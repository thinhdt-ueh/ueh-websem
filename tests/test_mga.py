from __future__ import annotations

import pytest

from pls.mga import MIN_GROUP_OBS, run_mga
from pls.model import Model


def _split(df, frac=0.5):
    cut = int(len(df) * frac)
    return df.iloc[:cut].reset_index(drop=True), df.iloc[cut:].reset_index(drop=True)


def test_run_mga_basic_shape(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    df_a, df_b = _split(tam_df)
    result = run_mga(model, df_a, df_b, "Group A", "Group B", n_boot=150, n_perm=150, seed=1)

    assert result.group_a.label == "Group A"
    assert result.group_b.label == "Group B"
    assert result.group_a.n_obs == len(df_a)
    assert result.group_b.n_obs == len(df_b)
    assert len(result.paths) == len(model.paths)

    for row in result.paths:
        assert row.se_a is not None and row.se_a >= 0
        assert row.se_b is not None and row.se_b >= 0
        assert row.p_parametric is not None and 0 <= row.p_parametric <= 1
        assert row.p_welch is not None and 0 <= row.p_welch <= 1
        assert row.df_welch is not None and row.df_welch > 0
        assert row.p_permutation is not None and 0 <= row.p_permutation <= 1
        assert row.p_mga is not None and 0 <= row.p_mga <= 1
        assert row.significant_mga == (row.p_mga < 0.05 or row.p_mga > 0.95)


def test_run_mga_rejects_interaction_model(moderation_model_json, moderation_df):
    model = Model.from_json(moderation_model_json)
    df_a, df_b = _split(moderation_df)
    with pytest.raises(ValueError, match="(?i)interaction|moderation"):
        run_mga(model, df_a, df_b, "A", "B", n_boot=100, n_perm=100)


def test_run_mga_rejects_small_group(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    df_a, df_b = _split(tam_df)
    too_small = df_a.iloc[: MIN_GROUP_OBS - 1]
    with pytest.raises(ValueError):
        run_mga(model, too_small, df_b, "A", "B", n_boot=100, n_perm=100)


def test_run_mga_clamps_n_boot_and_n_perm(tam_model_json, tam_df, monkeypatch):
    # Exercises the clamping arithmetic itself, not the real MIN/MAX bounds
    # (5000 permutations x 2 refits each would make this single test take
    # ~55s -- monkeypatching the module's own constants down keeps the
    # logic under test identical while running in a fraction of a second).
    import pls.mga as mga

    monkeypatch.setattr(mga, "MIN_BOOT_SAMPLES", 20)
    monkeypatch.setattr(mga, "MAX_BOOT_SAMPLES", 30)
    monkeypatch.setattr(mga, "MIN_PERMUTATIONS", 20)
    monkeypatch.setattr(mga, "MAX_PERMUTATIONS", 30)

    model = Model.from_json(tam_model_json)
    df_a, df_b = _split(tam_df)
    result = run_mga(model, df_a, df_b, "A", "B", n_boot=1, n_perm=1, seed=2)
    assert result.n_boot == 20
    assert result.n_perm == 20

    result2 = run_mga(model, df_a, df_b, "A", "B", n_boot=999999, n_perm=999999, seed=2)
    assert result2.n_boot == 30
    assert result2.n_perm == 30


def test_run_mga_same_underlying_data_gives_zero_diff_and_central_mga_pvalue(tam_model_json, tam_df):
    # Comparing a group against an identical copy of itself: the POINT
    # ESTIMATE difference must be exactly zero (both fit the same rows),
    # and the Henseler PLS-MGA p-value -- built from two independently
    # resampled bootstrap distributions of the SAME underlying population --
    # should land somewhere in the middle of (0, 1), not at an extreme.
    model = Model.from_json(tam_model_json)
    result = run_mga(model, tam_df, tam_df.copy(), "A", "B", n_boot=300, n_perm=100, seed=5)
    for row in result.paths:
        assert row.diff == pytest.approx(0.0, abs=1e-9)
        assert 0.2 < row.p_mga < 0.8


def test_path_pairs_match_model_paths_count(tam_model_json):
    from pls.mga import _path_pairs

    model = Model.from_json(tam_model_json)
    pairs = _path_pairs(model)
    assert len(pairs) == len(model.paths)
    assert set(pairs) == {(p.source, p.target) for p in model.paths}
