# Lunor App Development: Round 1 submission

**Live demo:** `<paste your Render URL>`  ·  **Code:** `<paste your GitHub URL>`

## Short version (for the submission box)

I built a guided prototype of Lunor for **app development** that goes beyond "prompt → app". You describe an idea, and it
walks you through **Understand → Plan → Build → Explain → Learn**: Gemini asks three questions specific to your idea,
writes a plan with two decision cards (navigation style, item layout) whose choices really change the generated app, then
builds a small interactive mobile-style app in a phone frame. The key feature is **Click-to-Explain**: turn on Explain
mode, click any element in the running app, and see the *real code behind it* (cut from the generated file with true line
numbers), how it works, the programming concept, and one thing to try changing. A "What you learned" section collects the
concepts you explored.

**AI tools and technologies used:** Google Gemini API (`gemini-3.5-flash`, via the `google-genai` SDK) for questions, plan,
app generation and explanations; Claude (Anthropic) as a planning and coding assistant during development; React 19, Vite,
FastAPI, Pydantic, Python 3.12, pytest, Vitest, Docker, Render, Git/GitHub.

---

## The flow

1. **Understand.** The AI asks 3 questions tailored to the idea; answer by tapping an option or typing your own.
2. **Plan.** It writes what it understood, the app summary and target user, features to build now vs later, and **two Decision
   Cards** (single screen vs two tabs; list vs cards) with trade-offs written for *this* app and a suggested option.
   Only choices the generator can genuinely build are offered, and your picks are passed to the build.
3. **Build.** Gemini generates one small self-contained mobile-style web app (HTML, CSS, vanilla JavaScript) that runs,
   interactively, inside a phone frame.
4. **Explain.** In Explain mode, clicking an element shows: what it does, **the actual code that powers it** with line
   numbers from the generated file, how it works, the concept involved, and one concrete "try changing this" experiment.
   Navigation controls (tab bars) explain *and* still work, so you can reach elements on the other tab.
5. **Learn.** A lightweight "What you learned" section lists the concepts and experiments from the elements you explored.

## What makes it reliable

- **The code you see is the code that runs.** The model marks the code behind each explainable element with comments;
  our server cuts those regions out of the generated file. The model never retypes code for the explanation.
- **Two checks before you see the app.** A static validator (structure, forbidden APIs, size, tags match code regions), then
  a runtime check in a hidden sandboxed iframe (it loads, no script errors, every explainable element is present).
- **One retry with feedback, then a safe fallback.** If a check fails, the model is told exactly what was wrong and tries once
  more. If it still fails, a pre-built example loads, with a visible notice, so the demo never ends in a broken frame.
- **Gemini overload is absorbed.** 503/429 responses are retried with backoff, then a backup model is tried. A bad API key or
  an outage skips pointless retries.
- **Safe preview.** The generated app runs in a sandboxed iframe (`allow-scripts allow-forms`, never same-origin) and cannot
  reach the host page; forms can never navigate it.
- **Public-demo protection.** Per-visitor and global rate limits protect the API quota; hitting them lands on the example.
- **Tested.** 63 backend tests (pytest) and 39 frontend tests (Vitest, jsdom, Testing Library) cover the validator, code
  extraction, retry and fallback policy, the iframe bridge and the full guided flow.

## AI tools and technologies used

**AI in the product**
- **Google Gemini API**: model `gemini-3.5-flash` (configurable; a backup model is configured for overload), called through the
  `google-genai` Python SDK. Four calls: (1) questions, (2) plan and decision-card reasoning, (3) app generation, (4) explanations.
  Questions, plan and explanations use **structured outputs** (JSON schema) validated with **Pydantic**; the app itself is plain
  HTML, validated by our own checks.

**AI used while building it**
- **Claude (Anthropic)**: planning, architecture, code and test writing, debugging.
- *(Add any other AI assistant you used, for example ChatGPT for npm setup help.)*

**Frameworks and tools**
- Frontend: React 19, Vite 8, plain CSS, Fontsource (Bricolage Grotesque, JetBrains Mono). No UI framework.
- Backend: Python 3.12, FastAPI, Uvicorn, Pydantic v2, python-dotenv.
- Testing: pytest, Vitest, Testing Library, jsdom.
- Delivery: Docker, Render, Git and GitHub.
- **Deliberately not used:** vector database or RAG, agent frameworks, a database, authentication. The prototype doesn't need them.

## Honest scope

**Real:** all four AI calls; generated apps that genuinely run; click-to-explain with the real code; decisions that change
the output; the safety and fallback behavior above.

**Simplified:** the generated app is a mobile-style *web* app, not a native build; its data lives in memory and resets on
reload; one app per run; "later" features are suggestions only; Learn is a lightweight summary, not a course or quiz.

**Known limits:** generation quality varies between runs (hence the validator, one retry and the fallback); a generated page
with an infinite loop cannot be detected; free-tier Gemini quotas apply.

## What Lunor App Development could become

Native export (React Native or Flutter), real persistence and backend choices as decision cards, editing the code and
watching the app change, teach-back and quizzes built from the learner's own app, and multi-screen apps.

## Suggested 2-minute demo

1. Type "a habit tracker". Answer the three questions (note they are about *this* idea).
2. On the plan screen, read "What I understood", then choose **Two tabs** and **Cards**. Press **Build**.
3. Use the app: add something, switch tabs.
4. Turn on **Explain mode**. Click a card, then the add button. Read the code, concept and "try changing this".
5. Point at "Learned so far" and "What you learned".
6. Mention the fallback: if Gemini fails, you still land on a working, explainable example.

## Run it locally

See `README.md`. Short version: put your key in `backend/.env`, run `python -m uvicorn app.main:app --port 8000` in
`backend/` and `npm run dev` in `frontend/`.
