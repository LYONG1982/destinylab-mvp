import { validateCloudEnvironment } from "./cloud-validation.mjs";

try {
  validateCloudEnvironment(process.env);
} catch {
  console.error(
    "Cloud startup refused: check protected server configuration, HTTPS and database isolation.",
  );
  process.exit(1);
}
// Load Next's standalone server in the same process so it receives SIGTERM.
await import("./server.js");
