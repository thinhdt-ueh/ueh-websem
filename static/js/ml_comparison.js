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
}

// ---------------- top: SEM vs. ML comparison, per target ----------------

function renderComparisonSection(data) {
  const container = document.getElementById("mlComparisonContainer");
  container.innerHTML = `
    <div class="table-scroll"><table id="mlCompTableAll"></table></div>
    <div class="ml-comparison-charts">
      ${data.targets.map((tr) => `
        <div class="ml-target-block">
          <h3>${cellTrunc(tr.target_name, 260)} <span class="hint">(n = ${tr.n_obs})</span></h3>
          <div class="chart-wrap">
            <canvas id="mlCompChart_${tr.target_id}"></canvas>
            <div id="mlCompTooltip_${tr.target_id}" class="chart-tooltip hidden"></div>
          </div>
          <div id="mlCompLegend_${tr.target_id}" class="chart-legend"></div>
        </div>
      `).join("")}
    </div>
  `;

  renderComparisonTableAll(data.targets, data.algorithms);
  data.targets.forEach((tr) => renderComparisonChart(tr, data.algorithms));
}

function renderComparisonTableAll(targets, algorithmIds) {
  let html = `<thead><tr><th>${t("ml_th_target")}</th><th>${t("ml_th_predictor")}</th><th>${t("ml_th_sem_coef")}</th>`;
  algorithmIds.forEach((a) => (html += `<th>${cellTrunc(algoLabel(a), 130)}</th>`));
  html += "</tr></thead><tbody>";
  targets.forEach((tr) => {
    tr.predictors.forEach((p, pi) => {
      html += "<tr>";
      if (pi === 0) {
        html += `<td rowspan="${tr.predictors.length}" class="ml-target-cell">${cellTrunc(tr.target_name, 160)}</td>`;
      }
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
  }];
  algorithmIds.forEach((a, i) => {
    const raw = rawByAlgo[i];
    series.push({
      id: a, label: algoLabel(a), color: SERIES_COLORS[i % SERIES_COLORS.length],
      values: raw.map((v) => (v === null ? 0 : v / maxAbs)),
      raw,
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

  legendEl.innerHTML = series.map((s) =>
    `<span class="leg-item" style="cursor:default"><svg class="leg-swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" fill="${s.color}"/></svg>${escapeHtml(s.label)}</span>`,
  ).join("");

  const allVals = series.flatMap((s) => s.values);
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
  const barW = Math.min(26, groupW / (series.length + 1.2));

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
      const totalW = barW * series.length;
      const startX = groupCenterX - totalW / 2;
      series.forEach((s, si) => {
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
    const s = series[hit.seriesIndex];
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
