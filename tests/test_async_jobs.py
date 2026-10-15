"""Background-job execution for long-running endpoints (routes/jobs.py):
X-Async-Job: 1 returns 202 + job_id immediately, and polling
/api/jobs/<id> yields exactly what the synchronous call would have returned."""

from __future__ import annotations

import time

from tests.conftest import TAM_MODEL_JSON


def _poll(client, job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/api/jobs/{job_id}")
        assert resp.status_code == 200
        body = resp.get_json()
        if body["state"] == "done":
            return body
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def _sample_file_id(client):
    return client.get("/api/sample?dataset=tam").get_json()["file_id"]


def test_async_analyze_matches_sync(client):
    fid = _sample_file_id(client)
    payload = {"file_id": fid, "model": TAM_MODEL_JSON, "bootstrap": {"enabled": False}, "lang": "en"}
    sync = client.post("/api/analyze", json=payload)
    assert sync.status_code == 200

    started = client.post("/api/analyze", json=payload, headers={"X-Async-Job": "1"})
    assert started.status_code == 202
    job = _poll(client, started.get_json()["job_id"])
    assert job["status"] == 200
    sync_paths = {(p["source"], p["target"]): p["coefficient"] for p in sync.get_json()["structural"]["paths"]}
    job_paths = {(p["source"], p["target"]): p["coefficient"] for p in job["payload"]["structural"]["paths"]}
    assert job_paths == sync_paths


def test_async_job_preserves_error_status(client):
    started = client.post("/api/power_analysis", json={"model": TAM_MODEL_JSON, "n_from": 0, "lang": "en"},
                          headers={"X-Async-Job": "1"})
    assert started.status_code == 202
    job = _poll(client, started.get_json()["job_id"])
    assert job["status"] == 400
    assert "error" in job["payload"]


def test_header_ignored_for_short_endpoints(client):
    resp = client.post("/api/dummy/create", json={"file_id": "nope", "column": "x"}, headers={"X-Async-Job": "1"})
    assert resp.status_code == 404  # handled synchronously, not turned into a job


def test_unknown_job_id(client):
    assert client.get("/api/jobs/" + "0" * 32).status_code == 404
    assert client.get("/api/jobs/not-a-valid-id").status_code == 404


def test_analyze_tolerates_non_dict_bootstrap(client):
    fid = _sample_file_id(client)
    resp = client.post("/api/analyze", json={"file_id": fid, "model": TAM_MODEL_JSON, "bootstrap": False, "lang": "en"})
    assert resp.status_code == 200


def test_orphaned_job_is_reported_as_lost(client, app):
    """A job file left "running" by a process that died (server restart)
    must not keep the browser polling forever."""
    import json
    import os

    from routes.jobs import HEARTBEAT_STALE_SECONDS, _jobs_dir

    job_id = "f" * 32
    stale = time.time() - HEARTBEAT_STALE_SECONDS - 5
    with open(os.path.join(_jobs_dir(app), f"{job_id}.json"), "w", encoding="utf-8") as f:
        json.dump({"state": "running", "started_at": stale, "heartbeat": stale}, f)
    body = client.get(f"/api/jobs/{job_id}?lang=en").get_json()
    assert body["state"] == "done"
    assert body["status"] == 500
    assert "restarted" in body["payload"]["error"]


def _power_job(**extra):
    return {
        "model": TAM_MODEL_JSON, "method": "cbsem", "n_from": 100, "n_to": 300, "n_step": 50, "n_mc": 100,
        "path_values": {f"{p['source']}->{p['target']}": 0.3 for p in TAM_MODEL_JSON["paths"]},
        "loading_values": {c["id"]: 0.75 for c in TAM_MODEL_JSON["constructs"]},
        "lang": "en", **extra,
    }


def test_power_job_reports_progress_and_can_be_cancelled(client):
    job_id = client.post("/api/power_analysis", json=_power_job(), headers={"X-Async-Job": "1"}).get_json()["job_id"]
    deadline = time.time() + 60
    progress = None
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}").get_json()
        assert body["state"] == "running", "job finished before progress could be observed"
        if body.get("progress") and body["progress"]["done"] > 0:
            progress = body["progress"]
            break
        time.sleep(0.3)
    assert progress and 0 < progress["done"] < progress["total"]

    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    job = _poll(client, job_id, timeout=60)
    assert job["status"] == 499
    assert job["payload"]["cancelled"] is True


def test_cancel_rejects_bad_job_id(client):
    assert client.post("/api/jobs/not-a-job/cancel").status_code == 404


def test_progress_callback_counts_to_total(tam_model_json):
    from cbsem.power_analysis import run_power_analysis
    from pls.model import Model

    model = Model.from_json(tam_model_json)
    calls = []
    run_power_analysis(
        model, {(p.source, p.target): 0.3 for p in model.paths}, {c: 0.75 for c in model.constructs},
        [100, 150], n_mc=20, seed=1, progress=lambda done, total: calls.append((done, total)),
    )
    dones = [d for d, _ in calls]
    assert dones == sorted(dones)
    assert calls[0][0] == 0 and calls[-1][0] == calls[-1][1] == 20 * (100 + 150)
