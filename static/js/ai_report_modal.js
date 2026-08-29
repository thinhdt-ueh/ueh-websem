/* Shared "AI Report" config modal, loaded by every page that offers it
 * (main results, Sensitivity, Power Analysis, ML Comparison). Collects the
 * user's own OpenAI API key + model + prompt, stashes a job in
 * sessionStorage together with a data summary the CALLER already built
 * from results it has in memory, and opens /ai_report in a new tab --
 * same sessionStorage-job -> new-tab pattern as every other standalone
 * results page in this app (see sensitivity.js/power_analysis.js/
 * ml_comparison.js's own main()).
 *
 * Self-contained (own escapeHtml/escapeAttr) rather than relying on
 * whichever page-specific script happens to load alongside it, matching
 * how each of this app's page scripts already duplicates these small
 * helpers instead of sharing them across files. */

const AI_REPORT_KEY_STORAGE = "websem_openai_api_key";
const AI_REPORT_MODEL_SUGGESTIONS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4.1-mini"];

function aiReportEscapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function aiReportEscapeAttr(s) {
  return aiReportEscapeHtml(s);
}

/**
 * opts:
 *   - context: string, the pre-built data summary for this analysis
 *   - sourceLabel: string, short human-readable description shown in the
 *     modal (e.g. "PLS-SEM results — TAM sample, n = 250")
 *   - defaultPrompt: string, editable starter instruction for this page type
 */
function openAiReportModal(opts) {
  const root = document.getElementById("modalRoot");
  let savedKey = "";
  try {
    savedKey = localStorage.getItem(AI_REPORT_KEY_STORAGE) || "";
  } catch {
    savedKey = "";
  }

  const modelOptionsHtml = AI_REPORT_MODEL_SUGGESTIONS.map((m) => `<option value="${aiReportEscapeAttr(m)}">`).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("ai_modal_title")}</h3>
        <p class="hint">${aiReportEscapeHtml(opts.sourceLabel || "")}</p>

        <label>${t("ai_modal_api_key_label")}</label>
        <div class="ai-key-row">
          <input type="password" id="aiApiKey" placeholder="sk-..." value="${aiReportEscapeAttr(savedKey)}" autocomplete="off">
          <button type="button" class="btn ghost" id="aiKeyToggle">👁</button>
        </div>
        <p class="hint">${t("ai_modal_api_key_hint")}</p>
        <label class="checkbox-row">
          <input type="checkbox" id="aiRememberKey" ${savedKey ? "checked" : ""}>
          ${t("ai_modal_remember_key")}
        </label>

        <label>${t("ai_modal_model_label")}</label>
        <input type="text" id="aiModel" list="aiModelSuggestions" value="gpt-4o-mini">
        <datalist id="aiModelSuggestions">${modelOptionsHtml}</datalist>

        <label>${t("ai_modal_prompt_label")}</label>
        <textarea id="aiPrompt" rows="5">${aiReportEscapeHtml(opts.defaultPrompt || "")}</textarea>

        <div id="aiModalError" class="error-box hidden"></div>
        <div class="modal-actions">
          <button class="btn" id="aiModalCancel">${t("modal_cancel")}</button>
          <button class="btn primary" id="aiModalOk">${t("ai_modal_run")}</button>
        </div>
      </div>
    </div>`;

  const keyInput = document.getElementById("aiApiKey");
  document.getElementById("aiKeyToggle").onclick = () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  };
  document.getElementById("aiModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("aiModalOk").onclick = () => {
    const errBox = document.getElementById("aiModalError");
    const apiKey = keyInput.value.trim();
    const model = document.getElementById("aiModel").value.trim() || "gpt-4o-mini";
    const userPrompt = document.getElementById("aiPrompt").value.trim();
    const remember = document.getElementById("aiRememberKey").checked;

    if (!apiKey) {
      errBox.textContent = t("ai_modal_invalid_key");
      errBox.classList.remove("hidden");
      return;
    }
    if (!userPrompt) {
      errBox.textContent = t("ai_modal_invalid_prompt");
      errBox.classList.remove("hidden");
      return;
    }

    try {
      if (remember) localStorage.setItem(AI_REPORT_KEY_STORAGE, apiKey);
      else localStorage.removeItem(AI_REPORT_KEY_STORAGE);
    } catch {
      // localStorage unavailable (private browsing, etc.) -- key just won't persist, not fatal
    }

    const job = {
      api_key: apiKey, model, context: opts.context, user_prompt: userPrompt,
      source_label: opts.sourceLabel || "", lang: getLang(),
    };
    sessionStorage.setItem("websem_ai_report_job", JSON.stringify(job));
    root.innerHTML = "";
    window.open("/ai_report", "_blank");
  };
}
