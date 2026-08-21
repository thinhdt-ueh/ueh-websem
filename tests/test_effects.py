from pls.algorithm import run_pls_algorithm
from pls.effects import total_effects
from pls.model import Model


def _coef_dict(result):
    return {
        s: {t: float(result.path_coefficients.loc[s, t]) for t in result.path_coefficients.columns}
        for s in result.path_coefficients.index
    }


def test_direct_only_edge_has_zero_indirect(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    coef = _coef_dict(result)
    rows = {(e.source, e.target): e for e in total_effects(model, coef)}
    # peou -> pu has no alternate path through the model, so its indirect
    # effect must be exactly zero and total == direct.
    row = rows[("peou", "pu")]
    assert row.indirect == 0.0
    assert row.total == row.direct


def test_mediated_edge_has_nonzero_indirect_effect(tam_model_json, tam_df):
    # peou -> int is mediated via both pu and att (peou has no direct path to
    # int in the TAM sample model), so its indirect effect must be non-zero.
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    coef = _coef_dict(result)
    rows = {(e.source, e.target): e for e in total_effects(model, coef)}
    row = rows[("peou", "int")]
    assert row.direct == 0.0
    assert row.indirect != 0.0
    assert row.total == row.indirect


def test_total_equals_direct_plus_indirect_for_every_edge(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    coef = _coef_dict(result)
    for e in total_effects(model, coef):
        assert abs(e.total - (e.direct + e.indirect)) < 1e-9
