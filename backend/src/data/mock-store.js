import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedState } from "../../../frontend/src/data/seed-state.js";
import { REPORT_STATUSES, reviewRoleForStatus } from "../../../shared/contracts/reporting.js";

const STORE_VERSION = 1;
const DEFAULT_COMPANY_ID = "org-convoy-of-hope";
const DEFAULT_COMPANY_NAME = "Convoy of Hope";
const LEGACY_DEFAULT_COMPANY_IDS = new Set(["org-default"]);
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

function normalizeOrganizationId(value, fallback = DEFAULT_COMPANY_ID) {
  const normalized = String(value || "").trim();
  if (!normalized || LEGACY_DEFAULT_COMPANY_IDS.has(normalized)) {
    return fallback;
  }
  return normalized;
}

function normalizeOrganizationName(organizationId, value, fallback = DEFAULT_COMPANY_NAME) {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  return normalizeOrganizationId(organizationId) === DEFAULT_COMPANY_ID ? DEFAULT_COMPANY_NAME : normalized;
}

function hasLegacyDefaultOrganization(items = []) {
  return Array.isArray(items)
    ? items.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (LEGACY_DEFAULT_COMPANY_IDS.has(String(item.companyId || "").trim()) ||
            LEGACY_DEFAULT_COMPANY_IDS.has(String(item.organizationId || "").trim())),
      )
    : false;
}

const seededPrograms = seedState.programs.map((program) => ({
  id: `prog-${slugify(program.name)}`,
  companyId: DEFAULT_COMPANY_ID,
  organizationId: DEFAULT_COMPANY_ID,
  organizationName: DEFAULT_COMPANY_NAME,
  ...structuredClone(program),
}));
const programs = structuredClone(seededPrograms);
const seededProgramCenters = (seedState.programCenters || []).map((center) => ({
  id: `center-${slugify(center.program)}-${slugify(center.province)}-${slugify(center.name)}`,
  companyId: DEFAULT_COMPANY_ID,
  organizationId: DEFAULT_COMPANY_ID,
  organizationName: DEFAULT_COMPANY_NAME,
  ...structuredClone(center),
}));
const programCenters = structuredClone(seededProgramCenters);

function programIdByName() {
  return new Map(programs.map((program) => [program.name, program.id]));
}

const indicators = seedState.indicators.map((indicator) => ({
  ...structuredClone(indicator),
  companyId: DEFAULT_COMPANY_ID,
  organizationId: DEFAULT_COMPANY_ID,
  organizationName: DEFAULT_COMPANY_NAME,
  programId: programIdByName().get(indicator.program) || null,
}));

function asList(value, fallback = []) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean) : fallback;
}

function conceptProgramFromContent(input = {}, fallbackProgram = "") {
  const text = `${input.program || ""} ${input.title || ""} ${input.fileName || input.name || ""}`.toLowerCase();
  if (/\bcfa\b|\bcfi\b/.test(text)) return "Programa CFI";
  if (/\bhiga\b|\biga\b/.test(text)) return "IGA";
  if (/agricultura/.test(text)) return "Agricultura";
  if (/club de chicos|chicos/.test(text)) return "Club de Chicos";
  return fallbackProgram;
}

function bundledConceptPaperPath(input = {}) {
  const id = String(input.id || "");
  if (id === "cp-ge-2026") return "assets/concept-papers/girls-empowerment-concept-paper-2026.pdf";
  if (id === "cp-bc-2026") return "assets/concept-papers/club-de-chicos-concept-paper-2026.pdf";
  return "";
}

function normalizedConceptPaper(input = {}) {
  const timestamp = nowIso();
  const inputProgram = String(input.program || "");
  const program = conceptProgramFromContent(input, inputProgram);
  const programInfo = programs.find((item) => item.name === program) || {};
  const fileName = String(input.fileName || input.name || "documento");
  const title = String(input.title || fileName || "Concept paper").replace(/\bCFA\b/g, "CFI");
  const bundledPath = bundledConceptPaperPath(input);
  const blueprintNames = Array.isArray(programInfo.indicatorBlueprints)
    ? programInfo.indicatorBlueprints.map((item) => item.name).filter(Boolean)
    : [];
  const expectedResults = Array.isArray(programInfo.expectedResults) ? programInfo.expectedResults.filter(Boolean) : [];
  return {
    id: String(input.id || `cp-${slugify(program || fileName)}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeOrganizationId(input.companyId || input.organizationId),
    organizationId: normalizeOrganizationId(input.organizationId || input.companyId),
    organizationName: normalizeOrganizationName(input.organizationId || input.companyId, input.organizationName),
    program,
    title,
    presenter: String(input.presenter || input.uploadedBy || "Equipo M&E"),
    fileName,
    path: bundledPath || String(input.path || ""),
    dataUrl: input.dataUrl || null,
    mimeType: bundledPath ? "application/pdf" : String(input.mimeType || input.type || "application/pdf"),
    size: asNumber(input.size),
    uploadedAt: input.uploadedAt || timestamp,
    uploadedBy: input.uploadedBy || null,
    year: String(input.year || timestamp.slice(0, 4)),
    status: String(input.status || "Cargado"),
    objective: String(input.objective || programInfo.focus || "Documento cargado por administracion para alimentar la biblioteca de Concept Papers."),
    beneficiaries: String(input.beneficiaries || programInfo.primaryPopulation || "Pendiente de completar desde el documento cargado."),
    budget: String(input.budget || programInfo.budget || "Pendiente"),
    methodology: asList(input.methodology, expectedResults.length ? expectedResults : ["Revisar metodologia dentro del documento adjunto."]),
    expectedImpact: asList(input.expectedImpact, expectedResults.length ? expectedResults : ["Revisar impacto esperado dentro del documento adjunto."]),
    measurableResults: asList(input.measurableResults, blueprintNames.length ? blueprintNames : ["Revisar resultados medibles dentro del documento adjunto."]),
    recommendedForms: asList(input.recommendedForms, ["Monitoreo semanal", "Evaluacion final"]),
    achievementIndicators: asList(input.achievementIndicators, blueprintNames.length ? blueprintNames : ["Indicadores pendientes de definir desde el Concept Paper."]),
  };
}

function normalizedProgramManual(input = {}) {
  const timestamp = nowIso();
  const program = String(input.program || "");
  const fileName = String(input.fileName || input.name || "manual.pdf");
  return {
    id: String(input.id || `manual-${slugify(program || fileName)}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeOrganizationId(input.companyId || input.organizationId),
    organizationId: normalizeOrganizationId(input.organizationId || input.companyId),
    organizationName: normalizeOrganizationName(input.organizationId || input.companyId, input.organizationName),
    program,
    title: String(input.title || fileName || "Manual de programa"),
    fileName,
    path: String(input.path || ""),
    fileUrl: String(input.fileUrl || ""),
    dataUrl: input.dataUrl || null,
    mimeType: String(input.mimeType || input.type || "application/pdf"),
    size: asNumber(input.size),
    uploadedAt: input.uploadedAt || timestamp,
    uploadedBy: input.uploadedBy || null,
    year: String(input.year || timestamp.slice(0, 4)),
    status: String(input.status || "Cargado"),
    version: String(input.version || "1.0"),
    notes: String(input.notes || ""),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

const conceptPapers = seedState.conceptPapers.map(normalizedConceptPaper);
const programManuals = [];
const reports = [];
const reportStatusHistory = [];
const deletedReports = [];
const deletedLibraryDocuments = [];
const formSubmissions = [];
const attendanceParticipants = [];
const attendanceSessions = [];
const attendanceArchive = [];
const notifications = [];
const emailOutbox = [];
const chatConversations = [];
const chatParticipants = [];
const chatMessages = [];
const chatReads = [];
const chatNotifications = [];
function attendanceProgramNames() {
  const names = programs.map((program) => normalizeString(program.name)).filter(Boolean);
  return names.length ? names : ["Programa general"];
}

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

function mergeMissingByKey(target, source, keyFn) {
  source.forEach((item) => {
    const key = keyFn(item);
    if (!target.some((candidate) => keyFn(candidate) === key)) {
      target.push(structuredClone(item));
    }
  });
}

function normalizedAttendanceParticipant(input = {}) {
  const timestamp = nowIso();
  const validPrograms = attendanceProgramNames();
  const requestedProgram = normalizeString(input.program);
  const program = validPrograms.includes(requestedProgram) ? requestedProgram : validPrograms[0];
  return {
    id: normalizeString(input.id, `attp-${slugify(program)}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeString(input.companyId, DEFAULT_COMPANY_ID),
    organizationId: normalizeString(input.organizationId, input.companyId || DEFAULT_COMPANY_ID),
    organizationName: normalizeString(input.organizationName, DEFAULT_COMPANY_NAME),
    program,
    name: normalizeString(input.name, "Participante"),
    status: normalizeString(input.status, "active"),
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function normalizedAttendanceSession(input = {}) {
  const timestamp = nowIso();
  const validPrograms = attendanceProgramNames();
  const requestedProgram = normalizeString(input.program);
  const program = validPrograms.includes(requestedProgram) ? requestedProgram : validPrograms[0];
  const weekStart = normalizeString(input.weekStart || input.date, timestamp.slice(0, 10));
  const center = normalizeString(input.center, "General");
  const period = normalizeString(input.period, weekStart.slice(0, 7));
  const actorRole = normalizeString(input.actorRole, "");
  return {
    id: normalizeString(input.id, `atts-${slugify(program)}-${slugify(center)}-${period}-${weekStart}`),
    companyId: normalizeString(input.companyId, DEFAULT_COMPANY_ID),
    organizationId: normalizeString(input.organizationId, input.companyId || DEFAULT_COMPANY_ID),
    organizationName: normalizeString(input.organizationName, DEFAULT_COMPANY_NAME),
    program,
    weekStart,
    center,
    period,
    entries: Array.isArray(input.entries)
      ? input.entries.map((entry) => {
          const status = ["present", "absent", "excused"].includes(entry.status)
            ? entry.status
            : Boolean(entry.present)
              ? "present"
              : "absent";
          return {
            participantId: normalizeString(entry.participantId || entry.id),
            name: normalizeString(entry.name, "Participante"),
            status,
            present: status === "present",
            excuseNote: normalizeString(entry.excuseNote, ""),
          };
        })
      : [],
    notes: normalizeString(input.notes, ""),
    recordedBy: normalizeString(input.recordedBy, ""),
    actorRole,
    locked: input.locked !== undefined ? Boolean(input.locked) : true,
    editRequest: input.editRequest || null,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function snapshotStore() {
  return {
    storeVersion: STORE_VERSION,
    programs,
    indicators,
    conceptPapers,
    programManuals,
    programCenters,
    reports,
    reportStatusHistory,
    deletedReports,
    deletedLibraryDocuments,
    formSubmissions,
    attendanceParticipants,
    attendanceSessions,
    attendanceArchive,
    notifications,
    emailOutbox,
    chatConversations,
    chatParticipants,
    chatMessages,
    chatReads,
    chatNotifications,
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
  let shouldPersistAfterMigration = false;
  if (
    hasLegacyDefaultOrganization(stored.conceptPapers) ||
    hasLegacyDefaultOrganization(stored.programManuals) ||
    hasLegacyDefaultOrganization(stored.reports) ||
    hasLegacyDefaultOrganization(stored.formSubmissions)
  ) {
    shouldPersistAfterMigration = true;
  }

  if (Array.isArray(stored.programs) && stored.programs.length) replaceArray(programs, stored.programs);
  if (Array.isArray(stored.indicators) && stored.indicators.length) replaceArray(indicators, stored.indicators);
  if (Array.isArray(stored.conceptPapers)) {
    replaceArray(conceptPapers, stored.conceptPapers.map(normalizedConceptPaper));
  }
  replaceArray(programManuals, Array.isArray(stored.programManuals) ? stored.programManuals.map(normalizedProgramManual) : []);
  replaceArray(deletedLibraryDocuments, Array.isArray(stored.deletedLibraryDocuments) ? stored.deletedLibraryDocuments : []);
  mergeMissingByKey(programs, seededPrograms, (program) => program.name);
  if (Array.isArray(stored.programCenters)) {
    replaceArray(programCenters, stored.programCenters.map(normalizedProgramCenter));
  } else {
    mergeMissingByKey(programCenters, seededProgramCenters, (center) => `${center.program}|${center.province}|${center.name}`);
  }
  const deletedConceptPaperIds = new Set(
    deletedLibraryDocuments.filter((item) => item.type === "concept-paper").map((item) => item.id),
  );
  mergeMissingByKey(
    conceptPapers,
    seedState.conceptPapers.map(normalizedConceptPaper).filter((paper) => !deletedConceptPaperIds.has(paper.id)),
    (paper) => paper.id,
  );
  replaceArray(reports, Array.isArray(stored.reports) ? stored.reports.map(normalizedReport) : []);
  replaceArray(reportStatusHistory, Array.isArray(stored.reportStatusHistory) ? stored.reportStatusHistory : []);
  replaceArray(deletedReports, Array.isArray(stored.deletedReports) ? stored.deletedReports : []);
  replaceArray(formSubmissions, Array.isArray(stored.formSubmissions) ? stored.formSubmissions.map(normalizedFormSubmission) : []);
  replaceArray(
    attendanceParticipants,
    Array.isArray(stored.attendanceParticipants) ? stored.attendanceParticipants.map(normalizedAttendanceParticipant) : [],
  );
  replaceArray(
    attendanceSessions,
    Array.isArray(stored.attendanceSessions) ? stored.attendanceSessions.map(normalizedAttendanceSession) : [],
  );
  replaceArray(attendanceArchive, Array.isArray(stored.attendanceArchive) ? stored.attendanceArchive : []);
  replaceArray(notifications, Array.isArray(stored.notifications) ? stored.notifications : []);
  replaceArray(emailOutbox, Array.isArray(stored.emailOutbox) ? stored.emailOutbox : []);
  replaceArray(chatConversations, Array.isArray(stored.chatConversations) ? stored.chatConversations.map(normalizedChatConversation) : []);
  replaceArray(chatParticipants, Array.isArray(stored.chatParticipants) ? stored.chatParticipants.map(normalizedChatParticipant) : []);
  replaceArray(chatMessages, Array.isArray(stored.chatMessages) ? stored.chatMessages.map(normalizedChatMessage) : []);
  replaceArray(chatReads, Array.isArray(stored.chatReads) ? stored.chatReads.map(normalizedChatRead) : []);
  replaceArray(chatNotifications, Array.isArray(stored.chatNotifications) ? stored.chatNotifications.map(normalizedChatNotification) : []);
  if (shouldPersistAfterMigration) {
    persistStore();
  }
}

function normalizedReport(input = {}) {
  const timestamp = nowIso();
  const participantBreakdown = {
    women: asNumber(input.participantBreakdown?.women ?? input.women),
    men: asNumber(input.participantBreakdown?.men ?? input.men),
    adolescents: asNumber(input.participantBreakdown?.adolescents ?? input.adolescents ?? input.youth),
    children: asNumber(input.participantBreakdown?.children ?? input.children),
  };
  return {
    id: String(input.id || `rep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeOrganizationId(input.companyId),
    organizationId: normalizeOrganizationId(input.organizationId || input.companyId),
    organizationName: normalizeOrganizationName(input.organizationId || input.companyId, input.organizationName),
    date: String(input.date || timestamp.slice(0, 10)),
    period: String(input.period || timestamp.slice(0, 7)),
    program: String(input.program || ""),
    programId: input.programId || programIdByName().get(input.program) || null,
    province: String(input.province || "Centros de programa"),
    center: String(input.center || input.centre || ""),
    indicatorId: String(input.indicatorId || ""),
    value: asNumber(input.value),
    women: participantBreakdown.women,
    men: participantBreakdown.men,
    adolescents: participantBreakdown.adolescents,
    children: participantBreakdown.children,
    youth: participantBreakdown.adolescents,
    participantBreakdown,
    owner: String(input.owner || ""),
    ownerUserId: input.ownerUserId || null,
    ownerEmail: String(input.ownerEmail || ""),
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
          path: String(attachment.path || ""),
          fileUrl: String(attachment.fileUrl || ""),
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

function normalizedFormSubmission(input = {}) {
  const timestamp = nowIso();
  const attachments = Array.isArray(input.attachments)
    ? input.attachments
        .map((attachment) => ({
          id: String(attachment.id || `subatt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
          name: String(attachment.name || attachment.fileName || "archivo"),
          fileName: String(attachment.fileName || attachment.name || "archivo"),
          type: String(attachment.type || attachment.mimeType || "application/octet-stream"),
          mimeType: String(attachment.mimeType || attachment.type || "application/octet-stream"),
          size: asNumber(attachment.size),
          path: String(attachment.path || ""),
          fileUrl: String(attachment.fileUrl || ""),
          dataUrl: attachment.dataUrl || null,
          uploadedAt: attachment.uploadedAt || timestamp,
          uploadedBy: attachment.uploadedBy || input.importedBy || null,
        }))
        .filter((attachment) => attachment.name)
    : [];

  return {
    id: String(input.id || `sub-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeOrganizationId(input.companyId || input.organizationId),
    organizationId: normalizeOrganizationId(input.organizationId || input.companyId),
    organizationName: normalizeOrganizationName(input.organizationId || input.companyId, input.organizationName),
    fileName: normalizeString(input.fileName, "formulario.csv"),
    formId: input.formId || null,
    formTitle: normalizeString(input.formTitle, input.fileName || "Formulario importado"),
    program: normalizeString(input.program, ""),
    period: normalizeString(input.period, timestamp.slice(0, 7)),
    reportCount: asNumber(input.reportCount),
    importedAt: input.importedAt || timestamp,
    sourceType: normalizeString(input.sourceType, "csv"),
    processing: normalizeString(input.processing, "automatico"),
    sourceFormId: input.sourceFormId || input.formId || null,
    reportIds: Array.isArray(input.reportIds) ? input.reportIds.map((reportId) => String(reportId || "")).filter(Boolean) : [],
    attachments,
    importedBy: normalizeString(input.importedBy, ""),
    importedByRole: normalizeString(input.importedByRole, ""),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function normalizedProgramCenter(input = {}, existing = {}) {
  const timestamp = nowIso();
  const program = normalizeString(input.program, existing.program);
  const province = normalizeString(input.province, existing.province);
  const name = normalizeString(input.name, existing.name);
  return {
    id: normalizeString(input.id, existing.id || `center-${slugify(program)}-${slugify(province)}-${Date.now()}`),
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(input.organizationId, existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
    program,
    programId: input.programId || existing.programId || programIdByName().get(program) || null,
    province,
    name,
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function normalizeProgramCenterEntries(value, program) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const province = normalizeString(entry.province);
      const name = normalizeString(entry.name);
      if (!province || !name) return null;
      const key = `${province.toLowerCase()}|${name.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { program, province, name };
    })
    .filter(Boolean);
}

function syncProgramCentersForProgram(program, centerEntries = []) {
  const desiredCenters = normalizeProgramCenterEntries(centerEntries, program.name);
  const keepKeys = new Set(desiredCenters.map((center) => `${center.province.toLowerCase()}|${center.name.toLowerCase()}`));

  for (let index = programCenters.length - 1; index >= 0; index -= 1) {
    const center = programCenters[index];
    if (center.programId !== program.id && center.program !== program.name) continue;
    const key = `${String(center.province || "").toLowerCase()}|${String(center.name || "").toLowerCase()}`;
    if (!keepKeys.has(key)) {
      programCenters.splice(index, 1);
    }
  }

  desiredCenters.forEach((center) => {
    const existing = programCenters.find(
      (item) =>
        (item.programId === program.id || item.program === program.name) &&
        item.province.toLowerCase() === center.province.toLowerCase() &&
        item.name.toLowerCase() === center.name.toLowerCase(),
    );
    if (existing) {
      existing.companyId = program.companyId || existing.companyId || DEFAULT_COMPANY_ID;
      existing.organizationId = program.organizationId || existing.organizationId || DEFAULT_COMPANY_ID;
      existing.organizationName = program.organizationName || existing.organizationName || DEFAULT_COMPANY_NAME;
      existing.program = program.name;
      existing.programId = program.id;
      existing.province = center.province;
      existing.name = center.name;
      existing.updatedAt = nowIso();
      return;
    }
    programCenters.push(
      normalizedProgramCenter({
        companyId: program.companyId || DEFAULT_COMPANY_ID,
        organizationId: program.organizationId || DEFAULT_COMPANY_ID,
        organizationName: program.organizationName || DEFAULT_COMPANY_NAME,
        program: program.name,
        programId: program.id,
        province: center.province,
        name: center.name,
      }),
    );
  });

  return listProgramCenters({ organizationId: program.organizationId || program.companyId || DEFAULT_COMPANY_ID, program: program.name });
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
      `Dato reportado: ${report.value}`,
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

function normalizeBoolean(value, fallback = false) {
  return value === undefined ? Boolean(fallback) : Boolean(value);
}

function normalizedChatConversation(input = {}, existing = {}) {
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(
      input.organizationId,
      existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID,
    ),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
    type: normalizeString(input.type, existing.type || "direct"),
    title: normalizeString(input.title, existing.title || ""),
    description: normalizeString(input.description, existing.description || ""),
    contextType: normalizeString(input.contextType, existing.contextType || ""),
    contextId: normalizeString(input.contextId, existing.contextId || ""),
    createdByUserId: normalizeString(input.createdByUserId, existing.createdByUserId || ""),
    archivedByUserId: normalizeString(input.archivedByUserId, existing.archivedByUserId || ""),
    isArchived: normalizeBoolean(input.isArchived, existing.isArchived || false),
    lastMessageAt: normalizeString(input.lastMessageAt, existing.lastMessageAt || input.createdAt || timestamp),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function normalizedChatParticipant(input = {}, existing = {}) {
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `chatp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(
      input.organizationId,
      existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID,
    ),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
    conversationId: normalizeString(input.conversationId, existing.conversationId || ""),
    userId: normalizeString(input.userId, existing.userId || ""),
    participantRole: normalizeString(input.participantRole, existing.participantRole || "member"),
    canSendMessages: normalizeBoolean(input.canSendMessages, existing.canSendMessages !== false),
    canAddPeople: normalizeBoolean(input.canAddPeople, existing.canAddPeople || false),
    canRemovePeople: normalizeBoolean(input.canRemovePeople, existing.canRemovePeople || false),
    isMuted: normalizeBoolean(input.isMuted, existing.isMuted || false),
    joinedAt: existing.joinedAt || input.joinedAt || timestamp,
    leftAt: input.leftAt === null ? null : normalizeString(input.leftAt, existing.leftAt || ""),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function normalizedChatAttachment(input = {}) {
  return {
    id: normalizeString(input.id, `chata-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    organizationId: normalizeString(input.organizationId, input.companyId || DEFAULT_COMPANY_ID),
    companyId: normalizeString(input.companyId, input.organizationId || DEFAULT_COMPANY_ID),
    fileName: normalizeString(input.fileName || input.name, "archivo"),
    originalFileName: normalizeString(input.originalFileName || input.fileName || input.name, "archivo"),
    mimeType: normalizeString(input.mimeType || input.type, "application/octet-stream"),
    fileSizeBytes: asNumber(input.fileSizeBytes ?? input.size, 0),
    storagePath: normalizeString(input.storagePath || input.path, ""),
    fileUrl: normalizeString(input.fileUrl, ""),
    uploadedByUserId: normalizeString(input.uploadedByUserId || input.uploadedBy, ""),
    createdAt: normalizeString(input.createdAt, nowIso()),
  };
}

function normalizedChatMessage(input = {}, existing = {}) {
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(
      input.organizationId,
      existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID,
    ),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
    conversationId: normalizeString(input.conversationId, existing.conversationId || ""),
    senderUserId: normalizeString(input.senderUserId, existing.senderUserId || ""),
    messageType: normalizeString(input.messageType, existing.messageType || "text"),
    body: String(input.body ?? existing.body ?? "").trim(),
    replyToMessageId: normalizeString(input.replyToMessageId, existing.replyToMessageId || ""),
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map(normalizedChatAttachment)
      : Array.isArray(existing.attachments)
        ? existing.attachments.map(normalizedChatAttachment)
        : [],
    isEdited: normalizeBoolean(input.isEdited, existing.isEdited || false),
    editedAt: input.editedAt === null ? null : normalizeString(input.editedAt, existing.editedAt || ""),
    isDeleted: normalizeBoolean(input.isDeleted, existing.isDeleted || false),
    deletedAt: input.deletedAt === null ? null : normalizeString(input.deletedAt, existing.deletedAt || ""),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function normalizedChatRead(input = {}, existing = {}) {
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `read-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(
      input.organizationId,
      existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID,
    ),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
    conversationId: normalizeString(input.conversationId, existing.conversationId || ""),
    messageId: normalizeString(input.messageId, existing.messageId || ""),
    userId: normalizeString(input.userId, existing.userId || ""),
    deliveredAt: normalizeString(input.deliveredAt, existing.deliveredAt || timestamp),
    readAt: normalizeString(input.readAt, existing.readAt || timestamp),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function normalizedChatNotification(input = {}, existing = {}) {
  const timestamp = nowIso();
  return {
    id: normalizeString(input.id, existing.id || `chatn-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(
      input.organizationId,
      existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID,
    ),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
    userId: normalizeString(input.userId, existing.userId || ""),
    conversationId: normalizeString(input.conversationId, existing.conversationId || ""),
    messageId: normalizeString(input.messageId, existing.messageId || ""),
    notificationType: normalizeString(input.notificationType, existing.notificationType || "new_message"),
    isSeen: normalizeBoolean(input.isSeen, existing.isSeen || false),
    seenAt: input.seenAt === null ? null : normalizeString(input.seenAt, existing.seenAt || ""),
    createdAt: existing.createdAt || input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
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
    companyId: normalizeString(input.companyId, existing.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(input.organizationId, existing.organizationId || input.companyId || existing.companyId || DEFAULT_COMPANY_ID),
    organizationName: normalizeString(input.organizationName, existing.organizationName || DEFAULT_COMPANY_NAME),
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
    companyId: normalizeString(input.companyId, existing.companyId || program?.companyId || DEFAULT_COMPANY_ID),
    organizationId: normalizeString(
      input.organizationId,
      existing.organizationId || program?.organizationId || input.companyId || program?.companyId || DEFAULT_COMPANY_ID,
    ),
    organizationName: normalizeString(input.organizationName, existing.organizationName || program?.organizationName || DEFAULT_COMPANY_NAME),
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

export function listPrograms(filters = {}) {
  const { companyId, organizationId } = filters;
  return programs
    .filter((program) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (program.organizationId || program.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      return true;
    })
    .map((program) => structuredClone(program));
}

export function listProgramCenters(filters = {}) {
  const { companyId, organizationId, program, province } = filters;
  return programCenters
    .filter((center) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (center.organizationId || center.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && center.program !== program) return false;
      if (province && center.province !== province) return false;
      return true;
    })
    .map((center) => structuredClone(center));
}

export function createProgramCenter(input) {
  const center = normalizedProgramCenter(input);
  const duplicate = programCenters.find(
    (item) =>
      (item.organizationId || item.companyId || DEFAULT_COMPANY_ID) === (center.organizationId || center.companyId || DEFAULT_COMPANY_ID) &&
      item.program === center.program &&
      item.province === center.province &&
      item.name.toLowerCase() === center.name.toLowerCase(),
  );
  if (duplicate) return structuredClone(duplicate);
  programCenters.push(center);
  persistStore();
  return structuredClone(center);
}

export function updateProgramCenter(centerId, input) {
  const index = programCenters.findIndex((center) => center.id === centerId);
  if (index < 0) return null;
  const next = normalizedProgramCenter({ ...programCenters[index], ...input, id: centerId }, programCenters[index]);
  programCenters[index] = next;
  persistStore();
  return structuredClone(next);
}

export function deleteProgramCenter(centerId, input = {}) {
  let index = programCenters.findIndex((center) => center.id === centerId);
  if (index < 0) {
    const program = normalizeString(input.program);
    const province = normalizeString(input.province);
    const name = normalizeString(input.name);
    if (program && province && name) {
      index = programCenters.findIndex(
        (center) =>
          center.program === program &&
          center.province === province &&
          center.name.toLowerCase() === name.toLowerCase(),
      );
    }
  }
  if (index < 0) return null;
  const [deleted] = programCenters.splice(index, 1);
  persistStore();
  return structuredClone(deleted);
}

export function findProgramById(programId) {
  return programs.find((program) => program.id === programId) || null;
}

export function createProgram(input) {
  const program = normalizedProgram(input);
  programs.push(program);
  const centers = Array.isArray(input.centers) ? syncProgramCentersForProgram(program, input.centers) : [];
  persistStore();
  return {
    ...structuredClone(program),
    centers,
  };
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

  programCenters.forEach((center) => {
    if (center.programId === previous.id || center.program === previous.name) {
      center.programId = next.id;
      center.program = next.name;
      center.updatedAt = nowIso();
    }
  });

  const centers = Array.isArray(input.centers) ? syncProgramCentersForProgram(next, input.centers) : [];

  persistStore();
  return {
    ...structuredClone(next),
    centers,
  };
}

export function deleteProgram(programId) {
  const index = programs.findIndex((program) => program.id === programId);
  if (index < 0) return false;

  const hasIndicators = indicators.some((indicator) => indicator.programId === programId);
  const hasReports = reports.some((report) => report.programId === programId);
  if (hasIndicators || hasReports) {
    return { blocked: true, hasIndicators, hasReports };
  }

  const program = programs[index];
  programs.splice(index, 1);
  for (let centerIndex = programCenters.length - 1; centerIndex >= 0; centerIndex -= 1) {
    if (programCenters[centerIndex].programId === programId || programCenters[centerIndex].program === program.name) {
      programCenters.splice(centerIndex, 1);
    }
  }
  persistStore();
  return true;
}

export function listIndicators(filters = {}) {
  const { companyId, organizationId, programId, program } = filters;
  return indicators
    .filter((indicator) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (indicator.organizationId || indicator.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (programId && indicator.programId !== programId) return false;
      if (program && indicator.program !== program) return false;
      return true;
    })
    .map((indicator) => structuredClone(indicator));
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
  const { companyId, organizationId, program, year, status } = filters;
  return conceptPapers
    .filter((paper) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (paper.organizationId || paper.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && paper.program !== program) return false;
      if (year && paper.year !== year) return false;
      if (status && paper.status !== status) return false;
      return true;
    })
    .map((paper) => structuredClone(paper));
}

export function findConceptPaperById(conceptPaperId) {
  return conceptPapers.find((paper) => paper.id === conceptPaperId) || null;
}

export function createConceptPaper(input = {}) {
  const paper = normalizedConceptPaper(input);
  conceptPapers.unshift(paper);
  persistStore();
  return structuredClone(paper);
}

function archiveLibraryDocument(type, document, options = {}) {
  const timestamp = nowIso();
  const existingIndex = deletedLibraryDocuments.findIndex((item) => item.type === type && item.id === document.id);
  if (existingIndex >= 0) {
    deletedLibraryDocuments.splice(existingIndex, 1);
  }
  deletedLibraryDocuments.unshift({
    type,
    id: document.id,
    title: document.title || document.fileName || "",
    program: document.program || "",
    fileName: document.fileName || "",
    path: document.path || "",
    mimeType: document.mimeType || "",
    deletedAt: timestamp,
    deletedBy: normalizeString(options.actorId || options.deletedBy, ""),
    deletedByRole: normalizeString(options.actorRole, ""),
    reason: normalizeString(options.reason, ""),
    snapshot: structuredClone(document),
  });
}

function findDeletedLibraryDocument(type, documentId) {
  return deletedLibraryDocuments.find((item) => item.type === type && item.id === documentId) || null;
}

function requireSupervisorLibraryDelete(options = {}) {
  const actorRole = normalizeString(options.actorRole, "");
  if (actorRole !== "Supervision M&E") {
    const error = new Error("Solo Supervision M&E puede eliminar documentos de la biblioteca.");
    error.status = 403;
    throw error;
  }
}

export function deleteConceptPaper(conceptPaperId, options = {}) {
  requireSupervisorLibraryDelete(options);
  const index = conceptPapers.findIndex((paper) => paper.id === conceptPaperId);
  if (index < 0) {
    const alreadyDeleted = findDeletedLibraryDocument("concept-paper", conceptPaperId);
    if (alreadyDeleted?.snapshot) {
      return structuredClone(alreadyDeleted.snapshot);
    }
    const seededPaper = seedState.conceptPapers.find((paper) => paper.id === conceptPaperId);
    if (!seededPaper) return null;
    const normalizedSeed = normalizedConceptPaper(seededPaper);
    archiveLibraryDocument("concept-paper", normalizedSeed, options);
    persistStore();
    return structuredClone(normalizedSeed);
  }

  const [deleted] = conceptPapers.splice(index, 1);
  archiveLibraryDocument("concept-paper", deleted, options);
  persistStore();
  return structuredClone(deleted);
}

export function listProgramManuals(filters = {}) {
  const { companyId, organizationId, program, year, status } = filters;
  return programManuals
    .filter((manual) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (manual.organizationId || manual.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && manual.program !== program) return false;
      if (year && manual.year !== year) return false;
      if (status && manual.status !== status) return false;
      return true;
    })
    .map((manual) => structuredClone(manual));
}

export function findProgramManualById(manualId) {
  return programManuals.find((manual) => manual.id === manualId) || null;
}

export function createProgramManual(input = {}) {
  const manual = normalizedProgramManual(input);
  programManuals.unshift(manual);
  persistStore();
  return structuredClone(manual);
}

export function deleteProgramManual(manualId, options = {}) {
  requireSupervisorLibraryDelete(options);
  const index = programManuals.findIndex((manual) => manual.id === manualId);
  if (index < 0) {
    const alreadyDeleted = findDeletedLibraryDocument("program-manual", manualId);
    if (alreadyDeleted?.snapshot) {
      return structuredClone(alreadyDeleted.snapshot);
    }
    return null;
  }

  const [deleted] = programManuals.splice(index, 1);
  archiveLibraryDocument("program-manual", deleted, options);
  persistStore();
  return structuredClone(deleted);
}

export function isLibraryDocumentPathDeleted(storagePath = "") {
  const normalizedPath = String(storagePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedPath) return false;
  return deletedLibraryDocuments.some((document) => {
    const documentPath = String(document.path || document.snapshot?.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return documentPath === normalizedPath;
  });
}

export function listFormSubmissions(filters = {}) {
  const { companyId, organizationId, program, period, formId, processing, sourceType } = filters;
  return formSubmissions
    .filter((submission) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (submission.organizationId || submission.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && submission.program !== program) return false;
      if (period && submission.period !== period) return false;
      if (formId && submission.formId !== formId && submission.sourceFormId !== formId) return false;
      if (processing && submission.processing !== processing) return false;
      if (sourceType && submission.sourceType !== sourceType) return false;
      return true;
    })
    .sort((left, right) => String(right.importedAt || right.createdAt || "").localeCompare(String(left.importedAt || left.createdAt || "")))
    .map((submission) => structuredClone(submission));
}

export function createFormSubmission(input = {}) {
  const submission = normalizedFormSubmission(input);
  const index = formSubmissions.findIndex((item) => item.id === submission.id);
  if (index >= 0) {
    formSubmissions[index] = {
      ...formSubmissions[index],
      ...submission,
      createdAt: formSubmissions[index].createdAt || submission.createdAt,
      updatedAt: nowIso(),
    };
  } else {
    formSubmissions.unshift(submission);
  }
  persistStore();
  return structuredClone(index >= 0 ? formSubmissions[index] : submission);
}

export function listAttendanceParticipants(filters = {}) {
  const { companyId, organizationId, program, status } = filters;
  return attendanceParticipants
    .filter((participant) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (participant.organizationId || participant.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && participant.program !== program) return false;
      if (status && participant.status !== status) return false;
      return true;
    })
    .map((participant) => structuredClone(participant));
}

export function createAttendanceParticipant(input = {}) {
  const participant = normalizedAttendanceParticipant(input);
  attendanceParticipants.push(participant);
  persistStore();
  return structuredClone(participant);
}

export function listAttendanceSessions(filters = {}) {
  const { companyId, organizationId, program, weekStart, center, period } = filters;
  return attendanceSessions
    .filter((session) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (session.organizationId || session.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && session.program !== program) return false;
      if (weekStart && session.weekStart !== weekStart) return false;
      if (center && (session.center || "General") !== center) return false;
      if (period && (session.period || session.weekStart?.slice(0, 7)) !== period) return false;
      return true;
    })
    .sort((left, right) => String(right.weekStart).localeCompare(String(left.weekStart)))
    .map((session) => structuredClone(session));
}

export function saveAttendanceSession(input = {}) {
  const session = normalizedAttendanceSession(input);
  const index = attendanceSessions.findIndex(
    (item) =>
      item.program === session.program &&
      item.weekStart === session.weekStart &&
      (item.center || "General") === session.center &&
      (item.period || item.weekStart?.slice(0, 7)) === session.period,
  );
  const existing = index >= 0 ? attendanceSessions[index] : null;
  const actorRole = normalizeString(input.actorRole || session.actorRole);
  const canEditLocked = ["Coordinador de programa", "Supervision M&E"].includes(actorRole);
  if (existing?.locked && !canEditLocked) {
    const note = normalizeString(input.editRequest?.note || input.editRequestNote);
    if (!note) {
      const error = new Error("Esta asistencia ya fue guardada. Solicita autorizacion para editarla.");
      error.status = 403;
      throw error;
    }
    attendanceSessions[index] = {
      ...existing,
      editRequest: {
        status: "pending",
        note,
        requestedBy: normalizeString(input.recordedBy || input.actorId, "Usuario"),
        requestedRole: actorRole || "Facilitador",
        requestedAt: nowIso(),
      },
      updatedAt: nowIso(),
    };
    persistStore();
    return structuredClone(attendanceSessions[index]);
  }
  if (index >= 0) {
    attendanceSessions[index] = {
      ...attendanceSessions[index],
      ...session,
      editRequest: canEditLocked ? null : session.editRequest,
      createdAt: attendanceSessions[index].createdAt,
      locked: true,
    };
  } else {
    attendanceSessions.unshift({ ...session, locked: true });
  }
  persistStore();
  return structuredClone(index >= 0 ? attendanceSessions[index] : session);
}

function requireAttendanceAdmin(actorRole) {
  if (normalizeString(actorRole) !== "Supervision M&E") {
    const error = new Error("Solo Supervision M&E puede eliminar registros de asistencia.");
    error.status = 403;
    throw error;
  }
}

function archiveAttendanceRecord(type, data, options = {}) {
  const archivedAt = nowIso();
  const record = {
    id: `atta-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    program: data?.program || options.program || null,
    center: data?.center || options.center || null,
    period: data?.period || options.period || null,
    weekStart: data?.weekStart || options.weekStart || null,
    deletedAt: archivedAt,
    deletedBy: normalizeString(options.actorId || options.deletedBy, ""),
    deletedByRole: normalizeString(options.actorRole, ""),
    reason: normalizeString(options.reason, ""),
    data: structuredClone(data),
  };
  attendanceArchive.unshift(record);
  return record;
}

export function deleteAttendanceParticipant(participantId, options = {}) {
  requireAttendanceAdmin(options.actorRole);
  const index = attendanceParticipants.findIndex((participant) => participant.id === participantId);
  if (index < 0) return null;
  const [deleted] = attendanceParticipants.splice(index, 1);
  const affectedSessions = [];
  attendanceSessions.forEach((session) => {
    const entries = (session.entries || []).filter((entry) => entry.participantId === participantId);
    if (entries.length) affectedSessions.push({ ...structuredClone(session), entries });
    session.entries = (session.entries || []).filter((entry) => entry.participantId !== participantId);
    session.updatedAt = nowIso();
  });
  archiveAttendanceRecord("participant", { participant: deleted, affectedSessions }, options);
  persistStore();
  return structuredClone(deleted);
}

export function deleteAttendanceParticipantsForProgram(program, options = {}) {
  requireAttendanceAdmin(options.actorRole);
  const deletedIds = new Set();
  const deletedParticipants = [];
  for (let index = attendanceParticipants.length - 1; index >= 0; index -= 1) {
    if (attendanceParticipants[index].program === program) {
      deletedIds.add(attendanceParticipants[index].id);
      deletedParticipants.push(attendanceParticipants[index]);
      attendanceParticipants.splice(index, 1);
    }
  }
  const affectedSessions = [];
  attendanceSessions.forEach((session) => {
    if (session.program !== program) return;
    const entries = (session.entries || []).filter((entry) => deletedIds.has(entry.participantId));
    if (entries.length) affectedSessions.push({ ...structuredClone(session), entries });
    session.entries = (session.entries || []).filter((entry) => !deletedIds.has(entry.participantId));
    session.updatedAt = nowIso();
  });
  archiveAttendanceRecord("program-participants", { program, participants: deletedParticipants, affectedSessions }, { ...options, program });
  persistStore();
  return { deletedCount: deletedIds.size };
}

export function deleteAttendanceSession(filters = {}, options = {}) {
  requireAttendanceAdmin(options.actorRole);
  const program = normalizeString(filters.program);
  const weekStart = normalizeString(filters.weekStart);
  const center = normalizeString(filters.center, "General");
  const period = normalizeString(filters.period, weekStart.slice(0, 7));
  const index = attendanceSessions.findIndex(
    (session) =>
      session.program === program &&
      session.weekStart === weekStart &&
      (session.center || "General") === center &&
      (session.period || session.weekStart?.slice(0, 7)) === period,
  );
  if (index < 0) return null;
  const [deleted] = attendanceSessions.splice(index, 1);
  archiveAttendanceRecord("session", deleted, { ...options, ...filters });
  persistStore();
  return structuredClone(deleted);
}

export function resetAttendanceProgram(program, options = {}) {
  requireAttendanceAdmin(options.actorRole);
  const deletedParticipants = [];
  const deletedSessions = [];
  for (let index = attendanceParticipants.length - 1; index >= 0; index -= 1) {
    if (attendanceParticipants[index].program === program) {
      deletedParticipants.push(attendanceParticipants[index]);
      attendanceParticipants.splice(index, 1);
    }
  }
  for (let index = attendanceSessions.length - 1; index >= 0; index -= 1) {
    if (attendanceSessions[index].program === program) {
      deletedSessions.push(attendanceSessions[index]);
      attendanceSessions.splice(index, 1);
    }
  }
  archiveAttendanceRecord(
    "program-reset",
    { program, participants: deletedParticipants, sessions: deletedSessions },
    { ...options, program },
  );
  persistStore();
  return {
    deletedParticipants: deletedParticipants.length,
    deletedSessions: deletedSessions.length,
  };
}

export function listAttendanceArchive(filters = {}) {
  const { companyId, organizationId, program, type } = filters;
  return attendanceArchive
    .filter((record) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (record.organizationId || record.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && record.program !== program) return false;
      if (type && record.type !== type) return false;
      return true;
    })
    .map((record) => structuredClone(record));
}

export function queryReports(filters = {}) {
  const { companyId, organizationId, program, programId, province, center, period } = filters;
  return reports
    .filter((report) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (report.organizationId || report.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (program && report.program !== program) return false;
      if (programId && report.programId !== programId) return false;
      if (province && report.province !== province) return false;
      if (center && report.center !== center) return false;
      if (period && report.period !== period) return false;
      return true;
    })
    .map((report) => structuredClone(report));
}

export function createReport(input) {
  const report = normalizedReport(input);
  const existing = reports.find((item) => item.id === report.id);
  if (existing) {
    return structuredClone(existing);
  }
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
  const { companyId, organizationId, program, programId, province, period, actorRole } = filters;
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
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (report.organizationId || report.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
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

export function listAllReportStatusHistory(filters = {}) {
  const { companyId, organizationId, reportId, program, period, status } = filters;
  const reportsById = new Map(reports.map((report) => [report.id, report]));
  const deletedById = new Map(deletedReports.map((report) => [report.id, report]));
  return reportStatusHistory
    .filter((entry) => {
      const report = reportsById.get(entry.reportId) || deletedById.get(entry.reportId) || null;
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId) {
        const reportOrganizationId = report?.organizationId || report?.companyId || DEFAULT_COMPANY_ID;
        if (reportOrganizationId !== scopedOrganizationId) return false;
      }
      if (reportId && entry.reportId !== reportId) return false;
      if (status && entry.status !== status) return false;
      if (program && report?.program !== program) return false;
      if (period && report?.period !== period) return false;
      return true;
    })
    .map((entry) => structuredClone(entry));
}

export function listNotifications(filters = {}) {
  const { companyId, organizationId, programId, reportId, recipientRole, status } = filters;
  return notifications
    .filter((notification) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (notification.organizationId || notification.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
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
  const { companyId, organizationId, programId, reportId, status } = filters;
  return emailOutbox
    .filter((email) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (email.organizationId || email.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (programId && email.programId !== programId) return false;
      if (reportId && email.reportId !== reportId) return false;
      if (status && email.status !== status) return false;
      return true;
    })
    .map((email) => structuredClone(email));
}

function conversationParticipants(conversationId) {
  return chatParticipants.filter((participant) => participant.conversationId === conversationId && !participant.leftAt);
}

function latestConversationMessage(conversationId) {
  return chatMessages
    .filter((message) => message.conversationId === conversationId && !message.isDeleted)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

function readKey(conversationId, messageId, userId) {
  return `${conversationId}::${messageId}::${userId}`;
}

export function findChatConversationById(conversationId, filters = {}) {
  const { companyId, organizationId, participantUserId, includeArchived = false } = filters;
  const conversation = chatConversations.find((item) => item.id === conversationId);
  if (!conversation) return null;
  const scopedOrganizationId = organizationId || companyId;
  if (scopedOrganizationId && (conversation.organizationId || conversation.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) {
    return null;
  }
  if (!includeArchived && conversation.isArchived) return null;
  if (participantUserId) {
    const isParticipant = chatParticipants.some(
      (participant) =>
        participant.conversationId === conversation.id && participant.userId === participantUserId && !participant.leftAt,
    );
    if (!isParticipant) return null;
  }
  return structuredClone(conversation);
}

export function listChatParticipants(filters = {}) {
  const { companyId, organizationId, conversationId, userId, activeOnly = true } = filters;
  return chatParticipants
    .filter((participant) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (participant.organizationId || participant.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (conversationId && participant.conversationId !== conversationId) return false;
      if (userId && participant.userId !== userId) return false;
      if (activeOnly && participant.leftAt) return false;
      return true;
    })
    .map((participant) => structuredClone(participant));
}

export function listChatConversations(filters = {}) {
  const {
    companyId,
    organizationId,
    participantUserId,
    type,
    contextType,
    contextId,
    unreadOnly = false,
    includeArchived = false,
  } = filters;
  return chatConversations
    .filter((conversation) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (conversation.organizationId || conversation.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (!includeArchived && conversation.isArchived) return false;
      if (type && conversation.type !== type) return false;
      if (contextType && conversation.contextType !== contextType) return false;
      if (contextId && conversation.contextId !== contextId) return false;
      if (participantUserId) {
        const isParticipant = chatParticipants.some(
          (participant) =>
            participant.conversationId === conversation.id && participant.userId === participantUserId && !participant.leftAt,
        );
        if (!isParticipant) return false;
        if (unreadOnly) {
          const hasUnread = chatMessages.some((message) => {
            if (message.conversationId !== conversation.id || message.isDeleted) return false;
            if (message.senderUserId === participantUserId) return false;
            const seen = chatReads.some(
              (entry) =>
                entry.conversationId === conversation.id &&
                entry.messageId === message.id &&
                entry.userId === participantUserId,
            );
            return !seen;
          });
          if (!hasUnread) return false;
        }
      }
      return true;
    })
    .map((conversation) => {
      const participants = conversationParticipants(conversation.id).map((participant) => structuredClone(participant));
      const lastMessage = latestConversationMessage(conversation.id);
      const unreadCount = participantUserId
        ? chatMessages.filter((message) => {
            if (message.conversationId !== conversation.id || message.isDeleted) return false;
            if (message.senderUserId === participantUserId) return false;
            return !chatReads.some(
              (entry) =>
                entry.conversationId === conversation.id &&
                entry.messageId === message.id &&
                entry.userId === participantUserId,
            );
          }).length
        : 0;
      return {
        ...structuredClone(conversation),
        participants,
        lastMessagePreview: lastMessage ? String(lastMessage.body || "").slice(0, 160) : "",
        lastMessageAt: lastMessage?.createdAt || conversation.lastMessageAt || conversation.updatedAt,
        unreadCount,
      };
    })
    .sort((left, right) => String(right.lastMessageAt || "").localeCompare(String(left.lastMessageAt || "")));
}

export function createChatConversation(input = {}) {
  const timestamp = nowIso();
  const conversation = normalizedChatConversation({
    ...input,
    lastMessageAt: input.lastMessageAt || timestamp,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  });
  const requestedParticipants = [
    conversation.createdByUserId,
    ...(Array.isArray(input.participantUserIds) ? input.participantUserIds : []),
  ]
    .map((item) => normalizeString(item))
    .filter(Boolean);
  const uniqueParticipantIds = [...new Set(requestedParticipants)];
  chatConversations.unshift(conversation);
  uniqueParticipantIds.forEach((userId, index) => {
    chatParticipants.push(
      normalizedChatParticipant({
        organizationId: conversation.organizationId,
        companyId: conversation.companyId,
        organizationName: conversation.organizationName,
        conversationId: conversation.id,
        userId,
        participantRole: userId === conversation.createdByUserId ? "owner" : index === 0 ? "admin" : "member",
        canSendMessages: true,
        canAddPeople: userId === conversation.createdByUserId,
        canRemovePeople: userId === conversation.createdByUserId,
        joinedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  });
  persistStore();
  return findChatConversationById(conversation.id, { organizationId: conversation.organizationId });
}

export function addChatParticipants(conversationId, input = {}) {
  const conversation = chatConversations.find((item) => item.id === conversationId);
  if (!conversation) return null;
  const timestamp = nowIso();
  const requestedParticipantIds = (Array.isArray(input.participantUserIds) ? input.participantUserIds : [])
    .map((item) => normalizeString(item))
    .filter(Boolean);
  const added = [];
  requestedParticipantIds.forEach((userId) => {
    const existing = chatParticipants.find(
      (participant) => participant.conversationId === conversationId && participant.userId === userId,
    );
    if (existing) {
      existing.leftAt = null;
      existing.updatedAt = timestamp;
      added.push(structuredClone(existing));
      return;
    }
    const participant = normalizedChatParticipant({
      organizationId: conversation.organizationId,
      companyId: conversation.companyId,
      organizationName: conversation.organizationName,
      conversationId,
      userId,
      participantRole: "member",
      canSendMessages: true,
      canAddPeople: false,
      canRemovePeople: false,
      joinedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    chatParticipants.push(participant);
    added.push(structuredClone(participant));
  });
  conversation.updatedAt = timestamp;
  persistStore();
  return added;
}

export function removeChatParticipant(conversationId, userId) {
  const participant = chatParticipants.find(
    (item) => item.conversationId === conversationId && item.userId === userId && !item.leftAt,
  );
  if (!participant) return null;
  const timestamp = nowIso();
  participant.leftAt = timestamp;
  participant.updatedAt = timestamp;
  const conversation = chatConversations.find((item) => item.id === conversationId);
  if (conversation) {
    conversation.updatedAt = timestamp;
  }
  persistStore();
  return structuredClone(participant);
}

export function archiveChatConversation(conversationId, options = {}) {
  const conversation = chatConversations.find((item) => item.id === conversationId);
  if (!conversation) return null;
  const timestamp = nowIso();
  conversation.isArchived = true;
  conversation.updatedAt = timestamp;
  if (options.actorId) {
    conversation.archivedByUserId = normalizeString(options.actorId, conversation.archivedByUserId || "");
  }
  persistStore();
  return structuredClone(conversation);
}

export function updateChatConversation(conversationId, input = {}) {
  const conversation = chatConversations.find((item) => item.id === conversationId);
  if (!conversation) return null;
  const timestamp = nowIso();
  if (Object.prototype.hasOwnProperty.call(input, "title")) {
    conversation.title = normalizeString(input.title, conversation.title || "");
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    conversation.description = normalizeString(input.description, conversation.description || "");
  }
  conversation.updatedAt = timestamp;
  persistStore();
  return structuredClone(conversation);
}

export function listChatMessages(filters = {}) {
  const { companyId, organizationId, conversationId, before, limit = 50 } = filters;
  const scopedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const sortedMessages = chatMessages
    .filter((message) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (message.organizationId || message.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (conversationId && message.conversationId !== conversationId) return false;
      if (before && String(message.createdAt) >= String(before)) return false;
      return true;
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, scopedLimit)
    .reverse();

  return sortedMessages.map((message) => ({
    ...structuredClone(message),
    readBy: chatReads
      .filter((entry) => entry.conversationId === message.conversationId && entry.messageId === message.id)
      .map((entry) => ({
        userId: entry.userId,
        readAt: entry.readAt,
      })),
  }));
}

export function createChatMessage(conversationId, input = {}) {
  const conversation = chatConversations.find((item) => item.id === conversationId);
  if (!conversation) return null;
  const timestamp = nowIso();
  const message = normalizedChatMessage({
    ...input,
    conversationId,
    organizationId: input.organizationId || conversation.organizationId,
    companyId: input.companyId || conversation.companyId,
    organizationName: input.organizationName || conversation.organizationName,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  });
  chatMessages.push(message);
  conversation.lastMessageAt = message.createdAt;
  conversation.updatedAt = timestamp;

  const activeParticipants = conversationParticipants(conversationId);
  activeParticipants
    .filter((participant) => participant.userId !== message.senderUserId)
    .forEach((participant) => {
      chatNotifications.push(
        normalizedChatNotification({
          organizationId: conversation.organizationId,
          companyId: conversation.companyId,
          organizationName: conversation.organizationName,
          userId: participant.userId,
          conversationId,
          messageId: message.id,
          notificationType: "new_message",
          isSeen: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    });
  persistStore();
  return structuredClone(message);
}

export function markChatConversationRead(conversationId, input = {}) {
  const timestamp = nowIso();
  const userId = normalizeString(input.userId);
  const lastReadMessageId = normalizeString(input.lastReadMessageId);
  if (!userId || !lastReadMessageId) return null;
  const targetMessage = chatMessages.find((message) => message.conversationId === conversationId && message.id === lastReadMessageId);
  if (!targetMessage) return null;
  const seenKeys = new Set(chatReads.map((entry) => readKey(entry.conversationId, entry.messageId, entry.userId)));
  chatMessages
    .filter((message) => message.conversationId === conversationId && String(message.createdAt) <= String(targetMessage.createdAt))
    .forEach((message) => {
      const key = readKey(conversationId, message.id, userId);
      if (seenKeys.has(key)) return;
      chatReads.push(
        normalizedChatRead({
          conversationId,
          messageId: message.id,
          userId,
          organizationId: targetMessage.organizationId,
          companyId: targetMessage.companyId,
          organizationName: targetMessage.organizationName,
          deliveredAt: timestamp,
          readAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
      seenKeys.add(key);
    });
  chatNotifications.forEach((notification) => {
    if (notification.conversationId === conversationId && notification.userId === userId && !notification.isSeen) {
      notification.isSeen = true;
      notification.seenAt = timestamp;
      notification.updatedAt = timestamp;
    }
  });
  persistStore();
  return {
    conversationId,
    lastReadMessageId,
    readAt: timestamp,
  };
}

export function getChatUnreadCount(filters = {}) {
  const { companyId, organizationId, userId } = filters;
  const conversations = listChatConversations({
    companyId,
    organizationId,
    participantUserId: userId,
    includeArchived: false,
  });
  return {
    totalUnreadConversations: conversations.filter((conversation) => conversation.unreadCount > 0).length,
    totalUnreadMessages: conversations.reduce((sum, conversation) => sum + Number(conversation.unreadCount || 0), 0),
  };
}

export function searchChat(filters = {}) {
  const { companyId, organizationId, participantUserId, q } = filters;
  const query = normalizeString(q).toLowerCase();
  if (!query) {
    return { conversations: [], messages: [] };
  }
  const conversations = listChatConversations({
    companyId,
    organizationId,
    participantUserId,
    includeArchived: false,
  }).filter(
    (conversation) =>
      String(conversation.title || "").toLowerCase().includes(query) ||
      String(conversation.description || "").toLowerCase().includes(query),
  );
  const allowedConversationIds = new Set(conversations.map((conversation) => conversation.id));
  listChatParticipants({ companyId, organizationId, userId: participantUserId }).forEach((participant) =>
    allowedConversationIds.add(participant.conversationId),
  );
  const messages = chatMessages
    .filter((message) => {
      const scopedOrganizationId = organizationId || companyId;
      if (scopedOrganizationId && (message.organizationId || message.companyId || DEFAULT_COMPANY_ID) !== scopedOrganizationId) return false;
      if (!allowedConversationIds.has(message.conversationId)) return false;
      return String(message.body || "").toLowerCase().includes(query);
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 50)
    .map((message) => structuredClone(message));
  return {
    conversations,
    messages,
  };
}
