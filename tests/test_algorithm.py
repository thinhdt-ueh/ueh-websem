from pls.algorithm import run_pls_algorithm
from pls.model import Model


def test_pls_converges_on_tam_sample(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    assert result.converged
    assert result.iterations > 0
    assert result.data.shape[0] == 250  # no missing data in the bundled sample


def test_path_coefficients_are_bounded(tam_model_json, tam_df):
    # standardized structural coefficients from well-behaved data shouldn't
    # run away outside a generous [-1, 1] band
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    for p in model.paths:
        coeff = result.path_coefficients.loc[p.source, p.target]
        assert -1.0 <= coeff <= 1.0


def test_r_squared_between_zero_and_one(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    for cid in model.endogenous_ids():
        assert 0.0 <= result.r_squared[cid] <= 1.0


def test_scores_are_standardized(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    for cid in model.constructs:
        assert abs(result.scores[cid].mean()) < 1e-6
        assert abs(result.scores[cid].std(ddof=0) - 1.0) < 1e-6


def test_outer_loadings_are_positive_for_well_specified_blocks(tam_model_json, tam_df):
    # every indicator should load positively on its own (reflective) construct
    # for a correctly specified, non-reverse-coded scale like the TAM sample
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    for c in model.constructs.values():
        for ind in c.indicators:
            assert result.outer_loadings[ind] > 0.5
