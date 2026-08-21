"""PLSpredict endpoint — run on demand (not part of /api/analyze) since it
refits the model k times and most analyses don't need it every run."""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from i18n import get_lang, t
from pls.model import Model, ModelError
from pls.plspredict import run_plspredict

from .api import _read_dataframe, _round_or_none, _upload_dir

plspredict_api = Blueprint("plspredict_api", __name__, url_prefix="/api")

DEFAULT_K = 10


@plspredict_api.post("/plspredict")
def plspredict():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id")
    model_payload = payload.get("model") or {}
    try:
        k = int(payload.get("k", DEFAULT_K))
    except (TypeError, ValueError):
        k = DEFAULT_K

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
        result = run_plspredict(model, df, k=k, lang=lang)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=t("err_pls_run_error", lang, exc=exc)), 500

    id_to_name = {c.id: c.name for c in model.constructs.values()}
    return jsonify(
        k=result.k,
        n_obs=result.n_obs,
        n_wins=result.n_wins,
        n_total=result.n_total,
        verdict=result.verdict,
        predictions=[
            {
                "indicator": p.indicator,
                "construct_id": p.construct_id,
                "construct_name": id_to_name.get(p.construct_id, p.construct_id),
                "pls_rmse": _round_or_none(p.pls_rmse),
                "pls_mae": _round_or_none(p.pls_mae),
                "lm_rmse": _round_or_none(p.lm_rmse),
                "lm_mae": _round_or_none(p.lm_mae),
                "pls_wins": p.pls_wins,
            }
            for p in result.predictions
        ],
    )
