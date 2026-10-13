import { validAvatar } from "@/config/avatars";
import { applyTongzhouCommand, isTongzhouCommand } from "./tongzhou";
import { AGES, QUESTIONS } from "@/data/questions";
import type {
  CommandEnvelope,
  DemoState,
  DomainEvent,
  Invitation,
} from "./types";
import {
  ACTIVE_STATUSES,
  available,
  commonAnswers,
  currentInvite,
  nicknameError,
  nowOf,
  pendingBroadcast,
  person,
} from "./selectors";
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function applyCommand(
  source: DemoState,
  envelope: CommandEnvelope,
  at = nowOf(source),
): DemoState {
  ensure(envelope.epoch === source.epoch, "演示场景已更新，请重新操作。");
  const key = `${envelope.actor}:${envelope.id}`;
  if (source.commands.includes(key)) return source;
  if (isTongzhouCommand(envelope.command))
    return applyTongzhouCommand(source, envelope, at);
  const s = structuredClone(source);
  s.now = at;
  s.wallAt = Date.now();
  const { command: c, actor } = envelope;
  const me = person(s, actor);
  const log = (
    type: string,
    text: string,
    invitationId?: string,
    participantId?: string,
  ) => {
    const event: DomainEvent = {
      id: `${envelope.id}-${s.events.length}`,
      at,
      type,
      text,
      invitationId,
      participantId,
    };
    s.events.push(event);
  };
  const admin = () => ensure(actor === "operator", "此操作需要现场运营身份。");
  const participant = () => {
    ensure(me, "请先从演示入口选择参与者。");
    return me;
  };
  const related = (id: string, operator = false) => {
    const i = s.invitations.find((v) => v.id === id);
    ensure(i, "本次邀请不存在。");
    ensure(
      (operator && actor === "operator") || i.from === actor || i.to === actor,
      "这不是你的相遇任务。",
    );
    if (actor !== "operator")
      ensure(me?.currentId === i.id, "当前相遇任务已变更，请刷新后继续。");
    return i;
  };
  const close = (i: Invitation, status: Invitation["status"]) => {
    i.status = status;
    const p = s.points.find((p) => p.occupant === i.id);
    if (p && Object.keys(i.departures).length === 0) p.occupant = null;
  };
  s.invitations
    .filter((i) => i.status === "SENT" && at - i.createdAt >= 900000)
    .forEach((i) => {
      close(i, "EXPIRED");
      log("EXPIRED", "一条邀请已过期", i.id);
    });
  switch (c.type) {
    case "answer": {
      const p = participant();
      const q = QUESTIONS.find((q) => q.id === c.questionId);
      ensure(
        q && (q.options as readonly string[]).includes(c.value),
        "请选择有效答案。",
      );
      p.answers[c.questionId] = c.value;
      if (c.questionId === "q1") s.responses[p.id] = c.value;
      log("ANSWER", `${p.name}完成了一道轻问题`, undefined, p.id);
      break;
    }
    case "profile": {
      const p = participant();
      ensure(
        !currentInvite(s, p) ||
          !ACTIVE_STATUSES.includes(currentInvite(s, p)!.status),
        "请先结束当前邀请再修改资料。",
      );
      ensure(!nicknameError(c.name), nicknameError(c.name));
      ensure(AGES.includes(c.age), "请选择年龄段。");
      ensure(["male", "female"].includes(c.gender), "请选择性别。");
      ensure(validAvatar(c.avatarId, c.gender), "选一个本次活动头像吧。");
      Object.assign(p, {
        avatarId: c.avatarId,
        name: c.name,
        gender: c.gender,
        age: c.age,
        ready: c.ready,
        profileComplete: true,
        present: true,
      });
      log("PROFILE", `${p.name}完善了资料`, undefined, p.id);
      break;
    }
    case "ready": {
      const p = participant();
      ensure(p.present && !p.paused, "当前无法加入推荐，请联系现场工作人员。");
      ensure(
        !p.currentId ||
          !ACTIVE_STATUSES.includes(currentInvite(s, p)?.status || ""),
        "请先结束当前邀请再调整见面状态。",
      );
      p.ready = c.value;
      log(
        "READY",
        `${p.name}${c.value ? "准备认识新朋友" : "想先看看"}`,
        undefined,
        p.id,
      );
      break;
    }
    case "invite": {
      const p = participant();
      ensure(!s.activityPaused, "现场暂时暂停新邀请，稍后再来看看。");
      const target = person(s, c.targetId);
      ensure(target, "对方暂时不可见。");
      ensure(available(s, p), "请先完成探索、准备见面，并结束当前相遇任务。");
      ensure(
        available(s, target) &&
          target.gender !== p.gender &&
          p.id !== target.id,
        "对方当前不方便接受邀请，请再看看其他人。",
      );
      const common = commonAnswers(p, target);
      ensure(common.length, "暂时没有共同答案。");
      const id = `inv-${envelope.id}`;
      const standard =
        p.id === "p-shanfeng" &&
        target.id === "p-xiaoman" &&
        !s.invitations.some((i) => i.pass === "A-018");
      const i: Invitation = {
        id,
        from: p.id,
        to: target.id,
        status: "SENT",
        createdAt: at,
        pointId: null,
        departures: {},
        arrivals: {},
        confirmations: {},
        common,
        choices: {},
        pass: standard
          ? "A-018"
          : `A-${String(s.invitations.length + 1).padStart(3, "0")}`,
        code: standard
          ? "4721"
          : String(1000 + ((s.invitations.length * 137) % 9000)),
      };
      s.invitations.push(i);
      p.currentId = id;
      target.currentId = id;
      log("SENT", `${p.name}向${target.name}发出了邀请`, id, p.id);
      break;
    }
    case "accept": {
      const i = related(c.invitationId);
      ensure(i.to === actor, "只有收到邀请的人可以接受。");
      ensure(i.status === "SENT", "邀请状态已变化，请查看当前任务。");
      ensure(
        me?.present && !me.paused && me.ready,
        "你当前不方便见面，请先恢复参与状态。",
      );
      const sender = person(s, i.from);
      ensure(sender?.present && !sender.paused, "对方暂时离开了现场。");
      i.status = "ACCEPTED";
      i.acceptedAt = at;
      log(
        "MUTUAL",
        `${person(s, i.from)?.name}与${me.name}都愿意认识彼此`,
        i.id,
      );
      break;
    }
    case "decline": {
      const i = related(c.invitationId);
      ensure(i.to === actor && i.status === "SENT", "当前无法回应这条邀请。");
      close(i, "DECLINED");
      log("CLOSED", "本次邀请已结束", i.id);
      break;
    }
    case "cancel": {
      const i = related(c.invitationId, true);
      ensure(ACTIVE_STATUSES.includes(i.status), "本次邀请已经结束。");
      close(i, "CANCELLED");
      log("CLOSED", "本次相遇安排已结束", i.id);
      break;
    }
    case "depart": {
      const i = related(c.invitationId);
      ensure(
        ["MEET_ASSIGNED", "ARRIVING"].includes(i.status) && i.pointId,
        "请等待相遇点分配。",
      );
      if (!i.departures[actor]) {
        i.departures[actor] = at;
        log("DEPART", `${me?.name}已确认出发`, i.id, actor);
      }
      i.status = "ARRIVING";
      break;
    }
    case "arrive": {
      const i = related(c.invitationId);
      ensure(i.status === "ARRIVING" && i.departures[actor], "请先确认出发。");
      if (!i.arrivals[actor]) {
        i.arrivals[actor] = at;
        log("ARRIVE", `${me?.name}已确认到达`, i.id, actor);
      }
      break;
    }
    case "confirm": {
      const i = related(c.invitationId);
      ensure(
        ["ARRIVING", "CONFIRMED"].includes(i.status),
        "当前不能确认见面。",
      );
      ensure(
        i.arrivals[i.from] && i.arrivals[i.to],
        "请等待双方都确认到达后再确认见面。",
      );
      if (!i.confirmations[actor]) {
        i.confirmations[actor] = at;
        log("CONFIRM", `${me?.name}已确认见到对方`, i.id, actor);
      }
      if (i.confirmations[i.from] && i.confirmations[i.to] && !i.realMeetAt) {
        i.realMeetAt = at;
        i.status = "CONFIRMED";
        log("REAL_MEET", "双方已确认真实见面，新增一次真实相遇", i.id);
      }
      break;
    }
    case "help": {
      const i = related(c.invitationId);
      ensure(
        [...ACTIVE_STATUSES, "CONFIRMED"].includes(i.status),
        "本次任务已经结束。",
      );
      if (
        !s.helps.some(
          (h) =>
            h.participantId === actor &&
            h.invitationId === i.id &&
            h.status !== "RESOLVED",
        )
      ) {
        s.helps.push({
          id: `help-${envelope.id}`,
          participantId: actor,
          invitationId: i.id,
          createdAt: at,
          status: "NEW",
          reply: "",
        });
        log("HELP", `${me?.name}需要工作人员帮助`, i.id, actor);
      }
      break;
    }
    case "next": {
      const i = related(c.invitationId);
      ensure(i.status === "CONFIRMED", "双方确认见面后才可以选择下一站。");
      ensure(
        ["WALK", "MERCHANT", "END"].includes(c.choice),
        "请选择有效去向。",
      );
      if (c.choice === "MERCHANT")
        ensure(
          s.merchants.some((m) => m.id === "cloud" && m.active),
          "云影咖啡暂时停止推荐。",
        );
      i.choices[actor] = c.choice;
      if (c.choice === "MERCHANT" && !s.merchantViews.includes(`${i.id}:cloud`))
        s.merchantViews.push(`${i.id}:cloud`);
      log("NEXT", `${me?.name}已选择自己的下一站`, i.id, actor);
      break;
    }
    case "rediscover": {
      const p = participant();
      const i = related(c.invitationId);
      ensure(
        !ACTIVE_STATUSES.includes(i.status),
        "请先结束当前邀请再继续探索。",
      );
      if (i.status === "CONFIRMED" && !i.choices[actor])
        i.choices[actor] = "END";
      p.currentId = null;
      p.ready = true;
      p.present = true;
      log("REDISCOVER", `${p.name}主动返回探索`, undefined, p.id);
      break;
    }
    case "merchant-view": {
      const i = related(c.invitationId);
      ensure(i.status === "CONFIRMED", "请先完成双方见面确认。");
      const view = `${i.id}:${c.merchantId}`;
      if (!s.merchantViews.includes(view)) s.merchantViews.push(view);
      break;
    }
    case "pause":
      admin();
      s.activityPaused = c.value;
      log("PAUSE", c.value ? "现场已暂停新邀请" : "现场已恢复新邀请");
      break;
    case "participant": {
      admin();
      const p = person(s, c.participantId);
      ensure(p, "参与者不存在。");
      if (c.action === "pause") p.paused = true;
      else if (c.action === "resume") p.paused = false;
      else if (c.action === "leave") {
        p.present = false;
        p.ready = false;
        const i = currentInvite(s, p);
        if (i && ACTIVE_STATUSES.includes(i.status)) close(i, "CANCELLED");
      } else if (c.action === "hint")
        log(
          "HINT",
          "工作人员提示：如需帮助，请前往主屏右侧服务点。",
          undefined,
          p.id,
        );
      log(
        "PARTICIPANT",
        `${p.name}：${{ pause: "暂停推荐", resume: "恢复推荐", leave: "标记离场", hint: "发送现场提示" }[c.action]}`,
        undefined,
        p.id,
      );
      break;
    }
    case "help-status": {
      admin();
      const h = s.helps.find((h) => h.id === c.helpId);
      ensure(h, "帮助请求不存在。");
      ensure(["ACK", "RESOLVED"].includes(c.status), "请选择处理状态。");
      h.status = c.status;
      h.reply =
        c.status === "ACK"
          ? "工作人员已接单，请在相遇点附近稍候。"
          : "本次帮助已处理。如仍有需要，可以再次求助。";
      log("HELP_STATUS", h.reply, h.invitationId, h.participantId);
      break;
    }
    case "point-status": {
      admin();
      const point = s.points.find((p) => p.id === c.pointId);
      ensure(point, "相遇点不存在。");
      ensure(!point.occupant, "请先结束安排并确认场地空闲，再修改开放状态。");
      point.closed = !c.enabled;
      log("POINT_STATUS", `${point.name}${c.enabled ? "已启用" : "已停用"}`);
      break;
    }
    case "release": {
      admin();
      const p = s.points.find((p) => p.id === c.pointId);
      ensure(p, "相遇点不存在。");
      const i = s.invitations.find((i) => i.id === p.occupant);
      ensure(
        !i || !ACTIVE_STATUSES.includes(i.status),
        "请先结束进行中的安排，再确认场地已空闲。",
      );
      p.occupant = null;
      p.closed = false;
      log("RELEASE", `${p.name}已确认空闲`);
      break;
    }
    case "merchant": {
      admin();
      const m = s.merchants.find((m) => m.id === c.merchantId);
      ensure(m, "商户不存在。");
      m.active = c.active;
      log("MERCHANT", `${m.name}${c.active ? "开启" : "暂停"}推荐`);
      break;
    }
    case "advance":
      admin();
      ensure(c.minutes > 0 && c.minutes <= 120, "时间推进范围为 1–120 分钟。");
      s.now += c.minutes * 60000;
      break;
    case "broadcast-consume":
      admin();
      {
        const pending = pendingBroadcast(s);
        ensure(pending.length >= 3, "当前不满足聚合播报条件。");
        s.broadcastConsumed.push(...pending.map((i) => i.id));
        break;
      }
    case "sweep":
      break;
  }
  // Reconcile expiry after explicit clock advance, then assign only truly vacant resources.
  s.invitations
    .filter((i) => i.status === "SENT" && s.now - i.createdAt >= 900000)
    .forEach((i) => {
      close(i, "EXPIRED");
      log("EXPIRED", "一条邀请已过期", i.id);
    });
  for (const i of s.invitations.filter((i) => i.status === "ACCEPTED")) {
    const p = s.points.find((p) => !p.occupant && !p.closed);
    if (!p) break;
    p.occupant = i.id;
    i.pointId = p.id;
    i.status = "MEET_ASSIGNED";
    log("ASSIGNED", `系统分配了 ${p.name}`, i.id);
  }
  s.commands.push(key);
  s.revision++;
  return s;
}
