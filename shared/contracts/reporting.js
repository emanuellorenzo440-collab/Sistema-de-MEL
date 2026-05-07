export const REPORT_STATUSES = {
  PENDING_COORDINATION: "Pendiente coordinacion",
  PENDING_PROGRAM_MANAGER: "Pendiente Program Manager",
  PENDING_MEL: "Pendiente Supervision M&E",
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
export const LEGACY_PENDING_STATUS = "Pendiente";

export const REVIEW_ROLES = ["Coordinador de programa", "Program Manager", "Supervision M&E"];
export const FINAL_APPROVAL_ROLE = "Supervision M&E";

export const REVIEW_STAGE_BY_STATUS = {
  [LEGACY_PENDING_STATUS]: "Coordinador de programa",
  [REPORT_STATUSES.PENDING_COORDINATION]: "Coordinador de programa",
  [REPORT_STATUSES.PENDING_PROGRAM_MANAGER]: "Program Manager",
  [REPORT_STATUSES.PENDING_MEL]: "Supervision M&E",
};

export function normalizeAnalyticsScope(scope) {
  return scope === ANALYTICS_SCOPES.ALL ? ANALYTICS_SCOPES.ALL : DEFAULT_ANALYTICS_SCOPE;
}

export function isApprovedReportStatus(status) {
  return status === REPORT_STATUSES.APPROVED;
}

export function isPendingApprovalStatus(status) {
  return Object.keys(REVIEW_STAGE_BY_STATUS).includes(status);
}

export function reviewRoleForStatus(status) {
  return REVIEW_STAGE_BY_STATUS[status] || null;
}

export function canReviewReports(role, status = null) {
  if (!REVIEW_ROLES.includes(role)) return false;
  if (!status) return true;
  return reviewRoleForStatus(status) === role;
}
