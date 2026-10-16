# V1.3 电子遇见邀请函 · 实施与 UAT

2026-10-12。已更新本机局域网 UAT，构建 `y924VOMndHk5x5TOC15K1`，构建目录 `.next-registration-pass-v13`。当前交付为 H5/微信内浏览器页面；不代表公网或正式小程序发布。

## ① 实施摘要

将现有报名凭证增量升级为“我的遇见邀请函”。活动与报名身份继续来自现有服务器数据；页面在现有暖米白、酒红色与字体基础上改为纸质票券。无依赖新增，无数据库迁移，无接口、编号规则、权限或活动配置修改。

## ② 变更文件

- `src/features/registration/RegistrationApp.tsx`：success分支接入邀请函，复用签到刷新、复制、档案、详情、进入活动回调；邀请函恢复时展示加载骨架，无有效报名仍回报名入口。
- `src/features/registration/EncounterPass.tsx`：邀请函页头、票券、活动信息、状态、遇见码及操作区；取消状态明确不可用于签到。
- `src/features/registration/encounter-pass.ts`：严格日期显示格式化与六码视觉分组，不改变业务值。
- `src/features/registration/registration.css`：`registration-pass`/`reg-pass-*`邀请函专用样式、票券缺口、安全区、响应式与减少动态效果。
- `tests/domain/encounter-pass.test.ts`：日期/自由文本回退与编号格式化。
- `tests/registration/encounter-pass-browser.mjs`：独立展示夹具测试，不修改真实活动配置；覆盖长内容、状态、复制、加载与移动布局。
- `tests/registration/metro-browser.mjs`：更新邀请函文字/视觉分组断言，保留真实服务器报名至第四站全流程回归。
- 同步需求、设计、旅程、数据说明、验收、变更和本报告。Next构建自动追加新构建目录的类型引用。

`RegistrationProfileEditor`、`useProfileEditor`、`MetroStepper`、服务端、数据库和小程序代码均未改动。

## ③ 关键视觉与交互变化

页头“ENCOUNTER PASS / 我的遇见邀请函 / 带上这份邀请，赴一场认真相遇。”；香槟米色票券、细边框、18px圆角、浅半圆缺口和虚线，上方为活动名/状态/时间/地点，下方为高对比的专属遇见码。首报有小号成功反馈，再次进入保持统一邀请函标题。

六位数字仅显示为XXX XXX，复制仍为原始六码；旧长编号原样完整换行。日期严格识别完整中文/ISO日期及明确区间，可显示英文短日期与活动年份，同时提供完整中文日期；跨月、跨年有效，无确定日期不猜测年份，保留原文或待公布。昵称与长地址自然换行。

“查看我的遇见档案 →”为唯一主按钮，报名详情及已签到后的进入活动为文字入口。签到状态可手动刷新，成功/未变化/失败反馈保留；取消报名不展示正常有效邀请操作。

600ms一次入场与250ms状态颜色过渡，签到刷新不重播；reduced-motion取消动画。440px桌面居中，320–430px手机自然滚动。截图检查时修复了既存`.encounter-meta`同名样式干扰，现全部采用独立前缀，并增加标签应位于信息上方的布局断言。

## ④ 保留的业务能力

原报名身份、六码/旧码、签到effectiveStatus（含活动重置）、状态刷新、报名详情维护、已签到进入原互动，以及第四站已保存预览和卡片/站点编辑回流均保留。第四站重复访问仍无profile/save/upload/delete-photo写入，报名版本不因预览增加。前3站保存失败仍保留输入并可重试。

后台、卡牌墙、机构授权及公开主页不在本次改动范围。现有报名须知/隐私告知与错误提示保留。

## ⑤ 实际测试与结果

命令中的环境变量由受保护的隔离测试配置载入，未将凭据写入工程或报告。

| 命令 / 检查 | 结果 |
|---|---|
| `npm test` | 133项领域测试通过，含新增日期与编号边界 |
| `npm run lint -- --ignore-pattern '.next-registration*/**'` | 全项目源码检查通过；额外排除已存在的生成构建目录 |
| `DESTINY_DIST_DIR=.next-registration-pass-v13 npm run typecheck` | 类型检查通过 |
| `DESTINY_DIST_DIR=.next-registration-pass-v13 node node_modules/next/dist/bin/next build` | 生产构建与内置TypeScript检查通过 |
| `node --conditions=react-server --import tsx --test tests/registration/service.test.ts` | 独立PostgreSQL报名生命周期通过，含持久化/幂等/相册权限/签到及重置 |
| `node tests/registration/metro-browser.mjs` | 真实隔离服务完整报名、档案四站、冲突/断网重试/回流/重复预览零写入等通过 |
| `node tests/registration/encounter-pass-browser.mjs` | 展示夹具边界通过：五屏宽、复制原码、长内容、空值、跨年、待签到/已签到/取消、失败保留状态、键盘、加载骨架、reduced-motion |

320/375/390/430/1440宽度无横向溢出，交互热区高度≥44px，检查文字对比度最低4.79:1。已实际查看390px邀请函和320px长内容截图，活动、日期、地点和编号完整可读。模拟长内容/状态的测试与真实服务集成测试分开记录，不冒充真实业务数据。

证据：`verification/registration/encounter-pass-v13/`中的`browser-result.json`、`pass-browser-result.json`、`pass-contrast.json`、`uat-result.json`和截图。`pass-390.png`为邀请函展示夹具；`01-first-ticket.png`、`02-return-ticket.png`来自真实隔离数据库报名。

UAT健康、报名/邀请函、运营、机构、卡牌墙、原互动入口返回200；匿名报名列表401。升级前后原有3条报名整行摘要完全一致，未植入UAT测试报名。

## ⑥ 入口、风险及建议

手机与Mac接入同一Wi-Fi，Mac保持开机：

- [报名入口 / 我的邀请函](http://192.168.43.70:3216/mobile/register?activity=meet)
- [直接查看邀请函](http://192.168.43.70:3216/mobile/register?activity=meet&view=success)（使用原报名浏览器，保留本人会话）
- [遇见档案第四站](http://192.168.43.70:3216/mobile/register?activity=meet&view=details&step=preview)
- [运营报名管理](http://192.168.43.70:3216/admin/registrations?activity=meet)
- [同舟机构后台](http://192.168.43.70:3216/agency/tongzhou?activity=meet)
- [现场卡牌墙](http://192.168.43.70:3216/display/member-wall?activity=meet)

报名二维码沿用`verification/registration/uat-registration-qr.png`。邀请函没有建立新的独立URL路由，原入口与有效会话仍可用。

实体微信/手机的系统安全区、软键盘、返回和选图尚需人工验收；自动化已验证Chrome移动视口。局域网HTTP的系统剪贴板能力受浏览器限制，仍沿用既有条件显示复制入口；原编号可选中查看，未添加第三方剪贴板依赖。非结构化日期保留原文是刻意的兼容回退，不虚构活动日期。

受保护运行目录：`~/.config/destinylab/2026-10-12-registration-pass-v13/`，内有uat.env/pid/log及previous.env，禁止纳入交付包。回退使用保留的`.next-registration-preview`（构建`aBjnUA3wacsO75VEY6L8H`）与previous.env，仅切换应用，不恢复覆盖数据库。重启前复核PID、工作目录与端口。
