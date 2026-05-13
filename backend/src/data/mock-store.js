import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedState } from "../../../frontend/src/data/seed-state.js";
import { REPORT_STATUSES, reviewRoleForStatus } from "../../../shared/contracts/reporting.js";

const STORE_VERSION = 1;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(dirname, "..", "..", "data");
const dataDir = process.env.MEL_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || defaultDataDir;
const melStorePath = process.env.MEL_STORE_DB_PATH || path.join(dataDir, "mel-store.json");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

const programs = seedState.programs.map((program) => ({
  id: `prog-${slugify(program.name)}`,
  ...structuredClone(program),
}));

function programIdByName() {
  return new Map(programs.map((program) => [program.name, program.id]));
}

const indicators = seedState.indicators.map((indicator) => ({
  ...structuredClone(indicator),
  programId: programIdByName().get(indicator.program) || null,
}));

function asList(value, fallback = []) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean) : fallback;
}

function normalizedConceptPaper(input = {}) {
  const timestamp = nowIso();
  const program = String(input.program || "");
  const fileName = String(input.fileName || input.name || "documento");
  return {
    id: String(input.id || `cp-${slugify(program || fileName)}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    program,
    title: String(input.title || fileName || "Concept paper"),
    presenter: String(input.presenter || input.uploadedBy || "Equipo M&E"),
    fileName,
    path: String(input.path || ""),
    dataUrl: input.dataUrl || null,
    mimeType: String(input.mimeType || input.type || "application/octet-stream"),
    size: asNumber(input.size),
    uploadedAt: input.uploadedAt || timestamp,
    uploadedBy: input.uploadedBy || null,
    year: String(input.year || timestamp.slice(0, 4)),
    status: String(input.status || "Cargado"),
    objective: String(input.objective || "Documento cargado por administracion para alimentar la biblioteca de Concept Papers."),
    beneficiaries: String(input.beneficiaries || "Pendiente de completar desde el documento cargado."),
    budget: String(input.budget || "Pendiente"),
    methodology: asList(input.methodology, ["Revisar metodologia dentro del documento adjunto."]),
    expectedImpact: asList(input.expectedImpact, ["Revisar impacto esperado dentro del documento adjunto."]),
    measurableResults: asList(input.measurableResults, ["Revisar resultados medibles dentro del documento adjunto."]),
    recommendedForms: asList(input.recommendedForms, ["Monitoreo semanal", "Evaluacion final"]),
    achievementIndicators: asList(input.achievementIndicators, ["Indicadores pendientes de definir desde el Concept Paper."]),
  };
}

const conceptPapers = seedState.conceptPapers.map(normalizedConceptPaper);
const reports = [];
const reportStatusHistory = [];
const deletedReports = [];
const notifications = [];
const emailOutbox = [];
const DEFAULT_COMPANY_ID = "org-default";

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(melStorePath), { recursive: true });
}

function readPersistentStore() {
  try {
    const raw = fs.readFileSync(melStorePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function replaceArray(target, nextItems = []) {
  target.splice(0, target.length, ...structuredClone(nextItems));
}

function snapshotStore() {
  return {
    storeVersion: STORE_VERSION,
    programs,
    indicators,
    conceptPapers,
    reports,
    reportStatusHistory,
    deletedReports,
    notifications,
    emailOutbox,
    updatedAt: nowIso(),
  };
}

function persistStore() {
  ensureStoreDir();
  fs.writeFileSync(melStorePath, `${JSON.stringify(snapshotStore(), null, 2)}\n`, "utf8");
}

function hydratePersistentStore() {
  const stored = readPersistentStore();
  if (!stored) {
    persistStore();
    return;
  }

  if (Array.isArray(stored.programs) && stored.programs.length) replaceArray(programs, stored.programs);
  if (Array.isArray(stored.indicators) && stored.indicators.length) replaceArray(indicators, stored.indicators);
  if (Array.isArray(stored.conceptPapers) && stored.conceptPapers.length) {
    replaceArray(conceptPapers, stored.conceptPapers.map(normalizedConceptPaper));
  }
  replaceArray(reports, Array.isArray(stored.reports) ? stored.reports.map(normalizedReport) : []);
  replaceArray(reportStatusHistory, Array.isArray(stored.reportStatusHistory) ? stored.reportStatusHistory : []);
  replaceArray(deletedReports, Array.isArray(stored.deletedReports) ? stored.deletedReports : []);
  replaceArray(notifications, Array.isArray(stored.notifications) ? stored.notifications : []);
  replaceArray(emailOutbox, Array.isArray(stored.emailOutbox) ? stored.emailOutbox : []);
}

function normalizedReport(input = {}) {
  const timestamp = nowIso();
  return {
    id: String(input.id || `rep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: String(input.companyId || DEFAULT_COMPANY_ID),
    date: String(input.date || timestamp.slice(0, 10)),
    period: String(input.period || timestamp.slice(0, 7)),
    program: String(input.program || ""),
    programId: input.programId || programIdByName().get(input.program) || null,
    province: String(input.province || "Centros de programa"),
    indicatorId: String(input.indicatorId || ""),
    value: asNumber(input.value),
    women: asNumber(input.women),
    men: asNumber(input.men),
    youth: asNumber(input.youth),
    owner: String(input.owner || ""),
    evidence: String(input.evidence || ""),
    notes: String(input.notes || ""),
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map((attachment) => ({
          id: String(attachment.id || `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
          name: String(attachment.name || attachment.fileName || "archivo"),
          type: String(attachment.type || attachment.mimeType || "application/octet-stream"),
          size: asNumber(attachment.size),
          uploadedAt: attachment.uploadedAt || timestamp,
          uploadedBy: attachment.uploadedBy || input.owner || null,
          dataUrl: attachment.dataUrl || null,
        }))
      : [],
    sourceFormId: input.sourceFormId || null,
    submissionId: input.submissionId || null,
    status: input.status || REPORT_STATUSES.PENDING_COORDINATION,
    reviewedBy: input.reviewedBy || null,
    reviewedAt: input.reviewedAt || null,
    reviewNote: input.reviewNote || null,
    correctionForRole: input.correctionForRole || null,
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function contactEmail(name, role) {
  const localPart = slugify(name || role || "usuario") || "usuario";
  return `${localPart}@pulso-me.local`;
}

function reviewRecipientsForReport(report) {
  const program = programs.find((item) => item.id === report.programId) || programs.find((item) => item.name === report.program);
  return {
    "Coordinador de programa": {
      role: "Coordinador de programa",
      name: program?.lead || `Coordinacion ${report.program}`,
      email: program?.coordinatorEmail || contactEmail(program?.lead || report.program, "coordinador"),
    },
    "Program Manager": {
      role: "Program Manager",
      name: "Program Manager",
      email: program?.programManagerEmail || "program-manager@pulso-me.local",
    },
    "Supervision M&E": {
      role: "Supervision M&E",
      name: "Supervision M&E",
      email: program?.melSupervisorEmail || "supervision-me@pulso-me.local",
    },
  };
}

function correctionRoleForStatus(status) {
  if (status === REPORT_STATUSES.PENDING_PROGRAM_MANAGER) return "Coordinador de programa";
  if (status === REPORT_STATUSES.PENDING_MEL) return "Program Manager";
  return "Facilitador";
}

function correctionRecipientForReport(report, role) {
  if (role === "Facilitador") {
    return {
      role,
      name: report.owner || "Facilitador",
      email: report.ownerEmail || contactEmail(report.owner || "facilitador", "facilitador"),
    };
  }
  return reviewRecipientsForReport(report)[role] || { role, name: role, email: contactEmail(role, role) };
}

function createEmailOutboxItem({ report, notification, recipient }) {
  const indicator = indicators.find((item) => item.id === report.indicatorId);
  const queuedAt = nowIso();
  const email = {
    id: `email-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: report.companyId || DEFAULT_COMPANY_ID,
    programId: report.programId,
    reportId: report.id,
    notificationId: notification.id,
    toRole: recipient.role,
    toName: recipient.name,
    toEmail: recipient.email,
    subject: `Nuevo reporte pendiente de aprobacion - ${report.program}`,
    body: [
      `Hay un nuevo reporte pendiente de revision para ${report.program}.`,
      `Indicador: ${indicator?.name || report.indicatorId}`,
      `Periodo: ${report.period}`,
      `Responsable: ${report.owner}`,
      `Valor reportado: ${report.value}`,
    ].join("\n"),
    provider: "pending-email-provider",
    status: "queued",
    queuedAt,
    sentAt: null,
    lastError: null,
  };
  emailOutbox.unshift(email);
  return email;
}

function createReviewNotificationsForReport(report) {
  const indicator = indicators.find((item) => item.id === report.indicatorId);
  const reviewRole = reviewRoleForStatus(report.status);
  const recipient = reviewRecipientsForReport(report)[reviewRole];
  if (!recipient) return [];

  return [recipient].map((stageRecipient) => {
    const notification = {
      id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      companyId: report.companyId || DEFAULT_COMPANY_ID,
      programId: report.programId,
      program: report.program,
      reportId: report.id,
      indicatorId: report.indicatorId,
      title: `Reporte pendiente: ${report.program}`,
      message: `${report.owner} envio ${report.value.toLocaleString("es-DO")} para ${indicator?.name || "un indicador"}.`,
      type: "report_review_requested",
      priority: "high",
      recipientRole: stageRecipient.role,
      recipientName: stageRecipient.name,
      recipientEmail: stageRecipient.email,
      status: "unread",
      createdAt: nowIso(),
      readAt: null,
    };
    notifications.unshift(notification);
    createEmailOutboxItem({ report, notification, recipient: stageRecipient });
    return structuredClone(notification);
  });
}

function createCorrectionNotificationForReport(report, recipientRole, note) {
  const indicator = indicators.find((item) => item.id === report.indicatorId);
  const recipient = correctionRecipientForReport(report, recipientRole);
  const notification = {
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: report.companyId || DEFAULT_COMPANY_ID,
    programId: report.programId,
    program: report.program,
    reportId: report.id,
    indicatorId: report.indicatorId,
    title: `Correccion solicitada: ${report.program}`,
    message: `Se solicito corregir ${indicator?.name || "un indicador"} (${report.period}). Nota: ${note}`,
    type: "report_correction_requested",
    priority: "high",
    recipientRole: recipient.role,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    status: "unread",
    correctionNote: note,
    createdAt: nowIso(),
    readAt: null,
  };
  notifications.unshift(notification);
  return structuredClone(notification);
}

function createSupervisorAuditNotification(report, action, actorRole = null) {
  const indicator = indicators.find((item) => item.id === report.indicatorId);
  const timestamp = nowIso();
  const notification = {
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: report.companyId || DEFAULT_COMPANY_ID,
    programId: report.programId,
    program: report.program,
    reportId: report.id,
    indicatorId: report.indicatorId,
    title: `Actividad de reporte: ${report.program}`,
    message: `${action} para ${indicator?.name || "un indicador"} (${report.period}). Estado actual: ${report.status}.`,
    type: "report_activity",
    priority: report.status === REPORT_STATUSES.PENDING_MEL ? "high" : "normal",
    recipientRole: "Supervision M&E",
    recipientName: "Supervision M&E",
    recipientEmail: reviewRecipientsForReport(report)["Supervision M&E"]?.email || "supervision-me@pulso-me.local",
    status: "unread",
    actorRole,
    createdAt: timestamp,
    readAt: null,
  };
  notifications.unshift(notification);
  return structuredClone(notification);
}

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeExpectedResults(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  return String(value || "")
    .split(/\n|;/)
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizedProgram(input = {}, existing = {}) {
  const name = normalizeString(input.name, existing.name);
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `prog-${slugify(name)}-${Date.now()}`),
    name,
    lead: normalizeString(input.lead, existing.lead || "Equipo de programa"),
    provinces: normalizeStringList(input.provinces?.length ? input.provinces : existing.provinces).length
      ? normalizeStringList(input.provinces?.length ? input.provinces : existing.provinces)
      : ["Centros de programa"],
    beneficiaries: asNumber(input.beneficiaries ?? existing.beneficiaries, 0),
    budget: normalizeString(input.budget, existing.budget || "No especificado"),
    focus: normalizeString(input.focus, existing.focus || "Programa en desarrollo"),
    expectedResults: normalizeExpectedResults(
      input.expectedResults?.length ? input.expectedResults : existing.expectedResults,
    ),
    primaryPopulation: normalizeString(
      input.primaryPopulation,
      existing.primaryPopulation || "Participantes del programa",
    ),
    coordinatorEmail: normalizeString(input.coordinatorEmail, existing.coordinatorEmail || ""),
    programManagerEmail: normalizeString(input.programManagerEmail, existing.programManagerEmail || ""),
    melSupervisorEmail: normalizeString(input.melSupervisorEmail, existing.melSupervisorEmail || ""),
    indicatorBlueprints: Array.isArray(input.indicatorBlueprints)
      ? structuredClone(input.indicatorBlueprints)
      : structuredClone(existing.indicatorBlueprints || []),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function normalizedIndicator(input = {}, existing = {}) {
  const program = programs.find((item) => item.id === input.programId) || programs.find((item) => item.name === input.program);
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `ind-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    program: program?.name || normalizeString(input.program, existing.program),
    programId: program?.id || input.programId || existing.programId || programIdByName().get(input.program) || null,
    name: normalizeString(input.name, existing.name),
    target: asNumber(input.target ?? existing.target, 0),
    value: asNumber(input.value ?? existing.value, 0),
    unit: normalizeString(input.unit, existing.unit || "unidades"),
    owner: normalizeString(input.owner, existing.owner || "Equipo M&E"),
    due: normalizeString(input.due, existing.due || "2026-12"),
    type: normalizeString(input.type, existing.type || "Logro"),
    source: normalizeString(input.source, existing.source || ""),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

hydratePersistentStore();

export function listPrograms() {
  return programs.map((program) => structuredClone(program));
}

export function findProgramById(programId) {
  return programs.find((program) => program.id === programId) || null;
}

export function createProgram(input) {
  const program = normalizedProgram(input);
  programs.push(program);
  persistStore();
  return structuredClone(program);
}

export function updateProgram(programId, input) {
  const index = programs.findIndex((program) => program.id === programId);
  if (index < 0) return null;

  const previous = programs[index];
  const next = normalizedProgram({ ...previous, ...input, id: previous.id }, previous);
  programs[index] = next;

  indicators.forEach((indicator) => {
    if (indicator.programId === previous.id || indicator.program === previous.name) {
      indicator.programId = next.id;
      indicator.program = next.name;
      indicator.updatedAt = nowIso();
    }
  });

  reports.forEach((report) => {
    if (report.programId === previous.id || report.program === previous.name) {
      report.programId = next.id;
      report.program = next.name;
      report.updatedAt = nowIso();
    }
  });

  persistStore();
  return structuredClone(next);
}

export function deleteProgram(programId) {
  const index = programs.findIndex((program) => program.id === programId);
  if (index < 0) return false;

  const hasIndicators = indicators.some((indicator) => indicator.programId === programId);
  const hasReports = reports.some((report) => report.programId === programId);
  if (hasIndicators || hasReports) {
    return { blocked: true, hasIndicators, hasReports };
  }

  programs.splice(index, 1);
  persistStore();
  return true;
}

export function listIndicators() {
  return indicators.map((indicator) => structuredClone(indicator));
}

export function findIndicatorById(indicatorId) {
  return indicators.find((indicator) => indicator.id === indicatorId) || null;
}

export function createIndicator(input) {
  const indicator = normalizedIndicator(input);
  indicators.push(indicator);
  persistStore();
  return structuredClone(indicator);
}

export function updateIndicator(indicatorId, input) {
  const index = indicators.findIndex((indicator) => indicator.id === indicatorId);
  if (index < 0) return null;

  const next = normalizedIndicator({ ...indicators[index], ...input, id: indicatorId }, indicators[index]);
  indicators[index] = next;
  persistStore();
  return structuredClone(next);
}

export function deleteIndicator(indicatorId) {
  const index = indicators.findIndex((indicator) => indicator.id === indicatorId);
  if (index < 0) return false;

  const hasReports = reports.some((report) => report.indicatorId === indicatorId);
  if (hasReports) {
    return { blocked: true, hasReports };
  }

  indicators.splice(index, 1);
  persistStore();
  return true;
}

export function listConceptPapers(filters = {}) {
  const { program, year, status } = filters;
  return conceptPapers
    .filter((paper) => {
      if (program && paper.program !== program) return false;
      if (year && paper.year !== year) return false;
      if (status && paper.status !== status) return false;
      return true;
    })
    .map((paper) => structuredClone(paper));
}

export function createConceptPaper(input = {}) {
  const paper = normalizedConceptPaper(input);
  conceptPapers.unshift(paper);
  persistStore();
  return structuredClone(paper);
}

export function queryReports(filters = {}) {
  const { program, programId, province, period } = filters;
  return reports
    .filter((report) => {
      if (program && report.program !== program) return false;
      if (programId && report.programId !== programId) return false;
      if (province && report.province !== province) return false;
      if (period && report.period !== period) return false;
      return true;
    })
    .map((report) => structuredClone(report));
}

export function createReport(input) {
  const report = normalizedReport(input);
  reports.unshift(report);
  reportStatusHistory.unshift({
    id: `hist-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    reportId: report.id,
    previousStatus: null,
    status: report.status,
    actorId: input.actorId || input.createdBy || null,
    actorRole: input.actorRole || "Facilitador",
    note: report.notes || "Reporte enviado a cadena de aprobacion.",
    createdAt: report.createdAt,
  });
  const reviewNotifications = createReviewNotificationsForReport(report);
  const supervisorNotification = createSupervisorAuditNotification(report, `${report.owner || "Un usuario"} envio un reporte`, "Facilitador");
  persistStore();
  return { ...structuredClone(report), reviewNotifications, supervisorNotification };
}

export function createReportsBulk(items = []) {
  return items.map((item) => createReport(item));
}

export function findReportById(reportId) {
  return reports.find((report) => report.id === reportId) || null;
}

export function deleteCorrectableReport(reportId, decision = {}) {
  const index = reports.findIndex((report) => report.id === reportId);
  if (index < 0) return null;

  const report = reports[index];
  const actorRole = decision.actorRole || null;
  const isSupervisorDelete = actorRole === "Supervision M&E";
  if (!isSupervisorDelete && report.status !== REPORT_STATUSES.NEEDS_CORRECTION) {
    const error = new Error("Solo puedes eliminar reportes que estan en correccion.");
    error.status = 409;
    throw error;
  }

  const allowedRole = report.correctionForRole || "Facilitador";
  if (!isSupervisorDelete && actorRole !== allowedRole) {
    const error = new Error(`Este reporte solo puede eliminarlo ${allowedRole}.`);
    error.status = 403;
    throw error;
  }

  const [deletedReport] = reports.splice(index, 1);
  const deletedAt = nowIso();
  const deletionStatus = isSupervisorDelete ? "Eliminado por supervision" : "Eliminado para correccion";
  const deletionNote =
    decision.note ||
    (isSupervisorDelete
      ? "Reporte eliminado definitivamente por supervision."
      : "Reporte eliminado para subir una version corregida.");
  reportStatusHistory.unshift({
    id: `hist-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    reportId,
    previousStatus: deletedReport.status,
    status: deletionStatus,
    actorId: decision.actorId || null,
    actorRole,
    note: deletionNote,
    createdAt: deletedAt,
  });
  deletedReports.unshift({
    ...structuredClone(deletedReport),
    deletedAt,
    deletedBy: decision.actorId || null,
    deletedByRole: actorRole,
    deletionStatus,
    deletionNote,
    previousStatus: deletedReport.status,
  });

  for (let i = notifications.length - 1; i >= 0; i -= 1) {
    if (notifications[i].reportId === reportId) notifications.splice(i, 1);
  }
  for (let i = emailOutbox.length - 1; i >= 0; i -= 1) {
    if (emailOutbox[i].reportId === reportId) emailOutbox.splice(i, 1);
  }

  persistStore();

  return structuredClone(deletedReport);
}

export function listDeletedReports(filters = {}) {
  const { program, programId, province, period, actorRole } = filters;
  const deletedById = new Map(deletedReports.map((report) => [report.id, structuredClone(report)]));
  reportStatusHistory
    .filter((entry) => String(entry.status || "").startsWith("Eliminado"))
    .forEach((entry) => {
      if (deletedById.has(entry.reportId)) return;
      deletedById.set(entry.reportId, {
        id: entry.reportId,
        deletedAt: entry.createdAt,
        deletedBy: entry.actorId || null,
        deletedByRole: entry.actorRole || null,
        deletionStatus: entry.status,
        deletionNote: entry.note || "",
        previousStatus: entry.previousStatus || null,
      });
    });

  return Array.from(deletedById.values())
    .filter((report) => {
      if (program && report.program !== program) return false;
      if (programId && report.programId !== programId) return false;
      if (province && report.province !== province) return false;
      if (period && report.period !== period) return false;
      if (actorRole && report.deletedByRole !== actorRole) return false;
      return true;
    })
    .map((report) => structuredClone(report));
}

export function saveReportStatusDecision(reportId, decision = {}) {
  const report = findReportById(reportId);
  if (!report) return null;

  const previousStatus = report.status;
  const nextStatus = decision.status || previousStatus;
  const changedAt = nowIso();

  report.status = nextStatus;
  report.reviewedBy = decision.actorId || report.reviewedBy;
  report.reviewedAt = changedAt;
  report.reviewNote = decision.note || null;
  report.correctionForRole =
    nextStatus === REPORT_STATUSES.NEEDS_CORRECTION ? correctionRoleForStatus(previousStatus) : null;
  report.updatedAt = changedAt;

  const historyEntry = {
    id: `hist-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    reportId,
    previousStatus,
    status: nextStatus,
    actorId: decision.actorId || null,
    actorRole: decision.actorRole || null,
    note: decision.note || "",
    createdAt: changedAt,
  };

  reportStatusHistory.unshift(historyEntry);
  const followUpNotifications =
    nextStatus === REPORT_STATUSES.NEEDS_CORRECTION
      ? [createCorrectionNotificationForReport(report, report.correctionForRole, decision.note || "Requiere correccion.")]
      : createReviewNotificationsForReport(report);
  const supervisorNotification = createSupervisorAuditNotification(
    report,
    `${decision.actorRole || "Un revisor"} cambio el estado de ${previousStatus} a ${nextStatus}`,
    decision.actorRole || null,
  );
  persistStore();
  return {
    report: structuredClone(report),
    historyEntry: structuredClone(historyEntry),
    followUpNotifications,
    supervisorNotification,
  };
}

export function listReportStatusHistory(reportId) {
  return reportStatusHistory
    .filter((entry) => entry.reportId === reportId)
    .map((entry) => structuredClone(entry));
}

export function listNotifications(filters = {}) {
  const { companyId, programId, reportId, recipientRole, status } = filters;
  return notifications
    .filter((notification) => {
      if (companyId && notification.companyId !== companyId) return false;
      if (programId && notification.programId !== programId) return false;
      if (reportId && notification.reportId !== reportId) return false;
      if (recipientRole && notification.recipientRole !== recipientRole) return false;
      if (status && notification.status !== status) return false;
      return true;
    })
    .map((notification) => structuredClone(notification));
}

export function markNotificationRead(notificationId, actorId = null) {
  const notification = notifications.find((item) => item.id === notificationId);
  if (!notification) return null;
  notification.status = "read";
  notification.readAt = nowIso();
  notification.readBy = actorId;
  persistStore();
  return structuredClone(notification);
}

export function listEmailOutbox(filters = {}) {
  const { companyId, programId, reportId, status } = filters;
  return emailOutbox
    .filter((email) => {
      if (companyId && email.companyId !== companyId) return false;
      if (programId && email.programId !== programId) return false;
      if (reportId && email.reportId !== reportId) return false;
      if (status && email.status !== status) return false;
      return true;
    })
    .map((email) => structuredClone(email));
}
