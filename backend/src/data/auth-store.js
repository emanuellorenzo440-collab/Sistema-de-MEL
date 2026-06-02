import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_AUTH_DATA_VERSION = 2;
const PRESET_ACCOUNT_VERSION = 4;
const PASSWORD_HASH_VERSION = "pbkdf2-sha512";
const PASSWORD_ITERATIONS = 120000;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PRODUCT_NAME = "Nexora";
const VIEW_KEYS = [
  "dashboard",
  "report",
  "indicators",
  "design",
  "forms",
  "charts",
  "chat",
  "attendance",
  "concepts",
  "supervision",
  "programs",
  "access",
];
const DEFAULT_ORGANIZATION = {
  id: "org-convoy-of-hope",
  name: "Convoy of Hope",
  slug: "convoy-of-hope",
  hostnames: [],
  settings: {
    productName: DEFAULT_PRODUCT_NAME,
    organizationName: "Convoy of Hope",
    loginTagline: "Plataforma operacional personalizada para Convoy of Hope",
    loginLead:
      "Entra con tus credenciales institucionales para continuar con reportes, aprobaciones y seguimiento operativo de Convoy of Hope.",
    sidebarCaption: "Convoy of Hope",
    topbarEyebrow: "Nexora | Convoy of Hope",
    brandLogoPath: "assets/convoy-of-hope-logo.jpg",
    loginHeroPath: "assets/convoy-of-hope-hero.jpg",
    primaryColor: "#c5332f",
    primaryDarkColor: "#972623",
    accentColor: "#2f85c7",
    enabledModules: VIEW_KEYS,
  },
};
const MASTER_ORGANIZATION = {
  id: "org-nexora-admin",
  name: "Nexora Admin",
  slug: "nexora-admin",
  hostnames: ["admin.nexora.app"],
  settings: {
    productName: DEFAULT_PRODUCT_NAME,
    organizationName: "Nexora Admin",
    loginTagline: "Portal maestro para administrar organizaciones, branding y modulos de Nexora",
    loginLead: "Entra con tu cuenta global para crear organizaciones y preparar sus portales sin depender de ningun tenant operativo.",
    sidebarCaption: "Control maestro",
    topbarEyebrow: "Nexora | Portal maestro",
    brandLogoPath: "assets/nexora-admin-logo.svg",
    loginHeroPath: "assets/nexora-admin-hero.svg",
    primaryColor: "#11446b",
    primaryDarkColor: "#0a2c46",
    accentColor: "#27c1da",
    enabledModules: ["access"],
  },
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(dirname, "..", "..", "data");
const dataDir = process.env.MEL_AUTH_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || defaultDataDir;
const authDbPath = process.env.MEL_AUTH_DB_PATH || path.join(dataDir, "auth-store.json");

const SYSTEM_ROLES = {
  facilitator: "Facilitador",
  programCoordinator: "Coordinador de programa",
  programManager: "Program Manager",
  nationalDirector: "Director Nacional",
  supervision: "Supervision M&E",
};

const DEFAULT_ROLE_PERMISSIONS = {
  [SYSTEM_ROLES.facilitator]: ["dashboard", "report", "forms", "charts", "chat", "attendance"],
  [SYSTEM_ROLES.programCoordinator]: [
    "dashboard",
    "report",
    "indicators",
    "forms",
    "chat",
    "attendance",
    "charts",
    "concepts",
    "programs",
  ],
  [SYSTEM_ROLES.programManager]: [
    "dashboard",
    "report",
    "indicators",
    "design",
    "forms",
    "chat",
    "attendance",
    "charts",
    "concepts",
    "supervision",
    "programs",
  ],
  [SYSTEM_ROLES.nationalDirector]: [
    "dashboard",
    "report",
    "indicators",
    "design",
    "forms",
    "chat",
    "attendance",
    "charts",
    "concepts",
    "supervision",
    "programs",
    "access",
  ],
  [SYSTEM_ROLES.supervision]: VIEW_KEYS,
};

const SEEDED_ACCOUNTS = [
  {
    id: "supervision",
    fullName: "Equipo Supervision M&E",
    email: "supervision@pulso-me.org",
    password: "PulsoMEL2026!",
    primaryRole: SYSTEM_ROLES.supervision,
    status: "active",
    accessNote: "Cuenta administradora base del sistema.",
    mustChangePassword: false,
    organizationId: DEFAULT_ORGANIZATION.id,
    organizationName: DEFAULT_ORGANIZATION.name,
  },
  {
    id: "llorenzo-supervision",
    fullName: "L Lorenzo",
    email: "llorenzo@convoyofhope.org",
    password: "ConvoyHope2026!",
    primaryRole: SYSTEM_ROLES.supervision,
    status: "active",
    accessNote: "Cuenta administradora configurada para iniciar sesion directamente.",
    mustChangePassword: false,
    organizationId: DEFAULT_ORGANIZATION.id,
    organizationName: DEFAULT_ORGANIZATION.name,
  },
  {
    id: "apujols-facilitator",
    fullName: "A Pujols",
    email: "apujols@convoyofhope.org",
    password: "Facilitador2026!",
    primaryRole: SYSTEM_ROLES.facilitator,
    status: "active",
    accessNote: "Cuenta facilitadora configurada para iniciar sesion directamente.",
    mustChangePassword: false,
    organizationId: DEFAULT_ORGANIZATION.id,
    organizationName: DEFAULT_ORGANIZATION.name,
  },
  {
    id: "nexora-platform-admin",
    fullName: "Nexora Platform Admin",
    email: "admin@nexora.app",
    password: "NexoraAdmin2026!",
    primaryRole: SYSTEM_ROLES.supervision,
    status: "active",
    accessNote: "Cuenta global para administrar organizaciones y portales de Nexora.",
    mustChangePassword: false,
    organizationId: MASTER_ORGANIZATION.id,
    organizationName: MASTER_ORGANIZATION.name,
    globalAdmin: true,
  },
];

let cachedState = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.pbkdf2Sync(String(password || ""), salt, PASSWORD_ITERATIONS, 64, "sha512").toString("hex");
  return `${PASSWORD_HASH_VERSION}$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

function legacyHashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function verifyPassword(password, storedHash) {
  const normalizedHash = String(storedHash || "");
  if (!normalizedHash) return false;
  if (!normalizedHash.startsWith(`${PASSWORD_HASH_VERSION}$`)) {
    return legacyHashPassword(password) === normalizedHash;
  }
  const [, iterationsText, salt, expectedDigest] = normalizedHash.split("$");
  const iterations = Number(iterationsText || PASSWORD_ITERATIONS);
  if (!salt || !expectedDigest || !Number.isFinite(iterations)) return false;
  const actualDigest = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 64, "sha512").toString("hex");
  const expectedBuffer = Buffer.from(expectedDigest, "hex");
  const actualBuffer = Buffer.from(actualDigest, "hex");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeList(values, fallback = []) {
  const list = Array.isArray(values) ? values : fallback;
  return [...new Set(list.filter(Boolean))];
}

function normalizeChatAlertSettings(value = {}) {
  const soundMode = String(value.soundMode || "").trim() === "muted-permanent" ? "muted-permanent" : "enabled";
  const mutedUntil = value.mutedUntil ? String(value.mutedUntil) : null;
  return {
    soundMode,
    mutedUntil,
  };
}

function rolePermissions(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS[SYSTEM_ROLES.facilitator];
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHostname(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function normalizeHostnameList(values = []) {
  const list = Array.isArray(values)
    ? values
    : String(values || "")
        .split(/[\n,]+/g)
        .map((item) => item.trim());
  return [...new Set(list.map((item) => normalizeHostname(item)).filter(Boolean))];
}

function normalizeOrganizationSettings(settings = {}, fallbackName = DEFAULT_ORGANIZATION.name) {
  const organizationName = String(settings.organizationName || fallbackName || DEFAULT_ORGANIZATION.name).trim() || DEFAULT_ORGANIZATION.name;
  const productName = String(settings.productName || DEFAULT_PRODUCT_NAME).trim() || DEFAULT_PRODUCT_NAME;
  const enabledModules = normalizeList(
    Array.isArray(settings.enabledModules) && settings.enabledModules.length ? settings.enabledModules : VIEW_KEYS,
    VIEW_KEYS,
  ).filter((viewId) => VIEW_KEYS.includes(viewId));
  return {
    productName,
    organizationName,
    loginTagline:
      String(settings.loginTagline || "").trim() ||
      `Plataforma operacional personalizada para ${organizationName}`,
    loginLead:
      String(settings.loginLead || "").trim() ||
      `Entra con tus credenciales institucionales para continuar con reportes, aprobaciones y seguimiento operativo de ${organizationName}.`,
    sidebarCaption: String(settings.sidebarCaption || "").trim() || organizationName,
    topbarEyebrow: String(settings.topbarEyebrow || "").trim() || `${productName} | ${organizationName}`,
    brandLogoPath: String(settings.brandLogoPath || DEFAULT_ORGANIZATION.settings.brandLogoPath).trim(),
    loginHeroPath: String(settings.loginHeroPath || DEFAULT_ORGANIZATION.settings.loginHeroPath).trim(),
    primaryColor: String(settings.primaryColor || DEFAULT_ORGANIZATION.settings.primaryColor).trim(),
    primaryDarkColor: String(settings.primaryDarkColor || DEFAULT_ORGANIZATION.settings.primaryDarkColor).trim(),
    accentColor: String(settings.accentColor || DEFAULT_ORGANIZATION.settings.accentColor).trim(),
    enabledModules: enabledModules.length ? enabledModules : VIEW_KEYS.slice(),
  };
}

function normalizeOrganization(organization = {}) {
  const id = String(organization.id || DEFAULT_ORGANIZATION.id).trim() || DEFAULT_ORGANIZATION.id;
  const name = String(organization.name || DEFAULT_ORGANIZATION.name).trim() || DEFAULT_ORGANIZATION.name;
  const hostnames = normalizeHostnameList(organization.hostnames);
  return {
    id,
    name,
    slug: String(organization.slug || slugify(name) || DEFAULT_ORGANIZATION.slug).trim() || DEFAULT_ORGANIZATION.slug,
    hostnames,
    settings: normalizeOrganizationSettings(organization.settings || {}, name),
  };
}

function createSeedUser(account) {
  const createdAt = nowIso();
  const permissions = rolePermissions(account.primaryRole);
  return {
    id: account.id,
    fullName: account.fullName,
    email: normalizeEmail(account.email),
    primaryRole: account.primaryRole,
    enabledProfiles: [account.primaryRole],
    viewPermissions: permissions,
    organizationId: account.organizationId || DEFAULT_ORGANIZATION.id,
    organizationName: account.organizationName || DEFAULT_ORGANIZATION.name,
    globalAdmin: Boolean(account.globalAdmin),
    status: account.status || "active",
    accessNote: account.accessNote || "",
    mustChangePassword: Boolean(account.mustChangePassword),
    passwordHash: hashPassword(account.password),
    createdAt,
    updatedAt: createdAt,
    createdBy: "seed",
    updatedBy: "seed",
  };
}

function buildInitialState() {
  return {
    authDataVersion: CURRENT_AUTH_DATA_VERSION,
    presetAccountVersion: PRESET_ACCOUNT_VERSION,
    organizations: [normalizeOrganization(DEFAULT_ORGANIZATION), normalizeOrganization(MASTER_ORGANIZATION)],
    users: SEEDED_ACCOUNTS.map(createSeedUser),
    activeSessions: [],
    deletedUserRegistry: [],
    emailOutbox: [],
    auditLog: [],
  };
}

function ensureDir() {
  fs.mkdirSync(path.dirname(authDbPath), { recursive: true });
}

function readStateFromDisk() {
  try {
    const raw = fs.readFileSync(authDbPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function writeStateToDisk(state) {
  ensureDir();
  fs.writeFileSync(authDbPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function findOrganizationById(organizationId, state = getState()) {
  const normalizedId = String(organizationId || "").trim();
  if (!normalizedId) return null;
  return state.organizations.find((organization) => organization.id === normalizedId) || null;
}

function findOrganizationBySlug(slug, state = getState()) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!normalizedSlug) return null;
  return state.organizations.find((organization) => String(organization.slug || "").trim().toLowerCase() === normalizedSlug) || null;
}

function findOrganizationByHostname(hostname, state = getState()) {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return null;
  return (
    state.organizations.find((organization) =>
      Array.isArray(organization.hostnames) && organization.hostnames.some((entry) => normalizeHostname(entry) === normalizedHost),
    ) || null
  );
}

function resolveOrganizationContext(selector = {}, state = getState()) {
  const direct =
    findOrganizationById(selector.organizationId, state) ||
    findOrganizationBySlug(selector.slug || selector.organizationSlug, state) ||
    findOrganizationByHostname(selector.host || selector.hostname, state);

  if (direct) return normalizeOrganization(direct);
  return state.organizations.length ? normalizeOrganization(state.organizations[0]) : normalizeOrganization(DEFAULT_ORGANIZATION);
}

function portalUrlForHostname(hostname = "") {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return "";
  const protocol = normalizedHost.includes("localhost") || /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost) ? "http" : "https";
  return `${protocol}://${normalizedHost}`;
}

function buildOrganizationPortalLinks(organization = {}) {
  const normalized = normalizeOrganization(organization);
  const primaryHostname = normalized.hostnames[0] || "";
  const aliases = normalized.hostnames.slice(1);
  const fallbackPortalPath =
    normalized.slug === "nexora-admin"
      ? "/admin"
      : normalized.slug === "convoy-of-hope"
        ? "/"
        : `/portal/${encodeURIComponent(normalized.slug)}`;
  return {
    primaryHostname,
    primaryPortalUrl: portalUrlForHostname(primaryHostname),
    hostnameAliases: aliases,
    hostnamePortalUrls: normalized.hostnames.map((hostname) => portalUrlForHostname(hostname)).filter(Boolean),
    fallbackPortalQuery: fallbackPortalPath,
  };
}

function publicOrganizationRecord(organization = {}) {
  const normalized = normalizeOrganization(organization);
  return {
    id: normalized.id,
    name: normalized.name,
    slug: normalized.slug,
    hostnames: normalized.hostnames.slice(),
    settings: structuredClone(normalized.settings),
    ...buildOrganizationPortalLinks(normalized),
  };
}

function organizationConflicts(candidateOrganization, existingOrganizations = [], excludeId = "") {
  const next = normalizeOrganization(candidateOrganization);
  const nextHostnames = new Set(next.hostnames.map((hostname) => normalizeHostname(hostname)));
  return existingOrganizations.find((organization) => {
    if (excludeId && organization.id === excludeId) return false;
    if (organization.slug === next.slug) return true;
    const candidateHostnames = normalizeHostnameList(organization.hostnames);
    return candidateHostnames.some((hostname) => nextHostnames.has(hostname));
  });
}

function resolveOrganizationForUser(user, state = getState()) {
  const existing = findOrganizationById(user?.organizationId, state);
  if (existing) return normalizeOrganization(existing);
  return normalizeOrganization({
    ...DEFAULT_ORGANIZATION,
    id: String(user?.organizationId || DEFAULT_ORGANIZATION.id).trim() || DEFAULT_ORGANIZATION.id,
    name: String(user?.organizationName || DEFAULT_ORGANIZATION.name).trim() || DEFAULT_ORGANIZATION.name,
  });
}

function safeUser(user, state = getState()) {
  if (!user) {
    return null;
  }

  const { passwordHash, resetTokenHash, ...publicUser } = user;
  const organization = resolveOrganizationForUser(publicUser, state);
  const enabledModules = normalizeList(organization.settings?.enabledModules, VIEW_KEYS).filter((viewId) => VIEW_KEYS.includes(viewId));
  const grantedViews = normalizeList(publicUser.viewPermissions, rolePermissions(publicUser.primaryRole)).filter((viewId) =>
    enabledModules.includes(viewId),
  );
  return {
    ...publicUser,
    email: normalizeEmail(publicUser.email),
    enabledProfiles: normalizeList(publicUser.enabledProfiles, [publicUser.primaryRole]),
    viewPermissions: grantedViews,
    organizationId: organization.id,
    organizationName: organization.name,
    globalAdmin: Boolean(publicUser.globalAdmin),
    organization,
    organizationSettings: structuredClone(organization.settings),
    mustChangePassword: Boolean(publicUser.mustChangePassword),
    chatAlertSettings: normalizeChatAlertSettings(publicUser.chatAlertSettings),
  };
}

function normalizeUser(user) {
  const primaryRole = user.primaryRole || SYSTEM_ROLES.facilitator;
  return {
    id: String(user.id || crypto.randomUUID()),
    fullName: String(user.fullName || user.email || "Usuario").trim(),
    email: normalizeEmail(user.email),
    primaryRole,
    enabledProfiles: normalizeList(user.enabledProfiles, [primaryRole]),
    viewPermissions: normalizeList(user.viewPermissions, rolePermissions(primaryRole)),
    organizationId: String(user.organizationId || DEFAULT_ORGANIZATION.id),
    organizationName: String(user.organizationName || DEFAULT_ORGANIZATION.name),
    globalAdmin: Boolean(user.globalAdmin),
    status: user.status === "suspended" ? "suspended" : "active",
    accessNote: String(user.accessNote || ""),
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordHash: user.passwordHash || "",
    resetTokenHash: user.resetTokenHash || null,
    resetExpiresAt: user.resetExpiresAt || null,
    resetRequestedAt: user.resetRequestedAt || null,
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || nowIso(),
    createdBy: user.createdBy || "system",
    updatedBy: user.updatedBy || user.createdBy || "system",
    lastLoginAt: user.lastLoginAt || null,
    passwordChangedAt: user.passwordChangedAt || null,
    chatAlertSettings: normalizeChatAlertSettings(user.chatAlertSettings),
  };
}

function normalizeSession(session = {}) {
  return {
    id: String(session.id || crypto.randomUUID()),
    userId: String(session.userId || ""),
    organizationId: String(session.organizationId || DEFAULT_ORGANIZATION.id),
    tokenHash: String(session.tokenHash || ""),
    createdAt: session.createdAt || nowIso(),
    lastSeenAt: session.lastSeenAt || nowIso(),
    expiresAt: session.expiresAt || new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
  };
}

function migrateState(state) {
  const next = {
    ...buildInitialState(),
    ...state,
    users: Array.isArray(state?.users) ? state.users.map(normalizeUser).filter((user) => user.email) : [],
    deletedUserRegistry: Array.isArray(state?.deletedUserRegistry) ? state.deletedUserRegistry : [],
    emailOutbox: Array.isArray(state?.emailOutbox) ? state.emailOutbox : [],
    auditLog: Array.isArray(state?.auditLog) ? state.auditLog : [],
    organizations:
      Array.isArray(state?.organizations) && state.organizations.length
        ? state.organizations.map((organization) => normalizeOrganization(organization))
        : [normalizeOrganization(DEFAULT_ORGANIZATION)],
    activeSessions: Array.isArray(state?.activeSessions) ? state.activeSessions.map(normalizeSession) : [],
    authDataVersion: CURRENT_AUTH_DATA_VERSION,
    presetAccountVersion: Number(state?.presetAccountVersion || 0),
  };

  if (!next.organizations.some((organization) => organization.id === DEFAULT_ORGANIZATION.id)) {
    next.organizations.unshift(normalizeOrganization(DEFAULT_ORGANIZATION));
  }
  if (!next.organizations.some((organization) => organization.id === MASTER_ORGANIZATION.id)) {
    next.organizations.push(normalizeOrganization(MASTER_ORGANIZATION));
  }

  for (const seed of SEEDED_ACCOUNTS) {
    const email = normalizeEmail(seed.email);
    const existing = next.users.find((user) => user.email === email);
    if (!existing) {
      next.users.push(createSeedUser(seed));
      continue;
    }

    if (next.presetAccountVersion < PRESET_ACCOUNT_VERSION) {
      const presetUser = createSeedUser(seed);
      Object.assign(existing, {
        fullName: presetUser.fullName,
        primaryRole: presetUser.primaryRole,
        enabledProfiles: presetUser.enabledProfiles,
        viewPermissions: presetUser.viewPermissions,
        globalAdmin: presetUser.globalAdmin,
        status: "active",
        accessNote: presetUser.accessNote,
        mustChangePassword: false,
        passwordHash: presetUser.passwordHash,
        updatedAt: nowIso(),
        updatedBy: "seed",
      });
    }
  }

  next.presetAccountVersion = PRESET_ACCOUNT_VERSION;
  next.users = next.users.map((user) => {
    const defaultViews = rolePermissions(user.primaryRole);
    if (!defaultViews.includes("chat")) return user;
    if (Array.isArray(user.viewPermissions) && user.viewPermissions.includes("chat")) return user;
    return {
      ...user,
      viewPermissions: normalizeList([...(user.viewPermissions || []), "chat"], defaultViews),
      updatedAt: nowIso(),
      updatedBy: user.updatedBy || "migration",
    };
  });
  next.activeSessions = next.activeSessions.filter((session) => {
    if (!session.userId || !session.tokenHash) return false;
    if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return false;
    return next.users.some((user) => user.id === session.userId && user.status === "active");
  });

  return next;
}

function getState() {
  if (cachedState) {
    return cachedState;
  }

  const diskState = readStateFromDisk();
  cachedState = migrateState(diskState || buildInitialState());
  if (!diskState) {
    writeStateToDisk(cachedState);
  }
  return cachedState;
}

function persist() {
  writeStateToDisk(getState());
}

function pruneExpiredSessions(state = getState()) {
  const before = state.activeSessions.length;
  state.activeSessions = state.activeSessions.filter((session) => {
    if (!session.userId || !session.tokenHash) return false;
    if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return false;
    const sessionUser = state.users.find((user) => user.id === session.userId);
    return Boolean(sessionUser && sessionUser.status === "active");
  });
  return before !== state.activeSessions.length;
}

function clearUserSessions(userId) {
  const state = getState();
  state.activeSessions = state.activeSessions.filter((session) => session.userId !== userId);
}

function createSessionForUser(user) {
  const token = createSessionToken();
  const session = normalizeSession({
    userId: user.id,
    organizationId: user.organizationId || DEFAULT_ORGANIZATION.id,
    tokenHash: hashToken(token),
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
  });
  const state = getState();
  state.activeSessions.unshift(session);
  pruneExpiredSessions(state);
  return {
    sessionToken: token,
    session,
  };
}

function touchSession(session) {
  session.lastSeenAt = nowIso();
  session.expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
}

function authError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function audit(action, details = {}) {
  const state = getState();
  state.auditLog.unshift({
    id: crypto.randomUUID(),
    action,
    details,
    createdAt: nowIso(),
  });
  state.auditLog = state.auditLog.slice(0, 500);
}

function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  return getState().users.find((user) => user.email === normalizedEmail) || null;
}

function findUserById(id) {
  return getState().users.find((user) => user.id === id) || null;
}

export function restoreAuthSession(sessionToken) {
  const tokenHash = hashToken(sessionToken);
  const state = getState();
  const changed = pruneExpiredSessions(state);
  const session = state.activeSessions.find((item) => item.tokenHash === tokenHash) || null;
  if (!session) {
    if (changed) persist();
    return null;
  }
  const actor = findUserById(session.userId);
  if (!actor || actor.status !== "active") {
    state.activeSessions = state.activeSessions.filter((item) => item.id !== session.id);
    persist();
    return null;
  }
  touchSession(session);
  persist();
  return {
    session: structuredClone(session),
    user: safeUser(actor),
  };
}

export function signOutAuthSession(sessionToken) {
  const tokenHash = hashToken(sessionToken);
  const state = getState();
  const before = state.activeSessions.length;
  state.activeSessions = state.activeSessions.filter((session) => session.tokenHash !== tokenHash);
  if (before !== state.activeSessions.length) {
    persist();
  }
}

function requireAccessAdmin(actorOrId) {
  const actor = typeof actorOrId === "string" ? findUserById(actorOrId) : actorOrId;
  if (!actor) {
    throw authError(401, "No se encontro una sesion administradora valida.");
  }
  if (actor.status !== "active") {
    throw authError(403, "La cuenta administradora no esta activa.");
  }
  if (!normalizeList(actor.viewPermissions).includes("access")) {
    throw authError(403, "Tu perfil no tiene permiso para administrar accesos.");
  }
  return actor;
}

function requireSupervisionAdmin(actorOrId) {
  const actor = requireAccessAdmin(actorOrId);
  if (String(actor.primaryRole || "").trim() !== SYSTEM_ROLES.supervision) {
    throw authError(403, "Solo Supervision M&E puede administrar organizaciones.");
  }
  if (!actor.globalAdmin) {
    throw authError(403, "Solo un administrador global de Nexora puede administrar organizaciones.");
  }
  return actor;
}

function clearDeletionMarkersForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const state = getState();
  state.deletedUserRegistry = state.deletedUserRegistry.filter(
    (entry) => normalizeEmail(entry.email) !== normalizedEmail,
  );
}

function createAuthEmailRecord({ user, type, link, expiresAt }) {
  const labels = {
    "password-reset": "Enlace para restablecer contraseña",
  };
  return {
    id: crypto.randomUUID(),
    type,
    toEmail: user.email,
    toName: user.fullName,
    subject: `${labels[type] || "Notificacion"} - Pulso M&E`,
    previewLink: link || null,
    body: `Hola ${user.fullName}, abre este enlace para cambiar tu contraseña: ${link}. Expira el ${expiresAt}. Si no pediste este cambio, puedes ignorar este correo.`,
    status: "queued",
    createdAt: nowIso(),
    expiresAt,
  };
}

export function listAuthUsers(actor = null) {
  const scopedUsers = actor?.organizationId
    ? getState().users.filter((user) => user.organizationId === actor.organizationId)
    : getState().users;
  return scopedUsers.map((user) => safeUser(user));
}

export function getOrganizationBranding(organizationId = "") {
  const organization = resolveOrganizationContext({ organizationId });
  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    branding: structuredClone(organization.settings),
  };
}

export function getCurrentOrganization(selector = {}) {
  const organization = resolveOrganizationContext(selector);
  return {
    organization: publicOrganizationRecord(organization),
    branding: structuredClone(organization.settings),
  };
}

export function listOrganizations() {
  return getState().organizations.map((organization) => publicOrganizationRecord(organization));
}

export function createOrganization(payload = {}, actorOrId) {
  const actor = requireSupervisionAdmin(actorOrId);
  const state = getState();
  const name = String(payload.name || "").trim();
  if (!name) {
    throw authError(400, "El nombre de la organizacion es obligatorio.");
  }
  const slug = String(payload.slug || slugify(name)).trim().toLowerCase();
  if (!slug) {
    throw authError(400, "El slug de la organizacion es obligatorio.");
  }
  if (state.organizations.some((organization) => organization.id === payload.id || organization.slug === slug)) {
    throw authError(409, "Ya existe una organizacion con ese identificador o slug.");
  }

  const organization = normalizeOrganization({
    id: String(payload.id || `org-${slug}`).trim(),
    name,
    slug,
    hostnames: payload.hostnames,
    settings: payload.settings || {
      organizationName: name,
      productName: payload.productName || DEFAULT_PRODUCT_NAME,
      loginTagline: payload.loginTagline,
      loginLead: payload.loginLead,
      sidebarCaption: payload.sidebarCaption,
      topbarEyebrow: payload.topbarEyebrow,
      brandLogoPath: payload.brandLogoPath,
      loginHeroPath: payload.loginHeroPath,
      primaryColor: payload.primaryColor,
      primaryDarkColor: payload.primaryDarkColor,
      accentColor: payload.accentColor,
    },
  });
  if (state.organizations.some((candidate) => candidate.id === organization.id || candidate.slug === organization.slug)) {
    throw authError(409, "Ya existe una organizacion con ese identificador o slug.");
  }
  if (organizationConflicts(organization, state.organizations)) {
    throw authError(409, "Otra organizacion ya usa ese slug o uno de esos hostnames.");
  }
  state.organizations.push(organization);
  audit("auth.organizationCreated", { actorId: actor.id, organizationId: organization.id, slug: organization.slug });
  persist();
  return getCurrentOrganization({ organizationId: organization.id });
}

export function updateOrganization(organizationId, payload = {}, actorOrId) {
  const actor = requireSupervisionAdmin(actorOrId);
  const state = getState();
  const current = state.organizations.find((organization) => organization.id === organizationId);
  if (!current) {
    throw authError(404, "No encontre la organizacion solicitada.");
  }

  const next = normalizeOrganization({
    ...current,
    ...payload,
    id: current.id,
    settings: {
      ...(current.settings || {}),
      ...(payload.settings || {}),
      organizationName: payload.name || payload.settings?.organizationName || current.name,
    },
  });

  if (organizationConflicts(next, state.organizations, current.id)) {
    throw authError(409, "Otra organizacion ya usa ese slug o uno de esos hostnames.");
  }

  Object.assign(current, next);
  state.users.forEach((user) => {
    if (user.organizationId === current.id) {
      user.organizationName = current.name;
      user.updatedAt = nowIso();
      user.updatedBy = actor.id;
    }
  });
  audit("auth.organizationUpdated", { actorId: actor.id, organizationId: current.id });
  persist();
  return getCurrentOrganization({ organizationId: current.id });
}

export function signInAuthUser({ email, password, organizationId, organizationSlug, host }) {
  const user = findUserByEmail(email);
  if (!user) {
    throw authError(404, "No encontre una cuenta con ese correo.");
  }
  const resolvedOrganization = resolveOrganizationContext({
    organizationId,
    slug: organizationSlug,
    host,
  });
  if (resolvedOrganization?.id && user.organizationId && resolvedOrganization.id !== user.organizationId) {
    throw authError(403, "Este usuario pertenece a otra organizacion.");
  }
  if (user.status !== "active") {
    throw authError(403, "Esta cuenta esta suspendida o eliminada.");
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw authError(401, "Contrasena incorrecta.");
  }

  if (user.mustChangePassword) {
    return {
      passwordChangeRequired: true,
      user: safeUser(user),
    };
  }

  user.lastLoginAt = nowIso();
  user.updatedAt = nowIso();
  if (!String(user.passwordHash || "").startsWith(`${PASSWORD_HASH_VERSION}$`)) {
    user.passwordHash = hashPassword(password);
    user.passwordChangedAt = user.passwordChangedAt || nowIso();
  }
  const { sessionToken } = createSessionForUser(user);
  audit("auth.signIn", { userId: user.id, email: user.email });
  persist();

  return {
    passwordChangeRequired: false,
    user: safeUser(user),
    sessionToken,
  };
}

export function completeRequiredPasswordChange({ email, currentPassword, password }) {
  const user = findUserByEmail(email);
  if (!user) {
    throw authError(404, "No encontre una cuenta con ese correo.");
  }
  if (user.status !== "active") {
    throw authError(403, "Esta cuenta esta suspendida o eliminada.");
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw authError(401, "Contrasena temporal incorrecta.");
  }
  if (String(password || "").length < 8) {
    throw authError(400, "La nueva contraseña debe tener al menos 8 caracteres.");
  }

  const timestamp = nowIso();
  user.passwordHash = hashPassword(password);
  user.mustChangePassword = false;
  user.passwordChangedAt = timestamp;
  user.lastLoginAt = timestamp;
  user.updatedAt = timestamp;
  clearUserSessions(user.id);
  const { sessionToken } = createSessionForUser(user);
  audit("auth.completePasswordChange", { userId: user.id, email: user.email });
  persist();

  return {
    ...safeUser(user),
    sessionToken,
  };
}

export function requestPasswordResetLink({ email, resetBaseUrl }) {
  const user = findUserByEmail(email);
  if (!user) {
    throw authError(404, "No encontre una cuenta con ese correo.");
  }
  if (user.status !== "active") {
    throw authError(403, "Esta cuenta esta suspendida o eliminada.");
  }

  const baseUrl = String(resetBaseUrl || "").trim();
  if (!baseUrl) {
    throw authError(400, "No pude construir el enlace de recuperacion.");
  }

  const token = createResetToken();
  const url = new URL(baseUrl);
  url.searchParams.set("resetToken", token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  user.resetTokenHash = hashToken(token);
  user.resetExpiresAt = expiresAt;
  user.resetRequestedAt = nowIso();
  user.updatedAt = nowIso();

  const emailRecord = createAuthEmailRecord({
    user,
    type: "password-reset",
    link: url.toString(),
    expiresAt,
  });
  getState().emailOutbox.unshift(emailRecord);
  audit("auth.passwordResetRequested", { userId: user.id, email: user.email, emailId: emailRecord.id });
  persist();

  return {
    email: user.email,
    expiresAt,
    delivery: "email-outbox",
    previewLink: emailRecord.previewLink,
    emailRecord,
  };
}

export function resetPasswordWithToken({ token, password }) {
  const rawToken = String(token || "").trim();
  const nextPassword = String(password || "").trim();
  if (!rawToken) {
    throw authError(400, "El enlace de recuperacion esta incompleto.");
  }
  if (nextPassword.length < 8) {
    throw authError(400, "La nueva contraseña debe tener al menos 8 caracteres.");
  }

  const incomingHash = hashToken(rawToken);
  const user = getState().users.find((candidate) => candidate.resetTokenHash === incomingHash);
  if (!user) {
    throw authError(400, "El enlace de recuperacion no es valido.");
  }
  if (user.status !== "active") {
    throw authError(403, "Esta cuenta esta suspendida o eliminada.");
  }
  if (user.resetExpiresAt && Date.parse(user.resetExpiresAt) < Date.now()) {
    throw authError(400, "El enlace de recuperacion ya expiro.");
  }

  const timestamp = nowIso();
  user.passwordHash = hashPassword(nextPassword);
  user.mustChangePassword = false;
  user.resetTokenHash = null;
  user.resetExpiresAt = null;
  user.resetRequestedAt = null;
  user.passwordChangedAt = timestamp;
  user.updatedAt = timestamp;
  clearUserSessions(user.id);
  audit("auth.passwordResetCompleted", { userId: user.id, email: user.email });
  persist();

  return safeUser(user);
}

export function createManagedAuthUser(payload, actorOrId) {
  const actor = requireAccessAdmin(actorOrId);
  const email = normalizeEmail(payload.email);
  const fullName = String(payload.fullName || "").trim();
  const temporaryPassword = String(payload.temporaryPassword || payload.password || "");
  const primaryRole = payload.primaryRole || SYSTEM_ROLES.facilitator;

  if (!fullName) {
    throw authError(400, "El nombre completo es obligatorio.");
  }
  if (!email || !email.includes("@")) {
    throw authError(400, "El correo electrónico no es válido.");
  }
  if (findUserByEmail(email)) {
    throw authError(409, "Ya existe un usuario con ese correo.");
  }
  if (temporaryPassword.length < 8) {
    throw authError(400, "La contraseña temporal debe tener al menos 8 caracteres.");
  }

  clearDeletionMarkersForEmail(email);

  const timestamp = nowIso();
  const user = normalizeUser({
    id: crypto.randomUUID(),
    fullName,
    email,
    primaryRole,
    enabledProfiles: normalizeList(payload.enabledProfiles, [primaryRole]),
    viewPermissions: normalizeList(payload.viewPermissions, rolePermissions(primaryRole)),
    organizationId: actor.organizationId || DEFAULT_ORGANIZATION.id,
    organizationName: actor.organizationName || DEFAULT_ORGANIZATION.name,
    status: payload.status === "suspended" ? "suspended" : "active",
    accessNote: payload.accessNote || "",
    mustChangePassword: true,
    passwordHash: hashPassword(temporaryPassword),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  getState().users.unshift(user);
  audit("auth.userCreated", { actorId: actor.id, userId: user.id, email: user.email });
  persist();

  return safeUser(user);
}

export function updateManagedAuthUser(id, updates, actorOrId) {
  const actor = requireAccessAdmin(actorOrId);
  const user = findUserById(id);
  if (!user) {
    throw authError(404, "No encontre ese usuario.");
  }
  if (user.organizationId !== actor.organizationId) {
    throw authError(403, "No puedes editar usuarios de otra organizacion.");
  }

  const nextEmail = updates.email ? normalizeEmail(updates.email) : user.email;
  const conflicting = getState().users.find((candidate) => candidate.id !== id && candidate.email === nextEmail);
  if (conflicting) {
    throw authError(409, "Ya existe otro usuario con ese correo.");
  }

  const primaryRole = updates.primaryRole || user.primaryRole || SYSTEM_ROLES.facilitator;
  const nextPassword = String(updates.password || updates.temporaryPassword || "").trim();
  if (nextPassword && nextPassword.length < 8) {
    throw authError(400, "La nueva contraseña debe tener al menos 8 caracteres.");
  }

  user.fullName = String(updates.fullName ?? user.fullName).trim() || user.fullName;
  user.email = nextEmail;
  user.primaryRole = primaryRole;
  user.enabledProfiles = normalizeList(updates.enabledProfiles, [primaryRole]);
  user.viewPermissions = normalizeList(updates.viewPermissions, rolePermissions(primaryRole));
  user.organizationId = actor.organizationId || user.organizationId || DEFAULT_ORGANIZATION.id;
  user.organizationName = actor.organizationName || user.organizationName || DEFAULT_ORGANIZATION.name;
  user.status = updates.status === "suspended" ? "suspended" : "active";
  user.accessNote = String(updates.accessNote ?? user.accessNote ?? "");
  if (nextPassword) {
    user.passwordHash = hashPassword(nextPassword);
    user.passwordChangedAt = nowIso();
    user.resetTokenHash = null;
    user.resetExpiresAt = null;
    user.resetRequestedAt = null;
  }
  if (user.status !== "active") {
    clearUserSessions(user.id);
  }
  if (typeof updates.mustChangePassword === "boolean") {
    user.mustChangePassword = updates.mustChangePassword;
  }
  if (updates.chatAlertSettings && typeof updates.chatAlertSettings === "object") {
    user.chatAlertSettings = normalizeChatAlertSettings({
      ...user.chatAlertSettings,
      ...updates.chatAlertSettings,
    });
  }
  user.updatedAt = nowIso();
  user.updatedBy = actor.id;

  audit("auth.userUpdated", { actorId: actor.id, userId: user.id, email: user.email });
  persist();

  return safeUser(user);
}

export function updateOwnAuthUserPreferences(userId, updates = {}) {
  const user = findUserById(userId);
  if (!user) {
    throw authError(404, "No encontre ese usuario.");
  }
  user.chatAlertSettings = normalizeChatAlertSettings({
    ...user.chatAlertSettings,
    ...(updates.chatAlertSettings || {}),
  });
  user.updatedAt = nowIso();
  user.updatedBy = user.id;
  audit("auth.userPreferencesUpdated", { userId: user.id, email: user.email });
  persist();
  return safeUser(user);
}

export function deleteManagedAuthUser(id, actorOrId) {
  const actor = requireAccessAdmin(actorOrId);
  if (actor.id === id) {
    throw authError(400, "No puedes eliminar tu propia cuenta mientras estas dentro.");
  }
  const state = getState();
  const index = state.users.findIndex((user) => user.id === id);
  if (index < 0) {
    throw authError(404, "No encontre ese usuario.");
  }
  if (state.users[index].organizationId !== actor.organizationId) {
    throw authError(403, "No puedes eliminar usuarios de otra organizacion.");
  }

  const [deleted] = state.users.splice(index, 1);
  clearUserSessions(deleted.id);
  const timestamp = nowIso();
  state.deletedUserRegistry.unshift({
    id: crypto.randomUUID(),
    userId: deleted.id,
    email: deleted.email,
    fullName: deleted.fullName,
    primaryRole: deleted.primaryRole,
    deletedAt: timestamp,
    deletedBy: actor.id,
  });
  audit("auth.userDeleted", { actorId: actor.id, userId: deleted.id, email: deleted.email });
  persist();

  return {
    deletedUser: safeUser(deleted),
    users: listAuthUsers(),
  };
}

export function resetAuthStoreForTests() {
  cachedState = null;
}
