"""AI-generated report: relays one chat-completion request to the caller's
choice of OpenAI (ChatGPT), Google Gemini, or Anthropic Claude, using the
CALLER's OWN API key, so the user can turn an already-computed analysis
(SEM results, Sensitivity, Power Analysis, or ML Comparison) into a full
written report.

The frontend builds the data summary (`context`) from results it already
has in memory -- this endpoint never re-runs any analysis, it only relays
one HTTP call to the chosen provider and returns the generated text.

Privacy: `api_key` is used only as a local variable for the one outbound
call below. It is never written to a file, a database, or a log line, and
this module must stay that way -- do not add logging.info/print calls that
include the payload here.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, jsonify, request

from i18n import get_lang, t

ai_report_api = Blueprint("ai_report_api", __name__, url_prefix="/api")

REQUEST_TIMEOUT_SECONDS = 110
CLAUDE_MAX_TOKENS = 4096

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.0-flash",
    "claude": "claude-sonnet-5",
}

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_URL_TMPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
CLAUDE_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_API_VERSION = "2023-06-01"

SYSTEM_PROMPT = {
    "vi": (
        "Bạn là trợ lý viết báo cáo nghiên cứu học thuật. Dựa CHỈ trên dữ liệu và số liệu "
        "được cung cấp bên dưới, viết báo cáo bằng tiếng Việt, mạch lạc, chuyên nghiệp, có "
        "cấu trúc (dùng heading Markdown # ## ###, bảng Markdown khi phù hợp). Không được bịa "
        "thêm số liệu hay kết quả không có trong dữ liệu cung cấp."
    ),
    "en": (
        "You are an academic research report writing assistant. Based ONLY on the data and "
        "figures provided below, write a coherent, professional, well-structured report in "
        "English (use Markdown headings # ## ### and Markdown tables where appropriate). Do "
        "not fabricate any number or finding not present in the provided data."
    ),
}


def _build_messages(context: str, user_prompt: str, lang: str) -> tuple[str, str]:
    system_msg = SYSTEM_PROMPT.get(lang, SYSTEM_PROMPT["en"])
    user_msg = f"{context}\n\n---\n\n{user_prompt}"
    return system_msg, user_msg


def _call_openai(api_key: str, model: str, system_msg: str, user_msg: str) -> str:
    """Each `_call_*` function is isolated so tests can monkeypatch it
    directly (by name, looked up dynamically at call time in the route
    below) without touching real network/credentials."""
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.3,
    }).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_CHAT_COMPLETIONS_URL,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["choices"][0]["message"]["content"]


def _call_gemini(api_key: str, model: str, system_msg: str, user_msg: str) -> str:
    body = json.dumps({
        "system_instruction": {"parts": [{"text": system_msg}]},
        "contents": [{"role": "user", "parts": [{"text": user_msg}]}],
        "generationConfig": {"temperature": 0.3},
    }).encode("utf-8")
    url = GEMINI_URL_TMPL.format(model=urllib.parse.quote(model), key=urllib.parse.quote(api_key))
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["candidates"][0]["content"]["parts"][0]["text"]


def _call_claude(api_key: str, model: str, system_msg: str, user_msg: str) -> str:
    body = json.dumps({
        "model": model,
        "max_tokens": CLAUDE_MAX_TOKENS,
        "system": system_msg,
        "messages": [{"role": "user", "content": user_msg}],
        "temperature": 0.3,
    }).encode("utf-8")
    req = urllib.request.Request(
        CLAUDE_MESSAGES_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": CLAUDE_API_VERSION,
        },
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["content"][0]["text"]


@ai_report_api.post("/ai_report")
def ai_report():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    provider = (payload.get("provider") or "openai").strip().lower()
    api_key = (payload.get("api_key") or "").strip()
    model = (payload.get("model") or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["openai"])).strip()
    context = (payload.get("context") or "").strip()
    user_prompt = (payload.get("user_prompt") or "").strip()

    if provider not in DEFAULT_MODELS:
        return jsonify(error=t("err_ai_bad_provider", lang)), 400
    if not api_key:
        return jsonify(error=t("err_ai_missing_key", lang)), 400
    if not context:
        return jsonify(error=t("err_ai_missing_context", lang)), 400
    if not user_prompt:
        return jsonify(error=t("err_ai_missing_prompt", lang)), 400

    system_msg, user_msg = _build_messages(context, user_prompt, lang)
    try:
        if provider == "openai":
            report_text = _call_openai(api_key, model, system_msg, user_msg)
        elif provider == "gemini":
            report_text = _call_gemini(api_key, model, system_msg, user_msg)
        else:
            report_text = _call_claude(api_key, model, system_msg, user_msg)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", {}).get("message")
        except Exception:  # noqa: BLE001
            detail = None
        # Status-code semantics are consistent enough across all three
        # providers to map uniformly rather than branching per-provider;
        # Gemini in particular can return 403 (not 401) for a bad/missing
        # key since its key travels as a query param, not an Authorization
        # header, so 403 is folded into the same "invalid key" bucket.
        if exc.code in (401, 403):
            return jsonify(error=t("err_ai_invalid_key", lang)), 400
        if exc.code in (429, 529):  # 529 = Claude "overloaded"
            return jsonify(error=t("err_ai_rate_limited", lang)), 429
        if exc.code == 400:
            return jsonify(error=t("err_ai_bad_model", lang, detail=detail or exc.reason)), 400
        return jsonify(error=t("err_ai_request_failed", lang, detail=detail or exc.reason)), 502
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return jsonify(error=t("err_ai_request_failed", lang, detail=str(exc))), 502
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        return jsonify(error=t("err_ai_request_failed", lang, detail=str(exc))), 502

    return jsonify(report=report_text)
