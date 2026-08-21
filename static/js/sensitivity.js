/* Sample-size sensitivity page: fetches /api/sensitivity for the job stashed
 * in sessionStorage by the results page, then renders two line charts (R² and
 * path coefficients vs. sample size) plus a data table. No charting library —
 * a small reusable canvas line-chart renderer, consistent with the rest of
 * this app (see diagram.js). */

const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_OTHER_COLOR = "#a9a8a2";

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
  if (window.__sensResult) renderAll(window.__sensResult);
});

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

  try {
    const res = await fetch("/api/sensitivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("sens_failed"));
    window.__sensResult = data;
    renderAll(data);
  } catch (err) {
    showError(err.message);
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
    points: points.map((row) => ({ x: row.n, y: row.paths ? row.paths[p.id] : null, converged: row.converged })),
  }));
  drawLineChart("pathChart", "pathTooltip", "pathLegend", pathSeries, {
    xLabel: t("sens_axis_n"), yLabel: t("sens_axis_coef"),
  });

  renderTable(points, data.constructs, data.paths, idToName, pathIdToLabel);
}

function renderTable(points, constructs, paths, idToName, pathIdToLabel) {
  let html = `<thead><tr><th>${t("sens_th_n")}</th><th>${t("sens_th_converged")}</th>`;
  constructs.forEach((c) => (html += `<th>R² ${escapeHtml(c.name)}</th>`));
  paths.forEach((p) => (html += `<th>${escapeHtml(pathIdToLabel[p.id])}</th>`));
  html += "</tr></thead><tbody>";
  for (const row of points) {
    html += `<tr><td>${row.n}</td><td>${row.converged ? t("sens_yes") : `<span class="badge warn">${t("sens_no")}</span>`}</td>`;
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

  // legend (always present for >=2 series)
  legendEl.innerHTML = series
    .map((s) => `<div class="leg-item"><span class="leg-swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}</div>`)
    .join("");

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
      .map((s) => {
        const p = s.points.find((pp) => pp.x === nearest);
        if (!p || p.y === null || p.y === undefined) return "";
        return `<div class="tt-row"><span class="tt-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}: <strong>${fmt(p.y)}</strong>${p.converged ? "" : ` (${t("sens_not_converged_short")})`}</div>`;
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
      const pts = s.points.filter((p) => p.y !== null && p.y !== undefined);
      if (pts.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach((p, i) => {
        const px = xOf(p.x), py = yOf(p.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      for (const p of pts) {
        const px = xOf(p.x), py = yOf(p.y);
        const isNear = nearestX !== null && p.x === nearestX;
        ctx.beginPath();
        ctx.arc(px, py, isNear ? 5 : (p.converged ? 3 : 4.5), 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
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

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.__sensResult) renderAll(window.__sensResult);
  }, 200);
});

main();
