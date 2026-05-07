import { API_BASE_STORAGE_KEY, DEFAULT_API_BASE_URL } from "../core/config.js?v=20260507i";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isLocalRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function getApiBaseUrl() {
  const url = new URL(window.location.href);
  const queryBase = url.searchParams.get("apiBase");
  if (queryBase) {
    return trimTrailingSlash(queryBase);
  }

  const storedBase = window.localStorage.getItem(API_BASE_STORAGE_KEY);
  if (storedBase) {
    return trimTrailingSlash(storedBase);
  }

  return isLocalRuntime() ? DEFAULT_API_BASE_URL : null;
}

export function isApiConfigured() {
  return Boolean(getApiBaseUrl());
}

function buildApiUrl(pathname, params = {}) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("La API de MEL no esta configurada en este entorno.");
  }

  const url = new URL(trimTrailingSlash(baseUrl) + "/" + String(pathname || "").replace(/^\//, ""));
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, value);
  });
  return url;
}

async function requestJson(pathname, options = {}, params = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) {
    headers["content-type"] = headers["content-type"] || "application/json";
  }

  const response = await fetch(buildApiUrl(pathname, params), {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "No pude completar la solicitud a la API.");
    error.details = body.details || null;
    throw error;
  }

  return body;
}

export async function fetchApiConfig() {
  const response = await requestJson("analytics/config");
  return response.data;
}

export async function fetchApiPrograms() {
  const response = await requestJson("programs");
  return response.data || [];
}

export async function createApiProgram(program) {
  const response = await requestJson("programs", {
    method: "POST",
    body: JSON.stringify(program),
  });
  return response.data;
}

export async function updateApiProgram(programId, program) {
  const response = await requestJson("programs/" + encodeURIComponent(programId), {
    method: "PUT",
    body: JSON.stringify(program),
  });
  return response.data;
}

export async function deleteApiProgram(programId) {
  await requestJson("programs/" + encodeURIComponent(programId), {
    method: "DELETE",
  });
}

export async function fetchApiIndicators(filters = {}) {
  const response = await requestJson("indicators", {}, filters);
  return response.data || [];
}

export async function createApiIndicator(indicator) {
  const response = await requestJson("indicators", {
    method: "POST",
    body: JSON.stringify(indicator),
  });
  return response.data;
}

export async function updateApiIndicator(indicatorId, indicator) {
  const response = await requestJson("indicators/" + encodeURIComponent(indicatorId), {
    method: "PUT",
    body: JSON.stringify(indicator),
  });
  return response.data;
}

export async function deleteApiIndicator(indicatorId) {
  await requestJson("indicators/" + encodeURIComponent(indicatorId), {
    method: "DELETE",
  });
}

export async function fetchApiReports(filters = {}) {
  const response = await requestJson("reports", {}, filters);
  return response.data || [];
}

export async function fetchApiNotifications(filters = {}) {
  const response = await requestJson("notifications", {}, filters);
  return response.data || [];
}

export async function markApiNotificationRead(notificationId, payload = {}) {
  const response = await requestJson("notifications/" + encodeURIComponent(notificationId) + "/read", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function fetchApiEmailOutbox(filters = {}) {
  const response = await requestJson("email-outbox", {}, filters);
  return response.data || [];
}

export async function fetchApiAnalyticsOverview(filters = {}) {
  const response = await requestJson("analytics/overview", {}, filters);
  return response.data;
}

export async function createApiReport(report) {
  const response = await requestJson("reports", {
    method: "POST",
    body: JSON.stringify(report),
  });
  return response.data;
}

export async function createApiReportsBulk(reports) {
  const response = await requestJson("reports/bulk", {
    method: "POST",
    body: JSON.stringify({ reports }),
  });
  return response.data || [];
}

export async function updateApiReportStatus(reportId, payload) {
  const response = await requestJson("reports/" + encodeURIComponent(reportId) + "/status", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response;
}

export async function fetchApiReportStatusHistory(reportId) {
  const response = await requestJson("reports/" + encodeURIComponent(reportId) + "/status-history");
  return response.data || [];
}
