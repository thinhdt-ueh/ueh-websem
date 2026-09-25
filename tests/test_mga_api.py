"""Route-level integration tests for PLS-MGA (routes/mga_api.py) -- exercises
the actual HTTP layer the way a browser would, mirroring tests/test_api.py's
own upload+analyze convention.
"""

from __future__ import annotations

import io


def _upload(client, df, lang="en"):
    csv_bytes = df.to_csv(index=False).encode()
    resp = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(csv_bytes), "data.csv"), "lang": lang},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["file_id"]


def _grouped_df(tam_df):
    df = tam_df.copy()
    df["Gender"] = ["male" if i % 2 == 0 else "female" for i in range(len(df))]
    return df


def test_mga_candidates_lists_the_grouping_column_but_not_indicators(client, tam_df, tam_model_json):
    file_id = _upload(client, _grouped_df(tam_df))
    resp = client.post("/api/mga_candidates", json={"file_id": file_id, "model": tam_model_json, "lang": "en"})
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    cols = {c["column"] for c in data["candidates"]}
    assert "Gender" in cols
    assert "PEOU1" not in cols  # an indicator column is never offered as a grouping variable

    gender_entry = next(c for c in data["candidates"] if c["column"] == "Gender")
    values = {o["value"] for o in gender_entry["options"]}
    assert values == {"male", "female"}


def test_mga_candidates_rejects_missing_file(client, tam_model_json):
    resp = client.post("/api/mga_candidates", json={"file_id": "doesnotexist", "model": tam_model_json, "lang": "en"})
    assert resp.status_code == 404


def test_mga_full_round_trip(client, tam_df, tam_model_json):
    file_id = _upload(client, _grouped_df(tam_df))
    resp = client.post("/api/mga", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "column": "Gender", "group_a_values": ["male"], "group_b_values": ["female"],
        "label_a": "Male", "label_b": "Female",
        "n_boot": 150, "n_perm": 150, "seed": 3,
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["group_a"]["label"] == "Male"
    assert data["group_b"]["label"] == "Female"
    assert data["group_a"]["n_obs"] + data["group_b"]["n_obs"] == len(tam_df)
    assert len(data["paths"]) == len(tam_model_json["paths"])
    for row in data["paths"]:
        for key in ("p_parametric", "p_welch", "p_permutation", "p_mga"):
            assert 0 <= row[key] <= 1


def test_mga_rejects_overlapping_group_values(client, tam_df, tam_model_json):
    file_id = _upload(client, _grouped_df(tam_df))
    resp = client.post("/api/mga", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "column": "Gender", "group_a_values": ["male"], "group_b_values": ["male"],
    })
    assert resp.status_code == 400


def test_mga_rejects_missing_column(client, tam_df, tam_model_json):
    file_id = _upload(client, _grouped_df(tam_df))
    resp = client.post("/api/mga", json={
        "file_id": file_id, "model": tam_model_json, "lang": "en",
        "column": "", "group_a_values": ["male"], "group_b_values": ["female"],
    })
    assert resp.status_code == 400


def test_mga_rejects_interaction_model(client, moderation_df, moderation_model_json):
    df = moderation_df.copy()
    df["Gender"] = ["male" if i % 2 == 0 else "female" for i in range(len(df))]
    file_id = _upload(client, df)
    resp = client.post("/api/mga", json={
        "file_id": file_id, "model": moderation_model_json, "lang": "en",
        "column": "Gender", "group_a_values": ["male"], "group_b_values": ["female"],
    })
    assert resp.status_code == 400
