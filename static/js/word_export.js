// Shared "📄 Export Word" handler for the standalone analysis pages (Power
// Analysis, Sample Size Sensitivity): posts the result the page already holds
// (plus chart snapshots) to the page's export endpoint and downloads the
// returned .docx -- same flow as exportMlReport() in ml_comparison.js.
async function downloadWordReport({ url, body, filename, button, errorBox }) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = t("s3_generating_file");
  errorBox.classList.add("hidden");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, lang: getLang() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("s3_export_failed"));
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

// Chart snapshot for the Word export and AI report: the chart canvas plus its
// legend. The on-page legend is HTML (clickable to toggle series), so a bare
// canvas.toDataURL() leaves it out; draw* functions stash their series on
// the canvas (canvas.__legendSeries) and this redraws the legend for the
// visible series -- line in the series' color/dash, marker shape, label --
// on a canvas below the chart, over the page's panel background so the
// chart's own text colors stay legible in either theme.
function chartImageDataUrl(canvas) {
  const series = (canvas.__legendSeries || []).filter((s) => !s.hidden);
  if (!series.length) return withBackground(canvas, 0).toDataURL("image/png");

  const scale = canvas.width / (canvas.clientWidth || canvas.width);
  const cssWidth = canvas.width / scale;
  const font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
  const PAD = 14, ROW_H = 24, SWATCH = 22, GAP = 18;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;

  const rows = [[]];
  let rowWidth = 0;
  series.forEach((s) => {
    const w = SWATCH + 6 + 12 + 6 + measure.measureText(s.label).width;
    if (rowWidth && rowWidth + GAP + w > cssWidth - PAD * 2) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1].push({ s, w });
    rowWidth += (rowWidth ? GAP : 0) + w;
  });

  const legendH = rows.length * ROW_H + PAD;
  const out = withBackground(canvas, legendH * scale);
  const ctx = out.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.font = font;
  ctx.textBaseline = "middle";
  const textColor = getComputedStyle(canvas.closest(".panel-card") || document.body).color;
  rows.forEach((row, r) => {
    const total = row.reduce((a, it) => a + it.w, 0) + GAP * (row.length - 1);
    let x = (cssWidth - total) / 2;
    const y = canvas.height / scale + PAD / 2 + r * ROW_H + ROW_H / 2;
    row.forEach(({ s, w }) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + SWATCH, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (typeof drawMarker === "function") drawMarker(ctx, s.shape, x + SWATCH + 6 + 6, y, 4.5, s.color);
      ctx.fillStyle = textColor;
      ctx.fillText(s.label, x + SWATCH + 6 + 12 + 6, y + 0.5);
      x += w + GAP;
    });
  });
  return out.toDataURL("image/png");
}

function withBackground(canvas, extraHeight) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height + extraHeight;
  const ctx = out.getContext("2d");
  let el = canvas, bg = "";
  while (el && (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
    bg = getComputedStyle(el).backgroundColor;
    el = el.parentElement;
  }
  ctx.fillStyle = bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}
