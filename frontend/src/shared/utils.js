export function percent(value, target) {
  if (!target) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

export function statusForProgress(progress) {
  if (progress >= 80) return "good";
  if (progress >= 60) return "warning";
  return "danger";
}

export function unique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function setOptions(select, values, selectedValue) {
  select.innerHTML = values.map((value) => `<option ${value === selectedValue ? "selected" : ""}>${value}</option>`).join("");
}

export function localFileUrl(path) {
  return encodeURI(`file://${path}`);
}

export function renderBullets(items) {
  return (items || []).map((item) => `<li>${item}</li>`).join("");
}

export function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function fileExtension(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}
