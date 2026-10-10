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

所有接口位于 `/api/live/*?activity=<slug>&audience=<participant|operator|screen>`，响应禁止缓存。

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

没有配置商户时不推荐虚构商户。本轮不新增真实商户录入流程；同舟真实资料收集与机构后台在共享模式均关闭。

## 隔离自动验证

`playwright.live.config.ts` 强制要求 URL 为 `http://127.0.0.1:3212`、数据库名称以 `_test` 结尾；每组测试新建独立活动，绝不清理/写入验收库。用受保护测试文件运行：

```sh
DESTINY_LIVE_TEST_ENV=/受保护目录/test.env \
DESTINY_LIVE_TEST_LOGIN=/受保护目录/test-login.json \
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
