"""Tests for /api/ai_report. Never calls a real provider's API -- that would
need real paid keys and be flaky/non-deterministic in CI -- instead
monkeypatches `_call_openai`/`_call_gemini`/`_call_claude`, the three
functions that make the actual HTTP calls, and asserts the route's
validation/provider-dispatch/error-mapping around them.
"""

from __future__ import annotations

import io
import json
import urllib.error

import routes.ai_report_api as ai_report_api


def _valid_payload(**overrides):
    payload = {
        "provider": "openai",
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


def test_ai_report_missing_report_length_defaults_to_long(client, monkeypatch):
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["system_msg"] = system_msg
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)
    payload = _valid_payload()
    payload.pop("report_length", None)
    payload.pop("options", None)
    resp = client.post("/api/ai_report", json=payload)
    assert resp.status_code == 200, resp.get_json()
    assert "1800-3000" in captured["system_msg"]  # the "long" length instruction


def test_ai_report_missing_options_means_no_optional_sections(client, monkeypatch):
    """An absent `options` dict (or an absent key within it) means that
    section is off -- matches how the real modal always sends every
    checkbox's actual boolean state explicitly, so "missing" only happens
    via a raw API call, and defaulting those to off (rather than silently
    maximal) keeps behavior predictable and avoids surprising extra
    output/cost for a caller that didn't ask for it."""
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["system_msg"] = system_msg
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)
    payload = _valid_payload()
    payload.pop("options", None)
    resp = client.post("/api/ai_report", json=payload)
    assert resp.status_code == 200, resp.get_json()
    for fragment in ("Markdown tables", "interpret their MEANING", "managerial or academic implications section", "limitations section"):
        assert fragment not in captured["system_msg"]


def test_ai_report_explicit_options_all_true_include_every_section(client, monkeypatch):
    """Matches what the modal actually sends when every checkbox is
    checked (its own default state)."""
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["system_msg"] = system_msg
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)
    all_on = {
        "include_tables": True, "include_interpretation": True,
        "include_recommendations": True, "include_limitations": True,
    }
    resp = client.post("/api/ai_report", json=_valid_payload(options=all_on))
    assert resp.status_code == 200, resp.get_json()
    for fragment in ("Markdown tables", "interpret their MEANING", "recommendations", "limitations"):
        assert fragment in captured["system_msg"]


def test_ai_report_short_length_omits_long_instruction(client, monkeypatch):
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["system_msg"] = system_msg
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)
    resp = client.post("/api/ai_report", json=_valid_payload(report_length="short", options={}))
    assert resp.status_code == 200, resp.get_json()
    assert "400-700 words" in captured["system_msg"]
    assert "1800-3000" not in captured["system_msg"]
    # every optional section was explicitly turned off
    for fragment in ("Markdown tables", "interpret their MEANING", "managerial or academic implications section", "limitations section"):
        assert fragment not in captured["system_msg"]


def test_ai_report_unknown_length_falls_back_to_long(client, monkeypatch):
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["system_msg"] = system_msg
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)
    resp = client.post("/api/ai_report", json=_valid_payload(report_length="not-a-real-length"))
    assert resp.status_code == 200, resp.get_json()
    assert "1800-3000" in captured["system_msg"]


def test_ai_report_temperature_defaults_to_one(client, monkeypatch):
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["temperature"] = temperature
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)
    payload = _valid_payload()
    payload.pop("temperature", None)
    resp = client.post("/api/ai_report", json=payload)
    assert resp.status_code == 200, resp.get_json()
    assert captured["temperature"] == 1.0


def test_ai_report_temperature_is_clamped_to_valid_range(client, monkeypatch):
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["temperature"] = temperature
        return "ok"

    monkeypatch.setattr(ai_report_api, "_call_openai", fake_call)

    resp = client.post("/api/ai_report", json=_valid_payload(temperature=5))
    assert resp.status_code == 200, resp.get_json()
    assert captured["temperature"] == 1.0  # clamped down to the max

    resp = client.post("/api/ai_report", json=_valid_payload(temperature=-2))
    assert resp.status_code == 200, resp.get_json()
    assert captured["temperature"] == 0.0  # clamped up to the min

    resp = client.post("/api/ai_report", json=_valid_payload(temperature=0.4))
    assert resp.status_code == 200, resp.get_json()
    assert captured["temperature"] == 0.4  # a valid value passes through untouched

    resp = client.post("/api/ai_report", json=_valid_payload(temperature="not-a-number"))
    assert resp.status_code == 200, resp.get_json()
    assert captured["temperature"] == 1.0  # unparseable -> falls back to the default


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


def test_ai_report_rejects_unknown_provider(client):
    resp = client.post("/api/ai_report", json=_valid_payload(provider="not-a-real-provider"))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ai_report_gemini_success(client, monkeypatch):
    monkeypatch.setattr(ai_report_api, "_call_gemini", lambda *a, **k: "# Gemini Report")
    resp = client.post("/api/ai_report", json=_valid_payload(provider="gemini", model="gemini-2.0-flash"))
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["report"] == "# Gemini Report"


def test_ai_report_claude_success(client, monkeypatch):
    monkeypatch.setattr(ai_report_api, "_call_claude", lambda *a, **k: "# Claude Report")
    resp = client.post("/api/ai_report", json=_valid_payload(provider="claude", model="claude-sonnet-5"))
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["report"] == "# Claude Report"


def test_ai_report_gemini_maps_forbidden_as_invalid_key(client, monkeypatch):
    def raise_403(*a, **k):
        raise _http_error(403, "Permission denied")
    monkeypatch.setattr(ai_report_api, "_call_gemini", raise_403)
    resp = client.post("/api/ai_report", json=_valid_payload(provider="gemini"))
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ai_report_claude_maps_overloaded_as_rate_limited(client, monkeypatch):
    def raise_529(*a, **k):
        raise _http_error(529, "Overloaded")
    monkeypatch.setattr(ai_report_api, "_call_claude", raise_529)
    resp = client.post("/api/ai_report", json=_valid_payload(provider="claude"))
    assert resp.status_code == 429
    assert "error" in resp.get_json()
