from fastapi.testclient import TestClient

from app import llm, prompts, services
from app.main import app
from app.schemas import (Answer, BuildRequest, DecisionNote, OptionNote, PlanLLMOutput, PlanRequest, Question,
                         UnderstandLLMOutput, UnderstandRequest)

client = TestClient(app)


def note(rec="first"):
    return DecisionNote(context="Why it matters here.", first=OptionNote(benefit="Fast.", cost="Crowded."),
                        second=OptionNote(benefit="Tidy.", cost="Extra tap."), recommended=rec)


def good_plan(**over):
    base = dict(app_name="HabitFlow", understanding="You want X. You need Y.", summary="A tiny habit tracker.",
                target_user="Busy students", mvp_features=["Add a habit", "Mark done", "See streak"],
                later_features=["Reminders", "Charts"], navigation=note("second"), layout=note("first"))
    base.update(over)
    return PlanLLMOutput(**base)


def q(text="Who is it for?", options=("Me", "Friends", "A team")):
    return Question(question=text, options=list(options))


# ---------- understand ----------
def test_understand_returns_up_to_three_clean_questions(monkeypatch):
    out = UnderstandLLMOutput(questions=[
        q("Q1", ("A", "a", "B", "C", "D", "E")),      # duplicate (case-insensitive) removed, capped at 4 options
        q("Q2"), q("Q3"), q("Q4"),                      # 4th question dropped
    ])
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: out)
    res = services.understand_app(UnderstandRequest(idea="habit tracker"))
    assert res.ok and [x.question for x in res.questions] == ["Q1", "Q2", "Q3"]
    assert res.questions[0].options == ["A", "B", "C", "D"]


def test_understand_drops_unusable_questions_and_fails_if_too_few(monkeypatch):
    out = UnderstandLLMOutput(questions=[q("Good"), q("", ("A", "B")), q("One option", ("Only",))])
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: out)
    res = services.understand_app(UnderstandRequest(idea="habit tracker"))
    assert not res.ok and res.error_kind == "model"


def test_understand_reports_provider_errors(monkeypatch):
    def down(*a, **k):
        raise llm.LLMError("Gemini failed: 503", kind="provider")
    monkeypatch.setattr(llm, "generate_json", down)
    res = services.understand_app(UnderstandRequest(idea="habit tracker"))
    assert not res.ok and res.error_kind == "provider"


# ---------- plan ----------
def test_plan_builds_fixed_decision_cards_with_model_reasoning(monkeypatch):
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: good_plan())
    res = services.plan_app(PlanRequest(idea="habit tracker", answers=[Answer(question="Q", answer="A")]))
    assert res.ok
    nav, layout = res.plan.decisions
    assert (nav.key, [o.value for o in nav.options], nav.recommended) == ("navigation", ["single", "tabs"], "tabs")
    assert (layout.key, [o.value for o in layout.options], layout.recommended) == ("layout", ["list", "cards"], "list")
    assert nav.options[0].label == "Single screen" and nav.options[1].benefit == "Tidy."
    assert res.plan.idea == "habit tracker" and res.plan.app_name == "HabitFlow"


def test_plan_unknown_recommendation_defaults_to_first(monkeypatch):
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: good_plan(navigation=note("maybe both")))
    assert services.plan_app(PlanRequest(idea="habit tracker")).plan.decisions[0].recommended == "single"


def test_plan_trims_long_lists_and_names(monkeypatch):
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: good_plan(
        app_name="N" * 80, mvp_features=[f"f{i}" for i in range(9)], later_features=[f"l{i}" for i in range(9)]))
    plan = services.plan_app(PlanRequest(idea="habit tracker")).plan
    assert len(plan.app_name) == 40 and len(plan.mvp_features) == 5 and len(plan.later_features) == 4


def test_plan_rejects_thin_output(monkeypatch):
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: good_plan(mvp_features=["Only one", "  "]))
    res = services.plan_app(PlanRequest(idea="habit tracker"))
    assert not res.ok and res.error_kind == "model" and "MVP" in res.errors[0]


def test_plan_rejects_empty_decision_text(monkeypatch):
    bad = DecisionNote(context="", first=OptionNote(benefit="a", cost="b"), second=OptionNote(benefit="c", cost="d"), recommended="first")
    monkeypatch.setattr(llm, "generate_json", lambda *a, **k: good_plan(layout=bad))
    assert not services.plan_app(PlanRequest(idea="habit tracker")).ok


def test_plan_prompt_contains_the_answers():
    p = prompts.plan_prompt("habit tracker", [Answer(question="Who for?", answer="Just me")])
    assert "habit tracker" in p and "Who for?" in p and "Just me" in p


# ---------- the plan feeds the build ----------
def test_build_prompt_carries_the_plan(monkeypatch, good_html):
    seen = {}
    monkeypatch.setattr(llm, "generate_text", lambda s, p, **k: seen.setdefault("p", p) and good_html)
    services.build_app(BuildRequest(idea="habit tracker", app_name="HabitFlow", summary="A tiny habit tracker.",
                                    target_user="Busy students", mvp_features=["Add a habit", "Mark done"]))
    p = seen["p"]
    assert "HabitFlow" in p and "A tiny habit tracker." in p and "Busy students" in p and "- Add a habit" in p


def test_form_guidance_is_in_the_build_rules():
    assert "preventDefault" in prompts.BUILD_SYSTEM


# ---------- http ----------
def test_http_understand_and_plan(monkeypatch):
    monkeypatch.setattr(llm, "generate_json", lambda s, p, schema, **k: (
        UnderstandLLMOutput(questions=[q("A?"), q("B?"), q("C?")]) if schema is UnderstandLLMOutput else good_plan()))
    r = client.post("/api/understand", json={"idea": "habit tracker"}).json()
    assert r["ok"] and len(r["questions"]) == 3
    r = client.post("/api/plan", json={"idea": "habit tracker", "answers": [{"question": "A?", "answer": "Me"}]}).json()
    assert r["ok"] and r["plan"]["decisions"][0]["key"] == "navigation"
    assert client.post("/api/plan", json={"idea": "habit tracker", "answers": [{"question": "q", "answer": ""}]}).status_code == 422


def test_tabs_prompt_asks_for_elements_on_both_tabs():
    assert "BOTH tabs" in prompts.NAVIGATION["tabs"] and "Spread" in prompts.NAVIGATION["tabs"]
