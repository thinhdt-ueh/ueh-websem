/* Shared "estimated time remaining" countdown for requests that can take a
 * while (bootstrapping, Monte Carlo power simulation, k-fold cross-validation
 * across several ML algorithms). None of these have a server-side progress
 * channel -- each is one synchronous request/response -- so this is a
 * client-side ESTIMATE computed before the request is sent (from real
 * benchmarked per-fit costs; see the comment at each call site), ticking
 * down once a second while the request is in flight. If the estimate runs
 * out before the real response arrives (a slower machine, a bigger dataset
 * than the benchmark was measured on), it switches to a ticking "taking
 * longer than estimated -- running for m:ss" message instead of freezing or
 * counting into negative numbers, so a long run still visibly progresses --
 * it's a ballpark, never a promise of exact timing.
 *
 * Usage: const stop = startEtaCountdown(el, 42); // ... stop() once the
 * response arrives (success or error) or the loading view is torn down. */
function startEtaCountdown(el, estimatedSeconds) {
  let remaining = Math.max(1, Math.round(estimatedSeconds));
  const startedAt = Date.now();
  function render() {
    if (remaining > 0) {
      el.textContent = t("eta_remaining", { s: remaining });
      return;
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
    el.textContent = t("eta_overtime", { elapsed: mmss });
  }
  render();
  const timer = setInterval(() => {
    remaining -= 1;
    render();
  }, 1000);
  return function stop() {
    clearInterval(timer);
  };
}

/* Real progress for a background job (routes/jobs.py report_progress, relayed
 * by async_fetch.js as "asyncjobprogress" events): once the first progress
 * report for `path` arrives, the up-front estimate (stopped via `stopEta`) is
 * replaced by a progress bar with elapsed time and a remaining-time
 * extrapolation from the actual run speed. Returns a function that detaches
 * the listener.
 *
 * Usage: const detach = trackJobProgress("/api/x", { wrapId, barId, textId, etaEl, stopEta }); */
function trackJobProgress(path, { wrapId, barId, textId, etaEl, stopEta }) {
  let etaStopped = false;
  function onProgress(ev) {
    const { path: evPath, elapsed, progress } = ev.detail || {};
    if (evPath !== path || !progress || !progress.total) return;
    if (!etaStopped) {
      etaStopped = true;
      if (stopEta) stopEta();
      if (etaEl) etaEl.classList.add("hidden");
    }
    const frac = Math.min(1, progress.done / progress.total);
    document.getElementById(wrapId).classList.remove("hidden");
    document.getElementById(barId).value = Math.round(frac * 100);
    const remaining = frac > 0.02 ? (elapsed * (1 - frac)) / frac : null;
    document.getElementById(textId).textContent = t(
      remaining === null ? "job_progress_starting" : "job_progress",
      { pct: Math.round(frac * 100), elapsed: formatDuration(elapsed), remaining: formatDuration(remaining) },
    );
  }
  window.addEventListener("asyncjobprogress", onProgress);
  return () => window.removeEventListener("asyncjobprogress", onProgress);
}

function formatDuration(seconds) {
  const sec = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
