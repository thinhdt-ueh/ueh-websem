"""Two-stage moderation analysis for CB-SEM (see pls/moderation.py for the
shared methodology notes). Stage 1 is an ordinary CB-SEM (ML) fit of the
model with interaction constructs removed. Stage 2 only touches the specific
structural equations an interaction construct actually feeds into: those get
re-estimated by OLS on the (standardized) factor + interaction scores, with
classical OLS standard errors/t/p — the textbook-correct inference for that
regression. Every other equation keeps its original Maximum Likelihood
estimate from stage 1 untouched, since re-deriving it from factor scores
would silently trade an exact joint ML estimate for a less accurate
factor-score approximation it never needed.
"""

from __future__ import annotations

import pandas as pd

from i18n import DEFAULT_LANG
from pls.model import Model
from pls.moderation import compute_interaction_scores, ols_with_inference

from .estimator import CBSEMResult, run_cbsem


def run_cbsem_with_moderation(model: Model, df: pd.DataFrame, lang: str = DEFAULT_LANG) -> CBSEMResult:
    base_model = Model.from_json(model.base_model_json(), lang=lang)
    stage1 = run_cbsem(base_model, df, lang=lang)

    interaction_scores = compute_interaction_scores(model, stage1.factor_scores)
    full_scores = pd.concat([stage1.factor_scores, interaction_scores], axis=1)

    interaction_ids = set(model.interaction_ids())
    targets_to_redo = [
        cid for cid in model.endogenous_ids()
        if set(model.predecessors(cid)) & interaction_ids
    ]

    structural_rows = [
        row.to_dict() for _, row in stage1.structural.iterrows() if row["target"] not in targets_to_redo
    ]
    r_squared = stage1.r_squared.drop(
        labels=[t for t in targets_to_redo if t in stage1.r_squared.index], errors="ignore"
    ).to_dict()

    for target in targets_to_redo:
        preds = model.predecessors(target)
        X = full_scores[preds].values
        y = full_scores[target].values
        beta, se, t_stat, p_value, r2, _r2_adj = ols_with_inference(X, y)
        for i, p in enumerate(preds):
            structural_rows.append({
                "source": p, "target": target,
                "unstd": float(beta[i]), "std": float(beta[i]),
                "se": float(se[i]), "z": float(t_stat[i]), "p": float(p_value[i]),
            })
        r_squared[target] = r2

    structural_df = pd.DataFrame(structural_rows, columns=["source", "target", "unstd", "std", "se", "z", "p"])

    return CBSEMResult(
        model=model,  # the FULL model (with interaction constructs) for downstream metrics
        data=stage1.data,
        scaled_data=stage1.scaled_data,
        n_obs=stage1.n_obs,
        converged=stage1.converged,
        optimizer_message=stage1.optimizer_message,
        n_iterations=stage1.n_iterations,
        fit_indices=stage1.fit_indices,
        measurement=stage1.measurement,
        structural=structural_df,
        r_squared=pd.Series(r_squared),
        factor_scores=full_scores,
    )
