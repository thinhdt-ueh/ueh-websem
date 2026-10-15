"""Asynchronous execution for long-running POST endpoints.

Reverse proxies in front of the app (the demo server's nginx uses the default
60 s proxy_read_timeout) cut any request that runs longer than their read
timeout and answer with an HTML "504 Gateway Time-out" page -- which the
browser then fails to parse as JSON. Power analysis, sensitivity, ML
comparison, MGA, large bootstraps and AI calls routinely exceed 60 s.

Instead of changing every route, any request to one of LONG_RUNNING_PATHS
that carries the header ``X-Async-Job: 1`` is answered immediately with
``202 {"job_id": ...}``; the unchanged view function then runs in a
background thread inside an equivalent request context, and its response
(status + JSON body) is written to a small file. The browser polls
``GET /api/jobs/<job_id>`` until the job is done (static/js/async_fetch.js
does this transparently). Results live on disk, not in memory, so polling
works no matter which gunicorn worker answers it. Requests without the
header behave exactly as before, which keeps tests and scripts unchanged.

While a job runs, its thread refreshes a heartbeat in the job file. If the
process running it dies (server restart, worker recycled, dev-server
reload), the heartbeat goes stale and polling reports the job as lost
instead of "running" forever.

Long loops can also call `report_progress(done, total)`: the latest value
rides along with the heartbeat so the page can show real progress, and the
same call raises `JobCancelled` once the browser has asked
``POST /api/jobs/<job_id>/cancel`` (sent when the results tab is closed),
so abandoned simulations stop instead of competing for CPU with new runs.
Outside a background job both are no-ops.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid

from flask import Flask, current_app, jsonify, request

from i18n import get_lang, t

LONG_RUNNING_PATHS = {
    "/api/analyze",
    "/api/analyze_cbsem",
    "/api/plspredict",
    "/api/ipma",
    "/api/sensitivity",
    "/api/sensitivity_resample",
    "/api/power_analysis",
    "/api/ml_compare",
    "/api/mga",
    "/api/ai_report",
    "/api/ai_data_gen/batch",
    "/api/ai_data_gen/suggest_constructs",
    "/api/ai_data_gen/suggest_paths",
    "/api/ai_worker/batch",
    "/api/ai_worker/survey_batch",
    "/api/ai_qual_score/batch",
}

JOB_TTL_SECONDS = 24 * 3600
HEARTBEAT_SECONDS = 2
# A running job whose heartbeat is older than this was orphaned by its process.
HEARTBEAT_STALE_SECONDS = 90
_JOB_ID_CHARS = set("0123456789abcdef")
_current = threading.local()


class JobCancelled(BaseException):
    """Raised from report_progress() once the job's client has cancelled it.
    A BaseException (like KeyboardInterrupt) so the analysis code's broad
    `except Exception` handlers for degenerate replicates don't swallow it."""


def report_progress(done: int, total: int) -> None:
    job = getattr(_current, "job", None)
    if job is None:
        return
    job["progress"] = {"done": int(done), "total": int(total)}
    if os.path.exists(job["cancel_path"]):
        raise JobCancelled()


def _valid_job_id(job_id: str) -> bool:
    return len(job_id) == 32 and set(job_id) <= _JOB_ID_CHARS


def _jobs_dir(app: Flask) -> str:
    path = os.path.join(app.config["UPLOAD_DIR"], "_jobs")
    os.makedirs(path, exist_ok=True)
    return path


def _write(path: str, record: dict) -> None:
    tmp = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(record, f)
    # On Windows the rename fails while a poll request has the target file
    # open for reading; that window is a few milliseconds, so retry briefly.
    for attempt in range(100):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 99:
                raise
            time.sleep(0.02)


def _cleanup(jobs_dir: str) -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    for name in os.listdir(jobs_dir):
        p = os.path.join(jobs_dir, name)
        try:
            if os.path.getmtime(p) < cutoff:
                os.remove(p)
        except OSError:
            pass


def _run_job(app: Flask, job_path: str, endpoint: str, view_args: dict, path: str,
             query_string: bytes, body: bytes, content_type: str | None, lang: str) -> None:
    view = app.view_functions[endpoint]
    started_at = time.time()
    done = threading.Event()
    lock = threading.Lock()
    job = {"cancel_path": job_path[: -len(".json")] + ".cancel", "progress": None}
    _current.job = job

    def heartbeat():
        while not done.wait(HEARTBEAT_SECONDS):
            with lock:
                if not done.is_set():
                    _write(job_path, {"state": "running", "started_at": started_at, "heartbeat": time.time(),
                                      "progress": job["progress"]})

    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        with app.test_request_context(path, method="POST", data=body, content_type=content_type,
                                      query_string=query_string):
            response = app.make_response(view(**view_args))
            status = response.status_code
            payload = response.get_json(silent=True)
            if payload is None:
                payload = {"error": t("err_job_bad_response", lang)}
                status = 500
    except JobCancelled:
        status, payload = 499, {"error": t("err_job_cancelled", lang), "cancelled": True}
    except Exception as exc:  # noqa: BLE001 -- surface any failure to the polling client
        status, payload = 500, {"error": t("err_job_failed", lang, exc=exc)}
    finally:
        _current.job = None
    with lock:
        done.set()
        _write(job_path, {"state": "done", "status": status, "payload": payload, "finished_at": time.time()})


def init_async_jobs(app: Flask) -> None:
    @app.before_request
    def _maybe_run_async():
        if request.method != "POST" or request.headers.get("X-Async-Job") != "1":
            return None
        if request.path not in LONG_RUNNING_PATHS or request.url_rule is None:
            return None
        lang = get_lang(request.get_json(silent=True) or {"lang": request.form.get("lang")})
        jobs_dir = _jobs_dir(current_app)
        _cleanup(jobs_dir)
        job_id = uuid.uuid4().hex
        job_path = os.path.join(jobs_dir, f"{job_id}.json")
        now = time.time()
        _write(job_path, {"state": "running", "started_at": now, "heartbeat": now})
        worker = threading.Thread(
            target=_run_job,
            args=(current_app._get_current_object(), job_path, request.url_rule.endpoint,
                  dict(request.view_args or {}), request.path, request.query_string,
                  request.get_data(), request.content_type, lang),
            daemon=True,
        )
        worker.start()
        return jsonify(job_id=job_id), 202

    @app.get("/api/jobs/<job_id>")
    def job_status(job_id: str):
        lang = get_lang({"lang": request.args.get("lang")})
        if not _valid_job_id(job_id):
            return jsonify(error=t("err_job_not_found", lang)), 404
        path = os.path.join(_jobs_dir(current_app), f"{job_id}.json")
        try:
            with open(path, encoding="utf-8") as f:
                record = json.load(f)
        except (OSError, ValueError):
            return jsonify(error=t("err_job_not_found", lang)), 404
        if record.get("state") != "done":
            now = time.time()
            last_beat = record.get("heartbeat") or record.get("started_at") or 0
            if now - last_beat > HEARTBEAT_STALE_SECONDS:
                return jsonify(state="done", status=500, payload={"error": t("err_job_lost", lang)})
            return jsonify(state="running", elapsed=round(now - record.get("started_at", now), 1),
                           progress=record.get("progress"))
        return jsonify(state="done", status=record["status"], payload=record["payload"])

    @app.post("/api/jobs/<job_id>/cancel")
    def job_cancel(job_id: str):
        if not _valid_job_id(job_id):
            return jsonify(error=t("err_job_not_found", get_lang(None))), 404
        jobs_dir = _jobs_dir(current_app)
        if os.path.exists(os.path.join(jobs_dir, f"{job_id}.json")):
            with open(os.path.join(jobs_dir, f"{job_id}.cancel"), "w", encoding="utf-8"):
                pass
        return jsonify(ok=True)
