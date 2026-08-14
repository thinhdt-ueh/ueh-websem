from __future__ import annotations

import os

import pandas as pd
from flask import Blueprint, jsonify, request, send_file

from cbsem.estimator import CBSEMError, run_cbsem
from cbsem.metrics import compute_all_cbsem_metrics
from cbsem.moderation import run_cbsem_with_moderation
from cbsem.report import build_excel_report, build_word_report
from i18n import get_lang, t
from pls.effects import total_effects
from pls.metrics import CMB_VIF_THRESHOLD
from pls.model import Model, ModelError

from .api import _clean, _read_dataframe, _round_or_none, _upload_dir, df_to_nested_dict, series_to_dict

cbsem_api = Blueprint("cbsem_api", __name__, url_prefix="/api")


@cbsem_api.post("/analyze_cbsem")
def analyze_cbsem():
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
        if model.has_interactions():
            result = run_cbsem_with_moderation(model, df, lang=lang)
        else:
            result = run_cbsem(model, df, lang=lang)
    except CBSEMError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_cbsem_run_error", lang, exc=exc)), 500

    metrics = compute_all_cbsem_metrics(result)

    loadings = []
    for ind, row in result.measurement.iterrows():
        loadings.append({
            "indicator": ind,
            "construct": row["construct"],
            "unstd": _round_or_none(row["unstd"]),
            "std": _round_or_none(row["std"]),
            "se": _round_or_none(row["se"]),
            "z": _round_or_none(row["z"]),
            "p": _round_or_none(row["p"], 6),
            "is_reference": bool(row["is_reference"]),
        })

    paths = []
    for _, row in result.structural.iterrows():
        p_value = row["p"]
        paths.append({
            "source": row["source"],
            "target": row["target"],
            "source_name": model.constructs[row["source"]].name,
            "target_name": model.constructs[row["target"]].name,
            "unstd": _round_or_none(row["unstd"]),
            "std": _round_or_none(row["std"]),
            "se": _round_or_none(row["se"]),
            "z": _round_or_none(row["z"]),
            "p": _round_or_none(p_value, 6),
            "significant": bool(pd.notna(p_value) and p_value < 0.05),
            "is_interaction": model.constructs[row["source"]].mode == "I",
        })

    coef: dict[str, dict[str, float]] = {}
    for _, row in result.structural.iterrows():
        coef.setdefault(row["source"], {})[row["target"]] = float(row["std"])
    total_effects_list = [
        {
            "source": e.source, "target": e.target,
            "source_name": model.constructs[e.source].name, "target_name": model.constructs[e.target].name,
            "direct": round(e.direct, 6), "indirect": round(e.indirect, 6), "total": round(e.total, 6),
        }
        for e in total_effects(model, coef)
    ]

    response = {
        "method": "cbsem",
        "converged": result.converged,
        "optimizer_message": result.optimizer_message,
        "iterations": result.n_iterations,
        "n_obs": result.n_obs,
        "constructs": [
            {
                "id": c.id,
                "name": c.name,
                "mode": c.mode,
                "indicators": c.indicators,
                "is_endogenous": c.id in model.endogenous_ids(),
                "interaction_of": c.interaction_of,
            }
            for c in model.constructs.values()
        ],
        "has_moderation": model.has_interactions(),
        "fit_indices": _clean(result.fit_indices),
        "measurement": {
            "loadings": loadings,
            "cronbachs_alpha": series_to_dict(metrics["cronbachs_alpha"]),
            "composite_reliability": series_to_dict(metrics["composite_reliability"]),
            "ave": series_to_dict(metrics["ave"]),
        },
        "discriminant_validity": {
            "fornell_larcker": df_to_nested_dict(metrics["fornell_larcker"]),
            "htmt": df_to_nested_dict(metrics["htmt"]),
        },
        "structural": {
            "paths": paths,
            "total_effects": total_effects_list,
            "r_squared": series_to_dict(result.r_squared),
        },
        "common_method_bias": {
            "vif": series_to_dict(metrics["full_collinearity_vif"]),
            "threshold": CMB_VIF_THRESHOLD,
        },
    }
    return jsonify(response)


@cbsem_api.post("/export_cbsem/excel")
def export_cbsem_excel():
    data = request.get_json(force=True, silent=True) or {}
    lang = get_lang(data)
    if not data.get("constructs") or not data.get("structural"):
        return jsonify(error=t("err_export_missing_data", lang)), 400
    try:
        buf = build_excel_report(data, lang=lang)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_export_excel_error", lang, exc=exc)), 500
    return send_file(
        buf, as_attachment=True, download_name="CB-SEM_Report.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@cbsem_api.post("/export_cbsem/word")
def export_cbsem_word():
    data = request.get_json(force=True, silent=True) or {}
    lang = get_lang(data)
    if not data.get("constructs") or not data.get("structural"):
        return jsonify(error=t("err_export_missing_data", lang)), 400
    try:
        buf = build_word_report(data, lang=lang)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_export_word_error", lang, exc=exc)), 500
    return send_file(
        buf, as_attachment=True, download_name="CB-SEM_Report.docx",
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
