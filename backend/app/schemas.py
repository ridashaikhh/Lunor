from typing import Literal

from pydantic import BaseModel, Field


# Why a call failed. The frontend uses this to decide what to do next:
#   validation: the model's output broke our rules -> retry once, telling the model what was wrong
#   model:      the model's output was unusable (empty, bad JSON, missing items) -> retry once
#   provider:   Gemini is overloaded/unavailable even after our own retries -> don't retry, use the example
#   config:     missing/invalid API key -> don't retry, use the example
ErrorKind = Literal["validation", "model", "provider", "config"]


class Decisions(BaseModel):
    """Choices the user makes on the Plan screen. Every option must be something the generator can really build."""

    navigation: Literal["single", "tabs"] = "single"
    layout: Literal["list", "cards"] = "list"


class BuildRequest(BaseModel):
    idea: str = Field(min_length=3, max_length=300)
    app_name: str | None = Field(default=None, max_length=60)
    summary: str | None = Field(default=None, max_length=400)
    target_user: str | None = Field(default=None, max_length=200)
    decisions: Decisions = Decisions()
    mvp_features: list[str] = Field(default_factory=list, max_length=8)
    # Set by the frontend on the single retry: what went wrong with the first attempt.
    previous_error: str | None = Field(default=None, max_length=1200)


class BuildResponse(BaseModel):
    ok: bool
    html: str = ""
    ids: list[str] = []          # every data-explain id found in the generated page
    errors: list[str] = []
    retryable: bool = True       # False for config problems (e.g. missing API key): retrying won't help
    error_kind: ErrorKind | None = None


class Snippet(BaseModel):
    language: Literal["html", "css", "js"]
    code: str
    start_line: int              # 1-based line numbers in the generated file
    end_line: int


class ExplainItem(BaseModel):
    """What the LLM writes for one element (this is also the structured-output schema)."""

    id: str
    title: str = Field(description="Short human name for the element, e.g. 'Add expense button'")
    what_it_does: str = Field(description="1-2 sentences: what this element does for the user of the app")
    how_it_works: str = Field(description="Plain-language walkthrough of the given code, naming real functions and variables")
    concept: str = Field(description="Name of the programming concept, 2-4 words")
    concept_note: str = Field(description="One sentence explaining the concept in general")
    try_changing: str = Field(description="One small concrete edit to the given code and what visible change to expect")


class ExplainLLMOutput(BaseModel):
    items: list[ExplainItem]


class ExplainEntry(ExplainItem):
    """ExplainItem plus the real code regions, which the server cuts out of the generated file itself."""

    snippets: list[Snippet]


class ExplainRequest(BaseModel):
    html: str = Field(min_length=100, max_length=80_000)


class ExplainResponse(BaseModel):
    ok: bool
    explanations: list[ExplainEntry] = []
    errors: list[str] = []
    retryable: bool = True
    error_kind: ErrorKind | None = None


# ---------------- Understand: the Idea Interrogator ----------------
class UnderstandRequest(BaseModel):
    idea: str = Field(min_length=3, max_length=300)


class Question(BaseModel):
    question: str = Field(description="One question specific to this app idea")
    options: list[str] = Field(description="3-4 short tappable answers, 6 words or fewer each")


class UnderstandLLMOutput(BaseModel):
    questions: list[Question]


class UnderstandResponse(BaseModel):
    ok: bool
    questions: list[Question] = []
    errors: list[str] = []
    retryable: bool = True
    error_kind: ErrorKind | None = None


# ---------------- Plan ----------------
class Answer(BaseModel):
    question: str = Field(max_length=300)
    answer: str = Field(min_length=1, max_length=200)


class PlanRequest(BaseModel):
    idea: str = Field(min_length=3, max_length=300)
    answers: list[Answer] = Field(default_factory=list, max_length=4)


class OptionNote(BaseModel):
    benefit: str = Field(description="One sentence: what the user gains with this option in THIS app")
    cost: str = Field(description="One sentence: what the user gives up with this option in THIS app")


class DecisionNote(BaseModel):
    context: str = Field(description="One sentence on why this choice matters for THIS app")
    first: OptionNote
    second: OptionNote
    recommended: str = Field(description="Either 'first' or 'second'")


class PlanLLMOutput(BaseModel):
    app_name: str = Field(description="A short, friendly product name, 1-3 words")
    understanding: str = Field(description="Exactly two sentences starting 'You want...' describing what the person is after")
    summary: str = Field(description="One sentence describing the prototype")
    target_user: str = Field(description="One short phrase")
    mvp_features: list[str] = Field(description="3-5 features, each 8 words or fewer, buildable in a tiny offline web app")
    later_features: list[str] = Field(description="3-4 bigger ideas beyond the prototype")
    navigation: DecisionNote
    layout: DecisionNote


class DecisionOption(BaseModel):
    value: str
    label: str
    benefit: str
    cost: str


class DecisionCard(BaseModel):
    key: Literal["navigation", "layout"]
    title: str
    context: str
    options: list[DecisionOption]
    recommended: str


class Plan(BaseModel):
    idea: str
    app_name: str
    understanding: str
    summary: str
    target_user: str
    mvp_features: list[str]
    later_features: list[str]
    decisions: list[DecisionCard]


class PlanResponse(BaseModel):
    ok: bool
    plan: Plan | None = None
    errors: list[str] = []
    retryable: bool = True
    error_kind: ErrorKind | None = None
