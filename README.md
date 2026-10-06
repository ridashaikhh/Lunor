# Lunor App Dev prototype : Understand -> Plan -> Build -> Explain -> Learn

Idea -> 3 idea-specific questions -> a plan with two decisions -> a small generated app in a phone frame ->
Explain mode (click anything to see the real code, the concept and one thing to try changing) -> "What you learned".
Without an API key, **Skip to a ready-made example** runs the Build/Explain/Learn experience with no AI at all.

## Run it
```bash
# 1. backend  (Python 3.11+)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then put your Gemini key in GEMINI_API_KEY
python -m uvicorn app.main:app --reload --port 8000

# 2. frontend (Node 20+), in another terminal
cd frontend
npm install
npm run dev                     # http://localhost:5173  (proxies /api to :8000)
```

## Tests
```bash
cd backend  && python -m pytest -q       # validator, region extractor, services (LLM mocked)
cd frontend && npm test                  # iframe bridge, retry/fallback policy, React flow (jsdom)
```

## Endpoints
`POST /api/understand` (questions) · `/api/plan` (plan + decision cards) · `/api/build` · `/api/explain` · `GET /api/health`

## How reliability works
1. The model must follow a strict contract (see `backend/app/prompts.py`): one HTML file, no network/storage,
   6-8 elements tagged `data-explain`, and marker comments around the code behind each one.
2. **Static check** (backend, `validate.py`): structure, forbidden APIs, size, tags <-> code regions match.
3. **Runtime check** (frontend, `verify.js`): the app loads in a hidden sandboxed iframe with no script errors
   and every tagged element present.
4. Either check fails -> **one retry** that tells the model what was wrong. Fails again -> the **pre-built example**
   (with a visible notice, never silently).
   Temporary Gemini trouble (503 overloaded, 429 rate limit) is absorbed in `llm.py`: wait and retry, then try the backup
   model (`GEMINI_FALLBACK_MODEL`). A bad API key or a Gemini outage skips the retry and goes straight to the example.
5. Code shown in the Explain panel is **cut out of the generated file by the server**, not retyped by the model.

## Layout
- `backend/app/` `validate.py` (checks + code-region extraction), `prompts.py`, `llm.py` (only file that knows the provider), `services.py`, `main.py`
- `backend/fallback/` the known-good app + its hand-written explanations; `python -m scripts.build_fallback` bundles it for the frontend
- `frontend/src/lib/` `bridge.iife.js` (runs inside the app), `verify.js`, `pipeline.js`, `highlight.js`
- Model is set by `GEMINI_MODEL` in `.env`. Model names change often: check https://ai.google.dev/gemini-api/docs/models
- The preview iframe is sandboxed with `allow-scripts allow-forms` (never `allow-same-origin`). `allow-forms` is required:
  without it browsers never fire `submit` events, so generated apps that use a <form> silently do nothing. The bridge
  cancels every form's default action so a form can never navigate the preview.
- If Understand or Plan fails (after one retry), the flow continues with a ready-made plan and says so.

## Deploy (one service, Render)
1. Push this repo to GitHub (`.env` is git-ignored; never commit your key).
2. Render dashboard -> **New + -> Blueprint** -> pick the repo (it reads `render.yaml` and the `Dockerfile`).
3. Paste `GEMINI_API_KEY` when asked. Deploy. The same service serves the React app and the API.
4. Open `<your-url>/api/health`: it should say `"llm_configured": true`.
Free instances sleep when idle and take about a minute to wake; open the URL before demoing.
Rate limits: `RATE_LIMIT_PER_IP_HOUR` (default 60) and `RATE_LIMIT_GLOBAL_DAY` (default 1000) are environment variables.
