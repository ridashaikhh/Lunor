"""Builds the known-good example bundle the frontend ships with.

Run from backend/:   python -m scripts.build_fallback
The example passes through the SAME validator and region extractor as AI output, so it can never drift from the contract.
"""
import json
from pathlib import Path

from app.validate import validate_app

ROOT = Path(__file__).resolve().parent.parent
SRC_HTML = ROOT / "fallback" / "expense_tracker.html"
SRC_EXPLAIN = ROOT / "fallback" / "expense_tracker.explain.json"
OUT = ROOT.parent / "frontend" / "src" / "fallback" / "expenseTracker.json"


def build_bundle() -> dict:
    html = SRC_HTML.read_text(encoding="utf-8")
    meta = json.loads(SRC_EXPLAIN.read_text(encoding="utf-8"))
    report = validate_app(html)
    if report.errors:
        raise SystemExit("Fallback app fails validation:\n- " + "\n- ".join(report.errors))

    items = {i["id"]: i for i in meta["items"]}
    if set(items) != set(report.ids):
        raise SystemExit(f"Explanation ids {sorted(items)} do not match tagged ids {report.ids}")

    explanations = []
    for rid in report.ids:  # keep the order the elements appear in the page
        snippets = [{"language": r.language, "code": r.code, "start_line": r.start_line, "end_line": r.end_line}
                    for r in report.regions[rid]]
        explanations.append({**items[rid], "snippets": snippets})
    return {"title": meta["title"], "html": html, "ids": report.ids, "explanations": explanations}


if __name__ == "__main__":
    bundle = build_bundle()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} ({len(bundle['explanations'])} explainable elements, {bundle['html'].count(chr(10)) + 1} lines)")
