import { STORAGE_KEY } from "../core/config.js?v=20260514a";
import { $, $$, elements } from "../core/dom.js?v=20260527c";
import { loadStoredState, saveStoredState } from "../core/storage.js?v=20260514a";
import { seedState } from "../data/seed-state.js?v=20260521a";
import {
  REPORT_STATUSES,
  canReviewReports,
  isApprovedReportStatus,
  isPendingApprovalStatus,
  reviewRoleForStatus,
} from "../../../shared/contracts/reporting.js?v=20260514a";
import {
  SYSTEM_ROLES,
  VIEW_DEFINITIONS,
  createManagedUser,
  deleteManagedUser,
  getAllowedRoles,
  getCurrentUser,
  getSessionRole,
  listManagedUsers,
  listVisibleViews,
  updateManagedUserAccess,
} from "../services/auth-service.js?v=20260527c";
import {
  apiFileUrl,
  addApiChatParticipants,
  createApiChatConversation,
  createApiChatMessage,
  createApiConceptPaper,
  createApiAttendanceParticipant,
  createApiFormSubmission,
  createApiIndicator,
  createApiProgram,
  createApiProgramCenter,
  createApiProgramManual,
  createApiReport,
  createApiReportsBulk,
  deleteApiAttendanceParticipant,
  deleteApiAttendanceParticipants,
  deleteApiAttendanceSession,
  deleteApiChatConversation,
  deleteApiConceptPaper,
  deleteApiReport,
  deleteApiIndicator,
  deleteApiProgram,
  deleteApiProgramCenter,
  deleteApiProgramManual,
  fetchApiChatConversation,
  fetchApiChatConversationPresence,
  fetchApiChatConversations,
  fetchApiChatDirectory,
  fetchApiChatMessages,
  fetchApiChatUnreadCount,
  fetchApiConceptPapers,
  fetchApiAttendanceParticipants,
  fetchApiAttendanceSessions,
  fetchApiFormSubmissions,
  fetchApiNotifications,
  fetchApiProgramCenters,
  fetchApiProgramManuals,
  fetchApiReports,
  getApiBaseUrl,
  isApiConfigured,
  markApiChatConversationRead,
  markApiNotificationRead,
  postApiChatPresence,
  postApiChatTyping,
  removeApiChatParticipant,
  resetApiAttendanceProgram,
  searchApiChat,
  saveApiAttendanceSession,
  updateApiChatParticipant,
  updateApiChatMessage,
  updateApiChatConversation,
  updateApiReportStatus,
  updateApiIndicator,
  updateApiProgram,
  updateApiProgramCenter,
  uploadApiFile,
} from "../services/mel-api.js?v=20260527c";
import {
  currentMonth,
  escapeHtml,
  fileExtension,
  localFileUrl,
  percent,
  renderBullets,
  setOptions,
  slugify,
  statusForProgress,
  unique,
} from "../shared/utils.js?v=20260514a";

let state = null;
const ROLE_STORAGE_KEY = "pulso-me-active-role";
const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024;
const MAX_REPORT_ATTACHMENT_BYTES = MAX_UPLOAD_FILE_BYTES;
const MAX_CONCEPT_PAPER_BYTES = MAX_UPLOAD_FILE_BYTES;
const MAX_PROGRAM_MANUAL_BYTES = MAX_UPLOAD_FILE_BYTES;
const NO_CENTER_OPTION = "Sin centros registrados";
const ACCESS_SYNC_INTERVAL_MS = 15000;
const CHAT_SYNC_INTERVAL_MS = 4000;
const CHAT_PRESENCE_INTERVAL_MS = 6000;
const CHAT_TYPING_IDLE_MS = 4500;
const CHAT_TYPING_REFRESH_MS = 2500;
let currentUser = null;
let currentUserRoles = SYSTEM_ROLES.slice();
let currentUserViews = VIEW_DEFINITIONS.map((view) => view.id);
let accessRenderRequest = 0;
const deletedAccessUserIds = new Set();
let activeStatusReportId = null;
let accessLibraryUploadInFlight = false;
let appRefreshInFlight = false;
let eventsBound = false;
let stateSyncListenerBound = false;
let startupSyncPromise = null;
let accessSyncIntervalId = null;
let accessSyncInFlight = false;
let chatSyncIntervalId = null;
let chatSyncInFlight = false;
let chatPresenceIntervalId = null;
let chatPresenceInFlight = false;
let chatMessageSendInFlight = false;
let chatAttachmentFiles = [];
let chatSearchResults = null;
let chatReplyMessageId = "";
let chatSearchRequestId = 0;
let chatSyncPrimed = false;
let chatTypingStopTimerId = null;
let chatTypingConversationId = "";
let chatTypingActive = false;
let chatTypingLastSentAt = 0;
const BASE_DOCUMENT_TITLE = document.title || "Pulso M&E";
const INSTITUTIONAL_CHAT_AREAS = [
  { id: "mel", title: "M&E", description: "Coordinacion institucional de monitoreo, evaluacion y aprendizaje." },
  { id: "access", title: "Accesos", description: "Gestión de usuarios, permisos y credenciales." },
  { id: "supervision", title: "Supervision", description: "Seguimiento, alertas y validaciones operativas." },
];

function loadState() {
  return loadStoredState(STORAGE_KEY, seedState, normalizeState);
}

function hydrateState() {
  state = loadState();
  state.role = normalizeRoleLabel(state.role || seedState.role);
  return state;
}

const ROLE_LABELS = {
  facilitador: "Facilitador",
  "coordinador de programa": "Coordinador de programa",
  "program manager": "Program Manager",
  "director nacional": "Director Nacional",
  "supervision m&e": "Supervision M&E",
  "supervision me": "Supervision M&E",
  "supervisión m&e": "Supervision M&E",
  supervisor: "Supervision M&E",
};

const REPORT_PARTICIPANT_FIELDS = {
  women: {
    key: "women",
    label: "Mujeres",
    element: () => elements.reportWomenField,
    input: () => elements.reportWomenInput,
  },
  men: {
    key: "men",
    label: "Hombres",
    element: () => elements.reportMenField,
    input: () => elements.reportMenInput,
  },
  adolescents: {
    key: "adolescents",
    label: "Adolescentes",
    element: () => elements.reportAdolescentsField,
    input: () => elements.reportAdolescentsInput,
  },
  children: {
    key: "children",
    label: "Niños",
    element: () => elements.reportChildrenField,
    input: () => elements.reportChildrenInput,
  },
};

function normalizedProgramKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function reportParticipantFieldsForProgram(programName = "") {
  const normalized = normalizedProgramKey(programName);
  if (normalized === "girls empowerment") return ["adolescents"];
  if (normalized === "club de chicos") return ["adolescents"];
  if (normalized === "iga") return ["women", "men"];
  if (normalized === "programa cfi" || normalized === "cfi") return ["adolescents", "children"];
  if (normalized === "agricultura") return ["adolescents", "women", "men"];
  return ["women", "men", "adolescents"];
}

function reportParticipantValue(report = {}, fieldKey = "") {
  const breakdown = report?.participantBreakdown || {};
  if (fieldKey === "adolescents") {
    return Number(breakdown.adolescents ?? report.adolescents ?? report.youth ?? 0);
  }
  if (fieldKey === "children") {
    return Number(breakdown.children ?? report.children ?? 0);
  }
  return Number(breakdown[fieldKey] ?? report[fieldKey] ?? 0);
}

function buildParticipantBreakdown(source = {}, programName = source.program || "") {
  const configuredFields = reportParticipantFieldsForProgram(programName);
  const breakdown = {
    women: Number(source.participantBreakdown?.women ?? source.women ?? 0),
    men: Number(source.participantBreakdown?.men ?? source.men ?? 0),
    adolescents: Number(source.participantBreakdown?.adolescents ?? source.adolescents ?? source.youth ?? 0),
    children: Number(source.participantBreakdown?.children ?? source.children ?? 0),
  };
  Object.keys(breakdown).forEach((key) => {
    breakdown[key] = Number.isFinite(breakdown[key]) ? Math.max(0, breakdown[key]) : 0;
    if (!configuredFields.includes(key)) breakdown[key] = 0;
  });
  return breakdown;
}

function reportParticipantTotal(report = {}) {
  return reportParticipantFieldsForProgram(report.program).reduce(
    (sum, fieldKey) => sum + reportParticipantValue(report, fieldKey),
    0,
  );
}

function reportParticipantSummary(report = {}, separator = " · ") {
  const parts = reportParticipantFieldsForProgram(report.program)
    .map((fieldKey) => {
      const config = REPORT_PARTICIPANT_FIELDS[fieldKey];
      const value = reportParticipantValue(report, fieldKey);
      return `${Number(value || 0).toLocaleString("es-DO")} ${config.label.toLowerCase()}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(separator) : "Sin desglose";
}

function normalizeRoleLabel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return ROLE_LABELS[normalized] || String(value || "").trim() || "Facilitador";
}

function conceptProgramFromContent(input = {}) {
  const fallbackProgram = String(input.program || "").trim();
  const text = `${input.program || ""} ${input.title || ""} ${input.fileName || input.name || ""}`.toLowerCase();
  if (/\bcfa\b|\bcfi\b/.test(text)) return "Programa CFI";
  if (/\bhiga\b|\biga\b/.test(text)) return "IGA";
  if (/agricultura/.test(text)) return "Agricultura";
  if (/club de chicos|chicos/.test(text)) return "Club de Chicos";
  return fallbackProgram;
}

function normalizeConceptPaperState(paper = {}) {
  return {
    ...paper,
    program: conceptProgramFromContent(paper),
    title: String(paper.title || paper.fileName || "Concept paper").replace(/\bCFA\b/g, "CFI"),
  };
}

function activeRole() {
  return normalizeRoleLabel(state?.role || "Facilitador");
}

function loadRolePreference(fallback = "Facilitador") {
  try {
    const savedRole = window.localStorage.getItem(ROLE_STORAGE_KEY);
    return normalizeRoleLabel(savedRole || fallback);
  } catch {
    return normalizeRoleLabel(fallback);
  }
}

function saveRolePreference(role) {
  try {
    window.localStorage.setItem(ROLE_STORAGE_KEY, normalizeRoleLabel(role));
  } catch {
    // ignore storage issues for the profile selector
  }
}

async function syncAuthenticatedAccess(authenticatedUser = null) {
  currentUser = authenticatedUser || (await getCurrentUser());
  currentUserRoles = currentUser ? currentUser.allowedRoles || (await getAllowedRoles()) : SYSTEM_ROLES.slice();
  currentUserViews = currentUser
    ? currentUser.viewPermissions || (await listVisibleViews())
    : VIEW_DEFINITIONS.map((view) => view.id);
  const nextRole = currentUser ? currentUser.systemRole || (await getSessionRole()) : loadRolePreference(state?.role || seedState.role);
  if (state) {
    state.role = normalizeRoleLabel(nextRole || state.role || seedState.role);
  }
}

function normalizeState(savedState) {
  const nextState = { ...structuredClone(seedState), ...savedState };
  const mergeByKey = (savedItems = [], seedItems = [], keyFn) => {
    const merged = [];
    const seen = new Set();
    savedItems.forEach((savedItem) => {
      const key = keyFn(savedItem);
      const seeded = seedItems.find((seedItem) => keyFn(seedItem) === key) || {};
      merged.push({ ...structuredClone(seeded), ...savedItem });
      seen.add(key);
    });
    seedItems.forEach((seedItem) => {
      const key = keyFn(seedItem);
      if (!seen.has(key)) {
        merged.push(structuredClone(seedItem));
      }
    });
    return merged;
  };

  nextState.programs = mergeByKey(savedState.programs || [], seedState.programs, (item) => item.name).map((program) => {
    const seeded = seedState.programs.find((item) => item.name === program.name) || {};
    const programName = String(program.name || seeded.name || "").trim();
    return {
      ...seeded,
      ...program,
      id: program.id || seeded.id || `prog-${slugify(programName)}`,
      expectedResults: program.expectedResults || seeded.expectedResults || [],
      primaryPopulation: program.primaryPopulation || seeded.primaryPopulation || "Participantes del programa",
      coordinatorEmail: program.coordinatorEmail || seeded.coordinatorEmail || "",
      programManagerEmail: program.programManagerEmail || seeded.programManagerEmail || "",
      melSupervisorEmail: program.melSupervisorEmail || seeded.melSupervisorEmail || "",
    };
  });
  nextState.indicators = mergeByKey(savedState.indicators || [], seedState.indicators, (item) => item.id || item.name);
  nextState.monitoringForms = mergeByKey(savedState.monitoringForms || [], seedState.monitoringForms, (item) => item.id);
  nextState.deletedConceptPaperIds = Array.isArray(savedState.deletedConceptPaperIds) ? savedState.deletedConceptPaperIds.slice() : [];
  const deletedConceptPaperIds = new Set(nextState.deletedConceptPaperIds);
  nextState.conceptPapers = mergeByKey(
    (savedState.conceptPapers || []).filter((paper) => !deletedConceptPaperIds.has(paper.id)),
    seedState.conceptPapers.filter((paper) => !deletedConceptPaperIds.has(paper.id)),
    (item) => item.id,
  ).map(normalizeConceptPaperState);
  nextState.programManuals = Array.isArray(savedState.programManuals) ? savedState.programManuals.slice() : [];
  nextState.programCenters = (Array.isArray(savedState.programCenters) ? savedState.programCenters : seedState.programCenters || []).map((center) => ({
    id:
      center.id ||
      `center-${slugify(String(center.program || ""))}-${slugify(String(center.province || ""))}-${slugify(String(center.name || ""))}`,
    program: String(center.program || ""),
    programId:
      center.programId ||
      nextState.programs.find((program) => program.name === center.program)?.id ||
      null,
    province: String(center.province || ""),
    name: String(center.name || ""),
  }));
  nextState.reports = Array.isArray(savedState.reports) ? savedState.reports.slice() : [];
  nextState.notifications = Array.isArray(savedState.notifications) ? savedState.notifications.slice() : [];
  nextState.reportDrafts = Array.isArray(savedState.reportDrafts) ? savedState.reportDrafts.slice() : [];
  nextState.actions = Array.isArray(savedState.actions) ? savedState.actions.slice() : [];
  nextState.formSubmissions = Array.isArray(savedState.formSubmissions) ? savedState.formSubmissions.slice() : [];
  nextState.chatConversations = Array.isArray(savedState.chatConversations) ? savedState.chatConversations.slice() : [];
  nextState.chatDirectory = Array.isArray(savedState.chatDirectory) ? savedState.chatDirectory.slice() : [];
  nextState.chatMessagesByConversation =
    savedState.chatMessagesByConversation && typeof savedState.chatMessagesByConversation === "object"
      ? { ...savedState.chatMessagesByConversation }
      : {};
  nextState.chatPresenceByConversation =
    savedState.chatPresenceByConversation && typeof savedState.chatPresenceByConversation === "object"
      ? { ...savedState.chatPresenceByConversation }
      : {};
  nextState.chatUnreadCount =
    savedState.chatUnreadCount && typeof savedState.chatUnreadCount === "object"
      ? {
          totalUnreadConversations: Number(savedState.chatUnreadCount.totalUnreadConversations || 0),
          totalUnreadMessages: Number(savedState.chatUnreadCount.totalUnreadMessages || 0),
        }
      : { totalUnreadConversations: 0, totalUnreadMessages: 0 };
  nextState.chatSelectedDirectUserId = typeof savedState.chatSelectedDirectUserId === "string" ? savedState.chatSelectedDirectUserId : "";
  nextState.chatSearch = typeof savedState.chatSearch === "string" ? savedState.chatSearch : "";
  nextState.chatActiveConversationId = typeof savedState.chatActiveConversationId === "string" ? savedState.chatActiveConversationId : "";
  nextState.attendanceParticipants = Array.isArray(savedState.attendanceParticipants) ? savedState.attendanceParticipants.slice() : [];
  nextState.attendanceSessions = Array.isArray(savedState.attendanceSessions) ? savedState.attendanceSessions.slice() : [];
  const attendancePrograms = unique(nextState.programs.map((program) => String(program.name || "").trim()).filter(Boolean));
  nextState.attendanceProgram = attendancePrograms.includes(savedState.attendanceProgram)
    ? savedState.attendanceProgram
    : attendancePrograms[0] || "Programa general";
  nextState.attendanceCenter = savedState.attendanceCenter || seedState.attendanceCenter || "General";
  nextState.attendancePeriod = savedState.attendancePeriod || seedState.attendancePeriod || currentMonth();
  nextState.attendanceWeek = savedState.attendanceWeek || new Date().toISOString().slice(0, 10);
  nextState.attendanceArchive = Array.isArray(savedState.attendanceArchive) ? savedState.attendanceArchive.slice() : [];
  nextState.operationalProvinces = unique([
    ...(Array.isArray(savedState.operationalProvinces) ? savedState.operationalProvinces : []),
    ...(seedState.operationalProvinces || []),
  ].filter(Boolean));
  nextState.chartPreferences = { ...seedState.chartPreferences, ...(savedState.chartPreferences || {}) };
  nextState.filters = { ...seedState.filters, ...(savedState.filters || {}) };
  nextState.role = normalizeRoleLabel(nextState.role || seedState.role);
  nextState.activeView = typeof savedState.activeView === "string" ? savedState.activeView : "dashboard";
  nextState.designProgram = savedState.designProgram || nextState.programs[0]?.name;
  nextState.formsProgram = savedState.formsProgram || nextState.designProgram || nextState.programs[0]?.name;
  nextState.selectedConceptPaper =
    savedState.selectedConceptPaper && nextState.conceptPapers.some((paper) => paper.id === savedState.selectedConceptPaper)
      ? savedState.selectedConceptPaper
      : nextState.conceptPapers[0]?.id || null;
  if (
    nextState.chatActiveConversationId &&
    !nextState.chatConversations.some((conversation) => conversation.id === nextState.chatActiveConversationId)
  ) {
    nextState.chatActiveConversationId = nextState.chatConversations[0]?.id || "";
  }
  return nextState;
}

function saveState(options = {}) {
  const preserveAttendanceSnapshot = Boolean(options.preserveAttendanceSnapshot);
  const latest = loadState();
  const nextState = normalizeState({
    ...state,
    reports:
      Array.isArray(state?.reports) && state.reports.length === 0 && Array.isArray(latest?.reports) && latest.reports.length
        ? latest.reports
        : state.reports,
    notifications:
      Array.isArray(state?.notifications) &&
      state.notifications.length === 0 &&
      Array.isArray(latest?.notifications) &&
      latest.notifications.length
        ? latest.notifications
        : state.notifications,
    formSubmissions:
      Array.isArray(state?.formSubmissions) &&
      state.formSubmissions.length === 0 &&
      Array.isArray(latest?.formSubmissions) &&
      latest.formSubmissions.length
        ? latest.formSubmissions
        : state.formSubmissions,
    attendanceParticipants:
      !preserveAttendanceSnapshot &&
      Array.isArray(state?.attendanceParticipants) &&
      state.attendanceParticipants.length === 0 &&
      Array.isArray(latest?.attendanceParticipants) &&
      latest.attendanceParticipants.length
        ? latest.attendanceParticipants
        : state.attendanceParticipants,
    attendanceSessions:
      !preserveAttendanceSnapshot &&
      Array.isArray(state?.attendanceSessions) &&
      state.attendanceSessions.length === 0 &&
      Array.isArray(latest?.attendanceSessions) &&
      latest.attendanceSessions.length
        ? latest.attendanceSessions
        : state.attendanceSessions,
  });
  state = nextState;
  saveStoredState(STORAGE_KEY, state);
}

function upsertById(items, nextItem) {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...nextItem };
    return;
  }
  items.push(nextItem);
}

function removeById(items, id) {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) {
    items.splice(index, 1);
  }
}

function selectedProgramForIndicatorForm() {
  return state.filters.program === "Todos"
    ? state.programs[0]
    : state.programs.find((item) => item.name === state.filters.program) || state.programs[0];
}

function approvedReports() {
  return state.reports.filter((report) => isApprovedReportStatus(report.status));
}

function recomputeIndicatorValues() {
  const totals = approvedReports().reduce((groups, report) => {
    groups[report.indicatorId] = (groups[report.indicatorId] || 0) + Number(report.value || 0);
    return groups;
  }, {});

  state.indicators = state.indicators.map((indicator) => ({
    ...indicator,
    value: totals[indicator.id] || 0,
  }));
}

function indicatorById(id) {
  return state.indicators.find((indicator) => indicator.id === id);
}

function getFilteredReports() {
  return state.reports.filter((report) => {
    const programMatch = state.filters.program === "Todos" || report.program === state.filters.program;
    const provinceMatch = state.filters.province === "Todas" || report.province === state.filters.province;
    const periodMatch = state.filters.period === "Todos" || report.period === state.filters.period;
    return programMatch && provinceMatch && periodMatch;
  });
}

function getChartDataScope() {
  return state.chartPreferences?.dataScope === "all" ? "all" : "approved";
}

function getAnalyticsReports() {
  const reports = getFilteredReports();
  if (getChartDataScope() === "all") {
    return reports;
  }
  return reports.filter((report) => isApprovedReportStatus(report.status));
}

function registeredCenters() {
  return (state.programCenters || []).filter((center) => center.program && center.province && center.name);
}

function attendanceProgramOptions() {
  const programNames = unique((state.programs || []).map((program) => String(program.name || "").trim()).filter(Boolean));
  return programNames.length ? programNames : ["Programa general"];
}

function attendanceCentersForProgram(program = state.attendanceProgram) {
  const centers = unique(
    registeredCenters()
      .filter((center) => center.program === program)
      .map((center) => center.name)
      .filter(Boolean),
  );
  return centers.length ? centers : ["General"];
}

function setMultiSelectValues(select, values = []) {
  if (!select) return;
  const selected = new Set((values || []).map((value) => String(value)));
  Array.from(select.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function selectedProgramProvinces() {
  return Array.from(elements.programProvincesInput?.selectedOptions || [])
    .map((option) => String(option.value || "").trim())
    .filter(Boolean);
}

function populateProgramProvinceChoices(selectedValues = []) {
  if (!elements.programProvincesInput) return;
  elements.programProvincesInput.innerHTML = (state.operationalProvinces || [])
    .map((province) => `<option value="${escapeHtml(province)}">${escapeHtml(province)}</option>`)
    .join("");
  setMultiSelectValues(elements.programProvincesInput, selectedValues);
}

function parseProgramCentersInput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*\|\s*|\s*:\s*/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      const [province, ...nameParts] = parts;
      return {
        province,
        name: nameParts.join(" | "),
      };
    })
    .filter((entry) => entry?.province && entry?.name);
}

function formatProgramCentersInput(programName) {
  return registeredCenters()
    .filter((center) => center.program === programName)
    .sort((left, right) => {
      const provinceCompare = String(left.province || "").localeCompare(String(right.province || ""));
      if (provinceCompare !== 0) return provinceCompare;
      return String(left.name || "").localeCompare(String(right.name || ""));
    })
    .map((center) => `${center.province} | ${center.name}`)
    .join("\n");
}

function provincesForProgram(programName) {
  const centerProvinces = unique(
    registeredCenters()
      .filter((center) => !programName || center.program === programName)
      .map((center) => center.province),
  );
  if (centerProvinces.length) return centerProvinces;

  const program = state.programs.find((item) => item.name === programName);
  const programProvinces = Array.isArray(program?.provinces) ? program.provinces.filter(Boolean) : [];
  if (programProvinces.length) return unique(programProvinces);

  if (state.operationalProvinces?.length) return state.operationalProvinces;

  return unique(registeredCenters().map((center) => center.province));
}

function centersForProgramProvince(programName, province) {
  const programCenters = registeredCenters().filter((center) => center.program === programName);
  const exactProvinceCenters = unique(
    programCenters.filter((center) => center.province === province).map((center) => center.name),
  );
  if (exactProvinceCenters.length) return exactProvinceCenters;

  const allProgramCenters = unique(programCenters.map((center) => center.name));
  return allProgramCenters.length ? allProgramCenters : [NO_CENTER_OPTION];
}

function syncReportCaptureOptions() {
  const programName = elements.reportProgram?.value || state.programs[0]?.name || "";
  const selectedProvince = elements.reportProvince?.value || "";
  const selectedCenter = elements.reportCenter?.value || "";
  const selectedIndicator = elements.reportIndicator?.value || "";
  const provinces = provincesForProgram(programName);
  const programCenters = registeredCenters().filter((center) => center.program === programName);
  const provinceHasCenters = selectedProvince
    ? programCenters.some((center) => center.province === selectedProvince)
    : false;
  const fallbackProvince = provinceHasCenters
    ? selectedProvince
    : programCenters[0]?.province || provinces[0] || "";
  const nextProvince = provinces.includes(selectedProvince) && provinceHasCenters ? selectedProvince : fallbackProvince;
  const centers = centersForProgramProvince(programName, nextProvince);
  const nextCenter = centers.includes(selectedCenter) ? selectedCenter : centers[0] || "";
  const indicators = state.indicators.filter((indicator) => indicator.program === programName);
  const indicatorNames = indicators.map((indicator) => indicator.name);
  const nextIndicator = indicatorNames.includes(selectedIndicator) ? selectedIndicator : indicatorNames[0] || "";

  setOptions(elements.reportProvince, provinces, nextProvince);
  setOptions(elements.reportCenter, centers, nextCenter);
  setOptions(elements.reportIndicator, indicatorNames, nextIndicator);
  syncReportParticipantInputs(programName);
}

function syncReportParticipantInputs(programName = elements.reportProgram?.value || state.programs[0]?.name || "") {
  const activeFields = new Set(reportParticipantFieldsForProgram(programName));
  Object.values(REPORT_PARTICIPANT_FIELDS).forEach((fieldConfig) => {
    const wrapper = fieldConfig.element?.();
    const input = fieldConfig.input?.();
    const isActive = activeFields.has(fieldConfig.key);
    if (wrapper) {
      wrapper.hidden = !isActive;
      const textNode = Array.from(wrapper.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) {
        textNode.textContent = `${fieldConfig.label}\n                  `;
      }
    }
    if (input) {
      input.disabled = !isActive;
      if (!isActive) input.value = 0;
    }
  });
}

function reportLocation(report) {
  return [report.period, report.province, report.center].filter(Boolean).join(" · ");
}

function renderFilters() {
  const programs = ["Todos", ...state.programs.map((program) => program.name)];
  const provinces = [
    "Todas",
    ...unique([
      ...(state.operationalProvinces || []),
      ...registeredCenters().map((center) => center.province),
      ...state.programs.flatMap((program) => program.provinces || []),
    ].filter(Boolean)),
  ];
  const periods = ["Todos", ...unique(state.reports.map((report) => report.period)).reverse()];
  const programNames = state.programs.map((program) => program.name);
  const selectedProgram = state.programs[0]?.name || "";
  const currentReportProgram = programNames.includes(elements.reportProgram?.value)
    ? elements.reportProgram.value
    : selectedProgram;

  setOptions(elements.programFilter, programs, state.filters.program);
  setOptions(elements.provinceFilter, provinces, state.filters.province);
  setOptions(elements.periodFilter, periods, state.filters.period);
  setOptions(elements.reportProgram, programNames, currentReportProgram);
  syncReportCaptureOptions();
  if (elements.programCenterProgramInput) {
    setOptions(elements.programCenterProgramInput, programNames, elements.programCenterProgramInput.value || selectedProgram);
  }
  if (elements.programCenterProvinceInput) {
    setOptions(
      elements.programCenterProvinceInput,
      state.operationalProvinces || [],
      elements.programCenterProvinceInput.value || state.operationalProvinces?.[0] || "",
    );
  }
  populateProgramProvinceChoices(selectedProgramProvinces().length ? selectedProgramProvinces() : state.programs[0]?.provinces || []);
  setOptions(elements.indicatorProgramInput, programNames, elements.indicatorProgramInput?.value || selectedProgram);
  setOptions(elements.designProgramSelect, programNames, state.designProgram || selectedProgram);
  setOptions(elements.formsProgramSelect, programNames, state.formsProgram || state.designProgram || selectedProgram);
  elements.reportPeriod.value = state.filters.period === "Todos" ? currentMonth() : state.filters.period;
  const sessionRole = normalizeRoleLabel(state.role || currentUser?.systemRole || "Facilitador");
  setOptions(elements.roleSelect, [sessionRole], sessionRole);
  elements.roleSelect.disabled = true;
  elements.roleSelect.value = sessionRole;
  elements.roleSelect.setAttribute("aria-label", `Perfil fijo del usuario: ${sessionRole}`);
  if (elements.currentUserName) {
    elements.currentUserName.textContent = currentUser?.fullName || "Sin sesion";
  }
  if (elements.currentUserEmail) {
    elements.currentUserEmail.textContent = currentUser?.email || "-";
  }
  const reportOwnerInput = $("#reportOwner");
  if (reportOwnerInput && currentUser?.fullName && !String(reportOwnerInput.value || "").trim()) {
    reportOwnerInput.value = currentUser.fullName;
  }
  if (elements.indicatorChartTypeSelect) {
    elements.indicatorChartTypeSelect.value = state.chartPreferences?.indicatorType || "bars";
  }
  if (elements.periodChartTypeSelect) {
    elements.periodChartTypeSelect.value = state.chartPreferences?.periodType || "donut";
  }
  if (elements.chartDataScopeSelect) {
    elements.chartDataScopeSelect.value = getChartDataScope();
  }
  syncEvidenceInputMode();
}

function canValidate() {
  return isSystemAdminRole() || canReviewReports(activeRole());
}

function canManageProgramCenters(role = activeRole()) {
  const normalizedRole = normalizeRoleLabel(role);
  return ["Supervision M&E", "Coordinador de programa"].includes(normalizedRole);
}

function actorPayload() {
  const organizationId = currentUser?.organizationId || "org-convoy-of-hope";
  return {
    actorId: currentUser?.id || currentUser?.email || `local-${slugify(activeRole())}`,
    actorRole: activeRole(),
    organizationId,
    companyId: organizationId,
    organizationName: currentUser?.organizationName || "Convoy of Hope",
  };
}

function isSystemAdminRole(role = activeRole()) {
  return normalizeRoleLabel(role) === "Supervision M&E";
}

function accessStatusLabel(status = "") {
  const normalized = String(status || "").trim();
  if (normalized === "pending_verification") return "Pendiente verificación";
  if (normalized === "pending_approval") return "Pendiente aprobación";
  if (normalized === "active") return "Activo";
  if (normalized === "suspended") return "Suspendido";
  return normalized || "Sin estado";
}

function viewIsEnabled(viewId) {
  return isSystemAdminRole() || currentUserViews.includes(viewId);
}

function renderMetrics() {
  const reports = getFilteredReports();
  const totalValue = state.indicators.reduce((sum, indicator) => sum + indicator.value, 0);
  const totalTarget = state.indicators.reduce((sum, indicator) => sum + indicator.target, 0);
  const overallProgress = percent(totalValue, totalTarget);
  const pending = state.reports.filter((report) => isPendingApprovalStatus(report.status)).length;
  const riskCount = state.indicators.filter((indicator) => percent(indicator.value, indicator.target) < 70).length;
  const participants = reports.reduce((sum, report) => sum + reportParticipantTotal(report), 0);
  const filterProgramLabel = state.filters.program && state.filters.program !== "Todos" ? state.filters.program : "todos los programas";
  const filterPeriodLabel = state.filters.period && state.filters.period !== "Todos" ? state.filters.period : "todos los periodos";

  const metrics = [
    { label: "Cumplimiento global", value: `${overallProgress}%`, delta: `avance consolidado de ${filterProgramLabel}`, type: statusForProgress(overallProgress) },
    { label: "Reportes del periodo", value: reports.length, delta: `${filterPeriodLabel} según filtros activos`, type: "info" },
    { label: "Pendientes de validar", value: pending, delta: "en cola de supervision", type: pending > 0 ? "warning" : "good" },
    { label: "Participantes", value: participants.toLocaleString("es-DO"), delta: riskCount ? `${riskCount} indicadores piden atención` : "desglose reportado estable", type: riskCount ? "warning" : "good" },
  ];

  elements.metricGrid.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card ${metric.type}">
          <p class="eyebrow">${metric.label}</p>
          <div class="value">${metric.value}</div>
          <div class="delta">${metric.delta}</div>
        </article>
      `,
    )
    .join("");
}

function setProgramSourceContext(programName, targetView = "dashboard") {
  state.filters.program = programName;
  state.filters.province = "Todas";
  state.filters.period = "Todos";
  state.activeView = targetView;
  if (targetView === "indicators") {
    state.designProgram = programName;
    state.formsProgram = programName;
  }
  saveState();
  renderAll();
  switchView(targetView);
  if (targetView === "dashboard") {
    window.setTimeout(() => {
      elements.recentReports?.closest(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }
}

function renderProgramChart() {
  elements.programChart.innerHTML = state.programs
    .map((program) => {
      const indicators = state.indicators.filter((indicator) => indicator.program === program.name);
      const approvedReportCount = state.reports.filter(
        (report) => report.program === program.name && isApprovedReportStatus(report.status),
      ).length;
      const value = indicators.reduce((sum, indicator) => sum + indicator.value, 0);
      const target = indicators.reduce((sum, indicator) => sum + indicator.target, 0);
      const progress = percent(value, target);
      const risk = statusForProgress(progress);
      return `
        <div class="bar-row">
          <div class="bar-name">${program.name}</div>
          <div class="bar-content">
            <div class="bar-track" aria-label="${progress}% de avance">
              <div class="bar-fill ${risk}" style="width: ${progress}%"></div>
            </div>
            <div class="bar-meta">
              Fuente: ${value.toLocaleString("es-DO")} de ${target.toLocaleString("es-DO")} · ${indicators.length} indicador${indicators.length === 1 ? "" : "es"} · ${approvedReportCount} reporte${approvedReportCount === 1 ? "" : "s"} aprobado${approvedReportCount === 1 ? "" : "s"}
            </div>
            ${
              isSystemAdminRole()
                ? `<div class="bar-source-actions">
                    <button class="ghost-action" type="button" data-open-program-indicators="${escapeHtml(program.name)}">Ajustar indicadores</button>
                    <button class="ghost-action" type="button" data-open-program-reports="${escapeHtml(program.name)}">Revisar o eliminar reportes</button>
                  </div>`
                : ""
            }
          </div>
          <div class="bar-value">${progress}%</div>
        </div>
      `;
    })
    .join("");
}

function renderRisks() {
  const risks = state.indicators
    .map((indicator) => ({ ...indicator, progress: percent(indicator.value, indicator.target) }))
    .filter((indicator) => indicator.progress < 75)
    .sort((a, b) => a.progress - b.progress);

  elements.riskList.innerHTML = risks.length
    ? risks
        .map(
          (indicator) => `
            <article class="risk-item ${indicator.progress < 60 ? "danger" : ""}">
              <strong>${indicator.name}</strong>
              <span class="risk-meta">${indicator.program} · ${indicator.progress}% de ${indicator.target} ${indicator.unit}</span>
            </article>
          `,
        )
        .join("")
    : `<p class="item-meta">No hay indicadores criticos con los filtros actuales.</p>`;
}

function renderReports() {
  const reports = getFilteredReports().slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!reports.length) {
    elements.recentReports.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell">Todavia no hay reportes cargados.</td>
      </tr>
    `;
    return;
  }

  elements.recentReports.innerHTML = reports
    .map((report) => {
      const indicator = indicatorById(report.indicatorId);
      return `
        <tr>
          <td>${report.date}</td>
          <td>${report.program}</td>
          <td>${indicator?.name ?? "Indicador eliminado"}</td>
          <td>${report.value.toLocaleString("es-DO")}</td>
          <td>${report.owner}</td>
          <td><span class="status-pill ${classForReportStatus(report.status)}">${report.status}</span></td>
          <td>
            <div class="item-actions report-row-actions">
              ${renderAttachmentLinks(report, true) || `<span class="item-meta">-</span>`}
              ${
                canDeleteReport(report)
                  ? `<button class="ghost-action danger-action" type="button" data-delete-report="${report.id}">Eliminar</button>`
                  : ""
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function classForReportStatus(status) {
  if (status === REPORT_STATUSES.APPROVED) return "good";
  if (isPendingApprovalStatus(status)) return "pending";
  if (status === REPORT_STATUSES.NEEDS_CORRECTION) return "warning";
  return "danger";
}

function nextApprovalStatusForReport(report) {
  if (isSystemAdminRole()) return REPORT_STATUSES.APPROVED;
  if (report.status === "Pendiente") return REPORT_STATUSES.PENDING_PROGRAM_MANAGER;
  if (report.status === REPORT_STATUSES.PENDING_COORDINATION) return REPORT_STATUSES.PENDING_PROGRAM_MANAGER;
  if (report.status === REPORT_STATUSES.PENDING_PROGRAM_MANAGER) return REPORT_STATUSES.PENDING_MEL;
  if (report.status === REPORT_STATUSES.PENDING_MEL) return REPORT_STATUSES.APPROVED;
  return REPORT_STATUSES.APPROVED;
}

function approvalButtonLabel(report) {
  if (isSystemAdminRole()) return "Aprobar";
  if (report.status === "Pendiente") return "Enviar a Program Manager";
  if (report.status === REPORT_STATUSES.PENDING_COORDINATION) return "Enviar a Program Manager";
  if (report.status === REPORT_STATUSES.PENDING_PROGRAM_MANAGER) return "Enviar a Supervision M&E";
  if (report.status === REPORT_STATUSES.PENDING_MEL) return "Aprobar final";
  return "Aprobar";
}

function reportsAssignedToRole(role) {
  return state.reports
    .filter((report) => isPendingApprovalStatus(report.status))
    .filter((report) => isSystemAdminRole(role) || reviewRoleForStatus(report.status) === role)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

function inboxReportsForRole(role) {
  return state.reports
    .filter((report) => {
      if (report.status === REPORT_STATUSES.NEEDS_CORRECTION) {
        return report.correctionForRole === role || (role === "Facilitador" && !report.correctionForRole);
      }
      if (!isPendingApprovalStatus(report.status)) return false;
      return isSystemAdminRole(role) || reviewRoleForStatus(report.status) === role || role === "Facilitador";
    })
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

function formatPendingStageBreakdown(reports) {
  const counts = reports.reduce((groups, report) => {
    const reviewRole = reviewRoleForStatus(report.status);
    if (!reviewRole) return groups;
    groups[reviewRole] = (groups[reviewRole] || 0) + 1;
    return groups;
  }, {});

  return Object.entries(counts)
    .map(([role, total]) => `${total} en ${role}`)
    .join(", ");
}

function waitingMessageForRole(role) {
  return "No hay reportes pendientes por aprobar.";
}

function latestCorrectionNote(report) {
  return report?.status === REPORT_STATUSES.NEEDS_CORRECTION
    ? String(report.reviewNote || report.correctionNote || "").trim()
    : "";
}

function canDeleteReport(report, role = activeRole()) {
  if (!report) return false;
  if (isSystemAdminRole(role)) return true;
  if (report.status !== REPORT_STATUSES.NEEDS_CORRECTION) return false;
  const correctionRole = report.correctionForRole || "Facilitador";
  return normalizeRoleLabel(role) === correctionRole;
}

function formatFileSize(bytes = 0) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return size ? `${size} B` : "";
}

function reportAttachments(report) {
  return Array.isArray(report?.attachments) ? report.attachments.filter((attachment) => attachment?.name) : [];
}

function renderAttachmentLinks(report, compact = false) {
  const attachments = reportAttachments(report);
  if (!attachments.length) {
    return compact ? "" : `<p class="item-meta">Documento adjunto: Sin documento adjunto.</p>`;
  }

  const links = attachments
    .map((attachment, index) => {
      const label = escapeHtml(attachment.name || `Documento ${index + 1}`);
      const size = formatFileSize(attachment.size);
      const meta = [attachment.type, size].filter(Boolean).join(" · ");
      const href = uploadFileUrl(attachment) || attachment.dataUrl || "";
      if (!href) {
        return `<span class="attachment-link unavailable">${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</span>`;
      }
      return `
        <a class="attachment-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
          Abrir ${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}
        </a>
      `;
    })
    .join("");

  return `<div class="attachment-list">${links}</div>`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No pude leer el documento adjunto."));
    reader.readAsDataURL(file);
  });
}

function blobUrlFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/);
  if (!match) return "";
  const binary = atob(match[2] || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: match[1] || "application/octet-stream" }));
}

function openDataUrlDocument(dataUrl, fallbackName = "documento") {
  const blobUrl = blobUrlFromDataUrl(dataUrl);
  if (!blobUrl) {
    showToast(`No pude abrir ${fallbackName}.`);
    return;
  }
  const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    showToast("El navegador bloqueo la nueva pestana. Permite ventanas emergentes para abrir el documento.");
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

function conceptPaperFileUrl(paper) {
  if (!paper?.id || !isApiConfigured()) return "";
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return "";
  return `${baseUrl}/concept-papers/${encodeURIComponent(paper.id)}/file`;
}

function programManualFileUrl(manual) {
  if (!manual?.id || !isApiConfigured()) return "";
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return "";
  return `${baseUrl}/program-manuals/${encodeURIComponent(manual.id)}/file`;
}

function uploadFileUrl(fileRef) {
  if (!fileRef || !isApiConfigured()) return "";
  try {
    return apiFileUrl(fileRef);
  } catch {
    return "";
  }
}

async function attachmentFromFile(file, uploadedBy = null, kind = "report-attachments") {
  if (!file) return null;
  if (file.size > MAX_REPORT_ATTACHMENT_BYTES) {
    throw new Error(`El documento adjunto supera ${formatFileSize(MAX_REPORT_ATTACHMENT_BYTES)}. Sube un archivo más liviano.`);
  }

  const uploadedFile = isApiConfigured() ? await uploadApiFile(file, { kind }) : null;
  return {
    id: `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: file.name,
    type: uploadedFile?.mimeType || file.type || "application/octet-stream",
    size: uploadedFile?.size ?? file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: uploadedBy || currentUser?.email || activeRole(),
    path: uploadedFile?.path || "",
    fileUrl: uploadedFile ? uploadFileUrl(uploadedFile) : "",
    dataUrl: uploadedFile ? null : await readFileAsDataUrl(file),
  };
}

async function attachmentsFromFiles(files, uploadedBy = null, kind = "report-attachments") {
  const fileList = Array.from(files || []).filter(Boolean);
  if (!fileList.length) return [];
  const attachments = await Promise.all(fileList.map((file) => attachmentFromFile(file, uploadedBy, kind)));
  return attachments.filter(Boolean);
}

function evidenceLabel(type) {
  if (type === "link") return "Enlace";
  if (type === "photo") return "Foto adjunta";
  if (type === "file") return "Archivo adjunto";
  return "Nota";
}

function buildEvidenceSummary(type, detail, attachments = []) {
  const cleanDetail = String(detail || "").trim();
  const attachmentNames = attachments.map((attachment) => attachment?.name).filter(Boolean);
  const pieces = [];
  if (cleanDetail) {
    pieces.push(`${evidenceLabel(type)}: ${cleanDetail}`);
  } else if (type === "photo" || type === "file") {
    pieces.push(evidenceLabel(type));
  }
  if (attachmentNames.length) {
    pieces.push(`Adjuntos: ${attachmentNames.join(", ")}`);
  }
  return pieces.join(" | ").trim();
}

function evidenceUploadAccept(type) {
  if (type === "photo") return "image/*,.jpg,.jpeg,.png";
  return ".csv,text/csv,.xlsx,.xls,.doc,.docx,.pdf,.txt,.jpg,.jpeg,.png,.zip";
}

function selectedEvidenceDetail() {
  const type = String(elements.reportEvidenceType?.value || "note").trim();
  if (type === "link") {
    return String(elements.reportEvidenceLinkInput?.value || "").trim();
  }
  if (type === "photo" || type === "file") {
    return "";
  }
  return String(elements.reportEvidenceNoteInput?.value || "").trim();
}

function renderReportAttachmentPreview() {
  const files = Array.from(elements.reportFormUploadInput?.files || []);
  const type = String(elements.reportEvidenceType?.value || "note").trim();
  const oversizedFile = files.find((file) => file.size > MAX_REPORT_ATTACHMENT_BYTES);
  if (oversizedFile) {
    elements.reportUploadStatus.textContent = "Archivo grande";
    elements.reportUploadStatus.className = "status-pill danger";
    elements.reportUploadPreview.innerHTML = `<p class="item-meta">El documento supera ${formatFileSize(MAX_REPORT_ATTACHMENT_BYTES)}. Sube una version mas liviana para adjuntarla al reporte.</p>`;
    return;
  }
  elements.reportUploadStatus.textContent = files.length > 1 ? `${files.length} adjuntos` : files[0]?.name || "Sin archivo";
  elements.reportUploadStatus.className = `status-pill ${files.length ? "info" : "neutral"}`;
  elements.reportUploadPreview.innerHTML = files.length
    ? `
      <p class="item-meta">${
        type === "photo"
          ? "Las imagenes viajaran con el reporte para que quienes revisan y aprueban puedan abrirlas."
          : "Los adjuntos viajaran con el reporte para que quienes revisan y aprueban puedan abrirlos."
      }</p>
      <ul class="item-meta">
        ${files.map((file) => `<li>${escapeHtml(file.name)}${file.size ? ` (${escapeHtml(formatFileSize(file.size))})` : ""}</li>`).join("")}
      </ul>
    `
    : "";
}

function setReportAttachmentFiles(files = []) {
  if (!elements.reportFormUploadInput) return;
  const transfer = new DataTransfer();
  Array.from(files || []).forEach((file) => {
    if (file) transfer.items.add(file);
  });
  elements.reportFormUploadInput.files = transfer.files;
  renderReportAttachmentPreview();
}

function syncEvidenceInputMode() {
  if (!elements.reportEvidenceType) return;
  const type = String(elements.reportEvidenceType.value || "note").trim();
  if (elements.reportEvidenceNoteGroup) elements.reportEvidenceNoteGroup.hidden = type !== "note";
  if (elements.reportEvidenceLinkGroup) elements.reportEvidenceLinkGroup.hidden = type !== "link";
  if (elements.reportEvidenceUploadGroup) elements.reportEvidenceUploadGroup.hidden = !(type === "photo" || type === "file");
  if (elements.reportEvidenceLinkInput) {
    elements.reportEvidenceLinkInput.placeholder = "https://...";
  }
  if (elements.reportEvidenceNoteInput) {
    elements.reportEvidenceNoteInput.placeholder =
      type === "note" ? "Describe la evidencia o agrega una referencia breve" : elements.reportEvidenceNoteInput.placeholder;
  }
  if (elements.reportFormUploadInput) {
    elements.reportFormUploadInput.accept = evidenceUploadAccept(type);
  }
  if (elements.reportEvidenceUploadLabel) {
    elements.reportEvidenceUploadLabel.textContent = type === "photo" ? "Adjuntar imagenes" : "Adjuntar archivos";
  }
  if (elements.reportEvidenceUploadHint) {
    elements.reportEvidenceUploadHint.textContent =
      type === "photo"
        ? "Arrastra imagenes aqui o selecciona una o varias desde tu computadora."
        : "Arrastra archivos aqui o selecciona uno o varios desde tu computadora.";
  }
  if (elements.reportEvidenceDropzoneTitle) {
    elements.reportEvidenceDropzoneTitle.textContent = type === "photo" ? "Arrastra imagenes aqui" : "Arrastra archivos aqui";
  }
  if (elements.reportEvidenceDropzoneText) {
    elements.reportEvidenceDropzoneText.textContent =
      type === "photo"
        ? "o haz clic para seleccionar imagenes desde tu computadora"
        : "o haz clic para seleccionar archivos desde tu computadora";
  }
  if (elements.reportEvidenceDropzone) {
    elements.reportEvidenceDropzone.dataset.mode = type;
  }
  renderReportAttachmentPreview();
}

async function conceptPaperDocumentFromFile(file, formData) {
  if (!file) {
    throw new Error("Selecciona un documento para cargar.");
  }
  if (file.size > MAX_CONCEPT_PAPER_BYTES) {
    throw new Error(`El documento supera ${formatFileSize(MAX_CONCEPT_PAPER_BYTES)}. Sube una version mas liviana.`);
  }

  const program = String(formData.get("program") || "").trim();
  const title = String(formData.get("title") || file.name || "").trim();
  const uploadedBy = currentUser?.email || currentUser?.fullName || activeRole();
  const normalizedProgram = conceptProgramFromContent({ program, title, fileName: file.name });
  const programInfo = state.programs.find((item) => item.name === normalizedProgram) || {};
  const uploadedFile = isApiConfigured() ? await uploadApiFile(file, { kind: "concept-papers" }) : null;
  const indicatorNames = Array.isArray(programInfo.indicatorBlueprints)
    ? programInfo.indicatorBlueprints.map((item) => item.name).filter(Boolean)
    : [];
  const expectedResults = Array.isArray(programInfo.expectedResults) ? programInfo.expectedResults.filter(Boolean) : [];
  return {
    id: `cp-${slugify(program || title || file.name)}-${Date.now()}`,
    program: normalizedProgram,
    title: title.replace(/\bCFA\b/g, "CFI"),
    presenter: String(formData.get("presenter") || uploadedBy || "Equipo M&E").trim(),
    fileName: file.name,
    path: uploadedFile?.path || "",
    fileUrl: uploadedFile ? uploadFileUrl(uploadedFile) : "",
    dataUrl: uploadedFile ? null : await readFileAsDataUrl(file),
    mimeType: uploadedFile?.mimeType || file.type || "application/octet-stream",
    size: uploadedFile?.size ?? file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    year: String(formData.get("year") || new Date().getFullYear()).trim(),
    status: "Cargado",
    objective:
      String(formData.get("objective") || "").trim() ||
      programInfo.focus ||
      "Documento cargado por administracion para alimentar la biblioteca de Concept Papers.",
    beneficiaries: programInfo.primaryPopulation || "Pendiente de completar desde el documento cargado.",
    budget: programInfo.budget || "Pendiente",
    methodology: expectedResults.length ? expectedResults : ["Revisar metodologia dentro del documento adjunto."],
    expectedImpact: expectedResults.length ? expectedResults : ["Revisar impacto esperado dentro del documento adjunto."],
    measurableResults: indicatorNames.length ? indicatorNames : ["Revisar resultados medibles dentro del documento adjunto."],
    recommendedForms: ["Monitoreo semanal", "Evaluacion final"],
    achievementIndicators: indicatorNames.length ? indicatorNames : ["Indicadores pendientes de definir desde el Concept Paper."],
  };
}

async function programManualDocumentFromFile(file, formData) {
  if (!file) {
    throw new Error("Selecciona un manual en PDF.");
  }
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    throw new Error("Los manuales deben subirse en formato PDF.");
  }
  if (file.size > MAX_PROGRAM_MANUAL_BYTES) {
    throw new Error(`El manual supera ${formatFileSize(MAX_PROGRAM_MANUAL_BYTES)}. Sube una version mas liviana.`);
  }

  const program = String(formData.get("program") || "").trim();
  const title = String(formData.get("title") || file.name || "").trim();
  const uploadedBy = currentUser?.email || currentUser?.fullName || activeRole();
  const uploadedFile = isApiConfigured() ? await uploadApiFile(file, { kind: "program-manuals" }) : null;
  return {
    id: `manual-${slugify(program || title || file.name)}-${Date.now()}`,
    companyId: currentUser?.organizationId || "org-convoy-of-hope",
    organizationId: currentUser?.organizationId || "org-convoy-of-hope",
    organizationName: currentUser?.organizationName || "Convoy of Hope",
    program,
    title,
    fileName: file.name,
    path: uploadedFile?.path || "",
    fileUrl: uploadedFile ? uploadFileUrl(uploadedFile) : "",
    dataUrl: uploadedFile ? null : await readFileAsDataUrl(file),
    mimeType: "application/pdf",
    size: uploadedFile?.size ?? file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    year: String(formData.get("year") || new Date().getFullYear()).trim(),
    status: "Cargado",
    version: String(formData.get("version") || "1.0").trim(),
    notes: String(formData.get("notes") || "").trim(),
  };
}

async function refreshConceptPapersFromApi() {
  if (!isApiConfigured()) return;
  const remoteConceptPapers = await fetchApiConceptPapers();
  state.conceptPapers = remoteConceptPapers;
  if (!state.conceptPapers.some((paper) => paper.id === state.selectedConceptPaper)) {
    state.selectedConceptPaper = state.conceptPapers[0]?.id || null;
  }
  saveState();
}

async function refreshProgramManualsFromApi() {
  if (!isApiConfigured()) return;
  state.programManuals = await fetchApiProgramManuals();
  saveState();
}

async function refreshProgramCentersFromApi() {
  if (!isApiConfigured()) return;
  const remoteCenters = await fetchApiProgramCenters();
  state.programCenters = remoteCenters;
  saveState();
}

function renderIndicators() {
  const programIndicators =
    state.filters.program === "Todos"
      ? state.indicators
      : state.indicators.filter((indicator) => indicator.program === state.filters.program);

  elements.indicatorBoard.innerHTML = programIndicators
    .map((indicator) => {
      const progress = percent(indicator.value, indicator.target);
      const risk = statusForProgress(progress);
      return `
        <article class="indicator-item">
          <div class="indicator-top">
            <div>
              <h3>${indicator.name}</h3>
              <p class="item-meta">${indicator.program} · ${indicator.type || "Indicador"} · Responsable: ${indicator.owner}</p>
            </div>
            <span class="status-pill ${risk}">${progress}%</span>
          </div>
          <div class="progress-line">
            <div class="progress-head">
              <span>${indicator.value.toLocaleString("es-DO")} ${indicator.unit}</span>
              <span>Meta ${indicator.target.toLocaleString("es-DO")}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill ${risk}" style="width: ${progress}%"></div>
            </div>
          </div>
          <p class="item-meta">Fecha meta: ${indicator.due}</p>
          <div class="item-actions">
            <button type="button" data-edit-indicator="${indicator.id}">Editar</button>
            <button type="button" data-delete-indicator="${indicator.id}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function selectedDesignProgram() {
  return state.programs.find((program) => program.name === state.designProgram) || state.programs[0];
}

function selectedFormsProgram() {
  return state.programs.find((program) => program.name === state.formsProgram) || selectedDesignProgram();
}

function buildSuggestedIndicators(program) {
  if (program.indicatorBlueprints?.length) {
    return program.indicatorBlueprints;
  }

  const resultCount = program.expectedResults.length || 1;
  return [
    {
      name: `Participantes alcanzan el resultado esperado de ${program.name}`,
      target: Math.max(100, Math.round(program.beneficiaries * 0.72)),
      unit: "personas",
      owner: `Coordinacion ${program.name}`,
      due: "2026-12",
      source: "Resultado del programa",
    },
    {
      name: `Actividades de ${program.name} con evidencia validada`,
      target: resultCount * 24,
      unit: "actividades",
      owner: "Equipo M&E",
      due: "2026-12",
      source: "Monitoreo operativo",
    },
    {
      name: `Participantes reportan cambio positivo en ${program.name}`,
      target: Math.max(50, Math.round(program.beneficiaries * 0.45)),
      unit: "personas",
      owner: "Equipo de evaluacion",
      due: "2026-12",
      source: "Evaluacion de resultados",
    },
  ];
}

function selectedConceptPaper() {
  return state.conceptPapers.find((paper) => paper.id === state.selectedConceptPaper) || state.conceptPapers[0];
}

function renderConceptPapers() {
  const papers = state.conceptPapers || [];
  const manuals = state.programManuals || [];
  const activePaper = selectedConceptPaper();
  const canDeleteLibraryDocuments = isSystemAdminRole();
  const totalDocuments = papers.length + manuals.length;
  elements.conceptCount.textContent = `${totalDocuments} ${totalDocuments === 1 ? "documento" : "documentos"}`;

  const conceptPaperMarkup = papers
    .map(
      (paper) => {
        const documentHref = conceptPaperFileUrl(paper) || (paper.path ? localFileUrl(paper.path) : "");
        const openLabel = /pdf/i.test(`${paper.mimeType || ""} ${paper.fileName || ""}`) ? "Abrir PDF" : "Abrir documento";
        const openDocument = documentHref
          ? `<a class="ghost-link" href="${escapeHtml(documentHref)}" target="_blank" rel="noreferrer">${openLabel}</a>`
          : paper.dataUrl
          ? `<button class="ghost-link" data-open-concept-document="${escapeHtml(paper.id)}" type="button">${openLabel}</button>`
          : `<span class="item-meta">Sin archivo</span>`;
        return `
        <article class="concept-card ${paper.id === activePaper?.id ? "active" : ""}">
          <div>
            <p class="eyebrow">${paper.year} · ${paper.status}</p>
            <h3>${paper.title}</h3>
            <p class="item-meta">${paper.program} · ${paper.presenter}</p>
          </div>
          <div class="concept-actions">
            <button class="ghost-action" data-concept-id="${paper.id}" type="button">Ver resumen</button>
            ${openDocument}
            ${
              canDeleteLibraryDocuments
                ? `<button class="ghost-action danger-action" data-delete-concept-paper="${escapeHtml(paper.id)}" type="button">Eliminar</button>`
                : ""
            }
          </div>
        </article>
      `;
      },
    )
    .join("");
  const manualMarkup = manuals.length
    ? manuals
        .map((manual) => {
          const documentHref = programManualFileUrl(manual);
          const openDocument = documentHref
            ? `<a class="ghost-link" href="${escapeHtml(documentHref)}" target="_blank" rel="noreferrer">Abrir PDF</a>`
            : manual.dataUrl
            ? `<button class="ghost-link" data-open-program-manual="${escapeHtml(manual.id)}" type="button">Abrir PDF</button>`
            : `<span class="item-meta">Sin archivo</span>`;
          return `
            <article class="concept-card">
              <div>
                <p class="eyebrow">${escapeHtml(manual.year || "")} · Manual · Version ${escapeHtml(manual.version || "1.0")}</p>
                <h3>${escapeHtml(manual.title || manual.fileName || "Manual de programa")}</h3>
                <p class="item-meta">${escapeHtml(manual.program || "Programa")} · ${escapeHtml(manual.fileName || "manual.pdf")}</p>
              </div>
              <div class="concept-actions">
                ${openDocument}
                ${
                  canDeleteLibraryDocuments
                    ? `<button class="ghost-action danger-action" data-delete-program-manual="${escapeHtml(manual.id)}" type="button">Eliminar</button>`
                    : ""
                }
              </div>
            </article>
          `;
        })
        .join("")
    : `<p class="item-meta">Todavia no hay manuales cargados.</p>`;

  elements.conceptPaperList.innerHTML = `
    <div class="library-group">
      <p class="eyebrow">Concept Papers</p>
      ${conceptPaperMarkup || `<p class="item-meta">Todavia no hay concept papers cargados.</p>`}
    </div>
    <div class="library-group">
      <p class="eyebrow">Manuales de programa</p>
      ${manualMarkup}
    </div>
  `;

  if (!activePaper) {
    elements.conceptDetailTitle.textContent = "Sin concept paper";
    elements.conceptPaperDetail.innerHTML = `<p class="item-meta">Todavia no hay concept papers cargados.</p>`;
    return;
  }

  elements.conceptDetailTitle.textContent = activePaper.program;
  elements.conceptPaperDetail.innerHTML = `
    <article class="concept-summary">
      <p class="eyebrow">Objetivo general</p>
      <p>${activePaper.objective}</p>
      <div class="coverage">
        <span>${activePaper.beneficiaries}</span>
        <span>Presupuesto: ${activePaper.budget}</span>
        <span>Archivo: ${activePaper.fileName}</span>
        ${activePaper.size ? `<span>Tamaño: ${formatFileSize(activePaper.size)}</span>` : ""}
      </div>
    </article>
    <div class="concept-detail-grid">
      <article>
        <h3>Metodologia</h3>
        <ul>${renderBullets(activePaper.methodology)}</ul>
      </article>
      <article>
        <h3>Impacto esperado</h3>
        <ul>${renderBullets(activePaper.expectedImpact)}</ul>
      </article>
      <article>
        <h3>Resultados medibles</h3>
        <ul>${renderBullets(activePaper.measurableResults)}</ul>
      </article>
      <article>
        <h3>Formularios necesarios</h3>
        <ul>${renderBullets(activePaper.recommendedForms)}</ul>
      </article>
      <article class="span-detail">
        <h3>Indicadores de logro creados</h3>
        <div class="field-preview">
          ${(activePaper.achievementIndicators || []).map((indicator) => `<span>${indicator}</span>`).join("")}
        </div>
      </article>
    </div>
  `;
}

function attendanceParticipantsForProgram(program = state.attendanceProgram) {
  return (state.attendanceParticipants || [])
    .filter((participant) => participant.program === program && participant.status !== "inactive")
    .sort((left, right) => left.name.localeCompare(right.name));
}

function attendanceCenterValue() {
  const centers = attendanceCentersForProgram();
  const selectedCenter = String(state.attendanceCenter || "").trim();
  if (centers.includes(selectedCenter)) return selectedCenter;
  return centers[0] || "General";
}

function attendancePeriodValue() {
  return state.attendancePeriod || String(state.attendanceWeek || "").slice(0, 7) || currentMonth();
}

function attendanceSessionFor(
  program = state.attendanceProgram,
  weekStart = state.attendanceWeek,
  center = attendanceCenterValue(),
  period = attendancePeriodValue(),
) {
  return (
    (state.attendanceSessions || []).find(
      (session) =>
        session.program === program &&
        session.weekStart === weekStart &&
        (session.center || "General") === center &&
        (session.period || session.weekStart?.slice(0, 7)) === period,
    ) || null
  );
}

function attendanceEntryStatus(entry = {}) {
  if (["present", "absent", "excused"].includes(entry.status)) return entry.status;
  return entry.present ? "present" : "absent";
}

function attendanceIsPrivilegedEditor(role = activeRole()) {
  return ["Coordinador de programa", "Supervision M&E"].includes(normalizeRoleLabel(role));
}

function attendanceCanEdit(session = attendanceSessionFor()) {
  return !session?.locked || attendanceIsPrivilegedEditor();
}

function attendanceEffectivePresentCount(entries = []) {
  return entries.filter((entry) => ["present", "excused"].includes(attendanceEntryStatus(entry))).length;
}

function attendanceStatusLabel(status) {
  return {
    present: "Presente",
    absent: "Ausente",
    excused: "Excusa",
  }[status] || "Ausente";
}

function attendanceMonthlyKey(weekStart = state.attendanceWeek) {
  return String(weekStart || "").slice(0, 7);
}

function attendanceMonthlyScores() {
  const monthKey = attendancePeriodValue();
  return attendanceParticipantsForProgram().map((participant) => {
    const sessions = (state.attendanceSessions || []).filter(
      (session) =>
        session.program === state.attendanceProgram &&
        (session.center || "General") === attendanceCenterValue() &&
        (session.period || session.weekStart?.slice(0, 7)) === attendancePeriodValue() &&
        attendanceMonthlyKey(session.weekStart) === monthKey,
    );
    let absences = 0;
    let excuses = 0;
    sessions.forEach((session) => {
      const entry = (session.entries || []).find((item) => item.participantId === participant.id);
      const status = attendanceEntryStatus(entry || { status: "absent" });
      if (status === "absent") absences += 1;
      if (status === "excused") excuses += 1;
    });
    const score = Math.max(0, 100 - (absences + Math.max(0, excuses - 1)) * 25);
    return { participantId: participant.id, name: participant.name, absences, excuses, score };
  });
}

function attendanceEntriesForCurrentSelection() {
  const session = attendanceSessionFor();
  const entryById = new Map((session?.entries || []).map((entry) => [entry.participantId, entry]));
  return attendanceParticipantsForProgram().map((participant) => ({
    participantId: participant.id,
    name: participant.name,
    status: attendanceEntryStatus(entryById.get(participant.id) || {}),
    present: attendanceEntryStatus(entryById.get(participant.id) || {}) === "present",
    excuseNote: entryById.get(participant.id)?.excuseNote || "",
  }));
}

function attendanceEntriesFromChecklist() {
  if (!elements.attendanceList) return attendanceEntriesForCurrentSelection();
  const rows = Array.from(elements.attendanceList.querySelectorAll("[data-attendance-row]"));
  if (!rows.length) return attendanceEntriesForCurrentSelection();
  return rows.map((row) => {
    const participantId = row.dataset.attendanceRow;
    const selected = row.querySelector("[data-attendance-status]:checked");
    const status = selected?.value || "absent";
    const participant = (state.attendanceParticipants || []).find((item) => item.id === participantId);
    return {
      participantId,
      name: participant?.name || "Participante",
      status,
      present: status === "present",
    };
  });
}

function attendanceNameListMarkup(entries, status) {
  const filtered = entries.filter((entry) => attendanceEntryStatus(entry) === status);
  if (!filtered.length) {
    const emptyText = {
      present: "Nadie marcado presente.",
      absent: "No hay ausencias marcadas.",
      excused: "No hay excusas registradas.",
    }[status];
    return `<p class="item-meta">${emptyText}</p>`;
  }
  return `
    <ul class="attendance-name-list">
      ${filtered.map((entry) => `<li>${escapeHtml(entry.name)}</li>`).join("")}
    </ul>
  `;
}

function renderAttendanceWeekDetail(entries = attendanceEntriesForCurrentSelection()) {
  const presentCount = entries.filter((entry) => attendanceEntryStatus(entry) === "present").length;
  const excusedCount = entries.filter((entry) => attendanceEntryStatus(entry) === "excused").length;
  const absentCount = entries.filter((entry) => attendanceEntryStatus(entry) === "absent").length;
  const session = attendanceSessionFor();
  return `
    <section class="attendance-week-detail">
      <div class="attendance-bar-top">
        <div>
          <p class="eyebrow">Detalle de semana</p>
          <h3>${escapeHtml(state.attendanceWeek)}</h3>
          <p class="item-meta">${escapeHtml(attendanceCenterValue())} · ${escapeHtml(attendancePeriodValue())}</p>
        </div>
        <span class="status-pill info">${attendanceEffectivePresentCount(entries)}/${entries.length} efectivos</span>
      </div>
      ${session?.notes ? `<p class="item-meta">${escapeHtml(session.notes)}</p>` : ""}
      <div class="attendance-status-grid">
        <article class="attendance-status-card present">
          <strong>Presentes (${presentCount})</strong>
          ${attendanceNameListMarkup(entries, "present")}
        </article>
        <article class="attendance-status-card excused">
          <strong>Excusas (${excusedCount})</strong>
          ${attendanceNameListMarkup(entries, "excused")}
        </article>
        <article class="attendance-status-card absent">
          <strong>Ausentes (${absentCount})</strong>
          ${attendanceNameListMarkup(entries, "absent")}
        </article>
      </div>
    </section>
  `;
}

function renderAttendanceMonthlyChart() {
  const scores = attendanceMonthlyScores();
  if (!scores.length) return "";
  return `
    <section class="attendance-week-detail">
      <div class="attendance-bar-top">
        <div>
          <p class="eyebrow">Grafica mensual</p>
          <h3>${escapeHtml(attendancePeriodValue())}</h3>
          <p class="item-meta">${escapeHtml(state.attendanceProgram)} · ${escapeHtml(attendanceCenterValue())}</p>
        </div>
        <span class="status-pill info">4 semanas · 25% cada ausencia</span>
      </div>
      <div class="attendance-monthly-grid">
        ${scores
          .map(
            (item) => `
              <article class="attendance-monthly-card ${item.score <= 50 ? "danger" : ""}">
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <p class="item-meta">${item.absences} ausencias · ${item.excuses} excusas</p>
                </div>
                <span class="attendance-score">${item.score}%</span>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderAttendanceChart(detailEntries = attendanceEntriesForCurrentSelection()) {
  const sessions = (state.attendanceSessions || [])
    .filter(
      (session) =>
        session.program === state.attendanceProgram &&
        (session.center || "General") === attendanceCenterValue() &&
        (session.period || session.weekStart?.slice(0, 7)) === attendancePeriodValue(),
    )
    .slice()
    .sort((left, right) => String(left.weekStart).localeCompare(String(right.weekStart)))
    .slice(-8);

  if (!sessions.length) {
    elements.attendanceChart.innerHTML = `
      <p class="item-meta">Todavia no hay asistencia guardada para este programa.</p>
      ${renderAttendanceWeekDetail(detailEntries)}
      ${renderAttendanceMonthlyChart()}
    `;
    return;
  }

  elements.attendanceChart.innerHTML = `
    <div class="attendance-chart-bars">
      ${sessions
        .map((session) => {
          const total = session.entries?.length || 0;
          const present = attendanceEffectivePresentCount(session.entries || []);
          const rate = total ? Math.round((present / total) * 100) : 0;
          return `
            <button class="attendance-bar ${session.weekStart === state.attendanceWeek ? "active" : ""}" type="button" data-attendance-week="${escapeHtml(session.weekStart)}">
              <span class="attendance-bar-top">
                <strong>${escapeHtml(session.weekStart)}</strong>
                <span>${present}/${total} · ${rate}%</span>
              </span>
              <span class="bar-track"><span style="width: ${rate}%"></span></span>
            </button>
          `;
        })
        .join("")}
    </div>
    ${renderAttendanceWeekDetail(detailEntries)}
    ${renderAttendanceMonthlyChart()}
  `;
}

function renderAttendance() {
  if (!elements.attendanceProgramSelect) return;
  const programs = attendanceProgramOptions();
  if (!programs.includes(state.attendanceProgram)) {
    state.attendanceProgram = programs[0] || "Programa general";
  }
  setOptions(elements.attendanceProgramSelect, programs, state.attendanceProgram);
  if (elements.attendanceCenterInput) {
    const centers = attendanceCentersForProgram(state.attendanceProgram);
    const resolvedCenter = centers.includes(state.attendanceCenter) ? state.attendanceCenter : centers[0] || "General";
    state.attendanceCenter = resolvedCenter;
    setOptions(elements.attendanceCenterInput, centers, resolvedCenter);
  }
  if (elements.attendancePeriodInput) elements.attendancePeriodInput.value = attendancePeriodValue();
  elements.attendanceWeekInput.value = state.attendanceWeek;
  const entries = attendanceEntriesForCurrentSelection();
  const presentCount = entries.filter((entry) => attendanceEntryStatus(entry) === "present").length;
  const excusedCount = entries.filter((entry) => attendanceEntryStatus(entry) === "excused").length;
  const absentCount = entries.filter((entry) => attendanceEntryStatus(entry) === "absent").length;
  const session = attendanceSessionFor();
  const isAdmin = isSystemAdminRole();
  const isLockedForUser = Boolean(session?.locked && !attendanceCanEdit(session));
  if (elements.attendanceChatButton) {
    elements.attendanceChatButton.hidden = !viewIsEnabled("chat");
    elements.attendanceChatButton.disabled = !viewIsEnabled("chat");
  }
  elements.attendanceSummary.textContent = `${presentCount} presentes · ${excusedCount} excusas · ${absentCount} ausentes`;
  elements.attendanceNotes.value = session?.notes || "";
  elements.attendanceNotes.disabled = isLockedForUser;
  if (elements.saveAttendanceButton) {
    elements.saveAttendanceButton.disabled = isLockedForUser || !entries.length;
    elements.saveAttendanceButton.textContent = session ? "Actualizar asistencia" : "Guardar asistencia";
  }
  if (elements.deleteAttendanceSessionButton) {
    elements.deleteAttendanceSessionButton.hidden = !isAdmin;
    elements.deleteAttendanceSessionButton.disabled = !session;
  }
  if (elements.clearAttendanceParticipantsButton) {
    elements.clearAttendanceParticipantsButton.hidden = !isAdmin;
    elements.clearAttendanceParticipantsButton.disabled = !attendanceParticipantsForProgram().length;
  }
  if (elements.resetAttendanceProgramButton) {
    elements.resetAttendanceProgramButton.hidden = !isAdmin;
    elements.resetAttendanceProgramButton.disabled =
      !attendanceParticipantsForProgram().length &&
      !(state.attendanceSessions || []).some((session) => session.program === state.attendanceProgram);
  }
  document.querySelectorAll(".attendance-lock-panel").forEach((panel) => panel.remove());
  elements.attendanceList.innerHTML = entries.length
    ? entries
        .map(
          (entry) => {
            const status = attendanceEntryStatus(entry);
            const participantId = escapeHtml(entry.participantId);
            const radioName = `attendance-${participantId}`;
            return `
            <div class="attendance-row" data-attendance-row="${participantId}">
              <span>${escapeHtml(entry.name)}</span>
              <div class="attendance-choice-group" role="radiogroup" aria-label="Asistencia de ${escapeHtml(entry.name)}">
                ${["present", "absent", "excused"]
                  .map(
                    (option) => `
                      <label class="attendance-choice ${status === option ? "active" : ""}">
                        <input type="radio" name="${radioName}" value="${option}" data-attendance-status data-attendance-participant="${participantId}" ${status === option ? "checked" : ""} ${isLockedForUser ? "disabled" : ""} />
                        <span>${attendanceStatusLabel(option)}</span>
                      </label>
                    `,
                  )
                  .join("")}
              </div>
              <span class="attendance-state-badge ${status}">${attendanceStatusLabel(status)}</span>
              ${isAdmin ? `<button class="icon-button danger-icon" type="button" data-delete-attendance-participant="${participantId}" aria-label="Eliminar participante">×</button>` : ""}
            </div>
          `;
          },
        )
        .join("")
    : `<p class="item-meta">Agrega participantes para pasar lista semanal en este programa.</p>`;
  const editRequest = session?.editRequest;
  const lockMarkup =
    session?.locked && !attendanceIsPrivilegedEditor()
      ? `
        <section class="attendance-lock-panel">
          <strong>Asistencia bloqueada despues de guardar</strong>
          <p class="item-meta">${
            editRequest?.status === "pending"
              ? `Solicitud pendiente: ${escapeHtml(editRequest.note || "")}`
              : "Para cambiar esta semana, solicita autorizacion al coordinador o a Supervision M&E."
          }</p>
          <textarea id="attendanceEditRequestNote" rows="3" placeholder="Explica que necesitas corregir">${escapeHtml(editRequest?.note || "")}</textarea>
          <button type="button" class="secondary-button" data-request-attendance-edit>Solicitar editar asistencia</button>
        </section>
      `
      : session?.locked
        ? `<section class="attendance-lock-panel"><p class="item-meta">${
            editRequest?.status === "pending"
              ? `Solicitud pendiente de edicion: ${escapeHtml(editRequest.note || "")}`
              : "Esta semana ya esta guardada. Tu perfil puede editarla directamente."
          }</p></section>`
        : "";
  if (lockMarkup) elements.attendanceList.insertAdjacentHTML("afterend", lockMarkup);
  renderAttendanceChart();
}

function renderDesignStudio() {
  const program = selectedDesignProgram();
  const suggestions = buildSuggestedIndicators(program);

  elements.expectedResults.innerHTML = `
    <article class="program-summary">
      <h3>${program.name}</h3>
      <p>${program.focus}</p>
      <div class="coverage">
        <span>${program.primaryPopulation}</span>
        <span>${program.provinces.join(", ")}</span>
      </div>
    </article>
    ${program.expectedResults
      .map(
        (result, index) => `
          <article class="result-item">
            <span class="result-number">${index + 1}</span>
            <p>${result}</p>
          </article>
        `,
      )
      .join("")}
  `;

  elements.indicatorSuggestions.innerHTML = suggestions
    .map(
      (indicator) => `
        <article class="suggestion-item">
          <div>
            <h3>${indicator.name}</h3>
            <p class="item-meta">${indicator.source} · Meta sugerida: ${indicator.target.toLocaleString("es-DO")} ${indicator.unit}</p>
          </div>
          <span class="status-pill neutral">${indicator.owner}</span>
        </article>
      `,
    )
    .join("");
}

function renderForms() {
  const program = selectedFormsProgram();
  const programForms = state.monitoringForms.filter((form) => form.program === program.name);

  elements.formTemplateGrid.innerHTML = programForms.length
    ? programForms.map(renderFormTemplate).join("")
    : `<p class="item-meta">Todavia no hay formularios para este programa. Puedes crear uno de monitoreo o de evaluacion.</p>`;
}

function renderFormTemplate(form) {
  const mappedIndicators = (form.mappings || [])
    .map((mapping) => indicatorById(mapping.indicatorId)?.name)
    .filter(Boolean);

  return `
    <article class="form-template">
      <div class="form-template-top">
        <div>
          <h3>${form.title}</h3>
          <p class="item-meta">${form.program} · ${form.frequency} · Responsable: ${form.owner}</p>
        </div>
        <span class="status-pill ${form.type === "Evaluacion" ? "info" : "neutral"}">${form.type}</span>
      </div>
      <div class="field-preview">
        ${form.fields.map((field) => `<span>${field}</span>`).join("")}
      </div>
      <p class="item-meta">Al subirlo, alimenta automaticamente: ${mappedIndicators.length ? mappedIndicators.join(" · ") : "indicadores configurados manualmente"}</p>
      <div class="form-template-actions">
        <button class="ghost-action" data-download-form="${form.id}" type="button">
          <span aria-hidden="true">?</span>
          CSV
        </button>
        <button class="ghost-action" data-download-word="${form.id}" type="button">
          <span aria-hidden="true">?</span>
          Word
        </button>
        <button class="ghost-action" data-download-pdf="${form.id}" type="button">
          <span aria-hidden="true">?</span>
          PDF
        </button>
      </div>
    </article>
  `;
}

function renderReviewQueue() {
  const currentRole = activeRole();
  const pendingReports = reportsAssignedToRole(currentRole);
  const validationEnabled = canValidate();
  const chatEnabled = viewIsEnabled("chat");
  elements.reviewList.innerHTML = pendingReports.length
    ? pendingReports
        .map((report) => {
          const indicator = indicatorById(report.indicatorId);
          const participants = reportParticipantSummary(report, " · ");
          return `
            <article class="review-item">
              <div class="review-top">
                <div>
                  <h3>${report.program}</h3>
                  <p class="item-meta">${indicator?.name ?? "Indicador eliminado"} · ${[report.province, report.center].filter(Boolean).join(" · ")}</p>
                </div>
                <span class="status-pill ${classForReportStatus(report.status)}">${report.status}</span>
              </div>
              <p>${report.value.toLocaleString("es-DO")} reportados por ${report.owner}. Evidencia: ${report.evidence || "Sin evidencia"}</p>
              ${renderAttachmentLinks(report)}
              <div class="coverage">
                <span>${participants}</span>
                <span>${report.period}</span>
              </div>
              ${report.notes ? `<p class="item-meta">${report.notes}</p>` : ""}
              <div class="review-actions">
                ${chatEnabled ? `<button class="ghost-action" data-open-report-chat="${report.id}" type="button">Abrir chat</button>` : ""}
                <button class="approve-button" data-approve="${report.id}" type="button" ${validationEnabled ? "" : "disabled"}>? Aprobar</button>
                <button class="return-button" data-return="${report.id}" type="button" ${validationEnabled ? "" : "disabled"}>? Solicitar correccion</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<p class="item-meta">${waitingMessageForRole(currentRole)}</p>`;

  pendingReports.forEach((report) => {
    const button = elements.reviewList.querySelector(`[data-approve="${report.id}"]`);
    if (button) {
      button.textContent = approvalButtonLabel(report);
    }
  });
}

function renderNotificationCard(notification) {
  const chatEnabled = viewIsEnabled("chat");
  return `
    <article class="notification-item ${notification.priority || "normal"}">
      <div class="notification-top">
        <div>
          <h3>${notification.title}</h3>
          <p class="item-meta">${notification.recipientRole} · ${notification.program} · ${notification.createdAt?.slice(0, 10) || "Hoy"}</p>
        </div>
        <span class="status-pill warning">Pendiente</span>
      </div>
      <p>${notification.message}</p>
      <div class="item-actions">
        <button type="button" data-open-report="${notification.reportId}">Ver revision</button>
        ${chatEnabled ? `<button class="ghost-action" type="button" data-open-report-chat="${notification.reportId}">Abrir chat</button>` : ""}
        <button type="button" data-read-notification="${notification.id}">Marcar leida</button>
      </div>
    </article>
  `;
}

function renderReportStatusDetail(report) {
  if (!report) return "";
  const indicator = indicatorById(report.indicatorId);
  const correctionNote = latestCorrectionNote(report);
  const chatEnabled = viewIsEnabled("chat");
  const nextStage = reviewRoleForStatus(report.status);
  const deleteAllowed = canDeleteReport(report);
  const isSupervisorDelete = isSystemAdminRole() && report.status !== REPORT_STATUSES.NEEDS_CORRECTION;
  const participants = reportParticipantSummary(report, " · ");
  return `
    <article class="notification-item high">
      <div class="notification-top">
        <div>
          <p class="eyebrow">Detalle del reporte</p>
          <h3>${report.program}</h3>
          <p class="item-meta">${indicator?.name ?? "Indicador eliminado"} · ${reportLocation(report)}</p>
        </div>
        <span class="status-pill ${classForReportStatus(report.status)}">${report.status}</span>
      </div>
      <p>${report.value.toLocaleString("es-DO")} reportados por ${report.owner}. ${nextStage ? `Pendiente para ${nextStage}.` : ""}</p>
      ${renderAttachmentLinks(report)}
      <p class="item-meta"><strong>Desglose reportado:</strong> ${escapeHtml(participants)}</p>
      ${report.notes ? `<p class="item-meta"><strong>Nota original:</strong> ${escapeHtml(report.notes)}</p>` : ""}
      ${
        correctionNote
          ? `<p class="item-meta"><strong>Correccion solicitada para ${escapeHtml(report.correctionForRole || "Facilitador")}:</strong> ${escapeHtml(correctionNote)}</p>`
          : `<p class="item-meta">No hay correcciones pendientes registradas para este reporte.</p>`
      }
      <div class="item-actions">
        ${
          deleteAllowed
            ? `<button class="ghost-action danger-action" type="button" data-delete-report="${report.id}">${isSupervisorDelete ? "Eliminar reporte" : "Eliminar y subir corregido"}</button>`
            : ""
        }
        ${chatEnabled ? `<button class="ghost-action" type="button" data-open-report-chat="${report.id}">Abrir chat del reporte</button>` : ""}
        <button type="button" data-close-report-detail>Ocultar detalle</button>
      </div>
    </article>
  `;
}

function renderReportInboxCard(report, role) {
  const indicator = indicatorById(report.indicatorId);
  const currentStage = reviewRoleForStatus(report.status);
  const participants = reportParticipantSummary(report, " · ");
  const correctionNote = latestCorrectionNote(report);
  const chatEnabled = viewIsEnabled("chat");
  const roleMessage =
    report.status === REPORT_STATUSES.NEEDS_CORRECTION
      ? `Correccion asignada a ${report.correctionForRole || "Facilitador"}.`
      : role === "Facilitador"
      ? `Esperando revision de ${currentStage || "equipo validador"}.`
      : `Pendiente para ${currentStage || role}.`;

  return `
    <article class="notification-item high">
      <div class="notification-top">
        <div>
          <h3>${report.program}</h3>
          <p class="item-meta">${indicator?.name ?? "Indicador eliminado"} · ${reportLocation(report)}</p>
        </div>
        <span class="status-pill warning">${report.status}</span>
      </div>
      <p>${report.value.toLocaleString("es-DO")} reportados por ${report.owner}. ${roleMessage}</p>
      <div class="coverage">
        <span>${participants}</span>
      </div>
      ${report.evidence ? `<p class="item-meta">Evidencia: ${report.evidence}</p>` : ""}
      ${renderAttachmentLinks(report)}
      ${report.notes ? `<p class="item-meta">Notas: ${report.notes}</p>` : ""}
      ${correctionNote ? `<p class="item-meta"><strong>Correccion solicitada:</strong> ${escapeHtml(correctionNote)}</p>` : ""}
      <div class="item-actions">
        <button type="button" data-open-report="${report.id}">${role === "Facilitador" ? "Ver estado" : "Ver revision"}</button>
        ${chatEnabled ? `<button class="ghost-action" type="button" data-open-report-chat="${report.id}">Abrir chat</button>` : ""}
      </div>
    </article>
  `;
}

function renderNotifications() {
  const role = activeRole();
  const inboxReports = inboxReportsForRole(role);
  const visibleNotifications = notificationsForActiveRole();
  const chatAlertConversation = latestUnreadChatConversation();
  const chatAlertCount = Number(state.chatUnreadCount?.totalUnreadConversations || 0);
  const visibleCount = inboxReports.length + visibleNotifications.length + chatAlertCount;
  const countText = `${visibleCount} pendiente${visibleCount === 1 ? "" : "s"}`;
  elements.notificationCount.textContent = countText;
  elements.notificationCount.className = `status-pill ${visibleCount ? "warning" : "good"}`;
  const waitingMessage = waitingMessageForRole(role);
  const activeStatusReport = state.reports.find((report) => report.id === activeStatusReportId);
  const detailMarkup = activeStatusReport ? renderReportStatusDetail(activeStatusReport) : "";
  const chatMarkup = chatAlertConversation ? renderChatNotificationCard(chatAlertConversation) : "";
  const markup = inboxReports.length
    ? inboxReports.slice(0, 6).map((report) => renderReportInboxCard(report, role)).join("")
    : visibleNotifications.length
      ? visibleNotifications.slice(0, 6).map(renderNotificationCard).join("")
      : chatMarkup
        ? ""
        : `<p class="item-meta">${waitingMessage}</p>`;

  elements.notificationList.innerHTML = `${detailMarkup}${chatMarkup}${markup}`;
  elements.supervisionNotificationList.innerHTML = `${detailMarkup}${chatMarkup}${
    inboxReports.length
    ? inboxReports.slice(0, 3).map((report) => renderReportInboxCard(report, role)).join("")
    : visibleNotifications.length
      ? visibleNotifications.slice(0, 3).map(renderNotificationCard).join("")
      : chatMarkup
        ? ""
        : `<p class="item-meta">${waitingMessage}</p>`
  }`;
  updateAppDocumentTitle();
}

function renderActions() {
  elements.actionList.innerHTML = state.actions
    .map(
      (action) => `
        <article class="action-item">
          <div class="action-top">
            <div>
              <h3>${action.title}</h3>
              <p class="item-meta">${action.program} · Responsable: ${action.owner}</p>
            </div>
            <span class="status-pill info">${action.status}</span>
          </div>
          <p class="item-meta">Fecha compromiso: ${action.due}</p>
        </article>
      `,
    )
    .join("");
}

function renderPrograms() {
  elements.programGrid.innerHTML = state.programs
    .map((program) => {
      const indicators = state.indicators.filter((indicator) => indicator.program === program.name);
      const progress = percent(
        indicators.reduce((sum, indicator) => sum + indicator.value, 0),
        indicators.reduce((sum, indicator) => sum + indicator.target, 0),
      );
      return `
        <article class="program-item">
          <div class="program-top">
            <div>
              <h3>${program.name}</h3>
              <p class="item-meta">Lider: ${program.lead}</p>
            </div>
            <span class="status-pill ${statusForProgress(progress)}">${progress}%</span>
          </div>
          <p>${program.focus}</p>
          <div class="result-preview">
            ${(program.expectedResults || []).slice(0, 2).map((result) => `<span>${result}</span>`).join("")}
          </div>
          <div class="coverage">
            <span>${escapeHtml(program.primaryPopulation || "Participantes del programa")}</span>
            <span>${program.beneficiaries.toLocaleString("es-DO")} meta</span>
            <span>${program.budget} presupuesto</span>
            <span>${program.provinces.join(", ")}</span>
            <span>${registeredCenters().filter((center) => center.program === program.name).length} centros</span>
          </div>
          <div class="item-actions">
            ${viewIsEnabled("chat") ? `<button class="ghost-action" type="button" data-open-program-chat="${escapeHtml(program.id || program.name)}">Abrir chat</button>` : ""}
            <button type="button" data-edit-program="${program.id}" data-edit-program-name="${escapeHtml(program.name)}">Editar</button>
            <button type="button" data-delete-program="${program.id}" data-delete-program-name="${escapeHtml(program.name)}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderProgramCenters() {
  if (!elements.programCenterGrid) return;
  const canManage = canManageProgramCenters();
  if (elements.programCenterForm) {
    elements.programCenterForm.hidden = !canManage;
  }

  const centers = registeredCenters();
  elements.programCenterGrid.innerHTML = centers.length
    ? centers
        .map(
          (center) => `
            <article class="program-item">
              <div class="program-top">
                <div>
                  <h3>${escapeHtml(center.name)}</h3>
                  <p class="item-meta">${escapeHtml(center.program)} · ${escapeHtml(center.province)}</p>
                </div>
                <span class="status-pill neutral">Centro</span>
              </div>
              <div class="item-actions">
                ${
                  canManage
                    ? `
                      <button type="button" data-edit-program-center="${escapeHtml(center.id)}">Editar</button>
                      <button
                        type="button"
                        data-delete-program-center="${escapeHtml(center.id)}"
                        data-delete-program-center-program="${escapeHtml(center.program)}"
                        data-delete-program-center-province="${escapeHtml(center.province)}"
                        data-delete-program-center-name="${escapeHtml(center.name)}"
                      >Eliminar</button>
                    `
                    : ""
                }
              </div>
            </article>
          `,
        )
        .join("")
    : `<p class="item-meta">Todavia no hay centros registrados.</p>`;
}

function captureFormValues(form) {
  if (!form) return null;
  const values = {};
  Array.from(form.elements || []).forEach((control) => {
    if (!control.name || control.disabled) return;
    if (control.type === "file") return;
    if (control.type === "checkbox") {
      const group = Array.from(form.elements).filter((item) => item.name === control.name && item.type === "checkbox");
      values[control.name] = group.length > 1
        ? group.filter((item) => item.checked).map((item) => item.value)
        : control.checked;
      return;
    }
    if (control.type === "radio") {
      if (control.checked) values[control.name] = control.value;
      return;
    }
    values[control.name] = control.value;
  });
  return values;
}

function restoreFormValues(form, values) {
  if (!form || !values) return;
  Array.from(form.elements || []).forEach((control) => {
    if (!control.name || control.disabled || !(control.name in values)) return;
    if (control.type === "file") return;
    const value = values[control.name];
    if (control.type === "checkbox") {
      control.checked = Array.isArray(value) ? value.includes(control.value) : Boolean(value);
      return;
    }
    if (control.type === "radio") {
      control.checked = control.value === value;
      return;
    }
    control.value = value;
  });
}

function hasPendingAccessLibraryFileSelection() {
  if (!elements.accessUserGrid) return false;
  return Array.from(elements.accessUserGrid.querySelectorAll('input[type="file"]')).some(
    (input) => input instanceof HTMLInputElement && input.files && input.files.length > 0,
  );
}

function captureAccessWorkspaceDraft() {
  if (!elements.accessUserGrid) return null;
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const createForm = elements.accessUserGrid.querySelector("#createManagedUserForm");
  const conceptForm = elements.accessUserGrid.querySelector("#createConceptPaperForm");
  const manualForm = elements.accessUserGrid.querySelector("#createProgramManualForm");
  const editForms = Array.from(elements.accessUserGrid.querySelectorAll("[data-user-access-form]"));
  const activeForm = activeElement?.closest?.("form");

  return {
    activeFormId:
      activeForm?.id === "createManagedUserForm"
        ? "create"
        : activeForm?.id === "createConceptPaperForm"
          ? "concept"
          : activeForm?.id === "createProgramManualForm"
            ? "manual"
        : activeForm?.dataset?.userAccessForm
          ? `edit:${activeForm.dataset.userAccessForm}`
          : null,
    activeFieldName: activeElement?.name || null,
    selectionStart: typeof activeElement?.selectionStart === "number" ? activeElement.selectionStart : null,
    selectionEnd: typeof activeElement?.selectionEnd === "number" ? activeElement.selectionEnd : null,
    create: captureFormValues(createForm),
    concept: captureFormValues(conceptForm),
    manual: captureFormValues(manualForm),
    edits: editForms.map((form) => ({
      id: form.dataset.userAccessForm,
      values: captureFormValues(form),
    })),
  };
}

function restoreAccessWorkspaceDraft(snapshot) {
  if (!snapshot || !elements.accessUserGrid) return;
  restoreFormValues(elements.accessUserGrid.querySelector("#createManagedUserForm"), snapshot.create);
  restoreFormValues(elements.accessUserGrid.querySelector("#createConceptPaperForm"), snapshot.concept);
  restoreFormValues(elements.accessUserGrid.querySelector("#createProgramManualForm"), snapshot.manual);
  snapshot.edits?.forEach((entry) => {
    restoreFormValues(elements.accessUserGrid.querySelector(`[data-user-access-form="${entry.id}"]`), entry.values);
  });

  const activeForm =
    snapshot.activeFormId === "create"
      ? elements.accessUserGrid.querySelector("#createManagedUserForm")
      : snapshot.activeFormId === "concept"
        ? elements.accessUserGrid.querySelector("#createConceptPaperForm")
      : snapshot.activeFormId === "manual"
        ? elements.accessUserGrid.querySelector("#createProgramManualForm")
      : snapshot.activeFormId?.startsWith("edit:")
        ? elements.accessUserGrid.querySelector(`[data-user-access-form="${snapshot.activeFormId.slice(5)}"]`)
        : null;
  const activeField = activeForm?.elements?.[snapshot.activeFieldName];
  const focusTarget = Array.isArray(activeField) ? activeField[0] : activeField;
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus({ preventScroll: true });
    if (
      typeof focusTarget.setSelectionRange === "function" &&
      snapshot.selectionStart !== null &&
      snapshot.selectionEnd !== null
    ) {
      focusTarget.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
  }
}

function renderAccessWorkspace(options = {}) {
  if (!elements.accessUserGrid || !elements.accessRequestCount) return;
  const { force = false } = options;
  if (!force && state?.activeView === "access" && (accessLibraryUploadInFlight || hasPendingAccessLibraryFileSelection())) {
    return;
  }
  const renderRequest = ++accessRenderRequest;

  void (async () => {
    const users = (await listManagedUsers()).filter((user) => !deletedAccessUserIds.has(user.id));
    if (renderRequest !== accessRenderRequest) return;
    const groups = [
      { key: "pending_verification", label: "Solicitudes nuevas", empty: "No hay usuarios pendientes de verificacion." },
      { key: "pending_approval", label: "Pendientes de aprobacion", empty: "No hay usuarios esperando aprobacion." },
      { key: "active", label: "Usuarios activos", empty: "No hay usuarios activos." },
      { key: "suspended", label: "Usuarios suspendidos", empty: "No hay usuarios suspendidos." },
    ];
    const pendingCount = users.filter((user) => user.status === "pending_approval").length;
    const totalUsers = users.length;
    const activeUsers = users.filter((user) => user.status === "active").length;
    const suspendedUsers = users.filter((user) => user.status === "suspended").length;
    elements.accessRequestCount.textContent = `${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}`;
    elements.accessRequestCount.className = `status-pill ${pendingCount ? "warning" : "good"}`;

  const manualUploadMarkup = isSystemAdminRole()
    ? `
      <form class="user-access-card concept-upload-card" id="createProgramManualForm">
        <div class="user-access-top">
          <div>
            <p class="eyebrow">Manuales</p>
            <h3>Cargar manual de programa</h3>
          </div>
          <span class="status-pill info">${(state.programManuals || []).length} cargados</span>
        </div>
        <div class="access-card-grid">
          <label>
            Programa
            <select name="program" required>
              ${state.programs.map((program) => `<option value="${escapeHtml(program.name)}">${escapeHtml(program.name)}</option>`).join("")}
            </select>
          </label>
          <label>
            Año
            <input name="year" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required />
          </label>
          <label>
            Titulo
            <input name="title" type="text" placeholder="Ej. Manual operativo del programa" required />
          </label>
          <label>
            Version
            <input name="version" type="text" value="1.0" />
          </label>
          <label class="span-2">
            Manual PDF
            <input name="manualFile" type="file" accept=".pdf,application/pdf" required />
          </label>
          <label class="span-2">
            Nota interna
            <textarea name="notes" rows="2" placeholder="Opcional: uso, alcance o version del manual."></textarea>
          </label>
        </div>
        <div class="item-actions">
          <button class="primary-action" type="submit">Subir manual</button>
        </div>
      </form>
    `
    : "";

  const summaryMarkup = `

          <form class="user-access-card create-user-card" id="createManagedUserForm">
            <div class="user-access-top">
              <div>
                <p class="eyebrow">Nuevo usuario</p>
                <h3>Crear acceso directo</h3>
              </div>
              <span class="status-pill info">Activo al guardar</span>
            </div>
            <div class="access-card-grid">
              <label>
                Nombre completo
                <input name="fullName" type="text" required />
              </label>
              <label>
                Correo electrónico
                <input name="email" type="email" required />
              </label>
              <label>
                Contrasena temporal
                <input name="password" type="password" minlength="8" required />
              </label>
              <label class="access-chip access-wide">
                <input name="mustChangePassword" type="checkbox" checked />
                <span>Pedir cambio de clave al primer ingreso</span>
              </label>
              <label>
                Rol principal
                <select name="systemRole">
                  ${SYSTEM_ROLES.map((role) => `<option value="${role}" ${role === "Facilitador" ? "selected" : ""}>${role}</option>`).join("")}
                </select>
              </label>
              <label>
                Estado
                <select name="status">
                  <option value="active" selected>Activo</option>
                  <option value="pending_approval">Pendiente aprobacion</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </label>
            </div>
            <label>
              Nota de acceso
              <textarea name="accessNote" rows="2" placeholder="Ej. Creado por supervision para equipo de campo."></textarea>
            </label>
            <div class="item-actions">
              <button class="primary-action" type="submit">Crear usuario</button>
            </div>
          </form>
          <form class="user-access-card concept-upload-card" id="createConceptPaperForm">
            <div class="user-access-top">
              <div>
                <p class="eyebrow">Concept Papers</p>
                <h3>Cargar documento al sistema</h3>
              </div>
              <span class="status-pill info">${state.conceptPapers.length} cargados</span>
            </div>
            <div class="access-card-grid">
              <label>
                Programa
                <select name="program" required>
                  ${state.programs.map((program) => `<option value="${escapeHtml(program.name)}">${escapeHtml(program.name)}</option>`).join("")}
                </select>
              </label>
              <label>
                Año
                <input name="year" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required />
              </label>
              <label>
                Titulo
                <input name="title" type="text" placeholder="Ej. Concept Paper 2026" required />
              </label>
              <label>
                Responsable / presentador
                <input name="presenter" type="text" value="${escapeHtml(currentUser?.fullName || "Supervision M&E")}" />
              </label>
              <label class="span-2">
                Documento
                <input name="conceptFile" type="file" required />
              </label>
              <label class="span-2">
                Objetivo o nota breve
                <textarea name="objective" rows="2" placeholder="Resumen breve para identificar el documento en Concept Papers."></textarea>
              </label>
            </div>
            <div class="item-actions">
              <button class="primary-action" type="submit">Subir a Concept Papers</button>
            </div>
          </form>
          ${manualUploadMarkup}
      <div class="access-summary-grid">
        ${groups
          .map((group) => {
            const total = users.filter((user) => user.status === group.key).length;
            const tone = group.key === "active" ? "good" : total ? "warning" : "neutral";
            return `
              <article class="program-summary">
                <p class="eyebrow">${group.label}</p>
                <h2>${total}</h2>
                <p class="item-meta">${group.key === "active" ? "cuentas con acceso" : "cuentas en esta bandeja"}</p>
                <span class="status-pill ${tone}">${total ? "Con actividad" : "Sin items"}</span>
              </article>
            `;
          })
          .join("")}
      </div>
    `;

    const cardsMarkup = groups
      .map((group) => {
        const groupUsers = users.filter((user) => user.status === group.key);
        return `
          <section class="access-group">
            <div class="panel-header">
              <div>
                <p class="eyebrow">${group.label}</p>
                <h2>${groupUsers.length} usuario${groupUsers.length === 1 ? "" : "s"}</h2>
              </div>
            </div>
            <div class="user-access-group-grid">
              ${
                groupUsers.length
                  ? groupUsers
                      .map((user) => {
                        const allowedRoleMarkup = SYSTEM_ROLES.map(
                          (role) => `
                            <label class="access-chip">
                              <input type="checkbox" name="allowedRoles" value="${role}" ${user.allowedRoles.includes(role) ? "checked" : ""} />
                              <span>${role}</span>
                            </label>
                          `,
                        ).join("");
                        const permissionMarkup = VIEW_DEFINITIONS.map(
                          (view) => `
                            <label class="access-chip">
                              <input type="checkbox" name="viewPermissions" value="${view.id}" ${user.viewPermissions.includes(view.id) ? "checked" : ""} />
                              <span>${view.label}</span>
                            </label>
                          `,
                        ).join("");

                        return `
                          <form class="user-access-card" data-user-access-form="${user.id}">
                            <div class="user-access-top">
                              <div>
                                <h3>${user.fullName}</h3>
                                <p class="item-meta">${user.email}</p>
                              </div>
                              <div class="access-status-stack">
                                <span class="status-pill ${user.status === "active" ? "good" : user.status === "suspended" ? "danger" : "warning"}">${accessStatusLabel(user.status)}</span>
                                ${user.mustChangePassword ? '<span class="status-pill warning">Cambio de clave</span>' : ""}
                              </div>
                            </div>
                            <div class="access-card-grid">
                              <label>
                                Nombre completo
                                <input name="fullName" type="text" value="${escapeHtml(user.fullName || "")}" required />
                              </label>
                              <label>
                                Correo electrónico
                                <input name="email" type="email" value="${escapeHtml(user.email || "")}" required />
                              </label>
                              ${
                                user.status === "active"
                                  ? `<label>
                                      Nueva contraseña
                                      <input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Dejar vacio para no cambiar" />
                                    </label>`
                                  : ""
                              }
                              <label class="access-chip access-wide">
                                <input name="mustChangePassword" type="checkbox" ${user.mustChangePassword ? "checked" : ""} />
                                <span>Requerir cambio de clave al entrar</span>
                              </label>
                              <label>
                                Rol principal
                                <select name="systemRole">
                                  ${SYSTEM_ROLES.map((role) => `<option value="${role}" ${role === user.systemRole ? "selected" : ""}>${role}</option>`).join("")}
                                </select>
                              </label>
                              <label>
                                Estado
                                <select name="status">
                                  <option value="pending_verification" ${user.status === "pending_verification" ? "selected" : ""}>Pendiente verificacion</option>
                                  <option value="pending_approval" ${user.status === "pending_approval" ? "selected" : ""}>Pendiente aprobacion</option>
                                  <option value="active" ${user.status === "active" ? "selected" : ""}>Activo</option>
                                  <option value="suspended" ${user.status === "suspended" ? "selected" : ""}>Suspendido</option>
                                </select>
                              </label>
                            </div>
                            <div>
                              <p class="eyebrow">Perfiles habilitados</p>
                              <div class="access-chip-list">${allowedRoleMarkup}</div>
                            </div>
                            <div>
                              <p class="eyebrow">Modulos permitidos</p>
                              <div class="access-chip-list">${permissionMarkup}</div>
                            </div>
                            <label>
                              Nota de acceso
                              <textarea name="accessNote" rows="3">${escapeHtml(user.accessNote || "")}</textarea>
                            </label>
                            <div class="item-actions">
                              <button class="ghost-action danger-action" data-delete-access="${user.id}" type="button">Eliminar definitivo</button>
                              <button class="primary-action" data-save-access="${user.id}" type="submit">Guardar acceso</button>
                            </div>
                          </form>
                        `;
                      })
                      .join("")
                  : `<p class="item-meta">${group.empty}</p>`
              }
            </div>
          </section>
        `;
      })
      .join("");

    const draftSnapshot = captureAccessWorkspaceDraft();
    elements.accessUserGrid.innerHTML = `${summaryMarkup}${cardsMarkup}`;
    restoreAccessWorkspaceDraft(draftSnapshot);
  })().catch((error) => {
    console.error(error);
    const message = escapeHtml(error?.message || "No pude cargar los accesos.");
    elements.accessUserGrid.innerHTML = `<p class="item-meta">${message}</p>`;
  });
}

function reportsByPeriod(reports = state.reports) {
  return reports.reduce((groups, report) => {
    groups[report.period] = (groups[report.period] || 0) + Number(report.value || 0);
    return groups;
  }, {});
}

function chartColor(index) {
  const palette = ["var(--teal)", "var(--blue)", "var(--green)", "var(--amber)", "var(--red)", "var(--violet)"];
  return palette[index % palette.length];
}

function buildIndicatorChartSeries(reports) {
  const totals = reports.reduce((groups, report) => {
    groups[report.indicatorId] = (groups[report.indicatorId] || 0) + Number(report.value || 0);
    return groups;
  }, {});

  return state.indicators
    .filter((indicator) => state.filters.program === "Todos" || indicator.program === state.filters.program)
    .map((indicator) => {
      const value = totals[indicator.id] || 0;
      const progress = percent(value, indicator.target);
      return {
        key: indicator.id,
        label: indicator.name,
        value,
        valueText: value.toLocaleString("es-DO"),
        meta: `${progress}% de ${indicator.target.toLocaleString("es-DO")} ${indicator.unit}`,
        tone: statusForProgress(progress),
      };
    })
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

function buildPeriodChartSeries(reports) {
  return Object.entries(reportsByPeriod(reports))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, value]) => ({
      key: period,
      label: period,
      value,
      valueText: Number(value).toLocaleString("es-DO"),
      meta: "dato reportado",
      tone: "info",
    }));
}

function buildProgramChartSeries(reports) {
  return Object.entries(
    reports.reduce((groups, report) => {
      groups[report.program] = (groups[report.program] || 0) + Number(report.value || 0);
      return groups;
    }, {}),
  )
    .sort(([, left], [, right]) => right - left)
    .map(([program, value]) => ({
      key: program,
      label: program,
      value,
      valueText: Number(value).toLocaleString("es-DO"),
      meta: "valor agregado del programa",
      tone: "info",
    }));
}

function buildStatusChartSeries(reports) {
  return Object.entries(
    reports.reduce((groups, report) => {
      groups[report.status] = (groups[report.status] || 0) + 1;
      return groups;
    }, {}),
  ).map(([status, value]) => ({
    key: status,
    label: status,
    value,
    valueText: Number(value).toLocaleString("es-DO"),
    meta: "reportes en este estado",
    tone: status === REPORT_STATUSES.APPROVED ? "good" : status === REPORT_STATUSES.NEEDS_CORRECTION ? "warning" : status === REPORT_STATUSES.REJECTED ? "danger" : "info",
  }));
}

function buildAutomaticStats(reports) {
  const totalValue = reports.reduce((sum, report) => sum + Number(report.value || 0), 0);
  const averageValue = reports.length ? totalValue / reports.length : 0;
  const periodSeries = buildPeriodChartSeries(reports);
  const programSeries = buildProgramChartSeries(reports);
  const statusSeries = buildStatusChartSeries(reports);
  const approved = reports.filter((report) => report.status === REPORT_STATUSES.APPROVED).length;
  const participants = reports.reduce((sum, report) => sum + reportParticipantTotal(report), 0);
  const strongestPeriod = periodSeries.slice().sort((left, right) => right.value - left.value)[0];
  const topPeriod = strongestPeriod?.label || "Sin datos";
  const topProgram = programSeries[0]?.label || "Sin datos";
  const pendingCount = reports.filter((report) => isPendingApprovalStatus(report.status)).length;
  const approvalRate = reports.length ? Math.round((approved / reports.length) * 100) : 0;

  return [
    { label: "Promedio por reporte", value: averageValue.toLocaleString("es-DO", { maximumFractionDigits: 1 }), meta: "valor medio por registro", tone: averageValue ? "good" : "neutral" },
    { label: "Periodo mas fuerte", value: topPeriod, meta: strongestPeriod ? `${strongestPeriod.valueText} reportado` : "sin actividad aun", tone: strongestPeriod ? "info" : "neutral" },
    { label: "Programa lider", value: topProgram, meta: programSeries[0] ? `${programSeries[0].valueText} acumulado` : "sin comparativa aun", tone: programSeries[0] ? "good" : "neutral" },
    { label: "Tasa de aprobacion", value: `${approvalRate}%`, meta: `${approved} aprobados y ${pendingCount} pendientes`, tone: approvalRate >= 70 ? "good" : approvalRate >= 40 ? "warning" : "danger" },
    { label: "Participación reportada", value: participants.toLocaleString("es-DO"), meta: "desglose reportado acumulado", tone: participants ? "info" : "neutral" },
    { label: "Estados activos", value: statusSeries.length, meta: "tipos de estado presentes en reportes", tone: statusSeries.length ? "info" : "neutral" },
  ];
}

function buildTrendSummary(periodSeries) {
  if (periodSeries.length < 2) return null;
  const last = periodSeries[periodSeries.length - 1];
  const previous = periodSeries[periodSeries.length - 2];
  if (!previous.value) {
    return { direction: "stable", delta: 0, last, previous };
  }
  const delta = Math.round(((last.value - previous.value) / previous.value) * 100);
  return { direction: delta > 10 ? "up" : delta < -10 ? "down" : "stable", delta, last, previous };
}

function buildAnalysisBotInsights(reports) {
  if (!reports.length) {
    return [
      {
        tone: "info",
        title: "Sin datos para analizar",
        summary: "Todavia no hay reportes con los filtros activos para generar recomendaciones utiles.",
        action: "Sube reportes o ajusta los filtros para activar el analisis.",
      },
    ];
  }

  const insights = [];
  const periodSeries = buildPeriodChartSeries(reports);
  const programSeries = buildProgramChartSeries(reports);
  const indicatorSeries = buildIndicatorChartSeries(reports);
  const statusSeries = buildStatusChartSeries(reports);
  const pendingCount = reports.filter((report) => isPendingApprovalStatus(report.status)).length;
  const correctionCount = statusSeries.find((item) => item.label === "Necesita correccion")?.value || 0;
  const totalReports = reports.length;
  const trend = buildTrendSummary(periodSeries);
  const lowIndicator = indicatorSeries.find((item) => item.tone === "danger") || indicatorSeries.find((item) => item.tone === "warning");
  const topProgram = programSeries[0];

  if (pendingCount / totalReports >= 0.35) {
    insights.push({
      tone: "warning",
      title: "Acelerar validacion de datos",
      summary: `${pendingCount} de ${totalReports} reportes siguen pendientes. El cuello de botella esta en la revision.`,
      action: "Define una rutina semanal de validacion y prioriza los reportes del periodo actual.",
    });
  }

  if (correctionCount > 0) {
    insights.push({
      tone: "warning",
      title: "Reducir devoluciones por calidad",
      summary: `${correctionCount} reportes necesitan correccion, lo que puede afectar la confianza del tablero.`,
      action: "Refuerza plantillas, ejemplos y revisiones rapidas antes de enviar los reportes a supervision.",
    });
  }

  if (trend?.direction === "down") {
    insights.push({
      tone: "danger",
      title: "Recuperar ritmo de captura",
      summary: `El ultimo periodo (${trend.last.label}) cayo ${Math.abs(trend.delta)}% frente al periodo anterior (${trend.previous.label}).`,
      action: "Revisa si hubo menos actividad de campo, atraso en carga o problemas con formularios en ese periodo.",
    });
  }

  if (trend?.direction === "up") {
    insights.push({
      tone: "good",
      title: "Escalar la mejora reciente",
      summary: `El ultimo periodo (${trend.last.label}) mejoro ${trend.delta}% respecto al anterior.`,
      action: "Documenta que cambio en el proceso y replica esa practica en los programas con menor avance.",
    });
  }

  if (lowIndicator) {
    insights.push({
      tone: lowIndicator.tone,
      title: "Intervenir el indicador mas fragil",
      summary: `${lowIndicator.label} muestra ${lowIndicator.meta} y merece seguimiento cercano.`,
      action: "Revisa causas operativas, calidad de captura y acciones concretas del programa relacionadas con este indicador.",
    });
  }

  if (topProgram) {
    insights.push({
      tone: "info",
      title: "Usar al programa lider como referencia",
      summary: `${topProgram.label} concentra el mayor valor agregado en los reportes visibles.`,
      action: "Identifica practicas de ejecucion, seguimiento o carga de datos que puedan replicarse en otros programas.",
    });
  }

  return insights.slice(0, 4);
}

function renderBarSeries(series, emptyMessage) {
  if (!series.length) {
    return `<p class="item-meta">${emptyMessage}</p>`;
  }

  const maxValue = Math.max(1, ...series.map((item) => item.value));
  return series
    .map((item) => {
      const width = Math.max(6, Math.round((item.value / maxValue) * 100));
      return `
        <article class="chart-item">
          <div class="chart-row-head">
            <div>
              <h3>${item.label}</h3>
              <p class="item-meta">${item.valueText} · ${item.meta}</p>
            </div>
            <span class="status-pill ${item.tone}">${item.valueText}</span>
          </div>
          <div class="bar-track tall">
            <div class="bar-fill ${item.tone}" style="width: ${width}%"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderColumnSeries(series, emptyMessage) {
  if (!series.length) {
    return `<p class="item-meta">${emptyMessage}</p>`;
  }

  const maxValue = Math.max(1, ...series.map((item) => item.value));
  return `
    <div class="chart-columns">
      ${series
        .map((item, index) => {
          const height = Math.max(10, Math.round((item.value / maxValue) * 100));
          return `
            <article class="chart-column-item">
              <div class="chart-column-frame">
                <div class="chart-column-fill ${item.tone}" style="height: ${height}%; background: ${chartColor(index)};"></div>
              </div>
              <strong>${item.valueText}</strong>
              <p>${item.label}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildCircularGradient(series) {
  const total = series.reduce((sum, item) => sum + item.value, 0);
  if (!total) return "";

  let start = 0;
  return series
    .map((item, index) => {
      const slice = (item.value / total) * 360;
      const end = start + slice;
      const segment = `${chartColor(index)} ${start}deg ${end}deg`;
      start = end;
      return segment;
    })
    .join(", ");
}

function renderLineSeries(series, emptyMessage) {
  if (!series.length) {
    return `<p class="item-meta">${emptyMessage}</p>`;
  }

  const width = 520;
  const height = 220;
  const padding = 28;
  const maxValue = Math.max(1, ...series.map((item) => item.value));
  const stepX = series.length > 1 ? (width - padding * 2) / (series.length - 1) : 0;
  const points = series.map((item, index) => {
    const x = padding + stepX * index;
    const y = height - padding - ((item.value / maxValue) * (height - padding * 2));
    return { ...item, x, y };
  });
  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const y = padding + (((height - padding * 2) / 3) * index);
    return `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" class="line-chart-grid"></line>`;
  }).join("");

  return `
    <div class="line-chart-shell">
      <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg" aria-label="Tendencia de reportes">
        ${gridLines}
        <polyline fill="none" stroke="var(--teal)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${polylinePoints}"></polyline>
        ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="6" fill="var(--amber)"></circle>`).join("")}
      </svg>
      <div class="line-chart-labels">
        ${points.map((point) => `
          <article class="line-chart-label-item">
            <strong>${point.valueText}</strong>
            <p>${point.label}</p>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCircularSeries(series, emptyMessage, variant) {
  if (!series.length) {
    return `<p class="item-meta">${emptyMessage}</p>`;
  }

  const total = series.reduce((sum, item) => sum + item.value, 0);
  const gradient = buildCircularGradient(series);

  return `
    <div class="circular-chart-layout">
      <div class="circular-chart ${variant}" style="--chart-gradient: conic-gradient(${gradient});">
        ${variant === "donut" ? `<div class="circular-chart-center"><strong>${total.toLocaleString("es-DO")}</strong><span>Total</span></div>` : ""}
      </div>
      <div class="chart-legend">
        ${series
          .map((item, index) => `
            <article class="chart-legend-item">
              <span class="legend-swatch" style="background: ${chartColor(index)};"></span>
              <div>
                <strong>${item.label}</strong>
                <p>${item.valueText} · ${item.meta}</p>
              </div>
            </article>
          `)
          .join("")}
      </div>
    </div>
  `;
}

function renderSeriesByType(series, type, emptyMessage) {
  if (type === "columns") return renderColumnSeries(series, emptyMessage);
  if (type === "line") return renderLineSeries(series, emptyMessage);
  if (type === "pie") return renderCircularSeries(series, emptyMessage, "pie");
  if (type === "donut") return renderCircularSeries(series, emptyMessage, "donut");
  return renderBarSeries(series, emptyMessage);
}

function renderCharts() {
  const visibleReports = getFilteredReports();
  const reports = getAnalyticsReports();
  const chartScope = getChartDataScope();
  const totalReports = reports.length;
  const excludedReports = Math.max(visibleReports.length - reports.length, 0);
  const totalUploaded = state.formSubmissions.length;
  const totalValue = reports.reduce((sum, report) => sum + Number(report.value || 0), 0);
  const indicatorSeries = buildIndicatorChartSeries(reports);
  const periodSeries = buildPeriodChartSeries(reports);
  const programSeries = buildProgramChartSeries(reports);
  const stats = buildAutomaticStats(reports);
  const activeIndicators = indicatorSeries.length;
  const indicatorType = state.chartPreferences?.indicatorType || "bars";
  const periodType = state.chartPreferences?.periodType || "donut";
  const scopeLabel = chartScope === "approved" ? "Solo aprobados" : "Todos visibles";
  const scopeDelta =
    chartScope === "approved"
      ? excludedReports
        ? `${excludedReports} pendientes o devueltos fuera del analisis`
        : "sin excluir reportes por estado"
      : "incluye reportes pendientes y en correccion";
  const noApprovedYet = chartScope === "approved" && !reports.length && visibleReports.length > 0;
  const dataMessage =
    noApprovedYet
      ? "Hay reportes con los filtros actuales, pero todavia ninguno aprobado para analisis ejecutivo."
      : chartScope === "approved"
        ? "Cuando existan reportes aprobados con los filtros actuales, aqui veras el comportamiento por indicador."
        : "Cuando existan reportes con los filtros actuales, aqui veras el comportamiento por indicador.";
  const periodMessage =
    noApprovedYet
      ? "Aprueba al menos un reporte visible para activar la lectura ejecutiva por periodo."
      : chartScope === "approved"
        ? "Cuando existan reportes aprobados o formularios validados, aqui apareceran los resultados por periodo."
        : "Cuando subas formularios o reportes de datos, aqui apareceran los resultados por periodo.";
  const programMessage =
    noApprovedYet
      ? "La comparativa se activara cuando los reportes visibles hayan pasado validacion."
      : "Cuando existan reportes de distintos programas, aqui veras la comparativa agregada.";
  const trendMessage =
    noApprovedYet
      ? "La tendencia aparecera cuando exista al menos un reporte aprobado dentro de los filtros."
      : "A medida que entren reportes, aqui veras la tendencia del tiempo.";
  const botInsights =
    noApprovedYet
      ? [
          {
            tone: "info",
            title: "Pendiente de validacion ejecutiva",
            summary: "Hay reportes visibles, pero la vista actual solo analiza reportes aprobados para proteger la calidad de lectura.",
            action: "Aprueba reportes o cambia la base del analisis a todos los reportes visibles si quieres explorar datos operativos.",
          },
        ]
      : buildAnalysisBotInsights(reports);

  const metrics = [
    { label: "Base analitica", value: scopeLabel, delta: scopeDelta, type: chartScope === "approved" ? "good" : "info" },
    { label: "Datos analizados", value: totalReports, delta: chartScope === "approved" ? "reportes aprobados con filtros activos" : "registros con filtros activos", type: "info" },
    { label: "Formularios subidos", value: totalUploaded, delta: "archivos procesados", type: totalUploaded ? "good" : "warning" },
    { label: "Valor acumulado", value: totalValue.toLocaleString("es-DO"), delta: "suma reportada con filtros", type: totalValue ? "good" : "neutral" },
    { label: "Indicadores con datos", value: activeIndicators, delta: "alimentados por reportes", type: activeIndicators ? "good" : "warning" },
  ];

  elements.chartMetricGrid.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card ${metric.type}">
          <p class="eyebrow">${metric.label}</p>
          <div class="value">${metric.value}</div>
          <div class="delta">${metric.delta}</div>
        </article>
      `,
    )
    .join("");

  elements.indicatorCharts.innerHTML = renderSeriesByType(
    indicatorSeries,
    indicatorType,
    dataMessage,
  );

  elements.periodCharts.innerHTML = renderSeriesByType(
    periodSeries,
    periodType,
    periodMessage,
  );

  elements.programCharts.innerHTML = renderSeriesByType(
    programSeries,
    programSeries.length > 1 ? "donut" : "bars",
    programMessage,
  );

  elements.trendCharts.innerHTML = renderLineSeries(
    periodSeries,
    trendMessage,
  );

  elements.chartStatsGrid.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card ${stat.tone}">
          <p class="eyebrow">${stat.label}</p>
          <div class="value">${stat.value}</div>
          <div class="delta">${stat.meta}</div>
        </article>
      `,
    )
    .join("");

  elements.analysisBotList.innerHTML = botInsights
    .map(
      (insight) => `
        <article class="analysis-bot-item ${insight.tone}">
          <div class="analysis-bot-head">
            <strong>${insight.title}</strong>
            <span class="status-pill ${insight.tone}">${insight.tone === "danger" ? "Alta prioridad" : insight.tone === "warning" ? "Atencion" : insight.tone === "good" ? "Oportunidad" : "Analisis"}</span>
          </div>
          <p>${insight.summary}</p>
          <div class="analysis-bot-action">${insight.action}</div>
        </article>
      `,
    )
    .join("");

  elements.submissionList.innerHTML = state.formSubmissions.length    ? state.formSubmissions
        .slice()
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
        .map(
          (submission) => `
            <article class="submission-item">
              <div class="chart-row-head">
                <div>
                  <h3>${submission.formTitle}</h3>
                  <p class="item-meta">${submission.program} · ${submission.fileName}</p>
                </div>
                <span class="status-pill ${submission.processing === "automatico" ? "good" : "info"}">
                  ${submission.processing === "automatico" ? `${submission.reportCount} registros` : "Soporte"}
                </span>
              </div>
              <p class="item-meta">Subido: ${submission.importedAt.slice(0, 10)} · Periodo: ${submission.period} · Tipo: ${(submission.sourceType || "csv").toUpperCase()}</p>
            </article>
          `,
        )
        .join("")
    : `<p class="item-meta">Todavia no se han subido formularios completados.</p>`;
}

function updateRoleUi() {
  const role = activeRole();
  elements.roleBadge.textContent = role;
  elements.roleBadge.className = `status-pill ${canValidate() ? "info" : "neutral"}`;
}

function firstAllowedView() {
  return currentUserViews[0] || "dashboard";
}

function activeViewName() {
  return $(".nav-item.active")?.dataset.view || "dashboard";
}

function resetViewportPosition() {
  const workspace = document.querySelector(".workspace");
  workspace?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function currentAccessSignature(user = currentUser) {
  return JSON.stringify({
    id: user?.id || null,
    status: user?.status || null,
    role: user?.systemRole || null,
    updatedAt: user?.updatedAt || null,
    allowedRoles: [...(user?.allowedRoles || [])].sort(),
    viewPermissions: [...(user?.viewPermissions || [])].sort(),
  });
}

function updateQuickReportButtonVisibility(viewName = activeViewName()) {
  const quickReportButton = $("#quickReportButton");
  if (quickReportButton) {
    quickReportButton.hidden = viewName !== "report" || !viewIsEnabled("report");
  }
}

function applyAccessControl() {
  $$(".nav-item").forEach((button) => {
    button.hidden = !viewIsEnabled(button.dataset.view);
  });

  const currentView = activeViewName();
  updateQuickReportButtonVisibility(currentView);
  if (!viewIsEnabled(currentView)) {
    switchView(firstAllowedView());
  }
}

function renderAll() {
  recomputeIndicatorValues();
  renderFilters();
  updateRoleUi();
  applyAccessControl();
  renderMetrics();
  renderProgramChart();
  renderRisks();
  renderReports();
  renderIndicators();
  renderDesignStudio();
  renderForms();
  renderCharts();
  renderChatWorkspace();
  renderAttendance();
  renderConceptPapers();
  renderNotifications();
  renderReviewQueue();
  renderActions();
  renderPrograms();
  renderProgramCenters();
  renderAccessWorkspace();
  switchView(state.activeView || firstAllowedView(), { persist: false, resetScroll: false });
}

async function refreshAccessStateFromRemote(options = {}) {
  const { showToastOnPermissionChange = false } = options;
  if (accessSyncInFlight) return;
  accessSyncInFlight = true;
  try {
    const previousSignature = currentAccessSignature(currentUser);
    const accessViewActive = state?.activeView === "access";
    await syncAuthenticatedAccess();
    const nextSignature = currentAccessSignature(currentUser);
    const permissionsChanged = previousSignature !== nextSignature;

    if (permissionsChanged || accessViewActive) {
      renderAll();
      if (showToastOnPermissionChange && permissionsChanged) {
        showToast("Accesos actualizados.");
      }
      return;
    }

    updateRoleUi();
    applyAccessControl();
  } catch (error) {
    console.error("No pude sincronizar accesos remotos.", error);
  } finally {
    accessSyncInFlight = false;
  }
}

function ensureAccessSyncMonitor() {
  if (accessSyncIntervalId !== null) return;
  accessSyncIntervalId = window.setInterval(() => {
    if (document.hidden || accessSyncInFlight) return;
    void refreshAccessStateFromRemote({ showToastOnPermissionChange: false });
  }, ACCESS_SYNC_INTERVAL_MS);
}

function ensureChatSyncMonitor() {
  if (chatSyncIntervalId !== null) return;
  chatSyncIntervalId = window.setInterval(() => {
    if (document.hidden || chatSyncInFlight || !isApiConfigured()) return;
    void syncChatInbox({
      includeMessages: state?.activeView === "chat",
      showToastOnNewMessages: true,
    }).catch((error) => console.error("No pude sincronizar el chat.", error));
  }, CHAT_SYNC_INTERVAL_MS);
}

function ensureChatPresenceMonitor() {
  if (chatPresenceIntervalId !== null) return;
  chatPresenceIntervalId = window.setInterval(() => {
    if (document.hidden || chatPresenceInFlight || !isApiConfigured() || !currentUser) return;
    chatPresenceInFlight = true;
    void (async () => {
      try {
        await sendChatPresenceHeartbeat();
        if (state?.activeView === "chat" && state.chatActiveConversationId) {
          await refreshActiveChatPresence({ render: true });
        }
      } catch (error) {
        console.error("No pude sincronizar la presencia del chat.", error);
      } finally {
        chatPresenceInFlight = false;
      }
    })();
  }, CHAT_PRESENCE_INTERVAL_MS);
}

function switchView(viewName, options = {}) {
  const { persist = true, resetScroll = true } = options;
  const titles = {
    dashboard: "Resumen ejecutivo",
    report: "Nuevo reporte",
    indicators: "Matriz de indicadores",
    design: "Diseño de monitoreo y evaluación",
    forms: "Formularios descargables",
    charts: "Graficas automaticas",
    chat: "Mensajeria interna",
    attendance: "Asistencia semanal",
    concepts: "Concept papers",
    supervision: "Supervision y validacion",
    programs: "Programas",
    access: "Usuarios y accesos",
  };
  if (!viewIsEnabled(viewName)) {
    viewName = firstAllowedView();
  }
  if (state) {
    state.activeView = viewName;
  }
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === viewName));
  if (elements.globalFilters) {
    elements.globalFilters.hidden = true;
  }
  updateQuickReportButtonVisibility(viewName);
  elements.pageTitle.textContent = titles[viewName];
  if (resetScroll) {
    resetViewportPosition();
  }
  if (viewName !== "chat") {
    stopChatTyping();
  }
  if (viewName === "chat" && isApiConfigured()) {
    void syncChatInbox({ includeMessages: true, showToastOnNewMessages: false })
      .catch((error) => console.error("No pude abrir el chat.", error));
    void sendChatPresenceHeartbeat({ activeConversationId: state?.chatActiveConversationId || "", activeView: "chat" }).catch((error) =>
      console.error("No pude actualizar la presencia al abrir el chat.", error),
    );
  }
  if (persist && state) {
    saveState();
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function createLocalReviewNotifications(report) {
  const program = state.programs.find((item) => item.name === report.program);
  const indicator = indicatorById(report.indicatorId);
  const recipients = {
    "Coordinador de programa": {
      role: "Coordinador de programa",
      name: program?.lead || `Coordinacion ${report.program}`,
      email: program?.coordinatorEmail || "",
    },
    "Program Manager": {
      role: "Program Manager",
      name: "Program Manager",
      email: program?.programManagerEmail || "",
    },
    "Supervision M&E": {
      role: "Supervision M&E",
      name: "Supervision M&E",
      email: program?.melSupervisorEmail || "",
    },
  };
  const recipient = recipients[reviewRoleForStatus(report.status)];
  if (!recipient) return [];

  return [recipient].map((stageRecipient) => ({
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: report.companyId || report.organizationId || currentUser?.organizationId || "org-convoy-of-hope",
    programId: report.programId || program?.id || null,
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
    createdAt: new Date().toISOString(),
    readAt: null,
  }));
}

function queueReportForReview(report) {
  state.reports.unshift(report);
  state.notifications = [...createLocalReviewNotifications(report), ...(state.notifications || [])];
  if (!state.filters.period || state.filters.period === "Todos") {
    state.filters.period = report.period;
  }
}

async function refreshReportsAndNotificationsFromApi() {
  if (!isApiConfigured()) return;
  const [remoteReports, remoteNotifications, remoteFormSubmissions] = await Promise.all([
    fetchApiReports({ scope: "all" }),
    fetchApiNotifications(),
    fetchApiFormSubmissions(),
  ]);
  state.reports = remoteReports;
  state.notifications = remoteNotifications;
  state.formSubmissions = remoteFormSubmissions;
  recomputeIndicatorValues();
  saveState();
}

async function refreshAttendanceFromApi() {
  if (!isApiConfigured()) return;
  const [participants, sessions] = await Promise.all([
    fetchApiAttendanceParticipants(),
    fetchApiAttendanceSessions(),
  ]);
  state.attendanceParticipants = participants;
  state.attendanceSessions = sessions;
  saveState({ preserveAttendanceSnapshot: true });
}

function activeChatConversation() {
  return (
    (state.chatConversations || []).find((conversation) => conversation.id === state.chatActiveConversationId) ||
    state.chatConversations?.[0] ||
    null
  );
}

function chatMessageStatusLabel(message, conversation = activeChatConversation()) {
  if (!message || message.senderUserId !== currentUser?.id) return "";
  if (Array.isArray(message.readBy) && message.readBy.length) {
    return `Leido por ${message.readBy.length}`;
  }
  const otherParticipants = (conversation?.participants || []).filter((participant) => participant.userId !== currentUser?.id && !participant.leftAt);
  return otherParticipants.length ? "Enviado" : "";
}

function activeChatPresenceSnapshot(conversation = activeChatConversation()) {
  if (!conversation?.id) return null;
  return state.chatPresenceByConversation?.[conversation.id] || null;
}

function chatPresenceParticipants(conversation = activeChatConversation()) {
  return activeChatPresenceSnapshot(conversation)?.participants || [];
}

function formatRelativeTimestamp(value) {
  if (!value) return "sin actividad reciente";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "sin actividad reciente";
  const diffMs = Date.now() - timestamp;
  const diffSeconds = Math.max(0, Math.round(diffMs / 1000));
  if (diffSeconds < 45) return "hace unos segundos";
  if (diffSeconds < 90) return "hace 1 minuto";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  return `hace ${diffDays} dia${diffDays === 1 ? "" : "s"}`;
}

function chatPresenceSummary(conversation = activeChatConversation()) {
  const others = chatPresenceParticipants(conversation).filter((participant) => participant.userId !== currentUser?.id);
  const typingUsers = others.filter((participant) => participant.isTyping);
  const onlineUsers = others.filter((participant) => participant.isOnline);
  const latestSeenAt = others
    .map((participant) => participant.lastSeenAt)
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0] || "";
  return {
    typingUsers,
    onlineUsers,
    latestSeenAt,
  };
}

function chatConversationTitle(conversation = {}) {
  if (String(conversation.title || "").trim()) return String(conversation.title).trim();
  const otherParticipants = (conversation.participants || []).filter((participant) => participant.userId !== currentUser?.id);
  if (otherParticipants.length) {
    return otherParticipants.map((participant) => participant.displayName || participant.email || participant.userId).join(", ");
  }
  return "Conversacion";
}

function chatConversationMeta(conversation = {}) {
  const participants = conversation.participants || [];
  const base = conversation.contextType && conversation.contextId
    ? `${participants.length} participante${participants.length === 1 ? "" : "s"} · ${conversation.contextType}`
    : `${participants.length} participante${participants.length === 1 ? "" : "s"}`;
  const presence = chatPresenceSummary(conversation);
  if (presence.typingUsers.length === 1) {
    return `${base} · ${presence.typingUsers[0].displayName || "Alguien"} esta escribiendo...`;
  }
  if (presence.typingUsers.length > 1) {
    return `${base} · ${presence.typingUsers.length} personas estan escribiendo...`;
  }
  if (presence.onlineUsers.length === 1) {
    return `${base} · 1 en linea`;
  }
  if (presence.onlineUsers.length > 1) {
    return `${base} · ${presence.onlineUsers.length} en linea`;
  }
  if (presence.latestSeenAt) {
    return `${base} · Activo ${formatRelativeTimestamp(presence.latestSeenAt)}`;
  }
  return base;
}

function formatChatContextLabel(contextType = "") {
  const normalized = String(contextType || "").trim().toLowerCase();
  if (!normalized) return "General";
  const labels = {
    report: "Reporte",
    program: "Programa",
    attendance: "Asistencia",
    access_request: "Acceso",
  };
  return labels[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatChatConversationType(conversation = {}) {
  if (conversation.contextType) return `Chat de ${formatChatContextLabel(conversation.contextType)}`;
  if (conversation.type === "group") return "Grupo";
  if (conversation.type === "direct") return "Directo";
  return "Conversacion";
}

function formatShortDateTime(value) {
  if (!value) return "Sin actividad";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return date.toLocaleString("es-DO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activeChatSearchInsights() {
  const query = String(state.chatSearch || "").trim().toLowerCase();
  const empty = {
    query,
    conversationIds: new Set(),
    messagesByConversationId: new Map(),
  };
  if (!query || chatSearchResults?.query !== query) return empty;
  const conversations = Array.isArray(chatSearchResults.conversations) ? chatSearchResults.conversations : [];
  const messages = Array.isArray(chatSearchResults.messages) ? chatSearchResults.messages : [];
  const conversationIds = new Set(conversations.map((item) => item.id).filter(Boolean));
  const messagesByConversationId = new Map();
  messages.forEach((message) => {
    if (!message?.conversationId) return;
    if (!messagesByConversationId.has(message.conversationId)) {
      messagesByConversationId.set(message.conversationId, []);
    }
    messagesByConversationId.get(message.conversationId).push(message);
  });
  return {
    query,
    conversationIds,
    messagesByConversationId,
  };
}

function resolveChatCreatorName(conversation = {}) {
  const creatorId = String(conversation.createdByUserId || "").trim();
  if (!creatorId) return "Sistema";
  if (creatorId === currentUser?.id) return currentUser.fullName || currentUser.email || "Tu usuario";
  const participant = (conversation.participants || []).find((item) => item.userId === creatorId);
  if (participant) return participant.displayName || participant.email || creatorId;
  const directoryMatch = (state.chatDirectory || []).find((item) => item.id === creatorId);
  if (directoryMatch) return directoryMatch.fullName || directoryMatch.email || creatorId;
  return creatorId;
}

function renderChatSearchSummary(conversations = filteredChatConversations()) {
  if (!elements.chatSearchSummary) return;
  const query = String(state.chatSearch || "").trim();
  if (!query) {
    elements.chatSearchSummary.innerHTML = `<p class="item-meta">Busca por nombre, mensaje, participante o nombre de adjunto.</p>`;
    return;
  }
  const insights = activeChatSearchInsights();
  const totalConversationHits = insights.conversationIds.size;
  const totalMessageHits = Array.from(insights.messagesByConversationId.values()).reduce((sum, items) => sum + items.length, 0);
  elements.chatSearchSummary.innerHTML = `
    <div class="chat-search-summary-card">
      <strong>${escapeHtml(String(conversations.length))} resultado${conversations.length === 1 ? "" : "s"}</strong>
      <span class="item-meta">Chats: ${escapeHtml(String(totalConversationHits))} · Mensajes: ${escapeHtml(String(totalMessageHits))}</span>
    </div>
  `;
}

function renderChatAreaChannels() {
  if (!elements.chatAreaChannels) return;
  elements.chatAreaChannels.innerHTML = INSTITUTIONAL_CHAT_AREAS.map(
    (area) => `
      <button class="chat-area-button" type="button" data-open-chat-area="${escapeHtml(area.id)}">
        <strong>${escapeHtml(area.title)}</strong>
        <span>${escapeHtml(area.description)}</span>
      </button>
    `,
  ).join("");
}

function renderChatLiveStatus(conversation = activeChatConversation()) {
  if (!elements.chatLiveStatus) return;
  if (!conversation) {
    elements.chatLiveStatus.innerHTML = "";
    elements.chatLiveStatus.hidden = true;
    return;
  }
  const { typingUsers, onlineUsers, latestSeenAt } = chatPresenceSummary(conversation);
  const typingLabel =
    typingUsers.length === 1
      ? `${typingUsers[0].displayName || "Alguien"} esta escribiendo...`
      : typingUsers.length > 1
        ? `${typingUsers.length} participantes estan escribiendo...`
        : "";
  const statusChips = [];
  if (typingLabel) {
    statusChips.push(`<span class="status-pill info">${escapeHtml(typingLabel)}</span>`);
  }
  if (onlineUsers.length) {
    statusChips.push(
      `<span class="status-pill success">${escapeHtml(String(onlineUsers.length))} en linea</span>`,
    );
  } else if (latestSeenAt) {
    statusChips.push(`<span class="status-pill neutral">Activo ${escapeHtml(formatRelativeTimestamp(latestSeenAt))}</span>`);
  } else {
    statusChips.push(`<span class="status-pill neutral">Sin actividad reciente</span>`);
  }
  elements.chatLiveStatus.hidden = false;
  elements.chatLiveStatus.innerHTML = statusChips.join("");
}

function renderChatDetails(conversation, messages = []) {
  if (!elements.chatDetailsGrid) return;
  if (!conversation) {
    elements.chatDetailsGrid.innerHTML = "";
    return;
  }
  const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
  const lastActivity = conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt || "";
  const sharedFilesCount = sharedChatAttachments(messages).length;
  const pinnedCount = pinnedChatMessages(messages).length;
  const liveParticipants = chatPresenceParticipants(conversation);
  const onlineCount = liveParticipants.filter((participant) => participant.userId !== currentUser?.id && participant.isOnline).length;
  const typingCount = liveParticipants.filter((participant) => participant.userId !== currentUser?.id && participant.isTyping).length;
  elements.chatDetailsGrid.innerHTML = `
    <article class="chat-detail-card">
      <p class="eyebrow">Tipo</p>
      <h3>${escapeHtml(formatChatConversationType(conversation))}</h3>
      <p class="item-meta">${escapeHtml(formatChatContextLabel(conversation.contextType || ""))}</p>
    </article>
    <article class="chat-detail-card">
      <p class="eyebrow">Participantes</p>
      <h3>${escapeHtml(String(participants.length))}</h3>
      <p class="item-meta">${escapeHtml(participants.map((item) => item.displayName || item.email || item.userId).slice(0, 3).join(", ") || "Sin participantes")}</p>
    </article>
    <article class="chat-detail-card">
      <p class="eyebrow">Actividad</p>
      <h3>${escapeHtml(String(onlineCount))} en linea</h3>
      <p class="item-meta">${typingCount ? `${escapeHtml(String(typingCount))} escribiendo · ` : ""}Ultimo mensaje ${escapeHtml(formatShortDateTime(lastActivity))}</p>
    </article>
    <article class="chat-detail-card">
      <p class="eyebrow">Creado por</p>
      <h3>${escapeHtml(resolveChatCreatorName(conversation))}</h3>
      <p class="item-meta">${escapeHtml(formatShortDateTime(conversation.createdAt || ""))}</p>
    </article>
    <article class="chat-detail-card">
      <p class="eyebrow">Archivos</p>
      <h3>${escapeHtml(String(sharedFilesCount))}</h3>
      <p class="item-meta">Adjuntos compartidos en este chat</p>
    </article>
    <article class="chat-detail-card">
      <p class="eyebrow">Fijados</p>
      <h3>${escapeHtml(String(pinnedCount))}</h3>
      <p class="item-meta">Mensajes importantes visibles para todos</p>
    </article>
  `;
}

function filteredChatConversations() {
  const query = String(state.chatSearch || "").trim().toLowerCase();
  if (!query) return state.chatConversations || [];
  if (chatSearchResults?.query && chatSearchResults.query === query) {
    const messageMatches = Array.isArray(chatSearchResults.messages) ? chatSearchResults.messages : [];
    const directMatches = Array.isArray(chatSearchResults.conversations) ? chatSearchResults.conversations : [];
    const conversationMap = new Map((state.chatConversations || []).map((conversation) => [conversation.id, conversation]));
    const ordered = [];
    const seen = new Set();
    [...directMatches, ...messageMatches]
      .map((item) => conversationMap.get(item.conversationId || item.id) || null)
      .filter(Boolean)
      .forEach((conversation) => {
        if (seen.has(conversation.id)) return;
        seen.add(conversation.id);
        ordered.push(conversation);
      });
    if (ordered.length) return ordered;
  }
  return (state.chatConversations || []).filter((conversation) => {
    const haystack = [
      chatConversationTitle(conversation),
      conversation.description || "",
      conversation.lastMessagePreview || "",
      ...(conversation.participants || []).flatMap((participant) => [participant.displayName || "", participant.email || ""]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function activeChatMessages() {
  const conversation = activeChatConversation();
  if (!conversation) return [];
  return state.chatMessagesByConversation?.[conversation.id] || [];
}

function pinnedChatMessages(messages = activeChatMessages()) {
  return (messages || [])
    .filter((message) => !message.isDeleted && !String(message.messageType || "").includes("system") && String(message.pinnedAt || "").trim())
    .sort((left, right) => String(right.pinnedAt || "").localeCompare(String(left.pinnedAt || "")));
}

function scrollToChatMessage(messageId) {
  const target = elements.chatMessageList?.querySelector(`[data-chat-message-id="${CSS.escape(String(messageId || ""))}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function ensureChatNavBadge() {
  const chatNav = document.querySelector('.nav-item[data-view="chat"]');
  if (!chatNav) return null;
  let badge = chatNav.querySelector(".nav-badge");
  if (!badge) {
    badge = document.createElement("small");
    badge.className = "nav-badge";
    badge.hidden = true;
    chatNav.appendChild(badge);
  }
  return badge;
}

function sharedChatAttachments(messages = activeChatMessages()) {
  const items = [];
  const seen = new Set();
  (messages || []).forEach((message) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    attachments.forEach((attachment) => {
      const href = uploadFileUrl(attachment) || attachment.fileUrl || attachment.dataUrl || "";
      const key = `${href}::${attachment.name || attachment.fileName || ""}`;
      if (!href || seen.has(key)) return;
      seen.add(key);
      items.push({
        ...attachment,
        href,
        messageId: message.id,
        messageCreatedAt: message.createdAt,
      });
    });
  });
  return items
    .sort((left, right) => String(right.messageCreatedAt || "").localeCompare(String(left.messageCreatedAt || "")))
    .slice(0, 10);
}

function chatReplyMessage(messageId, messages = activeChatMessages()) {
  return (messages || []).find((message) => message.id === messageId) || null;
}

function renderChatReplyPreview() {
  if (!elements.chatReplyPreview) return;
  const replyTarget = chatReplyMessage(chatReplyMessageId);
  if (!replyTarget) {
    elements.chatReplyPreview.hidden = true;
    elements.chatReplyPreview.innerHTML = "";
    return;
  }
  const summary = String(replyTarget.body || "").trim() || "(Sin texto)";
  elements.chatReplyPreview.hidden = false;
  elements.chatReplyPreview.innerHTML = `
    <p class="item-meta"><strong>Respondiendo a ${escapeHtml(replyTarget.senderName || "Usuario")}</strong></p>
    <p>${escapeHtml(summary.slice(0, 160))}</p>
    <div class="item-actions">
      <button class="ghost-action" type="button" data-clear-chat-reply>Cancelar respuesta</button>
    </div>
  `;
}

function startReplyToChatMessage(messageId) {
  const target = chatReplyMessage(messageId);
  if (!target) {
    showToast("No encontre el mensaje para responder.");
    return;
  }
  chatReplyMessageId = target.id;
  renderChatReplyPreview();
  elements.chatComposerInput?.focus();
}

function clearChatReplyTarget() {
  chatReplyMessageId = "";
  renderChatReplyPreview();
}

async function handleChatSearchQuery(query) {
  state.chatSearch = query;
  saveState();
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery || normalizedQuery.length < 2 || !isApiConfigured()) {
    chatSearchResults = null;
    renderChatWorkspace();
    return;
  }
  const requestId = ++chatSearchRequestId;
  try {
    const results = await searchApiChat(normalizedQuery);
    if (requestId !== chatSearchRequestId) return;
    chatSearchResults = {
      query: normalizedQuery,
      conversations: Array.isArray(results.conversations) ? results.conversations : [],
      messages: Array.isArray(results.messages) ? results.messages : [],
    };
    renderChatWorkspace();
  } catch (error) {
    if (requestId !== chatSearchRequestId) return;
    console.error("No pude buscar en el chat.", error);
    chatSearchResults = null;
    renderChatWorkspace();
  }
}

function populateChatDirectoryChoices() {
  if (!elements.chatUserSelect) return;
  const users = state.chatDirectory || [];
  const preferredUserId =
    users.some((user) => user.id === state.chatSelectedDirectUserId)
      ? state.chatSelectedDirectUserId
      : users[0]?.id || "";
  elements.chatUserSelect.innerHTML = users
    .map(
      (user, index) =>
        `<option value="${escapeHtml(user.id)}" ${index === 0 ? "selected" : ""}>${escapeHtml(`${user.fullName} · ${user.primaryRole || "Usuario"}`)}</option>`,
    )
    .join("");
  if (preferredUserId) {
    elements.chatUserSelect.value = preferredUserId;
  }
  state.chatSelectedDirectUserId = preferredUserId;
}

function renderChatGroupMemberChecklist() {
  if (!elements.chatGroupMemberChecklist) return;
  const users = state.chatDirectory || [];
  elements.chatGroupMemberChecklist.innerHTML = users.length
    ? users
        .map(
          (user) => `
            <label class="chat-member-option">
              <input type="checkbox" value="${escapeHtml(user.id)}" data-chat-group-member />
              <span>${escapeHtml(user.fullName)}</span>
            </label>
          `,
        )
        .join("")
    : `<p class="item-meta">No hay usuarios disponibles.</p>`;
}

function selectedChatGroupMemberIds() {
  if (!elements.chatGroupMemberChecklist) return [];
  return Array.from(elements.chatGroupMemberChecklist.querySelectorAll("[data-chat-group-member]:checked"))
    .map((input) => input.value)
    .filter(Boolean);
}

function availableParticipantsForActiveConversation(conversation = activeChatConversation()) {
  const participantIds = new Set((conversation?.participants || []).map((participant) => participant.userId));
  return (state.chatDirectory || []).filter((user) => !participantIds.has(user.id));
}

function currentChatParticipant(conversation = activeChatConversation()) {
  return (conversation?.participants || []).find((participant) => participant.userId === currentUser?.id) || null;
}

function canModerateActiveChatConversation(conversation = activeChatConversation()) {
  if (!conversation || conversation.type !== "group") return false;
  if (isSystemAdminRole()) return true;
  if (conversation.createdByUserId === currentUser?.id) return true;
  const participant = currentChatParticipant(conversation);
  return Boolean(participant?.participantRole === "owner" || participant?.canRemovePeople);
}

function populateChatParticipantManager(conversation = activeChatConversation()) {
  if (
    !elements.chatParticipantStrip ||
    !elements.chatAddParticipantForm ||
    !elements.chatAddParticipantSelect ||
    !elements.chatParticipantModeration
  ) return;
  const participants = conversation?.participants || [];
  elements.chatParticipantStrip.innerHTML = participants.length
    ? participants
        .map(
          (participant) => `
            <span class="chat-participant-chip">
              <strong>${escapeHtml(participant.displayName || participant.email || participant.userId)}</strong>
              <small>${escapeHtml(participant.primaryRole || participant.participantRole || "")}</small>
            </span>
          `,
        )
        .join("")
    : `<p class="item-meta">Sin participantes.</p>`;

  const canManageParticipants = canModerateActiveChatConversation(conversation);
  elements.chatAddParticipantForm.hidden = !canManageParticipants;
  if (!canManageParticipants) {
    elements.chatAddParticipantSelect.innerHTML = "";
    elements.chatParticipantModeration.hidden = true;
    elements.chatParticipantModeration.innerHTML = "";
    return;
  }
  const availableUsers = availableParticipantsForActiveConversation(conversation);
  elements.chatAddParticipantSelect.innerHTML = availableUsers.length
    ? availableUsers
        .map(
          (user, index) =>
            `<option value="${escapeHtml(user.id)}" ${index === 0 ? "selected" : ""}>${escapeHtml(`${user.fullName} · ${user.primaryRole || "Usuario"}`)}</option>`,
        )
        .join("")
    : `<option value="">No hay mas usuarios disponibles</option>`;
  elements.chatAddParticipantSelect.disabled = !availableUsers.length;
  const submitButton = elements.chatAddParticipantForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = !availableUsers.length;
  elements.chatParticipantModeration.hidden = false;
  elements.chatParticipantModeration.innerHTML = `
    <div class="panel-header compact">
      <div>
        <p class="eyebrow">Moderacion</p>
        <h3>Permisos del grupo</h3>
      </div>
    </div>
    <div class="chat-participant-admin-list">
      ${participants
        .map((participant) => {
          const canModifyOwner =
            participant.participantRole !== "owner" || isSystemAdminRole() || participant.userId === currentUser?.id;
          const disableControls = !canModifyOwner;
          const isSelf = participant.userId === currentUser?.id;
          return `
            <form class="chat-participant-admin-row" data-chat-participant-manage="${escapeHtml(participant.userId)}">
              <div>
                <strong>${escapeHtml(participant.displayName || participant.email || participant.userId)}</strong>
                <p class="item-meta">${escapeHtml(participant.primaryRole || participant.email || participant.userId)}</p>
              </div>
                <label>
                  Rol
                  <select name="participantRole" ${disableControls ? "disabled" : ""}>
                    <option value="member" ${participant.participantRole === "member" ? "selected" : ""}>Miembro</option>
                    <option value="admin" ${participant.participantRole === "admin" ? "selected" : ""}>Admin</option>
                    ${isSystemAdminRole() ? `<option value="owner" ${participant.participantRole === "owner" ? "selected" : ""}>Propietario</option>` : ""}
                  </select>
                </label>
              <label class="toggle-field">
                <input type="checkbox" name="canSendMessages" ${participant.canSendMessages !== false ? "checked" : ""} ${disableControls ? "disabled" : ""} />
                <span>Puede escribir</span>
              </label>
              <label class="toggle-field">
                <input type="checkbox" name="isMuted" ${participant.isMuted ? "checked" : ""} ${disableControls ? "disabled" : ""} />
                <span>Silenciado</span>
              </label>
              <div class="item-actions">
                <button class="ghost-action" type="submit" ${disableControls ? "disabled" : ""}>Guardar</button>
                ${
                  !isSelf && canModifyOwner
                    ? `<button class="ghost-action danger-action" type="button" data-remove-chat-participant="${escapeHtml(participant.userId)}">Quitar</button>`
                    : ""
                }
              </div>
            </form>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadChatConversation(conversationId, options = {}) {
  if (!isApiConfigured() || !conversationId) return;
  const { markRead = true } = options;
  if (chatTypingConversationId && chatTypingConversationId !== conversationId) {
    stopChatTyping({ conversationId: chatTypingConversationId });
  }
  const detail = await fetchApiChatConversation(conversationId);
  const response = await fetchApiChatMessages(conversationId, { limit: 80 });
  upsertById(state.chatConversations, detail);
  state.chatMessagesByConversation = {
    ...(state.chatMessagesByConversation || {}),
    [conversationId]: Array.isArray(response.data) ? response.data : [],
  };
  state.chatActiveConversationId = conversationId;

  const messages = state.chatMessagesByConversation[conversationId] || [];
  const lastUnread = [...messages].reverse().find((message) => message.senderUserId !== currentUser?.id);
  if (markRead && lastUnread) {
    try {
      await markApiChatConversationRead(conversationId, { lastReadMessageId: lastUnread.id });
      state.chatUnreadCount = await fetchApiChatUnreadCount();
      state.chatConversations = await fetchApiChatConversations();
    } catch (error) {
      console.error("No pude marcar el chat como leido.", error);
    }
  }

  saveState();
  try {
    await sendChatPresenceHeartbeat({ activeConversationId: conversationId, activeView: state?.activeView || "chat" });
    await refreshActiveChatPresence({ conversationId, render: false });
  } catch (error) {
    console.error("No pude refrescar la presencia de la conversacion.", error);
  }
}

async function openChatConversationById(conversationId, options = {}) {
  const { switchToChat = false, markRead = true } = options;
  if (!conversationId) return;
  await loadChatConversation(conversationId, { markRead });
  if (switchToChat) {
    switchView("chat", { persist: true, resetScroll: false });
  } else {
    renderChatWorkspace();
  }
}

async function refreshChatFromApi(options = {}) {
  if (!isApiConfigured()) return;
  const { includeMessages = true, includeDirectory = true } = options;
  const requests = [fetchApiChatConversations(), fetchApiChatUnreadCount()];
  if (includeDirectory) {
    requests.push(fetchApiChatDirectory());
  }
  const [conversations, unreadCount, directory] = await Promise.all(requests);
  state.chatConversations = conversations;
  if (includeDirectory) {
    state.chatDirectory = directory;
  }
  state.chatUnreadCount = unreadCount;
  if (!state.chatActiveConversationId || !conversations.some((conversation) => conversation.id === state.chatActiveConversationId)) {
    state.chatActiveConversationId = conversations[0]?.id || "";
  }
  if (includeMessages && state.chatActiveConversationId) {
    await loadChatConversation(state.chatActiveConversationId, { markRead: true });
  }
  saveState();
}

async function refreshActiveChatPresence(options = {}) {
  if (!isApiConfigured()) return null;
  const { conversationId = state.chatActiveConversationId, render = false } = options;
  if (!conversationId) return null;
  const snapshot = await fetchApiChatConversationPresence(conversationId);
  state.chatPresenceByConversation = {
    ...(state.chatPresenceByConversation || {}),
    [conversationId]: snapshot,
  };
  saveState();
  if (render) {
    renderChatWorkspace();
  }
  return snapshot;
}

async function sendChatPresenceHeartbeat(options = {}) {
  if (!isApiConfigured() || !currentUser) return null;
  const activeConversationId =
    options.activeConversationId !== undefined
      ? options.activeConversationId
      : state?.activeView === "chat"
        ? state.chatActiveConversationId
        : "";
  return postApiChatPresence({
    activeConversationId: activeConversationId || "",
    activeView: options.activeView || state?.activeView || "",
  });
}

async function setChatTypingState(conversationId, isTyping) {
  if (!isApiConfigured() || !currentUser || !conversationId) return;
  await postApiChatTyping(conversationId, { isTyping: Boolean(isTyping) });
  chatTypingConversationId = conversationId;
  chatTypingActive = Boolean(isTyping);
  chatTypingLastSentAt = Date.now();
}

function clearChatTypingTimer() {
  if (chatTypingStopTimerId !== null) {
    window.clearTimeout(chatTypingStopTimerId);
    chatTypingStopTimerId = null;
  }
}

function stopChatTyping(options = {}) {
  const conversationId = options.conversationId || chatTypingConversationId || state?.chatActiveConversationId || "";
  clearChatTypingTimer();
  if (!conversationId || !chatTypingActive) {
    chatTypingConversationId = conversationId || "";
    chatTypingActive = false;
    return;
  }
  chatTypingActive = false;
  chatTypingConversationId = conversationId;
  void setChatTypingState(conversationId, false).catch((error) => console.error("No pude detener el indicador de escritura.", error));
}

function scheduleChatTypingStop(conversationId) {
  clearChatTypingTimer();
  chatTypingStopTimerId = window.setTimeout(() => {
    stopChatTyping({ conversationId });
  }, CHAT_TYPING_IDLE_MS);
}

function handleChatComposerInputChange() {
  const conversation = activeChatConversation();
  const conversationId = conversation?.id || "";
  const value = String(elements.chatComposerInput?.value || "").trim();
  if (!conversationId || !value) {
    stopChatTyping({ conversationId: conversationId || chatTypingConversationId });
    return;
  }
  const shouldRefreshTypingHeartbeat =
    !chatTypingActive ||
    chatTypingConversationId !== conversationId ||
    Date.now() - chatTypingLastSentAt > CHAT_TYPING_REFRESH_MS;
  if (shouldRefreshTypingHeartbeat) {
    void setChatTypingState(conversationId, true).catch((error) => console.error("No pude actualizar el estado de escritura.", error));
  }
  scheduleChatTypingStop(conversationId);
}

function selectNewestUnreadConversation(nextConversations = [], previousConversations = []) {
  const previousUnreadById = new Map(
    (previousConversations || []).map((conversation) => [conversation.id, Number(conversation.unreadCount || 0)]),
  );
  return (nextConversations || [])
    .filter((conversation) => Number(conversation.unreadCount || 0) > Number(previousUnreadById.get(conversation.id) || 0))
    .sort((left, right) => String(right.lastMessageAt || "").localeCompare(String(left.lastMessageAt || "")))[0] || null;
}

function notifyNewChatMessage(conversation) {
  if (!conversation) return;
  const title = chatConversationTitle(conversation);
  const preview = String(conversation.lastMessagePreview || "").trim();
  showToast(preview ? `Nuevo mensaje en ${title}: ${preview.slice(0, 90)}` : `Nuevo mensaje en ${title}.`);
}

function latestUnreadChatConversation() {
  return (state.chatConversations || [])
    .filter((conversation) => Number(conversation.unreadCount || 0) > 0)
    .sort((left, right) => String(right.lastMessageAt || "").localeCompare(String(left.lastMessageAt || "")))[0] || null;
}

function updateAppDocumentTitle() {
  const unreadMessages = Number(state?.chatUnreadCount?.totalUnreadMessages || 0);
  const reportAlerts = Number(inboxReportsForRole(activeRole()).length || 0);
  const operationalAlerts = Number(notificationsForActiveRole().length || 0);
  const totalAlerts = unreadMessages + reportAlerts + operationalAlerts;
  document.title = totalAlerts > 0 ? `(${totalAlerts}) ${BASE_DOCUMENT_TITLE}` : BASE_DOCUMENT_TITLE;
}

function renderChatNotificationCard(conversation) {
  if (!conversation) return "";
  const unreadCount = Number(conversation.unreadCount || 0);
  const preview = String(conversation.lastMessagePreview || "").trim() || "Tienes actividad nueva en este chat.";
  return `
    <article class="notification-item chat-alert">
      <div class="notification-top">
        <div>
          <p class="eyebrow">Mensajeria interna</p>
          <h3>${escapeHtml(chatConversationTitle(conversation))}</h3>
          <p class="item-meta">${escapeHtml(chatConversationMeta(conversation))} · ${escapeHtml(formatShortDateTime(conversation.lastMessageAt || conversation.updatedAt || ""))}</p>
        </div>
        <span class="status-pill info">${escapeHtml(String(unreadCount))} sin leer</span>
      </div>
      <p>${escapeHtml(preview.slice(0, 180))}</p>
      <div class="item-actions">
        <button class="ghost-action" type="button" data-open-chat-conversation="${escapeHtml(conversation.id)}">Abrir chat</button>
      </div>
    </article>
  `;
}

async function syncChatInbox(options = {}) {
  if (!isApiConfigured() || chatSyncInFlight) return;
  const {
    includeMessages = false,
    includeDirectory = false,
    showToastOnNewMessages = false,
  } = options;
  chatSyncInFlight = true;
  try {
    const previousConversations = Array.isArray(state?.chatConversations) ? state.chatConversations.map((item) => ({ ...item })) : [];
    const previousUnreadTotal = Number(state?.chatUnreadCount?.totalUnreadMessages || 0);
    await refreshChatFromApi({
      includeMessages,
      includeDirectory: includeDirectory || !Array.isArray(state?.chatDirectory) || !state.chatDirectory.length,
    });
    renderChatWorkspace();
    renderNotifications();
    const nextUnreadTotal = Number(state?.chatUnreadCount?.totalUnreadMessages || 0);
    if (chatSyncPrimed && showToastOnNewMessages && nextUnreadTotal > previousUnreadTotal) {
      notifyNewChatMessage(selectNewestUnreadConversation(state.chatConversations || [], previousConversations));
    }
    chatSyncPrimed = true;
  } finally {
    chatSyncInFlight = false;
  }
}

function renderChatWorkspace() {
  if (
    !elements.chatConversationList ||
    !elements.chatMessageList ||
    !elements.chatConversationTitle ||
    !elements.chatConversationMeta ||
    !elements.chatUnreadCount
  ) {
    return;
  }

  populateChatDirectoryChoices();
  renderChatGroupMemberChecklist();
  renderChatAreaChannels();
  const conversations = filteredChatConversations();
  const activeConversation = activeChatConversation();
  const messages = activeConversation ? state.chatMessagesByConversation?.[activeConversation.id] || [] : [];
  const normalizedQuery = String(state.chatSearch || "").trim().toLowerCase();
  const searchInsights = activeChatSearchInsights();
  const searchMessages = searchInsights.query === normalizedQuery ? chatSearchResults?.messages || [] : [];

  elements.chatUnreadCount.textContent = `${Number(state.chatUnreadCount?.totalUnreadMessages || 0)} sin leer`;
  const chatNavBadge = ensureChatNavBadge();
  if (chatNavBadge) {
    const totalUnread = Number(state.chatUnreadCount?.totalUnreadMessages || 0);
    chatNavBadge.hidden = totalUnread <= 0;
    chatNavBadge.textContent = totalUnread > 99 ? "99+" : String(totalUnread);
  }
  renderChatSearchSummary(conversations);
  elements.chatConversationList.innerHTML = conversations.length
    ? conversations
        .map(
          (conversation) => {
            const matchedMessages = searchInsights.messagesByConversationId.get(conversation.id) || [];
            const matchedMessage = matchedMessages[0] || searchMessages.find((message) => message.conversationId === conversation.id);
            const hasConversationMatch = searchInsights.conversationIds.has(conversation.id);
            const hasMessageMatch = matchedMessages.length > 0;
            const searchBadge = normalizedQuery
              ? hasMessageMatch
                ? `<span class="status-pill info">${escapeHtml(chatSearchMatchLabel(matchedMessage) || "Coincide en mensaje")}</span>`
                : hasConversationMatch
                  ? `<span class="status-pill neutral">Coincide en chat</span>`
                  : ""
              : "";
            return `
            <article class="chat-conversation-item ${conversation.id === activeConversation?.id ? "active" : ""} ${hasMessageMatch ? "search-hit" : ""}" data-open-chat-conversation="${conversation.id}">
              <div class="chat-conversation-item-head">
                <h3>${escapeHtml(chatConversationTitle(conversation))}</h3>
                <span class="status-pill ${conversation.unreadCount ? "warning" : "neutral"}">${conversation.unreadCount || 0}</span>
              </div>
              <p class="item-meta">${escapeHtml(chatConversationMeta(conversation))}</p>
              ${searchBadge}
              <p>${escapeHtml(chatSearchPreviewText(matchedMessage, conversation.lastMessagePreview).slice(0, 180))}</p>
            </article>
          `;
          },
        )
        .join("")
    : `<div class="chat-empty-state">No hay conversaciones todavia.</div>`;

  elements.chatConversationTitle.textContent = activeConversation ? chatConversationTitle(activeConversation) : "Selecciona una conversacion";
  elements.chatConversationMeta.textContent = activeConversation
    ? chatConversationMeta(activeConversation)
    : "Elige un chat o crea uno nuevo para empezar.";
  renderChatLiveStatus(activeConversation);
  renderChatDetails(activeConversation, messages);
  if (elements.chatDeleteButton) {
    elements.chatDeleteButton.hidden = !activeConversation || !canDeleteActiveChatConversation(activeConversation);
    elements.chatDeleteButton.disabled = !activeConversation || !canDeleteActiveChatConversation(activeConversation);
  }
  if (elements.chatRenameButton) {
    elements.chatRenameButton.hidden = !activeConversation || !canRenameActiveChatConversation(activeConversation);
    elements.chatRenameButton.disabled = !activeConversation || !canRenameActiveChatConversation(activeConversation);
  }
  if (elements.chatLeaveButton) {
    elements.chatLeaveButton.hidden = !activeConversation || !canLeaveActiveChatConversation(activeConversation);
    elements.chatLeaveButton.disabled = !activeConversation || !canLeaveActiveChatConversation(activeConversation);
  }
  if (elements.chatSharedFiles) {
    const sharedFiles = sharedChatAttachments(messages);
    elements.chatSharedFiles.innerHTML = sharedFiles.length
      ? sharedFiles
          .map((attachment) => {
            const label = escapeHtml(attachment.name || attachment.fileName || "Adjunto");
            const meta = escapeHtml(formatFileSize(attachment.size || attachment.fileSizeBytes || 0));
            return `<a class="chat-shared-file-chip" href="${escapeHtml(attachment.href)}" target="_blank" rel="noreferrer">Archivo: ${label}${meta ? ` <small>${meta}</small>` : ""}</a>`;
          })
          .join("")
      : `<p class="item-meta">Sin archivos compartidos todavia.</p>`;
  }
  if (elements.chatPinnedMessages) {
    const pinnedMessages = pinnedChatMessages(messages);
    elements.chatPinnedMessages.innerHTML = pinnedMessages.length
      ? `
        <div class="chat-pinned-header">
          <p class="eyebrow">Mensajes fijados</p>
          <span class="status-pill info">${escapeHtml(String(pinnedMessages.length))}</span>
        </div>
        <div class="chat-pinned-list">
          ${pinnedMessages
            .map((message) => {
              const pinnedBy = message.pinnedByName || message.senderName || "Usuario";
              return `
                <article class="chat-pinned-card">
                  <div class="chat-pinned-card-head">
                    <strong>${escapeHtml(message.senderName || "Usuario")}</strong>
                    <span class="item-meta">${escapeHtml(formatShortDateTime(message.pinnedAt || message.createdAt || ""))}</span>
                  </div>
                  <p>${escapeHtml(String(message.body || "(Sin texto)").slice(0, 180))}</p>
                  <p class="item-meta">Fijado por ${escapeHtml(pinnedBy)}</p>
                  <div class="item-actions">
                    <button class="ghost-action" type="button" data-chat-scroll-to-message="${escapeHtml(message.id)}">Ir al mensaje</button>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      `
      : `<p class="item-meta">No hay mensajes fijados en este chat.</p>`;
  }
  populateChatParticipantManager(activeConversation);
  elements.chatMessageList.innerHTML = activeConversation
    ? messages.length
      ? messages
          .map(
            (message) => {
              const replied = message.replyToMessageId ? chatReplyMessage(message.replyToMessageId, messages) : null;
              const readSummary = chatMessageStatusLabel(message, activeConversation);
              const isSystemMessage = message.messageType === "system";
              const activeConversationSearchHits = searchInsights.messagesByConversationId.get(activeConversation.id) || [];
              const isSearchHit = activeConversationSearchHits.some((item) => item.id === message.id);
              const searchMatchLabel = isSearchHit ? chatSearchMatchLabel(activeConversationSearchHits.find((item) => item.id === message.id) || message) : "";
              return `
              <article class="chat-message-item ${message.senderUserId === currentUser?.id ? "mine" : ""} ${isSystemMessage ? "system" : ""} ${isSearchHit ? "search-hit" : ""}" data-chat-message-id="${escapeHtml(message.id)}">
                <div class="chat-message-item-head">
                  <strong>${escapeHtml(message.senderName || "Usuario")}</strong>
                  <span class="item-meta">${escapeHtml(String(message.createdAt || "").slice(0, 16).replace("T", " "))}</span>
                </div>
                ${
                  replied
                    ? `<div class="chat-message-reply"><p class="item-meta"><strong>${escapeHtml(replied.senderName || "Usuario")}</strong></p><p>${escapeHtml(String(replied.body || "(Sin texto)").slice(0, 140))}</p></div>`
                    : ""
                }
                <p>${escapeHtml(message.body || "(Sin texto)")}</p>
                ${message.pinnedAt ? `<span class="status-pill warning">Fijado</span>` : ""}
                ${isSearchHit ? `<span class="status-pill info">${escapeHtml(searchMatchLabel || "Coincide con la busqueda")}</span>` : ""}
                ${renderRichChatAttachmentLinks(message.attachments || [])}
                <div class="chat-message-actions">
                  ${!isSystemMessage ? `<button class="ghost-action" type="button" data-chat-reply="${message.id}">Responder</button>` : ""}
                  ${!isSystemMessage ? `<button class="ghost-action" type="button" data-chat-pin="${message.id}" data-chat-pin-next="${message.pinnedAt ? "false" : "true"}">${message.pinnedAt ? "Quitar fijado" : "Fijar"}</button>` : ""}
                  ${readSummary ? `<span class="item-meta">${escapeHtml(readSummary)}</span>` : ""}
                </div>
              </article>
            `;
            },
          )
          .join("")
      : `<div class="chat-empty-state">Todavia no hay mensajes en esta conversacion.</div>`
    : `<div class="chat-empty-state">Selecciona una conversacion para ver mensajes.</div>`;

  if (elements.chatComposerInput) {
    elements.chatComposerInput.disabled = !activeConversation;
    if (!activeConversation) {
      elements.chatComposerInput.value = "";
    }
  }
  if (elements.chatAttachmentInput) {
    elements.chatAttachmentInput.disabled = !activeConversation;
    if (!activeConversation) {
      elements.chatAttachmentInput.value = "";
    }
  }
  if (!activeConversation && chatAttachmentFiles.length) {
    chatAttachmentFiles = [];
  }
  if (!activeConversation) {
    clearChatReplyTarget();
  }
  renderChatReplyPreview();
  renderChatAttachmentPreview();
}

function renderChatAttachmentLinks(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  const items = attachments
    .map((attachment, index) => {
      const label = escapeHtml(attachment.name || `Adjunto ${index + 1}`);
      const href = uploadFileUrl(attachment) || attachment.fileUrl || attachment.dataUrl || "";
      const meta = [attachment.type || attachment.mimeType || "", formatFileSize(attachment.size || attachment.fileSizeBytes || 0)]
        .filter(Boolean)
        .join(" · ");
      if (!href) {
        return `<span class="attachment-link unavailable">${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</span>`;
      }
      return `<a class="attachment-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Abrir ${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</a>`;
    })
    .join("");
  return `<div class="attachment-list">${items}</div>`;
}

function chatSearchMatchLabel(message) {
  const source = String(message?.matchSource || "").trim().toLowerCase();
  if (source === "attachment") return "Coincide en adjunto";
  if (source === "sender") return "Coincide en remitente";
  if (source === "message") return "Coincide en mensaje";
  return "";
}

function chatSearchPreviewText(message, fallback = "") {
  const explicitPreview = String(message?.matchPreview || "").trim();
  if (explicitPreview) return explicitPreview;
  const body = String(message?.body || "").trim();
  if (body) return body;
  return String(fallback || "").trim() || "Sin mensajes todavia.";
}

function chatPdfPreviewUrl(href) {
  const normalized = String(href || "").trim();
  if (!normalized) return "";
  return normalized.includes("#") ? normalized : `${normalized}#view=FitH&toolbar=0&navpanes=0&scrollbar=0`;
}

function renderRichChatAttachmentLinks(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  const items = attachments
    .map((attachment, index) => {
      const label = escapeHtml(attachment.name || `Adjunto ${index + 1}`);
      const href = chatAttachmentHref(attachment);
      const meta = [attachment.type || attachment.mimeType || "", formatFileSize(attachment.size || attachment.fileSizeBytes || 0)]
        .filter(Boolean)
        .join(" · ");
      if (!href) {
        return `<span class="attachment-link unavailable">${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</span>`;
      }
      if (isImageChatAttachment(attachment)) {
        return `
          <a class="chat-image-attachment" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
            <img src="${escapeHtml(href)}" alt="${label}" />
            <span>${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</span>
          </a>
        `;
      }
      if (isPdfChatAttachment(attachment)) {
        const previewUrl = chatPdfPreviewUrl(href);
        return `
          <article class="chat-pdf-attachment">
            <iframe src="${escapeHtml(previewUrl)}" title="${label}" loading="lazy"></iframe>
            <div class="chat-pdf-attachment-meta">
              <strong>${label}</strong>
              ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
            </div>
            <div class="chat-pdf-attachment-actions">
              <a class="attachment-link pdf" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Abrir PDF</a>
            </div>
          </article>
        `;
      }
      return `<a class="attachment-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Abrir ${label}${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</a>`;
    })
    .join("");
  return `<div class="attachment-list">${items}</div>`;
}

function renderChatAttachmentPreview() {
  if (!elements.chatAttachmentPreview) return;
  const files = Array.from(chatAttachmentFiles || []);
  if (!files.length) {
    elements.chatAttachmentPreview.innerHTML = `<p class="item-meta">Sin adjuntos seleccionados.</p>`;
    return;
  }
  const hasOversized = files.some((file) => file.size > MAX_REPORT_ATTACHMENT_BYTES);
  if (hasOversized) {
    elements.chatAttachmentPreview.innerHTML = `<p class="item-meta">Uno o mÃ¡s adjuntos superan ${formatFileSize(MAX_REPORT_ATTACHMENT_BYTES)}.</p>`;
    return;
  }
  elements.chatAttachmentPreview.innerHTML = `<ul>${files
    .map((file) => `<li>${escapeHtml(file.name)} <span class="item-meta">(${escapeHtml(formatFileSize(file.size))})</span></li>`)
    .join("")}</ul>`;
}

function setChatAttachmentFiles(files = []) {
  chatAttachmentFiles = Array.from(files || []).filter(Boolean);
  renderChatAttachmentPreview();
}

async function createDirectChat(userId) {
  state.chatSelectedDirectUserId = String(userId || "").trim();
  saveState();
  const selectedUser = (state.chatDirectory || []).find((user) => user.id === userId);
  if (!selectedUser) {
    showToast("Selecciona un usuario valido.");
    return;
  }
  const existing = (state.chatConversations || []).find(
    (conversation) =>
      conversation.type === "direct" &&
      (conversation.participants || []).some((participant) => participant.userId === userId) &&
      (conversation.participants || []).some((participant) => participant.userId === currentUser?.id),
  );
  if (existing) {
    state.chatActiveConversationId = existing.id;
    await loadChatConversation(existing.id, { markRead: true });
    renderChatWorkspace();
    return;
  }
  const created = await createApiChatConversation({
    type: "direct",
    title: selectedUser.fullName,
    participantUserIds: [userId],
  });
  state.chatActiveConversationId = created.id;
  await refreshChatFromApi({ includeMessages: true });
  renderChatWorkspace();
  showToast("Chat creado.");
}

async function createGroupChat(groupName, participantUserIds = []) {
  const normalizedName = String(groupName || "").trim();
  if (!normalizedName) {
    showToast("Escribe el nombre del grupo.");
    return;
  }
  const uniqueParticipantIds = [...new Set(participantUserIds.map((item) => String(item || "").trim()).filter(Boolean))];
  if (!uniqueParticipantIds.length) {
    showToast("Selecciona al menos un participante.");
    return;
  }
  const created = await createApiChatConversation({
    type: "group",
    title: normalizedName,
    participantUserIds: uniqueParticipantIds,
  });
  state.chatActiveConversationId = created.id;
  await refreshChatFromApi({ includeMessages: true });
  elements.chatGroupCreateForm?.reset();
  renderChatGroupMemberChecklist();
  renderChatWorkspace();
  showToast("Grupo creado.");
}

async function ensureChatDirectoryLoaded() {
  if (!isApiConfigured()) return state.chatDirectory || [];
  if (Array.isArray(state.chatDirectory) && state.chatDirectory.length) {
    return state.chatDirectory;
  }
  const directory = await fetchApiChatDirectory();
  state.chatDirectory = directory;
  saveState();
  return directory;
}

function activeOrganizationParticipantIds() {
  return [...new Set((state.chatDirectory || []).map((user) => user.id).filter(Boolean))];
}

function chatAttachmentHref(attachment = {}) {
  return uploadFileUrl(attachment) || attachment.fileUrl || attachment.dataUrl || "";
}

function isImageChatAttachment(attachment = {}) {
  return String(attachment.type || attachment.mimeType || "").startsWith("image/");
}

function isPdfChatAttachment(attachment = {}) {
  return String(attachment.type || attachment.mimeType || "").includes("pdf");
}

async function sendAutomatedChatMessage(conversationId, body, options = {}) {
  if (!isApiConfigured() || !conversationId || !String(body || "").trim()) return null;
  return createApiChatMessage(conversationId, {
    messageType: options.messageType || "system",
    body: String(body || "").trim(),
    replyToMessageId: "",
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
  });
}

async function ensureContextChatConversation({
  title,
  description = "",
  contextType,
  contextId,
  participantUserIds = [],
}) {
  if (!contextType || !contextId) throw new Error("El chat contextual necesita tipo y contexto.");
  const existing = (state.chatConversations || []).find(
    (conversation) => conversation.contextType === contextType && conversation.contextId === contextId,
  );
  if (existing) return existing;

  await ensureChatDirectoryLoaded();
  const requestedParticipantIds = participantUserIds.length ? participantUserIds : activeOrganizationParticipantIds();
  const participantIds = [...new Set(requestedParticipantIds.map((item) => String(item || "").trim()).filter(Boolean))];
  const created = await createApiChatConversation({
    type: "group",
    title,
    description,
    contextType,
    contextId,
    participantUserIds: participantIds,
  });
  await refreshChatFromApi({ includeMessages: false, includeDirectory: false });
  return created;
}

async function openProgramChat(programIdOrName, options = {}) {
  const { openView = true } = options;
  const program = (state.programs || []).find(
    (item) => item.id === programIdOrName || item.name === programIdOrName,
  );
  if (!program) {
    showToast("No encontre el programa para abrir su chat.");
    return;
  }
  const conversation = await ensureContextChatConversation({
    title: `Programa · ${program.name}`,
    description: `Chat institucional del programa ${program.name}.`,
    contextType: "program",
    contextId: program.id || `program-${slugify(program.name)}`,
    participantUserIds: activeOrganizationParticipantIds(),
  });
  await openChatConversationById(conversation.id, { switchToChat: openView, markRead: true });
}

async function openAttendanceChat(options = {}) {
  const { openView = true } = options;
  const programName = String(state.attendanceProgram || "").trim();
  if (!programName) {
    showToast("Selecciona un programa para abrir el chat de asistencia.");
    return;
  }
  await ensureChatDirectoryLoaded();
  const conversation = await ensureContextChatConversation({
    title: `Asistencia · ${programName}`,
    description: `Seguimiento operativo de asistencia para ${programName}.`,
    contextType: "attendance",
    contextId: `attendance-${slugify(programName)}`,
    participantUserIds: activeOrganizationParticipantIds(),
  });
  await openChatConversationById(conversation.id, { switchToChat: openView, markRead: true });
}

async function openAreaChat(areaId, options = {}) {
  const { openView = true } = options;
  const area = INSTITUTIONAL_CHAT_AREAS.find((item) => item.id === areaId);
  if (!area) {
    showToast("No encontre el canal institucional solicitado.");
    return;
  }
  await ensureChatDirectoryLoaded();
  const conversation = await ensureContextChatConversation({
    title: `Canal · ${area.title}`,
    description: area.description,
    contextType: "area",
    contextId: `area-${area.id}`,
    participantUserIds: activeOrganizationParticipantIds(),
  });
  await openChatConversationById(conversation.id, { switchToChat: openView, markRead: true });
}

async function addParticipantsToCurrentGroup(userIds = []) {
  const activeConversation = activeChatConversation();
  if (!activeConversation || activeConversation.type !== "group") {
    showToast("Selecciona un grupo.");
    return;
  }
  const uniqueParticipantIds = [...new Set(userIds.map((item) => String(item || "").trim()).filter(Boolean))];
  if (!uniqueParticipantIds.length) {
    showToast("Selecciona un participante valido.");
    return;
  }
  await addApiChatParticipants(activeConversation.id, {
    participantUserIds: uniqueParticipantIds,
  });
  await refreshChatFromApi({ includeMessages: true });
  elements.chatAddParticipantForm?.reset();
  renderChatWorkspace();
  showToast("Participante agregado al grupo.");
}

async function updateParticipantInCurrentGroup(userId, payload = {}) {
  const activeConversation = activeChatConversation();
  if (!activeConversation || activeConversation.type !== "group") {
    showToast("Selecciona un grupo.");
    return;
  }
  await updateApiChatParticipant(activeConversation.id, userId, payload);
  await refreshChatFromApi({ includeMessages: true });
  renderChatWorkspace();
  showToast("Permisos del participante actualizados.");
}

async function removeParticipantFromCurrentGroup(userId) {
  const activeConversation = activeChatConversation();
  if (!activeConversation || activeConversation.type !== "group") {
    showToast("Selecciona un grupo.");
    return;
  }
  const target = (activeConversation.participants || []).find((participant) => participant.userId === userId);
  const confirmed = window.confirm(`Quitar a ${target?.displayName || target?.email || "este participante"} del grupo?`);
  if (!confirmed) return;
  await removeApiChatParticipant(activeConversation.id, userId);
  await refreshChatFromApi({ includeMessages: true });
  renderChatWorkspace();
  showToast("Participante quitado del grupo.");
}

function findReportOwnerUser(report, directory = state.chatDirectory || []) {
  if (!report) return null;
  const ownerUserId = String(report.ownerUserId || "").trim();
  const ownerEmail = String(report.ownerEmail || "").trim().toLowerCase();
  const ownerLabel = String(report.owner || "").trim().toLowerCase();
  return (
    directory.find((user) => ownerUserId && user.id === ownerUserId) ||
    directory.find((user) => ownerEmail && String(user.email || "").trim().toLowerCase() === ownerEmail) ||
    directory.find((user) => ownerLabel && String(user.fullName || "").trim().toLowerCase() === ownerLabel) ||
    null
  );
}

function reportChatTitle(report) {
  const indicator = indicatorById(report?.indicatorId);
  const program = String(report?.program || "Reporte").trim();
  const indicatorName = String(indicator?.name || "").trim();
  const period = String(report?.period || report?.date || "").trim();
  return ["Reporte", program, indicatorName || null, period || null].filter(Boolean).join(" · ");
}

async function ensureReportConversation(report, options = {}) {
  const { openView = true, seedMessage = "" } = options;
  if (!report || !isApiConfigured()) return null;
  if (!viewIsEnabled("chat")) {
    if (openView) showToast("Tu perfil no tiene acceso a chat.");
    return null;
  }

  const directory = await ensureChatDirectoryLoaded();
  const existing = await fetchApiChatConversations({
    contextType: "report",
    contextId: report.id,
  });

  let conversation = existing[0] || null;
  if (!conversation) {
    const participantIds = new Set([currentUser?.id].filter(Boolean));
    const ownerUser = findReportOwnerUser(report, directory);
    if (ownerUser?.id) participantIds.add(ownerUser.id);
    directory.forEach((user) => {
      if (["Coordinador de programa", "Program Manager", "Supervision M&E", "Director Nacional"].includes(user.primaryRole)) {
        participantIds.add(user.id);
      }
    });
    conversation = await createApiChatConversation({
      type: "group",
      title: reportChatTitle(report),
      contextType: "report",
      contextId: report.id,
      participantUserIds: [...participantIds],
    });
  }

  if (String(seedMessage || "").trim()) {
    await createApiChatMessage(conversation.id, {
      messageType: "system",
      body: String(seedMessage || "").trim(),
      attachments: [],
    });
  }

  await refreshChatFromApi({ includeMessages: false });
  state.chatActiveConversationId = conversation.id;
  await loadChatConversation(conversation.id, { markRead: true });
  if (openView) {
    switchView("chat");
  } else if (state.activeView === "chat") {
    renderChatWorkspace();
  }
  return conversation;
}

async function openReportChatById(reportId, options = {}) {
  const report = (state.reports || []).find((item) => item.id === reportId);
  if (!report) {
    showToast("No encontre el reporte para abrir el chat.");
    return null;
  }
  return ensureReportConversation(report, options);
}

function canDeleteActiveChatConversation(conversation = activeChatConversation()) {
  if (!conversation) return false;
  if (isSystemAdminRole()) return true;
  return conversation.createdByUserId === currentUser?.id;
}

async function deleteActiveChatConversation() {
  const conversation = activeChatConversation();
  if (!conversation) {
    showToast("Selecciona un chat.");
    return;
  }
  if (!canDeleteActiveChatConversation(conversation)) {
    showToast("Solo quien creo el chat o Supervision M&E puede eliminarlo.");
    return;
  }
  const confirmed = window.confirm("Este chat se eliminara de la lista activa para todos los participantes. Deseas continuar?");
  if (!confirmed) return;
  stopChatTyping({ conversationId: conversation.id });
  await deleteApiChatConversation(conversation.id);
  chatReplyMessageId = "";
  if (state.chatPresenceByConversation?.[conversation.id]) {
    delete state.chatPresenceByConversation[conversation.id];
  }
  await refreshChatFromApi({ includeMessages: false });
  if (state.chatActiveConversationId === conversation.id) {
    state.chatActiveConversationId = state.chatConversations[0]?.id || "";
  }
  if (state.chatActiveConversationId) {
    await loadChatConversation(state.chatActiveConversationId, { markRead: true });
  }
  renderChatWorkspace();
  showToast("Chat eliminado.");
}

function canRenameActiveChatConversation(conversation = activeChatConversation()) {
  if (!conversation) return false;
  if (conversation.type !== "group") return false;
  if (isSystemAdminRole()) return true;
  return conversation.createdByUserId === currentUser?.id;
}

function canLeaveActiveChatConversation(conversation = activeChatConversation()) {
  if (!conversation) return false;
  return Array.isArray(conversation.participants) && conversation.participants.some((participant) => participant.userId === currentUser?.id);
}

async function renameActiveChatConversation() {
  const conversation = activeChatConversation();
  if (!conversation) {
    showToast("Selecciona un chat.");
    return;
  }
  if (!canRenameActiveChatConversation(conversation)) {
    showToast("Solo quien creo el grupo o Supervision M&E puede renombrarlo.");
    return;
  }
  const nextTitle = window.prompt("Nuevo nombre del grupo:", conversation.title || chatConversationTitle(conversation));
  if (!nextTitle?.trim()) return;
  await updateApiChatConversation(conversation.id, { title: nextTitle.trim() });
  await refreshChatFromApi({ includeMessages: false });
  await loadChatConversation(conversation.id, { markRead: true });
  renderChatWorkspace();
  showToast("Grupo actualizado.");
}

async function leaveActiveChatConversation() {
  const conversation = activeChatConversation();
  if (!conversation) {
    showToast("Selecciona un chat.");
    return;
  }
  if (!canLeaveActiveChatConversation(conversation)) {
    showToast("No puedes salir de este chat.");
    return;
  }
  const confirmed = window.confirm("Saldras de este chat y dejara de aparecer en tu lista activa. Deseas continuar?");
  if (!confirmed) return;
  stopChatTyping({ conversationId: conversation.id });
  await removeApiChatParticipant(conversation.id, currentUser?.id);
  clearChatReplyTarget();
  if (state.chatPresenceByConversation?.[conversation.id]) {
    delete state.chatPresenceByConversation[conversation.id];
  }
  await refreshChatFromApi({ includeMessages: false });
  state.chatActiveConversationId = state.chatConversations[0]?.id || "";
  if (state.chatActiveConversationId) {
    await loadChatConversation(state.chatActiveConversationId, { markRead: true });
  }
  renderChatWorkspace();
  showToast("Saliste del chat.");
}

async function sendCurrentChatMessage() {
  if (chatMessageSendInFlight) return;
  const activeConversation = activeChatConversation();
  const body = String(elements.chatComposerInput?.value || "").trim();
  const selectedFiles = Array.from(chatAttachmentFiles || []);
  if (!activeConversation) {
    showToast("Selecciona una conversacion.");
    return;
  }
  if (!body && !selectedFiles.length) {
    showToast("Escribe un mensaje o adjunta un archivo.");
    return;
  }
  chatMessageSendInFlight = true;
  const submitButton = elements.chatComposerForm?.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
  }
  try {
    const attachments = await attachmentsFromFiles(selectedFiles, currentUser?.email || activeRole(), "chat-attachments");
    const inferredType =
      attachments.length && attachments.every((attachment) => String(attachment.type || "").startsWith("image/")) ? "image" : attachments.length ? "file" : "text";
    stopChatTyping({ conversationId: activeConversation.id });
    await createApiChatMessage(activeConversation.id, {
      messageType: inferredType,
      body,
      replyToMessageId: chatReplyMessageId || "",
      attachments,
    });
    elements.chatComposerInput.value = "";
    if (elements.chatAttachmentInput) {
      elements.chatAttachmentInput.value = "";
    }
    setChatAttachmentFiles([]);
    clearChatReplyTarget();
    await refreshChatFromApi({ includeMessages: true });
    renderChatWorkspace();
    elements.chatComposerInput?.focus();
  } finally {
    chatMessageSendInFlight = false;
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function toggleCurrentChatMessagePin(messageId, shouldPin) {
  const activeConversation = activeChatConversation();
  if (!activeConversation?.id || !messageId) {
    showToast("Selecciona una conversacion valida.");
    return;
  }
  await updateApiChatMessage(activeConversation.id, messageId, {
    isPinned: Boolean(shouldPin),
  });
  await refreshChatFromApi({ includeMessages: true });
  renderChatWorkspace();
  showToast(shouldPin ? "Mensaje fijado." : "Mensaje quitado de fijados.");
}

async function addAttendanceParticipant(name) {
  const participant = {
    id: `attp-${slugify(state.attendanceProgram)}-${Date.now()}`,
    program: state.attendanceProgram,
    name: String(name || "").trim(),
    status: "active",
  };
  if (!participant.name) {
    showToast("Escribe el nombre del participante.");
    return;
  }

  const saved = isApiConfigured() ? await createApiAttendanceParticipant(participant) : participant;
  state.attendanceParticipants = [...(state.attendanceParticipants || []), saved];
  saveState({ preserveAttendanceSnapshot: true });
  renderAttendance();
}

function upsertAttendanceSession(session) {
  const index = (state.attendanceSessions || []).findIndex(
    (item) =>
      item.program === session.program &&
      item.weekStart === session.weekStart &&
      (item.center || "General") === (session.center || "General") &&
      (item.period || item.weekStart?.slice(0, 7)) === (session.period || session.weekStart?.slice(0, 7)),
  );
  if (index >= 0) state.attendanceSessions[index] = session;
  else state.attendanceSessions = [session, ...(state.attendanceSessions || [])];
  saveState();
}

async function saveCurrentAttendance() {
  const entries = attendanceEntriesFromChecklist().map((entry) => ({
    participantId: entry.participantId,
    name: entry.name,
    status: attendanceEntryStatus(entry),
    present: attendanceEntryStatus(entry) === "present",
  }));
  const session = {
    id: `atts-${slugify(state.attendanceProgram)}-${slugify(attendanceCenterValue())}-${attendancePeriodValue()}-${state.attendanceWeek}`,
    program: state.attendanceProgram,
    weekStart: state.attendanceWeek,
    center: attendanceCenterValue(),
    period: attendancePeriodValue(),
    entries,
    notes: elements.attendanceNotes.value,
    recordedBy: currentUser?.email || currentUser?.fullName || activeRole(),
    actorId: currentUser?.id || currentUser?.email || `local-${slugify(activeRole())}`,
    actorRole: activeRole(),
  };
  const saved = isApiConfigured() ? await saveApiAttendanceSession(session) : session;
  upsertAttendanceSession({ ...saved, locked: saved.locked ?? true });
  if (isApiConfigured()) {
    const conversation = await ensureContextChatConversation({
      title: `Asistencia · ${state.attendanceProgram}`,
      description: `Seguimiento operativo de asistencia para ${state.attendanceProgram}.`,
      contextType: "attendance",
      contextId: `attendance-${slugify(state.attendanceProgram)}`,
      participantUserIds: activeOrganizationParticipantIds(),
    });
    const presentCount = entries.filter((entry) => entry.status === "present").length;
    const excusedCount = entries.filter((entry) => entry.status === "excused").length;
    const absentCount = entries.filter((entry) => entry.status === "absent").length;
    await sendAutomatedChatMessage(
      conversation.id,
      `${currentUser?.fullName || activeRole()} actualizo asistencia de ${state.attendanceProgram} para ${state.attendanceWeek} en ${attendanceCenterValue()}: ${presentCount} presentes, ${excusedCount} excusas y ${absentCount} ausentes.`,
    );
  }
  renderAttendance();
}

async function requestAttendanceEdit(note) {
  const cleanNote = String(note || "").trim();
  if (!cleanNote) {
    showToast("Escribe la razon de la correccion.");
    return;
  }
  const payload = {
    id: `atts-${slugify(state.attendanceProgram)}-${slugify(attendanceCenterValue())}-${attendancePeriodValue()}-${state.attendanceWeek}`,
    program: state.attendanceProgram,
    weekStart: state.attendanceWeek,
    center: attendanceCenterValue(),
    period: attendancePeriodValue(),
    editRequest: { note: cleanNote },
    editRequestNote: cleanNote,
    recordedBy: currentUser?.email || currentUser?.fullName || activeRole(),
    actorId: currentUser?.id || currentUser?.email || `local-${slugify(activeRole())}`,
    actorRole: activeRole(),
  };
  const saved = isApiConfigured() ? await saveApiAttendanceSession(payload) : { ...attendanceSessionFor(), editRequest: payload.editRequest };
  upsertAttendanceSession(saved);
  renderAttendance();
}

function attendanceAdminPayload() {
  return actorPayload();
}

function archiveAttendanceLocally(type, data, reason = "") {
  state.attendanceArchive = [
    {
      id: `local-atta-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type,
      program: data?.program || data?.participant?.program || state.attendanceProgram,
      center: data?.center || attendanceCenterValue(),
      period: data?.period || attendancePeriodValue(),
      weekStart: data?.weekStart || null,
      deletedAt: new Date().toISOString(),
      deletedBy: currentUser?.email || currentUser?.fullName || activeRole(),
      deletedByRole: activeRole(),
      reason,
      data,
    },
    ...(state.attendanceArchive || []),
  ];
}

async function deleteAttendanceParticipantById(participantId) {
  if (!isSystemAdminRole()) {
    showToast("Solo Supervision M&E puede eliminar participantes.");
    return;
  }
  if (isApiConfigured()) {
    await deleteApiAttendanceParticipant(participantId, attendanceAdminPayload());
  }
  const participant = (state.attendanceParticipants || []).find((item) => item.id === participantId);
  const affectedSessions = (state.attendanceSessions || [])
    .map((session) => ({ ...session, entries: (session.entries || []).filter((entry) => entry.participantId === participantId) }))
    .filter((session) => session.entries.length);
  archiveAttendanceLocally("participant", { participant, affectedSessions }, "Eliminado desde la interfaz de asistencia.");
  state.attendanceParticipants = (state.attendanceParticipants || []).filter((participant) => participant.id !== participantId);
  state.attendanceSessions = (state.attendanceSessions || []).map((session) => ({
    ...session,
    entries: (session.entries || []).filter((entry) => entry.participantId !== participantId),
  }));
  saveState({ preserveAttendanceSnapshot: true });
  renderAttendance();
}

async function clearAttendanceParticipantsForCurrentProgram() {
  if (!isSystemAdminRole()) {
    showToast("Solo Supervision M&E puede eliminar participantes.");
    return;
  }
  const program = state.attendanceProgram;
  if (isApiConfigured()) {
    await deleteApiAttendanceParticipants({ program }, { ...attendanceAdminPayload(), program });
  }
  const deletedParticipants = (state.attendanceParticipants || []).filter((participant) => participant.program === program);
  const affectedSessions = (state.attendanceSessions || []).filter(
    (session) => session.program === program && (session.entries || []).some((entry) => deletedParticipants.some((participant) => participant.id === entry.participantId)),
  );
  archiveAttendanceLocally("program-participants", { program, participants: deletedParticipants, affectedSessions }, "Nombres del programa eliminados.");
  const deletedIds = new Set(
    (state.attendanceParticipants || []).filter((participant) => participant.program === program).map((participant) => participant.id),
  );
  state.attendanceParticipants = (state.attendanceParticipants || []).filter((participant) => participant.program !== program);
  state.attendanceSessions = (state.attendanceSessions || []).map((session) =>
    session.program === program
      ? { ...session, entries: (session.entries || []).filter((entry) => !deletedIds.has(entry.participantId)) }
      : session,
  );
  saveState({ preserveAttendanceSnapshot: true });
  renderAttendance();
}

async function deleteCurrentAttendanceSession() {
  if (!isSystemAdminRole()) {
    showToast("Solo Supervision M&E puede eliminar sesiones.");
    return;
  }
  const filters = {
    program: state.attendanceProgram,
    weekStart: state.attendanceWeek,
    center: attendanceCenterValue(),
    period: attendancePeriodValue(),
  };
  if (isApiConfigured()) {
    await deleteApiAttendanceSession(filters, attendanceAdminPayload());
  }
  const sessionToDelete = attendanceSessionFor(filters.program, filters.weekStart, filters.center, filters.period);
  archiveAttendanceLocally("session", sessionToDelete, "Sesion eliminada desde la interfaz de asistencia.");
  state.attendanceSessions = (state.attendanceSessions || []).filter(
    (session) =>
      !(
        session.program === filters.program &&
        session.weekStart === filters.weekStart &&
        (session.center || "General") === filters.center &&
        (session.period || session.weekStart?.slice(0, 7)) === filters.period
      ),
  );
  saveState({ preserveAttendanceSnapshot: true });
  renderAttendance();
}

async function resetCurrentAttendanceProgram() {
  if (!isSystemAdminRole()) {
    showToast("Solo Supervision M&E puede reiniciar asistencia.");
    return;
  }
  const program = state.attendanceProgram;
  if (isApiConfigured()) {
    await resetApiAttendanceProgram({ program }, { ...attendanceAdminPayload(), program, reason: "Reinicio operativo del programa." });
  }
  const deletedParticipants = (state.attendanceParticipants || []).filter((participant) => participant.program === program);
  const deletedSessions = (state.attendanceSessions || []).filter((session) => session.program === program);
  archiveAttendanceLocally(
    "program-reset",
    { program, participants: deletedParticipants, sessions: deletedSessions },
    "Reinicio operativo del programa.",
  );
  state.attendanceParticipants = (state.attendanceParticipants || []).filter((participant) => participant.program !== program);
  state.attendanceSessions = (state.attendanceSessions || []).filter((session) => session.program !== program);
  saveState({ preserveAttendanceSnapshot: true });
  renderAttendance();
}

function correctionRoleForReport(report) {
  if (report.status === REPORT_STATUSES.PENDING_PROGRAM_MANAGER) return "Coordinador de programa";
  if (report.status === REPORT_STATUSES.PENDING_MEL) return "Program Manager";
  return "Facilitador";
}

async function saveReviewDecision(report, nextStatus, note = "") {
  const payload = {
    status: nextStatus,
    actorId: currentUser?.id || currentUser?.email || `local-${slugify(activeRole())}`,
    actorRole: activeRole(),
    note,
  };

  if (isApiConfigured()) {
    await updateApiReportStatus(report.id, payload);
    await refreshReportsAndNotificationsFromApi();
    return;
  }

  const previousStatus = report.status;
  report.status = nextStatus;
  report.reviewNote = note || null;
  report.correctionForRole =
    nextStatus === REPORT_STATUSES.NEEDS_CORRECTION ? correctionRoleForReport({ status: previousStatus }) : null;
  state.notifications = (state.notifications || []).filter((notification) => notification.reportId !== report.id);
  state.notifications =
    nextStatus === REPORT_STATUSES.NEEDS_CORRECTION
      ? [
          {
            id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            reportId: report.id,
            program: report.program,
            recipientRole: report.correctionForRole,
            title: `Correccion solicitada: ${report.program}`,
            message: note,
            status: "unread",
            priority: "high",
            createdAt: new Date().toISOString(),
          },
          ...state.notifications,
        ]
      : [...createLocalReviewNotifications(report), ...state.notifications];
  saveState();
}

async function deleteReportFromUi(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    showToast("No encontre el reporte.");
    return;
  }
  if (!canDeleteReport(report)) {
    showToast("No tienes permiso para eliminar este reporte.");
    return;
  }

  const supervisorDelete = isSystemAdminRole();
  const confirmed = window.confirm(
    supervisorDelete
      ? report.status === REPORT_STATUSES.APPROVED
        ? "Este reporte aprobado se eliminara de la lista activa, quedara registrado en auditoria y recalculara el cumplimiento del programa. Deseas continuar?"
        : "Este reporte se eliminara de la lista activa y quedara registrado en auditoria. Deseas continuar?"
      : "Este reporte se eliminara para que puedas subirlo nuevamente corregido. Deseas continuar?",
  );
  if (!confirmed) return;
  const deletionNote = supervisorDelete
    ? "Reporte eliminado por supervision desde la administracion."
    : "Reporte eliminado para subir una version corregida.";

  try {
    if (isApiConfigured()) {
      await deleteApiReport(reportId, {
        actorId: currentUser?.id || currentUser?.email || `local-${slugify(activeRole())}`,
        actorRole: activeRole(),
        note: deletionNote,
      });
      await refreshReportsAndNotificationsFromApi();
    } else {
      state.reports = state.reports.filter((item) => item.id !== reportId);
      state.notifications = (state.notifications || []).filter((notification) => notification.reportId !== reportId);
      saveState();
    }
    activeStatusReportId = null;
    renderAll();
    showToast(supervisorDelete ? "Reporte eliminado y registrado en auditoria." : "Reporte eliminado. Ya puedes subirlo nuevamente corregido.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude eliminar el reporte.");
  }
}

function botSummaryForDraft(report, formTitle = "Formulario") {
  const indicator = indicatorById(report.indicatorId);
  const fragments = [
    `${formTitle} leido para ${report.program}.`,
    `Indicador detectado: ${indicator?.name || report.indicatorId}.`,
    `Valor: ${Number(report.value || 0).toLocaleString("es-DO")}.`,
    report.notes ? `Observacion base: ${report.notes}.` : "",
  ].filter(Boolean);
  return fragments.join(" ");
}

function clearReportDrafts() {
  state.reportDrafts = [];
  saveState();
  renderAll();
}

function applyDraftToReportForm(draft) {
  const indicator = indicatorById(draft.indicatorId);
  elements.reportProgram.value = draft.program;
  const indicators = state.indicators.filter((item) => item.program === draft.program);
  setOptions(elements.reportIndicator, indicators.map((item) => item.name), indicator?.name || indicators[0]?.name);
  elements.reportProvince.value = draft.province || "Centros de programa";
  syncReportCaptureOptions();
  if (draft.center) {
    elements.reportCenter.value = draft.center;
  }
  elements.reportPeriod.value = draft.period || currentMonth();
  document.querySelector("#reportOwner").value = draft.owner || "";
  document.querySelector("#reportValue").value = draft.value || 0;
  const participantBreakdown = buildParticipantBreakdown(draft, draft.program);
  if (elements.reportWomenInput) elements.reportWomenInput.value = participantBreakdown.women || 0;
  if (elements.reportMenInput) elements.reportMenInput.value = participantBreakdown.men || 0;
  if (elements.reportAdolescentsInput) elements.reportAdolescentsInput.value = participantBreakdown.adolescents || 0;
  if (elements.reportChildrenInput) elements.reportChildrenInput.value = participantBreakdown.children || 0;
  if (elements.reportEvidenceType) elements.reportEvidenceType.value = "note";
  if (elements.reportEvidenceNoteInput) elements.reportEvidenceNoteInput.value = draft.evidence || "";
  if (elements.reportEvidenceLinkInput) elements.reportEvidenceLinkInput.value = "";
  if (elements.reportFormUploadInput) elements.reportFormUploadInput.value = "";
  document.querySelector("#reportNotes").value = draft.botSummary || draft.notes || "";
  syncReportParticipantInputs(draft.program);
  syncEvidenceInputMode();
}

function renderReportDrafts() {
  if (!elements.reportDraftList) return;
  const drafts = state.reportDrafts || [];
  elements.reportDraftList.innerHTML = drafts.length
    ? drafts
        .map(
          (draft, index) => `
            <article class="draft-item">
              <div class="draft-top">
                <div>
                  <h3>${draft.program}</h3>
                  <p class="item-meta">${draft.formTitle || "Formulario"} · ${draft.period} · ${draft.sourceFileName}</p>
                </div>
                <span class="status-pill info">${indicatorById(draft.indicatorId)?.name || "Indicador"}</span>
              </div>
              <p>${draft.botSummary}</p>
              <div class="coverage">
                <span>Valor ${Number(draft.value || 0).toLocaleString("es-DO")}</span>
                <span>${draft.owner || "Sin responsable"}</span>
                <span>${[draft.province || "Centros de programa", draft.center].filter(Boolean).join(" · ")}</span>
              </div>
              <div class="item-actions">
                <button type="button" data-apply-draft="${index}">Cargar en captura</button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<p class="item-meta">Sube un formulario del sistema y el asistente preparara borradores de reporte aqui.</p>`;
}

function buildDraftsFromImportedRows(rows, fileName, sourceAttachment = null) {
  const { form, reports, submissionId } = rowsToReports(rows, fileName);
  const drafts = reports.map((report, index) => ({
    ...report,
    attachments: sourceAttachment
      ? [{ ...sourceAttachment, id: `${sourceAttachment.id}-${index + 1}` }]
      : report.attachments || [],
    sourceFileName: fileName,
    formTitle: form.title,
    submissionId,
    botSummary: botSummaryForDraft(report, form.title),
  }));
  return { form, drafts, submissionId };
}

function uniqueSubmissionAttachments(attachments = []) {
  const seen = new Set();
  return (attachments || []).filter((attachment) => {
    if (!attachment) return false;
    const key = [attachment.path || "", attachment.fileUrl || "", attachment.dataUrl || "", attachment.name || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFormSubmissionRecord({
  id,
  fileName,
  formId = null,
  formTitle = "",
  program = "",
  period = currentMonth(),
  reportCount = 0,
  sourceType = "csv",
  processing = "automatico",
  reportIds = [],
  attachments = [],
}) {
  return {
    id: id || `sub-${Date.now()}`,
    companyId: currentUser?.organizationId || "org-convoy-of-hope",
    organizationId: currentUser?.organizationId || "org-convoy-of-hope",
    organizationName: currentUser?.organizationName || "Convoy of Hope",
    fileName: fileName || "formulario.csv",
    formId,
    sourceFormId: formId,
    formTitle: formTitle || fileName || "Formulario importado",
    program,
    period,
    reportCount,
    importedAt: new Date().toISOString(),
    sourceType,
    processing,
    reportIds: Array.isArray(reportIds) ? reportIds.filter(Boolean) : [],
    attachments: uniqueSubmissionAttachments(attachments),
    importedBy: currentUser?.email || currentUser?.fullName || activeRole(),
    importedByRole: activeRole(),
  };
}

function upsertLocalFormSubmission(submission) {
  const nextSubmission = {
    ...submission,
    attachments: uniqueSubmissionAttachments(submission.attachments || []),
  };
  state.formSubmissions = [
    nextSubmission,
    ...(state.formSubmissions || []).filter((item) => item.id !== nextSubmission.id),
  ];
}

function analyzeReportFormFile(file) {
  if (!file) {
    showToast("Selecciona un formulario para leer.");
    return;
  }

  const extension = fileExtension(file.name);
  if (extension !== "csv") {
    elements.reportUploadStatus.textContent = "Soporte";
    elements.reportUploadStatus.className = "status-pill warning";
    elements.reportUploadPreview.innerHTML = `<p class="item-meta">${file.name} se puede guardar como soporte, pero el autocompletado automatico funciona con CSV descargados desde Formularios.</p>`;
    state.reportDrafts = [];
    saveState();
    renderReportDrafts();
    showToast("Para autocompletar reportes, usa el CSV del sistema.");
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const rows = parseCsv(String(reader.result || ""));
      const sourceAttachment = await attachmentFromFile(file, activeRole());
      const { drafts } = buildDraftsFromImportedRows(rows, file.name, sourceAttachment);
      if (!drafts.length) {
        throw new Error("El formulario fue leido, pero no encontre datos que puedan alimentar la captura.");
      }
      state.reportDrafts = drafts;
      saveState();
      renderReportDrafts();
      elements.reportUploadStatus.textContent = `${drafts.length} borradores`;
      elements.reportUploadStatus.className = "status-pill good";
      elements.reportUploadPreview.innerHTML = `<p class="item-meta">El asistente leyo ${file.name} y preparo ${drafts.length} borradores para la captura de actividades y metricas.</p>`;
      applyDraftToReportForm(drafts[0]);
      showToast("Formulario leido y captura autocompletada.");
    } catch (error) {
      elements.reportUploadStatus.textContent = "Error";
      elements.reportUploadStatus.className = "status-pill danger";
      elements.reportUploadPreview.innerHTML = `<p class="item-meta">${error.message}</p>`;
      state.reportDrafts = [];
      saveState();
      renderReportDrafts();
      showToast("No pude leer ese formulario.");
    }
  };
  reader.readAsText(file);
}

async function submitDraftReports() {
  const drafts = state.reportDrafts || [];
  if (!drafts.length) {
    showToast("No hay borradores listos para enviar.");
    return;
  }

  const reportsToSubmit = drafts.map((draft) => ({
      ...draft,
      botSummary: undefined,
      formTitle: undefined,
      sourceFileName: undefined,
  }));
  const sourceAttachments = uniqueSubmissionAttachments(
    drafts.flatMap((draft) => (Array.isArray(draft.attachments) ? draft.attachments.slice(0, 1) : [])),
  );
  const submissionRecord = buildFormSubmissionRecord({
    id: drafts[0].submissionId || `sub-${Date.now()}`,
    fileName: drafts[0].sourceFileName || "formulario.csv",
    formId: drafts[0].sourceFormId || null,
    formTitle: drafts[0].formTitle || "Formulario importado",
    program: drafts[0].program,
    period: drafts[0].period,
    reportCount: drafts.length,
    sourceType: "csv",
    processing: "automatico",
    reportIds: reportsToSubmit.map((report) => report.id),
    attachments: sourceAttachments,
  });

  try {
    if (isApiConfigured()) {
      await createApiReportsBulk(reportsToSubmit);
      await createApiFormSubmission(submissionRecord);
      await refreshReportsAndNotificationsFromApi();
    } else {
      reportsToSubmit.forEach((report) => queueReportForReview(report));
      upsertLocalFormSubmission(submissionRecord);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude enviar los reportes a la API.");
    return;
  }

  state.reportDrafts = [];
  saveState();
  renderAll();
  switchView("supervision");
  elements.reportUploadStatus.textContent = "Enviados";
  elements.reportUploadStatus.className = "status-pill good";
  elements.reportUploadPreview.innerHTML = `<p class="item-meta">${drafts.length} borradores fueron enviados a la cadena de revision.</p>`;
  showToast("Borradores enviados a revision.");
}

async function addReport(formData) {
  const indicator = state.indicators.find((item) => item.name === formData.get("indicator"));
  if (!indicator) {
    showToast("Selecciona un indicador valido.");
    return false;
  }
  const value = Number(formData.get("value"));
  const selectedCenter = String(formData.get("center") || "").trim();
  if (!selectedCenter || selectedCenter === NO_CENTER_OPTION) {
    showToast("Selecciona un centro registrado para ese programa y provincia.");
    return false;
  }
  const evidenceType = String(formData.get("evidenceType") || "note").trim();
  const evidenceDetail = selectedEvidenceDetail();
  const participantBreakdown = buildParticipantBreakdown(
    {
      program: formData.get("program"),
      women: formData.get("women"),
      men: formData.get("men"),
      adolescents: formData.get("adolescents"),
      children: formData.get("children"),
    },
    formData.get("program"),
  );
  const attachedFiles = Array.from(elements.reportFormUploadInput.files || []);
  let attachedDocuments = [];
  try {
    attachedDocuments = await attachmentsFromFiles(attachedFiles, formData.get("owner"));
  } catch (error) {
    showToast(error.message || "No pude adjuntar el documento.");
    return false;
  }
  if (evidenceType === "link" && evidenceDetail && !/^https?:\/\//i.test(evidenceDetail)) {
    showToast("Cuando la evidencia sea un enlace, pega una URL valida que empiece con http:// o https://.");
    return false;
  }
  if ((evidenceType === "photo" || evidenceType === "file") && !attachedDocuments.length) {
    showToast("Adjunta al menos un archivo cuando la evidencia sea foto o archivo.");
    return false;
  }
  const newReport = {
    id: `rep-${Date.now()}`,
    companyId: currentUser?.organizationId || "org-convoy-of-hope",
    organizationId: currentUser?.organizationId || "org-convoy-of-hope",
    organizationName: currentUser?.organizationName || "Convoy of Hope",
    date: new Date().toISOString().slice(0, 10),
    period: formData.get("period"),
    program: formData.get("program"),
    programId: state.programs.find((program) => program.name === formData.get("program"))?.id || null,
    province: formData.get("province"),
    center: selectedCenter,
    indicatorId: indicator.id,
    value,
    women: participantBreakdown.women,
    men: participantBreakdown.men,
    adolescents: participantBreakdown.adolescents,
    children: participantBreakdown.children,
    youth: participantBreakdown.adolescents,
    participantBreakdown,
    owner: formData.get("owner"),
    ownerUserId: currentUser?.id || null,
    ownerEmail: currentUser?.email || "",
    evidence: buildEvidenceSummary(evidenceType, evidenceDetail, attachedDocuments),
    notes: formData.get("notes"),
    attachments: attachedDocuments,
    status: REPORT_STATUSES.PENDING_COORDINATION,
  };

  try {
    if (isApiConfigured()) {
      await createApiReport(newReport);
      await refreshReportsAndNotificationsFromApi();
    } else {
      queueReportForReview(newReport);
      saveState();
    }
    renderAll();
    showToast(attachedDocuments.length ? "Reporte y evidencias enviadas a revision." : "Reporte enviado a coordinacion para primera aprobacion.");
    return true;
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude guardar el reporte en la API.");
    return false;
  }
}

function exportCsv() {
  const rows = [
    ["fecha", "periodo", "programa", "provincia", "centro", "indicador", "valor", "mujeres", "hombres", "adolescentes", "niños", "responsable", "estado"],
    ...state.reports.map((report) => [
      report.date,
      report.period,
      report.program,
      report.province,
      report.center || "",
      indicatorById(report.indicatorId)?.name ?? "",
      report.value,
      reportParticipantValue(report, "women"),
      reportParticipantValue(report, "men"),
      reportParticipantValue(report, "adolescents"),
      reportParticipantValue(report, "children"),
      report.owner,
      report.status,
    ]),
  ];
  downloadCsv(rows, "pulso-me-reportes.csv");
  showToast("Archivo CSV preparado.");
}

function csvFromRows(rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  return csv;
}

function downloadCsv(rows, fileName) {
  const csv = csvFromRows(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formRows(form) {
  const automaticIndicators = (form.mappings || [])
    .map((mapping) => indicatorById(mapping.indicatorId)?.name)
    .filter(Boolean)
    .join(" | ");

  return [
    ["formulario_id", form.id],
    ["programa", form.program],
    ["formulario", form.title],
    ["tipo", form.type],
    ["frecuencia", form.frequency],
    ["responsable", form.owner],
    ["indicadores_automaticos", automaticIndicators],
    [],
    ["fecha", "periodo", "provincia", "responsable", "evidencia", "observaciones", ...form.fields],
    [new Date().toISOString().slice(0, 10), currentMonth(), "", "", "", "", ...form.fields.map(() => "")],
  ];
}

function buildPrintableTemplate(form) {
  const rows = form.fields
    .map(
      (field) => `
        <tr>
          <td>${escapeHtml(field)}</td>
          <td></td>
        </tr>
      `,
    )
    .join("");

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(form.title)}</title>
        <style>
          body {
            color: #14201f;
            font-family: "Georgia", "Times New Roman", serif;
            margin: 32px;
          }
          h1, h2, p { margin-top: 0; }
          .meta {
            display: grid;
            gap: 8px;
            margin: 18px 0 24px;
          }
          .meta span {
            background: #f4f6f5;
            border: 1px solid #dfe6e4;
            display: inline-block;
            padding: 8px 10px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            border: 1px solid #dfe6e4;
            padding: 12px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background: #eef3f1;
          }
          td:last-child {
            height: 44px;
          }
        </style>
      </head>
      <body>
        <p>Formulario de recoleccion</p>
        <h1>${escapeHtml(form.title)}</h1>
        <div class="meta">
          <span>Programa: ${escapeHtml(form.program)}</span>
          <span>Tipo: ${escapeHtml(form.type)}</span>
          <span>Frecuencia: ${escapeHtml(form.frequency)}</span>
          <span>Responsable: ${escapeHtml(form.owner)}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Campo</th>
              <th>Respuesta</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((csvRow) => csvRow.some((value) => String(value).trim()));
}

function metadataFromRows(rows) {
  const metadata = {};
  rows.forEach((row) => {
    const key = String(row[0] || "").trim().toLowerCase();
    if (["formulario_id", "programa", "formulario", "tipo", "frecuencia", "responsable"].includes(key)) {
      metadata[key] = String(row[1] || "").trim();
    }
  });
  return metadata;
}

function parseMetricValue(rawValue, mode) {
  const value = String(rawValue || "").trim();
  if (!value) return 0;

  if (mode === "number") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  const normalized = value.toLowerCase();
  if (["no", "n/a", "na", "ninguno", "ninguna", "0"].includes(normalized)) {
    return 0;
  }

  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 1;
}

function rowsToReports(rows, fileName) {
  const metadata = metadataFromRows(rows);
  const form = state.monitoringForms.find((item) => item.id === metadata.formulario_id || item.title === metadata.formulario);
  if (!form) {
    throw new Error("No pude identificar el formulario. Descarga una plantilla nueva desde el sistema.");
  }

  const headerIndex = rows.findIndex((row) => String(row[0] || "").trim().toLowerCase() === "fecha");
  if (headerIndex === -1) {
    throw new Error("El archivo no tiene la fila de encabezados de captura.");
  }

  const headers = rows[headerIndex].map((header) => String(header || "").trim());
  const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell || "").trim()));
  const reports = [];
  const submissionId = `sub-${Date.now()}`;
  const participantFields = reportParticipantFieldsForProgram(form.program);

  dataRows.forEach((row, rowIndex) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] || "";
    });

    (form.mappings || []).forEach((mapping) => {
      const indicator = indicatorById(mapping.indicatorId);
      const value = parseMetricValue(record[mapping.field], mapping.mode);
      if (!indicator || value <= 0) return;

      const participantBreakdown = buildParticipantBreakdown(
        {
          program: form.program,
          adolescents: participantFields.includes("adolescents") ? value : 0,
          children: 0,
          women: participantFields.includes("women") ? value : 0,
          men: 0,
        },
        form.program,
      );

      reports.push({
        id: `rep-${Date.now()}-${rowIndex}-${mapping.indicatorId}`,
        date: record.fecha || new Date().toISOString().slice(0, 10),
        period: record.periodo || currentMonth(),
        program: form.program,
        province: record.provincia || "Centros de programa",
        center: record.centro || "",
        indicatorId: indicator.id,
        value,
        women: participantBreakdown.women,
        men: participantBreakdown.men,
        adolescents: participantBreakdown.adolescents,
        children: participantBreakdown.children,
        youth: participantBreakdown.adolescents,
        participantBreakdown,
        owner: record.responsable || metadata.responsable || form.owner,
        ownerUserId: currentUser?.id || null,
        ownerEmail: currentUser?.email || "",
        evidence: record.evidencia || fileName,
        notes: record.observaciones || `${form.title}: ${mapping.field}`,
        status: REPORT_STATUSES.PENDING_COORDINATION,
        sourceFormId: form.id,
        submissionId,
      });
    });
  });

  return { form, reports, submissionId };
}

function importCompletedForm(file) {
  if (!file) {
    showToast("Selecciona un archivo.");
    return;
  }

  const extension = fileExtension(file.name);
  if (["pdf", "doc", "docx", "xls", "xlsx"].includes(extension)) {
    const selectedProgram = selectedFormsProgram();
    void (async () => {
      try {
        const supportAttachment = await attachmentFromFile(file, activeRole());
        const submissionRecord = buildFormSubmissionRecord({
          fileName: file.name,
          formId: null,
          formTitle: "Archivo de soporte",
          program: selectedProgram.name,
          period: currentMonth(),
          reportCount: 0,
          sourceType: extension,
          processing: "soporte",
          attachments: supportAttachment ? [supportAttachment] : [],
        });
        if (isApiConfigured()) {
          await createApiFormSubmission(submissionRecord);
          await refreshReportsAndNotificationsFromApi();
        } else {
          upsertLocalFormSubmission(submissionRecord);
        }
        saveState();
        renderAll();
        elements.uploadStatus.textContent = "Soporte cargado";
        elements.uploadStatus.className = "status-pill info";
        elements.uploadPreview.innerHTML = `<p class="item-meta">${file.name} fue subido como soporte. Para alimentar graficas automaticamente, usa la plantilla CSV del sistema.</p>`;
        showToast("Archivo subido como soporte.");
      } catch (error) {
        elements.uploadStatus.textContent = "Error";
        elements.uploadStatus.className = "status-pill danger";
        elements.uploadPreview.innerHTML = `<p class="item-meta">${error.message}</p>`;
        showToast(error.message || "No pude subir el archivo de soporte.");
      }
    })();
    return;
  }

  if (extension !== "csv") {
    elements.uploadStatus.textContent = "Formato no valido";
    elements.uploadStatus.className = "status-pill danger";
    elements.uploadPreview.innerHTML = `<p class="item-meta">Usa CSV para carga automatica o sube PDF, Word o Excel como soporte.</p>`;
    showToast("Ese formato no esta disponible.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    void (async () => {
    try {
      const rows = parseCsv(String(reader.result || ""));
      const sourceAttachment = await attachmentFromFile(file, activeRole());
      const { form, reports, submissionId } = rowsToReports(rows, file.name);

      if (!reports.length) {
        elements.uploadPreview.innerHTML = `<p class="item-meta">El formulario fue leido, pero no encontre valores que alimenten indicadores.</p>`;
        showToast("No se importaron indicadores.");
        return;
      }

      const submissionRecord = buildFormSubmissionRecord({
        id: submissionId,
        fileName: file.name,
        formId: form.id,
        formTitle: form.title,
        program: form.program,
        period: reports[0].period,
        reportCount: reports.length,
        sourceType: extension,
        processing: "automatico",
        reportIds: reports.map((report) => report.id),
        attachments: sourceAttachment ? [sourceAttachment] : [],
      });

      if (isApiConfigured()) {
        await createApiReportsBulk(reports);
        await createApiFormSubmission(submissionRecord);
        await refreshReportsAndNotificationsFromApi();
      } else {
        reports.forEach((report) => {
          queueReportForReview(report);
        });
        upsertLocalFormSubmission(submissionRecord);
      }
      state.filters.period = reports[0].period;
      saveState();
      renderAll();
      switchView("supervision");
      elements.uploadStatus.textContent = `${reports.length} registros`;
      elements.uploadStatus.className = "status-pill good";
      elements.uploadPreview.innerHTML = `<p class="item-meta">${reports.length} registros importados desde ${file.name}. Ya entraron a la cadena de revision y alimentaran la analitica cuando M&E apruebe.</p>`;
      showToast("Formulario subido y enviado a revision.");
    } catch (error) {
      elements.uploadStatus.textContent = "Error";
      elements.uploadStatus.className = "status-pill danger";
      elements.uploadPreview.innerHTML = `<p class="item-meta">${error.message}</p>`;
      showToast("No pude importar el formulario.");
    }
    })();
  };
  reader.readAsText(file);
}

function downloadFormTemplate(formId) {
  const form = state.monitoringForms.find((item) => item.id === formId);
  if (!form) return;
  downloadCsv(formRows(form), `${slugify(form.title)}.csv`);
  showToast("Formulario preparado para descarga.");
}

function downloadWordTemplate(formId) {
  const form = state.monitoringForms.find((item) => item.id === formId);
  if (!form) return;

  const blob = new Blob([buildPrintableTemplate(form)], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(form.title)}.doc`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Formulario Word preparado.");
}

function downloadPdfTemplate(formId) {
  const form = state.monitoringForms.find((item) => item.id === formId);
  if (!form) return;

  const pdfWindow = window.open("", "_blank", "width=980,height=720");
  if (!pdfWindow) {
    showToast("Activa las ventanas emergentes para guardar el PDF.");
    return;
  }

  pdfWindow.document.write(buildPrintableTemplate(form));
  pdfWindow.document.close();
  pdfWindow.focus();
  window.setTimeout(() => {
    pdfWindow.print();
  }, 250);
  showToast("Se abrio la vista para guardar en PDF.");
}

function downloadAllForms() {
  const program = selectedFormsProgram();
  const forms = state.monitoringForms.filter((form) => form.program === program.name);
  const rows = forms.flatMap((form, index) => [...(index ? [[""]] : []), ...formRows(form)]);

  if (!rows.length) {
    showToast("No hay formularios para descargar.");
    return;
  }

  downloadCsv(rows, `${slugify(program.name)}-formularios.csv`);
  showToast("Formularios preparados para descarga.");
}

async function createIndicatorsFromProgram() {
  const program = selectedDesignProgram();
  const existingNames = new Set(state.indicators.map((indicator) => indicator.name));
  const suggestions = buildSuggestedIndicators(program).filter((indicator) => !existingNames.has(indicator.name));

  for (const indicator of suggestions) {
    const payload = {
      id: `ind-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      program: program.name,
      programId: program.id || null,
      name: indicator.name,
      target: indicator.target,
      value: 0,
      unit: indicator.unit,
    owner: indicator.owner,
    due: indicator.due,
    type: "Logro",
    ...actorPayload(),
  };
    const saved = isApiConfigured() ? await createApiIndicator(payload) : payload;
    upsertById(state.indicators, saved);
  }

  saveState();
  renderAll();
  showToast(suggestions.length ? `${suggestions.length} indicadores creados para ${program.name}.` : "Los indicadores sugeridos ya existen.");
}

function createFormTemplate(type) {
  const program = selectedFormsProgram();
  const isEvaluation = type === "Evaluacion";
  const title = isEvaluation ? `Evaluacion de resultados - ${program.name}` : `Monitoreo operativo - ${program.name}`;
  const fields = isEvaluation
    ? [
        "Resultado esperado evaluado",
        "Cambio observado en participantes",
        "Evidencia cualitativa",
        "Comparacion contra linea base",
        "Factores que facilitaron o limitaron el resultado",
        "Recomendaciones para el siguiente periodo",
      ]
    : [
        "Actividad realizada",
        "Comunidad o punto de servicio",
        "Participantes según desglose del programa",
        "Indicador asociado",
        "Evidencia disponible",
        "Alertas, riesgos o necesidades",
      ];

  state.monitoringForms.unshift({
    id: `form-${Date.now()}`,
    program: program.name,
    type,
    title,
    frequency: isEvaluation ? "Trimestral" : "Mensual",
    owner: isEvaluation ? "Equipo M&E" : "Facilitador o coordinador",
    fields,
  });
  saveState();
  renderAll();
  showToast(`Formulario de ${type.toLowerCase()} creado.`);
}

function notificationsForActiveRole() {
  const role = activeRole();
  if (role === "Facilitador") return [];
  return (state.notifications || [])
    .filter((notification) => {
      if (notification.status === "read") return false;
      return notification.recipientRole === role;
    })
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function resetIndicatorForm() {
  elements.indicatorCrudForm.reset();
  elements.indicatorIdInput.value = "";
  elements.indicatorProgramInput.value = selectedProgramForIndicatorForm()?.name || state.programs[0]?.name || "";
  elements.indicatorUnitInput.value = "unidades";
  elements.indicatorOwnerInput.value = "Equipo M&E";
  elements.indicatorDueInput.value = "2026-12";
}

function fillIndicatorForm(indicator) {
  elements.indicatorIdInput.value = indicator.id;
  elements.indicatorProgramInput.value = indicator.program;
  elements.indicatorNameInput.value = indicator.name;
  elements.indicatorTargetInput.value = indicator.target;
  elements.indicatorUnitInput.value = indicator.unit;
  elements.indicatorOwnerInput.value = indicator.owner;
  elements.indicatorDueInput.value = indicator.due;
}

async function saveIndicatorFromForm(formData) {
  const indicatorId = formData.get("id");
  const payload = {
    id: indicatorId || undefined,
    program: formData.get("program"),
    programId: state.programs.find((program) => program.name === formData.get("program"))?.id || null,
    name: formData.get("name"),
    target: Number(formData.get("target")),
    value: indicatorId ? indicatorById(indicatorId)?.value || 0 : 0,
    unit: formData.get("unit"),
    owner: formData.get("owner") || currentUser?.fullName || "Usuario del sistema",
    due: formData.get("due"),
    type: "Logro",
    ...actorPayload(),
  };

  try {
    const saved = isApiConfigured()
      ? indicatorId
        ? await updateApiIndicator(indicatorId, payload)
        : await createApiIndicator(payload)
      : payload;
    upsertById(state.indicators, saved);
    saveState();
    renderAll();
    resetIndicatorForm();
    showToast(indicatorId ? "Indicador actualizado." : "Indicador creado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude guardar el indicador.");
  }
}

function resetProgramForm() {
  elements.programCrudForm.reset();
  elements.programIdInput.value = "";
  elements.programBeneficiariesInput.value = 0;
  elements.programBudgetInput.value = "No especificado";
  populateProgramProvinceChoices([]);
  if (elements.programCentersInput) elements.programCentersInput.value = "";
  elements.programPopulationInput.value = "";
  if (elements.programCoordinatorEmailInput) elements.programCoordinatorEmailInput.value = "";
  if (elements.programManagerEmailInput) elements.programManagerEmailInput.value = "";
  if (elements.programMelSupervisorEmailInput) elements.programMelSupervisorEmailInput.value = "";
}

function resetProgramCenterForm() {
  if (!elements.programCenterForm) return;
  elements.programCenterForm.reset();
  elements.programCenterIdInput.value = "";
  const programName = state.programs[0]?.name || "";
  const province = state.operationalProvinces?.[0] || "";
  if (programName) elements.programCenterProgramInput.value = programName;
  if (province) elements.programCenterProvinceInput.value = province;
}

function fillProgramCenterForm(center) {
  elements.programCenterIdInput.value = center.id || "";
  elements.programCenterProgramInput.value = center.program || state.programs[0]?.name || "";
  elements.programCenterProvinceInput.value = center.province || state.operationalProvinces?.[0] || "";
  elements.programCenterNameInput.value = center.name || "";
  elements.programCenterForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.programCenterNameInput?.focus({ preventScroll: true });
}

function fillProgramForm(program) {
  elements.programIdInput.value = program.id;
  elements.programNameInput.value = program.name;
  elements.programLeadInput.value = program.lead;
  elements.programBeneficiariesInput.value = program.beneficiaries;
  elements.programBudgetInput.value = program.budget;
  populateProgramProvinceChoices(program.provinces || []);
  if (elements.programCentersInput) {
    elements.programCentersInput.value = formatProgramCentersInput(program.name);
  }
  if (elements.programCoordinatorEmailInput) elements.programCoordinatorEmailInput.value = program.coordinatorEmail || "";
  if (elements.programManagerEmailInput) elements.programManagerEmailInput.value = program.programManagerEmail || "";
  if (elements.programMelSupervisorEmailInput) elements.programMelSupervisorEmailInput.value = program.melSupervisorEmail || "";
  elements.programFocusInput.value = program.focus;
  elements.programPopulationInput.value = program.primaryPopulation || "";
  elements.programCrudForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.programNameInput?.focus({ preventScroll: true });
}

async function saveProgramFromForm(formData) {
  const programId = formData.get("id");
  const selectedProvinces = formData.getAll("provinces").map((item) => String(item || "").trim()).filter(Boolean);
  const centers = parseProgramCentersInput(formData.get("centers"));
  const payload = {
    id: programId || undefined,
    name: formData.get("name"),
    lead: formData.get("lead"),
    beneficiaries: Number(formData.get("beneficiaries") || 0),
    budget: formData.get("budget"),
    coordinatorEmail: formData.get("coordinatorEmail"),
    programManagerEmail: formData.get("programManagerEmail"),
    melSupervisorEmail: formData.get("melSupervisorEmail"),
    provinces: selectedProvinces,
    focus: formData.get("focus"),
    primaryPopulation: formData.get("primaryPopulation"),
    centers,
    expectedResults: programId ? state.programs.find((program) => program.id === programId)?.expectedResults || [] : [],
    ...actorPayload(),
  };

  if (!payload.provinces.length) {
    showToast("Selecciona al menos una provincia para el programa.");
    return;
  }

  try {
    const previous = state.programs.find((program) => program.id === programId);
    const saved = isApiConfigured()
      ? programId
        ? await updateApiProgram(programId, payload)
        : await createApiProgram(payload)
      : {
          ...payload,
          id: programId || `prog-${slugify(payload.name)}-${Date.now()}`,
          centers: centers.map((center, index) => ({
            id: `center-${slugify(payload.name)}-${slugify(center.province)}-${Date.now()}-${index}`,
            program: payload.name,
            programId: programId || null,
            province: center.province,
            name: center.name,
          })),
        };
    upsertById(state.programs, saved);
    if (previous && previous.name !== saved.name) {
      state.indicators = state.indicators.map((indicator) =>
        indicator.program === previous.name ? { ...indicator, program: saved.name, programId: saved.id } : indicator,
      );
      state.reports = state.reports.map((report) =>
        report.program === previous.name ? { ...report, program: saved.name, programId: saved.id } : report,
      );
      state.programCenters = (state.programCenters || []).map((center) =>
        center.program === previous.name ? { ...center, program: saved.name, programId: saved.id } : center,
      );
    }
    if (Array.isArray(saved.centers)) {
      state.programCenters = [
        ...(state.programCenters || []).filter((center) => center.programId !== saved.id && center.program !== saved.name),
        ...saved.centers,
      ];
    }
    saveState();
    renderAll();
    if (isApiConfigured()) {
      const conversation = await ensureContextChatConversation({
        title: `Programa · ${saved.name}`,
        description: `Chat institucional del programa ${saved.name}.`,
        contextType: "program",
        contextId: saved.id || `program-${slugify(saved.name)}`,
        participantUserIds: activeOrganizationParticipantIds(),
      });
      await sendAutomatedChatMessage(
        conversation.id,
        `${currentUser?.fullName || activeRole()} ${programId ? "actualizo" : "registro"} el programa ${saved.name}. Provincias: ${(saved.provinces || []).join(", ") || "Sin provincias"}.`,
      );
    }
    resetProgramForm();
    showToast(programId ? "Programa actualizado." : "Programa creado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude guardar el programa.");
  }
}

async function deleteConceptPaperFromUi(conceptPaperId) {
  if (!isSystemAdminRole()) {
    showToast("Solo Supervision M&E puede eliminar Concept Papers.");
    return;
  }
  const paper = (state.conceptPapers || []).find((item) => item.id === conceptPaperId);
  if (!paper) {
    showToast("No encontre el Concept Paper.");
    return;
  }
  const confirmed = window.confirm(
    `Eliminar "${paper.title}" quitará también su resumen técnico de la biblioteca para todos los usuarios. Quedará registro en auditoría. ¿Deseas continuar?`,
  );
  if (!confirmed) return;

  const previousConceptPapers = state.conceptPapers || [];
  const previousDeletedConceptPaperIds = state.deletedConceptPaperIds || [];
  const previousSelectedConceptPaper = state.selectedConceptPaper;
  try {
    state.deletedConceptPaperIds = Array.from(new Set([...(state.deletedConceptPaperIds || []), conceptPaperId]));
    state.conceptPapers = (state.conceptPapers || []).filter((item) => item.id !== conceptPaperId);
    if (state.selectedConceptPaper === conceptPaperId) {
      state.selectedConceptPaper = state.conceptPapers[0]?.id || null;
    }
    saveState();
    renderAll();

    if (isApiConfigured()) {
      await deleteApiConceptPaper(conceptPaperId, {
        ...actorPayload(),
        reason: "Concept Paper eliminado desde la biblioteca.",
      });
      await refreshConceptPapersFromApi();
    } else {
      saveState();
    }
    renderAll();
    showToast("Concept Paper eliminado de la plataforma.");
  } catch (error) {
    if (error.status === 404) {
      saveState();
      renderAll();
      showToast("Concept Paper eliminado de la plataforma.");
      return;
    }
    state.conceptPapers = previousConceptPapers;
    state.deletedConceptPaperIds = previousDeletedConceptPaperIds;
    state.selectedConceptPaper = previousSelectedConceptPaper;
    saveState();
    renderAll();
    console.error(error);
    showToast(error.message || "No pude eliminar el Concept Paper.");
  }
}

async function deleteProgramManualFromUi(manualId) {
  if (!isSystemAdminRole()) {
    showToast("Solo Supervision M&E puede eliminar manuales.");
    return;
  }
  const manual = (state.programManuals || []).find((item) => item.id === manualId);
  if (!manual) {
    showToast("No encontre el manual.");
    return;
  }
  const confirmed = window.confirm(
    `Eliminar "${manual.title || manual.fileName}" quitara este manual de la biblioteca para todos los usuarios. Quedara registro en auditoria. Deseas continuar?`,
  );
  if (!confirmed) return;

  const previousManuals = state.programManuals || [];
  try {
    state.programManuals = (state.programManuals || []).filter((item) => item.id !== manualId);
    saveState();
    renderAll();

    if (isApiConfigured()) {
      await deleteApiProgramManual(manualId, {
        ...actorPayload(),
        reason: "Manual eliminado desde la biblioteca.",
      });
      await refreshProgramManualsFromApi();
    } else {
      saveState();
    }
    renderAll();
    showToast("Manual eliminado de la plataforma.");
  } catch (error) {
    if (error.status === 404) {
      saveState();
      renderAll();
      showToast("Manual eliminado de la plataforma.");
      return;
    }
    state.programManuals = previousManuals;
    saveState();
    renderAll();
    console.error(error);
    showToast(error.message || "No pude eliminar el manual.");
  }
}

async function saveProgramCenterFromForm(formData) {
  if (!canManageProgramCenters()) {
    showToast("No tienes permiso para administrar centros.");
    return;
  }

  const centerId = String(formData.get("id") || "").trim();
  const payload = {
    id: centerId || undefined,
    program: String(formData.get("program") || "").trim(),
    province: String(formData.get("province") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    ...actorPayload(),
  };

  if (!payload.program || !payload.province || !payload.name) {
    showToast("Completa programa, provincia y centro.");
    return;
  }

  try {
    const saved = isApiConfigured()
      ? centerId
        ? await updateApiProgramCenter(centerId, payload)
        : await createApiProgramCenter(payload)
      : { ...payload, id: centerId || `center-${slugify(payload.program)}-${slugify(payload.province)}-${Date.now()}` };
    upsertById(state.programCenters, saved);
    saveState();
    resetProgramCenterForm();
    renderAll();
    if (isApiConfigured()) {
      const targetProgram = (state.programs || []).find((program) => program.id === saved.programId || program.name === saved.program);
      const conversation = await ensureContextChatConversation({
        title: `Programa · ${saved.program}`,
        description: `Chat institucional del programa ${saved.program}.`,
        contextType: "program",
        contextId: targetProgram?.id || saved.programId || `program-${slugify(saved.program)}`,
        participantUserIds: activeOrganizationParticipantIds(),
      });
      await sendAutomatedChatMessage(
        conversation.id,
        `${currentUser?.fullName || activeRole()} ${centerId ? "actualizo" : "agrego"} el centro ${saved.name} en ${saved.province} para ${saved.program}.`,
      );
    }
    showToast("Centro guardado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude guardar el centro.");
  }
}

function bindEvents() {
  window.addEventListener("focus", () => {
    void refreshAccessStateFromRemote({ showToastOnPermissionChange: false });
    if (isApiConfigured()) {
      void syncChatInbox({ includeMessages: state?.activeView === "chat", showToastOnNewMessages: true }).catch((error) => {
        console.error("No pude refrescar el chat al volver a la ventana.", error);
      });
      void sendChatPresenceHeartbeat().catch((error) => {
        console.error("No pude restaurar la presencia del chat al volver a la ventana.", error);
      });
      if (state?.activeView === "chat" && state.chatActiveConversationId) {
        void refreshActiveChatPresence({ render: true }).catch((error) => {
          console.error("No pude refrescar la presencia del chat al volver a la ventana.", error);
        });
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshAccessStateFromRemote({ showToastOnPermissionChange: false });
      if (isApiConfigured()) {
        void syncChatInbox({ includeMessages: state?.activeView === "chat", showToastOnNewMessages: true }).catch((error) => {
          console.error("No pude refrescar el chat al volver a la pestana.", error);
        });
        void sendChatPresenceHeartbeat().catch((error) => {
          console.error("No pude restaurar la presencia del chat al volver a la pestana.", error);
        });
        if (state?.activeView === "chat" && state.chatActiveConversationId) {
          void refreshActiveChatPresence({ render: true }).catch((error) => {
            console.error("No pude refrescar la presencia del chat al volver a la pestana.", error);
          });
        }
      }
    } else {
      stopChatTyping();
    }
  });
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#quickReportButton").addEventListener("click", () => switchView("report"));

  elements.chatCreateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await createDirectChat(elements.chatUserSelect?.value || "");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude crear el chat.");
      }
    })();
  });

  elements.chatGroupCreateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await createGroupChat(elements.chatGroupNameInput?.value || "", selectedChatGroupMemberIds());
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude crear el grupo.");
      }
    })();
  });

  elements.chatSearchInput?.addEventListener("input", () => {
    void handleChatSearchQuery(elements.chatSearchInput.value || "");
  });

  elements.chatUserSelect?.addEventListener("change", () => {
    state.chatSelectedDirectUserId = String(elements.chatUserSelect?.value || "").trim();
    saveState();
  });

  elements.chatComposerInput?.addEventListener("input", () => {
    handleChatComposerInputChange();
  });

  elements.chatComposerInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    if (chatMessageSendInFlight) return;
    elements.chatComposerForm?.requestSubmit();
  });

  elements.chatAttachmentInput?.addEventListener("change", () => {
    setChatAttachmentFiles(Array.from(elements.chatAttachmentInput.files || []));
  });

  elements.chatAreaChannels?.addEventListener("click", (event) => {
    const areaId = event.target.closest("[data-open-chat-area]")?.dataset.openChatArea;
    if (!areaId) return;
    void openAreaChat(areaId, { openView: true }).catch((error) => {
      console.error(error);
      showToast(error.message || "No pude abrir el canal institucional.");
    });
  });

  elements.chatConversationList?.addEventListener("click", (event) => {
    const conversationId = event.target.closest("[data-open-chat-conversation]")?.dataset.openChatConversation;
    if (!conversationId) return;
    void (async () => {
      try {
        await openChatConversationById(conversationId, { markRead: true });
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude abrir la conversacion.");
      }
    })();
  });

  elements.chatDeleteButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await deleteActiveChatConversation();
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude eliminar el chat.");
      }
    })();
  });

  elements.chatRenameButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await renameActiveChatConversation();
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude renombrar el chat.");
      }
    })();
  });

  elements.chatLeaveButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await leaveActiveChatConversation();
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude salir del chat.");
      }
    })();
  });

  elements.chatMessageList?.addEventListener("click", (event) => {
    const replyId = event.target.closest("[data-chat-reply]")?.dataset.chatReply;
    if (replyId) {
      startReplyToChatMessage(replyId);
      return;
    }
    const pinButton = event.target.closest("[data-chat-pin]");
    if (pinButton) {
      const messageId = pinButton.dataset.chatPin;
      const nextPinned = pinButton.dataset.chatPinNext === "true";
      void (async () => {
        try {
          await toggleCurrentChatMessagePin(messageId, nextPinned);
        } catch (error) {
          console.error(error);
          showToast(error.message || "No pude actualizar el mensaje fijado.");
        }
      })();
    }
  });

  elements.chatPinnedMessages?.addEventListener("click", (event) => {
    const messageId = event.target.closest("[data-chat-scroll-to-message]")?.dataset.chatScrollToMessage;
    if (!messageId) return;
    scrollToChatMessage(messageId);
  });

  elements.chatReplyPreview?.addEventListener("click", (event) => {
    if (event.target.closest("[data-clear-chat-reply]")) {
      clearChatReplyTarget();
    }
  });

  elements.chatAddParticipantForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await addParticipantsToCurrentGroup([elements.chatAddParticipantSelect?.value || ""]);
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude agregar el participante.");
      }
    })();
  });

  elements.chatParticipantModeration?.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-chat-participant-manage]");
    if (!form) return;
    event.preventDefault();
    const userId = form.dataset.chatParticipantManage;
    const formData = new FormData(form);
    void (async () => {
      try {
        await updateParticipantInCurrentGroup(userId, {
          participantRole: formData.get("participantRole"),
          canSendMessages: formData.get("canSendMessages") === "on",
          isMuted: formData.get("isMuted") === "on",
        });
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude actualizar al participante.");
      }
    })();
  });

  elements.chatParticipantModeration?.addEventListener("click", (event) => {
    const userId = event.target.closest("[data-remove-chat-participant]")?.dataset.removeChatParticipant;
    if (!userId) return;
    void (async () => {
      try {
        await removeParticipantFromCurrentGroup(userId);
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude quitar al participante.");
      }
    })();
  });

  elements.chatComposerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await sendCurrentChatMessage();
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude enviar el mensaje.");
      }
    })();
  });

  $("#seedButton").addEventListener("click", () => {
    if (appRefreshInFlight) return;
    const button = $("#seedButton");
    const idleLabel = button?.dataset.idleLabel || button?.textContent || "Sync";
    if (button && !button.dataset.idleLabel) {
      button.dataset.idleLabel = idleLabel;
    }
    const syncStatus = elements.syncStatus;
    let settled = false;
    const finishRefresh = () => {
      if (settled) return;
      settled = true;
      hydrateState();
      renderAll();
      appRefreshInFlight = false;
      window.removeEventListener("mel:state-synced", handleSynced);
      if (syncStatus) {
        syncStatus.hidden = true;
        syncStatus.classList.remove("is-active");
      }
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.idleLabel || idleLabel;
        button.setAttribute("aria-label", "Actualizar vista");
        button.title = "Actualizar vista";
      }
      showToast("Sistema actualizado.");
    };
    const handleSynced = () => {
      finishRefresh();
    };
    appRefreshInFlight = true;
    if (button) {
      button.disabled = true;
      button.textContent = "...";
      button.setAttribute("aria-label", "Actualizando sistema");
      button.title = "Actualizando sistema";
    }
    if (syncStatus) {
      syncStatus.hidden = false;
      syncStatus.classList.add("is-active");
    }
    window.addEventListener("mel:state-synced", handleSynced, { once: true });
    window.dispatchEvent(new CustomEvent("mel:manual-refresh"));
    window.setTimeout(finishRefresh, isApiConfigured() ? 2500 : 120);
  });

  $("#clearFormButton").addEventListener("click", () => {
    elements.reportForm.reset();
    syncReportCaptureOptions();
    elements.reportPeriod.value = state.filters.period === "Todos" ? currentMonth() : state.filters.period;
    if (elements.reportEvidenceType) elements.reportEvidenceType.value = "note";
    if (elements.reportEvidenceNoteInput) elements.reportEvidenceNoteInput.value = "";
    if (elements.reportEvidenceLinkInput) elements.reportEvidenceLinkInput.value = "";
    if (elements.reportFormUploadInput) elements.reportFormUploadInput.value = "";
    syncEvidenceInputMode();
    elements.reportUploadStatus.textContent = "Sin archivo";
    elements.reportUploadStatus.className = "status-pill neutral";
    elements.reportUploadPreview.innerHTML = "";
    state.reportDrafts = [];
  });
  elements.reportEvidenceType?.addEventListener("change", () => {
    if (elements.reportFormUploadInput) {
      elements.reportFormUploadInput.value = "";
    }
    syncEvidenceInputMode();
  });
  elements.reportFormUploadInput?.addEventListener("change", () => {
    const selectedFiles = Array.from(elements.reportFormUploadInput.files || []);
    const evidenceType = String(elements.reportEvidenceType?.value || "note").trim();
    if (evidenceType === "photo") {
      const imageFiles = selectedFiles.filter((file) => String(file.type || "").startsWith("image/"));
      if (selectedFiles.length && imageFiles.length !== selectedFiles.length) {
        showToast("Cuando la evidencia sea una imagen, selecciona solo archivos de imagen.");
        setReportAttachmentFiles(imageFiles);
        return;
      }
    }
    renderReportAttachmentPreview();
  });
  elements.reportEvidenceDropzone?.addEventListener("click", () => {
    elements.reportFormUploadInput?.click();
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    elements.reportEvidenceDropzone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.reportEvidenceDropzone?.classList.add("is-dragging");
    });
  });
  ["dragleave", "dragend"].forEach((eventName) => {
    elements.reportEvidenceDropzone?.addEventListener(eventName, () => {
      elements.reportEvidenceDropzone?.classList.remove("is-dragging");
    });
  });
  elements.reportEvidenceDropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.reportEvidenceDropzone?.classList.remove("is-dragging");
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    const evidenceType = String(elements.reportEvidenceType?.value || "note").trim();
    const filteredFiles =
      evidenceType === "photo" ? droppedFiles.filter((file) => String(file.type || "").startsWith("image/")) : droppedFiles;
    if (evidenceType === "photo" && droppedFiles.length && !filteredFiles.length) {
      showToast("Cuando la evidencia sea una imagen, arrastra archivos de imagen.");
      return;
    }
    setReportAttachmentFiles(filteredFiles);
  });

  $("#exportButton").addEventListener("click", exportCsv);

  elements.recentReports.addEventListener("click", (event) => {
    const deleteReportId = event.target.closest("[data-delete-report]")?.dataset.deleteReport;
    if (!deleteReportId) return;
    void deleteReportFromUi(deleteReportId);
  });

  elements.attendanceProgramSelect?.addEventListener("change", () => {
    state.attendanceProgram = elements.attendanceProgramSelect.value;
    state.attendanceCenter = attendanceCentersForProgram(state.attendanceProgram)[0] || "General";
    saveState();
    renderAttendance();
  });

  elements.attendanceCenterInput?.addEventListener("change", () => {
    state.attendanceCenter = elements.attendanceCenterInput.value || "General";
    saveState();
    renderAttendance();
  });

  elements.attendancePeriodInput?.addEventListener("change", () => {
    state.attendancePeriod = elements.attendancePeriodInput.value || currentMonth();
    saveState();
    renderAttendance();
  });

  elements.attendanceChatButton?.addEventListener("click", () => {
    void openAttendanceChat({ openView: true }).catch((error) => {
      console.error(error);
      showToast(error.message || "No pude abrir el chat de asistencia.");
    });
  });

  elements.attendanceWeekInput?.addEventListener("change", () => {
    state.attendanceWeek = elements.attendanceWeekInput.value || new Date().toISOString().slice(0, 10);
    if (!elements.attendancePeriodInput?.value) {
      state.attendancePeriod = state.attendanceWeek.slice(0, 7);
    }
    saveState();
    renderAttendance();
  });

  elements.participantForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await addAttendanceParticipant(elements.participantNameInput.value);
        elements.participantNameInput.value = "";
        showToast("Participante agregado.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude agregar el participante.");
      }
    })();
  });

  elements.attendanceList?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-attendance-status]");
    if (!input) return;
    const row = input.closest(".attendance-row");
    row?.querySelectorAll(".attendance-choice").forEach((choice) => choice.classList.toggle("active", choice.contains(input)));
    const badge = row?.querySelector(".attendance-state-badge");
    if (badge) {
      badge.textContent = attendanceStatusLabel(input.value);
      badge.className = `attendance-state-badge ${input.value}`;
    }
    const entries = attendanceEntriesFromChecklist();
    const presentCount = entries.filter((entry) => attendanceEntryStatus(entry) === "present").length;
    const excusedCount = entries.filter((entry) => attendanceEntryStatus(entry) === "excused").length;
    const absentCount = entries.filter((entry) => attendanceEntryStatus(entry) === "absent").length;
    elements.attendanceSummary.textContent = `${presentCount} presentes · ${excusedCount} excusas · ${absentCount} ausentes`;
    renderAttendanceChart(entries);
  });

  elements.attendanceList?.addEventListener("click", (event) => {
    const participantId = event.target.closest("[data-delete-attendance-participant]")?.dataset.deleteAttendanceParticipant;
    if (!participantId) return;
    void (async () => {
      try {
        await deleteAttendanceParticipantById(participantId);
        showToast("Participante eliminado.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude eliminar el participante.");
      }
    })();
  });

  elements.attendanceChart?.addEventListener("click", (event) => {
    const requestButton = event.target.closest("[data-request-attendance-edit]");
    if (requestButton) {
      void (async () => {
        try {
          await requestAttendanceEdit($("#attendanceEditRequestNote")?.value || "");
          showToast("Solicitud enviada.");
        } catch (error) {
          console.error(error);
          showToast(error.message || "No pude enviar la solicitud.");
        }
      })();
      return;
    }
    const week = event.target.closest("[data-attendance-week]")?.dataset.attendanceWeek;
    if (!week) return;
    state.attendanceWeek = week;
    saveState();
    renderAttendance();
  });

  elements.attendanceList?.parentElement?.addEventListener("click", (event) => {
    const requestButton = event.target.closest("[data-request-attendance-edit]");
    if (!requestButton) return;
    void (async () => {
      try {
        await requestAttendanceEdit($("#attendanceEditRequestNote")?.value || "");
        showToast("Solicitud enviada.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude enviar la solicitud.");
      }
    })();
  });

  elements.saveAttendanceButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await saveCurrentAttendance();
        showToast("Asistencia guardada.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude guardar la asistencia.");
      }
    })();
  });

  elements.deleteAttendanceSessionButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await deleteCurrentAttendanceSession();
        showToast("Sesion eliminada.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude eliminar la sesion.");
      }
    })();
  });

  elements.clearAttendanceParticipantsButton?.addEventListener("click", () => {
    void (async () => {
      try {
        await clearAttendanceParticipantsForCurrentProgram();
        showToast("Nombres eliminados del programa.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude eliminar los nombres.");
      }
    })();
  });

  elements.resetAttendanceProgramButton?.addEventListener("click", () => {
    const confirmed = window.confirm(
      `Esto quitara todos los nombres y todas las sesiones de asistencia de ${state.attendanceProgram}. La auditoria quedara guardada. ¿Quieres continuar?`,
    );
    if (!confirmed) return;
    void (async () => {
      try {
        await resetCurrentAttendanceProgram();
        showToast("Asistencia reiniciada desde cero.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude reiniciar la asistencia.");
      }
    })();
  });

  [elements.programFilter, elements.provinceFilter, elements.periodFilter].forEach((filter) => {
    filter.addEventListener("change", () => {
      state.filters.program = elements.programFilter.value;
      state.filters.province = elements.provinceFilter.value;
      state.filters.period = elements.periodFilter.value;
      saveState();
      renderAll();
    });
  });

  elements.programChart?.addEventListener("click", (event) => {
    const indicatorProgram = event.target.closest("[data-open-program-indicators]")?.dataset.openProgramIndicators;
    if (indicatorProgram) {
      setProgramSourceContext(indicatorProgram, "indicators");
      showToast(`Mostrando indicadores fuente de ${indicatorProgram}.`);
      return;
    }

    const reportProgram = event.target.closest("[data-open-program-reports]")?.dataset.openProgramReports;
    if (reportProgram) {
      setProgramSourceContext(reportProgram, "dashboard");
      showToast(`Mostrando reportes fuente de ${reportProgram}.`);
    }
  });

  [elements.notificationList, elements.supervisionNotificationList].forEach((list) => {
    list.addEventListener("click", (event) => {
      const conversationId = event.target.closest("[data-open-chat-conversation]")?.dataset.openChatConversation;
      const reportId = event.target.closest("[data-open-report]")?.dataset.openReport;
      const reportChatId = event.target.closest("[data-open-report-chat]")?.dataset.openReportChat;
      const notificationId = event.target.closest("[data-read-notification]")?.dataset.readNotification;
      const closeDetail = event.target.closest("[data-close-report-detail]");
      const deleteReportId = event.target.closest("[data-delete-report]")?.dataset.deleteReport;

      if (closeDetail) {
        activeStatusReportId = null;
        renderNotifications();
        return;
      }

      if (deleteReportId) {
        void deleteReportFromUi(deleteReportId);
        return;
      }

      if (conversationId) {
        void (async () => {
          try {
            await openChatConversationById(conversationId, { switchToChat: true, markRead: true });
          } catch (error) {
            console.error(error);
            showToast(error.message || "No pude abrir la conversacion.");
          }
        })();
        return;
      }

      if (reportChatId) {
        void openReportChatById(reportChatId, { openView: true }).catch((error) => {
          console.error(error);
          showToast(error.message || "No pude abrir el chat del reporte.");
        });
        return;
      }

      if (reportId) {
        activeStatusReportId = reportId;
        renderNotifications();
        switchView("supervision");
      }

      if (notificationId) {
        void (async () => {
          try {
            if (isApiConfigured()) {
              await markApiNotificationRead(notificationId, { actorId: `local-${slugify(activeRole() || "usuario")}` });
            }
            state.notifications = (state.notifications || []).map((notification) =>
              notification.id === notificationId
                ? { ...notification, status: "read", readAt: new Date().toISOString() }
                : notification,
            );
            saveState();
            renderAll();
            showToast("Alerta marcada como leida.");
          } catch (error) {
            console.error(error);
            showToast(error.message || "No pude actualizar la alerta.");
          }
        })();
      }
    });
  });

  elements.reportProgram.addEventListener("change", () => {
    syncReportCaptureOptions();
  });

  elements.reportProvince.addEventListener("change", () => {
    syncReportCaptureOptions();
  });

  elements.designProgramSelect.addEventListener("change", () => {
    state.designProgram = elements.designProgramSelect.value;
    state.formsProgram = state.designProgram;
    saveState();
    renderAll();
  });

  elements.formsProgramSelect.addEventListener("change", () => {
    state.formsProgram = elements.formsProgramSelect.value;
    saveState();
    renderAll();
  });

  elements.indicatorChartTypeSelect.addEventListener("change", () => {
    state.chartPreferences.indicatorType = elements.indicatorChartTypeSelect.value;
    saveState();
    renderCharts();
  });

  elements.periodChartTypeSelect.addEventListener("change", () => {
    state.chartPreferences.periodType = elements.periodChartTypeSelect.value;
    saveState();
    renderCharts();
  });

  elements.chartDataScopeSelect.addEventListener("change", () => {
    state.chartPreferences.dataScope = elements.chartDataScopeSelect.value;
    saveState();
    renderCharts();
  });

  $("#generateIndicatorsButton").addEventListener("click", () => {
    void createIndicatorsFromProgram().catch((error) => {
      console.error(error);
      showToast(error.message || "No pude crear los indicadores.");
    });
  });
  $("#createMonitoringFormButton").addEventListener("click", () => createFormTemplate("Monitoreo"));
  $("#createEvaluationFormButton").addEventListener("click", () => createFormTemplate("Evaluacion"));
  $("#downloadAllFormsButton").addEventListener("click", downloadAllForms);
  elements.indicatorCrudForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveIndicatorFromForm(new FormData(elements.indicatorCrudForm));
  });
  elements.clearIndicatorFormButton.addEventListener("click", resetIndicatorForm);
  elements.programCrudForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveProgramFromForm(new FormData(elements.programCrudForm));
  });
  elements.clearProgramFormButton.addEventListener("click", resetProgramForm);
  elements.programCenterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveProgramCenterFromForm(new FormData(elements.programCenterForm));
  });
  elements.clearProgramCenterFormButton.addEventListener("click", resetProgramCenterForm);
  elements.formUploadInput.addEventListener("change", () => {
    const file = elements.formUploadInput.files?.[0];
    elements.uploadStatus.textContent = file ? file.name : "Sin archivo";
    elements.uploadStatus.className = `status-pill ${file ? "info" : "neutral"}`;
  });
  elements.uploadFormButton.addEventListener("click", () => {
    importCompletedForm(elements.formUploadInput.files?.[0]);
  });

  elements.formTemplateGrid.addEventListener("click", (event) => {
    const formId = event.target.closest("[data-download-form]")?.dataset.downloadForm;
    const wordFormId = event.target.closest("[data-download-word]")?.dataset.downloadWord;
    const pdfFormId = event.target.closest("[data-download-pdf]")?.dataset.downloadPdf;
    if (formId) {
      downloadFormTemplate(formId);
    }
    if (wordFormId) {
      downloadWordTemplate(wordFormId);
    }
    if (pdfFormId) {
      downloadPdfTemplate(pdfFormId);
    }
  });

  elements.conceptPaperList.addEventListener("click", (event) => {
    const deleteConceptPaperId = event.target.closest("[data-delete-concept-paper]")?.dataset.deleteConceptPaper;
    if (deleteConceptPaperId) {
      void deleteConceptPaperFromUi(deleteConceptPaperId);
      return;
    }

    const deleteManualId = event.target.closest("[data-delete-program-manual]")?.dataset.deleteProgramManual;
    if (deleteManualId) {
      void deleteProgramManualFromUi(deleteManualId);
      return;
    }

    const openDocumentId = event.target.closest("[data-open-concept-document]")?.dataset.openConceptDocument;
    if (openDocumentId) {
      const paper = state.conceptPapers.find((item) => item.id === openDocumentId);
      if (paper?.dataUrl) {
        openDataUrlDocument(paper.dataUrl, paper.fileName || paper.title || "Concept Paper");
      }
      return;
    }

    const openManualId = event.target.closest("[data-open-program-manual]")?.dataset.openProgramManual;
    if (openManualId) {
      const manual = (state.programManuals || []).find((item) => item.id === openManualId);
      if (manual?.dataUrl) {
        openDataUrlDocument(manual.dataUrl, manual.fileName || manual.title || "Manual de programa");
      }
      return;
    }

    const conceptId = event.target.dataset.conceptId;
    if (!conceptId) return;
    state.selectedConceptPaper = conceptId;
    saveState();
    renderAll();
  });

  $("#useConceptButton").addEventListener("click", () => {
    const paper = selectedConceptPaper();
    if (!paper) return;
    state.designProgram = paper.program;
    state.formsProgram = paper.program;
    saveState();
    renderAll();
    switchView("design");
    showToast(`Concept paper aplicado a ${paper.program}.`);
  });

  elements.reportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const saved = await addReport(new FormData(elements.reportForm));
      if (!saved) return;
      elements.reportForm.reset();
      syncReportCaptureOptions();
      elements.reportPeriod.value = state.filters.period === "Todos" ? currentMonth() : state.filters.period;
      if (elements.reportEvidenceType) elements.reportEvidenceType.value = "note";
      if (elements.reportEvidenceNoteInput) elements.reportEvidenceNoteInput.value = "";
      if (elements.reportEvidenceLinkInput) elements.reportEvidenceLinkInput.value = "";
      if (elements.reportFormUploadInput) elements.reportFormUploadInput.value = "";
      syncEvidenceInputMode();
      elements.reportUploadStatus.textContent = "Sin archivo";
      elements.reportUploadStatus.className = "status-pill neutral";
      elements.reportUploadPreview.innerHTML = "";
      switchView("dashboard");
    })();
  });

  elements.reviewList.addEventListener("click", (event) => {
    const approveId = event.target.dataset.approve;
    const returnId = event.target.dataset.return;
    const reportChatId = event.target.closest("[data-open-report-chat]")?.dataset.openReportChat;
    if (reportChatId) {
      void openReportChatById(reportChatId, { openView: true }).catch((error) => {
        console.error(error);
        showToast(error.message || "No pude abrir el chat del reporte.");
      });
      return;
    }
    const report = state.reports.find((item) => item.id === approveId || item.id === returnId);
    if (!report) return;

    void (async () => {
      try {
        if (approveId) {
          const nextStatus = nextApprovalStatusForReport(report);
          await saveReviewDecision(report, nextStatus, "Aprobado para continuar la cadena de revision.");
          showToast(
            nextStatus === REPORT_STATUSES.APPROVED
              ? "Reporte aprobado y habilitado para analitica."
              : `Reporte enviado a ${reviewRoleForStatus(nextStatus)}.`,
          );
        }

        if (returnId) {
          const note = window.prompt("Indica que debe corregirse en este reporte:");
          if (!note?.trim()) {
            showToast("Debes escribir una nota de correccion.");
            return;
          }
          await saveReviewDecision(report, REPORT_STATUSES.NEEDS_CORRECTION, note.trim());
          const latestReport = state.reports.find((item) => item.id === report.id) || report;
          await ensureReportConversation(latestReport, {
            openView: false,
            seedMessage: `${currentUser?.fullName || activeRole()} solicito correccion para ${latestReport.correctionForRole || "Facilitador"}: ${note.trim()}`,
          });
          activeStatusReportId = report.id;
          showToast("Correccion solicitada con nota.");
        }

        renderAll();
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude actualizar la revision.");
      }
    })();
  });

  elements.indicatorBoard.addEventListener("click", (event) => {
    const editId = event.target.closest("[data-edit-indicator]")?.dataset.editIndicator;
    const deleteId = event.target.closest("[data-delete-indicator]")?.dataset.deleteIndicator;

    if (editId) {
      const indicator = state.indicators.find((item) => item.id === editId);
      if (indicator) fillIndicatorForm(indicator);
    }

    if (deleteId) {
      const hasReports = state.reports.some((report) => report.indicatorId === deleteId);
      if (hasReports) {
        showToast("No se puede eliminar un indicador con reportes.");
        return;
      }
      void (async () => {
        try {
          if (isApiConfigured()) {
            await deleteApiIndicator(deleteId, actorPayload());
          }
          removeById(state.indicators, deleteId);
          saveState();
          renderAll();
          showToast("Indicador eliminado.");
        } catch (error) {
          console.error(error);
          showToast(error.message || "No pude eliminar el indicador.");
        }
      })();
    }
  });

  elements.programGrid.addEventListener("click", (event) => {
    const programChatId = event.target.closest("[data-open-program-chat]")?.dataset.openProgramChat;
    const editId = event.target.closest("[data-edit-program]")?.dataset.editProgram;
    const editName = event.target.closest("[data-edit-program-name]")?.dataset.editProgramName;
    const deleteId = event.target.closest("[data-delete-program]")?.dataset.deleteProgram;
    const deleteName = event.target.closest("[data-delete-program-name]")?.dataset.deleteProgramName;

    if (programChatId) {
      void openProgramChat(programChatId, { openView: true }).catch((error) => {
        console.error(error);
        showToast(error.message || "No pude abrir el chat del programa.");
      });
      return;
    }

    if (editId || editName) {
      const program = state.programs.find((item) => item.id === editId) || state.programs.find((item) => item.name === editName);
      if (program) fillProgramForm(program);
    }

    if (deleteId || deleteName) {
      const targetProgram = state.programs.find((item) => item.id === deleteId) || state.programs.find((item) => item.name === deleteName);
      if (!targetProgram) return;
      const hasIndicators = state.indicators.some((indicator) => indicator.programId === targetProgram.id || indicator.program === targetProgram.name);
      const hasReports = state.reports.some((report) => report.programId === targetProgram.id || report.program === targetProgram.name);
      if (hasIndicators || hasReports) {
        showToast("No se puede eliminar un programa con datos asociados.");
        return;
      }
      void (async () => {
        try {
          if (isApiConfigured()) {
            await deleteApiProgram(targetProgram.id, actorPayload());
          }
          removeById(state.programs, targetProgram.id);
          saveState();
          renderAll();
          showToast("Programa eliminado.");
        } catch (error) {
          console.error(error);
          showToast(error.message || "No pude eliminar el programa.");
        }
      })();
    }
  });

  elements.programCenterGrid.addEventListener("click", (event) => {
    const editId = event.target.closest("[data-edit-program-center]")?.dataset.editProgramCenter;
    const deleteId = event.target.closest("[data-delete-program-center]")?.dataset.deleteProgramCenter;
    const deleteProgram = event.target.closest("[data-delete-program-center-program]")?.dataset.deleteProgramCenterProgram;
    const deleteProvince = event.target.closest("[data-delete-program-center-province]")?.dataset.deleteProgramCenterProvince;
    const deleteName = event.target.closest("[data-delete-program-center-name]")?.dataset.deleteProgramCenterName;

    if (editId) {
      const center = state.programCenters.find((item) => item.id === editId);
      if (center) fillProgramCenterForm(center);
    }

    if (deleteId) {
      if (!canManageProgramCenters()) {
        showToast("No tienes permiso para eliminar centros.");
        return;
      }
      void (async () => {
        const previousCenters = state.programCenters.slice();
        const matchesTarget = (center) =>
          center.id === deleteId ||
          (deleteProgram &&
            deleteProvince &&
            deleteName &&
            center.program === deleteProgram &&
            center.province === deleteProvince &&
            String(center.name || "").toLowerCase() === String(deleteName || "").toLowerCase());
        try {
          state.programCenters = (state.programCenters || []).filter((center) => !matchesTarget(center));
          saveState();
          renderAll();
          if (isApiConfigured()) {
            await deleteApiProgramCenter(deleteId, {
              ...actorPayload(),
              program: deleteProgram,
              province: deleteProvince,
              name: deleteName,
            });
            await refreshProgramCentersFromApi();
          }
          window.dispatchEvent(new CustomEvent("mel:manual-refresh"));
          renderAll();
          showToast("Centro eliminado.");
        } catch (error) {
          if (error.status === 404) {
            if (isApiConfigured()) {
              await refreshProgramCentersFromApi();
            }
            window.dispatchEvent(new CustomEvent("mel:manual-refresh"));
            saveState();
            renderAll();
            showToast("Centro eliminado.");
            return;
          }
          state.programCenters = previousCenters;
          saveState();
          renderAll();
          console.error(error);
          showToast(error.message || "No pude eliminar el centro.");
        }
      })();
    }
  });

  $("#addIndicatorButton").addEventListener("click", () => {
    const next = state.indicators.length + 1;
    const program = selectedProgramForIndicatorForm();
    resetIndicatorForm();
    elements.indicatorProgramInput.value = program?.name || "";
    elements.indicatorNameInput.value = `Nuevo indicador ${next}`;
    elements.indicatorTargetInput.value = 100;
    elements.indicatorNameInput.focus();
  });

  elements.accessUserGrid?.addEventListener("submit", (event) => {
    if (event.target.id === "createConceptPaperForm") {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);
      const file = form.elements.conceptFile?.files?.[0] || null;
      void (async () => {
        accessLibraryUploadInFlight = true;
        try {
          const conceptPaper = await conceptPaperDocumentFromFile(file, formData);
          const savedPaper = isApiConfigured() ? await createApiConceptPaper({ ...conceptPaper, ...actorPayload() }) : conceptPaper;
          state.conceptPapers = [savedPaper, ...state.conceptPapers.filter((paper) => paper.id !== savedPaper.id)];
          state.selectedConceptPaper = savedPaper.id;
          saveState();
          form.reset();
          await refreshConceptPapersFromApi();
          accessLibraryUploadInFlight = false;
          renderAll();
          showToast("Concept Paper cargado y disponible para todos.");
        } catch (error) {
          console.error(error);
          showToast(error.status === 403 ? "Solo Supervision M&E puede cargar Concept Papers." : error.message || "No pude cargar el Concept Paper.");
        } finally {
          accessLibraryUploadInFlight = false;
        }
      })();
      return;
    }

    if (event.target.id === "createProgramManualForm") {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);
      const file = form.elements.manualFile?.files?.[0] || null;
      void (async () => {
        accessLibraryUploadInFlight = true;
        try {
          const manual = await programManualDocumentFromFile(file, formData);
          const savedManual = isApiConfigured() ? await createApiProgramManual({ ...manual, ...actorPayload() }) : manual;
          state.programManuals = [savedManual, ...(state.programManuals || []).filter((item) => item.id !== savedManual.id)];
          saveState();
          form.reset();
          await refreshProgramManualsFromApi();
          accessLibraryUploadInFlight = false;
          renderAll();
          showToast("Manual cargado y disponible para todos.");
        } catch (error) {
          console.error(error);
          showToast(error.status === 403 ? "Solo Supervision M&E puede cargar manuales." : error.message || "No pude cargar el manual.");
        } finally {
          accessLibraryUploadInFlight = false;
        }
      })();
      return;
    }

    if (event.target.id === "createManagedUserForm") {
      event.preventDefault();
      const formData = new FormData(event.target);
      void (async () => {
        try {
          const systemRole = String(formData.get("systemRole") || "Facilitador");
          await createManagedUser({
            fullName: formData.get("fullName"),
            email: formData.get("email"),
            password: formData.get("password"),
            systemRole,
            status: formData.get("status"),
            allowedRoles: [systemRole],
            mustChangePassword: formData.get("mustChangePassword") === "on",
            accessNote: formData.get("accessNote"),
          });
          event.target.reset();
          renderAccessWorkspace();
          showToast("Usuario creado.");
        } catch (error) {
          console.error(error);
          showToast(error.message || "No pude crear el usuario.");
        }
      })();
      return;
    }

    const form = event.target.closest("[data-user-access-form]");
    if (!form) return;
    event.preventDefault();

    const userId = form.dataset.userAccessForm;
    const formData = new FormData(form);
    const allowedRoles = formData.getAll("allowedRoles").map((item) => String(item));
    const viewPermissions = formData.getAll("viewPermissions").map((item) => String(item));

    void (async () => {
      try {
        await updateManagedUserAccess(userId, {
          fullName: formData.get("fullName"),
          email: formData.get("email"),
          password: String(formData.get("password") || "").trim() || undefined,
          systemRole: formData.get("systemRole"),
          status: formData.get("status"),
          allowedRoles,
          viewPermissions,
          mustChangePassword: formData.get("mustChangePassword") === "on",
          accessNote: formData.get("accessNote"),
        });
        await syncAuthenticatedAccess();
        renderAll();
        showToast("Acceso actualizado.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No pude actualizar el acceso.");
      }
    })();
  });

  elements.accessUserGrid?.addEventListener("click", (event) => {
    const clickTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const deleteButton = clickTarget?.closest("[data-delete-access]");
    if (!deleteButton) return;

    event.preventDefault();
    const userId = deleteButton.dataset.deleteAccess;
    if (!userId || deleteButton.disabled) return;

    void (async () => {
      const userCard = deleteButton.closest("[data-user-access-form]");
      try {
        deletedAccessUserIds.add(userId);
        userCard?.remove();
        deleteButton.disabled = true;
        deleteButton.textContent = "Eliminando...";
        await deleteManagedUser(userId);
        await syncAuthenticatedAccess();
        renderAccessWorkspace();
        showToast("Usuario eliminado definitivamente.");
      } catch (error) {
        console.error(error);
        deletedAccessUserIds.delete(userId);
        deleteButton.disabled = false;
        deleteButton.textContent = "Eliminar definitivo";
        renderAccessWorkspace();
        showToast(error.message || "No pude eliminar el usuario.");
      }
    })();
  });
}

export function createMonitoringApp() {
  async function syncStartupData(options = {}) {
    const { showErrorToast = false } = options;
    if (startupSyncPromise) {
      return startupSyncPromise;
    }

    const loaders = [
      { label: "reportes y notificaciones", run: refreshReportsAndNotificationsFromApi },
      { label: "concept papers", run: refreshConceptPapersFromApi },
      { label: "manuales", run: refreshProgramManualsFromApi },
      { label: "centros de programa", run: refreshProgramCentersFromApi },
      { label: "chat", run: () => refreshChatFromApi({ includeMessages: false }) },
      { label: "asistencia", run: refreshAttendanceFromApi },
    ];

    startupSyncPromise = (async () => {
      const failures = [];
      for (const loader of loaders) {
        try {
          await loader.run();
        } catch (error) {
          failures.push(loader.label);
          console.error(`No pude sincronizar ${loader.label}.`, error);
        }
      }
      if (failures.length && showErrorToast) {
        showToast(`Algunos datos no se actualizaron todavia: ${failures.join(", ")}.`);
      }
      return failures;
    })();

    try {
      return await startupSyncPromise;
    } finally {
      startupSyncPromise = null;
    }
  }

  function ensureStateSyncListener() {
    if (stateSyncListenerBound) return;
    stateSyncListenerBound = true;
    window.addEventListener("mel:state-synced", () => {
      hydrateState();
      void (async () => {
        try {
          await syncAuthenticatedAccess();
          renderAll();
        } catch (error) {
          console.error("No pude rehidratar el acceso despues de sincronizar estado.", error);
          showToast("No pude refrescar todos los permisos. Vuelve a intentar.");
        }
      })();
    });
  }

  return {
    async start(authenticatedUser = null) {
      hydrateState();
      await syncAuthenticatedAccess(authenticatedUser);
      renderAll();
      if (!eventsBound) {
        bindEvents();
        eventsBound = true;
      }
      ensureStateSyncListener();
      ensureAccessSyncMonitor();
      ensureChatSyncMonitor();
      ensureChatPresenceMonitor();
      await syncStartupData({ showErrorToast: true });
      if (isApiConfigured()) {
        void sendChatPresenceHeartbeat().catch((error) => console.error("No pude iniciar la presencia del chat.", error));
      }
      renderAll();
    },
    async syncAccess(authenticatedUser = null) {
      hydrateState();
      await syncAuthenticatedAccess(authenticatedUser);
      renderAll();
      ensureAccessSyncMonitor();
      ensureChatSyncMonitor();
      ensureChatPresenceMonitor();
      await syncStartupData({ showErrorToast: true });
      if (isApiConfigured()) {
        void sendChatPresenceHeartbeat().catch((error) => console.error("No pude sincronizar la presencia del chat.", error));
      }
      renderAll();
    },
    lock() {
      if (accessSyncIntervalId !== null) {
        window.clearInterval(accessSyncIntervalId);
        accessSyncIntervalId = null;
      }
      if (chatSyncIntervalId !== null) {
        window.clearInterval(chatSyncIntervalId);
        chatSyncIntervalId = null;
      }
      if (chatPresenceIntervalId !== null) {
        window.clearInterval(chatPresenceIntervalId);
        chatPresenceIntervalId = null;
      }
      accessSyncInFlight = false;
      chatSyncInFlight = false;
      chatPresenceInFlight = false;
      stopChatTyping();
      if (state) {
        state.chatPresenceByConversation = {};
      }
      currentUser = null;
      currentUserRoles = SYSTEM_ROLES.slice();
      currentUserViews = VIEW_DEFINITIONS.map((view) => view.id);
      if (elements.currentUserName) elements.currentUserName.textContent = "Sin sesion";
      if (elements.currentUserEmail) elements.currentUserEmail.textContent = "-";
    },
  };
}




