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
  createProgramManual,
  createReport,
  createChatConversation,
  createChatMessage,
  createReportsBulk,
  createFormSubmission,
  addChatParticipants,
  archiveChatConversation,
  getChatConversationPresence,
  updateChatMessage,
  deleteAttendanceParticipant,
  deleteAttendanceParticipantsForProgram,
  deleteAttendanceSession,
  deleteConceptPaper,
  deleteCorrectableReport,
  deleteIndicator,
  deleteProgram,
  deleteProgramCenter,
  deleteProgramManual,
  findChatConversationById,
  findConceptPaperById,
  findProgramManualById,
  findReportById,
  getChatUnreadCount,
  isLibraryDocumentPathDeleted,
  listAttendanceArchive,
  listAttendanceParticipants,
  listAttendanceSessions,
  listChatConversations,
  listChatMessages,
  listChatParticipants,
  listConceptPapers,
  listEmailOutbox,
  listFormSubmissions,
  listIndicators,
  listNotifications,
  listPrograms,
  listProgramCenters,
  listProgramManuals,
  listAllReportStatusHistory,
  listDeletedReports,
  listPlatformActivity,
  listReportStatusHistory,
  heartbeatChatPresence,
  markChatConversationRead,
  markNotificationRead,
  queryReports,
  removeChatParticipant,
  resetAttendanceProgram,
  saveAttendanceSession,
  searchChat,
  setChatConversationTyping,
  saveReportStatusDecision,
  updateChatParticipant,
  updateChatConversation,
  updateIndicator,
  updateProgram,
  updateProgramCenter,
} from "./data/mock-store.js";
import {
  completeRequiredPasswordChange,
  createOrganization,
  createManagedAuthUser,
  deleteManagedAuthUser,
  getCurrentOrganization,
  getOrganizationBranding,
  listOrganizations,
  listAuditLog,
  listAuthUsers,
  requestPasswordResetLink,
  restoreAuthSession,
  resetPasswordWithToken,
  signOutAuthSession,
  signInAuthUser,
  updateOrganization,
  updateOwnAuthUserPreferences,
  updateManagedAuthUser,
} from "./data/auth-store.js";
import { resolveAnalyticsScope, validateReportStatusChange } from "./domain/reporting-rules.js";
import { buildAnalyticsConfig, buildAnalyticsOverview, buildPowerBiDataset } from "./services/analytics-service.js";

const PORT = Number(process.env.PORT || 8080);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(dirname, "..", "..", "frontend");
const sharedDir = path.resolve(dirname, "..", "..", "shared");
const defaultDataDir = path.resolve(dirname, "..", "..", "data");
const dataDir = process.env.MEL_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || defaultDataDir;
const uploadsDir = process.env.MEL_UPLOAD_DIR || path.join(dataDir, "uploads");
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
  "access-control-allow-headers": "content-type,x-mel-actor-id,x-mel-session-token",
};
const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = 12 * 1024 * 1024;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

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

function sendBinary(response, status, buffer, options = {}) {
  response.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": options.contentType || "application/octet-stream",
    "content-length": buffer.length,
    "content-disposition": `${options.disposition || "inline"}; filename="${String(options.fileName || "documento").replaceAll('"', "")}"`,
    "cache-control": "private, max-age=300",
  });
  response.end(buffer);
}

function sendStoredUpload(response, storagePath, options = {}) {
  const absolutePath = resolveUploadPath(storagePath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    sendJson(response, 404, { error: "No encontre el archivo solicitado." });
    return;
  }

  const stat = fs.statSync(absolutePath);
  response.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": options.contentType || "application/octet-stream",
    "content-length": stat.size,
    "content-disposition": `${options.disposition || "inline"}; filename="${String(options.fileName || path.basename(absolutePath)).replaceAll('"', "")}"`,
    "cache-control": "private, max-age=300",
  });
  fs.createReadStream(absolutePath).pipe(response);
}

const PDF_WIN_ANSI_MAP = {
  Á: "\\301",
  É: "\\311",
  Í: "\\315",
  Ñ: "\\321",
  Ó: "\\323",
  Ú: "\\332",
  Ü: "\\334",
  á: "\\341",
  é: "\\351",
  í: "\\355",
  ñ: "\\361",
  ó: "\\363",
  ú: "\\372",
  ü: "\\374",
  "¿": "\\277",
  "¡": "\\241",
};

function pdfEscape(value = "") {
  return Array.from(String(value || ""))
    .map((character) => {
      if (character === "\\") return "\\\\";
      if (character === "(") return "\\(";
      if (character === ")") return "\\)";
      if (PDF_WIN_ANSI_MAP[character]) return PDF_WIN_ANSI_MAP[character];
      const codePoint = character.codePointAt(0);
      if (codePoint >= 0x20 && codePoint <= 0x7e) return character;
      return String(character)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, "");
    })
    .join("");
}

function wrapText(value = "", maxLength = 92) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function conceptPaperFallbackLines(paper = {}) {
  const listLines = (label, values = []) => {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return [];
    return [label, ...items.flatMap((item) => wrapText(`- ${item}`, 88))];
  };

  return [
    paper.title || "Concept Paper",
    `Programa: ${paper.program || "No definido"}`,
    `Año: ${paper.year || "No definido"}`,
    `Presentador: ${paper.presenter || paper.uploadedBy || "Equipo M&E"}`,
    `Archivo registrado: ${paper.fileName || "Sin archivo fisico disponible"}`,
    "",
    "Objetivo",
    ...wrapText(paper.objective || "Pendiente de completar.", 88),
    "",
    `Beneficiarios: ${paper.beneficiaries || "Pendiente"}`,
    `Presupuesto: ${paper.budget || "Pendiente"}`,
    "",
    ...listLines("Metodología", paper.methodology),
    "",
    ...listLines("Impacto esperado", paper.expectedImpact),
    "",
    ...listLines("Resultados medibles", paper.measurableResults),
    "",
    ...listLines("Indicadores de logro", paper.achievementIndicators),
  ].filter((line, index, lines) => !(line === "" && lines[index - 1] === ""));
}

function simplePdfBuffer(lines = []) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginX = 56;
  const firstY = 736;
  const lineHeight = 14;
  const pages = [];
  let current = [];
  let y = firstY;

  lines.forEach((line) => {
    const wrappedLines = wrapText(line, line === lines[0] ? 70 : 92);
    wrappedLines.forEach((wrappedLine) => {
      if (y < 64) {
        pages.push(current);
        current = [];
        y = firstY;
      }
      const isTitle = pages.length === 0 && current.length === 0;
      current.push({ text: wrappedLine, y, size: isTitle ? 18 : 10, bold: isTitle });
      y -= line === "" ? lineHeight / 2 : lineHeight;
    });
  });
  if (current.length) pages.push(current);

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  pages.forEach((pageLines, index) => {
    const pageNumber = 3 + index * 2;
    const contentNumber = pageNumber + 1;
    const content = [
      "BT",
      ...pageLines.map((line) => `/F1 ${line.size} Tf 1 0 0 1 ${marginX} ${line.y} Tm (${pdfEscape(line.text)}) Tj`),
      "ET",
    ].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(chunks.join(""), "utf8"));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = Buffer.byteLength(chunks.join(""), "utf8");
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(""), "utf8");
}

function sendConceptPaperFallbackPdf(response, paper) {
  const buffer = simplePdfBuffer(conceptPaperFallbackLines(paper));
  sendBinary(response, 200, buffer, {
    contentType: "application/pdf",
    fileName: paper.fileName || `${paper.title || "concept-paper"}.pdf`,
    disposition: "inline",
  });
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
  if (isLibraryDocumentPathDeleted(relativePath)) {
    sendJson(response, 404, { error: "Este documento fue eliminado de la biblioteca." });
    return;
  }
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
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      const error = new Error("BODY_TOO_LARGE");
      error.status = 413;
      throw error;
    }
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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isValidEmail(value = "") {
  return EMAIL_REGEX.test(String(value || "").trim());
}

function validateOptionalEmail(value = "", label = "correo") {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (isValidEmail(normalized)) return null;
  return {
    error: `${label} no es valido.`,
    details: { field: label },
  };
}

function validateProgramPayload(payload = {}, { requireCoreFields = false } = {}) {
  if ((requireCoreFields || hasOwn(payload, "name")) && !String(payload.name || "").trim()) {
    return { error: "Debes indicar el nombre del programa.", details: { field: "name" } };
  }
  if ((requireCoreFields || hasOwn(payload, "lead")) && !String(payload.lead || "").trim()) {
    return { error: "Debes indicar el lider del programa.", details: { field: "lead" } };
  }
  if ((requireCoreFields || hasOwn(payload, "focus")) && !String(payload.focus || "").trim()) {
    return { error: "Debes completar el enfoque del programa.", details: { field: "focus" } };
  }
  if ((requireCoreFields || hasOwn(payload, "provinces")) && (!Array.isArray(payload.provinces) || !payload.provinces.some((item) => String(item || "").trim()))) {
    return { error: "Debes seleccionar al menos una provincia.", details: { field: "provinces" } };
  }
  if (hasOwn(payload, "beneficiaries")) {
    const beneficiaries = Number(payload.beneficiaries);
    if (!Number.isFinite(beneficiaries) || beneficiaries < 0) {
      return { error: "La meta de beneficiarios debe ser un numero igual o mayor que cero.", details: { field: "beneficiaries" } };
    }
  }
  return (
    validateOptionalEmail(payload.coordinatorEmail, "El correo de coordinacion") ||
    validateOptionalEmail(payload.programManagerEmail, "El correo de Program Manager") ||
    validateOptionalEmail(payload.melSupervisorEmail, "El correo de Supervision M&E")
  );
}

function validateProgramCenterPayload(payload = {}, { requireCoreFields = false } = {}) {
  if ((requireCoreFields || hasOwn(payload, "program")) && !String(payload.program || "").trim()) {
    return { error: "Debes indicar el programa del centro.", details: { field: "program" } };
  }
  if ((requireCoreFields || hasOwn(payload, "province")) && !String(payload.province || "").trim()) {
    return { error: "Debes indicar la provincia del centro.", details: { field: "province" } };
  }
  if ((requireCoreFields || hasOwn(payload, "name")) && !String(payload.name || "").trim()) {
    return { error: "Debes indicar el nombre del centro.", details: { field: "name" } };
  }
  return null;
}

function validateReportPayload(payload = {}, { requireCoreFields = false } = {}) {
  if ((requireCoreFields || hasOwn(payload, "program")) && !String(payload.program || "").trim()) {
    return { error: "Debes indicar el programa del reporte.", details: { field: "program" } };
  }
  if ((requireCoreFields || hasOwn(payload, "indicatorId")) && !String(payload.indicatorId || "").trim()) {
    return { error: "Debes indicar el indicador del reporte.", details: { field: "indicatorId" } };
  }
  if ((requireCoreFields || hasOwn(payload, "owner")) && !String(payload.owner || "").trim()) {
    return { error: "Debes indicar la persona responsable del reporte.", details: { field: "owner" } };
  }
  if ((requireCoreFields || hasOwn(payload, "period")) && !PERIOD_REGEX.test(String(payload.period || "").trim())) {
    return { error: "El periodo del reporte debe tener formato YYYY-MM.", details: { field: "period" } };
  }
  if ((requireCoreFields || hasOwn(payload, "province")) && !String(payload.province || "").trim()) {
    return { error: "Debes indicar la provincia del reporte.", details: { field: "province" } };
  }
  if ((requireCoreFields || hasOwn(payload, "center")) && !String(payload.center || "").trim()) {
    return { error: "Debes indicar el centro del reporte.", details: { field: "center" } };
  }
  if ((requireCoreFields || hasOwn(payload, "value"))) {
    const numericValue = Number(payload.value);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return { error: "El valor del reporte debe ser un numero igual o mayor que cero.", details: { field: "value" } };
    }
  }
  return null;
}

function safeFileName(value = "archivo") {
  const baseName = path.basename(String(value || "archivo")).replace(/[^\w.\- ]+/g, "-").trim();
  return baseName || "archivo";
}

function safeSegment(value = "general") {
  return String(value || "general")
    .trim()
    .toLowerCase()
    .replace(/[^\w.\-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
}

function uploadStoragePath(kind = "general", fileName = "archivo", organizationId = "shared") {
  const date = new Date();
  const folder = [
    "organizations",
    safeSegment(organizationId),
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    safeSegment(kind),
  ].join("/");
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `${folder}/${id}-${safeFileName(fileName)}`;
}

function resolveUploadPath(storagePath = "") {
  const normalizedPath = String(storagePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = path.resolve(uploadsDir, normalizedPath);
  const root = path.resolve(uploadsDir);
  if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
    return null;
  }
  return absolutePath;
}

async function streamRequestToUpload(request, { kind = "general", fileName = "archivo", organizationId = "shared" } = {}) {
  const storagePath = uploadStoragePath(kind, fileName, organizationId);
  const absolutePath = resolveUploadPath(storagePath);
  if (!absolutePath) {
    const error = new Error("Ruta de archivo invalida.");
    error.status = 400;
    throw error;
  }

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  const stream = fs.createWriteStream(absolutePath, { flags: "wx" });
  let totalBytes = 0;

  try {
    for await (const chunk of request) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_FILE_BYTES) {
        const error = new Error(`El archivo supera ${formatFileSize(MAX_UPLOAD_FILE_BYTES)}.`);
        error.status = 413;
        throw error;
      }
      if (!stream.write(chunk)) {
        await new Promise((resolve, reject) => {
          stream.once("drain", resolve);
          stream.once("error", reject);
        });
      }
    }
    await new Promise((resolve, reject) => {
      stream.end(resolve);
      stream.once("error", reject);
    });
  } catch (error) {
    stream.destroy();
    await fs.promises.rm(absolutePath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    path: storagePath,
    fileName: safeFileName(fileName),
    mimeType: request.headers["content-type"] || "application/octet-stream",
    size: totalBytes,
  };
}

function uploadPathOrganizationId(storagePath = "") {
  const normalizedPath = String(storagePath || "").replace(/\\/g, "/");
  const match = normalizedPath.match(/^organizations\/([^/]+)\//i);
  return match ? String(match[1] || "").trim().toLowerCase() : "";
}

function canAccessUploadPath(actor, storagePath = "") {
  if (!actor?.organizationId) return false;
  const scopedOrganizationId = uploadPathOrganizationId(storagePath);
  if (scopedOrganizationId) {
    return scopedOrganizationId === safeSegment(actor.organizationId);
  }
  return safeSegment(actor.organizationId) === safeSegment("org-convoy-of-hope");
}

function dataUrlToFile(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/);
  if (!match) return null;
  return {
    contentType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2] || "", "base64"),
  };
}

function dataUrlFileSize(dataUrl = "") {
  const match = String(dataUrl).match(/^data:[^,]*;base64,(.*)$/);
  if (!match) return null;
  const base64 = match[1] || "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "0 MB";
  if (size >= 1024 * 1024) return `${Math.round(size / (1024 * 1024))} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size)} B`;
}

function uploadSizeError(label = "archivo") {
  return {
    error: `El ${label} supera ${formatFileSize(MAX_UPLOAD_FILE_BYTES)}.`,
    details: { maxBytes: MAX_UPLOAD_FILE_BYTES },
  };
}

function jsonBodyReadError(error, fallbackMessage = "El cuerpo de la solicitud no es JSON valido.") {
  if (error?.status === 413 || error?.message === "BODY_TOO_LARGE") {
    return {
      status: 413,
      body: {
        error: "La solicitud es demasiado grande. Sube archivos usando el flujo de carga del sistema.",
        details: { maxJsonBytes: MAX_JSON_BODY_BYTES },
      },
    };
  }
  return { status: 400, body: { error: fallbackMessage } };
}

function isUploadTooLarge(dataUrl, declaredSize = null) {
  const decodedSize = dataUrl ? dataUrlFileSize(dataUrl) : null;
  const size = Number.isFinite(decodedSize) ? decodedSize : Number(declaredSize || 0);
  return size > MAX_UPLOAD_FILE_BYTES;
}

function validatePayloadUploads(payload, label = "archivo") {
  if (payload?.dataUrl && isUploadTooLarge(payload.dataUrl, payload.size)) {
    return uploadSizeError(label);
  }
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  const oversizedAttachment = attachments.find((attachment) =>
    isUploadTooLarge(attachment?.dataUrl, attachment?.size),
  );
  if (oversizedAttachment) {
    return uploadSizeError(oversizedAttachment.name || label);
  }
  return null;
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
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  sendJson(response, 200, { data: listPrograms(actorScopeFilters(_request)) });
}

export async function handleProgramCenters(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    program: url.searchParams.get("program") || undefined,
    province: url.searchParams.get("province") || undefined,
  });
  sendJson(response, 200, { data: listProgramCenters(filters), filters });
}

export async function handleProgramCenterCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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
  const validationError = validateProgramCenterPayload(payload, { requireCoreFields: true });
  if (validationError) {
    sendJson(response, 400, validationError);
    return;
  }
  if (!requireActorRole(response, actor, ["Supervision M&E", "Coordinador de programa"], "crear centros")) return;

  sendJson(response, 201, { data: createProgramCenter(payloadWithActor(request, payload)) });
}

export async function handleProgramCenterUpdate(request, response, centerId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del centro no es JSON valido." });
    return;
  }
  const validationError = validateProgramCenterPayload(payload);
  if (validationError) {
    sendJson(response, 400, validationError);
    return;
  }
  if (!requireActorRole(response, actor, ["Supervision M&E", "Coordinador de programa"], "editar centros")) return;

  const center = updateProgramCenter(centerId, payloadWithActor(request, payload));
  if (!center) {
    sendJson(response, 404, { error: "No encontre el centro solicitado." });
    return;
  }
  sendJson(response, 200, { data: center });
}

export async function handleProgramCenterDelete(request, response, centerId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const payload = await readOptionalJsonBody(request);
  if (!requireActorRole(response, actor, ["Supervision M&E", "Coordinador de programa"], "eliminar centros")) return;
  const deleted = deleteProgramCenter(centerId, payloadWithActor(request, payload));
  if (!deleted) {
    sendJson(response, 404, { error: "No encontre el centro solicitado." });
    return;
  }
  sendJson(response, 200, { data: deleted });
}

export async function handleProgramCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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
  const validationError = validateProgramPayload(payload, { requireCoreFields: true });
  if (validationError) {
    sendJson(response, 400, validationError);
    return;
  }
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager"], "crear programas")) return;

  const program = createProgram(payloadWithActor(request, payload));
  sendJson(response, 201, { data: program });
}

export async function handleProgramUpdate(request, response, programId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del programa no es JSON valido." });
    return;
  }
  const validationError = validateProgramPayload(payload);
  if (validationError) {
    sendJson(response, 400, validationError);
    return;
  }
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager"], "editar programas")) return;

  const program = updateProgram(programId, payloadWithActor(request, payload));
  if (!program) {
    sendJson(response, 404, { error: "No encontre el programa solicitado." });
    return;
  }

  sendJson(response, 200, { data: program });
}

export async function handleProgramDelete(request, response, programId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const payload = await readOptionalJsonBody(request);
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager"], "eliminar programas")) return;
  const result = deleteProgram(programId, payloadWithActor(request, payload));
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
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    programId: url.searchParams.get("programId") || undefined,
    program: url.searchParams.get("program") || undefined,
  });
  sendJson(response, 200, { data: listIndicators(filters), filters });
}

export async function handleIndicatorCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager", "Coordinador de programa"], "crear indicadores")) return;

  const indicator = createIndicator(payloadWithActor(request, payload));
  sendJson(response, 201, { data: indicator });
}

export async function handleIndicatorUpdate(request, response, indicatorId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo del indicador no es JSON valido." });
    return;
  }
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager", "Coordinador de programa"], "editar indicadores")) return;

  const indicator = updateIndicator(indicatorId, payloadWithActor(request, payload));
  if (!indicator) {
    sendJson(response, 404, { error: "No encontre el indicador solicitado." });
    return;
  }

  sendJson(response, 200, { data: indicator });
}

export async function handleIndicatorDelete(request, response, indicatorId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const payload = await readOptionalJsonBody(request);
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager"], "eliminar indicadores")) return;
  const result = deleteIndicator(indicatorId, payloadWithActor(request, payload));
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
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    program: url.searchParams.get("program") || undefined,
    year: url.searchParams.get("year") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  sendJson(response, 200, { data: listConceptPapers(filters), filters });
}

export async function handleConceptPaperCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const apiError = jsonBodyReadError(error, "El cuerpo del Concept Paper no es JSON valido.");
    sendJson(response, apiError.status, apiError.body);
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
  if (!requireActorRole(response, actor, ["Supervision M&E", "Program Manager", "Coordinador de programa"], "cargar Concept Papers")) return;

  const uploadError = validatePayloadUploads(payload, "Concept Paper");
  if (uploadError) {
    sendJson(response, 413, uploadError);
    return;
  }

  const conceptPaper = createConceptPaper(payloadWithActor(request, payload));
  sendJson(response, 201, { data: conceptPaper });
}

export async function handleConceptPaperDelete(request, response, conceptPaperId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload = {};
  try {
    payload = await readOptionalJsonBody(request);
  } catch {
    payload = {};
  }

  try {
    const deleted = deleteConceptPaper(conceptPaperId, {
      actorId: actor.id,
      actorRole: actor.primaryRole,
      reason: payload.reason || "Eliminado desde biblioteca de Concept Papers.",
    });
    if (!deleted) {
      sendJson(response, 404, { error: "No encontre el Concept Paper solicitado." });
      return;
    }
    sendJson(response, 200, { data: deleted });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleConceptPaperFile(_request, response, conceptPaperId) {
  const paper = findConceptPaperById(conceptPaperId);
  if (!paper) {
    sendJson(response, 404, { error: "No encontre el Concept Paper solicitado." });
    return;
  }

  const file = dataUrlToFile(paper.dataUrl);
  if (!file) {
    if (paper.path) {
      const absoluteUploadPath = resolveUploadPath(paper.path);
      if (absoluteUploadPath && fs.existsSync(absoluteUploadPath)) {
        sendStoredUpload(response, paper.path, {
          contentType: paper.mimeType || "application/octet-stream",
          fileName: paper.fileName || `${paper.title || "concept-paper"}.pdf`,
          disposition: "inline",
        });
        return;
      }
      const isBundledConceptPaper = /^assets\/concept-papers\//i.test(String(paper.path || ""));
      if (isBundledConceptPaper) {
        sendConceptPaperFallbackPdf(response, paper);
        return;
      }
      if (!path.isAbsolute(paper.path) && fs.existsSync(path.resolve(frontendDir, paper.path.replace(/^\/+/, "")))) {
        const staticPath = path.resolve(frontendDir, paper.path.replace(/^\/+/, ""));
        sendBinary(response, 200, fs.readFileSync(staticPath), {
          contentType: paper.mimeType || "application/pdf",
          fileName: paper.fileName || `${paper.title || "concept-paper"}.pdf`,
          disposition: "inline",
        });
        return;
      }
      sendConceptPaperFallbackPdf(response, paper);
      return;
    }
    sendConceptPaperFallbackPdf(response, paper);
    return;
  }

  sendBinary(response, 200, file.buffer, {
    contentType: paper.mimeType || file.contentType,
    fileName: paper.fileName || `${paper.title || "concept-paper"}.pdf`,
    disposition: "inline",
  });
}

export async function handleProgramManuals(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    program: url.searchParams.get("program") || undefined,
    year: url.searchParams.get("year") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  sendJson(response, 200, { data: listProgramManuals(filters), filters });
}

export async function handleProgramManualCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const apiError = jsonBodyReadError(error, "El cuerpo del manual no es JSON valido.");
    sendJson(response, apiError.status, apiError.body);
    return;
  }

  const missing = ["program", "title", "fileName"].filter((field) => !String(payload[field] || "").trim());
  if (!payload.dataUrl && !payload.path) {
    missing.push("dataUrl");
  }
  if (missing.length) {
    sendJson(response, 400, {
      error: "Faltan campos obligatorios para registrar el manual.",
      details: { missing },
    });
    return;
  }
  if (!requireActorRole(response, actor, ["Supervision M&E"], "cargar manuales")) return;

  const uploadError = validatePayloadUploads(payload, "manual");
  if (uploadError) {
    sendJson(response, 413, uploadError);
    return;
  }

  const file = dataUrlToFile(payload.dataUrl);
  const mimeType = String(payload.mimeType || file?.contentType || "");
  if (!/application\/pdf/i.test(mimeType)) {
    sendJson(response, 400, { error: "Los manuales deben subirse en formato PDF." });
    return;
  }
  if (!file && !payload.path) {
    sendJson(response, 400, { error: "Los manuales deben subirse en formato PDF." });
    return;
  }

  const manual = createProgramManual({ ...payloadWithActor(request, payload), mimeType: "application/pdf" });
  sendJson(response, 201, { data: manual });
}

export async function handleProgramManualDelete(request, response, manualId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload = {};
  try {
    payload = await readOptionalJsonBody(request);
  } catch {
    payload = {};
  }

  try {
    const deleted = deleteProgramManual(manualId, {
      actorId: actor.id,
      actorRole: actor.primaryRole,
      reason: payload.reason || "Eliminado desde biblioteca de manuales.",
    });
    if (!deleted) {
      sendJson(response, 404, { error: "No encontre el manual solicitado." });
      return;
    }
    sendJson(response, 200, { data: deleted });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleProgramManualFile(_request, response, manualId) {
  const manual = findProgramManualById(manualId);
  if (!manual) {
    sendJson(response, 404, { error: "No encontre el manual solicitado." });
    return;
  }

  const file = dataUrlToFile(manual.dataUrl);
  if (!file) {
    if (manual.path) {
      sendStoredUpload(response, manual.path, {
        contentType: manual.mimeType || "application/pdf",
        fileName: manual.fileName || `${manual.title || "manual"}.pdf`,
        disposition: "inline",
      });
      return;
    }
    sendJson(response, 404, { error: "Este manual no tiene archivo disponible en la API." });
    return;
  }

  sendBinary(response, 200, file.buffer, {
    contentType: manual.mimeType || file.contentType || "application/pdf",
    fileName: manual.fileName || `${manual.title || "manual"}.pdf`,
    disposition: "inline",
  });
}

export async function handleUploadCreate(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const kind = url.searchParams.get("kind") || "general";
  const fileName = url.searchParams.get("fileName") || "archivo";
  try {
    const uploaded = await streamRequestToUpload(request, { kind, fileName, organizationId: actor.organizationId });
    sendJson(response, 201, { data: uploaded });
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "No pude cargar el archivo.",
      details: { maxBytes: MAX_UPLOAD_FILE_BYTES },
    });
  }
}

export async function handleUploadFile(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const storagePath = url.searchParams.get("path") || "";
  if (isLibraryDocumentPathDeleted(storagePath)) {
    sendJson(response, 404, { error: "Este documento fue eliminado de la biblioteca." });
    return;
  }
  if (!canAccessUploadPath(actor, storagePath)) {
    sendJson(response, 403, { error: "No tienes permiso para abrir este archivo." });
    return;
  }
  const fileName = url.searchParams.get("fileName") || path.basename(storagePath);
  const contentType = url.searchParams.get("mimeType") || "application/octet-stream";
  sendStoredUpload(response, storagePath, { fileName, contentType, disposition: "inline" });
}

export async function handleAttendanceParticipants(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    program: url.searchParams.get("program") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  sendJson(response, 200, { data: listAttendanceParticipants(filters), filters });
}

export async function handleAttendanceArchive(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    program: url.searchParams.get("program") || undefined,
    type: url.searchParams.get("type") || undefined,
  });
  sendJson(response, 200, { data: listAttendanceArchive(filters), filters });
}

export async function handleAttendanceParticipantCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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

  const participant = createAttendanceParticipant(payloadWithActor(request, payload));
  sendJson(response, 201, { data: participant });
}

export async function handleAttendanceParticipantDelete(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch {
    payload = {};
  }
  const participantId = decodeURIComponent(url.pathname.split("/").pop() || "");
  try {
    const deleted = deleteAttendanceParticipant(participantId, {
      actorId: actor.id,
      actorRole: actor.primaryRole,
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
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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
      actorId: actor.id,
      actorRole: actor.primaryRole,
      reason: payload.reason,
    });
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceProgramReset(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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
      actorId: actor.id,
      actorRole: actor.primaryRole,
      reason: payload.reason,
    });
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceSessions(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    program: url.searchParams.get("program") || undefined,
    weekStart: url.searchParams.get("weekStart") || undefined,
    center: url.searchParams.get("center") || undefined,
    period: url.searchParams.get("period") || undefined,
  });
  sendJson(response, 200, { data: listAttendanceSessions(filters), filters });
}

export async function handleAttendanceSessionSave(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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
    const session = saveAttendanceSession(payloadWithActor(request, payload));
    sendJson(response, 200, { data: session });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAttendanceSessionDelete(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch {
    payload = {};
  }
  const filters = actorScopeFilters(request, {
    program: url.searchParams.get("program") || payload.program,
    weekStart: url.searchParams.get("weekStart") || payload.weekStart,
    center: url.searchParams.get("center") || payload.center,
    period: url.searchParams.get("period") || payload.period,
  });
  const required = requireFields(filters, ["program", "weekStart"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }
  try {
    const deleted = deleteAttendanceSession(filters, {
      actorId: actor.id,
      actorRole: actor.primaryRole,
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
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const filters = actorScopeFilters(request, parseFilters(url));
  const reports = filterReportsByScope(queryReports(filters), filters.scope);
  sendJson(response, 200, { data: reports, filters });
}

export async function handleReportCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const apiError = jsonBodyReadError(error, "El cuerpo del reporte no es JSON valido.");
    sendJson(response, apiError.status, apiError.body);
    return;
  }

  const required = requireFields(payload, ["program", "indicatorId", "owner"]);
  if (required) {
    sendJson(response, 400, required);
    return;
  }
  const validationError = validateReportPayload(payload, { requireCoreFields: true });
  if (validationError) {
    sendJson(response, 400, validationError);
    return;
  }

  const uploadError = validatePayloadUploads(payload, "adjunto del reporte");
  if (uploadError) {
    sendJson(response, 413, uploadError);
    return;
  }

  const report = createReport(payloadWithActor(request, payload));
  sendJson(response, 201, { data: report });
}

export async function handleReportBulkCreate(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const apiError = jsonBodyReadError(error, "El cuerpo del lote no es JSON valido.");
    sendJson(response, apiError.status, apiError.body);
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
  const validationError = items.map((item) => validateReportPayload(item, { requireCoreFields: true })).find(Boolean);
  if (validationError) {
    sendJson(response, 400, validationError);
    return;
  }

  const uploadError = items.map((item) => validatePayloadUploads(item, "adjunto del reporte")).find(Boolean);
  if (uploadError) {
    sendJson(response, 413, uploadError);
    return;
  }

  const reports = createReportsBulk(items.map((item) => payloadWithActor(request, item)));
  sendJson(response, 201, { data: reports, count: reports.length });
}

export async function handleReportDelete(request, response, reportId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "La solicitud de eliminacion no es JSON valido." });
    return;
  }

  try {
    const deletedReport = deleteCorrectableReport(reportId, {
      actorId: actor.id,
      actorRole: actor.primaryRole,
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
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, parseFilters(url));
  sendJson(response, 200, { data: listDeletedReports(filters), filters });
}

export async function handleNotificationsList(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    programId: url.searchParams.get("programId") || undefined,
    reportId: url.searchParams.get("reportId") || undefined,
    recipientRole: url.searchParams.get("recipientRole") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  sendJson(response, 200, { data: listNotifications(filters), filters });
}

function authAuditEntryToActivity(entry = {}, actor) {
  const details = entry.details || {};
  const action = String(entry.action || "").trim();
  const actorLabel = String(details.email || details.userId || details.actorId || "Usuario").trim();
  return {
    id: entry.id,
    actionType: action.includes("Deleted") || action.includes("deleted") ? "deleted" : action.includes("Created") || action.includes("created") ? "created" : "updated",
    module: "access",
    entityType: "auth",
    entityId: String(details.userId || details.organizationId || entry.id || "").trim(),
    organizationId: actor.organizationId,
    organizationName: actor.organizationName,
    actorId: String(details.actorId || details.userId || "").trim(),
    actorName: actorLabel,
    actorRole: "",
    title: action || "Movimiento de acceso",
    description: actorLabel,
    resourceLabel: String(details.slug || details.email || details.organizationId || "acceso").trim(),
    status: "Registrado",
    metadata: details,
    createdAt: entry.createdAt,
  };
}

export async function handlePlatformActivityList(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const limit = Number(url.searchParams.get("limit") || 120);
  const filters = actorScopeFilters(request, {
    limit,
    module: url.searchParams.get("module") || undefined,
  });
  const domainActivity = listPlatformActivity(filters);
  const authActivity = listAuditLog({ organizationId: actor.organizationId, limit }).map((entry) => authAuditEntryToActivity(entry, actor));
  const combined = [...domainActivity, ...authActivity]
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, limit);
  sendJson(response, 200, { data: combined, filters });
}

export async function handleNotificationRead(request, response, notificationId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "El cuerpo de la alerta no es JSON valido." });
    return;
  }

  const notification = markNotificationRead(notificationId, actor.id);
  if (!notification) {
    sendJson(response, 404, { error: "No encontre la alerta solicitada." });
    return;
  }

  sendJson(response, 200, { data: notification });
}

export async function handleEmailOutboxList(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, {
    programId: url.searchParams.get("programId") || undefined,
    reportId: url.searchParams.get("reportId") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  sendJson(response, 200, { data: listEmailOutbox(filters), filters });
}

export async function handleFormSubmissionsList(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const filters = actorScopeFilters(request, {
    program: url.searchParams.get("program") || undefined,
    period: url.searchParams.get("period") || undefined,
    formId: url.searchParams.get("formId") || undefined,
    processing: url.searchParams.get("processing") || undefined,
    sourceType: url.searchParams.get("sourceType") || undefined,
  });
  sendJson(response, 200, { data: listFormSubmissions(filters), filters });
}

export async function handleFormSubmissionCreate(request, response) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const payload = await readJsonBody(request);
    sendJson(response, 201, {
      data: createFormSubmission({
        ...payload,
        importedBy: payload.importedBy || actor.email || actor.fullName || actor.id,
        importedByRole: payload.importedByRole || actor.primaryRole,
        actorId: actor.id,
        actorName: actor.fullName || actor.email || actor.id,
        actorRole: actor.role,
        organizationId: actor.organizationId,
        companyId: actor.organizationId,
        organizationName: actor.organizationName,
      }),
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

function chatUserDirectory(actor) {
  return new Map(listAuthUsers(actor).map((user) => [user.id, user]));
}

function decorateChatParticipant(participant, usersById) {
  const user = usersById.get(participant.userId) || null;
  return {
    ...participant,
    displayName: user?.fullName || participant.userId,
    email: user?.email || null,
    primaryRole: user?.primaryRole || null,
    status: user?.status || null,
  };
}

function decorateChatPresenceParticipant(participant, usersById) {
  return {
    ...decorateChatParticipant(participant, usersById),
    isOnline: Boolean(participant.isOnline),
    isTyping: Boolean(participant.isTyping),
    lastSeenAt: participant.lastSeenAt || "",
    typingUpdatedAt: participant.typingUpdatedAt || "",
    activeConversationId: participant.activeConversationId || "",
    activeView: participant.activeView || "",
    deviceLabel: participant.deviceLabel || "",
  };
}

function decorateChatConversation(conversation, usersById) {
  return {
    ...conversation,
    participants: Array.isArray(conversation.participants)
      ? conversation.participants.map((participant) => decorateChatParticipant(participant, usersById))
      : [],
  };
}

function decorateChatMessage(message, usersById) {
  return {
    ...message,
    senderName: usersById.get(message.senderUserId)?.fullName || message.senderUserId,
    pinnedByName: message.pinnedByUserId ? usersById.get(message.pinnedByUserId)?.fullName || message.pinnedByUserId : "",
    editedByName: message.editedByUserId ? usersById.get(message.editedByUserId)?.fullName || message.editedByUserId : "",
    deletedByName: message.deletedByUserId ? usersById.get(message.deletedByUserId)?.fullName || message.deletedByUserId : "",
    reactions: Array.isArray(message.reactions)
      ? message.reactions.map((reaction) => ({
          ...reaction,
          displayName: usersById.get(reaction.userId)?.fullName || reaction.userId,
        }))
      : [],
    readBy: Array.isArray(message.readBy)
      ? message.readBy.map((entry) => ({
          ...entry,
          displayName: usersById.get(entry.userId)?.fullName || entry.userId,
        }))
      : [],
  };
}

function participantIdsFromPayload(payload, actor) {
  return [...new Set([actor.id, ...(Array.isArray(payload.participantUserIds) ? payload.participantUserIds : [])].map((item) => String(item || "").trim()).filter(Boolean))];
}

function actorChatParticipant(conversationId, actor) {
  return listChatParticipants({
    organizationId: actor.organizationId,
    conversationId,
    userId: actor.id,
  })[0] || null;
}

function canManageConversationParticipants(participant, actor, conversation) {
  if (!participant) return false;
  if (actor.role === "Supervision M&E") return true;
  if (participant.canAddPeople || participant.canRemovePeople) return true;
  return conversation?.createdByUserId === actor.id;
}

function canModerateConversationParticipants(participant, actor, conversation) {
  if (!participant) return false;
  if (actor.role === "Supervision M&E") return true;
  if (conversation?.createdByUserId === actor.id) return true;
  return participant.participantRole === "owner" || Boolean(participant.canRemovePeople);
}

function canArchiveConversation(participant, actor, conversation) {
  if (!participant) return false;
  if (actor.role === "Supervision M&E") return true;
  if (conversation?.createdByUserId === actor.id) return true;
  return Boolean(participant.canRemovePeople || participant.canAddPeople);
}

function canEditConversation(participant, actor, conversation) {
  if (!participant) return false;
  if (actor.role === "Supervision M&E") return true;
  if (conversation?.createdByUserId === actor.id) return true;
  return conversation?.type === "group" && Boolean(participant.canAddPeople || participant.canRemovePeople);
}

function canEditChatMessage(actor, participant, message) {
  if (!actor || !participant || !message) return false;
  if (String(message.messageType || "").toLowerCase() === "system") return false;
  if (message.isDeleted) return false;
  return message.senderUserId === actor.id;
}

function canDeleteChatMessage(actor, participant, message, conversation) {
  if (!actor || !participant || !message) return false;
  if (String(message.messageType || "").toLowerCase() === "system") return false;
  if (message.isDeleted) return false;
  if (actor.role === "Supervision M&E") return true;
  if (conversation?.createdByUserId === actor.id) return true;
  return message.senderUserId === actor.id;
}

function postSystemChatMessage(conversation, actor, body) {
  if (!conversation || !String(body || "").trim()) return null;
  return createChatMessage(conversation.id, {
    messageType: "system",
    body: String(body || "").trim(),
    senderUserId: actor.id,
    senderName: actor.fullName || actor.email || actor.id,
    actorName: actor.fullName || actor.email || actor.id,
    actorRole: actor.role,
    organizationId: actor.organizationId,
    companyId: actor.organizationId,
    organizationName: actor.organizationName,
  });
}

export async function handleChatConversationsList(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const usersById = chatUserDirectory(actor);
  const filters = actorScopeFilters(request, {
    participantUserId: actor.id,
    type: url.searchParams.get("type") || undefined,
    contextType: url.searchParams.get("contextType") || undefined,
    contextId: url.searchParams.get("contextId") || undefined,
    unreadOnly: url.searchParams.get("unreadOnly") === "true",
    includeArchived: url.searchParams.get("includeArchived") === "true",
  });
  const conversations = listChatConversations(filters).map((conversation) => decorateChatConversation(conversation, usersById));
  sendJson(response, 200, { data: conversations, filters });
}

export async function handleChatConversationCreate(request, response) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const payload = await readJsonBody(request);
    const participantUserIds = participantIdsFromPayload(payload, actor);
    const usersById = chatUserDirectory(actor);
    const missingUserIds = participantUserIds.filter((userId) => !usersById.has(userId));
    if (missingUserIds.length) {
      sendJson(response, 400, { error: "Hay participantes no validos para esta organizacion.", details: { missingUserIds } });
      return;
    }
    const conversation = createChatConversation({
      type: payload.type || "direct",
      title: payload.title || "",
      description: payload.description || "",
      contextType: payload.contextType || "",
      contextId: payload.contextId || "",
      participantUserIds,
      createdByUserId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
      organizationId: actor.organizationId,
      companyId: actor.organizationId,
      organizationName: actor.organizationName,
    });
    sendJson(response, 201, {
      data: decorateChatConversation(
        {
          ...conversation,
          participants: listChatParticipants({ organizationId: actor.organizationId, conversationId: conversation.id }),
        },
        usersById,
      ),
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatConversationDetail(request, response, conversationId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const conversation = findChatConversationById(conversationId, {
    organizationId: actor.organizationId,
    participantUserId: actor.id,
  });
  if (!conversation) {
    sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
    return;
  }
  const usersById = chatUserDirectory(actor);
  sendJson(response, 200, {
    data: decorateChatConversation(
      {
        ...conversation,
        participants: listChatParticipants({ organizationId: actor.organizationId, conversationId }),
      },
      usersById,
    ),
  });
}

export async function handleChatConversationUpdate(request, response, conversationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    if (!canEditConversation(participant, actor, conversation)) {
      sendJson(response, 403, { error: "No tienes permiso para editar esta conversacion." });
      return;
    }
    const payload = await readJsonBody(request);
    const previousTitle = String(conversation.title || "").trim();
    const updated = updateChatConversation(conversationId, {
      title: payload.title,
      description: payload.description,
      actorId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
    });
    const nextTitle = String(updated?.title || "").trim();
    if (nextTitle && nextTitle !== previousTitle) {
      postSystemChatMessage(updated, actor, `${actor.fullName || actor.id} renombro el grupo a "${nextTitle}".`);
    }
    const usersById = chatUserDirectory(actor);
    sendJson(response, 200, {
      data: decorateChatConversation(
        {
          ...updated,
          participants: listChatParticipants({ organizationId: actor.organizationId, conversationId }),
        },
        usersById,
      ),
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatMessagesList(request, response, conversationId, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const conversation = findChatConversationById(conversationId, {
    organizationId: actor.organizationId,
    participantUserId: actor.id,
  });
  if (!conversation) {
    sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
    return;
  }
  const usersById = chatUserDirectory(actor);
  const limit = Number(url.searchParams.get("limit") || 50);
  const before = url.searchParams.get("before") || undefined;
  const messages = listChatMessages({
    organizationId: actor.organizationId,
    conversationId,
    before,
    limit,
  }).map((message) => decorateChatMessage(message, usersById));
  sendJson(response, 200, {
    data: messages,
    meta: {
      hasMore: messages.length >= Math.max(1, Math.min(200, limit || 50)),
      nextCursor: messages.length ? messages[0]?.createdAt || null : null,
    },
  });
}

export async function handleChatMessageCreate(request, response, conversationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    if (!participant || participant.canSendMessages === false) {
      sendJson(response, 403, { error: "No tienes permiso para enviar mensajes en esta conversacion." });
      return;
    }
    const payload = await readJsonBody(request);
    const hasBody = String(payload.body || "").trim().length > 0;
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (!hasBody && !attachments.length) {
      sendJson(response, 400, { error: "El mensaje necesita texto o adjuntos." });
      return;
    }
    const usersById = chatUserDirectory(actor);
    const message = createChatMessage(conversationId, {
      messageType: payload.messageType || (attachments.length ? "file" : "text"),
      body: payload.body || "",
      replyToMessageId: payload.replyToMessageId || "",
      attachments,
      senderUserId: actor.id,
      senderName: actor.fullName || actor.email || actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
      organizationId: actor.organizationId,
      companyId: actor.organizationId,
      organizationName: actor.organizationName,
    });
    sendJson(response, 201, { data: decorateChatMessage(message, usersById) });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatMessageUpdate(request, response, conversationId, messageId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    if (!participant) {
      sendJson(response, 403, { error: "No tienes permiso para actualizar mensajes en esta conversacion." });
      return;
    }
    const payload = await readJsonBody(request);
    const conversationMessages = listChatMessages({
      organizationId: actor.organizationId,
      conversationId,
      limit: 200,
    });
    const targetMessage = conversationMessages.find((message) => message.id === messageId) || null;
    if (!targetMessage) {
      sendJson(response, 404, { error: "No encontre el mensaje solicitado." });
      return;
    }
    if (
      !Object.prototype.hasOwnProperty.call(payload, "isPinned") &&
      !Object.prototype.hasOwnProperty.call(payload, "reactionEmoji") &&
      !Object.prototype.hasOwnProperty.call(payload, "body") &&
      !Object.prototype.hasOwnProperty.call(payload, "isDeleted")
    ) {
      sendJson(response, 400, { error: "No hay cambios validos para este mensaje." });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "body") && !canEditChatMessage(actor, participant, targetMessage)) {
      sendJson(response, 403, { error: "No tienes permiso para editar este mensaje." });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "isDeleted") && !canDeleteChatMessage(actor, participant, targetMessage, conversation)) {
      sendJson(response, 403, { error: "No tienes permiso para eliminar este mensaje." });
      return;
    }
    const updated = updateChatMessage(conversationId, messageId, {
      actorId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
      ...(Object.prototype.hasOwnProperty.call(payload, "isPinned")
        ? {
            isPinned: payload.isPinned === true,
            pinnedAt: payload.isPinned === true ? nowIso() : null,
            pinnedByUserId: payload.isPinned === true ? actor.id : null,
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "reactionEmoji")
        ? {
            reactionEmoji: payload.reactionEmoji,
            reactionUserId: actor.id,
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "body")
        ? {
            body: payload.body,
            editedAt: nowIso(),
            editedByUserId: actor.id,
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "isDeleted")
        ? {
            isDeleted: payload.isDeleted === true,
            deletedAt: payload.isDeleted === true ? nowIso() : null,
            deletedByUserId: payload.isDeleted === true ? actor.id : null,
          }
        : {}),
    });
    if (!updated) {
      sendJson(response, 404, { error: "No encontre el mensaje solicitado." });
      return;
    }
    const usersById = chatUserDirectory(actor);
    if (Object.prototype.hasOwnProperty.call(payload, "isPinned")) {
      const pinVerb = payload.isPinned === true ? "fijo" : "quito del panel fijado";
      postSystemChatMessage(conversation, actor, `${actor.fullName || actor.id} ${pinVerb} un mensaje importante.`);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "body")) {
      postSystemChatMessage(conversation, actor, `${actor.fullName || actor.id} edito un mensaje.`);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "isDeleted") && payload.isDeleted === true) {
      postSystemChatMessage(conversation, actor, `${actor.fullName || actor.id} elimino un mensaje.`);
    }
    sendJson(response, 200, { data: decorateChatMessage(updated, usersById) });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatConversationRead(request, response, conversationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const payload = await readJsonBody(request);
    const result = markChatConversationRead(conversationId, {
      userId: actor.id,
      lastReadMessageId: payload.lastReadMessageId,
    });
    if (!result) {
      sendJson(response, 400, { error: "No pude registrar la lectura de la conversacion." });
      return;
    }
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatParticipantAdd(request, response, conversationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    if (!canManageConversationParticipants(participant, actor, conversation)) {
      sendJson(response, 403, { error: "No tienes permiso para agregar participantes a esta conversacion." });
      return;
    }
    const payload = await readJsonBody(request);
    const participantUserIds = [...new Set((Array.isArray(payload.participantUserIds) ? payload.participantUserIds : []).map((item) => String(item || "").trim()).filter(Boolean))];
    const usersById = chatUserDirectory(actor);
    const missingUserIds = participantUserIds.filter((userId) => !usersById.has(userId));
    if (missingUserIds.length) {
      sendJson(response, 400, { error: "Hay participantes no validos para esta organizacion.", details: { missingUserIds } });
      return;
    }
    const added = addChatParticipants(conversationId, {
      participantUserIds,
      actorId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
    });
    if (added?.length) {
      const participantNames = added
        .map((entry) => usersById.get(entry.userId)?.fullName || entry.userId)
        .filter(Boolean)
        .join(", ");
      postSystemChatMessage(conversation, actor, `${actor.fullName || actor.id} agrego a ${participantNames} al chat.`);
    }
    sendJson(response, 200, {
      data: {
        conversationId,
        participants: added.map((entry) => decorateChatParticipant(entry, usersById)),
      },
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatParticipantDelete(request, response, conversationId, userId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    const canManage = canManageConversationParticipants(participant, actor, conversation);
    if (!canManage && actor.id !== userId) {
      sendJson(response, 403, { error: "No tienes permiso para quitar participantes de esta conversacion." });
      return;
    }
    const removed = removeChatParticipant(conversationId, userId, {
      actorId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
    });
    if (!removed) {
      sendJson(response, 404, { error: "No encontre el participante solicitado." });
      return;
    }
    const usersById = chatUserDirectory(actor);
    const targetName = usersById.get(userId)?.fullName || userId;
    const message =
      actor.id === userId
        ? `${actor.fullName || actor.id} salio del chat.`
        : `${actor.fullName || actor.id} quito a ${targetName} del chat.`;
    postSystemChatMessage(conversation, actor, message);
    sendJson(response, 200, {
      data: {
        conversationId,
        removedUserId: userId,
        removedAt: removed.leftAt || removed.updatedAt,
      },
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatParticipantUpdate(request, response, conversationId, userId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const actorParticipant = actorChatParticipant(conversationId, actor);
    if (!canModerateConversationParticipants(actorParticipant, actor, conversation)) {
      sendJson(response, 403, { error: "No tienes permiso para moderar este chat." });
      return;
    }
    const targetParticipant = listChatParticipants({
      organizationId: actor.organizationId,
      conversationId,
      userId,
    })[0];
    if (!targetParticipant) {
      sendJson(response, 404, { error: "No encontre el participante solicitado." });
      return;
    }
    if (targetParticipant.participantRole === "owner" && actor.role !== "Supervision M&E" && actor.id !== userId) {
      sendJson(response, 403, { error: "No puedes modificar al propietario del grupo." });
      return;
    }
    const payload = await readJsonBody(request);
    const roleInput = String(payload.participantRole || targetParticipant.participantRole || "member").trim().toLowerCase();
    if (!["member", "admin", "owner"].includes(roleInput)) {
      sendJson(response, 400, { error: "Rol de participante no valido." });
      return;
    }
    if (roleInput === "owner" && actor.role !== "Supervision M&E") {
      sendJson(response, 403, { error: "Solo Supervision M&E puede reasignar el rol de propietario." });
      return;
    }
    const roleTemplates = {
      owner: { participantRole: "owner", canAddPeople: true, canRemovePeople: true },
      admin: { participantRole: "admin", canAddPeople: true, canRemovePeople: true },
      member: { participantRole: "member", canAddPeople: false, canRemovePeople: false },
    };
    const updated = updateChatParticipant(conversationId, userId, {
      ...roleTemplates[roleInput],
      canSendMessages: payload.canSendMessages !== undefined ? payload.canSendMessages : targetParticipant.canSendMessages,
      isMuted: payload.isMuted !== undefined ? payload.isMuted : targetParticipant.isMuted,
      actorId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
    });
    const usersById = chatUserDirectory(actor);
    const targetName = usersById.get(userId)?.fullName || userId;
    const changes = [];
    if (updated.participantRole !== targetParticipant.participantRole) {
      changes.push(`rol ${targetParticipant.participantRole || "miembro"} -> ${updated.participantRole}`);
    }
    if (Boolean(updated.canSendMessages) !== Boolean(targetParticipant.canSendMessages)) {
      changes.push(updated.canSendMessages ? "habilito envio de mensajes" : "restringio envio de mensajes");
    }
    if (Boolean(updated.isMuted) !== Boolean(targetParticipant.isMuted)) {
      changes.push(updated.isMuted ? "silencio notificaciones" : "reactivo notificaciones");
    }
    if (changes.length) {
      postSystemChatMessage(conversation, actor, `${actor.fullName || actor.id} actualizo a ${targetName}: ${changes.join(", ")}.`);
    }
    sendJson(response, 200, {
      data: decorateChatParticipant(updated, usersById),
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatConversationArchive(request, response, conversationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    if (!canArchiveConversation(participant, actor, conversation)) {
      sendJson(response, 403, { error: "No tienes permiso para eliminar esta conversacion." });
      return;
    }
    const archived = archiveChatConversation(conversationId, {
      actorId: actor.id,
      actorName: actor.fullName || actor.email || actor.id,
      actorRole: actor.role,
    });
    sendJson(response, 200, { data: archived });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatUnreadCount(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  sendJson(response, 200, {
    data: getChatUnreadCount({
      organizationId: actor.organizationId,
      userId: actor.id,
    }),
  });
}

export async function handleChatPresenceHeartbeat(request, response) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const payload = await readOptionalJsonBody(request);
    const activeConversationId = String(payload.activeConversationId || "").trim();
    if (activeConversationId) {
      const conversation = findChatConversationById(activeConversationId, {
        organizationId: actor.organizationId,
        participantUserId: actor.id,
      });
      if (!conversation) {
        sendJson(response, 404, { error: "No encontre la conversacion activa para actualizar presencia." });
        return;
      }
    }
    const result = heartbeatChatPresence({
      userId: actor.id,
      organizationId: actor.organizationId,
      companyId: actor.organizationId,
      organizationName: actor.organizationName,
      activeConversationId,
      activeView: String(payload.activeView || "").trim(),
      deviceLabel: String(payload.deviceLabel || request.headers["user-agent"] || "").slice(0, 140),
    });
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatConversationPresence(request, response, conversationId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const conversation = findChatConversationById(conversationId, {
    organizationId: actor.organizationId,
    participantUserId: actor.id,
  });
  if (!conversation) {
    sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
    return;
  }
  const usersById = chatUserDirectory(actor);
  const snapshot = getChatConversationPresence(conversationId, {
    organizationId: actor.organizationId,
  });
  if (!snapshot) {
    sendJson(response, 404, { error: "No pude cargar la presencia del chat." });
    return;
  }
  sendJson(response, 200, {
    data: {
      ...snapshot,
      participants: (snapshot.participants || []).map((participant) => decorateChatPresenceParticipant(participant, usersById)),
    },
  });
}

export async function handleChatTypingUpdate(request, response, conversationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const conversation = findChatConversationById(conversationId, {
      organizationId: actor.organizationId,
      participantUserId: actor.id,
    });
    if (!conversation) {
      sendJson(response, 404, { error: "No encontre la conversacion solicitada." });
      return;
    }
    const participant = actorChatParticipant(conversationId, actor);
    if (!participant || participant.canSendMessages === false) {
      sendJson(response, 403, { error: "No tienes permiso para escribir en esta conversacion." });
      return;
    }
    const payload = await readOptionalJsonBody(request);
    const result = setChatConversationTyping(conversationId, {
      userId: actor.id,
      organizationId: actor.organizationId,
      companyId: actor.organizationId,
      organizationName: actor.organizationName,
      isTyping: payload.isTyping === true,
    });
    sendJson(response, 200, { data: result });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleChatSearch(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const usersById = chatUserDirectory(actor);
  const result = searchChat({
    organizationId: actor.organizationId,
    participantUserId: actor.id,
    q: url.searchParams.get("q") || "",
    conversationId: url.searchParams.get("conversationId") || "",
    senderUserId: url.searchParams.get("senderUserId") || "",
    hasAttachments: url.searchParams.get("hasAttachments") || "",
    date: url.searchParams.get("date") || "",
  });
  sendJson(response, 200, {
    data: {
      conversations: result.conversations.map((conversation) => decorateChatConversation(conversation, usersById)),
      messages: result.messages.map((message) => decorateChatMessage(message, usersById)),
    },
  });
}

export async function handleChatDirectory(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  const users = listAuthUsers(actor)
    .filter((user) => user.status === "active" && user.id !== actor.id)
    .map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      primaryRole: user.primaryRole,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
    }));
  sendJson(response, 200, { data: users });
}

export async function handleReportStatusUpdate(request, response, reportId) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
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

  const validation = validateReportStatusChange({
    currentStatus: report.status,
    nextStatus: payload.status,
    actorRole: actor.primaryRole,
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
    actorId: actor.id,
    actorRole: actor.primaryRole,
    note: payload.note,
  });

  sendJson(response, 200, {
    data: result.report,
    historyEntry: result.historyEntry,
    followUpNotifications: result.followUpNotifications || [],
  });
}

export async function handleReportStatusHistory(_request, response, reportId) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const report = findReportById(reportId);
  const history = listReportStatusHistory(reportId);
  if (!report && !history.length) {
    sendJson(response, 404, { error: "No encontre el reporte solicitado." });
    return;
  }

  sendJson(response, 200, { data: history });
}

export async function handleAnalyticsConfig(_request, response) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  sendJson(response, 200, {
    data: {
      ...buildAnalyticsConfig(),
      ...getOrganizationBranding(actor.organizationId),
    },
  });
}

export async function handleAnalyticsOverview(_request, response, url) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  const filters = actorScopeFilters(_request, parseFilters(url));
  const visibleReports = queryReports(filters);
  const overview = buildAnalyticsOverview({
    programs: listPrograms(filters),
    indicators: listIndicators(filters),
    reports: visibleReports,
    filters,
    scope: filters.scope,
  });

  sendJson(response, 200, { data: overview, filters });
}

export async function handleAnalyticsPowerBi(request, response, url) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  if (!requireActorRole(response, actor, ["Supervision M&E"], "exportar datos analiticos")) return;

  const filters = actorScopeFilters(request, parseFilters(url));
  const users = listAuthUsers(actor);
  const programs = listPrograms(filters);
  const programCenters = listProgramCenters(filters);
  const indicators = listIndicators(filters);
  const reports = queryReports(filters);
  const deletedReports = listDeletedReports(filters);
  const reportStatusHistory = listAllReportStatusHistory(filters);
  const attendanceParticipants = listAttendanceParticipants(filters);
  const attendanceSessions = listAttendanceSessions(filters);
  const attendanceArchive = listAttendanceArchive(filters);
  const formSubmissions = listFormSubmissions(filters);
  const conceptPapers = listConceptPapers(filters);
  const programManuals = listProgramManuals(filters);

  sendJson(response, 200, {
    data: buildPowerBiDataset({
      organization: {
        id: actor.organizationId,
        name: actor.organizationName,
      },
      users,
      programs,
      programCenters,
      indicators,
      reports,
      deletedReports,
      reportStatusHistory,
      attendanceParticipants,
      attendanceSessions,
      attendanceArchive,
      formSubmissions,
      conceptPapers,
      programManuals,
      generatedBy: {
        id: actor.id,
        email: actor.email,
        role: actor.primaryRole,
      },
      filters,
    }),
    filters,
  });
}

function apiIndex() {
  return {
    name: "Sistema de MEL API",
    version: "v1",
    resources: [
      "organization/branding",
      "organization/current",
      "organization/list",
      "POST organization/list",
      "PUT organization/:id",
      "programs",
      "program-centers",
      "indicators",
      "concept-papers",
      "concept-papers/:id/file",
      "program-manuals",
      "program-manuals/:id/file",
      "DELETE concept-papers/:id",
      "DELETE program-manuals/:id",
      "uploads",
      "uploads/file",
      "attendance/participants",
      "attendance/sessions",
      "attendance/archive",
      "form-submissions",
      "reports",
      "reports/deleted",
      "chat/conversations",
      "chat/conversations/:id",
      "chat/conversations/:id/messages",
      "chat/conversations/:id/read",
      "chat/conversations/:id/presence",
      "chat/conversations/:id/participants",
      "chat/conversations/:id/participants/:userId",
      "chat/conversations/:id/typing",
      "chat/directory",
      "chat/presence",
      "chat/unread-count",
      "chat/search",
      "notifications",
      "email-outbox",
      "analytics/config",
      "analytics/overview",
      "analytics/power-bi",
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
  return request.melActor?.id || request.headers["x-mel-actor-id"] || payload.actorId || null;
}

function actorRoleFrom(request, payload = {}) {
  return request.melActor?.primaryRole || payload.actorRole || null;
}

function sessionTokenFrom(request) {
  return String(request.headers["x-mel-session-token"] || "").trim();
}

function organizationSelectorFrom(request, payload = {}) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "")
    .split(",")[0]
    .trim();
  const url = new URL(request.url || "/", "http://localhost");
  const pathname = String(url.pathname || "/").trim();
  const inferredPathSlug =
    pathname === "/admin" || pathname.startsWith("/admin/")
      ? "nexora-admin"
      : pathname === "/convoy" || pathname.startsWith("/convoy/")
        ? "convoy-of-hope"
        : (pathname.match(/^\/portal\/([^/?#]+)/)?.[1] || "");
  return {
    organizationId:
      request.headers["x-mel-organization-id"] ||
      payload.organizationId ||
      payload.orgId ||
      url.searchParams.get("organizationId") ||
      url.searchParams.get("org") ||
      "",
    organizationSlug:
      payload.organizationSlug ||
      payload.orgSlug ||
      url.searchParams.get("organizationSlug") ||
      url.searchParams.get("orgSlug") ||
      inferredPathSlug ||
      "",
    host,
  };
}

function actorScopeFilters(request, filters = {}) {
  const organizationId = request.melActor?.organizationId || filters.organizationId || filters.companyId || undefined;
  return {
    ...filters,
    organizationId,
    companyId: organizationId,
  };
}

function payloadWithActor(request, payload = {}) {
  const organizationId =
    request.melActor?.organizationId || payload.organizationId || payload.companyId || undefined;
  return {
    ...payload,
    actorId: actorIdFrom(request, payload),
    actorName: request.melActor?.fullName || request.melActor?.email || payload.actorName || undefined,
    actorRole: actorRoleFrom(request, payload),
    organizationId,
    companyId: organizationId,
    organizationName: request.melActor?.organizationName || payload.organizationName || undefined,
  };
}

function requireAuthenticatedUser(request, response) {
  if (request.melActor?.id) return request.melActor;
  sendJson(response, 401, { error: "Necesitas iniciar sesion para usar la API." });
  return null;
}

function attachAuthenticatedActor(request) {
  const sessionToken = sessionTokenFrom(request);
  if (!sessionToken) {
    request.melActor = null;
    request.melSession = null;
    return null;
  }

  const restored = restoreAuthSession(sessionToken);
  request.melActor = restored?.user || null;
  request.melSession = restored?.session || null;
  return restored;
}

function requireActorRole(response, actor, allowedRoles = [], action = "realizar esta accion") {
  const actorRole = String(actor?.primaryRole || "").trim();
  if (allowedRoles.includes(actorRole)) return true;
  sendJson(response, 403, {
    error: `No tienes permiso para ${action}.`,
    details: { actorRole: actorRole || null, allowedRoles },
  });
  return false;
}

function requireActorViewPermission(response, actor, requiredView, action = "realizar esta accion") {
  const grantedViews = Array.isArray(actor?.viewPermissions) ? actor.viewPermissions.map((item) => String(item || "").trim()) : [];
  if (grantedViews.includes(requiredView)) return true;
  sendJson(response, 403, {
    error: `No tienes permiso para ${action}.`,
    details: { requiredView, grantedViews },
  });
  return false;
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
    sendJson(response, 200, signInAuthUser({ ...payload, ...organizationSelectorFrom(request, payload) }));
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthSession(request, response) {
  const sessionToken = sessionTokenFrom(request);
  if (!sessionToken) {
    sendJson(response, 401, { error: "No hay una sesion activa." });
    return;
  }
  const session = request.melActor?.id ? { user: request.melActor, session: request.melSession } : restoreAuthSession(sessionToken);
  if (!session) {
    sendJson(response, 401, { error: "La sesion ya no es valida." });
    return;
  }
  sendJson(response, 200, {
    user: session.user,
    session: {
      ...session.session,
      token: sessionToken,
    },
  });
}

export async function handleAuthSignOut(request, response) {
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken) {
    signOutAuthSession(sessionToken);
  }
  sendEmpty(response, 204);
}

export async function handleOrganizationBranding(request, response, url) {
  const organizationId = url.searchParams.get("organizationId") || url.searchParams.get("org") || "";
  sendJson(response, 200, { data: organizationId ? getOrganizationBranding(organizationId) : getCurrentOrganization(organizationSelectorFrom(request)) });
}

export async function handleCurrentOrganization(request, response) {
  sendJson(response, 200, { data: getCurrentOrganization(organizationSelectorFrom(request)) });
}

export async function handleOrganizationList(_request, response) {
  const actor = requireAuthenticatedUser(_request, response);
  if (!actor) return;
  if (!requireActorViewPermission(response, actor, "access", "ver organizaciones")) return;
  if (!actor.globalAdmin) {
    sendJson(response, 403, { error: "Solo un administrador global de Nexora puede ver organizaciones." });
    return;
  }
  sendJson(response, 200, { data: listOrganizations() });
}

export async function handleOrganizationCreate(request, response) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const payload = await readJsonBody(request);
    sendJson(response, 201, { data: createOrganization(payload, actor) });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleOrganizationUpdate(request, response, organizationId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const payload = await readJsonBody(request);
    sendJson(response, 200, { data: updateOrganization(organizationId, payload, actor) });
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

export async function handleAuthUsersList(request, response) {
  const actor = requireAuthenticatedUser(request, response);
  if (!actor) return;
  if (!requireActorViewPermission(response, actor, "access", "ver usuarios")) return;
  sendJson(response, 200, { users: listAuthUsers(actor) });
}

export async function handleAuthUserCreate(request, response) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    if (!requireActorViewPermission(response, actor, "access", "crear usuarios")) return;
    const payload = await readJsonBody(request);
    sendJson(response, 201, { user: createManagedAuthUser(payload, actor) });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthUserUpdate(request, response, userId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    if (!requireActorViewPermission(response, actor, "access", "editar accesos")) return;
    const payload = await readJsonBody(request);
    sendJson(response, 200, {
      user: updateManagedAuthUser(userId, payload, actor),
    });
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthUserDelete(request, response, userId) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    if (!requireActorViewPermission(response, actor, "access", "eliminar usuarios")) return;
    await readJsonBody(request);
    sendJson(response, 200, deleteManagedAuthUser(userId, actor));
  } catch (error) {
    sendApiError(response, error);
  }
}

export async function handleAuthPreferencesUpdate(request, response) {
  try {
    const actor = requireAuthenticatedUser(request, response);
    if (!actor) return;
    const payload = await readJsonBody(request);
    sendJson(response, 200, {
      user: updateOwnAuthUserPreferences(actor.id, payload),
    });
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
  attachAuthenticatedActor(request);

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "sistema-de-mel-api" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1") {
    sendJson(response, 200, apiIndex());
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/organization/branding") {
    await handleOrganizationBranding(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/organization/list") {
    await handleOrganizationList(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/organization/list") {
    await handleOrganizationCreate(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/auth/sign-in") {
    await handleAuthSignIn(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/auth/session") {
    await handleAuthSession(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/organization/current") {
    await handleCurrentOrganization(request, response);
    return;
  }

  const organizationMatch = pathname.match(/^\/api\/v1\/organization\/([^/]+)$/);
  if (request.method === "PUT" && organizationMatch) {
    await handleOrganizationUpdate(request, response, decodeURIComponent(organizationMatch[1]));
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/auth/sign-out") {
    await handleAuthSignOut(request, response);
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

  if (request.method === "PATCH" && pathname === "/api/v1/auth/preferences") {
    await handleAuthPreferencesUpdate(request, response);
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

  const conceptPaperMatch = pathname.match(/^\/api\/v1\/concept-papers\/([^/]+)$/);
  if (request.method === "DELETE" && conceptPaperMatch) {
    await handleConceptPaperDelete(request, response, decodeURIComponent(conceptPaperMatch[1]));
    return;
  }

  const conceptPaperFileMatch = pathname.match(/^\/api\/v1\/concept-papers\/([^/]+)\/file$/);
  if (request.method === "GET" && conceptPaperFileMatch) {
    await handleConceptPaperFile(request, response, decodeURIComponent(conceptPaperFileMatch[1]));
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/program-manuals") {
    await handleProgramManuals(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/program-manuals") {
    await handleProgramManualCreate(request, response);
    return;
  }

  const programManualMatch = pathname.match(/^\/api\/v1\/program-manuals\/([^/]+)$/);
  if (request.method === "DELETE" && programManualMatch) {
    await handleProgramManualDelete(request, response, decodeURIComponent(programManualMatch[1]));
    return;
  }

  const programManualFileMatch = pathname.match(/^\/api\/v1\/program-manuals\/([^/]+)\/file$/);
  if (request.method === "GET" && programManualFileMatch) {
    await handleProgramManualFile(request, response, decodeURIComponent(programManualFileMatch[1]));
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/uploads") {
    await handleUploadCreate(request, response, url);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/uploads/file") {
    await handleUploadFile(request, response, url);
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

  if (request.method === "GET" && pathname === "/api/v1/form-submissions") {
    await handleFormSubmissionsList(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/form-submissions") {
    await handleFormSubmissionCreate(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/chat/conversations") {
    await handleChatConversationsList(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/chat/conversations") {
    await handleChatConversationCreate(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/chat/unread-count") {
    await handleChatUnreadCount(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/v1/chat/presence") {
    await handleChatPresenceHeartbeat(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/chat/directory") {
    await handleChatDirectory(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/v1/chat/search") {
    await handleChatSearch(request, response, url);
    return;
  }

  const chatConversationMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)$/);
  if (request.method === "GET" && chatConversationMatch) {
    await handleChatConversationDetail(request, response, decodeURIComponent(chatConversationMatch[1]));
    return;
  }
  if (request.method === "PATCH" && chatConversationMatch) {
    await handleChatConversationUpdate(request, response, decodeURIComponent(chatConversationMatch[1]));
    return;
  }
  if (request.method === "DELETE" && chatConversationMatch) {
    await handleChatConversationArchive(request, response, decodeURIComponent(chatConversationMatch[1]));
    return;
  }

  const chatMessagesMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/messages$/);
  if (request.method === "GET" && chatMessagesMatch) {
    await handleChatMessagesList(request, response, decodeURIComponent(chatMessagesMatch[1]), url);
    return;
  }

  if (request.method === "POST" && chatMessagesMatch) {
    await handleChatMessageCreate(request, response, decodeURIComponent(chatMessagesMatch[1]));
    return;
  }

  const chatMessageUpdateMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/messages\/([^/]+)$/);
  if (request.method === "PATCH" && chatMessageUpdateMatch) {
    await handleChatMessageUpdate(
      request,
      response,
      decodeURIComponent(chatMessageUpdateMatch[1]),
      decodeURIComponent(chatMessageUpdateMatch[2]),
    );
    return;
  }

  const chatReadMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/read$/);
  if (request.method === "POST" && chatReadMatch) {
    await handleChatConversationRead(request, response, decodeURIComponent(chatReadMatch[1]));
    return;
  }

  const chatPresenceMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/presence$/);
  if (request.method === "GET" && chatPresenceMatch) {
    await handleChatConversationPresence(request, response, decodeURIComponent(chatPresenceMatch[1]));
    return;
  }

  const chatTypingMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/typing$/);
  if (request.method === "POST" && chatTypingMatch) {
    await handleChatTypingUpdate(request, response, decodeURIComponent(chatTypingMatch[1]));
    return;
  }

  const chatParticipantsMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/participants$/);
  if (request.method === "POST" && chatParticipantsMatch) {
    await handleChatParticipantAdd(request, response, decodeURIComponent(chatParticipantsMatch[1]));
    return;
  }

  const chatParticipantDeleteMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)\/participants\/([^/]+)$/);
  if (request.method === "PATCH" && chatParticipantDeleteMatch) {
    await handleChatParticipantUpdate(
      request,
      response,
      decodeURIComponent(chatParticipantDeleteMatch[1]),
      decodeURIComponent(chatParticipantDeleteMatch[2]),
    );
    return;
  }
  if (request.method === "DELETE" && chatParticipantDeleteMatch) {
    await handleChatParticipantDelete(
      request,
      response,
      decodeURIComponent(chatParticipantDeleteMatch[1]),
      decodeURIComponent(chatParticipantDeleteMatch[2]),
    );
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

  if (request.method === "GET" && pathname === "/api/v1/platform-activity") {
    await handlePlatformActivityList(request, response, url);
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

  if (request.method === "GET" && pathname === "/api/v1/analytics/power-bi") {
    await handleAnalyticsPowerBi(request, response, url);
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

