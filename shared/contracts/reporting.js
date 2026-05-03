export const REPORT_STATUSES = {
  PENDING: "Pendiente",
  NEEDS_CORRECTION: "Necesita correccion",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
};

export const REPORT_STATUS_VALUES = Object.values(REPORT_STATUSES);

export const ANALYTICS_SCOPES = {
  APPROVED: "approved",
  ALL: "all",
};

export const ANALYTICS_SCOPE_VALUES = Object.values(ANALYTICS_SCOPES);
export const DEFAULT_ANALYTICS_SCOPE = ANALYTICS_SCOPES.APPROVED;

export const REVIEW_ROLES = ["Program Manager", "Director Nacional", "Supervision M&E"];

export function normalizeAnalyticsScope(scope) {
  return scope === ANALYTICS_SCOPES.ALL ? ANALYTICS_SCOPES.ALL : DEFAULT_ANALYTICS_SCOPE;
}

export function isApprovedReportStatus(status) {
  return status === REPORT_STATUSES.APPROVED;
}

export function canReviewReports(role) {
  return REVIEW_ROLES.includes(role);
}
