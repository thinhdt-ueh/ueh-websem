"""Tests for the /api/ai_worker/* routes (AI Lab Experiment: a reusable
Worker Pool + condition-based Survey Experiment administration). Never
calls a real provider's API -- monkeypatches `_call_openai`/`_call_gemini`/
`_call_claude` on `routes.ai_data_gen_api` (where `_call_ai_provider_mapped`
-- imported, not redefined, by ai_worker_api.py -- actually resolves its
bare-name lookups), exactly like tests/test_ai_data_gen_api.py already does.
"""

from __future__ import annotations

import io
import json

import openpyxl
import pandas as pd

import routes.ai_data_gen_api as ai_data_gen_api
import routes.ai_worker_api as ai_worker_api


def _worker_persona_csv(n, persona="A 25-year-old tech-savvy student"):
    # Demographics are no longer AI output (see _assign_demographics) -- the
    # AI's mocked response now only ever needs to supply persona sentences.
    return "\n".join(["persona_description"] + [f'"{persona}"'] * n)


def _worker_batch_payload(**overrides):
    payload = {
        "provider": "openai", "api_key": "sk-test-123", "model": "gpt-4o-mini", "temperature": 0.7,
        "system_prompt": "SYSTEM", "user_prompt": "USER",
        "start_row": 1, "end_row": 5, "n_workers": 40, "seed": 42,
        "demographics": {"age_min": 20, "age_max": 40}, "lang": "en",
    }
    payload.update(overrides)
    return payload


def _finalize_pool_payload(n=30, **overrides):
    rows = [
        {"persona_description": f"Persona {i}", "resp_age": 25 + (i % 10), "resp_gender": "male" if i % 2 == 0 else "female"}
        for i in range(n)
    ]
    payload = {
        "population_prompt": "University students in Vietnam", "rows": rows,
        "demographics": {"occupation": "students"}, "provider": "openai", "model": "gpt-4o-mini",
        "temperature": 0.7, "lang": "en",
    }
    payload.update(overrides)
    return payload


def _make_pool(client, n=30, monkeypatch=None):
    """Creates a real, persisted pool via the actual finalize_pool route
    and returns its pool_id."""
    resp = client.post("/api/ai_worker/finalize_pool", json=_finalize_pool_payload(n=n))
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["pool_id"]


def _codebook():
    return [
        {"column": "PU1", "question_text": "I find the system useful."},
        {"column": "PU2", "question_text": "Using the system improves my performance."},
    ]


# ---------------- Phase 1: suggest_prompt / batch / finalize_pool ----------------

def test_suggest_worker_prompt_builds_expected_shape(client):
    resp = client.post("/api/ai_worker/suggest_prompt", json={
        "population_prompt": "University students in Ho Chi Minh City",
        "demographics": {"occupation": "university students"},
        "n_workers": 45, "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert "persona_description" in data["system_prompt"]
    assert "University students in Ho Chi Minh City" in data["system_prompt"]
    assert "45" in data["user_prompt"]
    assert data["batch_size"] == 25
    assert data["total_batches"] == 2
    assert isinstance(data["seed"], int)
    # Demographics are pre-assigned server-side now (see _assign_demographics),
    # not left to the AI to pick -- so they no longer appear in the reusable
    # system prompt, only in the per-batch roster preview.
    assert "resp_age" not in data["system_prompt"]
    assert "age" in data["first_batch_instruction"]
    # No survey/Likert content should leak into a worker-only prompt.
    assert "Likert" not in data["system_prompt"]


def test_suggest_worker_prompt_includes_custom_attrs(client):
    resp = client.post("/api/ai_worker/suggest_prompt", json={
        "population_prompt": "", "n_workers": 30,
        "demo_attributes": [{"name": "Income", "type": "numeric", "min": 5, "max": 50}],
        "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    # The attribute's own name (not just its slugified column) shows up in
    # the per-row assigned-values preview.
    assert "Income" in resp.get_json()["first_batch_instruction"]


def test_generate_worker_batch_success(client, monkeypatch):
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: _worker_persona_csv(5))
    resp = client.post("/api/ai_worker/batch", json=_worker_batch_payload())
    assert resp.status_code == 200, resp.get_json()
    rows = resp.get_json()["rows"]
    assert len(rows) == 5
    assert all(set(r.keys()) == {"persona_description", "resp_age", "resp_gender"} for r in rows)
    assert all(20 <= r["resp_age"] <= 40 for r in rows)


def test_generate_worker_batch_retries_on_malformed_then_succeeds(client, monkeypatch):
    calls = []

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        calls.append(1)
        if len(calls) == 1:
            return "not a csv"
        return _worker_persona_csv(5)

    monkeypatch.setattr(ai_data_gen_api, "_call_openai", fake_call)
    resp = client.post("/api/ai_worker/batch", json=_worker_batch_payload())
    assert resp.status_code == 200, resp.get_json()
    assert len(calls) == 2


def test_generate_worker_batch_with_custom_attrs(client, monkeypatch):
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: _worker_persona_csv(5))
    raw_demo_attributes = [{"name": "Income", "type": "numeric", "min": 5, "max": 50}]
    payload = _worker_batch_payload(demo_attributes=raw_demo_attributes)
    resp = client.post("/api/ai_worker/batch", json=payload)
    assert resp.status_code == 200, resp.get_json()
    rows = resp.get_json()["rows"]
    # demo_income comes from the server's own seeded assignment, not the AI
    # -- recomputing it independently with the same (n_workers, seed) must
    # match exactly. _assign_demographics expects the VALIDATED shape (with
    # a slugified "column" key), same as the route itself produces before
    # calling it.
    validated_attributes, _ = ai_data_gen_api._validate_demo_attributes(raw_demo_attributes, "en")
    expected = ai_worker_api._assign_demographics(
        payload["n_workers"], payload["demographics"], validated_attributes, payload["seed"],
    )[payload["start_row"] - 1:payload["end_row"]]
    assert [r["demo_income"] for r in rows] == [e["demo_income"] for e in expected]
    assert all(5 <= v <= 50 for v in (r["demo_income"] for r in rows))


def test_assign_demographics_balanced_gender_is_exact_quota():
    rows = ai_worker_api._assign_demographics(101, {"gender_mix": "balanced"}, [], seed=7)
    n_male = sum(1 for r in rows if r["resp_gender"] == "male")
    n_female = sum(1 for r in rows if r["resp_gender"] == "female")
    assert n_male + n_female == 101
    assert {n_male, n_female} == {50, 51}


def test_assign_demographics_mostly_male_is_exact_80_20():
    rows = ai_worker_api._assign_demographics(100, {"gender_mix": "mostly_male"}, [], seed=7)
    n_male = sum(1 for r in rows if r["resp_gender"] == "male")
    assert n_male == 80


def test_assign_demographics_categorical_attr_is_exact_quota():
    attr = {"name": "Tier", "column": "tier", "type": "categorical", "min": None, "max": None, "options": ["A", "B", "C"]}
    rows = ai_worker_api._assign_demographics(90, {}, [attr], seed=1)
    counts = {opt: sum(1 for r in rows if r["tier"] == opt) for opt in ["A", "B", "C"]}
    assert set(counts.values()) == {30}


def test_assign_demographics_deterministic_for_same_seed():
    demographics = {"gender_mix": "balanced", "age_min": 20, "age_max": 30}
    a = ai_worker_api._assign_demographics(50, demographics, [], seed=99)
    b = ai_worker_api._assign_demographics(50, demographics, [], seed=99)
    assert a == b


def test_assign_demographics_any_gender_is_not_forced_exact():
    # "any" means unconstrained, not "forced 50/50" -- an independent coin
    # flip per row can (and with this seed, does) land away from exact half.
    rows = ai_worker_api._assign_demographics(20, {"gender_mix": "any"}, [], seed=3)
    assert all(r["resp_gender"] in ("male", "female") for r in rows)


def test_generate_worker_batch_missing_api_key_rejected(client):
    resp = client.post("/api/ai_worker/batch", json=_worker_batch_payload(api_key=""))
    assert resp.status_code == 400


def test_finalize_pool_persists_and_returns_summary(client):
    resp = client.post("/api/ai_worker/finalize_pool", json=_finalize_pool_payload(n=30))
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["n_workers"] == 30
    assert len(data["preview"]) == 10
    assert data["preview"][0]["worker_id"] == "W0001"


def test_finalize_pool_rejects_too_few_rows(client):
    resp = client.post("/api/ai_worker/finalize_pool", json=_finalize_pool_payload(n=5))
    assert resp.status_code == 400


def test_get_worker_pool_round_trips(client):
    pool_id = _make_pool(client)
    resp = client.get(f"/api/ai_worker/pool?pool_id={pool_id}")
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["pool_id"] == pool_id
    assert len(data["workers"]) == 30
    assert data["workers"][0]["worker_id"] == "W0001"


def test_get_worker_pool_missing_404(client):
    resp = client.get("/api/ai_worker/pool?pool_id=doesnotexist")
    assert resp.status_code == 404


def test_export_worker_pool_returns_valid_workbook(client):
    pool_id = _make_pool(client)
    resp = client.get(f"/api/ai_worker/pool_export?pool_id={pool_id}")
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.data))
    assert wb.sheetnames == ["Worker Pool"]
    ws = wb["Worker Pool"]
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    assert "worker_id" in header
    assert "persona_description" in header
    assert ws.max_row == 31  # header + 30 workers


def test_download_worker_pool_template_is_importable(client):
    resp = client.get("/api/ai_worker/pool_import_template")
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.data))
    assert "Worker Pool" in wb.sheetnames
    assert "Instructions" in wb.sheetnames
    header = [c.value for c in next(wb["Worker Pool"].iter_rows(min_row=1, max_row=1))]
    assert header[:4] == ["worker_id", "persona_description", "resp_age", "resp_gender"]
    assert wb["Worker Pool"].max_row == 3  # header + 2 sample rows

    # The 2-row template is a shape EXAMPLE, not a real pool -- it correctly
    # gets rejected by the same MIN_WORKERS floor finalize_pool() enforces
    # (import_worker_pool()'s size-bound check), not a crash or a
    # column-shape error.
    import_resp = client.post(
        "/api/ai_worker/import_pool",
        data={"file": (io.BytesIO(resp.data), "template.xlsx"), "lang": "en"},
        content_type="multipart/form-data",
    )
    assert import_resp.status_code == 400
    assert "30" in import_resp.get_json()["error"]

    # The template's COLUMN SHAPE (including custom-attribute inference) is
    # exactly what a real, properly-sized file needs -- expand its two
    # example rows to a valid pool size and confirm THAT imports cleanly.
    sample_rows = [[c.value for c in row] for row in wb["Worker Pool"].iter_rows(min_row=2, max_row=3)]
    expanded = pd.DataFrame([sample_rows[i % len(sample_rows)] for i in range(30)], columns=header)
    expanded["worker_id"] = [f"W{i:04d}" for i in range(30)]
    buf = io.BytesIO()
    expanded.to_excel(buf, index=False)
    buf.seek(0)
    import_resp2 = client.post(
        "/api/ai_worker/import_pool",
        data={"file": (buf, "template_expanded.xlsx"), "lang": "en"},
        content_type="multipart/form-data",
    )
    assert import_resp2.status_code == 200, import_resp2.get_json()
    data2 = import_resp2.get_json()
    assert data2["n_workers"] == 30
    assert any(a["column"] == "Monthly Income (USD)" and a["type"] == "numeric" for a in data2["demo_attributes"])


def test_import_worker_pool_round_trips_an_export(client):
    pool_id = _make_pool(client)
    export_resp = client.get(f"/api/ai_worker/pool_export?pool_id={pool_id}")
    import_resp = client.post(
        "/api/ai_worker/import_pool",
        data={"file": (io.BytesIO(export_resp.data), "pool.xlsx"), "lang": "en"},
        content_type="multipart/form-data",
    )
    assert import_resp.status_code == 200, import_resp.get_json()
    data = import_resp.get_json()
    assert data["n_workers"] == 30
    assert data["pool_id"] != pool_id  # a fresh pool_id, not the original


def test_import_worker_pool_rejects_bad_file(client):
    csv_bytes = b"a,b\n1,2\n"
    resp = client.post(
        "/api/ai_worker/import_pool",
        data={"file": (io.BytesIO(csv_bytes), "bad.csv"), "lang": "en"},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400


# ---------------- Phase 2: select / suggest_survey_prompt / survey_batch / finalize_experiment ----------------

def test_select_workers_partitions_correctly(client):
    pool_id = _make_pool(client, n=30)
    resp = client.post("/api/ai_worker/select", json={"pool_id": pool_id, "group_sizes": [3, 4]})
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert [len(g["worker_ids"]) for g in data["groups"]] == [3, 4]
    all_selected = {wid for g in data["groups"] for wid in g["worker_ids"]}
    assert len(all_selected) == 7  # no overlap between groups
    assert len(data["excluded_worker_ids"]) == 23
    assert all_selected.isdisjoint(set(data["excluded_worker_ids"]))
    assert all_selected | set(data["excluded_worker_ids"]) == {f"W{i + 1:04d}" for i in range(30)}


def test_select_workers_rejects_m_too_large(client):
    pool_id = _make_pool(client, n=30)
    resp = client.post("/api/ai_worker/select", json={"pool_id": pool_id, "group_sizes": [20, 20]})
    assert resp.status_code == 400


def test_select_workers_rejects_too_many_groups(client):
    pool_id = _make_pool(client, n=30)
    resp = client.post("/api/ai_worker/select", json={"pool_id": pool_id, "group_sizes": [1] * 7})
    assert resp.status_code == 400


def test_select_workers_missing_pool_404(client):
    resp = client.post("/api/ai_worker/select", json={"pool_id": "nope", "group_sizes": [1]})
    assert resp.status_code == 404


def test_suggest_survey_prompt_builds_per_group_prompts(client):
    pool_id = _make_pool(client, n=30)
    pool = client.get(f"/api/ai_worker/pool?pool_id={pool_id}").get_json()
    ids = [w["worker_id"] for w in pool["workers"]]
    resp = client.post("/api/ai_worker/suggest_survey_prompt", json={
        "pool_id": pool_id,
        "context_text": "You are browsing an online store.",
        "groups": [
            {"group_index": 0, "manipulation_text": "Told the product is on sale.", "worker_ids": ids[:3]},
            {"group_index": 1, "manipulation_text": "Told the product is sold out.", "worker_ids": ids[3:6]},
        ],
        "codebook": _codebook(), "likert_scale": 5, "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    groups = resp.get_json()["groups"]
    assert len(groups) == 2
    # The shared context appears in EVERY group's prompt identically...
    assert "browsing an online store" in groups[0]["system_prompt"]
    assert "browsing an online store" in groups[1]["system_prompt"]
    # ...while each group's own manipulation differs.
    assert "on sale" in groups[0]["system_prompt"]
    assert "sold out" not in groups[0]["system_prompt"]
    assert "sold out" in groups[1]["system_prompt"]
    assert "on sale" not in groups[1]["system_prompt"]
    assert "PU1" in groups[0]["system_prompt"]
    # The worker roster is a per-batch concern now (see
    # _survey_batch_instruction), not baked into the reusable system prompt
    # -- it shows up in the first-batch preview instead.
    assert ids[0] not in groups[0]["system_prompt"]
    assert ids[0] in groups[0]["first_batch_preview"]


def test_generate_survey_batch_success(client, monkeypatch):
    pool_id = _make_pool(client, n=30)
    worker_ids = ["W0001", "W0002", "W0003"]
    csv_text = "\n".join(
        ["worker_id,PU1,PU2"] + [f"{wid},4,4" for wid in worker_ids]
    )
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: csv_text)
    resp = client.post("/api/ai_worker/survey_batch", json={
        "provider": "openai", "api_key": "sk-test", "model": "gpt-4o-mini", "temperature": 0.7,
        "system_prompt": "SYS", "user_prompt": "USER", "pool_id": pool_id,
        "columns": ["PU1", "PU2"], "likert_min": 1, "likert_max": 5,
        "worker_ids": worker_ids, "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    rows = resp.get_json()["rows"]
    assert {r["worker_id"] for r in rows} == set(worker_ids)
    assert all(r["PU1"] == 4 for r in rows)


def test_generate_survey_batch_missing_pool_404(client, monkeypatch):
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: "worker_id,PU1\nW0001,4\n")
    resp = client.post("/api/ai_worker/survey_batch", json={
        "provider": "openai", "api_key": "sk-test", "model": "gpt-4o-mini", "temperature": 0.7,
        "system_prompt": "SYS", "user_prompt": "USER", "pool_id": "nope",
        "columns": ["PU1"], "likert_min": 1, "likert_max": 5,
        "worker_ids": ["W0001"], "lang": "en",
    })
    assert resp.status_code == 404


def test_generate_survey_batch_rejects_wrong_worker_id_set(client, monkeypatch):
    pool_id = _make_pool(client, n=30)
    # AI returns an extra, uninstructed worker_id instead of one of the
    # three actually requested -- must be rejected, not silently accepted.
    csv_text = "worker_id,PU1\nW0001,4\nW0002,4\nW9999,4\n"
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: csv_text)
    resp = client.post("/api/ai_worker/survey_batch", json={
        "provider": "openai", "api_key": "sk-test", "model": "gpt-4o-mini", "temperature": 0.7,
        "system_prompt": "SYS", "user_prompt": "USER", "pool_id": pool_id,
        "columns": ["PU1"], "likert_min": 1, "likert_max": 5,
        "worker_ids": ["W0001", "W0002", "W0003"], "lang": "en",
    })
    assert resp.status_code == 422


def test_generate_survey_batch_with_qualitative_column(client, monkeypatch):
    pool_id = _make_pool(client, n=30)
    worker_ids = ["W0001", "W0002"]
    csv_text = "\n".join(
        ["worker_id,PU1,OPEN1"] + [f'{wid},4,"free text answer {wid}"' for wid in worker_ids]
    )
    monkeypatch.setattr(ai_data_gen_api, "_call_openai", lambda *a, **k: csv_text)
    resp = client.post("/api/ai_worker/survey_batch", json={
        "provider": "openai", "api_key": "sk-test", "model": "gpt-4o-mini", "temperature": 0.7,
        "system_prompt": "SYS", "user_prompt": "USER", "pool_id": pool_id,
        "columns": ["PU1", "OPEN1"], "qualitative_columns": ["OPEN1"],
        "likert_min": 1, "likert_max": 5, "worker_ids": worker_ids, "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    rows = resp.get_json()["rows"]
    assert all(isinstance(r["OPEN1"], str) and r["OPEN1"] for r in rows)


def test_generate_survey_batch_roster_scoped_to_this_batch_only(client, monkeypatch):
    # Quality fix: a batch's prompt must mention ONLY its own workers, never
    # personas from elsewhere in the group (see the module docstring on why
    # a whole-group roster used to leak into every batch call).
    pool_id = _make_pool(client, n=30)
    captured = {}

    def fake_call(api_key, model, system_msg, user_msg, temperature):
        captured["user_msg"] = user_msg
        return "worker_id,PU1\nW0001,4\nW0002,4\n"

    monkeypatch.setattr(ai_data_gen_api, "_call_openai", fake_call)
    resp = client.post("/api/ai_worker/survey_batch", json={
        "provider": "openai", "api_key": "sk-test", "model": "gpt-4o-mini", "temperature": 0.7,
        "system_prompt": "SYS", "user_prompt": "USER", "pool_id": pool_id,
        "columns": ["PU1"], "likert_min": 1, "likert_max": 5,
        "worker_ids": ["W0001", "W0002"], "lang": "en",
    })
    assert resp.status_code == 200, resp.get_json()
    assert "W0001" in captured["user_msg"]
    assert "W0002" in captured["user_msg"]
    assert "W0003" not in captured["user_msg"]
    assert "W0030" not in captured["user_msg"]


def _finalize_experiment_payload(pool_id, groups, excluded_ids):
    rows = []
    for g in groups:
        for wid in g["worker_ids"]:
            rows.append({"worker_id": wid, "PU1": 4, "PU2": 4})
    return {
        "pool_id": pool_id,
        "codebook": _codebook(),
        "condition_groups": groups,
        "excluded_worker_ids": excluded_ids,
        "rows": rows,
        "likert_scale": 5, "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7,
        "batches": [], "lang": "en",
    }


def test_finalize_experiment_produces_likert_only_indicator_and_condition_group(client):
    pool_id = _make_pool(client, n=30)
    pool = client.get(f"/api/ai_worker/pool?pool_id={pool_id}").get_json()
    ids = [w["worker_id"] for w in pool["workers"]]
    groups = [
        {"group_index": 0, "manipulation_text": "On sale", "worker_ids": ids[:3]},
        {"group_index": 1, "manipulation_text": "Sold out", "worker_ids": ids[3:6]},
    ]
    excluded = ids[6:]
    resp = client.post("/api/ai_worker/finalize_experiment", json=_finalize_experiment_payload(pool_id, groups, excluded))
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["n_rows"] == 6
    assert set(data["columns"]) == {"PU1", "PU2"}
    assert set(data["numeric_columns"]) == {"PU1", "PU2"}
    condition_attr = next(a for a in data["demo_attributes"] if a["column"] == "condition_group")
    assert set(condition_attr["options"]) == {"On sale", "Sold out"}

    file_id = data["file_id"]
    with client.application.test_request_context():
        _meta, demo_df = ai_data_gen_api._load_ai_gen_metadata(file_id)
    assert set(demo_df["condition_group"]) == {"On sale", "Sold out"}
    assert len(demo_df) == 6
    # Excluded workers must never appear as data rows.
    assert set(demo_df["respondent_id"]) == set(ids[:6])


def test_finalize_experiment_and_export_allow_all_qualitative_codebook(client):
    # An all-qualitative codebook is legitimate (no limit on quantitative
    # vs qualitative item counts) -- indicator_df just ends up with zero
    # columns, and export must not crash on that (EmptyDataError fallback
    # in export_full()).
    pool_id = _make_pool(client, n=30)
    pool = client.get(f"/api/ai_worker/pool?pool_id={pool_id}").get_json()
    ids = [w["worker_id"] for w in pool["workers"]]
    groups = [{"group_index": 0, "worker_ids": ids[:3]}]
    payload = _finalize_experiment_payload(pool_id, groups, ids[3:])
    payload["codebook"] = [{"column": "OPEN1", "question_text": "Why?", "type": "qualitative"}]
    payload["rows"] = [{"worker_id": wid, "OPEN1": "Some open-ended answer"} for wid in ids[:3]]
    resp = client.post("/api/ai_worker/finalize_experiment", json=payload)
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["columns"] == []
    assert data["n_rows"] == 3

    export_resp = client.get(f"/api/ai_data_gen/export?file_id={data['file_id']}")
    assert export_resp.status_code == 200, export_resp.get_data()
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.data))
    ws = wb["Respondent Profile"]
    header_row = next(row for row in ws.iter_rows(values_only=True) if row and "persona_description" in row)
    assert "OPEN1" in header_row


def test_finalize_experiment_rejects_row_count_mismatch(client):
    pool_id = _make_pool(client, n=30)
    pool = client.get(f"/api/ai_worker/pool?pool_id={pool_id}").get_json()
    ids = [w["worker_id"] for w in pool["workers"]]
    groups = [{"group_index": 0, "worker_ids": ids[:3]}]
    payload = _finalize_experiment_payload(pool_id, groups, ids[3:])
    payload["rows"] = payload["rows"][:2]  # short by one row
    resp = client.post("/api/ai_worker/finalize_experiment", json=payload)
    assert resp.status_code == 400


def test_finalize_experiment_missing_pool_404(client):
    resp = client.post("/api/ai_worker/finalize_experiment", json=_finalize_experiment_payload(
        "doesnotexist", [{"group_index": 0, "worker_ids": ["W0001"]}], [],
    ))
    assert resp.status_code == 404


def test_export_includes_worker_pool_and_conditions_sheets(client):
    pool_id = _make_pool(client, n=30)
    pool = client.get(f"/api/ai_worker/pool?pool_id={pool_id}").get_json()
    ids = [w["worker_id"] for w in pool["workers"]]
    groups = [
        {"group_index": 0, "manipulation_text": "On sale", "worker_ids": ids[:3]},
        {"group_index": 1, "manipulation_text": "Sold out", "worker_ids": ids[3:6]},
    ]
    excluded = ids[6:]
    payload = _finalize_experiment_payload(pool_id, groups, excluded)
    payload["context_text"] = "You are browsing an online store."
    finalize_resp = client.post("/api/ai_worker/finalize_experiment", json=payload)
    file_id = finalize_resp.get_json()["file_id"]

    export_resp = client.get(f"/api/ai_data_gen/export?file_id={file_id}")
    assert export_resp.status_code == 200, export_resp.get_data()
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.data))
    assert "Worker Pool" in wb.sheetnames
    assert "Conditions" in wb.sheetnames
    # The four sheets a plain AI Lab export already produces must still be there.
    assert "Survey Data" in wb.sheetnames
    assert "Respondent Profile" in wb.sheetnames

    pool_ws = wb["Worker Pool"]
    pool_header = [c.value for c in next(pool_ws.iter_rows(min_row=1, max_row=1))]
    assert "status" in pool_header
    assert "condition_group" in pool_header
    status_col = pool_header.index("status")
    statuses = {row[status_col].value for row in pool_ws.iter_rows(min_row=2, max_row=pool_ws.max_row)}
    assert statuses == {"Selected", "Excluded"}

    cond_ws = wb["Conditions"]
    all_rows = [[c.value for c in row] for row in cond_ws.iter_rows(min_row=1, max_row=cond_ws.max_row)]
    assert all_rows[0][0] == "Shared Context"
    assert all_rows[0][1] == "You are browsing an online store."
    assert all_rows[2] == ["Group", "Manipulation Prompt", "N Workers"]
    data_rows = all_rows[3:]
    assert {r[1] for r in data_rows} == {"On sale", "Sold out"}
    assert {r[2] for r in data_rows} == {3}


def test_export_without_pool_id_has_no_extra_sheets(client):
    # A plain (non-experiment) AI Lab export must be unaffected by the
    # export_full() extension -- no Worker Pool/Conditions sheets appear.
    rows = [
        {"persona_description": f"P{i}", "PU1": 4, "resp_age": 25, "resp_gender": "male"}
        for i in range(30)
    ]
    resp = client.post("/api/ai_data_gen/finalize", json={
        "filename": "x.csv", "columns": ["PU1"], "rows": rows,
        "codebook": [{"column": "PU1", "question_text": "q"}],
        "demographics": {}, "provider": "openai", "model": "m", "temperature": 0.7,
        "likert_scale": 5, "batches": [], "lang": "en",
    })
    file_id = resp.get_json()["file_id"]
    export_resp = client.get(f"/api/ai_data_gen/export?file_id={file_id}")
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.data))
    assert "Worker Pool" not in wb.sheetnames
    assert "Conditions" not in wb.sheetnames
