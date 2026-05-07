import { createMonitoringApp } from "./features/monitoring-app.js?v=20260507h";
import { bootstrapApiBridge, startRuntimeBridge } from "./services/mel-runtime-bridge.js?v=20260507h";

await bootstrapApiBridge();
createMonitoringApp().start();
startRuntimeBridge();
