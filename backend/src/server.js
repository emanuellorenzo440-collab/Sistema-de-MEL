import http from "node:http";
import {
  createIndicator,
  createProgram,
  createReport,
  createReportsBulk,
  deleteIndicator,
  deleteProgram,
  findReportById,
  listEmailOutbox,
  listIndicators,
  listNotifications,
  listPrograms,
  listReportStatusHistory,
  markNotificationRead,
  queryReports,
  saveReportStatusDecision,
  updateIndicator,
  updateProgram,
} from "./data/mock-store.js";
import {
  completeRequiredPasswordChange,
  createManagedAuthUser,
  deleteManagedAuthUser,
  listAuthUsers,
  signInAuthUser,
  updateManagedAuthUser,
} from "./data/auth-store.js";
import { resolveAnalyticsScope, validateReportStatusChange } from "./domain/reporting-rules.js";
import { buildAnalyticsConfig, buildAnalyticsOverview } from "./services/analytics-service.js";

const PORT = Number(process.env.PORT || 8080);
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-mel-actor-id",
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

function sendApiError(response, error) {
  sendJson(response, error.status || 500, { error: error.message || "Error interno del servidor." });
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

export async function handleProgramCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del programa no es JSON valido." });
    return;
  }

  const required = requireFields(payload, ["name", "lead"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }

  const program = createProgram(payload);
  sendJson(response, 201, { data: program });
}

export async function handleProgramUpdate(request, response, programId) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del programa no es JSON valido." });
    return;
  }

  const program = updateProgram(programId, payload);
  if (!program) {
    sendJson(response, 404, { error: "No encontre el programa solicitado." });
    return;
  }

  sendJson(response, 200, { data: program });
}

export async function handleProgramDelete(_request, response, programId) {
  const result = deleteProgram(programId);
  if (!result) {
    sendJson(response, 404, { error: "No encontre el programa solicitado." });
    return;
  }

  if (result.blocked) {
    sendJson(response, 409, {
      error: "No se puede eliminar un programa con indicadores o reportes asociados.",
      details: result,
    });
    return;
  }

  sendEmpty(response);
}

export async function handleIndicators(_request, response, url) {
  const programId = url.searchParams.get("programId");
  const program = url.searchParams.get("program");
  const data = listIndicators().filter((indicator) => {
    if (programId && indicator.programId !== programId) return false;
    if (program && indicator.program !== program) return false;
    return true;
  });
  sendJson(response, 200, { data });
}

export async function handleIndicatorCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del indicador no es JSON valido." });
    return;
  }

  const required = requireFields(payload, ["name", "program", "target"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }

  const indicator = createIndicator(payload);
  sendJson(response, 201, { data: indicator });
}

export async function handleIndicatorUpdate(request, response, indicatorId) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del indicador no es JSON valido." });
    return;
  }

  const indicator = updateIndicator(indicatorId, payload);
  if (!indicator) {
    sendJson(response, 404, { error: "No encontre el indicador solicitado." });
    return;
  }

  sendJson(response, 200, { data: indicator });
}

export async function handleIndicatorDelete(_request, response, indicatorId) {
  const result = deleteIndicator(indicatorId);
  if (!result) {
    sendJson(response, 404, { error: "No encontre el indicador solicitado." });
    return;
  }

  if (result.blocked) {
    sendJson(response, 409, {
      error: "No se puede eliminar un indicador con reportes asociados.",
      details: result,
    });
    return;
  }

  sendEmpty(response);
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

export async function handleNotificationsList(_request, response, url) {
  const filters = {
    companyId: url.searchParams.get("companyId") || undefined,
    programId: url.searchParams.get("programId") || undefined,
    reportId: url.searchParams.get("reportId") || undefined,
    recipientRole: url.searchParams.get("recipientRole") || undefined,
    status: url.searchParams.get("status") || undefined,
  };
  sendJson(response, 200, { data: listNotifications(filters), filters });
}

export async function handleNotificationRead(request, response, notificationId) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo de la alerta no es JSON valido." });
    return;
  }

  const notification = markNotificationRead(notificationId, payload.actorId || null);
  if (!notification) {
    sendJson(response, 404, { error: "No encontre la alerta solicitada." });
    return;
  }

  sendJson(response, 200, { data: notification });
}

export async function handleEmailOutboxList(_request, response, url) {
  const filters = {
    companyId: url.searchParams.get("companyId") || undefined,
    programId: url.searchParams.get("programId") || undefined,
    reportId: url.searchParams.get("reportId") || undefined,
    status: url.searchParams.get("status") || undefined,
  };
  sendJson(response, 200, { data: listEmailOutbox(filters), filters });
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
    followUpNotifications: result.followUpNotifications || [],
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
      "indicators",
      "reports",
      "notifications",
      "email-outbox",
      "analytics/config",
      "analytics/overview",
      "auth/sign-in",
      "auth/complete-password-change",
      "auth/users",
      "reports/:id/status",
      "reports/:id/status-history",
    ],
  };
}

function actorIdFrom(request, payload = {}) {
  return request.headers["x-mel-actor-id"] || payload.actorId || null;
}

export async function handleAuthSignIn(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, signInAuthUser(payload));
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthPasswordChange(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { user: completeRequiredPasswordChange(payload) });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthUsersList(_request, response) {
  sendJson(response, 200, { users: listAuthUsers() });
}

export async function handleAuthUserCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 201, { user: createManagedAuthUser(payload, actorIdFrom(request, payload)) });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthUserUpdate(request, response, userId) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, {
      user: updateManagedAuthUser(userId, payload, actorIdFrom(request, payload)),
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthUserDelete(request, response, userId) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, deleteManagedAuthUser(userId, actorIdFrom(request, payload)));
  } catch (error) {
    sendApiError(response, error);
  }
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

  if (request.method === "POST" && pathname === "/api/v1/auth/sign-in") {
    await handleAuthSignIn(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/auth/complete-password-change") {
    await handleAuthPasswordChange(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/auth/users") {
    await handleAuthUsersList(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/auth/users") {
    await handleAuthUserCreate(request, response);
    return;
  }

  const authUserMatch = pathname.match(/^\/api\/v1\/auth\/users\/([^/]+)$/);
  if (request.method === "PUT" && authUserMatch) {
    await handleAuthUserUpdate(request, response, decodeURIComponent(authUserMatch[1]));
    return;
  }

  if (request.method === "DELETE" && authUserMatch) {
    await handleAuthUserDelete(request, response, decodeURIComponent(authUserMatch[1]));
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/programs") {
    await handlePrograms(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/programs") {
    await handleProgramCreate(request, response, url);
    return;
  }

  const programMatch = pathname.match(/^\/api\/v1\/programs\/([^/]+)$/);
  if (request.method === "PUT" && programMatch) {
    await handleProgramUpdate(request, response, decodeURIComponent(programMatch[1]));
    return;
  }

  if (request.method === "DELETE" && programMatch) {
    await handleProgramDelete(request, response, decodeURIComponent(programMatch[1]));
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/indicators") {
    await handleIndicators(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/indicators") {
    await handleIndicatorCreate(request, response, url);
    return;
  }

  const indicatorMatch = pathname.match(/^\/api\/v1\/indicators\/([^/]+)$/);
  if (request.method === "PUT" && indicatorMatch) {
    await handleIndicatorUpdate(request, response, decodeURIComponent(indicatorMatch[1]));
    return;
  }

  if (request.method === "DELETE" && indicatorMatch) {
    await handleIndicatorDelete(request, response, decodeURIComponent(indicatorMatch[1]));
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

  if (request.method === "GET" && pathname === "/api/v1/notifications") {
    await handleNotificationsList(request, response, url);
    return;
  }

  const notificationReadMatch = pathname.match(/^\/api\/v1\/notifications\/([^/]+)\/read$/);
  if (request.method === "PATCH" && notificationReadMatch) {
    await handleNotificationRead(request, response, decodeURIComponent(notificationReadMatch[1]));
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/email-outbox") {
    await handleEmailOutboxList(request, response, url);
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
