# 工程师部署手册 — weapp-v1.4.0-rc.1

> 最新源码已增加双入口统一档案与迁移 014，见 [统一档案增量说明](../docs/weapp/13-unified-agency.md)。以下 rc.1 镜像结果仍对应历史发布包，本轮未替换该包。

> 数据库连接变更提示：本手册的 rc.1 镜像仍按该历史包配置运行。当前源码已改为由 `DATABASE_URL` 和 PostgreSQL 驱动默认行为决定连接方式，必须用当前源码重建镜像后才适用；不要把新配置要求误用于 rc.1 旧镜像。

这是开发候选版，不是已完成微信提审的正式版。发布包不含数据库和运行凭据。目标镜像为 **linux/amd64**；Mac 本地通过 Docker amd64 仿真验证，部署到其他架构须重新构建和验收。

## 交付与准备

- `destinylab-weapp-1.4.0-rc.1-amd64.tar.gz`：应用和迁移两个镜像。
- `destinylab-weapp-deploy-1.4.0-rc.1.zip`：本手册、compose、Nginx 示例、环境模板、SQL、测试摘要。
- `destinylab-miniapp-development-1.4.0-rc.1.zip`：游客开发产物，API 地址为空；只供结构/编译检查，不能扫码登录或直接提审。
- GitHub 标签源代码：用于重新构建；SHA256SUMS 校验附加文件，image-metadata.json 记录镜像 ID/架构。

核验宿主机架构、磁盘、现有监听端口和受管理 PostgreSQL 17 连接，先准备实际 HTTPS 与证书。公网后端要求数据库 `verify-full`，数据库 CA 按需只读挂载；数据库端口不向公众开放。延续零新增费用，本手册不授权采购资源。

## 备份与迁移

1. 备份数据库为 pg_dump 自定义格式、现有应用镜像和受保护环境文件，并在独立恢复库做恢复演练。
2. 校验下载文件后导入镜像：

```sh
shasum -a 256 -c SHA256SUMS
# Linux 也可使用 sha256sum -c SHA256SUMS
gzip -dc destinylab-weapp-1.4.0-rc.1-amd64.tar.gz | docker load
```

3. 复制 runtime.env.example 到 `/etc/destinylab/runtime.env`，目录 0700、文件 0600；在受保护渠道填入配置，不把明文凭据放入命令行、Git 或工单。
4. `DESTINY_INIT_DATABASE` 必须明确等于本次目标数据库名，只对本次迁移环境设置。执行：

```sh
docker run --rm --env-file /etc/destinylab/runtime.env   destinylab:weapp-1.4.0-rc.1-migration-amd64
```

该命令执行 001–013 的兼容增量，以及六位凭证回填；保留已有数据及活动。012 将旧小程序码归为 encounter，旧 mini 会话需要重新登录。013 新建审核记录。迁移成功后移除运行文件里的 DESTINY_INIT_DATABASE。

新建活动默认 Meet01–Meet20。已有活动补齐编号需要单独运行迁移镜像中的 `scripts/migrate-meet-points.ts`：受保护配置设置 `DESTINY_MIGRATE_DATABASE`、`DESTINY_ACTIVITY_ID`、`DESTINY_BACKUP_DIR=/backups`，把宿主机备份目录以 UID 1000 可写权限挂载到 `/backups`；覆盖命令为 `node --conditions=react-server --import tsx scripts/migrate-meet-points.ts`。脚本先写活动状态备份再补齐缺失编号，保留旧地点、地址、占用状态；不要删库重建。

## 启动应用

- 在运行文件设置 server 模式、活动、会话密钥、PostgreSQL URL、独立运营/机构账号及 scrypt 密码哈希。哈希格式为 `scrypt$16字节随机盐的hex$64字节scrypt结果的hex`，不使用示例或测试凭据。
- 按需要启用 REGISTRATION/TONGZHOU/AVATARS/MEMBER_WALL；实际微信配置未齐时保持 `DESTINY_MINI_ENABLED=false`。
- `DESTINY_PUBLIC_URL` 是实际 HTTPS 根地址。可信代理头建议 `DESTINY_TRUSTED_CLIENT_IP_HEADER=x-real-ip`，只由 Nginx 覆盖该头；外网不能绕过代理访问 8080。
- compose 默认只绑定 127.0.0.1:8080，非 root、只读根目录、临时缓存。已有服务占用时先改端口及反代，不能盲目停止其他项目。

```sh
DESTINY_ENV_FILE=/etc/destinylab/runtime.env docker compose -f compose.yaml up -d
curl --fail http://127.0.0.1:8080/api/health/ready
```

将 nginx.conf.example 合并到受管理的 Nginx 配置，替换域名和证书。访问日志不记录 query、Cookie、Authorization，避免审核下载短期令牌进入日志。SSE 关闭代理缓冲。不要把真实照片放入静态 public 目录。

## 微信配置与发布前验收

1. 服务端配置真实 AppID/AppSecret、试用版本参数和内容审核回调 TOKEN/AES KEY；消息推送使用 `/api/wechat/content/callback`，安全模式 JSON。详见 docs/weapp/10-content-security.md。
2. 配置实际 request、uploadFile、downloadFile 合法域名及隐私主体信息。AppSecret 只在服务端。
3. 用源码运行 `npm ci` 和 `npm ci --prefix miniapp`，设定 TARO_APP_ID/API_ORIGIN/ACTIVITY_ID/PRIVACY_OWNER/PRIVACY_CONTACT，运行 `npm run build:release --prefix miniapp`，导入 `miniapp/release`。
4. 上传体验版后由运营生成两类码；分别验证报名、凭证、四站保存/修改/失败重试、签到入场、十题、双方邀请见面、后台/大屏、照片授权拒绝、审核等待/拒绝、微信分享和冷/热扫码。
5. iOS、Android、Wi-Fi、移动网络分别留证。未完成前不得标记正式上线，实际提审和正式发布另行安排。

## 回退与验收证据

变更前保留旧镜像，切换 `DESTINY_IMAGE` 至经过恢复库兼容演练的旧镜像，保留新增数据库结构和原配置备份。不得执行 `down -v`、删除业务表、回填旧库覆盖新数据。若需数据库时间点恢复，应另行安排维护窗口，在独立恢复库验证后切换。

本地证据汇总见 docs/weapp/08-implementation-status.md。原 UAT 和测试库分离；本包没有真实人员、登录凭据或数据库备份。小程序工具链保留 21 条已列明告警，限制为本地可信 weapp 编译用途，详见 11-dependency-review.md。
