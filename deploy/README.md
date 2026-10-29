> 本次活动管理更新需要迁移 **015**，部署前备份，详见 [现场管理交接](../docs/weapp/14-field-management.md)。以下历史 rc.1 包不能直接提供此功能。

2026-10-29双端自动呈现增量：需要从本次提交重建H5统一应用，并让旧页面刷新取得新资源；不需要新增DDL、重置活动或重新分配已经生成的码。它补齐发起方自动进入指引，保留全部点位/码/物理占用规则。详见 [本轮交付与验收](../docs/weapp/24-auto-guide-after-mutual-confirmation.md)。源码推送不会自动升级线上。

## 2026-10-27 当前源码交付

请使用 `codex/weapp-release-20261013` 的本次源码重新构建H5/API；当前个人相遇、相遇点增删和默认30对规则及工程师交接见 [本次源码交付](../docs/releases/2026-10-27-personal-encounter-source.md)。源码推送不自动部署或修改线上活动。

当前新流程取消出发/到达确认，本人记录即进入个人下一站，配对统计仍在双方记录后计一次。新活动/新点默认30对、可配置1–160对；已有显式值保留，旧缺省仍按1并经后台预览确认后才应用30。软删除保留历史，未清场占用/码不会自动释放。下文旧容量上限20和旧版本镜像说明保留为历史，以本节和最新交付为准。无新DDL，微信设备/线上验收仍须另做。

## 2026-10-26 六题/520 开发候选说明

此前本地 UAT 收尾时暂缓GitHub发布；用户现已授权源码提交/推送，小程序设备验证和线上 `meet` 升级/现场验收仍未实施。下列兼容与备份说明用于部署准备，不表示已部署。当前本地入口见 [本地 UAT 指南](../docs/weapp/12-six-question-520-uat.md)。

新任务改用六题和双向确认后的个人三位520组合码。部署应同时交付H5/API和新小程序；旧客户端创建新相遇会收到更新提示，旧四位码任务可继续。不得仅部署前端或把旧客户端当作新协议验收。

新活动默认30点，既有活动通过下面受保护点位补齐脚本增量补齐Meet01–Meet30，并立即处理等待配对；保留已停用/占用/自定义位置。先核对实际场地、目标数据库和活动，备份后执行，不自动在启动时改历史数据。JSON增量字段无新增DDL；旧单占用读取兼容，新多容量/520任务产生后禁止直接回退只支持旧结构的版本。回退前先处置活跃任务并保留备份。

后台可维护现场位置和容量，新活动/新点默认30对、范围1–160对；旧显式容量保持，旧缺省需显式应用。归档未清场的码需保留至确认空闲；不要批量清空占用。默认双人关系上屏规则替代旧授权开关，主大屏不显示入口二维码。

可信代理配置仍须由代理覆盖来源IP头；新增 `DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE` 缺省300，允许1..600，不改变全局/活动额度和微信code单次使用规则。只对版本化公共WebP资源长期缓存，私有照片和API继续no-store。


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
