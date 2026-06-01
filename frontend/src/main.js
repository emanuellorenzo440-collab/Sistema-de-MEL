import { initializeAccessLobby } from "./features/access-lobby.js?v=20260601b";
import { applyOrganizationBranding, brandingFromUser, loadPublicOrganizationBranding } from "./services/organization-branding.js?v=20260601b";

let monitoringApp = null;
let monitoringAppPromise = null;
let runtimeBridgeStarted = false;
const publicBranding = await loadPublicOrganizationBranding();

if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

async function loadMonitoringApp(authenticatedUser = null) {
  if (monitoringApp) return monitoringApp;
  if (monitoringAppPromise) return monitoringAppPromise;

  monitoringAppPromise = (async () => {
    const [{ createMonitoringApp }, { bootstrapApiBridge, startRuntimeBridge }] = await Promise.all([
      import("./features/monitoring-app.js?v=20260601h"),
      import("./services/mel-runtime-bridge.js?v=20260601b"),
    ]);

    const app = createMonitoringApp();
    await app.start(authenticatedUser);

    if (!runtimeBridgeStarted) {
      startRuntimeBridge();
      runtimeBridgeStarted = true;
    }

    void bootstrapApiBridge();

    monitoringApp = app;
    return app;
  })().catch((error) => {
    monitoringAppPromise = null;
    throw error;
  });

  return monitoringAppPromise;
}

await initializeAccessLobby({
  onAuthenticated: async (currentUser) => {
    applyOrganizationBranding(brandingFromUser(currentUser, publicBranding));
    const isFreshBoot = !monitoringApp && !monitoringAppPromise;
    const app = await loadMonitoringApp(currentUser);
    if (!isFreshBoot) {
      await app.syncAccess(currentUser);
    }
  },
  onSignedOut: () => {
    applyOrganizationBranding(publicBranding);
    monitoringApp?.lock();
  },
});


