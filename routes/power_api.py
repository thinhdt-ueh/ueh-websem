"""Monte Carlo power analysis endpoint — purely simulation-driven, so unlike
every other analysis endpoint in this app it never reads the uploaded
dataset (no file_id needed), only the model structure plus the population
parameters (expected path coefficients / loadings) the user declares.

Dispatches on `method` ("pls" or "cbsem", default "pls") to the matching
engine — pls.power_analysis (bootstrap-based significance, needs
n_boot_inner) or cbsem.power_analysis (analytic ML significance, no
bootstrap, no n_boot_inner) — mirroring the same method-dispatch pattern
already used by routes/sensitivity_api.py."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from cbsem.power_analysis import run_power_analysis as run_power_analysis_cbsem
from i18n import get_lang, t
from pls.model import Model, ModelError
from pls.power_analysis import (
    MAX_SAMPLE_SIZE_POINTS,
    MAX_BOOT_INNER,
    MAX_MC_REPLICATES,
    MIN_BOOT_INNER,
    MIN_MC_REPLICATES,
    run_power_analysis as run_power_analysis_pls,
)

power_api = Blueprint("power_api", __name__, url_prefix="/api")

DEFAULT_N_MC_PLS = 30
DEFAULT_N_MC_CBSEM = 100
DEFAULT_N_BOOT_INNER = 100


def _parse_int(payload: dict, key: str, default: int) -> int | None:
    try:
        return int(payload.get(key, default))
    except (TypeError, ValueError):
        return None


@power_api.post("/power_analysis")
def power_analysis():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    method = payload.get("method") if payload.get("method") in ("pls", "cbsem") else "pls"
    model_payload = payload.get("model") or {}

    try:
        model = Model.from_json(model_payload, lang=lang)
    except ModelError as exc:
        return jsonify(error=str(exc)), 400

    n_from = _parse_int(payload, "n_from", 0)
    n_to = _parse_int(payload, "n_to", 0)
    n_step = _parse_int(payload, "n_step", 0)
    if not n_from or not n_to or not n_step or n_from >= n_to or n_step < 1:
        return jsonify(error=t("err_power_invalid_range", lang)), 400

    sample_sizes = list(range(n_from, n_to + 1, n_step))
    if len(sample_sizes) > MAX_SAMPLE_SIZE_POINTS:
        return jsonify(error=t("err_power_too_many_points", lang, max=MAX_SAMPLE_SIZE_POINTS)), 400

    default_n_mc = DEFAULT_N_MC_CBSEM if method == "cbsem" else DEFAULT_N_MC_PLS
    n_mc = _parse_int(payload, "n_mc", default_n_mc) or default_n_mc
    n_mc = max(MIN_MC_REPLICATES, min(MAX_MC_REPLICATES, n_mc))

    n_boot_inner = None
    if method == "pls":
        n_boot_inner = _parse_int(payload, "n_boot_inner", DEFAULT_N_BOOT_INNER) or DEFAULT_N_BOOT_INNER
        n_boot_inner = max(MIN_BOOT_INNER, min(MAX_BOOT_INNER, n_boot_inner))

    raw_path_values = payload.get("path_values") or {}
    path_values: dict[tuple[str, str], float] = {}
    for key, val in raw_path_values.items():
        if "->" not in key:
            continue
        src, tgt = key.split("->", 1)
        try:
            path_values[(src, tgt)] = float(val)
        except (TypeError, ValueError):
            return jsonify(error=t("err_power_missing_path_value", lang, src=src, tgt=tgt)), 400

    raw_loading_values = payload.get("loading_values") or {}
    loading_values: dict[str, float] = {}
    for cid, val in raw_loading_values.items():
        try:
            loading_values[cid] = float(val)
        except (TypeError, ValueError):
            return jsonify(error=t("err_power_missing_loading", lang, name=cid)), 400

    try:
        if method == "cbsem":
            points = run_power_analysis_cbsem(
                model, path_values, loading_values, sample_sizes, n_mc=n_mc, seed=42, lang=lang,
            )
        else:
            points = run_power_analysis_pls(
                model, path_values, loading_values, sample_sizes,
                n_mc=n_mc, n_boot_inner=n_boot_inner, seed=42, lang=lang,
            )
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:  # noqa: BLE001
        err_key = "err_cbsem_run_error" if method == "cbsem" else "err_pls_run_error"
        return jsonify(error=t(err_key, lang, exc=exc)), 500

    id_to_name = {c.id: c.name for c in model.constructs.values()}
    return jsonify(
        method=method,
        n_mc=n_mc,
        n_boot_inner=n_boot_inner,
        sample_sizes=sample_sizes,
        points=[
            {
                "n": p.n,
                "source": p.source,
                "target": p.target,
                "source_name": id_to_name.get(p.source, p.source),
                "target_name": id_to_name.get(p.target, p.target),
                "power": round(p.power, 4),
                "n_converged": p.n_converged,
                "n_replicates": p.n_replicates,
                "mean_estimate": round(p.mean_estimate, 6) if p.mean_estimate is not None else None,
            }
            for p in points
        ],
    )
