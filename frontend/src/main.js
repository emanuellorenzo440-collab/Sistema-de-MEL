import { createMonitoringApp } from "./features/monitoring-app.js?v=20260507i";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260507i";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
