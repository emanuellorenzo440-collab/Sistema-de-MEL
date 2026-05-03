import {
  canReviewReports,
  DEFAULT_ANALYTICS_SCOPE,
  isApprovedReportStatus,
  normalizeAnalyticsScope,
  REPORT_STATUSES,
  REPORT_STATUS_VALUES,
} from "../../../shared/contracts/reporting.js";

const ALLOWED_TRANSITIONS = {
  [REPORT_STATUSES.PENDING]: [REPORT_STATUSES.APPROVED, REPORT_STATUSES.NEEDS_CORRECTION, REPORT_STATUSES.REJECTED],
  [REPORT_STATUSES.NEEDS_CORRECTION]: [REPORT_STATUSES.PENDING, REPORT_STATUSES.APPROVED, REPORT_STATUSES.REJECTED],
  [REPORT_STATUSES.REJECTED]: [REPORT_STATUSES.PENDING],
  [REPORT_STATUSES.APPROVED]: [REPORT_STATUSES.NEEDS_CORRECTION, REPORT_STATUSES.REJECTED],
};

export function resolveAnalyticsScope(scope) {
  return normalizeAnalyticsScope(scope || DEFAULT_ANALYTICS_SCOPE);
}

export function shouldIncludeReportInAnalytics(report, scope) {
  return resolveAnalyticsScope(scope) === "all" ? true : isApprovedReportStatus(report.status);
}

export function validateReportStatusChange(input) {
  if (!REPORT_STATUS_VALUES.includes(input.nextStatus)) {
    return { ok: false, status: 400, error: "Estado de reporte no soportado." };
  }

  if (!canReviewReports(input.actorRole)) {
    return { ok: false, status: 403, error: "Este rol no puede validar reportes." };
  }

  const allowedTargets = ALLOWED_TRANSITIONS[input.currentStatus] || [];
  if (!allowedTargets.includes(input.nextStatus)) {
    return {
      ok: false,
      status: 409,
      error: "No se permite cambiar de " + input.currentStatus + " a " + input.nextStatus + ".",
      details: { currentStatus: input.currentStatus, nextStatus: input.nextStatus, allowedTargets }
    };
  }

  if (input.nextStatus === REPORT_STATUSES.NEEDS_CORRECTION && !input.note?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "Debes indicar una observacion cuando un reporte necesita correccion."
    };
  }

  return { ok: true };
}
