"""Route-level integration tests: exercises the actual HTTP layer (upload,
analyze, export, and the on-demand PLSpredict/IPMA/sensitivity endpoints)
the way a browser would, rather than calling the pls/cbsem modules directly.
"""

import io

import pandas as pd


def _upload(client, df, lang="en"):
    csv_bytes = df.to_csv(index=False).encode()
    resp = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(csv_bytes), "data.csv"), "lang": lang},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["file_id"]


def test_index_page_loads(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"AI-SEM" in resp.data


def test_sensitivity_page_loads(client):
    resp = client.get("/sensitivity")
    assert resp.status_code == 200


def test_sample_endpoint_serves_both_datasets(client):
    for dataset in ("tam", "moderation"):
        resp = client.get(f"/api/sample?dataset={dataset}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["file_id"]
        assert data["model"]["constructs"]


def test_upload_analyze_export_round_trip(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/analyze", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "bootstrap": {"enabled": True, "n_boot": 100},
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["converged"] is True
    assert len(data["structural"]["paths"]) == len(tam_model_json["paths"])
    assert data["bootstrap"]["valid"] > 0
    assert data["source_transparency"]

    data["lang"] = "en"
    for endpoint, name in (("excel", "PLS-SEM_Report.xlsx"), ("word", "PLS-SEM_Report.docx")):
        r = client.post(f"/api/export/{endpoint}", json=data)
        assert r.status_code == 200
        assert len(r.data) > 0


def test_analyze_runs_with_single_indicator_reflective_construct(client, tam_df, tam_model_json):
    """A single-indicator reflective (Mode A) construct must analyze
    normally end-to-end, not just pass model validation -- Cronbach's alpha/
    composite reliability are correctly omitted for it (undefined for a
    1-item scale), but the construct still gets an outer loading and takes
    part in the structural model like any other."""
    payload = {
        "constructs": [
            dict(c, indicators=c["indicators"][:1]) if c["id"] == "peou" else c
            for c in tam_model_json["constructs"]
        ],
        "paths": tam_model_json["paths"],
    }
    file_id = _upload(client, tam_df)
    resp = client.post("/api/analyze", json={"file_id": file_id, "model": payload, "lang": "en"})
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["converged"] is True
    measurement = data["measurement"]
    assert "PEOU1" in measurement["outer_loadings"]
    assert "peou" not in measurement["cronbachs_alpha"]
    assert "peou" not in measurement["composite_reliability"]


def test_upload_rejects_unsupported_extension(client):
    resp = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(b"not a real file"), "data.txt"), "lang": "en"},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400


def test_analyze_rejects_missing_file_id(client, tam_model_json):
    resp = client.post("/api/analyze", json={"model": tam_model_json, "lang": "en"})
    assert resp.status_code == 400


def test_analyze_cbsem_round_trip(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/analyze_cbsem", json={"file_id": file_id, "model": tam_model_json, "lang": "vi"})
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["converged"] is True
    assert data["fit_indices"]["cfi"] is not None


def test_sensitivity_endpoint(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls", "step": 20,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["points"]
    assert all(p["n"] >= 20 for p in data["points"])
    # p-values are opt-in for PLS-SEM (need an extra bootstrap per step)
    assert data["has_p_values"] is False
    assert all(p["p_values"] == {} for p in data["points"])


def test_sensitivity_endpoint_cbsem_gets_p_values_for_free(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "cbsem", "step": 40,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["has_p_values"] is True
    assert data["n_boot"] is None  # CB-SEM's ML fit needs no bootstrap for this
    converged_points = [p for p in data["points"] if p["converged"]]
    assert converged_points
    assert all(p["p_values"] for p in converged_points)


def test_sensitivity_endpoint_pls_bootstrap_enabled(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls", "step": 60,
        "bootstrap": {"enabled": True, "n_boot": 100},
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["has_p_values"] is True
    assert data["n_boot"] == 100
    converged_points = [p for p in data["points"] if p["converged"]]
    assert converged_points
    assert all(p["p_values"] for p in converged_points)
    for p_value in converged_points[0]["p_values"].values():
        assert p_value is None or 0.0 <= p_value <= 1.0


def test_sensitivity_endpoint_rejects_excessive_bootstrap_budget(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls", "step": 1,
        "bootstrap": {"enabled": True, "n_boot": 5000},
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


# ---------------- sensitivity: fixed-size repeated resampling ----------------

def test_sensitivity_resample_endpoint(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 100, "n_iterations": 30,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["new_n"] == 100
    assert data["n_iterations"] == 30
    assert len(data["points"]) == 30
    assert [p["iteration"] for p in data["points"]] == list(range(1, 31))
    construct_ids = {c["id"] for c in data["constructs"]}
    path_ids = {p["id"] for p in data["paths"]}
    converged_points = [p for p in data["points"] if p["converged"]]
    assert converged_points
    for p in converged_points:
        assert set(p["r_squared"].keys()) == construct_ids
        assert set(p["paths"].keys()) == path_ids
    # p-values are opt-in for PLS-SEM here too (need an extra bootstrap per iteration)
    assert data["has_p_values"] is False
    assert all(p["p_values"] == {} for p in data["points"])


def test_sensitivity_resample_endpoint_cbsem_gets_p_values_for_free(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "cbsem",
        "new_n": 100, "n_iterations": 20,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["has_p_values"] is True
    assert data["n_boot"] is None
    converged_points = [p for p in data["points"] if p["converged"]]
    assert converged_points
    assert all(p["p_values"] for p in converged_points)


def test_sensitivity_resample_endpoint_pls_bootstrap_enabled(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 100, "n_iterations": 15,
        "bootstrap": {"enabled": True, "n_boot": 100},
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["has_p_values"] is True
    assert data["n_boot"] == 100
    converged_points = [p for p in data["points"] if p["converged"]]
    assert converged_points
    assert all(p["p_values"] for p in converged_points)
    for p_value in converged_points[0]["p_values"].values():
        assert p_value is None or 0.0 <= p_value <= 1.0


def test_sensitivity_resample_endpoint_rejects_excessive_bootstrap_budget(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 100, "n_iterations": 500,
        "bootstrap": {"enabled": True, "n_boot": 5000},
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_sensitivity_resample_endpoint_cbsem(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "cbsem",
        "new_n": 100, "n_iterations": 20,
    })
    assert resp.status_code == 200, resp.get_json()
    assert len(resp.get_json()["points"]) == 20


def test_sensitivity_resample_rejects_new_n_too_large(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": len(tam_df), "n_iterations": 20,
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_sensitivity_resample_rejects_new_n_too_small(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 5, "n_iterations": 20,
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_sensitivity_resample_clamps_n_iterations(client, tam_df, tam_model_json):
    from pls.power_analysis import MAX_MC_REPLICATES

    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 100, "n_iterations": 9999,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["n_iterations"] == MAX_MC_REPLICATES
    assert len(data["points"]) == MAX_MC_REPLICATES


def test_sensitivity_resample_clamps_n_iterations_below_minimum(client, tam_df, tam_model_json):
    from pls.power_analysis import MIN_MC_REPLICATES

    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 100, "n_iterations": 1,
    })
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["n_iterations"] == MIN_MC_REPLICATES


# ---------------- sensitivity: per-row original-data export ----------------

def test_sensitivity_export_row_shrink_reproduces_exact_original_rows(client, tam_df, tam_model_json):
    # A column the model never sees, to prove the export returns the
    # original CSV's own columns (for verification), not just the
    # indicators the model happened to fit on.
    df = tam_df.copy()
    df.insert(0, "respondent_id", [f"R{i}" for i in range(len(df))])
    file_id = _upload(client, df)

    sens_resp = client.post("/api/sensitivity", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls", "step": 20,
    })
    assert sens_resp.status_code == 200, sens_resp.get_json()
    points = sens_resp.get_json()["points"]
    row = points[2]
    assert row["step_index"] == 3

    export_resp = client.post("/api/sensitivity_export_row", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "mode": "shrink", "row_index": row["step_index"], "step": 20,
    })
    assert export_resp.status_code == 200, export_resp.get_json()
    assert export_resp.mimetype == "text/csv"
    exported = pd.read_csv(io.BytesIO(export_resp.data))
    assert list(exported.columns) == list(df.columns)
    assert len(exported) == row["n"]
    assert set(exported["respondent_id"]).issubset(set(df["respondent_id"]))

    # Deterministic: replaying the same row again returns the identical rows.
    export_resp2 = client.post("/api/sensitivity_export_row", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "mode": "shrink", "row_index": row["step_index"], "step": 20,
    })
    assert export_resp2.data == export_resp.data


def test_sensitivity_export_row_resample_reproduces_exact_original_rows(client, tam_df, tam_model_json):
    df = tam_df.copy()
    df.insert(0, "respondent_id", [f"R{i}" for i in range(len(df))])
    file_id = _upload(client, df)

    sens_resp = client.post("/api/sensitivity_resample", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "new_n": 100, "n_iterations": 5,
    })
    assert sens_resp.status_code == 200, sens_resp.get_json()
    row = sens_resp.get_json()["points"][3]
    assert row["iteration"] == 4

    export_resp = client.post("/api/sensitivity_export_row", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "mode": "resample", "row_index": row["iteration"], "new_n": 100,
    })
    assert export_resp.status_code == 200, export_resp.get_json()
    exported = pd.read_csv(io.BytesIO(export_resp.data))
    assert list(exported.columns) == list(df.columns)
    assert len(exported) == 100
    assert set(exported["respondent_id"]).issubset(set(df["respondent_id"]))


def test_sensitivity_export_row_rejects_invalid_row_index(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_export_row", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "mode": "shrink", "row_index": 0, "step": 20,
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_sensitivity_export_row_rejects_row_index_beyond_min_n(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/sensitivity_export_row", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "mode": "shrink", "row_index": 9999, "step": 20,
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ml_compare_endpoint(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/ml_compare", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "algorithms": ["linreg", "logreg", "rf"], "k": 3,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert {t["target_id"] for t in data["targets"]} == {"pu", "att", "int"}
    att = next(t for t in data["targets"] if t["target_id"] == "att")
    assert {p["id"] for p in att["predictors"]} == {"peou", "pu"}
    assert all(p["sem_coefficient"] is not None for p in att["predictors"])
    linreg = att["algorithms"]["linreg"]
    assert linreg["task"] == "regression"
    assert "r2" in linreg["metrics"]
    logreg = att["algorithms"]["logreg"]
    assert logreg["task"] == "classification"
    assert "accuracy" in logreg["metrics"]


def test_ml_compare_endpoint_rejects_no_algorithms(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/ml_compare", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls", "algorithms": [],
    })
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_ml_compare_endpoint_cbsem(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/ml_compare", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "cbsem",
        "algorithms": ["linreg", "dtree"], "k": 3,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert {t["target_id"] for t in data["targets"]} == {"pu", "att", "int"}


def test_ml_compare_export_round_trip(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/ml_compare", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "method": "pls",
        "algorithms": ["linreg", "logreg", "rf"], "k": 3,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    data["lang"] = "en"

    for endpoint, name in (("excel", "ML_Comparison_Report.xlsx"), ("word", "ML_Comparison_Report.docx")):
        r = client.post(f"/api/ml_compare/export/{endpoint}", json=data)
        assert r.status_code == 200
        assert len(r.data) > 0


def test_ml_compare_export_rejects_missing_data(client):
    resp = client.post("/api/ml_compare/export/excel", json={"lang": "en"})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_plspredict_endpoint(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/plspredict", json={"file_id": file_id, "model": tam_model_json, "lang": "en"})
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["verdict"] in ("high", "medium", "low", "none")
    assert len(data["predictions"]) == 9  # 3 endogenous constructs x 3 indicators each


def test_ipma_endpoint(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/ipma", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "target": "int",
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert {r["construct_id"] for r in data["rows"]} == {"peou", "pu", "att"}


def test_ipma_rejects_exogenous_target(client, tam_df, tam_model_json):
    file_id = _upload(client, tam_df)
    resp = client.post("/api/ipma", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en", "target": "peou",
    })
    assert resp.status_code == 400


def test_moderation_model_round_trip(client, moderation_df, moderation_model_json):
    file_id = _upload(client, moderation_df)
    resp = client.post("/api/analyze", json={
        "file_id": file_id, "model": moderation_model_json, "lang": "en",
        "bootstrap": {"enabled": True, "n_boot": 100},
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    interaction_paths = [p for p in data["structural"]["paths"] if p["is_interaction"]]
    assert len(interaction_paths) == 1
    assert interaction_paths[0]["coefficient"] > 0
