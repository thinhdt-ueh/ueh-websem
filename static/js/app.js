/* App orchestration: upload -> model builder -> run analysis -> results. */

const state = {
  fileId: null,
  filename: null,
  columns: [],
  numericColumns: [],
  previewRows: [],
  nRows: 0,
};

let editor = null;
let resultDiagram = null;
let nextNodePos = { x: 160, y: 110 };
let lastAnalysisResult = null;
let lastCbsemResult = null;
let cbsemResultDiagram = null;

// ---------------- Language switch ----------------
applyStaticTranslations();
document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === getLang()));
document.getElementById("runAnalysisBtn").textContent = t("s2_run_pls");
document.getElementById("toolbarHint").textContent = t("s2_toolbar_hint_default");
document.getElementById("methodHint").textContent = t("s2_method_hint_pls");
document.getElementById("resultsLoading").textContent = t("s3_loading_pls");

document.getElementById("langSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest(".lang-btn");
  if (!btn) return;
  setLang(btn.dataset.lang);
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
});

document.addEventListener("langchange", refreshUIForLanguage);

function refreshUIForLanguage() {
  // Text that depends on more than just the static markup (current selection /
  // toggle state) needs to be recomputed rather than just re-applied from data-i18n.
  const method = document.getElementById("estimationMethod").value;
  document.getElementById("methodHint").textContent =
    t(method === "cbsem" ? "s2_method_hint_cbsem" : "s2_method_hint_pls");
  document.getElementById("runAnalysisBtn").textContent = t(method === "cbsem" ? "s2_run_cbsem" : "s2_run_pls");
  document.getElementById("toolbarHint").textContent =
    t(editor && editor.pathMode ? "s2_toolbar_hint_path_mode" : "s2_toolbar_hint_default");

  if (state.filename) {
    document.getElementById("dzFilename").textContent = t("s1_selected_file", { name: state.filename });
  }
  if (state.columns.length) updatePreviewTitle();
  if (editor) {
    renderModelSummary();
    editor.render();
  }
  if (lastAnalysisResult && !document.getElementById("resultsContent").classList.contains("hidden")) {
    renderResults(lastAnalysisResult);
  }
  if (lastCbsemResult && !document.getElementById("cbsemResultsContent").classList.contains("hidden")) {
    renderCbsemResults(lastCbsemResult);
  }
}

// ---------------- Step navigation ----------------
function goToStep(n) {
  document.querySelectorAll(".step-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("panel-" + n).classList.add("active");
  document.querySelectorAll(".step-btn").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.step) === n);
  });
}

document.getElementById("stepNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".step-btn");
  if (!btn) return;
  const step = Number(btn.dataset.step);
  if (step === 2 && !state.fileId) return;
  if (step === 3 && !editor) return;
  goToStep(step);
});

// ---------------- Step 1: Upload ----------------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

document.getElementById("browseBtn").addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (e) => {
  if (e.target.id === "browseBtn") return;
  fileInput.click();
});
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

document.getElementById("sampleBtn").addEventListener("click", loadSample);

async function uploadFile(file) {
  const errBox = document.getElementById("uploadError");
  errBox.classList.add("hidden");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("lang", getLang());
  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("msg_upload_failed"));
    applyUploadResult(data);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
  }
}

async function loadSample() {
  const errBox = document.getElementById("uploadError");
  errBox.classList.add("hidden");
  try {
    const res = await fetch("/api/sample");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("msg_sample_failed"));
    applyUploadResult(data);
    buildModelFromJson(data.model);
    goToStep2Enable();
    goToStep(2);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
  }
}

function applyUploadResult(data) {
  state.fileId = data.file_id;
  state.filename = data.filename;
  state.columns = data.columns;
  state.numericColumns = data.numeric_columns;
  state.previewRows = data.preview;
  state.nRows = data.n_rows;

  document.getElementById("dzFilename").textContent = t("s1_selected_file", { name: data.filename });
  updatePreviewTitle();
  renderPreviewTable();
  document.getElementById("dataPreviewWrap").classList.remove("hidden");
  goToStep2Enable();
}

function updatePreviewTitle() {
  document.getElementById("previewTitle").textContent =
    t("s1_preview_title", { rows: state.nRows, cols: state.columns.length });
}

function renderPreviewTable() {
  const table = document.getElementById("previewTable");
  const cols = state.columns;
  let html = "<thead><tr>" + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr></thead><tbody>";
  for (const row of state.previewRows) {
    html += "<tr>" + cols.map((c) => `<td>${row[c] ?? ""}</td>`).join("") + "</tr>";
  }
  html += "</tbody>";
  table.innerHTML = html;
}

function goToStep2Enable() {
  document.querySelector('.step-btn[data-step="2"]').disabled = false;
}

document.getElementById("toStep2Btn").addEventListener("click", () => {
  if (!editor) initEditor();
  goToStep(2);
});

// ---------------- Step 2: Model builder ----------------
function initEditor() {
  const canvas = document.getElementById("modelCanvas");
  editor = new PathDiagram(canvas, {
    editable: true,
    onSelect: onConstructSelected,
    onChange: onEditorChange,
  });
  renderModelSummary();
}

function onEditorChange(evt) {
  if (evt && evt.requestAddConstruct) {
    openAddConstructModal(evt.requestAddConstruct);
    return;
  }
  if (evt && evt.pathRejected) {
    showModelMessage(t("s2_path_rejected"));
  }
  renderModelSummary();
}

document.getElementById("addConstructBtn").addEventListener("click", () => {
  nextNodePos = { x: 140 + (editor.constructs.length % 5) * 150, y: 100 + Math.floor(editor.constructs.length / 5) * 140 };
  openAddConstructModal(nextNodePos);
});

document.getElementById("pathModeBtn").addEventListener("click", (e) => {
  const on = !editor.pathMode;
  editor.setPathMode(on);
  e.target.classList.toggle("active-toggle", on);
  document.getElementById("toolbarHint").textContent =
    t(on ? "s2_toolbar_hint_path_mode" : "s2_toolbar_hint_default");
});

document.getElementById("deleteSelBtn").addEventListener("click", () => {
  editor.deleteSelected();
  onConstructSelected(null);
  renderModelSummary();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Delete" && editor && document.getElementById("panel-2").classList.contains("active")) {
    editor.deleteSelected();
    onConstructSelected(null);
    renderModelSummary();
  }
});

function openAddConstructModal(pos) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>${t("modal_title")}</h3>
        <label>${t("modal_name_label")}</label>
        <input type="text" id="modalCName" placeholder="${t("modal_name_placeholder")}">
        <label>${t("modal_mode_label")}</label>
        <select id="modalCMode">
          <option value="A">${t("s2_mode_reflective")}</option>
          <option value="B">${t("s2_mode_formative")}</option>
        </select>
        <div class="modal-actions">
          <button class="btn" id="modalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="modalOk">${t("modal_add")}</button>
        </div>
      </div>
    </div>`;
  document.getElementById("modalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("modalOk").onclick = () => {
    const name = document.getElementById("modalCName").value.trim() || "Construct";
    const mode = document.getElementById("modalCMode").value;
    const id = editor.addConstruct(name, mode, pos.x, pos.y);
    root.innerHTML = "";
    editor.setSelected({ type: "node", id });
    renderModelSummary();
  };
  document.getElementById("modalCName").focus();
}

function onConstructSelected(sel) {
  const noSel = document.getElementById("noSelection");
  const form = document.getElementById("constructForm");
  if (!sel || sel.type !== "node") {
    noSel.classList.remove("hidden");
    form.classList.add("hidden");
    return;
  }
  noSel.classList.add("hidden");
  form.classList.remove("hidden");
  const c = sel.construct;
  document.getElementById("cName").value = c.name;
  document.getElementById("cMode").value = c.mode;
  renderIndicatorPicker(c);
}

document.getElementById("cName").addEventListener("input", (e) => {
  if (!editor.selected || editor.selected.type !== "node") return;
  editor.getConstruct(editor.selected.id).name = e.target.value || "Construct";
  editor.render();
  renderModelSummary();
});

document.getElementById("cMode").addEventListener("change", (e) => {
  if (!editor.selected || editor.selected.type !== "node") return;
  editor.getConstruct(editor.selected.id).mode = e.target.value;
  editor.render();
  renderModelSummary();
});

function renderIndicatorPicker(construct) {
  const wrap = document.getElementById("indicatorPicker");
  const assignedElsewhere = new Set();
  editor.constructs.forEach((c) => {
    if (c.id !== construct.id) c.indicators.forEach((i) => assignedElsewhere.add(i));
  });
  wrap.innerHTML = state.numericColumns
    .map((col) => {
      const checked = construct.indicators.includes(col) ? "checked" : "";
      const disabled = assignedElsewhere.has(col) ? "disabled" : "";
      return `<label class="${disabled ? "muted" : ""}">
        <input type="checkbox" value="${escapeAttr(col)}" ${checked} ${disabled}> ${escapeHtml(col)}
      </label>`;
    })
    .join("");
  wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const col = cb.value;
      if (cb.checked) {
        if (!construct.indicators.includes(col)) construct.indicators.push(col);
      } else {
        construct.indicators = construct.indicators.filter((x) => x !== col);
      }
      editor.render();
      renderModelSummary();
    });
  });
}

let expandedConstructs = new Set();

function renderModelSummary() {
  const ul = document.getElementById("modelSummary");
  const parts = editor.constructs.map((c) => {
    const modeLabel = t(c.mode === "A" ? "s2_summary_reflective" : "s2_summary_formative");
    const isOpen = expandedConstructs.has(c.id);
    const indicatorList = isOpen
      ? `<ul class="summary-indicators">${
          c.indicators.length
            ? c.indicators.map((i) => `<li>${escapeHtml(i)}</li>`).join("")
            : `<li class="muted">—</li>`
        }</ul>`
      : "";
    return `<li>
      <div class="summary-row">
        <button class="summary-toggle" data-construct-id="${c.id}" type="button" aria-label="${t("s2_summary_toggle_aria")}">${isOpen ? "−" : "+"}</button>
        <span><strong>${escapeHtml(c.name)}</strong> — ${modeLabel}, ${c.indicators.length} ${t("s2_summary_item_suffix")}</span>
      </div>
      ${indicatorList}
    </li>`;
  });
  parts.push(`<li>${editor.paths.length} ${t("s2_summary_paths_suffix")}</li>`);
  ul.innerHTML = parts.join("");
  ul.querySelectorAll(".summary-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.constructId;
      if (expandedConstructs.has(id)) expandedConstructs.delete(id);
      else expandedConstructs.add(id);
      renderModelSummary();
    });
  });
  document.getElementById("modelError").classList.add("hidden");
}

function showModelMessage(msg) {
  const box = document.getElementById("modelError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function circleLayout(constructs) {
  const n = constructs.length;
  const cx = 500, cy = 280, rx = 380, ry = 180;
  return constructs.map((c, i) => {
    if (typeof c.x === "number" && typeof c.y === "number") return { ...c };
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { ...c, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

function buildModelFromJson(model) {
  if (!editor) initEditor();
  editor.loadFrom(circleLayout(model.constructs), model.paths);
  renderModelSummary();
}

// ---------------- Model import / export (JSON) ----------------
document.getElementById("exportModelBtn").addEventListener("click", () => {
  if (!editor || editor.constructs.length === 0) return;
  const payload = {
    format: "pls-sem-web-model",
    version: 1,
    exported_at: new Date().toISOString(),
    constructs: editor.constructs,
    paths: editor.paths,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pls_model.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importModelBtn").addEventListener("click", () => {
  document.getElementById("importModelInput").click();
});

document.getElementById("importModelInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errBox = document.getElementById("modelImportError");
  const reader = new FileReader();
  reader.onload = () => {
    errBox.classList.add("hidden");
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.constructs) || !Array.isArray(parsed.paths)) {
        throw new Error(t("s2_import_missing_arrays"));
      }
      for (const c of parsed.constructs) {
        if (!c.id || !c.name || !c.mode || !Array.isArray(c.indicators)) {
          throw new Error(t("s2_import_missing_fields"));
        }
      }
      if (!editor) initEditor();
      editor.loadFrom(circleLayout(parsed.constructs), parsed.paths);
      onConstructSelected(null);
      renderModelSummary();
    } catch (err) {
      errBox.textContent = t("s2_import_failed", { msg: err.message });
      errBox.classList.remove("hidden");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

// ---------------- Step 3: Run analysis & results ----------------
document.getElementById("runAnalysisBtn").addEventListener("click", runAnalysis);
document.getElementById("backToModelBtn").addEventListener("click", () => goToStep(2));
document.getElementById("cbsemBackToModelBtn").addEventListener("click", () => goToStep(2));

document.getElementById("cbsemExportExcelBtn").addEventListener("click", () => exportCbsemReport("excel"));
document.getElementById("cbsemExportWordBtn").addEventListener("click", () => exportCbsemReport("word"));

async function exportCbsemReport(kind) {
  if (!lastCbsemResult) return;
  const btn = document.getElementById(kind === "excel" ? "cbsemExportExcelBtn" : "cbsemExportWordBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("s3_generating_file");
  document.getElementById("resultsError").classList.add("hidden");
  try {
    const res = await fetch(`/api/export_cbsem/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lastCbsemResult, lang: getLang() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("s3_export_failed"));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "excel" ? "CB-SEM_Report.xlsx" : "CB-SEM_Report.docx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    document.getElementById("resultsError").textContent = err.message;
    document.getElementById("resultsError").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.getElementById("exportExcelBtn").addEventListener("click", () => exportReport("excel"));
document.getElementById("exportWordBtn").addEventListener("click", () => exportReport("word"));

async function exportReport(kind) {
  if (!lastAnalysisResult) return;
  const btn = document.getElementById(kind === "excel" ? "exportExcelBtn" : "exportWordBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("s3_generating_file");
  document.getElementById("resultsError").classList.add("hidden");
  try {
    const res = await fetch(`/api/export/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lastAnalysisResult, lang: getLang() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("s3_export_failed"));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "excel" ? "PLS-SEM_Report.xlsx" : "PLS-SEM_Report.docx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    document.getElementById("resultsError").textContent = err.message;
    document.getElementById("resultsError").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.getElementById("bootstrapEnable").addEventListener("change", (e) => {
  document.getElementById("bootstrapOptions").classList.toggle("hidden", !e.target.checked);
});

document.getElementById("estimationMethod").addEventListener("change", (e) => {
  const isCbsem = e.target.value === "cbsem";
  document.getElementById("methodHint").textContent = t(isCbsem ? "s2_method_hint_cbsem" : "s2_method_hint_pls");
  document.getElementById("bootstrapSection").classList.toggle("hidden", isCbsem);
  document.getElementById("cbsemNote").classList.toggle("hidden", !isCbsem);
  document.getElementById("runAnalysisBtn").textContent = t(isCbsem ? "s2_run_cbsem" : "s2_run_pls");
});

async function runAnalysis() {
  const method = document.getElementById("estimationMethod").value;
  if (method === "cbsem") return runCbsemAnalysis();

  const modelPayload = editor.serialize();
  const bootstrapEnabled = document.getElementById("bootstrapEnable").checked;
  const nBoot = Number(document.getElementById("bootstrapReps").value);

  goToStep(3);
  document.getElementById("resultsContent").classList.add("hidden");
  document.getElementById("cbsemResultsContent").classList.add("hidden");
  document.getElementById("resultsError").classList.add("hidden");
  document.getElementById("resultsLoading").classList.remove("hidden");
  document.getElementById("resultsLoading").textContent = bootstrapEnabled
    ? t("s3_loading_pls_boot", { n: nBoot })
    : t("s3_loading_pls");

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: state.fileId,
        model: modelPayload,
        lang: getLang(),
        bootstrap: { enabled: bootstrapEnabled, n_boot: nBoot },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("s3_analyze_failed"));
    renderResults(data);
  } catch (err) {
    document.getElementById("resultsError").textContent = err.message;
    document.getElementById("resultsError").classList.remove("hidden");
  } finally {
    document.getElementById("resultsLoading").classList.add("hidden");
  }
}

async function runCbsemAnalysis() {
  const modelPayload = editor.serialize();

  goToStep(3);
  document.getElementById("resultsContent").classList.add("hidden");
  document.getElementById("cbsemResultsContent").classList.add("hidden");
  document.getElementById("resultsError").classList.add("hidden");
  document.getElementById("resultsLoading").classList.remove("hidden");
  document.getElementById("resultsLoading").textContent = t("s3_loading_cbsem");

  try {
    const res = await fetch("/api/analyze_cbsem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: state.fileId, model: modelPayload, lang: getLang() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("s3_analyze_failed"));
    renderCbsemResults(data);
  } catch (err) {
    document.getElementById("resultsError").textContent = err.message;
    document.getElementById("resultsError").classList.remove("hidden");
  } finally {
    document.getElementById("resultsLoading").classList.add("hidden");
  }
}

function renderResults(data) {
  lastAnalysisResult = data;
  document.getElementById("resultsContent").classList.remove("hidden");
  let info = `${t(data.converged ? "conv_converged" : "conv_not_converged")} ` +
    `${t("conv_after_iterations", { n: data.iterations })} · ${t("conv_n_obs", { n: data.n_obs })}`;
  if (data.bootstrap) {
    info += ` ${t("conv_bootstrap", { valid: data.bootstrap.valid, requested: data.bootstrap.requested })}`;
  }
  document.getElementById("convergenceInfo").textContent = info;

  const canvas = document.getElementById("resultCanvas");
  resultDiagram = new PathDiagram(canvas, { editable: false });
  resultDiagram.loadFrom(editor.constructs, editor.paths);
  resultDiagram.annotate = { paths: data.structural.paths, r2: data.structural.r_squared };
  resultDiagram.render();

  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));

  renderReliabilityTable(data, idToName);
  renderLoadingsTable(data);
  renderCrossLoadingsTable(data, idToName);
  renderMatrixTable("flTable", data.discriminant_validity.fornell_larcker, idToName);
  renderMatrixTable("htmtTable", data.discriminant_validity.htmt, idToName);
  renderPathTable(data);
  renderR2Table(data, idToName);
  renderVifTable(data, idToName);
}

function renderReliabilityTable(data, idToName) {
  const m = data.measurement;
  const ids = data.constructs.filter((c) => c.mode === "A").map((c) => c.id);
  let html = `<thead><tr><th>${t("th_construct")}</th><th>${t("th_cronbachs_alpha")}</th><th>${t("th_rho_a")}</th>` +
    `<th>${t("th_composite_reliability")}</th><th>${t("th_ave")}</th></tr></thead><tbody>`;
  for (const id of ids) {
    html += `<tr><td>${escapeHtml(idToName[id])}</td>` +
      `<td>${fmt(m.cronbachs_alpha[id])}</td>` +
      `<td>${fmt(m.rho_a[id])}</td>` +
      `<td>${fmt(m.composite_reliability[id])}</td>` +
      `<td>${fmt(m.ave[id])}</td></tr>`;
  }
  const formative = data.constructs.filter((c) => c.mode === "B");
  for (const c of formative) {
    html += `<tr><td>${escapeHtml(c.name)}</td><td colspan="4" style="text-align:center;color:#6b7385">${t("lbl_formative_note")}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("reliabilityTable").innerHTML = html;
}

function renderLoadingsTable(data) {
  const m = data.measurement;
  const bootByInd = {};
  (m.outer_loadings_bootstrap || []).forEach((row) => (bootByInd[row.indicator] = row));
  const hasBoot = !!m.outer_loadings_bootstrap;

  let html = `<thead><tr><th>${t("th_indicator")}</th><th>${t("th_construct")}</th><th>${t("th_outer_loading")}</th><th>${t("th_outer_weight")}</th>`;
  if (hasBoot) html += `<th>${t("th_stdev")}</th><th>${t("th_t_stat")}</th><th>${t("th_p_value")}</th><th>${t("th_significance")}</th>`;
  html += "</tr></thead><tbody>";
  for (const c of data.constructs) {
    for (const ind of c.indicators) {
      html += `<tr><td>${escapeHtml(ind)}</td><td>${escapeHtml(c.name)}</td>` +
        `<td>${fmt(m.outer_loadings[ind])}</td><td>${fmt(m.outer_weights[ind])}</td>`;
      if (hasBoot) {
        const b = bootByInd[ind];
        html += b
          ? `<td>${fmt(b.std)}</td><td>${fmt(b.t_stat)}</td><td>${fmt(b.p_value)}</td><td>${sigBadge(b.significant)}</td>`
          : `<td colspan="4">${t("lbl_dash")}</td>`;
      }
      html += "</tr>";
    }
  }
  html += "</tbody>";
  document.getElementById("loadingsTable").innerHTML = html;
}

function sigBadge(significant) {
  if (significant === null || significant === undefined) return t("lbl_dash");
  return significant
    ? `<span class="badge ok">${t("lbl_significant")}</span>`
    : `<span class="badge warn">${t("lbl_not_significant")}</span>`;
}

function renderCrossLoadingsTable(data, idToName) {
  // cross_loadings is serialized from a pandas DataFrame via .to_dict(): {construct_id: {indicator: value}}.
  const cl = data.measurement.cross_loadings;
  const constructIds = data.constructs.map((c) => c.id);
  let html = `<thead><tr><th>${t("th_indicator")}</th>` +
    constructIds.map((id) => `<th>${escapeHtml(idToName[id])}</th>`).join("") + "</tr></thead><tbody>";
  for (const c of data.constructs) {
    for (const ind of c.indicators) {
      const rowVals = constructIds.map((id) => cl[id][ind]);
      const maxAbs = Math.max(...rowVals.map((v) => Math.abs(v ?? 0)));
      html += `<tr><td>${escapeHtml(ind)}</td>` +
        rowVals.map((v) => {
          const isOwn = Math.abs(v ?? 0) === maxAbs;
          return `<td${isOwn ? ' style="font-weight:700;color:#3457d5"' : ""}>${fmt(v)}</td>`;
        }).join("") + "</tr>";
    }
  }
  html += "</tbody>";
  document.getElementById("crossLoadingsTable").innerHTML = html;
}

function renderMatrixTable(elId, matrix, idToName) {
  // matrix is serialized from a pandas DataFrame via .to_dict(): {column: {index: value}}.
  const ids = Object.keys(matrix);
  let html = "<thead><tr><th></th>" + ids.map((id) => `<th>${escapeHtml(idToName[id] || id)}</th>`).join("") + "</tr></thead><tbody>";
  for (const rowId of ids) {
    html += `<tr><td>${escapeHtml(idToName[rowId] || rowId)}</td>`;
    for (const colId of ids) {
      html += `<td>${fmt(matrix[colId][rowId])}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById(elId).innerHTML = html;
}

function renderPathTable(data) {
  const hasBoot = data.structural.paths.some((p) => p.t_stat !== undefined);
  let html = `<thead><tr><th>${t("th_path")}</th><th>${t("th_path_coefficient")}</th>`;
  if (hasBoot) html += `<th>${t("th_stdev")}</th><th>${t("th_t_stat")}</th><th>${t("th_p_value")}</th><th>${t("th_significance")}</th>`;
  html += `<th>${t("th_f_squared")}</th><th>${t("th_f2_effect")}</th></tr></thead><tbody>`;
  for (const p of data.structural.paths) {
    html += `<tr><td>${escapeHtml(p.source_name)} → ${escapeHtml(p.target_name)}</td>` +
      `<td>${fmt(p.coefficient)}</td>`;
    if (hasBoot) {
      html += `<td>${fmt(p.bootstrap_std)}</td><td>${fmt(p.t_stat)}</td><td>${fmt(p.p_value)}</td><td>${sigBadge(p.significant)}</td>`;
    }
    html += `<td>${fmt(p.f_squared)}</td><td>${f2Label(p.f_squared)}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("pathTable").innerHTML = html;
}

function f2Label(v) {
  if (v === null || v === undefined) return t("lbl_dash");
  if (v < 0.02) return t("lbl_f2_none");
  if (v < 0.15) return t("lbl_f2_small");
  if (v < 0.35) return t("lbl_f2_medium");
  return t("lbl_f2_large");
}

function r2Label(v) {
  if (v === null || v === undefined) return t("lbl_dash");
  if (v < 0.19) return t("lbl_r2_weak");
  if (v < 0.33) return t("lbl_r2_moderate");
  if (v < 0.67) return t("lbl_r2_substantial");
  return t("lbl_r2_strong");
}

function q2Label(v) {
  if (v === null || v === undefined) return t("lbl_dash");
  if (v <= 0) return t("lbl_q2_none");
  if (v < 0.02) return t("lbl_f2_none");
  if (v < 0.15) return t("lbl_f2_small");
  if (v < 0.35) return t("lbl_f2_medium");
  return t("lbl_f2_large");
}

function renderR2Table(data, idToName) {
  const ids = Object.keys(data.structural.r_squared);
  const q2 = data.structural.q_squared || {};
  const q2Skipped = data.structural.q_squared_skipped || {};
  let html = `<thead><tr><th>${t("th_endogenous_construct")}</th><th>${t("th_r2")}</th><th>${t("th_r2_adj")}</th><th>${t("th_r2_assessment")}</th>` +
    `<th>${t("th_q2", { d: data.structural.omission_distance ?? t("lbl_dash") })}</th><th>${t("th_q2_assessment")}</th></tr></thead><tbody>`;
  for (const id of ids) {
    const r2 = data.structural.r_squared[id];
    html += `<tr><td>${escapeHtml(idToName[id])}</td><td>${fmt(r2)}</td>` +
      `<td>${fmt(data.structural.r_squared_adj[id])}</td><td>${r2Label(r2)}</td>`;
    if (id in q2) {
      html += `<td>${fmt(q2[id])}</td><td>${q2Label(q2[id])}</td>`;
    } else {
      html += `<td colspan="2" style="text-align:center;color:#6b7385">${escapeHtml(q2Skipped[id] || t("lbl_dash"))}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById("r2Table").innerHTML = html;
}

function renderVifTable(data, idToName) {
  const rows = [];
  // inner_vif is serialized from a pandas DataFrame via .to_dict(), which nests as
  // {column: {index: value}} — here columns are targets and the index is predictors.
  const inner = data.structural.inner_vif;
  for (const targetId of Object.keys(inner)) {
    for (const predId of Object.keys(inner[targetId])) {
      const v = inner[targetId][predId];
      if (v !== null && v !== undefined) {
        rows.push([`${idToName[predId]} → ${idToName[targetId]}${t("suffix_structural")}`, v]);
      }
    }
  }
  const outer = data.measurement.outer_vif;
  for (const ind of Object.keys(outer)) {
    rows.push([`${ind}${t("suffix_formative_measurement")}`, outer[ind]]);
  }
  let html = `<thead><tr><th>${t("th_pair")}</th><th>${t("th_vif")}</th><th>${t("th_assessment")}</th></tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr><td colspan="3" style="text-align:center;color:#6b7385">${t("lbl_no_vif_pairs")}</td></tr>`;
  }
  for (const [label, v] of rows) {
    const badge = v > 5
      ? `<span class="badge warn">${t("lbl_vif_high")}</span>`
      : `<span class="badge ok">${t("lbl_vif_acceptable")}</span>`;
    html += `<tr><td>${label}</td><td>${fmt(v)}</td><td>${badge}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("vifTable").innerHTML = html;
}

// ---------------- CB-SEM results ----------------
const CBSEM_FIT_INDEX_KEYS = {
  chi_square: "fit_chi_square",
  df: "fit_df",
  chi_square_p_value: "fit_chi2_p",
  cfi: "fit_cfi",
  tli: "fit_tli",
  rmsea: "fit_rmsea",
  srmr: "fit_srmr",
  gfi: "fit_gfi",
  agfi: "fit_agfi",
  nfi: "fit_nfi",
  aic: "fit_aic",
  bic: "fit_bic",
};

function fitVerdict(key, v) {
  if (v === null || v === undefined) return "";
  const higherBetter = { cfi: [0.9, 0.95], tli: [0.9, 0.95], gfi: [0.9, 0.95], nfi: [0.9, 0.95] };
  const lowerBetter = { rmsea: [0.08, 0.06], srmr: [0.08, 0.05] };
  if (key in higherBetter) {
    const [acc, good] = higherBetter[key];
    if (v >= good) return `<span class="badge ok">${t("lbl_fit_good")}</span>`;
    if (v >= acc) return `<span class="badge ok">${t("lbl_fit_acceptable")}</span>`;
    return `<span class="badge warn">${t("lbl_fit_poor")}</span>`;
  }
  if (key in lowerBetter) {
    const [acc, good] = lowerBetter[key];
    if (v <= good) return `<span class="badge ok">${t("lbl_fit_good")}</span>`;
    if (v <= acc) return `<span class="badge ok">${t("lbl_fit_acceptable")}</span>`;
    return `<span class="badge warn">${t("lbl_fit_poor")}</span>`;
  }
  return "";
}

function renderCbsemResults(data) {
  lastCbsemResult = data;
  document.getElementById("cbsemResultsContent").classList.remove("hidden");
  document.getElementById("cbsemConvergenceInfo").textContent =
    `${t(data.converged ? "conv_converged" : "conv_not_converged")} ` +
    `${t("conv_cbsem_after", { msg: data.optimizer_message, n: data.iterations })} · ${t("conv_n_obs", { n: data.n_obs })}`;

  const canvas = document.getElementById("cbsemResultCanvas");
  cbsemResultDiagram = new PathDiagram(canvas, { editable: false });
  cbsemResultDiagram.loadFrom(editor.constructs, editor.paths);
  const diagramPaths = data.structural.paths.map((p) => ({
    source: p.source, target: p.target, coefficient: p.std, t_stat: p.z, significant: p.significant,
  }));
  cbsemResultDiagram.annotate = { paths: diagramPaths, r2: data.structural.r_squared };
  cbsemResultDiagram.render();

  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));

  renderCbsemFitTable(data);
  renderCbsemReliabilityTable(data);
  renderCbsemLoadingsTable(data, idToName);
  renderMatrixTable("cbsemFlTable", data.discriminant_validity.fornell_larcker, idToName);
  renderMatrixTable("cbsemHtmtTable", data.discriminant_validity.htmt, idToName);
  renderCbsemPathTable(data);
  renderCbsemR2Table(data, idToName);
}

function renderCbsemFitTable(data) {
  const fi = data.fit_indices;
  let html = `<thead><tr><th>${t("th_fit_index")}</th><th>${t("th_value")}</th><th>${t("th_assessment")}</th></tr></thead><tbody>`;
  for (const key of Object.keys(CBSEM_FIT_INDEX_KEYS)) {
    const digits = key === "df" ? 0 : key === "chi_square_p_value" ? 4 : 3;
    html += `<tr><td>${t(CBSEM_FIT_INDEX_KEYS[key])}</td><td>${fmt(fi[key], digits)}</td><td>${fitVerdict(key, fi[key])}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("cbsemFitTable").innerHTML = html;
}

function renderCbsemReliabilityTable(data) {
  const m = data.measurement;
  let html = `<thead><tr><th>${t("th_construct")}</th><th>${t("th_cronbachs_alpha")}</th><th>${t("th_composite_reliability")}</th><th>${t("th_ave")}</th></tr></thead><tbody>`;
  for (const c of data.constructs) {
    html += `<tr><td>${escapeHtml(c.name)}</td><td>${fmt(m.cronbachs_alpha[c.id])}</td>` +
      `<td>${fmt(m.composite_reliability[c.id])}</td><td>${fmt(m.ave[c.id])}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("cbsemReliabilityTable").innerHTML = html;
}

function renderCbsemLoadingsTable(data, idToName) {
  let html = `<thead><tr><th>${t("th_indicator")}</th><th>${t("th_construct")}</th><th>${t("th_unstd")}</th>` +
    `<th>${t("th_std_lambda")}</th><th>${t("th_se")}</th><th>${t("th_z")}</th><th>${t("th_p")}</th><th>${t("th_note")}</th></tr></thead><tbody>`;
  for (const row of data.measurement.loadings) {
    const note = row.is_reference
      ? `<span class="badge ok">${t("lbl_reference_indicator")}</span>`
      : sigBadge(row.p === null ? null : row.p < 0.05);
    html += `<tr><td>${escapeHtml(row.indicator)}</td><td>${escapeHtml(idToName[row.construct])}</td>` +
      `<td>${fmt(row.unstd)}</td><td>${fmt(row.std)}</td><td>${fmt(row.se)}</td><td>${fmt(row.z, 2)}</td>` +
      `<td>${fmt(row.p, 4)}</td><td>${note}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("cbsemLoadingsTable").innerHTML = html;
}

function renderCbsemPathTable(data) {
  let html = `<thead><tr><th>${t("th_path")}</th><th>${t("th_unstd_b")}</th><th>${t("th_std_beta")}</th>` +
    `<th>${t("th_se")}</th><th>${t("th_z")}</th><th>${t("th_p")}</th><th>${t("th_significance")}</th></tr></thead><tbody>`;
  for (const p of data.structural.paths) {
    html += `<tr><td>${escapeHtml(p.source_name)} → ${escapeHtml(p.target_name)}</td>` +
      `<td>${fmt(p.unstd)}</td><td>${fmt(p.std)}</td><td>${fmt(p.se)}</td><td>${fmt(p.z, 2)}</td>` +
      `<td>${fmt(p.p, 4)}</td><td>${sigBadge(p.significant)}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("cbsemPathTable").innerHTML = html;
}

function renderCbsemR2Table(data, idToName) {
  let html = `<thead><tr><th>${t("th_endogenous_construct")}</th><th>${t("th_r2")}</th><th>${t("th_assessment")}</th></tr></thead><tbody>`;
  for (const [cid, r2] of Object.entries(data.structural.r_squared)) {
    html += `<tr><td>${escapeHtml(idToName[cid])}</td><td>${fmt(r2)}</td><td>${r2Label(r2)}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("cbsemR2Table").innerHTML = html;
}

// ---------------- utils ----------------
function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return t("lbl_dash");
  return Number(v).toFixed(digits);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
