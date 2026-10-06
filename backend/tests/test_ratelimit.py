import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.main import app
from app.ratelimit import RateLimiter, client_ip


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make(per_ip=3, global_max=100):
    clock = Clock()
    return RateLimiter(per_ip, 3600, global_max, 86400, clock=clock), clock


def test_blocks_one_visitor_after_the_limit_but_not_others():
    lim, _ = make(per_ip=3)
    assert [lim.check("a") for _ in range(3)] == [None, None, None]
    assert "hourly limit" in lim.check("a")
    assert lim.check("b") is None


def test_window_slides_so_the_visitor_is_allowed_again():
    lim, clock = make(per_ip=2)
    lim.check("a"); lim.check("a")
    assert lim.check("a") is not None
    clock.t += 3601
    assert lim.check("a") is None


def test_global_ceiling_protects_the_quota_even_for_new_visitors():
    lim, _ = make(per_ip=50, global_max=3)
    assert [lim.check(f"ip{i}") for i in range(3)] == [None, None, None]
    assert "daily usage limit" in lim.check("someone-new")


def test_refused_requests_do_not_count_against_the_visitor():
    lim, clock = make(per_ip=1)
    lim.check("a")
    for _ in range(5):
        assert lim.check("a") is not None
    clock.t += 3601
    assert lim.check("a") is None


def test_client_ip_prefers_forwarded_header():
    assert client_ip({"x-forwarded-for": "9.9.9.9, 10.0.0.1"}, "127.0.0.1") == "9.9.9.9"
    assert client_ip({}, "127.0.0.1") == "127.0.0.1"


def test_http_limit_answers_in_the_normal_shape_so_the_frontend_falls_back(monkeypatch):
    lim, _ = make(per_ip=1)
    monkeypatch.setattr(ratelimit, "limiter", lim)
    client = TestClient(app)
    first = client.post("/api/understand", json={"idea": "habit tracker"}).json()
    assert first.get("error_kind") == "config"                                  # no API key in tests: got through to the service
    second = client.post("/api/plan", json={"idea": "habit tracker"})
    assert second.status_code == 200
    body = second.json()
    assert body["ok"] is False and body["retryable"] is False and body["error_kind"] == "provider"
    assert "hourly limit" in body["errors"][0]
    assert client.get("/api/health").status_code == 200                          # GETs are never limited
