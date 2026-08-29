/* Monte Carlo power analysis page: fetches /api/power_analysis for the job
 * stashed in sessionStorage by the results page, then renders a power-curve
 * chart (n vs. % of Monte Carlo replicates where each path came out
 * significant) plus a details table. Chart code is a close adaptation of
 * sensitivity.js's drawLineChart (devicePixelRatio-aware canvas, hover
 * crosshair/tooltip, click-to-toggle legend) — copied rather than shared
 * since each page-specific script is loaded standalone, same as this app's
 * existing split between app.js and sensitivity.js. */

const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_OTHER_COLOR = "#a9a8a2";
const DASH_PATTERNS = [[], [7, 4], [1, 3], [9, 3, 2, 3], [4, 2], [10, 3, 1, 3, 1, 3], [2, 2], [12, 3]];
const MARKER_SHAPES = ["circle", "square", "triangle", "diamond", "circle", "square", "triangle", "diamond"];
const SHAPE_GLYPH = { circle: "●", square: "■", triangle: "▲", diamond: "◆" };
const POWER_THRESHOLD = 0.8;

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
  if (window.__powerResult) renderAll(window.__powerResult);
});
document.getElementById("powerAiReportBtn").addEventListener("click", () => {
  if (!window.__powerResult) return;
  const data = window.__powerResult;
  openAiReportModal({
    context: buildPowerReportContext(data),
    sourceLabel: `${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"} Power Analysis — n_mc = ${data.n_mc}`,
    defaultPrompt: t("ai_modal_prompt_default_power"),
  });
});

function buildPowerReportContext(data) {
  const lines = [];
  lines.push(`## Monte Carlo Power Analysis (${data.method === "cbsem" ? "CB-SEM" : "PLS-SEM"})`);
  lines.push(`n_mc replicates per point = ${data.n_mc}${data.n_boot_inner ? `, inner bootstrap resamples = ${data.n_boot_inner}` : ""}, sample sizes tested: ${data.sample_sizes.join(", ")}`);
  lines.push(`Power threshold convention: 0.8 (80%) is considered adequate.`);
  lines.push("");
  lines.push("## Power by path and sample size");
  lines.push("| Path | n | Declared/estimated coefficient | Power | Converged replicates |");
  lines.push("|---|---|---|---|---|");
  data.points.forEach((p) => {
    lines.push(`| ${p.source_name}->${p.target_name} | ${p.n} | ${fmt(p.mean_estimate)} | ${fmt(p.power, 4)} | ${p.n_converged}/${p.n_replicates} |`);
  });
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? t("lbl_dash") : Number(v).toFixed(digits);
}

async function main() {
  const raw = sessionStorage.getItem("websem_power_job");
  if (!raw) {
    showError(t("power_no_job"));
    return;
  }
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    showError(t("power_no_job"));
    return;
  }

  let stopEta = null;
  if (job.estimated_seconds) {
    const etaEl = document.getElementById("powerLoadingEta");
    etaEl.classList.remove("hidden");
    stopEta = startEtaCountdown(etaEl, job.estimated_seconds);
  }

  try {
    const res = await fetch("/api/power_analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("power_failed"));
    window.__powerResult = data;
    renderAll(data);
  } catch (err) {
    showError(err.message);
  } finally {
    if (stopEta) stopEta();
  }
}

function showError(msg) {
  document.getElementById("powerLoading").classList.add("hidden");
  const box = document.getElementById("powerError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function pathKey(p) {
  return `${p.source}->${p.target}`;
}

function renderAll(data) {
  document.getElementById("powerLoading").classList.add("hidden");
  document.getElementById("powerContent").classList.remove("hidden");

  const byPath = {};
  for (const p of data.points) {
    const key = pathKey(p);
    if (!byPath[key]) byPath[key] = { source: p.source, target: p.target, source_name: p.source_name, target_name: p.target_name, rows: [] };
    byPath[key].rows.push(p);
  }
  const pathKeys = Object.keys(byPath);
  pathKeys.forEach((k) => byPath[k].rows.sort((a, b) => a.n - b.n));

  const minNFor80 = pathKeys.map((k) => {
    const hit = byPath[k].rows.find((r) => r.power >= POWER_THRESHOLD);
    return hit ? String(hit.n) : t("power_not_reached");
  });
  document.getElementById("powerSummary").textContent = t(
    data.method === "cbsem" ? "power_summary_text_cbsem" : "power_summary_text_pls",
    {
      nPaths: pathKeys.length,
      nSizes: data.sample_sizes.length,
      nMc: data.n_mc,
      nBoot: data.n_boot_inner,
      minN: minNFor80.join(", "),
    }
  );

  const series = pathKeys.map((k, i) => ({
    id: k,
    label: `${byPath[k].source_name} → ${byPath[k].target_name}`,
    color: SERIES_COLORS[i] || SERIES_OTHER_COLOR,
    dash: DASH_PATTERNS[i % DASH_PATTERNS.length],
    shape: MARKER_SHAPES[i % MARKER_SHAPES.length],
    hidden: hiddenSeriesIds.has(k),
    points: byPath[k].rows.map((r) => ({ x: r.n, y: r.power * 100, converged: r.n_converged > 0 })),
  }));
  drawPowerChart("powerChart", "powerTooltip", "powerLegend", series, {
    xLabel: t("power_axis_n"), yLabel: t("power_axis_power"),
  });

  renderTable(byPath, pathKeys);
}

function renderTable(byPath, pathKeys) {
  let html = `<thead><tr><th>${t("power_th_n")}</th><th>${t("power_th_path")}</th>` +
    `<th>${t("power_th_power")}</th><th>${t("power_th_converged")}</th><th>${t("power_th_mean_estimate")}</th></tr></thead><tbody>`;
  for (const k of pathKeys) {
    const { source_name, target_name, rows } = byPath[k];
    for (const row of rows) {
      const powerCell = row.power >= POWER_THRESHOLD
        ? `<span class="badge ok">${(row.power * 100).toFixed(0)}%</span>`
        : `${(row.power * 100).toFixed(0)}%`;
      html += `<tr><td>${row.n}</td><td>${escapeHtml(source_name)} → ${escapeHtml(target_name)}</td>` +
        `<td>${powerCell}</td><td>${row.n_converged}/${row.n_replicates}</td><td>${fmt(row.mean_estimate)}</td></tr>`;
    }
  }
  html += "</tbody>";
  document.getElementById("powerTable").innerHTML = html;
}

// ---------------- power-curve canvas chart ----------------

function drawPowerChart(canvasId, tooltipId, legendId, series, opts) {
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
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = 0, yMax = 100;

  const PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 34;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const xOf = (x) => PAD_L + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
  const yOf = (y) => PAD_T + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const yTickCount = 5;
  const xVals = [...new Set(allX)].sort((a, b) => a - b);
  const maxTicks = Math.max(4, Math.floor(plotW / 60));
  const tickEvery = Math.max(1, Math.ceil(xVals.length / maxTicks));

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
        if (!p) return "";
        const glyph = SHAPE_GLYPH[s.shape] || "●";
        return `<div class="tt-row"><span class="tt-dot" style="color:${s.color}">${glyph}</span>${escapeHtml(s.label)}: <strong>${p.y.toFixed(0)}%</strong></div>`;
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
      ctx.fillText(yv.toFixed(0) + "%", PAD_L - 8, yy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    xVals.forEach((xv, i) => {
      if (i % tickEvery !== 0 && i !== xVals.length - 1) return;
      ctx.fillText(String(xv), xOf(xv), PAD_T + plotH + 8);
    });
    ctx.fillText(opts.xLabel, PAD_L + plotW / 2, PAD_T + plotH + 20);

    // 80% power reference line — the conventional adequacy threshold
    // (Cohen, 1988), shown so a curve crossing it is visually obvious.
    const refY = yOf(POWER_THRESHOLD * 100);
    ctx.strokeStyle = "#c3c2b7";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD_L, refY);
    ctx.lineTo(PAD_L + plotW, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#c3c2b7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, PAD_T + plotH);
    ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
    ctx.stroke();

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
      const pts = s.points;
      if (pts.length === 0) continue;
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
        drawMarker(ctx, s.shape, px, py, isNear ? 5.5 : 3.5, s.color);
        if (isNear) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
  }

  redrawWithCrosshair(null);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.__powerResult) renderAll(window.__powerResult);
  }, 200);
});

main();
