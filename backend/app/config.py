"""All configuration lives here so the model/provider is easy to change and easy to explain."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
# Used only when the main model is overloaded (429/5xx after retries) or not found (404). Set empty to disable.
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.1-flash-lite")
BUILD_TIMEOUT_S = int(os.getenv("BUILD_TIMEOUT_S", "90"))
EXPLAIN_TIMEOUT_S = int(os.getenv("EXPLAIN_TIMEOUT_S", "60"))
PLAN_TIMEOUT_S = int(os.getenv("PLAN_TIMEOUT_S", "45"))
