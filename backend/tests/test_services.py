import pytest
from fastapi.testclient import TestClient

from app import llm, services
from app.main import app
from app.schemas import BuildRequest, ExplainItem, ExplainLLMOutput, ExplainRequest

client = TestClient(app)


def fake_items(good_explain, drop=None):
    return ExplainLLMOutput(items=[ExplainItem(**{k: v for k, v in i.items()}) for i in good_explain["items"] if i["id"] != drop])


def test_build_ok(monkeypatch, good_html):
    monkeypatch.setattr(llm, "generate_text", lambda *a, **k: "```html\n" + good_html + "\n```")
    res = services.build_app(BuildRequest(idea="expense tracker for students"))
    assert res.ok and res.ids[0] == "total-card" and res.html.startswith("<!DOCTYPE html>")


def test_build_returns_validation_errors_not_exceptions(monkeypatch, good_html):
    monkeypatch.setattr(llm, "generate_text", lambda *a, **k: good_html.replace("// @end:add-button", ""))
    res = services.build_app(BuildRequest(idea="expense tracker for students"))
    assert not res.ok and res.retryable and res.error_kind == "validation" and any("never closed" in e for e in res.errors)


def test_build_missing_api_key_is_not_retryable(monkeypatch):
    def boom(*a, **k):
        raise llm.LLMError("GEMINI_API_KEY is not set on the server", retryable=False, kind="config")
    monkeypatch.setattr(llm, "generate_text", boom)
    res = services.build_app(BuildRequest(idea="anything"))
    assert not res.ok and res.retryable is False and res.error_kind == "config"


def test_provider_outage_is_reported_as_such(monkeypatch):
    def down(*a, **k):
        raise llm.LLMError("Gemini (m) failed: 503 UNAVAILABLE", kind="provider")
    monkeypatch.setattr(llm, "generate_text", down)
    res = services.build_app(BuildRequest(idea="anything"))
    assert not res.ok and res.error_kind == "provider"


def test_prompt_contains_a_reference_app_that_itself_passes_validation(good_html):
    from app import prompts
    from app.validate import validate_app
    assert good_html in prompts.BUILD_SYSTEM
    assert validate_app(good_html).errors == []


def test_previous_error_is_passed_to_the_model(monkeypatch, good_html):
    seen = {}
    def capture(system, prompt, **k):
        seen["prompt"] = prompt
        return good_html
    monkeypatch.setattr(llm, "generate_text", capture)
    services.build_app(BuildRequest(idea="notes app", previous_error="Missing </html>"))
    assert "PREVIOUS ATTEMPT WAS REJECTED" in seen["prompt"] and "Missing </html>" in seen["prompt"]


def test_decisions_reach_the_prompt(monkeypatch, good_html):
    seen = {}
    monkeypatch.setattr(llm, "generate_text", lambda s, p, **k: seen.setdefault("p", p) and good_html)
    services.build_app(BuildRequest(idea="habit tracker", decisions={"navigation": "tabs", "layout": "cards"}))
    assert "TWO tabs" in seen["p"] and "2-column grid" in seen["p"]


def test_explain_attaches_real_code_from_the_html(monkeypatch, good_html, good_explain):
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: fake_items(good_explain))
    res = services.explain_app(ExplainRequest(html=good_html))
    assert res.ok and [e.id for e in res.explanations] == [i["id"] for i in good_explain["items"]]
    add = next(e for e in res.explanations if e.id == "add-button")
    assert add.snippets[0].language == "js" and "readAmount()" in add.snippets[0].code
    # every line of the snippet really exists in the generated file (ignoring indentation)
    file_lines = {l.strip() for l in good_html.split("\n")}
    assert all(l.strip() in file_lines for l in add.snippets[0].code.split("\n") if l.strip())


def test_explain_fails_when_an_id_is_missing(monkeypatch, good_html, good_explain):
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: fake_items(good_explain, drop="delete-button"))
    res = services.explain_app(ExplainRequest(html=good_html))
    assert not res.ok and any("delete-button" in e for e in res.errors)


def test_explain_revalidates_html_it_is_sent(good_html):
    res = services.explain_app(ExplainRequest(html=good_html.replace("// @end:add-button", "")))
    assert not res.ok and res.retryable is False


def test_http_endpoints(monkeypatch, good_html, good_explain):
    monkeypatch.setattr(llm, "generate_text", lambda *a, **k: good_html)
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: fake_items(good_explain))
    assert client.get("/api/health").json()["ok"] is True
    built = client.post("/api/build", json={"idea": "expense tracker for students"}).json()
    assert built["ok"] and len(built["ids"]) == 7
    explained = client.post("/api/explain", json={"html": built["html"]}).json()
    assert explained["ok"] and len(explained["explanations"]) == 7
    assert client.post("/api/build", json={"idea": "x"}).status_code == 422          # too short
    assert client.post("/api/build", json={"idea": "ok idea", "decisions": {"navigation": "drawer"}}).status_code == 422
