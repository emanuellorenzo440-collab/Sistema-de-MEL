import { STORAGE_KEY } from "../core/config.js";
import { seedState } from "../data/seed-state.js";
import {
  createApiReport,
  createApiReportsBulk,
  fetchApiReports,
  getApiBaseUrl,
  isApiConfigured,
  updateApiReportStatus,
} from "./mel-api.js";

const SYNC_INTERVAL_MS = 6000;
let syncTimer = null;
let syncInFlight = false;

function clone(value) {
  return structuredClone(value);
}

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

function readStoredState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mergeByKey(savedItems = [], seedItems = [], keyFn) {
  const merged = [];
  const seen = new Set();

  savedItems.forEach((savedItem) => {
    const key = keyFn(savedItem);
    const seeded = seedItems.find((seedItem) => keyFn(seedItem) === key) || {};
    merged.push({ ...clone(seeded), ...savedItem });
    seen.add(key);
  });

  seedItems.forEach((seedItem) => {
    const key = keyFn(seedItem);
    if (!seen.has(key)) {
      merged.push(clone(seedItem));
    }
  });

  return merged;
}

function normalizeState(savedState = {}) {
  const nextState = { ...clone(seedState), ...savedState };
  nextState.programs = mergeByKey(savedState.programs || [], seedState.programs, (item) => item.name).map((program) => {
    const seeded = seedState.programs.find((item) => item.name === program.name) || {};
    return {
      ...seeded,
      ...program,
      expectedResults: program.expectedResults || seeded.expectedResults || [],
      primaryPopulation: program.primaryPopulation || seeded.primaryPopulation || "Participantes del programa",
    };
  });
  nextState.indicators = mergeByKey(savedState.indicators || [], seedState.indicators, (item) => item.id || item.name);
  nextState.monitoringForms = mergeByKey(savedState.monitoringForms || [], seedState.monitoringForms, (item) => item.id);
  nextState.conceptPapers = mergeByKey(savedState.conceptPapers || [], seedState.conceptPapers, (item) => item.id);
  nextState.reports = Array.isArray(savedState.reports) ? savedState.reports.slice() : [];
  nextState.actions = Array.isArray(savedState.actions) ? savedState.actions.slice() : [];
  nextState.formSubmissions = Array.isArray(savedState.formSubmissions) ? savedState.formSubmissions.slice() : [];
  nextState.chartPreferences = { ...seedState.chartPreferences, ...(savedState.chartPreferences || {}) };
  nextState.filters = { ...seedState.filters, ...(savedState.filters || {}) };
  nextState.role = savedState.role || seedState.role;
  nextState.designProgram = savedState.designProgram || nextState.programs[0]?.name;
  nextState.formsProgram = savedState.formsProgram || nextState.designProgram || nextState.programs[0]?.name;
  nextState.selectedConceptPaper = savedState.selectedConceptPaper || nextState.conceptPapers[0]?.id;
  return recomputeIndicators(nextState);
}

function recomputeIndicators(state) {
  const nextState = { ...state };
  const indicatorValues = new Map();

  nextState.reports.forEach((report) => {
    indicatorValues.set(report.indicatorId, (indicatorValues.get(report.indicatorId) || 0) + asNumber(report.value));
  });

  nextState.indicators = nextState.indicators.map((indicator) => ({
    ...indicator,
    value: indicatorValues.get(indicator.id) || 0,
  }));

  return nextState;
}

function sortReports(reports) {
  return reports
    .slice()
    .sort((left, right) => {
      const dateDiff = String(right.date || "").localeCompare(String(left.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return String(right.id || "").localeCompare(String(left.id || ""));
    });
}

function mergeRemoteReports(localReports = [], remoteReports = []) {
  const localById = new Map(localReports.map((report) => [report.id, report]));
  const merged = remoteReports.map((report) => ({
    ...(localById.get(report.id) || {}),
    ...report,
  }));

  localReports.forEach((report) => {
    if (!merged.find((candidate) => candidate.id === report.id)) {
      merged.push(report);
    }
  });

  return sortReports(merged);
}

function mapLocalReportToApi(report) {
  return {
    id: report.id,
    date: report.date,
    period: report.period,
    program: report.program,
    programId: report.programId || null,
    province: report.province,
    indicatorId: report.indicatorId,
    value: asNumber(report.value),
    women: asNumber(report.women),
    men: asNumber(report.men),
    youth: asNumber(report.youth),
    owner: report.owner,
    evidence: report.evidence || "",
    notes: report.notes || "",
    status: report.status || "Pendiente",
    sourceFormId: report.sourceFormId || null,
    submissionId: report.submissionId || null,
  };
}

function currentActorId(state) {
  return `local-${slugify(state.role || "usuario")}`;
}

function updateConnectionBadge(connected, message) {
  const badge = document.querySelector("#draftStatus");
  if (!badge) return;

  if (!isApiConfigured()) {
    badge.textContent = "Borrador local";
    badge.className = "status-pill neutral";
    return;
  }

  badge.textContent = connected ? "API conectada" : message || "API no disponible";
  badge.className = `status-pill ${connected ? "good" : "warning"}`;
}

async function pullRemoteReports() {
  const remoteReports = await fetchApiReports({ scope: "all" });
  const currentState = normalizeState(readStoredState());
  const nextState = recomputeIndicators({
    ...currentState,
    reports: mergeRemoteReports(currentState.reports, remoteReports),
  });
  saveStoredState(nextState);
  return nextState;
}

async function pushMissingReports() {
  const state = normalizeState(readStoredState());
  const remoteReports = await fetchApiReports({ scope: "all" });
  const remoteIds = new Set(remoteReports.map((report) => report.id));
  const missingReports = state.reports.filter((report) => !remoteIds.has(report.id));

  if (!missingReports.length) {
    return { state, remoteReports };
  }

  if (missingReports.length === 1) {
    await createApiReport(mapLocalReportToApi(missingReports[0]));
  } else {
    await createApiReportsBulk(missingReports.map(mapLocalReportToApi));
  }

  const refreshedReports = await fetchApiReports({ scope: "all" });
  const nextState = recomputeIndicators({
    ...state,
    reports: mergeRemoteReports(state.reports, refreshedReports),
  });
  saveStoredState(nextState);
  return { state: nextState, remoteReports: refreshedReports };
}

async function pushReviewDecision(reportId) {
  const state = normalizeState(readStoredState());
  const localReport = state.reports.find((report) => report.id === reportId);
  if (!localReport) return;

  const remoteReports = await fetchApiReports({ scope: "all" });
  const remoteReport = remoteReports.find((report) => report.id === reportId);
  if (!remoteReport || remoteReport.status === localReport.status) return;

  if (!["Aprobado", "Necesita correccion", "Rechazado", "Pendiente"].includes(localReport.status)) {
    return;
  }

  const note =
    localReport.status === "Necesita correccion"
      ? localReport.reviewNote || localReport.notes || "Requiere ajustes antes de entrar a lectura ejecutiva."
      : localReport.reviewNote || localReport.notes || "Revision registrada desde la interfaz web.";

  await updateApiReportStatus(reportId, {
    status: localReport.status,
    actorId: currentActorId(state),
    actorRole: state.role,
    note,
  });

  await pullRemoteReports();
}

async function runSyncPass() {
  if (!isApiConfigured() || syncInFlight) return;
  syncInFlight = true;
  try {
    await pushMissingReports();
    await pullRemoteReports();
    updateConnectionBadge(true);
  } catch (error) {
    console.error(error);
    updateConnectionBadge(false, "API no disponible");
  } finally {
    syncInFlight = false;
  }
}

export async function bootstrapApiBridge() {
  if (!isApiConfigured()) {
    updateConnectionBadge(false);
    return { connected: false, baseUrl: null };
  }

  try {
    await pullRemoteReports();
    updateConnectionBadge(true);
    return { connected: true, baseUrl: getApiBaseUrl() };
  } catch (error) {
    console.error(error);
    updateConnectionBadge(false, "API no disponible");
    return { connected: false, baseUrl: getApiBaseUrl() };
  }
}

export function startRuntimeBridge() {
  if (!isApiConfigured()) {
    updateConnectionBadge(false);
    return;
  }

  const reportForm = document.querySelector("#reportForm");
  if (reportForm) {
    reportForm.addEventListener(
      "submit",
      () => {
        window.setTimeout(() => {
          void runSyncPass();
        }, 300);
      },
      true,
    );
  }

  const uploadButton = document.querySelector("#uploadFormButton");
  if (uploadButton) {
    uploadButton.addEventListener("click", () => {
      window.setTimeout(() => {
        void runSyncPass();
      }, 1200);
    });
  }

  const reviewList = document.querySelector("#reviewList");
  if (reviewList) {
    reviewList.addEventListener("click", (event) => {
      const approveId = event.target?.dataset?.approve;
      const returnId = event.target?.dataset?.return;
      const reportId = approveId || returnId;
      if (!reportId) return;

      window.setTimeout(() => {
        void pushReviewDecision(reportId).catch((error) => {
          console.error(error);
          updateConnectionBadge(false, "Revision no sincronizada");
        });
      }, 0);
    });
  }

  if (!syncTimer) {
    syncTimer = window.setInterval(() => {
      void runSyncPass();
    }, SYNC_INTERVAL_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void runSyncPass();
    }
  });

  void runSyncPass();
}
