import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConceptPaper,
  createAttendanceParticipant,
  createIndicator,
  createProgram,
  createProgramCenter,
  createReport,
  createReportsBulk,
  deleteAttendanceParticipant,
  deleteAttendanceParticipantsForProgram,
  deleteAttendanceSession,
  deleteCorrectableReport,
  deleteIndicator,
  deleteProgram,
  deleteProgramCenter,
  findReportById,
  listAttendanceArchive,
  listAttendanceParticipants,
  listAttendanceSessions,
  listConceptPapers,
  listEmailOutbox,
  listIndicators,
  listNotifications,
  listPrograms,
  listProgramCenters,
  listDeletedReports,
  listReportStatusHistory,
  markNotificationRead,
  queryReports,
  resetAttendanceProgram,
  saveAttendanceSession,
  saveReportStatusDecision,
  updateIndicator,
  updateProgram,
  updateProgramCenter,
} from "./data/mock-store.js";
import {
  completeRequiredPasswordChange,
  createManagedAuthUser,
  deleteManagedAuthUser,
  listAuthUsers,
  requestPasswordResetLink,
  resetPasswordWithToken,
  signInAuthUser,
  updateManagedAuthUser,
} from "./data/auth-store.js";
import { resolveAnalyticsScope, validateReportStatusChange } from "./domain/reporting-rules.js";
import { buildAnalyticsConfig, buildAnalyticsOverview } from "./services/analytics-service.js";

const PORT = Number(process.env.PORT || 8080);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(dirname, "..", "..", "frontend");
const sharedDir = path.resolve(dirname, "..", "..", "shared");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};
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

function sendStaticFile(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Metodo no permitido." });
    return;
  }

  const url = new URL(request.url || "/", "http://localhost");
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const staticRoot = requestedPath.startsWith("/shared/") ? sharedDir : frontendDir;
  const relativePath = requestedPath.startsWith("/shared/")
    ? requestedPath.replace(/^\/shared\//, "")
    : requestedPath.replace(/^\//, "");
  const filePath = path.resolve(staticRoot, relativePath || "index.html");
  const safePath = filePath.startsWith(staticRoot) ? filePath : path.join(frontendDir, "index.html");
  const finalPath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
    ? safePath
    : path.join(frontendDir, "index.html");
  const extension = path.extname(finalPath).toLowerCase();

  response.writeHead(200, {
    "content-type": MIME_TYPES[extension] || "application/octet-stream",
    "cache-control": extension === ".html" ? "no-store" : "public, max-age=300",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(finalPath).pipe(response);
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
    center: url.searchParams.get("center") || undefined,
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

function requireActorRole(response, payload = {}, allowedRoles = [], action = "realizar esta accion") {
  const actorRole = String(payload.actorRole || "").trim();
  if (allowedRoles.includes(actorRole)) return true;
  sendJson(response, 403, {
    error: `No tienes permiso para ${action}.`,
    details: { actorRole: actorRole || null, allowedRoles },
  });
  return false;
}

async function readOptionalJsonBody(request) {
  try {
    return await readJsonBody(request);
  } catch {
    return {};
  }
}

function filterReportsByScope(reports, scope) {
  if (scope === "all") return reports;
  return reports.filter((report) => report.status === "Aprobado");
}

export async function handlePrograms(_request, response) {
  sendJson(response, 200, { data: listPrograms() });
}

export async function handleProgramCenters(_request, response, url) {
  const filters = {
    program: url.searchParams.get("program") || undefined,
    province: url.searchParams.get("province") || undefined,
  };
  sendJson(response, 200, { data: listProgramCenters(filters), filters });
}

export async function handleProgramCenterCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del centro no es JSON valido." });
    return;
  }

  const required = requireFields(payload, ["program", "province", "name"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }
  if (!requireActorRole(response, payload, ["Supervision M&E", "Coordinador de programa"], "crear centros")) return;

  sendJson(response, 201, { data: createProgramCenter(payload) });
}

export async function handleProgramCenterUpdate(request, response, centerId) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del centro no es JSON valido." });
    return;
  }
  if (!requireActorRole(response, payload, ["Supervision M&E", "Coordinador de programa"], "editar centros")) return;

  const center = updateProgramCenter(centerId, payload);
  if (!center) {
    sendJson(response, 404, { error: "No encontre el centro solicitado." });
    return;
  }
  sendJson(response, 200, { data: center });
}

export async function handleProgramCenterDelete(request, response, centerId) {
  const payload = await readOptionalJsonBody(request);
  if (!requireActorRole(response, payload, ["Supervision M&E", "Coordinador de programa"], "eliminar centros")) return;
  if (!deleteProgramCenter(centerId)) {
    sendJson(response, 404, { error: "No encontre el centro solicitado." });
    return;
  }
  sendEmpty(response);
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
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager"], "crear programas")) return;

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
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager"], "editar programas")) return;

  const program = updateProgram(programId, payload);
  if (!program) {
    sendJson(response, 404, { error: "No encontre el programa solicitado." });
    return;
  }

  sendJson(response, 200, { data: program });
}

export async function handleProgramDelete(request, response, programId) {
  const payload = await readOptionalJsonBody(request);
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager"], "eliminar programas")) return;
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
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager", "Coordinador de programa"], "crear indicadores")) return;

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
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager", "Coordinador de programa"], "editar indicadores")) return;

  const indicator = updateIndicator(indicatorId, payload);
  if (!indicator) {
    sendJson(response, 404, { error: "No encontre el indicador solicitado." });
    return;
  }

  sendJson(response, 200, { data: indicator });
}

export async function handleIndicatorDelete(request, response, indicatorId) {
  const payload = await readOptionalJsonBody(request);
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager"], "eliminar indicadores")) return;
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

export async function handleConceptPapers(_request, response, url) {
  const filters = {
    program: url.searchParams.get("program") || undefined,
    year: url.searchParams.get("year") || undefined,
    status: url.searchParams.get("status") || undefined,
  };
  sendJson(response, 200, { data: listConceptPapers(filters), filters });
}

export async function handleConceptPaperCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del Concept Paper no es JSON valido." });
    return;
  }

  const missing = ["program", "title", "fileName"].filter((field) => !String(payload[field] || "").trim());
  if (!payload.dataUrl && !payload.path) {
    missing.push("dataUrl");
  }
  if (missing.length) {
    sendJson(response, 400, {
      error: "Faltan campos obligatorios para registrar el Concept Paper.",
      details: { missing },
    });
    return;
  }
  if (!requireActorRole(response, payload, ["Supervision M&E", "Program Manager", "Coordinador de programa"], "cargar Concept Papers")) return;

  const conceptPaper = createConceptPaper(payload);
  sendJson(response, 201, { data: conceptPaper });
}

export async function handleAttendanceParticipants(_request, response, url) {
  const filters = {
    program: url.searchParams.get("program") || undefined,
    status: url.searchParams.get("status") || undefined,
  };
  sendJson(response, 200, { data: listAttendanceParticipants(filters), filters });
}

export async function handleAttendanceArchive(_request, response, url) {
  const filters = {
    program: url.searchParams.get("program") || undefined,
    type: url.searchParams.get("type") || undefined,
  };
  sendJson(response, 200, { data: listAttendanceArchive(filters), filters });
}

export async function handleAttendanceParticipantCreate(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del participante no es JSON valido." });
    return;
  }

  const required = requireFields(payload, ["program", "name"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }

  const participant = createAttendanceParticipant(payload);
  sendJson(response, 201, { data: participant });
}

export async function handleAttendanceParticipantDelete(request, response, url) {
  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch {
    payload = {};
  }
  const participantId = decodeURIComponent(url.pathname.split("/").pop() || "");
  try {
    const deleted = deleteAttendanceParticipant(participantId, {
      actorId: payload.actorId,
      actorRole: payload.actorRole,
      reason: payload.reason,
    });
    if (!deleted) {
      sendJson(response, 404, { error: "No encontre ese participante." });
      return;
    }
    sendJson(response, 200, { data: deleted });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceParticipantsDelete(request, response, url) {
  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch {
    payload = {};
  }
  const program = url.searchParams.get("program") || payload.program;
  if (!program) {
    sendJson(response, 400, { error: "Indica el programa para eliminar los participantes." });
    return;
  }
  try {
    const result = deleteAttendanceParticipantsForProgram(program, {
      actorId: payload.actorId,
      actorRole: payload.actorRole,
      reason: payload.reason,
    });
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceProgramReset(request, response, url) {
  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch {
    payload = {};
  }
  const program = url.searchParams.get("program") || payload.program;
  if (!program) {
    sendJson(response, 400, { error: "Indica el programa para reiniciar la asistencia." });
    return;
  }
  try {
    const result = resetAttendanceProgram(program, {
      actorId: payload.actorId,
      actorRole: payload.actorRole,
      reason: payload.reason,
    });
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceSessions(_request, response, url) {
  const filters = {
    program: url.searchParams.get("program") || undefined,
    weekStart: url.searchParams.get("weekStart") || undefined,
    center: url.searchParams.get("center") || undefined,
    period: url.searchParams.get("period") || undefined,
  };
  sendJson(response, 200, { data: listAttendanceSessions(filters), filters });
}

export async function handleAttendanceSessionSave(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo de asistencia no es JSON valido." });
    return;
  }

  const required = requireFields(payload, ["program", "weekStart"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }

  try {
    const session = saveAttendanceSession(payload);
    sendJson(response, 200, { data: session });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceSessionDelete(request, response, url) {
  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch {
    payload = {};
  }
  const filters = {
    program: url.searchParams.get("program") || payload.program,
    weekStart: url.searchParams.get("weekStart") || payload.weekStart,
    center: url.searchParams.get("center") || payload.center,
    period: url.searchParams.get("period") || payload.period,
  };
  const required = requireFields(filters, ["program", "weekStart"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }
  try {
    const deleted = deleteAttendanceSession(filters, {
      actorId: payload.actorId,
      actorRole: payload.actorRole,
      reason: payload.reason,
    });
    if (!deleted) {
      sendJson(response, 404, { error: "No encontre esa sesion de asistencia." });
      return;
    }
    sendJson(response, 200, { data: deleted });
  } catch (error) {
    sendApiError(response, error);
  }
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

export async function handleReportDelete(request, response, reportId) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "La solicitud de eliminacion no es JSON valido." });
    return;
  }

  try {
    const deletedReport = deleteCorrectableReport(reportId, {
      actorId: payload.actorId || null,
      actorRole: payload.actorRole || null,
      note: payload.note || null,
    });
    if (!deletedReport) {
      sendJson(response, 404, { error: "No encontre el reporte solicitado." });
      return;
    }
    sendJson(response, 200, { data: deletedReport });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "No pude eliminar el reporte." });
  }
}

export async function handleDeletedReportsList(_request, response, url) {
  const filters = parseFilters(url);
  sendJson(response, 200, { data: listDeletedReports(filters), filters });
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
  const history = listReportStatusHistory(reportId);
  if (!report && !history.length) {
    sendJson(response, 404, { error: "No encontre el reporte solicitado." });
    return;
  }

  sendJson(response, 200, { data: history });
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
      "program-centers",
      "indicators",
      "concept-papers",
      "attendance/participants",
      "attendance/sessions",
      "attendance/archive",
      "reports",
      "reports/deleted",
      "notifications",
      "email-outbox",
      "analytics/config",
      "analytics/overview",
      "auth/sign-in",
      "auth/request-password-reset",
      "auth/reset-password",
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

function publicBaseUrlFrom(request, payload = {}) {
  if (payload.resetBaseUrl) {
    return String(payload.resetBaseUrl);
  }
  const host = request.headers["x-forwarded-host"] || request.headers.host || "localhost";
  const protocol = request.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return `${protocol}://${host}/`;
}

async function deliverAuthEmail(emailRecord) {
  const apiKey = process.env.RESEND_API_KEY || process.env.MEL_RESEND_API_KEY;
  const from = process.env.MEL_EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !emailRecord?.toEmail) {
    return { delivery: "email-outbox" };
  }

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [emailRecord.toEmail],
        subject: emailRecord.subject,
        text: emailRecord.body,
      }),
    });
    if (!resendResponse.ok) {
      const errorText = await resendResponse.text().catch(() => "");
      console.error("No pude enviar correo transaccional:", errorText || resendResponse.statusText);
      return { delivery: "email-outbox" };
    }
    return { delivery: "email" };
  } catch (error) {
    console.error("No pude enviar correo transaccional:", error);
    return { delivery: "email-outbox" };
  }
}

export async function handleAuthSignIn(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, signInAuthUser(payload));
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthPasswordResetRequest(request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = requestPasswordResetLink({ ...payload, resetBaseUrl: publicBaseUrlFrom(request, payload) });
    const delivery = await deliverAuthEmail(result.emailRecord);
    const { emailRecord, ...publicResult } = result;
    const responsePayload = { ...publicResult, ...delivery };
    if (delivery.delivery === "email") {
      delete responsePayload.previewLink;
    }
    sendJson(response, 200, responsePayload);
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthPasswordResetComplete(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { user: resetPasswordWithToken(payload) });
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

  if (request.method === "POST" && pathname === "/api/v1/auth/request-password-reset") {
    await handleAuthPasswordResetRequest(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/auth/reset-password") {
    await handleAuthPasswordResetComplete(request, response);
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

  if (request.method === "GET" && pathname === "/api/v1/program-centers") {
    await handleProgramCenters(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/program-centers") {
    await handleProgramCenterCreate(request, response, url);
    return;
  }

  const programCenterMatch = pathname.match(/^\/api\/v1\/program-centers\/([^/]+)$/);
  if (request.method === "PUT" && programCenterMatch) {
    await handleProgramCenterUpdate(request, response, decodeURIComponent(programCenterMatch[1]));
    return;
  }

  if (request.method === "DELETE" && programCenterMatch) {
    await handleProgramCenterDelete(request, response, decodeURIComponent(programCenterMatch[1]));
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

  if (request.method === "GET" && pathname === "/api/v1/concept-papers") {
    await handleConceptPapers(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/concept-papers") {
    await handleConceptPaperCreate(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/attendance/participants") {
    await handleAttendanceParticipants(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/attendance/archive") {
    await handleAttendanceArchive(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/attendance/participants") {
    await handleAttendanceParticipantCreate(request, response, url);
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/v1/attendance/reset") {
    await handleAttendanceProgramReset(request, response, url);
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/v1/attendance/participants") {
    await handleAttendanceParticipantsDelete(request, response, url);
    return;
  }

  if (request.method === "DELETE" && pathname.startsWith("/api/v1/attendance/participants/")) {
    await handleAttendanceParticipantDelete(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/attendance/sessions") {
    await handleAttendanceSessions(request, response, url);
    return;
  }

  if (request.method === "PUT" && pathname === "/api/v1/attendance/sessions") {
    await handleAttendanceSessionSave(request, response, url);
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/v1/attendance/sessions") {
    await handleAttendanceSessionDelete(request, response, url);
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

  if (request.method === "GET" && pathname === "/api/v1/reports/deleted") {
    await handleDeletedReportsList(request, response, url);
    return;
  }

  const reportMatch = pathname.match(/^\/api\/v1\/reports\/([^/]+)$/);
  if (request.method === "DELETE" && reportMatch) {
    await handleReportDelete(request, response, decodeURIComponent(reportMatch[1]));
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

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Route not found" });
    return;
  }

  sendStaticFile(request, response);
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
