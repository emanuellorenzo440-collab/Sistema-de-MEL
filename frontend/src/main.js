import { createMonitoringApp } from "./features/monitoring-app.js?v=20260507j";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260507j";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
