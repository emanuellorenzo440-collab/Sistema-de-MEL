import {
  ANALYTICS_SCOPES,
  DEFAULT_ANALYTICS_SCOPE,
  isPendingApprovalStatus,
  REPORT_STATUSES,
  isApprovedReportStatus,
  normalizeAnalyticsScope,
} from "../../../shared/contracts/reporting.js";

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percent(value, target) {
  const safeTarget = asNumber(target);
  if (!safeTarget) return 0;
  return Math.round((asNumber(value) / safeTarget) * 100);
}

function sum(values) {
  return values.reduce((total, value) => total + asNumber(value), 0);
}

function groupTotals(items, keyFn, valueFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = (groups[key] || 0) + asNumber(valueFn(item));
    return groups;
  }, {});
}

function indicatorSeries(indicators, analyzedReports) {
  const totals = groupTotals(analyzedReports, (report) => report.indicatorId, (report) => report.value);
  return indicators
    .map((indicator) => ({
      id: indicator.id,
      label: indicator.name,
      program: indicator.program,
      value: totals[indicator.id] || 0,
      target: asNumber(indicator.target),
      unit: indicator.unit,
      progress: percent(totals[indicator.id] || 0, indicator.target),
    }))
    .filter((item) => item.value > 0 || item.target > 0)
    .sort((left, right) => right.value - left.value);
}

function periodSeries(analyzedReports) {
  return Object.entries(groupTotals(analyzedReports, (report) => report.period, (report) => report.value))
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function programSeries(programs, analyzedReports, indicators) {
  const values = groupTotals(analyzedReports, (report) => report.program, (report) => report.value);
  return programs
    .map((program) => {
      const programIndicators = indicators.filter((indicator) => indicator.program === program.name);
      const target = sum(programIndicators.map((indicator) => indicator.target));
      const value = values[program.name] || 0;
      return {
        id: program.id,
        label: program.name,
        value,
        target,
        progress: percent(value, target),
      };
    })
    .sort((left, right) => right.value - left.value);
}

function statusSeries(visibleReports) {
  return Object.entries(groupTotals(visibleReports, (report) => report.status, () => 1))
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function buildMetrics(summary, programChart) {
  const approvedRate = summary.visibleReports ? Math.round((summary.approvedReports / summary.visibleReports) * 100) : 0;
  const leadingProgram = programChart[0];

  return [
    {
      id: "reports-analyzed",
      label: "Reportes analizados",
      value: summary.analyzedReports,
      delta: `${summary.excludedReports} excluidos por alcance`,
      type: "info",
    },
    {
      id: "approved-rate",
      label: "Tasa de aprobacion",
      value: `${approvedRate}%`,
      delta: `${summary.approvedReports} aprobados de ${summary.visibleReports}`,
      type: approvedRate >= 70 ? "good" : approvedRate >= 40 ? "warning" : "danger",
    },
    {
      id: "participants",
      label: "Participantes reportados",
      value: summary.participants,
      delta: "mujeres y hombres acumulados",
      type: "info",
    },
    {
      id: "leading-program",
      label: "Programa con mayor volumen",
      value: leadingProgram?.label || "Sin datos",
      delta: leadingProgram ? `${leadingProgram.value} acumulados` : "todavia no hay reportes aprobados",
      type: leadingProgram ? "good" : "warning",
    },
  ];
}

function buildStats(summary, indicatorChart, programChart) {
  const fragileIndicators = indicatorChart.filter((indicator) => indicator.target > 0 && indicator.progress < 50).length;
  const onTrackIndicators = indicatorChart.filter((indicator) => indicator.progress >= 70).length;
  const averageProgress = indicatorChart.length
    ? Math.round(sum(indicatorChart.map((indicator) => indicator.progress)) / indicatorChart.length)
    : 0;
  const bestProgram = programChart[0] || null;

  return [
    { label: "Progreso promedio", value: `${averageProgress}%` },
    { label: "Indicadores en ruta", value: onTrackIndicators },
    { label: "Indicadores fragiles", value: fragileIndicators },
    { label: "Programa lider", value: bestProgram?.label || "Sin datos" },
    { label: "Reportes pendientes", value: summary.pendingReports },
    { label: "Correcciones solicitadas", value: summary.needsCorrectionReports },
  ];
}

function buildInsights(summary, indicatorChart, programChart, scope) {
  const insights = [];
  const fragileIndicators = indicatorChart
    .filter((indicator) => indicator.target > 0 && indicator.progress < 50)
    .slice(0, 3);
  const bestProgram = programChart[0] || null;

  if (!summary.analyzedReports) {
    insights.push({
      title: "Sin base analitica suficiente",
      severity: "warning",
      message:
        scope === ANALYTICS_SCOPES.APPROVED
          ? "Todavia no hay reportes aprobados para lectura ejecutiva. Conviene revisar la cola de validacion."
          : "Todavia no hay reportes visibles para construir analitica automatica.",
    });
  }

  if (summary.pendingReports > 0) {
    insights.push({
      title: "Cola de validacion activa",
      severity: summary.pendingReports > 5 ? "warning" : "info",
      message: `${summary.pendingReports} reportes siguen pendientes. Mientras no se aprueben, la lectura ejecutiva puede verse incompleta.`,
    });
  }

  if (summary.needsCorrectionReports > 0) {
    insights.push({
      title: "Calidad de datos a reforzar",
      severity: "warning",
      message: `${summary.needsCorrectionReports} reportes necesitan correccion. Vale la pena revisar evidencia, consistencia y acompanamiento a campo.`,
    });
  }

  if (fragileIndicators.length) {
    insights.push({
      title: "Indicadores con senal debil",
      severity: "danger",
      message: `Conviene intervenir primero en ${fragileIndicators.map((indicator) => indicator.label).join(", ")}, porque siguen por debajo del 50% de su meta acumulada.`,
    });
  }

  if (bestProgram) {
    insights.push({
      title: "Referencia interna util",
      severity: "good",
      message: `${bestProgram.label} lidera el volumen reportado. Podemos revisar su ritmo de seguimiento y usarlo como referencia para otros programas.`,
    });
  }

  return insights.slice(0, 5);
}

export function buildAnalyticsOverview({ programs = [], indicators = [], reports = [], filters = {}, scope }) {
  const appliedScope = normalizeAnalyticsScope(scope || filters.scope);
  const visibleReports = reports.slice();
  const analyzedReports =
    appliedScope === ANALYTICS_SCOPES.ALL ? visibleReports : visibleReports.filter((report) => isApprovedReportStatus(report.status));

  const indicatorChart = indicatorSeries(indicators, analyzedReports);
  const periodChart = periodSeries(analyzedReports);
  const programChart = programSeries(programs, analyzedReports, indicators);
  const statusesChart = statusSeries(visibleReports);

  const summary = {
    visibleReports: visibleReports.length,
    analyzedReports: analyzedReports.length,
    excludedReports: Math.max(visibleReports.length - analyzedReports.length, 0),
    totalValue: sum(analyzedReports.map((report) => report.value)),
    participants: sum(analyzedReports.map((report) => asNumber(report.women) + asNumber(report.men))),
    approvedReports: visibleReports.filter((report) => report.status === REPORT_STATUSES.APPROVED).length,
    pendingReports: visibleReports.filter((report) => isPendingApprovalStatus(report.status)).length,
    needsCorrectionReports: visibleReports.filter((report) => report.status === REPORT_STATUSES.NEEDS_CORRECTION).length,
  };

  return {
    scope: {
      requested: scope || filters.scope || null,
      applied: appliedScope,
      default: DEFAULT_ANALYTICS_SCOPE,
      executiveDefault: DEFAULT_ANALYTICS_SCOPE,
    },
    summary,
    metrics: buildMetrics(summary, programChart),
    charts: {
      indicators: indicatorChart,
      periods: periodChart,
      programs: programChart,
      statuses: statusesChart,
    },
    stats: buildStats(summary, indicatorChart, programChart),
    insights: buildInsights(summary, indicatorChart, programChart, appliedScope),
  };
}

export function buildAnalyticsConfig() {
  return {
    scopes: Object.values(ANALYTICS_SCOPES),
    defaultScope: DEFAULT_ANALYTICS_SCOPE,
    executiveDefaultScope: DEFAULT_ANALYTICS_SCOPE,
    statuses: Object.values(REPORT_STATUSES),
  };
}
