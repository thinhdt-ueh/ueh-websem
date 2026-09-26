"""AI-rater: turns a qualitative (open-ended) survey column into a new
Likert-scale indicator by having an AI score every respondent's free-text
answer against a user-written rubric prompt, then merges the result into
the existing indicator dataset so it can feed the PLS-SEM/CB-SEM model.

Works for ANY file_id carrying AI-generation metadata -- both
ai_data_gen_api.py's plain generator and ai_worker_api.py's Experiment
finalize persist through the exact same
_save_ai_gen_metadata/_load_ai_gen_metadata/_ai_meta_dir convention, and
both always include a `respondent_id` identity column
(ai_data_gen_api.py's finalize(), ai_worker_api.py's finalize_experiment()).
Deliberately does NOT apply to a plain uploaded file: there is no
guaranteed qualitative-text column (or respondent_id) to read from one.

Follows the same generate-batch -> finalize pattern as every other
AI-calling feature in this app: /batch calls the AI and returns
unpersisted rows for the frontend to accumulate (with the same
adaptive-retry loop used everywhere else), /finalize merges the complete,
validated set into the existing indicator CSV in place under the SAME
file_id -- Step 2's candidate-indicator list picks up the new column for
free, no other route needs to change.
"""

from __future__ import annotations

import io
import os

import pandas as pd
from flask import Blueprint, jsonify, request

from i18n import get_lang, t
from routes.ai_data_gen_api import (
    DEFAULT_MODELS,
    DEFAULT_TEMPERATURE,
    LIKERT_SCALES,
    MAX_BATCH_ATTEMPTS,
    MAX_BATCH_SIZE,
    MAX_TEMPERATURE,
    MIN_TEMPERATURE,
    _call_ai_provider_mapped,
    _compute_descriptive_stats,
    _extract_csv_block,
    _load_ai_gen_metadata,
    _save_ai_gen_metadata,
)
from routes.api import _clean, _upload_dir

ai_qual_score_api = Blueprint("ai_qual_score_api", __name__, url_prefix="/api")


# ---------------- prompt building ----------------

RATER_ROLE_FRAMING = {
    "vi": (
        "Bạn là một người chấm điểm (rater) khách quan, nhất quán cho một nghiên cứu học thuật. "
        "Nhiệm vụ của bạn: đọc câu trả lời mở (qualitative) của từng người tham gia và chấm điểm theo "
        "đúng tiêu chí chấm điểm (rubric) được cung cấp bên dưới, KHÔNG dựa trên cảm tính riêng của bạn."
    ),
    "en": (
        "You are an objective, consistent rater for an academic study. Your task: read each "
        "participant's open-ended (qualitative) answer and score it strictly according to the rubric "
        "given below, not your own personal opinion."
    ),
}

RATER_RUBRIC_LABEL = {"vi": "Tiêu chí chấm điểm (rubric)", "en": "Scoring rubric"}

RATER_OUTPUT_FORMAT = {
    "vi": (
        "Chỉ xuất ra một bảng CSV -- dòng đầu tiên là chính xác header: respondent_id,score. Sau đó "
        "mỗi dòng là một người: `respondent_id` PHẢI khớp chính xác với một trong các id đã cho (mỗi id "
        "xuất hiện đúng một lần), `score` là số nguyên từ {lo} đến {hi}. KHÔNG markdown code fence, "
        "KHÔNG giải thích, KHÔNG có văn bản nào khác ngoài bảng CSV."
    ),
    "en": (
        "Output ONLY a CSV table -- the first line must be exactly this header: respondent_id,score. "
        "Each following line is one person: `respondent_id` MUST exactly match one of the given ids "
        "(each id appearing exactly once), `score` is an integer from {lo} to {hi}. NO markdown code "
        "fences, NO explanations, NO text other than the CSV table."
    ),
}


def _build_rater_system_message(rubric_prompt: str, likert_min: int, likert_max: int, lang: str) -> str:
    rubric_label = RATER_RUBRIC_LABEL.get(lang, RATER_RUBRIC_LABEL["en"])
    parts = [
        RATER_ROLE_FRAMING.get(lang, RATER_ROLE_FRAMING["en"]),
        f"{rubric_label}:\n{rubric_prompt}",
        RATER_OUTPUT_FORMAT.get(lang, RATER_OUTPUT_FORMAT["en"]).format(lo=likert_min, hi=likert_max),
    ]
    return "\n\n".join(parts)


def _format_rater_items(ids: list[str], texts: list[str]) -> str:
    lines = []
    for rid, text in zip(ids, texts):
        safe_text = str(text).replace('"', "'")
        lines.append(f'{rid}: "{safe_text}"')
    return "\n".join(lines)


def _build_rater_batch_instruction(ids: list[str], texts: list[str], lang: str) -> str:
    n = len(ids)
    items = _format_rater_items(ids, texts)
    return {
        "vi": f"Hãy chấm điểm chính xác {n} câu trả lời sau, mỗi id đúng một lần:\n{items}",
        "en": f"Score exactly these {n} answers now, each id exactly once:\n{items}",
    }.get(lang, f"Score exactly these {n} answers now, each id exactly once:\n{items}")


def _rater_corrective_note(reason: str, ids: list[str], lang: str) -> str:
    ids_list = ", ".join(ids)
    return {
        "vi": (
            f"Phản hồi trước không hợp lệ ({reason}). CHỈ xuất bảng CSV với header CHÍNH XÁC "
            f"respondent_id,score, và đúng các id: {ids_list} -- không markdown, không giải thích."
        ),
        "en": (
            f"Your previous response was invalid ({reason}). Output ONLY a CSV table with header "
            f"EXACTLY respondent_id,score, and exactly these ids: {ids_list} -- no markdown, no "
            f"explanation."
        ),
    }.get(lang, (
        f"Your previous response was invalid ({reason}). Output ONLY a CSV table with header EXACTLY "
        f"respondent_id,score, and exactly these ids: {ids_list} -- no markdown, no explanation."
    ))


def _parse_qual_score_batch_csv(text: str, expected_ids: list[str], likert_min: int, likert_max: int):
    """Returns (list[int] scores, None) or (None, reason) -- same
    never-raises contract as this app's other batch parsers. The identity
    column here (`respondent_id`) must be an EXACT set-match to
    `expected_ids`, same strictness as _parse_survey_batch_csv."""
    cleaned = _extract_csv_block(text)
    try:
        df = pd.read_csv(io.StringIO(cleaned))
    except Exception as exc:  # noqa: BLE001
        return None, f"could not parse as CSV ({exc})"

    if set(df.columns) != {"respondent_id", "score"}:
        return None, f"column mismatch (expected respondent_id,score, got {sorted(df.columns)})"

    id_part = df["respondent_id"].astype(str).str.strip()
    if set(id_part) != set(expected_ids) or len(id_part) != len(expected_ids):
        return None, f"respondent_id column must contain exactly {sorted(expected_ids)}, one each"

    score_part = pd.to_numeric(df["score"], errors="coerce")
    if score_part.isna().any():
        return None, "a non-numeric score was found"
    if ((score_part < likert_min) | (score_part > likert_max)).any():
        return None, f"a score outside [{likert_min}, {likert_max}] was found"

    out = pd.DataFrame({"respondent_id": id_part, "score": score_part.astype(int)})
    out = out.set_index("respondent_id").loc[expected_ids].reset_index()
    return out["score"].tolist(), None


def _qualitative_columns(meta: dict) -> set[str]:
    return {item["column"] for item in meta.get("codebook") or [] if item.get("type") == "qualitative"}


# ---------------- routes ----------------

@ai_qual_score_api.get("/ai_qual_score/columns")
def list_qual_score_columns():
    """Lets the frontend know, for a given file_id, whether the AI-scoring
    panel has anything to offer -- authoritative (server-side) rather than
    relying on the wizard's own client-side state, which may be stale or
    simply absent (e.g. after a page reload). A plain (non-AI-generated)
    file_id -- the common case, checked on every Step 2 entry regardless of
    data source -- is reported as "nothing to score" (200, empty list)
    rather than 404: it isn't an error condition for an existence check,
    only for /batch or /finalize actually attempting to score something.

    A qualitative column stays listed even after it's already been scored --
    scoring is a repeatable action (a different rubric, a second rater pass,
    ...), not a one-shot; each run just needs its own new_column name (see
    finalize_qual_score's collision check).

    Also reports whether this file_id is AI-generated at all (`is_ai_generated`)
    -- separate from `qualitative_columns` (an AI-generated file with an
    all-Likert codebook has no qualitative columns, but its data is still
    worth exporting via /api/ai_data_gen/export) -- so the frontend's Step 2
    export buttons can gate on the right, more general condition."""
    file_id = request.args.get("file_id") or ""
    meta, _respondents_df = _load_ai_gen_metadata(file_id)
    if meta is None:
        return jsonify(qualitative_columns=[], is_ai_generated=False)
    return jsonify(qualitative_columns=sorted(_qualitative_columns(meta)), is_ai_generated=True)


@ai_qual_score_api.post("/ai_qual_score/batch")
def generate_qual_score_batch():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    provider = (payload.get("provider") or "openai").strip().lower()
    api_key = (payload.get("api_key") or "").strip()
    model = (payload.get("model") or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["openai"])).strip()
    rubric_prompt = (payload.get("rubric_prompt") or "").strip()
    file_id = payload.get("file_id") or ""
    qual_column = payload.get("qual_column") or ""
    try:
        temperature = float(payload.get("temperature", DEFAULT_TEMPERATURE))
    except (TypeError, ValueError):
        temperature = DEFAULT_TEMPERATURE
    temperature = max(MIN_TEMPERATURE, min(MAX_TEMPERATURE, temperature))

    if provider not in DEFAULT_MODELS:
        return jsonify(error=t("err_ai_bad_provider", lang)), 400
    if not api_key:
        return jsonify(error=t("err_ai_missing_key", lang)), 400
    if not rubric_prompt:
        return jsonify(error=t("err_qual_score_missing_rubric", lang)), 400
    try:
        likert_scale = int(payload.get("likert_scale", 5))
    except (TypeError, ValueError):
        likert_scale = 5
    if likert_scale not in LIKERT_SCALES:
        return jsonify(error=t("err_ai_gen_invalid_likert", lang)), 400
    likert_min, likert_max = LIKERT_SCALES[likert_scale]

    meta, respondents_df = _load_ai_gen_metadata(file_id)
    if meta is None:
        return jsonify(error=t("err_qual_score_no_metadata", lang)), 404
    if qual_column not in _qualitative_columns(meta) or qual_column not in respondents_df.columns:
        return jsonify(error=t("err_qual_score_bad_column", lang)), 400

    try:
        start_row = int(payload.get("start_row"))
        end_row = int(payload.get("end_row"))
    except (TypeError, ValueError):
        return jsonify(error=t("err_ai_gen_invalid_n_rows", lang, min=1, max=MAX_BATCH_SIZE)), 400
    n_total = len(respondents_df)
    expected_n = end_row - start_row + 1
    if expected_n <= 0 or expected_n > MAX_BATCH_SIZE or end_row > n_total:
        return jsonify(error=t("err_ai_gen_invalid_n_rows", lang, min=1, max=MAX_BATCH_SIZE)), 400

    batch_df = respondents_df.iloc[start_row - 1:end_row]
    ids = batch_df["respondent_id"].astype(str).tolist()
    texts = batch_df[qual_column].astype(str).tolist()

    system_msg = _build_rater_system_message(rubric_prompt, likert_min, likert_max, lang)
    batch_user_msg = _build_rater_batch_instruction(ids, texts, lang)
    current_system_msg = system_msg
    last_reason = None

    for _attempt in range(MAX_BATCH_ATTEMPTS):
        text, err_response = _call_ai_provider_mapped(provider, api_key, model, current_system_msg, batch_user_msg, temperature, lang)
        if err_response is not None:
            return err_response

        scores, reason = _parse_qual_score_batch_csv(text, ids, likert_min, likert_max)
        if scores is not None:
            rows = [{"respondent_id": rid, "score": score} for rid, score in zip(ids, scores)]
            return jsonify(rows=rows, used_system_prompt=current_system_msg, used_user_prompt=batch_user_msg)
        last_reason = reason
        current_system_msg = system_msg + "\n\n" + _rater_corrective_note(reason, ids, lang)

    return jsonify(error=t("err_ai_gen_bad_batch", lang, detail=last_reason)), 422


@ai_qual_score_api.post("/ai_qual_score/finalize")
def finalize_qual_score():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id") or ""
    qual_column = payload.get("qual_column") or ""
    new_column = (payload.get("new_column") or "").strip()
    rubric_prompt = (payload.get("rubric_prompt") or "").strip()
    scores = payload.get("scores") or []

    meta, respondents_df = _load_ai_gen_metadata(file_id)
    if meta is None:
        return jsonify(error=t("err_qual_score_no_metadata", lang)), 404
    if qual_column not in _qualitative_columns(meta):
        return jsonify(error=t("err_qual_score_bad_column", lang)), 400
    if not new_column or not new_column.replace("_", "").isalnum():
        return jsonify(error=t("err_qual_score_bad_new_column", lang)), 400

    indicator_path = os.path.join(_upload_dir(), f"{file_id}.csv")
    if not os.path.exists(indicator_path):
        return jsonify(error=t("err_analyze_file_not_found", lang)), 404
    indicator_df = pd.read_csv(indicator_path)
    if new_column in indicator_df.columns:
        return jsonify(error=t("err_qual_score_column_exists", lang, name=new_column)), 400

    try:
        likert_scale = int(payload.get("likert_scale", 5))
    except (TypeError, ValueError):
        likert_scale = 5
    if likert_scale not in LIKERT_SCALES:
        return jsonify(error=t("err_ai_gen_invalid_likert", lang)), 400
    likert_min, likert_max = LIKERT_SCALES[likert_scale]

    expected_ids = respondents_df["respondent_id"].astype(str).tolist()
    if not isinstance(scores, list) or len(scores) != len(expected_ids):
        return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
    score_by_id = {}
    for item in scores:
        if not isinstance(item, dict) or "respondent_id" not in item or "score" not in item:
            return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
        rid = str(item["respondent_id"])
        try:
            score = int(item["score"])
        except (TypeError, ValueError):
            return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
        if score < likert_min or score > likert_max:
            return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
        score_by_id[rid] = score
    if set(score_by_id.keys()) != set(expected_ids) or len(score_by_id) != len(expected_ids):
        return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400

    # Aligned by respondents_df's own row order -- indicator_df and
    # respondents_df are always built in lockstep, same order, at the
    # original finalize step for both generators, so positional alignment
    # here is safe.
    indicator_df[new_column] = [score_by_id[rid] for rid in expected_ids]
    indicator_df.to_csv(indicator_path, index=False)

    derived = list(meta.get("derived_indicators") or [])
    derived.append({"column": new_column, "source_qual_column": qual_column, "rubric_prompt": rubric_prompt})
    meta["derived_indicators"] = derived
    _save_ai_gen_metadata(file_id, respondents_df, meta)

    descriptive_stats = _compute_descriptive_stats(indicator_df, respondents_df, meta.get("demo_attributes") or [])
    return jsonify(
        columns=list(indicator_df.columns),
        numeric_columns=list(indicator_df.columns),
        n_rows=int(indicator_df.shape[0]),
        preview=_clean(indicator_df.head(10).to_dict(orient="records")),
        descriptive_stats=descriptive_stats,
    )
