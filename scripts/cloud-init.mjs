import { spawn } from "node:child_process";
import { validateCloudEnvironment } from "./cloud-validation.mjs";
import { logServerError } from "./lib/error-log.mjs";

try {
  validateCloudEnvironment(process.env);
  if (
    process.env.DESTINY_INIT_DATABASE !==
    decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))
  )
    throw new Error("DATABASE_CONFIRMATION_REQUIRED");
} catch (error) {
  logServerError("database.initialization.refused", error, {
    stage: "configuration_validation",
  });
  console.error(
    "Initialization refused: validate protected configuration and explicitly name DESTINY_INIT_DATABASE.",
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", "scripts/live-init.ts"],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
let spawnFailed = false;
child.on("exit", (code, signal) => {
  process.exitCode = code ?? 1;
  if (code !== 0 && !signal && !spawnFailed) {
    const error = new Error(
      `INITIALIZER_EXIT_${code ?? "signal"}${signal ? `_${signal}` : ""}`,
    );
    logServerError("database.initialization.failed", error, {
      stage: "initializer_process_exit",
    });
  }
});
child.on("error", (error) => {
  spawnFailed = true;
  logServerError("database.initialization.failed", error, {
    stage: "initializer_process_start",
  });
  process.exitCode = 1;
});
