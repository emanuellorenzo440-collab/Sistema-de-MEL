import { seedState } from "../../../frontend/src/data/seed-state.js";
import { REPORT_STATUSES } from "../../../shared/contracts/reporting.js";

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

function nowIso() {
  return new Date().toISOString();
}

const programs = seedState.programs.map((program) => ({
  id: `prog-${slugify(program.name)}`,
  ...structuredClone(program),
}));

const programIdByName = new Map(programs.map((program) => [program.name, program.id]));
const indicators = seedState.indicators.map((indicator) => ({
  ...structuredClone(indicator),
  programId: programIdByName.get(indicator.program) || null,
}));

const reports = [];
const reportStatusHistory = [];

function normalizedReport(input = {}) {
  const timestamp = nowIso();
  return {
    id: String(input.id || `rep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    date: String(input.date || timestamp.slice(0, 10)),
    period: String(input.period || timestamp.slice(0, 7)),
    program: String(input.program || ""),
    programId: input.programId || programIdByName.get(input.program) || null,
    province: String(input.province || "Centros de programa"),
    indicatorId: String(input.indicatorId || ""),
    value: asNumber(input.value),
    women: asNumber(input.women),
    men: asNumber(input.men),
    youth: asNumber(input.youth),
    owner: String(input.owner || ""),
    evidence: String(input.evidence || ""),
    notes: String(input.notes || ""),
    sourceFormId: input.sourceFormId || null,
    submissionId: input.submissionId || null,
    status: input.status || REPORT_STATUSES.PENDING,
    reviewedBy: input.reviewedBy || null,
    reviewedAt: input.reviewedAt || null,
    reviewNote: input.reviewNote || null,
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

export function listPrograms() {
  return programs.map((program) => structuredClone(program));
}

export function listIndicators() {
  return indicators.map((indicator) => structuredClone(indicator));
}

export function findIndicatorById(indicatorId) {
  return indicators.find((indicator) => indicator.id === indicatorId) || null;
}

export function queryReports(filters = {}) {
  const { program, programId, province, period } = filters;
  return reports
    .filter((report) => {
      if (program && report.program !== program) return false;
      if (programId && report.programId !== programId) return false;
      if (province && report.province !== province) return false;
      if (period && report.period !== period) return false;
      return true;
    })
    .map((report) => structuredClone(report));
}

export function createReport(input) {
  const report = normalizedReport(input);
  reports.unshift(report);
  return structuredClone(report);
}

export function createReportsBulk(items = []) {
  return items.map((item) => createReport(item));
}

export function findReportById(reportId) {
  return reports.find((report) => report.id === reportId) || null;
}

export function saveReportStatusDecision(reportId, decision = {}) {
  const report = findReportById(reportId);
  if (!report) return null;

  const previousStatus = report.status;
  const nextStatus = decision.status || previousStatus;
  const changedAt = nowIso();

  report.status = nextStatus;
  report.reviewedBy = decision.actorId || report.reviewedBy;
  report.reviewedAt = changedAt;
  report.reviewNote = decision.note || null;
  report.updatedAt = changedAt;

  const historyEntry = {
    id: `hist-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    reportId,
    previousStatus,
    status: nextStatus,
    actorId: decision.actorId || null,
    actorRole: decision.actorRole || null,
    note: decision.note || "",
    createdAt: changedAt,
  };

  reportStatusHistory.unshift(historyEntry);
  return {
    report: structuredClone(report),
    historyEntry: structuredClone(historyEntry),
  };
}

export function listReportStatusHistory(reportId) {
  return reportStatusHistory
    .filter((entry) => entry.reportId === reportId)
    .map((entry) => structuredClone(entry));
}
