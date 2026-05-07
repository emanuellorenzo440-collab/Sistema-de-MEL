import { createMonitoringApp } from "./features/monitoring-app.js?v=20260507e";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260507e";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
