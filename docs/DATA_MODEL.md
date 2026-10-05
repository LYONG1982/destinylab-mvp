# 数据模型、状态与适配边界

## 存储

`destinylab:v1.1:state` 为 localStorage 版本化演示快照。`epoch` 区分场景，`revision` 区分写入，命令使用操作者和命令 ID 去重。`destinylab:v1.1:actor` 保存在各标签页 sessionStorage，不随其他标签角色切换而改变。

同源写操作经 Web Locks 串行化，读取最新快照后执行领域命令，再持久化和 BroadcastChannel 通知。无 Web Locks 时只承诺单标签角色切换演示。快照结构损坏时保留原始值并展示重置入口；用户确认重置后恢复。种子事件遵循发出、接受、出发、到达、确认的时间顺序。存储读写失败明确报错；不调用 `localStorage.clear()`。

## 对象

- Participant：昵称、性别、nullable avatarId、年龄段、准备/在场/暂停、完整题目答案、当前关系 ID。
- Invitation：双方 ID、独立状态、发出/接受/真实见面时间、各自出发/到达/见面时间、共同答案快照、本人去向、见面卡/辨认码。
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

`screenProjection` 仅返回聚合数量、题目、选项分布、样本量及是否满足播报条件。无人物、头像、地点、辨认码。Mock 浏览器持有完整虚构快照，本地投影不是正式服务端隐私边界。

## API 适配

`DestinyLabApi` 定义 command 与 resetScenario 契约；Mock 模拟 250ms 延迟，可人为延长或模拟失败。后续正式阶段需服务端身份、权限、持久化事务、时间和公共投影，不将本地角色参数当成真实认证。

## 返回推荐列表的状态边界

返回只进行路由导航，不新增领域命令，不修改当前关系、答案、候选排序或存储结构。禁用说明由既有 SENT / ACCEPTED / MEET_ASSIGNED / ARRIVING / CONFIRMED 状态派生，目标入口复用 routeFor；终止状态不继续保留旧的阻断说明。

## 动效展示状态边界（2026-10-05）

前一轮 H5 动效没有修改领域模型。本轮头像扩展增加 Participant.avatarId 和 profile 命令入参；schema=1、邀请状态和业务事件类型保持不变。`hasPlayedMutualMotion` 与邀请到达播放记录使用独立 sessionStorage 命名空间 `destinylab:motion:`，以 epoch / 参与者 ID / 邀请 ID 区分；存储受限时退回内存，不影响业务。它们不是用户资料字段。

跨路由信号与城市提示只存在组件展示状态中，在失效、离开相关路由、隐藏或到时后丢弃，不写入 DemoState。`demoPresentation.isDemoData=true` 为本地展示适配元数据；未来真实适配器不得默认沿用演示回应。展示读实际答案、邀请、出发 / 到达与匿名统计，不执行业务命令。

## avatarId 与大屏展示适配

Participant.avatarId: string|null；profile 命令必须携带性别匹配的白名单 ID。新档案未选为 null，完成资料前必须选择。旧快照字段缺失且资料已完成时，以参与者 ID 的确定性映射提供兼容默认；未完成保持 null。明确 null 不被自动覆盖，未知/性别不符值归为 null。读兼容不清数据，不修改 epoch/revision；下一次正常命令保存时持久化。只存 ID，不存图像路径或 Base64。

`screenProjection` 仍只返回聚合数据。新增 ScreenAdapter 私下持有当前会话的业务 ID→临时代号映射，只向 Canvas 输出临时代号与白名单虚拟头像源。头像路径属于公开系统素材，不含参与者 ID；不传出姓名或原始关系。该前端适配不构成正式认证边界。

ScreenEvent 的 JOIN/ANSWER/ACTIVE/MATCH 是非持久化展示事件。第一次完善资料产生 JOIN；答案差异产生 ACTIVE，统计计数增加触发对应 ANSWER；broadcast-consume 新消费至少三对才产生 mutual MATCH；realMeetAt 聚合数实际增加产生 confirmed MATCH。它们只能触发视觉效果，不能写回人数或见面次数。ScreenEventSource 为未来受控来源预留订阅接口，未接入 WS/SSE。PUBLIC/LIGHT 类型仅提供受控兼容；真实昵称公开仍未启用。
