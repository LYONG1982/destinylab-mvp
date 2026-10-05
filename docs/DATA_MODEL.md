# 数据模型、状态与适配边界

## 存储

`destinylab:v1.1:state` 为 localStorage 版本化演示快照。`epoch` 区分场景，`revision` 区分写入，命令使用操作者和命令 ID 去重。`destinylab:v1.1:actor` 保存在各标签页 sessionStorage，不随其他标签角色切换而改变。

同源写操作经 Web Locks 串行化，读取最新快照后执行领域命令，再持久化和 BroadcastChannel 通知。无 Web Locks 时只承诺单标签角色切换演示。快照结构损坏时保留原始值并展示重置入口；用户确认重置后恢复。种子事件遵循发出、接受、出发、到达、确认的时间顺序。存储读写失败明确报错；不调用 `localStorage.clear()`。

## 对象

- Participant：昵称、性别、年龄段、准备/在场/暂停、完整题目答案、当前关系 ID。
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
