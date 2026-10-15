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
