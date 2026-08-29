"""Post-SEM machine-learning comparison endpoint. Re-fits the structural
model from the uploaded dataset (same file_id + model pattern as
sensitivity_api.py) to get real construct/factor scores, then trains the
user's selected ML algorithms on those scores via ml_compare.engine and
returns both the SEM path coefficients and the ML comparison side by side.
"""

from __future__ import annotations

import os

import pandas as pd
from flask import Blueprint, jsonify, request, send_file

from cbsem.estimator import CBSEMError, run_cbsem
from cbsem.moderation import run_cbsem_with_moderation
from i18n import get_lang, t
from ml_compare.engine import run_ml_comparison
from ml_compare.registry import ALGORITHM_ORDER, ALGORITHMS
from ml_compare.report import build_excel_report, build_word_report
from ml_compare.source_transparency import ml_compare_sections
from pls.algorithm import run_pls_algorithm
from pls.model import Model, ModelError
from pls.moderation import run_pls_with_moderation

from .api import _read_dataframe, _upload_dir

ml_api = Blueprint("ml_api", __name__, url_prefix="/api")

DEFAULT_K = 5
MIN_K = 2
MAX_K = 10


def _round(v, ndigits: int = 6):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):  # NaN/Inf
        return None
    return round(v, ndigits)


def _round_stat(stat: dict | None) -> dict | None:
    if stat is None:
        return None
    return {"mean": _round(stat["mean"]), "std": _round(stat["std"])}


@ml_api.get("/ml_algorithms")
def ml_algorithms():
    return jsonify(algorithms=[
        {"id": a, "name_key": ALGORITHMS[a].name_key, "task": ALGORITHMS[a].task, "available": ALGORITHMS[a].available}
        for a in ALGORITHM_ORDER
    ])


@ml_api.post("/ml_compare")
def ml_compare():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id")
    model_payload = payload.get("model") or {}
    method = payload.get("method") if payload.get("method") in ("pls", "cbsem") else "pls"
    algorithm_ids = [a for a in (payload.get("algorithms") or []) if isinstance(a, str)]

    try:
        k = int(payload.get("k", DEFAULT_K))
    except (TypeError, ValueError):
        k = DEFAULT_K
    k = max(MIN_K, min(MAX_K, k))

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
        indicators = model.all_indicators()
        df = df[indicators].apply(pd.to_numeric, errors="coerce").dropna()
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_pls_run_error", lang, exc=exc)), 500

    try:
        if method == "cbsem":
            fn = run_cbsem_with_moderation if model.has_interactions() else run_cbsem
            fit = fn(model, df, lang=lang)
            scores_df = fit.factor_scores
            sem_coefficients = {
                (row["source"], row["target"]): _round(row["std"]) for _, row in fit.structural.iterrows()
            }
        else:
            fn = run_pls_with_moderation if model.has_interactions() else run_pls_algorithm
            fit = fn(model, df, lang=lang)
            scores_df = fit.scores
            sem_coefficients = {
                (p.source, p.target): _round(float(fit.path_coefficients.loc[p.source, p.target]))
                for p in model.paths
            }
    except (ValueError, CBSEMError) as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        err_key = "err_cbsem_run_error" if method == "cbsem" else "err_pls_run_error"
        return jsonify(error=t(err_key, lang, exc=exc)), 500

    try:
        targets = run_ml_comparison(
            model, scores_df, sem_coefficients, algorithm_ids, k=k, seed=123, lang=lang,
        )
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_ml_run_error", lang, exc=exc)), 500

    return jsonify(
        method=method,
        k=k,
        algorithms=algorithm_ids,
        source_transparency=[{"key": s.key, "code": s.code} for s in ml_compare_sections(algorithm_ids)],
        targets=[
            {
                "target_id": tr.target_id,
                "target_name": tr.target_name,
                "n_obs": tr.n_obs,
                "predictors": [
                    {"id": p["id"], "name": p["name"], "sem_coefficient": p["sem_coefficient"]}
                    for p in tr.predictors
                ],
                "algorithms": {
                    algo_id: {
                        "task": ao.task,
                        "metrics": {mk: _round_stat(mv) for mk, mv in ao.metrics.items()},
                        "permutation_importance": {
                            pid: _round_stat(stat) for pid, stat in ao.permutation_importance.items()
                        },
                        "native_importance": (
                            {pid: _round(v) for pid, v in ao.native_importance.items()}
                            if ao.native_importance is not None else None
                        ),
                        "n_folds_used": ao.n_folds_used,
                    }
                    for algo_id, ao in tr.algorithms.items()
                },
            }
            for tr in targets
        ],
    )


@ml_api.post("/ml_compare/export/excel")
def ml_compare_export_excel():
    """Builds an .xlsx report directly from an /api/ml_compare response
    payload (sent back by the frontend) -- no re-training, so exporting is
    instant regardless of how many algorithms/folds the original run used."""
    data = request.get_json(force=True, silent=True) or {}
    lang = get_lang(data)
    if not data.get("targets") or not data.get("algorithms"):
        return jsonify(error=t("err_export_missing_data", lang)), 400
    try:
        buf = build_excel_report(data, lang=lang)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_export_excel_error", lang, exc=exc)), 500
    return send_file(
        buf,
        as_attachment=True,
        download_name="ML_Comparison_Report.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@ml_api.post("/ml_compare/export/word")
def ml_compare_export_word():
    data = request.get_json(force=True, silent=True) or {}
    lang = get_lang(data)
    if not data.get("targets") or not data.get("algorithms"):
        return jsonify(error=t("err_export_missing_data", lang)), 400
    try:
        buf = build_word_report(data, lang=lang)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_export_word_error", lang, exc=exc)), 500
    return send_file(
        buf,
        as_attachment=True,
        download_name="ML_Comparison_Report.docx",
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
