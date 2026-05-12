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
} from "../services/auth-service.js?v=20260512f";

const sections = ["signin", "signup", "forgot", "force-password"];
let wired = false;
let onAuthenticatedCallback = () => {};
let onSignedOutCallback = () => {};
let lastSessionUserId = null;
let sessionReadyPromise = null;
let pendingPasswordChange = null;

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

function showSection(sectionId) {
  sections.forEach((section) => {
    const panel = document.querySelector(`[data-auth-section="${section}"]`);
    const tab = document.querySelector(`[data-open-auth="${section}"]`);
    if (panel) panel.hidden = section !== sectionId;
    if (tab) tab.classList.toggle("active", section === sectionId);
  });
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

async function updateLobbyVisibility() {
  const appShell = $(".app-shell");
  const authShell = $("#authShell");
  const currentUser = await getCurrentUser();
  const isLoggedIn = Boolean(currentUser);

  if (isLoggedIn) {
    paintSessionUser(currentUser);
    if (currentUser.id !== lastSessionUserId) {
      lastSessionUserId = currentUser.id;
      sessionReadyPromise = Promise.resolve(onAuthenticatedCallback(currentUser)).finally(() => {
        sessionReadyPromise = null;
      });
    }
    if (sessionReadyPromise) {
      await sessionReadyPromise;
    }
    if (appShell) appShell.hidden = false;
    if (authShell) authShell.hidden = true;
  } else {
    if (appShell) appShell.hidden = true;
    if (authShell) authShell.hidden = false;
  }

  if (!isLoggedIn && lastSessionUserId !== null) {
    lastSessionUserId = null;
    sessionReadyPromise = null;
    clearSessionUser();
    await onSignedOutCallback();
  }
}

function bindLobbyEvents() {
  if (wired) return;
  wired = true;

  document.querySelectorAll("[data-open-auth]").forEach((button) => {
    button.addEventListener("click", () => {
      showSection(button.dataset.openAuth);
    });
  });
  $("#signinForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void (async () => {
      try {
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
          showToastMessage("Debes cambiar tu contrasena provisional para entrar.");
          return;
        }
        await updateLobbyVisibility();
        showToastMessage("Sesion iniciada.");
      } catch (error) {
        showToastMessage(error.message || "No pude iniciar sesion.");
      }
    })();
  });

  $("#forcePasswordForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pendingPasswordChange?.email) {
      showSection("signin");
      showToastMessage("Vuelve a ingresar con tu clave provisional.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showToastMessage("Las contrasenas no coinciden.");
      return;
    }

    void (async () => {
      try {
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
        showToastMessage(error.message || "No pude cambiar la contrasena.");
      }
    })();
  });

  $("#signupForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showToastMessage("Las contrasenas no coinciden.");
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
        $("#resetEmail").value = result.email;
        if (result.code) $("#resetCode").value = result.code;
        $("#forgotResetBox").hidden = false;
        showToastMessage("Codigo de recuperacion enviado.");
      } catch (error) {
        showToastMessage(error.message || "No pude enviar el codigo.");
      }
    })();
  });

  $("#forgotResetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showToastMessage("Las contrasenas no coinciden.");
      return;
    }

    void (async () => {
      try {
        await resetPassword({
          email: formData.get("email"),
          code: formData.get("code"),
          password,
        });
        showSection("signin");
        showToastMessage("Contrasena actualizada.");
      } catch (error) {
        showToastMessage(error.message || "No pude cambiar la contrasena.");
      }
    })();
  });

  $("#signOutButton")?.addEventListener("click", () => {
    void (async () => {
      await signOutUser();
      pendingPasswordChange = null;
      await updateLobbyVisibility();
      showSection("signin");
      showToastMessage("Sesion cerrada.");
    })();
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

  await ensureAuthState();
  await consumeVerificationLink();
  fillRequestedRoleOptions();
  bindLobbyEvents();
  showSection("signin");
  $("#forgotResetBox").hidden = true;
  await updateLobbyVisibility();

  onAuthStateChange(async () => {
    await updateLobbyVisibility();
  });
}
