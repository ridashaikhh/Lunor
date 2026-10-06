import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, ratelimit
from .schemas import (BuildRequest, BuildResponse, ExplainRequest, ExplainResponse, PlanRequest, PlanResponse,
                      UnderstandRequest, UnderstandResponse)
from .services import build_app, explain_app, plan_app, understand_app

app = FastAPI(title="Lunor App Dev prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def limit_ai_calls(request: Request, call_next):
    """Every POST under /api/ costs Gemini quota. When the limit is hit we answer in the normal response shape with
    error_kind 'provider', which the frontend treats as 'AI unavailable': it lands on the ready-made example and says why."""
    if request.method == "POST" and request.url.path.startswith("/api/"):
        who = ratelimit.client_ip(request.headers, request.client.host if request.client else "unknown")
        reason = ratelimit.limiter.check(who)
        if reason:
            return JSONResponse({"ok": False, "errors": [reason], "retryable": False, "error_kind": "provider"})
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"ok": True, "model": config.GEMINI_MODEL, "llm_configured": bool(config.GEMINI_API_KEY)}


# Plain `def` endpoints: FastAPI runs them in a worker thread, so the blocking LLM call doesn't stall other requests.
@app.post("/api/understand", response_model=UnderstandResponse)
def understand(req: UnderstandRequest):
    return understand_app(req)


@app.post("/api/plan", response_model=PlanResponse)
def plan(req: PlanRequest):
    return plan_app(req)


@app.post("/api/build", response_model=BuildResponse)
def build(req: BuildRequest):
    return build_app(req)


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    return explain_app(req)


# In production the built React app is served by this same server (one deploy).
_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
