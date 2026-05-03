import { STORAGE_KEY } from "../core/config.js";
import { $, $$, elements } from "../core/dom.js";
import { loadStoredState, saveStoredState } from "../core/storage.js";
import { seedState } from "../data/seed-state.js";
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
    };
  });
  nextState.indicators = mergeByKey(savedState.indicators || [], seedState.indicators, (item) => item.id || item.name);
  nextState.monitoringForms = mergeByKey(savedState.monitoringForms || [], seedState.monitoringForms, (item) => item.id);
  nextState.conceptPapers = mergeByKey(savedState.conceptPapers || [], seedState.conceptPapers, (item) => item.id);
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
}

function canValidate() {
  return ["Program Manager", "Director Nacional", "Supervision M&E"].includes(state.role);
}

function renderMetrics() {
  const reports = getFilteredReports();
  const totalValue = state.indicators.reduce((sum, indicator) => sum + indicator.value, 0);
  const totalTarget = state.indicators.reduce((sum, indicator) => sum + indicator.target, 0);
  const overallProgress = percent(totalValue, totalTarget);
  const pending = state.reports.filter((report) => report.status === "Pendiente").length;
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
  if (status === "Aprobado") return "good";
  if (status === "Pendiente") return "pending";
  return "danger";
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
  const pendingReports = state.reports.filter((report) => report.status !== "Aprobado");
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
  if (type === "pie") return renderCircularSeries(series, emptyMessage, "pie");
  if (type === "donut") return renderCircularSeries(series, emptyMessage, "donut");
  return renderBarSeries(series, emptyMessage);
}

function renderCharts() {
  const reports = getFilteredReports();
  const totalReports = reports.length;
  const totalUploaded = state.formSubmissions.length;
  const totalValue = reports.reduce((sum, report) => sum + Number(report.value || 0), 0);
  const activeIndicators = buildIndicatorChartSeries(reports).length;
  const indicatorType = state.chartPreferences?.indicatorType || "bars";
  const periodType = state.chartPreferences?.periodType || "donut";

  const metrics = [
    { label: "Datos cargados", value: totalReports, delta: "registros con filtros activos", type: "info" },
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
    buildIndicatorChartSeries(reports),
    indicatorType,
    "Cuando existan reportes con los filtros actuales, aqui veras el comportamiento por indicador.",
  );

  elements.periodCharts.innerHTML = renderSeriesByType(
    buildPeriodChartSeries(reports),
    periodType,
    "Cuando subas formularios o reportes de datos, aqui apareceran los resultados por periodo.",
  );

  elements.submissionList.innerHTML = state.formSubmissions.length
    ? state.formSubmissions
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
  renderFilters();
  updateRoleUi();
  renderMetrics();
  renderProgramChart();
  renderRisks();
  renderReports();
  renderIndicators();
  renderDesignStudio();
  renderForms();
  renderCharts();
  renderConceptPapers();
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

function addReport(formData) {
  const indicator = state.indicators.find((item) => item.name === formData.get("indicator"));
  const value = Number(formData.get("value"));
  const newReport = {
    id: `rep-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    period: formData.get("period"),
    program: formData.get("program"),
    province: formData.get("province"),
    indicatorId: indicator.id,
    value,
    women: Number(formData.get("women") || 0),
    men: Number(formData.get("men") || 0),
    youth: Number(formData.get("youth") || 0),
    owner: formData.get("owner"),
    evidence: formData.get("evidence"),
    notes: formData.get("notes"),
    status: "Pendiente",
  };

  indicator.value += value;
  state.reports.unshift(newReport);
  if (!state.filters.period || state.filters.period === "Todos") {
    state.filters.period = newReport.period;
  }
  saveState();
  renderAll();
  showToast("Reporte enviado a supervision.");
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
        status: "Pendiente",
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
        const indicator = indicatorById(report.indicatorId);
        if (indicator) {
          indicator.value += report.value;
        }
        state.reports.unshift(report);
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
      switchView("charts");
      elements.uploadStatus.textContent = `${reports.length} registros`;
      elements.uploadStatus.className = "status-pill good";
      elements.uploadPreview.innerHTML = `<p class="item-meta">${reports.length} registros importados desde ${file.name}. Las graficas ya fueron actualizadas.</p>`;
      showToast("Formulario subido y graficas actualizadas.");
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

function createIndicatorsFromProgram() {
  const program = selectedDesignProgram();
  const existingNames = new Set(state.indicators.map((indicator) => indicator.name));
  const suggestions = buildSuggestedIndicators(program).filter((indicator) => !existingNames.has(indicator.name));

  suggestions.forEach((indicator) => {
    state.indicators.push({
      id: `ind-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      program: program.name,
      name: indicator.name,
      target: indicator.target,
      value: 0,
      unit: indicator.unit,
      owner: indicator.owner,
      due: indicator.due,
    });
  });

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

  $("#generateIndicatorsButton").addEventListener("click", createIndicatorsFromProgram);
  $("#createMonitoringFormButton").addEventListener("click", () => createFormTemplate("Monitoreo"));
  $("#createEvaluationFormButton").addEventListener("click", () => createFormTemplate("Evaluacion"));
  $("#downloadAllFormsButton").addEventListener("click", downloadAllForms);
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
      report.status = "Aprobado";
      showToast("Reporte aprobado.");
    }

    if (returnId) {
      report.status = "Necesita correccion";
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

  $("#addIndicatorButton").addEventListener("click", () => {
    const next = state.indicators.length + 1;
    const program = state.filters.program === "Todos" ? state.programs[0] : state.programs.find((item) => item.name === state.filters.program) || state.programs[0];
    state.indicators.push({
      id: `ind-${Date.now()}`,
      program: program.name,
      name: `Nuevo indicador ${next}`,
      target: 100,
      value: 0,
      unit: "unidades",
      owner: "Equipo M&E",
      due: "2026-12",
    });
    saveState();
    renderAll();
    showToast(`Indicador agregado a ${program.name}.`);
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
