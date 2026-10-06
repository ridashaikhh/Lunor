"""Prompts. The BUILD contract is what makes generated apps small, runnable and explainable."""
from __future__ import annotations

from pathlib import Path

from .schemas import BuildRequest

_BUILD_RULES = """You generate a tiny, working mobile-style web app as ONE self-contained HTML file.
Reply with ONLY the HTML document. No markdown fences, no commentary before or after.

HARD RULES (the file is automatically checked; a violation means it is rejected):
1. Structure: <!DOCTYPE html>, <html>, <head> with ONE <style>, <body> with the UI and ONE inline <script>.
2. Fully self-contained: no external libraries, fonts, images, URLs, <link> tags, or network calls of any kind.
   Do not use localStorage/sessionStorage/cookies (unavailable): keep all data in memory.
   Do not use alert(), confirm() or prompt() (blocked): build any messages or confirmations into the page.
3. Size: 150-250 lines in total. Plain HTML, CSS and vanilla JavaScript only. No frameworks.
4. The page is shown in a phone screen about 375px wide and 700px tall. Make it fill that space (html, body, .app at height 100%),
   scroll inside the app if needed, use large touch-friendly controls, and make it look polished and modern.
5. Architecture a beginner can read: one `state` object holds all data; small named functions; a `render()` function redraws
   the screen from `state`; event handlers change `state` and then call `render()`.
6. It must genuinely work: adding, removing, toggling, filtering, switching tabs, etc. all function.
   Prefer plain buttons with click handlers. If you do use a <form>, its submit handler MUST call event.preventDefault().
   Start with 3 realistic sample items in `state` so every important element is visible on first load.

EXPLAINABLE ELEMENTS (this powers a click-to-explain feature for learners):
7. Pick 6 to 8 important interactive or informative elements and give each a unique attribute data-explain="kebab-case-id",
   for example data-explain="add-button". Elements created inside template strings in JavaScript carry the attribute too.
   Tag the innermost element that matters (a delete button, not the whole row).
   Write the attribute literally as data-explain="id", either in the HTML or inside a template string. Do not set it with
   setAttribute() or dataset. Every id used in a marker must also appear on an element.
8. For every id, wrap the code that makes that element work in marker comments, each marker on its OWN line:
   - JavaScript:  // @explain:add-button   ...code...   // @end:add-button
   - CSS:         /* @explain:add-button */   ...rules...   /* @end:add-button */
   - HTML:        <!-- @explain:add-button -->   ...markup...   <!-- @end:add-button -->
   Every id needs at least one region, normally the JavaScript handler or render function (3-15 lines, focused on the logic a
   learner should study). A region must stay inside one language. Never put markers inside a template string.
   Plain comments that are not markers are fine and helpful, but keep them short.
9. Do NOT build any explain, help, tutorial, learning or "show code" feature or toggle inside the app: the host environment
   already provides that. Tag only the app's own functional elements, never a control that is about explaining.

Example of the marker style (shape only):
  // @explain:add-button
  addBtn.addEventListener("click", () => { /* read input, update state, render() */ });
  // @end:add-button
"""

# A complete, valid app (it is the fallback app, which our own validator checks) shown as a worked example.
# Showing a conforming file is far more reliable than describing one.
_REFERENCE_APP = (Path(__file__).resolve().parent.parent / "fallback" / "expense_tracker.html").read_text(encoding="utf-8")

BUILD_SYSTEM = (
    _BUILD_RULES
    + "\nREFERENCE: a complete app that follows every rule above (a DIFFERENT idea: study its structure, its data-explain "
    "tagging and its marker comments, but never copy its content, ids, names or features):\n\n"
    + _REFERENCE_APP
)

NAVIGATION = {
    "single": "Navigation: ONE screen only, no tab bar. Everything lives on that single scrolling screen.",
    "tabs": (
        "Navigation: TWO tabs with a bottom tab bar (pick two short tab names that fit the idea). Only one tab is visible at a time; "
        "switching is done in JavaScript. Elements of BOTH tabs must exist in the DOM from page load (hide the inactive tab with "
        "the `hidden` attribute, do not create or destroy it). Spread the explainable elements across BOTH tabs so there is something to explore on each."
    ),
}
LAYOUT = {
    "list": "Layout of items: compact rows in a vertical list.",
    "cards": "Layout of items: larger cards in a 2-column grid, each card with a clear title, the key detail and a colour accent.",
}


def build_user_prompt(req: BuildRequest) -> str:
    parts = [f"App idea: {req.idea.strip()}"]
    if req.app_name:
        parts.append(f"App name (show it in the header): {req.app_name.strip()}")
    if req.summary:
        parts.append(f"What it is: {req.summary.strip()}")
    if req.target_user:
        parts.append(f"Who it is for: {req.target_user.strip()}")
    parts += [
        NAVIGATION[req.decisions.navigation],
        LAYOUT[req.decisions.layout],
    ]
    if req.mvp_features:
        parts.append("MVP features to include (keep the app small, implement these and nothing else):\n- " + "\n- ".join(req.mvp_features))
    else:
        parts.append("Choose 3-4 core MVP features that fit the idea and implement only those.")
    if req.previous_error:
        parts.append(
            "YOUR PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these problems and keep following all rules:\n" + req.previous_error
        )
    return "\n\n".join(parts)


EXPLAIN_SYSTEM = """You are a friendly programming teacher explaining a small app to a beginner who is learning to build apps.
You are given the app's full source and, for each explainable element, the exact code that powers it.
Write one explanation per element. Rules:
- Return every id you were given, exactly as written, nothing else.
- Be specific to THIS app: mention real function, variable and element names that appear in the given code. Never be generic.
- Wrap code identifiers, function names and short code fragments in single backticks, like `render()`.
- what_it_does: 1-2 sentences about what the element does for the person using the app.
- how_it_works: 2-4 sentences walking through the given code in plain language.
- concept: the programming concept in 2-4 words (e.g. Event handling, Array filtering, Derived state).
- concept_note: one sentence explaining that concept in general, without jargon.
- try_changing: ONE small edit to the given code (name the exact line or value) and the visible change the learner will see
  in the running app. It must be safe, and it must really work with the code as written.
Keep the tone encouraging and the text short."""


def build_explain_prompt(html: str, ids: list[str], regions: dict) -> str:
    blocks = []
    for rid in ids:
        code = "\n\n".join(f"[{r.language}]\n{r.code}" for r in regions[rid])
        blocks.append(f"### id: {rid}\n{code}")
    return (
        "FULL APP SOURCE (for context):\n```html\n" + html + "\n```\n\n"
        "ELEMENTS TO EXPLAIN (exact code regions):\n\n" + "\n\n".join(blocks)
    )


# ---------------- Understand ----------------
UNDERSTAND_SYSTEM = """You are a sharp, friendly product coach helping a beginner clarify a mobile app idea before it is built.
Ask exactly 3 questions: the three that would change what gets built the most for THIS specific idea.
Rules:
- Every question must be specific to the idea. Never ask generic things (colours, names, "who is your audience?").
- Cover three different angles, for example: the situation or person it serves, the single core action or data it handles,
  and what to keep out so the first version stays small.
- Each question is answered by tapping one of 3 or 4 short options (6 words or fewer each). Options must be realistic,
  distinct from each other, and cover the most likely answers.
- Never ask about technology, budget, deadlines or platforms. Use plain language a beginner understands."""


def understand_prompt(idea: str) -> str:
    return f"App idea: {idea.strip()}"


# ---------------- Plan ----------------
PLAN_SYSTEM = """You turn an app idea plus a few answers into a concise plan for a SMALL prototype. Be concrete and specific to this idea.
- app_name: short, friendly, 1-3 words.
- understanding: exactly two sentences starting with "You want", reflecting the person's answers.
- summary: one sentence describing the prototype.
- target_user: one short phrase.
- mvp_features: 3 to 5 features, each 8 words or fewer. The prototype is ONE tiny web app with data kept in memory:
  no accounts, no backend, no network, no notifications, no camera, no maps. Only include features that fit that.
- later_features: 3 to 4 bigger ideas beyond the prototype (accounts, sync, reminders, charts, sharing...).
- Two decisions follow. For each, write one sentence of context on why it matters for THIS app, then for each option one
  sentence on what the user gains and one on what they give up, specific to this app (never generic). Pick a recommended option.
  navigation: first = Single screen (everything on one scrolling screen), second = Two tabs (a bottom tab bar with two views).
  layout: first = List (compact rows), second = Cards (larger cards in a 2-column grid).
  "recommended" must be exactly "first" or "second"."""


def plan_prompt(idea: str, answers) -> str:
    lines = [f"App idea: {idea.strip()}"]
    if answers:
        lines.append("The person's answers:")
        lines += [f"- Q: {a.question.strip()}\n  A: {a.answer.strip()}" for a in answers]
    return "\n".join(lines)
