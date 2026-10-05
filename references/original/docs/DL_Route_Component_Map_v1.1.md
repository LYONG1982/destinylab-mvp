# 缘分实验室｜路由、组件与页面映射 v1.1

## 一、路由清单

| 编号 | 页面 | 路由 | 参考高保真文件 |
|---|---|---|---|
| M01 | 开始遇见 | `/mobile/01-start` | `DL_Mobile_01_开始遇见.png` |
| M02 | 原来有人和你想得一样 | `/mobile/02-result` | `DL_Mobile_02_原来有人和你想得一样.png` |
| M03 | 先认识一下你 | `/mobile/03-profile` | `DL_Mobile_03_先认识一下你.png` |
| M04 | 更愿意先聊什么 | `/mobile/04-question` | `DL_Mobile_04_更愿意先聊什么.png` |
| M05 | 看看现在可以认识谁 | `/mobile/05-discover` | `DL_Mobile_05_看看现在可以认识谁.png` |
| M06 | 共同答案与邀请 | `/mobile/06-common` | `DL_Mobile_06_共同答案与邀请.png` |
| M07 | 收到见面邀请 | `/mobile/07-invitation` | `DL_Mobile_07_收到见面邀请.png` |
| M08 | 双向确认与相遇点 | `/mobile/08-mutual` | `DL_Mobile_08_双向确认与相遇点.png` |
| M09 | 去 Meet01 见面 | `/mobile/09-meet` | `DL_Mobile_09_去Meet01见面.png` |
| M10 | 相遇后的下一站 | `/mobile/10-next-step` | `DL_Mobile_10_相遇后的下一站.png` |
| A01 | 现场总览 | `/admin/dashboard` | `DL_Admin_01_现场总览.png`（待实现） |
| A02 | 邀请与相遇 | `/admin/encounters` | `DL_Admin_02_邀请与相遇.png`（待实现） |
| A03 | 参与用户 | `/admin/participants` | `DL_Admin_03_参与用户.png`（待实现） |
| A04 | 商户与服务授权 | `/admin/partners` | `DL_Admin_04_商户与服务授权.png`（待实现） |
| S01 | 关系问题 | `/screen/question` | `DL_Screen_01_关系问题.png`（待实现） |
| S02 | 此刻在场 | `/screen/presence` | `DL_Screen_02_此刻在场.png`（待实现） |
| S03 | 双方愿意见面 | `/screen/mutual` | `DL_Screen_03_双方愿意见面.png`（待实现） |
| S04 | 今日真实相遇 | `/screen/real-meet` | `DL_Screen_04_今日真实相遇.png`（待实现） |

## 二、组件与 Props 建议

```ts
interface DefaultAvatarProps {
  gender: 'male' | 'female';
  variant: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
}

interface RecommendationCardProps {
  participant: Participant;
  commonAnswers: CommonAnswer[];
  onOpen: () => void;
}

interface InvitationCardProps {
  invitation: Invitation;
  perspective: 'sender' | 'receiver';
  onAccept?: () => void;
  onDecline?: () => void;
}

interface MeetPassCardProps {
  meetPoint: MeetPoint;
  encounterCode: string;
  counterpart: Participant;
  currentUserStatus: ArrivalStatus;
  counterpartStatus: ArrivalStatus;
}

interface StatCardProps {
  label: string;
  value: number | string;
  trend?: string;
  status?: 'normal' | 'warning' | 'danger';
}

interface MatchCardProps {
  invitation: Invitation;
  participants: [Participant, Participant];
  onOpen: () => void;
}
```

## 三、页面状态场景

### Mobile 05

- `recommendations.length === 0`：空状态；
- `1–3`：真实卡片数量；
- `pendingInvitationCount > 0`：顶部任务栏。

### Mobile 08

- `MEET_ASSIGNED`：相遇点已分配；
- `counterpartDepartureConfirmed === false`：显示“TA也愿意见面”；
- `true`：显示“TA已确认出发”。

### Mobile 09

- 当前用户未到：按钮“我已经到了”；
- 双方到但未确认见面：按钮“我已经见到TA”；
- 单方确认：显示“等待TA确认”；
- 双方确认：进入 Mobile 10。

## 四、后台状态映射

```ts
export const flowStatusLabels = {
  NEW: '刚进入',
  ANSWERING: '答题中',
  PROFILE: '补充资料',
  DISCOVERING: '探索中',
  WAITING: '等待回应',
  MATCHED: '双方愿意见面',
  GOING_TO_MEET: '前往相遇点',
  MEETING: '已见面',
  CONTINUE: '继续认识',
  REDISCOVER: '继续探索',
  END: '已结束',
} as const;
```

## 五、大屏轮播

```ts
const rotation = [
  { state: 'question', duration: 12000 },
  { state: 'presence', duration: 8000 },
  { state: 'real-meet', duration: 8000 },
];
```

关系事件为插播：

```ts
if (mutualEvent && privacyRulePassed) {
  insertState({ state: 'mutual', duration: 6000 });
}
```
