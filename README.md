# 遇见-缘分实验室 · V1.0

## 当前实现：三端共享服务与数据库（2026-10-10）

手机、运营后台和业务大屏已接入同一 Next.js 服务和 PostgreSQL。手机独立会话提交资料、十题答案、邀请与见面操作；事务提交后，运营与大屏通过 SSE 版本通知重新读取获准快照。真实模式不读取或导入 localStorage 演示种子。

当前交付为本机与局域网验收，活动 `meet`；验收库从零参与者、零答案、零邀请、零相遇和零相遇点开始，自动化测试使用另一数据库。大屏仍以第一题为展示基线；后台可查看十题汇总和参与者答案。具体配对需双方独立允许，结束当前任务后仍可撤回。公网/移动网络、微信内置浏览器及实体手机旅程尚未验收。

- 手机入口：[开始参与](http://192.168.43.70:3213/mobile/01-start?activity=meet)
- 运营入口：[现场运营](http://192.168.43.70:3213/admin/dashboard?activity=meet)
- 大屏入口：[业务大屏](http://192.168.43.70:3213/screen?activity=meet)
- [运行、受保护配置与备份说明](docs/LIVE_SERVICE.md)
- [本轮验证与未完成边界](docs/verification/live-linkage/2026-10-10-validation.md)

以上 IP 只适用于当前局域网，换网络时需重新配置并启动；电脑须联网且保持唤醒。旧 3210/3211 演示进程保持原状。下文保留历次视觉版本说明，其中“没有跨设备服务/没有许可来源”描述旧 Mock 阶段，不再描述共享服务模式。

## 当前大屏：ACT03 三对相遇 V2（2026-10-09）

本轮本地验证完成：lint/typecheck/build、92项领域测试、62项完整production回归，最终相关补测及17项开发专项分轮通过；最终冻结源码连续运行1,803.306秒、356采样，FPS中位60。详情及分轮/现场边界见ACT03 V2验证记录。

第三幕支持0/1/2/3对自适应；超过3对在安全时机只替换一组。人物继续使用所选虚拟头像和昵称，三组各有红蓝曲线、暖金交点与错峰反馈。1080P下三对头像152px、昵称30px；两对168/32px，单对176/34px；1440P/4K等比。

- **本地三对预览：<http://localhost:3211/screen/demo>**，展开左下开发面板，点击MEET；0/1/2/3/10 PAIRS切换数量，正常轮播为12/8/18秒。
- 业务大屏：<http://localhost:3210/screen>；production的`/screen/demo`会跳回该入口，无开发面板或虚构Pair。
- 当前业务没有双方公开配对许可来源，业务第三幕仍仅显示匿名见面总数。真实许可接入、跨设备服务和小程序发布不在本轮范围。
- 在工程目录执行`node node_modules/next/dist/bin/next dev --hostname localhost --port 3211`启动预览；已有服务时不重复启动。
- `npm run verify`执行静态/领域/构建；`npx playwright test`生产回归；`npx playwright test -c playwright.dev.config.ts`开发专项；`caffeinate -i npx tsx scripts/verify-destiny-pair-v2-soak.ts`执行默认30分钟开发压力验证。

完整文件说明、验收证据及限制见[ACT03 V2本地验证记录](docs/verification/destiny-field-act3-v2/2026-10-09-validation.md)。下方旧版章节保留历史时序与结果，以本节为当前入口和第三幕口径。


独立本地项目，产品正式命名为“遇见-缘分实验室”，当前产品版本 V1.0（工程版本 1.0.0）。依据历史 v1.1 实施包和用户已确认计划完成；源包版本不代表当前产品版本。先在本地验证从共同话题到双方见面的完整旅程，采用虚构人物和本地 Mock 状态。

后续发布目标为微信小程序：用户端适配小程序，现场运营、同舟资料后台和大屏保留 Web 形态，共用后续正式服务端。当前仍是本地 Web 验证版本，未构建、提审或发布小程序。详见 [小程序适配路线](docs/MINI_PROGRAM_ROADMAP.md)。

当前大屏最新实现见文首“ACT03 三对相遇 V2”章节；前两幕布局继续有效，旧GPU人物交接和历史测试数字不代表当前版本。

**当前范围：手机主旅程 10 页、运营后台 4 页、Destiny Field 大屏（3 个持续世界 Mode＋全局交汇事件）、19 个可重置场景，另含同舟自愿资料填报与资料查看两页。商户核销继续延后。**

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
| `/mobile/04-question` | q2–q10 共用问答页 |
| `/mobile/05-discover` | 0–3 位合格候选 |
| `/mobile/06-common` | 双方共同答案及发出邀请 |
| `/mobile/07-invitation` | 发起方等待 / 接收方决定 |
| `/mobile/08-mutual` | 双向意愿与相遇点 |
| `/mobile/09-meet` | 各自出发、到达、确认见面及帮助 |
| `/mobile/10-next-step` | 个人下一站选择 |
| `/mobile/tongzhou` | 同舟自愿填报、授权、回执及本人管理（虚构资料） |
| `/agency/tongzhou` | 同舟已授权名单、搜索及详情（本地角色演示） |
| `/admin/dashboard` | 现场指标、帮助待办、相遇点和过程记录 |
| `/admin/encounters` | 邀请与相遇状态看板 |
| `/admin/participants` | 搜索、筛选、分页和个人详情 |
| `/admin/partners` | 商户信息、推荐启停和意向 |
| `/screen` | 同源业务快照的只读关系世界：CHOICE 12秒 → LIVE 8秒 → MEET 8秒 |
| `/screen/question`、`presence`、`real-meet` | 同一 World 的三个固定 Mode 预览 |
| `/screen/mutual` | 同一 World 上的一次匿名交汇事件预览，不是第四页 |
| `/screen/demo` | 独立虚构世界；调试控制仅在开发模式出现，不修改手机/后台状态 |

后续页面有状态守卫，直接访问不会替用户接受、出发或确认。要查看特定状态，在 `/demo` 选择对应场景。

## 工程结构

- `src/features/mobile`、`admin`、`screen`：各端页面与交互。
- `src/features/screen/world`：Destiny Field 只读适配、独立 Mock、Mode/事件时钟、Three 渲染及 screen 专属样式。
- `src/components/ui.tsx`：品牌、头像、按钮、提示、原生模态框等共用控件。
- `src/domain`：类型、命令、统计、推荐和公开投影；计数从事实派生。
- `src/data`：完整题库和可复现的虚构场景。
- `src/lib/demo`：本地存储、Web Locks、标签页同步及故障模拟。
- `src/lib/api/contract.ts`：未来服务端适配契约；正式后端需单独设计身份、权限、事务与公共投影。
- `references/original`：原实施包全部 14 个文件，逐项 SHA-256 校验一致。
- `public/assets`：手机场景图、20张可选系统虚拟头像及历史资产；生成提示词及替换步骤见 [素材清单](docs/ASSETS.md)。
- `docs/verification/screenshots`：23 张截图及场景、路由、尺寸、时间清单。

## 验收材料

[操作清单](docs/ACCEPTANCE.md) · [V1.0 品牌验证](docs/verification/brand-v1/2026-10-06-validation.md) · [同舟资料验证](docs/verification/tongzhou/2026-10-06-validation.md) · [十题扩展验证](docs/verification/questions-10/2026-10-06-validation.md) · [本地验证记录](docs/verification/2026-10-05-local-validation.md) · [PRD](docs/PRD.md) · [用户旅程](docs/USER_JOURNEY.md) · [数据模型](docs/DATA_MODEL.md) · [设计规范](docs/DESIGN.md) · [变更记录](docs/CHANGELOG.md)

## 交付边界

独立 Git 仓库，分支 `codex/mvp-local`，没有远程仓库、推送或云部署。原“缘分实验室2026”目录保持原状。业务场景的时间、108 位人物、28 次历史相遇、商户与步行距离，以及独立大屏 Mock 的 143 份档案，均为本地演示数据；不代表真实活动或实际商户承诺。

本地版本没有正式身份认证、真实客户信息接收、跨设备后台或运营权限隔离，浏览器中可检查完整虚构状态。同舟表单可填入虚构示例，禁止用本轮 Mock 收集真实资料；后续服务由同舟线下完成。生产发布、两台手机同步、现场扫码与用户最终体验验收均未完成。本地验收后再另行制定正式后端和上线计划。

## 历史基线：Destiny Field 1.0 · 缘分场（2026-10-07）

大屏重构为持续运行的关系世界：一个 Three Scene 和同一批 Player 跨 CHOICE / LIVE / MEET 连续存在，Mode 仅改变空间与文字状态。核心画面不显示活动名称、Logo、城市、建筑照片、日期或宣传口号；手机、后台和同舟的品牌与业务保持。

- CHOICE：当前首题的三个引力场，按选择分布所选头像与活动昵称；独立`/screen/demo`默认示例48/58/37人用最大余数法显示 **34%/40%/26%**。`/screen`始终按已保存业务快照投影，不套用这组示例。
- LIVE：当前在场人数；只有可认识人数大于零时显示辅助句及对应 Player 的呼吸环。
- MEET：双方已确认的相遇次数，匿名历史轨迹作为空间表达。
- 新双向确认随时触发约6秒 INTERSECTION，暂停 Mode 倒计时后恢复原 Mode 和剩余时间；不公开具体配对，也不增加真实见面数。
- 右下角静止 QR HUD 保留现有扫码目标，独立于世界运动；仅“扫码加入”和一句辅助文案。

`/screen` 只读订阅当前业务 Mock，不调用 sweep / broadcast-consume；仍只支持同源浏览器标签联动。`/screen/demo` 为独立内存演示：143 份虚构档案、默认37人在场、0人开放，支持加入、完成问题、改选、开放/取消、双向确认、确认见面、清空及143人在场压力场景。该控制入口不写原业务存储。

累计选择与当前在场采用不同文案，以独立Mock初值为例：CHOICE“143 人留下了选择”，LIVE“37 人正在这里”；显示头像是可见样本，不凑造业务人物。已具备昵称/头像但未回答首题者进入中性区域，不自动归入任一选项；减少动画时改选直接采用新的静态安全位置。WebGL不可用时静态世界复用文字/二维码避让规则，保留数据与扫码。业务存储损坏时显示“现场数据暂不可用”，不拿种子冒充现有数据；修复后重新建立事件基线，不补播历史。

本轮lint、类型、61项领域测试、生产构建、64项浏览器回归和30分钟连续运行通过；本机FPS采样中位60，Three资源数量稳定。详情见[本地验收记录](docs/verification/destiny-field/2026-10-07-validation.md)。前轮 `screen-relationship` 的101分钟中断记录不能作为新世界稳定性结论；现场5米/10米扫码、真实设备长时运行和用户视觉接受需另外验收。

M08/M09 的前序精简继续保留：仅实际 Meet01 等点位编号与“缘分相遇码”，没有预设方位/步行距离。未增加跨设备后端，未发布线上或小程序。


## 历史双幕高保真版本（2026-10-08）

前两幕已改为稳定DOM人物队列：第一幕男/女各列5人、头像80px/昵称24px；第二幕左右各6人、头像96px/昵称28px。数字与二维码独立渲染，场弧、抽象轨迹和无UI秋日背景组成持续空间。超过窗口人数时分步轮换，跨幕共同人物平滑重排；MEET与匿名INTERSECTION保持。

- 独立视觉预览：`http://localhost:3210/screen/demo`。
- 真实同源本地流程：`http://localhost:3210/demo` → `/screen`。
- 固定幕预览：`/screen/question`、`/screen/presence`，读取业务演示数据。
- 定向新增/突发开发入口：`http://localhost:3211/screen/demo`，可单独执行`node node_modules/next/dist/bin/next dev --hostname localhost --port 3211`启动。
- 开发专项：`npx playwright test --config playwright.dev.config.ts`，需3211服务已启动；生产回归仍用`npm run test:e2e`。

首答、资料入列、在场变化分别反馈，数字不重复累加。二维码码体和锚点保持，仅文案改为“你呢？/扫码加入”。不显示available人数，不显示活动/城市/Logo/装饰英文；未首答资料者在CHOICE不误归任何选项，在LIVE可正常出现。

本轮已通过74项领域测试、生产60项与开发10项的分轮回归，以及最终构建1801秒连续验证（FPS中位60）。修复过程、实际环境、截图与边界见[双幕验收记录](docs/verification/destiny-field-act12-v2/2026-10-08-validation.md)。旧版61/64项及旧30分钟结果仅代表历史版本。现场远距观看/扫码、跨设备后端及小程序未在本轮发布。

## 历史第三幕V1：虚拟头像与昵称相遇（2026-10-09）

第三幕以两位参与者所选的系统虚拟头像和活动昵称为主体：1080P下头像176px、昵称34px，1440P/4K等比例。红蓝彗尾向哑金交点靠近，约7.8秒完成入场、连接、交汇、停留和退出；相遇总数为次级信息。三幕持续使用同一Scene与DOM人物层，二维码全程静止且不透明。

- 本地完整三幕：`http://localhost:3210/screen/demo`，10对明确虚构演示配对，历史相遇总数28独立计数。
- 开发定幕：`http://localhost:3211/screen/demo`，展开控制面板点MEET；支持NEXT/PREVIOUS PAIR、新见面、碰撞、彗尾/火花切换、突发配对、撤回与单对。
- 业务快照：`http://localhost:3210/screen`，当前没有双方公开关系许可来源，因此第三幕保留匿名相遇总数，不显示具体双方。
- 调试面板仅development显示，生产构建无该面板。演示数据不写业务存储；未发布后端、线上或微信小程序。

沿用12/8/8秒轮转，每次MEET一对。新配对在下一安全周期优先，匿名全局交汇暂停并恢复当前Pair；历史播放不会增加相遇数。双方展示许可缺省拒绝，撤回立即清除，不能用同舟服务授权代替。当前结果、截图和连续运行记录见[第三幕验收](docs/verification/destiny-field-act3-v1/2026-10-09-validation.md)。

本轮已完成：最终87项领域测试、14项开发专项、62项完整生产回归及最终构建2项Pair补测；冻结构建连续运行1801.12秒，通过357个采样，FPS中位60，内存与监听器未见持续增长。分轮构建范围及现场边界详见上述第三幕验收记录。


## 2026-10-10 公网 10–20 人演练适配

新增非特权容器、独立初始化、健康检查、数据库 TLS/连接池配置与远端测试库绑定保护。三端继续共用服务及 PostgreSQL，原有手机旅程、十题、双方确认和三幕大屏规则不变，数据库业务表结构不变。自动化使用独立测试库和 20 个浏览器身份；真人验收使用另一个空库。2026-10-10 已按确认计划创建 Render 免费应用和 PostgreSQL 两个独立数据库，完整 TLS 与跨库拒绝检查通过；公网 20 身份演练在集中答题时出现 HTTP 502，尚未进入配对及 30 分钟持续阶段；应用已暂停，测试数据与备份保留。真人空库未切换、实体手机未验收，服务端同步优化方案待确认。运行边界及步骤见 [docs/CLOUD_UAT.md](docs/CLOUD_UAT.md)。
