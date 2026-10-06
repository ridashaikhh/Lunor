"""The only file that knows which LLM provider is used. To switch provider, change this file only."""
from __future__ import annotations

import re
import time
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from . import config

T = TypeVar("T", bound=BaseModel)

TRANSIENT_CODES = {429, 500, 502, 503, 504}   # overloaded / rate limited / server hiccup: worth retrying
RETRY_DELAYS = (1.5, 4.0)                     # seconds to wait between attempts on the same model


class LLMError(Exception):
    """kind: config | provider | model  (see schemas.ErrorKind)."""

    def __init__(self, message: str, retryable: bool = True, kind: str = "provider"):
        super().__init__(message)
        self.retryable = retryable
        self.kind = kind


_client = None


def _get_client():
    global _client
    if not config.GEMINI_API_KEY:
        raise LLMError("GEMINI_API_KEY is not set on the server", retryable=False, kind="config")
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def _models_to_try() -> list[str]:
    models = [config.GEMINI_MODEL]
    backup = (config.GEMINI_FALLBACK_MODEL or "").strip()
    if backup and backup != config.GEMINI_MODEL:
        models.append(backup)
    return models


def _call(gen_config, prompt: str) -> str:
    """One logical request. Absorbs temporary Gemini trouble so the rest of the app never sees it:
       - 429/5xx: wait and retry on the same model, then try the backup model
       - 404 (model name wrong/retired): go straight to the backup model
       - 401/403 (bad key): stop at once, retrying can't help
       - anything else: raise immediately"""
    client = _get_client()
    last: LLMError | None = None
    for model in _models_to_try():
        for attempt in range(len(RETRY_DELAYS) + 1):
            try:
                resp = client.models.generate_content(model=model, contents=prompt, config=gen_config)
            except Exception as exc:  # the SDK raises several types; they all carry .code when it is an HTTP error
                code = getattr(exc, "code", None)
                code = code if isinstance(code, int) else None
                if code in (401, 403):
                    raise LLMError(f"Gemini rejected the API key (HTTP {code}). Check GEMINI_API_KEY.",
                                   retryable=False, kind="config") from exc
                last = LLMError(f"Gemini ({model}) failed: {exc}", kind="provider")
                if code in TRANSIENT_CODES:
                    if attempt < len(RETRY_DELAYS):
                        time.sleep(RETRY_DELAYS[attempt])
                        continue
                    break                      # out of retries on this model: try the backup model
                if code == 404:
                    break                      # unknown model: try the backup model
                raise last from exc            # 400, timeouts, network errors, ...
            text = resp.text or ""
            if not text.strip():
                raise LLMError("Gemini returned an empty response", kind="model")
            return text
    raise last or LLMError("No model available", kind="provider")


def generate_text(system: str, prompt: str, *, temperature: float = 0.4, timeout_s: int = 90,
                  max_output_tokens: int = 16384) -> str:
    """Free-form text (used for the HTML app, which would be fragile to wrap in JSON)."""
    from google.genai import types

    cfg = types.GenerateContentConfig(
        system_instruction=system, temperature=temperature, max_output_tokens=max_output_tokens,
        http_options=types.HttpOptions(timeout=timeout_s * 1000),
    )
    return _call(cfg, prompt)


def generate_json(system: str, prompt: str, schema: type[T], *, temperature: float = 0.3, timeout_s: int = 60,
                  max_output_tokens: int = 12000) -> T:
    """Structured output validated by a Pydantic model."""
    from google.genai import types

    cfg = types.GenerateContentConfig(
        system_instruction=system, temperature=temperature, max_output_tokens=max_output_tokens,
        response_mime_type="application/json", response_schema=schema,
        http_options=types.HttpOptions(timeout=timeout_s * 1000),
    )
    text = _call(cfg, prompt)
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return schema.model_validate_json(text)
    except ValidationError as exc:
        raise LLMError(f"Model returned JSON that did not match the schema ({exc.error_count()} problems)",
                       kind="model") from exc
