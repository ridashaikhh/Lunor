"""Static checks on generated HTML + extraction of the code regions behind each explainable element.

The model tags elements with  data-explain="some-id"  and wraps the code that powers each element in marker
comments (// @explain:some-id ... // @end:some-id). We cut the snippets out of the file ourselves, so the code
shown to the learner is always the code that is really running, never something the model retyped.
"""
from __future__ import annotations

import re
import textwrap
from dataclasses import dataclass, field

# Tunable limits. The prompt asks for ~150-250 lines and 6-8 elements; these are the (looser) acceptance bounds.
MIN_LINES, MAX_LINES = 80, 450
MIN_IDS, MAX_IDS = 5, 9

ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,40}$")
# Every legitimate way a page can put data-explain="id" on an element. The browser-side check is the final judge of
# what is really in the DOM; this only needs to find the ids reliably.
TAG_PATTERNS = [
    # attribute in HTML or inside a JS string, incl. escaped quotes (data-explain=\"id\") and unquoted values
    re.compile(r"""data-explain\s*=\s*\\?["']?([A-Za-z][A-Za-z0-9_-]*)"""),
    re.compile(r"""setAttribute\(\s*\\?["']data-explain\\?["']\s*,\s*["']([A-Za-z][A-Za-z0-9_-]*)["']"""),
    re.compile(r"""\.dataset\.explain\s*=\s*["']([A-Za-z][A-Za-z0-9_-]*)["']"""),
]
MARKER_RE = re.compile(r"^\s*(?://|/\*|<!--)\s*@(explain|end):([A-Za-z0-9_-]+)\s*(?:\*/|-->)?\s*$")

# (pattern, message). Anything here would either break in the sandbox or reach outside the phone frame.
FORBIDDEN: list[tuple[str, str]] = [
    (r"<link\b", "Do not use <link> tags; the page must be fully self-contained."),
    (r"<script[^>]*\bsrc\s*=", "Do not load external scripts."),
    (r"""(?:src|href|action|poster)\s*=\s*["']\s*(?:https?:)?//""", "Do not reference external URLs."),
    (r"url\(\s*[\"']?\s*(?:https?:)?//", "Do not reference external URLs in CSS."),
    (r"@import\b", "Do not use CSS @import."),
    (r"\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon", "No network requests of any kind."),
    (r"\bimport\s*\(", "No dynamic imports."),
    (r"\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie",
     "Browser storage is not available in the sandbox; keep data in memory."),
    (r"\bwindow\s*\.\s*(?:parent|top|opener)\b|\b(?:parent|top)\s*\.\s*(?:postMessage|document|location)\b",
     "Do not touch window.parent/window.top."),
    (r"\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(", "Do not use eval, new Function or document.write."),
    (r"<iframe\b|<object\b|<embed\b", "Do not embed other documents."),
    (r"\b(?:alert|confirm|prompt)\s*\(",
     "alert/confirm/prompt are blocked in the sandbox; use in-page UI instead."),
    (r"\bwindow\s*\.\s*open\s*\(|\blocation\s*(?:\.\s*href\s*)?=[^=]", "Do not navigate or open windows."),
]


@dataclass
class Region:
    id: str
    language: str  # "html" | "css" | "js"
    code: str
    start_line: int
    end_line: int


@dataclass
class ValidationReport:
    errors: list[str] = field(default_factory=list)
    ids: list[str] = field(default_factory=list)
    regions: dict[str, list[Region]] = field(default_factory=dict)


def extract_html_document(raw: str) -> str:
    """Pull the HTML document out of a model reply (which may be wrapped in ``` fences or chatter)."""
    text = raw.replace("\r\n", "\n").strip()
    lower = text.lower()
    start = lower.find("<!doctype")
    if start == -1:
        start = lower.find("<html")
    if start == -1:
        return text
    end = lower.rfind("</html>")
    return text[start : end + len("</html>")] if end != -1 else text[start:]


def _language_after(line: str, current: str) -> str:
    """Track whether we are inside <style> / <script> as we walk the file line by line."""
    low = line.lower()
    if "<style" in low and "</style>" not in low:
        return "css"
    if "</style>" in low:
        return "html"
    if "<script" in low and "</script>" not in low:
        return "js"
    if "</script>" in low:
        return "html"
    return current


def extract_regions(html: str) -> tuple[dict[str, list[Region]], list[str]]:
    regions: dict[str, list[Region]] = {}
    errors: list[str] = []
    open_: dict[str, tuple[int, str, list[str]]] = {}  # id -> (marker line, language, collected lines)
    lang = "html"

    for n, line in enumerate(html.split("\n"), start=1):
        m = MARKER_RE.match(line)
        if m:
            kind, rid = m.group(1), m.group(2)
            if kind == "explain":
                if rid in open_:
                    errors.append(f"@explain:{rid} was opened twice without @end:{rid} (line {n}).")
                else:
                    open_[rid] = (n, lang, [])
            elif rid not in open_:
                errors.append(f"@end:{rid} has no matching @explain:{rid} (line {n}).")
            else:
                start, rlang, buf = open_.pop(rid)
                if rlang != lang:
                    errors.append(f"Region '{rid}' starts in {rlang} but ends in {lang}; keep each region in one language.")
                body = [x.rstrip() for x in buf]
                first, last = start + 1, n - 1  # 1-based file lines covered by `body`
                while body and not body[0].strip():  # trim blank edges but keep line numbers truthful
                    body.pop(0)
                    first += 1
                while body and not body[-1].strip():
                    body.pop()
                    last -= 1
                if not body:
                    errors.append(f"Region '{rid}' (line {start}) is empty.")
                else:
                    code = textwrap.dedent("\n".join(body))
                    regions.setdefault(rid, []).append(Region(rid, rlang, code, first, last))
        else:
            for _, _, buf in open_.values():
                buf.append(line)
        lang = _language_after(line, lang)

    for rid, (start, _, _) in open_.items():
        errors.append(f"@explain:{rid} (line {start}) is never closed with @end:{rid}.")
    return regions, errors


def tagged_ids(html: str) -> list[str]:
    """Unique data-explain ids in order of first appearance."""
    found = sorted((m.start(), m.group(1)) for pat in TAG_PATTERNS for m in pat.finditer(html))
    seen: list[str] = []
    for _, rid in found:
        if rid not in seen:
            seen.append(rid)
    return seen


def validate_app(html: str) -> ValidationReport:
    report = ValidationReport()
    errors = report.errors
    low = html.lower()

    if not html.strip():
        errors.append("The response was empty.")
        return report

    for needle, label in (("<!doctype html", "<!DOCTYPE html>"), ("<html", "<html>"), ("</html>", "</html>"),
                          ("<head", "<head>"), ("<body", "<body>"), ("</body>", "</body>")):
        if needle not in low:
            errors.append(f"Missing {label}; the document looks incomplete or was cut off.")
    if "<script" not in low:
        errors.append("The app needs an inline <script> to be interactive.")

    for pattern, message in FORBIDDEN:
        if re.search(pattern, html, flags=re.IGNORECASE):
            errors.append(message)

    n_lines = html.count("\n") + 1
    if n_lines < MIN_LINES:
        errors.append(f"Too short ({n_lines} lines); aim for 150-250 lines.")
    elif n_lines > MAX_LINES:
        errors.append(f"Too long ({n_lines} lines); keep it to 150-250 lines.")

    ids = tagged_ids(html)
    report.ids = ids
    for rid in ids:
        if not ID_RE.match(rid):
            errors.append(f"data-explain id '{rid}' must be lowercase kebab-case (letters, digits, hyphens).")
        elif "explain" in rid:
            errors.append(f"data-explain id '{rid}' looks like an explain/learning feature. Do not build one; "
                          "tag only the app's own functional elements.")
    if not MIN_IDS <= len(ids) <= MAX_IDS:
        errors.append(f"Found {len(ids)} data-explain elements; use 6-8.")

    regions, region_errors = extract_regions(html)
    report.regions = regions
    errors.extend(region_errors)
    for rid in ids:
        if rid not in regions:
            errors.append(f"data-explain=\"{rid}\" has no code region; wrap its code in // @explain:{rid} ... // @end:{rid}.")
    # A code region with no tagged element is harmless (there is simply nothing to attach it to), so drop it instead of
    # rejecting an otherwise good app. If too few elements remain, the 6-8 check above already catches that.
    for rid in [r for r in regions if r not in ids]:
        del regions[rid]
    return report
