# 本地验证与微信验收

双入口自动测试使用独立本机 PostgreSQL `destiny_weapp_release_test`。同日后续 20 地点计划已备份并升级原 3216 UAT，参见 09-meet-points-uat.md。测试秘密保存在仓库外权限 600 文件，不进入交付包。

## 本轮证据

- 主工程 TypeScript 与 ESLint 通过（仅检查源码，排除隔离构建和历史截图/日志）。
- 135 项领域测试通过。
- 双入口集成 8 项通过：身份无入场副作用、报名并发幂等、三站保存与版本冲突、私人照片访问、签到和并发入场、双码路由与重复迁移、过期/重置拒绝。
- 原 H5 报名及私有生日回归 2 项通过。
- 既有小程序互动集成 4 项通过，包含 20 个注入身份完成真实本机 API 答题和双方相遇。注入仅限测试函数，HTTP 登录仍调用真实微信。
- 小程序类型检查与 `build:weapp` 通过；注册报名、互动、旧互动流程、隐私四条页面路径。开发包使用游客 AppID，不能当作体验版。
- 真实 React 组件＋浏览器 Taro 适配器＋实际 API，6 个 UI 场景通过：首次报名、保存失败重试、编辑返回第四站、重复进入不提交、返回凭证、互动入口待签到拦截。适配器不验证微信原生控件、微信登录、原生照片选择或微信分享面板。
- 发布构建门禁实测拒绝游客/缺失 AppID。

并发测试发现并修复事务内二次获取数据库连接的问题：报名配置读取改为复用当前事务连接，避免连接池占满后等待自身事务释放连接。

## 复验

先准备独立本机测试库与受保护运行环境，应用 `database/001` 至 `012`，启用 registration/mini/tongzhou/avatars/member-wall 功能。不要使用正式数据库。

```sh
npm ci
npm ci --prefix miniapp
npm run lint
npm run typecheck
npm test
npm run test:mini:integration
npm run typecheck --prefix miniapp
npm run build:weapp --prefix miniapp
npm run build
```

API 集成要求已注入受保护配置，测试数据库名以 `_test` 结尾且必须回环地址。20 人互动回归见 `tests/mini/service.test.ts`，需隔离服务（3215 或 3227）、机构测试登录文件及受保护结果路径。UI 适配器见 `tests/mini/browser-harness.mjs`，固定回环 3228 代理独立 API 3227；使用 `scripts/mini-ui-fixture.ts` 创建测试身份，不对外开放此能力。

## 尚未完成的验收

- 真实 AppID 换码、微信开发者工具与 iOS/Android 双真机。
- 真实小程序码生成、微信扫码冷/热启动和原生分享。
- 相册权限同意/拒绝及原生裁剪、原生 Picker、安全区。
- 实际 HTTPS 域名、移动网络、账号主体/类目和平台隐私声明。
- 微信公开内容检测 API 与实际账号策略对接；现有机构人工预览发布继续保留，但不能据此认定小程序公开昵称/照片已完成平台内容检测。

本地通过不代表微信审核通过，也不代表已有生产部署。

## 最终独立交付复验（2026-10-13）

独立目录重新安装依赖；140 项领域测试、18 项集成、空库 13 项集成、20 人 HTTP 回归 4 项、React 浏览器适配器 6 场景通过。后续权威状态见 08-implementation-status.md；微信原生运行时和真机仍待实际账号。
