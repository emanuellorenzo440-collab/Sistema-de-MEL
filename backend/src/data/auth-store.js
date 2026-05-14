import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_AUTH_DATA_VERSION = 1;
const PRESET_ACCOUNT_VERSION = 4;

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

const VIEW_KEYS = [
  "dashboard",
  "report",
  "indicators",
  "design",
  "forms",
  "charts",
  "attendance",
  "concepts",
  "supervision",
  "programs",
  "access",
];

const DEFAULT_ROLE_PERMISSIONS = {
  [SYSTEM_ROLES.facilitator]: ["dashboard", "report", "forms", "attendance", "charts"],
  [SYSTEM_ROLES.programCoordinator]: [
    "dashboard",
    "report",
    "indicators",
    "forms",
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
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function hashToken(token) {
  return hashPassword(token);
}

function createResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeList(values, fallback = []) {
  const list = Array.isArray(values) ? values : fallback;
  return [...new Set(list.filter(Boolean))];
}

function rolePermissions(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS[SYSTEM_ROLES.facilitator];
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
    users: SEEDED_ACCOUNTS.map(createSeedUser),
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

function safeUser(user) {
  if (!user) {
    return null;
  }

  const { passwordHash, resetTokenHash, ...publicUser } = user;
  return {
    ...publicUser,
    email: normalizeEmail(publicUser.email),
    enabledProfiles: normalizeList(publicUser.enabledProfiles, [publicUser.primaryRole]),
    viewPermissions: normalizeList(publicUser.viewPermissions, rolePermissions(publicUser.primaryRole)),
    mustChangePassword: Boolean(publicUser.mustChangePassword),
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
    authDataVersion: CURRENT_AUTH_DATA_VERSION,
    presetAccountVersion: Number(state?.presetAccountVersion || 0),
  };

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

function requireAccessAdmin(actorId) {
  const actor = findUserById(actorId);
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

function clearDeletionMarkersForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const state = getState();
  state.deletedUserRegistry = state.deletedUserRegistry.filter(
    (entry) => normalizeEmail(entry.email) !== normalizedEmail,
  );
}

function createAuthEmailRecord({ user, type, link, expiresAt }) {
  const labels = {
    "password-reset": "Enlace para restablecer contrasena",
  };
  return {
    id: crypto.randomUUID(),
    type,
    toEmail: user.email,
    toName: user.fullName,
    subject: `${labels[type] || "Notificacion"} - Pulso M&E`,
    previewLink: link || null,
    body: `Hola ${user.fullName}, abre este enlace para cambiar tu contrasena: ${link}. Expira el ${expiresAt}. Si no pediste este cambio, puedes ignorar este correo.`,
    status: "queued",
    createdAt: nowIso(),
    expiresAt,
  };
}

export function listAuthUsers() {
  return getState().users.map(safeUser);
}

export function signInAuthUser({ email, password }) {
  const user = findUserByEmail(email);
  if (!user) {
    throw authError(404, "No encontre una cuenta con ese correo.");
  }
  if (user.status !== "active") {
    throw authError(403, "Esta cuenta esta suspendida o eliminada.");
  }
  if (user.passwordHash !== hashPassword(password)) {
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
  audit("auth.signIn", { userId: user.id, email: user.email });
  persist();

  return {
    passwordChangeRequired: false,
    user: safeUser(user),
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
  if (user.passwordHash !== hashPassword(currentPassword)) {
    throw authError(401, "Contrasena temporal incorrecta.");
  }
  if (String(password || "").length < 8) {
    throw authError(400, "La nueva contrasena debe tener al menos 8 caracteres.");
  }

  const timestamp = nowIso();
  user.passwordHash = hashPassword(password);
  user.mustChangePassword = false;
  user.passwordChangedAt = timestamp;
  user.lastLoginAt = timestamp;
  user.updatedAt = timestamp;
  audit("auth.completePasswordChange", { userId: user.id, email: user.email });
  persist();

  return safeUser(user);
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
    throw authError(400, "La nueva contrasena debe tener al menos 8 caracteres.");
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
  audit("auth.passwordResetCompleted", { userId: user.id, email: user.email });
  persist();

  return safeUser(user);
}

export function createManagedAuthUser(payload, actorId) {
  const actor = requireAccessAdmin(actorId);
  const email = normalizeEmail(payload.email);
  const fullName = String(payload.fullName || "").trim();
  const temporaryPassword = String(payload.temporaryPassword || payload.password || "");
  const primaryRole = payload.primaryRole || SYSTEM_ROLES.facilitator;

  if (!fullName) {
    throw authError(400, "El nombre completo es obligatorio.");
  }
  if (!email || !email.includes("@")) {
    throw authError(400, "El correo electronico no es valido.");
  }
  if (findUserByEmail(email)) {
    throw authError(409, "Ya existe un usuario con ese correo.");
  }
  if (temporaryPassword.length < 8) {
    throw authError(400, "La contrasena temporal debe tener al menos 8 caracteres.");
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

export function updateManagedAuthUser(id, updates, actorId) {
  const actor = requireAccessAdmin(actorId);
  const user = findUserById(id);
  if (!user) {
    throw authError(404, "No encontre ese usuario.");
  }

  const nextEmail = updates.email ? normalizeEmail(updates.email) : user.email;
  const conflicting = getState().users.find((candidate) => candidate.id !== id && candidate.email === nextEmail);
  if (conflicting) {
    throw authError(409, "Ya existe otro usuario con ese correo.");
  }

  const primaryRole = updates.primaryRole || user.primaryRole || SYSTEM_ROLES.facilitator;
  user.fullName = String(updates.fullName ?? user.fullName).trim() || user.fullName;
  user.email = nextEmail;
  user.primaryRole = primaryRole;
  user.enabledProfiles = normalizeList(updates.enabledProfiles, [primaryRole]);
  user.viewPermissions = normalizeList(updates.viewPermissions, rolePermissions(primaryRole));
  user.status = updates.status === "suspended" ? "suspended" : "active";
  user.accessNote = String(updates.accessNote ?? user.accessNote ?? "");
  if (typeof updates.mustChangePassword === "boolean") {
    user.mustChangePassword = updates.mustChangePassword;
  }
  user.updatedAt = nowIso();
  user.updatedBy = actor.id;

  audit("auth.userUpdated", { actorId: actor.id, userId: user.id, email: user.email });
  persist();

  return safeUser(user);
}

export function deleteManagedAuthUser(id, actorId) {
  const actor = requireAccessAdmin(actorId);
  if (actor.id === id) {
    throw authError(400, "No puedes eliminar tu propia cuenta mientras estas dentro.");
  }
  const state = getState();
  const index = state.users.findIndex((user) => user.id === id);
  if (index < 0) {
    throw authError(404, "No encontre ese usuario.");
  }

  const [deleted] = state.users.splice(index, 1);
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
