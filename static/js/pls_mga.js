/* PLS-MGA (Multi-Group Analysis) results page: fetches /api/mga for the job
 * stashed in sessionStorage by the results page's config modal, then renders
 * a per-path comparison table across all 3 significance tests (Parametric /
 * Welch-Satterthwaite, Permutation, PLS-MGA). No charting -- this is a
 * comparison table, not a chart-driven page like ml_comparison.js. */

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
  if (window.__mgaResult) renderAll(window.__mgaResult);
});

// {construct_id: display name} -- the /api/mga response identifies paths by
// the model's internal construct ids (e.g. "ccglh4nv"), not their
// human-readable name (e.g. "CST"), since that's all the backend model
// object carries. The job stashed into sessionStorage already has the full
// model payload (it's what /api/mga itself was sent), so build the lookup
// from that instead of a second round-trip.
let idToName = {};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(v, digits = 3) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function fmtP(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v < 0.001 ? "<0.001" : v.toFixed(3);
}

async function main() {
  const raw = sessionStorage.getItem("websem_mga_job");
  if (!raw) {
    showError(t("mga_no_job"));
    return;
  }
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    showError(t("mga_no_job"));
    return;
  }

  idToName = Object.fromEntries((job.model?.constructs || []).map((c) => [c.id, c.name || c.id]));

  try {
    const res = await fetch("/api/mga", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("mga_failed"));
    window.__mgaResult = data;
    renderAll(data);
  } catch (err) {
    showError(err.message);
  }
}

function showError(msg) {
  document.getElementById("mgaLoading").classList.add("hidden");
  const box = document.getElementById("mgaError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function renderAll(data) {
  document.getElementById("mgaLoading").classList.add("hidden");
  document.getElementById("mgaContent").classList.remove("hidden");

  document.getElementById("mgaSummary").textContent = t("mga_summary_text", {
    column: data.column,
    labelA: data.group_a.label, nA: data.group_a.n_obs,
    labelB: data.group_b.label, nB: data.group_b.n_obs,
    nBoot: data.n_boot, nPerm: data.n_perm,
  });
  document.getElementById("mgaTableHint").textContent = t("mga_table_hint", {
    labelA: data.group_a.label, labelB: data.group_b.label,
  });

  const rows = data.paths.map((row) => {
    const sigBadge = row.significant_mga
      ? `<span class="badge warn">${escapeHtml(t("mga_significant"))}</span>`
      : `<span class="hint">${escapeHtml(t("mga_not_significant"))}</span>`;
    return `
      <tr>
        <td>${escapeHtml(idToName[row.source] || row.source)} → ${escapeHtml(idToName[row.target] || row.target)}</td>
        <td>${fmt(row.coef_a)}</td>
        <td>${fmt(row.coef_b)}</td>
        <td>${fmt(row.diff)}</td>
        <td>${fmtP(row.p_parametric)}</td>
        <td>${fmtP(row.p_welch)}</td>
        <td>${fmtP(row.p_permutation)}</td>
        <td>${fmtP(row.p_mga)}</td>
        <td>${sigBadge}</td>
      </tr>`;
  }).join("");

  document.getElementById("mgaTable").innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(t("mga_col_path"))}</th>
        <th>${escapeHtml(t("mga_col_coef_a"))} (${escapeHtml(data.group_a.label)})</th>
        <th>${escapeHtml(t("mga_col_coef_b"))} (${escapeHtml(data.group_b.label)})</th>
        <th>${escapeHtml(t("mga_col_diff"))}</th>
        <th>${escapeHtml(t("mga_col_p_parametric"))}</th>
        <th>${escapeHtml(t("mga_col_p_welch"))}</th>
        <th>${escapeHtml(t("mga_col_p_permutation"))}</th>
        <th>${escapeHtml(t("mga_col_p_mga"))}</th>
        <th>${escapeHtml(t("mga_col_significant"))}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `;
}

main();
