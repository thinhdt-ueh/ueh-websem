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

# Long reports take longer to generate -- raised from this endpoint's
# original 110s so a "long & thorough" report has real room to finish
# rather than getting cut off by our own request timeout (gunicorn's own
# worker timeout is already 2400s, see Procfile/render.yaml/Dockerfile, so
# there's ample headroom above this).
REQUEST_TIMEOUT_SECONDS = 240
# Anthropic's Messages API requires max_tokens as a mandatory field (unlike
# OpenAI/Gemini, where it's optional and we deliberately leave it unset --
# see _call_openai/_call_gemini). Raised from 4096 so a "long" report
# doesn't get truncated mid-sentence.
CLAUDE_MAX_TOKENS = 8192
GEMINI_MAX_OUTPUT_TOKENS = 8192
# Anthropic's documented temperature range is 0-1 (not 0-2 like OpenAI/
# Gemini) -- rather than juggling a different valid range per provider,
# every provider is exposed through the same 0-1 slider, since that already
# covers the practically meaningful range (fully deterministic to quite
# creative) and guarantees a value that's always valid for all three.
DEFAULT_TEMPERATURE = 1.0
MIN_TEMPERATURE = 0.0
MAX_TEMPERATURE = 1.0

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
        "cấu trúc (dùng heading Markdown # ## ###). Không được bịa thêm số liệu hay kết quả "
        "không có trong dữ liệu cung cấp."
    ),
    "en": (
        "You are an academic research report writing assistant. Based ONLY on the data and "
        "figures provided below, write a coherent, professional, well-structured report in "
        "English (use Markdown headings # ## ###). Do not fabricate any number or finding not "
        "present in the provided data."
    ),
}

# Length is a prompt-level instruction, not just a token cap -- a model asked
# for "a report" with no length guidance tends to default to a short summary
# regardless of how high max_tokens is set, so this is the primary lever for
# "make it longer", with the raised token caps above as the ceiling that lets
# a long response actually complete.
LENGTH_INSTRUCTIONS = {
    "vi": {
        "short": "Viết báo cáo NGẮN GỌN, súc tích, khoảng 400-700 từ, chỉ nêu những điểm quan trọng nhất.",
        "medium": "Viết báo cáo ở mức độ vừa phải, khoảng 900-1500 từ -- đủ chi tiết nhưng không dài dòng.",
        "long": (
            "Viết báo cáo ĐẦY ĐỦ VÀ CHI TIẾT, tối thiểu 1800-3000 từ (dài hơn nếu dữ liệu cho phép). "
            "Trình bày kỹ từng phần: bối cảnh, kết quả chi tiết theo từng chỉ số, diễn giải ý nghĩa, "
            "so sánh, và kết luận. Không rút gọn hay tóm tắt sơ sài -- khai thác tối đa số liệu đã cung cấp."
        ),
    },
    "en": {
        "short": "Write a SHORT, concise report, about 400-700 words, covering only the most important points.",
        "medium": "Write a moderate-length report, about 900-1500 words -- detailed enough but not padded.",
        "long": (
            "Write a FULL, DETAILED report, at least 1800-3000 words (longer if the data supports it). "
            "Cover each section thoroughly: background, detailed results per metric, interpretation, "
            "comparisons, and conclusions. Do not abbreviate or summarize superficially -- make full "
            "use of every figure provided."
        ),
    },
}

OPTIONAL_INSTRUCTIONS = {
    "vi": {
        "include_tables": "Trình bày các số liệu quan trọng dưới dạng bảng Markdown rõ ràng, có tiêu đề cột.",
        "include_interpretation": (
            "Với mỗi kết quả, đừng chỉ liệt kê số liệu -- hãy diễn giải Ý NGHĨA của nó, suy luận "
            "nguyên nhân/hệ quả có thể, và so sánh với kỳ vọng lý thuyết hoặc nghiên cứu trước đó."
        ),
        "include_recommendations": "Kết thúc bằng một phần khuyến nghị / hàm ý quản trị hoặc học thuật cụ thể, rút ra trực tiếp từ kết quả.",
        "include_limitations": "Thêm một phần ngắn nêu hạn chế của phân tích và hướng nghiên cứu tiếp theo.",
    },
    "en": {
        "include_tables": "Present the key figures as clearly formatted Markdown tables with column headers.",
        "include_interpretation": (
            "For every result, don't just list the numbers -- interpret their MEANING, reason about "
            "likely causes/implications, and compare against theoretical expectations or prior research."
        ),
        "include_recommendations": "End with a concrete recommendations / managerial or academic implications section, drawn directly from the results.",
        "include_limitations": "Add a short limitations section and suggested directions for future research.",
    },
}
REPORT_OPTION_KEYS = ("include_tables", "include_interpretation", "include_recommendations", "include_limitations")


def _build_messages(context: str, user_prompt: str, lang: str, report_length: str, options: dict) -> tuple[str, str]:
    length_map = LENGTH_INSTRUCTIONS.get(lang, LENGTH_INSTRUCTIONS["en"])
    opt_map = OPTIONAL_INSTRUCTIONS.get(lang, OPTIONAL_INSTRUCTIONS["en"])
    directives = [
        SYSTEM_PROMPT.get(lang, SYSTEM_PROMPT["en"]),
        length_map.get(report_length, length_map["long"]),
    ]
    directives += [opt_map[k] for k in REPORT_OPTION_KEYS if options.get(k)]
    system_msg = "\n\n".join(directives)
    user_msg = f"{context}\n\n---\n\n{user_prompt}"
    return system_msg, user_msg


def _call_openai(api_key: str, model: str, system_msg: str, user_msg: str, temperature: float) -> str:
    """Each `_call_*` function is isolated so tests can monkeypatch it
    directly (by name, looked up dynamically at call time in the route
    below) without touching real network/credentials.

    Deliberately no max_tokens here (unlike Claude, where it's mandatory):
    the reasoning models now offered in the model suggestions (o1/o3) reject
    the legacy `max_tokens` field in favor of `max_completion_tokens`, and
    since length is already controlled at the prompt level (see
    LENGTH_INSTRUCTIONS), there's no need to juggle two different parameter
    names per model family just to set a cap that's rarely the binding
    constraint anyway."""
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "temperature": temperature,
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


def _call_gemini(api_key: str, model: str, system_msg: str, user_msg: str, temperature: float) -> str:
    body = json.dumps({
        "system_instruction": {"parts": [{"text": system_msg}]},
        "contents": [{"role": "user", "parts": [{"text": user_msg}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": GEMINI_MAX_OUTPUT_TOKENS},
    }).encode("utf-8")
    url = GEMINI_URL_TMPL.format(model=urllib.parse.quote(model), key=urllib.parse.quote(api_key))
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["candidates"][0]["content"]["parts"][0]["text"]


def _call_claude(api_key: str, model: str, system_msg: str, user_msg: str, temperature: float) -> str:
    body = json.dumps({
        "model": model,
        "max_tokens": CLAUDE_MAX_TOKENS,
        "system": system_msg,
        "messages": [{"role": "user", "content": user_msg}],
        "temperature": temperature,
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
    report_length = (payload.get("report_length") or "long").strip().lower()
    if report_length not in LENGTH_INSTRUCTIONS["en"]:
        report_length = "long"
    raw_options = payload.get("options") or {}
    options = {k: bool(raw_options.get(k)) for k in REPORT_OPTION_KEYS}
    try:
        temperature = float(payload.get("temperature", DEFAULT_TEMPERATURE))
    except (TypeError, ValueError):
        temperature = DEFAULT_TEMPERATURE
    temperature = max(MIN_TEMPERATURE, min(MAX_TEMPERATURE, temperature))

    if provider not in DEFAULT_MODELS:
        return jsonify(error=t("err_ai_bad_provider", lang)), 400
    if not api_key:
        return jsonify(error=t("err_ai_missing_key", lang)), 400
    if not context:
        return jsonify(error=t("err_ai_missing_context", lang)), 400
    if not user_prompt:
        return jsonify(error=t("err_ai_missing_prompt", lang)), 400

    system_msg, user_msg = _build_messages(context, user_prompt, lang, report_length, options)
    try:
        if provider == "openai":
            report_text = _call_openai(api_key, model, system_msg, user_msg, temperature)
        elif provider == "gemini":
            report_text = _call_gemini(api_key, model, system_msg, user_msg, temperature)
        else:
            report_text = _call_claude(api_key, model, system_msg, user_msg, temperature)
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
