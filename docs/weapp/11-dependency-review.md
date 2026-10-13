# 发布候选依赖与产物审查

核验日期：2026-10-13。锁定 Node 22.22.1、Taro 4.3.0 与其声明兼容的 webpack 5.91.0，不使用 `npm audit fix --force` 降级整个框架。

## 处置

- 根应用 `npm audit --omit=dev`：0 项告警。后端镜像只来自根依赖，不复制 miniapp/node_modules。
- `@tarojs/components` 的传递 Swiper 已显式覆盖为 12.1.2，消除该依赖链的 critical 原型污染告警；独立安装、原生编译需保持通过。
- Taro loader 显式声明 4.3.0，修复 npm 重排依赖后 loader 不能从 webpack 根解析的问题。
- webpack 5.111.1 与 Taro 4.3.0 的精确 peer 约束及进度插件不兼容，未强制带入交付。既有版本的 buildHttp 功能不启用，miniapp 工具链不提供对外 H5 开发服务器。
- 原生包由 webpack 编译模块清单校验：Swiper 浏览器实现、webpack-dev-server、webpack-dev-middleware、node-forge、braces、esbuild、uuid 不得进入小程序产物。任何命中会令构建失败；主包采用项目自定 2 MiB 上限，超限需分包。

## 剩余告警

小程序安装依赖图仍有 21 条（0 critical、12 high、9 moderate）。它们主要归于 Taro 的 H5/开发服务器/编译工具传递依赖，不能说已全部修复。braces 与 node-forge 当前 registry 最新版本仍被告警范围覆盖；开发服务器和 webpack 升级跨越上游兼容约束。

本交付限制为 **weapp 原生构建**：不运行 Taro H5 server，不向网络开放开发服务器，不处理陌生构建项目或外部 glob 输入，不启用 webpack buildHttp，不把工具链安装目录放入生产镜像。原生模块检查和根生产依赖审计用于证明部署路径的隔离；不能据此保证工具自身不存在漏洞。

开发预发布保留此已知工具链风险。后续 Taro 修复版本升级或新增 Taro H5 目标时必须重新核验，不能沿用本次不可达结论。

审计来源为 npm registry 和其返回的 GitHub Advisory 链接，例如 [Swiper](https://github.com/advisories/GHSA-hmx5-qpq5-p643)、[webpack buildHttp](https://github.com/advisories/GHSA-8fgc-7cc6-rx7x)、[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv)。实际审计计数随上游公告更新，不是永久安全证明。
