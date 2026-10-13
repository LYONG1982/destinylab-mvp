# 遇见微信小程序 · 本机 UAT

客户端为独立 Taro 4.3.0 / React 18 工程，Web 与后端继续使用根工程的 Next.js。两者依赖独立。

## 构建与导入

```sh
cd miniapp
npm ci
TARO_APP_API_ORIGIN=http://127.0.0.1:3215 TARO_APP_ACTIVITY_ID=cloudtest-mini npm run build:weapp
npm run typecheck
```

在微信开发者工具中导入 **miniapp 目录**（含 project.config.json，miniprogramRoot 指向 dist/）。当前 touristappid 只用于本地项目检查，不具备真实微信登录能力。实际 AppID、主体及类目均待确认，不能将当前构建视为体验版。

未配置 API 地址的构建会明确提示并禁用登录，不提供虚构登录或演示身份后门。即使配置了本机 API，真实换码仍需有效 AppID 和服务端 AppSecret。AppSecret、业务令牌和数据库连接信息不进入客户端配置、Git 或构建产物。

开发者工具只运行客户端；先按 ../docs/MINI_UAT.md 启动后端和隔离 PostgreSQL。localhost HTTP 仅用于本机测试；公网及真机需按实际微信账号能力配置可信 HTTPS 服务、下载域名与必要权限。本项目不自动关闭 urlCheck。

## 接口与旅程

- /api/mini/login：微信 code 换业务令牌；重复进入同活动恢复本人。
- Authorization: Bearer：活动范围内快照、幂等命令、同舟、头像下载上传。
- 前台约 2 秒版本轮询，失败退避，后台停止；改答、同舟返程保留题目。
- 相册选图后正方形裁剪；照片默认允许上屏，但先经过微信内容检测，通过后才更新展示，配对许可独立授权。
- scene 活动码需运营登录后生成，服务端验证活动和开发/体验/正式版本。

现有本地接口测试通过不等于开发者工具视觉验收、真实微信登录或真机通过。应用未部署云端，镜像导出放在本机 UAT 后。

## 双入口与发布

报名：pages/registration/index；现场互动：pages/encounter/index。两个不同小程序码共用服务端与数据库。登录和报名不自动增加现场人数，工作人员核验后才入场。第四站只预览已保存档案，照片仍为私人相册。

正式包运行 npm run build:release，必须提供真实 AppID、HTTPS 根域名、隐私主体和联系方式。构建生成模块清单和 SHA256 manifest，检查 native 模块和项目 2 MiB 主包预算。当前账号未确定，只可交付游客开发包，不提供伪造微信体验版。

内容检测与安全模式回调见 ../docs/weapp/10-content-security.md，剩余工具链风险见 ../docs/weapp/11-dependency-review.md。
