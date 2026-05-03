import { createMonitoringApp } from "./features/monitoring-app.js";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
