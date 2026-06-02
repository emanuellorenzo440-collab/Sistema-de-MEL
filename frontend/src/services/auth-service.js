import { getApiBaseUrl } from "./mel-api.js?v=20260601a";
import { DEFAULT_ORGANIZATION_BRANDING, normalizeOrganizationBranding, readRequestedOrganizationContext } from "./organization-branding.js?v=20260602d";

const AUTH_STORAGE_KEY = "pulso-me-auth-v1";
const AUTH_SESSION_KEY = "pulso-me-session-v1";
const AUTH_SIGNED_OUT_KEY = "pulso-me-signed-out-v1";
const AUTH_EVENT_NAME = "mel:auth-changed";
const AUTH_API_TIMEOUT_MS = 10000;
const REMOTE_SESSION_SYNC_INTERVAL_MS = 15000;

export const SYSTEM_ROLES = [
  "Facilitador",
  "Coordinador de programa",
  "Program Manager",
  "Director Nacional",
  "Supervision M&E",
];

export const VIEW_DEFINITIONS = [
  { id: "dashboard", label: "Resumen" },
  { id: "report", label: "Reportar" },
  { id: "indicators", label: "Indicadores" },
  { id: "design", label: "Diseño M&E" },
  { id: "forms", label: "Formularios" },
  { id: "charts", label: "Graficas" },
  { id: "chat", label: "Chat" },
  { id: "attendance", label: "Asistencia" },
  { id: "concepts", label: "Concept Papers" },
  { id: "supervision", label: "Supervision" },
  { id: "programs", label: "Programas" },
  { id: "access", label: "Accesos" },
];

const ROLE_LABELS = {
  facilitador: "Facilitador",
  "coordinador de programa": "Coordinador de programa",
  "program manager": "Program Manager",
  "director nacional": "Director Nacional",
  "supervision m&e": "Supervision M&E",
  "supervision me": "Supervision M&E",
  "supervision de m&e": "Supervision M&E",
  supervisor: "Supervision M&E",
};

const DEFAULT_VIEW_PERMISSIONS = {
  Facilitador: ["dashboard", "report", "forms", "charts", "chat", "attendance"],
  "Coordinador de programa": ["dashboard", "report", "forms", "attendance", "charts", "chat", "supervision"],
  "Program Manager": ["dashboard", "attendance", "charts", "chat", "supervision", "programs", "concepts"],
  "Director Nacional": ["dashboard", "attendance", "charts", "chat", "programs", "concepts"],
  "Supervision M&E": VIEW_DEFINITIONS.map((view) => view.id),
};

const DEMO_SUPERVISOR = {
  email: "supervision@pulso-me.org",
  password: "PulsoMEL2026!",
  fullName: "Supervision MEL",
};

const SEEDED_ACCESS_MANAGER = {
  email: "llorenzo@convoyofhope.org",
  password: "ConvoyHope2026!",
  fullName: "L Lorenzo",
};

const SEEDED_FACILITATOR_APUJOLS = {
  email: "apujols@convoyofhope.org",
  password: "Facilitador2026!",
  fullName: "A Pujols",
};
const SEEDED_PLATFORM_ADMIN = {
  email: "admin@nexora.app",
  password: "NexoraAdmin2026!",
  fullName: "Nexora Platform Admin",
};

const SEEDED_ACCOUNTS_CREATED_AT = "2026-05-08T00:00:00.000Z";
const PRESET_ACCOUNT_VERSION = 2;
const AUTH_DATA_VERSION = 6;
const LEGACY_ACCESS_CUTOFF = "2026-05-12T00:00:00.000Z";
const MAX_DELETED_USER_AUDIT = 500;
const PROTECTED_PRESET_EMAILS = [SEEDED_FACILITATOR_APUJOLS.email];
const LEGACY_USER_PURGE_MATCHERS = [
  /alana/i,
  /alanna/i,
  /\blana\b/i,
  /\bapujo\b/i,
  /apujo@companyofhomes\.org/i,
  /apujo@conveyofhope\.org/i,
  /ap+lehost/i,
  /applehost/i,
];
const DEFAULT_ORGANIZATION = {
  id: "org-convoy-of-hope",
  name: "Convoy of Hope",
};
const MASTER_ORGANIZATION = {
  id: "org-nexora-admin",
  name: "Nexora Admin",
};
let presetAccountTemplatesPromise = null;
let authStateCache = null;
let authHydrationPromise = null;
let remoteUsersSyncPromise = null;
let lastRemoteSessionSyncAt = 0;

function authApiBaseUrl() {
  try {
    return getApiBaseUrl();
  } catch {
    return null;
  }
}

function storedSessionToken() {
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    return String(session?.sessionToken || "").trim();
  } catch {
    return "";
  }
}

function isLocalAuthRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function isStaticGitHost() {
  return /(^|\.)github\.io$/i.test(window.location.hostname);
}

function requiresSharedAuthApi() {
  return Boolean(authApiBaseUrl()) && !isLocalAuthRuntime() && !isStaticGitHost();
}

function isNetworkAuthError(error) {
  return error?.name === "AbortError" || error?.isNetworkError;
}

function shouldUseLocalAuthFallback(error) {
  return isNetworkAuthError(error) && !requiresSharedAuthApi();
}

function sharedAuthApiError(error) {
  if (!isNetworkAuthError(error)) return error;
  const message =
    error?.name === "AbortError"
      ? "La API de accesos tardo demasiado en responder. El usuario no se guardo. Intenta de nuevo cuando Railway termine de responder."
      : "No pude conectar con la API de accesos. El usuario no se guardo. Revisa que Railway este activo y vuelve a intentar.";
  const nextError = new Error(message);
  nextError.cause = error;
  return nextError;
}

async function requestAuthApi(pathname, options = {}) {
  const baseUrl = authApiBaseUrl();
  if (!baseUrl) {
    const error = new Error("La API de accesos no esta configurada.");
    error.isNetworkError = true;
    throw error;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AUTH_API_TIMEOUT_MS);
  const headers = { ...(options.headers || {}) };
  if (options.body) {
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const sessionToken = storedSessionToken();
  if (sessionToken) {
    headers["x-mel-session-token"] = sessionToken;
  }

  try {
    const response = await fetch(`${baseUrl}/auth/${String(pathname || "").replace(/^\//, "")}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "No pude completar la solicitud de acceso.");
      error.status = response.status;
      error.details = body.details || null;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    if (!error.status) {
      error.isNetworkError = true;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function mapRemoteUser(user = {}) {
  return normalizeUser({
    ...user,
    systemRole: user.systemRole || user.primaryRole || user.requestedRole,
    requestedRole: user.requestedRole || user.primaryRole || user.systemRole,
    allowedRoles: user.allowedRoles || user.enabledProfiles,
    verifiedAt: user.verifiedAt || user.createdAt || nowIso(),
    passwordUpdatedAt: user.passwordUpdatedAt || user.passwordChangedAt || null,
    passwordHash: user.passwordHash || "",
  });
}

async function upsertRemoteUser(remoteUser, eventType = "remote-user-synced") {
  const state = await ensureAuthState();
  const nextUser = mapRemoteUser(remoteUser);
  const index = state.users.findIndex((user) => user.id === nextUser.id || user.email === nextUser.email);
  if (index >= 0) {
    state.users[index] = {
      ...state.users[index],
      ...nextUser,
      passwordHash: state.users[index].passwordHash || nextUser.passwordHash,
    };
  } else {
    state.users.unshift(nextUser);
  }
  writeStoredAuthState(state, eventType);
  return nextUser;
}

async function replaceLocalManagedUsers(remoteUsers = [], eventType = "remote-users-synced") {
  const state = await ensureAuthState();
  const existingPasswordHashes = new Map(state.users.map((user) => [user.email, user.passwordHash || ""]));
  const nextUsers = remoteUsers.map((remoteUser) => {
    const nextUser = mapRemoteUser(remoteUser);
    return {
      ...nextUser,
      passwordHash: nextUser.passwordHash || existingPasswordHashes.get(nextUser.email) || "",
    };
  });
  state.users = nextUsers;
  if (state.session?.userId) {
    const sessionUser = nextUsers.find((user) => user.id === state.session.userId);
    if (!sessionUser || sessionUser.status !== "active") {
      state.session = null;
    } else {
      state.session.activeRole = normalizeRoleLabel(state.session.activeRole || sessionUser.systemRole);
    }
  }
  return writeStoredAuthState(state, eventType).users;
}

async function syncRemoteManagedUsers(eventType = "remote-users-synced") {
  if (remoteUsersSyncPromise) return remoteUsersSyncPromise;
  remoteUsersSyncPromise = (async () => {
    const response = await requestAuthApi("users");
    return replaceLocalManagedUsers(response.users || [], eventType);
  })().finally(() => {
    remoteUsersSyncPromise = null;
  });
  return remoteUsersSyncPromise;
}

async function syncRemoteSessionState(eventType = "remote-session-validated") {
  const response = await requestAuthApi("session");
  const remoteUser = {
    ...(response.user || {}),
    sessionToken: response.session?.token || response.user?.sessionToken || storedSessionToken(),
  };
  return startRemoteSession(remoteUser, eventType);
}

async function startRemoteSession(remoteUser, eventType = "signed-in") {
  const state = await ensureAuthState();
  const nextUser = mapRemoteUser(remoteUser);
  const index = state.users.findIndex((user) => user.id === nextUser.id || user.email === nextUser.email);
  if (index >= 0) {
    state.users[index] = { ...state.users[index], ...nextUser, passwordHash: state.users[index].passwordHash };
  } else {
    state.users.unshift(nextUser);
  }
  state.session = {
    userId: nextUser.id,
    activeRole: normalizeRoleLabel(nextUser.systemRole),
    createdAt: nowIso(),
    sessionToken: remoteUser.sessionToken || state.session?.sessionToken || "",
  };
  writeStoredAuthState(state, eventType);
  return nextUser;
}

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function legacyUserShouldBePurged(user = {}) {
  const identity = `${user.fullName || ""} ${user.email || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (PROTECTED_PRESET_EMAILS.includes(normalizeEmail(user.email))) return false;
  return LEGACY_USER_PURGE_MATCHERS.some((matcher) => matcher.test(identity));
}

function recoverProtectedPresetEmails({ deletedUserEmails = [], deletedUserRegistry = [], deletedPresetEmails = [] }) {
  const manualPresetDeletes = new Set(deletedPresetEmails);
  return {
    deletedUserEmails: deletedUserEmails.filter(
      (email) => !PROTECTED_PRESET_EMAILS.includes(email) || manualPresetDeletes.has(email),
    ),
    deletedUserRegistry: deletedUserRegistry.filter(
      (record) => !PROTECTED_PRESET_EMAILS.includes(record.email) || manualPresetDeletes.has(record.email),
    ),
  };
}

function recordTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function legacyUserIsBeforeAccessCutoff(user = {}) {
  const createdTime = recordTime(user.createdAt || user.updatedAt || user.lastLoginAt);
  return createdTime > 0 && createdTime < Date.parse(LEGACY_ACCESS_CUTOFF);
}

function normalizeDeletedUserRecord(record = {}) {
  const email = normalizeEmail(record.email || record.userEmail);
  return {
    id: record.id || `del-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: record.userId || null,
    fullName: String(record.fullName || record.userName || "Usuario eliminado").trim(),
    email,
    deletedAt: record.deletedAt || nowIso(),
    deletedBy: record.deletedBy || "Sistema",
    reason: record.reason || "Eliminacion definitiva de acceso",
  };
}

function createDeletedUserRecord(user = {}, { actor = null, reason = "Eliminacion definitiva de acceso" } = {}) {
  return normalizeDeletedUserRecord({
    userId: user.id,
    fullName: user.fullName,
    email: user.email,
    deletedAt: nowIso(),
    deletedBy: actor?.email || actor?.fullName || "Sistema",
    reason,
  });
}

function latestDeletionTimeForEmail(email, registry = []) {
  const normalizedEmail = normalizeEmail(email);
  return registry
    .filter((record) => record.email === normalizedEmail)
    .reduce((latest, record) => Math.max(latest, recordTime(record.deletedAt)), 0);
}

function clearDeletionMarkersForEmail(state, email) {
  const normalizedEmail = normalizeEmail(email);
  state.deletedUserEmails = (state.deletedUserEmails || []).filter((item) => item !== normalizedEmail);
  state.deletedPresetEmails = (state.deletedPresetEmails || []).filter((item) => item !== normalizedEmail);
  state.deletedUserRegistry = (state.deletedUserRegistry || []).filter((record) => record.email !== normalizedEmail);
}

export function normalizeRoleLabel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return ROLE_LABELS[normalized] || "Facilitador";
}

function uniqueStrings(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeRoleList(items = []) {
  return uniqueStrings(items.map((item) => normalizeRoleLabel(item)));
}

function normalizeViewPermissions(items = []) {
  const allowedIds = new Set(VIEW_DEFINITIONS.map((view) => view.id));
  return uniqueStrings(items.filter((item) => allowedIds.has(item)));
}

function normalizeEnabledModules(items = []) {
  const allowedIds = new Set(VIEW_DEFINITIONS.map((view) => view.id));
  const normalized = uniqueStrings((Array.isArray(items) ? items : []).filter((item) => allowedIds.has(item)));
  return normalized.length ? normalized : VIEW_DEFINITIONS.map((view) => view.id);
}

function filterViewPermissionsByOrganization(viewPermissions = [], organizationSettings = {}) {
  const enabledModules = normalizeEnabledModules(organizationSettings.enabledModules);
  return normalizeViewPermissions(viewPermissions).filter((viewId) => enabledModules.includes(viewId));
}

function normalizeChatAlertSettings(settings = {}) {
  const soundMode = String(settings.soundMode || "").trim() === "muted-permanent" ? "muted-permanent" : "enabled";
  const mutedUntil = settings.mutedUntil ? String(settings.mutedUntil) : null;
  return {
    soundMode,
    mutedUntil,
  };
}

function defaultPermissionsForRole(role) {
  return clone(DEFAULT_VIEW_PERMISSIONS[normalizeRoleLabel(role)] || DEFAULT_VIEW_PERMISSIONS.Facilitador);
}

function dispatchAuthChange(type, detail = {}) {
  window.dispatchEvent(
    new CustomEvent(AUTH_EVENT_NAME, {
      detail: {
        type,
        ...detail,
      },
    }),
  );
}

window.addEventListener("storage", (event) => {
  if (event.key === AUTH_STORAGE_KEY || event.key === AUTH_SESSION_KEY) {
    authStateCache = null;
    authHydrationPromise = null;
    dispatchAuthChange("storage-synced", { session: readStoredAuthState()?.session || null });
  }
});

async function sha256(value) {
  const source = String(value || "");
  if (window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(source);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return btoa(source);
}

function createCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createToken() {
  const parts = new Uint32Array(4);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(parts);
    return Array.from(parts)
      .map((value) => value.toString(16).padStart(8, "0"))
      .join("");
  }

  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function buildVerificationLink(token) {
  const url = new URL(window.location.href);
  url.searchParams.set("verifyToken", token);
  return url.toString();
}

function buildPasswordResetLink(token) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("resetToken", token);
  return url.toString();
}

function passwordResetBaseUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createEmailRecord({ user, type, code, link, expiresAt }) {
  const labels = {
    verification: "Enlace de verificacion",
    reset: "Enlace para restablecer contraseña",
    "temporary-password": "Credenciales provisionales",
  };
  const body =
    type === "verification"
      ? `Hola ${user.fullName}, abre este enlace para verificar tu cuenta: ${link}. Expira el ${expiresAt}.`
      : type === "temporary-password"
        ? `Hola ${user.fullName}, tu cuenta de Pulso M&E fue creada. Correo: ${user.email}. Clave provisional: ${code}. El sistema te pedira cambiarla al entrar.`
        : `Hola ${user.fullName}, abre este enlace para cambiar tu contraseña: ${link}. Expira el ${expiresAt}.`;
  return {
    id: `mail-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    toEmail: user.email,
    toName: user.fullName,
    subject: `${labels[type]} - Pulso M&E`,
    previewCode: code || null,
    previewLink: link || null,
    body,
    status: "queued",
    createdAt: nowIso(),
    expiresAt,
  };
}

async function getPresetAccountTemplates() {
  if (!presetAccountTemplatesPromise) {
    presetAccountTemplatesPromise = Promise.all([
      sha256(DEMO_SUPERVISOR.password),
      sha256(SEEDED_ACCESS_MANAGER.password),
      sha256(SEEDED_FACILITATOR_APUJOLS.password),
      sha256(SEEDED_PLATFORM_ADMIN.password),
    ]).then(([supervisorPasswordHash, accessManagerPasswordHash, apujolsPasswordHash, platformAdminPasswordHash]) => [
      {
        id: "usr-supervision-root",
        fullName: DEMO_SUPERVISOR.fullName,
        email: DEMO_SUPERVISOR.email,
        passwordHash: supervisorPasswordHash,
        status: "active",
        systemRole: "Supervision M&E",
        requestedRole: "Supervision M&E",
        allowedRoles: SYSTEM_ROLES.slice(),
        viewPermissions: VIEW_DEFINITIONS.map((view) => view.id),
        organizationId: DEFAULT_ORGANIZATION.id,
        organizationName: DEFAULT_ORGANIZATION.name,
        verifiedAt: SEEDED_ACCOUNTS_CREATED_AT,
        accessNote: "Cuenta inicial para gestionar accesos del sistema.",
      },
      {
        id: "usr-llorenzo-access",
        fullName: SEEDED_ACCESS_MANAGER.fullName,
        email: SEEDED_ACCESS_MANAGER.email,
        passwordHash: accessManagerPasswordHash,
        status: "active",
        systemRole: "Supervision M&E",
        requestedRole: "Supervision M&E",
        allowedRoles: SYSTEM_ROLES.slice(),
        viewPermissions: VIEW_DEFINITIONS.map((view) => view.id),
        organizationId: DEFAULT_ORGANIZATION.id,
        organizationName: DEFAULT_ORGANIZATION.name,
        verifiedAt: SEEDED_ACCOUNTS_CREATED_AT,
        accessNote: "Cuenta habilitada para revisar solicitudes y administrar accesos.",
      },
      {
        id: "usr-apujols-facilitator",
        fullName: SEEDED_FACILITATOR_APUJOLS.fullName,
        email: SEEDED_FACILITATOR_APUJOLS.email,
        passwordHash: apujolsPasswordHash,
        status: "active",
        systemRole: "Facilitador",
        requestedRole: "Facilitador",
        allowedRoles: ["Facilitador"],
        viewPermissions: defaultPermissionsForRole("Facilitador"),
        organizationId: DEFAULT_ORGANIZATION.id,
        organizationName: DEFAULT_ORGANIZATION.name,
        verifiedAt: SEEDED_ACCOUNTS_CREATED_AT,
        accessNote: "Cuenta facilitadora configurada para iniciar sesion directamente.",
      },
      {
        id: "usr-nexora-platform-admin",
        fullName: SEEDED_PLATFORM_ADMIN.fullName,
        email: SEEDED_PLATFORM_ADMIN.email,
        passwordHash: platformAdminPasswordHash,
        status: "active",
        systemRole: "Supervision M&E",
        requestedRole: "Supervision M&E",
        allowedRoles: SYSTEM_ROLES.slice(),
        viewPermissions: ["access"],
        organizationId: MASTER_ORGANIZATION.id,
        organizationName: MASTER_ORGANIZATION.name,
        verifiedAt: SEEDED_ACCOUNTS_CREATED_AT,
        accessNote: "Cuenta global para administrar organizaciones y portales de Nexora.",
        globalAdmin: true,
      },
    ]);
  }

  return presetAccountTemplatesPromise;
}

function normalizeUser(user = {}) {
  const systemRole = normalizeRoleLabel(user.systemRole || user.primaryRole || user.requestedRole || "Facilitador");
  const allowedRoleSource = user.allowedRoles?.length ? user.allowedRoles : user.enabledProfiles;
  const allowedRoles = normalizeRoleList(allowedRoleSource?.length ? allowedRoleSource : [systemRole]);
  const viewPermissions = normalizeViewPermissions(
    user.viewPermissions?.length ? user.viewPermissions : defaultPermissionsForRole(systemRole),
  );

  const organizationBranding = normalizeOrganizationBranding({
    organization: user.organization,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    branding: user.organizationSettings || user.organization?.settings || DEFAULT_ORGANIZATION_BRANDING.branding,
  });
  const filteredViewPermissions = filterViewPermissionsByOrganization(viewPermissions, organizationBranding.branding);

  return {
    id: user.id || `usr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fullName: String(user.fullName || "Usuario").trim(),
    email: normalizeEmail(user.email),
    passwordHash: user.passwordHash || "",
    status: user.status || "pending_verification",
    systemRole,
    requestedRole: normalizeRoleLabel(user.requestedRole || systemRole),
    allowedRoles: allowedRoles.includes(systemRole) ? allowedRoles : [systemRole, ...allowedRoles],
    viewPermissions: filteredViewPermissions,
    verifiedAt: user.verifiedAt || null,
    verificationTokenHash: user.verificationTokenHash || user.verificationCodeHash || null,
    verificationCodeHash: user.verificationCodeHash || null,
    verificationExpiresAt: user.verificationExpiresAt || null,
    resetTokenHash: user.resetTokenHash || null,
    resetCodeHash: user.resetCodeHash || null,
    resetExpiresAt: user.resetExpiresAt || null,
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordUpdatedAt: user.passwordUpdatedAt || null,
    temporaryPasswordIssuedAt: user.temporaryPasswordIssuedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    accessNote: user.accessNote || "",
    globalAdmin: Boolean(user.globalAdmin),
    chatAlertSettings: normalizeChatAlertSettings(user.chatAlertSettings),
    organizationId: String(user.organizationId || organizationBranding.organization.id || DEFAULT_ORGANIZATION.id),
    organizationName: String(user.organizationName || organizationBranding.organization.name || DEFAULT_ORGANIZATION.name),
    organization: organizationBranding.organization,
    organizationSettings: organizationBranding.branding,
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || nowIso(),
  };
}

function normalizeAuthState(rawState = {}) {
  const rawUsers = Array.isArray(rawState.users) ? rawState.users.map(normalizeUser) : [];
  let deletedUserEmails = Array.isArray(rawState.deletedUserEmails)
    ? rawState.deletedUserEmails.map(normalizeEmail).filter(Boolean)
    : [];
  let deletedUserRegistry = Array.isArray(rawState.deletedUserRegistry)
    ? rawState.deletedUserRegistry.map(normalizeDeletedUserRecord).filter((record) => record.email)
    : [];
  const deletedPresetEmails = Array.isArray(rawState.deletedPresetEmails)
    ? rawState.deletedPresetEmails.map(normalizeEmail).filter(Boolean)
    : [];

  ({ deletedUserEmails, deletedUserRegistry } = recoverProtectedPresetEmails({
    deletedUserEmails,
    deletedUserRegistry,
    deletedPresetEmails,
  }));

  rawUsers.forEach((user) => {
    const shouldPurgeLegacy =
      legacyUserShouldBePurged(user) &&
      (Number(rawState.authDataVersion || 0) < AUTH_DATA_VERSION || legacyUserIsBeforeAccessCutoff(user));
    if (shouldPurgeLegacy && user.email) {
      deletedUserEmails.push(user.email);
      deletedUserRegistry.push(
        createDeletedUserRecord(user, {
          reason: "Purga automatica de registro heredado Lana/Apujo/applehost",
        }),
      );
    }
  });
  const normalizedDeletedEmails = Array.from(new Set(deletedUserEmails));
  const deletedRegistryByKey = new Map();
  deletedUserRegistry.forEach((record) => {
    const key = `${record.email}:${record.userId || ""}:${record.reason || ""}`;
    const existing = deletedRegistryByKey.get(key);
    if (!existing || recordTime(record.deletedAt) >= recordTime(existing.deletedAt)) {
      deletedRegistryByKey.set(key, record);
    }
  });
  const state = {
    users: rawUsers.filter((user) => {
      if (normalizedDeletedEmails.includes(user.email)) return false;
      const latestDeletion = latestDeletionTimeForEmail(user.email, deletedUserRegistry);
      return !latestDeletion || recordTime(user.createdAt || user.updatedAt) > latestDeletion;
    }),
    emailOutbox: Array.isArray(rawState.emailOutbox) ? rawState.emailOutbox.slice() : [],
    deletedUserEmails: normalizedDeletedEmails,
    deletedUserRegistry: Array.from(deletedRegistryByKey.values())
      .sort((left, right) => recordTime(right.deletedAt) - recordTime(left.deletedAt))
      .slice(0, MAX_DELETED_USER_AUDIT),
    deletedPresetEmails,
    session: rawState.session || null,
    presetAccountVersion: Number(rawState.presetAccountVersion || 0),
    authDataVersion: AUTH_DATA_VERSION,
  };

  if (state.session?.userId) {
    const sessionUser = state.users.find((user) => user.id === state.session.userId);
    if (!sessionUser || sessionUser.status !== "active") {
      state.session = null;
    } else {
      const allowedRoles = normalizeRoleList(sessionUser.allowedRoles);
      const activeRole = normalizeRoleLabel(state.session.activeRole || sessionUser.systemRole);
      state.session = {
        ...state.session,
        activeRole: allowedRoles.includes(activeRole) ? activeRole : sessionUser.systemRole,
        sessionToken: String(state.session.sessionToken || ""),
      };
    }
  }

  return state;
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  try {
    if (session?.userId) {
      window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
      window.sessionStorage.removeItem(AUTH_SIGNED_OUT_KEY);
    } else {
      window.localStorage.removeItem(AUTH_SESSION_KEY);
    }
  } catch {
    // Keep auth usable even if persistent storage is unavailable.
  }
}

function restorePersistedSession(state) {
  const normalized = normalizeAuthState(state);
  if (window.sessionStorage.getItem(AUTH_SIGNED_OUT_KEY) === "1") {
    writeStoredSession(null);
    return {
      ...normalized,
      session: null,
    };
  }
  const persistedSession = readStoredSession();
  if (persistedSession?.userId && persistedSession.userId !== normalized.session?.userId) {
    const sessionUser = normalized.users.find((user) => user.id === persistedSession.userId);
    if (!sessionUser || sessionUser.status !== "active") {
      writeStoredSession(null);
    }
  }

  if (normalized.session?.userId) {
    writeStoredSession(normalized.session);
    return normalized;
  }

  if (!persistedSession?.userId) return normalized;

  const sessionUser = normalized.users.find((user) => user.id === persistedSession.userId);
  if (!sessionUser || sessionUser.status !== "active") {
    writeStoredSession(null);
    return normalized;
  }

  return normalizeAuthState({
    ...normalized,
      session: {
        userId: sessionUser.id,
        activeRole: normalizeRoleLabel(persistedSession.activeRole || sessionUser.systemRole),
        createdAt: persistedSession.createdAt || nowIso(),
        sessionToken: String(persistedSession.sessionToken || ""),
      },
    });
}

function readStoredAuthState() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? restorePersistedSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStoredAuthState(state, eventType = "updated") {
  const normalized = normalizeAuthState(state);
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  writeStoredSession(normalized.session);
  authStateCache = normalized;
  authHydrationPromise = null;
  dispatchAuthChange(eventType, { session: normalized.session });
  return normalized;
}

async function buildSeedAuthState() {
  const timestamp = SEEDED_ACCOUNTS_CREATED_AT;
  const presets = await getPresetAccountTemplates();
  return normalizeAuthState({
    users: presets.map((preset) => ({
      ...preset,
      lastLoginAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    emailOutbox: [],
    deletedUserEmails: [],
    deletedUserRegistry: [],
    deletedPresetEmails: [],
    session: null,
    presetAccountVersion: PRESET_ACCOUNT_VERSION,
    authDataVersion: AUTH_DATA_VERSION,
  });
}

async function ensurePresetUsers(state) {
  const timestamp = SEEDED_ACCOUNTS_CREATED_AT;
  const presets = await getPresetAccountTemplates();

  const nextState = normalizeAuthState(state);
  let changed = false;
  const shouldApplyPresetMigration = nextState.presetAccountVersion < PRESET_ACCOUNT_VERSION;
  presets.forEach((preset) => {
    if (nextState.deletedPresetEmails.includes(preset.email)) {
      return;
    }

    const index = nextState.users.findIndex((user) => user.email === preset.email);
    if (index >= 0) {
      const existing = nextState.users[index];
      const shouldUpdate =
        shouldApplyPresetMigration &&
        (existing.passwordHash !== preset.passwordHash ||
          existing.status !== preset.status ||
          existing.systemRole !== preset.systemRole ||
          JSON.stringify(existing.allowedRoles || []) !== JSON.stringify(preset.allowedRoles || []) ||
          JSON.stringify(existing.viewPermissions || []) !== JSON.stringify(preset.viewPermissions || []) ||
          existing.verifiedAt !== preset.verifiedAt ||
          existing.accessNote !== preset.accessNote ||
          existing.fullName !== preset.fullName);

      if (shouldUpdate) {
        nextState.users[index] = normalizeUser({
          ...existing,
          ...preset,
          id: existing.id || preset.id,
          createdAt: existing.createdAt || timestamp,
          updatedAt: timestamp,
        });
        changed = true;
      }
      return;
    }

    changed = true;
    nextState.users.push(
      normalizeUser({
        ...preset,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  });

  if (nextState.presetAccountVersion !== PRESET_ACCOUNT_VERSION) {
    nextState.presetAccountVersion = PRESET_ACCOUNT_VERSION;
    changed = true;
  }
  if (nextState.authDataVersion !== AUTH_DATA_VERSION) {
    nextState.authDataVersion = AUTH_DATA_VERSION;
    changed = true;
  }

  return {
    state: normalizeAuthState(nextState),
    changed,
  };
}

export async function ensureAuthState() {
  if (authStateCache) return authStateCache;
  if (authHydrationPromise) return authHydrationPromise;

  authHydrationPromise = (async () => {
    const existing = readStoredAuthState();
    if (existing) {
      const hydrated = await ensurePresetUsers(existing);
      if (hydrated.changed) {
        return writeStoredAuthState(hydrated.state, "seeded");
      }
      authStateCache = hydrated.state;
      return hydrated.state;
    }

    const seeded = await ensurePresetUsers(await buildSeedAuthState());
    return writeStoredAuthState(seeded.state, "seeded");
  })().finally(() => {
    authHydrationPromise = null;
  });

  return authHydrationPromise;
}

export async function getAuthState() {
  return ensureAuthState();
}

export async function getCurrentUser() {
  let state = await ensureAuthState();
  if (state.session?.userId && Date.now() - lastRemoteSessionSyncAt > REMOTE_SESSION_SYNC_INTERVAL_MS) {
    lastRemoteSessionSyncAt = Date.now();
    try {
      await syncRemoteSessionState("remote-session-validated");
      state = await ensureAuthState();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        state.session = null;
        writeStoredAuthState(state, "remote-session-invalid");
        return null;
      }
      if (!isNetworkAuthError(error)) throw error;
    }
  }
  if (!state.session?.userId) return null;
  return clone(state.users.find((user) => user.id === state.session.userId) || null);
}

export async function updateCurrentUserChatAlertSettings(chatAlertSettings = {}) {
  const response = await requestAuthApi("preferences", {
    method: "PATCH",
    body: JSON.stringify({ chatAlertSettings }),
  });
  return clone(await upsertRemoteUser(response.user, "chat-alert-settings-updated-remote"));
}

export async function getSessionRole() {
  const state = await ensureAuthState();
  if (!state.session?.userId) return null;
  const user = state.users.find((item) => item.id === state.session.userId);
  if (!user) return null;
  return normalizeRoleLabel(state.session.activeRole || user.systemRole);
}

export async function isAuthenticated() {
  return Boolean(await getCurrentUser());
}

export async function getAllowedRoles() {
  const user = await getCurrentUser();
  return user ? normalizeRoleList(user.allowedRoles) : [];
}

export async function hasViewAccess(viewId) {
  const user = await getCurrentUser();
  return Boolean(user && user.viewPermissions.includes(viewId));
}

export async function listVisibleViews() {
  const user = await getCurrentUser();
  return user ? filterViewPermissionsByOrganization(user.viewPermissions, user.organizationSettings).slice() : [];
}

export async function listManagedUsers() {
  try {
    const response = await requestAuthApi("users");
    const syncedUsers = await replaceLocalManagedUsers(response.users || [], "remote-users-listed");
    return syncedUsers
      .slice()
      .sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")))
      .map((user) => ({
        ...clone(user),
        passwordHash: undefined,
        verificationCodeHash: undefined,
        resetCodeHash: undefined,
      }));
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const state = await ensureAuthState();
  return state.users
    .slice()
    .sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")))
    .map((user) => ({
      ...clone(user),
      passwordHash: undefined,
      verificationCodeHash: undefined,
      resetCodeHash: undefined,
    }));
}

export async function listAuthEmails(filters = {}) {
  const state = await ensureAuthState();
  return state.emailOutbox
    .filter((email) => {
      if (filters.toEmail && normalizeEmail(filters.toEmail) !== email.toEmail) return false;
      if (filters.type && filters.type !== email.type) return false;
      return true;
    })
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

export async function signUpUser(payload = {}) {
  const state = await ensureAuthState();
  const email = normalizeEmail(payload.email);
  if (!email) {
    throw new Error("Debes indicar un correo electrónico.");
  }
  if (!String(payload.fullName || "").trim()) {
    throw new Error("Debes indicar el nombre del usuario.");
  }
  if (!String(payload.password || "").trim() || String(payload.password || "").trim().length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (state.users.some((user) => user.email === email)) {
    throw new Error("Ya existe una cuenta registrada con ese correo.");
  }
  clearDeletionMarkersForEmail(state, email);

  const token = createToken();
  const link = buildVerificationLink(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const passwordHash = await sha256(payload.password);
  const verificationTokenHash = await sha256(token);
  const requestedRole = normalizeRoleLabel(payload.requestedRole || "Facilitador");
  const nextUser = normalizeUser({
    id: `usr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fullName: payload.fullName,
    email,
    passwordHash,
    requestedRole,
    systemRole: requestedRole,
    allowedRoles: [requestedRole],
    viewPermissions: defaultPermissionsForRole(requestedRole),
    verificationTokenHash,
    verificationCodeHash: null,
    verificationExpiresAt: expiresAt,
    status: "pending_verification",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    accessNote: "Pendiente de verificacion de correo y aprobacion por supervision.",
  });

  state.users.unshift(nextUser);
  state.emailOutbox.unshift(createEmailRecord({ user: nextUser, type: "verification", link, expiresAt }));
  writeStoredAuthState(state, "signed-up");
  return {
    email,
    requestedRole,
    delivery: "demo-email-outbox",
  };
}

export async function createManagedUser(payload = {}) {
  const state = await ensureAuthState();
  const actor = state.users.find((item) => item.id === state.session?.userId);
  if (!actor || actor.status !== "active") {
    throw new Error("Necesitas una sesion activa para crear usuarios.");
  }

  const email = normalizeEmail(payload.email);
  const fullName = String(payload.fullName || "").trim();
  const password = String(payload.password || "").trim();
  const systemRole = normalizeRoleLabel(payload.systemRole || payload.requestedRole || "Facilitador");
  const status = payload.status || "active";
  const mustChangePassword = payload.mustChangePassword !== false;

  if (!fullName) {
    throw new Error("Debes indicar el nombre del usuario.");
  }
  if (!email) {
    throw new Error("Debes indicar un correo electrónico.");
  }
  if (!password || password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (state.users.some((user) => user.email === email)) {
    throw new Error("Ya existe una cuenta registrada con ese correo.");
  }
  clearDeletionMarkersForEmail(state, email);

  const allowedRoles = normalizeRoleList(payload.allowedRoles?.length ? payload.allowedRoles : [systemRole]);
  const viewPermissions = normalizeViewPermissions(
    payload.viewPermissions?.length ? payload.viewPermissions : defaultPermissionsForRole(systemRole),
  );

  try {
    const response = await requestAuthApi("users", {
      method: "POST",
      headers: { "x-mel-actor-id": actor.id },
      body: JSON.stringify({
        fullName,
        email,
        temporaryPassword: password,
        primaryRole: systemRole,
        enabledProfiles: allowedRoles,
        viewPermissions: viewPermissions.length ? viewPermissions : defaultPermissionsForRole(systemRole),
        organizationId: String(payload.organizationId || "").trim() || undefined,
        status,
        accessNote: String(payload.accessNote || "Usuario creado desde Accesos.").trim(),
      }),
    });
    return clone({
      ...(await upsertRemoteUser(response.user, "managed-user-created-remote")),
      passwordHash: undefined,
    });
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const nextUser = normalizeUser({
    id: `usr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fullName,
    email,
    passwordHash: await sha256(password),
    requestedRole: systemRole,
    systemRole,
    allowedRoles,
    viewPermissions: viewPermissions.length ? viewPermissions : defaultPermissionsForRole(systemRole),
    organizationId: String(payload.organizationId || "").trim() || actor.organizationId || DEFAULT_ORGANIZATION.id,
    organizationName: String(payload.organizationName || "").trim() || actor.organizationName || DEFAULT_ORGANIZATION.name,
    verifiedAt: nowIso(),
    status,
    mustChangePassword,
    passwordUpdatedAt: null,
    temporaryPasswordIssuedAt: mustChangePassword ? nowIso() : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    accessNote: String(payload.accessNote || "Usuario creado desde Accesos.").trim(),
  });

  state.users.unshift(nextUser);
  state.emailOutbox.unshift(
    createEmailRecord({ user: nextUser, type: "temporary-password", code: password, expiresAt: null }),
  );
  writeStoredAuthState(state, "managed-user-created");
  return clone({
    ...nextUser,
    passwordHash: undefined,
  });
}

function completeVerification(user) {
  user.verificationTokenHash = null;
  user.verificationCodeHash = null;
  user.verificationExpiresAt = null;
  user.verifiedAt = nowIso();
  user.status = "pending_approval";
  user.updatedAt = nowIso();
}

export async function verifyRegisteredUser(payload = {}) {
  const state = await ensureAuthState();
  const email = normalizeEmail(payload.email);
  const code = String(payload.code || "").trim();
  const user = state.users.find((item) => item.email === email);
  if (!user) {
    throw new Error("No encontre una cuenta con ese correo.");
  }
  if (!user.verificationCodeHash || !code) {
    throw new Error("Debes ingresar el codigo de verificacion.");
  }
  if (user.verificationExpiresAt && Date.parse(user.verificationExpiresAt) < Date.now()) {
    throw new Error("El codigo de verificacion ya expiro.");
  }

  const incomingHash = await sha256(code);
  if (incomingHash !== user.verificationCodeHash) {
    throw new Error("El codigo de verificacion no coincide.");
  }

  completeVerification(user);
  writeStoredAuthState(state, "verified");
  return {
    email,
    status: user.status,
  };
}

export async function verifyRegisteredUserByLink(token) {
  const state = await ensureAuthState();
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    throw new Error("El enlace de verificacion esta incompleto.");
  }

  const incomingHash = await sha256(rawToken);
  const user = state.users.find((item) => item.verificationTokenHash === incomingHash);
  if (!user) {
    throw new Error("El enlace de verificacion no es valido.");
  }
  if (user.verificationExpiresAt && Date.parse(user.verificationExpiresAt) < Date.now()) {
    throw new Error("El enlace de verificacion ya expiro.");
  }

  completeVerification(user);
  writeStoredAuthState(state, "verified");
  return {
    email: user.email,
    status: user.status,
  };
}

export async function signInUser(payload = {}) {
  const state = await ensureAuthState();
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const organizationContext = readRequestedOrganizationContext();

  try {
    const response = await requestAuthApi("sign-in", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        organizationId: organizationContext.organizationId || document.documentElement.dataset.organizationId || DEFAULT_ORGANIZATION.id,
        organizationSlug: organizationContext.organizationSlug || document.documentElement.dataset.organizationSlug || "",
      }),
    });
    if (response.passwordChangeRequired) {
      return clone({
        passwordChangeRequired: true,
        user: mapRemoteUser(response.user),
      });
    }
    const user = await startRemoteSession({ ...(response.user || {}), sessionToken: response.sessionToken || "" }, "signed-in-remote");
    return clone({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        systemRole: user.systemRole,
        allowedRoles: user.allowedRoles,
        viewPermissions: user.viewPermissions,
      },
    });
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const user = state.users.find((item) => item.email === email);
  if (!user) {
    throw new Error("No encontre una cuenta con ese correo.");
  }

  const passwordHash = await sha256(password);
  if (passwordHash !== user.passwordHash) {
    throw new Error("La contraseña no coincide.");
  }
  if (!user.verifiedAt) {
    throw new Error("Debes verificar tu correo antes de entrar.");
  }
  if (user.status === "pending_approval") {
    throw new Error("Tu cuenta ya fue verificada, pero sigue pendiente de aprobacion por supervision.");
  }
  if (user.status === "suspended") {
    throw new Error("Tu acceso al sistema esta suspendido.");
  }
  if (user.status !== "active") {
    throw new Error("Tu cuenta no tiene acceso activo todavia.");
  }

  if (user.mustChangePassword) {
    return clone({
      passwordChangeRequired: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        systemRole: user.systemRole,
      },
    });
  }

  user.lastLoginAt = nowIso();
  user.updatedAt = nowIso();
  state.session = {
    userId: user.id,
    activeRole: normalizeRoleLabel(user.systemRole),
    createdAt: nowIso(),
  };
  writeStoredAuthState(state, "signed-in");
  return clone({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      systemRole: user.systemRole,
      allowedRoles: user.allowedRoles,
      viewPermissions: user.viewPermissions,
    },
  });
}

export async function signOutUser() {
  const state = await ensureAuthState();
  try {
    await requestAuthApi("sign-out", {
      method: "POST",
    });
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }
  state.session = null;
  try {
    window.sessionStorage.setItem(AUTH_SIGNED_OUT_KEY, "1");
  } catch {
    // ignore storage issues during sign out
  }
  writeStoredAuthState(state, "signed-out");
}

export async function completeRequiredPasswordChange(payload = {}) {
  const state = await ensureAuthState();
  const email = normalizeEmail(payload.email);
  const currentPassword = String(payload.currentPassword || "");
  const nextPassword = String(payload.password || "").trim();

  try {
    const response = await requestAuthApi("complete-password-change", {
      method: "POST",
      body: JSON.stringify({ email, currentPassword, password: nextPassword }),
    });
    const user = await startRemoteSession(response.user, "password-change-completed-remote");
    return clone({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        systemRole: user.systemRole,
        allowedRoles: user.allowedRoles,
        viewPermissions: user.viewPermissions,
      },
    });
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const user = state.users.find((item) => item.email === email);
  if (!user) {
    throw new Error("No encontre una cuenta con ese correo.");
  }
  if (user.status === "suspended") {
    throw new Error("Tu acceso al sistema esta suspendido.");
  }
  if (user.status !== "active") {
    throw new Error("Tu cuenta no tiene acceso activo todavia.");
  }
  if (!nextPassword || nextPassword.length < 8) {
    throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
  }

  const currentHash = await sha256(currentPassword);
  const nextHash = await sha256(nextPassword);
  if (currentHash !== user.passwordHash) {
    throw new Error("La contraseña provisional no coincide.");
  }
  if (nextHash === user.passwordHash) {
    throw new Error("La nueva contraseña debe ser distinta a la provisional.");
  }

  user.passwordHash = nextHash;
  user.mustChangePassword = false;
  user.passwordUpdatedAt = nowIso();
  user.temporaryPasswordIssuedAt = null;
  user.resetCodeHash = null;
  user.resetExpiresAt = null;
  user.lastLoginAt = nowIso();
  user.updatedAt = nowIso();
  state.session = {
    userId: user.id,
    activeRole: normalizeRoleLabel(user.systemRole),
    createdAt: nowIso(),
  };
  writeStoredAuthState(state, "password-change-completed");
  return clone({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      systemRole: user.systemRole,
      allowedRoles: user.allowedRoles,
      viewPermissions: user.viewPermissions,
    },
  });
}

export async function requestPasswordReset(payload = {}) {
  const state = await ensureAuthState();
  const email = normalizeEmail(payload.email);

  try {
    const response = await requestAuthApi("request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email, resetBaseUrl: passwordResetBaseUrl() }),
    });
    return {
      email: response.email || email,
      delivery: response.delivery || "email",
      previewLink: response.previewLink || null,
    };
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const user = state.users.find((item) => item.email === email);
  if (!user) {
    throw new Error("No encontre una cuenta con ese correo.");
  }
  if (user.status === "suspended") {
    throw new Error("Tu acceso al sistema esta suspendido.");
  }

  const token = createToken();
  const link = buildPasswordResetLink(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  user.resetTokenHash = await sha256(token);
  user.resetCodeHash = null;
  user.resetExpiresAt = expiresAt;
  user.updatedAt = nowIso();
  state.emailOutbox.unshift(createEmailRecord({ user, type: "reset", link, expiresAt }));
  writeStoredAuthState(state, "reset-requested");
  return {
    email,
    delivery: "demo-email-outbox",
    previewLink: link,
  };
}

export async function resetPassword(payload = {}) {
  const state = await ensureAuthState();
  const email = normalizeEmail(payload.email);
  const token = String(payload.token || payload.code || "").trim();
  const nextPassword = String(payload.password || "").trim();

  try {
    const response = await requestAuthApi("reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: nextPassword }),
    });
    return {
      email: response.user?.email || email,
    };
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const incomingHash = await sha256(token);
  const user = email
    ? state.users.find((item) => item.email === email)
    : state.users.find((item) => item.resetTokenHash === incomingHash || item.resetCodeHash === incomingHash);
  if (!user) {
    throw new Error("No encontre una cuenta con ese correo.");
  }
  if (user.status === "suspended") {
    throw new Error("Tu acceso al sistema esta suspendido.");
  }
  if ((!user.resetTokenHash && !user.resetCodeHash) || !token) {
    throw new Error("Debes abrir el enlace de recuperacion enviado a tu correo.");
  }
  if (!nextPassword || nextPassword.length < 8) {
    throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
  }
  if (user.resetExpiresAt && Date.parse(user.resetExpiresAt) < Date.now()) {
    throw new Error("El enlace de recuperacion ya expiro.");
  }

  if (incomingHash !== user.resetTokenHash && incomingHash !== user.resetCodeHash) {
    throw new Error("El enlace de recuperacion no coincide.");
  }

  user.passwordHash = await sha256(nextPassword);
  user.mustChangePassword = false;
  user.passwordUpdatedAt = nowIso();
  user.temporaryPasswordIssuedAt = null;
  user.resetTokenHash = null;
  user.resetCodeHash = null;
  user.resetExpiresAt = null;
  user.updatedAt = nowIso();
  writeStoredAuthState(state, "password-reset");
  return { email };
}

export async function updateManagedUserAccess(userId, updates = {}) {
  const state = await ensureAuthState();
  const actor = state.users.find((item) => item.id === state.session?.userId);
  if (!actor || actor.status !== "active") {
    throw new Error("Necesitas una sesion activa para administrar accesos.");
  }

  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    throw new Error("No encontre el usuario solicitado.");
  }

  const nextFullName = String(updates.fullName || user.fullName || "").trim();
  const nextEmail = normalizeEmail(updates.email || user.email);
  const nextPassword = String(updates.password || "").trim();
  const nextSystemRole = normalizeRoleLabel(updates.systemRole || user.systemRole);
  const nextAllowedRoles = normalizeRoleList(updates.allowedRoles?.length ? updates.allowedRoles : user.allowedRoles);
  const nextViewPermissions = normalizeViewPermissions(
    updates.viewPermissions?.length ? updates.viewPermissions : user.viewPermissions,
  );
  const mustChangePassword = Boolean(updates.mustChangePassword);

  if (!nextFullName) {
    throw new Error("Debes indicar el nombre del usuario.");
  }
  if (!nextEmail) {
    throw new Error("Debes indicar un correo electrónico.");
  }
  if (nextEmail !== user.email && state.users.some((item) => item.email === nextEmail)) {
    throw new Error("Ya existe una cuenta registrada con ese correo.");
  }
  if (nextPassword && nextPassword.length < 8) {
    throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
  }

  try {
    const response = await requestAuthApi(`users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: { "x-mel-actor-id": actor.id },
      body: JSON.stringify({
        fullName: nextFullName,
        email: nextEmail,
        password: nextPassword || undefined,
        primaryRole: nextSystemRole,
        enabledProfiles: nextAllowedRoles.includes(nextSystemRole)
          ? nextAllowedRoles
          : [nextSystemRole, ...nextAllowedRoles],
        viewPermissions: nextViewPermissions.length ? nextViewPermissions : defaultPermissionsForRole(nextSystemRole),
        status: updates.status || user.status,
        mustChangePassword,
        accessNote: String(updates.accessNote || user.accessNote || "").trim(),
      }),
    });
    return clone(await upsertRemoteUser(response.user, "access-updated-remote"));
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  user.fullName = nextFullName;
  user.email = nextEmail;
  if (nextPassword) {
    user.passwordHash = await sha256(nextPassword);
    user.passwordUpdatedAt = mustChangePassword ? null : nowIso();
    user.temporaryPasswordIssuedAt = mustChangePassword ? nowIso() : null;
    if (mustChangePassword) {
      state.emailOutbox.unshift(
        createEmailRecord({ user, type: "temporary-password", code: nextPassword, expiresAt: null }),
      );
    }
  }
  user.mustChangePassword = mustChangePassword;
  if (!nextPassword && !mustChangePassword) {
    user.temporaryPasswordIssuedAt = null;
  }
  user.systemRole = nextSystemRole;
  user.allowedRoles = nextAllowedRoles.includes(nextSystemRole)
    ? nextAllowedRoles
    : [nextSystemRole, ...nextAllowedRoles];
  user.viewPermissions = nextViewPermissions.length ? nextViewPermissions : defaultPermissionsForRole(nextSystemRole);
  user.status = updates.status || user.status;
  user.accessNote = String(updates.accessNote || user.accessNote || "").trim();
  user.updatedAt = nowIso();

  if (user.status === "active" && !user.verifiedAt) {
    user.verifiedAt = nowIso();
    user.verificationTokenHash = null;
    user.verificationCodeHash = null;
    user.verificationExpiresAt = null;
  }

  if (state.session?.userId === user.id) {
    if (user.status !== "active") {
      state.session = null;
    } else {
      state.session.activeRole = user.allowedRoles.includes(state.session.activeRole)
        ? state.session.activeRole
        : user.systemRole;
    }
  }

  writeStoredAuthState(state, "access-updated");
  return clone(user);
}

export async function deleteManagedUser(userId) {
  const state = await ensureAuthState();
  const actor = state.users.find((item) => item.id === state.session?.userId);
  if (!actor || actor.status !== "active") {
    throw new Error("Necesitas una sesion activa para eliminar usuarios.");
  }
  if (actor.id === userId) {
    throw new Error("No puedes eliminar tu propia cuenta mientras estas dentro.");
  }

  const userIndex = state.users.findIndex((item) => item.id === userId);
  if (userIndex === -1) {
    throw new Error("No encontre el usuario solicitado.");
  }
  const userPendingDelete = state.users[userIndex];

  try {
    const response = await requestAuthApi(`users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { "x-mel-actor-id": actor.id },
      body: JSON.stringify({ actorId: actor.id }),
    });
    if (Array.isArray(response.users)) {
      await replaceLocalManagedUsers(response.users, "managed-user-deleted-remote");
    } else {
      state.users.splice(userIndex, 1);
      writeStoredAuthState(state, "managed-user-deleted-remote");
    }
    return clone(response.deletedUser || {
      id: userId,
      email: userPendingDelete.email,
      fullName: userPendingDelete.fullName,
    });
  } catch (error) {
    if (!shouldUseLocalAuthFallback(error)) throw sharedAuthApiError(error);
  }

  const [deletedUser] = state.users.splice(userIndex, 1);
  state.deletedUserEmails = Array.from(new Set([...(state.deletedUserEmails || []), deletedUser.email]));
  state.deletedUserRegistry = [
    createDeletedUserRecord(deletedUser, {
      actor,
      reason: "Eliminacion definitiva desde Accesos",
    }),
    ...(state.deletedUserRegistry || []),
  ];
  const presets = await getPresetAccountTemplates();
  if (presets.some((preset) => preset.email === deletedUser.email)) {
    state.deletedPresetEmails = Array.from(new Set([...(state.deletedPresetEmails || []), deletedUser.email]));
  }
  state.emailOutbox = state.emailOutbox.filter((item) => item.toEmail !== deletedUser.email);
  if (state.session?.userId === deletedUser.id) {
    state.session = null;
  }

  writeStoredAuthState(state, "managed-user-deleted");
  return clone({
    id: deletedUser.id,
    email: deletedUser.email,
    fullName: deletedUser.fullName,
  });
}

export async function setSessionRole(nextRole) {
  const state = await ensureAuthState();
  const user = state.users.find((item) => item.id === state.session?.userId);
  if (!user) {
    throw new Error("No hay una sesion activa.");
  }
  const normalizedRole = normalizeRoleLabel(nextRole);
  if (!user.allowedRoles.includes(normalizedRole)) {
    throw new Error("Ese perfil no esta habilitado para tu usuario.");
  }
  state.session.activeRole = normalizedRole;
  writeStoredAuthState(state, "role-updated");
  return normalizedRole;
}

export function onAuthStateChange(listener) {
  const handler = (event) => listener(event.detail || {});
  window.addEventListener(AUTH_EVENT_NAME, handler);
  return () => window.removeEventListener(AUTH_EVENT_NAME, handler);
}

export function getDemoSupervisorCredentials() {
  return clone(DEMO_SUPERVISOR);
}

export function getSeededAccessManagerCredentials() {
  return clone(SEEDED_ACCESS_MANAGER);
}

