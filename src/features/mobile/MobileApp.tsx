"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AvatarSelector } from "@/components/shared/AvatarSelector";
import { validAvatar } from "@/config/avatars";
import { AGES, QUESTIONS, STATUS_LABELS } from "@/data/questions";
import type {
  DemoState,
  Participant,
  Invitation,
  Gender,
} from "@/domain/types";
import {
  ACTIVE_STATUSES,
  commonAnswers,
  complete,
  counterpart,
  currentInvite,
  distribution,
  nicknameError,
  person,
  recommendations,
  routeFor,
  stats,
} from "@/domain/selectors";
import { useAction, useDemo } from "@/lib/demo/hooks";
import {
  Avatar,
  Badge,
  Brand,
  Button,
  DemoLink,
  Empty,
  Footer,
  Icon,
  Loading,
  Modal,
  Notice,
} from "@/components/ui";

import {
  QuestionTransition,
  DestinyProgressTrack,
} from "@/components/motion/QuestionTransition";

import { CommonAnswerLink } from "@/components/motion/CommonAnswerLink";
import { SignalArrival, useSendSignal } from "@/components/motion/SignalMotion";
import { MutualEncounterMotion } from "@/components/motion/MutualEncounterMotion";
import { MeetStatusTrack } from "@/components/motion/MeetStatusTrack";
import { Motion, Ambient } from "@/components/motion/Motion";
import { getSnapshot } from "@/lib/demo/store";

import { AnimatedCounter } from "@/components/motion/AnimatedCounter";
import { PresenceIndicator } from "@/components/motion/PresenceIndicator";
import { RouteDraw } from "@/components/motion/RouteDraw";
import { DestinyTrack } from "@/components/motion/DestinyTrack";
import { useCityResponse } from "@/components/motion/CityResponseToast";
import { motionTiming } from "@/lib/motion-tokens";

type Actions = ReturnType<typeof useAction>;
export function MobileApp({ page }: { page: string }) {
  const { state, actor, problem } = useDemo();
  if (!state) return <Loading />;
  const me = person(state, actor);
  if (!me)
    return (
      <div className="loading">
        <p>请选择参与者身份</p>
        <Link href="/demo">返回演示入口</Link>
      </div>
    );
  return (
    <MobileFlow
      key={`${state.epoch}:${actor}`}
      state={state}
      me={me}
      page={page}
      problem={problem}
    />
  );
}
function MobileFlow({
  state: s,
  me,
  page,
  problem,
}: {
  state: DemoState;
  me: Participant;
  page: string;
  problem: string;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const a = useAction(me.id);
  const sendSignal = useSendSignal();
  const inv = currentInvite(s, me);
  const candidates = recommendations(s, me.id);
  const invitationBlocked =
    !!inv && [...ACTIVE_STATUSES, "CONFIRMED"].includes(inv.status);
  const currentTaskLabel =
    inv?.status === "SENT"
      ? "查看当前邀请"
      : inv?.status === "CONFIRMED"
        ? "前往下一站"
        : "查看当前相遇";
  const invitationMessage =
    inv?.status === "SENT"
      ? `${inv.from === me.id ? "你发出的邀请正在等待回应" : "你收到了一条待回应的邀请"}。请先处理当前邀请，暂时不能再发出新邀请。`
      : inv?.status === "CONFIRMED"
        ? "你已完成这次相遇。请先前往下一站，选择“我想继续探索”，再发出新邀请。"
        : "你正在进行一次相遇。结束当前相遇前，暂时不能再发出新邀请。";
  const [inviteModal, setInviteModal] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const target = person(s, query.get("target") || "p-xiaoman");
  const go = (p: string, targetId?: string) =>
    router.push(`/mobile/${p}${targetId ? `?target=${targetId}` : ""}`);
  useEffect(() => {
    let destination = "";
    const n = Number(page.slice(0, 2));
    if (n > 2 && !me.answers.q1) destination = "01-start";
    else if (n > 3 && !me.profileComplete) destination = "03-profile";
    else if (n >= 5 && !complete(me)) destination = "04-question";
    else if (n >= 7 && !inv) destination = "05-discover";
    else if (n === 8 && inv?.status === "SENT") destination = "07-invitation";
    else if (n === 9 && inv?.status === "CONFIRMED")
      destination = "10-next-step";
    else if (
      n >= 8 &&
      inv &&
      ["DECLINED", "CANCELLED", "EXPIRED", "MEET_FAILED"].includes(inv.status)
    )
      destination = "07-invitation";
    else if (n === 10 && inv?.status !== "CONFIRMED")
      destination = inv?.status === "SENT" ? "07-invitation" : "09-meet";
    if (destination && destination !== page)
      router.replace(`/mobile/${destination}`);
  }, [s.epoch, me, page, inv, router]);
  const hero = (eyebrow: string, title: React.ReactNode, subtitle?: string) => (
    <div className="page-hero">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
  const titleBlock = () => {
    switch (page) {
      case "02-result":
        return hero(
          "A LITTLE IN COMMON",
          <>
            原来，有人
            <br />
            和你<span>想得一样</span>
          </>,
          "从一个共同话题，开始认识",
        );
      case "03-profile":
        return hero(
          "NICE TO MEET YOU",
          <>
            先认识<span>一下你</span>
          </>,
          "留下一个昵称，准备好后再加入现场推荐",
        );
      case "05-discover":
        return hero(
          "SOMEONE LIKE YOU",
          <>
            看看现在
            <br />
            可以<span>认识谁</span>
          </>,
          "现场与你同频的人",
        );
      case "06-common":
        return hero(
          "THINGS WE SHARE",
          <>
            共同答案<span>与邀请</span>
          </>,
          "相似的想法，让靠近变得自然",
        );
      case "07-invitation":
        return hero(
          "AN INVITATION TO MEET",
          inv?.to === me.id ? (
            <>
              收到<span>见面邀请</span>
            </>
          ) : (
            <>
              邀请已经<span>送出</span>
            </>
          ),
          "从一个共同话题，走向真实的相遇",
        );
      case "08-mutual":
        return hero(
          "THE FEELING IS MUTUAL",
          <>
            你们都愿意
            <br />
            <span>认识彼此</span>
          </>,
          "那就去见一面吧",
        );
      case "09-meet":
        return hero(
          "A REAL MOMENT",
          <>
            去{" "}
            <span>
              {s.points.find((p) => p.id === inv?.pointId)?.name || "相遇点"}
            </span>{" "}
            见面
          </>,
          "一次认真相遇，从这里开始",
        );
      case "10-next-step":
        return hero(
          "THE STORY GOES ON",
          <>
            相遇后的<span>下一站</span>
          </>,
          "接下来，你想怎么继续？",
        );
      default:
        return null;
    }
  };
  const other = inv ? person(s, counterpart(inv, me.id)) : null;
  const help = inv
    ? s.helps
        .filter((h) => h.participantId === me.id && h.invitationId === inv.id)
        .at(-1)
    : null;
  const hint = s.events
    .filter((e) => e.type === "HINT" && e.participantId === me.id)
    .at(-1);
  const notices = (
    <>
      {hint && <Notice>{hint.text}</Notice>}
      {problem && <Notice tone="error">{problem}</Notice>}
      {a.error && <Notice tone="error">{a.error}</Notice>}
    </>
  );
  return (
    <main
      className={`mobile-shell ${page === "01-start" ? "start-shell" : ""}`}
    >
      <header className="mobile-header">
        <Brand />
        <span>
          好的相遇
          <br />
          让一座城更温柔
        </span>
      </header>
      {page !== "01-start" && (
        <div className="mobile-utility">
          <button
            className="back-link"
            onClick={() => {
              const back: Record<string, string> = {
                "02-result": "01-start",
                "03-profile": "02-result",
                "04-question": "03-profile",
                "05-discover": "04-question",
                "06-common": "05-discover",
                "07-invitation": "05-discover",
                "08-mutual": "05-discover",
                "09-meet": "08-mutual",
                "10-next-step": "05-discover",
              };
              go(back[page] || "01-start");
            }}
          >
            <Icon name="back" size={16} />
            返回
          </button>
          <span>
            {me.name} · {me.gender === "male" ? "男生" : "女生"}
          </span>
        </div>
      )}
      {page === "01-start" ? (
        <Start me={me} action={a} onNext={() => go("02-result")} />
      ) : (
        <>
          {titleBlock()}
          {["02-result", "05-discover"].includes(page) && (
            <PresenceIndicator count={stats(s).active} />
          )}
          <div className="mobile-content">
            {notices}
            {page === "02-result" && (
              <Result
                state={s}
                me={me}
                onContinue={() => go("03-profile")}
                onBack={() => go("01-start")}
              />
            )}
            {page === "03-profile" && (
              <Profile me={me} action={a} onNext={() => go("04-question")} />
            )}
            {page === "04-question" && (
              <Questions me={me} action={a} onNext={() => go("05-discover")} />
            )}
            {page === "05-discover" && (
              <>
                {s.activityPaused && (
                  <Notice>现场暂时暂停新邀请。你可以先看看共同答案。</Notice>
                )}
                {!me.ready && (
                  <Notice>
                    你正在先看看，暂不向别人推荐你。准备好后可以加入。
                  </Notice>
                )}
                {me.paused && (
                  <Notice>推荐已暂停，如需恢复请联系现场工作人员。</Notice>
                )}
                {inv && (
                  <Link
                    className="task-banner"
                    href={`/mobile/${routeFor(s, me) === "05-discover" ? "07-invitation" : routeFor(s, me)}`}
                  >
                    <Icon name="heart" />
                    <span>
                      {STATUS_LABELS[inv.status]}
                      <small>查看你的相遇任务</small>
                    </span>
                    <Icon name="arrow" />
                  </Link>
                )}
                <div className="section-line">
                  <span>{candidates.length} 位可以认识的人</span>
                  <span>不必着急，慢慢来</span>
                </div>
                {candidates.length === 0 ? (
                  <Empty title="现在和你同频的人还不多。">
                    可以先逛逛鼓楼，稍后再回来看看。
                  </Empty>
                ) : (
                  candidates.map(({ participant: p, common }, index) => (
                    <Motion
                      as="article"
                      delay={index * motionTiming.cardGap}
                      className={`recommend-card ${index === 0 ? "featured" : ""}`}
                      key={p.id}
                    >
                      <div className="person-row">
                        <Avatar person={p} size="lg" />
                        <div>
                          <h2>{p.name}</h2>
                          <p>
                            {p.gender === "male" ? "男生" : "女生"} · {p.age} 岁
                          </p>
                          <p className="common-count">
                            有 <strong>{common.length}</strong> 道答案相同
                          </p>
                        </div>
                      </div>
                      <div className="shared-highlight">
                        <Icon name={index === 0 ? "heart" : "leaf"} />
                        <span>
                          <small>从这个共同点开始</small>你们都选择了「
                          {common[0].answer}」
                        </span>
                      </div>
                      <Button
                        kind={index === 0 ? "primary" : "secondary"}
                        onClick={() => go("06-common", p.id)}
                      >
                        看看共同答案
                        <Icon name="arrow" size={18} />
                      </Button>
                    </Motion>
                  ))
                )}
                {candidates.length > 0 && candidates.length < 3 && (
                  <Notice>
                    当前推荐已全部展示，暂时没有更多同频的人，可以稍后再来看看。
                  </Notice>
                )}
                {!me.ready && (
                  <Button
                    disabled={a.busy}
                    onClick={() => a.run({ type: "ready", value: true })}
                  >
                    我现在可以见面了
                  </Button>
                )}
                <p className="fine center">系统虚拟头像，不代表本人长相</p>
              </>
            )}
            {page === "06-common" &&
              (target && target.id !== me.id ? (
                <>
                  <PersonCard p={target} />
                  <CommonAnswerLink
                    key={target.id}
                    common={commonAnswers(me, target)}
                  />
                  {invitationBlocked ? (
                    <Notice>
                      <span id="invite-unavailable-reason">
                        {invitationMessage}
                      </span>
                      <Link
                        className="notice-action"
                        href={`/mobile/${routeFor(s, me)}`}
                      >
                        {currentTaskLabel}
                        <Icon name="arrow" size={16} />
                      </Link>
                    </Notice>
                  ) : s.activityPaused ? (
                    <Notice>
                      <span id="invite-unavailable-reason">
                        现场暂时暂停新邀请。你可以先看看共同答案，恢复后再发出邀请。
                      </span>
                    </Notice>
                  ) : (
                    <Notice>
                      可以从「
                      {commonAnswers(me, target)[0]?.answer || "今天的鼓楼"}
                      」开始聊起。
                    </Notice>
                  )}
                  <Button
                    disabled={a.busy || s.activityPaused || invitationBlocked}
                    aria-describedby={
                      invitationBlocked || s.activityPaused
                        ? "invite-unavailable-reason"
                        : undefined
                    }
                    onClick={() => setInviteModal(true)}
                  >
                    想认识 TA
                    <Icon name="arrow" />
                  </Button>
                  <Button kind="text" onClick={() => go("05-discover")}>
                    返回推荐列表
                  </Button>
                  <p className="fine center">双方都愿意，才会安排见面。</p>
                </>
              ) : (
                <Empty title="这位朋友暂时不可见">
                  <Button onClick={() => go("05-discover")}>回到发现</Button>
                </Empty>
              ))}
            {page === "07-invitation" && inv && other && (
              <>
                {inv.status === "SENT" && inv.to === me.id ? (
                  <SignalArrival
                    key={inv.id}
                    identity={`${s.epoch}:${me.id}:${inv.id}`}
                  >
                    <p className="invitation-caption">{other.name}想认识你</p>
                    <PersonCard p={other} />
                  </SignalArrival>
                ) : (
                  <PersonCard p={other} />
                )}
                <CommonList common={inv.common.slice(0, 3)} />
                {inv.status === "SENT" ? (
                  <>
                    {inv.to === me.id ? (
                      <>
                        <Notice>
                          TA 想从一个共同话题开始认识你。你的决定，由你自己做。
                        </Notice>
                        <Button
                          disabled={a.busy}
                          onClick={() =>
                            a.run(
                              { type: "accept", invitationId: inv.id },
                              () => go("08-mutual"),
                            )
                          }
                        >
                          我也愿意认识
                          <Icon name="heart" />
                        </Button>
                        <Button
                          kind="secondary"
                          disabled={a.busy}
                          onClick={() =>
                            a.run({ type: "decline", invitationId: inv.id })
                          }
                        >
                          暂时不见面
                        </Button>
                        <p className="fine center">
                          暂时不见面时，不向对方说明原因。
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="waiting-state" aria-live="polite">
                          <Ambient>
                            <span className="pulse-dot" />
                          </Ambient>
                          <h2>等待 {other.name} 回应</h2>
                          <p>
                            TA 可以按自己的节奏决定。
                            <br />
                            你也可以先逛逛鼓楼。
                          </p>
                          <small>邀请将在发出 15 分钟后过期</small>
                        </div>
                        <Button
                          kind="secondary"
                          onClick={() => go("05-discover")}
                        >
                          先看看现场
                        </Button>
                        <Button
                          kind="text"
                          onClick={() => setConfirmExit(true)}
                        >
                          撤回这次邀请
                        </Button>
                      </>
                    )}
                  </>
                ) : [
                    "DECLINED",
                    "CANCELLED",
                    "EXPIRED",
                    "MEET_FAILED",
                  ].includes(inv.status) ? (
                  <>
                    <Notice>
                      {STATUS_LABELS[inv.status]}
                      。每个人都有自己的节奏，下一次相遇也值得期待。
                    </Notice>
                    <Button
                      disabled={a.busy}
                      onClick={() =>
                        a.run(
                          { type: "rediscover", invitationId: inv.id },
                          () => go("05-discover"),
                        )
                      }
                    >
                      继续探索
                      <Icon name="arrow" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Notice tone="success">你们都愿意认识彼此。</Notice>
                    <Button onClick={() => go(routeFor(s, me))}>
                      查看相遇任务
                      <Icon name="arrow" />
                    </Button>
                  </>
                )}
              </>
            )}
            {page === "08-mutual" && inv && other && (
              <>
                <MutualEncounterMotion
                  me={me}
                  other={other}
                  identity={`${s.epoch}:${me.id}:${inv.id}`}
                  pointName={s.points.find((p) => p.id === inv.pointId)?.name}
                />
                {inv.pointId ? (
                  <>
                    <div className="meet-ticket">
                      <div className="eyebrow">— 相遇点 —</div>
                      <h2>
                        {s.points.find((p) => p.id === inv.pointId)?.name}
                      </h2>
                      <p>
                        <Icon name="pin" />
                        {s.points.find((p) => p.id === inv.pointId)?.location}
                      </p>
                    </div>
                    <Notice tone="success">
                      {inv.departures[other.id]
                        ? "TA 已确认出发"
                        : "TA 也愿意见面，尚未确认出发。"}
                    </Notice>
                    <Button onClick={() => go("09-meet")}>
                      查看见面指引
                      <Icon name="arrow" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Empty title="正在等候相遇点">
                      你们的意愿已保留。空位准备好后，这里会自动更新。
                    </Empty>
                    <Notice>工作人员正在协调相遇点，请稍候。</Notice>
                  </>
                )}
                <Button kind="text" onClick={() => setConfirmExit(true)}>
                  暂时不见面
                </Button>
              </>
            )}
            {page === "09-meet" && inv && other && (
              <>
                <div className="meet-ticket pass-ticket">
                  <div className="pass-top">
                    <span>
                      MEET
                      <br />
                      <strong>
                        {s.points
                          .find((p) => p.id === inv.pointId)
                          ?.name.replace("Meet", "") || "—"}
                      </strong>
                    </span>
                    <div>
                      <small>DESTINY LAB</small>
                      <p>
                        一次认真的线下见面
                        <br />
                        从这里开始
                      </p>
                      <Badge>{inv.pass}</Badge>
                    </div>
                  </div>
                  <div className="ticket-row">
                    <Icon name="pin" />
                    <span>
                      <strong>见面地点</strong>
                      <small>
                        {s.points.find((p) => p.id === inv.pointId)?.location ||
                          "等待分配"}
                      </small>
                    </span>
                  </div>
                  <div className="ticket-row">
                    <Icon name="walk" />
                    <span>
                      <strong>
                        步行约{" "}
                        {s.points.find((p) => p.id === inv.pointId)?.distance ||
                          40}{" "}
                        米
                      </strong>
                      <small>跟随现场指引，轻松找到见面点</small>
                    </span>
                  </div>
                  <div className="verification-code">
                    <small>本次辨认码</small>
                    <Motion
                      as="span"
                      className="code-motion"
                      preset="code"
                      key={inv.id}
                    >
                      <strong>{inv.code}</strong>
                    </Motion>
                    <span>到场后核对昵称与辨认码，不凭默认头像认人。</span>
                  </div>
                </div>
                <MeetStatusTrack
                  people={[me, other]}
                  invitation={inv}
                  pointName={
                    s.points.find((p) => p.id === inv.pointId)?.name ||
                    "等待分配"
                  }
                />
                <div className="arrival-status">
                  <PersonStatus p={me} inv={inv} />
                  <PersonStatus p={other} inv={inv} />
                </div>
                {help && (
                  <Notice
                    tone={help.status === "RESOLVED" ? "success" : "info"}
                  >
                    {help.reply || "帮助请求已送达，等待工作人员接单。"}
                  </Notice>
                )}
                {!inv.pointId ? (
                  <Button onClick={() => go("08-mutual")}>等待相遇点</Button>
                ) : !inv.departures[me.id] ? (
                  <Button
                    disabled={a.busy}
                    onClick={() =>
                      a.run({ type: "depart", invitationId: inv.id })
                    }
                  >
                    确认出发
                    <Icon name="arrow" />
                  </Button>
                ) : !inv.arrivals[me.id] ? (
                  <Button
                    disabled={a.busy}
                    onClick={() =>
                      a.run({ type: "arrive", invitationId: inv.id })
                    }
                  >
                    我已经到了
                    <Icon name="check" />
                  </Button>
                ) : !inv.arrivals[other.id] ? (
                  <Button disabled>已到达，等待 TA</Button>
                ) : !inv.confirmations[me.id] ? (
                  <Button
                    disabled={a.busy}
                    onClick={() =>
                      a.run({ type: "confirm", invitationId: inv.id })
                    }
                  >
                    我已经见到 TA
                    <Icon name="check" />
                  </Button>
                ) : (
                  <Button disabled>等待 TA 确认见面</Button>
                )}
                <Button
                  kind="secondary"
                  disabled={a.busy}
                  onClick={() => a.run({ type: "help", invitationId: inv.id })}
                >
                  需要工作人员帮助
                  <Icon name="help" />
                </Button>
                <div className="inline-actions">
                  <button
                    onClick={() =>
                      a.run({ type: "help", invitationId: inv.id })
                    }
                  >
                    还没找到 TA
                  </button>
                  <button onClick={() => setConfirmExit(true)}>
                    结束本次安排
                  </button>
                </div>
              </>
            )}
            {page === "10-next-step" && inv && (
              <NextStep
                state={s}
                me={me}
                inv={inv}
                action={a}
                onExplore={() =>
                  a.run({ type: "rediscover", invitationId: inv.id }, () =>
                    go("05-discover"),
                  )
                }
              />
            )}
          </div>
        </>
      )}
      {page === "01-start" && <div className="mobile-content">{notices}</div>}
      <Footer />
      <DemoLink />
      {inviteModal && target && (
        <Modal
          title={`想认识“${target.name}”？`}
          onClose={() => setInviteModal(false)}
        >
          <PersonCard p={target} />
          <p>
            TA
            会看到你的昵称、默认头像、性别、年龄段和共同答案。联系方式不会自动分享。
          </p>
          {!me.ready && (
            <Notice>
              你选择了先看看。请先明确切换为“现在可以见面”，再发出邀请。
            </Notice>
          )}
          {!me.ready ? (
            <Button
              disabled={a.busy}
              onClick={() => a.run({ type: "ready", value: true })}
            >
              我现在可以见面
            </Button>
          ) : (
            <Button
              disabled={a.busy}
              onClick={() =>
                a.run({ type: "invite", targetId: target.id }, () => {
                  const saved = getSnapshot();
                  const created =
                    saved && currentInvite(saved, person(saved, me.id)!);
                  if (saved && created?.status === "SENT")
                    sendSignal({
                      epoch: saved.epoch,
                      actor: me.id,
                      invitationId: created.id,
                      target: target.name,
                    });
                  setInviteModal(false);
                  go("07-invitation");
                })
              }
            >
              发出邀请
            </Button>
          )}
          {a.error && <Notice tone="error">{a.error}</Notice>}
          <Button kind="text" onClick={() => setInviteModal(false)}>
            再想想
          </Button>
        </Modal>
      )}
      {confirmExit && inv && (
        <Modal title="结束这次相遇安排？" onClose={() => setConfirmExit(false)}>
          <p>
            对方会看到本次安排已结束，不会收到你的私人理由。你之后仍可主动继续探索。
          </p>
          <Button
            disabled={a.busy}
            onClick={() =>
              a.run({ type: "cancel", invitationId: inv.id }, () => {
                setConfirmExit(false);
                go("07-invitation");
              })
            }
          >
            确认结束
          </Button>
          {a.error && <Notice tone="error">{a.error}</Notice>}
          <Button kind="text" onClick={() => setConfirmExit(false)}>
            继续这次相遇
          </Button>
        </Modal>
      )}
    </main>
  );
}
function Start({
  me,
  action: a,
  onNext,
}: {
  me: Participant;
  action: Actions;
  onNext: () => void;
}) {
  const [selected, setSelected] = useState(me.answers.q1 || "一起逛逛");
  const [touched, setTouched] = useState(false);
  const cityResponse = useCityResponse();
  return (
    <>
      <div className="start-hero">
        <Motion preset="hero" className="start-backdrop">
          {null}
        </Motion>
        <div className="start-copy">
          <div className="eyebrow">YINCHUAN · GULOU</div>
          <h1>
            <Motion as="span" className="title-primary">
              在凤城，
            </Motion>
            <Motion
              as="span"
              className="title-secondary"
              delay={motionTiming.titleGap}
            >
              认真遇见一个人
            </Motion>
          </h1>
          <p>从一个共同话题，开始认识</p>
        </div>
        <div className="hero-note">
          在这座城里
          <br />
          总有相似的灵魂
          <br />
          正向你走来
        </div>
      </div>
      <section className="start-actions">
        <div className="section-heading">
          <h2>今天，想怎样遇见？</h2>
          <Icon name="spark" size={18} />
        </div>
        <div className="intent-grid">
          {QUESTIONS[0].options.map((v, index) => (
            <Motion
              key={v}
              delay={index * motionTiming.cardGap}
              className="intent-motion"
            >
              <button
                aria-pressed={selected === v}
                className={`intent-card ${selected === v ? "selected" : ""}`}
                onClick={() => {
                  setSelected(v);
                  setTouched(true);
                }}
              >
                {selected === v && (
                  <span className="selection-check">
                    <Icon name="check" size={12} />
                  </span>
                )}
                <Icon name={["chat", "pin", "people"][index]} size={27} />
                <strong>{v}</strong>
                <small>{QUESTIONS[0].hints[index]}</small>
                {touched && selected === v && (
                  <DestinyTrack key={v} className="intent-track" />
                )}
              </button>
            </Motion>
          ))}
        </div>
        <Button
          disabled={a.busy}
          onClick={() =>
            a.run({ type: "answer", questionId: "q1", value: selected }, () => {
              cityResponse(me.id, "q1", selected);
              onNext();
            })
          }
        >
          开始今天的遇见
          <Icon name="arrow" />
        </Button>
        <p className="fine center">回答 6 个轻问题，发现现场同频的人</p>
      </section>
    </>
  );
}
function Result({
  state,
  me,
  onContinue,
  onBack,
}: {
  state: DemoState;
  me: Participant;
  onContinue: () => void;
  onBack: () => void;
}) {
  const dist = distribution(state);
  const current = dist.find((x) => x.label === me.answers.q1);
  return (
    <>
      <div className="result-card">
        <Icon name="pin" size={35} />
        <p>你选择了</p>
        <h2>「{me.answers.q1 || "一起逛逛"}」</h2>
        <div className="result-stat">
          <div className="donut motion-donut">
            <strong>
              <AnimatedCounter
                value={current?.percentage || 0}
                fromZero
                suffix="%"
                ring
              />
            </strong>
            <span>的人也这样想</span>
          </div>
          <Motion
            as="div"
            className="result-explanation"
            preset="soft"
            delay={motionTiming.counter}
          >
            <p>
              今天回答这道题的人中，<strong>{current?.percentage || 0}%</strong>{" "}
              也选择了
              <br />「{me.answers.q1}」
            </p>
          </Motion>
        </div>
        <div className="sample-note">
          演示样本 · {Object.keys(state.responses).length} 人回答
        </div>
        <h3>其他人的选择</h3>
        {dist.map((d) => (
          <div className="distribution-row" key={d.label}>
            <span>{d.label}</span>
            <i>
              <b style={{ width: `${d.percentage}%` }} />
            </i>
            <strong>{d.percentage}%</strong>
          </div>
        ))}
      </div>
      <Button onClick={onContinue}>
        看看现场还有谁和我一样
        <Icon name="arrow" size={18} />
      </Button>
      <Button kind="text" onClick={onBack}>
        重新选择
      </Button>
    </>
  );
}
function Profile({
  me,
  action: a,
  onNext,
}: {
  me: Participant;
  action: Actions;
  onNext: () => void;
}) {
  const [name, setName] = useState(me.name),
    [gender, setGender] = useState<Gender>(me.gender),
    [age, setAge] = useState(me.age),
    [ready, setReady] = useState(me.ready),
    [error, setError] = useState("");
  const [avatarId, setAvatarId] = useState(me.avatarId);
  const [avatarMessage, setAvatarMessage] = useState("");
  const respond = useCityResponse();
  const composing = useRef(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const err = nicknameError(name);
        setError(err);
        const avatarValid = validAvatar(avatarId, gender);
        setAvatarMessage(avatarValid ? "" : "选一个本次活动头像吧。");
        if (!err && avatarValid && !composing.current)
          void a.run(
            { type: "profile", name, gender, age, ready, avatarId },
            () => {
              if (!me.profileComplete) respond(me.id, "profile", "");
              onNext();
            },
          );
      }}
    >
      <PersonCard
        p={{ ...me, name: name || "你的昵称", gender, age, avatarId }}
        preview
      />
      <label className="field-label" htmlFor="nickname">
        怎么称呼你？
      </label>
      <div className="nickname-field">
        <input
          id="nickname"
          disabled={a.busy}
          value={name}
          aria-describedby="nickname-help nickname-error"
          aria-invalid={!!error}
          autoComplete="off"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            setName(e.currentTarget.value);
            setError(nicknameError(e.currentTarget.value));
          }}
          onChange={(e) => {
            setName(e.target.value);
            if (!composing.current) setError(nicknameError(e.target.value));
          }}
        />
        <span>{[...name].length} / 5</span>
      </div>
      <p id="nickname-help" className="fine">
        输入 1–5 个汉字，不用真名，好记就行
      </p>
      <p id="nickname-error" className="field-error" aria-live="polite">
        {error}
      </p>
      <fieldset disabled={a.busy}>
        <legend className="field-label">你的年龄段</legend>
        <div className="age-grid">
          {AGES.map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={age === v}
              className={age === v ? "selected" : ""}
              onClick={() => setAge(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={a.busy}>
        <legend className="field-label">我是</legend>
        <div className="choice-row">
          {(["male", "female"] as const).map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={gender === v}
              className={gender === v ? "selected" : ""}
              onClick={() => {
                if (v !== gender) {
                  setGender(v);
                  setAvatarId(null);
                  setAvatarMessage(
                    `请重新选择一个${v === "male" ? "男生" : "女生"}头像。`,
                  );
                }
              }}
            >
              <span className="radio-dot" />
              {v === "male" ? "男生" : "女生"}
            </button>
          ))}
        </div>
      </fieldset>
      <AvatarSelector
        gender={gender}
        value={avatarId}
        disabled={a.busy}
        message={avatarMessage}
        onChange={(id) => {
          setAvatarId(id);
          setAvatarMessage("");
        }}
      />
      <Notice>
        本场将为你推荐愿意认识新朋友的{gender === "male" ? "女生" : "男生"}。
      </Notice>
      <fieldset disabled={a.busy}>
        <legend className="field-label">你现在方便认识新朋友吗？</legend>
        <div className="readiness">
          <button
            type="button"
            aria-pressed={ready}
            className={ready ? "selected" : ""}
            onClick={() => setReady(true)}
          >
            <span className="radio-dot" />
            可以，现在就能见面
          </button>
          <button
            type="button"
            aria-pressed={!ready}
            className={!ready ? "selected" : ""}
            onClick={() => setReady(false)}
          >
            <span className="radio-dot" />
            我想先看看
          </button>
        </div>
      </fieldset>
      <p className="fine privacy-note">
        <Icon name="help" size={18} />
        对方会看到昵称、默认头像、性别、年龄段和相同答案。联系方式不会自动分享。
      </p>
      <Button type="submit" disabled={a.busy}>
        继续答题
        <Icon name="arrow" />
      </Button>
    </form>
  );
}
function Questions({
  me,
  action: a,
  onNext,
}: {
  me: Participant;
  action: Actions;
  onNext: () => void;
}) {
  const cityResponse = useCityResponse();
  const initial = QUESTIONS.findIndex((q, i) => i > 0 && !me.answers[q.id]);
  const [index, setIndex] = useState(initial < 0 ? 1 : initial);
  const [selected, setSelected] = useState("");
  const q = QUESTIONS[index];
  return (
    <div className="question-page">
      <div className="question-progress">
        <strong>{String(index + 1).padStart(2, "0")}</strong>
        <span>/ 06</span>
        <DestinyProgressTrack answers={me.answers} current={index} />
      </div>
      <QuestionTransition questionKey={q.id}>
        <h1>{q.title}</h1>
        <p className="question-note">没有标准答案，选择此刻的你。</p>
        <div className="answer-grid">
          {q.options.map((v, i) => (
            <button
              key={v}
              aria-pressed={(selected || me.answers[q.id]) === v}
              className={`answer-card ${(selected || me.answers[q.id]) === v ? "selected" : ""}`}
              onClick={() => setSelected(v)}
            >
              <Icon name={["coffee", "chat", "bag", "leaf"][i]} size={34} />
              <strong>{v}</strong>
              {(selected || me.answers[q.id]) === v && (
                <span className="selection-check">
                  <Icon name="check" size={13} />
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          disabled={a.busy || (!selected && !me.answers[q.id])}
          onClick={() =>
            a.run(
              {
                type: "answer",
                questionId: q.id,
                value: selected || me.answers[q.id],
              },
              () => {
                cityResponse(me.id, q.id, selected || me.answers[q.id]);
                if (index === 5) onNext();
                else {
                  setIndex(index + 1);
                  setSelected("");
                }
              },
            )
          }
        >
          {index === 5 ? "看看现场同频的人" : "下一题"}
          <Icon name="arrow" />
        </Button>
        {index > 1 && (
          <Button
            kind="text"
            onClick={() => {
              setIndex(index - 1);
              setSelected("");
            }}
          >
            返回上一题
          </Button>
        )}
      </QuestionTransition>
      <p className="fine center">你的答案只用于发现共同话题</p>
    </div>
  );
}
export function PersonCard({
  p,
  preview = false,
}: {
  p: Participant;
  preview?: boolean;
}) {
  return (
    <div className="person-card">
      {preview ? (
        <Motion
          as="span"
          className="avatar-motion"
          key={`${p.gender}:${p.avatarId}`}
          preset="avatar"
        >
          <Avatar person={p} size="lg" />
        </Motion>
      ) : (
        <Avatar person={p} size="lg" />
      )}
      <div>
        <h2>
          {preview ? (
            <Motion as="span" key={p.name} preset="soft">
              {p.name}
            </Motion>
          ) : (
            p.name
          )}
        </h2>
        <p>
          {p.gender === "male" ? "男生" : "女生"} · {p.age} 岁
        </p>
        <small>系统虚拟头像，不代表本人长相</small>
      </div>
    </div>
  );
}
function CommonList({
  common,
}: {
  common: { questionId: string; answer: string }[];
}) {
  return (
    <div className="common-list">
      {common.map((c, i) => (
        <div className="common-item" key={c.questionId}>
          <span>
            <Icon
              name={["walk", "bag", "heart", "leaf", "coffee", "chat"][i % 6]}
            />
          </span>
          <div>
            <strong>都选择了「{c.answer}」</strong>
            <small>{QUESTIONS.find((q) => q.id === c.questionId)?.short}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
function PersonStatus({ p, inv }: { p: Participant; inv: Invitation }) {
  return (
    <div className="status-person">
      <Avatar person={p} size="sm" />
      <span>
        <strong>{p.name}</strong>
        <small>
          {inv.confirmations[p.id]
            ? "已确认见到对方"
            : inv.arrivals[p.id]
              ? "已经到达"
              : inv.departures[p.id]
                ? "已确认出发"
                : "尚未确认出发"}
        </small>
      </span>
      <Badge tone={inv.arrivals[p.id] ? "success" : "neutral"}>
        {inv.confirmations[p.id]
          ? "已见面"
          : inv.arrivals[p.id]
            ? "已到达"
            : inv.departures[p.id]
              ? "已出发"
              : "待出发"}
      </Badge>
    </div>
  );
}
function NextStep({
  state: s,
  me,
  inv,
  action: a,
  onExplore,
}: {
  state: DemoState;
  me: Participant;
  inv: Invitation;
  action: Actions;
  onExplore: () => void;
}) {
  const [showMerchants, setShowMerchants] = useState(
    inv.choices[me.id] === "MERCHANT",
  );
  const choice = inv.choices[me.id];
  return (
    <>
      <Notice tone="success">双方均已确认见面。谢谢你认真认识了一个人。</Notice>
      <div className="next-options">
        {(
          [
            {
              value: "WALK",
              icon: "walk",
              title: "一起走走",
              description: "在鼓楼再慢慢逛一会",
            },
            {
              value: "MERCHANT",
              icon: "coffee",
              title: "去云影咖啡",
              description: "步行 3 分钟 · 城市里的下一站",
            },
            {
              value: "END",
              icon: "leaf",
              title: "就到这里，也很好",
              description: "每一次认真相遇，都有意义",
            },
          ] as const
        ).map((v, index) => (
          <Motion key={v.value} delay={index * motionTiming.cardGap}>
            <button
              className={`next-card ${choice === v.value ? "selected" : ""}`}
              aria-pressed={choice === v.value}
              disabled={
                a.busy ||
                (v.value === "MERCHANT" &&
                  !s.merchants.some((m) => m.id === "cloud" && m.active))
              }
              onClick={() =>
                a.run(
                  { type: "next", invitationId: inv.id, choice: v.value },
                  () => setShowMerchants(v.value === "MERCHANT"),
                )
              }
            >
              <span className={`next-picture ${v.value.toLowerCase()}`}>
                {v.value === "WALK" ? (
                  <Ambient className="city-walk">
                    <Icon name={v.icon} size={36} />
                  </Ambient>
                ) : (
                  <Icon name={v.icon} size={36} />
                )}
                {v.value === "MERCHANT" && (
                  <Ambient className="city-steam">
                    <svg
                      viewBox="0 0 36 24"
                      width="36"
                      height="24"
                      aria-hidden="true"
                    >
                      <path d="M11 22C6 15 17 13 11 4M23 22C18 15 29 13 23 4" />
                    </svg>
                  </Ambient>
                )}
              </span>
              <span>
                <strong>{v.title}</strong>
                <small>{v.description}</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
          </Motion>
        ))}
      </div>
      {choice && (
        <p className="fine">
          已保存你的选择。是否一起继续，请与对方面对面商量。
        </p>
      )}
      {showMerchants && (
        <section className="merchant-list">
          {choice === "MERCHANT" &&
            inv.pointId &&
            s.merchants.some((m) => m.id === "cloud" && m.active) && (
              <RouteDraw
                point={
                  s.points.find((p) => p.id === inv.pointId)?.name || "相遇点"
                }
                merchant={s.merchants.find((m) => m.id === "cloud")!.name}
              />
            )}
          <h2>城市里的相遇伙伴</h2>
          {s.merchants
            .filter((m) => m.active)
            .map((m) => (
              <article className="merchant-card" key={m.id}>
                <div className="section-heading">
                  <h3>{m.name}</h3>
                  <Badge tone="success">步行 {m.minutes} 分钟</Badge>
                </div>
                <strong>{m.category}</strong>
                <p>给相遇留一点时间。和对方面对面商量，一起去坐坐吧。</p>
                <p className="fine">演示商户信息，实际营业情况以门店为准。</p>
              </article>
            ))}
          {!s.merchants.some((m) => m.active) && (
            <Notice>相遇伙伴暂时休息中，也可以一起在鼓楼走走。</Notice>
          )}
        </section>
      )}
      <div className="next-ending">
        <Icon name="leaf" size={25} />
        <p>
          有些相遇，不止于此。
          <br />
          有些相遇，到这里也很好。
        </p>
      </div>
      <Button kind="secondary" disabled={a.busy} onClick={onExplore}>
        我想继续探索
        <Icon name="arrow" />
      </Button>
    </>
  );
}
