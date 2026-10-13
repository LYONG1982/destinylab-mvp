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
  logServerError(
    "database.initialization.refused",
    "configuration_validation",
    error,
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
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
