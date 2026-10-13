# 遇见 · 缘分实验室

微信小程序开发候选版 `weapp-v1.4.0-rc.1`。用户端采用 Taro/React 原生小程序，运营后台、同舟机构后台和现场大屏保留 Web，共用 Next.js 服务与 PostgreSQL。

## 功能与入口

- **报名入口**：`pages/registration/index`，姓名与昵称、分列生日及星座、六位报名凭证、电子邀请函、四站档案、私有相册、同舟服务。
- **现场互动入口**：`pages/encounter/index`，工作人员签到后入场，十题互动、推荐、邀请、见面与后续服务。报名码和互动码分别生成。
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

统一应用镜像同时提供 API、H5、后台、机构与大屏；数据库单独部署。增量迁移 001–013 由独立迁移镜像显式执行，不在应用启动时自动改库。配置、AppSecret、数据库备份和用户照片不进入 Git 或发布包。

代码与本地验证可独立交付。实际 AppID、主体、服务类目尚未确定，微信开发者工具、体验版、iOS/Android 真机与公网验收未完成；GitHub 开发预发布不等于微信上架。具体本地地址是时点信息，以 [UAT 入口](docs/weapp/06-uat-entrypoints.md) 为准。历史验收大目录未包含在发布源码中。
