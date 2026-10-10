# 腾讯云公网演练运行说明

2026-10-10。实施依据：`plans/active/2026-10-10-腾讯云默认域名公网测试部署.md`。

## 状态与边界

部署适配已实施，云端尚未发布。现有上海 CloudBase 共享 PostgreSQL 无内网直连地址，外网开启和证书下载不可用，SQL 角色没有 CREATEDB/CREATEROLE 权限；当前无法据此提供两个独立库和受校验的 pg 直连。现有业务资源不作为遇见数据源。云托管尚未启用，启用涉及服务条款及付费模式确认。不得将 HTTP SQL 查询成功视作容器协议直连通过。

三个端点必须由同一个服务提供，统一 HTTPS origin，同一个活动、同一个 PostgreSQL。GitHub 仅存私有源码，不使用 GitHub Pages 分离前端。默认域名由新服务实际分配后填写，不发布占位域名或二维码。

## 构建与配置

在工程目录执行（云端目标使用 linux/amd64；本机镜像的架构应另行记录）：

```sh
docker build --platform linux/amd64 --target runner -t destinylab-uat:VERSION .
docker build --platform linux/amd64 --target migration -t destinylab-migrate:VERSION .
```

镜像不包含 .env、数据库备份或测试输出；运行时通过平台受保护变量注入。运行镜像使用 node 非特权用户，监听 0.0.0.0:8080，PORT 可由平台指定。必要变量见 `.env.example`。公网入口必须 HTTPS；`DESTINY_DATABASE_SSL=verify-full`；连接池建议先 6，允许 1–12；私有 CA 通过只读文件挂载并设置 `DESTINY_DATABASE_CA_FILE`，不能设置 rejectUnauthorized=false，也不能通过 DATABASE_URL 中 sslmode 覆盖明确 TLS 配置。

初始化与应用启动分开。管理员先建立独立数据库及迁移账号；`DESTINY_INIT_DATABASE` 必须准确等于配置中数据库名，再用 migration 目标单独执行。初始化只增量建表和创建零业务活动，已有活动保持不变。初始化不创建参与者、不导入 Mock，也不设置历史次数。业务账号仅授予本库本 schema 必要的表 SELECT/INSERT/UPDATE/DELETE 和序列权限；不授予 CREATEDB/CREATEROLE，不授予其他业务库连接及对象权限。云资源就绪后实际核验权限，而非仅依赖配置说明。

## 两个数据库、分阶段发布

- `destiny_cloud_test`：自动化技术演练，活动必须以 `cloudtest-` 开头；独立会话密钥、运营凭据和 32 字符以上测试令牌。
- `destiny_uat`：之后初始化的空白真人库，活动 `meet`；独立会话密钥、运营凭据；必须移除 `DESTINY_CLOUD_TEST_TOKEN`，自动化不得创建参与者。

`GET /api/health/live` 只检查进程响应。`GET /api/health/ready` 检查数据库和配置的活动可读，仅返回 ok。测试环境收到正确测试令牌后，返回 origin、**实际 current_database()**、活动的 HMAC 绑定；不公开库名、连接串、令牌。测试器在任何登录或参与写操作之前验证该绑定，防止本地配置写着测试库而远端误连真人库。令牌只通过请求头传递，不放在 URL 或日志。

## 自动化演练

将配置和运营登录 JSON 保存到仓库外 0700 目录、0600 文件，设置 `DESTINY_CLOUD_TEST_ORIGIN`、`DESTINY_PUBLIC_URL` 为完全一致的根 origin，配置真实测试 DATABASE_URL、活动、令牌，以及 `DESTINY_CLOUD_TEST_LOGIN`、`DESTINY_CLOUD_TEST_OUTPUT` 受保护路径。测试前必须确认活动为空。已有测试记录不自动清空，应新建隔离演练活动并同步服务配置。

```sh
DESTINY_CLOUD_TEST_ENV=/protected/cloud-test.env npx playwright test --config playwright.cloud.config.ts
```

脚本保持 20 个独立浏览器上下文和手机页面打开，先 10 后 20；前 4 个完成 UI 资料和十题，其他通过正常会话/命令接口答题；两组配对用命令 API 完成状态旅程，后台和大屏持续核对。覆盖重复确认、点位不足、鉴权拒绝、展示许可与撤回、刷新身份和大屏断网恢复。二维码回读不等于实体手机摄像头扫码。测试数据只存在独立库，单元测试里的 seed 不进入服务数据库。

结果文件中记录实际身份数、0 台真机、两档并发答题用时和 12 次同步延迟。观察 P95 ≤2 秒，超出时报告实测值并调查，不以小样本推断生产 SLA。云端还需 30–60 分钟演练、冷启动、约 25 秒 SSE 轮换、默认域名中间页和移动网络；本机测试不能替代这些检查。

容器重启后使用受保护的 restart-session.json 只读查询，检查 actor、revision、人数和相遇数保持；备份使用 pg_dump，将备份在新的隔离恢复库 pg_restore，核对计数及状态摘要，不覆盖原库。

## 真人验收和交付

切换独立空库后，只读核对参与者、答案、邀请、相遇、点位、商户、参与会话皆为零，再交付 `/mobile/01-start?activity=meet`、`/admin/dashboard?activity=meet`、`/screen?activity=meet`。不使用 `/screen/demo`。至少两台真机，其中一台移动网络；人工完成完整旅程。没有真实设备证据时明确标注待验收。

## 费用与停止

当前环境属于资源点计费。2026-10-10 官方报价：CPU 55 点/核时、内存 32 点/GB 时、1000 点=1 元；0.5 核/1GB 的纯计算参考约 0.0595 元/小时，**不含数据库、出网、构建、日志与存储**。不是完整部署报价，也不是支出上限。现有余额 0 元，不能据已有个人版推断新资源免费。数据库方案与预算确认前不启用新收费资源，不升级旧业务共享集群。停止应用不等于停止数据库/存储计费，不删除数据或备份。

来源：[资源点计费](https://cloud.tencent.com/document/product/876/127357)、[CPU 规格](https://docs.cloudbase.net/run/deploy/configuring/resources/cpu-limits)、[默认域名限制](https://docs.cloudbase.net/service/alias)。
