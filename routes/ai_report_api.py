"""AI-generated report: relays a Chat Completions request to OpenAI using
the CALLER's OWN API key, so the user can turn an already-computed
analysis (SEM results, Sensitivity, Power Analysis, or ML Comparison) into
a full written report via ChatGPT.

The frontend builds the data summary (`context`) from results it already
has in memory -- this endpoint never re-runs any analysis, it only relays
one HTTP call to OpenAI and returns the generated text.

Privacy: `api_key` is used only as a local variable for the one outbound
call below. It is never written to a file, a database, or a log line, and
this module must stay that way -- do not add logging.info/print calls that
include the payload here.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, request

from i18n import get_lang, t

ai_report_api = Blueprint("ai_report_api", __name__, url_prefix="/api")

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
REQUEST_TIMEOUT_SECONDS = 110
DEFAULT_MODEL = "gpt-4o-mini"

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


def _call_openai(api_key: str, model: str, context: str, user_prompt: str, lang: str) -> str:
    """Makes the actual HTTP call. Isolated into its own function so tests
    can monkeypatch it without touching real network/credentials."""
    system_msg = SYSTEM_PROMPT.get(lang, SYSTEM_PROMPT["en"])
    user_msg = f"{context}\n\n---\n\n{user_prompt}"
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
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["choices"][0]["message"]["content"]


@ai_report_api.post("/ai_report")
def ai_report():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    api_key = (payload.get("api_key") or "").strip()
    model = (payload.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    context = (payload.get("context") or "").strip()
    user_prompt = (payload.get("user_prompt") or "").strip()

    if not api_key:
        return jsonify(error=t("err_ai_missing_key", lang)), 400
    if not context:
        return jsonify(error=t("err_ai_missing_context", lang)), 400
    if not user_prompt:
        return jsonify(error=t("err_ai_missing_prompt", lang)), 400

    try:
        report_text = _call_openai(api_key, model, context, user_prompt, lang)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", {}).get("message")
        except Exception:  # noqa: BLE001
            detail = None
        if exc.code == 401:
            return jsonify(error=t("err_ai_invalid_key", lang)), 400
        if exc.code == 429:
            return jsonify(error=t("err_ai_rate_limited", lang)), 429
        if exc.code == 400:
            return jsonify(error=t("err_ai_bad_model", lang, detail=detail or exc.reason)), 400
        return jsonify(error=t("err_ai_request_failed", lang, detail=detail or exc.reason)), 502
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return jsonify(error=t("err_ai_request_failed", lang, detail=str(exc))), 502
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        return jsonify(error=t("err_ai_request_failed", lang, detail=str(exc))), 502

    return jsonify(report=report_text)
