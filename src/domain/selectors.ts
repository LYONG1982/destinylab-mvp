import { QUESTIONS } from "@/data/questions";
import type { DemoState, Participant, Invitation } from "./types";
export const ACTIVE_STATUSES = [
  "SENT",
  "ACCEPTED",
  "MEET_ASSIGNED",
  "ARRIVING",
];
export const nowOf = (s: DemoState) =>
  s.now + Math.max(0, Date.now() - s.wallAt);
export const person = (s: DemoState, id: string) =>
  s.participants.find((p) => p.id === id);
export const complete = (p: Participant) =>
  p.profileComplete && QUESTIONS.every((q) => p.answers[q.id]);
export const commonAnswers = (a: Participant, b: Participant) =>
  QUESTIONS.filter(
    (q) => a.answers[q.id] && a.answers[q.id] === b.answers[q.id],
  ).map((q) => ({ questionId: q.id, answer: a.answers[q.id] }));
export function currentInvite(s: DemoState, p: Participant) {
  return s.invitations.find((i) => i.id === p.currentId);
}
export function available(s: DemoState, p: Participant) {
  const i = currentInvite(s, p);
  return (
    p.present &&
    p.ready &&
    !p.paused &&
    complete(p) &&
    (!i || ![...ACTIVE_STATUSES, "CONFIRMED"].includes(i.status))
  );
}
export function recommendations(s: DemoState, id: string) {
  const me = person(s, id);
  if (!me || !complete(me) || me.paused || !me.present) return [];
  return s.participants
    .filter((p) => p.id !== id && p.gender !== me.gender && available(s, p))
    .map((p) => ({ participant: p, common: commonAnswers(me, p) }))
    .filter((p) => p.common.length > 0)
    .sort(
      (a, b) =>
        b.common.length - a.common.length ||
        a.participant.id.localeCompare(b.participant.id),
    )
    .slice(0, 3);
}
export function phase(s: DemoState, p: Participant) {
  if (!p.present) return "已离场";
  if (p.paused) return "暂停推荐";
  if (!p.profileComplete) return p.answers.q1 ? "补充资料" : "刚进入";
  const i = currentInvite(s, p);
  if (i?.status === "SENT") return "等待回应";
  if (i?.status === "ACCEPTED") return "等待相遇点";
  if (i?.status === "MEET_ASSIGNED") return "双方愿意见面";
  if (i?.status === "ARRIVING") return "前往相遇点";
  if (i?.status === "CONFIRMED")
    return i.choices[p.id] ? "已选择下一站" : "已确认见面";
  if (!complete(p)) return "答题中";
  return p.ready ? "探索中" : "先看看";
}
export function routeFor(s: DemoState, p: Participant) {
  if (!p.answers.q1) return "01-start";
  if (!p.profileComplete) return "03-profile";
  const i = currentInvite(s, p);
  if (i?.status === "SENT") return "07-invitation";
  if (i && ["ACCEPTED", "MEET_ASSIGNED"].includes(i.status)) return "08-mutual";
  if (i?.status === "ARRIVING") return "09-meet";
  if (i?.status === "CONFIRMED") return "10-next-step";
  if (!complete(p)) return "04-question";
  return "05-discover";
}
export function stats(s: DemoState) {
  return {
    active: s.participants.filter((p) => p.present).length,
    canMeet: s.participants.filter((p) => available(s, p)).length,
    waiting: s.invitations.filter((i) => i.status === "SENT").length,
    mutual: s.invitations.filter((i) =>
      ["ACCEPTED", "MEET_ASSIGNED"].includes(i.status),
    ).length,
    going: s.invitations.filter((i) => i.status === "ARRIVING").length,
    real: s.invitations.filter((i) => i.realMeetAt).length,
    scans: s.scans.length,
    answered: Object.keys(s.responses).length,
    completed: s.participants.filter(complete).length,
    sent: s.invitations.length,
    merchant: s.invitations.filter((i) =>
      Object.values(i.choices).includes("MERCHANT"),
    ).length,
  };
}
export function distribution(s: DemoState) {
  const total = Object.keys(s.responses).length;
  return QUESTIONS[0].options.map((label) => ({
    label,
    count: Object.values(s.responses).filter((x) => x === label).length,
    percentage: total
      ? Math.round(
          (Object.values(s.responses).filter((x) => x === label).length * 100) /
            total,
        )
      : 0,
  }));
}
export function pendingBroadcast(s: DemoState) {
  const now = nowOf(s);
  return s.invitations.filter(
    (i) =>
      i.acceptedAt &&
      now - i.acceptedAt < 600000 &&
      ["ACCEPTED", "MEET_ASSIGNED", "ARRIVING", "CONFIRMED"].includes(
        i.status,
      ) &&
      !s.broadcastConsumed.includes(i.id),
  );
}
export function screenProjection(s: DemoState) {
  const m = stats(s);
  return {
    active: m.active,
    canMeet: m.canMeet,
    real: m.real,
    question: QUESTIONS[0].title,
    options: distribution(s),
    total: m.answered,
    canBroadcast: pendingBroadcast(s).length >= 3,
    paused: s.activityPaused,
  };
}
export function counterpart(i: Invitation, actor: string) {
  return i.from === actor ? i.to : i.from;
}
export function nicknameError(value: string) {
  if (!value) return "先起一个昵称吧。";
  if ([...value].length > 5) return "昵称最多 5 个汉字，请缩短一点。";
  if (!/^[\u4e00-\u9fff]{1,5}$/.test(value)) return "昵称请只使用汉字。";
  return "";
}
export function alerts(s: DemoState) {
  const now = nowOf(s);
  return s.invitations.flatMap((i) => {
    if (i.status === "SENT" && now - i.createdAt >= 600000)
      return [
        {
          id: i.id,
          text: "邀请等待超过 10 分钟",
          detail: "可以查看详情或结束本次等待",
        },
      ];
    const arrived = Object.values(i.arrivals);
    if (
      i.status === "ARRIVING" &&
      arrived.length === 1 &&
      now - arrived[0] >= 180000
    )
      return [
        {
          id: i.id,
          text: "相遇点单方等候超过 3 分钟",
          detail: "请关注尚未到达的一方",
        },
      ];
    return [];
  });
}
