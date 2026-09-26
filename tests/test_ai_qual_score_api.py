"""Tests for /api/ai_qual_score/* (AI-rater: scores a qualitative column
into a new Likert indicator, merged into the existing indicator dataset).
Never calls a real provider's API -- monkeypatches
`routes.ai_data_gen_api._call_openai`, matching every other AI-calling
route in this app (see tests/test_ai_data_gen_api.py, tests/test_ai_worker_api.py).
"""

from __future__ import annotations

import routes.ai_data_gen_api as ai_data_gen_api


def _plain_rows_with_qual(n, likert_columns=("PU1", "PU2"), qual_column="OPEN1"):
    out = []
    for i in range(n):
        row = {"persona_description": f"Respondent {i}: a consistent persona"}
        row.update({c: 4 for c in likert_columns})
        row[qual_column] = f"Free-text answer from respondent {i}."
        row["resp_age"] = 30
        row["resp_gender"] = "male" if i % 2 == 0 else "female"
        out.append(row)
    return out


def _plain_codebook(likert_columns=("PU1", "PU2"), qual_column="OPEN1"):
    codebook = [{"column": c, "question_text": f"Question about {c}"} for c in likert_columns]
    codebook.append({"column": qual_column, "question_text": "What would you improve?", "type": "qualitative"})
    return codebook


def _finalize_plain_ai_lab(client, n=30, likert_columns=("PU1", "PU2"), qual_column="OPEN1"):
    """Creates a real, persisted plain-AI-Lab file_id (via /ai_data_gen/finalize)
    carrying one qualitative column, and returns its file_id."""
    columns = list(likert_columns) + [qual_column]
    resp = client.post("/api/ai_data_gen/finalize", json={
        "filename": "synthetic.csv",
        "columns": columns,
        "rows": _plain_rows_with_qual(n, likert_columns, qual_column),
        "codebook": _plain_codebook(likert_columns, qual_column),
        "demographics": {}, "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7,
        "likert_scale": 5, "batches": [], "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["file_id"]


def _batch_payload(file_id, **overrides):
    payload = {
        "provider": "openai", "api_key": "sk-test-123", "model": "gpt-4o-mini", "temperature": 0.7,
        "file_id": file_id, "qual_column": "OPEN1",
        "rubric_prompt": "Score 1 (very negative) to 5 (very positive) sentiment.",
        "likert_scale": 5, "start_row": 1, "end_row": 5, "lang": "en",
    }
    payload.update(overrides)
    return payload


def _score_csv(ids, score=4):
    return "\n".join(["respondent_id,score"] + [f"{rid},{score}" for rid in ids])


# ---------------- /columns ----------------

def test_list_columns_returns_qualitative_columns_only(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    resp = client.get(f"/api/ai_qual_score/columns?file_id={file_id}")
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["qualitative_columns"] == ["OPEN1"]
    assert data["is_ai_generated"] is True


def test_list_columns_still_includes_already_scored_columns(client):
    # Scoring is repeatable (a different rubric, a second rater pass, ...),
    # not one-shot -- the source column must stay selectable afterward.
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    finalize_resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids))
    assert finalize_resp.status_code == 200, finalize_resp.get_json()
    resp = client.get(f"/api/ai_qual_score/columns?file_id={file_id}")
    assert resp.get_json()["qualitative_columns"] == ["OPEN1"]


def test_can_score_the_same_qualitative_column_a_second_time(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    first = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids, score=3, new_column="OPEN1_score"))
    assert first.status_code == 200, first.get_json()
    second = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids, score=5, new_column="OPEN1_score_v2"))
    assert second.status_code == 200, second.get_json()
    data = second.get_json()
    assert "OPEN1_score" in data["numeric_columns"]
    assert "OPEN1_score_v2" in data["numeric_columns"]


def test_list_columns_missing_metadata_returns_empty_not_error(client):
    # A plain (non-AI-generated) file_id is the common case checked on every
    # Step 2 entry -- reported as "nothing to score" (200, empty), not an error.
    resp = client.get("/api/ai_qual_score/columns?file_id=nope")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["qualitative_columns"] == []
    assert data["is_ai_generated"] is False


# ---------------- /batch ----------------

def test_batch_scoring_round_trip(client, monkeypatch):
    file_id = _finalize_plain_ai_lab(client, n=30)
    expected_ids = [f"R{i + 1:04d}" for i in range(5)]
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: _score_csv(expected_ids, score=4))
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(file_id))
    assert resp.status_code == 200, resp.get_json()
    rows = resp.get_json()["rows"]
    assert {r["respondent_id"] for r in rows} == set(expected_ids)
    assert all(r["score"] == 4 for r in rows)


def test_batch_retries_on_malformed_then_succeeds(client, monkeypatch):
    file_id = _finalize_plain_ai_lab(client, n=30)
    expected_ids = [f"R{i + 1:04d}" for i in range(5)]
    calls = []

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        calls.append(1)
        if len(calls) == 1:
            return "not a csv"
        return _score_csv(expected_ids, score=3)

    monkeypatch.setattr(ai_data_gen_api, "_call_openai", fake_call)
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(file_id))
    assert resp.status_code == 200, resp.get_json()
    assert len(calls) == 2


def test_batch_rejects_score_out_of_range(client, monkeypatch):
    file_id = _finalize_plain_ai_lab(client, n=30)
    expected_ids = [f"R{i + 1:04d}" for i in range(5)]
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: _score_csv(expected_ids, score=9))
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(file_id))
    assert resp.status_code == 422


def test_batch_rejects_missing_rubric(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(file_id, rubric_prompt=""))
    assert resp.status_code == 400


def test_batch_rejects_missing_api_key(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(file_id, api_key=""))
    assert resp.status_code == 400


def test_batch_rejects_file_with_no_ai_gen_metadata(client):
    # A plain upload (no AI-gen metadata at all) must be rejected, not
    # silently scored on garbage -- confirmed scope is AI-generated data only.
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload("some-plain-upload-id"))
    assert resp.status_code == 404


def test_batch_rejects_unknown_qual_column(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(file_id, qual_column="PU1"))
    assert resp.status_code == 400


# ---------------- /finalize ----------------

def _finalize_payload(file_id, ids, score=4, **overrides):
    payload = {
        "file_id": file_id, "qual_column": "OPEN1", "new_column": "OPEN1_score",
        "rubric_prompt": "Score sentiment 1-5.", "likert_scale": 5,
        "scores": [{"respondent_id": rid, "score": score} for rid in ids],
    }
    payload.update(overrides)
    return payload


def test_finalize_merges_new_column_into_indicator_dataset(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids, score=5))
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert "OPEN1_score" in data["columns"]
    assert "OPEN1_score" in data["numeric_columns"]
    assert data["n_rows"] == 30
    assert all(row["OPEN1_score"] == 5 for row in data["preview"])
    assert "OPEN1_score" in data["descriptive_stats"]["indicators"]

    # The merge is persisted -- a fresh read of the underlying CSV must
    # already reflect it (a later PLS-SEM run reads straight off disk).
    download_resp = client.get(f"/api/ai_data_gen/download?file_id={file_id}")
    assert download_resp.status_code == 200
    assert b"OPEN1_score" in download_resp.data


def test_finalize_rejects_incomplete_scores(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)][:-1]  # missing one respondent
    resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids))
    assert resp.status_code == 400


def test_finalize_rejects_duplicate_respondent_id(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    payload = _finalize_payload(file_id, ids)
    payload["scores"][-1]["respondent_id"] = payload["scores"][0]["respondent_id"]  # duplicate, drops one real id
    resp = client.post("/api/ai_qual_score/finalize", json=payload)
    assert resp.status_code == 400


def test_finalize_rejects_out_of_range_score(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    payload = _finalize_payload(file_id, ids)
    payload["scores"][0]["score"] = 99
    resp = client.post("/api/ai_qual_score/finalize", json=payload)
    assert resp.status_code == 400


def test_finalize_rejects_column_name_collision(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids, new_column="PU1"))
    assert resp.status_code == 400


def test_finalize_rejects_bad_new_column_name(client):
    file_id = _finalize_plain_ai_lab(client, n=30)
    ids = [f"R{i + 1:04d}" for i in range(30)]
    resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids, new_column="bad name!"))
    assert resp.status_code == 400


def test_finalize_rejects_missing_metadata(client):
    resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload("nope", ["R0001"]))
    assert resp.status_code == 404


# ---------------- works for AI Lab Experiment-originated data too ----------------

def _finalize_experiment_with_qual(client):
    pool_resp = client.post("/api/ai_worker/finalize_pool", json={
        "population_prompt": "Students", "rows": [
            {"persona_description": f"Persona {i}", "resp_age": 25, "resp_gender": "male" if i % 2 == 0 else "female"}
            for i in range(30)
        ],
        "demographics": {}, "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7, "lang": "en",
    })
    assert pool_resp.status_code == 200, pool_resp.get_json()
    pool_id = pool_resp.get_json()["pool_id"]
    pool = client.get(f"/api/ai_worker/pool?pool_id={pool_id}").get_json()
    ids = [w["worker_id"] for w in pool["workers"]][:5]

    codebook = [{"column": "PU1", "question_text": "Q"}, {"column": "OPEN1", "question_text": "Why?", "type": "qualitative"}]
    rows = [{"worker_id": wid, "PU1": 4, "OPEN1": f"Answer from {wid}"} for wid in ids]
    resp = client.post("/api/ai_worker/finalize_experiment", json={
        "pool_id": pool_id, "codebook": codebook,
        "condition_groups": [{"group_index": 0, "manipulation_text": "cond", "worker_ids": ids}],
        "excluded_worker_ids": [], "rows": rows, "likert_scale": 5,
        "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7, "batches": [], "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["file_id"], ids


def test_batch_and_finalize_work_for_experiment_originated_file(client, monkeypatch):
    file_id, ids = _finalize_experiment_with_qual(client)
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: _score_csv(ids, score=2))
    batch_resp = client.post("/api/ai_qual_score/batch", json=_batch_payload(
        file_id, start_row=1, end_row=len(ids),
    ))
    assert batch_resp.status_code == 200, batch_resp.get_json()

    finalize_resp = client.post("/api/ai_qual_score/finalize", json=_finalize_payload(file_id, ids, score=2))
    assert finalize_resp.status_code == 200, finalize_resp.get_json()
    data = finalize_resp.get_json()
    assert "OPEN1_score" in data["numeric_columns"]
    assert all(row["OPEN1_score"] == 2 for row in data["preview"])
