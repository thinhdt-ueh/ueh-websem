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
  if (window.__lastPlspredict && !document.getElementById("plspredictSection").classList.contains("hidden")) {
    renderPlspredictResults(window.__lastPlspredict);
  }
  if (window.__lastIpma && !document.getElementById("ipmaSection").classList.contains("hidden")) {
    renderIpma(window.__lastIpma);
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
    // Switch to step 2 (and thus lay out #panel-2's canvas) *before*
    // building the model: PathDiagram sizes its raster off the canvas's
    // actual rendered width (see diagram.js's _syncCanvasResolution), and
    // that reads as 0 while .step-panel is still `display:none`, which
    // drew the diagram undersized until some later render happened to
    // fire after the panel was already visible.
    goToStep2Enable();
    goToStep(2);
    buildModelFromJson(data.model);
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
  // Same ordering as loadSample(): make #panel-2 visible before the
  // canvas's very first render() ever measures its own width.
  goToStep(2);
  if (!editor) initEditor();
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

// Path diagrams size their raster to the canvas's current CSS-rendered
// width each render() (see diagram.js's _syncCanvasResolution) — which
// covers every user interaction, but a plain browser-window resize with no
// other interaction wouldn't otherwise trigger a re-render, leaving the
// canvas at its old resolution/proportions until the next click. Debounced
// so a drag-resize doesn't re-render on every intermediate frame.
let diagramResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(diagramResizeTimer);
  diagramResizeTimer = setTimeout(() => {
    if (editor) editor.render();
    if (resultDiagram) resultDiagram.render();
    if (cbsemResultDiagram) cbsemResultDiagram.render();
  }, 200);
});

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

  // "Standardized" isn't a separate choice under Two Stage — it multiplies
  // two stage-1 factor scores, which are already standardized by
  // construction (Henseler & Chin, 2010), so there's no unstandardized/
  // mean-centered variant of it to pick. The product-term radios stay
  // visible but disabled (and visually pinned to "standardized") in that
  // case, rather than disappearing, so it reads as "this is already what
  // you get" instead of "this option went missing".
  function updateProductTermUI(isTwoStage) {
    document.querySelectorAll('#cProductTerm input[name="cProductTerm"]').forEach((r) => {
      r.disabled = isTwoStage;
      if (isTwoStage) r.checked = r.value === "standardized";
      else r.checked = r.value === (construct.product_term_generation || "standardized");
    });
    document.getElementById("productTermTwoStageNote").classList.toggle("hidden", !isTwoStage);
  }

  const calcMethod = construct.calc_method || "two_stage";
  document.querySelectorAll('#cCalcMethod input[name="cCalcMethod"]').forEach((r) => {
    r.checked = r.value === calcMethod;
    r.onchange = () => {
      construct.calc_method = r.value;
      updateProductTermUI(r.value === "two_stage");
      renderModelSummary();
    };
  });
  updateProductTermUI(calcMethod === "two_stage");

  document.querySelectorAll('#cProductTerm input[name="cProductTerm"]').forEach((r) => {
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
document.getElementById("powerAnalysisBtn").addEventListener("click", () => openPowerAnalysisModal("pls"));
document.getElementById("cbsemPowerAnalysisBtn").addEventListener("click", () => openPowerAnalysisModal("cbsem"));
document.getElementById("mlCompareBtn").addEventListener("click", () => openMlComparisonModal("pls"));
document.getElementById("cbsemMlCompareBtn").addEventListener("click", () => openMlComparisonModal("cbsem"));
document.getElementById("plspredictBtn").addEventListener("click", runPlspredict);
document.getElementById("ipmaBtn").addEventListener("click", openIpmaModal);

function openIpmaModal() {
  if (!editor) return;
  const endogenous = editor.constructs.filter((c) => c.mode !== "I" && editor.paths.some((p) => p.target === c.id));
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>${t("s3_ipma_btn")}</h3>
        <label>${t("s3_ipma_target_label")}</label>
        <select id="ipmaTargetSelect">
          ${endogenous.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
        <div class="modal-actions">
          <button class="btn" id="ipmaModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="ipmaModalOk">${t("sens_modal_run")}</button>
        </div>
      </div>
    </div>`;
  document.getElementById("ipmaModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("ipmaModalOk").onclick = () => {
    const target = document.getElementById("ipmaTargetSelect").value;
    root.innerHTML = "";
    runIpma(target);
  };
}

async function runIpma(target) {
  const btn = document.getElementById("ipmaBtn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("s3_plspredict_running");
  document.getElementById("resultsError").classList.add("hidden");
  try {
    const res = await fetch("/api/ipma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: state.fileId, model: editor.serialize(), lang: getLang(), target }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("sens_failed"));
    window.__lastIpma = data;
    document.getElementById("ipmaSection").classList.remove("hidden");
    renderIpma(data);
    document.getElementById("ipmaSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    document.getElementById("resultsError").textContent = err.message;
    document.getElementById("resultsError").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderIpma(data) {
  document.getElementById("ipmaTitle").textContent = t("s3_ipma_title", { target: data.target_name });

  let html = `<thead><tr><th>${t("th_construct")}</th><th>${t("th_ipma_importance")}</th><th>${t("th_ipma_performance")}</th></tr></thead><tbody>`;
  for (const r of data.rows) {
    html += `<tr><td>${escapeHtml(r.construct_name)}</td><td>${fmt(r.importance)}</td><td>${fmt(r.performance, 1)}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("ipmaTable").innerHTML = html;

  drawIpmaScatter(data.rows);
}

function drawIpmaScatter(rows) {
  const canvas = document.getElementById("ipmaChart");
  const tooltip = document.getElementById("ipmaTooltip");
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = Math.max(320, Math.min(460, cssWidth * 0.5));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const importances = rows.map((r) => r.importance);
  const iMin = Math.min(0, ...importances);
  const iMax = Math.max(...importances) * 1.15 || 1;
  const meanImportance = importances.reduce((a, b) => a + b, 0) / importances.length;
  const meanPerformance = rows.reduce((a, r) => a + r.performance, 0) / rows.length;

  const PAD_L = 46, PAD_R = 20, PAD_T = 16, PAD_B = 36;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const xOf = (x) => PAD_L + ((x - iMin) / (iMax - iMin || 1)) * plotW;
  const yOf = (y) => PAD_T + plotH - (y / 100) * plotH;

  function render(hoverIdx) {
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = "#e1e0d9";
    ctx.fillStyle = "#898781";
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const yv = i * 25;
      const yy = yOf(yv);
      ctx.beginPath();
      ctx.moveTo(PAD_L, yy);
      ctx.lineTo(PAD_L + plotW, yy);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(String(yv), PAD_L - 8, yy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xTickCount = 5;
    for (let i = 0; i <= xTickCount; i++) {
      const xv = iMin + ((iMax - iMin) * i) / xTickCount;
      ctx.fillText(xv.toFixed(2), xOf(xv), PAD_T + plotH + 8);
    }

    ctx.strokeStyle = "#c3c2b7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, PAD_T + plotH);
    ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
    ctx.stroke();

    // quadrant crosshair at the mean of the plotted antecedents
    ctx.strokeStyle = "#c3c2b7";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xOf(meanImportance), PAD_T);
    ctx.lineTo(xOf(meanImportance), PAD_T + plotH);
    ctx.moveTo(PAD_L, yOf(meanPerformance));
    ctx.lineTo(PAD_L + plotW, yOf(meanPerformance));
    ctx.stroke();
    ctx.setLineDash([]);

    rows.forEach((r, i) => {
      const px = xOf(r.importance), py = yOf(r.performance);
      const isHover = i === hoverIdx;
      ctx.beginPath();
      ctx.arc(px, py, isHover ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = SERIES_COLORS_APP[i % SERIES_COLORS_APP.length];
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#1c2333";
      ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(r.construct_name, px + 10, py);
    });
  }
  render(null);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let nearest = -1, bestDist = 400;
    rows.forEach((r, i) => {
      const d = Math.hypot(xOf(r.importance) - mx, yOf(r.performance) - my);
      if (d < bestDist) { bestDist = d; nearest = i; }
    });
    render(nearest);
    if (nearest === -1) {
      tooltip.classList.add("hidden");
      return;
    }
    const r = rows[nearest];
    tooltip.innerHTML = `<div class="tt-title">${escapeHtml(r.construct_name)}</div>` +
      `<div class="tt-row">${t("th_ipma_importance")}: <strong>${fmt(r.importance)}</strong></div>` +
      `<div class="tt-row">${t("th_ipma_performance")}: <strong>${fmt(r.performance, 1)}</strong></div>`;
    tooltip.classList.remove("hidden");
    tooltip.style.left = Math.min(mx + 12, cssWidth - tooltip.offsetWidth - 8) + "px";
    tooltip.style.top = Math.max(4, my - 40) + "px";
  };
  canvas.onmouseleave = () => {
    tooltip.classList.add("hidden");
    render(null);
  };
}

const SERIES_COLORS_APP = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

async function runPlspredict() {
  if (!editor) return;
  const btn = document.getElementById("plspredictBtn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("s3_plspredict_running");
  document.getElementById("resultsError").classList.add("hidden");
  try {
    const res = await fetch("/api/plspredict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: state.fileId, model: editor.serialize(), lang: getLang() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("sens_failed"));
    window.__lastPlspredict = data;
    renderPlspredictResults(data);
    document.getElementById("plspredictSection").classList.remove("hidden");
    document.getElementById("plspredictSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    document.getElementById("resultsError").textContent = err.message;
    document.getElementById("resultsError").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderPlspredictResults(data) {
  const verdictKey = {
    high: "lbl_plspredict_high", medium: "lbl_plspredict_medium",
    low: "lbl_plspredict_low", none: "lbl_plspredict_none",
  }[data.verdict] || "lbl_plspredict_low";
  document.getElementById("plspredictVerdict").innerHTML =
    `<strong>${t("s3_plspredict_verdict_label")}: ${t(verdictKey)}</strong> — ` +
    t("s3_plspredict_verdict_detail", { k: data.k, n: data.n_obs, wins: data.n_wins, total: data.n_total });

  let html = `<thead><tr><th>${t("th_indicator")}</th><th>${t("th_construct")}</th>` +
    `<th>${t("th_plspredict_pls_rmse")}</th><th>${t("th_plspredict_pls_mae")}</th>` +
    `<th>${t("th_plspredict_lm_rmse")}</th><th>${t("th_plspredict_lm_mae")}</th><th>${t("th_plspredict_result")}</th></tr></thead><tbody>`;
  for (const p of data.predictions) {
    const badge = p.pls_wins
      ? `<span class="badge ok">${t("lbl_plspredict_pls_wins")}</span>`
      : `<span class="badge warn">${t("lbl_plspredict_lm_wins")}</span>`;
    html += `<tr><td>${escapeHtml(p.indicator)}</td><td>${escapeHtml(p.construct_name)}</td>` +
      `<td>${fmt(p.pls_rmse)}</td><td>${fmt(p.pls_mae)}</td>` +
      `<td>${fmt(p.lm_rmse)}</td><td>${fmt(p.lm_mae)}</td><td>${badge}</td></tr>`;
  }
  html += "</tbody>";
  document.getElementById("plspredictTable").innerHTML = html;
}

function openSensitivityModal(method) {
  const isCbsem = method === "cbsem";
  const root = document.getElementById("modalRoot");
  const nRows = state.nRows || 0;
  const suggestedStep = Math.max(1, Math.round(nRows * 0.05));
  // CB-SEM's ML fit already gives a p-value per path at every step, no
  // extra cost — PLS-SEM has no closed-form significance test at all, so
  // getting one means an extra bootstrap run at every single step, hence
  // opt-in with its own count rather than always-on like CB-SEM.
  const pvalueSection = isCbsem
    ? `<p class="hint">${t("sens_modal_cbsem_pvalue_note")}</p>`
    : `
      <label class="radio-row" style="margin:10px 0 4px">
        <input type="checkbox" id="sensBootEnabled"> ${t("sens_modal_bootstrap_label")}
      </label>
      <div id="sensBootOptions" class="hidden">
        <label>${t("sens_modal_n_boot_label")}</label>
        <input type="number" id="sensNBoot" min="100" max="5000" step="50" value="100">
        <p class="hint">${t("sens_modal_bootstrap_hint")}</p>
      </div>`;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>${t("sens_modal_title")}</h3>
        <p class="hint">${t("sens_modal_hint", { n: nRows })}</p>
        <label>${t("sens_modal_step_label")}</label>
        <input type="number" id="sensStep" min="1" step="1" value="${suggestedStep}">
        ${pvalueSection}
        <div id="sensModalError" class="error-box hidden"></div>
        <div class="modal-actions">
          <button class="btn" id="sensModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="sensModalOk">${t("sens_modal_run")}</button>
        </div>
      </div>
    </div>`;
  if (!isCbsem) {
    document.getElementById("sensBootEnabled").onchange = (e) => {
      document.getElementById("sensBootOptions").classList.toggle("hidden", !e.target.checked);
    };
  }
  document.getElementById("sensModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("sensModalOk").onclick = () => {
    const step = parseInt(document.getElementById("sensStep").value, 10);
    const errBox = document.getElementById("sensModalError");
    if (!Number.isInteger(step) || step < 1) {
      errBox.textContent = t("sens_modal_invalid_step");
      errBox.classList.remove("hidden");
      return;
    }
    const job = { file_id: state.fileId, model: editor.serialize(), method, step, lang: getLang() };
    if (!isCbsem && document.getElementById("sensBootEnabled").checked) {
      const nBoot = parseInt(document.getElementById("sensNBoot").value, 10);
      if (!Number.isInteger(nBoot) || nBoot < 100) {
        errBox.textContent = t("sens_modal_invalid_n_boot");
        errBox.classList.remove("hidden");
        return;
      }
      job.bootstrap = { enabled: true, n_boot: nBoot };
    }
    sessionStorage.setItem("websem_sensitivity_job", JSON.stringify(job));
    root.innerHTML = "";
    window.open("/sensitivity", "_blank");
  };
  document.getElementById("sensStep").focus();
}

function openPowerAnalysisModal(method) {
  const isCbsem = method === "cbsem";
  const modelPayload = editor.serialize();
  const root = document.getElementById("modalRoot");

  const nonReflective = modelPayload.constructs.filter((c) => c.mode !== "A");
  if (nonReflective.length > 0) {
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-box">
          <h3>${t("power_modal_title")}</h3>
          <p class="hint">${t("power_btn_disabled_hint")}</p>
          <div class="modal-actions">
            <button class="btn" id="powerModalClose">${t("modal_cancel")}</button>
          </div>
        </div>
      </div>`;
    document.getElementById("powerModalClose").onclick = () => (root.innerHTML = "");
    return;
  }

  const idToName = {};
  modelPayload.constructs.forEach((c) => (idToName[c.id] = c.name));

  // Prefill from the last analysis of the matching engine — PLS-SEM's
  // /api/analyze response shapes this differently than CB-SEM's
  // /api/analyze_cbsem (coefficient vs. std, a loadings dict vs. an array).
  const lastResult = isCbsem ? lastCbsemResult : lastAnalysisResult;
  const coefByPath = {};
  ((lastResult && lastResult.structural && lastResult.structural.paths) || []).forEach((p) => {
    coefByPath[`${p.source}->${p.target}`] = isCbsem ? p.std : p.coefficient;
  });

  const lastLoadings = {};
  if (isCbsem) {
    ((lastResult && lastResult.measurement && lastResult.measurement.loadings) || []).forEach((row) => {
      lastLoadings[row.indicator] = row.std;
    });
  } else {
    Object.assign(lastLoadings, (lastResult && lastResult.measurement && lastResult.measurement.outer_loadings) || {});
  }
  const avgLoadingByConstruct = {};
  modelPayload.constructs.forEach((c) => {
    const vals = (c.indicators || []).map((ind) => lastLoadings[ind]).filter((v) => v !== undefined && v !== null);
    avgLoadingByConstruct[c.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.7;
  });

  const nRows = state.nRows || 200;
  const suggestedFrom = Math.max(50, Math.round((nRows * 0.5) / 10) * 10);
  const suggestedTo = Math.max(suggestedFrom + 100, Math.round((nRows * 1.5) / 10) * 10);
  const suggestedStep = Math.max(10, Math.round((suggestedTo - suggestedFrom) / 5 / 10) * 10);
  const defaultNMc = isCbsem ? 100 : 30;

  const pathRows = modelPayload.paths
    .map((p) => {
      const key = `${p.source}->${p.target}`;
      const def = coefByPath[key] !== undefined ? coefByPath[key] : 0.3;
      return `<div class="modal-value-row"><span>${escapeHtml(idToName[p.source])} → ${escapeHtml(idToName[p.target])}</span>` +
        `<input type="number" step="0.01" min="-0.99" max="0.99" value="${def.toFixed(2)}" data-path="${key}"></div>`;
    })
    .join("");

  const loadingRows = modelPayload.constructs
    .map((c) => {
      const def = avgLoadingByConstruct[c.id];
      return `<div class="modal-value-row"><span>${escapeHtml(c.name)}</span>` +
        `<input type="number" step="0.01" min="0.1" max="0.99" value="${def.toFixed(2)}" data-construct="${c.id}"></div>`;
    })
    .join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("power_modal_title")}</h3>
        <p class="hint">${t("power_modal_hint")}</p>
        <div class="modal-section-title">${t("power_modal_paths_title")}</div>
        ${pathRows}
        <div class="modal-section-title">${t("power_modal_loadings_title")}</div>
        ${loadingRows}
        <div class="modal-section-title">${t("power_modal_range_title")}</div>
        <div class="modal-range-row">
          <label>${t("power_modal_from")}<input type="number" id="powerNFrom" min="10" step="10" value="${suggestedFrom}"></label>
          <label>${t("power_modal_to")}<input type="number" id="powerNTo" min="20" step="10" value="${suggestedTo}"></label>
          <label>${t("power_modal_step")}<input type="number" id="powerNStep" min="1" step="10" value="${suggestedStep}"></label>
        </div>
        <details>
          <summary>${t("power_modal_advanced")}</summary>
          <label>${t("power_modal_n_mc")}<input type="number" id="powerNMc" min="20" max="500" value="${defaultNMc}"></label>
          ${isCbsem ? "" : `<label>${t("power_modal_n_boot")}<input type="number" id="powerNBoot" min="100" max="300" value="100"></label>`}
          <p class="hint" style="margin:2px 0 0">${t("power_modal_n_mc_hint")}</p>
        </details>
        <p class="hint" id="powerEstimateText"></p>
        <div id="powerModalError" class="error-box hidden"></div>
        <div class="modal-actions">
          <button class="btn" id="powerModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="powerModalOk">${t("power_modal_run")}</button>
        </div>
      </div>
    </div>`;

  function computePoints() {
    const from = parseInt(document.getElementById("powerNFrom").value, 10);
    const to = parseInt(document.getElementById("powerNTo").value, 10);
    const step = parseInt(document.getElementById("powerNStep").value, 10);
    if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(step) || from >= to || step < 1) return null;
    const points = [];
    for (let n = from; n <= to; n += step) points.push(n);
    return points;
  }

  function updateEstimate() {
    const points = computePoints();
    const nMc = parseInt(document.getElementById("powerNMc").value, 10) || defaultNMc;
    const text = document.getElementById("powerEstimateText");
    if (!points) {
      text.textContent = "";
      return;
    }
    // Rough client-side estimate only — the server enforces the real
    // budget cap regardless of this guess. PLS-SEM pays for n_boot_inner
    // extra fits per replicate (see MAX_TOTAL_FITS's comment in
    // pls/power_analysis.py, ~7.7ms/fit); CB-SEM has no bootstrap step, so
    // each replicate is just one ~44ms ML fit (cbsem/power_analysis.py).
    let estSec;
    if (isCbsem) {
      const SEC_PER_REPLICATE_CBSEM = 0.044;
      estSec = Math.round(points.length * nMc * SEC_PER_REPLICATE_CBSEM);
    } else {
      const nBoot = parseInt(document.getElementById("powerNBoot").value, 10) || 100;
      const SEC_PER_FIT = 0.0077;
      estSec = Math.round(points.length * nMc * (1 + nBoot) * SEC_PER_FIT);
    }
    text.textContent = t("power_modal_estimate", { sec: estSec, points: points.length, mc: nMc });
  }
  ["powerNFrom", "powerNTo", "powerNStep", "powerNMc"].concat(isCbsem ? [] : ["powerNBoot"]).forEach((id) => {
    document.getElementById(id).addEventListener("input", updateEstimate);
  });
  updateEstimate();

  document.getElementById("powerModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("powerModalOk").onclick = () => {
    const errBox = document.getElementById("powerModalError");
    const points = computePoints();
    const nMc = parseInt(document.getElementById("powerNMc").value, 10);
    const nBoot = isCbsem ? null : parseInt(document.getElementById("powerNBoot").value, 10);
    let valid = !!points && Number.isInteger(nMc) && nMc >= 1 && (isCbsem || (Number.isInteger(nBoot) && nBoot >= 1));

    const pathValues = {};
    root.querySelectorAll("input[data-path]").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (Number.isNaN(v)) valid = false;
      pathValues[inp.dataset.path] = v;
    });
    const loadingValues = {};
    root.querySelectorAll("input[data-construct]").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (Number.isNaN(v) || v <= 0 || v >= 1) valid = false;
      loadingValues[inp.dataset.construct] = v;
    });

    if (!valid) {
      errBox.textContent = t("power_modal_invalid");
      errBox.classList.remove("hidden");
      return;
    }
    const job = {
      method: isCbsem ? "cbsem" : "pls",
      model: modelPayload, path_values: pathValues, loading_values: loadingValues,
      n_from: points[0], n_to: points[points.length - 1],
      n_step: parseInt(document.getElementById("powerNStep").value, 10),
      n_mc: nMc, lang: getLang(),
    };
    if (!isCbsem) job.n_boot_inner = nBoot;
    sessionStorage.setItem("websem_power_job", JSON.stringify(job));
    root.innerHTML = "";
    window.open("/power_analysis", "_blank");
  };
}

async function openMlComparisonModal(method) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal-box"><h3>${t("ml_modal_title")}</h3><p class="hint">${t("ml_modal_loading_algorithms")}</p></div></div>`;

  let algorithms = null;
  try {
    const res = await fetch("/api/ml_algorithms");
    const data = await res.json();
    if (res.ok) algorithms = data.algorithms;
  } catch {
    algorithms = null;
  }
  if (!algorithms) {
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-box">
          <h3>${t("ml_modal_title")}</h3>
          <div class="error-box">${t("ml_modal_load_failed")}</div>
          <div class="modal-actions"><button class="btn" id="mlModalClose">${t("modal_cancel")}</button></div>
        </div>
      </div>`;
    document.getElementById("mlModalClose").onclick = () => (root.innerHTML = "");
    return;
  }

  const GROUPS = [
    { titleKey: "ml_group_linear", ids: ["linreg", "logreg"] },
    { titleKey: "ml_group_tree", ids: ["dtree", "rf", "svm", "gbm"] },
    { titleKey: "ml_group_boosting", ids: ["xgboost", "lightgbm", "catboost"] },
  ];
  const byId = Object.fromEntries(algorithms.map((a) => [a.id, a]));
  const algoItemHtml = (a) => `
    <label class="ml-algo-item"${a.available ? "" : ` title="${escapeAttr(t("ml_modal_unavailable_hint"))}"`}>
      <input type="checkbox" data-algo="${escapeAttr(a.id)}" ${a.available ? "checked" : "disabled"}>
      <span>${escapeHtml(t(a.name_key))}${a.available ? "" : ` <span class="hint">(${t("ml_modal_unavailable")})</span>`}</span>
    </label>
  `;
  const groupsHtml = GROUPS.map((g) => `
    <div class="modal-section-title">${t(g.titleKey)}</div>
    <div class="ml-algo-checklist">${g.ids.filter((id) => byId[id]).map((id) => algoItemHtml(byId[id])).join("")}</div>
  `).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("ml_modal_title")}</h3>
        <p class="hint">${t("ml_modal_hint")}</p>
        ${groupsHtml}
        <div class="ml-kfold-row">
          <label>${t("ml_modal_k_label")}</label>
          <input type="number" id="mlKFold" min="2" max="10" step="1" value="5">
        </div>
        <p class="hint">${t("ml_modal_k_hint")}</p>
        <div id="mlModalError" class="error-box hidden"></div>
        <div class="modal-actions">
          <button class="btn" id="mlModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="mlModalOk">${t("sens_modal_run")}</button>
        </div>
      </div>
    </div>`;
  document.getElementById("mlModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("mlModalOk").onclick = () => {
    const errBox = document.getElementById("mlModalError");
    const selected = [...root.querySelectorAll("input[data-algo]:checked")].map((i) => i.dataset.algo);
    const k = parseInt(document.getElementById("mlKFold").value, 10);
    if (selected.length === 0) {
      errBox.textContent = t("ml_modal_select_at_least_one");
      errBox.classList.remove("hidden");
      return;
    }
    if (!Number.isInteger(k) || k < 2 || k > 10) {
      errBox.textContent = t("ml_modal_invalid_k");
      errBox.classList.remove("hidden");
      return;
    }
    const job = { file_id: state.fileId, model: editor.serialize(), method, algorithms: selected, k, lang: getLang() };
    sessionStorage.setItem("websem_ml_job", JSON.stringify(job));
    root.innerHTML = "";
    window.open("/ml_comparison", "_blank");
  };
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
  document.getElementById("plspredictSection").classList.add("hidden");
  window.__lastPlspredict = null;
  document.getElementById("ipmaSection").classList.add("hidden");
  window.__lastIpma = null;
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
  renderSpecificIndirectTable(data, "specificIndirectTable");
  renderModeratedMediationTable(data, "moderatedMediationSection", "moderatedMediationTable");
  renderR2Table(data, idToName);
  renderVifTable(data, idToName);
  renderCmbTable(data.common_method_bias, idToName, "cmbHint", "cmbTable");
  renderSimpleSlopes(data, "simpleSlopesSection", "simpleSlopesGrid");
  renderBootstrapHistograms(data);
  renderSourceTransparency("sourceTransparency", data.source_transparency);
}

// ---------------- Simple slopes (moderation interpretation) ----------------
// Standard conditional-effects plot for a significant interaction (Aiken &
// West, 1991): Y = b_focal*X + b_mod*Z + b_int*(X*Z), evaluated at the
// moderator's -1SD/mean/+1SD (all constructs are already standardized
// composite/factor scores, so no intercept term is needed). Every number
// used here is a path coefficient already in the analyze response — no
// extra API round-trip.
const SLOPE_LEVEL_COLORS = { low: "#e34948", mean: "#2a78d6", high: "#1baf7a" };
const SLOPE_LEVEL_DASH = { low: [], mean: [7, 4], high: [1, 3] };

function renderSimpleSlopes(data, sectionId, gridId) {
  const section = document.getElementById(sectionId);
  const grid = document.getElementById(gridId);
  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));

  const interactions = data.constructs.filter((c) => c.mode === "I" && c.interaction_of);
  const cards = interactions
    .map((ic) => {
      const targetPath = data.structural.paths.find((p) => p.source === ic.id);
      return targetPath ? { ic, targetId: targetPath.target } : null;
    })
    .filter(Boolean);

  if (cards.length === 0) {
    section.classList.add("hidden");
    grid.innerHTML = "";
    return;
  }
  section.classList.remove("hidden");

  const coefOf = {};
  for (const p of data.structural.paths) {
    coefOf[`${p.source}->${p.target}`] = p.coefficient !== undefined ? p.coefficient : p.std;
  }

  grid.innerHTML = cards
    .map(
      (c, i) => `
      <div class="slope-card" data-idx="${i}">
        <div class="slope-card-header">
          <h4 id="${gridId}Title${i}"></h4>
          <button type="button" class="slope-swap-btn" data-idx="${i}">⇄ ${t("s3_slopes_swap")}</button>
        </div>
        <div class="chart-wrap"><canvas id="${gridId}Chart${i}"></canvas><div id="${gridId}Tooltip${i}" class="chart-tooltip hidden"></div></div>
        <div class="chart-legend" id="${gridId}Legend${i}"></div>
      </div>`
    )
    .join("");

  const swapped = cards.map(() => false);

  function draw(i) {
    const { ic, targetId } = cards[i];
    const [a, b] = ic.interaction_of;
    const focalId = swapped[i] ? a : b;
    const modId = swapped[i] ? b : a;
    const bFocal = coefOf[`${focalId}->${targetId}`] || 0;
    const bMod = coefOf[`${modId}->${targetId}`] || 0;
    const bInt = coefOf[`${ic.id}->${targetId}`] || 0;

    document.getElementById(`${gridId}Title${i}`).textContent =
      `${idToName[modId]} × ${idToName[focalId]} → ${idToName[targetId]}`;

    const xs = [];
    for (let x = -2; x <= 2.0001; x += 0.25) xs.push(Math.round(x * 100) / 100);

    const levels = [
      { key: "low", z: -1, label: t("s3_slopes_low", { name: idToName[modId] }) },
      { key: "mean", z: 0, label: t("s3_slopes_mean", { name: idToName[modId] }) },
      { key: "high", z: 1, label: t("s3_slopes_high", { name: idToName[modId] }) },
    ];
    const series = levels.map((lv) => ({
      id: lv.key,
      label: lv.label,
      color: SLOPE_LEVEL_COLORS[lv.key],
      dash: SLOPE_LEVEL_DASH[lv.key],
      points: xs.map((x) => ({ x, y: bFocal * x + bMod * lv.z + bInt * x * lv.z, converged: true })),
    }));

    drawSimpleSlopesChart(`${gridId}Chart${i}`, `${gridId}Tooltip${i}`, `${gridId}Legend${i}`, series, {
      xLabel: idToName[focalId], yLabel: idToName[targetId],
    });
  }

  grid.querySelectorAll(".slope-swap-btn").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.idx);
      swapped[i] = !swapped[i];
      draw(i);
    };
  });

  cards.forEach((_, i) => draw(i));
}

function drawSimpleSlopesChart(canvasId, tooltipId, legendId, series, opts) {
  const canvas = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  const legendEl = document.getElementById(legendId);
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = Math.max(260, Math.min(360, cssWidth * 0.55));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const allX = series[0].points.map((p) => p.x);
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yPad = (Math.max(...allY) - Math.min(...allY)) * 0.12 || 0.1;
  const yMin = Math.min(...allY) - yPad, yMax = Math.max(...allY) + yPad;

  const PAD_L = 50, PAD_R = 14, PAD_T = 14, PAD_B = 34;
  const plotW = cssWidth - PAD_L - PAD_R;
  const plotH = cssHeight - PAD_T - PAD_B;
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const yOf = (y) => PAD_T + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  legendEl.innerHTML = series
    .map((s) => `<div class="leg-item" style="cursor:default"><svg class="leg-swatch" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><line x1="0" y1="6" x2="22" y2="6" stroke="${s.color}" stroke-width="2.4"${s.dash.length ? ` stroke-dasharray="${s.dash.join(",")}"` : ""}/></svg>${escapeHtml(s.label)}</div>`)
    .join("");

  function render(nearestX) {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = "#e1e0d9";
    ctx.fillStyle = "#898781";
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const yv = yMin + ((yMax - yMin) * i) / 4;
      const yy = yOf(yv);
      ctx.beginPath();
      ctx.moveTo(PAD_L, yy);
      ctx.lineTo(PAD_L + plotW, yy);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(yv.toFixed(2), PAD_L - 8, yy);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 4; i++) {
      const xv = xMin + ((xMax - xMin) * i) / 4;
      ctx.fillText(xv.toFixed(1), xOf(xv), PAD_T + plotH + 8);
    }
    ctx.fillText(opts.xLabel, PAD_L + plotW / 2, PAD_T + plotH + 20);
    ctx.save();
    ctx.translate(12, PAD_T + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();

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
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.setLineDash(s.dash);
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const px = xOf(p.x), py = yOf(p.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      if (nearestX !== null) {
        const p = s.points.reduce((a, b) => (Math.abs(b.x - nearestX) < Math.abs(a.x - nearestX) ? b : a));
        ctx.beginPath();
        ctx.arc(xOf(p.x), yOf(p.y), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  render(null);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < PAD_L || mx > PAD_L + plotW) {
      tooltip.classList.add("hidden");
      render(null);
      return;
    }
    const targetX = xMin + ((mx - PAD_L) / plotW) * (xMax - xMin);
    const nearest = series[0].points.reduce((a, b) => (Math.abs(b.x - targetX) < Math.abs(a.x - targetX) ? b : a)).x;
    render(nearest);
    const rows = series
      .map((s) => {
        const p = s.points.find((pp) => pp.x === nearest);
        return `<div class="tt-row"><span class="tt-dot" style="color:${s.color}">●</span>${escapeHtml(s.label)}: <strong>${fmt(p.y)}</strong></div>`;
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
    render(null);
  };
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

// Decomposition of the aggregate indirect effect above into one row per
// individual mediated route (SmartPLS's "Specific Indirect Effects" report):
// e.g. X -> M1 -> Y and X -> M2 -> Y show up separately here even though
// they're summed into a single X -> Y row in the Total Effects table.
function renderSpecificIndirectTable(data, elId) {
  const rows = data.structural.specific_indirect_effects || [];
  const hasBoot = rows.some((r) => r.t_stat !== undefined);
  let html = `<thead><tr><th>${t("th_path")}</th><th>${t("th_indirect_effect")}</th>`;
  if (hasBoot) html += `<th>${t("th_stdev")}</th><th>${t("th_t_stat")}</th><th>${t("th_p_value")}</th><th>${t("th_significance")}</th>`;
  html += `</tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr><td colspan="${hasBoot ? 6 : 2}" style="text-align:center;color:#6b7385">${t("lbl_dash")}</td></tr>`;
  }
  for (const r of rows) {
    html += `<tr><td>${r.path_names.map(escapeHtml).join(" → ")}</td><td>${fmt(r.effect)}</td>`;
    if (hasBoot) {
      html += `<td>${fmt(r.bootstrap_std)}</td><td>${fmt(r.t_stat)}</td><td>${fmt(r.p_value)}</td><td>${sigBadge(r.significant)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById(elId).innerHTML = html;
}

// Index of Moderated Mediation (Hayes, 2015): only appears (section is
// hidden otherwise) for models where a mediated route has exactly one
// moderated edge — see pls/effects.py's find_moderated_mediation_opportunities
// for why routes with zero or two-or-more moderated edges never show up here.
function renderModeratedMediationTable(data, sectionId, tableId) {
  const rows = data.structural.moderated_mediation || [];
  const section = document.getElementById(sectionId);
  if (rows.length === 0) {
    section.classList.add("hidden");
    document.getElementById(tableId).innerHTML = "";
    return;
  }
  section.classList.remove("hidden");

  const hasBoot = rows.some((r) => r.t_stat !== undefined);
  let html = `<thead><tr><th>${t("th_path")}</th><th>${t("th_moderator")}</th><th>${t("th_mm_index")}</th>`;
  if (hasBoot) html += `<th>${t("th_stdev")}</th><th>${t("th_t_stat")}</th><th>${t("th_p_value")}</th><th>${t("th_significance")}</th>`;
  html += `</tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr><td>${r.path_names.map(escapeHtml).join(" → ")}</td><td>${escapeHtml(r.moderator_name)}</td><td>${fmt(r.index)}</td>`;
    if (hasBoot) {
      html += `<td>${fmt(r.bootstrap_std)}</td><td>${fmt(r.t_stat)}</td><td>${fmt(r.p_value)}</td><td>${sigBadge(r.significant)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  document.getElementById(tableId).innerHTML = html;
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
  renderSpecificIndirectTable(data, "cbsemSpecificIndirectTable");
  renderModeratedMediationTable(data, "cbsemModeratedMediationSection", "cbsemModeratedMediationTable");
  renderCbsemR2Table(data, idToName);
  renderCmbTable(data.common_method_bias, idToName, "cbsemCmbHint", "cbsemCmbTable");
  renderSimpleSlopes(data, "cbsemSimpleSlopesSection", "cbsemSimpleSlopesGrid");
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
