/* Sample-size sensitivity page: fetches /api/sensitivity for the job stashed
 * in sessionStorage by the results page, then renders two line charts (R² and
 * path coefficients vs. sample size) plus a data table. No charting library —
 * a small reusable canvas line-chart renderer, consistent with the rest of
 * this app (see diagram.js). */

const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_OTHER_COLOR = "#a9a8a2";
// Each series is identified by color AND a distinct {dash pattern, marker
// shape} pair, so a black-and-white printout (or a colorblind reader) can
// still tell every line apart — color is never the only channel carrying
// identity here.
const DASH_PATTERNS = [[], [7, 4], [1, 3], [9, 3, 2, 3], [4, 2], [10, 3, 1, 3, 1, 3], [2, 2], [12, 3]];
const MARKER_SHAPES = ["circle", "square", "triangle", "diamond", "circle", "square", "triangle", "diamond"];
const SHAPE_GLYPH = { circle: "●", square: "■", triangle: "▲", diamond: "◆" };

// Which series are toggled off via the legend, keyed by series id (a
// construct id for the R² chart, a "source->target" path id for the path
// chart — the two id spaces never collide). Kept outside renderAll() so a
// window resize or language switch (both of which rebuild the series arrays
// from scratch) doesn't silently un-hide everything the user just toggled.
const hiddenSeriesIds = new Set();

function legendSwatchSvg(s) {
  const dashAttr = s.dash && s.dash.length ? ` stroke-dasharray="${s.dash.join(",")}"` : "";
  const glyph = SHAPE_GLYPH[s.shape] || "●";
  return (
    `<svg class="leg-swatch" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">` +
    `<line x1="0" y1="6" x2="22" y2="6" stroke="${s.color}" stroke-width="2.4"${dashAttr}/>` +
    `</svg>` +
    `<span class="leg-glyph" style="color:${s.color}">${glyph}</span>`
  );
}

function drawMarker(ctx, shape, x, y, size, fillColor) {
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(x - size, y - size, size * 2, size * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - size * 1.15);
    ctx.lineTo(x + size * 1.05, y + size * 0.85);
    ctx.lineTo(x - size * 1.05, y + size * 0.85);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - size * 1.15);
    ctx.lineTo(x + size * 1.15, y);
    ctx.lineTo(x, y + size * 1.15);
    ctx.lineTo(x - size * 1.15, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  ctx.fill();
}

applyStaticTranslations();
document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === getLang()));
document.getElementById("langSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest(".lang-btn");
  if (!btn) return;
  setLang(btn.dataset.lang);
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
});
document.getElementById("closeTabBtn").addEventListener("click", () => window.close());
document.addEventListener("langchange", () => {
  if (!window.__sensResult) return;
  if (window.__sensJobMode === "resample") renderResampleResults(window.__sensResult);
  else renderAll(window.__sensResult);
});
document.getElementById("sensAiReportBtn").addEventListener("click", () => {
  if (!window.__sensResult) return;
  const data = window.__sensResult;
  const isResample = window.__sensJobMode === "resample";
  openAiReportModal({
    context: isResample ? buildResampleReportContext(data) : buildSensitivityReportContext(data),
    sourceLabel: isResample
      ? `${t("sens_mode_resample_label")} — ${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"}, n_total = ${data.n_total}, new_n = ${data.new_n}`
      : `${t("sens_page_title") || "Sample Size Sensitivity"} — ${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"}, n_total = ${data.n_total}`,
    defaultPrompt: t("ai_modal_prompt_default_sensitivity"),
    images: captureSensitivityChartImages(data, isResample),
  });
});

function captureSensitivityChartImages(data, isResample) {
  const charts = isResample
    ? [["r2Chart", t("sens_resample_r2_chart_title")], ["pathChart", t("sens_resample_path_chart_title")]]
    : [["r2Chart", t("sens_r2_chart_title")], ["pathChart", t("sens_path_chart_title")]];
  if (!isResample && data.has_p_values) charts.push(["pvalueChart", t("sens_pvalue_chart_title")]);
  return charts
    .map(([id, label]) => {
      const canvas = document.getElementById(id);
      if (!canvas || !canvas.width || !canvas.height) return null;
      return { label, dataUrl: canvas.toDataURL("image/png") };
    })
    .filter(Boolean);
}

function buildSensitivityReportContext(data) {
  // See buildSemReportContext (app.js) for why this is localized: the AI is
  // told to write the whole report in the app's current language, but it
  // was leaking English section headers/words when this context -- the
  // "data and figures" it's told to write ONLY from -- was hardcoded in
  // English regardless of `lang`. Fixed statistical terms (R², p-value)
  // are left as-is, matching this app's own convention elsewhere.
  const lang = getLang();
  const L = (vi, en) => (lang === "vi" ? vi : en);
  const converged = data.points.filter((p) => p.converged);
  // Cap to ~12 evenly-spaced points so a dense run (up to 150 steps)
  // doesn't balloon the prompt sent to the AI.
  const maxPoints = 12;
  const stride = Math.max(1, Math.ceil(converged.length / maxPoints));
  const sampled = converged.filter((_, i) => i % stride === 0);

  const lines = [];
  lines.push(`## ${L("Độ nhạy theo Cỡ mẫu", "Sample Size Sensitivity")} (${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"})`);
  lines.push(`${L("Cỡ mẫu gốc", "Original n")} = ${data.n_total}, step = ${data.step}, ${L("có p-value", "has p-values")} = ${L(data.has_p_values ? "có" : "không", data.has_p_values)}${data.n_boot ? `, ${L("số mẫu lặp lại bootstrap mỗi bước", "bootstrap resamples per step")} = ${data.n_boot}` : ""}`);
  lines.push("");
  lines.push(`## R² ${L("theo cỡ mẫu", "by sample size")}`);
  const rSquaredIds = data.constructs.map((c) => c.id);
  lines.push(`| n | ${data.constructs.map((c) => c.name).join(" | ")} |`);
  lines.push(`|---|${data.constructs.map(() => "---").join("|")}|`);
  sampled.forEach((p) => {
    lines.push(`| ${p.n} | ${rSquaredIds.map((cid) => fmt(p.r_squared[cid])).join(" | ")} |`);
  });

  lines.push("");
  lines.push(`## ${L("Hệ số đường dẫn theo cỡ mẫu", "Path coefficients by sample size")}` + (data.has_p_values ? L(" (kèm p-value)", " (with p-value)") : ""));
  lines.push(`| n | ${data.paths.map((p) => `${p.source_name}->${p.target_name}`).join(" | ")} |`);
  lines.push(`|---|${data.paths.map(() => "---").join("|")}|`);
  sampled.forEach((p) => {
    lines.push(`| ${p.n} | ${data.paths.map((pt) => {
      const coef = fmt(p.paths[pt.id]);
      if (data.has_p_values) {
        const pv = p.p_values[pt.id];
        return `${coef} (p=${fmt(pv, 4)})`;
      }
      return coef;
    }).join(" | ")} |`);
  });

  const nonConverged = data.points.length - converged.length;
  if (nonConverged > 0) {
    lines.push("");
    lines.push(L(
      `${nonConverged} trong số ${data.points.length} cỡ mẫu được kiểm tra không hội tụ.`,
      `${nonConverged} of ${data.points.length} sample sizes tested failed to converge.`,
    ));
  }

  return lines.join("\n");
}

// Quartiles via linear interpolation (the common "type 7" convention) on a
// pre-sorted array -- used both by the AI-report context below and by
// drawBoxPlot's rendering, so the two always agree on the same numbers.
function quantile(sortedArr, q) {
  if (!sortedArr.length) return null;
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedArr[base + 1] !== undefined
    ? sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
    : sortedArr[base];
}

// Standard Tukey box-plot summary: whiskers extend to the most extreme
// value still within 1.5*IQR of the box, anything further out is reported
// separately as an outlier rather than stretching the whisker to it.
function boxStats(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const q1 = quantile(clean, 0.25), median = quantile(clean, 0.5), q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
  const inFence = clean.filter((v) => v >= lowFence && v <= highFence);
  const whiskerLo = inFence.length ? inFence[0] : clean[0];
  const whiskerHi = inFence.length ? inFence[inFence.length - 1] : clean[clean.length - 1];
  const outliers = clean.filter((v) => v < whiskerLo || v > whiskerHi);
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  return { min: clean[0], max: clean[clean.length - 1], q1, median, q3, whiskerLo, whiskerHi, outliers, mean, n: clean.length };
}

function buildResampleReportContext(data) {
  // Same localization rationale as buildSensitivityReportContext above.
  const lang = getLang();
  const L = (vi, en) => (lang === "vi" ? vi : en);
  const converged = data.points.filter((p) => p.converged);

  const lines = [];
  lines.push(`## ${L("Lấy mẫu lặp ở cỡ mẫu cố định", "Repeated Resampling at a Fixed Size")} (${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"})`);
  lines.push(`${L("Cỡ mẫu gốc", "Original n")} = ${data.n_total}, ${L("cỡ mẫu mới", "new sample size")} = ${data.new_n}, ${L("số lần lặp", "iterations")} = ${data.n_iterations}, ${L("hội tụ", "converged")} = ${converged.length}/${data.points.length}`);

  lines.push("");
  lines.push(`## R² ${L("qua các lần lặp (median, IQR, min-max)", "across iterations (median, IQR, min-max)")}`);
  lines.push(`| ${L("Biến nội sinh", "Endogenous construct")} | Median | Q1 | Q3 | Min | Max |`);
  lines.push("|---|---|---|---|---|---|");
  data.constructs.forEach((c) => {
    const stats = boxStats(converged.map((p) => p.r_squared[c.id]));
    if (stats) lines.push(`| ${c.name} | ${fmt(stats.median)} | ${fmt(stats.q1)} | ${fmt(stats.q3)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`);
  });

  lines.push("");
  lines.push(`## ${L("Hệ số đường dẫn qua các lần lặp (median, IQR, min-max)", "Path coefficients across iterations (median, IQR, min-max)")}`);
  lines.push(`| ${L("Đường dẫn", "Path")} | Median | Q1 | Q3 | Min | Max |`);
  lines.push("|---|---|---|---|---|---|");
  data.paths.forEach((p) => {
    const stats = boxStats(converged.map((row) => row.paths[p.id]));
    if (stats) lines.push(`| ${p.source_name} → ${p.target_name} | ${fmt(stats.median)} | ${fmt(stats.q1)} | ${fmt(stats.q3)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`);
  });

  const nonConverged = data.points.length - converged.length;
  if (nonConverged > 0) {
    lines.push("");
    lines.push(L(
      `${nonConverged} trong số ${data.points.length} lần lặp không hội tụ.`,
      `${nonConverged} of ${data.points.length} iterations failed to converge.`,
    ));
  }

  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? t("lbl_dash") : Number(v).toFixed(digits);
}

async function main() {
  const raw = sessionStorage.getItem("websem_sensitivity_job");
  if (!raw) {
    showError(t("sens_no_job"));
    return;
  }
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    showError(t("sens_no_job"));
    return;
  }

  let stopEta = null;
  if (job.estimated_seconds) {
    const etaEl = document.getElementById("sensLoadingEta");
    etaEl.classList.remove("hidden");
    stopEta = startEtaCountdown(etaEl, job.estimated_seconds);
  }

  const isResample = job.mode === "resample";
  try {
    const res = await fetch(isResample ? "/api/sensitivity_resample" : "/api/sensitivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("sens_failed"));
    window.__sensResult = data;
    window.__sensJobMode = job.mode || "shrink";
    if (isResample) renderResampleResults(data);
    else renderAll(data);
  } catch (err) {
    showError(err.message);
  } finally {
    if (stopEta) stopEta();
  }
}

function showError(msg) {
  document.getElementById("sensLoading").classList.add("hidden");
  const box = document.getElementById("sensError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function renderAll(data) {
  document.getElementById("sensLoading").classList.add("hidden");
  document.getElementById("sensContent").classList.remove("hidden");

  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));
  const pathIdToLabel = {};
  data.paths.forEach((p) => (pathIdToLabel[p.id] = `${p.source_name} → ${p.target_name}`));

  const points = [...data.points].sort((a, b) => a.n - b.n);
  const nConverged = points.filter((p) => p.converged).length;

  document.getElementById("sensSummary").textContent = t("sens_summary_text", {
    method: data.method === "cbsem" ? "CB-SEM" : "PLS-SEM",
    n0: data.n_total,
    step: data.step,
    count: points.length,
    conv: nConverged,
    minN: points.length ? points[0].n : data.min_n,
  });

  const r2Series = data.constructs.map((c, i) => ({
    id: c.id,
    label: c.name,
    color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
    dash: DASH_PATTERNS[i % DASH_PATTERNS.length],
    shape: MARKER_SHAPES[i % MARKER_SHAPES.length],
    hidden: hiddenSeriesIds.has(c.id),
    points: points.map((p) => ({ x: p.n, y: p.r_squared ? p.r_squared[c.id] : null, converged: p.converged })),
  }));
  drawLineChart("r2Chart", "r2Tooltip", "r2Legend", r2Series, {
    yMin: 0, yMax: 1, yFormat: (v) => v.toFixed(2),
    xLabel: t("sens_axis_n"), yLabel: "R²",
  });

  const pathSeries = data.paths.map((p, i) => ({
    id: p.id,
    label: pathIdToLabel[p.id],
    color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
    dash: DASH_PATTERNS[i % DASH_PATTERNS.length],
    shape: MARKER_SHAPES[i % MARKER_SHAPES.length],
    hidden: hiddenSeriesIds.has(p.id),
    points: points.map((row) => ({ x: row.n, y: row.paths ? row.paths[p.id] : null, converged: row.converged })),
  }));
  drawLineChart("pathChart", "pathTooltip", "pathLegend", pathSeries, {
    xLabel: t("sens_axis_n"), yLabel: t("sens_axis_coef"),
  });

  const pvalueSection = document.getElementById("sensPvalueSection");
  if (data.has_p_values) {
    pvalueSection.classList.remove("hidden");
    const pvalueSeries = data.paths.map((p, i) => ({
      id: "pval_" + p.id,
      label: pathIdToLabel[p.id],
      color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
      dash: DASH_PATTERNS[i % DASH_PATTERNS.length],
      shape: MARKER_SHAPES[i % MARKER_SHAPES.length],
      hidden: hiddenSeriesIds.has("pval_" + p.id),
      points: points.map((row) => ({ x: row.n, y: row.p_values ? row.p_values[p.id] : null, converged: row.converged })),
    }));
    drawLineChart("pvalueChart", "pvalueTooltip", "pvalueLegend", pvalueSeries, {
      yMin: 0, yMax: 1, yFormat: (v) => v.toFixed(3), refLine: 0.05,
      xLabel: t("sens_axis_n"), yLabel: t("sens_axis_pvalue"),
    });
  } else {
    pvalueSection.classList.add("hidden");
  }

  renderTable(points, data.constructs, data.paths, idToName, pathIdToLabel, data.has_p_values);
}

function renderTable(points, constructs, paths, idToName, pathIdToLabel, hasPValues) {
  let html = `<thead><tr><th>${t("sens_th_n")}</th><th>${t("sens_th_converged")}</th>`;
  constructs.forEach((c) => (html += `<th>R² ${escapeHtml(c.name)}</th>`));
  paths.forEach((p) => {
    html += `<th>${escapeHtml(pathIdToLabel[p.id])}</th>`;
    if (hasPValues) html += `<th>p (${escapeHtml(pathIdToLabel[p.id])})</th>`;
  });
  html += "</tr></thead><tbody>";
  for (const row of points) {
    html += `<tr><td>${row.n}</td><td>${row.converged ? t("sens_yes") : `<span class="badge warn">${t("sens_no")}</span>`}</td>`;
    constructs.forEach((c) => (html += `<td>${fmt(row.r_squared ? row.r_squared[c.id] : null)}</td>`));
    paths.forEach((p) => {
      html += `<td>${fmt(row.paths ? row.paths[p.id] : null)}</td>`;
      if (hasPValues) {
        const pv = row.p_values ? row.p_values[p.id] : null;
        if (pv === null || pv === undefined) {
          html += `<td>${t("lbl_dash")}</td>`;
        } else {
          const badgeClass = pv < 0.05 ? "ok" : "warn";
          html += `<td>${fmt(pv, 4)} <span class="badge ${badgeClass}">${pv < 0.05 ? t("lbl_significant") : t("lbl_not_significant")}</span></td>`;
        }
      }
    });
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById("sensTable").innerHTML = html;
}

// "box" (default -- shows the actual spread via a Tukey box plot) or
// "line" (each construct/path plotted across iteration number, reusing
// drawLineChart as-is) -- a per-page toggle the viewer can switch, kept
// as module state so it survives a language switch or window resize
// re-render within the same /sensitivity tab.
let resampleChartType = "box";

function renderResampleResults(data) {
  document.getElementById("sensLoading").classList.add("hidden");
  document.getElementById("sensContent").classList.remove("hidden");
  document.getElementById("sensPvalueSection").classList.add("hidden");

  const converged = data.points.filter((p) => p.converged);
  document.getElementById("sensSummary").textContent = t("sens_resample_summary_text", {
    method: data.method === "cbsem" ? "CB-SEM" : "PLS-SEM",
    n0: data.n_total,
    newN: data.new_n,
    nIter: data.n_iterations,
    conv: converged.length,
  });

  ensureChartTypeToggle();
  drawResampleCharts(data);

  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));
  const pathIdToLabel = {};
  data.paths.forEach((p) => (pathIdToLabel[p.id] = `${p.source_name} → ${p.target_name}`));
  renderResampleTable(data.points, data.constructs, data.paths, idToName, pathIdToLabel);
}

function ensureChartTypeToggle() {
  let toggle = document.getElementById("sensChartTypeToggle");
  if (!toggle) {
    toggle = document.createElement("div");
    toggle.id = "sensChartTypeToggle";
    toggle.className = "chart-type-switch";
    toggle.innerHTML = `
      <button type="button" class="chart-type-btn" data-type="box">${t("sens_chart_type_box")}</button>
      <button type="button" class="chart-type-btn" data-type="line">${t("sens_chart_type_line")}</button>`;
    // Placed inside .export-buttons (alongside the AI Report button) rather
    // than as its own block below the summary text, so the two sit in the
    // same flex row (and wrap together, via that container's own
    // flex-wrap) instead of the toggle visually shoving the button down
    // onto its own line.
    document.getElementById("sensAiReportBtn").closest(".export-buttons").insertAdjacentElement("afterbegin", toggle);
    toggle.querySelectorAll(".chart-type-btn").forEach((btn) => {
      btn.onclick = () => {
        resampleChartType = btn.dataset.type;
        toggle.querySelectorAll(".chart-type-btn").forEach((b) => b.classList.toggle("active", b === btn));
        if (window.__sensResult) drawResampleCharts(window.__sensResult);
      };
    });
  }
  toggle.querySelectorAll(".chart-type-btn").forEach((b) => b.classList.toggle("active", b.dataset.type === resampleChartType));
}

function drawResampleCharts(data) {
  const pathIdToLabel = {};
  data.paths.forEach((p) => (pathIdToLabel[p.id] = `${p.source_name} → ${p.target_name}`));

  // The two chart panel-cards are reused as-is from the shrinking-step mode
  // (same canvases, same DOM) -- only their heading/hint text changes to
  // describe whichever view is currently selected.
  const isLine = resampleChartType === "line";
  const hintKey = isLine ? "sens_resample_chart_hint_line" : "sens_resample_chart_hint";
  const r2Card = document.getElementById("r2Chart").closest(".panel-card");
  r2Card.querySelector("h2").textContent = t("sens_resample_r2_chart_title", { n: data.n_iterations, newN: data.new_n });
  r2Card.querySelector(".hint").textContent = t(hintKey);
  const pathCard = document.getElementById("pathChart").closest(".panel-card");
  pathCard.querySelector("h2").textContent = t("sens_resample_path_chart_title", { n: data.n_iterations, newN: data.new_n });
  pathCard.querySelector(".hint").textContent = t(hintKey);

  if (isLine) {
    const r2Series = data.constructs.map((c, i) => ({
      id: c.id,
      label: c.name,
      color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
      dash: DASH_PATTERNS[i % DASH_PATTERNS.length],
      shape: MARKER_SHAPES[i % MARKER_SHAPES.length],
      hidden: hiddenSeriesIds.has(c.id),
      points: data.points.map((p) => ({ x: p.iteration, y: p.r_squared ? p.r_squared[c.id] : null, converged: p.converged })),
    }));
    drawLineChart("r2Chart", "r2Tooltip", "r2Legend", r2Series, {
      yMin: 0, yMax: 1, yFormat: (v) => v.toFixed(2), xLabel: t("sens_th_iteration"), yLabel: "R²",
    });

    const pathSeries = data.paths.map((p, i) => ({
      id: p.id,
      label: pathIdToLabel[p.id],
      color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
      dash: DASH_PATTERNS[i % DASH_PATTERNS.length],
      shape: MARKER_SHAPES[i % MARKER_SHAPES.length],
      hidden: hiddenSeriesIds.has(p.id),
      points: data.points.map((row) => ({ x: row.iteration, y: row.paths ? row.paths[p.id] : null, converged: row.converged })),
    }));
    drawLineChart("pathChart", "pathTooltip", "pathLegend", pathSeries, {
      xLabel: t("sens_th_iteration"), yLabel: t("sens_axis_coef"),
    });
    return;
  }

  const converged = data.points.filter((p) => p.converged);
  const r2Series = data.constructs.map((c, i) => ({
    id: c.id,
    label: c.name,
    color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
    values: converged.map((p) => p.r_squared[c.id]),
  }));
  drawBoxPlot("r2Chart", "r2Tooltip", "r2Legend", r2Series, { yMin: 0, yMax: 1, yFormat: (v) => v.toFixed(2) });

  const pathSeries = data.paths.map((p, i) => ({
    id: p.id,
    label: pathIdToLabel[p.id],
    color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
    values: converged.map((row) => row.paths[p.id]),
  }));
  drawBoxPlot("pathChart", "pathTooltip", "pathLegend", pathSeries, {});
}

function renderResampleTable(points, constructs, paths, idToName, pathIdToLabel) {
  let html = `<thead><tr><th>${t("sens_th_iteration")}</th><th>${t("sens_th_converged")}</th>`;
  constructs.forEach((c) => (html += `<th>R² ${escapeHtml(c.name)}</th>`));
  paths.forEach((p) => (html += `<th>${escapeHtml(pathIdToLabel[p.id])}</th>`));
  html += "</tr></thead><tbody>";
  for (const row of points) {
    html += `<tr><td>${row.iteration}</td><td>${row.converged ? t("sens_yes") : `<span class="badge warn">${t("sens_no")}</span>`}</td>`;
    constructs.forEach((c) => (html += `<td>${fmt(row.r_squared ? row.r_squared[c.id] : null)}</td>`));
    paths.forEach((p) => (html += `<td>${fmt(row.paths ? row.paths[p.id] : null)}</td>`));
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById("sensTable").innerHTML = html;
}

// ---------------- reusable canvas line chart ----------------

function drawLineChart(canvasId, tooltipId, legendId, series, opts) {
  const canvas = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  const legendEl = document.getElementById(legendId);
  const wrap = canvas.parentElement;
  const cssWidth = wrap.clientWidth;
  const cssHeight = Math.max(280, Math.min(420, cssWidth * 0.42));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y).filter((v) => v !== null && v !== undefined));
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  let yMin = opts.yMin !== undefined ? opts.yMin : Math.min(0, ...allY);
  let yMax = opts.yMax !== undefined ? opts.yMax : Math.max(...allY);
  if (opts.yMin === undefined || opts.yMax === undefined) {
    const pad = (yMax - yMin) * 0.12 || 0.1;
    if (opts.yMin === undefined) yMin -= pad;
    if (opts.yMax === undefined) yMax += pad;
  }

  const PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 34;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const xOf = (x) => PAD_L + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
  const yOf = (y) => PAD_T + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  const yFormat = opts.yFormat || ((v) => v.toFixed(2));
  const yTickCount = 5;
  const xVals = [...new Set(allX)].sort((a, b) => a - b);
  const maxTicks = Math.max(4, Math.floor(plotW / 60));
  const tickEvery = Math.max(1, Math.ceil(xVals.length / maxTicks));

  // legend (always present for >=2 series) — color + dash pattern + marker
  // shape together, so identity never rests on color alone (print/CVD safe).
  // Also doubles as a click-to-toggle filter: clicking a series' legend
  // entry shows/hides just that line, so a crowded chart can be narrowed
  // down to the series actually being compared.
  legendEl.innerHTML = series
    .map((s, i) => `<button type="button" class="leg-item" data-series-index="${i}" aria-pressed="${!s.hidden}">${legendSwatchSvg(s)}${escapeHtml(s.label)}</button>`)
    .join("");
  legendEl.querySelectorAll(".leg-item").forEach((btn) => {
    btn.onclick = () => {
      const s = series[Number(btn.dataset.seriesIndex)];
      s.hidden = !s.hidden;
      if (s.hidden) hiddenSeriesIds.add(s.id);
      else hiddenSeriesIds.delete(s.id);
      btn.setAttribute("aria-pressed", String(!s.hidden));
      tooltip.classList.add("hidden");
      redrawWithCrosshair(null);
    };
  });

  // crosshair + tooltip
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < PAD_L || mx > PAD_L + plotW) {
      tooltip.classList.add("hidden");
      return;
    }
    const targetX = xMin + ((mx - PAD_L) / plotW) * (xMax - xMin);
    let nearest = xVals[0];
    let bestDist = Infinity;
    for (const xv of xVals) {
      const d = Math.abs(xv - targetX);
      if (d < bestDist) { bestDist = d; nearest = xv; }
    }
    redrawWithCrosshair(nearest);

    const rows = series
      .filter((s) => !s.hidden)
      .map((s) => {
        const p = s.points.find((pp) => pp.x === nearest);
        if (!p || p.y === null || p.y === undefined) return "";
        const glyph = SHAPE_GLYPH[s.shape] || "●";
        return `<div class="tt-row"><span class="tt-dot" style="color:${s.color}">${glyph}</span>${escapeHtml(s.label)}: <strong>${fmt(p.y)}</strong>${p.converged ? "" : ` (${t("sens_not_converged_short")})`}</div>`;
      })
      .join("");
    tooltip.innerHTML = `<div class="tt-title">${opts.xLabel} = ${nearest}</div>${rows}`;
    tooltip.classList.remove("hidden");
    const ttX = Math.min(xOf(nearest) + 12, cssWidth - tooltip.offsetWidth - 8);
    tooltip.style.left = Math.max(4, ttX) + "px";
    tooltip.style.top = "8px";
  };
  canvas.onmouseleave = () => {
    tooltip.classList.add("hidden");
    redrawWithCrosshair(null);
  };

  function redrawWithCrosshair(nearestX) {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = "#e1e0d9";
    ctx.fillStyle = "#898781";
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yTickCount; i++) {
      const yv = yMin + ((yMax - yMin) * i) / yTickCount;
      const yy = yOf(yv);
      ctx.beginPath();
      ctx.moveTo(PAD_L, yy);
      ctx.lineTo(PAD_L + plotW, yy);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(yFormat(yv), PAD_L - 8, yy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    xVals.forEach((xv, i) => {
      if (i % tickEvery !== 0 && i !== xVals.length - 1) return;
      ctx.fillText(String(xv), xOf(xv), PAD_T + plotH + 8);
    });
    ctx.strokeStyle = "#c3c2b7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, PAD_T + plotH);
    ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
    ctx.stroke();

    if (opts.refLine !== undefined) {
      const refY = yOf(opts.refLine);
      ctx.strokeStyle = "#d64545";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, refY);
      ctx.lineTo(PAD_L + plotW, refY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (nearestX !== null) {
      ctx.strokeStyle = "#c3c2b7";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xOf(nearestX), PAD_T);
      ctx.lineTo(xOf(nearestX), PAD_T + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const s of series) {
      if (s.hidden) continue;
      const pts = s.points.filter((p) => p.y !== null && p.y !== undefined);
      if (pts.length === 0) continue;
      // color + dash pattern + marker shape together identify a series, so
      // it still reads correctly with no color at all (print / CVD).
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const px = xOf(p.x), py = yOf(p.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of pts) {
        const px = xOf(p.x), py = yOf(p.y);
        const isNear = nearestX !== null && p.x === nearestX;
        const size = isNear ? 5.5 : (p.converged ? 3.5 : 5);
        drawMarker(ctx, s.shape, px, py, size, s.color);
        if (!p.converged) {
          ctx.strokeStyle = "#d03b3b";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (isNear) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
  }

  redrawWithCrosshair(null);
}

// ---------------- reusable canvas box plot (Tukey convention) ----------------
// One box per series, laid out left-to-right by category (construct/path
// name) rather than by a shared x-axis value like drawLineChart's -- each
// series here is a full distribution (many resample iterations), not a
// single point per x, so there is nothing to connect with a line and no
// legend is needed (the category label under each box already identifies
// it, unlike drawLineChart's overlapping same-x series).

function drawBoxPlot(canvasId, tooltipId, legendId, series, opts) {
  const canvas = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  document.getElementById(legendId).innerHTML = "";
  const wrap = canvas.parentElement;
  const cssWidth = wrap.clientWidth;
  const cssHeight = Math.max(280, Math.min(420, cssWidth * 0.42));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const boxes = series.map((s) => ({ ...s, stats: boxStats(s.values) })).filter((s) => s.stats);
  const allVals = boxes.flatMap((s) => [s.stats.min, s.stats.max, ...s.stats.outliers]);
  let yMin = opts.yMin !== undefined ? opts.yMin : Math.min(0, ...allVals);
  let yMax = opts.yMax !== undefined ? opts.yMax : Math.max(...allVals);
  if (opts.yMin === undefined || opts.yMax === undefined) {
    const pad = (yMax - yMin) * 0.12 || 0.1;
    if (opts.yMin === undefined) yMin -= pad;
    if (opts.yMax === undefined) yMax += pad;
  }

  const PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 34;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const yOf = (y) => PAD_T + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;
  const n = boxes.length || 1;
  const slot = plotW / n;
  const boxWidth = Math.min(46, slot * 0.5);
  const xOf = (i) => PAD_L + slot * (i + 0.5);
  const yFormat = opts.yFormat || ((v) => v.toFixed(2));
  const yTickCount = 5;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.strokeStyle = "#e1e0d9";
  ctx.fillStyle = "#898781";
  ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTickCount; i++) {
    const yv = yMin + ((yMax - yMin) * i) / yTickCount;
    const yy = yOf(yv);
    ctx.beginPath();
    ctx.moveTo(PAD_L, yy);
    ctx.lineTo(PAD_L + plotW, yy);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText(yFormat(yv), PAD_L - 8, yy);
  }
  ctx.strokeStyle = "#c3c2b7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T);
  ctx.lineTo(PAD_L, PAD_T + plotH);
  ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
  ctx.stroke();

  boxes.forEach((s, i) => {
    const cx = xOf(i);
    const st = s.stats;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color + "2e"; // translucent fill (hex alpha suffix)
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(cx, yOf(st.whiskerHi));
    ctx.lineTo(cx, yOf(st.q3));
    ctx.moveTo(cx, yOf(st.q1));
    ctx.lineTo(cx, yOf(st.whiskerLo));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - boxWidth * 0.25, yOf(st.whiskerHi));
    ctx.lineTo(cx + boxWidth * 0.25, yOf(st.whiskerHi));
    ctx.moveTo(cx - boxWidth * 0.25, yOf(st.whiskerLo));
    ctx.lineTo(cx + boxWidth * 0.25, yOf(st.whiskerLo));
    ctx.stroke();

    const boxTop = yOf(st.q3), boxBottom = yOf(st.q1);
    ctx.fillRect(cx - boxWidth / 2, boxTop, boxWidth, Math.max(1, boxBottom - boxTop));
    ctx.strokeRect(cx - boxWidth / 2, boxTop, boxWidth, Math.max(1, boxBottom - boxTop));

    ctx.beginPath();
    ctx.moveTo(cx - boxWidth / 2, yOf(st.median));
    ctx.lineTo(cx + boxWidth / 2, yOf(st.median));
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.lineWidth = 1.5;

    st.outliers.forEach((v) => drawMarker(ctx, "circle", cx, yOf(v), 3, s.color));

    ctx.fillStyle = "#5a5850";
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const label = s.label.length > 14 ? s.label.slice(0, 13) + "…" : s.label;
    ctx.fillText(label, cx, PAD_T + plotH + 8);
  });

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = Math.floor((mx - PAD_L) / slot);
    if (mx < PAD_L || i < 0 || i >= boxes.length) {
      tooltip.classList.add("hidden");
      return;
    }
    const s = boxes[i];
    const st = s.stats;
    tooltip.innerHTML = `<div class="tt-title">${escapeHtml(s.label)}</div>` +
      `<div class="tt-row">Max: <strong>${fmt(st.max)}</strong></div>` +
      `<div class="tt-row">Q3: <strong>${fmt(st.q3)}</strong></div>` +
      `<div class="tt-row">${t("sens_axis_median")}: <strong>${fmt(st.median)}</strong></div>` +
      `<div class="tt-row">Q1: <strong>${fmt(st.q1)}</strong></div>` +
      `<div class="tt-row">Min: <strong>${fmt(st.min)}</strong></div>` +
      `<div class="tt-row">n = ${st.n}</div>`;
    tooltip.classList.remove("hidden");
    tooltip.style.left = Math.max(4, Math.min(xOf(i) + 12, cssWidth - tooltip.offsetWidth - 8)) + "px";
    tooltip.style.top = "8px";
  };
  canvas.onmouseleave = () => tooltip.classList.add("hidden");
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!window.__sensResult) return;
    if (window.__sensJobMode === "resample") renderResampleResults(window.__sensResult);
    else renderAll(window.__sensResult);
  }, 200);
});

main();
