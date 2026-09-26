/* App orchestration: upload -> model builder -> run analysis -> results. */

const state = {
  fileId: null,
  filename: null,
  columns: [],
  numericColumns: [],
  previewRows: [],
  nRows: 0,
  // One-shot seed for Step 2's model builder, set by finalizeAiGeneration()
  // right after applyUploadResult() when the codebook's Construct column
  // grouped some indicators -- consumed (and cleared) the first time
  // initEditor() runs. See applyUploadResult() for why it's cleared there.
  pendingConstructSeed: null,
};

let editor = null;
let resultDiagram = null;
let nextNodePos = { x: 160, y: 110 };
let lastAnalysisResult = null;
let lastCbsemResult = null;
let cbsemResultDiagram = null;

// ---------------- Whole-app session persistence (localStorage) ----------------
// No login exists in this app -- this is the only "don't lose your work on
// refresh" mechanism. Saved continuously (beforeunload + a periodic safety
// net for a hard crash mid-AI-batch-loop) and restored once on load. Wrapped
// in try/catch throughout: a private window, a full quota, or a shape from
// an older app version must never block the page from loading normally.
const SESSION_KEY = "websem_session_v1";
const SESSION_VERSION = 1;

// Generic {id: value} snapshot/restore for plain form fields scoped to one
// container -- covers every simple input/textarea/select field in a wizard
// pane for free, without hand-listing dozens of ids per tab (dynamic-row
// tables like the codebook are handled separately, see saveSession/
// restoreSession below, since their rows have no ids to walk). Unlabeled
// radio groups (name but no id, e.g. the Likert-scale choices) are captured
// by group name instead.
function serializeFormFields(root) {
  const out = {};
  if (!root) return out;
  root.querySelectorAll("input[id], textarea[id], select[id]").forEach((el) => {
    if (el.type === "file" || el.disabled) return;
    if (el.type === "radio") return; // handled via name below
    out[el.id] = el.type === "checkbox" ? el.checked : el.value;
  });
  const radioNames = new Set();
  root.querySelectorAll('input[type="radio"][name]').forEach((el) => radioNames.add(el.name));
  radioNames.forEach((name) => {
    const checked = root.querySelector(`input[type="radio"][name="${name}"]:checked`);
    if (checked) out["radio:" + name] = checked.value;
  });
  return out;
}

function restoreFormFields(root, saved) {
  if (!root || !saved) return;
  Object.entries(saved).forEach(([key, value]) => {
    if (key.startsWith("radio:")) {
      const name = key.slice(6);
      const el = root.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(String(value))}"]`);
      if (el) el.checked = true;
      return;
    }
    const el = document.getElementById(key);
    if (!el || !root.contains(el)) return;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  });
}

function saveSession() {
  try {
    // Flush whatever's currently sitting in the dynamic-row tables (which
    // have no ids for serializeFormFields to walk) into aiGenState/expState
    // first, so the snapshot below is never stale relative to an
    // uncommitted edit -- unconditional (not gated to "only if that substep
    // is currently active" like aiGenCommitCurrentSubstepState/step-dot
    // navigation do) since a hidden substep's DOM rows are still sitting
    // there unchanged and are just as worth capturing.
    aiGenState.codebook = collectCodebook();
    { const { attrs } = collectDemoAttrs(); if (attrs) aiGenState.demoAttributes = attrs; }
    expState.codebook = collectCodebook("expCodebookTableBody");
    { const { attrs } = collectDemoAttrs("expDemoAttrsTableBody"); if (attrs) expState.demoAttributes = attrs; }
    // The condition-group DEFINITION drafts (substep 3, before "🎲 Chọn
    // ngẫu nhiên Workers" is clicked) are a separate thing from
    // expState.selectedGroups (the resulting random M-sized pick) -- both
    // are worth preserving independently.
    expState.groupDrafts = collectExpGroupDrafts();

    const activeTabBtn = document.querySelector("#dataSourceTabs .ai-provider-tab.active");
    const activePanel = document.querySelector(".step-panel.active");
    const aiGenActiveSubstep = document.querySelector("#aiGenSourcePane .ai-gen-substep.active");
    const expActiveSubstep = document.querySelector("#aiExperimentSourcePane .ai-gen-substep.active");

    const snapshot = {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      step: activePanel ? Number(activePanel.id.replace("panel-", "")) : 1,
      activeTab: activeTabBtn ? activeTabBtn.dataset.source : "upload",
      aiGenSubstep: aiGenActiveSubstep ? Number(aiGenActiveSubstep.id.replace("aiGenStep", "")) : 1,
      aiGenMaxSubstepReached: typeof aiGenMaxSubstepReached !== "undefined" ? aiGenMaxSubstepReached : 1,
      expSubstep: expActiveSubstep ? Number(expActiveSubstep.id.replace("expStep", "")) : 1,
      expMaxSubstepReached: typeof expMaxSubstepReached !== "undefined" ? expMaxSubstepReached : 1,
      state,
      editor: editor ? { constructs: editor.constructs, paths: editor.paths } : null,
      lastAnalysisResult,
      lastCbsemResult,
      resultsMode: lastCbsemResult && !document.getElementById("cbsemResultsContent").classList.contains("hidden") ? "cbsem" : "pls",
      aiGenState,
      expState,
      uploadFields: serializeFormFields(document.getElementById("uploadSourcePane")),
      aiGenFields: serializeFormFields(document.getElementById("aiGenSourcePane")),
      expFields: serializeFormFields(document.getElementById("aiExperimentSourcePane")),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Private window, full quota, or a mid-render DOM state -- never block
    // the page (or the beforeunload/interval trigger) over this.
  }
}

function restoreSession() {
  let saved;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    saved = JSON.parse(raw);
    if (!saved || saved.version !== SESSION_VERSION) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  try {
    if (saved.state) Object.assign(state, saved.state);
    if (saved.aiGenState) Object.assign(aiGenState, saved.aiGenState);
    if (saved.expState) Object.assign(expState, saved.expState);

    // Dynamic-row tables: rebuilt from the already-restored state objects,
    // the exact same way codebookImportBtn/aiGenImportAllInput already
    // rebuild a table from saved JSON (see those handlers).
    document.getElementById("codebookTableBody").innerHTML = "";
    (aiGenState.codebook || []).forEach((it) => codebookAddRow(it.column, it.question_text, it.construct, it.type));
    document.getElementById("demoAttrsTableBody").innerHTML = "";
    (aiGenState.demoAttributes || []).forEach((attr) => {
      const valueText = attr.type === "categorical" ? (attr.options || []).join(", ") : `${attr.min},${attr.max}`;
      demoAttrAddRow(attr.name, attr.type, valueText);
    });
    document.getElementById("expCodebookTableBody").innerHTML = "";
    (expState.codebook || []).forEach((it) => codebookAddRow(it.column, it.question_text, it.construct, it.type, "expCodebookTableBody"));
    document.getElementById("expDemoAttrsTableBody").innerHTML = "";
    (expState.demoAttributes || []).forEach((attr) => {
      const valueText = attr.type === "categorical" ? (attr.options || []).join(", ") : `${attr.min},${attr.max}`;
      demoAttrAddRow(attr.name, attr.type, valueText, "expDemoAttrsTableBody");
    });
    document.getElementById("expGroupsTableBody").innerHTML = "";
    (expState.groupDrafts || []).forEach((g) => expGroupAddRow(g.manipulation_text, g.size || 10));
    if (typeof updateExpGroupsSizeTotal === "function") updateExpGroupsSizeTotal();
    if (expState.selectedGroups && expState.selectedGroups.length) renderExpSelectionResult();

    // Plain form fields (age/gender/prompts/provider config/...) -- restored
    // after the state objects above so provider-tab re-rendering (which
    // reads aiGenState.provider/expState.provider) happens first, since that
    // rebuilds the API-key/model inputs this step then fills in.
    if (typeof renderAiGenProviderFields === "function") renderAiGenProviderFields();
    if (typeof applyExpProvider === "function") applyExpProvider(expState.provider || "openai");
    restoreFormFields(document.getElementById("uploadSourcePane"), saved.uploadFields);
    restoreFormFields(document.getElementById("aiGenSourcePane"), saved.aiGenFields);
    restoreFormFields(document.getElementById("aiExperimentSourcePane"), saved.expFields);
    if (typeof updateExpGroupsSizeTotal === "function") updateExpGroupsSizeTotal();

    // Model builder + results (editor must exist before renderResults/
    // renderCbsemResults, since both read editor.constructs/editor.paths).
    if (saved.editor && saved.editor.constructs) {
      if (!editor) initEditor();
      editor.loadFrom(saved.editor.constructs, saved.editor.paths || []);
      goToStep2Enable();
    }
    if (saved.lastAnalysisResult && saved.resultsMode !== "cbsem") {
      renderResults(saved.lastAnalysisResult);
    } else if (saved.lastCbsemResult) {
      renderCbsemResults(saved.lastCbsemResult);
    }
    if (state.fileId) refreshQualScorePanel();

    // Navigation: land exactly where the user left off.
    if (typeof aiGenMaxSubstepReached !== "undefined") aiGenMaxSubstepReached = saved.aiGenMaxSubstepReached || 1;
    if (typeof expMaxSubstepReached !== "undefined") expMaxSubstepReached = saved.expMaxSubstepReached || 1;
    const tabBtn = document.querySelector(`#dataSourceTabs .ai-provider-tab[data-source="${saved.activeTab}"]`);
    if (tabBtn) tabBtn.click();
    if (typeof aiGenGoToSubstep === "function") aiGenGoToSubstep(saved.aiGenSubstep || 1);
    if (typeof expGoToSubstep === "function") expGoToSubstep(saved.expSubstep || 1);
    goToStep(saved.step || 1);
  } catch {
    // A shape mismatch mid-restore must not leave the page half-wired --
    // clear the (apparently incompatible) saved session and let the rest
    // of this script's own normal initialization take over from here.
    localStorage.removeItem(SESSION_KEY);
  }
}

window.addEventListener("beforeunload", saveSession);
setInterval(saveSession, 20000);

document.getElementById("clearSessionBtn").addEventListener("click", () => {
  if (!confirm(t("footer_clear_session_confirm"))) return;
  // Reloading itself fires beforeunload, which would otherwise call
  // saveSession() one more time and silently re-write the very session
  // this click is trying to delete -- drop that listener first.
  window.removeEventListener("beforeunload", saveSession);
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear if storage was never reachable in the first place.
  }
  location.reload();
});

// ---------------- Language switch ----------------
applyStaticTranslations();
document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === getLang()));
updateGuideLink();

function updateGuideLink() {
  const link = document.getElementById("guideLink");
  if (link) link.href = `/static/docs/user_guide_${getLang()}.html`;
}
document.getElementById("runAnalysisBtn").textContent = t("s2_run_pls");
updateRunAnalysisBtnState();
document.getElementById("toolbarHint").textContent = t("s2_toolbar_hint_default");
document.getElementById("methodHint").textContent = t("s2_method_hint_pls");
document.getElementById("resultsLoadingMsg").textContent = t("s3_loading_pls");

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
  updateRunAnalysisBtnState();
  document.getElementById("toolbarHint").textContent =
    t(editor && editor.pathMode ? "s2_toolbar_hint_path_mode" : "s2_toolbar_hint_default");

  if (state.filename) {
    document.getElementById("dzFilename").textContent = t("s1_selected_file", { name: state.filename });
  }
  if (state.columns.length) updatePreviewTitle();
  if (document.getElementById("aiGenStep3").classList.contains("active")) {
    applyAiGenProvider(aiGenState.provider);
    updateAiGenNRowsHint();
  }
  // Codebook remove buttons are created dynamically (codebookAddRow()), so
  // their label isn't covered by the static data-i18n re-application above.
  document.querySelectorAll(".codebook-row-remove").forEach((btn) => {
    btn.textContent = t("s1_ai_codebook_remove");
  });
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
  // Only the AI-gen path re-sets this (immediately after calling this
  // function) -- a plain upload/sample load must never inherit a stale
  // construct grouping left over from an earlier, abandoned AI-gen session.
  state.pendingConstructSeed = null;

  document.getElementById("dzFilename").textContent = t("s1_selected_file", { name: data.filename });
  updatePreviewTitle();
  renderPreviewTable();
  document.getElementById("dataPreviewWrap").classList.remove("hidden");
  // Only the AI-generation path re-shows these; a plain upload or sample
  // load should never carry over a stale download link/export button/
  // demographics-and-stats panel from an earlier AI-generated dataset.
  document.getElementById("aiGenDownloadLink").classList.add("hidden");
  document.getElementById("aiGenExportBtn").classList.add("hidden");
  document.getElementById("aiGenResultExtra").classList.add("hidden");
  goToStep2Enable();
  updateRunAnalysisBtnState();
  refreshQualScorePanel();
}

// Server-authoritative visibility check for the "🤖 Chấm điểm câu hỏi mở"
// toolbar button (Step 2) -- a plain upload/sample load has no AI-gen
// metadata at all (404s here), which is exactly the confirmed scope
// (AI-generated data only), so the button simply stays hidden for those
// instead of needing a separate client-side "is this AI-generated" flag.
async function refreshQualScorePanel() {
  const btn = document.getElementById("qualScoreBtn");
  const csvBtn = document.getElementById("step2ExportCsvBtn");
  const excelBtn = document.getElementById("step2ExportExcelBtn");
  state.qualitativeColumns = [];
  if (!state.fileId) {
    btn.classList.add("hidden");
    csvBtn.classList.add("hidden");
    excelBtn.classList.add("hidden");
    return;
  }
  // The raw CSV download works for any file_id (AI-generated or a plain
  // upload) -- always offer it once there's data at all.
  csvBtn.href = `/api/ai_data_gen/download?file_id=${encodeURIComponent(state.fileId)}`;
  csvBtn.classList.remove("hidden");
  try {
    const res = await fetch(`/api/ai_qual_score/columns?file_id=${encodeURIComponent(state.fileId)}`);
    const data = await res.json();
    if (res.ok && Array.isArray(data.qualitative_columns) && data.qualitative_columns.length) {
      state.qualitativeColumns = data.qualitative_columns;
      btn.classList.remove("hidden");
    } else {
      btn.classList.add("hidden");
    }
    // The full Excel export (Survey Data/Respondent Profile/Stats/Prompt
    // Transparency, + any AI-rater-derived score columns since it's built
    // fresh from disk on every request) only exists for AI-generated data.
    if (res.ok && data.is_ai_generated) {
      excelBtn.href = `/api/ai_data_gen/export?file_id=${encodeURIComponent(state.fileId)}`;
      excelBtn.classList.remove("hidden");
    } else {
      excelBtn.classList.add("hidden");
    }
  } catch {
    btn.classList.add("hidden");
    excelBtn.classList.add("hidden");
  }
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

// ---------------- Step 1: AI-generated survey data ----------------
// A second path into Step 1, alongside upload/sample data: define a
// question codebook + target-respondent profile, then have an LLM (the
// caller's own API key, same 3 providers as the AI Report feature) write a
// synthetic Likert dataset. finalizeAiGeneration() hands the result to the
// exact same applyUploadResult() an upload or sample load uses, so nothing
// downstream (Step 2 model builder, /api/analyze) needs to know or care
// where the data came from.
const aiGenState = {
  codebook: [],
  demographics: {},
  demoAttributes: [],
  // Populated from AI construct-search results: {construct_name: {citation_apa, doi}}.
  // Carried into /finalize so it survives into the export's References sheet
  // and into Step 2's pre-seeded construct nodes (see finalizeAiGeneration).
  constructTheories: {},
  provider: "openai",
  apiKey: "",
  model: "",
  temperature: 1,
  systemPrompt: "",
  userPrompt: "",
  columns: [],
  likertMin: 1,
  likertMax: 5,
  nRows: 200,
  batchSize: 25,
  totalBatches: 0,
  firstBatchInstruction: "",
  currentBatch: 0,
  rows: [],
  // One entry per successful batch call: {start_row, end_row, system_prompt,
  // user_prompt} -- the ACTUAL prompt that produced those rows (post any
  // server-side corrective retry), persisted at finalize time for the
  // "prompt transparency" section and the full Excel export.
  batchLog: [],
};
let aiGenUserPromptEdited = false;
// Latest AI-drawn-model rationale (renderAiPathsReview's Apply handler), if
// any -- folded into the "save all proposals" model export alongside it.
let lastPathsRationale = null;

document.getElementById("dataSourceTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".ai-provider-tab");
  if (!btn) return;
  const source = btn.dataset.source;
  document.querySelectorAll("#dataSourceTabs .ai-provider-tab").forEach((b) => b.classList.toggle("active", b === btn));
  document.getElementById("uploadSourcePane").classList.toggle("hidden", source !== "upload");
  document.getElementById("aiGenSourcePane").classList.toggle("hidden", source !== "ai_gen");
  document.getElementById("aiExperimentSourcePane").classList.toggle("hidden", source !== "ai_experiment");
});

let aiGenMaxSubstepReached = 1;
function aiGenGoToSubstep(n) {
  aiGenMaxSubstepReached = Math.max(aiGenMaxSubstepReached, n);
  document.querySelectorAll(".ai-gen-substep").forEach((el) => el.classList.remove("active"));
  document.getElementById("aiGenStep" + n).classList.add("active");
  document.querySelectorAll("#aiGenSteps .ai-gen-step-dot").forEach((dot) => {
    const num = Number(dot.dataset.substep);
    dot.classList.toggle("active", num === n);
    dot.classList.toggle("done", num < n);
    dot.classList.toggle("reached", num <= aiGenMaxSubstepReached);
  });
}

// Jumping via a step-dot bypasses whichever step's own "Next" button would
// normally commit its DOM edits into aiGenState -- so do that commit
// ourselves whenever the user navigates away from step 1 or 2 this way,
// otherwise a codebook/profile edit made after going back could be silently
// dropped when jumping forward again without re-clicking "Next".
function aiGenCommitCurrentSubstepState() {
  if (document.getElementById("aiGenStep1").classList.contains("active")) {
    aiGenState.codebook = collectCodebook();
  } else if (document.getElementById("aiGenStep2").classList.contains("active")) {
    const { attrs } = collectDemoAttrs();
    if (attrs) aiGenState.demoAttributes = attrs;
    aiGenState.demographics = collectDemographics();
  }
}

document.getElementById("aiGenSteps").addEventListener("click", (e) => {
  const dot = e.target.closest(".ai-gen-step-dot");
  if (!dot) return;
  const target = Number(dot.dataset.substep);
  if (target > aiGenMaxSubstepReached) return;
  const activeEl = document.querySelector(".ai-gen-substep.active");
  const previousActive = activeEl ? Number(activeEl.id.replace("aiGenStep", "")) : null;
  aiGenCommitCurrentSubstepState();
  aiGenGoToSubstep(target);
  // Arriving at step 3 from elsewhere needs the same refresh its own "Next"
  // button already does -- otherwise the prompt preview keeps showing
  // whatever was last fetched, stale relative to any codebook/profile edit
  // just made after jumping back via a dot.
  if (target === 3 && previousActive !== 3) {
    requestPromptSuggestion();
  }
});

// ---- Sub-step 1: Codebook ----
function codebookAddRow(column, question, construct, type, tbodyId) {
  const tbody = document.getElementById(tbodyId || "codebookTableBody");
  const tr = document.createElement("tr");
  const colInput = document.createElement("input");
  colInput.type = "text";
  colInput.className = "codebook-col-input";
  colInput.value = column || "";
  const constructInput = document.createElement("input");
  constructInput.type = "text";
  constructInput.className = "codebook-construct-input";
  constructInput.value = construct || "";
  const qInput = document.createElement("input");
  qInput.type = "text";
  qInput.className = "codebook-question-input";
  qInput.value = question || "";
  const typeSelect = document.createElement("select");
  typeSelect.className = "codebook-type-select";
  const optLikert = document.createElement("option");
  optLikert.value = "likert";
  optLikert.textContent = t("s1_ai_codebook_type_likert");
  const optQual = document.createElement("option");
  optQual.value = "qualitative";
  optQual.textContent = t("s1_ai_codebook_type_qualitative");
  typeSelect.append(optLikert, optQual);
  typeSelect.value = type === "qualitative" ? "qualitative" : "likert";
  const tdCol = document.createElement("td");
  tdCol.appendChild(colInput);
  const tdConstruct = document.createElement("td");
  tdConstruct.appendChild(constructInput);
  const tdQ = document.createElement("td");
  tdQ.appendChild(qInput);
  const tdType = document.createElement("td");
  tdType.appendChild(typeSelect);
  const tdRemove = document.createElement("td");
  tdRemove.className = "codebook-remove-cell";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "codebook-row-remove";
  removeBtn.textContent = t("s1_ai_codebook_remove");
  removeBtn.addEventListener("click", () => tr.remove());
  tdRemove.appendChild(removeBtn);
  tr.append(tdCol, tdConstruct, tdQ, tdType, tdRemove);
  tbody.appendChild(tr);
}
document.getElementById("codebookAddRowBtn").addEventListener("click", () => codebookAddRow());

function collectCodebook(tbodyId) {
  return Array.from(document.querySelectorAll(`#${tbodyId || "codebookTableBody"} tr`))
    .map((tr) => ({
      column: tr.querySelector(".codebook-col-input").value.trim(),
      construct: tr.querySelector(".codebook-construct-input").value.trim(),
      question_text: tr.querySelector(".codebook-question-input").value.trim(),
      type: tr.querySelector(".codebook-type-select").value === "qualitative" ? "qualitative" : "likert",
    }))
    .filter((r) => r.column);
}

// Groups codebook items by their (optional) Construct column -- used to
// pre-seed Step 2's model canvas with matching construct nodes, so the
// user doesn't have to manually recreate groupings that came from the AI
// construct search (or that they typed in by hand).
function buildConstructGroupsFromCodebook(codebook) {
  const groups = [];
  const byName = new Map();
  for (const item of codebook) {
    const name = (item.construct || "").trim();
    if (!name) continue;
    if (!byName.has(name)) {
      const group = { name, indicators: [] };
      byName.set(name, group);
      groups.push(group);
    }
    byName.get(name).indicators.push(item.column);
  }
  return groups;
}

document.getElementById("codebookExportBtn").addEventListener("click", () => {
  const payload = {
    format: "pls-sem-web-codebook",
    version: 1,
    exported_at: new Date().toISOString(),
    items: collectCodebook(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "survey_codebook.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("codebookImportBtn").addEventListener("click", () => {
  document.getElementById("codebookImportInput").click();
});
// Accepts either a codebook export (format: "pls-sem-web-codebook", a flat
// {column, construct, question_text} list) or a full model export (format:
// "pls-sem-web-model" -- constructs + indicators, produced by exportModelBtn/
// "Save all proposals") -- so a model designed earlier can be reopened here
// to (re)generate synthetic data matching its exact construct/indicator
// structure, indicator wording included when the model export carried it.
function codebookItemsFromModelExport(parsed) {
  // "Save all proposals" (buildModelExportPayload) carries the full original
  // codebook when one exists -- prefer it exactly as-is, since it also
  // covers rows not currently assigned to any construct in the model
  // (reconstructing purely from constructs/indicators would silently drop
  // those). Fall back to rebuilding from constructs + indicator_descriptions
  // for a model exported without a codebook (e.g. hand-built from a plain
  // upload, or from an older export).
  if (Array.isArray(parsed.codebook) && parsed.codebook.length) {
    return parsed.codebook;
  }
  const descriptions = parsed.indicator_descriptions || {};
  const items = [];
  (parsed.constructs || []).forEach((c) => {
    if (!c || c.mode === "I") return; // interaction constructs have no raw indicators to import
    const name = String(c.name || "").trim();
    (c.indicators || []).forEach((rawCol) => {
      const column = String(rawCol || "").trim();
      if (!column) return;
      items.push({ column, construct: name, question_text: descriptions[column] || "" });
    });
  });
  return items;
}

document.getElementById("codebookImportInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errBox = document.getElementById("codebookImportError");
  const reader = new FileReader();
  reader.onload = () => {
    errBox.classList.add("hidden");
    try {
      const parsed = JSON.parse(reader.result);
      const isModelExport = parsed.format === "pls-sem-web-model" || Array.isArray(parsed.constructs);
      const rawItems = isModelExport ? codebookItemsFromModelExport(parsed) : parsed.items;
      if (!Array.isArray(rawItems)) throw new Error(t("s1_ai_codebook_min_rows"));
      const cleanItems = rawItems.filter((it) => it && String(it.column || "").trim());
      if (!cleanItems.length) throw new Error(t("s1_ai_codebook_min_rows"));
      document.getElementById("codebookTableBody").innerHTML = "";
      cleanItems.forEach((it) => codebookAddRow(it.column, it.question_text || "", it.construct || "", it.type));
    } catch (err) {
      errBox.textContent = t("s1_ai_codebook_import_failed", { msg: err.message });
      errBox.classList.remove("hidden");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

// AI Lab Experiment's own codebook table gets the exact same definition
// export/import as the plain AI Lab wizard above -- same JSON shape, same
// model-export fallback, just scoped to expCodebookTableBody.
document.getElementById("expCodebookExportBtn").addEventListener("click", () => {
  const payload = {
    format: "pls-sem-web-codebook",
    version: 1,
    exported_at: new Date().toISOString(),
    items: collectCodebook("expCodebookTableBody"),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "survey_codebook.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("expCodebookImportBtn").addEventListener("click", () => {
  document.getElementById("expCodebookImportInput").click();
});
document.getElementById("expCodebookImportInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errBox = document.getElementById("expCodebookImportError");
  const reader = new FileReader();
  reader.onload = () => {
    errBox.classList.add("hidden");
    try {
      const parsed = JSON.parse(reader.result);
      const isModelExport = parsed.format === "pls-sem-web-model" || Array.isArray(parsed.constructs);
      const rawItems = isModelExport ? codebookItemsFromModelExport(parsed) : parsed.items;
      if (!Array.isArray(rawItems)) throw new Error(t("s1_ai_codebook_min_rows"));
      const cleanItems = rawItems.filter((it) => it && String(it.column || "").trim());
      if (!cleanItems.length) throw new Error(t("s1_ai_codebook_min_rows"));
      document.getElementById("expCodebookTableBody").innerHTML = "";
      cleanItems.forEach((it) => codebookAddRow(it.column, it.question_text || "", it.construct || "", it.type, "expCodebookTableBody"));
    } catch (err) {
      errBox.textContent = t("s1_ai_codebook_import_failed", { msg: err.message });
      errBox.classList.remove("hidden");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

// ---- AI-assisted construct/indicator search (literature review) ----
// Uses the shared provider/API key/model/temperature fields above (visible
// from Step 1 onward) -- no separate key entry for this feature.
document.getElementById("constructSearchToggleBtn").addEventListener("click", () => {
  document.getElementById("constructSearchPanel").classList.toggle("hidden");
});

let lastConstructSearchResults = [];

function renderConstructSearchResults(constructs) {
  const el = document.getElementById("constructSearchGroups");
  el.innerHTML = constructs.map((group, gi) => {
    const theory = group.theory || {};
    const citation = [theory.citation_apa, theory.doi ? `DOI: ${theory.doi}` : ""].filter(Boolean).join(" — ");
    return `
    <div class="construct-search-group">
      <label class="checkbox-row">
        <input type="checkbox" class="construct-group-check" data-group="${gi}" checked>
        <strong>${escapeHtml(group.name)}</strong>
      </label>
      ${citation ? `<p class="hint construct-theory-hint">📚 ${escapeHtml(citation)}</p>` : ""}
      <div class="construct-search-items">
        ${group.items.map((item, ii) => `
          <label class="checkbox-row">
            <input type="checkbox" class="construct-item-check" data-group="${gi}" data-index="${ii}" checked>
            <code>${escapeHtml(item.column)}</code> — ${escapeHtml(item.question_text)}
          </label>
        `).join("")}
      </div>
    </div>
  `;
  }).join("");
}

document.getElementById("constructSearchGroups").addEventListener("change", (e) => {
  if (!e.target.classList.contains("construct-group-check")) return;
  const gi = e.target.dataset.group;
  document.querySelectorAll(`.construct-item-check[data-group="${gi}"]`).forEach((cb) => {
    cb.checked = e.target.checked;
  });
});

document.getElementById("constructSearchRunBtn").addEventListener("click", async () => {
  const errBox = document.getElementById("constructSearchError");
  errBox.classList.add("hidden");
  document.getElementById("constructSearchResults").classList.add("hidden");
  const topic = document.getElementById("constructSearchTopic").value.trim();
  if (!topic) {
    errBox.textContent = t("s1_ai_construct_search_missing_topic");
    errBox.classList.remove("hidden");
    return;
  }
  const apiKey = document.getElementById("aiGenApiKey").value.trim();
  if (!apiKey) {
    errBox.textContent = t("s1_ai_config_missing_key");
    errBox.classList.remove("hidden");
    return;
  }
  const loading = document.getElementById("constructSearchLoading");
  loading.classList.remove("hidden");
  try {
    const res = await fetch("/api/ai_data_gen/suggest_constructs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: aiGenState.provider,
        api_key: apiKey,
        model: document.getElementById("aiGenModel").value.trim() || AI_PROVIDERS[aiGenState.provider].defaultModel,
        temperature: Number(aiGenTemperatureInput.value),
        topic,
        n_constructs: Number(document.getElementById("constructSearchCount").value) || 5,
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "search failed");
    lastConstructSearchResults = data.constructs || [];
    renderConstructSearchResults(lastConstructSearchResults);
    document.getElementById("constructSearchDisclaimer").classList.toggle("hidden", lastConstructSearchResults.length === 0);
    document.getElementById("constructSearchResults").classList.remove("hidden");
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
});

document.getElementById("constructSearchCancelBtn").addEventListener("click", () => {
  document.getElementById("constructSearchResults").classList.add("hidden");
});

document.getElementById("constructSearchAddBtn").addEventListener("click", () => {
  document.querySelectorAll(".construct-item-check:checked").forEach((cb) => {
    const group = lastConstructSearchResults[Number(cb.dataset.group)];
    const item = group.items[Number(cb.dataset.index)];
    codebookAddRow(item.column, item.question_text, group.name);
    if (group.theory) aiGenState.constructTheories[group.name] = group.theory;
  });
  document.getElementById("constructSearchResults").classList.add("hidden");
  document.getElementById("constructSearchPanel").classList.add("hidden");
});

document.getElementById("codebookNextBtn").addEventListener("click", () => {
  const errBox = document.getElementById("codebookValidationError");
  errBox.classList.add("hidden");
  const items = collectCodebook();
  if (!items.length) {
    errBox.textContent = t("s1_ai_codebook_min_rows");
    errBox.classList.remove("hidden");
    return;
  }
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.column)) {
      errBox.textContent = t("s1_ai_codebook_duplicate_column", { name: item.column });
      errBox.classList.remove("hidden");
      return;
    }
    seen.add(item.column);
  }
  aiGenState.codebook = items;
  aiGenGoToSubstep(2);
});

// Shortcut for a user who just wants to design the model (constructs +
// structural paths + AI rationale) without walking through the rest of the
// data-generation wizard -- e.g. real data will be uploaded later, or the
// model is only being drafted for now. Reuses the same codebook validation
// as codebookNextBtn and the same one-shot construct-seeding mechanism as
// finalizeAiGeneration(), just without any data-generation step in between.
document.getElementById("skipToModelBtn").addEventListener("click", () => {
  const errBox = document.getElementById("codebookValidationError");
  errBox.classList.add("hidden");
  const items = collectCodebook();
  if (!items.length) {
    errBox.textContent = t("s1_ai_codebook_min_rows");
    errBox.classList.remove("hidden");
    return;
  }
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.column)) {
      errBox.textContent = t("s1_ai_codebook_duplicate_column", { name: item.column });
      errBox.classList.remove("hidden");
      return;
    }
    seen.add(item.column);
  }
  aiGenState.codebook = items;

  // Draft mode: no real rows yet, so #runAnalysisBtn stays disabled (see
  // updateRunAnalysisBtnState) until a real upload/AI-generated dataset
  // supplies actual data -- but the codebook's columns are still real
  // enough to populate as candidate indicators in Step 2.
  state.fileId = null;
  state.filename = null;
  state.columns = items.map((i) => i.column);
  state.numericColumns = state.columns;
  state.previewRows = [];
  state.nRows = 0;
  document.getElementById("aiGenDownloadLink").classList.add("hidden");
  document.getElementById("aiGenExportBtn").classList.add("hidden");
  document.getElementById("aiGenResultExtra").classList.add("hidden");
  document.getElementById("dataPreviewWrap").classList.add("hidden");

  state.pendingConstructSeed = buildConstructGroupsFromCodebook(aiGenState.codebook).map((g) => ({
    ...g, theory: aiGenState.constructTheories[g.name] || null,
  }));

  goToStep2Enable();
  goToStep(2);
  if (!editor) initEditor();
  updateRunAnalysisBtnState();
});

// ---- Sub-step 2: Respondent profile ----
document.getElementById("demoBackBtn").addEventListener("click", () => aiGenGoToSubstep(1));

// User-definable extra demographic attributes (beyond the fixed age/gender
// above), e.g. "monthly income" (numeric) or "education level" (categorical).
// Mirrors the codebook table's dynamic-row pattern; the server (not this
// code) is the source of truth for validation and for deriving a stable
// column name from the attribute's display name.
function demoAttrAddRow(name, type, valueText, tbodyId) {
  const tbody = document.getElementById(tbodyId || "demoAttrsTableBody");
  const tr = document.createElement("tr");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "demo-attr-name-input";
  nameInput.value = name || "";
  const tdName = document.createElement("td");
  tdName.appendChild(nameInput);

  const typeSelect = document.createElement("select");
  typeSelect.className = "demo-attr-type-select";
  const optNumeric = document.createElement("option");
  optNumeric.value = "numeric";
  optNumeric.textContent = t("s1_ai_demo_attrs_type_numeric");
  const optCategorical = document.createElement("option");
  optCategorical.value = "categorical";
  optCategorical.textContent = t("s1_ai_demo_attrs_type_categorical");
  typeSelect.append(optNumeric, optCategorical);
  typeSelect.value = type === "categorical" ? "categorical" : "numeric";
  const tdType = document.createElement("td");
  tdType.appendChild(typeSelect);

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "demo-attr-value-input";
  valueInput.value = valueText || "";
  const updateValuePlaceholder = () => {
    valueInput.placeholder = t(
      typeSelect.value === "categorical" ? "s1_ai_demo_attrs_value_placeholder_categorical" : "s1_ai_demo_attrs_value_placeholder_numeric"
    );
  };
  updateValuePlaceholder();
  typeSelect.addEventListener("change", updateValuePlaceholder);
  const tdValue = document.createElement("td");
  tdValue.appendChild(valueInput);

  const tdRemove = document.createElement("td");
  tdRemove.className = "codebook-remove-cell";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "codebook-row-remove";
  removeBtn.textContent = t("s1_ai_codebook_remove");
  removeBtn.addEventListener("click", () => tr.remove());
  tdRemove.appendChild(removeBtn);

  tr.append(tdName, tdType, tdValue, tdRemove);
  tbody.appendChild(tr);
}
document.getElementById("demoAttrsAddRowBtn").addEventListener("click", () => demoAttrAddRow());

// Returns { attrs, error } -- attrs is the payload shape the backend's
// _validate_demo_attributes expects; error is a user-facing message if any
// row's value doesn't parse for its declared type. Empty rows (no name) are
// silently skipped, same as the codebook's collectCodebook().
function collectDemoAttrs(tbodyId) {
  const attrs = [];
  for (const tr of document.querySelectorAll(`#${tbodyId || "demoAttrsTableBody"} tr`)) {
    const name = tr.querySelector(".demo-attr-name-input").value.trim();
    const type = tr.querySelector(".demo-attr-type-select").value;
    const valueText = tr.querySelector(".demo-attr-value-input").value.trim();
    if (!name) continue;
    if (type === "numeric") {
      const parts = valueText.split(/[-,]/).map((s) => s.trim()).filter(Boolean);
      const min = Number(parts[0]);
      const max = Number(parts[1]);
      if (parts.length !== 2 || !Number.isFinite(min) || !Number.isFinite(max)) {
        return { attrs: null, error: t("s1_ai_demo_attrs_invalid_numeric", { name }) };
      }
      attrs.push({ name, type: "numeric", min, max });
    } else {
      const options = valueText.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) {
        return { attrs: null, error: t("s1_ai_demo_attrs_invalid_categorical", { name }) };
      }
      attrs.push({ name, type: "categorical", options });
    }
  }
  return { attrs, error: null };
}

function collectDemographics() {
  return {
    age_min: document.getElementById("demoAgeMin").value || null,
    age_max: document.getElementById("demoAgeMax").value || null,
    gender_mix: document.getElementById("demoGenderMix").value,
    occupation: document.getElementById("demoOccupation").value.trim(),
    location: document.getElementById("demoLocation").value.trim(),
    target_population: document.getElementById("demoTargetPopulation").value.trim(),
  };
}

document.getElementById("demoNextBtn").addEventListener("click", () => {
  const errBox = document.getElementById("demoAttrsValidationError");
  errBox.classList.add("hidden");
  const { attrs, error } = collectDemoAttrs();
  if (error) {
    errBox.textContent = error;
    errBox.classList.remove("hidden");
    return;
  }
  aiGenState.demoAttributes = attrs;
  aiGenState.demographics = collectDemographics();
  aiGenGoToSubstep(3);
  aiGenUserPromptEdited = false;
  requestPromptSuggestion();
});

// ---- Sub-step 3: Generation settings + prompt ----
document.getElementById("aiGenUserPrompt").addEventListener("input", () => {
  aiGenUserPromptEdited = true;
});
let aiGenSystemPromptEdited = false;
document.getElementById("aiGenSystemPromptPreview").addEventListener("input", () => {
  aiGenSystemPromptEdited = true;
});

function renderAiGenProviderFields() {
  document.getElementById("aiGenProviderTabs").innerHTML = AI_PROVIDER_ORDER.map(
    (id) => `<button type="button" class="ai-provider-tab${id === aiGenState.provider ? " active" : ""}" data-provider="${id}">${aiReportEscapeHtml(AI_PROVIDERS[id].label)}</button>`,
  ).join("");
  applyAiGenProvider(aiGenState.provider);
}
// The provider/API key/model/temperature block is shared across the whole
// wizard (visible from Step 1 onward), not just Step 3 -- render it once at
// load instead of lazily on the Step 2 -> 3 transition, so the key is
// available up front for the construct-search feature too.
renderAiGenProviderFields();

function applyAiGenProvider(providerId) {
  aiGenState.provider = providerId;
  document.querySelectorAll("#aiGenProviderTabs .ai-provider-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === providerId));
  const cfg = AI_PROVIDERS[providerId];
  const stored = aiReportGetStoredKey(providerId);
  const keyInput = document.getElementById("aiGenApiKey");
  keyInput.value = stored;
  keyInput.placeholder = cfg.keyPlaceholder;
  document.getElementById("aiGenRememberKey").checked = !!stored;
  document.getElementById("aiGenModel").value = cfg.defaultModel;
  document.getElementById("aiGenModelSuggestions").innerHTML = cfg.modelSuggestions.map((m) => `<option value="${aiReportEscapeAttr(m)}">`).join("");
  document.getElementById("aiGenApiKeyHint").textContent = t("ai_modal_api_key_hint", { provider: cfg.label });
}

document.getElementById("aiGenProviderTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".ai-provider-tab");
  if (btn) applyAiGenProvider(btn.dataset.provider);
});
document.getElementById("aiGenKeyToggle").addEventListener("click", () => {
  const input = document.getElementById("aiGenApiKey");
  input.type = input.type === "password" ? "text" : "password";
});
const aiGenTemperatureInput = document.getElementById("aiGenTemperature");
aiGenTemperatureInput.addEventListener("input", () => {
  document.getElementById("aiGenTemperatureValue").textContent = Number(aiGenTemperatureInput.value).toFixed(1);
});

function clampAiGenNRows() {
  const input = document.getElementById("aiGenNRows");
  let n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) n = 200;
  n = Math.max(30, Math.min(500, n));
  input.value = n;
  return n;
}
function clampAiGenBatchSize() {
  const input = document.getElementById("aiGenBatchSize");
  let n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) n = 25;
  n = Math.max(1, Math.min(50, n));
  input.value = n;
  return n;
}
function updateAiGenNRowsHint() {
  document.getElementById("aiGenNRowsHint").textContent = t("s1_ai_config_n_rows_hint", { max: 500, batch: clampAiGenBatchSize() });
}
updateAiGenNRowsHint();
// requestPromptSuggestion() itself only overwrites the *textarea value* when
// the user hasn't hand-edited it (aiGenUserPromptEdited) -- so these
// listeners always call it unconditionally, keeping the system-prompt
// preview, first-batch preview and total-batches hint accurate even after
// the user has customized the base prompt text.
document.getElementById("aiGenNRows").addEventListener("change", () => {
  clampAiGenNRows();
  requestPromptSuggestion();
});
document.getElementById("aiGenBatchSize").addEventListener("change", () => {
  clampAiGenBatchSize();
  requestPromptSuggestion();
});
document.querySelectorAll('input[name="aiGenLikert"]').forEach((r) =>
  r.addEventListener("change", () => requestPromptSuggestion()),
);

async function requestPromptSuggestion() {
  const nRows = clampAiGenNRows();
  const likertScale = Number(document.querySelector('input[name="aiGenLikert"]:checked').value);
  const batchSize = clampAiGenBatchSize();
  try {
    const res = await fetch("/api/ai_data_gen/suggest_prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codebook: aiGenState.codebook,
        demographics: aiGenState.demographics,
        demo_attributes: aiGenState.demoAttributes,
        n_rows: nRows,
        likert_scale: likertScale,
        batch_size: batchSize,
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) return;
    aiGenState.batchSize = data.batch_size;
    aiGenState.totalBatches = data.total_batches;
    aiGenState.firstBatchInstruction = data.first_batch_instruction || "";
    if (!aiGenSystemPromptEdited) {
      aiGenState.systemPrompt = data.system_prompt;
      document.getElementById("aiGenSystemPromptPreview").value = data.system_prompt;
    }
    if (!aiGenUserPromptEdited) {
      document.getElementById("aiGenUserPrompt").value = data.user_prompt;
    }
    updateAiGenNRowsHint();
    updateAiGenFullPreview();
  } catch {
    // Best-effort preview only -- the actual "Generate data" click revalidates everything.
  }
}
document.getElementById("aiGenRegenBtn").addEventListener("click", () => {
  aiGenUserPromptEdited = false;
  aiGenSystemPromptEdited = false;
  requestPromptSuggestion();
});

// Exact WYSIWYG preview of what /batch will actually send for the first
// call: the (possibly hand-edited) base user prompt plus the real
// per-batch instruction suffix the server computed for it.
function updateAiGenFullPreview() {
  const base = document.getElementById("aiGenUserPrompt").value;
  const instruction = aiGenState.firstBatchInstruction || "";
  document.getElementById("aiGenFirstBatchPreview").textContent = instruction ? `${base}\n\n${instruction}` : base;
}
document.getElementById("aiGenUserPrompt").addEventListener("input", updateAiGenFullPreview);

document.getElementById("configBackBtn").addEventListener("click", () => aiGenGoToSubstep(2));

document.getElementById("aiGenStartBtn").addEventListener("click", () => {
  const errBox = document.getElementById("aiGenConfigError");
  errBox.classList.add("hidden");
  const apiKey = document.getElementById("aiGenApiKey").value.trim();
  if (!apiKey) {
    errBox.textContent = t("s1_ai_config_missing_key");
    errBox.classList.remove("hidden");
    return;
  }
  const remember = document.getElementById("aiGenRememberKey").checked;
  try {
    const storageKey = AI_PROVIDERS[aiGenState.provider].keyStorageKey;
    if (remember) localStorage.setItem(storageKey, apiKey);
    else localStorage.removeItem(storageKey);
  } catch {
    // localStorage unavailable -- key just won't persist, not fatal.
  }

  aiGenState.apiKey = apiKey;
  aiGenState.model = document.getElementById("aiGenModel").value.trim() || AI_PROVIDERS[aiGenState.provider].defaultModel;
  aiGenState.temperature = Number(aiGenTemperatureInput.value);
  aiGenState.systemPrompt = document.getElementById("aiGenSystemPromptPreview").value.trim();
  aiGenState.userPrompt = document.getElementById("aiGenUserPrompt").value.trim();
  const likertScale = Number(document.querySelector('input[name="aiGenLikert"]:checked').value);
  aiGenState.likertMin = 1;
  aiGenState.likertMax = likertScale;
  aiGenState.columns = aiGenState.codebook.map((c) => c.column);
  aiGenState.qualColumns = aiGenState.codebook.filter((c) => c.type === "qualitative").map((c) => c.column);
  aiGenState.nRows = clampAiGenNRows();
  aiGenState.batchSize = Math.min(clampAiGenBatchSize(), aiGenState.nRows);
  aiGenState.totalBatches = Math.ceil(aiGenState.nRows / aiGenState.batchSize);
  aiGenState.rows = [];
  aiGenState.batchLog = [];
  aiGenState.currentBatch = 0;

  document.getElementById("aiGenError").classList.add("hidden");
  document.getElementById("aiGenErrorActions").classList.add("hidden");
  document.getElementById("aiGenProgressWrap").classList.remove("hidden");
  aiGenGoToSubstep(4);
  runAiGeneration();
});

// ---- Sub-step 4: Batched generation loop ----
async function runAiGeneration() {
  const bar = document.getElementById("aiGenProgressBar");
  const text = document.getElementById("aiGenProgressText");
  bar.max = aiGenState.totalBatches;

  // Row ranges are computed from how many rows have ACTUALLY accumulated so
  // far, not a fixed per-batch schedule -- a batch that comes back a few
  // rows short (the AI slightly under-counting, not necessarily an error;
  // see _parse_batch_csv) is accepted rather than discarded, and the next
  // call simply asks for however many rows are still needed to reach
  // nRows. totalBatches is only an ESTIMATE for the progress bar; a
  // generous extra allowance on top of it keeps this resilient to a few
  // short batches without letting a persistently misbehaving provider loop
  // forever.
  const maxIterations = aiGenState.totalBatches + 5;

  while (aiGenState.rows.length < aiGenState.nRows && aiGenState.currentBatch < maxIterations) {
    const startRow = aiGenState.rows.length + 1;
    const endRow = Math.min(aiGenState.nRows, startRow + aiGenState.batchSize - 1);
    bar.value = Math.min(aiGenState.currentBatch, aiGenState.totalBatches);
    text.textContent = t("s1_ai_gen_progress", { done: aiGenState.currentBatch, total: aiGenState.totalBatches });

    try {
      const res = await fetch("/api/ai_data_gen/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiGenState.provider,
          api_key: aiGenState.apiKey,
          model: aiGenState.model,
          temperature: aiGenState.temperature,
          system_prompt: aiGenState.systemPrompt,
          user_prompt: aiGenState.userPrompt,
          columns: aiGenState.columns,
          qualitative_columns: aiGenState.qualColumns || [],
          likert_min: aiGenState.likertMin,
          likert_max: aiGenState.likertMax,
          start_row: startRow,
          end_row: endRow,
          demo_age_min: document.getElementById("demoAgeMin").value || null,
          demo_age_max: document.getElementById("demoAgeMax").value || null,
          demo_attributes: aiGenState.demoAttributes,
          lang: getLang(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "batch failed");
      aiGenState.rows.push(...data.rows);
      aiGenState.batchLog.push({
        start_row: startRow,
        // Reflects the rows actually received, not the range asked for --
        // a partial batch (see above) means these can differ.
        end_row: startRow + data.rows.length - 1,
        system_prompt: data.used_system_prompt || aiGenState.systemPrompt,
        user_prompt: data.used_user_prompt || aiGenState.userPrompt,
      });
      aiGenState.currentBatch += 1;
    } catch (err) {
      showAiGenBatchError(err.message);
      return;
    }
  }

  if (aiGenState.rows.length < aiGenState.nRows) {
    showAiGenBatchError(t("s1_ai_gen_error_incomplete", { got: aiGenState.rows.length, total: aiGenState.nRows }));
    return;
  }

  bar.value = aiGenState.totalBatches;
  text.textContent = t("s1_ai_gen_finalizing");
  await finalizeAiGeneration();
}

function showAiGenBatchError(message) {
  document.getElementById("aiGenError").textContent = t("s1_ai_gen_error_batch", { detail: message });
  document.getElementById("aiGenError").classList.remove("hidden");
  document.getElementById("aiGenErrorActions").classList.remove("hidden");
}
document.getElementById("aiGenRetryBtn").addEventListener("click", () => {
  document.getElementById("aiGenError").classList.add("hidden");
  document.getElementById("aiGenErrorActions").classList.add("hidden");
  runAiGeneration();
});
document.getElementById("aiGenCancelBtn").addEventListener("click", () => {
  document.getElementById("aiGenError").classList.add("hidden");
  document.getElementById("aiGenErrorActions").classList.add("hidden");
  document.getElementById("aiGenProgressWrap").classList.add("hidden");
  aiGenGoToSubstep(3);
});

async function finalizeAiGeneration() {
  try {
    const res = await fetch("/api/ai_data_gen/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "ai_generated_survey.csv",
        columns: aiGenState.columns,
        rows: aiGenState.rows,
        codebook: aiGenState.codebook,
        demographics: aiGenState.demographics,
        demo_attributes: aiGenState.demoAttributes,
        provider: aiGenState.provider,
        model: aiGenState.model,
        temperature: aiGenState.temperature,
        likert_scale: aiGenState.likertMax,
        batches: aiGenState.batchLog,
        construct_theories: aiGenState.constructTheories,
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "finalize failed");
    applyUploadResult(data);
    // One-shot seed for Step 2's model canvas (consumed by initEditor() the
    // first time it opens for this dataset) -- must be set AFTER
    // applyUploadResult(), which clears it unconditionally at its top.
    state.pendingConstructSeed = buildConstructGroupsFromCodebook(aiGenState.codebook).map((g) => ({
      ...g, theory: aiGenState.constructTheories[g.name] || null,
    }));
    const dlLink = document.getElementById("aiGenDownloadLink");
    dlLink.href = `/api/ai_data_gen/download?file_id=${encodeURIComponent(data.file_id)}`;
    dlLink.classList.remove("hidden");
    const exportBtn = document.getElementById("aiGenExportBtn");
    exportBtn.href = `/api/ai_data_gen/export?file_id=${encodeURIComponent(data.file_id)}`;
    exportBtn.classList.remove("hidden");
    renderAiGenDemoSummary(data.demographics_summary, data.demo_attributes);
    renderAiGenStatsTables(data.descriptive_stats);
    renderAiGenTransparency(aiGenState.batchLog);
    document.getElementById("aiGenResultExtra").classList.remove("hidden");
    document.getElementById("aiGenProgressWrap").classList.add("hidden");
    document.getElementById("dataPreviewWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showAiGenBatchError(err.message);
  }
}

function renderAiGenDemoSummary(demographics, demoAttributes) {
  const el = document.getElementById("aiGenDemoSummary");
  const d = demographics || {};
  const ageRange = d.age_min || d.age_max ? `${d.age_min || "?"}-${d.age_max || "?"}` : "—";
  const rows = [
    [t("s1_ai_result_demo_occupation"), d.occupation || "—"],
    [t("s1_ai_result_demo_location"), d.location || "—"],
    [t("s1_ai_result_demo_target_population"), d.target_population || "—"],
    [t("s1_ai_result_demo_age_range"), ageRange],
    [t("s1_ai_result_demo_gender_mix"), d.gender_mix ? t(`s1_ai_demo_gender_${d.gender_mix}`) : "—"],
  ];
  for (const attr of demoAttributes || []) {
    const desc = attr.type === "numeric" ? `${attr.min}-${attr.max}` : (attr.options || []).join(", ");
    rows.push([attr.name, desc]);
  }
  el.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join("")}</dl>`;
}

function renderAiGenStatsTables(stats) {
  const el = document.getElementById("aiGenStatsTables");
  if (!stats) {
    el.innerHTML = "";
    return;
  }
  const indicatorRows = Object.entries(stats.indicators || {})
    .map(([col, s]) => `<tr><td>${escapeHtml(col)}</td><td>${s.mean}</td><td>${s.std}</td><td>${s.min}</td><td>${s.max}</td></tr>`)
    .join("");
  const age = (stats.demographics || {}).age || {};
  const gender = (stats.demographics || {}).gender || {};
  el.innerHTML = `
    <div class="ai-gen-stats-table-title">${t("s1_ai_result_stats_indicators_title")}</div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t("s1_ai_result_stats_col")}</th><th>${t("s1_ai_result_stats_mean")}</th><th>${t("s1_ai_result_stats_std")}</th><th>${t("s1_ai_result_stats_min")}</th><th>${t("s1_ai_result_stats_max")}</th></tr></thead>
      <tbody>${indicatorRows}</tbody>
    </table></div>
    <div class="ai-gen-stats-table-title">${t("s1_ai_result_stats_demo_title")}</div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t("s1_ai_result_stats_col")}</th><th>${t("s1_ai_result_stats_mean")}</th><th>${t("s1_ai_result_stats_std")}</th><th>${t("s1_ai_result_stats_min")}</th><th>${t("s1_ai_result_stats_max")}</th></tr></thead>
      <tbody><tr><td>${t("s1_ai_result_stats_age_row")}</td><td>${age.mean ?? ""}</td><td>${age.std ?? ""}</td><td>${age.min ?? ""}</td><td>${age.max ?? ""}</td></tr></tbody>
    </table></div>
    <div class="table-scroll"><table>
      <thead><tr><th>${t("s1_ai_result_stats_gender_col")}</th><th>${t("s1_ai_result_stats_count")}</th><th>${t("s1_ai_result_stats_pct")}</th></tr></thead>
      <tbody>
        <tr><td>${t("s1_ai_result_stats_gender_male")}</td><td>${(gender.male || {}).count ?? 0}</td><td>${(gender.male || {}).pct ?? 0}</td></tr>
        <tr><td>${t("s1_ai_result_stats_gender_female")}</td><td>${(gender.female || {}).count ?? 0}</td><td>${(gender.female || {}).pct ?? 0}</td></tr>
      </tbody>
    </table></div>
    ${((stats.demographics || {}).custom || []).map((attr) => renderAiGenCustomAttrStatsTable(attr)).join("")}
  `;
}

function renderAiGenCustomAttrStatsTable(attr) {
  const title = `<div class="ai-gen-stats-table-title">${escapeHtml(attr.name)}</div>`;
  if (attr.type === "numeric") {
    const s = attr.stats || {};
    return `
      ${title}
      <div class="table-scroll"><table>
        <thead><tr><th>${t("s1_ai_result_stats_col")}</th><th>${t("s1_ai_result_stats_mean")}</th><th>${t("s1_ai_result_stats_std")}</th><th>${t("s1_ai_result_stats_min")}</th><th>${t("s1_ai_result_stats_max")}</th></tr></thead>
        <tbody><tr><td>${escapeHtml(attr.name)}</td><td>${s.mean ?? ""}</td><td>${s.std ?? ""}</td><td>${s.min ?? ""}</td><td>${s.max ?? ""}</td></tr></tbody>
      </table></div>
    `;
  }
  const rows = Object.entries(attr.counts || {})
    .map(([opt, s]) => `<tr><td>${escapeHtml(opt)}</td><td>${s.count ?? 0}</td><td>${s.pct ?? 0}</td></tr>`)
    .join("");
  return `
    ${title}
    <div class="table-scroll"><table>
      <thead><tr><th>${t("s1_ai_result_stats_option_col")}</th><th>${t("s1_ai_result_stats_count")}</th><th>${t("s1_ai_result_stats_pct")}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

function renderAiGenTransparency(batchLog) {
  const el = document.getElementById("aiGenTransparency");
  el.innerHTML = (batchLog || [])
    .map((b, i) => `
      <details>
        <summary>${escapeHtml(t("s1_ai_result_transparency_batch", { n: i + 1, start: b.start_row, end: b.end_row }))}</summary>
        <p class="hint">${escapeHtml(t("s1_ai_result_transparency_system"))}</p>
        <pre><code>${escapeHtml(b.system_prompt)}</code></pre>
        <p class="hint">${escapeHtml(t("s1_ai_result_transparency_user"))}</p>
        <pre><code>${escapeHtml(b.user_prompt)}</code></pre>
      </details>
    `)
    .join("");
}

// ---------------- Step 1: AI Lab Experiment (worker pool + condition survey) ----------------
// A third path into Step 1: define a reusable pool of N "AI Worker" personas
// (persona + demographics, no survey answers), persisted server-side by
// pool_id. Then randomly select M<=N of them, split into one or more
// condition groups (a between-subjects design -- each group gets its own
// condition prompt), and have each selected worker answer a codebook survey
// in character, under their group's condition. finalizeExperiment() hands
// off into the exact same applyUploadResult()/Step 2 pipeline the AI Gen and
// upload paths use, via routes/ai_worker_api.py's finalize_experiment.
const expState = {
  populationPrompt: "",
  demographics: {},
  demoAttributes: [],
  provider: "openai",
  apiKey: "",
  model: "",
  temperature: 1,
  systemPrompt: "",
  userPrompt: "",
  nWorkers: 100,
  batchSize: 25,
  totalBatches: 0,
  currentBatch: 0,
  workerRows: [],
  demoSeed: null, // fixes the target-matching demographic assignment for this whole generation run (see _assign_demographics)

  poolId: null,
  nPoolWorkers: 0,

  selectedGroups: [], // [{group_index, manipulation_text, worker_ids, systemPrompt, userPrompt, batchSize}] after /select + /suggest_survey_prompt
  excludedWorkerIds: [],
  sharedContext: "", // one context shared by every group, entered once (see #expSharedContext)

  codebook: [],
  qualColumns: [],
  likertMin: 1,
  likertMax: 5,
  batchLog: [],
  rows: [], // accumulated {worker_id, ...columns}
  groupCursor: 0,
};
let expPromptEdited = false;
let expMaxSubstepReached = 1;

// Appends one batch's ACTUAL prompt to a live-updating transparency panel
// as soon as that batch's response arrives -- so the user can see exactly
// what was sent to the AI while generation is still running. Collapsed by
// default (both this entry and the whole section it lives in, see
// .source-transparency-outer) -- nothing forces itself open, so a long run
// with many batches never turns into a wall of text the reader didn't ask
// to see; each entry expands only when a reader deliberately clicks it.
function appendLiveTransparencyEntry(containerId, label, promptText) {
  const el = document.getElementById(containerId);
  const details = document.createElement("details");
  details.innerHTML = `
    <summary>${escapeHtml(label)}</summary>
    <pre><code>${escapeHtml(promptText || "")}</code></pre>
  `;
  el.appendChild(details);
}

// The actual chat-completion call still needs a system+user message pair,
// but the user only ever sees/edits ONE combined prompt -- everything goes
// into "system", and "user" carries just the per-batch trigger instruction
// the server appends. This reassembles the two back into one block for
// display, matching exactly what was conceptually sent.
function combinePromptParts(systemPrompt, userPrompt) {
  const sys = (systemPrompt || "").trim();
  const usr = (userPrompt || "").trim();
  return usr ? `${sys}\n\n${usr}` : sys;
}

function expGoToSubstep(n) {
  expMaxSubstepReached = Math.max(expMaxSubstepReached, n);
  document.querySelectorAll("#aiExperimentSourcePane .ai-gen-substep").forEach((el) => el.classList.remove("active"));
  document.getElementById("expStep" + n).classList.add("active");
  document.querySelectorAll("#expSteps .ai-gen-step-dot").forEach((dot) => {
    const num = Number(dot.dataset.substep);
    dot.classList.toggle("active", num === n);
    dot.classList.toggle("done", num < n);
    dot.classList.toggle("reached", num <= expMaxSubstepReached);
  });
}
document.getElementById("expSteps").addEventListener("click", (e) => {
  const dot = e.target.closest(".ai-gen-step-dot");
  if (!dot) return;
  const target = Number(dot.dataset.substep);
  if (target > expMaxSubstepReached) return;
  expGoToSubstep(target);
});

function collectExpDemographics() {
  return {
    age_min: document.getElementById("expDemoAgeMin").value || null,
    age_max: document.getElementById("expDemoAgeMax").value || null,
    gender_mix: document.getElementById("expDemoGenderMix").value,
    occupation: document.getElementById("expDemoOccupation").value.trim(),
    location: document.getElementById("expDemoLocation").value.trim(),
    target_population: document.getElementById("expDemoTargetPopulation").value.trim(),
  };
}

// ---- Sub-step 1: population, demographics, provider config, pool generation ----
function renderExpProviderFields() {
  document.getElementById("expProviderTabs").innerHTML = AI_PROVIDER_ORDER.map(
    (id) => `<button type="button" class="ai-provider-tab${id === expState.provider ? " active" : ""}" data-provider="${id}">${aiReportEscapeHtml(AI_PROVIDERS[id].label)}</button>`,
  ).join("");
  applyExpProvider(expState.provider);
}
renderExpProviderFields();

function applyExpProvider(providerId) {
  expState.provider = providerId;
  document.querySelectorAll("#expProviderTabs .ai-provider-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === providerId));
  const cfg = AI_PROVIDERS[providerId];
  const stored = aiReportGetStoredKey(providerId);
  const keyInput = document.getElementById("expApiKey");
  keyInput.value = stored;
  keyInput.placeholder = cfg.keyPlaceholder;
  document.getElementById("expRememberKey").checked = !!stored;
  document.getElementById("expModel").value = cfg.defaultModel;
  document.getElementById("expModelSuggestions").innerHTML = cfg.modelSuggestions.map((m) => `<option value="${aiReportEscapeAttr(m)}">`).join("");
  document.getElementById("expApiKeyHint").textContent = t("ai_modal_api_key_hint", { provider: cfg.label });
}
document.getElementById("expProviderTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".ai-provider-tab");
  if (btn) applyExpProvider(btn.dataset.provider);
});
document.getElementById("expKeyToggle").addEventListener("click", () => {
  const input = document.getElementById("expApiKey");
  input.type = input.type === "password" ? "text" : "password";
});
const expTemperatureInput = document.getElementById("expTemperature");
expTemperatureInput.addEventListener("input", () => {
  document.getElementById("expTemperatureValue").textContent = Number(expTemperatureInput.value).toFixed(1);
});

function clampExpNWorkers() {
  const input = document.getElementById("expNWorkers");
  let n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) n = 100;
  n = Math.max(30, Math.min(500, n));
  input.value = n;
  return n;
}
function updateExpNWorkersHint() {
  document.getElementById("expNWorkersHint").textContent = t("exp_n_workers_hint");
}
updateExpNWorkersHint();

function clampExpBatchSize() {
  const input = document.getElementById("expBatchSize");
  let n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) n = 25;
  n = Math.max(1, Math.min(50, n));
  input.value = n;
  return n;
}

async function requestExpPromptSuggestion() {
  const nWorkers = clampExpNWorkers();
  const { attrs } = collectDemoAttrs("expDemoAttrsTableBody");
  try {
    const res = await fetch("/api/ai_worker/suggest_prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        population_prompt: document.getElementById("expPopulationPrompt").value.trim(),
        demographics: collectExpDemographics(),
        demo_attributes: attrs || [],
        n_workers: nWorkers,
        batch_size: clampExpBatchSize(),
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) return;
    expState.batchSize = data.batch_size;
    expState.totalBatches = data.total_batches;
    expState.demoSeed = data.seed;
    if (!expPromptEdited) {
      document.getElementById("expCombinedPrompt").value = combinePromptParts(data.system_prompt, data.user_prompt);
    }
    expState.firstBatchInstruction = data.first_batch_instruction || "";
    updateExpFirstBatchPreview();
  } catch {
    // Best-effort preview only -- the actual "Generate" click re-fetches this.
  }
}
// Exact WYSIWYG preview of what /ai_worker/batch will actually send for the
// first call: the (possibly hand-edited) combined prompt plus the real
// per-batch instruction suffix the server computed for it -- so the user can
// review (and still edit) everything before clicking "Sinh Worker Pool",
// mirroring the existing AI Gen wizard's own first-batch preview.
function updateExpFirstBatchPreview() {
  const base = document.getElementById("expCombinedPrompt").value;
  const instruction = expState.firstBatchInstruction || "";
  document.getElementById("expFirstBatchPreview").textContent = instruction ? `${base}\n\n${instruction}` : base;
}
document.getElementById("expCombinedPrompt").addEventListener("input", () => {
  expPromptEdited = true;
  updateExpFirstBatchPreview();
});
document.getElementById("expRegenBtn").addEventListener("click", () => {
  expPromptEdited = false;
  requestExpPromptSuggestion();
});
document.getElementById("expNWorkers").addEventListener("change", () => {
  clampExpNWorkers();
  requestExpPromptSuggestion();
});
document.getElementById("expDemoAttrsAddRowBtn").addEventListener("click", () => demoAttrAddRow(undefined, undefined, undefined, "expDemoAttrsTableBody"));
document.getElementById("expBatchSize").addEventListener("change", () => {
  clampExpBatchSize();
  requestExpPromptSuggestion();
});
["expDemoAgeMin", "expDemoAgeMax", "expDemoGenderMix"].forEach((id) => {
  document.getElementById(id).addEventListener("change", requestExpPromptSuggestion);
});
["expDemoOccupation", "expDemoLocation", "expDemoTargetPopulation", "expPopulationPrompt"].forEach((id) => {
  document.getElementById(id).addEventListener("blur", requestExpPromptSuggestion);
});
requestExpPromptSuggestion();

document.getElementById("expPoolImportBtn").addEventListener("click", () => {
  document.getElementById("expPoolImportInput").click();
});
document.getElementById("expPoolImportInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errBox = document.getElementById("expPoolImportError");
  errBox.classList.add("hidden");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("lang", getLang());
  try {
    const res = await fetch("/api/ai_worker/import_pool", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "import failed");
    applyExpPoolResult(data);
    expGoToSubstep(2);
  } catch (err) {
    errBox.textContent = t("exp_pool_import_failed", { msg: err.message });
    errBox.classList.remove("hidden");
  } finally {
    e.target.value = "";
  }
});

function renderExpPoolPreviewTable(rows) {
  const table = document.getElementById("expPoolPreviewTable");
  if (!rows || !rows.length) {
    table.innerHTML = "";
    return;
  }
  const cols = Object.keys(rows[0]);
  let html = "<thead><tr>" + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>" + cols.map((c) => `<td>${row[c] ?? ""}</td>`).join("") + "</tr>";
  }
  html += "</tbody>";
  table.innerHTML = html;
}

function applyExpPoolResult(data) {
  expState.poolId = data.pool_id;
  expState.nPoolWorkers = data.n_workers;
  document.getElementById("expPoolSummary").textContent = t("exp_pool_ready_summary", { n: data.n_workers });
  renderExpPoolPreviewTable(data.preview);
  document.getElementById("expPoolExportBtn").href = `/api/ai_worker/pool_export?pool_id=${encodeURIComponent(data.pool_id)}`;
  const mInput = document.getElementById("expM");
  mInput.max = data.n_workers;
  mInput.value = Math.min(30, data.n_workers);
}

document.getElementById("expGenerateBtn").addEventListener("click", async () => {
  const errBox = document.getElementById("expConfigError");
  errBox.classList.add("hidden");
  const apiKey = document.getElementById("expApiKey").value.trim();
  if (!apiKey) {
    errBox.textContent = t("s1_ai_config_missing_key");
    errBox.classList.remove("hidden");
    return;
  }
  const { attrs, error } = collectDemoAttrs("expDemoAttrsTableBody");
  if (error) {
    errBox.textContent = error;
    errBox.classList.remove("hidden");
    return;
  }
  const remember = document.getElementById("expRememberKey").checked;
  try {
    const storageKey = AI_PROVIDERS[expState.provider].keyStorageKey;
    if (remember) localStorage.setItem(storageKey, apiKey);
    else localStorage.removeItem(storageKey);
  } catch {
    // localStorage unavailable -- key just won't persist, not fatal.
  }

  await requestExpPromptSuggestion();

  expState.apiKey = apiKey;
  expState.model = document.getElementById("expModel").value.trim() || AI_PROVIDERS[expState.provider].defaultModel;
  expState.temperature = Number(expTemperatureInput.value);
  // Everything lives in ONE combined, user-editable prompt now -- sent
  // entirely as the "system" message, with "user" left empty so only the
  // real per-batch trigger instruction (appended server-side) occupies it.
  expState.systemPrompt = document.getElementById("expCombinedPrompt").value.trim();
  expState.userPrompt = "";
  expState.populationPrompt = document.getElementById("expPopulationPrompt").value.trim();
  expState.demographics = collectExpDemographics();
  expState.demoAttributes = attrs || [];
  expState.nWorkers = clampExpNWorkers();
  expState.batchSize = Math.min(expState.batchSize || 25, expState.nWorkers);
  expState.totalBatches = Math.ceil(expState.nWorkers / expState.batchSize);
  expState.workerRows = [];
  expState.currentBatch = 0;

  document.getElementById("expPoolError").classList.add("hidden");
  document.getElementById("expPoolErrorActions").classList.add("hidden");
  document.getElementById("expPoolProgressWrap").classList.remove("hidden");
  document.getElementById("expPoolLiveTransparency").innerHTML = "";
  document.getElementById("expPoolLiveTransparencyWrap").classList.remove("hidden");
  runWorkerPoolGeneration();
});

async function runWorkerPoolGeneration() {
  const bar = document.getElementById("expPoolProgressBar");
  const text = document.getElementById("expPoolProgressText");
  bar.max = expState.totalBatches;
  const maxIterations = expState.totalBatches + 5;

  while (expState.workerRows.length < expState.nWorkers && expState.currentBatch < maxIterations) {
    const startRow = expState.workerRows.length + 1;
    const endRow = Math.min(expState.nWorkers, startRow + expState.batchSize - 1);
    bar.value = Math.min(expState.currentBatch, expState.totalBatches);
    text.textContent = t("s1_ai_gen_progress", { done: expState.currentBatch, total: expState.totalBatches });
    try {
      const res = await fetch("/api/ai_worker/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: expState.provider,
          api_key: expState.apiKey,
          model: expState.model,
          temperature: expState.temperature,
          system_prompt: expState.systemPrompt,
          user_prompt: expState.userPrompt,
          start_row: startRow,
          end_row: endRow,
          n_workers: expState.nWorkers,
          seed: expState.demoSeed,
          demographics: expState.demographics,
          demo_attributes: expState.demoAttributes,
          lang: getLang(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "batch failed");
      expState.workerRows.push(...data.rows);
      appendLiveTransparencyEntry(
        "expPoolLiveTransparency",
        t("exp_live_transparency_pool_batch", { n: expState.currentBatch + 1, start: startRow, end: startRow + data.rows.length - 1 }),
        combinePromptParts(data.used_system_prompt || expState.systemPrompt, data.used_user_prompt || expState.userPrompt),
      );
      expState.currentBatch += 1;
    } catch (err) {
      showExpPoolBatchError(err.message);
      return;
    }
  }

  if (expState.workerRows.length < expState.nWorkers) {
    showExpPoolBatchError(t("s1_ai_gen_error_incomplete", { got: expState.workerRows.length, total: expState.nWorkers }));
    return;
  }

  bar.value = expState.totalBatches;
  text.textContent = t("s1_ai_gen_finalizing");
  await finalizeWorkerPool();
}

function showExpPoolBatchError(message) {
  document.getElementById("expPoolError").textContent = t("s1_ai_gen_error_batch", { detail: message });
  document.getElementById("expPoolError").classList.remove("hidden");
  document.getElementById("expPoolErrorActions").classList.remove("hidden");
}
document.getElementById("expPoolRetryBtn").addEventListener("click", () => {
  document.getElementById("expPoolError").classList.add("hidden");
  document.getElementById("expPoolErrorActions").classList.add("hidden");
  runWorkerPoolGeneration();
});
document.getElementById("expPoolCancelBtn").addEventListener("click", () => {
  document.getElementById("expPoolError").classList.add("hidden");
  document.getElementById("expPoolErrorActions").classList.add("hidden");
  document.getElementById("expPoolProgressWrap").classList.add("hidden");
});

async function finalizeWorkerPool() {
  try {
    const res = await fetch("/api/ai_worker/finalize_pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: expState.workerRows,
        demo_attributes: expState.demoAttributes,
        population_prompt: expState.populationPrompt,
        demographics: expState.demographics,
        provider: expState.provider,
        model: expState.model,
        temperature: expState.temperature,
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "finalize failed");
    applyExpPoolResult(data);
    document.getElementById("expPoolProgressWrap").classList.add("hidden");
    expGoToSubstep(2);
  } catch (err) {
    showExpPoolBatchError(err.message);
  }
}

// ---- Sub-step 2: pool ready (preview, export, next) ----
document.getElementById("expPoolBackBtn").addEventListener("click", () => expGoToSubstep(1));
document.getElementById("expPoolNextBtn").addEventListener("click", () => {
  if (!document.querySelector("#expGroupsTableBody tr")) {
    expGroupAddRow("", clampExpM());
  }
  expGoToSubstep(3);
});

// ---- Sub-step 3: design the experiment (M, condition groups, selection, codebook) ----
function clampExpSurveyBatchSize() {
  const input = document.getElementById("expSurveyBatchSize");
  let n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) n = 25;
  n = Math.max(1, Math.min(50, n));
  input.value = n;
  return n;
}

function clampExpM() {
  const input = document.getElementById("expM");
  let n = parseInt(input.value, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  n = Math.min(n, expState.nPoolWorkers || 500);
  input.value = n;
  return n;
}

function collectExpGroupDrafts() {
  return Array.from(document.querySelectorAll("#expGroupsTableBody tr")).map((tr) => ({
    manipulation_text: tr.querySelector(".exp-group-manipulation-input").value.trim(),
    size: parseInt(tr.querySelector(".exp-group-size-input").value, 10) || 0,
  }));
}

function updateExpGroupsSizeTotal() {
  const total = collectExpGroupDrafts().reduce((s, g) => s + g.size, 0);
  document.getElementById("expMHint").textContent = t("exp_m_hint", { total, m: clampExpM() });
}

function expGroupAddRow(manipulationText, size) {
  const tbody = document.getElementById("expGroupsTableBody");
  const tr = document.createElement("tr");

  const condInput = document.createElement("textarea");
  condInput.rows = 2;
  condInput.className = "exp-group-manipulation-input";
  condInput.value = manipulationText || "";
  const tdCond = document.createElement("td");
  tdCond.appendChild(condInput);

  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "1";
  sizeInput.className = "exp-group-size-input";
  sizeInput.value = size || 10;
  sizeInput.addEventListener("input", updateExpGroupsSizeTotal);
  const tdSize = document.createElement("td");
  tdSize.appendChild(sizeInput);

  const tdRemove = document.createElement("td");
  tdRemove.className = "codebook-remove-cell";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "codebook-row-remove";
  removeBtn.textContent = t("s1_ai_codebook_remove");
  removeBtn.addEventListener("click", () => {
    tr.remove();
    updateExpGroupsSizeTotal();
  });
  tdRemove.appendChild(removeBtn);

  tr.append(tdCond, tdSize, tdRemove);
  tbody.appendChild(tr);
  updateExpGroupsSizeTotal();
}
document.getElementById("expGroupsAddRowBtn").addEventListener("click", () => expGroupAddRow());
document.getElementById("expM").addEventListener("change", updateExpGroupsSizeTotal);
document.getElementById("expCodebookAddRowBtn").addEventListener("click", () => codebookAddRow(undefined, undefined, undefined, undefined, "expCodebookTableBody"));

function renderExpSelectionResult() {
  document.getElementById("expSelectedLists").innerHTML = expState.selectedGroups.map((g, i) => `
    <div class="exp-group-result">
      <strong>${escapeHtml(t("exp_group_n", { n: i + 1 }))}</strong> — <em>${escapeHtml(g.manipulation_text || "")}</em>
      <p class="hint">${g.worker_ids.map(escapeHtml).join(", ")}</p>
    </div>
  `).join("");
  document.getElementById("expExcludedList").textContent = expState.excludedWorkerIds.length
    ? expState.excludedWorkerIds.join(", ")
    : t("exp_excluded_none");
  document.getElementById("expSelectionResult").classList.remove("hidden");
}

document.getElementById("expSelectBtn").addEventListener("click", async () => {
  const errBox = document.getElementById("expGroupsValidationError");
  errBox.classList.add("hidden");
  const drafts = collectExpGroupDrafts().filter((g) => g.size > 0);
  if (!drafts.length) {
    errBox.textContent = t("exp_groups_min_rows");
    errBox.classList.remove("hidden");
    return;
  }
  const m = clampExpM();
  const total = drafts.reduce((s, g) => s + g.size, 0);
  if (total !== m) {
    errBox.textContent = t("exp_groups_size_mismatch", { total, m });
    errBox.classList.remove("hidden");
    return;
  }
  try {
    const res = await fetch("/api/ai_worker/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pool_id: expState.poolId, group_sizes: drafts.map((g) => g.size), lang: getLang() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "selection failed");
    expState.selectedGroups = data.groups.map((g, i) => ({
      group_index: g.group_index,
      manipulation_text: drafts[i].manipulation_text,
      worker_ids: g.worker_ids,
    }));
    expState.excludedWorkerIds = data.excluded_worker_ids || [];
    renderExpSelectionResult();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
  }
});

document.getElementById("expDesignBackBtn").addEventListener("click", () => expGoToSubstep(2));

// Fetches each selected group's full combined prompt (worker roster +
// condition + codebook, exactly as _build_survey_messages assembles it) and
// renders one editable textarea PER GROUP -- so the user can review and
// hand-edit the exact content before any AI call is made, same idea as the
// Worker Pool step's first-batch preview, just one prompt per group here
// since each group's roster/condition differs.
async function fetchExpSurveyPromptPreview() {
  const errBox = document.getElementById("expSurveyConfigError");
  errBox.classList.add("hidden");
  if (!expState.selectedGroups.length) {
    errBox.textContent = t("exp_select_first");
    errBox.classList.remove("hidden");
    return;
  }
  const items = collectCodebook("expCodebookTableBody");
  if (!items.length) {
    errBox.textContent = t("s1_ai_codebook_min_rows");
    errBox.classList.remove("hidden");
    return;
  }
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.column)) {
      errBox.textContent = t("s1_ai_codebook_duplicate_column", { name: item.column });
      errBox.classList.remove("hidden");
      return;
    }
    seen.add(item.column);
  }
  expState.codebook = items;
  expState.qualColumns = items.filter((c) => c.type === "qualitative").map((c) => c.column);
  const likertScale = Number(document.querySelector('input[name="expLikert"]:checked').value);
  expState.likertMin = 1;
  expState.likertMax = likertScale;
  expState.sharedContext = document.getElementById("expSharedContext").value.trim();

  try {
    const res = await fetch("/api/ai_worker/suggest_survey_prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pool_id: expState.poolId,
        codebook: expState.codebook,
        likert_scale: likertScale,
        context_text: expState.sharedContext,
        groups: expState.selectedGroups,
        batch_size: clampExpSurveyBatchSize(),
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "suggest failed");
    data.groups.forEach((pg) => {
      const g = expState.selectedGroups.find((sg) => sg.group_index === pg.group_index);
      if (g) {
        g.combinedPrompt = combinePromptParts(pg.system_prompt, pg.user_prompt);
        g.batchSize = pg.batch_size;
        g.firstBatchPreview = pg.first_batch_preview || "";
      }
    });
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
    return;
  }

  renderExpSurveyPromptGroups();
  document.getElementById("expSurveyPromptPreviewWrap").classList.remove("hidden");
  document.getElementById("expSurveyConfirmNav").classList.remove("hidden");
}

function renderExpSurveyPromptGroups() {
  document.getElementById("expSurveyPromptGroups").innerHTML = expState.selectedGroups.map((g, i) => `
    <div class="exp-survey-prompt-group">
      <label>${escapeHtml(t("exp_group_n", { n: i + 1 }))} — ${escapeHtml(g.manipulation_text || "")}</label>
      <textarea class="exp-survey-prompt-textarea ai-gen-prompt-preview" rows="8" data-group-index="${g.group_index}">${escapeHtml(g.combinedPrompt || "")}</textarea>
      <label>${escapeHtml(t("s1_ai_config_first_batch_preview_label"))}</label>
      <div class="ai-gen-prompt-preview">${escapeHtml(g.firstBatchPreview || "")}</div>
    </div>
  `).join("");
}

document.getElementById("expSurveyPreviewBtn").addEventListener("click", fetchExpSurveyPromptPreview);
document.getElementById("expSurveyPreviewRegenBtn").addEventListener("click", fetchExpSurveyPromptPreview);

// A selection re-roll invalidates whatever prompt preview was already
// shown (it named specific worker_ids that no longer match), so hide it
// until the user re-runs the preview against the new selection.
document.getElementById("expSelectBtn").addEventListener("click", () => {
  document.getElementById("expSurveyPromptPreviewWrap").classList.add("hidden");
  document.getElementById("expSurveyConfirmNav").classList.add("hidden");
});

document.getElementById("expSurveyStartBtn").addEventListener("click", () => {
  // Commit whatever the user actually sees/edited in each group's textarea
  // (possibly hand-edited) as the exact prompt that call will use.
  document.querySelectorAll(".exp-survey-prompt-textarea").forEach((ta) => {
    const gi = Number(ta.dataset.groupIndex);
    const g = expState.selectedGroups.find((sg) => sg.group_index === gi);
    if (g) {
      // Same reasoning as the Worker Pool step: everything the user edited
      // goes into "system", "user" stays empty for just the per-batch
      // trigger instruction appended server-side.
      g.systemPrompt = ta.value;
      g.userPrompt = "";
    }
  });

  expState.rows = [];
  expState.batchLog = [];
  expState.groupCursor = 0;
  document.getElementById("expError").classList.add("hidden");
  document.getElementById("expErrorActions").classList.add("hidden");
  document.getElementById("expLiveTransparency").innerHTML = "";
  document.getElementById("expLiveTransparencyWrap").classList.remove("hidden");
  expGoToSubstep(4);
  runExperimentSurveyGeneration();
});

// ---- Sub-step 4: batched survey generation loop, then auto-finalize ----
async function runExperimentSurveyGeneration() {
  const bar = document.getElementById("expProgressBar");
  const text = document.getElementById("expProgressText");
  const totalWorkers = expState.selectedGroups.reduce((s, g) => s + g.worker_ids.length, 0);
  bar.max = totalWorkers;

  for (let gi = expState.groupCursor; gi < expState.selectedGroups.length; gi++) {
    const group = expState.selectedGroups[gi];
    const batchSize = group.batchSize || Math.min(25, group.worker_ids.length);
    const answeredIds = new Set(expState.rows.map((r) => r.worker_id));
    let cursor = group.worker_ids.filter((wid) => answeredIds.has(wid)).length;

    while (cursor < group.worker_ids.length) {
      const idsSlice = group.worker_ids.slice(cursor, cursor + batchSize);
      bar.value = expState.rows.length;
      text.textContent = t("s1_ai_gen_progress", { done: expState.rows.length, total: totalWorkers });
      try {
        const res = await fetch("/api/ai_worker/survey_batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: expState.provider,
            api_key: expState.apiKey,
            model: expState.model,
            temperature: expState.temperature,
            system_prompt: group.systemPrompt,
            user_prompt: group.userPrompt,
            pool_id: expState.poolId,
            columns: expState.codebook.map((c) => c.column),
            qualitative_columns: expState.qualColumns,
            likert_min: expState.likertMin,
            likert_max: expState.likertMax,
            worker_ids: idsSlice,
            lang: getLang(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "batch failed");
        expState.rows.push(...data.rows);
        expState.batchLog.push({
          worker_ids: idsSlice,
          system_prompt: data.used_system_prompt || group.systemPrompt,
          user_prompt: data.used_user_prompt || group.userPrompt,
        });
        appendLiveTransparencyEntry(
          "expLiveTransparency",
          t("exp_live_transparency_survey_batch", { group: gi + 1, n: expState.batchLog.length, ids: idsSlice.join(", ") }),
          combinePromptParts(data.used_system_prompt || group.systemPrompt, data.used_user_prompt || group.userPrompt),
        );
        cursor += idsSlice.length;
      } catch (err) {
        expState.groupCursor = gi;
        showExpSurveyBatchError(err.message);
        return;
      }
    }
    expState.groupCursor = gi + 1;
  }

  bar.value = totalWorkers;
  text.textContent = t("s1_ai_gen_finalizing");
  await finalizeExperiment();
}

function showExpSurveyBatchError(message) {
  document.getElementById("expError").textContent = t("s1_ai_gen_error_batch", { detail: message });
  document.getElementById("expError").classList.remove("hidden");
  document.getElementById("expErrorActions").classList.remove("hidden");
}
document.getElementById("expRetryBtn").addEventListener("click", () => {
  document.getElementById("expError").classList.add("hidden");
  document.getElementById("expErrorActions").classList.add("hidden");
  runExperimentSurveyGeneration();
});
document.getElementById("expCancelBtn").addEventListener("click", () => {
  document.getElementById("expError").classList.add("hidden");
  document.getElementById("expErrorActions").classList.add("hidden");
  expGoToSubstep(3);
});

async function finalizeExperiment() {
  try {
    const res = await fetch("/api/ai_worker/finalize_experiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pool_id: expState.poolId,
        codebook: expState.codebook,
        context_text: expState.sharedContext,
        condition_groups: expState.selectedGroups.map((g) => ({
          group_index: g.group_index, manipulation_text: g.manipulation_text, worker_ids: g.worker_ids,
        })),
        excluded_worker_ids: expState.excludedWorkerIds,
        rows: expState.rows,
        likert_scale: expState.likertMax,
        provider: expState.provider,
        model: expState.model,
        temperature: expState.temperature,
        batches: expState.batchLog,
        lang: getLang(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "finalize failed");
    applyUploadResult(data);
    state.pendingConstructSeed = buildConstructGroupsFromCodebook(expState.codebook).map((g) => ({ ...g, theory: null }));
    const exportBtn = document.getElementById("aiGenExportBtn");
    exportBtn.href = `/api/ai_data_gen/export?file_id=${encodeURIComponent(data.file_id)}`;
    exportBtn.classList.remove("hidden");
    renderAiGenDemoSummary(data.demographics_summary, data.demo_attributes);
    renderAiGenStatsTables(data.descriptive_stats);
    renderAiGenTransparency(expState.batchLog.map((b) => ({
      start_row: b.worker_ids[0], end_row: b.worker_ids[b.worker_ids.length - 1],
      system_prompt: b.system_prompt, user_prompt: b.user_prompt,
    })));
    document.getElementById("aiGenResultExtra").classList.remove("hidden");
    document.getElementById("expProgressWrap").classList.add("hidden");
    document.getElementById("dataPreviewWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showExpSurveyBatchError(err.message);
  }
}

// ---- Export/import the entire wizard configuration as one CSV file ----
// (codebook + respondent profile + custom demographic attributes +
// generation settings) so a later session can restore everything with a
// single import instead of re-entering each step. The API key is never
// included -- same privacy rule as everywhere else in this module.
function csvEscapeField(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(rows) {
  return rows.map((row) => row.map(csvEscapeField).join(",")).join("\r\n");
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") continue;
    else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const AI_GEN_CONFIG_CSV_HEADER = ["section", "key", "value", "column", "question_text", "construct", "name", "type", "min", "max", "options"];

document.getElementById("aiGenExportAllBtn").addEventListener("click", () => {
  const codebook = collectCodebook();
  const demographics = collectDemographics();
  const { attrs } = collectDemoAttrs();
  const rows = [AI_GEN_CONFIG_CSV_HEADER];

  const metaEntries = [
    ["provider", aiGenState.provider],
    ["model", document.getElementById("aiGenModel").value.trim()],
    ["temperature", String(Number(aiGenTemperatureInput.value))],
    ["likert_scale", document.querySelector('input[name="aiGenLikert"]:checked').value],
    ["n_rows", String(clampAiGenNRows())],
    ["batch_size", String(clampAiGenBatchSize())],
    ["user_prompt", document.getElementById("aiGenUserPrompt").value],
    ["age_min", demographics.age_min || ""],
    ["age_max", demographics.age_max || ""],
    ["gender_mix", demographics.gender_mix || ""],
    ["occupation", demographics.occupation || ""],
    ["location", demographics.location || ""],
    ["target_population", demographics.target_population || ""],
  ];
  for (const [key, value] of metaEntries) rows.push(["meta", key, value, "", "", "", "", "", "", "", ""]);
  for (const item of codebook) rows.push(["codebook", "", "", item.column, item.question_text, item.construct || "", "", item.type || "likert", "", "", ""]);
  for (const attr of attrs || []) {
    rows.push([
      "demo_attribute", "", "", "", "", "",
      attr.name, attr.type,
      attr.type === "numeric" ? attr.min : "",
      attr.type === "numeric" ? attr.max : "",
      attr.type === "categorical" ? attr.options.join("|") : "",
    ]);
  }

  const blob = new Blob([buildCsv(rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ai_gen_full_config.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("aiGenImportAllBtn").addEventListener("click", () => {
  document.getElementById("aiGenImportAllInput").click();
});
document.getElementById("aiGenImportAllInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errBox = document.getElementById("aiGenImportAllError");
  const reader = new FileReader();
  reader.onload = () => {
    errBox.classList.add("hidden");
    try {
      const parsed = parseCsv(String(reader.result));
      if (!parsed.length) throw new Error(t("s1_ai_codebook_min_rows"));
      const header = parsed[0];
      const body = parsed.slice(1);
      // Soft lookup -- a column absent from the header (e.g. an older
      // export made before a field like "construct" existed) yields "" for
      // every row instead of failing the whole import.
      const col = (name) => header.indexOf(name);
      const at = (r, idx) => (idx === -1 ? "" : r[idx] || "");
      const secIdx = header.indexOf("section");
      if (secIdx === -1) throw new Error(t("s1_ai_all_config_import_bad_file"));
      const keyIdx = col("key"), valIdx = col("value");
      const colIdx = col("column"), qIdx = col("question_text"), constructIdx = col("construct");
      const nameIdx = col("name"), typeIdx = col("type"), minIdx = col("min"), maxIdx = col("max"), optIdx = col("options");

      const meta = {};
      const codebookItems = [];
      const demoAttrItems = [];
      for (const r of body) {
        const section = r[secIdx];
        if (section === "meta") meta[at(r, keyIdx)] = at(r, valIdx);
        else if (section === "codebook") {
          codebookItems.push({ column: at(r, colIdx), question_text: at(r, qIdx), construct: at(r, constructIdx), type: at(r, typeIdx) });
        }
        else if (section === "demo_attribute") {
          demoAttrItems.push({
            name: r[nameIdx],
            type: r[typeIdx],
            min: r[minIdx],
            max: r[maxIdx],
            options: r[optIdx] ? r[optIdx].split("|") : [],
          });
        }
      }
      const cleanCodebookItems = codebookItems.filter((it) => it.column);
      if (!cleanCodebookItems.length) throw new Error(t("s1_ai_codebook_min_rows"));

      // Step 1: codebook
      document.getElementById("codebookTableBody").innerHTML = "";
      cleanCodebookItems.forEach((it) => codebookAddRow(it.column, it.question_text, it.construct, it.type));

      // Step 2: respondent profile + custom demographic attributes
      document.getElementById("demoAgeMin").value = meta.age_min || "";
      document.getElementById("demoAgeMax").value = meta.age_max || "";
      document.getElementById("demoGenderMix").value = meta.gender_mix || "any";
      document.getElementById("demoOccupation").value = meta.occupation || "";
      document.getElementById("demoLocation").value = meta.location || "";
      document.getElementById("demoTargetPopulation").value = meta.target_population || "";
      document.getElementById("demoAttrsTableBody").innerHTML = "";
      demoAttrItems.forEach((attr) => {
        const valueText = attr.type === "categorical" ? attr.options.join(", ") : `${attr.min},${attr.max}`;
        demoAttrAddRow(attr.name, attr.type, valueText);
      });

      // Step 3: generation settings
      if (meta.provider && AI_PROVIDERS[meta.provider]) aiGenState.provider = meta.provider;
      renderAiGenProviderFields();
      if (meta.model) document.getElementById("aiGenModel").value = meta.model;
      if (meta.temperature) {
        aiGenTemperatureInput.value = meta.temperature;
        document.getElementById("aiGenTemperatureValue").textContent = Number(meta.temperature).toFixed(1);
      }
      if (meta.likert_scale) {
        const radio = document.querySelector(`input[name="aiGenLikert"][value="${meta.likert_scale}"]`);
        if (radio) radio.checked = true;
      }
      if (meta.n_rows) document.getElementById("aiGenNRows").value = meta.n_rows;
      if (meta.batch_size) document.getElementById("aiGenBatchSize").value = meta.batch_size;
      clampAiGenNRows();
      clampAiGenBatchSize();
      aiGenUserPromptEdited = false;
      if (meta.user_prompt) {
        document.getElementById("aiGenUserPrompt").value = meta.user_prompt;
        aiGenUserPromptEdited = true;
      }

      // Commit the collected step 1/2 state (mirrors what clicking "Next"
      // on each step would do), so the wizard stays consistent if the user
      // navigates back to an earlier step before generating.
      aiGenState.codebook = collectCodebook();
      aiGenState.demographics = collectDemographics();
      aiGenState.demoAttributes = demoAttrItems.map((attr) => (
        attr.type === "categorical"
          ? { name: attr.name, type: "categorical", options: attr.options }
          : { name: attr.name, type: "numeric", min: Number(attr.min), max: Number(attr.max) }
      ));

      aiGenGoToSubstep(3);
      requestPromptSuggestion();
    } catch (err) {
      errBox.textContent = t("s1_ai_all_config_import_failed", { msg: err.message });
      errBox.classList.remove("hidden");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

// ---------------- Step 2: Model builder ----------------
function initEditor() {
  const canvas = document.getElementById("modelCanvas");
  editor = new PathDiagram(canvas, {
    editable: true,
    onSelect: onConstructSelected,
    onChange: onEditorChange,
    getIndicatorDescription: (col) => buildIndicatorDescriptions()[col] || null,
  });
  // One-shot seed from the AI-gen codebook's Construct column, if any (see
  // finalizeAiGeneration()/applyUploadResult()) -- only ever applied the
  // FIRST time Step 2 opens for a dataset, since initEditor() itself is only
  // ever called once (guarded by `if (!editor) initEditor();`). Consuming it
  // here means later codebook edits never resync/overwrite manual canvas
  // edits made after this point.
  const seed = state.pendingConstructSeed;
  state.pendingConstructSeed = null;
  if (seed && seed.length) {
    const constructs = seed.map((group) => ({
      id: "c" + Math.random().toString(36).slice(2, 9),
      name: group.name,
      mode: "A",
      indicators: group.indicators.filter((col) => state.numericColumns.includes(col)),
      theory: group.theory || null,
    }));
    editor.loadFrom(circleLayout(constructs), []);
  }
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
  // renderModelSummary() unconditionally clears #modelError at its own end
  // (a fresh render implicitly means "no error to show" in every other
  // case) -- so any message for THIS event must be shown after it runs,
  // not before, or it gets wiped in the same call.
  renderModelSummary();
  if (evt && evt.pathRejected) {
    showModelMessage(t("s2_path_rejected"));
  }
  if (evt && evt.moderatorAttachRejected) {
    showModelMessage(t("s2_moderator_attach_rejected"));
  }
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
          <label>${t("s2_interaction_source_c")}</label>
          <select id="modalSourceC"></select>
          <div id="modalInteractionError" class="error-box hidden"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="modalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="modalOk">${t("modal_add")}</button>
        </div>
      </div>
    </div>`;

  const fillSourceSelect = (sel, preferIndex, allowNone) => {
    const options = eligibleInteractionSources();
    const optHtml = options.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`).join("");
    sel.innerHTML = allowNone ? `<option value="">${t("s2_interaction_source_c_none")}</option>${optHtml}` : optHtml;
    if (!allowNone && options[preferIndex]) sel.value = options[preferIndex].id;
  };

  document.getElementById("modalCMode").addEventListener("change", (e) => {
    const isInteraction = e.target.value === "I";
    document.getElementById("modalInteractionSources").classList.toggle("hidden", !isInteraction);
    if (isInteraction) {
      fillSourceSelect(document.getElementById("modalSourceA"), 0, false);
      fillSourceSelect(document.getElementById("modalSourceB"), 1, false);
      fillSourceSelect(document.getElementById("modalSourceC"), null, true);
    }
  });

  document.getElementById("modalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("modalOk").onclick = () => {
    const name = document.getElementById("modalCName").value.trim() || "Construct";
    const mode = document.getElementById("modalCMode").value;
    let interactionOf = null;
    if (mode === "I") {
      const sources = [
        document.getElementById("modalSourceA").value,
        document.getElementById("modalSourceB").value,
        document.getElementById("modalSourceC").value,
      ].filter(Boolean);
      if (sources.length < 2 || new Set(sources).size !== sources.length) {
        const errBox = document.getElementById("modalInteractionError");
        errBox.textContent = t("s2_interaction_same_source");
        errBox.classList.remove("hidden");
        return;
      }
      interactionOf = sources;
    }
    const id = editor.addConstruct(name, mode, pos.x, pos.y, interactionOf);
    root.innerHTML = "";
    editor.setSelected({ type: "node", id });
    renderModelSummary();
  };
  document.getElementById("modalCName").focus();
}

// ---- AI-assisted structural model drawing ----
// New, purpose-built modal rather than generalizing openAiReportModal --
// this app's convention is small, self-contained, per-feature modals
// rather than one do-everything modal (see ai_report_modal.js's own header
// comment). Reuses the shared AI_PROVIDERS/aiReportGetStoredKey/
// aiReportEscapeHtml/aiReportEscapeAttr helpers from that file.
document.getElementById("aiDrawPathsBtn").addEventListener("click", () => {
  if (editor.constructs.length >= 2) openAiPathsModal();
});

function openAiPathsModal() {
  const root = document.getElementById("modalRoot");
  let currentProvider = "openai";

  const providerTabsHtml = AI_PROVIDER_ORDER.map((id) =>
    `<button type="button" class="ai-provider-tab${id === currentProvider ? " active" : ""}" data-provider="${id}">${aiReportEscapeHtml(AI_PROVIDERS[id].label)}</button>`,
  ).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("s2_ai_paths_modal_title")}</h3>
        <p class="hint">${t("s2_ai_paths_modal_hint")}</p>

        <label>${t("ai_modal_provider_label")}</label>
        <div class="ai-provider-tabs" id="aiPathsProviderTabs">${providerTabsHtml}</div>

        <label>${t("ai_modal_api_key_label")}</label>
        <div class="ai-key-row">
          <input type="password" id="aiPathsApiKey" autocomplete="off">
          <button type="button" class="btn ghost" id="aiPathsKeyToggle">👁</button>
        </div>
        <p class="hint" id="aiPathsApiKeyHint"></p>
        <label class="checkbox-row">
          <input type="checkbox" id="aiPathsRememberKey">
          ${t("ai_modal_remember_key")}
        </label>

        <label>${t("ai_modal_model_label")}</label>
        <input type="text" id="aiPathsModel" list="aiPathsModelSuggestions">
        <datalist id="aiPathsModelSuggestions"></datalist>
        <p class="hint">${t("ai_modal_model_hint")}</p>

        <label>${t("ai_modal_temperature_label")} — <span id="aiPathsTemperatureValue">1.0</span></label>
        <div class="ai-temp-row">
          <span class="ai-temp-endpoint">${t("ai_modal_temperature_low")}</span>
          <input type="range" id="aiPathsTemperature" min="0" max="1" step="0.1" value="1">
          <span class="ai-temp-endpoint">${t("ai_modal_temperature_high")}</span>
        </div>

        <label>${t("s2_ai_paths_context_label")}</label>
        <textarea id="aiPathsContext" rows="3" placeholder="${aiReportEscapeAttr(t("s2_ai_paths_context_placeholder"))}"></textarea>

        <div id="aiPathsError" class="error-box hidden"></div>
        <p class="hint hidden" id="aiPathsLoading">${t("s2_ai_paths_loading")}</p>
        <div class="modal-actions">
          <button class="btn" id="aiPathsCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="aiPathsRun">${t("s2_ai_paths_run")}</button>
        </div>
      </div>
    </div>`;

  const keyInput = document.getElementById("aiPathsApiKey");
  const modelInput = document.getElementById("aiPathsModel");
  const modelDatalist = document.getElementById("aiPathsModelSuggestions");
  const rememberCheckbox = document.getElementById("aiPathsRememberKey");
  const keyHint = document.getElementById("aiPathsApiKeyHint");
  const temperatureInput = document.getElementById("aiPathsTemperature");

  function applyProvider(providerId) {
    currentProvider = providerId;
    document.querySelectorAll("#aiPathsProviderTabs .ai-provider-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === providerId));
    const cfg = AI_PROVIDERS[providerId];
    const stored = aiReportGetStoredKey(providerId);
    keyInput.value = stored;
    keyInput.placeholder = cfg.keyPlaceholder;
    rememberCheckbox.checked = !!stored;
    modelInput.value = cfg.defaultModel;
    modelDatalist.innerHTML = cfg.modelSuggestions.map((m) => `<option value="${aiReportEscapeAttr(m)}">`).join("");
    keyHint.textContent = t("ai_modal_api_key_hint", { provider: cfg.label });
  }
  applyProvider(currentProvider);

  document.getElementById("aiPathsProviderTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".ai-provider-tab");
    if (btn) applyProvider(btn.dataset.provider);
  });
  document.getElementById("aiPathsKeyToggle").onclick = () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  };
  temperatureInput.addEventListener("input", () => {
    document.getElementById("aiPathsTemperatureValue").textContent = Number(temperatureInput.value).toFixed(1);
  });
  document.getElementById("aiPathsCancel").onclick = () => (root.innerHTML = "");

  document.getElementById("aiPathsRun").onclick = async () => {
    const errBox = document.getElementById("aiPathsError");
    errBox.classList.add("hidden");
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      errBox.textContent = t("s1_ai_config_missing_key");
      errBox.classList.remove("hidden");
      return;
    }
    const model = modelInput.value.trim() || AI_PROVIDERS[currentProvider].defaultModel;
    const temperature = Number(temperatureInput.value);
    const remember = rememberCheckbox.checked;
    try {
      const storageKey = AI_PROVIDERS[currentProvider].keyStorageKey;
      if (remember) localStorage.setItem(storageKey, apiKey);
      else localStorage.removeItem(storageKey);
    } catch {
      // localStorage unavailable -- key just won't persist, not fatal.
    }

    const constructsPayload = editor.constructs.map((c) => ({
      id: c.id, name: c.name, mode: c.mode, indicators: c.indicators || [],
      interaction_of: c.interaction_of || null,
    }));
    const extraContext = document.getElementById("aiPathsContext").value.trim();

    document.getElementById("aiPathsLoading").classList.remove("hidden");
    try {
      // Build the prompt text first with no AI call -- the user reviews/edits
      // it in the next phase before it's actually sent, since moderator/
      // interaction assignment can be semantically ambiguous and worth a
      // human check before spending an AI call on it.
      const res = await fetch("/api/ai_data_gen/suggest_paths_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          constructs: constructsPayload, extra_context: extraContext,
          indicator_descriptions: buildIndicatorDescriptions(), lang: getLang(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "request failed");
      renderAiPathsPromptReview(constructsPayload, currentProvider, apiKey, model, temperature, data.system_prompt, data.user_prompt);
      return; // renderAiPathsPromptReview already replaced this whole modal's DOM
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    }
    document.getElementById("aiPathsLoading").classList.add("hidden");
  };
}

function renderAiPathsPromptReview(constructsPayload, provider, apiKey, model, temperature, systemPrompt, userPrompt) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("s2_ai_paths_prompt_review_title")}</h3>
        <p class="hint">${t("s2_ai_paths_prompt_review_hint")}</p>

        <details open>
          <summary>${t("s1_ai_config_system_prompt_label")}</summary>
          <textarea class="ai-gen-prompt-preview" id="aiPathsSystemPrompt" rows="8"></textarea>
        </details>

        <label>${t("s1_ai_config_user_prompt_label")}</label>
        <textarea id="aiPathsUserPrompt" rows="4"></textarea>

        <div id="aiPathsPromptError" class="error-box hidden"></div>
        <p class="hint hidden" id="aiPathsPromptLoading">${t("s2_ai_paths_loading")}</p>
        <div class="modal-actions">
          <button class="btn" id="aiPathsPromptBack">${t("s2_ai_paths_back")}</button>
          <button class="btn primary" id="aiPathsPromptSend">${t("s2_ai_paths_send")}</button>
        </div>
      </div>
    </div>`;

  document.getElementById("aiPathsSystemPrompt").value = systemPrompt;
  document.getElementById("aiPathsUserPrompt").value = userPrompt;
  document.getElementById("aiPathsPromptBack").onclick = () => openAiPathsModal();
  document.getElementById("aiPathsPromptSend").onclick = async () => {
    const errBox = document.getElementById("aiPathsPromptError");
    errBox.classList.add("hidden");
    const editedSystemPrompt = document.getElementById("aiPathsSystemPrompt").value.trim();
    const editedUserPrompt = document.getElementById("aiPathsUserPrompt").value.trim();
    document.getElementById("aiPathsPromptLoading").classList.remove("hidden");
    try {
      const res = await fetch("/api/ai_data_gen/suggest_paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, api_key: apiKey, model, temperature,
          constructs: constructsPayload,
          system_prompt: editedSystemPrompt, user_prompt: editedUserPrompt,
          lang: getLang(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "request failed");
      renderAiPathsReview(constructsPayload, data.paths, data.rationale, data.moderator_suggestions || []);
      return; // renderAiPathsReview already replaced this whole modal's DOM
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    }
    document.getElementById("aiPathsPromptLoading").classList.add("hidden");
  };
}

function renderAiPathsReview(constructsPayload, paths, rationale, moderatorSuggestions = []) {
  const root = document.getElementById("modalRoot");
  const nameById = {};
  constructsPayload.forEach((c) => { nameById[c.id] = c.name; });

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("s2_ai_paths_review_title")}</h3>
        <div class="paths-review-list">
          ${paths.map((p, i) => `
            <label class="checkbox-row">
              <input type="checkbox" class="ai-path-check" data-index="${i}" checked>
              ${escapeHtml(nameById[p.source] || p.source)} → ${escapeHtml(nameById[p.target] || p.target)}
            </label>
          `).join("")}
        </div>
        ${moderatorSuggestions.length ? `
          <label>${t("s2_ai_moderator_suggestions_label")}</label>
          <p class="hint">${t("s2_ai_moderator_suggestions_hint")}</p>
          <div class="moderator-suggestions-box">
            ${moderatorSuggestions.map((m, i) => `
              <div class="moderator-suggestion-row" data-index="${i}">
                <div>
                  <strong>${escapeHtml(nameById[m.construct_id] || m.construct_id)}</strong>
                  ${m.reason ? `<p class="hint">${escapeHtml(m.reason)}</p>` : ""}
                </div>
                <button type="button" class="btn ghost ai-moderator-convert" data-construct-id="${escapeAttr(m.construct_id)}">${t("s2_ai_moderator_convert_btn")}</button>
              </div>
            `).join("")}
          </div>
        ` : ""}
        <label>${t("s2_ai_paths_rationale_label")}</label>
        <p class="paths-review-rationale">${escapeHtml(rationale)}</p>
        <div class="modal-actions">
          <button class="btn" id="aiPathsBack">${t("s2_ai_paths_back")}</button>
          <button class="btn primary" id="aiPathsApply">${t("s2_ai_paths_apply")}</button>
        </div>
      </div>
    </div>`;

  root.querySelectorAll(".ai-moderator-convert").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = editor.getConstruct(btn.dataset.constructId);
      if (!c) return;
      const sources = eligibleInteractionSources(c.id);
      if (sources.length < 2) {
        showModelMessage(t("s2_interaction_not_enough"));
        return;
      }
      // Same transition the mode dropdown in the construct edit panel does:
      // an interaction/moderation term is always exogenous, computed from
      // two OTHER constructs' scores, so it keeps no raw indicators of its
      // own and can't remain the target of any existing path.
      c.mode = "I";
      c.indicators = [];
      c.calc_method = "two_stage";
      c.product_term_generation = "standardized";
      editor.paths = editor.paths.filter((p) => p.target !== c.id);
      // The AI only flags WHICH construct looks like a moderator, not which
      // two (or three) others it multiplies with -- that's the same kind of
      // semantic judgment call this app already defers to a human for
      // elsewhere. Default to the first two eligible constructs so the
      // moderator renders correctly right away (dashed border, "A × B"
      // label, connector lines into it) instead of looking broken/empty;
      // the hint below tells the user to open the side panel and adjust the
      // sources if the AI's default guess isn't the right pair.
      c.interaction_of = [sources[0].id, sources[1].id];
      editor.render();
      renderModelSummary();
      btn.disabled = true;
      btn.textContent = t("s2_ai_moderator_converted");
      const row = btn.closest(".moderator-suggestion-row");
      if (row) {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = t("s2_ai_moderator_pick_sources_hint", { a: sources[0].name, b: sources[1].name });
        row.querySelector("div").appendChild(hint);
      }
    });
  });

  document.getElementById("aiPathsBack").onclick = () => openAiPathsModal();
  document.getElementById("aiPathsApply").onclick = () => {
    let applied = 0;
    let checkedCount = 0;
    document.querySelectorAll(".ai-path-check:checked").forEach((cb) => {
      checkedCount++;
      const p = paths[Number(cb.dataset.index)];
      if (editor.addPath(p.source, p.target)) applied++;
    });
    root.innerHTML = "";
    lastPathsRationale = rationale;
    document.getElementById("modelRationaleText").textContent = rationale;
    document.getElementById("modelRationalePanel").classList.remove("hidden");
    // Only worth a heads-up when something was actually skipped (e.g. the
    // client-side addPath guard rejected a path the user left checked) --
    // a full, unremarkable success needs no red-styled banner.
    if (applied < checkedCount) {
      showModelMessage(t("s2_ai_paths_applied", { applied, total: checkedCount }));
    }
  };
}

// ---- AI-rater: score a qualitative column into a new Likert indicator ----
// New, purpose-built modal (same "small, self-contained, per-feature modal"
// convention as openAiPathsModal above), but with a batch-accumulation loop
// instead of one call, since scoring potentially hundreds of respondents'
// free-text answers can't fit in a single AI response any more than
// generating that many rows could (see routes/ai_qual_score_api.py).
const QUAL_SCORE_BATCH_SIZE = 25;

document.getElementById("qualScoreBtn").addEventListener("click", () => {
  if (state.qualitativeColumns && state.qualitativeColumns.length) openQualScoreModal();
});

function openQualScoreModal() {
  const root = document.getElementById("modalRoot");
  let currentProvider = "openai";

  const providerTabsHtml = AI_PROVIDER_ORDER.map((id) =>
    `<button type="button" class="ai-provider-tab${id === currentProvider ? " active" : ""}" data-provider="${id}">${aiReportEscapeHtml(AI_PROVIDERS[id].label)}</button>`,
  ).join("");
  const columnOptionsHtml = state.qualitativeColumns.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("s2_qual_score_modal_title")}</h3>
        <p class="hint">${t("s2_qual_score_modal_hint")}</p>

        <label>${t("s2_qual_score_column_label")}</label>
        <select id="qualScoreColumn">${columnOptionsHtml}</select>

        <label>${t("s2_qual_score_rubric_label")}</label>
        <textarea id="qualScoreRubric" rows="4" placeholder="${aiReportEscapeAttr(t("s2_qual_score_rubric_placeholder"))}"></textarea>

        <div class="ai-gen-form-row">
          <div>
            <label>${t("s1_ai_config_likert")}</label>
            <label class="radio-row"><input type="radio" name="qualScoreLikert" value="5" checked> <span data-i18n="s1_ai_config_likert5">5 mức (1-5)</span></label>
            <label class="radio-row"><input type="radio" name="qualScoreLikert" value="7"> <span data-i18n="s1_ai_config_likert7">7 mức (1-7)</span></label>
          </div>
          <div>
            <label>${t("s2_qual_score_new_column_label")}</label>
            <input type="text" id="qualScoreNewColumn">
          </div>
        </div>

        <label>${t("ai_modal_provider_label")}</label>
        <div class="ai-provider-tabs" id="qualScoreProviderTabs">${providerTabsHtml}</div>

        <label>${t("ai_modal_api_key_label")}</label>
        <div class="ai-key-row">
          <input type="password" id="qualScoreApiKey" autocomplete="off">
          <button type="button" class="btn ghost" id="qualScoreKeyToggle">👁</button>
        </div>
        <p class="hint" id="qualScoreApiKeyHint"></p>
        <label class="checkbox-row">
          <input type="checkbox" id="qualScoreRememberKey">
          ${t("ai_modal_remember_key")}
        </label>

        <label>${t("ai_modal_model_label")}</label>
        <input type="text" id="qualScoreModel" list="qualScoreModelSuggestions">
        <datalist id="qualScoreModelSuggestions"></datalist>
        <p class="hint">${t("ai_modal_model_hint")}</p>

        <label>${t("ai_modal_temperature_label")} — <span id="qualScoreTemperatureValue">1.0</span></label>
        <div class="ai-temp-row">
          <span class="ai-temp-endpoint">${t("ai_modal_temperature_low")}</span>
          <input type="range" id="qualScoreTemperature" min="0" max="1" step="0.1" value="1">
          <span class="ai-temp-endpoint">${t("ai_modal_temperature_high")}</span>
        </div>

        <div id="qualScoreError" class="error-box hidden"></div>
        <div id="qualScoreProgressWrap" class="ai-gen-progress-wrap hidden">
          <progress id="qualScoreProgressBar" value="0" max="1"></progress>
          <p class="hint" id="qualScoreProgressText"></p>
        </div>
        <div class="modal-actions">
          <button class="btn" id="qualScoreCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="qualScoreRun">${t("s2_qual_score_run")}</button>
        </div>
      </div>
    </div>`;

  const columnSelect = document.getElementById("qualScoreColumn");
  const newColumnInput = document.getElementById("qualScoreNewColumn");
  const keyInput = document.getElementById("qualScoreApiKey");
  const modelInput = document.getElementById("qualScoreModel");
  const modelDatalist = document.getElementById("qualScoreModelSuggestions");
  const rememberCheckbox = document.getElementById("qualScoreRememberKey");
  const keyHint = document.getElementById("qualScoreApiKeyHint");
  const temperatureInput = document.getElementById("qualScoreTemperature");

  // Scoring the same column again (a different rubric, a second rater
  // pass, ...) is expected -- pick the first name that doesn't already
  // collide with an existing indicator, instead of always suggesting
  // "<column>_score" and making every re-run hit the collision error.
  function syncNewColumnDefault() {
    const base = `${columnSelect.value}_score`;
    let candidate = base;
    let n = 2;
    while ((state.columns || []).includes(candidate)) {
      candidate = `${base}_v${n}`;
      n += 1;
    }
    newColumnInput.value = candidate;
  }
  columnSelect.addEventListener("change", syncNewColumnDefault);
  syncNewColumnDefault();

  function applyProvider(providerId) {
    currentProvider = providerId;
    document.querySelectorAll("#qualScoreProviderTabs .ai-provider-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === providerId));
    const cfg = AI_PROVIDERS[providerId];
    const stored = aiReportGetStoredKey(providerId);
    keyInput.value = stored;
    keyInput.placeholder = cfg.keyPlaceholder;
    rememberCheckbox.checked = !!stored;
    modelInput.value = cfg.defaultModel;
    modelDatalist.innerHTML = cfg.modelSuggestions.map((m) => `<option value="${aiReportEscapeAttr(m)}">`).join("");
    keyHint.textContent = t("ai_modal_api_key_hint", { provider: cfg.label });
  }
  applyProvider(currentProvider);

  document.getElementById("qualScoreProviderTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".ai-provider-tab");
    if (btn) applyProvider(btn.dataset.provider);
  });
  document.getElementById("qualScoreKeyToggle").onclick = () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  };
  temperatureInput.addEventListener("input", () => {
    document.getElementById("qualScoreTemperatureValue").textContent = Number(temperatureInput.value).toFixed(1);
  });
  document.getElementById("qualScoreCancel").onclick = () => (root.innerHTML = "");

  document.getElementById("qualScoreRun").onclick = async () => {
    const errBox = document.getElementById("qualScoreError");
    errBox.classList.add("hidden");
    const qualColumn = columnSelect.value;
    const rubricPrompt = document.getElementById("qualScoreRubric").value.trim();
    const newColumn = newColumnInput.value.trim();
    const apiKey = keyInput.value.trim();
    if (!rubricPrompt) {
      errBox.textContent = t("s2_qual_score_missing_rubric");
      errBox.classList.remove("hidden");
      return;
    }
    if (!newColumn) {
      errBox.textContent = t("s2_qual_score_missing_new_column");
      errBox.classList.remove("hidden");
      return;
    }
    if (!apiKey) {
      errBox.textContent = t("s1_ai_config_missing_key");
      errBox.classList.remove("hidden");
      return;
    }
    const model = modelInput.value.trim() || AI_PROVIDERS[currentProvider].defaultModel;
    const temperature = Number(temperatureInput.value);
    const likertScale = Number(document.querySelector('input[name="qualScoreLikert"]:checked').value);
    const remember = rememberCheckbox.checked;
    try {
      const storageKey = AI_PROVIDERS[currentProvider].keyStorageKey;
      if (remember) localStorage.setItem(storageKey, apiKey);
      else localStorage.removeItem(storageKey);
    } catch {
      // localStorage unavailable -- key just won't persist, not fatal.
    }

    document.getElementById("qualScoreRun").disabled = true;
    const bar = document.getElementById("qualScoreProgressBar");
    const text = document.getElementById("qualScoreProgressText");
    document.getElementById("qualScoreProgressWrap").classList.remove("hidden");
    const total = state.nRows;
    bar.max = total;

    const accumulated = [];
    try {
      let cursor = 0;
      while (cursor < total) {
        const startRow = cursor + 1;
        const endRow = Math.min(total, cursor + QUAL_SCORE_BATCH_SIZE);
        bar.value = cursor;
        text.textContent = t("s1_ai_gen_progress", { done: cursor, total });
        const res = await fetch("/api/ai_qual_score/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: currentProvider, api_key: apiKey, model, temperature,
            file_id: state.fileId, qual_column: qualColumn, rubric_prompt: rubricPrompt,
            likert_scale: likertScale, start_row: startRow, end_row: endRow, lang: getLang(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "batch failed");
        accumulated.push(...data.rows);
        cursor = endRow;
      }

      bar.value = total;
      text.textContent = t("s1_ai_gen_finalizing");
      const finalizeRes = await fetch("/api/ai_qual_score/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: state.fileId, qual_column: qualColumn, new_column: newColumn,
          rubric_prompt: rubricPrompt, likert_scale: likertScale, scores: accumulated,
        }),
      });
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "finalize failed");

      state.numericColumns = finalizeData.numeric_columns;
      state.columns = finalizeData.columns;
      root.innerHTML = "";
      showModelMessage(t("s2_qual_score_success", { column: newColumn }));
      refreshQualScorePanel();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
      document.getElementById("qualScoreRun").disabled = false;
      document.getElementById("qualScoreProgressWrap").classList.add("hidden");
    }
  };
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
  const theoryBox = document.getElementById("cTheoryBox");
  if (c.theory && c.theory.citation_apa) {
    const citation = [c.theory.citation_apa, c.theory.doi ? `DOI: ${c.theory.doi}` : ""].filter(Boolean).join(" — ");
    theoryBox.textContent = `📚 ${citation}`;
    theoryBox.classList.remove("hidden");
  } else {
    theoryBox.classList.add("hidden");
  }
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
  const noneOptHtml = `<option value="">${t("s2_interaction_source_c_none")}</option>` + optHtml;
  const selA = document.getElementById("cSourceA");
  const selB = document.getElementById("cSourceB");
  const selC = document.getElementById("cSourceC");
  selA.innerHTML = optHtml;
  selB.innerHTML = optHtml;
  selC.innerHTML = noneOptHtml;
  const [curA, curB, curC] = construct.interaction_of || [];
  if (curA && options.some((o) => o.id === curA)) selA.value = curA;
  else if (options[0]) selA.value = options[0].id;
  if (curB && options.some((o) => o.id === curB)) selB.value = curB;
  else if (options[1]) selB.value = options[1].id;
  selC.value = curC && options.some((o) => o.id === curC) ? curC : "";

  const collectSources = () => [selA.value, selB.value, selC.value].filter(Boolean);

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

  // A three-way interaction (3 sources) only supports Two Stage (see
  // pls/model.py's own validation) — lock the other two radios out rather
  // than letting the user pick an invalid combination the server would
  // just reject.
  function updateCalcMethodLock(isThreeWay) {
    document.querySelectorAll('#cCalcMethod input[name="cCalcMethod"]').forEach((r) => {
      r.disabled = isThreeWay && r.value !== "two_stage";
      if (isThreeWay && r.value === "two_stage") r.checked = true;
    });
    document.getElementById("cCalcMethodThreeWayNote").classList.toggle("hidden", !isThreeWay);
    if (isThreeWay) {
      construct.calc_method = "two_stage";
      updateProductTermUI(true);
    }
  }

  const onSourceChange = () => {
    const sources = collectSources();
    if (new Set(sources).size !== sources.length) {
      errBox.textContent = t("s2_interaction_same_source");
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    construct.interaction_of = sources;
    // Keep the construct's own name in sync with its current sources --
    // otherwise adding/swapping a source here (e.g. picking a third one to
    // go from 2-way to 3-way) leaves a stale "A × B" name that silently
    // drops a source every downstream label (path table, Simple Slopes,
    // exports, AI report) reads directly from .name.
    construct.name = sources.map((sid) => editor.getConstruct(sid)?.name).filter(Boolean).join(" × ") || construct.name;
    document.getElementById("cName").value = construct.name;
    updateCalcMethodLock(sources.length === 3);
    editor.render();
    renderModelSummary();
  };
  selA.onchange = onSourceChange;
  selB.onchange = onSourceChange;
  selC.onchange = onSourceChange;
  construct.interaction_of = collectSources();

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
  updateCalcMethodLock((construct.interaction_of || []).length === 3);

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
  const sources = (c.interaction_of || []).map((sid) => editor.getConstruct(sid));
  return sources.length >= 2 && sources.every(Boolean) ? sources.map((s) => s.name).join(" × ") : t("lbl_dash");
}

function updateAiDrawPathsBtnState() {
  const btn = document.getElementById("aiDrawPathsBtn");
  const enough = editor.constructs.length >= 2;
  btn.disabled = !enough;
  btn.title = enough ? "" : t("s2_ai_draw_paths_disabled_hint");
}

// Model design (constructs/paths/AI rationale) is allowed with no real
// dataset yet (see the skip-to-model shortcut) -- but actually running PLS
// needs real rows, so keep the run button disabled with a hint until
// state.fileId names an uploaded/generated dataset.
function updateRunAnalysisBtnState() {
  const btn = document.getElementById("runAnalysisBtn");
  const hasData = !!state.fileId;
  btn.disabled = !hasData;
  btn.title = hasData ? "" : t("s2_run_no_data_hint");
}

function renderModelSummary() {
  updateAiDrawPathsBtnState();
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
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Additive fields only -- pls/model.py's Model.from_json (used by both
// /api/analyze and importModelBtn) ignores unknown keys, so folding the
// codebook's question wording and the AI's structural rationale in here
// doesn't touch the model's real schema or round-trip behavior.
// column -> question wording, from the AI Lab codebook (if any) -- shared by
// the model export enrichment and by the AI-drawn-model prompt, which needs
// the actual scale content (not just column names) to reason accurately.
function buildIndicatorDescriptions() {
  const descriptions = {};
  (aiGenState.codebook || []).forEach((item) => {
    if (item.column && item.question_text) descriptions[item.column] = item.question_text;
  });
  return descriptions;
}

function buildModelExportPayload() {
  const payload = {
    format: "pls-sem-web-model",
    version: 1,
    exported_at: new Date().toISOString(),
    constructs: editor.constructs,
    paths: editor.paths,
  };
  // Full codebook (column + construct + question wording, same shape as
  // codebookExportBtn's own export) -- not just the subset of indicators
  // currently wired into the model, so a row the user hasn't assigned to
  // any construct yet isn't silently lost from the "save everything" export.
  if (aiGenState.codebook && aiGenState.codebook.length) payload.codebook = aiGenState.codebook;
  const descriptions = buildIndicatorDescriptions();
  if (Object.keys(descriptions).length) payload.indicator_descriptions = descriptions;
  if (lastPathsRationale) payload.rationale = lastPathsRationale;
  return payload;
}

document.getElementById("exportModelBtn").addEventListener("click", () => {
  if (!editor || editor.constructs.length === 0) return;
  downloadJson(buildModelExportPayload(), "pls_model.json");
});

// "Save all proposals": one click downloads the (enriched) model JSON and,
// only when the current dataset was AI-generated (i.e. #aiGenExportBtn's
// Excel export link is populated), also triggers that download -- two
// separate export formats, same as today, just both from one button.
document.getElementById("saveAllProposalsBtn").addEventListener("click", () => {
  if (!editor || editor.constructs.length === 0) return;
  downloadJson(buildModelExportPayload(), "pls_model.json");
  const dataExportBtn = document.getElementById("aiGenExportBtn");
  if (!dataExportBtn.classList.contains("hidden")) dataExportBtn.click();
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
document.getElementById("mgaBtn").addEventListener("click", () => openMgaModal());
document.getElementById("cbsemMlCompareBtn").addEventListener("click", () => openMlComparisonModal("cbsem"));
document.getElementById("aiReportBtn").addEventListener("click", () => openSemAiReportModal("pls"));
document.getElementById("cbsemAiReportBtn").addEventListener("click", () => openSemAiReportModal("cbsem"));
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
  const modelPayloadForDefaults = editor.serialize();
  // Mirrors routes/sensitivity_api.py's own min_n floor, so the "new sample
  // size" field's bounds and default match what the server will actually
  // accept instead of just guessing and letting the server reject it.
  const nIndicatorsForDefaults = modelPayloadForDefaults.constructs.reduce(
    (sum, c) => sum + (c.indicators ? c.indicators.length : 0), 0,
  );
  const minN = Math.max(20, nIndicatorsForDefaults + 5);
  const suggestedNewN = Math.max(minN, Math.round(nRows * 0.5));
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
        <div>
          <label>${t("sens_mode_label")}</label>
          <label class="radio-row"><input type="radio" name="sensMode" value="shrink" checked> <span>${t("sens_mode_shrink_label")}</span></label>
          <label class="radio-row"><input type="radio" name="sensMode" value="resample"> <span>${t("sens_mode_resample_label")}</span></label>
        </div>

        <div id="sensShrinkFields">
          <label>${t("sens_modal_step_label")}</label>
          <input type="number" id="sensStep" min="1" step="1" value="${suggestedStep}">
        </div>

        <div id="sensResampleFields" class="hidden">
          <label>${t("sens_modal_new_n_label")}</label>
          <input type="number" id="sensNewN" min="${minN}" max="${Math.max(minN, nRows - 1)}" step="1" value="${suggestedNewN}">
          <label>${t("sens_modal_n_iter_label")}</label>
          <input type="number" id="sensNIter" min="20" max="500" step="10" value="100">
          <p class="hint">${t("sens_modal_resample_hint")}</p>
        </div>

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
  document.querySelectorAll('input[name="sensMode"]').forEach((radio) => {
    radio.onchange = () => {
      const isResample = document.querySelector('input[name="sensMode"]:checked').value === "resample";
      document.getElementById("sensShrinkFields").classList.toggle("hidden", isResample);
      document.getElementById("sensResampleFields").classList.toggle("hidden", !isResample);
    };
  });
  document.getElementById("sensModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("sensModalOk").onclick = () => {
    const mode = document.querySelector('input[name="sensMode"]:checked').value;
    const errBox = document.getElementById("sensModalError");
    const modelPayload = editor.serialize();

    if (mode === "resample") {
      const newN = parseInt(document.getElementById("sensNewN").value, 10);
      const nIter = parseInt(document.getElementById("sensNIter").value, 10);
      if (!Number.isInteger(newN) || newN < minN || newN >= nRows) {
        errBox.textContent = t("sens_modal_invalid_new_n", { min: minN, n: nRows });
        errBox.classList.remove("hidden");
        return;
      }
      if (!Number.isInteger(nIter) || nIter < 20 || nIter > 500) {
        errBox.textContent = t("sens_modal_invalid_n_iter");
        errBox.classList.remove("hidden");
        return;
      }
      const job = {
        file_id: state.fileId, model: modelPayload, method, mode: "resample",
        new_n: newN, n_iterations: nIter, lang: getLang(),
        estimated_seconds: (nIter * PLS_MS_PER_FIT) / 1000,
      };
      if (!isCbsem && document.getElementById("sensBootEnabled").checked) {
        const nBoot = parseInt(document.getElementById("sensNBoot").value, 10);
        if (!Number.isInteger(nBoot) || nBoot < 100) {
          errBox.textContent = t("sens_modal_invalid_n_boot");
          errBox.classList.remove("hidden");
          return;
        }
        job.bootstrap = { enabled: true, n_boot: nBoot };
        // Mirrors routes/sensitivity_api.py's own total_fits math for this route.
        job.estimated_seconds = (nIter * nBoot * PLS_MS_PER_FIT) / 1000;
      }
      sessionStorage.setItem("websem_sensitivity_job", JSON.stringify(job));
      root.innerHTML = "";
      window.open("/sensitivity", "_blank");
      return;
    }

    const step = parseInt(document.getElementById("sensStep").value, 10);
    if (!Number.isInteger(step) || step < 1) {
      errBox.textContent = t("sens_modal_invalid_step");
      errBox.classList.remove("hidden");
      return;
    }
    const job = { file_id: state.fileId, model: modelPayload, method, mode: "shrink", step, lang: getLang() };
    if (!isCbsem && document.getElementById("sensBootEnabled").checked) {
      const nBoot = parseInt(document.getElementById("sensNBoot").value, 10);
      if (!Number.isInteger(nBoot) || nBoot < 100) {
        errBox.textContent = t("sens_modal_invalid_n_boot");
        errBox.classList.remove("hidden");
        return;
      }
      job.bootstrap = { enabled: true, n_boot: nBoot };
      // Mirrors routes/sensitivity_api.py's own expected_steps math, so the
      // countdown on the results tab is grounded in the same formula the
      // server will actually run against -- see PLS_MS_PER_FIT's comment.
      const expectedSteps = Math.max(1, Math.min(150, Math.floor((nRows - minN) / step) + 1));
      job.estimated_seconds = (expectedSteps * nBoot * PLS_MS_PER_FIT) / 1000;
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
    // Same formula as updateEstimate() above -- reused here so the countdown
    // on the results tab matches the estimate the modal already showed.
    job.estimated_seconds = isCbsem
      ? points.length * nMc * 0.044
      : points.length * nMc * (1 + nBoot) * 0.0077;
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
    const modelPayload = editor.serialize();
    const job = { file_id: state.fileId, model: modelPayload, method, algorithms: selected, k, lang: getLang() };
    // Mirrors ml_compare/engine.py's own budget-guard formula exactly --
    // cost_per_fit came from that same module via /api/ml_algorithms, so
    // this can't drift out of sync with the real cost model.
    const nTargets = new Set(modelPayload.paths.map((p) => p.target)).size;
    const totalCostPerFit = selected.reduce((sum, id) => sum + (byId[id] ? byId[id].cost_per_fit : 1), 0);
    job.estimated_seconds = nTargets * k * totalCostPerFit;
    sessionStorage.setItem("websem_ml_job", JSON.stringify(job));
    root.innerHTML = "";
    window.open("/ml_comparison", "_blank");
  };
}

// ---- PLS-MGA (Multi-Group Analysis): compare path coefficients between two
// groups of respondents. Same two-hop pattern as ML Comparison: a config
// modal here collects the grouping column + which values go in each group,
// then stashes a job into sessionStorage and opens a standalone results tab.
async function openMgaModal() {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal-box"><h3>${t("mga_modal_title")}</h3><p class="hint">${t("mga_modal_loading")}</p></div></div>`;

  const modelPayload = editor.serialize();
  let candidates = null;
  try {
    const res = await fetch("/api/mga_candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: state.fileId, model: modelPayload, lang: getLang() }),
    });
    const data = await res.json();
    if (res.ok) candidates = data.candidates;
  } catch {
    candidates = null;
  }

  if (!candidates || !candidates.length) {
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-box">
          <h3>${t("mga_modal_title")}</h3>
          <div class="error-box">${t("mga_modal_no_candidates")}</div>
          <div class="modal-actions"><button class="btn" id="mgaModalClose">${t("modal_cancel")}</button></div>
        </div>
      </div>`;
    document.getElementById("mgaModalClose").onclick = () => (root.innerHTML = "");
    return;
  }

  const byColumn = Object.fromEntries(candidates.map((c) => [c.column, c]));

  function renderValueChecklist(containerId, column, excludeValues) {
    const entry = byColumn[column];
    document.getElementById(containerId).innerHTML = entry.options.map((o) => `
      <label class="ml-algo-item"${excludeValues.has(o.value) ? ` title="${escapeAttr(t("mga_modal_value_used_by_other_group"))}"` : ""}>
        <input type="checkbox" data-value="${escapeAttr(o.value)}" ${excludeValues.has(o.value) ? "disabled" : ""}>
        <span>${escapeHtml(o.value)} <span class="hint">(n=${o.count})</span></span>
      </label>
    `).join("");
  }

  function checkedValues(containerId) {
    return [...document.querySelectorAll(`#${containerId} input[data-value]:checked`)].map((i) => i.dataset.value);
  }

  function refreshChecklists() {
    const column = document.getElementById("mgaColumn").value;
    const aChecked = new Set(checkedValues("mgaGroupAValues"));
    const bChecked = new Set(checkedValues("mgaGroupBValues"));
    renderValueChecklist("mgaGroupAValues", column, bChecked);
    renderValueChecklist("mgaGroupBValues", column, aChecked);
    document.querySelectorAll("#mgaGroupAValues input[data-value]").forEach((i) => { i.checked = aChecked.has(i.dataset.value); });
    document.querySelectorAll("#mgaGroupBValues input[data-value]").forEach((i) => { i.checked = bChecked.has(i.dataset.value); });
  }

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("mga_modal_title")}</h3>
        <p class="hint">${t("mga_modal_hint")}</p>
        <label>${t("mga_modal_column_label")}</label>
        <select id="mgaColumn">
          ${candidates.map((c) => `<option value="${escapeAttr(c.column)}">${escapeHtml(c.column)}</option>`).join("")}
        </select>

        <div class="modal-section-title">${t("mga_modal_group_a_title")}</div>
        <input type="text" id="mgaLabelA" placeholder="${escapeAttr(t("mga_modal_label_placeholder_a"))}">
        <div class="ml-algo-checklist" id="mgaGroupAValues"></div>

        <div class="modal-section-title">${t("mga_modal_group_b_title")}</div>
        <input type="text" id="mgaLabelB" placeholder="${escapeAttr(t("mga_modal_label_placeholder_b"))}">
        <div class="ml-algo-checklist" id="mgaGroupBValues"></div>

        <div class="ml-kfold-row">
          <label>${t("mga_modal_n_boot_label")}</label>
          <input type="number" id="mgaNBoot" min="100" max="5000" step="100" value="500">
        </div>
        <div class="ml-kfold-row">
          <label>${t("mga_modal_n_perm_label")}</label>
          <input type="number" id="mgaNPerm" min="100" max="5000" step="100" value="1000">
        </div>
        <p class="hint">${t("mga_modal_settings_hint")}</p>

        <div id="mgaModalError" class="error-box hidden"></div>
        <div class="modal-actions">
          <button class="btn" id="mgaModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="mgaModalOk">${t("sens_modal_run")}</button>
        </div>
      </div>
    </div>`;

  refreshChecklists();
  document.getElementById("mgaColumn").addEventListener("change", refreshChecklists);
  document.getElementById("mgaGroupAValues").addEventListener("change", refreshChecklists);
  document.getElementById("mgaGroupBValues").addEventListener("change", refreshChecklists);
  document.getElementById("mgaModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("mgaModalOk").onclick = () => {
    const errBox = document.getElementById("mgaModalError");
    const column = document.getElementById("mgaColumn").value;
    const groupAValues = checkedValues("mgaGroupAValues");
    const groupBValues = checkedValues("mgaGroupBValues");
    if (!groupAValues.length || !groupBValues.length) {
      errBox.textContent = t("mga_modal_select_values");
      errBox.classList.remove("hidden");
      return;
    }
    const nBoot = parseInt(document.getElementById("mgaNBoot").value, 10);
    const nPerm = parseInt(document.getElementById("mgaNPerm").value, 10);
    if (!Number.isInteger(nBoot) || nBoot < 100 || nBoot > 5000 || !Number.isInteger(nPerm) || nPerm < 100 || nPerm > 5000) {
      errBox.textContent = t("mga_modal_invalid_settings");
      errBox.classList.remove("hidden");
      return;
    }
    const job = {
      file_id: state.fileId, model: modelPayload, column,
      group_a_values: groupAValues, group_b_values: groupBValues,
      label_a: document.getElementById("mgaLabelA").value.trim() || groupAValues.join(", "),
      label_b: document.getElementById("mgaLabelB").value.trim() || groupBValues.join(", "),
      n_boot: nBoot, n_perm: nPerm, lang: getLang(),
    };
    sessionStorage.setItem("websem_mga_job", JSON.stringify(job));
    root.innerHTML = "";
    window.open("/pls_mga", "_blank");
  };
}

function buildSemReportContext(data, method) {
  // The AI is instructed (SYSTEM_PROMPT in routes/ai_report_api.py) to write
  // the whole report in whatever language the app is currently in -- but it
  // was still leaking English fragments into Vietnamese reports because
  // this context (the "data and figures" it's told to write ONLY from) was
  // hardcoded in English regardless of `lang`, and it tends to echo section
  // headers/labels verbatim from its source material. Narrative headers and
  // connective words are localized below; genuinely fixed statistical/
  // methodological terms (Cronbach's α, AVE, HTMT, VIF, R², CFI/TLI/RMSEA,
  // p-value, Reflective (Mode A)/Formative (Mode B), etc.) are left as-is,
  // matching how this app's OWN UI already keeps those identical in both
  // languages (see s2_mode_reflective/s2_mode_formative in i18n.js) --
  // that's standard academic convention, not English leaking in.
  const lang = getLang();
  const L = (vi, en) => (lang === "vi" ? vi : en);
  const idToName = {};
  data.constructs.forEach((c) => (idToName[c.id] = c.name));
  const lines = [];
  const modeLabel = {
    A: "Reflective (Mode A)", B: "Formative (Mode B)",
    I: L("Biến tương tác/điều tiết", "Interaction/Moderation"),
  };
  const yesNo = (v) => (v === undefined ? "—" : v ? L("có", "yes") : L("không", "no"));

  lines.push(`## ${L("Tổng quan mô hình", "Model overview")} (${method === "cbsem" ? "CB-SEM" : "PLS-SEM"})`);
  lines.push(`n = ${data.n_obs}, ${L("hội tụ", "converged")} = ${yesNo(data.converged)}${data.iterations ? `, ${L("số vòng lặp", "iterations")} = ${data.iterations}` : ""}`);
  if (data.bootstrap) lines.push(`Bootstrap: ${data.bootstrap.valid}/${data.bootstrap.requested} ${L("mẫu lặp lại hợp lệ", "valid resamples")}`);
  lines.push("");
  lines.push(L("Các biến tiềm ẩn (construct):", "Constructs:"));
  data.constructs.forEach((c) => {
    lines.push(`- ${c.name} (${modeLabel[c.mode] || c.mode}), ${L("biến quan sát", "indicators")}: ${c.indicators.join(", ") || "—"}`);
  });

  lines.push("");
  lines.push(`## ${L("Mô hình cấu trúc — hệ số đường dẫn", "Structural model — path coefficients")}`);
  lines.push(`| ${L("Đường dẫn", "Path")} | ${L("Hệ số", "Coefficient")} | p-value | ${L("Có ý nghĩa", "Significant")} | f² |`);
  lines.push("|---|---|---|---|---|");
  data.structural.paths.forEach((p) => {
    const coef = method === "cbsem" ? p.std : p.coefficient;
    lines.push(`| ${p.source_name} -> ${p.target_name} | ${fmt(coef)} | ${fmt(p.p_value, 4)} | ${yesNo(p.significant)} | ${fmt(p.f_squared)} |`);
  });

  lines.push("");
  lines.push("## R²" + (method === "pls" ? " / Q²" : ""));
  lines.push(method === "pls" ? `| ${L("Construct", "Construct")} | R² | Q² |` : `| ${L("Construct", "Construct")} | R² |`);
  lines.push(method === "pls" ? "|---|---|---|" : "|---|---|");
  Object.keys(data.structural.r_squared || {}).forEach((cid) => {
    if (method === "pls") {
      const q2 = data.structural.q_squared ? data.structural.q_squared[cid] : null;
      lines.push(`| ${idToName[cid]} | ${fmt(data.structural.r_squared[cid])} | ${q2 !== null && q2 !== undefined ? fmt(q2) : "—"} |`);
    } else {
      lines.push(`| ${idToName[cid]} | ${fmt(data.structural.r_squared[cid])} |`);
    }
  });

  const m = data.measurement;
  if (m && m.cronbachs_alpha) {
    lines.push("");
    lines.push(`## ${L("Độ tin cậy & giá trị hội tụ", "Reliability & convergent validity")}`);
    lines.push(`| ${L("Construct", "Construct")} | Cronbach's α | Composite Reliability | AVE |`);
    lines.push("|---|---|---|---|");
    data.constructs.filter((c) => c.mode === "A").forEach((c) => {
      lines.push(`| ${c.name} | ${fmt(m.cronbachs_alpha[c.id])} | ${fmt(m.composite_reliability[c.id])} | ${fmt(m.ave[c.id])} |`);
    });
  }

  const teRows = (data.structural.total_effects || []);
  if (teRows.length) {
    lines.push("");
    lines.push(`## ${L("Hiệu ứng Tổng & Gián tiếp (trung gian)", "Total & Indirect Effects (mediation)")}`);
    lines.push(`| ${L("Đường dẫn", "Path")} | ${L("Trực tiếp", "Direct")} | ${L("Gián tiếp", "Indirect")} | ${L("Tổng", "Total")} |`);
    lines.push("|---|---|---|---|");
    teRows.forEach((e) => lines.push(`| ${e.source_name} -> ${e.target_name} | ${fmt(e.direct)} | ${fmt(e.indirect)} | ${fmt(e.total)} |`));
  }

  const siRows = (data.structural.specific_indirect_effects || []);
  if (siRows.length) {
    lines.push("");
    lines.push(`## ${L("Hiệu ứng Gián tiếp Cụ thể", "Specific Indirect Effects")}`);
    lines.push(`| ${L("Chuỗi trung gian", "Route")} | ${L("Hiệu ứng", "Effect")} | p-value | ${L("Có ý nghĩa", "Significant")} |`);
    lines.push("|---|---|---|---|");
    siRows.forEach((r) => lines.push(`| ${r.path_names.join(" -> ")} | ${fmt(r.effect)} | ${r.p_value !== undefined ? fmt(r.p_value, 4) : "—"} | ${yesNo(r.significant)} |`));
  }

  const mmRows = (data.structural.moderated_mediation || []);
  if (mmRows.length) {
    lines.push("");
    lines.push(`## ${L("Chỉ số Trung gian có Điều tiết (Hayes, 2015)", "Index of Moderated Mediation (Hayes, 2015)")}`);
    lines.push(`| ${L("Chuỗi trung gian", "Route")} | ${L("Biến điều tiết", "Moderator")} | ${L("Chỉ số", "Index")} | p-value | ${L("Có ý nghĩa", "Significant")} |`);
    lines.push("|---|---|---|---|---|");
    mmRows.forEach((r) => lines.push(`| ${r.path_names.join(" -> ")} | ${r.moderator_name} | ${fmt(r.index)} | ${r.p_value !== undefined ? fmt(r.p_value, 4) : "—"} | ${yesNo(r.significant)} |`));
  }

  if (method === "cbsem" && data.fit_indices) {
    const fi = data.fit_indices;
    lines.push("");
    lines.push(`## ${L("Chỉ số phù hợp mô hình CB-SEM", "CB-SEM fit indices")}`);
    lines.push(`chi-square = ${fmt(fi.chi_square)} (df = ${fi.df}, p = ${fmt(fi.chi_square_p_value, 4)}), CFI = ${fmt(fi.cfi)}, TLI = ${fmt(fi.tli)}, RMSEA = ${fmt(fi.rmsea)}, SRMR = ${fmt(fi.srmr)}, GFI = ${fmt(fi.gfi)}, AGFI = ${fmt(fi.agfi)}, NFI = ${fmt(fi.nfi)}, AIC = ${fmt(fi.aic)}, BIC = ${fmt(fi.bic)}`);
  }

  const dv = data.discriminant_validity;
  if (dv && dv.fornell_larcker) {
    const flIds = Object.keys(dv.fornell_larcker);
    lines.push("");
    lines.push(`## ${L("Giá trị phân biệt — Tiêu chí Fornell-Larcker", "Discriminant Validity — Fornell-Larcker Criterion")}`);
    lines.push(L(
      "Đường chéo = căn bậc hai của AVE; phải lớn hơn tương quan của construct này với mọi construct khác (ngoài đường chéo, cùng hàng/cột).",
      "Diagonal = sqrt(AVE); should exceed this construct's correlation with every other construct (off-diagonal, same row/column).",
    ));
    lines.push(`| | ${flIds.map((id) => idToName[id]).join(" | ")} |`);
    lines.push(`|---|${flIds.map(() => "---").join("|")}|`);
    flIds.forEach((rid) => lines.push(`| ${idToName[rid]} | ${flIds.map((cid) => fmt(dv.fornell_larcker[cid][rid])).join(" | ")} |`));
  }
  if (dv && dv.htmt) {
    const htmtIds = Object.keys(dv.htmt);
    lines.push("");
    lines.push(`## ${L("Giá trị phân biệt — HTMT (Heterotrait-Monotrait Ratio)", "Discriminant Validity — HTMT (Heterotrait-Monotrait Ratio)")}`);
    lines.push(L(
      "Nên nhỏ hơn 0.85 (nghiêm ngặt) hoặc 0.90 (nới lỏng) cho mọi cặp construct.",
      "Should stay below 0.85 (strict) or 0.90 (lenient) for every construct pair.",
    ));
    lines.push(`| | ${htmtIds.map((id) => idToName[id]).join(" | ")} |`);
    lines.push(`|---|${htmtIds.map(() => "---").join("|")}|`);
    htmtIds.forEach((rid) => lines.push(`| ${idToName[rid]} | ${htmtIds.map((cid) => fmt(dv.htmt[cid][rid])).join(" | ")} |`));
  }

  if (method === "pls" && data.structural.inner_vif) {
    const vifRows = [];
    Object.entries(data.structural.inner_vif).forEach(([targetId, preds]) => {
      Object.entries(preds || {}).forEach(([predId, v]) => {
        if (v !== null && v !== undefined) vifRows.push([idToName[predId], idToName[targetId], v]);
      });
    });
    if (vifRows.length) {
      lines.push("");
      lines.push(`## ${L("Đa cộng tuyến Cấu trúc (Inner VIF)", "Structural Multicollinearity (Inner VIF)")}`);
      lines.push(L(
        "Nên nhỏ hơn 3.3-5; giá trị cao hơn cho thấy đa cộng tuyến đáng lo ngại giữa các biến dự báo của một construct.",
        "Should stay below 3.3-5; higher values suggest problematic collinearity among a target's predictors.",
      ));
      lines.push(`| ${L("Biến dự báo", "Predictor")} | ${L("Biến đích", "Target")} | VIF |`);
      lines.push("|---|---|---|");
      vifRows.forEach(([p, tt, v]) => lines.push(`| ${p} | ${tt} | ${fmt(v)} |`));
    }
  }

  const cmb = data.common_method_bias;
  if (cmb && cmb.vif) {
    lines.push("");
    lines.push(`## ${L("Sai lệch Phương pháp Chung — Kiểm tra Đa cộng tuyến Toàn phần (Kock, 2015)", "Common Method Bias — Full Collinearity Test (Kock, 2015)")}`);
    lines.push(L(
      `Mỗi construct được hồi quy trên TẤT CẢ construct khác (không chỉ các biến dự báo cấu trúc của nó); ngưỡng = ${fmt(cmb.threshold, 1)} -- VIF vượt ngưỡng này ở BẤT KỲ construct nào cho thấy có thể có một yếu tố "phương pháp" tiềm ẩn làm phóng đại phương sai.`,
      `Every construct regressed on all others (not just its structural predictors); threshold = ${fmt(cmb.threshold, 1)} -- a VIF above this on ANY construct suggests a single latent "method" factor may be inflating variances.`,
    ));
    lines.push(`| ${L("Construct", "Construct")} | ${L("VIF đa cộng tuyến toàn phần", "Full collinearity VIF")} | ${L("Đánh giá", "Assessment")} |`);
    lines.push("|---|---|---|");
    Object.entries(cmb.vif).forEach(([cid, v]) => {
      const assessment = v !== null && v !== undefined && v > cmb.threshold
        ? L("Có thể có sai lệch phương pháp chung (CMB)", "Possible CMB concern")
        : L("Đạt", "OK");
      lines.push(`| ${idToName[cid]} | ${fmt(v)} | ${assessment} |`);
    });
  }

  const slopeCards = buildSimpleSlopesCards(data, method, idToName);
  if (slopeCards.length) {
    lines.push("");
    lines.push(`## ${L("Độ dốc đơn giản (diễn giải điều tiết, Aiken & West 1991)", "Simple Slopes (moderation interpretation, Aiken & West 1991)")}`);
    lines.push(L(
      "Độ dốc của biến dự báo chính lên biến đích tại ba mức của biến điều tiết (trung bình ± 1 độ lệch chuẩn); biểu đồ cho mỗi tương tác đã được đính kèm ở trên.",
      "Slope of the focal predictor on the target at three levels of the moderator (mean ± 1 SD); a chart per interaction is attached above.",
    ));
    const outerLevelLabel = { low: L("−1 SD", "−1 SD"), mean: L("Trung bình", "Mean"), high: L("+1 SD", "+1 SD") };
    slopeCards.forEach((c) => {
      lines.push("");
      const heading = c.outerModName
        ? `### ${c.outerModName} (${outerLevelLabel[c.outerLevelKey]}) × ${c.modName} × ${c.focalName} → ${c.targetName}`
        : `### ${c.modName} × ${c.focalName} → ${c.targetName}`;
      lines.push(heading);
      if (c.outerModName) {
        lines.push(L(
          `Trong nhóm giữ ${c.outerModName} ở mức ${outerLevelLabel[c.outerLevelKey]}, độ dốc của biến chính theo ${c.modName}:`,
          `Holding ${c.outerModName} at ${outerLevelLabel[c.outerLevelKey]}, the focal predictor's slope across ${c.modName}:`,
        ));
      }
      lines.push(`| ${L("Mức biến điều tiết", "Moderator level")} | ${L("Độ dốc đơn giản (β)", "Simple slope (β)")} |`);
      lines.push("|---|---|");
      lines.push(`| ${c.modName} ${L("tại −1 SD", "at −1 SD")} | ${fmt(c.slopeLow)} |`);
      lines.push(`| ${c.modName} ${L("tại Trung bình", "at Mean")} | ${fmt(c.slopeMean)} |`);
      lines.push(`| ${c.modName} ${L("tại +1 SD", "at +1 SD")} | ${fmt(c.slopeHigh)} |`);
    });
  }

  return lines.join("\n");
}

// Shared between buildSemReportContext (text) and captureSimpleSlopesImages
// (chart PNGs) so the two stay in sync -- same focal/moderator orientation
// (unswapped default) and same b_focal*x + b_mod*z + b_int*x*z model as
// renderSimpleSlopes/drawSimpleSlopesChart use for the on-screen chart.
function buildSimpleSlopesCards(data, method, idToName) {
  // 2-way: one card, slope of the focal predictor at -1SD/Mean/+1SD of the
  // (single) moderator. 3-way: the SAME idea applied per level of the OUTER
  // moderator -- within a fixed level z of the outer moderator, the model's
  // Y = bFocal*X + bInnerMod*Z1 + bOuterMod*Z2 + bTriple*X*Z1*Z2 reduces to
  // an ordinary 2-way interaction between X and Z1 with an EFFECTIVE
  // interaction coefficient bTriple*z -- so three cards (one per outer
  // level) reuse the exact same slope math as the 2-way case, just with
  // that scaled interaction term substituted in.
  const interactions = data.constructs.filter(
    (c) => c.mode === "I" && c.interaction_of && (c.interaction_of.length === 2 || c.interaction_of.length === 3)
  );
  const coefOf = {};
  data.structural.paths.forEach((p) => {
    coefOf[`${p.source}->${p.target}`] = method === "cbsem" ? p.std : p.coefficient;
  });
  const out = [];
  interactions.forEach((ic) => {
    const targetPath = data.structural.paths.find((p) => p.source === ic.id);
    if (!targetPath) return;
    const targetId = targetPath.target;

    if (ic.interaction_of.length === 3) {
      const [a, b, c] = ic.interaction_of;
      const focalId = c, innerModId = b, outerModId = a;
      const bFocal = coefOf[`${focalId}->${targetId}`] || 0;
      const bTriple = coefOf[`${ic.id}->${targetId}`] || 0;
      [["low", -1], ["mean", 0], ["high", 1]].forEach(([outerLevelKey, z]) => {
        const bIntEffective = bTriple * z;
        out.push({
          focalName: idToName[focalId], modName: idToName[innerModId], targetName: idToName[targetId],
          outerModName: idToName[outerModId], outerLevelKey,
          slopeLow: bFocal - bIntEffective, slopeMean: bFocal, slopeHigh: bFocal + bIntEffective,
        });
      });
      return;
    }

    const [a, b] = ic.interaction_of;
    const focalId = b, modId = a; // matches renderSimpleSlopes' default (unswapped) orientation
    const bFocal = coefOf[`${focalId}->${targetId}`] || 0;
    const bInt = coefOf[`${ic.id}->${targetId}`] || 0;
    out.push({
      focalName: idToName[focalId], modName: idToName[modId], targetName: idToName[targetId],
      slopeLow: bFocal - bInt, slopeMean: bFocal, slopeHigh: bFocal + bInt,
    });
  });
  return out;
}

function captureSimpleSlopesImages(data, gridId) {
  const interactions = data.constructs.filter(
    (c) => c.mode === "I" && c.interaction_of && (c.interaction_of.length === 2 || c.interaction_of.length === 3)
  );
  const cards = interactions
    .map((ic) => (data.structural.paths.find((p) => p.source === ic.id) ? ic : null))
    .filter(Boolean);
  const images = [];
  cards.forEach((ic, i) => {
    const mainTitle = document.getElementById(`${gridId}Title${i}`);
    const mainLabel = mainTitle ? mainTitle.textContent : t("ai_image_simple_slopes");
    if (ic.interaction_of.length === 3) {
      for (let pi = 0; pi < 3; pi++) {
        const canvas = document.getElementById(`${gridId}Chart${i}_${pi}`);
        if (!canvas || !canvas.width || !canvas.height) continue;
        const panelTitle = document.getElementById(`${gridId}PanelTitle${i}_${pi}`);
        images.push({
          label: panelTitle ? `${mainLabel} — ${panelTitle.textContent}` : mainLabel,
          dataUrl: canvas.toDataURL("image/png"),
        });
      }
      return;
    }
    const canvas = document.getElementById(`${gridId}Chart${i}`);
    if (!canvas || !canvas.width || !canvas.height) return;
    images.push({ label: mainLabel, dataUrl: canvas.toDataURL("image/png") });
  });
  return images;
}

function openSemAiReportModal(method) {
  const data = method === "cbsem" ? lastCbsemResult : lastAnalysisResult;
  if (!data) return;
  const context = buildSemReportContext(data, method);
  const sourceLabel = `${method === "cbsem" ? "CB-SEM" : "PLS-SEM"} — n = ${data.n_obs}`;
  const diagram = method === "cbsem" ? cbsemResultDiagram : resultDiagram;
  const images = diagram ? [{ label: t("ai_image_path_diagram"), dataUrl: diagram.canvas.toDataURL("image/png") }] : [];
  const slopesGridId = method === "cbsem" ? "cbsemSimpleSlopesGrid" : "simpleSlopesGrid";
  images.push(...captureSimpleSlopesImages(data, slopesGridId));
  openAiReportModal({
    context,
    sourceLabel,
    defaultPrompt: t("ai_modal_prompt_default_sem"),
    images,
  });
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

// Benchmarked on this app's own 4-construct/13-indicator TAM sample model
// (see pls/power_analysis.py's docstring) -- one PLS fit, which is what each
// bootstrap resample costs, takes ~7.7ms there. Used only for a rough
// client-side "time remaining" estimate on top of the real request; actual
// cost depends on the user's own dataset/model size, so the countdown
// degrades gracefully (see countdown.js) rather than promising exact timing.
const PLS_MS_PER_FIT = 7.7;

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
  document.getElementById("resultsLoadingMsg").textContent = bootstrapEnabled
    ? t("s3_loading_pls_boot", { n: nBoot })
    : t("s3_loading_pls");
  const etaEl = document.getElementById("resultsLoadingEta");
  let stopEta = null;
  if (bootstrapEnabled) {
    etaEl.classList.remove("hidden");
    stopEta = startEtaCountdown(etaEl, (nBoot * PLS_MS_PER_FIT) / 1000);
  } else {
    etaEl.classList.add("hidden");
  }

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
    if (stopEta) stopEta();
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
  document.getElementById("resultsLoadingMsg").textContent = t("s3_loading_cbsem");
  document.getElementById("resultsLoadingEta").classList.add("hidden");

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

  const interactions = data.constructs.filter(
    (c) => c.mode === "I" && c.interaction_of && (c.interaction_of.length === 2 || c.interaction_of.length === 3)
  );
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
    .map((c, i) => {
      if (c.ic.interaction_of.length === 3) {
        // 3-way: three side-by-side panels, one per level of the OUTER
        // moderator -- each panel is its own ordinary 3-line chart (see
        // draw3Way below for why this is mathematically exact, not just a
        // visual approximation). No swap button here (V1): the three roles
        // (focal / inner moderator shown as 3 lines / outer moderator
        // faceted into 3 panels) use a fixed default assignment.
        return `
      <div class="slope-card slope-card-3way" data-idx="${i}">
        <div class="slope-card-header">
          <h4 id="${gridId}Title${i}"></h4>
        </div>
        <div class="slope-3way-panels">
          ${[0, 1, 2].map((pi) => `
            <div class="slope-3way-panel">
              <p class="slope-3way-panel-title" id="${gridId}PanelTitle${i}_${pi}"></p>
              <div class="chart-wrap"><canvas id="${gridId}Chart${i}_${pi}"></canvas><div id="${gridId}Tooltip${i}_${pi}" class="chart-tooltip hidden"></div></div>
              <div class="chart-legend" id="${gridId}Legend${i}_${pi}"></div>
            </div>`).join("")}
        </div>
      </div>`;
      }
      return `
      <div class="slope-card" data-idx="${i}">
        <div class="slope-card-header">
          <h4 id="${gridId}Title${i}"></h4>
          <button type="button" class="slope-swap-btn" data-idx="${i}">⇄ ${t("s3_slopes_swap")}</button>
        </div>
        <div class="chart-wrap"><canvas id="${gridId}Chart${i}"></canvas><div id="${gridId}Tooltip${i}" class="chart-tooltip hidden"></div></div>
        <div class="chart-legend" id="${gridId}Legend${i}"></div>
      </div>`;
    })
    .join("");

  const swapped = cards.map(() => false);

  function draw3Way(i) {
    const { ic, targetId } = cards[i];
    const [a, b, c] = ic.interaction_of;
    const focalId = c, innerModId = b, outerModId = a;
    const bFocal = coefOf[`${focalId}->${targetId}`] || 0;
    const bInnerMod = coefOf[`${innerModId}->${targetId}`] || 0;
    const bOuterMod = coefOf[`${outerModId}->${targetId}`] || 0;
    const bTriple = coefOf[`${ic.id}->${targetId}`] || 0;

    document.getElementById(`${gridId}Title${i}`).textContent =
      `${idToName[outerModId]} × ${idToName[innerModId]} × ${idToName[focalId]} → ${idToName[targetId]}`;

    const xs = [];
    for (let x = -2; x <= 2.0001; x += 0.25) xs.push(Math.round(x * 100) / 100);

    const outerLevels = [
      { key: "low", z: -1, label: t("s3_slopes_low", { name: idToName[outerModId] }) },
      { key: "mean", z: 0, label: t("s3_slopes_mean", { name: idToName[outerModId] }) },
      { key: "high", z: 1, label: t("s3_slopes_high", { name: idToName[outerModId] }) },
    ];
    const innerLevels = [
      { key: "low", z: -1, label: t("s3_slopes_low", { name: idToName[innerModId] }) },
      { key: "mean", z: 0, label: t("s3_slopes_mean", { name: idToName[innerModId] }) },
      { key: "high", z: 1, label: t("s3_slopes_high", { name: idToName[innerModId] }) },
    ];

    outerLevels.forEach((ol, pi) => {
      document.getElementById(`${gridId}PanelTitle${i}_${pi}`).textContent = ol.label;
      // Fixing the outer moderator at level `ol.z` reduces
      // Y = bFocal*X + bInnerMod*Z1 + bOuterMod*Z2 + bTriple*X*Z1*Z2 to an
      // ordinary 2-way interaction between X and Z1 with EFFECTIVE
      // interaction coefficient bTriple*ol.z -- so at the outer moderator's
      // mean (ol.z = 0) the three lines are exactly parallel (no visible
      // interaction), which is the correct, substantive reading: the
      // moderating effect of Z1 only emerges away from Z2's mean.
      const bIntEffective = bTriple * ol.z;
      const series = innerLevels.map((lv) => ({
        id: lv.key,
        label: lv.label,
        color: SLOPE_LEVEL_COLORS[lv.key],
        dash: SLOPE_LEVEL_DASH[lv.key],
        points: xs.map((x) => ({
          x, y: bFocal * x + bInnerMod * lv.z + bOuterMod * ol.z + bIntEffective * x * lv.z, converged: true,
        })),
      }));
      drawSimpleSlopesChart(`${gridId}Chart${i}_${pi}`, `${gridId}Tooltip${i}_${pi}`, `${gridId}Legend${i}_${pi}`, series, {
        xLabel: idToName[focalId], yLabel: idToName[targetId],
      });
    });
  }

  function draw(i) {
    const { ic, targetId } = cards[i];
    if (ic.interaction_of.length === 3) {
      draw3Way(i);
      return;
    }
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

// Runs last -- every function/DOM element it depends on (initEditor,
// codebookAddRow, renderResults, the wizard substep navigators, ...) is
// already defined and wired up by this point in the script.
restoreSession();
