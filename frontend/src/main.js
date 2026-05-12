import { initializeAccessLobby } from "./features/access-lobby.js?v=20260512d";

let monitoringApp = null;
let monitoringAppPromise = null;
let runtimeBridgeStarted = false;

async function loadMonitoringApp(authenticatedUser = null) {
  if (monitoringApp) return monitoringApp;
  if (monitoringAppPromise) return monitoringAppPromise;

  monitoringAppPromise = (async () => {
    const [{ createMonitoringApp }, { bootstrapApiBridge, startRuntimeBridge }] = await Promise.all([
      import("./features/monitoring-app.js?v=20260512d"),
      import("./services/mel-runtime-bridge.js?v=20260508h"),
    ]);

    const app = createMonitoringApp();
    await bootstrapApiBridge();
    await app.start(authenticatedUser);

    if (!runtimeBridgeStarted) {
      startRuntimeBridge();
      runtimeBridgeStarted = true;
    }

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
    const app = await loadMonitoringApp(currentUser);
    await app.syncAccess(currentUser);
  },
  onSignedOut: () => {
    monitoringApp?.lock();
  },
});
