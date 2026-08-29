/* Post-SEM Machine Learning comparison page: fetches /api/ml_compare for the
 * job stashed in sessionStorage by the results page, then renders, per
 * endogenous target construct, a grouped bar chart + table comparing the SEM
 * path coefficient against each selected algorithm's permutation importance,
 * followed by a collapsible per-algorithm detail section (fit metrics + full
 * native/permutation importance ranking). No charting library — same small
 * canvas-chart approach as sensitivity.js/power_analysis.js. */

const SERIES_COLORS = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4",
  "#008300", "#4a3aa7", "#e34948", "#8a4fbb", "#c9862f",
];
const SEM_COLOR = "#41403a";

const ALGO_LABEL_KEY = {
  linreg: "ml_algo_linreg", logreg: "ml_algo_logreg", dtree: "ml_algo_dtree", rf: "ml_algo_rf",
  svm: "ml_algo_svm", gbm: "ml_algo_gbm", xgboost: "ml_algo_xgboost",
  lightgbm: "ml_algo_lightgbm", catboost: "ml_algo_catboost",
};

// Clicking a series' name in any chart's legend hides/shows its bars in
// EVERY target's chart at once (series ids -- "sem" plus each algorithm id
// -- are shared across charts). Kept at module scope so the toggle survives
// a re-render (window resize, language switch).
const hiddenSeriesIds = new Set();

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
  if (window.__mlResult) renderAll(window.__mlResult);
});
document.getElementById("mlExportExcelBtn").addEventListener("click", () => exportMlReport("excel"));
document.getElementById("mlExportWordBtn").addEventListener("click", () => exportMlReport("word"));
document.getElementById("mlAiReportBtn").addEventListener("click", () => {
  if (!window.__mlResult) return;
  const data = window.__mlResult;
  openAiReportModal({
    context: buildMlReportContext(data),
    sourceLabel: `${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"} ML Comparison — k = ${data.k}, algorithms: ${data.algorithms.map(algoLabel).join(", ")}`,
    defaultPrompt: t("ai_modal_prompt_default_mlcompare"),
    images: captureMlChartImages(data),
  });
});

function captureMlChartImages(data) {
  return data.targets
    .map((tr) => {
      const canvas = document.getElementById(`mlCompChart_${tr.target_id}`);
      if (!canvas || !canvas.width || !canvas.height) return null;
      return { label: t("ai_image_ml_chart", { target: tr.target_name }), dataUrl: canvas.toDataURL("image/png") };
    })
    .filter(Boolean);
}

function buildMlReportContext(data) {
  const lines = [];
  lines.push(`## Machine Learning Comparison (${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"})`);
  lines.push(`k-fold = ${data.k}, algorithms: ${data.algorithms.map(algoLabel).join(", ")}`);

  lines.push("");
  lines.push("## SEM path coefficient vs. permutation importance, per target");
  lines.push(`| Target | Predictor | SEM coefficient | ${data.algorithms.map(algoLabel).join(" | ")} |`);
  lines.push(`|---|---|---|${data.algorithms.map(() => "---").join("|")}|`);
  data.targets.forEach((tr) => {
    tr.predictors.forEach((p) => {
      const cells = data.algorithms.map((a) => {
        const ao = tr.algorithms[a];
        const pi = ao ? ao.permutation_importance[p.id] : null;
        return pi ? fmt(pi.mean) : "—";
      });
      lines.push(`| ${tr.target_name} | ${p.name} | ${fmt(p.sem_coefficient)} | ${cells.join(" | ")} |`);
    });
  });

  lines.push("");
  lines.push("## Per-algorithm fit metrics");
  data.algorithms.forEach((a) => {
    lines.push(`### ${algoLabel(a)}`);
    data.targets.forEach((tr) => {
      const ao = tr.algorithms[a];
      if (!ao) return;
      if (ao.task === "classification") {
        lines.push(`- ${tr.target_name}: Accuracy = ${fmt(ao.metrics.accuracy && ao.metrics.accuracy.mean)}, AUC = ${fmt(ao.metrics.auc && ao.metrics.auc.mean)}`);
      } else {
        lines.push(`- ${tr.target_name}: R² = ${fmt(ao.metrics.r2 && ao.metrics.r2.mean)}, RMSE = ${fmt(ao.metrics.rmse && ao.metrics.rmse.mean)}`);
      }
    });
  });

  return lines.join("\n");
}

async function exportMlReport(kind) {
  if (!window.__mlResult) return;
  const btn = document.getElementById(kind === "excel" ? "mlExportExcelBtn" : "mlExportWordBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("s3_generating_file");
  document.getElementById("mlExportError").classList.add("hidden");
  try {
    const res = await fetch(`/api/ml_compare/export/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...window.__mlResult, lang: getLang() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("s3_export_failed"));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "excel" ? "ML_Comparison_Report.xlsx" : "ML_Comparison_Report.docx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    const box = document.getElementById("mlExportError");
    box.textContent = err.message;
    box.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? t("lbl_dash") : Number(v).toFixed(digits);
}

function algoLabel(algoId) {
  return t(ALGO_LABEL_KEY[algoId] || algoId);
}

// Truncates long construct/algorithm names with a CSS ellipsis instead of
// letting them wrap or overflow raggedly inside a narrow table column or
// chart heading -- the full name is still available on hover via `title`.
function cellTrunc(text, maxWidth) {
  const s = escapeHtml(text);
  const style = maxWidth ? ` style="max-width:${maxWidth}px"` : "";
  return `<span class="cell-trunc"${style} title="${s}">${s}</span>`;
}

async function main() {
  const raw = sessionStorage.getItem("websem_ml_job");
  if (!raw) {
    showError(t("ml_no_job"));
    return;
  }
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    showError(t("ml_no_job"));
    return;
  }

  let stopEta = null;
  if (job.estimated_seconds) {
    const etaEl = document.getElementById("mlLoadingEta");
    etaEl.classList.remove("hidden");
    stopEta = startEtaCountdown(etaEl, job.estimated_seconds);
  }

  try {
    const res = await fetch("/api/ml_compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("ml_failed"));
    window.__mlResult = data;
    renderAll(data);
  } catch (err) {
    showError(err.message);
  } finally {
    if (stopEta) stopEta();
  }
}

function showError(msg) {
  document.getElementById("mlLoading").classList.add("hidden");
  const box = document.getElementById("mlError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function renderAll(data) {
  document.getElementById("mlLoading").classList.add("hidden");
  document.getElementById("mlContent").classList.remove("hidden");

  document.getElementById("mlSummary").textContent = t("ml_summary_text", {
    method: data.method === "cbsem" ? "CB-SEM" : "PLS-SEM",
    nTargets: data.targets.length,
    nAlgos: data.algorithms.length,
    k: data.k,
  });

  renderComparisonSection(data);
  renderDetailSection(data);
  renderSourceTransparency(data.source_transparency);
}

function renderSourceTransparency(sections) {
  const container = document.getElementById("mlSourceTransparency");
  container.innerHTML = (sections || [])
    .map((s, i) => `
      <details${i === 0 ? " open" : ""}>
        <summary>${escapeHtml(t(s.key))}</summary>
        <pre><code>${escapeHtml(s.code)}</code></pre>
      </details>
    `)
    .join("");
}

// ---------------- top: SEM vs. ML comparison, per target ----------------

function renderComparisonSection(data) {
  renderComparisonTableAll(data.targets, data.algorithms);

  const chartsContainer = document.getElementById("mlComparisonChartsContainer");
  chartsContainer.innerHTML = data.targets.map((tr) => `
    <div class="panel-card ml-target-block">
      <h3>${cellTrunc(tr.target_name, 320)} <span class="hint">(n = ${tr.n_obs})</span></h3>
      <div class="chart-wrap">
        <canvas id="mlCompChart_${tr.target_id}"></canvas>
        <div id="mlCompTooltip_${tr.target_id}" class="chart-tooltip hidden"></div>
      </div>
      <div id="mlCompLegend_${tr.target_id}" class="chart-legend"></div>
    </div>
  `).join("");
  data.targets.forEach((tr) => renderComparisonChart(tr, data.algorithms));
}

function renderComparisonTableAll(targets, algorithmIds) {
  let html = `<thead><tr><th>${t("ml_th_target")}</th><th>${t("ml_th_predictor")}</th><th>${t("ml_th_sem_coef")}</th>`;
  algorithmIds.forEach((a) => (html += `<th>${cellTrunc(algoLabel(a), 130)}</th>`));
  html += "</tr></thead><tbody>";
  targets.forEach((tr) => {
    tr.predictors.forEach((p) => {
      html += "<tr>";
      html += `<td>${cellTrunc(tr.target_name, 160)}</td>`;
      html += `<td>${cellTrunc(p.name, 160)}</td><td>${fmt(p.sem_coefficient)}</td>`;
      algorithmIds.forEach((a) => {
        const ao = tr.algorithms[a];
        const pi2 = ao ? ao.permutation_importance[p.id] : null;
        html += `<td>${pi2 ? `${fmt(pi2.mean)} <span class="hint">(±${fmt(pi2.std, 3)})</span>` : t("lbl_dash")}</td>`;
      });
      html += "</tr>";
    });
  });
  html += "</tbody>";
  document.getElementById("mlCompTableAll").innerHTML = html;
}

function renderComparisonChart(tr, algorithmIds) {
  const groupLabels = tr.predictors.map((p) => p.name);

  // Importance is normalized by a SINGLE shared scale across every selected
  // algorithm for this target (not per algorithm) -- normalizing each
  // algorithm to its own max would force every algorithm's most-important
  // predictor to the same bar height regardless of how much more (or less)
  // confidently that algorithm actually predicts the target, which defeats
  // the whole point of comparing algorithms side by side (most visibly with
  // a single predictor, where every algorithm would render identically).
  const rawByAlgo = algorithmIds.map((a) => {
    const ao = tr.algorithms[a];
    return tr.predictors.map((p) => (ao && ao.permutation_importance[p.id] ? ao.permutation_importance[p.id].mean : null));
  });
  const allImportanceVals = rawByAlgo.flat().filter((v) => v !== null);
  const maxAbs = Math.max(1e-9, ...allImportanceVals.map((v) => Math.abs(v)));

  const series = [{
    id: "sem", label: "SEM", color: SEM_COLOR,
    values: tr.predictors.map((p) => (p.sem_coefficient === null || p.sem_coefficient === undefined ? 0 : p.sem_coefficient)),
    raw: tr.predictors.map((p) => p.sem_coefficient),
    hidden: hiddenSeriesIds.has("sem"),
  }];
  algorithmIds.forEach((a, i) => {
    const raw = rawByAlgo[i];
    series.push({
      id: a, label: algoLabel(a), color: SERIES_COLORS[i % SERIES_COLORS.length],
      values: raw.map((v) => (v === null ? 0 : v / maxAbs)),
      raw,
      hidden: hiddenSeriesIds.has(a),
    });
  });
  drawGroupedBarChart(
    `mlCompChart_${tr.target_id}`, `mlCompTooltip_${tr.target_id}`, `mlCompLegend_${tr.target_id}`,
    groupLabels, series,
  );
}

function drawGroupedBarChart(canvasId, tooltipId, legendId, groupLabels, series) {
  const canvas = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  const legendEl = document.getElementById(legendId);
  const wrap = canvas.parentElement;
  const cssWidth = wrap.clientWidth;
  const cssHeight = Math.max(240, Math.min(360, cssWidth * 0.32));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Clicking a legend entry hides/shows that series' bars in every target's
  // chart at once (a full re-render keeps all charts + the toggle state in
  // sync, same cost as the resize handler already does).
  legendEl.innerHTML = series.map((s) =>
    `<button type="button" class="leg-item" data-series-id="${escapeHtml(s.id)}" aria-pressed="${!s.hidden}"><svg class="leg-swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" fill="${s.color}"/></svg>${escapeHtml(s.label)}</button>`,
  ).join("");
  legendEl.querySelectorAll(".leg-item").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.seriesId;
      if (hiddenSeriesIds.has(id)) hiddenSeriesIds.delete(id);
      else hiddenSeriesIds.add(id);
      if (window.__mlResult) renderComparisonSection(window.__mlResult);
    };
  });

  const visibleSeries = series.filter((s) => !s.hidden);
  const allVals = visibleSeries.flatMap((s) => s.values);
  const maxAbs = Math.max(0.1, ...allVals.map((v) => Math.abs(v)));
  const yMax = maxAbs * 1.15;
  const yMin = -yMax;

  const PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 46;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const yOf = (v) => PAD_T + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const zeroY = yOf(0);

  const groupCount = groupLabels.length;
  const groupW = plotW / Math.max(1, groupCount);
  const barW = Math.min(26, groupW / (visibleSeries.length + 1.2));

  const barRects = []; // {x,y,w,h,groupIndex,seriesIndex}

  function render(hoverRect) {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = "#e1e0d9";
    ctx.fillStyle = "#898781";
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yTickCount = 4;
    for (let i = 0; i <= yTickCount; i++) {
      const yv = yMin + ((yMax - yMin) * i) / yTickCount;
      const yy = yOf(yv);
      ctx.beginPath();
      ctx.moveTo(PAD_L, yy);
      ctx.lineTo(PAD_L + plotW, yy);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(yv.toFixed(2), PAD_L - 8, yy);
    }

    barRects.length = 0;
    groupLabels.forEach((label, gi) => {
      const groupCenterX = PAD_L + gi * groupW + groupW / 2;
      const totalW = barW * visibleSeries.length;
      const startX = groupCenterX - totalW / 2;
      visibleSeries.forEach((s, si) => {
        const v = s.values[gi];
        const bx = startX + si * barW;
        const by = yOf(v);
        const top = Math.min(by, zeroY);
        const h = Math.abs(by - zeroY);
        const rect = { x: bx, y: top, w: barW - 2, h, groupIndex: gi, seriesIndex: si };
        barRects.push(rect);
        const isHover = hoverRect && hoverRect.groupIndex === gi && hoverRect.seriesIndex === si;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = isHover ? 1 : 0.88;
        ctx.fillRect(rect.x, rect.y, rect.w, Math.max(1, rect.h));
        ctx.globalAlpha = 1;
      });
      ctx.fillStyle = "#41403a";
      ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label2 = label.length > 16 ? label.slice(0, 15) + "…" : label;
      ctx.fillText(label2, groupCenterX, PAD_T + plotH + 8);
    });

    ctx.strokeStyle = "#c3c2b7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, zeroY);
    ctx.lineTo(PAD_L + plotW, zeroY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, PAD_T + plotH);
    ctx.stroke();
  }
  render(null);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = barRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= Math.min(r.y, zeroY) && my <= Math.max(r.y + r.h, zeroY));
    if (!hit) {
      tooltip.classList.add("hidden");
      render(null);
      return;
    }
    render(hit);
    const s = visibleSeries[hit.seriesIndex];
    const rawVal = s.raw[hit.groupIndex];
    const label = s.id === "sem"
      ? `${t("ml_th_sem_coef")}: <strong>${fmt(rawVal)}</strong>`
      : `${escapeHtml(s.label)}: <strong>${fmt(rawVal)}</strong> <span class="hint">(${t("ml_tooltip_normalized")})</span>`;
    tooltip.innerHTML = `<div class="tt-title">${escapeHtml(groupLabels[hit.groupIndex])}</div><div class="tt-row">${label}</div>`;
    tooltip.classList.remove("hidden");
    tooltip.style.left = Math.min(mx + 12, cssWidth - tooltip.offsetWidth - 8) + "px";
    tooltip.style.top = "8px";
  };
  canvas.onmouseleave = () => {
    tooltip.classList.add("hidden");
    render(null);
  };
}

// ---------------- bottom: per-algorithm detail ----------------

function renderDetailSection(data) {
  const container = document.getElementById("mlDetailContainer");
  container.innerHTML = `<div class="ml-detail">${data.algorithms.map((algoId, i) => {
    const task = data.targets.find((tr) => tr.algorithms[algoId])?.algorithms[algoId]?.task;
    const badgeKey = task === "classification" ? "ml_badge_classification" : "ml_badge_regression";
    return `
    <details${i === 0 ? " open" : ""}>
      <summary>${escapeHtml(algoLabel(algoId))} <span class="ml-task-badge">${t(badgeKey)}</span></summary>
      <div class="ml-detail-body">
        ${task === "classification" ? `<p class="hint">${t("ml_logreg_inline_note")}</p>` : ""}
        <div class="table-scroll"><table id="mlDetailMetrics_${algoId}"></table></div>
        <div class="table-scroll" style="margin-top:10px"><table id="mlDetailImportance_${algoId}"></table></div>
      </div>
    </details>
  `;
  }).join("")}</div>`;

  data.algorithms.forEach((algoId) => {
    renderDetailMetricsTable(algoId, data.targets);
    renderDetailImportanceTable(algoId, data.targets);
  });
}

function renderDetailMetricsTable(algoId, targets) {
  const task = targets.find((tr) => tr.algorithms[algoId])?.algorithms[algoId]?.task;
  let html;
  if (task === "classification") {
    html = `<thead><tr><th>${t("ml_th_target")}</th><th>${t("ml_th_accuracy")}</th><th>${t("ml_th_auc")}</th></tr></thead><tbody>`;
    targets.forEach((tr) => {
      const ao = tr.algorithms[algoId];
      const acc = ao.metrics.accuracy, auc = ao.metrics.auc;
      html += `<tr><td>${cellTrunc(tr.target_name, 200)}</td>` +
        `<td>${acc ? `${fmt(acc.mean)} <span class="hint">(±${fmt(acc.std, 3)})</span>` : t("lbl_dash")}</td>` +
        `<td>${auc ? `${fmt(auc.mean)} <span class="hint">(±${fmt(auc.std, 3)})</span>` : t("lbl_dash")}</td></tr>`;
    });
  } else {
    html = `<thead><tr><th>${t("ml_th_target")}</th><th>R²</th><th>RMSE</th></tr></thead><tbody>`;
    targets.forEach((tr) => {
      const ao = tr.algorithms[algoId];
      const r2 = ao.metrics.r2, rmse = ao.metrics.rmse;
      html += `<tr><td>${cellTrunc(tr.target_name, 200)}</td>` +
        `<td>${r2 ? `${fmt(r2.mean)} <span class="hint">(±${fmt(r2.std, 3)})</span>` : t("lbl_dash")}</td>` +
        `<td>${rmse ? `${fmt(rmse.mean)} <span class="hint">(±${fmt(rmse.std, 3)})</span>` : t("lbl_dash")}</td></tr>`;
    });
  }
  html += "</tbody>";
  document.getElementById(`mlDetailMetrics_${algoId}`).innerHTML = html;
}

function renderDetailImportanceTable(algoId, targets) {
  let html = `<thead><tr><th>${t("ml_th_target")}</th><th>${t("ml_th_predictor")}</th>` +
    `<th>${t("ml_th_native_importance")}</th><th>${t("ml_th_permutation_importance")}</th></tr></thead><tbody>`;
  targets.forEach((tr) => {
    const ao = tr.algorithms[algoId];
    tr.predictors.forEach((p) => {
      const native = ao.native_importance ? ao.native_importance[p.id] : null;
      const perm = ao.permutation_importance[p.id];
      html += `<tr><td>${cellTrunc(tr.target_name, 160)}</td><td>${cellTrunc(p.name, 160)}</td>` +
        `<td>${native === null || native === undefined ? t("lbl_dash") : fmt(native)}</td>` +
        `<td>${perm ? `${fmt(perm.mean)} <span class="hint">(±${fmt(perm.std, 3)})</span>` : t("lbl_dash")}</td></tr>`;
    });
  });
  html += "</tbody>";
  document.getElementById(`mlDetailImportance_${algoId}`).innerHTML = html;
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.__mlResult) renderComparisonSection(window.__mlResult);
  }, 200);
});

main();
