"""Retry / backup-model behaviour, driven by a fake Gemini client (no network)."""
import pytest

from app import config, llm


class FakeAPIError(Exception):
    def __init__(self, code, msg="boom"):
        super().__init__(f"{code}: {msg}")
        self.code = code


class FakeResp:
    def __init__(self, text):
        self.text = text


class FakeClient:
    """script: list of outcomes consumed in order; an Exception is raised, a string is returned as the reply."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []                      # model name of every request
        self.models = self

    def generate_content(self, model, contents, config):
        self.calls.append(model)
        outcome = self.script.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResp(outcome)


@pytest.fixture
def setup(monkeypatch):
    sleeps = []
    monkeypatch.setattr(llm.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(config, "GEMINI_MODEL", "main-model")
    monkeypatch.setattr(config, "GEMINI_FALLBACK_MODEL", "backup-model")

    def install(script):
        client = FakeClient(script)
        monkeypatch.setattr(llm, "_client", client)
        return client

    return install, sleeps


def test_503_then_success_is_invisible_to_the_caller(setup):
    install, sleeps = setup
    client = install([FakeAPIError(503), FakeAPIError(503), "<html>ok</html>"])
    assert llm.generate_text("s", "p") == "<html>ok</html>"
    assert client.calls == ["main-model"] * 3
    assert sleeps == [1.5, 4.0]                       # backed off between attempts


def test_persistent_503_moves_to_the_backup_model(setup):
    install, _ = setup
    client = install([FakeAPIError(503)] * 3 + ["from backup"])
    assert llm.generate_text("s", "p") == "from backup"
    assert client.calls == ["main-model"] * 3 + ["backup-model"]


def test_429_rate_limit_is_treated_like_overload(setup):
    install, _ = setup
    client = install([FakeAPIError(429), "fine"])
    assert llm.generate_text("s", "p") == "fine"
    assert client.calls == ["main-model", "main-model"]


def test_everything_down_raises_a_provider_error(setup):
    install, _ = setup
    install([FakeAPIError(503, "high demand")] * 6)
    with pytest.raises(llm.LLMError) as exc:
        llm.generate_text("s", "p")
    assert exc.value.kind == "provider" and "503" in str(exc.value)


def test_unknown_model_goes_straight_to_the_backup_without_waiting(setup):
    install, sleeps = setup
    client = install([FakeAPIError(404, "model not found"), "from backup"])
    assert llm.generate_text("s", "p") == "from backup"
    assert client.calls == ["main-model", "backup-model"] and sleeps == []


def test_bad_api_key_stops_immediately_and_is_not_retryable(setup):
    install, sleeps = setup
    client = install([FakeAPIError(403, "API key not valid")])
    with pytest.raises(llm.LLMError) as exc:
        llm.generate_text("s", "p")
    assert exc.value.kind == "config" and exc.value.retryable is False
    assert len(client.calls) == 1 and sleeps == []


def test_other_errors_are_not_retried(setup):
    install, sleeps = setup
    client = install([FakeAPIError(400, "invalid argument")])
    with pytest.raises(llm.LLMError):
        llm.generate_text("s", "p")
    assert len(client.calls) == 1 and sleeps == []


def test_empty_reply_is_a_model_problem(setup):
    install, _ = setup
    install([""])
    with pytest.raises(llm.LLMError) as exc:
        llm.generate_text("s", "p")
    assert exc.value.kind == "model"


def test_backup_model_can_be_disabled(setup, monkeypatch):
    install, _ = setup
    monkeypatch.setattr(config, "GEMINI_FALLBACK_MODEL", "")
    client = install([FakeAPIError(503)] * 3)
    with pytest.raises(llm.LLMError):
        llm.generate_text("s", "p")
    assert client.calls == ["main-model"] * 3


def test_json_mismatch_is_a_model_problem(setup):
    from app.schemas import ExplainLLMOutput
    install, _ = setup
    install(['{"nope": 1}'])
    with pytest.raises(llm.LLMError) as exc:
        llm.generate_json("s", "p", ExplainLLMOutput)
    assert exc.value.kind == "model"
