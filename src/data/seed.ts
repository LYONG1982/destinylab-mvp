import { defaultAvatarId } from "@/config/avatars";
import { defaultMeetPoints } from "@/domain/meet-points";
import { QUESTIONS } from "./questions";
import type { DemoState, Participant, Invitation } from "@/domain/types";
import { commonAnswers } from "@/domain/selectors";
const START = Date.parse("2026-11-07T18:36:00+08:00");
const baseAnswers = {
  q1: "一起逛逛",
  q2: "热闹街区",
  q3: "旅行与城市",
  q4: "慢慢靠近",
  q5: "出去走走",
  q6: "聊得来",
};
export const SCENARIOS = [
  ["fresh", "从头体验", "第一题开始，分别操作两位参与者"],
  ["discover", "发现同频", "完成探索，3 位候选"],
  ["zero", "没有候选", "体面地等待下一次相遇"],
  ["one", "1 位候选", "只展示真实可用的人"],
  ["two", "2 位候选", "不补齐虚构卡片"],
  ["browse", "我想先看看", "暂不进入他人的推荐池"],
  ["waiting", "邀请待回应", "山风发出，小满自主决定"],
  ["declined", "邀请已结束", "拒绝后不展示原因"],
  ["expired", "邀请已过期", "可以主动返回探索"],
  ["busy", "相遇点忙碌", "双方愿意，等待空闲地点"],
  ["mutual", "双向确认", "地点已分配，尚未出发"],
  ["departure", "一方出发", "另一方仍需自己确认"],
  ["arrival", "一方已到达", "等候与工作人员帮助"],
  ["one-confirm", "一方确认见面", "真实相遇仍为 28 次"],
  ["confirmed", "双方已经见面", "真实相遇为 29 次"],
  ["help", "需要现场帮助", "请求已进入运营待办"],
  ["paused", "暂停新邀请", "已接受的关系仍可继续"],
  ["merchant", "相遇伙伴", "看看城市里的下一站"],
  ["broadcast", "聚合播报", "三对独立关系，允许匿名插播"],
] as const;
export function createSeed(
  scenario = "fresh",
  epoch = globalThis.crypto.randomUUID(),
): DemoState {
  const names = ["山风", "小满", "晚风", "青禾", "川野", "长安"];
  const participants: Participant[] = Array.from({ length: 108 }, (_, n) => ({
    id:
      n === 0
        ? "p-shanfeng"
        : n === 1
          ? "p-xiaoman"
          : n === 2
            ? "p-wanfeng"
            : n === 3
              ? "p-qinghe"
              : `p-${String(n).padStart(3, "0")}`,
    name:
      names[n] ||
      `${["云", "青", "秋", "林", "南", "北", "星", "月", "溪"][Math.floor((n - 6) / 12) % 9]}${["初", "禾", "棠", "言", "晓", "白", "舟", "安", "宁", "雨", "桐", "晴"][(n - 6) % 12]}`,
    gender:
      n === 0 || n === 4 || n === 5 || (n >= 6 && n % 2 === 0)
        ? "male"
        : "female",
    avatarId: null,
    age: n === 3 ? "30–33" : "26–29",
    ready: n < 6,
    paused: false,
    present: n < 37,
    profileComplete: true,
    answers:
      n < 6
        ? { ...baseAnswers }
        : {
            q1: "轻松聊聊",
            q2: "特色小店",
            q3: "电影与音乐",
            q4: "先做朋友",
            q5: "在家充电",
            q6: "真诚表达",
          },
    currentId: null,
    joinedAt: START - (n + 1) * 60000,
  }));
  participants.forEach((p) => {
    p.avatarId = defaultAvatarId(p.id, p.gender);
  });
  participants[1].answers = {
    ...baseAnswers,
    q2: "安静咖啡馆",
    q6: "相处自在",
  };
  participants[2].answers = {
    ...baseAnswers,
    q2: "安静咖啡馆",
    q5: "在家充电",
    q6: "兴趣相近",
  };
  participants[3].answers = {
    ...baseAnswers,
    q2: "户外步道",
    q3: "美食与探店",
    q6: "真诚表达",
  };
  participants[4].answers = {
    ...baseAnswers,
    q2: "户外步道",
    q3: "美食与探店",
    q6: "相处自在",
  };
  participants[5].answers = {
    ...baseAnswers,
    q2: "安静咖啡馆",
    q4: "先做朋友",
    q6: "真诚表达",
  };
  // Fictional seed answers only; persisted participants are never backfilled.
  // Keep the original six-question common-answer counts for the demo actors.
  participants.forEach((p, n) => {
    QUESTIONS.slice(6).forEach((q, index) => {
      p.answers[q.id] = q.options[n === 0 ? 0 : 1 + ((n + index) % 3)];
    });
  });
  const s: DemoState = {
    schema: 1,
    epoch,
    revision: 0,
    now: START,
    wallAt: Date.now(),
    scenario,
    activityPaused: false,
    participants,
    invitations: [],
    points: defaultMeetPoints(),
    helps: [],
    merchants: [
      {
        id: "cloud",
        name: "云影咖啡",
        category: "咖啡与小憩",
        active: true,
        minutes: 3,
      },
      {
        id: "dessert",
        name: "山河甜品",
        category: "甜品与分享",
        active: true,
        minutes: 5,
      },
      {
        id: "craft",
        name: "西巷手作",
        category: "手作与体验",
        active: false,
        minutes: 7,
      },
    ],
    events: [],
    scans: Array.from({ length: 162 }, (_, i) => `scan-${i}`),
    responses: {},
    merchantViews: [],
    commands: [],
    broadcastConsumed: [],
    tongzhouSubmissions: [],
  };
  // Complete, inspectable historical pairs. These do not occupy current meet points.
  for (let n = 0; n < 28; n++) {
    const a = participants[52 + n * 2],
      b = participants[53 + n * 2],
      at = START - (180 - n * 3) * 60000;
    s.invitations.push({
      id: `history-${n}`,
      from: a.id,
      to: b.id,
      status: "CONFIRMED",
      createdAt: at - 600000,
      acceptedAt: at - 500000,
      realMeetAt: at,
      pointId: null,
      departures: { [a.id]: at - 300000, [b.id]: at - 300000 },
      arrivals: { [a.id]: at - 100000, [b.id]: at - 100000 },
      confirmations: { [a.id]: at, [b.id]: at },
      common: commonAnswers(a, b),
      choices: { [a.id]: "END", [b.id]: "END" },
      pass: `H-${n + 1}`,
      code: String(6000 + n),
    });
  }
  // The sample total is 143; each distribution entry remains inspectable.
  const counts = [47, 60, 36];
  const labels = QUESTIONS[0].options;
  participants.forEach((p) => {
    s.responses[p.id] = p.answers.q1;
    const index = labels.findIndex((x) => x === p.answers.q1);
    counts[index]--;
  });
  // Balance the historical sample rather than retaining impossible summary constants.
  if (counts.some((n) => n < 0)) {
    participants.slice(6).forEach((p, i) => {
      p.answers.q1 = i < 42 ? "一起逛逛" : i < 73 ? "轻松聊聊" : "认真认识";
      s.responses[p.id] = p.answers.q1;
    });
  }
  labels.forEach((label, index) => {
    const target = [47, 60, 36][index];
    const existing = Object.values(s.responses).filter(
      (v) => v === label,
    ).length;
    for (let n = existing; n < target; n++)
      s.responses[`anon-${index}-${n}`] = label;
  });
  if (scenario === "fresh") {
    participants[0].answers = {};
    participants[0].profileComplete = false;
    participants[0].avatarId = null;
    participants[0].ready = false;
    delete s.responses[participants[0].id];
  }
  if (["zero", "one", "two"].includes(scenario)) {
    const count = scenario === "zero" ? 0 : scenario === "one" ? 1 : 2;
    participants.slice(1, 4).forEach((p, i) => (p.paused = i >= count));
  }
  if (scenario === "browse") participants[0].ready = false;
  if (scenario === "paused") s.activityPaused = true;
  if (
    !["fresh", "discover", "zero", "one", "two", "browse", "paused"].includes(
      scenario,
    )
  ) {
    const i = seedInvitation(
      s,
      participants[0],
      participants[1],
      "inv-shanfeng-xiaoman",
    );
    if (scenario === "waiting") i.status = "SENT";
    else if (scenario === "declined") i.status = "DECLINED";
    else if (scenario === "expired") {
      i.status = "EXPIRED";
      i.createdAt = START - 16 * 60000;
    } else {
      i.acceptedAt = START - 30000;
      if (scenario === "busy") {
        i.status = "ACCEPTED";
        s.points.forEach((p) => (p.closed = true));
      } else {
        i.status = "MEET_ASSIGNED";
        i.pointId = s.points[0].id;
        s.points[0].occupant = i.id;
      }
      if (
        [
          "departure",
          "arrival",
          "one-confirm",
          "confirmed",
          "help",
          "merchant",
        ].includes(scenario)
      ) {
        i.createdAt = START - 600000;
        i.acceptedAt = START - 360000;
        i.status = "ARRIVING";
        i.departures[i.to] = START - 300000;
      }
      if (
        ["arrival", "one-confirm", "confirmed", "help", "merchant"].includes(
          scenario,
        )
      ) {
        i.departures[i.from] = START - 100000;
        i.arrivals[i.to] = START - 200000;
      }
      if (["one-confirm", "confirmed", "merchant"].includes(scenario)) {
        i.arrivals[i.from] = START - 30000;
        i.confirmations[i.to] = START - 10000;
      }
      if (["confirmed", "merchant"].includes(scenario)) {
        i.confirmations[i.from] = START;
        i.realMeetAt = START;
        i.status = "CONFIRMED";
      }
      if (scenario === "help")
        s.helps.push({
          id: "help-seed",
          participantId: i.from,
          invitationId: i.id,
          createdAt: START,
          status: "NEW",
          reply: "",
        });
      if (scenario === "merchant") i.choices[i.from] = "MERCHANT";
      if (scenario === "broadcast") {
        [
          [participants[4], participants[2]],
          [participants[5], participants[3]],
        ].forEach(([a, b], n) => {
          const other = seedInvitation(s, a, b, `broadcast-${n}`);
          other.status = "MEET_ASSIGNED";
          other.acceptedAt = START - 60000;
          other.pointId = s.points[n + 1].id;
          s.points[n + 1].occupant = other.id;
        });
      }
    }
  }
  s.events.push({
    id: "initial",
    at: START,
    type: "SCENARIO",
    text: `本地演示已载入：${SCENARIOS.find((x) => x[0] === scenario)?.[1] || scenario}`,
  });
  return s;
}
function seedInvitation(
  s: DemoState,
  a: Participant,
  b: Participant,
  id: string,
) {
  const i: Invitation = {
    id,
    from: a.id,
    to: b.id,
    status: "SENT",
    createdAt: START - 60000,
    pointId: null,
    departures: {},
    arrivals: {},
    confirmations: {},
    common: commonAnswers(a, b),
    choices: {},
    pass:
      id === "inv-shanfeng-xiaoman"
        ? "A-018"
        : `A-${String(s.invitations.length + 1).padStart(3, "0")}`,
    code:
      id === "inv-shanfeng-xiaoman"
        ? "4721"
        : String(5000 + s.invitations.length),
  };
  s.invitations.push(i);
  a.currentId = id;
  b.currentId = id;
  return i;
}
