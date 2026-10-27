import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runtimeEnv =
  process.env.DESTINY_520_RUNTIME_ENV ||
  "/Users/lvyong198201/.local/share/destinylab/uat-520-20261026/runtime.env";
process.loadEnvFile(runtimeEnv);
process.env.DESTINY_PUBLIC_URL ||= "http://127.0.0.1:3244";

const script = fileURLToPath(new URL("./520-load.mjs", import.meta.url));
const child = spawn(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", script],
  {
    env: process.env,
    stdio: "inherit",
  },
);
child.on("error", (error) => {
  console.error(`Could not start the load runner: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
