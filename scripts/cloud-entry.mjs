import { validateCloudEnvironment } from "./cloud-validation.mjs";
import { logServerError } from "./scripts/lib/error-log.mjs";

try {
  validateCloudEnvironment(process.env);
} catch (error) {
  logServerError("cloud.startup.refused", error, {
    stage: "configuration_validation",
  });
  process.exit(1);
}
// Load Next's standalone server in the same process so it receives SIGTERM.
await import("./server.js");
