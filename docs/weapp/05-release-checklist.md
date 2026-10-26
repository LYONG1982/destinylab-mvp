# 发布检查与部署交接

状态：开发预发布；未提供真实 AppID，不可直接提审或视为生产上线。

## 产物

- 小程序开发包：`miniapp/dist/`，仅可用于开发导入检查；游客 AppID，API 地址由构建环境决定。
- 发布候选构建：在受保护环境设置 `TARO_APP_ID`、`TARO_APP_API_ORIGIN`（公网 HTTPS 根地址）、`TARO_APP_PRIVACY_OWNER`、`TARO_APP_PRIVACY_CONTACT`，运行 `npm run build:release --prefix miniapp`。输出 `miniapp/release/`，含独立 `project.config.json` 和 `miniprogram/`。不修改源工程游客配置，不包含 AppSecret。
- 统一应用：现有 Dockerfile runner 提供 API、H5、运营、机构、大屏。migration target 执行至 013 的迁移；数据库独立持久化。小程序依赖不进入应用容器。
- GitHub Actions 仅手动触发，不自动部署；私有仓库执行前先核对免费额度，继续零新增费用。

## 部署顺序

1. 备份现有数据库和受保护配置，在独立恢复库演练增量迁移。保留全部旧表/记录。
2. 构建目标架构的镜像：`docker build --platform linux/amd64 --target runner -t <应用标签> .`；迁移镜像使用 `--target migration`。本机 arm64 验证不能替代 amd64 验证。
3. 显式迁移 001–013；不清空已有库。012 原码回填 encounter，保留原 scene。新身份会话使旧 mini 会话需要重新登录，旧参与记录保留。
4. 启动新 API，确认 `/api/health/ready` 返回 200。mini readiness 检查新增表和 entry_type，registration 检查 birth_date。
5. 配置服务端 AppID/AppSecret、实际 HTTPS、可信代理来源头和微信合法域名；AppSecret 不进入前端、镜像层或 GitHub。
6. 上传对应微信版本；分别从运营后台生成报名码、现场互动码。先真实体验版验收，再按授权提审/发布。
7. H5/后台/机构/大屏与两手机分别验收，记录服务端版本和小程序版本。

应用回退只切换经过兼容验证的旧应用镜像，数据库新增结构保留；新会话表不由旧版本识别。需要数据库恢复时在独立恢复库演练并另行安排，不执行 `down -v` 或删表。

## 发布前必须完成

- 真实账号、主体/服务类目、备案准备及开发者权限。
- 真实隐私主体、联系方式、保存期限与平台指引，照片接口授权拒绝场景。
- 公开昵称与头像的平台检测接口和安全回调代码已接入；真实账号联调与运营处理仍待完成，见 10-content-security.md，不以测试桩替代。
- 微信登录、两类小程序码、双真机与移动网络验收。
- 小程序依赖告警的兼容修复与风险复核，尤其 Taro 传递工具链；不得使用 `audit fix --force` 强行回退 Taro。

当前扫码参数只含不透明 scene 或活动标识，六位凭证不作为登录凭据。真实姓名、手机号、生日及令牌不放进分享内容。历史 H5 资料跨端认领不按未核验手机号自动完成。
