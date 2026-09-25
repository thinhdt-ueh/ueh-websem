"""AI Lab Experiment: a reusable "AI Worker" pool (persona + demographics,
generated once, no survey answers) that can be administered a survey many
times, under different experimental conditions, against different random
subsets of the same pool -- enabling a real between-subjects synthetic
experiment design that the single-shot AI Lab generator (ai_data_gen_api.py)
cannot express.

Two independent phases:

  Phase 1 (Worker Pool): describe the target population, generate N worker
  profiles (persona_description + resp_age + resp_gender + custom
  attributes -- exactly the demographic columns ai_data_gen_api.py already
  generates, just with NO codebook/indicator columns at all). Reuses
  `_batch_instruction`/`_parse_batch_csv`/`_corrective_note` from that
  module completely unchanged: both are already fully generic over an EMPTY
  `columns`/`qual_columns` list, which degrades them to exactly this shape.
  Persisted server-side by `pool_id`, exportable to and re-importable from
  Excel (so a pool survives across sessions without needing its own
  database).

  Phase 2 (Survey Experiment): pick M <= N workers at random from a pool,
  split them into one or more CONDITION GROUPS (each with its own
  condition prompt -- the experimental manipulation/scenario), define a
  codebook (Likert + qualitative, same shape as ai_data_gen_api.py), and
  have each selected worker answer *as their own already-generated
  persona*, under their assigned group's condition. This is genuinely
  different from Phase 1/ai_data_gen_api.py's generation: no persona is
  invented here, and the response CSV's identity column must match an exact
  pre-declared roster of worker ids, not just be "non-empty" the way
  persona_description is checked today.

  Finalize writes the resulting indicator data into the SAME upload
  directory / file_id convention `finalize()` (ai_data_gen_api.py) already
  uses, and persists metadata via the exact same `_save_ai_gen_metadata`,
  so the existing `/api/ai_data_gen/export` and `/api/ai_data_gen/download`
  routes, and Step 2's model builder, serve an experiment's output with NO
  changes beyond the two extra sheets `export_full` adds when it recognizes
  a `pool_id` in the metadata.
"""

from __future__ import annotations

import io
import json
import math
import os
import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request, send_file
from openpyxl import Workbook

from i18n import get_lang, t
from routes.ai_data_gen_api import (
    AI_BATCH_SIZE,
    DEMO_COLUMNS,
    GEN_CODEBOOK_LABEL,
    GEN_CUSTOM_ATTR_INSTRUCTION,
    GEN_DEMOGRAPHICS_LABEL,
    GEN_DEMO_COLUMNS_INSTRUCTION,
    GEN_NO_DEMOGRAPHICS,
    GEN_OUTPUT_FORMAT_EXTRA_NOTE,
    GEN_OUTPUT_FORMAT_QUAL_NOTE,
    GEN_QUALITATIVE_INSTRUCTION,
    GENDER_VALUES,
    LIKERT_SCALES,
    MAX_AI_ROWS,
    MAX_BATCH_ATTEMPTS,
    MAX_BATCH_SIZE,
    MIN_AI_ROWS,
    MIN_BATCH_SIZE,
    PERSONA_COLUMN,
    _ai_meta_dir,
    _batch_instruction,
    _call_ai_provider_mapped,
    _clean,
    _compute_descriptive_stats,
    _corrective_note,
    _demo_attr_columns,
    _extract_csv_block,
    _format_codebook,
    _format_custom_attrs,
    _format_demographics,
    _load_ai_gen_metadata,
    _normalize_categorical_value,
    _parse_batch_csv,
    _resolve_age_bounds,
    _resolve_gender_desc,
    _save_ai_gen_metadata,
    _split_codebook_columns,
    _validate_codebook,
    _validate_demo_attributes,
    _write_sheet,
)
from routes.ai_report_api import DEFAULT_MODELS, DEFAULT_TEMPERATURE, MAX_TEMPERATURE, MIN_TEMPERATURE
from routes.api import _read_dataframe, _upload_dir

ai_worker_api = Blueprint("ai_worker_api", __name__, url_prefix="/api")

# Reuse the exact same "how many rows can an LLM cleanly emit per call"
# bounds ai_data_gen_api.py already established -- the same constraint
# applies identically to generating workers or generating survey answers.
MIN_WORKERS = MIN_AI_ROWS
MAX_WORKERS = MAX_AI_ROWS

# A between-subjects design with more groups than this gets hard to reason
# about (and to fit a readable UI for) -- mirrors MAX_CUSTOM_DEMO_ATTRS's
# role as a sane ceiling rather than a statistically-derived one.
MAX_CONDITION_GROUPS = 6


# ---------------- Phase 1: Worker Pool prompt building ----------------
# A trimmed variant of ai_data_gen_api.py's _build_generation_messages --
# same persona-construction idea, but with every mention of survey
# questions/Likert scales removed, since a worker has no answers yet.

GEN_WORKER_ROLE_FRAMING = {
    "vi": (
        "Bạn đang tạo một nhóm người tham gia khảo sát (participant) giả lập cho một nghiên cứu học "
        "thuật, để dùng lại nhiều lần sau này -- KHÔNG trả lời câu hỏi khảo sát nào ở bước này, chỉ "
        "tạo hồ sơ nhân vật (persona) và thông tin cá nhân của họ."
    ),
    "en": (
        "You are creating a pool of simulated survey participants for an academic study, to be reused "
        "many times later -- do NOT answer any survey questions at this step, only create each "
        "person's persona profile and personal attributes."
    ),
}

GEN_WORKER_PERSONA_INSTRUCTION = {
    "vi": (
        "Với MỖI người (mỗi dòng), hãy DỰNG RA một hồ sơ nhân vật cụ thể, thực tế, và KHÁC BIỆT thật "
        "sự so với những người khác trong nhóm (không chỉ khác ở vài chi tiết ngẫu nhiên) -- phù hợp "
        "với đối tượng mục tiêu được mô tả bên dưới: tuổi, giới tính, nghề nghiệp/bối cảnh sống, tính "
        "cách, và các đặc điểm liên quan khác. Viết hồ sơ này thành MỘT câu THẬT NGẮN GỌN (tối đa 15 "
        "từ, KHÔNG đặt tên riêng) vào cột `persona_description`. Toàn bộ nhóm phải đa dạng thực tế -- "
        "tránh lặp lại cùng một khuôn mẫu tính cách cho nhiều người."
    ),
    "en": (
        "For EACH person (row), CONSTRUCT a concrete, realistic persona that is genuinely DIFFERENT "
        "from every other person in the pool (not just varied by a few random details) -- consistent "
        "with the target population described below: age, gender, occupation/life context, "
        "personality, and other relevant traits. Write this profile as ONE VERY SHORT sentence (15 "
        "words max, NO invented proper names) into the `persona_description` column. The whole pool "
        "must be realistically varied -- avoid repeating the same personality template across people."
    ),
}

GEN_WORKER_OUTPUT_FORMAT = {
    "vi": (
        "Chỉ xuất ra một bảng CSV -- dòng đầu tiên là chính xác header sau: {header}. Sau đó mỗi dòng "
        "là một người: cột đầu tiên `persona_description` (một câu ngắn, LUÔN đặt trong dấu ngoặc kép "
        "\"...\" vì có thể chứa dấu phẩy), rồi `resp_age` (số nguyên trong khoảng đã nêu), "
        "`resp_gender` (`male` hoặc `female`){extra_note}. KHÔNG markdown code fence, KHÔNG giải "
        "thích, KHÔNG có văn bản nào khác ngoài bảng CSV."
    ),
    "en": (
        "Output ONLY a CSV table -- the first line must be exactly this header: {header}. Each "
        "following line is one person: the first column `persona_description` (one short sentence, "
        "ALWAYS wrapped in double quotes \"...\" since it may contain commas), then `resp_age` (an "
        "integer in the stated range), `resp_gender` (`male` or `female`){extra_note}. NO markdown "
        "code fences, NO explanations, NO text other than the CSV table."
    ),
}


def _build_worker_generation_messages(
    population_prompt: str, demographics: dict, demo_attributes: list[dict], n_workers: int, lang: str,
) -> tuple[str, str]:
    # Reuses the exact same formatting helpers ai_data_gen_api.py's own
    # codebook-based prompt builder uses for demographics/custom attrs.
    demo_attr_columns = _demo_attr_columns(demo_attributes)
    header = ",".join([PERSONA_COLUMN] + DEMO_COLUMNS + demo_attr_columns)
    age_min, age_max = _resolve_age_bounds(demographics)
    gender_desc = _resolve_gender_desc(demographics, lang)
    demo_label = GEN_DEMOGRAPHICS_LABEL.get(lang, GEN_DEMOGRAPHICS_LABEL["en"])
    extra_note = GEN_OUTPUT_FORMAT_EXTRA_NOTE.get(lang, GEN_OUTPUT_FORMAT_EXTRA_NOTE["en"]) if demo_attributes else ""

    demo_text = _format_demographics(demographics, lang)
    if not demo_text or demo_text == GEN_NO_DEMOGRAPHICS.get(lang, GEN_NO_DEMOGRAPHICS["en"]):
        demo_text = GEN_NO_DEMOGRAPHICS.get(lang, GEN_NO_DEMOGRAPHICS["en"])
    population_text = (population_prompt or "").strip()

    parts = [
        GEN_WORKER_ROLE_FRAMING.get(lang, GEN_WORKER_ROLE_FRAMING["en"]),
        GEN_WORKER_PERSONA_INSTRUCTION.get(lang, GEN_WORKER_PERSONA_INSTRUCTION["en"]),
        f"{demo_label}:\n{population_text}\n{demo_text}" if population_text else f"{demo_label}:\n{demo_text}",
        GEN_DEMO_COLUMNS_INSTRUCTION.get(lang, GEN_DEMO_COLUMNS_INSTRUCTION["en"]).format(
            age_min=age_min, age_max=age_max, gender_desc=gender_desc,
        ),
    ]
    if demo_attributes:
        parts.append(
            GEN_CUSTOM_ATTR_INSTRUCTION.get(lang, GEN_CUSTOM_ATTR_INSTRUCTION["en"]).format(
                attr_list=_format_custom_attrs(demo_attributes, lang),
            )
        )
    parts.append(GEN_WORKER_OUTPUT_FORMAT.get(lang, GEN_WORKER_OUTPUT_FORMAT["en"]).format(header=header, extra_note=extra_note))
    system_msg = "\n\n".join(parts)
    user_msg = {
        "vi": f"Hãy tạo bộ hồ sơ người tham gia (AI Worker) cho nghiên cứu mô tả ở trên. Tổng số người cần: {n_workers}.",
        "en": f"Create the pool of participant (AI Worker) profiles for the study described above. Total people needed: {n_workers}.",
    }.get(lang, f"Create the pool of participant (AI Worker) profiles for the study described above. Total people needed: {n_workers}.")
    return system_msg, user_msg


def _worker_batch_instruction(start_row: int, end_row: int, lang: str, demo_attr_columns: list[str] | None = None) -> str:
    # Identical in spirit to _batch_instruction, just with columns=[] baked
    # in (no indicator/Likert questions exist at the worker-pool stage).
    return _batch_instruction([], 1, 1, start_row, end_row, lang, demo_attr_columns, [])


# ---------------- Phase 2: Survey administration prompt building ----------------
# Unlike ai_data_gen_api.py's generator, no persona is invented here -- each
# worker's persona_description + demographics are already fixed and given
# verbatim, and every worker in a batch is additionally under one shared
# "condition" (the experimental manipulation for their group).

GEN_SURVEY_ROLE_FRAMING = {
    "vi": (
        "Bạn đang mô phỏng những người tham gia CỤ THỂ (đã có hồ sơ nhân vật sẵn) trả lời một khảo sát "
        "học thuật, sau khi họ vừa trải qua một tình huống/điều kiện thực nghiệm cụ thể."
    ),
    "en": (
        "You are simulating SPECIFIC, already-defined participants answering an academic survey, "
        "right after they experienced a specific experimental scenario/condition."
    ),
}

GEN_SURVEY_PERSONA_INSTRUCTION = {
    "vi": (
        "Dưới đây là hồ sơ của từng người tham gia (worker_id và persona/thông tin cá nhân của họ). "
        "Với MỖI người, bạn phải THỰC SỰ ĐÓNG VAI đúng người đó -- không tạo persona mới, không đổi "
        "tuổi/giới tính/đặc điểm của họ. Trả lời TẤT CẢ câu hỏi khảo sát đúng như người đó, dưới ảnh "
        "hưởng của điều kiện thực nghiệm được mô tả bên dưới. Các câu hỏi đo cùng một khái niệm phải "
        "có câu trả lời tương quan hợp lý cho cùng một người (không ngẫu nhiên độc lập từng câu), "
        "nhưng vẫn nên có dao động tự nhiên nhỏ (khoảng 1 bậc thang đo) giữa các câu cùng khái niệm, "
        "PHẢI giữ trong khoảng thang đo hợp lệ {lo}-{hi}. Những người khác nhau (worker khác nhau) "
        "phải phản ứng khác nhau thực sự với cùng điều kiện, phù hợp với cá tính riêng của họ -- "
        "không phải ai cũng phản ứng giống nhau.\n\nHồ sơ từng người:\n{roster}"
    ),
    "en": (
        "Below is each participant's profile (worker_id and their persona/personal attributes). For "
        "EACH person, you must ACTUALLY ROLE-PLAY as that exact person -- do not invent a new persona, "
        "do not change their age/gender/traits. Answer ALL survey questions as that person would, under "
        "the influence of the experimental condition described below. Items measuring the same concept "
        "must correlate realistically for the same person (not independently randomized), but should "
        "still show a little natural variation (about a 1-point spread) between items on the same "
        "concept, and MUST stay within the valid scale range {lo}-{hi}. Different people (different "
        "workers) must react genuinely differently to the same condition, consistent with their own "
        "personality -- not everyone reacting identically.\n\nEach person's profile:\n{roster}"
    ),
}

GEN_SURVEY_CONDITION_INSTRUCTION = {
    "vi": (
        "Điều kiện thực nghiệm (tất cả người tham gia dưới đây vừa trải qua tình huống này ngay trước "
        "khi trả lời khảo sát): {condition}"
    ),
    "en": (
        "Experimental condition (every participant below just experienced this situation immediately "
        "before answering the survey): {condition}"
    ),
}

GEN_SURVEY_OUTPUT_FORMAT = {
    "vi": (
        "Chỉ xuất ra một bảng CSV -- dòng đầu tiên là chính xác header sau: {header}. Sau đó mỗi dòng "
        "là một người tham gia: cột đầu tiên `worker_id` PHẢI khớp chính xác với một trong các "
        "worker_id đã cho ở trên (mỗi worker_id xuất hiện đúng một lần), tiếp theo các câu hỏi Likert "
        "là số nguyên từ {lo} đến {hi}{qual_note}. KHÔNG markdown code fence, KHÔNG giải thích, KHÔNG "
        "có văn bản nào khác ngoài bảng CSV."
    ),
    "en": (
        "Output ONLY a CSV table -- the first line must be exactly this header: {header}. Each "
        "following line is one participant: the first column `worker_id` MUST exactly match one of "
        "the worker_ids given above (each worker_id appearing exactly once), then the Likert questions "
        "as integers from {lo} to {hi}{qual_note}. NO markdown code fences, NO explanations, NO text "
        "other than the CSV table."
    ),
}


def _format_worker_roster(workers: list[dict], lang: str) -> str:
    lines = []
    for w in workers:
        extra = ", ".join(
            f"{k}={v}" for k, v in w.items()
            if k not in (PERSONA_COLUMN, "resp_age", "resp_gender", "worker_id")
        )
        base = {
            "vi": f"- {w['worker_id']}: {w[PERSONA_COLUMN]} (tuổi {w['resp_age']}, {w['resp_gender']})",
            "en": f"- {w['worker_id']}: {w[PERSONA_COLUMN]} (age {w['resp_age']}, {w['resp_gender']})",
        }.get(lang, f"- {w['worker_id']}: {w[PERSONA_COLUMN]} (age {w['resp_age']}, {w['resp_gender']})")
        if extra:
            base += f", {extra}"
        lines.append(base)
    return "\n".join(lines)


def _build_survey_messages(
    workers: list[dict], condition_text: str, codebook: list[dict], likert_scale: int, lang: str,
) -> tuple[str, str]:
    lo, hi = LIKERT_SCALES[likert_scale]
    _likert_cols, qual_cols = _split_codebook_columns(codebook)
    codebook_label = GEN_CODEBOOK_LABEL.get(lang, GEN_CODEBOOK_LABEL["en"])
    qual_note = GEN_OUTPUT_FORMAT_QUAL_NOTE.get(lang, GEN_OUTPUT_FORMAT_QUAL_NOTE["en"]) if qual_cols else ""
    header = ",".join(["worker_id"] + [item["column"] for item in codebook])
    roster = _format_worker_roster(workers, lang)

    parts = [
        GEN_SURVEY_ROLE_FRAMING.get(lang, GEN_SURVEY_ROLE_FRAMING["en"]),
        GEN_SURVEY_PERSONA_INSTRUCTION.get(lang, GEN_SURVEY_PERSONA_INSTRUCTION["en"]).format(lo=lo, hi=hi, roster=roster),
        GEN_SURVEY_CONDITION_INSTRUCTION.get(lang, GEN_SURVEY_CONDITION_INSTRUCTION["en"]).format(condition=(condition_text or "").strip()),
        f"{codebook_label}:\n{_format_codebook(codebook, lang)}",
    ]
    if qual_cols:
        parts.append(GEN_QUALITATIVE_INSTRUCTION.get(lang, GEN_QUALITATIVE_INSTRUCTION["en"]))
    parts.append(GEN_SURVEY_OUTPUT_FORMAT.get(lang, GEN_SURVEY_OUTPUT_FORMAT["en"]).format(header=header, lo=lo, hi=hi, qual_note=qual_note))
    system_msg = "\n\n".join(parts)
    user_msg = {
        "vi": f"Hãy sinh câu trả lời khảo sát cho đúng {len(workers)} người tham gia đã nêu ở trên, dưới điều kiện đã mô tả.",
        "en": f"Generate survey answers for exactly the {len(workers)} participants named above, under the stated condition.",
    }.get(lang, f"Generate survey answers for exactly the {len(workers)} participants named above, under the stated condition.")
    return system_msg, user_msg


def _survey_batch_instruction(columns: list[str], lo: int, hi: int, worker_ids: list[str], lang: str, qual_columns: list[str] | None = None) -> str:
    n = len(worker_ids)
    header = ",".join(["worker_id"] + list(columns))
    qual_columns = qual_columns or []
    qual_reminder = {
        "vi": f" (trừ các cột định tính {', '.join(qual_columns)} -- viết văn bản tự do, đặt trong dấu ngoặc kép, cho các cột đó)",
        "en": f" (except the qualitative columns {', '.join(qual_columns)} -- write free text, double-quoted, for those)",
    }.get(lang, f" (except the qualitative columns {', '.join(qual_columns)} -- write free text, double-quoted, for those)") if qual_columns else ""
    ids_list = ", ".join(worker_ids)
    return {
        "vi": (
            f"Sinh chính xác {n} dòng ngay bây giờ, đúng cho các worker_id sau (mỗi id đúng một lần, "
            f"không thêm/bớt): {ids_list}. Chỉ xuất CSV, dòng đầu là header: {header}, theo sau đúng "
            f"{n} dòng dữ liệu -- mỗi dòng bắt đầu bằng `worker_id` đúng như đã cho, rồi đến các câu "
            f"hỏi là số nguyên từ {lo} đến {hi}{qual_reminder}."
        ),
        "en": (
            f"Generate exactly {n} rows now, exactly for these worker_ids (each appearing exactly "
            f"once, no more, no fewer): {ids_list}. Output ONLY the CSV, header row: {header}, "
            f"followed by exactly {n} data rows -- each row starting with the given `worker_id`, then "
            f"whole numbers from {lo} to {hi} for the questions{qual_reminder}."
        ),
    }.get(lang, (
        f"Generate exactly {n} rows now, exactly for these worker_ids: {ids_list}. Output ONLY the "
        f"CSV, header row: {header}, followed by exactly {n} data rows -- each row starting with the "
        f"given `worker_id`, then whole numbers from {lo} to {hi} for the questions{qual_reminder}."
    ))


def _survey_corrective_note(reason: str, columns: list[str], worker_ids: list[str], lang: str) -> str:
    header = ",".join(["worker_id"] + list(columns))
    return {
        "vi": (
            f"Phản hồi trước không hợp lệ ({reason}). CHỈ xuất bảng CSV với header CHÍNH XÁC: "
            f"{header}, và đúng các worker_id: {', '.join(worker_ids)} -- không markdown, không giải thích."
        ),
        "en": (
            f"Your previous response was invalid ({reason}). Output ONLY a CSV table with header "
            f"EXACTLY: {header}, and exactly these worker_ids: {', '.join(worker_ids)} -- no markdown, "
            f"no explanation."
        ),
    }.get(lang, (
        f"Your previous response was invalid ({reason}). Output ONLY a CSV table with header EXACTLY: "
        f"{header}, and exactly these worker_ids: {', '.join(worker_ids)} -- no markdown, no explanation."
    ))


def _parse_survey_batch_csv(
    text: str, expected_worker_ids: list[str], columns: list[str], likert_min: int, likert_max: int,
    qual_columns: list[str] | None = None,
):
    """Returns (dataframe, None) or (None, reason) -- same never-raises
    contract as _parse_batch_csv. The identity column here (`worker_id`)
    must be an EXACT set-match to `expected_worker_ids` (every given worker
    answers exactly once, no invented extras) -- deliberately stricter than
    _parse_batch_csv's persona_description check (merely "non-empty"),
    since these workers already exist and must all be accounted for.
    Duplicates (rather than importing) _parse_batch_csv's Likert/qualitative
    validation block -- small enough that copying it here is lower-risk
    than modifying that already-well-tested function's internals.
    """
    qual_columns = qual_columns or []
    likert_columns = [c for c in columns if c not in qual_columns]
    all_columns = ["worker_id"] + list(columns)
    cleaned = _extract_csv_block(text)
    try:
        df = pd.read_csv(io.StringIO(cleaned))
    except Exception as exc:  # noqa: BLE001
        return None, f"could not parse as CSV ({exc})"

    if set(df.columns) != set(all_columns):
        missing = sorted(set(all_columns) - set(df.columns))
        extra = sorted(set(df.columns) - set(all_columns))
        return None, f"column mismatch (missing={missing}, extra={extra})"
    df = df[all_columns]

    worker_id_part = df["worker_id"].astype(str).str.strip()
    if set(worker_id_part) != set(expected_worker_ids) or len(worker_id_part) != len(expected_worker_ids):
        return None, f"worker_id column must contain exactly {sorted(expected_worker_ids)}, one each"

    likert_part = df[likert_columns].apply(pd.to_numeric, errors="coerce") if likert_columns else pd.DataFrame(index=df.index)
    if likert_part.isna().any().any():
        return None, "a non-numeric value was found"
    if ((likert_part < likert_min) | (likert_part > likert_max)).any().any():
        return None, f"a value outside the [{likert_min}, {likert_max}] range was found"

    qual_raw = df[qual_columns] if qual_columns else pd.DataFrame(index=df.index)
    qual_part = qual_raw.astype(str).apply(lambda s: s.str.strip()) if qual_columns else qual_raw
    if qual_columns:
        qual_empty = qual_raw.isna() | (qual_part == "") | (qual_part.apply(lambda s: s.str.lower()) == "nan")
        if qual_empty.any().any():
            return None, "a qualitative answer was empty"

    out = pd.DataFrame({"worker_id": worker_id_part})
    if likert_columns:
        out[likert_columns] = likert_part.astype(int)
    if qual_columns:
        out[qual_columns] = qual_part
    out = out[["worker_id"] + list(columns)]
    # Re-order to match the caller's requested roster order, not whatever
    # order the AI happened to emit rows in -- callers zip this against
    # per-worker metadata by position downstream.
    out = out.set_index("worker_id").loc[expected_worker_ids].reset_index()
    return out, None


# ---------------- Worker Pool persistence ----------------

def _worker_pool_path(pool_id: str) -> str:
    return os.path.join(_ai_meta_dir(), f"{pool_id}_pool.json")


def _save_worker_pool(pool: dict) -> None:
    with open(_worker_pool_path(pool["pool_id"]), "w", encoding="utf-8") as f:
        json.dump(pool, f, ensure_ascii=False, indent=2)


def _load_worker_pool(pool_id: str) -> dict | None:
    path = _worker_pool_path(pool_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ==================== Phase 1 routes: Worker Pool ====================

@ai_worker_api.post("/ai_worker/suggest_prompt")
def suggest_worker_prompt():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    population_prompt = (payload.get("population_prompt") or "").strip()
    demographics = payload.get("demographics") or {}
    demo_attributes, attr_err = _validate_demo_attributes(payload.get("demo_attributes"), lang)
    if attr_err:
        return jsonify(error=attr_err), 400
    try:
        n_workers = int(payload.get("n_workers", 100))
    except (TypeError, ValueError):
        n_workers = 100
    n_workers = max(MIN_WORKERS, min(MAX_WORKERS, n_workers))
    try:
        requested_batch_size = int(payload.get("batch_size", AI_BATCH_SIZE))
    except (TypeError, ValueError):
        requested_batch_size = AI_BATCH_SIZE
    requested_batch_size = max(MIN_BATCH_SIZE, min(MAX_BATCH_SIZE, requested_batch_size))

    system_msg, user_msg = _build_worker_generation_messages(population_prompt, demographics, demo_attributes, n_workers, lang)
    batch_size = min(requested_batch_size, n_workers)
    total_batches = math.ceil(n_workers / batch_size)
    first_batch_instruction = _worker_batch_instruction(1, batch_size, lang, _demo_attr_columns(demo_attributes))
    return jsonify(
        system_prompt=system_msg, user_prompt=user_msg,
        batch_size=batch_size, total_batches=total_batches,
        first_batch_instruction=first_batch_instruction,
    )


@ai_worker_api.post("/ai_worker/batch")
def generate_worker_batch():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    provider = (payload.get("provider") or "openai").strip().lower()
    api_key = (payload.get("api_key") or "").strip()
    model = (payload.get("model") or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["openai"])).strip()
    system_msg = payload.get("system_prompt") or ""
    user_msg = payload.get("user_prompt") or ""
    try:
        temperature = float(payload.get("temperature", DEFAULT_TEMPERATURE))
    except (TypeError, ValueError):
        temperature = DEFAULT_TEMPERATURE
    temperature = max(MIN_TEMPERATURE, min(MAX_TEMPERATURE, temperature))

    if provider not in DEFAULT_MODELS:
        return jsonify(error=t("err_ai_bad_provider", lang)), 400
    if not api_key:
        return jsonify(error=t("err_ai_missing_key", lang)), 400
    demo_attributes, attr_err = _validate_demo_attributes(payload.get("demo_attributes"), lang)
    if attr_err:
        return jsonify(error=attr_err), 400
    try:
        start_row = int(payload.get("start_row"))
        end_row = int(payload.get("end_row"))
    except (TypeError, ValueError):
        return jsonify(error=t("err_ai_gen_invalid_n_rows", lang, min=MIN_WORKERS, max=MAX_WORKERS)), 400

    expected_n = end_row - start_row + 1
    if expected_n <= 0 or expected_n > MAX_BATCH_SIZE:
        return jsonify(error=t("err_ai_gen_invalid_n_rows", lang, min=MIN_WORKERS, max=MAX_WORKERS)), 400

    age_min, age_max = _resolve_age_bounds({"age_min": payload.get("demo_age_min"), "age_max": payload.get("demo_age_max")})
    demo_attr_columns = _demo_attr_columns(demo_attributes)
    categorical_attr_columns = {a["column"] for a in demo_attributes if a["type"] == "categorical"}

    batch_user_msg = user_msg + "\n\n" + _worker_batch_instruction(start_row, end_row, lang, demo_attr_columns)
    current_system_msg = system_msg
    last_reason = None

    for _attempt in range(MAX_BATCH_ATTEMPTS):
        text, err_response = _call_ai_provider_mapped(provider, api_key, model, current_system_msg, batch_user_msg, temperature, lang)
        if err_response is not None:
            return err_response

        df, reason = _parse_batch_csv(text, [], 1, 1, expected_n, age_min, age_max, demo_attributes, [])
        if df is not None:
            string_cols = {"resp_gender", PERSONA_COLUMN} | categorical_attr_columns
            safe_rows = [
                {k: (str(v) if k in string_cols else int(v)) for k, v in row.items()}
                for row in df.to_dict(orient="records")
            ]
            return jsonify(rows=safe_rows, used_system_prompt=current_system_msg, used_user_prompt=batch_user_msg)
        last_reason = reason
        current_system_msg = system_msg + "\n\n" + _corrective_note(reason, [], expected_n, lang, demo_attr_columns)

    return jsonify(error=t("err_ai_gen_bad_batch", lang, detail=last_reason)), 422


@ai_worker_api.post("/ai_worker/finalize_pool")
def finalize_pool():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    rows = payload.get("rows") or []
    if not isinstance(rows, list) or not (MIN_WORKERS <= len(rows) <= MAX_WORKERS):
        return jsonify(error=t("err_ai_gen_invalid_n_rows", lang, min=MIN_WORKERS, max=MAX_WORKERS)), 400

    demo_attributes, attr_err = _validate_demo_attributes(payload.get("demo_attributes"), lang)
    if attr_err:
        return jsonify(error=attr_err), 400
    demo_attr_columns = _demo_attr_columns(demo_attributes)
    categorical_attrs_by_col = {a["column"]: a for a in demo_attributes if a["type"] == "categorical"}

    all_columns = [PERSONA_COLUMN] + DEMO_COLUMNS + demo_attr_columns
    col_set = set(all_columns)
    for row in rows:
        if not isinstance(row, dict) or set(row.keys()) != col_set:
            return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
        for k, v in row.items():
            if k == PERSONA_COLUMN:
                if not str(v).strip():
                    return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
                continue
            if k == "resp_gender":
                if str(v).strip().lower() not in GENDER_VALUES:
                    return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
                continue
            if k in categorical_attrs_by_col:
                if _normalize_categorical_value(v, categorical_attrs_by_col[k]["options"]) is None:
                    return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
                continue
            try:
                int(v)
            except (TypeError, ValueError):
                return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400

    full_df = pd.DataFrame(rows, columns=all_columns)
    full_df[PERSONA_COLUMN] = full_df[PERSONA_COLUMN].astype(str).str.strip()
    full_df["resp_age"] = full_df["resp_age"].astype(int)
    full_df["resp_gender"] = full_df["resp_gender"].astype(str).str.strip().str.lower()
    for attr in demo_attributes:
        col = attr["column"]
        if attr["type"] == "numeric":
            full_df[col] = full_df[col].astype(int)
        else:
            full_df[col] = full_df[col].apply(lambda v, opts=attr["options"]: _normalize_categorical_value(v, opts))
    full_df.insert(0, "worker_id", [f"W{i + 1:04d}" for i in range(len(full_df))])

    pool_id = uuid.uuid4().hex
    pool = {
        "pool_id": pool_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "population_prompt": (payload.get("population_prompt") or "").strip(),
        "demographics": payload.get("demographics") or {},
        "demo_attributes": demo_attributes,
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "temperature": payload.get("temperature"),
        "n_workers": int(len(full_df)),
        "workers": full_df.to_dict(orient="records"),
    }
    _save_worker_pool(pool)

    return jsonify(
        pool_id=pool_id,
        n_workers=pool["n_workers"],
        preview=_clean(full_df.head(10).to_dict(orient="records")),
        demographics_summary=pool["demographics"],
        demo_attributes=demo_attributes,
    )


@ai_worker_api.get("/ai_worker/pool")
def get_worker_pool():
    lang = get_lang({"lang": request.args.get("lang")})
    pool_id = request.args.get("pool_id") or ""
    pool = _load_worker_pool(pool_id)
    if pool is None:
        return jsonify(error=t("err_worker_pool_not_found", lang)), 404
    return jsonify(**pool)


@ai_worker_api.get("/ai_worker/pool_export")
def export_worker_pool():
    lang = get_lang({"lang": request.args.get("lang")})
    pool_id = request.args.get("pool_id") or ""
    pool = _load_worker_pool(pool_id)
    if pool is None:
        return jsonify(error=t("err_worker_pool_not_found", lang)), 404

    workers = pool["workers"]
    columns = list(workers[0].keys()) if workers else ["worker_id", PERSONA_COLUMN, "resp_age", "resp_gender"]
    wb = Workbook()
    ws = wb.active
    ws.title = "Worker Pool"
    _write_sheet(ws, [columns] + [[w.get(c) for c in columns] for w in workers])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf, as_attachment=True, download_name=f"ai_worker_pool_{pool_id[:8]}.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@ai_worker_api.get("/ai_worker/pool_import_template")
def download_worker_pool_template():
    # A ready-to-fill example matching exactly the shape import_worker_pool()
    # requires (worker_id, persona_description, resp_age, resp_gender), plus
    # one example extra column to show how a custom demographic attribute is
    # recognized on import (numeric-vs-categorical inferred from its values).
    wb = Workbook()
    ws = wb.active
    ws.title = "Worker Pool"
    header = ["worker_id", PERSONA_COLUMN, "resp_age", "resp_gender", "Monthly Income (USD)"]
    sample_rows = [
        ["W0001", "A budget-conscious university student who shops online every week", 21, "female", 300],
        ["W0002", "A busy office worker who rarely compares prices before buying", 34, "male", 1200],
    ]
    _write_sheet(ws, [header] + sample_rows)

    ws2 = wb.create_sheet("Instructions")
    _write_sheet(ws2, [
        ["Column", "Required?", "Notes"],
        ["worker_id", "Required", "Must be unique per row, e.g. W0001, W0002, ..."],
        [PERSONA_COLUMN, "Required", "A short free-text persona description for this worker."],
        ["resp_age", "Required", "Integer age."],
        ["resp_gender", "Required", "Exactly 'male' or 'female' for every row."],
        ["(any other column)", "Optional", "Any extra column becomes a custom demographic attribute: numeric if every value in it parses as a number, otherwise categorical (options are the distinct values found)."],
    ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf, as_attachment=True, download_name="ai_worker_pool_template.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@ai_worker_api.post("/ai_worker/import_pool")
def import_worker_pool():
    lang = get_lang({"lang": request.form.get("lang")})
    if "file" not in request.files:
        return jsonify(error=t("err_upload_no_file", lang)), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify(error=t("err_upload_empty_filename", lang)), 400

    tmp_path = os.path.join(_ai_meta_dir(), f"_import_{uuid.uuid4().hex}{os.path.splitext(f.filename)[1].lower()}")
    f.save(tmp_path)
    try:
        df = _read_dataframe(tmp_path)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_upload_read_error", lang, exc=exc)), 400
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    required = {"worker_id", PERSONA_COLUMN, "resp_age", "resp_gender"}
    if not required.issubset(set(df.columns)):
        return jsonify(error=t("err_worker_pool_import_bad_file", lang)), 400
    if df["resp_gender"].astype(str).str.strip().str.lower().isin(GENDER_VALUES).all() is False:
        return jsonify(error=t("err_worker_pool_import_bad_file", lang)), 400

    extra_cols = [c for c in df.columns if c not in required]
    demo_attributes = []
    for col in extra_cols:
        series = df[col]
        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.notna().all():
            demo_attributes.append({
                "name": col, "column": col, "type": "numeric",
                "min": int(numeric.min()), "max": int(numeric.max()), "options": None,
            })
        else:
            options = sorted({str(v).strip() for v in series.dropna()})[: 8]
            if len(options) < 2:
                continue
            demo_attributes.append({"name": col, "column": col, "type": "categorical", "min": None, "max": None, "options": options})

    df[PERSONA_COLUMN] = df[PERSONA_COLUMN].astype(str).str.strip()
    df["resp_age"] = pd.to_numeric(df["resp_age"], errors="coerce").astype(int)
    df["resp_gender"] = df["resp_gender"].astype(str).str.strip().str.lower()

    pool_id = uuid.uuid4().hex
    pool = {
        "pool_id": pool_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "population_prompt": "",
        "demographics": {},
        "demo_attributes": demo_attributes,
        "provider": None, "model": None, "temperature": None,
        "n_workers": int(len(df)),
        "workers": df[["worker_id", PERSONA_COLUMN, "resp_age", "resp_gender"] + extra_cols].to_dict(orient="records"),
    }
    _save_worker_pool(pool)
    return jsonify(
        pool_id=pool_id, n_workers=pool["n_workers"],
        preview=_clean(df.head(10).to_dict(orient="records")),
        demographics_summary={}, demo_attributes=demo_attributes,
    )


# ==================== Phase 2 routes: Survey Experiment ====================

@ai_worker_api.post("/ai_worker/select")
def select_workers():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    pool_id = payload.get("pool_id") or ""
    pool = _load_worker_pool(pool_id)
    if pool is None:
        return jsonify(error=t("err_worker_pool_not_found", lang)), 404

    raw_sizes = payload.get("group_sizes")
    if not isinstance(raw_sizes, list) or not raw_sizes:
        return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400
    if len(raw_sizes) > MAX_CONDITION_GROUPS:
        return jsonify(error=t("err_worker_select_too_many_groups", lang, max=MAX_CONDITION_GROUPS)), 400
    try:
        group_sizes = [int(s) for s in raw_sizes]
    except (TypeError, ValueError):
        return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400
    if any(s <= 0 for s in group_sizes):
        return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400

    n_workers = pool["n_workers"]
    m = sum(group_sizes)
    if m > n_workers:
        return jsonify(error=t("err_worker_select_m_too_large", lang, m=m, n=n_workers)), 400

    all_ids = [w["worker_id"] for w in pool["workers"]]
    rng = np.random.default_rng()  # fresh randomness every call -- the user re-rolls this deliberately
    shuffled = rng.permutation(all_ids).tolist()
    selected = shuffled[:m]
    excluded = shuffled[m:]

    groups = []
    cursor = 0
    for i, size in enumerate(group_sizes):
        groups.append({"group_index": i, "worker_ids": selected[cursor:cursor + size]})
        cursor += size

    return jsonify(groups=groups, excluded_worker_ids=excluded)


@ai_worker_api.post("/ai_worker/suggest_survey_prompt")
def suggest_survey_prompt():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    pool_id = payload.get("pool_id") or ""
    pool = _load_worker_pool(pool_id)
    if pool is None:
        return jsonify(error=t("err_worker_pool_not_found", lang)), 404
    workers_by_id = {w["worker_id"]: w for w in pool["workers"]}

    codebook, cb_err = _validate_codebook(payload.get("codebook"), lang)
    if cb_err:
        return jsonify(error=cb_err), 400
    try:
        likert_scale = int(payload.get("likert_scale", 5))
    except (TypeError, ValueError):
        likert_scale = 5
    if likert_scale not in LIKERT_SCALES:
        return jsonify(error=t("err_ai_gen_invalid_likert", lang)), 400

    raw_groups = payload.get("groups") or []
    if not isinstance(raw_groups, list) or not raw_groups:
        return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400

    try:
        requested_batch_size = int(payload.get("batch_size", AI_BATCH_SIZE))
    except (TypeError, ValueError):
        requested_batch_size = AI_BATCH_SIZE
    requested_batch_size = max(MIN_BATCH_SIZE, min(MAX_BATCH_SIZE, requested_batch_size))

    out_groups = []
    for g in raw_groups:
        worker_ids = g.get("worker_ids") or []
        if not isinstance(worker_ids, list) or not worker_ids:
            return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400
        workers = [workers_by_id[wid] for wid in worker_ids if wid in workers_by_id]
        if len(workers) != len(worker_ids):
            return jsonify(error=t("err_worker_pool_not_found", lang)), 404
        condition_text = (g.get("condition_text") or "").strip()
        system_msg, user_msg = _build_survey_messages(workers, condition_text, codebook, likert_scale, lang)
        batch_size = min(requested_batch_size, len(worker_ids))
        total_batches = math.ceil(len(worker_ids) / batch_size)
        out_groups.append({
            "group_index": g.get("group_index"),
            "system_prompt": system_msg, "user_prompt": user_msg,
            "batch_size": batch_size, "total_batches": total_batches,
        })

    return jsonify(groups=out_groups)


@ai_worker_api.post("/ai_worker/survey_batch")
def generate_survey_batch():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    provider = (payload.get("provider") or "openai").strip().lower()
    api_key = (payload.get("api_key") or "").strip()
    model = (payload.get("model") or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["openai"])).strip()
    system_msg = payload.get("system_prompt") or ""
    user_msg = payload.get("user_prompt") or ""
    columns = payload.get("columns") or []
    worker_ids = payload.get("worker_ids") or []
    try:
        temperature = float(payload.get("temperature", DEFAULT_TEMPERATURE))
    except (TypeError, ValueError):
        temperature = DEFAULT_TEMPERATURE
    temperature = max(MIN_TEMPERATURE, min(MAX_TEMPERATURE, temperature))

    if provider not in DEFAULT_MODELS:
        return jsonify(error=t("err_ai_bad_provider", lang)), 400
    if not api_key:
        return jsonify(error=t("err_ai_missing_key", lang)), 400
    if not columns or not isinstance(columns, list):
        return jsonify(error=t("err_ai_gen_missing_codebook", lang)), 400
    if not worker_ids or not isinstance(worker_ids, list) or len(worker_ids) > MAX_BATCH_SIZE:
        return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400
    try:
        likert_min = int(payload.get("likert_min"))
        likert_max = int(payload.get("likert_max"))
    except (TypeError, ValueError):
        return jsonify(error=t("err_ai_gen_invalid_likert", lang)), 400

    raw_qual_columns = payload.get("qualitative_columns") or []
    qual_columns = [c for c in raw_qual_columns if c in columns] if isinstance(raw_qual_columns, list) else []

    batch_user_msg = user_msg + "\n\n" + _survey_batch_instruction(columns, likert_min, likert_max, worker_ids, lang, qual_columns)
    current_system_msg = system_msg
    last_reason = None

    for _attempt in range(MAX_BATCH_ATTEMPTS):
        text, err_response = _call_ai_provider_mapped(provider, api_key, model, current_system_msg, batch_user_msg, temperature, lang)
        if err_response is not None:
            return err_response

        df, reason = _parse_survey_batch_csv(text, worker_ids, columns, likert_min, likert_max, qual_columns)
        if df is not None:
            string_cols = {"worker_id"} | set(qual_columns)
            safe_rows = [
                {k: (str(v) if k in string_cols else int(v)) for k, v in row.items()}
                for row in df.to_dict(orient="records")
            ]
            return jsonify(rows=safe_rows, used_system_prompt=current_system_msg, used_user_prompt=batch_user_msg)
        last_reason = reason
        current_system_msg = system_msg + "\n\n" + _survey_corrective_note(reason, columns, worker_ids, lang)

    return jsonify(error=t("err_ai_gen_bad_batch", lang, detail=last_reason)), 422


@ai_worker_api.post("/ai_worker/finalize_experiment")
def finalize_experiment():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    pool_id = payload.get("pool_id") or ""
    pool = _load_worker_pool(pool_id)
    if pool is None:
        return jsonify(error=t("err_worker_pool_not_found", lang)), 404
    workers_by_id = {w["worker_id"]: w for w in pool["workers"]}

    codebook, cb_err = _validate_codebook(payload.get("codebook"), lang)
    if cb_err:
        return jsonify(error=cb_err), 400
    columns = [item["column"] for item in codebook] if codebook else []
    if not columns:
        return jsonify(error=t("err_ai_gen_missing_codebook", lang)), 400
    likert_columns, qual_columns = _split_codebook_columns(codebook)

    condition_groups = payload.get("condition_groups") or []
    excluded_worker_ids = payload.get("excluded_worker_ids") or []
    rows = payload.get("rows") or []
    if not isinstance(condition_groups, list) or not condition_groups:
        return jsonify(error=t("err_worker_select_invalid_groups", lang)), 400

    worker_id_to_group = {}
    for g in condition_groups:
        for wid in g.get("worker_ids") or []:
            worker_id_to_group[wid] = g
    m = len(worker_id_to_group)
    if not isinstance(rows, list) or len(rows) != m:
        return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400

    all_columns = ["worker_id"] + columns
    col_set = set(all_columns)
    for row in rows:
        if not isinstance(row, dict) or set(row.keys()) != col_set:
            return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
        wid = row.get("worker_id")
        if wid not in worker_id_to_group:
            return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
        for k, v in row.items():
            if k in ("worker_id",) or k in qual_columns:
                if not str(v).strip():
                    return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400
                continue
            if k in likert_columns:
                try:
                    int(v)
                except (TypeError, ValueError):
                    return jsonify(error=t("err_ai_gen_finalize_shape_mismatch", lang)), 400

    full_df = pd.DataFrame(rows, columns=all_columns).set_index("worker_id")
    ordered_ids = list(worker_id_to_group.keys())
    full_df = full_df.loc[ordered_ids]
    indicator_df = full_df[likert_columns].astype(int) if likert_columns else pd.DataFrame(index=full_df.index)

    demo_attributes = list(pool.get("demo_attributes") or [])
    group_labels = {}
    for g in condition_groups:
        label = (g.get("condition_text") or f"Group {g.get('group_index')}").strip()
        label = label[:60] + ("…" if len(label) > 60 else "")
        for wid in g.get("worker_ids") or []:
            group_labels[wid] = label
    condition_group_attr = {
        "name": "Condition Group", "column": "condition_group", "type": "categorical",
        "min": None, "max": None, "options": sorted(set(group_labels.values())),
    }
    demo_attributes_with_condition = demo_attributes + [condition_group_attr]

    demo_cols = [PERSONA_COLUMN, "resp_age", "resp_gender"] + [a["column"] for a in demo_attributes]
    demo_rows = []
    for wid in ordered_ids:
        w = workers_by_id.get(wid, {})
        demo_rows.append({c: w.get(c) for c in demo_cols})
    demo_df = pd.DataFrame(demo_rows, columns=demo_cols)
    for col in qual_columns:
        demo_df[col] = full_df[col].astype(str).str.strip().values
    demo_df["condition_group"] = [group_labels.get(wid) for wid in ordered_ids]
    demo_df.insert(0, "respondent_id", ordered_ids)

    file_id = uuid.uuid4().hex
    dest = os.path.join(_upload_dir(), file_id + ".csv")
    indicator_df.to_csv(dest, index=False)

    meta = {
        "file_id": file_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "codebook": codebook,
        "demographics": pool.get("demographics") or {},
        "demo_attributes": demo_attributes_with_condition,
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "temperature": payload.get("temperature"),
        "likert_scale": payload.get("likert_scale"),
        "n_rows": int(indicator_df.shape[0]),
        "batches": payload.get("batches") or [],
        "construct_theories": {},
        "pool_id": pool_id,
        "condition_groups": [
            {"group_index": g.get("group_index"), "condition_text": g.get("condition_text"), "worker_ids": g.get("worker_ids")}
            for g in condition_groups
        ],
        "excluded_worker_ids": excluded_worker_ids,
        "worker_pool_snapshot": pool["workers"],
    }
    _save_ai_gen_metadata(file_id, demo_df, meta)

    descriptive_stats = _compute_descriptive_stats(indicator_df, demo_df, demo_attributes_with_condition)

    return jsonify(
        file_id=file_id,
        filename="ai_experiment_survey.csv",
        columns=list(indicator_df.columns),
        numeric_columns=list(indicator_df.columns),
        n_rows=int(indicator_df.shape[0]),
        preview=_clean(indicator_df.head(10).to_dict(orient="records")),
        demographics_summary=meta["demographics"],
        demo_attributes=demo_attributes_with_condition,
        descriptive_stats=descriptive_stats,
    )
