import {
  SYSTEM_ROLES,
  ensureAuthState,
  getCurrentUser,
  onAuthStateChange,
  requestPasswordReset,
  resetPassword,
  signInUser,
  signOutUser,
  signUpUser,
  verifyRegisteredUserByLink,
} from "../services/auth-service.js?v=20260508b";

const sections = ["signin", "signup", "forgot"];
let wired = false;
let onAuthenticatedCallback = () => {};
let onSignedOutCallback = () => {};

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

  if (appShell) appShell.hidden = !isLoggedIn;
  if (authShell) authShell.hidden = isLoggedIn;

  if (isLoggedIn) {
    onAuthenticatedCallback(currentUser);
  } else {
    onSignedOutCallback();
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
        await signInUser({
          email: formData.get("email"),
          password: formData.get("password"),
        });
        await updateLobbyVisibility();
        showToastMessage("Sesion iniciada.");
      } catch (error) {
        showToastMessage(error.message || "No pude iniciar sesion.");
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
        $("#forgotResetBox").hidden = false;
        showToastMessage("Codigo de recuperacion emitido.");
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
