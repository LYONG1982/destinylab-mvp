# 局域网 HTTP 运营操作兼容修复

## 触发与修复

通过私有 IP 的 HTTP 地址访问运营后台时，浏览器不提供 crypto.randomUUID。现场维护准备确认任务、活动管理准备请求会因此报错，尚未完成相应业务操作。

ActivityManagement.tsx 两处调用改为复用既有 clientId：优先 randomUUID，不可用时用 getRandomValues 生成 UUID v4。沿用同一确认任务的请求编号，失败后重试不重新生成编号。无数据结构、接口、权限或视觉变更，不新增迁移，原有迁移015要求不变。

2026-10-15 的操作回归使用回环 HTTP；该环境支持 randomUUID，未覆盖真实局域网差异。本次补齐该验证缺口。

## 可重复验收

沿用 [视觉验收](15-admin-visual-uat.md) 的受保护配置和 seed 脚本，创建独立 visual-* 合成活动。数据库必须在本机且名称以 _test 结尾。测试服务绑定 0.0.0.0:3235，DESTINY_PUBLIC_URL 设置为本机实际私有 IPv4 的 HTTP 地址，DESTINY_ALLOW_LAN_HTTP=true。不得使用真实活动或3216运行维护测试。

```sh
ADMIN_VISUAL_ORIGIN=http://本机私有IPv4:3235 ADMIN_VISUAL_EVIDENCE=/受保护目录 ADMIN_VISUAL_LOGIN=/受保护目录/ui-login.json node tests/live/admin-visual-ui.mjs
```

脚本限制 HTTP、专用3235端口、回环或私有IPv4、visual-* 合成标识。私有IP运行时强制核对 isSecureContext=false、randomUUID=undefined、getRandomValues=function；不通过模拟浏览器 API 伪造该条件。

## 2026-10-16 验收记录

- ESLint、TypeScript、Next生产构建通过。
- 实际地址 http://192.168.43.70:3235，合成活动 visual-20a4c636，符合上述非安全上下文条件。
- 批量离场、恢复、单人移除、关闭/开放现场、创建另一活动和两种切换入口通过。
- 模拟提交503：保持失败提示，没有成功提示；同一确认任务再次提交复用原编号。所有现场操作请求编号符合UUID v4格式。
- 实际执行清零：剩余2名参与者退出，新epoch不同于旧epoch，旧轮次归档；现场仍关闭，之后由管理员开放。3条报名记录仍保留。
- 六档窗口（1440/1280/1024/768/390/320）两张名单滚动前后共24组布局检查，状态、焦点、加载/失败/空态回归通过；浏览器运行错误0。
- 截图及results.json交付至本地“2026-10-16-局域网UUID修复”目录；没有在真实meet活动执行移除、清零等测试。

## 本地交付

3216 UAT已切换至 .next-lan-uuid-20261016 生产构建。切换前临时3217就绪检查通过；沿用原受保护配置、账号和数据库，不执行迁移或业务数据清理。切换后13个主要入口HTTP200、运营和机构登录页通过，浏览器运行错误0，结果见交付目录uat-health.json。

修复提交b0c07b8已推送并核验；GitHub候选分支 codex/weapp-release-20261013、草稿PR #1承载本次源码。公网服务尚未更新，未合并默认分支、重打历史发布包或进行微信真机验收。
