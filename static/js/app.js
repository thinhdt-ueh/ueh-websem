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
updateGuideLink();

function updateGuideLink() {
  const link = document.getElementById("guideLink");
  if (link) link.href = `/static/docs/user_guide_${getLang()}.html`;
}
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
  updateGuideLink();
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

document.getElementById("sampleBtn").addEventListener("click", (e) => loadSample(e.target.dataset.dataset));
document.getElementById("sampleModerationBtn").addEventListener("click", (e) => loadSample(e.target.dataset.dataset));

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

async function loadSample(dataset) {
  const errBox = document.getElementById("uploadError");
  errBox.classList.add("hidden");
  try {
    const res = await fetch(`/api/sample?dataset=${encodeURIComponent(dataset || "tam")}`);
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

function eligibleInteractionSources(excludeId = null) {
  return editor.constructs.filter((c) => c.mode !== "I" && c.id !== excludeId);
}

function openAddConstructModal(pos) {
  const root = document.getElementById("modalRoot");
  const canInteract = eligibleInteractionSources().length >= 2;
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
          <option value="I" ${canInteract ? "" : "disabled"}>${t("s2_mode_interaction")}</option>
        </select>
        ${canInteract ? "" : `<p class="hint">${t("s2_interaction_not_enough")}</p>`}
        <div id="modalInteractionSources" class="hidden">
          <label>${t("s2_interaction_source_a")}</label>
          <select id="modalSourceA"></select>
          <label>${t("s2_interaction_source_b")}</label>
          <select id="modalSourceB"></select>
          <div id="modalInteractionError" class="error-box hidden"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="modalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="modalOk">${t("modal_add")}</button>
        </div>
      </div>
    </div>`;

  const fillSourceSelect = (sel, preferIndex) => {
    const options = eligibleInteractionSources();
    sel.innerHTML = options.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`).join("");
    if (options[preferIndex]) sel.value = options[preferIndex].id;
  };

  document.getElementById("modalCMode").addEventListener("change", (e) => {
    const isInteraction = e.target.value === "I";
    document.getElementById("modalInteractionSources").classList.toggle("hidden", !isInteraction);
    if (isInteraction) {
      fillSourceSelect(document.getElementById("modalSourceA"), 0);
      fillSourceSelect(document.getElementById("modalSourceB"), 1);
    }
  });

  document.getElementById("modalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("modalOk").onclick = () => {
    const name = document.getElementById("modalCName").value.trim() || "Construct";
    const mode = document.getElementById("modalCMode").value;
    let interactionOf = null;
    if (mode === "I") {
      const a = document.getElementById("modalSourceA").value;
      const b = document.getElementById("modalSourceB").value;
      if (!a || !b || a === b) {
        const errBox = document.getElementById("modalInteractionError");
        errBox.textContent = t("s2_interaction_same_source");
        errBox.classList.remove("hidden");
        return;
      }
      interactionOf = [a, b];
    }
    const id = editor.addConstruct(name, mode, pos.x, pos.y, interactionOf);
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
  if (c.mode === "I") {
    document.getElementById("indicatorPickerSection").classList.add("hidden");
    document.getElementById("interactionSourcesSection").classList.remove("hidden");
    renderInteractionSourcePicker(c);
  } else {
    document.getElementById("indicatorPickerSection").classList.remove("hidden");
    document.getElementById("interactionSourcesSection").classList.add("hidden");
    renderIndicatorPicker(c);
  }
}

function renderInteractionSourcePicker(construct) {
  const options = eligibleInteractionSources(construct.id);
  const errBox = document.getElementById("interactionSourceError");
  errBox.classList.add("hidden");
  const optHtml = options.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`).join("");
  const selA = document.getElementById("cSourceA");
  const selB = document.getElementById("cSourceB");
  selA.innerHTML = optHtml;
  selB.innerHTML = optHtml;
  const [curA, curB] = construct.interaction_of || [];
  if (curA && options.some((o) => o.id === curA)) selA.value = curA;
  else if (options[0]) selA.value = options[0].id;
  if (curB && options.some((o) => o.id === curB)) selB.value = curB;
  else if (options[1]) selB.value = options[1].id;
  construct.interaction_of = [selA.value, selB.value];

  const onSourceChange = () => {
    if (selA.value === selB.value) {
      errBox.textContent = t("s2_interaction_same_source");
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    construct.interaction_of = [selA.value, selB.value];
    editor.render();
    renderModelSummary();
  };
  selA.onchange = onSourceChange;
  selB.onchange = onSourceChange;

  const calcMethod = construct.calc_method || "two_stage";
  document.querySelectorAll('#cCalcMethod input[name="cCalcMethod"]').forEach((r) => {
    r.checked = r.value === calcMethod;
    r.onchange = () => {
      construct.calc_method = r.value;
      document.getElementById("productTermSection").classList.toggle("hidden", r.value === "two_stage");
      renderModelSummary();
    };
  });
  document.getElementById("productTermSection").classList.toggle("hidden", calcMethod === "two_stage");

  const productTerm = construct.product_term_generation || "standardized";
  document.querySelectorAll('#cProductTerm input[name="cProductTerm"]').forEach((r) => {
    r.checked = r.value === productTerm;
    r.onchange = () => {
      construct.product_term_generation = r.value;
      renderModelSummary();
    };
  });
}

document.getElementById("cName").addEventListener("input", (e) => {
  if (!editor.selected || editor.selected.type !== "node") return;
  editor.getConstruct(editor.selected.id).name = e.target.value || "Construct";
  editor.render();
  renderModelSummary();
});

document.getElementById("cMode").addEventListener("change", (e) => {
  if (!editor.selected || editor.selected.type !== "node") return;
  const c = editor.getConstruct(editor.selected.id);
  const newMode = e.target.value;
  if (newMode === "I" && eligibleInteractionSources(c.id).length < 2) {
    e.target.value = c.mode; // not enough other constructs to form an interaction — revert
    showModelMessage(t("s2_interaction_not_enough"));
    return;
  }
  c.mode = newMode;
  if (newMode === "I") {
    c.indicators = [];
    // any structural path pointing INTO this construct is now invalid, since an
    // interaction term is always exogenous
    editor.paths = editor.paths.filter((p) => p.target !== c.id);
  } else {
    c.interaction_of = null;
  }
  editor.render();
  onConstructSelected({ type: "node", construct: c });
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

function interactionOfLabel(c) {
  const [a, b] = (c.interaction_of || []).map((sid) => editor.getConstruct(sid));
  return a && b ? `${a.name} × ${b.name}` : t("lbl_dash");
}

function renderModelSummary() {
  const ul = document.getElementById("modelSummary");
  const parts = editor.constructs.map((c) => {
    const isInteraction = c.mode === "I";
    const modeLabel = t(
      c.mode === "A" ? "s2_summary_reflective" : isInteraction ? "s2_summary_interaction" : "s2_summary_formative"
    );
    const calcMethodLabel = isInteraction
      ? t(`s2_calc_method_${c.calc_method || "two_stage"}`)
      : "";
    const detail = isInteraction
      ? `${modeLabel} (${calcMethodLabel}): ${interactionOfLabel(c)}`
      : `${modeLabel}, ${c.indicators.length} ${t("s2_summary_item_suffix")}`;
    const isOpen = expandedConstructs.has(c.id);
    const indicatorList = isOpen && !isInteraction
      ? `<ul class="summary-indicators">${
          c.indicators.length
            ? c.indicators.map((i) => `<li>${escapeHtml(i)}</li>`).join("")
            : `<li class="muted">—</li>`
        }</ul>`
      : "";
    return `<li>
      <div class="summary-row">
        <button class="summary-toggle" data-construct-id="${c.id}" type="button" aria-label="${t("s2_summary_toggle_aria")}" ${isInteraction ? "disabled style=\"visibility:hidden\"" : ""}>${isOpen ? "−" : "+"}</button>
        <span><strong>${escapeHtml(c.name)}</strong> — ${detail}</span>
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
    const diagramImage = cbsemResultDiagram ? cbsemResultDiagram.canvas.toDataURL("image/png") : null;
    const res = await fetch(`/api/export_cbsem/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lastCbsemResult, lang: getLang(), diagram_image: diagramImage }),
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
document.getElementById("sensitivityBtn").addEventListener("click", () => openSensitivityModal("pls"));
document.getElementById("cbsemSensitivityBtn").addEventListener("click", () => openSensitivityModal("cbsem"));

function openSensitivityModal(method) {
  const root = document.getElementById("modalRoot");
  const nRows = state.nRows || 0;
  const suggestedStep = Math.max(1, Math.round(nRows * 0.05));
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>${t("sens_modal_title")}</h3>
        <p class="hint">${t("sens_modal_hint", { n: nRows })}</p>
        <label>${t("sens_modal_step_label")}</label>
        <input type="number" id="sensStep" min="1" step="1" value="${suggestedStep}">
        <div id="sensModalError" class="error-box hidden"></div>
        <div class="modal-actions">
          <button class="btn" id="sensModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="sensModalOk">${t("sens_modal_run")}</button>
        </div>
      </div>
    </div>`;
  document.getElementById("sensModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("sensModalOk").onclick = () => {
    const step = parseInt(document.getElementById("sensStep").value, 10);
    if (!Number.isInteger(step) || step < 1) {
      const errBox = document.getElementById("sensModalError");
      errBox.textContent = t("sens_modal_invalid_step");
      errBox.classList.remove("hidden");
      return;
    }
    const modelPayload = editor.serialize();
    sessionStorage.setItem("websem_sensitivity_job", JSON.stringify({
      file_id: state.fileId, model: modelPayload, method, step, lang: getLang(),
    }));
    root.innerHTML = "";
    window.open("/sensitivity", "_blank");
  };
  document.getElementById("sensStep").focus();
}

async function exportReport(kind) {
  if (!lastAnalysisResult) return;
  const btn = document.getElementById(kind === "excel" ? "exportExcelBtn" : "exportWordBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("s3_generating_file");
  document.getElementById("resultsError").classList.add("hidden");
  try {
    const diagramImage = resultDiagram ? resultDiagram.canvas.toDataURL("image/png") : null;
    const res = await fetch(`/api/export/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lastAnalysisResult, lang: getLang(), diagram_image: diagramImage }),
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
  resultDiagram.renderWithMeasurement(measurementValuesByIndicator(data));

  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));

  renderReliabilityTable(data, idToName);
  renderLoadingsTable(data);
  renderCrossLoadingsTable(data, idToName);
  renderMatrixTable("flTable", data.discriminant_validity.fornell_larcker, idToName);
  renderHtmtHeatmap("htmtTable", "htmtLegend", data.discriminant_validity.htmt, idToName);
  renderPathTable(data);
  renderTotalEffectsTable(data, "totalEffectsTable");
  renderR2Table(data, idToName);
  renderVifTable(data, idToName);
  renderCmbTable(data.common_method_bias, idToName, "cmbHint", "cmbTable");
  renderBootstrapHistograms(data);
  renderSourceTransparency("sourceTransparency", data.source_transparency);
}

function renderBootstrapHistograms(data) {
  const section = document.getElementById("bootstrapHistSection");
  const grid = document.getElementById("bootstrapHistGrid");
  const pathsWithHist = (data.structural.paths || []).filter((p) => p.histogram);
  if (!data.bootstrap || pathsWithHist.length === 0) {
    section.classList.add("hidden");
    grid.innerHTML = "";
    return;
  }
  section.classList.remove("hidden");
  document.getElementById("bootstrapHistHint").textContent = t("s3_bootstrap_dist_hint", { n: data.bootstrap.valid });
  grid.innerHTML = pathsWithHist
    .map((p, i) => `
      <div class="bootstrap-hist-card">
        <h4>${pathLabel(p)}</h4>
        <canvas id="bootstrapHistCanvas${i}"></canvas>
        <div class="hist-stats">${t("lbl_bootstrap_hist_stats", { orig: fmt(p.coefficient), lo: fmt(p.ci_lower), hi: fmt(p.ci_upper) })}</div>
      </div>
    `)
    .join("");
  pathsWithHist.forEach((p, i) => drawHistogram(document.getElementById(`bootstrapHistCanvas${i}`), p));
}

function drawHistogram(canvas, p) {
  const h = p.histogram;
  const cssWidth = canvas.getBoundingClientRect().width || 260;
  const cssHeight = 110;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const edges = h.edges, counts = h.counts;
  const xMin = edges[0], xMax = edges[edges.length - 1];
  const maxCount = Math.max(...counts, 1);
  const PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 16;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const barW = plotW / counts.length;

  ctx.fillStyle = "#c7d3f7";
  counts.forEach((c, i) => {
    const barH = (c / maxCount) * plotH;
    ctx.fillRect(PAD_L + i * barW + 0.5, PAD_T + plotH - barH, Math.max(1, barW - 1), barH);
  });

  ctx.strokeStyle = "#c3c2b7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T + plotH + 0.5);
  ctx.lineTo(PAD_L + plotW, PAD_T + plotH + 0.5);
  ctx.stroke();

  const drawVLine = (xVal, color, dash) => {
    if (xVal === null || xVal === undefined || xVal < xMin || xVal > xMax) return;
    const x = xOf(xVal);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, PAD_T + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawVLine(p.ci_lower, "#d64545", [3, 2]);
  drawVLine(p.ci_upper, "#d64545", [3, 2]);
  drawVLine(p.coefficient, "#3457d5", []);

  ctx.fillStyle = "#898781";
  ctx.font = "10px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(xMin.toFixed(2), PAD_L, PAD_T + plotH + 3);
  ctx.textAlign = "right";
  ctx.fillText(xMax.toFixed(2), PAD_L + plotW, PAD_T + plotH + 3);
}

function renderSourceTransparency(containerId, sections) {
  const container = document.getElementById(containerId);
  container.innerHTML = (sections || [])
    .map((s, i) => `
      <details${i === 0 ? " open" : ""}>
        <summary>${escapeHtml(t(s.key))}</summary>
        <pre><code>${escapeHtml(s.code)}</code></pre>
      </details>
    `)
    .join("");
}

function measurementValuesByIndicator(data) {
  // Reflective (Mode A) blocks are conventionally labeled with the outer
  // loading on their diagram arrow; formative (Mode B) blocks with the outer
  // weight instead — same convention SmartPLS uses.
  const m = data.measurement;
  const out = {};
  data.constructs.forEach((c) => {
    const src = c.mode === "B" ? m.outer_weights : m.outer_loadings;
    c.indicators.forEach((ind) => { out[ind] = src ? src[ind] : null; });
  });
  return out;
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
  // Interaction/moderation constructs have no indicators of their own, so they never
  // appear as a column here — derive the column set from `cl` itself, not from the
  // full construct list (mirrors the same fix in pls/report.py's Excel export).
  const cl = data.measurement.cross_loadings;
  const constructIds = Object.keys(cl);
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

const HTMT_WARN_THRESHOLD = 0.85;
const HTMT_CRITICAL_THRESHOLD = 0.90;

function renderHtmtHeatmap(elId, legendId, matrix, idToName) {
  const ids = Object.keys(matrix);
  let html = "<thead><tr><th></th>" + ids.map((id) => `<th>${escapeHtml(idToName[id] || id)}</th>`).join("") + "</tr></thead><tbody>";
  for (const rowId of ids) {
    html += `<tr><td>${escapeHtml(idToName[rowId] || rowId)}</td>`;
    for (const colId of ids) {
      const v = matrix[colId][rowId];
      let cls = "htmt-good";
      if (rowId === colId) cls = "htmt-diag";
      else if (v !== null && v !== undefined) {
        if (v >= HTMT_CRITICAL_THRESHOLD) cls = "htmt-critical";
        else if (v >= HTMT_WARN_THRESHOLD) cls = "htmt-warn";
      }
      html += `<td class="htmt-cell ${cls}">${fmt(v)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById(elId).innerHTML = html;
  if (legendId) {
    document.getElementById(legendId).innerHTML = `
      <span><span class="leg-swatch" style="background:#e3f6e9"></span>${t("lbl_htmt_good", { v: HTMT_WARN_THRESHOLD })}</span>
      <span><span class="leg-swatch" style="background:#fdf3e0"></span>${t("lbl_htmt_warn", { a: HTMT_WARN_THRESHOLD, b: HTMT_CRITICAL_THRESHOLD })}</span>
      <span><span class="leg-swatch" style="background:#fdeceb"></span>${t("lbl_htmt_critical", { v: HTMT_CRITICAL_THRESHOLD })}</span>
    `;
  }
}

function pathLabel(p) {
  const name = `${escapeHtml(p.source_name)} → ${escapeHtml(p.target_name)}`;
  return p.is_interaction ? `${name} <span class="badge moderation" title="${t("s2_mode_interaction")}">${t("lbl_moderation_badge")}</span>` : name;
}

function renderPathTable(data) {
  const hasBoot = data.structural.paths.some((p) => p.t_stat !== undefined);
  let html = `<thead><tr><th>${t("th_path")}</th><th>${t("th_path_coefficient")}</th>`;
  if (hasBoot) html += `<th>${t("th_stdev")}</th><th>${t("th_t_stat")}</th><th>${t("th_p_value")}</th><th>${t("th_significance")}</th>`;
  html += `<th>${t("th_f_squared")}</th><th>${t("th_f2_effect")}</th></tr></thead><tbody>`;
  for (const p of data.structural.paths) {
    html += `<tr><td>${pathLabel(p)}</td>` +
      `<td>${fmt(p.coefficient)}</td>`;
    if (hasBoot) {
      html += `<td>${fmt(p.bootstrap_std)}</td><td>${fmt(p.t_stat)}</td><td>${fmt(p.p_value)}</td><td>${sigBadge(p.significant)}</td>`;
    }
    const labelFn = p.is_interaction ? f2ModerationLabel : f2Label;
    html += `<td>${fmt(p.f_squared)}</td><td>${labelFn(p.f_squared)}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("pathTable").innerHTML = html;
}

function renderTotalEffectsTable(data, elId) {
  const rows = data.structural.total_effects || [];
  let html = `<thead><tr><th>${t("th_path")}</th><th>${t("th_direct_effect")}</th>` +
    `<th>${t("th_indirect_effect")}</th><th>${t("th_total_effect")}</th></tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center;color:#6b7385">${t("lbl_dash")}</td></tr>`;
  }
  for (const e of rows) {
    html += `<tr><td>${escapeHtml(e.source_name)} → ${escapeHtml(e.target_name)}</td>` +
      `<td>${fmt(e.direct)}</td><td>${fmt(e.indirect)}</td><td>${fmt(e.total)}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById(elId).innerHTML = html;
}

function f2Label(v) {
  if (v === null || v === undefined) return t("lbl_dash");
  if (v < 0.02) return t("lbl_f2_none");
  if (v < 0.15) return t("lbl_f2_small");
  if (v < 0.35) return t("lbl_f2_medium");
  return t("lbl_f2_large");
}

// Moderation (interaction-term) f² uses much smaller thresholds than main-effect
// f² (Kenny 2018; Aguinis et al. 2005) — see pls/report.py's f2_moderation_label
// for the same rationale on the export side.
function f2ModerationLabel(v) {
  if (v === null || v === undefined) return t("lbl_dash");
  if (v < 0.005) return t("lbl_f2_none");
  if (v < 0.01) return t("lbl_f2_small");
  if (v < 0.025) return t("lbl_f2_medium");
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

function renderCmbTable(cmb, idToName, hintElId, tableElId) {
  document.getElementById(hintElId).textContent = t("s3_cmb_hint", { threshold: cmb.threshold });
  let html = `<thead><tr><th>${t("th_construct")}</th><th>${t("th_vif")}</th><th>${t("th_assessment")}</th></tr></thead><tbody>`;
  for (const [cid, v] of Object.entries(cmb.vif)) {
    const badge = v > cmb.threshold
      ? `<span class="badge warn">${t("lbl_cmb_warn")}</span>`
      : `<span class="badge ok">${t("lbl_cmb_ok")}</span>`;
    html += `<tr><td>${escapeHtml(idToName[cid] || cid)}</td><td>${fmt(v)}</td><td>${badge}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById(tableElId).innerHTML = html;
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
  const cbsemLoadings = {};
  (data.measurement.loadings || []).forEach((row) => { cbsemLoadings[row.indicator] = row.std; });
  cbsemResultDiagram.renderWithMeasurement(cbsemLoadings);

  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));

  renderCbsemFitTable(data);
  renderCbsemReliabilityTable(data);
  renderCbsemLoadingsTable(data, idToName);
  renderMatrixTable("cbsemFlTable", data.discriminant_validity.fornell_larcker, idToName);
  renderHtmtHeatmap("cbsemHtmtTable", "cbsemHtmtLegend", data.discriminant_validity.htmt, idToName);
  renderCbsemPathTable(data);
  renderTotalEffectsTable(data, "cbsemTotalEffectsTable");
  renderCbsemR2Table(data, idToName);
  renderCmbTable(data.common_method_bias, idToName, "cbsemCmbHint", "cbsemCmbTable");
  renderSourceTransparency("cbsemSourceTransparency", data.source_transparency);
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
    html += `<tr><td>${pathLabel(p)}</td>` +
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
