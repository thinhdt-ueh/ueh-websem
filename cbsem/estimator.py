"""CB-SEM (Covariance-Based SEM) estimation via Maximum Likelihood, using the
`semopy` library as the estimation engine.

Unlike PLS-SEM's iterative composite-based algorithm (hand-written in
pls/algorithm.py), CB-SEM fits the model by numerically minimizing a
discrepancy function between the observed and model-implied covariance
matrices (here: MLW, maximum likelihood). This requires a proper ML
optimizer plus asymptotic standard errors from the information matrix —
both are easy to get subtly wrong by hand, so this module delegates the
actual estimation to semopy (a peer-reviewed, published SEM package) and
only handles: translating our Model into lavaan-style syntax, running the
fit, and re-shaping semopy's output into the same kind of pandas structures
`routes/api.py` already knows how to serialize.

CB-SEM only supports reflective (Mode A) measurement — formative blocks
need a MIMIC specification with extra identification constraints that this
app does not build; `Model` objects with a Mode B construct are rejected
before estimation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import semopy

from i18n import DEFAULT_LANG, t
from pls.model import Model, ModelError


class CBSEMError(ValueError):
    """Raised for CB-SEM-specific model or estimation problems."""


@dataclass
class CBSEMResult:
    model: Model
    data: pd.DataFrame  # cleaned raw indicator data actually used
    scaled_data: pd.DataFrame  # standardized indicator data (for alpha/HTMT)
    n_obs: int
    converged: bool
    optimizer_message: str
    n_iterations: int
    fit_indices: dict
    measurement: pd.DataFrame  # index=indicator; columns=construct,unstd,std,se,z,p,is_reference
    structural: pd.DataFrame  # columns=source,target,unstd,std,se,z,p
    r_squared: pd.Series  # index=construct id (endogenous only)
    factor_scores: pd.DataFrame  # index=obs, columns=construct id


def _build_lavaan_syntax(model: Model) -> str:
    lines = []
    for cid, c in model.constructs.items():
        lines.append(f"{cid} =~ " + " + ".join(c.indicators))
    for cid in model.endogenous_ids():
        preds = model.predecessors(cid)
        lines.append(f"{cid} ~ " + " + ".join(preds))
    return "\n".join(lines)


def _standardize(df: pd.DataFrame) -> pd.DataFrame:
    std = df.std(ddof=0)
    return (df - df.mean()) / std.replace(0, 1.0)


def run_cbsem(model: Model, df: pd.DataFrame, lang: str = DEFAULT_LANG) -> CBSEMResult:
    non_reflective = [c.name for c in model.constructs.values() if c.mode != "A"]
    if non_reflective:
        raise CBSEMError(
            t("err_cbsem_formative_not_supported", lang, names=", ".join(non_reflective))
        )

    indicators = model.all_indicators()
    missing = [c for c in indicators if c not in df.columns]
    if missing:
        raise CBSEMError(t("err_missing_indicator_columns", lang, cols=", ".join(missing)))

    data = df[indicators].apply(pd.to_numeric, errors="coerce").dropna()
    if len(data) < len(indicators) + 5:
        raise CBSEMError(t("err_cbsem_insufficient_observations", lang, n=len(data)))

    desc = _build_lavaan_syntax(model)
    sem_model = semopy.Model(desc)
    try:
        fit_res = sem_model.fit(data)
    except Exception as exc:  # noqa: BLE001
        raise CBSEMError(t("err_cbsem_fit_failed", lang, exc=exc)) from exc

    stats_row = semopy.calc_stats(sem_model).iloc[0]
    dof = float(stats_row["DoF"])
    if dof < 0:
        raise CBSEMError(t("err_cbsem_not_identified", lang, dof=f"{dof:.0f}"))

    ins = sem_model.inspect(std_est=True)
    indicator_set = set(indicators)

    # --- measurement model: indicator ~ construct rows ---
    meas_rows = ins[(ins.op == "~") & (ins.lval.isin(indicator_set))]
    measurement = pd.DataFrame(
        {
            "construct": meas_rows["rval"].values,
            "unstd": meas_rows["Estimate"].astype(float).values,
            "std": meas_rows["Est. Std"].astype(float).values,
            "se": pd.to_numeric(meas_rows["Std. Err"], errors="coerce").values,
            "z": pd.to_numeric(meas_rows["z-value"], errors="coerce").values,
            "p": pd.to_numeric(meas_rows["p-value"], errors="coerce").values,
        },
        index=meas_rows["lval"].values,
    )
    measurement["is_reference"] = measurement["se"].isna()
    measurement = measurement.loc[indicators]  # stable, model-defined order

    # --- structural model: construct ~ construct rows ---
    construct_ids = set(model.constructs.keys())
    struct_rows = ins[(ins.op == "~") & (ins.lval.isin(construct_ids)) & (ins.rval.isin(construct_ids))]
    structural = pd.DataFrame(
        {
            "source": struct_rows["rval"].values,
            "target": struct_rows["lval"].values,
            "unstd": struct_rows["Estimate"].astype(float).values,
            "std": struct_rows["Est. Std"].astype(float).values,
            "se": pd.to_numeric(struct_rows["Std. Err"], errors="coerce").values,
            "z": pd.to_numeric(struct_rows["z-value"], errors="coerce").values,
            "p": pd.to_numeric(struct_rows["p-value"], errors="coerce").values,
        }
    )

    # --- R^2: for a standardized endogenous latent, Var=1=R^2 + std. disturbance variance ---
    r_squared = {}
    for cid in model.endogenous_ids():
        row = ins[(ins.lval == cid) & (ins.op == "~~") & (ins.rval == cid)]
        if len(row):
            r_squared[cid] = 1 - float(row["Est. Std"].iloc[0])
    r_squared = pd.Series(r_squared)

    # --- fit indices (chi2/CFI/TLI/RMSEA/... from semopy; SRMR computed manually) ---
    sigma = sem_model.calc_sigma()[0]
    lambda_indicator_order, _ = sem_model.names_lambda
    obs_cov = data[lambda_indicator_order].cov().values

    def _cov2corr(cov: np.ndarray) -> np.ndarray:
        d = np.sqrt(np.diag(cov))
        return cov / np.outer(d, d)

    resid = _cov2corr(obs_cov) - _cov2corr(sigma)
    p = len(lambda_indicator_order)
    srmr = float(np.sqrt(np.mean(resid[np.tril_indices(p)] ** 2)))

    fit_indices = {
        "chi_square": float(stats_row["chi2"]),
        "df": int(dof),
        "chi_square_p_value": float(stats_row["chi2 p-value"]),
        "cfi": float(stats_row["CFI"]),
        "tli": float(stats_row["TLI"]),
        "rmsea": float(stats_row["RMSEA"]),
        "srmr": srmr,
        "gfi": float(stats_row["GFI"]),
        "agfi": float(stats_row["AGFI"]),
        "nfi": float(stats_row["NFI"]),
        "aic": float(stats_row["AIC"]),
        "bic": float(stats_row["BIC"]),
    }

    factor_scores = sem_model.predict_factors(data)
    factor_scores = factor_scores[list(model.constructs.keys())]
    factor_scores.index = data.index

    scaled_data = _standardize(data)

    return CBSEMResult(
        model=model,
        data=data,
        scaled_data=scaled_data,
        n_obs=len(data),
        converged=bool(fit_res.success),
        optimizer_message=str(fit_res.message),
        n_iterations=int(fit_res.n_it),
        fit_indices=fit_indices,
        measurement=measurement,
        structural=structural,
        r_squared=r_squared,
        factor_scores=factor_scores,
    )
