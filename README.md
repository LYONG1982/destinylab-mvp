# 缘分实验室 · Destiny Lab MVP 1.1

独立本地项目，依据 v1.1 实施包和用户已确认计划完成。用于先验证从共同话题到双方见面的完整旅程，采用虚构人物和本地 Mock 状态。

**当前范围：手机 10 页、运营后台 4 页、大屏 4 态、19 个可重置场景。商户核销和服务授权按用户要求延后。**

## 本地体验

打开 **http://localhost:3210/demo**，先选择“从头体验”并确认载入，然后分别打开“山风视角”“小满视角”“现场运营”“现场大屏”。请在同一浏览器的普通标签页操作。

山风完成答题后向小满发出邀请；在小满标签页主动接受。两人分别确认出发、到达、已经见到 TA。单方确认时真实相遇仍为 28；双方确认后后台和大屏同时为 29。之后各自选择下一站。场景重置只覆盖本项目演示快照。

建议使用本机 Chrome。不同浏览器、隐身窗口、不同地址来源（localhost 与 127.0.0.1）、不同设备的状态互不共享；二维码默认也是本机地址。这里的角色选择不是正式登录。

## 安装与运行

本次验证环境：Node 22.22.1、npm 10.9.4、Next 16.3.8、React 19.3.0、TypeScript 5.9.3。依赖已锁定，项目不需要环境变量、密钥或数据库。

```sh
cd "/Users/lvyong198201/Desktop/Game 2026/DestinyLab-MVP"
npm ci
npm run build
npm run start
```

本地服务绑定 `localhost:3210`。修改代码时可改用 `npm run dev`；不要同时运行两个占用该端口的进程。启动终端按 Ctrl+C 停止。若已经运行，可直接打开上述入口。

```sh
npm run verify       # lint、类型、领域规则、生产构建
npm run test:e2e     # Chrome 浏览器验收；需已构建，必要时自动启动服务
npm run screenshots # 服务运行时导出 23 张页面和异常状态图
```

浏览器脚本使用本机已安装的 Google Chrome（`channel: chrome`），无需下载 Playwright Chromium。自动测试使用独立浏览器上下文，不修改用户正在体验的演示数据。

## 路由

| 入口 | 内容 |
| --- | --- |
| `/demo` | 角色入口、场景重置、故障模拟、页面索引及二维码配置 |
| `/mobile/01-start` | 第一道问题 |
| `/mobile/02-result` | 真实首答样本分布 |
| `/mobile/03-profile` | 昵称、年龄段、性别和见面准备 |
| `/mobile/04-question` | q2–q6 共用问答页 |
| `/mobile/05-discover` | 0–3 位合格候选 |
| `/mobile/06-common` | 双方共同答案及发出邀请 |
| `/mobile/07-invitation` | 发起方等待 / 接收方决定 |
| `/mobile/08-mutual` | 双向意愿与相遇点 |
| `/mobile/09-meet` | 各自出发、到达、确认见面及帮助 |
| `/mobile/10-next-step` | 个人下一站选择 |
| `/admin/dashboard` | 现场指标、帮助待办、相遇点和过程记录 |
| `/admin/encounters` | 邀请与相遇状态看板 |
| `/admin/participants` | 搜索、筛选、分页和个人详情 |
| `/admin/partners` | 商户信息、推荐启停和意向 |
| `/screen` | 12/8/8 秒轮播及符合条件时 6 秒匿名插播 |
| `/screen/question`、`presence`、`mutual`、`real-meet` | 四态固定预览 |

后续页面有状态守卫，直接访问不会替用户接受、出发或确认。要查看特定状态，在 `/demo` 选择对应场景。

## 工程结构

- `src/features/mobile`、`admin`、`screen`：各端页面与交互。
- `src/components/ui.tsx`：品牌、头像、按钮、提示、原生模态框等共用控件。
- `src/domain`：类型、命令、统计、推荐和公开投影；计数从事实派生。
- `src/data`：完整题库和可复现的虚构场景。
- `src/lib/demo`：本地存储、Web Locks、标签页同步及故障模拟。
- `src/lib/api/contract.ts`：未来服务端适配契约；正式后端需单独设计身份、权限、事务与公共投影。
- `references/original`：原实施包全部 14 个文件，逐项 SHA-256 校验一致。
- `public/assets`：独立场景图和两枚默认头像；生成提示词及替换步骤见 [素材清单](docs/ASSETS.md)。
- `docs/verification/screenshots`：23 张截图及场景、路由、尺寸、时间清单。

## 验收材料

[操作清单](docs/ACCEPTANCE.md) · [本地验证记录](docs/verification/2026-10-05-local-validation.md) · [PRD](docs/PRD.md) · [用户旅程](docs/USER_JOURNEY.md) · [数据模型](docs/DATA_MODEL.md) · [设计规范](docs/DESIGN.md) · [变更记录](docs/CHANGELOG.md)

## 交付边界

独立 Git 仓库，分支 `codex/mvp-local`，没有远程仓库、推送或云部署。原“缘分实验室2026”目录保持原状。时间、108 位人物、28 次历史相遇、商户与步行距离均为本地演示数据；不代表真实活动或实际商户承诺。

本地版本没有正式身份认证、真实联系方式、跨设备后台或运营权限隔离，浏览器中可检查完整虚构状态。生产发布、两台手机同步、现场扫码与用户最终体验验收均未完成。本地验收后再另行制定正式后端和上线计划。
