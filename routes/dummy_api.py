"""Dummy (0/1) coding for categorical columns, so a categorical variable
(gender, education level, experimental group, ...) can enter the PLS-SEM /
CB-SEM model as ordinary numeric indicators -- e.g. single-indicator
constructs used as control variables or as a binary independent variable.

Standard k-1 (treatment) coding: a column with k distinct levels yields
k-1 new 0/1 columns, one per non-reference level; the reference level is
the all-zero baseline every dummy's coefficient is interpreted against.
Missing source values stay missing (NaN) in every dummy, so the existing
listwise handling of incomplete rows applies unchanged.

Works for ANY dataset (plain upload, sample data, AI-generated): the new
columns are written back into the SAME file_id, always as `{file_id}.csv`
(an uploaded .xlsx/.xls is converted once, and the original removed, so
the prefix-match file lookup every analysis route uses keeps resolving to
exactly one file) -- Step 2's indicator picker and every analysis route
pick the new columns up with no other change.
"""

from __future__ import annotations

import os
import re

import pandas as pd
from flask import Blueprint, jsonify, request

from i18n import get_lang, t
from routes.api import _clean, _read_dataframe, _upload_dir

dummy_api = Blueprint("dummy_api", __name__, url_prefix="/api")

MIN_LEVELS = 2
MAX_LEVELS = 12


def _find_data_file(file_id: str) -> str | None:
    if not file_id:
        return None
    matches = [p for p in os.listdir(_upload_dir()) if p.startswith(file_id)]
    return os.path.join(_upload_dir(), matches[0]) if matches else None


def _level_key(value) -> str:
    """Canonical string for one category level: numeric codes read back as
    floats (e.g. 2.0 after a NaN forced the column to float) must still
    match the "2" the user saw and picked."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _column_levels(series: pd.Series) -> list[dict]:
    keys = series.dropna().map(_level_key)
    counts = keys.value_counts()
    levels = list(counts.index)
    try:
        levels.sort(key=float)
    except ValueError:
        levels.sort()
    return [{"value": lv, "count": int(counts[lv])} for lv in levels]


def _safe_name_part(text: str) -> str:
    part = re.sub(r"\W+", "_", text, flags=re.UNICODE).strip("_")
    return part or "x"


def dummy_column_names(column: str, levels: list[str]) -> list[str]:
    """`{column}_{level}` for each level, sanitized to word characters and
    de-duplicated (two levels like "A-B" and "A B" would otherwise collide)."""
    base = _safe_name_part(column)
    out: list[str] = []
    for lv in levels:
        name = f"{base}_{_safe_name_part(lv)}"
        candidate, i = name, 2
        while candidate in out:
            candidate = f"{name}_{i}"
            i += 1
        out.append(candidate)
    return out


@dummy_api.get("/dummy/candidates")
def dummy_candidates():
    lang = get_lang({"lang": request.args.get("lang")})
    path = _find_data_file(request.args.get("file_id") or "")
    if not path:
        return jsonify(error=t("err_analyze_file_not_found", lang)), 404
    df = _read_dataframe(path)
    candidates = []
    for col in df.columns:
        levels = _column_levels(df[col])
        if MIN_LEVELS <= len(levels) <= MAX_LEVELS:
            candidates.append({
                "column": str(col),
                "levels": levels,
                "n_missing": int(df[col].isna().sum()),
                "is_numeric": bool(pd.api.types.is_numeric_dtype(df[col])),
            })
    return jsonify(candidates=candidates, max_levels=MAX_LEVELS)


@dummy_api.post("/dummy/create")
def dummy_create():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id") or ""
    column = payload.get("column") or ""
    reference = payload.get("reference")

    path = _find_data_file(file_id)
    if not path:
        return jsonify(error=t("err_analyze_file_not_found", lang)), 404
    df = _read_dataframe(path)
    if column not in df.columns:
        return jsonify(error=t("err_dummy_bad_column", lang, name=column)), 400

    levels = [lv["value"] for lv in _column_levels(df[column])]
    if not MIN_LEVELS <= len(levels) <= MAX_LEVELS:
        return jsonify(error=t("err_dummy_level_count", lang, name=column, min=MIN_LEVELS, max=MAX_LEVELS)), 400
    reference = _level_key(reference) if reference is not None else ""
    if reference not in levels:
        return jsonify(error=t("err_dummy_bad_reference", lang)), 400

    dummy_levels = [lv for lv in levels if lv != reference]
    new_names = dummy_column_names(column, dummy_levels)
    clashes = [n for n in new_names if n in df.columns]
    if clashes:
        return jsonify(error=t("err_dummy_column_exists", lang, names=", ".join(clashes))), 400

    keys = df[column].map(lambda v: None if pd.isna(v) else _level_key(v))
    missing = keys.isna()
    for lv, name in zip(dummy_levels, new_names):
        dummy = (keys == lv).astype(float)
        dummy[missing] = float("nan")
        df[name] = dummy if missing.any() else dummy.astype(int)

    csv_path = os.path.join(_upload_dir(), f"{file_id}.csv")
    df.to_csv(csv_path, index=False)
    if os.path.abspath(path) != os.path.abspath(csv_path):
        os.remove(path)

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    return jsonify(
        columns=list(df.columns),
        numeric_columns=numeric_cols,
        n_rows=int(df.shape[0]),
        preview=_clean(df.head(10).to_dict(orient="records")),
        created=[{"column": n, "level": lv} for n, lv in zip(new_names, dummy_levels)],
        reference=reference,
        source_column=column,
    )
