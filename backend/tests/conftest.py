import json
from pathlib import Path

import pytest

FALLBACK = Path(__file__).resolve().parent.parent / "fallback"


@pytest.fixture(scope="session")
def good_html() -> str:
    return (FALLBACK / "expense_tracker.html").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def good_explain() -> dict:
    return json.loads((FALLBACK / "expense_tracker.explain.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def never_touch_the_real_gemini(monkeypatch):
    """Tests must never spend quota or need the network, even when the developer's .env holds a real key.
    Tests that exercise the LLM layer install their own fake client (see test_llm.py)."""
    from app import config, llm

    monkeypatch.setattr(config, "GEMINI_API_KEY", "")
    monkeypatch.setattr(llm, "_client", None)
