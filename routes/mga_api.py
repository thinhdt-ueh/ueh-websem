"""PLS-MGA (Multi-Group Analysis): compares path coefficients between two
groups of respondents, reusing the SAME model/data already built in Step
2 -- resolves the saved file exactly like routes/sensitivity_api.py and
routes/ml_api.py do, then delegates the actual statistics to pls/mga.py.

A grouping variable can come from either of two places, depending on
where the data came from:
  - A plain upload/sample: the grouping column sits right alongside the
    indicator columns in the SAME dataframe.
  - AI Lab / AI Lab Experiment generated data: demographic columns
    (resp_gender, custom attributes, condition_group, ...) live in a
    SEPARATE respondents dataframe (see ai_data_gen_api.py's
    `_load_ai_gen_metadata`), joined to the indicator dataframe purely by
    ROW POSITION (both are written at the same time, same length, no
    shared key column) -- never by any column value.
"""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from i18n import get_lang, t
from pls.mga import run_mga
from pls.model import Model, ModelError
from routes.api import _read_dataframe, _upload_dir

mga_api = Blueprint("mga_api", __name__, url_prefix="/api")

# A column with more distinct values than this isn't a sane "group" variable
# for MGA (which compares exactly two groups at a time) -- mirrors the kind
# of UI-sanity ceiling used elsewhere in this codebase (e.g.
# MAX_CUSTOM_DEMO_ATTRS/MAX_CONDITION_GROUPS in the AI Lab features).
MAX_CANDIDATE_OPTIONS = 15


def _load_indicator_and_demo_df(file_id: str):
    """Returns (indicator_df, demo_df_or_None). demo_df is only returned when
    it is safely alignable with indicator_df by row position (AI-generated
    data where both were written together, same length) -- otherwise None,
    so a plain upload just falls back to scanning its own columns.
    """
    if not file_id:
        return None, None
    matches = [p for p in os.listdir(_upload_dir()) if p.startswith(file_id)]
    if not matches:
        return None, None
    saved_path = os.path.join(_upload_dir(), matches[0])
    try:
        indicator_df = _read_dataframe(saved_path)
    except Exception:  # noqa: BLE001
        return None, None

    from routes.ai_data_gen_api import _load_ai_gen_metadata  # local: avoids a module-level cycle
    _meta, demo_df = _load_ai_gen_metadata(file_id)
    if demo_df is not None and len(demo_df) == len(indicator_df):
        indicator_df = indicator_df.reset_index(drop=True)
        demo_df = demo_df.reset_index(drop=True)
    else:
        demo_df = None
    return indicator_df, demo_df


def _candidate_columns(df, exclude_cols: set[str]) -> list[dict]:
    candidates = []
    for col in df.columns:
        if col in exclude_cols:
            continue
        series = df[col].dropna().astype(str).str.strip()
        series = series[series != ""]
        if series.empty:
            continue
        counts = series.value_counts()
        if len(counts) < 2 or len(counts) > MAX_CANDIDATE_OPTIONS:
            continue
        candidates.append({
            "column": col,
            "options": [{"value": v, "count": int(c)} for v, c in counts.items()],
        })
    return candidates


@mga_api.post("/mga_candidates")
def mga_candidates():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id") or ""
    model_payload = payload.get("model") or {}

    try:
        model = Model.from_json(model_payload, lang=lang)
    except ModelError as exc:
        return jsonify(error=str(exc)), 400

    indicator_df, demo_df = _load_indicator_and_demo_df(file_id)
    if indicator_df is None:
        return jsonify(error=t("err_analyze_file_not_found", lang)), 404

    indicators = set(model.all_indicators())
    candidates = _candidate_columns(indicator_df, indicators)
    if demo_df is not None:
        seen = {c["column"] for c in candidates}
        for c in _candidate_columns(demo_df, {"respondent_id", "worker_id"}):
            if c["column"] not in seen:
                candidates.append(c)

    return jsonify(candidates=candidates)


@mga_api.post("/mga")
def mga():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id") or ""
    model_payload = payload.get("model") or {}
    column = payload.get("column") or ""
    group_a_values = payload.get("group_a_values") or []
    group_b_values = payload.get("group_b_values") or []
    label_a = (payload.get("label_a") or "Group A").strip() or "Group A"
    label_b = (payload.get("label_b") or "Group B").strip() or "Group B"

    try:
        n_boot = int(payload.get("n_boot", 500))
    except (TypeError, ValueError):
        n_boot = 500
    try:
        n_perm = int(payload.get("n_perm", 1000))
    except (TypeError, ValueError):
        n_perm = 1000
    try:
        seed = int(payload["seed"]) if payload.get("seed") is not None else None
    except (TypeError, ValueError):
        seed = None

    if not column:
        return jsonify(error=t("err_mga_missing_column", lang)), 400
    if not isinstance(group_a_values, list) or not group_a_values or not isinstance(group_b_values, list) or not group_b_values:
        return jsonify(error=t("err_mga_missing_groups", lang)), 400
    if set(map(str, group_a_values)) & set(map(str, group_b_values)):
        return jsonify(error=t("err_mga_overlapping_groups", lang)), 400

    try:
        model = Model.from_json(model_payload, lang=lang)
    except ModelError as exc:
        return jsonify(error=str(exc)), 400

    indicator_df, demo_df = _load_indicator_and_demo_df(file_id)
    if indicator_df is None:
        return jsonify(error=t("err_analyze_file_not_found", lang)), 404

    if column in indicator_df.columns:
        group_series = indicator_df[column].astype(str).str.strip()
    elif demo_df is not None and column in demo_df.columns:
        group_series = demo_df[column].astype(str).str.strip()
    else:
        return jsonify(error=t("err_mga_missing_column", lang)), 400

    mask_a = group_series.isin([str(v) for v in group_a_values]).values
    mask_b = group_series.isin([str(v) for v in group_b_values]).values
    df_a = indicator_df[mask_a]
    df_b = indicator_df[mask_b]

    try:
        result = run_mga(
            model, df_a, df_b, label_a, label_b,
            n_boot=n_boot, n_perm=n_perm, seed=seed, lang=lang,
        )
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

    return jsonify(
        column=column,
        group_a={"label": result.group_a.label, "n_obs": result.group_a.n_obs, "values": group_a_values},
        group_b={"label": result.group_b.label, "n_obs": result.group_b.n_obs, "values": group_b_values},
        n_boot=result.n_boot,
        n_perm=result.n_perm,
        paths=[
            {
                "source": row.source, "target": row.target,
                "coef_a": row.coef_a, "coef_b": row.coef_b, "diff": row.diff,
                "se_a": row.se_a, "se_b": row.se_b,
                "t_parametric": row.t_parametric, "p_parametric": row.p_parametric,
                "t_welch": row.t_welch, "p_welch": row.p_welch, "df_welch": row.df_welch,
                "p_permutation": row.p_permutation,
                "p_mga": row.p_mga, "significant_mga": row.significant_mga,
            }
            for row in result.paths
        ],
    )
