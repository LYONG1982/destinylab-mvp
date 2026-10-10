export const QUESTIONS = [
  {
    id: "q1",
    title: "今天，想怎样遇见？",
    short: "第一次认识",
    options: ["轻松聊聊", "一起逛逛", "认真认识"],
    hints: ["从一个话题开始", "城市漫步，线下相遇", "真诚交流，长期可能"],
  },
  {
    id: "q2",
    title: "第一次见面，你更喜欢怎样的地方？",
    short: "相遇的地方",
    options: ["热闹街区", "安静咖啡馆", "户外步道", "特色小店"],
  },
  {
    id: "q3",
    title: "如果刚好有半天空闲，你更愿意先聊点什么？",
    short: "更愿意先聊",
    options: ["美食与探店", "电影与音乐", "旅行与城市", "最近的生活"],
  },
  {
    id: "q4",
    title: "认识一个人，你更喜欢什么节奏？",
    short: "关系的节奏",
    options: ["慢慢靠近", "聊得来就多认识", "先做朋友", "看当下感觉"],
  },
  {
    id: "q5",
    title: "周末你更愿意？",
    short: "周末的偏好",
    options: ["出去走走", "在家充电", "约朋友聚聚", "随心安排"],
  },
  {
    id: "q6",
    title: "第一次见面更看重？",
    short: "更看重什么",
    options: ["聊得来", "相处自在", "兴趣相近", "真诚表达"],
  },
  {
    id: "q7",
    title: "到一个不太熟悉的聚会，你通常会？",
    short: "社交方式",
    options: ["主动认识几个人", "等别人来聊", "先观察一下", "跟着感觉走"],
  },
  {
    id: "q8",
    title: "遇到聊得来的人，你更容易怎么表达？",
    short: "沟通方式",
    options: ["主动找话题", "认真听对方说", "分享自己的故事", "用行动表达"],
  },
  {
    id: "q9",
    title: "如果遇到一个不错的人，你更期待？",
    short: "关系期待",
    options: ["先做朋友", "多见几次再说", "认真了解彼此", "顺其自然"],
  },
  {
    id: "q10",
    title: "你更容易被哪种感觉的人吸引？",
    short: "吸引偏好",
    options: ["有趣会聊天", "温柔有耐心", "独立有想法", "真诚"],
  },
] as const;
export const AGES = ["22–25", "26–29", "30–33", "34–37", "38+"];
export const MOBILE_ROUTES = [
  "01-start",
  "02-result",
  "03-profile",
  "04-question",
  "05-discover",
  "06-common",
  "07-invitation",
  "08-mutual",
  "09-meet",
  "10-next-step",
];
export const MOBILE_TITLES = [
  "开始遇见",
  "同题结果",
  "先认识一下你",
  "轻问题",
  "发现同频的人",
  "共同答案",
  "见面邀请",
  "双向确认",
  "相遇任务",
  "相遇后的下一站",
];
export const STATUS_LABELS: Record<string, string> = {
  SENT: "等待回应",
  ACCEPTED: "等待相遇点",
  MEET_ASSIGNED: "双方愿意见面",
  ARRIVING: "前往相遇点",
  CONFIRMED: "已确认见面",
  DECLINED: "本次邀请已结束",
  CANCELLED: "本次邀请已结束",
  EXPIRED: "邀请已过期",
  MEET_FAILED: "本次相遇已结束",
};
