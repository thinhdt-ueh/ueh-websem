/* Shared "AI Report" config modal, loaded by every page that offers it
 * (main results, Sensitivity, Power Analysis, ML Comparison). Collects the
 * user's own API key for their choice of provider (OpenAI/Gemini/Claude) +
 * model + prompt, stashes a job in sessionStorage together with a data
 * summary AND chart/diagram images the CALLER already built from results
 * it has in memory, and opens /ai_report in a new tab -- same
 * sessionStorage-job -> new-tab pattern as every other standalone results
 * page in this app (see sensitivity.js/power_analysis.js/ml_comparison.js's
 * own main()).
 *
 * Self-contained (own escapeHtml/escapeAttr) rather than relying on
 * whichever page-specific script happens to load alongside it, matching
 * how each of this app's page scripts already duplicates these small
 * helpers instead of sharing them across files. */

const AI_PROVIDERS = {
  openai: {
    label: "OpenAI (ChatGPT)",
    keyStorageKey: "websem_openai_api_key",
    keyPlaceholder: "sk-...",
    defaultModel: "gpt-4o-mini",
    modelSuggestions: [
      "gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4-turbo",
      "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-chat",
      "o1", "o1-mini", "o1-pro", "o3", "o3-mini", "o3-pro", "o4-mini",
    ],
  },
  gemini: {
    label: "Google Gemini",
    keyStorageKey: "websem_gemini_api_key",
    keyPlaceholder: "AIza...",
    defaultModel: "gemini-2.0-flash",
    modelSuggestions: [
      "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
      "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-pro",
      "gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.5-flash-8b",
    ],
  },
  claude: {
    label: "Anthropic Claude",
    keyStorageKey: "websem_claude_api_key",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-5",
    modelSuggestions: [
      "claude-sonnet-5", "claude-opus-5", "claude-fable-5", "claude-haiku-4-5-20251001",
      "claude-opus-4-1", "claude-sonnet-4-5", "claude-3-7-sonnet-latest",
      "claude-3-5-haiku-latest", "claude-3-opus-latest",
    ],
  },
};
const AI_PROVIDER_ORDER = ["openai", "gemini", "claude"];

function aiReportEscapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function aiReportEscapeAttr(s) {
  return aiReportEscapeHtml(s);
}

function aiReportGetStoredKey(providerId) {
  try {
    return localStorage.getItem(AI_PROVIDERS[providerId].keyStorageKey) || "";
  } catch {
    return "";
  }
}

/**
 * opts:
 *   - context: string, the pre-built data summary for this analysis
 *   - sourceLabel: string, short human-readable description shown in the
 *     modal (e.g. "PLS-SEM results — TAM sample, n = 250")
 *   - defaultPrompt: string, editable starter instruction for this page type
 *   - images: optional array of {label, dataUrl} -- chart/diagram PNGs
 *     already rendered on the calling page, carried through to the report
 *     page and displayed there (not sent to the AI, just attached to the
 *     report output).
 */
function openAiReportModal(opts) {
  const root = document.getElementById("modalRoot");
  let currentProvider = "openai";

  const providerTabsHtml = AI_PROVIDER_ORDER.map((id) =>
    `<button type="button" class="ai-provider-tab${id === currentProvider ? " active" : ""}" data-provider="${id}">${aiReportEscapeHtml(AI_PROVIDERS[id].label)}</button>`,
  ).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box modal-wide">
        <h3>${t("ai_modal_title")}</h3>
        <p class="hint">${aiReportEscapeHtml(opts.sourceLabel || "")}</p>

        <label>${t("ai_modal_provider_label")}</label>
        <div class="ai-provider-tabs" id="aiProviderTabs">${providerTabsHtml}</div>

        <label>${t("ai_modal_api_key_label")}</label>
        <div class="ai-key-row">
          <input type="password" id="aiApiKey" placeholder="${aiReportEscapeAttr(AI_PROVIDERS[currentProvider].keyPlaceholder)}" autocomplete="off">
          <button type="button" class="btn ghost" id="aiKeyToggle">👁</button>
        </div>
        <p class="hint" id="aiApiKeyHint"></p>
        <label class="checkbox-row">
          <input type="checkbox" id="aiRememberKey">
          ${t("ai_modal_remember_key")}
        </label>

        <label>${t("ai_modal_model_label")}</label>
        <input type="text" id="aiModel" list="aiModelSuggestions">
        <datalist id="aiModelSuggestions"></datalist>
        <p class="hint">${t("ai_modal_model_hint")}</p>

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
  const modelInput = document.getElementById("aiModel");
  const modelDatalist = document.getElementById("aiModelSuggestions");
  const rememberCheckbox = document.getElementById("aiRememberKey");
  const keyHint = document.getElementById("aiApiKeyHint");

  function applyProvider(providerId) {
    currentProvider = providerId;
    document.querySelectorAll(".ai-provider-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === providerId));
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

  document.getElementById("aiProviderTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".ai-provider-tab");
    if (btn) applyProvider(btn.dataset.provider);
  });
  document.getElementById("aiKeyToggle").onclick = () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  };
  document.getElementById("aiModalCancel").onclick = () => (root.innerHTML = "");
  document.getElementById("aiModalOk").onclick = () => {
    const errBox = document.getElementById("aiModalError");
    const apiKey = keyInput.value.trim();
    const model = modelInput.value.trim() || AI_PROVIDERS[currentProvider].defaultModel;
    const userPrompt = document.getElementById("aiPrompt").value.trim();
    const remember = rememberCheckbox.checked;

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
      const storageKey = AI_PROVIDERS[currentProvider].keyStorageKey;
      if (remember) localStorage.setItem(storageKey, apiKey);
      else localStorage.removeItem(storageKey);
    } catch {
      // localStorage unavailable (private browsing, etc.) -- key just won't persist, not fatal
    }

    const job = {
      provider: currentProvider, api_key: apiKey, model, context: opts.context, user_prompt: userPrompt,
      source_label: opts.sourceLabel || "", images: opts.images || [], lang: getLang(),
    };
    try {
      sessionStorage.setItem("websem_ai_report_job", JSON.stringify(job));
    } catch {
      // Chart images can be large; if the combined job exceeds sessionStorage's
      // quota, retry without them rather than failing outright -- the written
      // report still works, it just won't carry the attached charts.
      job.images = [];
      try {
        sessionStorage.setItem("websem_ai_report_job", JSON.stringify(job));
      } catch {
        errBox.textContent = t("ai_modal_storage_error");
        errBox.classList.remove("hidden");
        return;
      }
    }
    root.innerHTML = "";
    window.open("/ai_report", "_blank");
  };
}
