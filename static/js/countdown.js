/* Shared "estimated time remaining" countdown for requests that can take a
 * while (bootstrapping, Monte Carlo power simulation, k-fold cross-validation
 * across several ML algorithms). None of these have a server-side progress
 * channel -- each is one synchronous request/response -- so this is a
 * client-side ESTIMATE computed before the request is sent (from real
 * benchmarked per-fit costs; see the comment at each call site), ticking
 * down once a second while the request is in flight. If the estimate runs
 * out before the real response arrives (a slower machine, a bigger dataset
 * than the benchmark was measured on), it degrades to an "almost done"
 * message instead of freezing or counting into negative numbers -- it's a
 * ballpark, never a promise of exact timing.
 *
 * Usage: const stop = startEtaCountdown(el, 42); // ... stop() once the
 * response arrives (success or error) or the loading view is torn down. */
function startEtaCountdown(el, estimatedSeconds) {
  let remaining = Math.max(1, Math.round(estimatedSeconds));
  function render() {
    el.textContent = remaining > 0 ? t("eta_remaining", { s: remaining }) : t("eta_almost_done");
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
