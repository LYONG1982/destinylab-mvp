# Destiny Lab Codex Implementation Pack v1.1

本交付包用于让 Codex 基于现有高保真设计，实现“缘分实验室 Destiny Lab”MVP 前端。

## 文件说明

```text
docs/
├─ DL_Codex_Implementation_Spec_v1.1.md
└─ DL_Route_Component_Map_v1.1.md
mock/
└─ DL_Mock_Data_v1.1.json
references/mobile/
└─ 10 张移动端高保真 PNG
```

## 推荐使用方式

1. 将整个文件夹放入 Codex 可访问的项目目录；
2. 让 Codex 首先阅读 `docs/DL_Codex_Implementation_Spec_v1.1.md`；
3. 让 Codex 读取 `mock/DL_Mock_Data_v1.1.json` 创建 TypeScript Mock 数据；
4. 使用 `references/mobile/` 的 PNG 作为移动端视觉参考；
5. 后台 4 页和大屏 4 态按文档规范落地，先不依赖正式 API；
6. 第一阶段完成页面和交互，第二阶段再接服务端。

## 给 Codex 的启动指令

```text
请阅读 docs/DL_Codex_Implementation_Spec_v1.1.md 与
mock/DL_Mock_Data_v1.1.json，使用 Next.js + TypeScript + Tailwind CSS
实现移动端 10 页、后台 4 页和大屏 4 态。

移动端以 references/mobile 中的高保真图为视觉参考，业务状态、文案和
验收标准以实施规范文档为准。先使用 Mock 数据，不接真实后端。
完成后输出 README、路由清单、组件清单和运行截图。
```
