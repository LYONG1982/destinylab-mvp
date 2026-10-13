# 遇见-缘分实验室 · V1.0 数据模型、状态与适配边界

## 2026-10-12 更新：正面年龄段（当前）

PublicMemberCard新增ageRange:string|null，源于Participant.age，仅允许AGES中的22–25/26–29/30–33/34–37/38+，其他输入归null。客户端安全检查拒绝非法值。WALL_CONSENT_VERSION升级member-wall-2026-10-12-v4，复用既有版本列，无DDL。encounterCode保留后端/运营兼容，仅从卡片UI移除。

## 2026-10-12 更新：背面四项答案（当前版本）

PublicMemberCard.preferences最多四项，顺序q5/q6/q8/q9；正面tags仍为q3/q5。WALL_QUESTION_IDS为q3/q5/q6/q8/q9，WALL_CONSENT_VERSION为member-wall-2026-10-12-v3。复用原consent_version与question_ids列，无DDL迁移。v2不自动升级，不公开其未同意的q6/q9。

## 2026-10-12 更新：六列分区与大字号

dl_member_wall_sessions.visible_ids 仍用原 JSONB 列，内容为固定 24 项公开 ID/null 数组，slot%6<3 属男生区，否则属女生区；capacity 固定 24。公开分配卡片新增 slot（0–23），个人预览没有分配槽位可省略。旧配置 minColumns/maxColumns 读取并保存为 6；旧容量主屏需重新领取。无数据库结构迁移，许可仍为 v2。

## 2026-10-12 更新：人数看板与男女卡片

PublicMemberCard 新增 gender（male/female），由参与者资料投影，不从 avatarUrl 推断；safeWallCard 拒绝缺失或非法性别。WallSnapshot 新增 male/female 汇总，total 仍为全部参与者；eligible 保留供调度和后台使用。许可版本为 member-wall-2026-10-12-v2，沿用现有 consent_version 列，不新增迁移。

## 2026-10-12 增量：卡牌墙专用数据

迁移 `database/007-member-wall.sql` 增加四表，不改原答案/邀请/机构资料结构：

| 表 | 关键含义 |
| --- | --- |
| dl_member_wall_consents | 活动/参与者唯一，epoch、独立公开 UUID 与遇见码、昵称、allowed、许可范围和版本、CAS 版本与授权/停止时间 |
| dl_member_wall_config | 每活动模式、轮播开关、翻面/换人间隔、比例、列数、配置版本 |
| dl_member_wall_exposure | 活动/公开 UUID 唯一，非负可见毫秒累计、最后展示时间 |
| dl_member_wall_sessions | 每活动唯一主屏租约、token 哈希、窗口、批次、分配公开 ID、序号、容量、起始/心跳/换人/过期时间 |

公开 DTO 仅包含独立公开 ID、遇见码、昵称、性别标识、静态虚拟头像地址、2 标签/3 偏好及公开有效标识。历史参与者没有许可记录即不公开；epoch 变更使原许可失效。API 不返回内部参与者 ID、真实照片或机构档案。完整字段与回退约束见 [运行说明](member-wall/OPERATIONS.md)。

## 2026-10-11 · 私有服务增量

增量迁移 `database/002-private-services.sql` 新增：

- `dl_tongzhou_submissions`：按 activity_id/actor 唯一、固定 organization_id=tongzhou，record 保存现有 TongzhouSubmission 结构（内容、版本、状态、授权）；不进入 dl_activities.state。
- `dl_agency_sessions`：独立机构令牌哈希、活动、机构与 8 小时有效期，不使用客户端 actor 或现场运营角色授权。
- `dl_private_commands`：同活动同参与者的幂等键与请求摘要，不保存表单正文或图片。事务内锁活动行，检查 epoch、记录版本、幂等键后提交；只通过公共 revision 通知刷新。
- `dl_avatar_assets`：UUID、活动、所有者、重编码 WebP bytea（最大 200 KiB）、创建时间与 attached。临时图片 24 小时后不可访问；上传时清理过期资产，并限制同参与者暂存数量。替换和删除时清除旧已绑定图片。

Participant 兼容增加 `photo?: {id,screen}|null`、`avatarVersion?: number`；保留 avatarId 作为系统备用头像。客户端只通过专用 avatar 命令提交自有资产、版本及许可，不能提交任意 URL。手机本人投影附加自己的同舟记录，其他参与者、运营和屏幕投影不包含该集合。机构列表只返回必要索引及脱敏手机；详情重新校验有效授权。

照片读取按当前目标活动的本人、活动推荐/相遇可见范围或运营会话判定；`?screen=1` 仅在当前允许上屏且资料完整、在场时公开。响应 no-store，Next 图片优化只允许静态 `/assets/**`，防止撤回后从优化缓存取回图片。图片 URL 不包含原始参与者编号。


## 2026-10-10 · PostgreSQL 权威数据与角色投影

新增 `database/001-live.sql`，可重复执行且不会替换已有活动。MVP 以每活动一个 JSONB 业务聚合复用已验证的领域命令；`dl_activities` 的行锁串行化同活动修改，`state.revision` 与表内 revision 同事务更新。该取舍已验证 100 会话基本并发，不代表无限扩容能力。

| 表 | 用途与约束 |
| --- | --- |
| dl_activities | 活动 id 主键；资料、逐人逐题当前答案、邀请、点位、帮助、展示许可；初始集合均空 |
| dl_sessions | 随机令牌的 SHA-256；活动、角色、actor、到期时间；手机 30 天，运营 8 小时 |
| dl_commands | 活动+actor+幂等键联合主键；经校验命令 payload、哈希、提交版本及时间。保留改答/选择/授权审计，不包含登录密码 |
| dl_events | 活动+版本联合主键；仅公共动画事件；与状态和命令账本一起提交 |
| dl_rate_limits | 操作桶+时间窗；入场、登录、命令频率限制 |

`displayGrants[invitationId][participantId]` 保存各自许可，公开 Pair 要求双方为 true。客户端不得提交 actor、revision、时间、计数或任意字段。个人选择仅投影给本人；全量统计和答案仅运营可见。公开 WorldData 使用活动内稳定 HMAC 化名 ID；活动昵称/头像及第一题选择仍是可关联的公开内容，不能描述为完全匿名。二维码只含活动入口。

计数：scans 为建立的参与会话数，answered 为至少答过第一题的人数，completed 为资料与十题齐全的人数，active 为未标记离场的人数，real 为真实双方确认的邀请数。网络断开不等同离场。SSE 只通知持久版本，快照恢复最终状态；过期动画不补播，不能用动画数累加业务计数。

## 2026-10-10 · ACT03 局部桃心表现

没有新增业务字段或存储迁移。桃心与火花仅使用PairSceneFrame的slot、elapsedMs、opacity和现有布局，由交汇时刻1700ms派生0–1400ms视觉状态。历史播放及TRIGGER COLLISION不改变totalMeetings；新动画资源为固定3实例及复用16点缓冲，不保存新事件。授权撤回、未知统计和匿名全局事件维持原数据语义。


## 2026-10-09 · 第三幕副标题循环（已完成）

副标题为固定文案与CSS动效，复用现有Mode/INTERSECTION DOM状态，无字段、接口、持久化、许可或统计变化。[本轮验证](verification/destiny-field-act3-subtitle/2026-10-09-validation.md)

## 2026-10-09 局部彗尾与粒子视觉补充

本次仅调整渲染常量和共享曲线几何；Participant、WorldData、Pair、公开许可、统计口径、持久化格式与API均不变。`PAIR_EFFECT`是前端渲染配置，不写入业务数据。验证记录见[本轮记录](verification/destiny-field-act3-comet/2026-10-09-validation.md)。

## 当前屏幕适配增量：ACT03 V2（2026-10-09）

仅screen层变化，无领域模型、持久化或API契约迁移。

- `MeetPair.status`支持`mutual_confirmed | meet_confirmed`；稳定id由邀请记录展示token产生。有效acceptedAt且状态ACCEPTED/MEET_ASSIGNED/ARRIVING可投影认识关系；有效realMeetAt优先投影已见面。两者均需双方pair-specific许可Provider，缺省/异常拒绝。状态升级沿用id，更新状态，不重新造Pair。
- `uniqueQualifiedPairs`先按记录id、再按成员组合去重，优先已见面和较新时间；导演按成员id做跨槽互斥。底部统计来自独立realMeetAt汇总，不等于可公开Pair数量，不因重播、重复通知而累加。
- `MeetSceneData`可带`connection`、`permissionVerified`、`statisticsKnown`、`snapshotAt`，把连接故障、许可有效性和统计可靠性分开。`failedAvatarIds`仅为开发故障夹具，不持久化。
- `PairSceneFrame`持有0..3个`PairFrame`：slot/token/elapsed/phase/layout；时钟、优先队列32条、去重512条及短历史均有界。数据与动画分离，不逐帧React state。
- 开发Mock独立内存，以0/1/2/3/10对、重复、共享用户、撤回、连接升级、断线及头像失败验证；production入口不接受Mock。没有新增WebSocket/SSE，业务仍同源只读本地快照。

当前业务没有有效公开许可采集与通知源，默认具体Pair为空。这是接口接入边界，不能把开发夹具当真实授权或真实新相遇。


当前大屏以文首ACT03 V2和仍适用的双幕布局为准；此前漂浮头像、可见密度及文案为历史实现。手机、后台和同舟相关章节保持有效。

产品展示版本 V1.0 与数据版本独立。沿用 schema=1、`destinylab:v1.1:*` 存储/锁标识及同舟授权文本版本，不迁移、不清空已存资料。`src/config/product.ts` 仅包含显示信息，不参与命令、权限或统计。

未来小程序与 Web 将通过正式服务端共享状态，当前浏览器 Mock 不作为生产数据服务。届时须将客户端可提交命令、本人私有响应、同舟授权响应与大屏公开投影拆分，不能直接向各端返回完整 DemoState；具体实现另行规划，见 `MINI_PROGRAM_ROADMAP.md`。

## 同舟填报增量（2026-10-06）

独立 `tongzhouSubmissions: TongzhouSubmission[]`，每个 participantId 一份当前记录，固定 organizationId=tongzhou，状态 active/withdrawn/deleted；version 作并发版本，submittedAt/updatedAt 及 consent.version/at 记录本人确认。fields 包括七项必填和十项选填，不写入 Participant、Invitation 或 DomainEvent。出生年份与现场年龄段独立，不反向覆盖；民族只由本人填报。

`tongzhou-submit` 要求有效本人、expectedVersion 和当版显式授权，规范化并白名单保存字段；更新保留首次有效提交时间。撤回清除有效 consent 并保留本人资料；删除同时清除 fields，只保留最小终止/版本记录。旧请求不能覆盖新版本或恢复删除内容，重新提交需要新版本与新授权。命令提前返回，不触发邀请过期/分配资源等现场副作用；命令日志只存 ID，不存填报内容。

旧 schema=1 快照缺少集合时兼容为空，不重置原数据。损坏新集合报错并保留原始快照。场景重置清除演示填报并改变 epoch。useAction 为请求提供生命周期取消信号，store 仅对同舟命令检查该信号；现有现场命令语义不变。Web Locks 内重新读取最新快照，检查 epoch、version、去重后持久化，保存失败不更新本地快照。

存储读取失败与写入失败分开处理：无法读取时停止展示私密详情并保留原始存储；无法写入时保留手机输入供重试。修复存储或重置后可恢复展示。失败重试期间保留原错误提示占位，避免连点因页面收缩误触返回。

本人视角读取自己的记录；本地同舟选择器只返回固定机构的有效授权记录。名单手机号脱敏，详情按有效授权显示；撤回时详情派生为空，重新授权的新 submittedAt 不自动重开旧详情。公开 WorldAdapter（旧ScreenAdapter同样如此）、screenProjection、推荐卡和现场运营人员页不消费此集合，不将字段写入 URL 或普通日志。此为浏览器 Mock 的展示/领域规则，完整存储仍可在本机检查，不构成正式服务端访问控制。

## 存储

`destinylab:v1.1:state` 为 localStorage 版本化演示快照。`epoch` 区分场景，`revision` 区分写入，命令使用操作者和命令 ID 去重。`destinylab:v1.1:actor` 保存在各标签页 sessionStorage，不随其他标签角色切换而改变。

同源写操作经 Web Locks 串行化，读取最新快照后执行领域命令，再持久化和 BroadcastChannel 通知。无 Web Locks 时只承诺单标签角色切换演示。快照结构损坏时保留原始值并展示重置入口；用户确认重置后恢复。种子事件遵循发出、接受、出发、到达、确认的时间顺序。存储读写失败明确报错；不调用 `localStorage.clear()`。

## 对象

- Participant：昵称、性别、nullable avatarId、年龄段、准备/在场/暂停、完整题目答案、当前关系 ID。
- Invitation：双方 ID、独立状态、发出/接受/真实见面时间、各自出发/到达/见面时间、共同答案快照、本人去向、见面卡/缘分相遇码。
- MeetPoint：相遇点、文字位置、步行距离、占用关系 ID、是否暂停。
- HelpRequest：参与者/关系、请求时间、NEW/ACK/RESOLVED、固定回执。
- Merchant：名称、类别、启停和步行时间。没有权益、核销或授权对象。
- DomainEvent：现场过程和必要操作记录，只在本地运营视角展示。
- responses/scans：首答及扫码演示事实；允许未建档匿名回答。

## 邀请状态

SENT → ACCEPTED → MEET_ASSIGNED → ARRIVING → CONFIRMED。终止为 DECLINED / CANCELLED / EXPIRED；MEET_FAILED 类型保留给现场失败扩展。各人确认事实不压缩成一个枚举。

CONFIRMED 只在双方确认时生成 `realMeetAt`，已有事实不可因重试重复生成。场地占用独立于此事实，已有人出发的取消链仍保留待清场占用。

## 指标

在场人数按 participant.present；可见面人数按准备、完整答案、非暂停且无当前有效关系；等待/双向/前往按当前关系状态；真实相遇按存在 realMeetAt 的关系去重。扫码/首答/完成探索是参与维度，邀请和相遇是关系次数。

伙伴触达按关系与商户去重，本期云影咖啡意向为本人选择 MERCHANT 的关系去重数。暂停不撤销历史意向。

## 公共投影

`screenProjection`仍只返回聚合数量、题目、选项分布、样本量及旧聚合播报资格；无人物、头像、地点、缘分相遇码。当前WorldAdapter只复用其统计，忽略旧canBroadcast门槛，并另行建立受限Player/事件投影。Mock浏览器持有完整虚构快照，本地投影不是正式服务端隐私边界。

## API 适配

`DestinyLabApi` 定义 command 与 resetScenario 契约；Mock 模拟 250ms 延迟，可人为延长或模拟失败。后续正式阶段需服务端身份、权限、持久化事务、时间和公共投影，不将本地角色参数当成真实认证。

## 返回推荐列表的状态边界

返回只进行路由导航，不新增领域命令，不修改当前关系、答案、候选排序或存储结构。禁用说明由既有 SENT / ACCEPTED / MEET_ASSIGNED / ARRIVING / CONFIRMED 状态派生，目标入口复用 routeFor；终止状态不继续保留旧的阻断说明。

## 动效展示状态边界（2026-10-05）

前一轮 H5 动效没有修改领域模型。本轮头像扩展增加 Participant.avatarId 和 profile 命令入参；schema=1、邀请状态和业务事件类型保持不变。`hasPlayedMutualMotion` 与邀请到达播放记录使用独立 sessionStorage 命名空间 `destinylab:motion:`，以 epoch / 参与者 ID / 邀请 ID 区分；存储受限时退回内存，不影响业务。它们不是用户资料字段。

跨路由信号与城市提示只存在组件展示状态中，在失效、离开相关路由、隐藏或到时后丢弃，不写入 DemoState。`demoPresentation.isDemoData=true` 为本地展示适配元数据；未来真实适配器不得默认沿用演示回应。展示读实际答案、邀请、出发 / 到达与匿名统计，不执行业务命令。

## avatarId 与大屏展示适配

Participant.avatarId: string|null；profile 命令必须携带性别匹配的白名单 ID。新档案未选为 null，完成资料前必须选择。旧快照字段缺失且资料已完成时，以参与者 ID 的确定性映射提供兼容默认；未完成保持 null。明确 null 不被自动覆盖，未知/性别不符值归为 null。读兼容不清数据，不修改 epoch/revision；下一次正常命令保存时持久化。只存 ID，不存图像路径或 Base64。

`screenProjection` 仍只返回聚合数据。当前WorldAdapter（前轮为ScreenAdapter）私下持有当前会话的业务 ID→内部 visualKey 映射，按最新授权输出已提交活动昵称、白名单虚拟头像和当前展示题目归属。头像路径属于公开系统素材，不含参与者 ID；不传出同舟真实姓名、其他题目答案或原始配对。该前端适配不构成正式认证边界。

旧版ScreenEvent（当前World入口不使用）的JOIN/ANSWER/ACTIVE/MATCH是非持久化展示事件。第一次完善资料产生 JOIN；答案差异产生 ACTIVE，统计计数增加触发对应 ANSWER；broadcast-consume 新消费至少三对才产生 mutual MATCH；realMeetAt 聚合数实际增加产生 confirmed MATCH。它们只能触发视觉效果，不能写回人数或见面次数。ScreenEventSource 为未来受控来源预留订阅接口，未接入 WS/SSE。PUBLIC 用于已完成资料的活动昵称展示；LIGHT/ANONYMOUS 保留兼容和缺少资料时的降级。

## 十题增量兼容（2026-10-06）

Participant.answers 继续是 questionId→单选文字，不新增字段、版本或迁移。QUESTIONS 增加 q7–q10；complete 按当前全部 10 题计算，available 和新邀请校验沿用此完整性。旧存储读取不填新答案；下一次保存仅写实际选项。Mock 种子的新四题为独立生成的虚构数据，不用于迁移旧快照。

routeFor 与 phase 让已有 SENT / ACCEPTED / MEET_ASSIGNED / ARRIVING / CONFIRMED 任务优先于补答；移动页守卫允许查看 M07–M10 原任务及终止状态。rediscover 仍由本人触发，清空 currentId 后恢复完整性检查。Invitation.common 只在新邀请时计算，可含至多 10 个相同答案；旧共同答案快照与 realMeetAt 不回算。responses 仍只记录 q1；scans、schema、epoch、存储键及业务事件结构不变。

## 自动前进与显示连续性（2026-10-06）

点击答案仍执行原 answer 命令，成功写入后才前进；不预提交下一题。useAction 以同步锁防止同一任务重复提交，以组件代次、epoch 和路由检查异步结果；离开、换角色或重置后旧结果不能推进新页面。隐藏时允许已经提交的答案保存，但不继续旧视觉跳转。失败不写答案、不推进。

大屏显示数值和Mode时钟仅存在于内存；epoch变化重建，普通Mode变化保留世界。当前World首次读取/刷新不重播历史事件，数字持续读取最新快照并只作显示插值；真实相遇继续按realMeetAt去重。无新业务字段、命令、迁移或后端服务。


## M06 精修的展示边界（2026-10-06）

没有新增或改变实体、API Contract、领域命令、题库、存储键和推荐排序。共同点继续由原 commonAnswers 比较，邀请时的 Invitation.common 快照逻辑不变。零共同点 UI 禁用仅提前表达已有 invite 命令的共同答案限制。

类别文案及破冰模板位于 `features/mobile/match-detail.ts`，只根据 questionId + 实际 answer 派生显示，不构成画像或匹配计算。话题游标只存在 React 组件内，目标/实际共同答案变化后重置，不持久化、不写事件。细轨迹的一次播放记录复用 `destinylab:motion:common-path:` 会话命名空间，按 epoch / actor / target 区分，受限时退回原内存记录，不影响业务保存。

## 前轮 Three.js 展示数据（2026-10-07，历史架构）

以下ScreenSnapshot/ScreenEvent.field/JoinEventQueue保留作旧首屏实现记录，当前Destiny Field使用下节WorldData与WorldEvent；手机点位编号与缘分相遇码兼容约定继续有效。

ScreenSnapshot 增加 question（id/title/total/options[key,label,count,percentage]）和 members（visualKey、活动昵称、头像、当前 optionKey、稳定 seed）。optionKey 仅为展示键，由题目 ID 与选项索引生成；Participant.answers、responses、Invitation 和数据库结构均不变。稳定 seed 在适配器内派生，Three 不获得原始 participantId。

ScreenEvent.field 是可选的非持久化视觉元数据：questionKey / optionKey / optionLabel / kind(join,move,answer) / 活动昵称及白名单头像 / 聚合数量。JOIN 后已有回答不重复计数；已有资料的实际回答改变只产生一次个体入场/移动；匿名历史统计变化只产生聚合提示。初始读取、刷新和问题输入切换不回放历史。

MotionController 的 JoinEventQueue 限制 32 个待播、3 个同时入场、5 秒过期及 350ms 间隔，重复与失效节点被合并/取消。近期加入者短时优先进入代表样本；质量档、位置、纹理和排队状态只存在内存，不写业务数据。Future ScreenEventSource 仍为预留接口。

Invitation.code 保持现有生成和值，UI 命名改为“缘分相遇码”。MeetPoint.name（如 Meet01）为现场编号；location/distance 字段保留读兼容，M08/M09 不再展示。


## 历史基线：Destiny Field 1.0 世界投影（2026-10-07）

新模型仅位于`features/screen/world`，不修改Participant、Invitation、领域命令、schema或数据库。`WorldData`包含epoch、revision、source（business/mock）、totalParticipants、currentParticipants、availableParticipants、totalMeetings、当前question、participants与events。

| 显示字段 | 数据来源与边界 |
| --- | --- |
| totalParticipants | 当前Q1已保存回答总数，含匿名历史；CHOICE文案为“人留下了选择”，不能当作当前在场 |
| currentParticipants | participant.present人数；LIVE“人正在这里” |
| availableParticipants | 只读复用available(s,p)，包括完整资料/十题、ready、非paused及当前邀请限制 |
| totalMeetings | 存在realMeetAt的关系数，双方确认前不增加 |
| question.options | id、label、原始count、显示percent；屏幕最大余数分配保证合计100%；独立World Mock默认示例48/58/37→34/40/26，业务screen按现有快照计数 |
| participants | 当前在场、资料完整、昵称非空、虚拟头像有效的受限可视Player，非完整名册 |

`WorldPlayer`只输出会话视觉id、≤5字nickname、白名单avatar路径、当前field、通用status、isAvailable、activity、确定性seed。field允许null：表示未保存有效首答，渲染层使用中性位置而非默认归入第一个选项；Reduced Motion改选同样应用真实新Field的静态位置。状态不携带具体对象或原始邀请。渲染器持有position/velocity/target/trail等瞬时状态，不能写回业务。业务ID映射只保留在Adapter，画面与事件不携带真实姓名、手机号、同舟资料、其他题目答案、配对双方、MeetPoint、通行码或缘分相遇码。

`WorldEvent`为非持久化事件：id、type、timestamp，按类型可选playerId、field、isAvailable、completed、aggregateCount。type为join、answer、field_changed、availability_changed、mutual_confirmed、meeting_confirmed。第一题先更新统计，资料完成后join不再增加回答总数；只有Q1改选改变Field，其他答题用answer反馈，完成状态不泄露答案。availability根据完整业务资格变化，不能只看ready。

acceptedAt从无到有生成mutual_confirmed；realMeetAt从无到有生成meeting_confirmed。两种确认均只含匿名数量，不携带双方ID或头像。统计取快照，动画不自行+1。初始读取/刷新/epoch重置只建立基线；事件id去重、时间过期及有界合并抑制历史重播，旧broadcastConsumed不作为新交汇来源。

`useWorldData(false)`经useSyncExternalStore订阅已有store，只在必要时initialize本地演示状态，不执行sweep、broadcast-consume或其他业务命令，不更改共享手机hook。返回值区分WorldData、加载中的null与读取失败的unavailable；storageUnreadable时停止展示旧World或store内部回退种子，保留损坏存储原文。恢复后重建WorldAdapter，先建立事件基线，不追播不可用期间的历史。当前无服务端推送；未来WS/SSE须提供同样受限的快照与事件，不能直接发送DemoState。

`WorldMockSource`独立内存生成143份虚构档案，默认37人在场、0人开放、28次相遇；压力模式143人全在场。join/answer/field/open/close/mutual/meet/reset/stress/empty只改此内存，完全不写业务localStorage。join先增加在场，完成首答才增加累计选择；mutual不增加totalMeetings，meet才增加。source显式标记mock，不能静默补全业务数据。

WebGL失败的静态渲染使用同一WorldData并复用物理安全区，不回退到另一套业务种子；数据不可用与渲染降级是不同状态。

WorldClock的CHOICE/LIVE/MEET时长12/8/8秒；匿名交汇6秒期间冻结Mode剩余时间，结束恢复，事件间至少2.4秒正常模式窗口。队列有界、突发合并、seen去重；clearEvents清当前/待播视觉事件但保留Mode与剩余时间。普通Mode改变不改变epoch或重建Scene。本轮lint、类型、61项领域测试、生产构建、64项浏览器回归及1,800.112秒连续本地运行均通过；详情见`verification/destiny-field/2026-10-07-validation.md`。


## 历史双幕屏幕投影增量（2026-10-08）

仅screen的WorldPlayer新增gender和joinedAt，分别直接投影现有Participant字段；joinedAt用于稳定队列顺序，同时间以视觉ID排序。不改领域Participant或持久化结构，不按照片/昵称猜测性别。

WorldEvent新增choice_selected（首个有效Q1，countDelta=1，可以没有可展示playerId）与presence_changed（presentDelta为+1/-1）；join仍仅代表头像资料首次具备展示资格。field_changed含previousField和countDelta=0。UI数字永远读WorldData快照，不能把三种事件各自再加一次人数。

currentParticipants仍为present人数，不等同资料完整人数或可见窗口人数；availableParticipants仍按现有available资格计算。CHOICE只展示有有效field的资料用户，LIVE可展示field=null者；历史匿名回答不生成头像。Mock48/58/37按最大余数显示34/40/26。totalMeetings仍由realMeetAt决定，匿名mutual_confirmed不增加它。

六个CHOICE队列容量5、两个LIVE队列容量6，底层保留所有合资格人物。队列、游标、位置、淡变、seen事件、+N与缓存均为可丢弃的内存显示状态，不写回领域。隐藏页丢弃过时视觉反馈；初次读取、刷新、epoch更新及坏存储恢复不重播历史。

Mock新增join(gender?, fieldId?)、burst(count, gender?, fieldId?)，仍不写业务存储。调试UI只在development出现，生产的独立Mock页面只展示。具体验证见`verification/destiny-field-act12-v2/`。

## 历史第三幕V1屏幕投影与许可适配（2026-10-09）

新增仅screen使用的`WorldData.meetScene?: MeetSceneData`，其中`qualifiedPairs: MeetPair[]`。MeetPair包含临时展示id、male/female两个MeetParticipant、`status: meet_confirmed`、confirmedAt、justConfirmed。MeetParticipant复用公开虚拟头像/昵称，附加显式`allowPublicDisplay: true`；原业务Invitation/Participant/数据库和持久化key不变。

`PairDisplayConsent`具有revision与`allows(invitationId, participantId)`。Provider必须在许可变更时更新revision并通知所有者读取新投影，即使业务快照本身没变也重算。没有Provider、任意一方未知/拒绝、Provider异常、缺资料/非法头像/无realMeetAt时均拒绝展示。来源必须是同一已成立记录，不从候选列表临时拼人；按gender决定左右，不把from当男方。不按available/present过滤历史已见面关系。同一双人组合展示去重；业务总数继续按既有realMeetAt口径独立统计。

初载及重载不产生“刚刚”；真实新realMeetAt或开发新见面事件可进入优先队列。PairSceneController维护displayQueue、最多32优先项、最近4项、最多512已见事件；历史轮播、重复快照、动画碰撞均不增业务数。撤回过滤所有待播项与当前Pair。匿名mutual_confirmed仍不携带双方ID，不能借它推断具体Pair。

运行时业务Adapter尚未接入公开许可Provider，因此默认qualifiedPairs为空。后续真实接入需要独立确认许可采集/撤回范围，本轮不扩展手机、后台、同舟授权。Mock内存初始143人/37在场/10虚构Pair/28历史相遇；定向加入的性别和头像不可被Mock配对覆盖，同性邻接记录不构造本任务的男女Pair。Mock只供明确演示，不存储或补写业务数据。


## 2026-10-10 公网 10–20 人演练适配

新增非特权容器、独立初始化、健康检查、数据库 TLS/连接池配置与远端测试库绑定保护。三端继续共用服务及 PostgreSQL，原有手机旅程、十题、双方确认和三幕大屏规则不变，数据库业务表结构不变。自动化使用独立测试库和 20 个浏览器身份；真人验收使用另一个空库。2026-10-10 已按确认计划创建 Render 免费应用和 PostgreSQL 两个独立数据库，完整 TLS 与跨库拒绝检查通过；公网 20 身份演练在集中答题时出现 HTTP 502，尚未进入配对及 30 分钟持续阶段；应用已暂停，测试数据与备份保留。真人空库未切换、实体手机未验收，服务端同步优化方案待确认。运行边界及步骤见 [CLOUD_UAT.md](CLOUD_UAT.md)。


## 2026-10-11 小程序实施与 Mac UAT 增量

增量迁移 `database/003-wechat-identity.sql` 新增 dl_wechat_identities、dl_wechat_participants、dl_mini_sessions、dl_wechat_codes_used、dl_wechat_entry_codes。appid/openid 唯一；身份与活动唯一映射参与者；业务令牌仅存哈希，7 天到期，重新登录轮换、退出撤销。微信 session_key 不落库或返回。活动码缓存短 scene 和图片；原业务事实继续存于统一服务既有表。 详细步骤、证据与限制见 [MINI_UAT.md](MINI_UAT.md)。


## 2026-10-11 同舟机构工作台与个人宣传页

增量 004-tongzhou-agency.sql 新增 dl_agency_profiles（机构跟进、发布草稿及发布快照、独立公开照片字节、唯一编号及随机 slug）和 dl_agency_actions（命令幂等哈希、机构账号、动作与公开许可确认）。以 activity_id/actor 关联既有填报，不修改原填报结构。跟进 version 与用户填报 version 分别校验。照片发布副本只经有效发布接口读取，原头像换图清理不会导致已发布页面引用悬空。撤回/删除填报时清除发布内容及照片，重新提交不自动恢复旧发布。


## 2026-10-11 同舟三页签与独立相册

迁移 005-agency-album.sql 新增 dl_agency_albums（活动/用户相册版本）与 dl_agency_photos（独立生活照、缩略图、尺寸、顺序、机构上传账号/时间），新增 dl_agency_profiles.photo_ids 与 source_album_version。照片服务端纠正方向、去元数据、按比例缩至最长 1920px，展示版不超过 2MiB、缩略图不超过 200KiB。资产内容不可编辑，只可追加/排序/移除。snapshot.photos 保存本次公开的照片 ID 顺序（第一张封面），公共照片路由同时验证有效填报、发布状态及此白名单；photo 字段仍保存兼容封面缩略图，旧单图快照可读。公开快照不随新上传/草稿变化；明确删除已公开照片时同时移除快照引用、兼容封面及私有资产。机构动作日志承载 photo-upload/reorder/delete，幂等键与版本防并发覆盖。原资料撤回/删除清除相册资产及发布内容，重新提交不恢复。


## 2026-10-11 公开字段全选与用户照片展示

迁移 006-agency-user-photos.sql 新增 dl_agency_user_photo_snapshots：activity_id、actor、id 联合主键及用户照片 bytes（不超过 200KiB），仅在明确发布时复制当前已确认的用户头像照片；重发替换副本、下架/原资料撤回删除清理。相册本身以当前 participant.photo + attached avatar 只读合并投影，不导入取消上传、不累积用户历次头像。AgencyGallery 增加 userPhotoId 与 source；保留机构 version，并以 expectedUserPhoto 校验预览/发布间换图。public snapshot.photos 白名单同时约束机构资产与用户发布副本，私有头像清理不会损坏已发布图片。


## 2026-10-11 个人宣传页 V2 与昵称隐私规则

本轮无需数据库迁移。PUBLIC_FIELDS 排除 realName/phone；旧客户端配置含这两个字段时 validateAgencyDraft 兼容接收后过滤；management 读取旧设置时过滤；publicProfile 生成快照时强制过滤；publishedProfile 对历史快照执行 safePublicProfile 后才向匿名 JSON/SSR 返回。原始机构资料、保存过的数据库记录及 slug 不改写。nickname/code、照片副本及快照生命周期沿用原契约。


### 2026-10-11 发布可用性验收修复

发布可用性修复仅调整前端交互，无数据库或 API 契约变动；服务端 confirmed、版本、照片许可校验保持不变。


### 2026-10-11 发布成功专属链接交付

发布链接交付优化不新增数据库字段；读取既有 management.url，由当前访问来源组成绝对 URL，slug 与发布权限保持不变。


## 2026-10-11 宣传页隐藏编号与女生 UAT 样例

无 schema 迁移。PublicProfile.code 为兼容保留；渲染不展示，safePublicProfile 将历史 title===code 归一为空。测试提交使用固定 actor 与 record._uatBatch 标记；仅指定局域网库/隔离测试库可导入。独立相册沿用 dl_agency_photos，发布沿用现有版本校验和快照服务；不写入 dl_activities.state 或现场参与者。


## 2026-10-11 会员主页顶部照片柔焦优化

无 schema、接口、快照或图片字节变化。新增的loading/ready/failed仅为封面组件本地展示状态，按URL重挂载重置；背景和主图复用同一个获准公开URL。


## 2026-10-11 会员主页 V1.1 字体与排版

本轮无数据模型、字段、接口、授权或快照变化。仅展示章节增加wide样式标记用于维持相册宽度；排序、空值处理及格式化规则保持原状。

## 008 独立报名模型

`dl_registration_config`按活动保存可编辑文案与开放状态；`dl_registrations`存私有资料JSON、随机凭证、同意版本/时间、状态、版本、现场participant/epoch关联及checkin_epoch；活动内手机号唯一且不用于身份自动合并。`dl_registration_sessions`用哈希HttpOnly会话绑定本人报名；`dl_registration_photos`保存重编码WebP/缩略图；`dl_registration_actions`提供幂等账本。资料不进入dl_activities.state或公共事件。

明确同舟授权后，独立actor `registration:<uuid>`投影到既有机构提交和相册。机构备注、签约、服务、昵称与公开字段保留；用户更新下线旧公开快照。相册增补uploadedBy字段标明用户上传，保持原source存储类型及接口兼容。


## 2026-10-12 六位数字签到凭证

009-registration-receipts.sql为dl_registrations添加nullable legacy_receipt及唯一索引。receipt保持原唯一约束，新码由crypto.randomInt生成，INSERT ON CONFLICT(receipt)自动重试。受控迁移锁表后事务转换旧码，保留所有其他列；重复执行不再更改六码。


## 2026-10-12 报名电子凭证与四站档案 V1.2

010为dl_registrations追加profile_progress jsonb默认{}及profile_confirmed_at可空时间。profile更新接口按分区白名单合并、版本校验、幂等写入；DTO追加有效签到状态，原数据库status和六码不变。


## 2026-10-12 第四站已保存档案预览维护

本轮无模型或数据库变更。客户端停止preview/confirm写入，读取现有profileProgress与服务器快照；旧profileConfirmedAt及confirm接口保留兼容。具体见REGISTRATION_PREVIEW_UAT.md。


## 2026-10-12 V1.3 电子遇见邀请函

V1.3无数据库或API变更。票券继续读取config.title/date/location及record.nickname/receipt/effectiveStatus；日期与六码格式化仅在显示层，复制、查询、签到使用原始值。


## 报名出生日期与文案迭代

2026-10-13：dl_registrations 新增 nullable text birth_date（迁移 011，规范 YYYY-MM-DD）；API 私有记录新增 birthDate 与派生 zodiac，旧字段 birthYear 保留。生日不进入 TongzhouProfile、机构投影或公共白名单；版本控制、幂等与事务覆盖同次生日保存。无月日的历史记录保持 NULL。

### 2026-10-13 小程序报名与双入口

迁移 012 新增 dl_mini_identity_sessions、dl_wechat_registrations；原 entry code 表新增 entry_type 并扩展主键为活动/AppID/环境/入口。旧码回填 encounter，scene 不变；独立身份登录不写活动参与者。H5 与 mini 共用 registrationEnterActor 校验当前活动周期和工作人员签到。

## 遇见地点默认值（2026-10-13）

沿用 `state.points` 的 id/name/location/distance/occupant/closed 结构，无新字段。共享工厂默认生成 Meet01–Meet20，location 为空、distance=0（不作距离展示）。`point-status` 命令仅限运营，要求 occupant 为空。补齐按 name 去重并避免 id 冲突；保留旧 id、地址、占用、邀请及启停状态，不覆盖已有记录。

## 小程序双入口与内容审核增量

012 保留历史参与关联并增加独立微信身份会话、报名绑定及按入口区分的小程序码；013 增加 dl_mini_media_reviews 和 dl_mini_review_results，分别持久化照片审核及去重回调。真实生日仍只保存在报名私有记录中，不进入机构公共字段或大屏投影。
