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

function participantCount(report = {}) {
  const breakdown = report?.participantBreakdown || {};
  return sum([
    breakdown.women ?? report.women,
    breakdown.men ?? report.men,
    breakdown.adolescents ?? report.adolescents ?? report.youth,
    breakdown.children ?? report.children,
  ]);
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
      delta: "desglose reportado acumulado",
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
      message: `${summary.needsCorrectionReports} reportes necesitan corrección. Vale la pena revisar evidencia, consistencia y acompañamiento a campo.`,
    });
  }

  if (fragileIndicators.length) {
    insights.push({
      title: "Indicadores con señal débil",
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
    participants: sum(analyzedReports.map((report) => participantCount(report))),
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

function normalizeDimension(items = [], mapFn) {
  return items.map((item) => mapFn(item));
}

export function buildPowerBiDataset({
  organization,
  users = [],
  programs = [],
  programCenters = [],
  indicators = [],
  reports = [],
  deletedReports = [],
  reportStatusHistory = [],
  attendanceParticipants = [],
  attendanceSessions = [],
  attendanceArchive = [],
  formSubmissions = [],
  conceptPapers = [],
  programManuals = [],
  generatedBy = null,
  filters = {},
} = {}) {
  const scopedReports = reports.slice();
  const approvedReports = scopedReports.filter((report) => isApprovedReportStatus(report.status));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      organizationId: organization?.id || null,
      organizationName: organization?.name || null,
      generatedBy,
      filters,
      scopes: {
        defaultAnalyticsScope: DEFAULT_ANALYTICS_SCOPE,
      },
    },
    dimensions: {
      organizations: organization
        ? [
            {
              id: organization.id,
              name: organization.name,
            },
          ]
        : [],
      users: normalizeDimension(users, (user) => ({
        id: user.id,
        organizationId: user.organizationId || user.companyId || null,
        fullName: user.fullName,
        email: user.email,
        primaryRole: user.primaryRole || user.systemRole || null,
        status: user.status,
        allowedRoles: Array.isArray(user.allowedRoles) ? user.allowedRoles : [],
        enabledViews: Array.isArray(user.enabledViews) ? user.enabledViews : [],
        createdAt: user.createdAt || null,
        updatedAt: user.updatedAt || null,
      })),
      programs: normalizeDimension(programs, (program) => ({
        id: program.id,
        organizationId: program.organizationId || program.companyId || null,
        name: program.name,
        lead: program.lead,
        primaryPopulation: program.primaryPopulation || null,
        provinces: Array.isArray(program.provinces) ? program.provinces : [],
        beneficiaries: asNumber(program.beneficiaries),
        budget: program.budget || null,
        focus: program.focus || null,
        createdAt: program.createdAt || null,
        updatedAt: program.updatedAt || null,
      })),
      centers: normalizeDimension(programCenters, (center) => ({
        id: center.id,
        organizationId: center.organizationId || center.companyId || null,
        programId: center.programId || null,
        program: center.program || null,
        province: center.province || null,
        name: center.name || null,
        createdAt: center.createdAt || null,
        updatedAt: center.updatedAt || null,
      })),
      indicators: normalizeDimension(indicators, (indicator) => ({
        id: indicator.id,
        organizationId: indicator.organizationId || indicator.companyId || null,
        programId: indicator.programId || null,
        program: indicator.program || null,
        name: indicator.name,
        target: asNumber(indicator.target),
        unit: indicator.unit || null,
        owner: indicator.owner || null,
        due: indicator.due || null,
        type: indicator.type || null,
        source: indicator.source || null,
        createdAt: indicator.createdAt || null,
        updatedAt: indicator.updatedAt || null,
      })),
      conceptPapers: normalizeDimension(conceptPapers, (paper) => ({
        id: paper.id,
        organizationId: paper.organizationId || paper.companyId || null,
        program: paper.program || null,
        title: paper.title || null,
        year: paper.year || null,
        status: paper.status || null,
        presenter: paper.presenter || null,
        uploadedAt: paper.uploadedAt || null,
        uploadedBy: paper.uploadedBy || null,
      })),
      programManuals: normalizeDimension(programManuals, (manual) => ({
        id: manual.id,
        organizationId: manual.organizationId || manual.companyId || null,
        program: manual.program || null,
        title: manual.title || null,
        year: manual.year || null,
        version: manual.version || null,
        status: manual.status || null,
        uploadedAt: manual.uploadedAt || null,
        uploadedBy: manual.uploadedBy || null,
      })),
    },
    facts: {
      reports: normalizeDimension(scopedReports, (report) => ({
        id: report.id,
        organizationId: report.organizationId || report.companyId || null,
        programId: report.programId || null,
        program: report.program || null,
        province: report.province || null,
        center: report.center || null,
        indicatorId: report.indicatorId || null,
        date: report.date || null,
        period: report.period || null,
        owner: report.owner || null,
        status: report.status || null,
        value: asNumber(report.value),
        women: asNumber(report.participantBreakdown?.women ?? report.women),
        men: asNumber(report.participantBreakdown?.men ?? report.men),
        adolescents: asNumber(report.participantBreakdown?.adolescents ?? report.adolescents ?? report.youth),
        children: asNumber(report.participantBreakdown?.children ?? report.children),
        participants: participantCount(report),
        submissionId: report.submissionId || null,
        sourceFormId: report.sourceFormId || null,
        reviewedBy: report.reviewedBy || null,
        reviewedAt: report.reviewedAt || null,
        reviewNote: report.reviewNote || null,
        correctionForRole: report.correctionForRole || null,
        createdAt: report.createdAt || null,
        updatedAt: report.updatedAt || null,
      })),
      approvedReports: normalizeDimension(approvedReports, (report) => ({
        id: report.id,
        organizationId: report.organizationId || report.companyId || null,
        programId: report.programId || null,
        indicatorId: report.indicatorId || null,
        period: report.period || null,
        date: report.date || null,
        value: asNumber(report.value),
        participants: participantCount(report),
      })),
      deletedReports: normalizeDimension(deletedReports, (report) => ({
        id: report.id,
        organizationId: report.organizationId || report.companyId || null,
        programId: report.programId || null,
        program: report.program || null,
        indicatorId: report.indicatorId || null,
        period: report.period || null,
        previousStatus: report.previousStatus || null,
        deletionStatus: report.deletionStatus || null,
        deletionNote: report.deletionNote || null,
        deletedAt: report.deletedAt || null,
        deletedBy: report.deletedBy || null,
        deletedByRole: report.deletedByRole || null,
      })),
      reportStatusHistory: normalizeDimension(reportStatusHistory, (entry) => ({
        id: entry.id,
        reportId: entry.reportId,
        previousStatus: entry.previousStatus || null,
        status: entry.status || null,
        actorId: entry.actorId || null,
        actorRole: entry.actorRole || null,
        note: entry.note || null,
        createdAt: entry.createdAt || null,
      })),
      formSubmissions: normalizeDimension(formSubmissions, (submission) => ({
        id: submission.id,
        organizationId: submission.organizationId || submission.companyId || null,
        formId: submission.formId || submission.sourceFormId || null,
        formTitle: submission.formTitle || null,
        program: submission.program || null,
        period: submission.period || null,
        fileName: submission.fileName || null,
        sourceType: submission.sourceType || null,
        processing: submission.processing || null,
        reportCount: asNumber(submission.reportCount),
        importedAt: submission.importedAt || null,
        importedBy: submission.importedBy || null,
        importedByRole: submission.importedByRole || null,
        reportIds: Array.isArray(submission.reportIds) ? submission.reportIds : [],
        attachmentCount: Array.isArray(submission.attachments) ? submission.attachments.length : 0,
      })),
      attendanceParticipants: normalizeDimension(attendanceParticipants, (participant) => ({
        id: participant.id,
        organizationId: participant.organizationId || participant.companyId || null,
        program: participant.program || null,
        name: participant.name || null,
        status: participant.status || null,
        createdAt: participant.createdAt || null,
        updatedAt: participant.updatedAt || null,
      })),
      attendanceSessions: normalizeDimension(attendanceSessions, (session) => ({
        id: session.id,
        organizationId: session.organizationId || session.companyId || null,
        program: session.program || null,
        center: session.center || null,
        period: session.period || null,
        weekStart: session.weekStart || null,
        recordedBy: session.recordedBy || null,
        actorRole: session.actorRole || null,
        locked: Boolean(session.locked),
        entries: Array.isArray(session.entries)
          ? session.entries.map((entry) => ({
              participantId: entry.participantId || null,
              name: entry.name || null,
              status: entry.status || null,
              excuseNote: entry.excuseNote || null,
            }))
          : [],
        createdAt: session.createdAt || null,
        updatedAt: session.updatedAt || null,
      })),
      attendanceArchive: normalizeDimension(attendanceArchive, (record) => ({
        id: record.id || null,
        organizationId: record.organizationId || record.companyId || null,
        type: record.type || null,
        program: record.program || null,
        deletedAt: record.deletedAt || null,
        deletedBy: record.deletedBy || null,
        deletedByRole: record.deletedByRole || null,
      })),
    },
    summaries: {
      reportCount: scopedReports.length,
      approvedReportCount: approvedReports.length,
      deletedReportCount: deletedReports.length,
      formSubmissionCount: formSubmissions.length,
      attendanceSessionCount: attendanceSessions.length,
      attendanceParticipantCount: attendanceParticipants.length,
    },
  };
}

