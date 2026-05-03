import http from "node:http";
import {
  createReport,
  createReportsBulk,
  findReportById,
  listIndicators,
  listPrograms,
  listReportStatusHistory,
  queryReports,
  saveReportStatusDecision,
} from "./data/mock-store.js";
import { resolveAnalyticsScope, validateReportStatusChange } from "./domain/reporting-rules.js";
import { buildAnalyticsConfig, buildAnalyticsOverview } from "./services/analytics-service.js";

const PORT = Number(process.env.PORT || 8080);
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, status = 204) {
  response.writeHead(status, CORS_HEADERS);
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSON_INVALID");
  }
}

function parseFilters(url) {
  return {
    program: url.searchParams.get("program") || undefined,
    programId: url.searchParams.get("programId") || undefined,
    province: url.searchParams.get("province") || undefined,
    period: url.searchParams.get("period") || undefined,
    scope: resolveAnalyticsScope(url.searchParams.get("scope") || undefined),
  };
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => !String(payload[field] || "").trim());
  if (!missing.length) return null;
  return {
    error: "Faltan campos obligatorios para registrar el reporte.",
    details: { missing },
  };
}

function filterReportsByScope(reports, scope) {
  if (scope === "all") return reports;
  return reports.filter((report) => report.status === "Aprobado");
}

export async function handlePrograms(_request, response) {
  sendJson(response, 200, { data: listPrograms() });
}

export async function handleReportsList(request, response, url) {
  const filters = parseFilters(url);
  const reports = filterReportsByScope(queryReports(filters), filters.scope);
  sendJson(response, 200, { data: reports, filters });
}

export async function handleReportCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: "El cuerpo del reporte no es JSON valido." });
    return;
  }

  const required = requireFields(payload, ["program", "indicatorId", "owner"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }

  const report = createReport(payload);
  sendJson(response, 201, { data: report });
}

export async function handleReportBulkCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del lote no es JSON valido." });
    return;
  }

  const items = Array.isArray(payload.reports) ? payload.reports : [];
  if (!items.length) {
    sendJson(response, 400, {
      error: "Debes enviar un arreglo de reportes en reports.",
      details: { field: "reports" },
    });
    return;
  }

  const reports = createReportsBulk(items);
  sendJson(response, 201, { data: reports, count: reports.length });
}

export async function handleReportStatusUpdate(request, response, reportId) {
  const report = findReportById(reportId);
  if (!report) {
    sendJson(response, 404, { error: "No encontre el reporte solicitado." });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "La decision de revision no es JSON valido." });
    return;
  }

  if (!String(payload.actorId || "").trim()) {
    sendJson(response, 400, {
      error: "Debes indicar actorId para registrar la trazabilidad de revision.",
      details: { field: "actorId" },
    });
    return;
  }

  const validation = validateReportStatusChange({
    currentStatus: report.status,
    nextStatus: payload.status,
    actorRole: payload.actorRole,
    note: payload.note,
  });

  if (!validation.ok) {
    sendJson(response, validation.status || 400, {
      error: validation.error,
      details: validation.details || null,
    });
    return;
  }

  const result = saveReportStatusDecision(reportId, {
    status: payload.status,
    actorId: payload.actorId,
    actorRole: payload.actorRole,
    note: payload.note,
  });

  sendJson(response, 200, {
    data: result.report,
    historyEntry: result.historyEntry,
  });
}

export async function handleReportStatusHistory(_request, response, reportId) {
  const report = findReportById(reportId);
  if (!report) {
    sendJson(response, 404, { error: "No encontre el reporte solicitado." });
    return;
  }

  sendJson(response, 200, { data: listReportStatusHistory(reportId) });
}

export async function handleAnalyticsConfig(_request, response) {
  sendJson(response, 200, { data: buildAnalyticsConfig() });
}

export async function handleAnalyticsOverview(_request, response, url) {
  const filters = parseFilters(url);
  const visibleReports = queryReports(filters);
  const overview = buildAnalyticsOverview({
    programs: listPrograms(),
    indicators: listIndicators(),
    reports: visibleReports,
    filters,
    scope: filters.scope,
  });

  sendJson(response, 200, { data: overview, filters });
}

function apiIndex() {
  return {
    name: "Sistema de MEL API",
    version: "v1",
    resources: [
      "programs",
      "reports",
      "analytics/config",
      "analytics/overview",
      "reports/:id/status",
      "reports/:id/status-history",
    ],
  };
}

async function router(request, response) {
  if (request.method === "OPTIONS") {
    sendEmpty(response);
    return;
  }

  const url = new URL(request.url || "/", "http://localhost");
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "sistema-de-mel-api" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1") {
    sendJson(response, 200, apiIndex());
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/programs") {
    await handlePrograms(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/reports") {
    await handleReportsList(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/reports") {
    await handleReportCreate(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/reports/bulk") {
    await handleReportBulkCreate(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/analytics/config") {
    await handleAnalyticsConfig(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/analytics/overview") {
    await handleAnalyticsOverview(request, response, url);
    return;
  }

  const historyMatch = pathname.match(/^\/api\/v1\/reports\/([^/]+)\/status-history$/);
  if (request.method === "GET" && historyMatch) {
    await handleReportStatusHistory(request, response, decodeURIComponent(historyMatch[1]));
    return;
  }

  const statusMatch = pathname.match(/^\/api\/v1\/reports\/([^/]+)\/status$/);
  if (request.method === "PATCH" && statusMatch) {
    await handleReportStatusUpdate(request, response, decodeURIComponent(statusMatch[1]));
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
}

export function startServer(port = PORT) {
  const server = http.createServer((request, response) => {
    router(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, { error: "Ocurrio un error interno en la API." });
    });
  });

  if (process.env.MEL_DISABLE_LISTEN !== "1") {
    server.listen(port, () => {
      console.log(`Sistema de MEL API listening on http://localhost:${port}`);
    });
  }

  return server;
}

startServer();
