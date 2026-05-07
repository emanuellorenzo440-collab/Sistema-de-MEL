import { createMonitoringApp } from "./features/monitoring-app.js?v=20260507g";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260507g";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
