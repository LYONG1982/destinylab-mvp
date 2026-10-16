import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateMiniRelease } from "./mini-release-config.mjs";
import { checkMiniArtifact } from "./check-mini-artifact.mjs";
const mini = fileURLToPath(new URL("../miniapp/", import.meta.url));
let appid, origin;
try {
  ({ appid, origin } = validateMiniRelease(process.env));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const out = resolve(mini, "release");
await mkdir(out, { recursive: true });
const build = spawnSync(
  process.execPath,
  [
    resolve(mini, "node_modules/@tarojs/cli/bin/taro"),
    "build",
    "--type",
    "weapp",
  ],
  {
    cwd: mini,
    stdio: "inherit",
    env: {
      ...process.env,
      DESTINY_MINI_OUTPUT_ROOT: "release/miniprogram",
      TARO_APP_API_ORIGIN: origin,
    },
  },
);
if (build.status !== 0) process.exit(build.status || 1);
await checkMiniArtifact(resolve(out, "miniprogram"));
const project = JSON.parse(
  await readFile(resolve(mini, "project.config.json"), "utf8"),
);
await writeFile(
  resolve(out, "project.config.json"),
  JSON.stringify(
    { ...project, appid, miniprogramRoot: "miniprogram/" },
    null,
    2,
  ) + "\n",
);
await writeFile(
  resolve(out, "DELIVERY.md"),
  "# 微信发布候选包\n\n导入本目录，核对真实 AppID、合法域名和隐私配置后进行真机验收。构建通过不代表微信审核通过；真实照片/文字公开策略、运营主体及保存期限还需按发布检查清单核验。\n",
);
console.log(
  "发布候选包已生成：miniapp/release。仍须微信开发者工具与真机验收。",
);
