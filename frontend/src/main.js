import { initializeAccessLobby } from "./features/access-lobby.js?v=20260508g";
import { createMonitoringApp } from "./features/monitoring-app.js?v=20260508g";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260508a";

await bootstrapApiBridge();

const app = createMonitoringApp();
await app.start();
startRuntimeBridge();

await initializeAccessLobby({
  onAuthenticated: () => {
    void app.syncAccess();
  },
  onSignedOut: () => {
    app.lock();
  },
});
