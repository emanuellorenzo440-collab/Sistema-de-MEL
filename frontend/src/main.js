import { initializeAccessLobby } from "./features/access-lobby.js?v=20260525e";

let monitoringApp = null;
let monitoringAppPromise = null;
let runtimeBridgeStarted = false;

async function loadMonitoringApp(authenticatedUser = null) {
  if (monitoringApp) return monitoringApp;
  if (monitoringAppPromise) return monitoringAppPromise;

  monitoringAppPromise = (async () => {
    const [{ createMonitoringApp }, { bootstrapApiBridge, startRuntimeBridge }] = await Promise.all([
      import("./features/monitoring-app.js?v=20260525e"),
      import("./services/mel-runtime-bridge.js?v=20260525e"),
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
    const isFreshBoot = !monitoringApp && !monitoringAppPromise;
    const app = await loadMonitoringApp(currentUser);
    if (!isFreshBoot) {
      await app.syncAccess(currentUser);
    }
  },
  onSignedOut: () => {
    monitoringApp?.lock();
  },
});


