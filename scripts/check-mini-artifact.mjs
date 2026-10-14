import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
export async function checkMiniArtifact(directory) {
  const root = resolve(directory),
    files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name);
      if (entry.isSymbolicLink()) throw Error("小程序产物不能包含符号链接。");
      if (entry.isDirectory()) await walk(full);
      else if (entry.name !== "artifact-manifest.json") {
        const bytes = await readFile(full);
        files.push({
          path: relative(root, full).split(sep).join("/"),
          bytes: (await stat(full)).size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await walk(root);
  const app = JSON.parse(await readFile(resolve(root, "app.json"), "utf8"));
  for (const page of [
    "pages/registration/index",
    "pages/encounter/index",
    "pages/privacy/index",
  ])
    if (
      !app.pages.includes(page) ||
      !files.some((f) => f.path === page + ".wxml")
    )
      throw Error("双入口或隐私页面产物缺失。");
  const modules = JSON.parse(
    await readFile(resolve(root, "module-audit.json"), "utf8"),
  );
  const forbidden =
    /node_modules\/(swiper|webpack-dev-server|webpack-dev-middleware|node-forge|braces|esbuild|uuid)\//;
  if (
    !Array.isArray(modules) ||
    !modules.length ||
    modules.some((m) => typeof m !== "string" || forbidden.test(m))
  )
    throw Error("发现浏览器组件或构建工具进入小程序运行产物，需重新审查。");
  const size = files.reduce((n, f) => n + f.bytes, 0);
  if (size > 2 * 1024 * 1024)
    throw Error("小程序主包超过本项目的 2 MiB 预算，请先分包。");
  const manifest = {
    target: "weapp",
    bytes: size,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    modulesChecked: modules.length,
  };
  await writeFile(
    resolve(root, "artifact-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return { bytes: size, files: files.length, modulesChecked: modules.length };
}
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
)
  console.log(
    JSON.stringify(await checkMiniArtifact(process.argv[2] || "miniapp/dist")),
  );
