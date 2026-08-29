/* AI-generated report page: fetches /api/ai_report for the job stashed in
 * sessionStorage by ai_report_modal.js's openAiReportModal(), then renders
 * the returned Markdown as HTML. No countdown here (unlike Sensitivity/
 * Power Analysis/ML Comparison) -- there's no reliable per-token latency
 * benchmark for an LLM call, so a fabricated ETA would be misleading
 * rather than useful; a plain "generating..." message is the honest
 * choice. */

applyStaticTranslations();
document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === getLang()));
document.getElementById("langSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest(".lang-btn");
  if (!btn) return;
  setLang(btn.dataset.lang);
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
});
document.getElementById("closeTabBtn").addEventListener("click", () => window.close());

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- small hand-rolled Markdown -> HTML renderer ----------------
// Covers exactly what a report-writing prompt to GPT realistically produces:
// # ## ### headings, **bold**/*italic*/`code`, - / * / 1. lists, blank-line
// paragraphs, and GFM-style pipe tables. Not a general-purpose Markdown
// parser -- matches this codebase's existing "no external JS libraries"
// convention (hand-rolled canvas charts, hand-rolled i18n) rather than
// vendoring a Markdown library for one page.

function mdInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

function isTableSeparatorLine(line) {
  const t2 = line.trim();
  return t2.includes("-") && /^\|?[\s:|-]+\|?$/.test(t2);
}

function renderMarkdown(md) {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let listType = null; // "ul" | "ol" | null
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      html += `<p>${mdInline(paraBuf.join(" "))}</p>`;
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = Math.min(heading[1].length, 3);
      html += `<h${level}>${mdInline(heading[2])}</h${level}>`;
      i++;
      continue;
    }

    if (trimmed.includes("|") && lines[i + 1] !== undefined && isTableSeparatorLine(lines[i + 1])) {
      flushPara();
      closeList();
      const headerCells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      let tableHtml = "<table><thead><tr>" + headerCells.map((c) => `<th>${mdInline(c)}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) {
        const rowCells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        tableHtml += "<tr>" + rowCells.map((c) => `<td>${mdInline(c)}</td>`).join("") + "</tr>";
        i++;
      }
      tableHtml += "</tbody></table>";
      html += `<div class="table-scroll">${tableHtml}</div>`;
      continue;
    }

    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${mdInline(ul[1])}</li>`;
      i++;
      continue;
    }

    const ol = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${mdInline(ol[1])}</li>`;
      i++;
      continue;
    }

    if (trimmed === "") {
      flushPara();
      closeList();
      i++;
      continue;
    }

    closeList();
    paraBuf.push(trimmed);
    i++;
  }
  flushPara();
  closeList();
  return html;
}

// ---------------------------------------------------------------------------

async function main() {
  const raw = sessionStorage.getItem("websem_ai_report_job");
  if (!raw) {
    showError(t("ai_no_job"));
    return;
  }
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    showError(t("ai_no_job"));
    return;
  }
  document.getElementById("aiSourceLabel").textContent = job.source_label || "";
  document.getElementById("aiUserPrompt").textContent = job.user_prompt || "";
  renderReportImages(job.images);

  try {
    const res = await fetch("/api/ai_report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("ai_failed"));
    document.getElementById("aiLoading").classList.add("hidden");
    document.getElementById("aiContent").classList.remove("hidden");
    document.getElementById("aiReportBody").innerHTML = renderMarkdown(data.report);
  } catch (err) {
    showError(err.message);
  }
}

function renderReportImages(images) {
  const container = document.getElementById("aiReportImages");
  if (!images || !images.length) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  container.innerHTML = images.map((img) => `
    <div class="ai-report-image-card">
      <img src="${img.dataUrl}" alt="${escapeHtml(img.label || "")}">
      <p class="caption">${escapeHtml(img.label || "")}</p>
    </div>
  `).join("");
}

function showError(msg) {
  document.getElementById("aiLoading").classList.add("hidden");
  const box = document.getElementById("aiError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

main();
