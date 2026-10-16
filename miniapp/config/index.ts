import path from "node:path";
import type { Compiler } from "webpack";
import { writeFileSync, mkdirSync } from "node:fs";
import { defineConfig, type UserConfigExport } from "@tarojs/cli";

class NativeModuleAudit {
  apply(compiler: Compiler) {
    compiler.hooks.done.tap("NativeModuleAudit", (stats) => {
      if (stats.hasErrors()) return;
      const modules: string[] = [];
      const collect = (items: { name?: string; modules?: unknown[] }[]) => {
        for (const item of items) {
          if (item.name) modules.push(item.name);
          if (item.modules) collect(item.modules as typeof items);
        }
      };
      collect(
        stats.toJson({ all: false, modules: true, nestedModules: true })
          .modules || [],
      );
      const out = path.resolve(
        __dirname,
        "..",
        process.env.DESTINY_MINI_OUTPUT_ROOT || "dist",
      );
      mkdirSync(out, { recursive: true });
      writeFileSync(
        path.join(out, "module-audit.json"),
        JSON.stringify(modules.sort()),
      );
    });
  }
}

const sharedSourceRoot = path.resolve(__dirname, "../../src");

const apiOrigin = process.env.TARO_APP_API_ORIGIN ?? "";
const activityId = process.env.TARO_APP_ACTIVITY_ID ?? "meet";

const config: UserConfigExport = {
  projectName: "destiny-lab-miniapp",
  date: "2026-10-11",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
    375: 2,
  },
  sourceRoot: "src",
  outputRoot: process.env.DESTINY_MINI_OUTPUT_ROOT || "dist",
  framework: "react",
  compiler: "webpack5",
  cache: {
    enable: false,
  },
  defineConstants: {
    "process.env.TARO_APP_PRIVACY_OWNER": JSON.stringify(
      process.env.TARO_APP_PRIVACY_OWNER || "",
    ),
    "process.env.TARO_APP_PRIVACY_CONTACT": JSON.stringify(
      process.env.TARO_APP_PRIVACY_CONTACT || "",
    ),
    "process.env.TARO_APP_API_ORIGIN": JSON.stringify(apiOrigin),
    "process.env.TARO_APP_ACTIVITY_ID": JSON.stringify(activityId),
  },
  plugins: ["@tarojs/plugin-framework-react", "@tarojs/plugin-platform-weapp"],
  mini: {
    compile: {
      include: [sharedSourceRoot],
    },
    webpackChain(chain) {
      chain.resolve.alias.set("@", sharedSourceRoot);
      chain.plugin("native-module-audit").use(NativeModuleAudit);
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      url: {
        enable: true,
        config: {
          limit: 1024,
        },
      },
      cssModules: {
        enable: false,
      },
    },
  },
  h5: {},
};

export default defineConfig<"webpack5">(async (merge) =>
  merge({}, config as UserConfigExport),
);
