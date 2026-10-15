// Transparent async execution for long-running API calls.
//
// A reverse proxy in front of the app (nginx's default 60 s read timeout on
// the demo server) cuts any request that runs longer than that and answers
// with an HTML "504 Gateway Time-out" page, which callers then fail to parse
// as JSON ("Unexpected token '<'"). For the endpoints below, this wrapper asks
// the server to run the job in the background (header X-Async-Job: 1 ->
// 202 {job_id}), polls GET /api/jobs/<id>, and finally hands the caller an
// ordinary Response carrying the job's real status and JSON body -- so every
// existing `fetch(...).then(res => res.json())` call site works unchanged.
// Keep LONG_RUNNING_PATHS in sync with routes/jobs.py.
//
// While a job runs, each poll dispatches a window "asyncjobprogress" event
// ({path, jobId, elapsed, progress: {done, total} | null}) so a page can
// show real progress. Jobs still in flight when the page is closed or
// navigated away from (or whose fetch is aborted) are cancelled on the
// server, so abandoned simulations don't keep competing for CPU.
//
// Separately, any /api/ response that is an error but not JSON (proxy error
// pages, "413 Request Entity Too Large", ...) is converted into a JSON
// {error} with a readable message instead of surfacing a parse error.
(function () {
  const LONG_RUNNING_PATHS = new Set([
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
  ]);
  const MAX_POLL_FAILURES = 20;
  const originalFetch = window.fetch.bind(window);
  const inFlightJobs = new Set();

  function cancelJob(jobId) {
    const url = `/api/jobs/${jobId}/cancel`;
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    originalFetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }
  window.addEventListener("pagehide", () => inFlightJobs.forEach(cancelJob));

  function translate(key, vars, fallback) {
    if (typeof window.t === "function") {
      const s = window.t(key, vars);
      if (s && s !== key) return s;
    }
    return fallback;
  }

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function pathOf(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
      return url.origin === window.location.origin ? url.pathname : null;
    } catch {
      return null;
    }
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }
    });
  }

  function ensureJson(res) {
    const type = res.headers.get("content-type") || "";
    if (res.ok || type.includes("application/json")) return res;
    const message = res.status === 504 || res.status === 502 || res.status === 503
      ? translate("err_server_timeout", { status: res.status },
        `The server did not respond in time (HTTP ${res.status}). Please try again with lighter settings, or use the desktop version for long analyses.`)
      : translate("err_server_bad_response", { status: res.status },
        `The server returned an unexpected response (HTTP ${res.status}). Please try again.`);
    return jsonResponse(res.status, { error: message });
  }

  async function runAsJob(input, init) {
    const headers = new Headers(init.headers || {});
    headers.set("X-Async-Job", "1");
    const signal = init.signal;
    const first = await originalFetch(input, { ...init, headers });
    if (first.status !== 202) return ensureJson(first);
    const { job_id: jobId } = await first.json();
    const path = pathOf(input);
    inFlightJobs.add(jobId);
    try {
      let delay = 800;
      let failures = 0;
      for (;;) {
        await sleep(delay, signal);
        delay = Math.min(3000, delay + 400);
        let res;
        try {
          res = await originalFetch(`/api/jobs/${jobId}`, { signal, cache: "no-store" });
        } catch (err) {
          if (err && err.name === "AbortError") throw err;
          if (++failures > MAX_POLL_FAILURES) throw err;
          continue;
        }
        if (res.status === 404) return ensureJson(res);
        if (!res.ok || !(res.headers.get("content-type") || "").includes("application/json")) {
          if (++failures > MAX_POLL_FAILURES) return ensureJson(res);
          continue;
        }
        failures = 0;
        const job = await res.json();
        if (job.state === "done") {
          inFlightJobs.delete(jobId);
          return jsonResponse(job.status, job.payload);
        }
        window.dispatchEvent(new CustomEvent("asyncjobprogress", {
          detail: { path, jobId, elapsed: job.elapsed, progress: job.progress || null },
        }));
      }
    } catch (err) {
      if (err && err.name === "AbortError") cancelJob(jobId);
      throw err;
    } finally {
      inFlightJobs.delete(jobId);
    }
  }

  window.fetch = function (input, init) {
    const opts = init || {};
    const path = pathOf(input);
    if (!path || !path.startsWith("/api/")) return originalFetch(input, init);
    const method = (opts.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    if (method === "POST" && LONG_RUNNING_PATHS.has(path)) return runAsJob(input, opts);
    return originalFetch(input, init).then(ensureJson);
  };
})();
