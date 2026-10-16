# 三端共享服务运行说明

更新：2026-10-10。当前阶段为局域网真实数据验收；公共互联网、移动网络和微信真机尚未部署验收。

## 实际实例

源码根目录：`/Users/lvyong198201/Desktop/Game 2026/DestinyLab-MVP`。

| 项目 | 当前配置 |
| --- | --- |
| 三端共同地址 | `http://192.168.43.70:3213`，活动 `meet` |
| 手机 | `/mobile/01-start?activity=meet` |
| 运营 | `/admin/dashboard?activity=meet` |
| 大屏 | `/screen?activity=meet` |
| 应用监听 | `0.0.0.0:3213`，Next.js production 运行模式 |
| 独立构建 | `.next-live`，不覆盖原 `.next` 或停止 3210/3211 |
| PostgreSQL | 容器 `destinylab-live-20261010`，PostgreSQL 17.11；仅本机映射 `127.0.0.1:55464` |
| 数据持久化 | Docker 卷 `destinylab-live-20261010` |
| 真人验收库 | `destiny_acceptance`，零业务数据初始化，不导入 seed |
| 自动化测试库 | `destiny_test`，独立数据库，测试运行端口 3212 |
| 受保护配置 | `/Users/lvyong198201/.config/destinylab/2026-10-10/acceptance.env` |
| 运营凭据交接 | 同目录 `acceptance-login.json`；文件 0600，目录 0700，勿复制进代码或普通文档 |
| 本轮运行记录 | 同目录 `service.json`、`service.log`；PID 以运行记录及监听端口核对 |

电脑与手机连接同一网络并保持电脑联网、唤醒。电脑请求自己的 LAN IP 已通过；实体手机是否被 Wi-Fi 客户端隔离或系统防火墙阻挡，仍需真机测试。不要将手机地址改成 localhost。换网络导致 IP 变化时，更新受保护文件中的 `DESTINY_PUBLIC_URL` 并重启本实例，重新解码 QR 核对。不得自动关闭防火墙。

## 初始化、构建、启动

在实际工程目录执行。需 Node.js 22.22.1 和可连接的 PostgreSQL；先安装锁定依赖。配置字段见根目录 `.env.example`，其中凭据都是占位符。受保护运行文件不纳入 Git。

```sh
npm ci
npm run live -- init --env-file /受保护目录/acceptance.env
npm run live -- build --env-file /受保护目录/acceptance.env
npm run live -- start --env-file /受保护目录/acceptance.env --port 3213
```

`init` 只增量创建表/必要列和不存在的空活动；已存在活动不会重置。`build` 和 `start` 使用 `.next-live`。构建前先停止本轮实例，不能对正在服务的 `.next-live` 原地覆盖；原 3210/3211 不在本轮停止范围。重启电脑后 Docker 及本实例需重新启动，本轮未注册开机启动。

`DESTINY_DATA_MODE=server` 为共享模式；未设置时继续原本地 Mock。`DESTINY_ACTIVITY_ID` 是默认活动 slug；入口中的 activity 在手机导航间保留。`DESTINY_PUBLIC_URL` 必须是 origin（不带路径/查询/凭据）。公网必须 HTTPS；仅 localhost 或显式 `DESTINY_ALLOW_LAN_HTTP=true` 的私网 IPv4 允许 HTTP。移动网络无法访问当前私网地址。

运营密码配置为 `scrypt$盐十六进制$64字节哈希十六进制`，盐为 16 字节。服务端只存配置哈希；当前随机密码单独放在受保护凭据文件。数据库连接串、会话密钥、Cookie、密码和哈希不写入二维码、Git、普通日志或验证材料。

## 三端权限与接口

原活动接口位于 `/api/live/*?activity=<slug>&audience=<participant|operator|screen>`，新增同舟与头像接口见文末；响应禁止缓存。

| 方法与路径 | 行为 |
| --- | --- |
| POST session | 空 JSON 建立/恢复手机 HttpOnly 会话；不能指定 actor |
| POST login | username/password 登录，单独的运营 Cookie |
| POST logout | 撤销当前会话并清除对应 Cookie |
| GET snapshot | 手机本人及必要匹配数据；运营业务快照；公共屏 WorldData |
| GET events | SSE 仅发送持久 revision，客户端再取自己权限的快照 |
| POST command | `{command, epoch}` 与 Idempotency-Key；角色允许列表、状态校验、事务与持久幂等账本 |

POST 要求配置 origin 与 JSON，最多 16KiB。手机身份来自服务端会话，不读取 URL actor；运营命令只对运营会话开放。公共屏无运营状态、相遇码、原始业务 ID 或十题私密答案。活动昵称、系统头像、第一题选择属于产品明示的公开展示内容。具体配对要求双方单独许可，结束当前任务后也可以撤回。

活动行事务锁保证命令、状态、事件版本同一提交；同幂等键重复相同内容不会再计数，不同内容拒绝。命令账本留存经验证 payload 与提交时间供审计。第一题改选只移动选项归属，不增加答题人数。

SSE 每 750ms 查询数据库版本，约 25 秒主动轮换；重连、前台恢复和可见页面兜底快照校准最终状态。公共动画仅补最近 10 秒、最多 64 条事件，旧动画丢弃；事实不丢失且不由动画累加。邀请到期由服务端读快照或业务命令时检查并事务化过期；本版没有额外常驻 worker，在无人访问期间不写空转任务，重新访问仍会校准到期状态。

## 真人验收

1. 运营登录，在“题目统计与相遇点配置”添加现场已放置的 `Meet01` 等编号。没有点位时接受邀请后正常等候，不自动生成虚构点位。
2. 大屏打开 `/screen`；两部独立手机扫码。电脑后台与大屏不能使用 `/screen/demo` 或旧 3210/3211 作为本轮业务验收。
3. 两位参与者完成资料及十题且主动准备见面，依次邀请/接受/赴约/确认，核对后台和屏幕。单方确认不加次数，双方只加一次。
4. 分别允许具体配对公开展示，再撤回一方许可；继续探索后也可管理旧许可。私密下一步选择只返回本人。
5. 真机刷新、断网重连、服务重启按 [验收记录](verification/live-linkage/2026-10-10-validation.md) 的未验收项补记。不要清库来重复测试。

没有配置商户时不推荐虚构商户。本轮不新增真实商户录入流程；同舟真实服务自 2026-10-11 起可通过独立配置启用，默认关闭。

## 隔离自动验证

`playwright.live.config.ts` 强制要求 URL 为 `http://127.0.0.1:3212`、数据库名称以 `_test` 结尾；每组测试新建独立活动，绝不清理/写入验收库。用受保护测试文件运行：

```sh
DESTINY_LIVE_TEST_ENV=/受保护目录/test.env \
DESTINY_LIVE_TEST_LOGIN=/受保护目录/test-login.json \
DESTINY_AGENCY_TEST_LOGIN=/受保护目录/agency-login.json \
node node_modules/@playwright/test/cli.js test --config playwright.live.config.ts
```

测试配置需要单独测试服务已启动，测试凭据不是验收运营密码。测试禁用包含凭据的 trace，截图只用于失败业务状态。独立浏览器验证不等同实体手机。

## 备份与停止

备份只写受保护目录，例如本地容器：

```sh
umask 077
docker exec destinylab-live-20261010 pg_dump -U destiny -d destiny_acceptance -Fc > /受保护目录/acceptance-日期.dump
```

备份应随真实使用定期执行并另做恢复演练；本轮仅保存空白初始化备份。停止应用时核对 `service.json` 的 PID、命令和端口后，仅终止本实例。停止容器可用 `docker stop destinylab-live-20261010`，会同时停止本轮独立测试库与验收库；不执行删除卷或整库重置。原有其他项目数据库与容器不在操作范围。

公网部署仍需确定托管目标、域名、TLS、数据库备份/保留周期、SSE 代理禁用缓冲及容量目标；获得相应环境授权并用真实移动网络验证后，才能标记公网联动完成。

## 2026-10-11 · 私有服务启用与回退

先备份目标数据库，运行既有 `live init` 显式初始化流程（现在依序执行 001、002 兼容迁移）；不能以启动应用替代迁移。配置独立 `DESTINY_AGENCY_USERNAME` 和 `DESTINY_AGENCY_PASSWORD_HASH`（同现有 scrypt 格式，机构密码不可复用运营密码）。随后按需设置 `DESTINY_TONGZHOU_ENABLED=true`、`DESTINY_AVATARS_ENABLED=true` 并重启；两项缺省关闭。`/api/health/ready` 检查启用能力所需表及机构账号配置，不回显配置内容。

| 接口 | 用途 |
| --- | --- |
| POST /api/tongzhou/command?activity=… | 手机会话提交／修改／撤回／删除，JSON {epoch,command}，Idempotency-Key |
| POST /api/tongzhou/login 或 logout?activity=… | 独立机构登录／退出，独立 HttpOnly Cookie，8 小时会话 |
| GET /api/tongzhou/records?activity=…&q=…&page=… | 机构有效资料名单，每页 20 条，手机号脱敏 |
| GET /api/tongzhou/records?activity=…&id=… | 同机构同活动的有效授权详情 |
| POST /api/avatar/upload?activity=… | 手机会话上传 JPG／PNG／WebP 二进制，最多 10 MiB，返回暂存资产编号 |
| POST /api/avatar/command?activity=… | 手机会话绑定／更换／移除照片及照片上屏许可，版本与幂等校验 |
| GET /api/avatar/UUID | 按本人、推荐/相遇范围或运营身份读取照片；不接受机构会话替代活动权限 |
| GET /api/avatar/UUID?screen=1 | 当前允许上屏且在场、资料完整的照片，撤回即停止提供 |

原图不存储；WebP 小图保存在相同 PostgreSQL，新增依赖 sharp。图片与私有字段不进入通用命令正文、SSE、大屏快照或 URL。手机本人可获得自己的填报；机构只能查看有效授权记录。普通运营不可读取同舟表单，机构不会自动收到活动照片或十题答案。

业务删除清除在线记录内容与已替换图片，已有备份按受保护备份周期管理；恢复时须保留撤回／删除状态，不能以旧备份重新开放失效授权。未提交照片 24 小时后拒绝访问，并在后续上传时清理；单用户暂存资产数量有上限。服务并未承诺已被看过的照片可以从观看者设备中收回。

回退时关闭对应开关并重启；保留新表及用户资料，不执行 DROP 或清库。上传入口仅共享模式提供；Mock 继续使用原系统头像与虚构填报，不导入真实服务。公网部署、真实经营信息、渠道可用性和 iOS／Android／微信相册行为需单独验收。


## 2026-10-11 小程序实施与 Mac UAT 增量

小程序接口位于 /api/mini，使用 Authorization Bearer；微信密钥只在后端。DESTINY_MINI_ENABLED 启用时健康检查验证账号配置格式及 5 张增量表。公网启用前必须配置 DESTINY_TRUSTED_CLIENT_IP_HEADER；可信入口须覆盖为单一真实 IP，不能透传用户 Header，且禁止绕过代理直接连接容器。此部署约束尚未云端验证。迁移脚本已包含 003；数据库及秘密不进入镜像。 详细步骤、证据与限制见 [MINI_UAT.md](MINI_UAT.md)。


## 2026-10-11 同舟机构跟进与发布

增量迁移 004 新增 dl_agency_profiles、dl_agency_actions。机构身份可读取 records/photo 并执行 manage（save/preview/publish/unpublish），均经现有机构会话与写 Origin 校验。公开宣传页 /tongzhou/p/[slug] 与 /api/tongzhou-public/[slug] 只读取有效发布快照，照片副本独立存储，响应禁缓存且不索引。发布同时校验跟进版本、原填报版本、预览照片 ID 和公开许可确认；原填报撤回/删除在同一事务清除发布快照/照片。LAN 当前构建与操作说明见 MINI_UAT.md。
