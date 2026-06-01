import {
  SYSTEM_ROLES,
  completeRequiredPasswordChange,
  ensureAuthState,
  getCurrentUser,
  onAuthStateChange,
  requestPasswordReset,
  resetPassword,
  signInUser,
  signOutUser,
  signUpUser,
  verifyRegisteredUserByLink,
} from "../services/auth-service.js?v=20260601a";

const sections = ["signin", "signup", "forgot", "force-password", "reset-password"];
const INACTIVITY_TIMEOUT_MS = 60 * 1000;
const INACTIVITY_CHECK_INTERVAL_MS = 5000;
const REMOTE_ACCESS_REFRESH_INTERVAL_MS = 20000;
const AUTH_ACTIVITY_KEY = "pulso-me-last-activity-v1";
const ACTIVITY_WRITE_THROTTLE_MS = 5000;
let wired = false;
let onAuthenticatedCallback = () => {};
let onSignedOutCallback = () => {};
let lastSessionUserId = null;
let sessionReadyPromise = null;
let currentSessionRefreshPromise = null;
let pendingPasswordChange = null;
let pendingPasswordResetToken = null;
let inactivityTimerId = null;
let inactivityIntervalId = null;
let remoteAccessRefreshIntervalId = null;
let inactivityMonitoring = false;
let lastActivityAt = 0;
let lastActivityWriteAt = 0;
let inactivitySignOutInFlight = false;
let lastStartupError = "";

function clearInactivityTimer() {
  if (inactivityTimerId !== null) {
    window.clearTimeout(inactivityTimerId);
    inactivityTimerId = null;
  }
}

function clearInactivityInterval() {
  if (inactivityIntervalId !== null) {
    window.clearInterval(inactivityIntervalId);
    inactivityIntervalId = null;
  }
}

function clearRemoteAccessRefreshInterval() {
  if (remoteAccessRefreshIntervalId !== null) {
    window.clearInterval(remoteAccessRefreshIntervalId);
    remoteAccessRefreshIntervalId = null;
  }
}

function readStoredActivityAt() {
  try {
    const raw = window.localStorage.getItem(AUTH_ACTIVITY_KEY);
    const value = Number(raw || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeStoredActivityAt(timestamp, force = false) {
  const nextTimestamp = Number(timestamp || Date.now());
  if (!force && nextTimestamp - lastActivityWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;
  lastActivityWriteAt = nextTimestamp;
  try {
    window.localStorage.setItem(AUTH_ACTIVITY_KEY, String(nextTimestamp));
  } catch {
    // ignore storage write issues
  }
}

function scheduleInactivityTimer() {
  clearInactivityTimer();
  if (!inactivityMonitoring) return;
  const elapsed = Math.max(0, Date.now() - (lastActivityAt || Date.now()));
  const delay = Math.max(250, INACTIVITY_TIMEOUT_MS - elapsed);
  inactivityTimerId = window.setTimeout(() => {
    if (!inactivityMonitoring || inactivitySignOutInFlight) return;
    const effectiveLastActivity = Math.max(lastActivityAt, readStoredActivityAt());
    if (Date.now() - effectiveLastActivity < INACTIVITY_TIMEOUT_MS) {
      lastActivityAt = effectiveLastActivity;
      scheduleInactivityTimer();
      return;
    }
    void performSignOut("SesiÃ³n cerrada por inactividad.");
  }, delay);
}

function isSessionInactive() {
  const effectiveLastActivity = Math.max(lastActivityAt, readStoredActivityAt());
  return Date.now() - effectiveLastActivity >= INACTIVITY_TIMEOUT_MS;
}

function ensureInactivityInterval() {
  clearInactivityInterval();
  if (!inactivityMonitoring) return;
  inactivityIntervalId = window.setInterval(() => {
    if (!inactivityMonitoring || inactivitySignOutInFlight) return;
    if (!isSessionInactive()) return;
    void performSignOut("SesiÃ³n cerrada por inactividad.");
  }, INACTIVITY_CHECK_INTERVAL_MS);
}

function registerActivity(forcePersist = false) {
  if (!inactivityMonitoring) return;
  lastActivityAt = Date.now();
  writeStoredActivityAt(lastActivityAt, forcePersist);
  scheduleInactivityTimer();
}

function activateInactivityMonitor() {
  inactivityMonitoring = true;
  lastActivityAt = Math.max(Date.now(), readStoredActivityAt());
  writeStoredActivityAt(lastActivityAt, true);
  scheduleInactivityTimer();
  ensureInactivityInterval();
}

function deactivateInactivityMonitor() {
  inactivityMonitoring = false;
  clearInactivityTimer();
  clearInactivityInterval();
}

function ensureRemoteAccessRefreshMonitor() {
  if (remoteAccessRefreshIntervalId !== null) return;
  remoteAccessRefreshIntervalId = window.setInterval(() => {
    if (document.hidden || inactivitySignOutInFlight || sessionReadyPromise || currentSessionRefreshPromise) return;
    void updateLobbyVisibility({ refreshCurrentSession: true, showRefreshErrorToast: false });
  }, REMOTE_ACCESS_REFRESH_INTERVAL_MS);
}

async function performSignOut(message = "SesiÃ³n cerrada.") {
  if (inactivitySignOutInFlight) return;
  inactivitySignOutInFlight = true;
  try {
    deactivateInactivityMonitor();
    clearRemoteAccessRefreshInterval();
    await signOutUser();
    pendingPasswordChange = null;
    pendingPasswordResetToken = null;
    await updateLobbyVisibility();
    showSection("signin");
    showToastMessage(message);
  } finally {
    inactivitySignOutInFlight = false;
  }
}

function $(selector) {
  return document.querySelector(selector);
}

function showToastMessage(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function ensureAppBootOverlay() {
  const appShell = $(".app-shell");
  if (!appShell) return {};

  let overlay = $("#appBootOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "appBootOverlay";
    overlay.className = "app-boot-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="app-boot-card">
        <p class="eyebrow" id="appBootEyebrow">Preparando sesion</p>
        <h2 id="appBootTitle">Cargando sistema</h2>
        <p id="appBootMessage">Estamos preparando tu espacio de trabajo.</p>
        <div class="app-boot-actions">
          <button class="ghost-action" id="appBootRetryButton" type="button" hidden>Reintentar</button>
        </div>
      </div>
    `;
    appShell.append(overlay);
    overlay.querySelector("#appBootRetryButton")?.addEventListener("click", () => {
      lastStartupError = "";
      void updateLobbyVisibility();
    });
  }

  return {
    overlay,
    eyebrow: overlay.querySelector("#appBootEyebrow"),
    title: overlay.querySelector("#appBootTitle"),
    message: overlay.querySelector("#appBootMessage"),
    retryButton: overlay.querySelector("#appBootRetryButton"),
  };
}

function setAppBootState(mode = "ready", message = "") {
  const appShell = $(".app-shell");
  const { overlay, eyebrow, title, message: messageNode, retryButton } = ensureAppBootOverlay();
  if (!appShell || !overlay || !title || !messageNode || !retryButton) return;

  if (mode === "ready") {
    overlay.hidden = true;
    overlay.classList.remove("is-error");
    appShell.classList.remove("is-booting");
    return;
  }

  appShell.classList.add("is-booting");
  overlay.hidden = false;
  overlay.classList.toggle("is-error", mode === "error");
  if (mode === "loading") {
    if (eyebrow) eyebrow.textContent = "Preparando sesion";
    title.textContent = "Abriendo el sistema";
    messageNode.textContent = message || "Estamos cargando tus permisos, vistas y datos institucionales.";
    retryButton.hidden = true;
    return;
  }

  if (eyebrow) eyebrow.textContent = "No pudimos completar el arranque";
  title.textContent = "El sistema necesita reintentar";
  messageNode.textContent = message || "No se pudo completar la carga inicial.";
  retryButton.hidden = false;
}

function showSection(sectionId) {
  sections.forEach((section) => {
    const panel = document.querySelector(`[data-auth-section="${section}"]`);
    const tab = document.querySelector(`[data-open-auth="${section}"]`);
    if (panel) panel.hidden = section !== sectionId;
    if (tab) tab.classList.toggle("active", section === sectionId);
  });
}

function setSignInError(message = "") {
  const errorBox = $("#signinError");
  const passwordInput = $("#signinPassword");
  const emailInput = $("#signinEmail");
  const hasError = Boolean(message);
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = !hasError;
  }
  passwordInput?.classList.toggle("auth-input-error", hasError);
  passwordInput?.setAttribute("aria-invalid", hasError ? "true" : "false");
  emailInput?.setAttribute("aria-invalid", "false");
}

function normalizeSessionRole(user) {
  return user?.systemRole || user?.allowedRoles?.[0] || "Facilitador";
}

function paintSessionUser(currentUser) {
  const role = normalizeSessionRole(currentUser);
  const userName = $("#currentUserName");
  const userEmail = $("#currentUserEmail");
  const roleBadge = $("#roleBadge");
  const roleSelect = $("#roleSelect");

  if (userName) userName.textContent = currentUser?.fullName || "Sin sesion";
  if (userEmail) userEmail.textContent = currentUser?.email || "-";
  if (roleBadge) {
    roleBadge.textContent = role;
    roleBadge.className = `status-pill ${role === "Supervision M&E" ? "info" : "neutral"}`;
  }
  if (roleSelect) {
    roleSelect.innerHTML = `<option>${role}</option>`;
    roleSelect.value = role;
    roleSelect.disabled = true;
  }
}

function clearSessionUser() {
  paintSessionUser(null);
}

async function consumeVerificationLink() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("verifyToken");
  if (!token) return;

  try {
    await verifyRegisteredUserByLink(token);
    url.searchParams.delete("verifyToken");
    window.history.replaceState({}, "", url.toString());
    showSection("signin");
    showToastMessage("Correo verificado. Ya estas de vuelta en la portada del sistema.");
  } catch (error) {
    url.searchParams.delete("verifyToken");
    window.history.replaceState({}, "", url.toString());
    showSection("signin");
    showToastMessage(error.message || "No pude validar el enlace.");
  }
}

function consumePasswordResetLink() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("resetToken");
  if (!token) return null;

  pendingPasswordResetToken = token;
  url.searchParams.delete("resetToken");
  window.history.replaceState({}, "", url.toString());
  return "reset-password";
}

async function refreshAuthenticatedSession(currentUser, { showRefreshErrorToast = false } = {}) {
  if (!currentUser?.id) return;
  if (currentSessionRefreshPromise) {
    await currentSessionRefreshPromise;
    return;
  }

  currentSessionRefreshPromise = Promise.resolve(onAuthenticatedCallback(currentUser))
    .catch((error) => {
      console.error("No pude refrescar los permisos de la sesion activa.", error);
      if (showRefreshErrorToast) {
        showToastMessage(error?.message || "No pude refrescar tus accesos todavia.");
      }
    })
    .finally(() => {
      currentSessionRefreshPromise = null;
    });

  await currentSessionRefreshPromise;
}

async function updateLobbyVisibility(options = {}) {
  const { refreshCurrentSession = false, showRefreshErrorToast = false } = options;
  const appShell = $(".app-shell");
  const authShell = $("#authShell");
  const currentUser = await getCurrentUser();
  const isLoggedIn = Boolean(currentUser);

  if (isLoggedIn) {
    paintSessionUser(currentUser);
    const needsFullBoot = !sessionReadyPromise && currentUser.id !== lastSessionUserId;
    const canRefreshCurrentSession =
      refreshCurrentSession &&
      !sessionReadyPromise &&
      !currentSessionRefreshPromise &&
      currentUser.id === lastSessionUserId;

    if (needsFullBoot) {
      lastStartupError = "";
      setAppBootState("loading");
      const bootUserId = currentUser.id;
      sessionReadyPromise = Promise.resolve(onAuthenticatedCallback(currentUser))
        .then(() => {
          lastSessionUserId = bootUserId;
        })
        .catch((error) => {
          lastSessionUserId = null;
          lastStartupError = error?.message || "No pude cargar el sistema completo.";
          console.error(error);
          throw error;
        })
        .finally(() => {
          sessionReadyPromise = null;
        });
    }
    if (authShell) authShell.hidden = true;
    if (appShell) appShell.hidden = false;
    const pendingSessionReady = sessionReadyPromise;
    if (pendingSessionReady) {
      setAppBootState("loading");
      try {
        await pendingSessionReady;
      } catch (error) {
        setAppBootState("error", lastStartupError || error?.message || "No pude cargar el sistema completo.");
        showToastMessage("No pude iniciar el sistema completo. Reintenta la carga.");
        return;
      }
    }
    if (canRefreshCurrentSession) {
      await refreshAuthenticatedSession(currentUser, { showRefreshErrorToast });
    }
    setAppBootState("ready");
    activateInactivityMonitor();
    ensureRemoteAccessRefreshMonitor();
  } else {
    deactivateInactivityMonitor();
    clearRemoteAccessRefreshInterval();
    setAppBootState("ready");
    if (appShell) appShell.hidden = true;
    if (authShell) authShell.hidden = false;
  }

  if (!isLoggedIn && lastSessionUserId !== null) {
    lastSessionUserId = null;
    sessionReadyPromise = null;
    currentSessionRefreshPromise = null;
    clearSessionUser();
    await onSignedOutCallback();
  }
}

function bindLobbyEvents() {
  if (wired) return;
  wired = true;

  document.querySelectorAll("[data-open-auth]").forEach((button) => {
    button.addEventListener("click", () => {
      setSignInError("");
      showSection(button.dataset.openAuth);
    });
  });
  ["#signinEmail", "#signinPassword"].forEach((selector) => {
    $(selector)?.addEventListener("input", () => setSignInError(""));
  });
  ["pointerdown", "keydown", "click", "input", "touchstart", "wheel"].forEach((eventName) => {
    window.addEventListener(
      eventName,
      (event) => {
        if ("isTrusted" in event && event.isTrusted === false) return;
        registerActivity(false);
      },
      { passive: true },
    );
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      registerActivity(true);
      void updateLobbyVisibility({ refreshCurrentSession: true, showRefreshErrorToast: false });
    }
  });
  window.addEventListener("focus", () => {
    registerActivity(true);
    void updateLobbyVisibility({ refreshCurrentSession: true, showRefreshErrorToast: false });
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_ACTIVITY_KEY) return;
    const timestamp = Number(event.newValue || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    lastActivityAt = Math.max(lastActivityAt, timestamp);
    if (inactivityMonitoring) {
      scheduleInactivityTimer();
    }
  });
  $("#signinForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    setSignInError("");
    const formData = new FormData(event.currentTarget);
    void (async () => {
      try {
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = "Entrando...";
        }
        const email = formData.get("email");
        const password = String(formData.get("password") || "");
        const result = await signInUser({
          email,
          password,
        });
        if (result?.passwordChangeRequired) {
          pendingPasswordChange = {
            email: result.user.email,
            currentPassword: password,
          };
          const emailInput = $("#forcePasswordEmail");
          if (emailInput) emailInput.value = result.user.email;
          showSection("force-password");
          showToastMessage("Debes cambiar tu contraseÃ±a provisional para entrar.");
          return;
        }
        await updateLobbyVisibility();
        showToastMessage("Sesion iniciada.");
      } catch (error) {
        const message = error.message || "No pude iniciar sesion.";
        const isPasswordError = /contraseÃ±a|contrasena|password/i.test(message);
        setSignInError(isPasswordError ? "Contrasena incorrecta." : message);
        showToastMessage(isPasswordError ? "Contrasena incorrecta." : message);
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Entrar";
        }
      }
    })();
  });

  $("#forcePasswordForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    if (!pendingPasswordChange?.email) {
      showSection("signin");
      showToastMessage("Vuelve a ingresar con tu clave provisional.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showToastMessage("Las contraseÃ±as no coinciden.");
      return;
    }

    void (async () => {
      try {
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = "Guardando...";
        }
        await completeRequiredPasswordChange({
          email: pendingPasswordChange.email,
          currentPassword: pendingPasswordChange.currentPassword,
          password,
        });
        pendingPasswordChange = null;
        event.currentTarget.reset();
        await updateLobbyVisibility();
        showToastMessage("Contrasena actualizada. Ya estas dentro.");
      } catch (error) {
        showToastMessage(error.message || "No pude cambiar la contraseÃ±a.");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Guardar y entrar";
        }
      }
    })();
  });

  $("#signupForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showToastMessage("Las contraseÃ±as no coinciden.");
      return;
    }

    void (async () => {
      try {
        const result = await signUpUser({
          fullName: formData.get("fullName"),
          email: formData.get("email"),
          password,
          requestedRole: formData.get("requestedRole"),
        });
        showSection("signin");
        showToastMessage("Registro creado. Te envie un enlace de verificacion.");
      } catch (error) {
        showToastMessage(error.message || "No pude registrar el usuario.");
      }
    })();
  });

  $("#forgotRequestForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void (async () => {
      try {
        const result = await requestPasswordReset({
          email: formData.get("email"),
        });
        const message = $("#resetRequestMessage");
        if (message) {
          message.textContent = `Te enviamos un enlace de recuperaciÃ³n a ${result.email}. Abre ese enlace para crear tu nueva contraseÃ±a.`;
          if (result.delivery !== "email" && result.previewLink) {
            message.textContent = "El enlace fue generado. El correo real necesita estar configurado en Railway; mientras tanto puedes abrirlo aqui: ";
            const link = document.createElement("a");
            link.href = result.previewLink;
            link.textContent = "abrir enlace de recuperacion";
            message.append(link);
          }
          message.hidden = false;
        }
        $("#forgotResetBox").hidden = true;
        showToastMessage("Enlace de recuperacion enviado.");
      } catch (error) {
        showToastMessage(error.message || "No pude enviar el enlace.");
      }
    })();
  });

  $("#forgotResetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showToastMessage("Las contraseÃ±as no coinciden.");
      return;
    }

    void (async () => {
      try {
        await resetPassword({
          email: formData.get("email"),
          token: formData.get("code"),
          password,
        });
        showSection("signin");
        showToastMessage("Contrasena actualizada.");
      } catch (error) {
        showToastMessage(error.message || "No pude cambiar la contraseÃ±a.");
      }
    })();
  });

  $("#linkResetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (!pendingPasswordResetToken) {
      showSection("forgot");
      showToastMessage("El enlace de recuperacion esta incompleto. Pide uno nuevo.");
      return;
    }
    if (password !== confirmPassword) {
      showToastMessage("Las contraseÃ±as no coinciden.");
      return;
    }

    void (async () => {
      try {
        await resetPassword({
          token: pendingPasswordResetToken,
          password,
        });
        pendingPasswordResetToken = null;
        event.currentTarget.reset();
        showSection("signin");
        showToastMessage("ContraseÃ±a actualizada. Ya puedes entrar con tu nueva contraseÃ±a.");
      } catch (error) {
        showToastMessage(error.message || "No pude cambiar la contraseÃ±a.");
      }
    })();
  });

  $("#signOutButton")?.addEventListener("click", () => {
    void performSignOut("SesiÃ³n cerrada.");
  });

}

function fillRequestedRoleOptions() {
  const select = $("#signupRequestedRole");
  if (!select) return;
  select.innerHTML = SYSTEM_ROLES.map((role) => `<option value="${role}">${role}</option>`).join("");
}

export async function initializeAccessLobby({ onAuthenticated, onSignedOut } = {}) {
  onAuthenticatedCallback = typeof onAuthenticated === "function" ? onAuthenticated : () => {};
  onSignedOutCallback = typeof onSignedOut === "function" ? onSignedOut : () => {};
  const authShell = $("#authShell");
  const appShell = $(".app-shell");
  if (authShell) authShell.hidden = true;
  if (appShell) appShell.hidden = true;

  await ensureAuthState();
  await consumeVerificationLink();
  const initialSection = consumePasswordResetLink();
  fillRequestedRoleOptions();
  bindLobbyEvents();
  showSection(initialSection || "signin");
  $("#forgotResetBox").hidden = true;
  const resetRequestMessage = $("#resetRequestMessage");
  if (resetRequestMessage) resetRequestMessage.hidden = true;
  await updateLobbyVisibility();

  onAuthStateChange(async () => {
    await updateLobbyVisibility({ refreshCurrentSession: true, showRefreshErrorToast: false });
  });
}

