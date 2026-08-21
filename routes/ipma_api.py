"""IPMA endpoint — run on demand for a chosen target construct."""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from i18n import get_lang, t
from pls.algorithm import run_pls_algorithm
from pls.ipma import run_ipma
from pls.model import Model, ModelError
from pls.moderation import run_pls_with_moderation

from .api import _read_dataframe, _round_or_none, _upload_dir

ipma_api = Blueprint("ipma_api", __name__, url_prefix="/api")


@ipma_api.post("/ipma")
def ipma():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id")
    model_payload = payload.get("model") or {}
    target_id = payload.get("target")

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

    if not target_id or target_id not in model.constructs:
        return jsonify(error=t("err_ipma_invalid_target", lang)), 400
    if not model.predecessors(target_id):
        return jsonify(error=t("err_ipma_target_exogenous", lang)), 400

    try:
        df = _read_dataframe(saved_path)
        fn = run_pls_with_moderation if model.has_interactions() else run_pls_algorithm
        result = fn(model, df, lang=lang)
        rows = run_ipma(model, result, target_id)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_pls_run_error", lang, exc=exc)), 500

    if not rows:
        return jsonify(error=t("err_ipma_no_antecedents", lang)), 400

    return jsonify(
        target=target_id,
        target_name=model.constructs[target_id].name,
        rows=[
            {
                "construct_id": r.construct_id,
                "construct_name": model.constructs[r.construct_id].name,
                "importance": _round_or_none(r.importance),
                "performance": _round_or_none(r.performance),
            }
            for r in rows
        ],
    )
