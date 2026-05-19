import { STORAGE_KEY } from "../core/config.js?v=20260514a";
import { seedState } from "../data/seed-state.js?v=20260519c";
import { REPORT_STATUSES, isApprovedReportStatus, isPendingApprovalStatus } from "../../../shared/contracts/reporting.js?v=20260514a";
import {
  createApiReport,
  createApiReportsBulk,
  fetchApiAnalyticsOverview,
  fetchApiAttendanceParticipants,
  fetchApiAttendanceSessions,
  fetchApiConceptPapers,
  fetchApiDeletedReports,
  fetchApiIndicators,
  fetchApiNotifications,
  fetchApiProgramCenters,
  fetchApiProgramManuals,
  fetchApiPrograms,
  fetchApiReports,
  getApiBaseUrl,
  isApiConfigured,
  updateApiReportStatus,
} from "./mel-api.js?v=20260519c";

const CHART_COLORS = ["#14b8a6", "#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];
let syncInFlight = false;
let analyticsInFlight = false;

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

function percent(value, total) {
  const safeTotal = asNumber(total);
  if (!safeTotal) return 0;
  return Math.round((asNumber(value) / safeTotal) * 100);
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

function commitStoredState(state, options = {}) {
  saveStoredState(state);
  if (options.broadcast !== false) {
    window.dispatchEvent(
      new CustomEvent("mel:state-synced", {
        detail: {
          source: options.source || "runtime-bridge",
        },
      }),
    );
  }
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
  nextState.programManuals = Array.isArray(savedState.programManuals) ? savedState.programManuals.slice() : [];
  nextState.programCenters = Array.isArray(savedState.programCenters) ? savedState.programCenters.slice() : seedState.programCenters || [];
  nextState.operationalProvinces = [
    ...new Set([...(savedState.operationalProvinces || []), ...(seedState.operationalProvinces || [])]),
  ].sort((a, b) => a.localeCompare(b));
  nextState.reports = Array.isArray(savedState.reports) ? savedState.reports.slice() : [];
  nextState.notifications = Array.isArray(savedState.notifications) ? savedState.notifications.slice() : [];
  nextState.reportDrafts = Array.isArray(savedState.reportDrafts) ? savedState.reportDrafts.slice() : [];
  nextState.actions = Array.isArray(savedState.actions) ? savedState.actions.slice() : [];
  nextState.formSubmissions = Array.isArray(savedState.formSubmissions) ? savedState.formSubmissions.slice() : [];
  nextState.attendanceParticipants = Array.isArray(savedState.attendanceParticipants) ? savedState.attendanceParticipants.slice() : [];
  nextState.attendanceSessions = Array.isArray(savedState.attendanceSessions) ? savedState.attendanceSessions.slice() : [];
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

  nextState.reports.filter((report) => isApprovedReportStatus(report.status)).forEach((report) => {
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

function mergeRemoteReports(localReports = [], remoteReports = [], deletedReportIds = new Set()) {
  const localById = new Map(localReports.map((report) => [report.id, report]));
  const merged = remoteReports
    .filter((report) => !deletedReportIds.has(report.id))
    .map((report) => ({
      ...(localById.get(report.id) || {}),
      ...report,
    }));

  return sortReports(merged);
}

function mapLocalReportToApi(report) {
  return {
    id: report.id,
    companyId: report.companyId || "org-default",
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
    attachments: Array.isArray(report.attachments) ? report.attachments : [],
    status: report.status || REPORT_STATUSES.PENDING_COORDINATION,
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

function readAnalyticsFilters() {
  const program = document.querySelector("#programFilter")?.value;
  const province = document.querySelector("#provinceFilter")?.value;
  const period = document.querySelector("#periodFilter")?.value;
  const scope = document.querySelector("#chartDataScopeSelect")?.value;
  return {
    program: program && program !== "Todos" ? program : undefined,
    province: province && province !== "Todas" ? province : undefined,
    period: period && period !== "Todos" ? period : undefined,
    scope: scope || undefined,
  };
}

function readChartTypes() {
  return {
    indicatorType: document.querySelector("#indicatorChartTypeSelect")?.value || "bars",
    periodType: document.querySelector("#periodChartTypeSelect")?.value || "donut",
  };
}

function colorForIndex(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

function formatValue(value) {
  const numeric = asNumber(value, null);
  if (numeric === null) return String(value || "0");
  return numeric.toLocaleString("es-DO");
}

function renderEmpty(containerId, message) {
  const container = document.querySelector(`#${containerId}`);
  if (!container) return;
  container.innerHTML = `<p class="item-meta">${message}</p>`;
}

function renderMetricCards(metrics = []) {
  const container = document.querySelector("#chartMetricGrid");
  if (!container) return;
  if (!metrics.length) {
    container.innerHTML = `<p class="item-meta">Todavia no hay una lectura analitica disponible.</p>`;
    return;
  }

  container.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card ${metric.type || "info"}">
          <p class="eyebrow">${metric.label}</p>
          <div class="value">${metric.value}</div>
          <div class="delta">${metric.delta || ""}</div>
        </article>
      `,
    )
    .join("");
}

function renderHorizontalBars(items = []) {
  return items
    .map((item, index) => {
      const safeTarget = asNumber(item.target);
      const progress = safeTarget ? Math.min(percent(item.value, safeTarget), 100) : 100;
      return `
        <div class="bar-row">
          <div class="bar-name">${item.label}</div>
          <div class="bar-track" aria-label="${progress}% de avance">
            <div class="bar-fill info" style="width:${Math.max(progress, 6)}%; background:${colorForIndex(index)};"></div>
          </div>
          <div class="bar-value">${formatValue(item.value)}</div>
        </div>
      `;
    })
    .join("");
}

function renderColumns(items = []) {
  const maxValue = Math.max(...items.map((item) => asNumber(item.value)), 1);
  return `
    <div style="display:grid;grid-template-columns:repeat(${items.length},minmax(0,1fr));gap:12px;align-items:end;min-height:240px;">
      ${items
        .map((item, index) => {
          const height = Math.max(18, Math.round((asNumber(item.value) / maxValue) * 180));
          return `
            <div style="display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:flex-end;">
              <strong style="font-size:0.85rem;">${formatValue(item.value)}</strong>
              <div style="width:100%;max-width:72px;height:${height}px;border-radius:8px 8px 0 0;background:${colorForIndex(index)};"></div>
              <span class="item-meta" style="text-align:center;">${item.label}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLine(items = []) {
  const width = 640;
  const height = 220;
  const padding = 28;
  const maxValue = Math.max(...items.map((item) => asNumber(item.value)), 1);
  const step = items.length > 1 ? (width - padding * 2) / (items.length - 1) : 0;
  const points = items
    .map((item, index) => {
      const x = padding + step * index;
      const y = height - padding - (asNumber(item.value) / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return `
    <div style="display:grid;gap:12px;">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia de reportes" style="width:100%;height:auto;overflow:visible;">
        <polyline fill="none" stroke="#2563eb" stroke-width="4" points="${points}" />
        ${items
          .map((item, index) => {
            const x = padding + step * index;
            const y = height - padding - (asNumber(item.value) / maxValue) * (height - padding * 2);
            return `<circle cx="${x}" cy="${y}" r="5" fill="#14b8a6"></circle>`;
          })
          .join("")}
      </svg>
      <div style="display:grid;grid-template-columns:repeat(${items.length},minmax(0,1fr));gap:12px;">
        ${items
          .map(
            (item) => `
              <div style="text-align:center;">
                <strong style="display:block;">${formatValue(item.value)}</strong>
                <span class="item-meta">${item.label}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderCircular(items = [], variant = "donut") {
  const total = Math.max(items.reduce((sum, item) => sum + asNumber(item.value), 0), 1);
  let offset = 0;
  const segments = items.map((item, index) => {
    const share = Math.max(asNumber(item.value) / total, 0);
    const start = Math.round(offset * 360);
    offset += share;
    const end = Math.round(offset * 360);
    return `${colorForIndex(index)} ${start}deg ${end}deg`;
  });

  return `
    <div style="display:grid;gap:18px;justify-items:center;">
      <div style="width:220px;height:220px;border-radius:50%;background:conic-gradient(${segments.join(",")});position:relative;">
        ${
          variant === "donut"
            ? '<div style="position:absolute;inset:28px;border-radius:50%;background:#ffffff;"></div>'
            : ""
        }
      </div>
      <div style="display:grid;gap:8px;width:100%;">
        ${items
          .map(
            (item, index) => `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <span style="display:flex;align-items:center;gap:8px;">
                  <span style="display:inline-block;width:12px;height:12px;border-radius:999px;background:${colorForIndex(index)};"></span>
                  <span>${item.label}</span>
                </span>
                <strong>${formatValue(item.value)} (${percent(item.value, total)}%)</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderSeries(containerId, items = [], type = "bars", emptyMessage = "No hay datos disponibles.") {
  const container = document.querySelector(`#${containerId}`);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<p class="item-meta">${emptyMessage}</p>`;
    return;
  }

  const limited = items.slice(0, 6);
  if (type === "columns") {
    container.innerHTML = renderColumns(limited);
    return;
  }
  if (type === "line") {
    container.innerHTML = renderLine(limited);
    return;
  }
  if (type === "pie") {
    container.innerHTML = renderCircular(limited, "pie");
    return;
  }
  if (type === "donut") {
    container.innerHTML = renderCircular(limited, "donut");
    return;
  }

  container.innerHTML = renderHorizontalBars(limited);
}

function renderStats(stats = []) {
  const container = document.querySelector("#chartStatsGrid");
  if (!container) return;
  if (!stats.length) {
    container.innerHTML = `<p class="item-meta">Todavia no hay estadisticas disponibles.</p>`;
    return;
  }

  container.innerHTML = stats
    .map(
      (item) => `
        <article class="metric-card info">
          <p class="eyebrow">${item.label}</p>
          <div class="value">${item.value}</div>
        </article>
      `,
    )
    .join("");
}

function renderInsights(insights = []) {
  const container = document.querySelector("#analysisBotList");
  if (!container) return;
  if (!insights.length) {
    container.innerHTML = `<p class="item-meta">El bot analista mostrara hallazgos cuando lleguen datos suficientes.</p>`;
    return;
  }

  container.innerHTML = insights
    .map(
      (insight) => `
        <article class="risk-item ${insight.severity === "danger" ? "danger" : ""}">
          <strong>${insight.title}</strong>
          <span class="risk-meta">${insight.message}</span>
        </article>
      `,
    )
    .join("");
}

function renderRemoteSubmissionList() {
  const state = normalizeState(readStoredState());
  const container = document.querySelector("#submissionList");
  if (!container) return;
  if (!state.formSubmissions.length) {
    container.innerHTML = `<p class="item-meta">Todavia no hay formularios importados.</p>`;
    return;
  }

  container.innerHTML = state.formSubmissions
    .map(
      (submission) => `
        <article class="action-item">
          <div class="action-top">
            <div>
              <h3>${submission.formTitle || submission.fileName}</h3>
              <p class="item-meta">${submission.program} · ${submission.period || "Sin periodo"}</p>
            </div>
            <span class="status-pill info">${submission.reportCount || 0} registros</span>
          </div>
          <p class="item-meta">${submission.fileName} · ${submission.processing || "automatico"}</p>
        </article>
      `,
    )
    .join("");
}

async function refreshAnalyticsOverview() {
  if (!isApiConfigured() || analyticsInFlight) return;
  analyticsInFlight = true;
  try {
    const filters = readAnalyticsFilters();
    const chartTypes = readChartTypes();
    const overview = await fetchApiAnalyticsOverview(filters);

    renderMetricCards(overview.metrics || []);
    renderSeries(
      "indicatorCharts",
      overview.charts?.indicators || [],
      chartTypes.indicatorType,
      "Todavia no hay indicadores aprobados para este filtro.",
    );
    renderSeries(
      "periodCharts",
      overview.charts?.periods || [],
      chartTypes.periodType,
      overview.scope?.applied === "approved"
        ? "Todavia no hay reportes aprobados en este periodo."
        : "Todavia no hay reportes visibles en este periodo.",
    );
    renderSeries(
      "programCharts",
      overview.charts?.programs || [],
      "bars",
      "Todavia no hay comparativa por programa disponible.",
    );
    renderSeries(
      "trendCharts",
      overview.charts?.periods || [],
      "line",
      "Todavia no hay tendencia suficiente para mostrar.",
    );
    renderStats(overview.stats || []);
    renderInsights(overview.insights || []);
    renderRemoteSubmissionList();
  } catch (error) {
    console.error(error);
  } finally {
    analyticsInFlight = false;
  }
}

async function pullRemoteReports() {
  const [remoteReports, deletedReports] = await Promise.all([
    fetchApiReports({ scope: "all" }),
    fetchApiDeletedReports(),
  ]);
  const deletedReportIds = new Set(deletedReports.map((report) => report.id));
  const currentState = normalizeState(readStoredState());
  const nextState = recomputeIndicators({
    ...currentState,
    reports: mergeRemoteReports(currentState.reports, remoteReports, deletedReportIds),
  });
  commitStoredState(nextState, { source: "pullRemoteReports" });
  return nextState;
}

async function pullRemoteNotifications() {
  const remoteNotifications = await fetchApiNotifications();
  const currentState = normalizeState(readStoredState());
  const nextState = recomputeIndicators({
    ...currentState,
    notifications: remoteNotifications,
  });
  commitStoredState(nextState, { source: "pullRemoteNotifications" });
  return nextState;
}

async function pullRemotePlanningData() {
  const [remotePrograms, remoteIndicators, remoteConceptPapers, remoteProgramCenters, remoteProgramManuals] = await Promise.all([
    fetchApiPrograms(),
    fetchApiIndicators(),
    fetchApiConceptPapers(),
    fetchApiProgramCenters(),
    fetchApiProgramManuals(),
  ]);
  const currentState = normalizeState(readStoredState());
  const nextState = recomputeIndicators({
    ...currentState,
    programs: remotePrograms.length ? remotePrograms : currentState.programs,
    indicators: remoteIndicators.length ? remoteIndicators : currentState.indicators,
    conceptPapers: remoteConceptPapers.length ? remoteConceptPapers : currentState.conceptPapers,
    programCenters: remoteProgramCenters,
    programManuals: remoteProgramManuals,
  });
  commitStoredState(nextState, { source: "pullRemotePlanningData" });
  return nextState;
}

async function pullRemoteAttendance() {
  const [attendanceParticipants, attendanceSessions] = await Promise.all([
    fetchApiAttendanceParticipants(),
    fetchApiAttendanceSessions(),
  ]);
  const currentState = normalizeState(readStoredState());
  const nextState = recomputeIndicators({
    ...currentState,
    attendanceParticipants,
    attendanceSessions,
  });
  commitStoredState(nextState, { source: "pullRemoteAttendance" });
  return nextState;
}

async function pushMissingReports() {
  const state = normalizeState(readStoredState());
  const [remoteReports, deletedReports] = await Promise.all([
    fetchApiReports({ scope: "all" }),
    fetchApiDeletedReports(),
  ]);
  const remoteIds = new Set(remoteReports.map((report) => report.id));
  const deletedReportIds = new Set(deletedReports.map((report) => report.id));
  const missingReports = state.reports.filter((report) => !remoteIds.has(report.id) && !deletedReportIds.has(report.id));

  if (!missingReports.length) {
    const nextState = recomputeIndicators({
      ...state,
      reports: mergeRemoteReports(state.reports, remoteReports, deletedReportIds),
    });
    commitStoredState(nextState, { source: "pushMissingReports" });
    return { state: nextState, remoteReports };
  }

  if (missingReports.length === 1) {
    await createApiReport(mapLocalReportToApi(missingReports[0]));
  } else {
    await createApiReportsBulk(missingReports.map(mapLocalReportToApi));
  }

  const refreshedReports = await fetchApiReports({ scope: "all" });
  const nextState = recomputeIndicators({
    ...state,
    reports: mergeRemoteReports(state.reports, refreshedReports, deletedReportIds),
  });
  commitStoredState(nextState, { source: "pushMissingReports" });
  return { state: nextState, remoteReports: refreshedReports };
}

async function pushReviewDecision(reportId) {
  const state = normalizeState(readStoredState());
  const localReport = state.reports.find((report) => report.id === reportId);
  if (!localReport) return;

  const remoteReports = await fetchApiReports({ scope: "all" });
  const remoteReport = remoteReports.find((report) => report.id === reportId);
  if (!remoteReport || remoteReport.status === localReport.status) return;

  if (
    ![
      REPORT_STATUSES.APPROVED,
      REPORT_STATUSES.NEEDS_CORRECTION,
      REPORT_STATUSES.REJECTED,
      "Pendiente",
    ].includes(localReport.status) &&
    !isPendingApprovalStatus(localReport.status)
  ) {
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
  await pullRemoteNotifications();
  await refreshAnalyticsOverview();
}

async function runSyncPass() {
  if (!isApiConfigured() || syncInFlight) return;
  syncInFlight = true;
  try {
    await pushMissingReports();
    await pullRemoteReports();
    await pullRemoteNotifications();
    await pullRemoteAttendance();
    await refreshAnalyticsOverview();
    updateConnectionBadge(true);
  } catch (error) {
    console.error(error);
    updateConnectionBadge(false, "API no disponible");
  } finally {
    syncInFlight = false;
  }
}

function scheduleAnalyticsRefresh(delay = 0) {
  window.setTimeout(() => {
    void refreshAnalyticsOverview();
  }, delay);
}

function bindAnalyticsRefreshTriggers() {
  [
    "#programFilter",
    "#provinceFilter",
    "#periodFilter",
    "#chartDataScopeSelect",
    "#indicatorChartTypeSelect",
    "#periodChartTypeSelect",
  ].forEach((selector) => {
    const element = document.querySelector(selector);
    if (!element) return;
    element.addEventListener("change", () => {
      scheduleAnalyticsRefresh(50);
    });
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.view === "charts") {
        scheduleAnalyticsRefresh(50);
      }
    });
  });
}

export async function bootstrapApiBridge() {
  if (!isApiConfigured()) {
    updateConnectionBadge(false);
    return { connected: false, baseUrl: null };
  }

  try {
    await pullRemotePlanningData();
    await pullRemoteReports();
    await pullRemoteNotifications();
    await pullRemoteAttendance();
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

  bindAnalyticsRefreshTriggers();

  window.addEventListener("mel:manual-refresh", () => {
    void runSyncPass();
    scheduleAnalyticsRefresh(50);
  });

  scheduleAnalyticsRefresh(100);
}
