import { validateCloudEnvironment } from "./cloud-validation.mjs";
import { logServerError } from "./lib/error-log.mjs";

try {
  validateCloudEnvironment(process.env);
} catch (error) {
  logServerError("cloud.startup.refused", error, {
    stage: "configuration_validation",
  });
  process.exit(1);
}
// Load Next's standalone server in the same process so it receives SIGTERM.
try {
  await import("./server.js");
} catch (error) {
  logServerError("cloud.startup.failed", error, { stage: "next_server_import" });
  process.exitCode = 1;
}
