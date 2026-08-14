from __future__ import annotations

import math
import os
import uuid

import pandas as pd
from flask import Blueprint, current_app, jsonify, request, send_file

from i18n import get_lang, t
from pls.algorithm import run_pls_algorithm
from pls.blindfolding import run_blindfolding
from pls.bootstrap import MAX_BOOTSTRAP_SAMPLES, MIN_BOOTSTRAP_SAMPLES, run_bootstrap
from pls.metrics import CMB_VIF_THRESHOLD, compute_all_metrics
from pls.model import Model, ModelError
from pls.report import build_excel_report, build_word_report

api = Blueprint("api", __name__, url_prefix="/api")

ALLOWED_EXT = {".csv", ".xlsx", ".xls"}
MAX_ROWS = 5000


def _clean(value):
    """Recursively replace NaN/Inf with None so the payload is valid JSON."""
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 6)
    return value


def series_to_dict(s: pd.Series) -> dict:
    return _clean(s.to_dict())


def df_to_nested_dict(df: pd.DataFrame) -> dict:
    return _clean(df.to_dict())


def _round_or_none(v, ndigits: int = 6):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return round(float(v), ndigits)


def _clean_bootstrap_row(row: dict, key_field: str) -> dict:
    out = {key_field: row[key_field]}
    for field_name in ("original", "mean", "std", "t_stat", "ci_lower", "ci_upper"):
        out[field_name] = _round_or_none(row[field_name])
    out["p_value"] = _round_or_none(row["p_value"], 6)
    out["significant"] = row["p_value"] is not None and row["p_value"] < 0.05
    return out


def _upload_dir() -> str:
    path = current_app.config["UPLOAD_DIR"]
    os.makedirs(path, exist_ok=True)
    return path


def _read_dataframe(path: str) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        return pd.read_csv(path)
    return pd.read_excel(path)


@api.post("/upload")
def upload():
    lang = get_lang({"lang": request.form.get("lang")})
    if "file" not in request.files:
        return jsonify(error=t("err_upload_no_file", lang)), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify(error=t("err_upload_empty_filename", lang)), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify(error=t("err_upload_unsupported_format", lang, ext=ext)), 400

    file_id = uuid.uuid4().hex
    saved_path = os.path.join(_upload_dir(), file_id + ext)
    f.save(saved_path)

    try:
        df = _read_dataframe(saved_path)
    except Exception as exc:  # noqa: BLE001
        os.remove(saved_path)
        return jsonify(error=t("err_upload_read_error", lang, exc=exc)), 400

    if df.empty or df.shape[1] == 0:
        os.remove(saved_path)
        return jsonify(error=t("err_upload_empty_file", lang)), 400

    if df.shape[0] > MAX_ROWS:
        os.remove(saved_path)
        return jsonify(error=t("err_upload_too_many_rows", lang, n=df.shape[0], max=MAX_ROWS)), 400

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    preview = _clean(df.head(10).to_dict(orient="records"))

    return jsonify(
        file_id=file_id,
        filename=f.filename,
        columns=list(df.columns),
        numeric_columns=numeric_cols,
        n_rows=int(df.shape[0]),
        preview=preview,
    )


@api.post("/analyze")
def analyze():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id")
    model_payload = payload.get("model") or {}

    if not file_id:
        return jsonify(error=t("err_analyze_missing_file_id", lang)), 400

    matches = [p for p in os.listdir(_upload_dir()) if p.startswith(file_id)]
    if not matches:
        return jsonify(error=t("err_analyze_file_not_found", lang)), 404
    saved_path = os.path.join(_upload_dir(), matches[0])

    try:
        model = Model.from_json(model_payload, lang=lang)
    except ModelError as exc:
        return jsonify(error=str(exc)), 400

    try:
        df = _read_dataframe(saved_path)
        result = run_pls_algorithm(model, df, lang=lang)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_pls_run_error", lang, exc=exc)), 500

    metrics = compute_all_metrics(result)

    bootstrap_payload = payload.get("bootstrap") or {}
    bootstrap_summary = None
    bootstrap_path_lookup: dict[tuple, dict] = {}
    bootstrap_loadings = None
    bootstrap_weights = None
    if bootstrap_payload.get("enabled"):
        n_boot = bootstrap_payload.get("n_boot", 500)
        try:
            n_boot = int(n_boot)
        except (TypeError, ValueError):
            n_boot = 500
        try:
            boot = run_bootstrap(model, result, n_boot=n_boot)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=t("err_bootstrap_run_error", lang, exc=exc)), 500

        bootstrap_summary = {
            "requested": boot.n_requested,
            "valid": boot.n_valid,
            "clamped_min": MIN_BOOTSTRAP_SAMPLES,
            "clamped_max": MAX_BOOTSTRAP_SAMPLES,
        }
        bootstrap_path_lookup = {(row["source"], row["target"]): row for row in boot.path_stats}
        bootstrap_loadings = [_clean_bootstrap_row(row, "indicator") for row in boot.loading_stats]
        bootstrap_weights = [_clean_bootstrap_row(row, "indicator") for row in boot.weight_stats]

    try:
        bf = run_blindfolding(model, result.data)
        blindfolding_summary = {
            "omission_distance": bf.omission_distance,
            "q_squared": {cid: _round_or_none(v) for cid, v in bf.q_squared.items()},
            "skipped": bf.skipped,
        }
    except Exception as exc:  # noqa: BLE001
        blindfolding_summary = {"omission_distance": None, "q_squared": {}, "skipped": {}, "error": str(exc)}

    path_list = []
    for p in model.paths:
        coeff = float(result.path_coefficients.loc[p.source, p.target])
        f2 = metrics["f_squared"].loc[p.source, p.target]
        f2 = None if pd.isna(f2) else round(float(f2), 6)
        entry = {
            "source": p.source,
            "target": p.target,
            "source_name": model.constructs[p.source].name,
            "target_name": model.constructs[p.target].name,
            "coefficient": round(coeff, 6),
            "f_squared": f2,
        }
        boot_row = bootstrap_path_lookup.get((p.source, p.target))
        if boot_row:
            entry.update(
                bootstrap_mean=_round_or_none(boot_row["mean"]),
                bootstrap_std=_round_or_none(boot_row["std"]),
                t_stat=_round_or_none(boot_row["t_stat"]),
                p_value=_round_or_none(boot_row["p_value"], 6),
                ci_lower=_round_or_none(boot_row["ci_lower"]),
                ci_upper=_round_or_none(boot_row["ci_upper"]),
                significant=(boot_row["p_value"] is not None and boot_row["p_value"] < 0.05),
            )
        path_list.append(entry)

    response = {
        "converged": result.converged,
        "iterations": result.iterations,
        "n_obs": int(result.data.shape[0]),
        "constructs": [
            {
                "id": c.id,
                "name": c.name,
                "mode": c.mode,
                "indicators": c.indicators,
                "is_endogenous": c.id in model.endogenous_ids(),
            }
            for c in model.constructs.values()
        ],
        "measurement": {
            "outer_weights": series_to_dict(result.outer_weights),
            "outer_loadings": series_to_dict(result.outer_loadings),
            "cross_loadings": df_to_nested_dict(result.cross_loadings),
            "cronbachs_alpha": series_to_dict(metrics["cronbachs_alpha"]),
            "rho_a": series_to_dict(metrics["rho_a"]),
            "composite_reliability": series_to_dict(metrics["composite_reliability"]),
            "ave": series_to_dict(metrics["ave"]),
            "outer_vif": series_to_dict(metrics["outer_vif"]),
            "outer_loadings_bootstrap": bootstrap_loadings,
            "outer_weights_bootstrap": bootstrap_weights,
        },
        "discriminant_validity": {
            "fornell_larcker": df_to_nested_dict(metrics["fornell_larcker"]),
            "htmt": df_to_nested_dict(metrics["htmt"]),
        },
        "structural": {
            "paths": path_list,
            "r_squared": series_to_dict(result.r_squared),
            "r_squared_adj": series_to_dict(result.r_squared_adj),
            "inner_vif": df_to_nested_dict(metrics["inner_vif"]),
            "q_squared": blindfolding_summary["q_squared"],
            "q_squared_skipped": blindfolding_summary["skipped"],
            "omission_distance": blindfolding_summary["omission_distance"],
        },
        "bootstrap": bootstrap_summary,
        "common_method_bias": {
            "vif": series_to_dict(metrics["full_collinearity_vif"]),
            "threshold": CMB_VIF_THRESHOLD,
        },
    }
    return jsonify(response)


@api.get("/sample")
def sample():
    """Serve a ready-made demo dataset + model so users can try the app instantly."""
    sample_dir = current_app.config["SAMPLE_DIR"]
    csv_path = os.path.join(sample_dir, "tam_sample.csv")
    df = pd.read_csv(csv_path)

    file_id = uuid.uuid4().hex
    dest = os.path.join(_upload_dir(), file_id + ".csv")
    df.to_csv(dest, index=False)

    model = {
        "constructs": [
            {"id": "peou", "name": "Perceived Ease of Use", "mode": "A",
             "indicators": ["PEOU1", "PEOU2", "PEOU3"]},
            {"id": "pu", "name": "Perceived Usefulness", "mode": "A",
             "indicators": ["PU1", "PU2", "PU3"]},
            {"id": "att", "name": "Attitude", "mode": "A",
             "indicators": ["ATT1", "ATT2", "ATT3"]},
            {"id": "int", "name": "Behavioral Intention", "mode": "A",
             "indicators": ["INT1", "INT2", "INT3"]},
        ],
        "paths": [
            {"source": "peou", "target": "pu"},
            {"source": "peou", "target": "att"},
            {"source": "pu", "target": "att"},
            {"source": "pu", "target": "int"},
            {"source": "att", "target": "int"},
        ],
    }

    return jsonify(
        file_id=file_id,
        filename="tam_sample.csv",
        columns=list(df.columns),
        numeric_columns=list(df.columns),
        n_rows=int(df.shape[0]),
        preview=_clean(df.head(10).to_dict(orient="records")),
        model=model,
    )


@api.post("/export/excel")
def export_excel():
    """Builds an .xlsx report directly from an /api/analyze response payload
    (sent back by the frontend) — no re-estimation, so exporting is instant
    even when the original analysis included bootstrapping. The report's
    language follows `lang` in the payload (the UI's language at export
    time), independent of whatever language the original analysis used."""
    data = request.get_json(force=True, silent=True) or {}
    lang = get_lang(data)
    if not data.get("constructs") or not data.get("structural"):
        return jsonify(error=t("err_export_missing_data", lang)), 400
    try:
        buf = build_excel_report(data, lang=lang)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_export_excel_error", lang, exc=exc)), 500
    return send_file(
        buf,
        as_attachment=True,
        download_name="PLS-SEM_Report.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@api.post("/export/word")
def export_word():
    data = request.get_json(force=True, silent=True) or {}
    lang = get_lang(data)
    if not data.get("constructs") or not data.get("structural"):
        return jsonify(error=t("err_export_missing_data", lang)), 400
    try:
        buf = build_word_report(data, lang=lang)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_export_word_error", lang, exc=exc)), 500
    return send_file(
        buf,
        as_attachment=True,
        download_name="PLS-SEM_Report.docx",
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
