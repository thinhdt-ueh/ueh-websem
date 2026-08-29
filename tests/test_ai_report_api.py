"""Tests for /api/ai_report. Never calls the real OpenAI API -- that would
need a real paid key and be flaky/non-deterministic in CI -- instead
monkeypatches `_call_openai`, the one function that makes the actual HTTP
call, and asserts the route's validation/error-mapping around it.
"""

from __future__ import annotations

import io
import json
import urllib.error

import routes.ai_report_api as ai_report_api


def _valid_payload(**overrides):
    payload = {
        "api_key": "sk-test-123",
        "model": "gpt-4o-mini",
        "context": "PEOU -> PU: 0.462 (p < .001)",
        "user_prompt": "Write a short report.",
        "lang": "en",
    }
    payload.update(overrides)
    return payload


def test_ai_report_success(client, monkeypatch):
    monkeypatch.setattr(ai_report_api, "_call_openai", lambda *a, **k: "# Report\n\nGenerated text.")
    resp = client.post("/api/ai_report", json=_valid_payload())
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["report"] == "# Report\n\nGenerated text."


def test_ai_report_rejects_missing_key(client):
    resp = client.post("/api/ai_report", json=_valid_payload(api_key=""))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ai_report_rejects_missing_context(client):
    resp = client.post("/api/ai_report", json=_valid_payload(context=""))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ai_report_rejects_missing_prompt(client):
    resp = client.post("/api/ai_report", json=_valid_payload(user_prompt=""))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def _http_error(code: int, message: str) -> urllib.error.HTTPError:
    body = json.dumps({"error": {"message": message}}).encode("utf-8")
    return urllib.error.HTTPError(
        url="https://api.openai.com/v1/chat/completions", code=code, msg=message,
        hdrs=None, fp=io.BytesIO(body),
    )


def test_ai_report_maps_invalid_key(client, monkeypatch):
    def raise_401(*a, **k):
        raise _http_error(401, "Incorrect API key provided")
    monkeypatch.setattr(ai_report_api, "_call_openai", raise_401)
    resp = client.post("/api/ai_report", json=_valid_payload())
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ai_report_maps_rate_limit(client, monkeypatch):
    def raise_429(*a, **k):
        raise _http_error(429, "Rate limit exceeded")
    monkeypatch.setattr(ai_report_api, "_call_openai", raise_429)
    resp = client.post("/api/ai_report", json=_valid_payload())
    assert resp.status_code == 429
    assert "error" in resp.get_json()


def test_ai_report_maps_network_error(client, monkeypatch):
    def raise_network_error(*a, **k):
        raise urllib.error.URLError("temporary failure in name resolution")
    monkeypatch.setattr(ai_report_api, "_call_openai", raise_network_error)
    resp = client.post("/api/ai_report", json=_valid_payload())
    assert resp.status_code == 502
    assert "error" in resp.get_json()
