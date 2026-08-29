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
    assert b"WebSEM" in resp.data


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
