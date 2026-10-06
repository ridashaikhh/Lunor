"""Build and Explain, one LLM call each. Each call makes ONE attempt; the frontend owns the retry-then-fallback policy."""
from __future__ import annotations

from . import config, llm, prompts
from .schemas import (BuildRequest, BuildResponse, DecisionCard, DecisionOption, ExplainEntry, ExplainLLMOutput,
                      ExplainRequest, ExplainResponse, Plan, PlanLLMOutput, PlanRequest, PlanResponse, Question,
                      Snippet, UnderstandLLMOutput, UnderstandRequest, UnderstandResponse)
from .validate import extract_html_document, validate_app


def build_app(req: BuildRequest) -> BuildResponse:
    try:
        raw = llm.generate_text(prompts.BUILD_SYSTEM, prompts.build_user_prompt(req), timeout_s=config.BUILD_TIMEOUT_S)
    except llm.LLMError as exc:
        return BuildResponse(ok=False, errors=[str(exc)], retryable=exc.retryable, error_kind=exc.kind)

    html = extract_html_document(raw)
    report = validate_app(html)
    if report.errors:
        return BuildResponse(ok=False, errors=report.errors[:8], error_kind="validation")
    return BuildResponse(ok=True, html=html, ids=report.ids)


def explain_app(req: ExplainRequest) -> ExplainResponse:
    # Never trust the client: re-validate and re-extract the code regions from the HTML we were sent.
    report = validate_app(req.html)
    if report.errors:
        return ExplainResponse(ok=False, errors=report.errors[:8], retryable=False, error_kind="validation")

    try:
        out = llm.generate_json(
            prompts.EXPLAIN_SYSTEM,
            prompts.build_explain_prompt(req.html, report.ids, report.regions),
            ExplainLLMOutput,
            timeout_s=config.EXPLAIN_TIMEOUT_S,
        )
    except llm.LLMError as exc:
        return ExplainResponse(ok=False, errors=[str(exc)], retryable=exc.retryable, error_kind=exc.kind)

    by_id = {}
    for item in out.items:
        by_id.setdefault(item.id.strip(), item)

    problems: list[str] = []
    entries: list[ExplainEntry] = []
    for rid in report.ids:
        item = by_id.get(rid)
        if item is None:
            problems.append(f"No explanation returned for '{rid}'.")
            continue
        fields = (item.title, item.what_it_does, item.how_it_works, item.concept, item.concept_note, item.try_changing)
        if any(not f.strip() for f in fields):
            problems.append(f"Explanation for '{rid}' has an empty field.")
            continue
        snippets = [Snippet(language=r.language, code=r.code, start_line=r.start_line, end_line=r.end_line)
                    for r in report.regions[rid]]
        entries.append(ExplainEntry(**{**item.model_dump(), "id": rid}, snippets=snippets))
    if problems:
        return ExplainResponse(ok=False, errors=problems, error_kind="model")
    return ExplainResponse(ok=True, explanations=entries)


# ---------------- Understand ----------------
def understand_app(req: UnderstandRequest) -> UnderstandResponse:
    try:
        out = llm.generate_json(prompts.UNDERSTAND_SYSTEM, prompts.understand_prompt(req.idea), UnderstandLLMOutput,
                                temperature=0.6, timeout_s=config.PLAN_TIMEOUT_S, max_output_tokens=4096)
    except llm.LLMError as exc:
        return UnderstandResponse(ok=False, errors=[str(exc)], retryable=exc.retryable, error_kind=exc.kind)

    questions: list[Question] = []
    for q in out.questions:
        text = q.question.strip()
        options: list[str] = []
        for o in q.options:
            o = o.strip()
            if o and o.lower() not in {x.lower() for x in options}:
                options.append(o)
        if text and len(options) >= 2:
            questions.append(Question(question=text, options=options[:4]))
    questions = questions[:3]
    if len(questions) < 2:
        return UnderstandResponse(ok=False, errors=["The model returned fewer than 2 usable questions."], error_kind="model")
    return UnderstandResponse(ok=True, questions=questions)


# ---------------- Plan ----------------
# The decisions are fixed to things the generator can really build. The model only writes the app-specific reasoning.
DECISION_DEFS = {
    "navigation": ("How should people move around?", (("single", "Single screen"), ("tabs", "Two tabs"))),
    "layout": ("How should items be shown?", (("list", "List"), ("cards", "Cards"))),
}


def _decision_card(key: str, note) -> DecisionCard:
    title, ((v1, l1), (v2, l2)) = DECISION_DEFS[key]
    rec = v2 if note.recommended.strip().lower() == "second" else v1
    return DecisionCard(
        key=key, title=title, context=note.context.strip(), recommended=rec,
        options=[DecisionOption(value=v1, label=l1, benefit=note.first.benefit.strip(), cost=note.first.cost.strip()),
                 DecisionOption(value=v2, label=l2, benefit=note.second.benefit.strip(), cost=note.second.cost.strip())],
    )


def plan_app(req: PlanRequest) -> PlanResponse:
    try:
        out = llm.generate_json(prompts.PLAN_SYSTEM, prompts.plan_prompt(req.idea, req.answers), PlanLLMOutput,
                                temperature=0.3, timeout_s=config.PLAN_TIMEOUT_S, max_output_tokens=6000)
    except llm.LLMError as exc:
        return PlanResponse(ok=False, errors=[str(exc)], retryable=exc.retryable, error_kind=exc.kind)

    clean = lambda items: [i.strip() for i in items if i.strip()]
    mvp, later = clean(out.mvp_features)[:5], clean(out.later_features)[:4]
    notes = [out.navigation.context, out.navigation.first.benefit, out.navigation.first.cost, out.navigation.second.benefit,
             out.navigation.second.cost, out.layout.context, out.layout.first.benefit, out.layout.first.cost,
             out.layout.second.benefit, out.layout.second.cost]
    problems = []
    if len(mvp) < 3:
        problems.append("Fewer than 3 MVP features.")
    if len(later) < 2:
        problems.append("Fewer than 2 later features.")
    if not all(x.strip() for x in (out.app_name, out.understanding, out.summary, out.target_user)):
        problems.append("A required text field was empty.")
    if not all(n.strip() for n in notes):
        problems.append("A decision explanation was empty.")
    if problems:
        return PlanResponse(ok=False, errors=problems, error_kind="model")

    plan = Plan(
        idea=req.idea.strip(), app_name=out.app_name.strip()[:40], understanding=out.understanding.strip(),
        summary=out.summary.strip(), target_user=out.target_user.strip(), mvp_features=mvp, later_features=later,
        decisions=[_decision_card("navigation", out.navigation), _decision_card("layout", out.layout)],
    )
    return PlanResponse(ok=True, plan=plan)
