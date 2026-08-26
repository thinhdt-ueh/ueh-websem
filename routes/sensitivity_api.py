"""Sample-size sensitivity analysis: re-runs the same model on progressively
smaller RANDOM subsamples of the original dataset, to help a researcher see
how far n can drop before the structural estimates (path coefficients, R²)
start to move around a lot or the algorithm stops converging — a practical
way to eyeball a minimum viable sample size for a given model, complementing
(not replacing) a proper a-priori power analysis.

At step i (i = 1, 2, 3, ...), n_current = n_total - step*i observations are
drawn at random (no replacement) from the full cleaned dataset and the model
is re-estimated from scratch on just that subsample. This continues until
n_current would drop below the larger of ~20 or what the model actually needs
to run at all (indicator count + 5, same floor `run_pls_algorithm` enforces).
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from cbsem.estimator import CBSEMError, run_cbsem
from cbsem.moderation import run_cbsem_with_moderation
from i18n import get_lang, t
from pls.algorithm import run_pls_algorithm
from pls.bootstrap import MAX_BOOTSTRAP_SAMPLES, MIN_BOOTSTRAP_SAMPLES, run_bootstrap, run_bootstrap_with_moderation
from pls.model import Model, ModelError
from pls.moderation import run_pls_with_moderation

from .api import _read_dataframe, _upload_dir

sensitivity_api = Blueprint("sensitivity_api", __name__, url_prefix="/api")

MIN_OBSERVATIONS_FLOOR = 20
MAX_STEPS = 150
# PLS-SEM p-values need an extra bootstrap *inside* every step (CB-SEM's ML
# fit gives them for free, no extra cost) -- bounds how large
# steps * n_boot can get so opting into significance testing here can't turn
# a normally-fast diagnostic into an open-ended-length request.
MAX_BOOTSTRAP_TOTAL_FITS = 15_000


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


def _run_once(model: Model, method: str, sub_df: pd.DataFrame, lang: str, n_boot: int | None, seed: int):
    """Returns (converged, paths: {"src->tgt": coeff}, p_values: {"src->tgt": p},
    r_squared: {cid: r2}). p_values is populated for every path when method is
    "cbsem" (its ML fit gives p for free) or when method is "pls" and n_boot
    is given (an extra bootstrap run at this step); otherwise empty."""
    if method == "cbsem":
        fn = run_cbsem_with_moderation if model.has_interactions() else run_cbsem
        result = fn(model, sub_df, lang=lang)
        paths = {}
        p_values = {}
        for _, row in result.structural.iterrows():
            key = f"{row['source']}->{row['target']}"
            paths[key] = _round(row["std"])
            p_values[key] = _round(row["p"], 6)
        r_squared = {cid: _round(v) for cid, v in result.r_squared.to_dict().items()}
        return bool(result.converged), paths, p_values, r_squared

    fn = run_pls_with_moderation if model.has_interactions() else run_pls_algorithm
    result = fn(model, sub_df, lang=lang)
    paths = {
        f"{p.source}->{p.target}": _round(float(result.path_coefficients.loc[p.source, p.target]))
        for p in model.paths
    }
    p_values = {}
    if n_boot:
        boot_fn = run_bootstrap_with_moderation if model.has_interactions() else run_bootstrap
        boot = boot_fn(model, result, n_boot=n_boot, seed=seed)
        for row in boot.path_stats:
            p_values[f"{row['source']}->{row['target']}"] = _round(row["p_value"], 6)
    r_squared = {cid: _round(v) for cid, v in result.r_squared.to_dict().items()}
    return bool(result.converged), paths, p_values, r_squared


@sensitivity_api.post("/sensitivity")
def sensitivity():
    payload = request.get_json(force=True, silent=True) or {}
    lang = get_lang(payload)
    file_id = payload.get("file_id")
    model_payload = payload.get("model") or {}
    method = payload.get("method") if payload.get("method") in ("pls", "cbsem") else "pls"

    try:
        step = int(payload.get("step"))
    except (TypeError, ValueError):
        step = 0
    if step < 1:
        return jsonify(error=t("err_sensitivity_invalid_step", lang)), 400

    # p-values are free for CB-SEM (already in its ML fit) but need an extra
    # bootstrap per step for PLS-SEM, so that one's opt-in.
    bootstrap_payload = payload.get("bootstrap") or {}
    n_boot = None
    if method == "pls" and bootstrap_payload.get("enabled"):
        try:
            n_boot = int(bootstrap_payload.get("n_boot", MIN_BOOTSTRAP_SAMPLES))
        except (TypeError, ValueError):
            n_boot = MIN_BOOTSTRAP_SAMPLES
        n_boot = max(MIN_BOOTSTRAP_SAMPLES, min(MAX_BOOTSTRAP_SAMPLES, n_boot))

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

    n_total = len(df)
    min_n = max(MIN_OBSERVATIONS_FLOOR, len(indicators) + 5)
    if n_total <= min_n:
        return jsonify(error=t("err_sensitivity_not_enough_rows", lang, n=n_total, min=min_n)), 400

    if n_boot:
        expected_steps = min(MAX_STEPS, (n_total - min_n) // step + 1)
        total_fits = expected_steps * n_boot
        if total_fits > MAX_BOOTSTRAP_TOTAL_FITS:
            return jsonify(error=t(
                "err_sensitivity_bootstrap_budget_exceeded", lang, total=total_fits, max=MAX_BOOTSTRAP_TOTAL_FITS,
            )), 400

    rng = np.random.default_rng(42)
    points = []
    i = 1
    while i <= MAX_STEPS:
        n_current = n_total - step * i
        if n_current < min_n:
            break
        idx = rng.choice(n_total, size=n_current, replace=False)
        sub_df = df.iloc[idx]
        try:
            converged, paths, p_values, r_squared = _run_once(
                model, method, sub_df, lang, n_boot, seed=1000 + i,
            )
        except (ValueError, CBSEMError):
            points.append({"n": n_current, "converged": False, "paths": {}, "p_values": {}, "r_squared": {}})
            i += 1
            continue
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=t("err_pls_run_error", lang, exc=exc)), 500
        points.append({
            "n": n_current, "converged": converged, "paths": paths, "p_values": p_values, "r_squared": r_squared,
        })
        i += 1

    return jsonify(
        method=method,
        n_total=n_total,
        step=step,
        min_n=min_n,
        has_p_values=(method == "cbsem" or n_boot is not None),
        n_boot=n_boot,
        truncated=i > MAX_STEPS,
        constructs=[
            {"id": c.id, "name": c.name} for c in model.constructs.values() if c.id in model.endogenous_ids()
        ],
        paths=[
            {"id": f"{p.source}->{p.target}", "source_name": model.constructs[p.source].name,
             "target_name": model.constructs[p.target].name}
            for p in model.paths
        ],
        points=points,
    )
