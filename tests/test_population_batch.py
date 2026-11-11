"""Data-calibrated power-analysis populations (pls/population.py), the local
run-size limits (pls/limits.py) and the batch command line (pls/batch.py)."""

from __future__ import annotations

import io
import json
import os

import numpy as np
import pandas as pd
import pytest

from pls.model import Model
from pls.population import build_population
from pls.power_analysis import run_power_analysis

REPRO = os.path.join(os.path.dirname(__file__), "..", "reproducibility", "conclusion-stability-plssem")


def _oliveira():
    with open(os.path.join(REPRO, "data", "pls_model_oliveira2020.json"), encoding="utf-8") as f:
        spec = json.load(f)
    return spec, pd.read_csv(os.path.join(REPRO, "data", "oliveira2020_data.csv"))


def test_calibrated_population_recovers_the_fitted_model():
    """The paper's generator check: a large draw returns every path close to
    the full-sample estimate, on the observed 7-point scales."""
    from pls.algorithm import run_pls_algorithm

    spec, df = _oliveira()
    model = Model.from_json(spec)
    pop = build_population(model, df, "calibrated")
    assert pop.calibration_error < 0.02
    big = pop.draw(np.random.default_rng(0), 60_000)
    for col in pop.indicators:
        assert set(np.unique(big[col])) <= set(np.unique(df[col]))
    fitted, full = run_pls_algorithm(model, big), run_pls_algorithm(model, df)
    for p in spec["paths"]:
        a = fitted.path_coefficients.loc[p["source"], p["target"]]
        b = full.path_coefficients.loc[p["source"], p["target"]]
        assert a == pytest.approx(b, abs=0.015)


def test_saturated_population_reproduces_the_observed_correlations():
    spec, df = _oliveira()
    pop = build_population(Model.from_json(spec), df, "saturated")
    draw = pop.draw(np.random.default_rng(1), 100_000)
    obs = df[pop.indicators].corr().to_numpy()
    assert np.abs(draw.corr().to_numpy() - obs).max() < 0.03


def test_population_rejects_interaction_models(moderation_model_json):
    df = pd.DataFrame(np.random.default_rng(0).integers(1, 8, (100, 40)))
    with pytest.raises(ValueError):
        build_population(Model.from_json(moderation_model_json), df, "calibrated")


def test_power_with_population_ignores_declared_values(tam_df, tam_model_json, monkeypatch):
    monkeypatch.setenv("WEBSEM_WORKERS", "1")
    model = Model.from_json(tam_model_json)
    pop = build_population(model, tam_df, "calibrated")
    points = run_power_analysis(model, {}, {}, [150], n_mc=20, n_boot_inner=100, seed=1, population=pop)
    assert len(points) == len(model.paths)
    assert all(p.n_converged > 0 for p in points)


def test_fit_cap_applies_only_to_hosted_mode(tam_model_json, monkeypatch):
    model = Model.from_json(tam_model_json)
    pv = {(p.source, p.target): 0.3 for p in model.paths}
    lv = {c: 0.8 for c in model.constructs}
    monkeypatch.delenv("AISEM_LOCAL", raising=False)
    with pytest.raises(ValueError):  # 50 sizes x 500 x 301 fits is far beyond the hosted cap
        run_power_analysis(model, pv, lv, list(range(100, 1100, 20)), n_mc=500, n_boot_inner=300)
    from pls import limits
    monkeypatch.setenv("AISEM_LOCAL", "1")
    assert limits.power_fit_cap() is None and limits.max_replicates() > 500


def test_power_route_with_calibrated_population(client, tam_df, tam_model_json, monkeypatch):
    monkeypatch.setenv("WEBSEM_WORKERS", "1")
    resp = client.post("/api/upload", data={"file": (io.BytesIO(tam_df.to_csv(index=False).encode()), "d.csv"), "lang": "en"},
                       content_type="multipart/form-data")
    file_id = resp.get_json()["file_id"]
    body = {"model": tam_model_json, "method": "pls", "n_from": 100, "n_to": 150, "n_step": 50, "n_mc": 20,
            "n_boot_inner": 100, "lang": "en", "population": "calibrated", "file_id": file_id}
    r = client.post("/api/power_analysis", json=body)
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    assert data["population"] == "calibrated" and data["calibration_error"] < 0.05
    assert client.post("/api/power_analysis", json={**body, "file_id": None}).status_code == 400
    assert client.post("/api/power_analysis", json={**body, "population": "bogus"}).status_code == 400


def test_batch_reference_and_subsample(tmp_path, monkeypatch):
    monkeypatch.setenv("WEBSEM_WORKERS", "1")
    from pls import batch

    m = os.path.join(REPRO, "data", "pls_model_oliveira2020.json")
    d = os.path.join(REPRO, "data", "oliveira2020_data.csv")
    batch.main(["reference", "--model", m, "--data", d, "--boot", "200", "--seed", "1", "--out", str(tmp_path)])
    batch.main(["subsample", "--model", m, "--data", d, "--sizes", "250", "--reps", "3", "--boot", "100",
                "--seed", "1000", "--out", str(tmp_path)])
    ref = json.loads((tmp_path / "reference.json").read_text(encoding="utf-8"))
    assert len(ref["paths"]) == 10
    summary = pd.read_csv(tmp_path / "subsample_250_summary.csv")
    assert len(summary) == 10 and summary["n_valid"].eq(3).all()
    assert summary["predicted_share"].between(0, 1).all()


def test_predicted_share_matches_paper_table7():
    """Table 7: compliance (beta -.101, SE .050 rounded; z = 2.04) at n = 250 of 381."""
    from pls.batch import predicted_share

    se = 0.101 / 2.04
    assert predicted_share(-0.101, se, 381, 250, overlapping=True) == pytest.approx(0.30, abs=0.01)
    assert predicted_share(-0.101, se, 381, 250, overlapping=False) == pytest.approx(0.38, abs=0.01)


def test_power_word_report_names_the_population():
    from docx import Document
    from pls.analysis_reports import build_power_word_report

    pts = [{"source": "a", "target": "b", "source_name": "A", "target_name": "B", "n": 200, "power": 0.8,
            "n_converged": 40, "n_replicates": 40, "mean_estimate": 0.3}]
    data = {"method": "pls", "n_mc": 40, "points": pts, "sample_sizes": [200],
            "population": "calibrated", "calibration_error": 0.0101}
    text = "\n".join(p.text for p in Document(build_power_word_report(data, lang="en")).paragraphs)
    assert "calibrated to the data" in text and "Gaussian copula" in text and "0.0101" in text
    text = "\n".join(p.text for p in Document(build_power_word_report({**data, "population": None}, lang="vi")).paragraphs)
    assert "Theo tham số khai báo" in text and "copula tối đa" not in text
