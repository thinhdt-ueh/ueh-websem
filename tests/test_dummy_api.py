"""Tests for /api/dummy/* (k-1 dummy coding of a categorical column, written
back into the same file_id so it can feed the model as ordinary indicators).
"""

from __future__ import annotations

import io
import os

import numpy as np
import pandas as pd

from routes.dummy_api import dummy_column_names

SAMPLE_CSV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sample_data", "tam_sample.csv")


def _upload(client, df, name="data.csv"):
    buf = io.BytesIO()
    if name.endswith(".xlsx"):
        df.to_excel(buf, index=False)
    else:
        buf.write(df.to_csv(index=False).encode())
    buf.seek(0)
    resp = client.post("/api/upload", data={"file": (buf, name), "lang": "en"}, content_type="multipart/form-data")
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["file_id"]


def _data_with_categories(n=120):
    df = pd.read_csv(SAMPLE_CSV).head(n).copy()
    df["Edu"] = [["HighSchool", "Bachelor", "Master"][i % 3] for i in range(len(df))]
    df["Gender"] = [1 if i % 2 else 2 for i in range(len(df))]
    return df


def test_candidates_lists_categorical_columns_with_levels(client):
    fid = _upload(client, _data_with_categories())
    resp = client.get(f"/api/dummy/candidates?file_id={fid}")
    assert resp.status_code == 200
    by_col = {c["column"]: c for c in resp.get_json()["candidates"]}
    assert [lv["value"] for lv in by_col["Edu"]["levels"]] == ["Bachelor", "HighSchool", "Master"]
    assert [lv["value"] for lv in by_col["Gender"]["levels"]] == ["1", "2"]
    assert by_col["Gender"]["is_numeric"] is True


def test_create_k_minus_1_dummies_against_reference(client):
    df = _data_with_categories()
    fid = _upload(client, df)
    resp = client.post("/api/dummy/create", json={"file_id": fid, "column": "Edu", "reference": "HighSchool"})
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert [d["column"] for d in body["created"]] == ["Edu_Bachelor", "Edu_Master"]
    assert "Edu_HighSchool" not in body["columns"]
    assert {"Edu_Bachelor", "Edu_Master"} <= set(body["numeric_columns"])

    # CSV row alignment is exactly preserved.
    saved = pd.read_csv([os.path.join(client.application.config["UPLOAD_DIR"], p)
                         for p in os.listdir(client.application.config["UPLOAD_DIR"]) if p.startswith(fid)][0])
    assert (saved["Edu_Bachelor"] == (df["Edu"] == "Bachelor").astype(int)).all()
    assert (saved["Edu_Master"] == (df["Edu"] == "Master").astype(int)).all()


def test_numeric_coded_category_and_missing_values_stay_missing(client):
    df = _data_with_categories()
    df.loc[[0, 5], "Gender"] = np.nan
    fid = _upload(client, df)
    resp = client.post("/api/dummy/create", json={"file_id": fid, "column": "Gender", "reference": "1"})
    assert resp.status_code == 200, resp.get_json()
    assert [d["column"] for d in resp.get_json()["created"]] == ["Gender_2"]
    updir = client.application.config["UPLOAD_DIR"]
    saved = pd.read_csv(os.path.join(updir, f"{fid}.csv"))
    assert saved["Gender_2"].isna().sum() == 2
    assert saved.loc[1, "Gender_2"] == 0.0  # Gender 1 = reference
    assert saved.loc[2, "Gender_2"] == 1.0


def test_rejects_bad_reference_unknown_column_and_repeat(client):
    fid = _upload(client, _data_with_categories())
    assert client.post("/api/dummy/create", json={"file_id": fid, "column": "Edu", "reference": "PhD"}).status_code == 400
    assert client.post("/api/dummy/create", json={"file_id": fid, "column": "Nope", "reference": "x"}).status_code == 400
    ok = client.post("/api/dummy/create", json={"file_id": fid, "column": "Edu", "reference": "Master"})
    assert ok.status_code == 200
    again = client.post("/api/dummy/create", json={"file_id": fid, "column": "Edu", "reference": "Master", "lang": "en"})
    assert again.status_code == 400
    assert "already exists" in again.get_json()["error"]


def test_unknown_file_id_404(client):
    assert client.get("/api/dummy/candidates?file_id=doesnotexist").status_code == 404


def test_xlsx_upload_is_converted_to_single_csv(client):
    fid = _upload(client, _data_with_categories(60), name="data.xlsx")
    resp = client.post("/api/dummy/create", json={"file_id": fid, "column": "Edu", "reference": "Bachelor"})
    assert resp.status_code == 200, resp.get_json()
    updir = client.application.config["UPLOAD_DIR"]
    assert [p for p in os.listdir(updir) if p.startswith(fid)] == [f"{fid}.csv"]


def test_dummy_as_control_variable_runs_in_pls(client):
    from tests.conftest import TAM_MODEL_JSON

    fid = _upload(client, _data_with_categories())
    client.post("/api/dummy/create", json={"file_id": fid, "column": "Edu", "reference": "HighSchool"})
    model = {
        "constructs": TAM_MODEL_JSON["constructs"] + [
            {"id": "d1", "name": "Edu_Bachelor", "mode": "A", "indicators": ["Edu_Bachelor"]},
            {"id": "d2", "name": "Edu_Master", "mode": "A", "indicators": ["Edu_Master"]},
        ],
        "paths": TAM_MODEL_JSON["paths"] + [{"source": "d1", "target": "int"}, {"source": "d2", "target": "int"}],
    }
    resp = client.post("/api/analyze", json={"file_id": fid, "model": model, "lang": "en"})
    assert resp.status_code == 200, resp.get_json()


def test_dummy_column_names_sanitized_and_unique():
    assert dummy_column_names("Học vấn", ["Đại học", "Sau đại học"]) == ["Học_vấn_Đại_học", "Học_vấn_Sau_đại_học"]
    assert dummy_column_names("G", ["A-B", "A B"]) == ["G_A_B", "G_A_B_2"]
