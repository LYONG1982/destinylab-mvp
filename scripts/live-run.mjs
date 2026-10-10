import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [action, ...args] = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (
  !["init", "build", "start"].includes(action) ||
  envIndex < 0 ||
  !args[envIndex + 1]
) {
  console.error(
    "用法：npm run live -- <init|build|start> --env-file /受保护配置路径 [--port 3213]",
  );
  process.exit(1);
}
try {
  loadEnvFile(args[envIndex + 1]);
} catch {
  console.error("无法读取运行配置。");
  process.exit(1);
}
if (process.env.DESTINY_DATA_MODE !== "server") {
  console.error("此入口仅用于共享服务模式。");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? args[portIndex + 1] : "3213";
if (!/^\d{4,5}$/.test(port) || +port > 65535) {
  console.error("端口无效。");
  process.exit(1);
}
const options =
  action === "init"
    ? ["--conditions=react-server", "--import", "tsx", "scripts/live-init.ts"]
    : [
        "node_modules/next/dist/bin/next",
        action,
        ...(action === "start"
          ? ["--hostname", "0.0.0.0", "--port", port]
          : []),
      ];
const child = spawn(process.execPath, options, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DESTINY_DIST_DIR: ".next-live" },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
