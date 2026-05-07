import { createMonitoringApp } from "./features/monitoring-app.js?v=20260507f";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260507f";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
