import { STORAGE_KEY } from "../core/config.js";
import { $, $$, elements } from "../core/dom.js";
import { loadStoredState, saveStoredState } from "../core/storage.js";
import { seedState } from "../data/seed-state.js";
import {
  REPORT_STATUSES,
  canReviewReports,
  isApprovedReportStatus,
  isPendingApprovalStatus,
  reviewRoleForStatus,
} from "../../../shared/contracts/reporting.js";
import {
  createApiIndicator,
  createApiProgram,
  deleteApiIndicator,
  deleteApiProgram,
  isApiConfigured,
  markApiNotificationRead,
  updateApiIndicator,
  updateApiProgram,
} from "../services/mel-api.js";
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
} from "../shared/utils.js";

let state = loadState();

function loadState() {
  return loadStoredState(STORAGE_KEY, seedState, normalizeState);
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
    return {
      ...seeded,
      ...program,
      expectedResults: program.expectedResults || seeded.expectedResults || [],
      primaryPopulation: program.primaryPopulation || seeded.primaryPopulation || "Participantes del programa",
      coordinatorEmail: program.coordinatorEmail || seeded.coordinatorEmail || "",
      programManagerEmail: program.programManagerEmail || seeded.programManagerEmail || "",
      melSupervisorEmail: program.melSupervisorEmail || seeded.melSupervisorEmail || "",
    };
  });
  nextState.indicators = mergeByKey(savedState.indicators || [], seedState.indicators, (item) => item.id || item.name);
  nextState.monitoringForms = mergeByKey(savedState.monitoringForms || [], seedState.monitoringForms, (item) => item.id);
  nextState.conceptPapers = mergeByKey(savedState.conceptPapers || [], seedState.conceptPapers, (item) => item.id);
  nextState.notifications = Array.isArray(savedState.notifications) ? savedState.notifications : [];
  nextState.reportDrafts = Array.isArray(savedState.reportDrafts) ? savedState.reportDrafts : [];
  nextState.formSubmissions = savedState.formSubmissions || [];
  nextState.chartPreferences = { ...seedState.chartPreferences, ...(savedState.chartPreferences || {}) };
  nextState.designProgram = savedState.designProgram || nextState.programs[0]?.name;
  nextState.formsProgram = savedState.formsProgram || nextState.designProgram || nextState.programs[0]?.name;
  nextState.selectedConceptPaper = savedState.selectedConceptPaper || nextState.conceptPapers[0]?.id;
  return nextState;
}

function saveState() {
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

function renderFilters() {
  const programs = ["Todos", ...state.programs.map((program) => program.name)];
  const provinces = ["Todas", ...unique(state.programs.flatMap((program) => program.provinces))];
  const periods = ["Todos", ...unique(state.reports.map((report) => report.period)).reverse()];
  const programNames = state.programs.map((program) => program.name);
  const provinceNames = unique(state.programs.flatMap((program) => program.provinces));
  const selectedProgram = state.programs[0]?.name || "";
  const selectedProvince = provinceNames[0] || "";
  const selectedIndicator = state.indicators[0]?.name || "";

  setOptions(elements.programFilter, programs, state.filters.program);
  setOptions(elements.provinceFilter, provinces, state.filters.province);
  setOptions(elements.periodFilter, periods, state.filters.period);
  setOptions(elements.reportProgram, programNames, selectedProgram);
  setOptions(elements.reportProvince, provinceNames, selectedProvince);
  setOptions(elements.reportIndicator, state.indicators.map((indicator) => indicator.name), selectedIndicator);
  setOptions(elements.indicatorProgramInput, programNames, elements.indicatorProgramInput?.value || selectedProgram);
  setOptions(elements.designProgramSelect, programNames, state.designProgram || selectedProgram);
  setOptions(elements.formsProgramSelect, programNames, state.formsProgram || state.designProgram || selectedProgram);
  elements.reportPeriod.value = state.filters.period === "Todos" ? currentMonth() : state.filters.period;
  elements.roleSelect.value = state.role || "Facilitador";
  if (elements.indicatorChartTypeSelect) {
    elements.indicatorChartTypeSelect.value = state.chartPreferences?.indicatorType || "bars";
  }
  if (elements.periodChartTypeSelect) {
    elements.periodChartTypeSelect.value = state.chartPreferences?.periodType || "donut";
  }
  if (elements.chartDataScopeSelect) {
    elements.chartDataScopeSelect.value = getChartDataScope();
  }
}

function canValidate() {
  return canReviewReports(state.role || "");
}

function renderMetrics() {
  const reports = getFilteredReports();
  const totalValue = state.indicators.reduce((sum, indicator) => sum + indicator.value, 0);
  const totalTarget = state.indicators.reduce((sum, indicator) => sum + indicator.target, 0);
  const overallProgress = percent(totalValue, totalTarget);
  const pending = state.reports.filter((report) => isPendingApprovalStatus(report.status)).length;
  const riskCount = state.indicators.filter((indicator) => percent(indicator.value, indicator.target) < 70).length;
  const participants = reports.reduce((sum, report) => sum + report.women + report.men, 0);

  const metrics = [
    { label: "Cumplimiento global", value: `${overallProgress}%`, delta: "avance consolidado", type: statusForProgress(overallProgress) },
    { label: "Reportes del periodo", value: reports.length, delta: "segun filtros activos", type: "info" },
    { label: "Pendientes de validar", value: pending, delta: "en cola de supervision", type: pending > 0 ? "warning" : "good" },
    { label: "Participantes", value: participants.toLocaleString("es-DO"), delta: "mujeres y hombres", type: riskCount ? "warning" : "good" },
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

function renderProgramChart() {
  elements.programChart.innerHTML = state.programs
    .map((program) => {
      const indicators = state.indicators.filter((indicator) => indicator.program === program.name);
      const value = indicators.reduce((sum, indicator) => sum + indicator.value, 0);
      const target = indicators.reduce((sum, indicator) => sum + indicator.target, 0);
      const progress = percent(value, target);
      const risk = statusForProgress(progress);
      return `
        <div class="bar-row">
          <div class="bar-name">${program.name}</div>
          <div class="bar-track" aria-label="${progress}% de avance">
            <div class="bar-fill ${risk}" style="width: ${progress}%"></div>
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
        <td colspan="6" class="empty-cell">Todavia no hay reportes cargados.</td>
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
  if (report.status === "Pendiente") return REPORT_STATUSES.PENDING_PROGRAM_MANAGER;
  if (report.status === REPORT_STATUSES.PENDING_COORDINATION) return REPORT_STATUSES.PENDING_PROGRAM_MANAGER;
  if (report.status === REPORT_STATUSES.PENDING_PROGRAM_MANAGER) return REPORT_STATUSES.PENDING_MEL;
  if (report.status === REPORT_STATUSES.PENDING_MEL) return REPORT_STATUSES.APPROVED;
  return REPORT_STATUSES.APPROVED;
}

function approvalButtonLabel(report) {
  if (report.status === "Pendiente") return "Enviar a Program Manager";
  if (report.status === REPORT_STATUSES.PENDING_COORDINATION) return "Enviar a Program Manager";
  if (report.status === REPORT_STATUSES.PENDING_PROGRAM_MANAGER) return "Enviar a Supervision M&E";
  if (report.status === REPORT_STATUSES.PENDING_MEL) return "Aprobar final";
  return "Aprobar";
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
  const activePaper = selectedConceptPaper();
  elements.conceptCount.textContent = `${papers.length} ${papers.length === 1 ? "documento" : "documentos"}`;

  elements.conceptPaperList.innerHTML = papers
    .map(
      (paper) => `
        <article class="concept-card ${paper.id === activePaper?.id ? "active" : ""}">
          <div>
            <p class="eyebrow">${paper.year} · ${paper.status}</p>
            <h3>${paper.title}</h3>
            <p class="item-meta">${paper.program} · ${paper.presenter}</p>
          </div>
          <div class="concept-actions">
            <button class="ghost-action" data-concept-id="${paper.id}" type="button">Ver resumen</button>
            <a class="ghost-link" href="${localFileUrl(paper.path)}" target="_blank" rel="noreferrer">Abrir PDF</a>
          </div>
        </article>
      `,
    )
    .join("");

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
          <span aria-hidden="true">⇩</span>
          CSV
        </button>
        <button class="ghost-action" data-download-word="${form.id}" type="button">
          <span aria-hidden="true">⇩</span>
          Word
        </button>
        <button class="ghost-action" data-download-pdf="${form.id}" type="button">
          <span aria-hidden="true">⇩</span>
          PDF
        </button>
      </div>
    </article>
  `;
}

function renderReviewQueue() {
  const currentRole = state.role || "Facilitador";
  const pendingReports = state.reports.filter((report) => reviewRoleForStatus(report.status) === currentRole);
  const validationEnabled = canValidate();
  elements.reviewList.innerHTML = pendingReports.length
    ? pendingReports
        .map((report) => {
          const indicator = indicatorById(report.indicatorId);
          return `
            <article class="review-item">
              <div class="review-top">
                <div>
                  <h3>${report.program}</h3>
                  <p class="item-meta">${indicator?.name ?? "Indicador eliminado"} · ${report.province}</p>
                </div>
                <span class="status-pill ${classForReportStatus(report.status)}">${report.status}</span>
              </div>
              <p>${report.value.toLocaleString("es-DO")} reportados por ${report.owner}. Evidencia: ${report.evidence || "Sin evidencia"}</p>
              <div class="review-actions">
                <button class="approve-button" data-approve="${report.id}" type="button" ${validationEnabled ? "" : "disabled"}>✓ Aprobar</button>
                <button class="return-button" data-return="${report.id}" type="button" ${validationEnabled ? "" : "disabled"}>↵ Solicitar correccion</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<p class="item-meta">No hay reportes pendientes.</p>`;

  pendingReports.forEach((report) => {
    const button = elements.reviewList.querySelector(`[data-approve="${report.id}"]`);
    if (button) {
      button.textContent = approvalButtonLabel(report);
    }
  });
}

function renderNotificationCard(notification) {
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
        <button type="button" data-read-notification="${notification.id}">Marcar leida</button>
      </div>
    </article>
  `;
}

function renderNotifications() {
  const visibleNotifications = notificationsForActiveRole();
  const countText = `${visibleNotifications.length} pendiente${visibleNotifications.length === 1 ? "" : "s"}`;
  elements.notificationCount.textContent = countText;
  elements.notificationCount.className = `status-pill ${visibleNotifications.length ? "warning" : "good"}`;
  const markup = visibleNotifications.length
    ? visibleNotifications.slice(0, 6).map(renderNotificationCard).join("")
    : `<p class="item-meta">No hay alertas pendientes para tu perfil.</p>`;

  elements.notificationList.innerHTML = markup;
  elements.supervisionNotificationList.innerHTML = visibleNotifications.length
    ? visibleNotifications.slice(0, 3).map(renderNotificationCard).join("")
    : `<p class="item-meta">Sin alertas internas pendientes.</p>`;
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
            <span>${program.beneficiaries.toLocaleString("es-DO")} beneficiarios</span>
            <span>${program.budget} presupuesto</span>
            <span>${program.provinces.join(", ")}</span>
          </div>
          <div class="item-actions">
            <button type="button" data-edit-program="${program.id}">Editar</button>
            <button type="button" data-delete-program="${program.id}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
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
      meta: "valor reportado",
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
  const participants = reports.reduce((sum, report) => sum + Number(report.women || 0) + Number(report.men || 0), 0);
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
    { label: "Participacion reportada", value: participants.toLocaleString("es-DO"), meta: "mujeres y hombres acumulados", tone: participants ? "info" : "neutral" },
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
  const role = state.role || "Facilitador";
  elements.roleBadge.textContent = role;
  elements.roleBadge.className = `status-pill ${canValidate() ? "info" : "neutral"}`;
}

function renderAll() {
  recomputeIndicatorValues();
  renderFilters();
  updateRoleUi();
  renderMetrics();
  renderProgramChart();
  renderRisks();
  renderReports();
  renderReportDrafts();
  renderIndicators();
  renderDesignStudio();
  renderForms();
  renderCharts();
  renderConceptPapers();
  renderNotifications();
  renderReviewQueue();
  renderActions();
  renderPrograms();
}

function switchView(viewName) {
  const titles = {
    dashboard: "Resumen ejecutivo",
    report: "Nuevo reporte",
    indicators: "Matriz de indicadores",
    design: "Diseno de monitoreo y evaluacion",
    forms: "Formularios descargables",
    charts: "Graficas automaticas",
    concepts: "Concept papers",
    supervision: "Supervision y validacion",
    programs: "Programas",
  };
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === viewName));
  elements.pageTitle.textContent = titles[viewName];
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
    companyId: report.companyId || "org-default",
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
  elements.reportPeriod.value = draft.period || currentMonth();
  document.querySelector("#reportOwner").value = draft.owner || "";
  document.querySelector("#reportValue").value = draft.value || 0;
  document.querySelector("#reportWomen").value = draft.women || 0;
  document.querySelector("#reportMen").value = draft.men || 0;
  document.querySelector("#reportYouth").value = draft.youth || 0;
  document.querySelector("#reportEvidence").value = draft.evidence || "";
  document.querySelector("#reportNotes").value = draft.botSummary || draft.notes || "";
}

function renderReportDrafts() {
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
                <span>${draft.province || "Centros de programa"}</span>
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

function buildDraftsFromImportedRows(rows, fileName) {
  const { form, reports, submissionId } = rowsToReports(rows, fileName);
  const drafts = reports.map((report) => ({
    ...report,
    sourceFileName: fileName,
    formTitle: form.title,
    submissionId,
    botSummary: botSummaryForDraft(report, form.title),
  }));
  return { form, drafts, submissionId };
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
  reader.onload = () => {
    try {
      const rows = parseCsv(String(reader.result || ""));
      const { drafts } = buildDraftsFromImportedRows(rows, file.name);
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

function submitDraftReports() {
  const drafts = state.reportDrafts || [];
  if (!drafts.length) {
    showToast("No hay borradores listos para enviar.");
    return;
  }

  drafts.forEach((draft) => {
    queueReportForReview({
      ...draft,
      botSummary: undefined,
      formTitle: undefined,
      sourceFileName: undefined,
    });
  });

  state.formSubmissions.unshift({
    id: drafts[0].submissionId || `sub-${Date.now()}`,
    fileName: drafts[0].sourceFileName || "formulario.csv",
    formId: drafts[0].sourceFormId || null,
    formTitle: drafts[0].formTitle || "Formulario importado",
    program: drafts[0].program,
    period: drafts[0].period,
    reportCount: drafts.length,
    importedAt: new Date().toISOString(),
    sourceType: "csv",
    processing: "automatico",
  });

  state.reportDrafts = [];
  saveState();
  renderAll();
  switchView("supervision");
  elements.reportUploadStatus.textContent = "Enviados";
  elements.reportUploadStatus.className = "status-pill good";
  elements.reportUploadPreview.innerHTML = `<p class="item-meta">${drafts.length} borradores fueron enviados a la cadena de revision.</p>`;
  showToast("Borradores enviados a revision.");
}

function addReport(formData) {
  const indicator = state.indicators.find((item) => item.name === formData.get("indicator"));
  const value = Number(formData.get("value"));
  const newReport = {
    id: `rep-${Date.now()}`,
    companyId: "org-default",
    date: new Date().toISOString().slice(0, 10),
    period: formData.get("period"),
    program: formData.get("program"),
    programId: state.programs.find((program) => program.name === formData.get("program"))?.id || null,
    province: formData.get("province"),
    indicatorId: indicator.id,
    value,
    women: Number(formData.get("women") || 0),
    men: Number(formData.get("men") || 0),
    youth: Number(formData.get("youth") || 0),
    owner: formData.get("owner"),
    evidence: formData.get("evidence"),
    notes: formData.get("notes"),
    status: REPORT_STATUSES.PENDING_COORDINATION,
  };

  queueReportForReview(newReport);
  saveState();
  renderAll();
  showToast("Reporte enviado a coordinacion para primera aprobacion.");
}

function exportCsv() {
  const rows = [
    ["fecha", "periodo", "programa", "provincia", "indicador", "valor", "mujeres", "hombres", "jovenes", "responsable", "estado"],
    ...state.reports.map((report) => [
      report.date,
      report.period,
      report.program,
      report.province,
      indicatorById(report.indicatorId)?.name ?? "",
      report.value,
      report.women,
      report.men,
      report.youth,
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

  dataRows.forEach((row, rowIndex) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] || "";
    });

    (form.mappings || []).forEach((mapping) => {
      const indicator = indicatorById(mapping.indicatorId);
      const value = parseMetricValue(record[mapping.field], mapping.mode);
      if (!indicator || value <= 0) return;

      reports.push({
        id: `rep-${Date.now()}-${rowIndex}-${mapping.indicatorId}`,
        date: record.fecha || new Date().toISOString().slice(0, 10),
        period: record.periodo || currentMonth(),
        program: form.program,
        province: record.provincia || "Centros de programa",
        indicatorId: indicator.id,
        value,
        women: indicator.unit === "chicas" ? value : 0,
        men: 0,
        youth: indicator.unit === "chicas" ? value : 0,
        owner: record.responsable || metadata.responsable || form.owner,
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
    state.formSubmissions.unshift({
      id: `sub-${Date.now()}`,
      fileName: file.name,
      formId: null,
      formTitle: "Archivo de soporte",
      program: selectedProgram.name,
      period: currentMonth(),
      reportCount: 0,
      importedAt: new Date().toISOString(),
      sourceType: extension,
      processing: "soporte",
    });
    saveState();
    renderAll();
    elements.uploadStatus.textContent = "Soporte cargado";
    elements.uploadStatus.className = "status-pill info";
    elements.uploadPreview.innerHTML = `<p class="item-meta">${file.name} fue subido como soporte. Para alimentar graficas automaticamente, usa la plantilla CSV del sistema.</p>`;
    showToast("Archivo subido como soporte.");
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
    try {
      const rows = parseCsv(String(reader.result || ""));
      const { form, reports, submissionId } = rowsToReports(rows, file.name);

      if (!reports.length) {
        elements.uploadPreview.innerHTML = `<p class="item-meta">El formulario fue leido, pero no encontre valores que alimenten indicadores.</p>`;
        showToast("No se importaron indicadores.");
        return;
      }

      reports.forEach((report) => {
        queueReportForReview(report);
      });

      state.formSubmissions.unshift({
        id: submissionId,
        fileName: file.name,
        formId: form.id,
        formTitle: form.title,
        program: form.program,
        period: reports[0].period,
        reportCount: reports.length,
        importedAt: new Date().toISOString(),
        sourceType: extension,
        processing: "automatico",
      });
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
        "Participantes por sexo y edad",
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
  const role = state.role || "Facilitador";
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
    owner: formData.get("owner"),
    due: formData.get("due"),
    type: "Logro",
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
  elements.programProvincesInput.value = "Centros de programa";
  elements.programCoordinatorEmailInput.value = "";
  elements.programManagerEmailInput.value = "";
  elements.programMelSupervisorEmailInput.value = "";
}

function fillProgramForm(program) {
  elements.programIdInput.value = program.id;
  elements.programNameInput.value = program.name;
  elements.programLeadInput.value = program.lead;
  elements.programBeneficiariesInput.value = program.beneficiaries;
  elements.programBudgetInput.value = program.budget;
  elements.programProvincesInput.value = (program.provinces || []).join(", ");
  elements.programCoordinatorEmailInput.value = program.coordinatorEmail || "";
  elements.programManagerEmailInput.value = program.programManagerEmail || "";
  elements.programMelSupervisorEmailInput.value = program.melSupervisorEmail || "";
  elements.programFocusInput.value = program.focus;
  elements.programPopulationInput.value = program.primaryPopulation || "";
}

async function saveProgramFromForm(formData) {
  const programId = formData.get("id");
  const payload = {
    id: programId || undefined,
    name: formData.get("name"),
    lead: formData.get("lead"),
    beneficiaries: Number(formData.get("beneficiaries") || 0),
    budget: formData.get("budget"),
    coordinatorEmail: formData.get("coordinatorEmail"),
    programManagerEmail: formData.get("programManagerEmail"),
    melSupervisorEmail: formData.get("melSupervisorEmail"),
    provinces: String(formData.get("provinces") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    focus: formData.get("focus"),
    primaryPopulation: formData.get("primaryPopulation"),
    expectedResults: programId ? state.programs.find((program) => program.id === programId)?.expectedResults || [] : [],
  };

  try {
    const previous = state.programs.find((program) => program.id === programId);
    const saved = isApiConfigured()
      ? programId
        ? await updateApiProgram(programId, payload)
        : await createApiProgram(payload)
      : { ...payload, id: programId || `prog-${slugify(payload.name)}-${Date.now()}` };
    upsertById(state.programs, saved);
    if (previous && previous.name !== saved.name) {
      state.indicators = state.indicators.map((indicator) =>
        indicator.program === previous.name ? { ...indicator, program: saved.name, programId: saved.id } : indicator,
      );
      state.reports = state.reports.map((report) =>
        report.program === previous.name ? { ...report, program: saved.name, programId: saved.id } : report,
      );
    }
    saveState();
    renderAll();
    resetProgramForm();
    showToast(programId ? "Programa actualizado." : "Programa creado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No pude guardar el programa.");
  }
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#quickReportButton").addEventListener("click", () => switchView("report"));

  $("#seedButton").addEventListener("click", () => {
    state = structuredClone(seedState);
    saveState();
    renderAll();
    showToast("Base del concept paper reiniciada.");
  });

  $("#clearFormButton").addEventListener("click", () => {
    elements.reportForm.reset();
    elements.reportPeriod.value = state.filters.period === "Todos" ? currentMonth() : state.filters.period;
  });
  elements.reportFormUploadInput.addEventListener("change", () => {
    const file = elements.reportFormUploadInput.files?.[0];
    elements.reportUploadStatus.textContent = file ? file.name : "Sin archivo";
    elements.reportUploadStatus.className = `status-pill ${file ? "info" : "neutral"}`;
  });
  elements.analyzeReportFormButton.addEventListener("click", () => {
    analyzeReportFormFile(elements.reportFormUploadInput.files?.[0]);
  });
  elements.applyFirstDraftButton.addEventListener("click", () => {
    const firstDraft = state.reportDrafts?.[0];
    if (!firstDraft) {
      showToast("No hay borradores para cargar.");
      return;
    }
    applyDraftToReportForm(firstDraft);
    showToast("Primer borrador cargado en captura.");
  });
  elements.submitDraftReportsButton.addEventListener("click", submitDraftReports);
  elements.reportDraftList.addEventListener("click", (event) => {
    const draftIndex = Number(event.target.closest("[data-apply-draft]")?.dataset.applyDraft);
    if (Number.isNaN(draftIndex)) return;
    const draft = state.reportDrafts?.[draftIndex];
    if (!draft) return;
    applyDraftToReportForm(draft);
    showToast("Borrador cargado en captura.");
  });

  $("#exportButton").addEventListener("click", exportCsv);

  [elements.programFilter, elements.provinceFilter, elements.periodFilter].forEach((filter) => {
    filter.addEventListener("change", () => {
      state.filters.program = elements.programFilter.value;
      state.filters.province = elements.provinceFilter.value;
      state.filters.period = elements.periodFilter.value;
      saveState();
      renderAll();
    });
  });

  elements.roleSelect.addEventListener("change", () => {
    state.role = elements.roleSelect.value;
    saveState();
    renderAll();
    showToast(`Perfil activo: ${state.role}.`);
  });

  [elements.notificationList, elements.supervisionNotificationList].forEach((list) => {
    list.addEventListener("click", (event) => {
      const reportId = event.target.closest("[data-open-report]")?.dataset.openReport;
      const notificationId = event.target.closest("[data-read-notification]")?.dataset.readNotification;

      if (reportId) {
        switchView("supervision");
      }

      if (notificationId) {
        void (async () => {
          try {
            if (isApiConfigured()) {
              await markApiNotificationRead(notificationId, { actorId: `local-${slugify(state.role || "usuario")}` });
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
    const indicators = state.indicators.filter((indicator) => indicator.program === elements.reportProgram.value);
    setOptions(elements.reportIndicator, indicators.map((indicator) => indicator.name), indicators[0]?.name);
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
    addReport(new FormData(elements.reportForm));
    elements.reportForm.reset();
    elements.reportPeriod.value = state.filters.period === "Todos" ? currentMonth() : state.filters.period;
    switchView("dashboard");
  });

  elements.reviewList.addEventListener("click", (event) => {
    const approveId = event.target.dataset.approve;
    const returnId = event.target.dataset.return;
    const report = state.reports.find((item) => item.id === approveId || item.id === returnId);
    if (!report) return;

    if (approveId) {
      report.status = nextApprovalStatusForReport(report);
      state.notifications = (state.notifications || []).filter((notification) => notification.reportId !== report.id);
      state.notifications = [...createLocalReviewNotifications(report), ...state.notifications];
      showToast(
        report.status === REPORT_STATUSES.APPROVED
          ? "Reporte aprobado y habilitado para analitica."
          : `Reporte enviado a ${reviewRoleForStatus(report.status)}.`,
      );
    }

    if (returnId) {
      report.status = REPORT_STATUSES.NEEDS_CORRECTION;
      state.notifications = (state.notifications || []).filter((notification) => notification.reportId !== report.id);
      state.actions.unshift({
        title: `Corregir reporte de ${report.program}`,
        owner: report.owner,
        due: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        program: report.program,
        status: "Abierto",
      });
      showToast("Correccion solicitada.");
    }

    saveState();
    renderAll();
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
            await deleteApiIndicator(deleteId);
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
    const editId = event.target.closest("[data-edit-program]")?.dataset.editProgram;
    const deleteId = event.target.closest("[data-delete-program]")?.dataset.deleteProgram;

    if (editId) {
      const program = state.programs.find((item) => item.id === editId);
      if (program) fillProgramForm(program);
    }

    if (deleteId) {
      const hasIndicators = state.indicators.some((indicator) => indicator.programId === deleteId);
      const hasReports = state.reports.some((report) => report.programId === deleteId);
      if (hasIndicators || hasReports) {
        showToast("No se puede eliminar un programa con datos asociados.");
        return;
      }
      void (async () => {
        try {
          if (isApiConfigured()) {
            await deleteApiProgram(deleteId);
          }
          removeById(state.programs, deleteId);
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

  $("#addIndicatorButton").addEventListener("click", () => {
    const next = state.indicators.length + 1;
    const program = selectedProgramForIndicatorForm();
    resetIndicatorForm();
    elements.indicatorProgramInput.value = program?.name || "";
    elements.indicatorNameInput.value = `Nuevo indicador ${next}`;
    elements.indicatorTargetInput.value = 100;
    elements.indicatorNameInput.focus();
  });
}

export function createMonitoringApp() {
  return {
    start() {
      renderAll();
      bindEvents();
    },
  };
}
