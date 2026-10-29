# 遇见 · 缘分实验室

2026-10-29增量：双向确认后，双方H5页面自动显示地点与个人相遇码，发起方无须再点“查看相遇任务”；验证与交付见 [双端自动呈现说明](docs/weapp/24-auto-guide-after-mutual-confirmation.md)。

当前开发分支为 [`codex/weapp-release-20261013`](https://github.com/LYONG1982/destinylab-mvp/tree/codex/weapp-release-20261013)。2026-10-27 已完成个人相遇流程、动态地点/本人码指引、后台点位增删与新点默认30对，连同六题、520和默认大屏展示纳入本分支源码；工程师请读 [本次源码交付与部署说明](docs/releases/2026-10-27-personal-encounter-source.md)。本机入口为 http://127.0.0.1:3244 ，详见 [本轮验证与截图交付记录](docs/weapp/23-personal-encounter-and-meet-points-uat.md)。下文 v1.4.0 和旧LAN地址是历史记录；源码发布不表示线上部署完成。

微信小程序开发候选工程。用户端采用 Taro/React 原生小程序，运营后台、同舟机构后台和现场大屏保留 Web，共用 Next.js 服务与 PostgreSQL。

## GitHub 与当前版本

本次正式源码迭代为 **v1.4.0**，统一交付报名、现场互动、运营后台、同舟机构和两套大屏。默认交付分支为 [`codex/cloud-uat`](https://github.com/LYONG1982/destinylab-mvp/tree/codex/cloud-uat)，版本内容固定以 [v1.4.0 Release](https://github.com/LYONG1982/destinylab-mvp/releases/tag/v1.4.0) 为准。

本版包含迁移 **001–015**、双来源同舟档案、独立活动管理、批量离场/恢复/移除与现场清零、LAN HTTP 兼容修复，以及卡牌墙配置与独立模拟预览。部署人员请先读 [v1.4.0 部署与入口说明](docs/releases/v1.4.0.md)。

这是源码版本；须从本标签重新构建应用和迁移镜像。[历史 rc.1 包](https://github.com/LYONG1982/destinylab-mvp/releases/tag/weapp-v1.4.0-rc.1) 仅含至013，不能当作本版镜像。小程序源码随工程交付，实际 AppID、主体、服务类目和微信真机验收仍未完成；GitHub 发布不代表公网系统更新或微信上架。

## 本地 UAT 入口与用途

新增运营栏目：`/admin/activities?activity=meet`。报名与现场独立，现场不要求先报名/签到；现场清零不删除报名和已授权同舟档案。

手机和 Mac 连接同一 Wi-Fi，Mac 保持运行。下表为此前验收使用的局域网地址。正式发布复核时Mac已换到192.168.130.201，原192.168.43.70地址失效；本机服务仍在运行、就绪检查通过，但须同步运行时入口配置并复验后才能使用新网络的手机入口。以下历史链接不是当前可用入口或公网地址。

| 入口 | 说明 | 本地地址 |
| --- | --- | --- |
| 手机报名 | 报名、邀请函、六位凭证、四站档案与相册 | [进入报名](http://192.168.43.70:3216/mobile/register?activity=meet) |
| 活动遇见 | 答题、匹配、邀请与见面 | [进入活动](http://192.168.43.70:3216/mobile/01-start?activity=meet) |
| 同舟后台 | 双来源统一档案、跟进备注、相册及个人主页发布 | [进入同舟后台](http://192.168.43.70:3216/agency/tongzhou?activity=meet) |
| 运营报名管理 | 核验报名凭证、工作人员签到 | [报名管理与签到](http://192.168.43.70:3216/admin/registrations?activity=meet) |
| 运营总览 | 现场数据与 Meet01–Meet20 配置 | [现场总览](http://192.168.43.70:3216/admin/dashboard?activity=meet) |
| 现场大屏 | 现场状态与互动展示 | [主大屏](http://192.168.43.70:3216/screen?activity=meet) |
| 遇见卡牌墙 | 参与者卡牌与偏好展示 | [卡牌墙](http://192.168.43.70:3216/display/member-wall?activity=meet) |

个人专属主页由同舟后台发布后生成唯一 `/tongzhou/p/<slug>` 链接，使用实际发布返回的地址。账号密码仅存受保护配置，不放入代码或本说明。

更多运营页面、互动流程子页面和原生小程序路径见 [全部入口及使用条件](docs/weapp/06-uat-entrypoints.md)。

## 功能与入口

- **报名入口**：`pages/registration/index`，姓名与昵称、分列生日及星座、六位报名凭证、电子邀请函、四站档案、私有相册、同舟服务。
- **现场互动入口**：`pages/encounter/index`，可独立主动入场，无需先报名或签到；十题互动、推荐、邀请、见面与后续服务。报名码和互动码分别生成。
- **Web 运营**：`/admin/registrations`、`/admin/dashboard`、`/admin/member-wall`；默认 Meet01–Meet20，可配置启停，不预设具体地址。
- **同舟机构**：`/agency/tongzhou`，资料列表、抽屉详情、备注、相册、公开字段及专属主页发布。
- **大屏**：`/screen`、`/display/member-wall`；H5 兼容报名入口 `/mobile/register`。

活动参数统一为 `?activity=<活动标识>`。运营与机构使用各自服务端凭据，真实姓名、电话、完整生日不进入小程序分享或公共大屏。

## 开发与验证

Node.js 22.22.1，PostgreSQL 17，依赖以两个 package-lock.json 为准。

```sh
npm ci --no-audit --no-fund
npm ci --prefix miniapp --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build
npm run typecheck --prefix miniapp
npm run build:weapp --prefix miniapp
```

数据库集成测试只运行在专用回环 `_test` 库；配置方式及边界见 [验收记录](docs/weapp/04-test-and-acceptance.md)。GitHub Actions 仅手动触发，执行前核对免费额度。

小程序开发包使用游客 AppID，不提供真实登录。拿到账号与实际 HTTPS 后，设置 `TARO_APP_ID`、`TARO_APP_API_ORIGIN`、`TARO_APP_ACTIVITY_ID`、`TARO_APP_PRIVACY_OWNER`、`TARO_APP_PRIVACY_CONTACT`，执行 `npm run build:release --prefix miniapp`。正式构建拒绝占位 AppID、HTTP、IP 或空隐私主体配置。

## 部署交接

[工程师部署手册](deploy/README.md) · [配置模板](.env.example) · [内容检测和回调](docs/weapp/10-content-security.md) · [实施状态](docs/weapp/08-implementation-status.md) · [依赖风险](docs/weapp/11-dependency-review.md)

统一应用镜像同时提供 API、H5、后台、机构与大屏；数据库单独部署。最新源码的增量迁移 001–015 由对应版本独立迁移镜像显式执行，不在应用启动时自动改库。配置、AppSecret、数据库备份和用户照片不进入 Git 或发布包。

代码与本地验证可独立交付。实际 AppID、主体、服务类目尚未确定，微信开发者工具、体验版、iOS/Android 真机与公网验收未完成；GitHub 开发预发布不等于微信上架。具体本地地址是时点信息，以 [UAT 入口](docs/weapp/06-uat-entrypoints.md) 为准。历史验收大目录未包含在发布源码中。
