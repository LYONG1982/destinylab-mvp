# 遇见 · 缘分实验室 UAT 部署交付

版本：uat-20261011-192336。目标：Linux x86_64 / amd64，Docker Engine 与 Docker Compose v2。
这是包含最新同舟后台和会员主页 V1.1 的 UAT 候选包，不代表正式上线或微信小程序发布完成。

## 包内内容

- images/application.tar.gz：统一应用镜像，包含后端 API、手机 Web、大屏、运营后台、同舟后台及公开主页。
- images/migration.tar.gz：一次性数据库迁移镜像，启动应用不会自动执行迁移。
- compose.yaml：连接外部 PostgreSQL 的应用运行定义，默认仅在服务器回环地址暴露 8080。
- runtime.env.example、tools/configure.mjs：配置模板与首次安装随机凭据生成工具。
- database/：001–006 数据库迁移源文件。
- source.tar.gz：本次构建使用的源码快照，包括 miniapp 源码和共享 src；不含依赖目录或秘密。
- miniapp-check.zip：可导入微信开发者工具的检查产物，无实际 API 地址和正式 AppID。
- release.json、SOURCE_SHA256.json、SHA256SUMS：版本、源码及交付文件校验。
- verification/：本次验证结果与已知限制。

## 部署前准备

1. Linux amd64 主机、Docker 与 Compose v2。ARM 服务器需另行构建，不建议直接使用仿真承担现场业务。
2. 已创建的独立 PostgreSQL 数据库；本轮兼容性验证使用 PostgreSQL 17.11。应用容器应能访问数据库；公网模式要求 verify-full TLS 和可信数据库证书。不能直接复制本机 127.0.0.1 数据库地址到容器。
3. 目标 HTTPS 域名及反向代理。服务器代理可转发到 127.0.0.1:8080；若代理也运行在容器内，应按目标环境配置容器网络，容器内 localhost 不指向宿主机。
4. 数据库迁移账号需具有本库建表及增量变更权限；日常应用账号使用本库所需读写权限。若分开账号，迁移时通过受保护迁移配置覆盖数据库连接，并为应用账号授予本次新增表/序列的权限。
5. 本包不含数据库镜像、数据库业务备份、TLS 证书、云资源或真实账号密码；不附带 UAT 样例及用户照片。镜像可直接导入，独立数据库和 HTTPS 入口由部署方准备。

## 首次安装

解压交付归档并进入本目录。先校验，再导入：

```sh
sha256sum -c SHA256SUMS
docker load -i images/application.tar.gz
docker load -i images/migration.tar.gz
```

仅首次安装生成凭据。现有部署升级应保留原配置，不重新生成会话密钥：

```sh
docker run --rm --user "$(id -u):$(id -g)" --entrypoint node   -v "$PWD:/delivery" -w /delivery   destinylab-uat:uat-20261011-192336 tools/configure.mjs
chmod 600 runtime.env initial-access.txt
```

工具拒绝覆盖已有配置；初始账号保存在 initial-access.txt，不会在终端输出密码。请仅通过受保护渠道交接，切勿将生成后的文件加入源码或重新分发的交付包。

编辑 runtime.env：

- DATABASE_URL：真实 PostgreSQL 连接，用户名/密码包含保留字符时须 URL 编码。
- DESTINY_PUBLIC_URL：实际 HTTPS 根地址，不含页面路径、查询参数或活动参数。它决定接口源校验及分享链接，必须与用户访问入口一致。
- DESTINY_DATABASE_SSL=verify-full；私有 CA 可放入 secrets/ 并配置 DESTINY_DATABASE_CA_FILE=/run/secrets/文件名，保证容器 node 用户可读。
- DESTINY_ACTIVITY_ID=meet，或部署方明确指定的活动标识。
- DESTINY_TONGZHOU_ENABLED=true、DESTINY_AVATARS_ENABLED=true，启用当前交付功能。
- DESTINY_MINI_ENABLED=false，未具备正式微信配置前保持关闭。
- DESTINY_ALLOW_LAN_HTTP=false；不要将本机 LAN HTTP 配置直接套用到此云端镜像。
- 密码哈希使用单引号包裹，防止 Compose 将 scrypt 中的美元符号解释为变量；不要移除引号或把本配置直接当作 Docker --env-file 文件使用。

执行一次迁移，YOUR_DATABASE 必须替换为 DATABASE_URL 实际指定的数据库名：

```sh
docker compose --profile tools run --rm   -e DESTINY_INIT_DATABASE=YOUR_DATABASE migrate
docker compose up -d app
curl --fail http://127.0.0.1:8080/api/health/ready
```

迁移包含全部六组建表操作；已有活动不会被空活动覆盖。首次安装没有参与者、答案、相遇、婚恋资料和照片，运营需自行建立真实相遇点。

## HTTPS 代理与验收

反向代理保留 Host、正确传递请求协议；SSE 路径 /api/live/ 的响应关闭代理缓冲和缓存，读取超时应长于连接轮换周期，例如 60 秒。照片上传限制应结合应用校验配置，不额外启用代理缓存私有图片。

按实际域名检查：

- /api/health/live、/api/health/ready：均正常。
- /mobile/01-start?activity=meet：手机入口。
- /screen?activity=meet：实际大屏，不能用 /screen/demo 代替。
- /admin/dashboard?activity=meet：运营登录。
- /agency/tongzhou?activity=meet：机构登录。
- 机构填写备注、相册、公开字段、预览与发布；发布链接 /tongzhou/p/唯一标识 可匿名打开，姓名与电话不展示。
- 至少两部真实手机走答题和相遇流程，确认手机、大屏、后台一致；至少一部通过移动网络，微信内访问另行验收。

## 微信小程序

本包的 miniapp-check.zip 仅用于导入检查，touristappid 且 API 地址为空，登录按设计不可用。不能直接上传为可用体验版。

解开 source.tar.gz 后，保留 miniapp 与 src 的相邻关系；小程序构建依赖共享领域源码。配置实际 AppID、主体和类目后，在 miniapp 目录执行：

```sh
npm ci
TARO_APP_API_ORIGIN=https://YOUR_DOMAIN TARO_APP_ACTIVITY_ID=meet npm run build:weapp
npm run typecheck
```

通过微信开发者工具导入 miniapp 目录；在服务端受保护配置中设置 AppID/AppSecret 与相关开关，在微信账号后台核对实际请求、上传、下载域名。真实微信登录、活动码、隐私配置及真机验收通过后，再按审批流程上传发布。AppSecret 不进入客户端或源码包。

## 升级、备份和回退

- 升级前备份完整 PostgreSQL 数据库，照片也在库内；保存旧镜像标签、原 runtime.env 与证书。恢复演练在另一独立数据库执行，禁止覆盖现有 UAT 验证恢复。
- 导入新镜像、核对迁移兼容性、执行必要增量迁移，再启动新应用并验收。
- 本包迁移应先在备份恢复库演练。应用回退仅切换经兼容性验证的旧镜像；数据库保留，不删表、不清库。恢复备份属于另行安排的数据恢复操作。
- 同舟编辑草稿不会直接覆盖公开页面，需再次发布；分享域名变化后须检查生成链接和二维码。
- 不使用 docker compose down -v 作为普通升级或回退步骤。

## 已知边界

- 自定义照片仍需单独上屏许可，同舟撤回授权入口仍在；本包没有顺便修改这些业务规则。
- 最新会员主页已包含照片柔焦背景、独立相册、字体与响应式排版，真实姓名/电话/内部编号不在展示页面出现。
- 尚未完成真实微信登录、正式小程序提审、Safari 原生完整验收、目标云环境压力与现场验收。
- 本地容器验证不是公网 HTTPS、移动网络或生产容量承诺。
- 打包依据是包含未提交改动的工作区快照，release.json 与 SOURCE_SHA256.json 标识本次源码；单独拉取旧 Git HEAD 无法重建此版本。

实际交付目录：/Users/lvyong198201/Desktop/Game 2026/部署交付/DestinyLab-uat-20261011-192336-amd64
