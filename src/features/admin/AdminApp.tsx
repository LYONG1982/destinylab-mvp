"use client";
import { PRODUCT } from "@/config/product";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useDemo, useAction } from "@/lib/demo/hooks";
import type {
  Command,
  DemoState,
  Invitation,
  MeetPoint,
  Participant,
} from "@/domain/types";
import {
  ACTIVE_STATUSES,
  alerts,
  available,
  complete,
  hasPersonalEncounter,
  nowOf,
  person,
  phase,
  stats,
} from "@/domain/selectors";
import { pointCapacity, pointOccupants } from "@/domain/encounters";
import { QUESTIONS, STATUS_LABELS } from "@/data/questions";
import {
  Avatar,
  Badge,
  Brand,
  Button,
  Empty,
  Icon,
  Modal,
  Notice,
  timeText,
} from "@/components/ui";
import { AnimatedCounter } from "@/components/motion/AnimatedCounter";
import { Motion } from "@/components/motion/Motion";
import { LiveGate } from "@/components/LiveControls";

import { MemberWallSettings } from "@/features/member-wall/MemberWallSettings";

import { RegistrationAdmin } from "@/features/registration/RegistrationAdmin";

import {
  ActivityManagement,
  ActivitySwitch,
  FieldActions,
} from "./ActivityManagement";
import * as live from "@/lib/api/live-client";
import "./management.css";
import { PhaseStatus, PresenceStatus } from "./AdminPrimitives";
const NAV = [
  ["registrations", "活动报名", "people"],
  ["dashboard", "现场总览", "grid"],
  ["encounters", "邀请相遇", "heart"],
  ["participants", "现场参与者", "people"],
  ["partners", "相遇伙伴", "coffee"],
  ["member-wall", "遇见卡牌墙", "screen"],
  ["activities", "活动管理", "grid"],
];
export function AdminApp({ page }: { page: string }) {
  const { state, problem } = useDemo();
  if (!state) return <LiveGate problem={problem} />;
  return (
    <AdminView key={state.epoch} state={state} page={page} problem={problem} />
  );
}
function AdminView({
  state: s,
  page,
  problem,
}: {
  state: DemoState;
  page: string;
  problem: string;
}) {
  const a = useAction("operator");
  const [initialEvents] = useState(() => new Set(s.events.map((e) => e.id)));
  const query = useSearchParams();
  const [personId, setPersonId] = useState<string | null>(null),
    [inviteId, setInviteId] = useState<string | null>(query.get("id"));
  const [confirmation, setConfirmation] = useState<{
    title: string;
    body: string;
    command: Command;
  } | null>(null);
  const [success, setSuccess] = useState("");
  const selectedPerson = personId ? person(s, personId) : null;
  const selectedInvite = s.invitations.find((i) => i.id === inviteId);
  const m = stats(s);
  const confirm = (title: string, body: string, command: Command) =>
    setConfirmation({ title, body, command });
  const perform = (command: Command) =>
    a.run(command, () => setSuccess("操作已保存。"));
  const title = NAV.find((x) => x[0] === page)?.[1] || "现场总览";
  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="运营导航">
        <Brand compact />
        {NAV.map(([href, label, icon]) => (
          <Link
            key={href}
            href={`/admin/${href}?activity=${encodeURIComponent(s.live?.activity || "meet")}`}
            className={page === href ? "active" : ""}
            aria-current={page === href ? "page" : undefined}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </Link>
        ))}
        {!s.live && (
          <Link href="/demo">
            <Icon name="help" />
            <span>演示入口</span>
          </Link>
        )}
      </nav>
      <header className="admin-topbar">
        <div>
          <strong>
            {PRODUCT.name}{" "}
            <span style={{ fontWeight: 300, color: "#b5a496" }}>／</span>{" "}
            {s.live ? `活动 ${s.live.activity}` : "银川鼓楼"}
          </strong>
          <span className="activity-status">
            {s.fieldOpen === false
              ? "现场已关闭"
              : s.activityPaused
                ? "新邀请已暂停"
                : "现场已开放"}
          </span>
        </div>
        <div>
          {s.live && <ActivitySwitch activity={s.live.activity} />}
          <Badge>{s.live ? "实时活动" : "本地演示"}</Badge>
          {s.live && (
            <Button
              kind="text"
              data-wall-leave
              onClick={() =>
                void live.signOut().catch((e) => setSuccess(e.message))
              }
            >
              退出登录
            </Button>
          )}
        </div>
      </header>
      <main className="admin-main">
        {page !== "member-wall" && (
          <div className="admin-title">
            <div>
              <div className="eyebrow">DESTINY LAB · OPERATIONS</div>
              <h1>{title}</h1>
              {page !== "registrations" && (
                <p>
                  {s.live
                    ? "手机、运营与大屏共用现场数据"
                    : "2026 年 11 月 7 日 · 鼓楼步行街"}{" "}
                  <span>
                    ／ {s.live ? "现场时间" : "演示时间"} {timeText(nowOf(s))}
                  </span>
                </p>
              )}
            </div>
            <div className="admin-actions">
              <Link
                href={`/screen?activity=${encodeURIComponent(s.live?.activity || "meet")}`}
                target="_blank"
              >
                <Icon name="screen" size={17} />
                查看大屏
              </Link>
            </div>
          </div>
        )}
        {problem && <Notice tone="error">{problem}</Notice>}
        {a.error && <Notice tone="error">{a.error}</Notice>}
        {success && <Notice tone="success">{success}</Notice>}
        {page === "activities" && (
          <ActivityManagement state={s} problem={problem} />
        )}
        {page === "member-wall" && (
          <MemberWallSettings
            key={s.live?.activity || "meet"}
            activity={s.live?.activity || "meet"}
          />
        )}
        {page === "dashboard" && (
          <>
            <div className="stats-grid">
              {[
                {
                  label: "当前活跃",
                  value: m.active,
                  hint: "在场参与者",
                  icon: "people",
                },
                {
                  label: "等待回应",
                  value: m.waiting,
                  hint: "进行中的邀请",
                  icon: "clock",
                },
                {
                  label: "双向确认",
                  value: m.mutual,
                  hint: "双方愿意见面",
                  icon: "heart",
                },
                {
                  label: "已分配相遇点",
                  value: s.invitations.filter(
                    (invitation) =>
                      !!invitation.pointId &&
                      ACTIVE_STATUSES.includes(invitation.status),
                  ).length,
                  hint: "当前已分配点位",
                  icon: "pin",
                },
                {
                  label: "今日真实相遇",
                  value: m.real,
                  hint: "按双方记录去重",
                  icon: "spark",
                },
              ].map((v, i) => (
                <div
                  key={v.label}
                  className={`stat-card ${i === 4 ? "accent" : ""}`}
                >
                  <div>
                    <span>{v.label}</span>
                    <Icon name={v.icon} size={19} />
                  </div>
                  <strong data-testid={i === 4 ? "real-count" : undefined}>
                    <AnimatedCounter value={v.value} />
                  </strong>
                  <small>{v.hint}</small>
                </div>
              ))}
            </div>
            <div className="admin-grid">
              <Panel title="今天的参与路径" subtitle="人数与关系次数分别统计">
                <div className="panel-body">
                  {[
                    { title: "扫码进入", value: m.scans, filter: "all" },
                    {
                      title: "完成首答",
                      value: m.answered,
                      filter: "answered",
                    },
                    {
                      title: "完成探索",
                      value: m.completed,
                      filter: "completed",
                    },
                    { title: "发出邀请", value: m.sent, filter: "invited" },
                    { title: "真实相遇", value: m.real, filter: "real" },
                  ].map((x) => (
                    <Link
                      className="funnel-row"
                      key={x.title}
                      href={`/admin/participants?stage=${x.filter}&activity=${encodeURIComponent(s.live?.activity || "meet")}`}
                    >
                      <span>{x.title}</span>
                      <div>
                        <i
                          style={{
                            width: `${m.scans ? (x.value / m.scans) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <strong>
                        <AnimatedCounter value={x.value} />
                      </strong>
                    </Link>
                  ))}
                  <p className="funnel-note">
                    前三项为参与人数；后两项为邀请 /
                    相遇次数。相遇以双方确认去重。
                  </p>
                </div>
              </Panel>
              <Panel
                title="需要关注"
                subtitle={`${alerts(s).length + s.helps.filter((h) => h.status !== "RESOLVED").length} 项待办`}
              >
                <div className="panel-body">
                  {s.helps
                    .filter((h) => h.status !== "RESOLVED")
                    .map((h) => (
                      <button
                        key={h.id}
                        className="alert-item"
                        onClick={() => setInviteId(h.invitationId)}
                      >
                        <Icon name="help" size={18} />
                        <span>
                          <strong>
                            {person(s, h.participantId)?.name}需要工作人员帮助
                          </strong>
                          <small>
                            {h.status === "NEW" ? "等待接单" : "处理中"} ·{" "}
                            {timeText(h.createdAt)}
                          </small>
                        </span>
                      </button>
                    ))}
                  {alerts(s).map((x) => (
                    <button
                      className="alert-item"
                      key={x.id}
                      onClick={() => setInviteId(x.id)}
                    >
                      <Icon name="clock" size={18} />
                      <span>
                        <strong>{x.text}</strong>
                        <small>{x.detail}</small>
                      </span>
                    </button>
                  ))}
                  {!alerts(s).length &&
                    !s.helps.some((h) => h.status !== "RESOLVED") && (
                      <Empty title="现场一切有序">
                        新的帮助请求会出现在这里
                      </Empty>
                    )}
                </div>
              </Panel>
              <MeetPointPanel
                state={s}
                busy={a.busy}
                onOpenInvitation={setInviteId}
                onRun={perform}
                onConfirm={confirm}
              />
              <Panel title="实时动态" subtitle="最近发生的现场事件">
                <div className="panel-body">
                  {s.events
                    .slice(-6)
                    .reverse()
                    .map((e) => (
                      <EventRow
                        key={e.id}
                        text={e.text}
                        at={e.at}
                        animate={!initialEvents.has(e.id)}
                      />
                    ))}
                </div>
              </Panel>
            </div>
          </>
        )}
        {page === "encounters" && (
          <>
            <div className="filter-bar">
              <div>
                <Badge tone="wine">当前相遇安排</Badge>
                <span className="fine">状态由参与者操作和系统规则驱动</span>
              </div>
              <small>地点由系统自动分配；工作人员不能代替参与者确认见面</small>
            </div>
            <div className="kanban">
              {[
                { title: "等待回应", matches: (i: Invitation) => i.status === "SENT" },
                { title: "等待相遇点", matches: (i: Invitation) => i.status === "ACCEPTED" && !i.pointId },
                { title: "已分配相遇点", matches: (i: Invitation) => !!i.pointId && !hasPersonalEncounter(i, i.from) && !hasPersonalEncounter(i, i.to) },
                { title: "单方已记录", matches: (i: Invitation) => hasPersonalEncounter(i, i.from) !== hasPersonalEncounter(i, i.to) },
                { title: "双方已记录", matches: (i: Invitation) => hasPersonalEncounter(i, i.from) && hasPersonalEncounter(i, i.to) },
              ].map((col) => {
                const items = s.invitations.filter(
                  (i) =>
                    col.matches(i) &&
                    ["SENT", "ACCEPTED", "MEET_ASSIGNED", "ARRIVING", "CONFIRMED"].includes(i.status) &&
                    (i.status !== "CONFIRMED" ||
                      nowOf(s) - (i.realMeetAt || 0) < 1800000),
                );
                return (
                  <section className="kanban-column" key={col.title}>
                    <div className="kanban-heading">
                      <strong>{col.title}</strong>
                      <span>{items.length}</span>
                    </div>
                    {items
                      .slice()
                      .reverse()
                      .map((i) => (
                        <EncounterCard
                          key={i.id}
                          state={s}
                          invitation={i}
                          onOpen={() => setInviteId(i.id)}
                        />
                      ))}
                    {!items.length && (
                      <Empty title="暂时没有相遇">新的故事正在路上</Empty>
                    )}
                  </section>
                );
              })}
            </div>
            <details className="past-section">
              <summary>
                历史及已结束的相遇 ·{" "}
                {
                  s.invitations.filter(
                    (i) =>
                      !ACTIVE_STATUSES.includes(i.status) &&
                      (i.status !== "CONFIRMED" ||
                        nowOf(s) - (i.realMeetAt || 0) >= 1800000),
                  ).length
                }
              </summary>
              <div className="kanban">
                {s.invitations
                  .filter(
                    (i) =>
                      !ACTIVE_STATUSES.includes(i.status) &&
                      (i.status !== "CONFIRMED" ||
                        nowOf(s) - (i.realMeetAt || 0) >= 1800000),
                  )
                  .map((i) => (
                    <EncounterCard
                      key={i.id}
                      state={s}
                      invitation={i}
                      onOpen={() => setInviteId(i.id)}
                    />
                  ))}
              </div>
            </details>
          </>
        )}
        {page === "participants" && (
          <ParticipantList
            state={s}
            initialStage={query.get("stage") || "all"}
            onOpen={setPersonId}
          />
        )}
        {page === "partners" && (
          <>
            <div className="filter-bar">
              <div>
                <Icon name="coffee" />
                <span>把相遇，延伸到城市里</span>
              </div>
              <small>商户仅展示信息，不提供权益领取或核销</small>
            </div>
            <div className="partner-grid">
              {s.merchants.map((merchant) => (
                <article className="panel partner-detail" key={merchant.id}>
                  <div className="partner-symbol">
                    <Icon
                      name={merchant.id === "craft" ? "bag" : "coffee"}
                      size={41}
                    />
                  </div>
                  <div className="section-heading">
                    <Badge tone={merchant.active ? "success" : "neutral"}>
                      {merchant.active ? "推荐中" : "已暂停"}
                    </Badge>
                    <small className="fine">步行 {merchant.minutes} 分钟</small>
                  </div>
                  <h2>{merchant.name}</h2>
                  <p>
                    {merchant.category} ·
                    给相遇留一点时间。这里是城市里的下一站，实际营业情况以门店为准。
                  </p>
                  <div className="partner-numbers">
                    <div>
                      <strong>
                        {
                          s.merchantViews.filter((v) =>
                            v.endsWith(`:${merchant.id}`),
                          ).length
                        }
                      </strong>
                      推荐触达（按相遇去重）
                    </div>
                    <div>
                      <strong>
                        {merchant.id === "cloud" ? m.merchant : 0}
                      </strong>
                      到店意向（相遇数）
                    </div>
                  </div>
                  <Button
                    kind="secondary"
                    disabled={a.busy}
                    onClick={() =>
                      confirm(
                        merchant.active
                          ? "暂停推荐这家伙伴？"
                          : "恢复推荐这家伙伴？",
                        "只调整相遇后的展示推荐，不改变已记录的本人去向。",
                        {
                          type: "merchant",
                          merchantId: merchant.id,
                          active: !merchant.active,
                        },
                      )
                    }
                  >
                    {merchant.active ? "暂停推荐" : "开启推荐"}
                  </Button>
                </article>
              ))}
            </div>
            <Notice>
              当前版本保留商户展示与去向选择。商户核销和服务授权暂不实现。
            </Notice>
          </>
        )}
        {page === "registrations" && (
          <RegistrationAdmin activity={s.live?.activity || "meet"} />
        )}
        <p className="local-note">
          {s.live
            ? "本活动数据由服务端保存 · 请妥善保管运营账号"
            : "本地演示数据 · 不包含真实联系方式 · 当前操作不会发送外部消息"}
        </p>
      </main>
      {selectedPerson && (
        <Modal title="参与者详情" onClose={() => setPersonId(null)}>
          <div className="person-card">
            <Avatar person={selectedPerson} size="lg" />
            <div>
              <h2>{selectedPerson.name}</h2>
              <p>
                {selectedPerson.gender === "male" ? "男生" : "女生"} ·{" "}
                {selectedPerson.age} 岁
              </p>
              <PhaseStatus label={phase(s, selectedPerson)} />
            </div>
          </div>
          <div className="detail-meta">
            <div>
              <small>加入时间</small>
              <strong>{timeText(selectedPerson.joinedAt)}</strong>
            </div>
            <div>
              <small>在场状态</small>
              <PresenceStatus present={selectedPerson.present} />
            </div>
            <div>
              <small>发出邀请</small>
              <strong>
                {
                  s.invitations.filter((i) => i.from === selectedPerson.id)
                    .length
                }
              </strong>
            </div>
            <div>
              <small>真实见面</small>
              <strong>
                {
                  s.invitations.filter(
                    (i) =>
                      i.realMeetAt &&
                      [i.from, i.to].includes(selectedPerson.id),
                  ).length
                }
              </strong>
            </div>
          </div>
          <section className="detail-section">
            <h3>{QUESTIONS.length} 道轻问题</h3>
            <div className="answer-detail">
              {QUESTIONS.map((q) => (
                <div key={q.id}>
                  <span>{q.short}</span>
                  <strong>{selectedPerson.answers[q.id] || "尚未回答"}</strong>
                </div>
              ))}
            </div>
          </section>
          {selectedPerson.currentId && (
            <Button
              kind="secondary"
              onClick={() => {
                setInviteId(selectedPerson.currentId);
                setPersonId(null);
              }}
            >
              查看当前相遇任务
            </Button>
          )}
          <div className="detail-actions">
            <Button
              kind="secondary"
              onClick={() =>
                perform({
                  type: "participant",
                  participantId: selectedPerson.id,
                  action: selectedPerson.paused ? "resume" : "pause",
                })
              }
            >
              {selectedPerson.paused ? "恢复推荐" : "暂停推荐"}
            </Button>
            <Button
              kind="secondary"
              disabled={!selectedPerson.present}
              onClick={() =>
                confirm(
                  "标记该参与者离场？",
                  "进行中的邀请将结束；仍被相遇安排占用的点位需在确认现场空闲后释放。",
                  {
                    type: "participant",
                    participantId: selectedPerson.id,
                    action: "leave",
                  },
                )
              }
            >
              标记离场
            </Button>
            <Button
              kind="secondary"
              onClick={() =>
                perform({
                  type: "participant",
                  participantId: selectedPerson.id,
                  action: "hint",
                })
              }
            >
              发送现场提示
            </Button>
          </div>
          <section className="detail-section">
            <h3>行为时间线</h3>
            {s.events
              .filter((e) => e.participantId === selectedPerson.id)
              .slice(-8)
              .reverse()
              .map((e) => (
                <div className="feed-item" key={e.id}>
                  <time>{timeText(e.at)}</time>
                  <span>{e.text}</span>
                </div>
              ))}
          </section>
        </Modal>
      )}
      {selectedInvite && (
        <Modal title="邀请与相遇详情" onClose={() => setInviteId(null)}>
          <div className="encounter-detail-pair">
            {[selectedInvite.from, selectedInvite.to].map((id) => {
              const p = person(s, id)!;
              const recordedAt =
                selectedInvite.confirmations[id] ||
                (selectedInvite.status === "CONFIRMED"
                  ? selectedInvite.realMeetAt
                  : undefined);
              return (
                <div key={id}>
                  <Avatar person={p} size="md" />
                  <strong>{p.name}</strong>
                  <small>
                    {hasPersonalEncounter(selectedInvite, id)
                      ? `已记录相遇 · ${recordedAt ? timeText(recordedAt) : "时间未知"}`
                      : selectedInvite.arrivals[id]
                        ? "历史记录：已到达"
                        : selectedInvite.departures[id]
                          ? "历史记录：已出发"
                          : "未记录相遇"}
                  </small>
                </div>
              );
            })}
          </div>
          <div className="detail-meta">
            <div>
              <small>状态</small>
              <strong>
                {hasPersonalEncounter(selectedInvite, selectedInvite.from) &&
                hasPersonalEncounter(selectedInvite, selectedInvite.to)
                  ? "双方已记录"
                  : hasPersonalEncounter(selectedInvite, selectedInvite.from) ||
                      hasPersonalEncounter(selectedInvite, selectedInvite.to)
                    ? "单方已记录"
                    : selectedInvite.pointId
                      ? "已分配相遇点"
                      : STATUS_LABELS[selectedInvite.status]}
                {selectedInvite.status === "CANCELLED" ? " · 邀请已取消" : ""}
              </strong>
            </div>
            <div>
              <small>相遇点</small>
              <strong>
                {s.points.find((p) => p.id === selectedInvite.pointId)?.name ||
                  "尚未分配 / 历史记录"}
              </strong>
            </div>
            <div>
              <small>见面卡</small>
              <strong>{selectedInvite.pass}</strong>
            </div>
            <div>
              <small>
                {selectedInvite.codeVersion === "520"
                  ? "双方 520 相遇码"
                  : "旧版见面码"}
              </small>
              <strong>
                {selectedInvite.codeVersion === "520"
                  ? [selectedInvite.from, selectedInvite.to]
                      .map((participantId) => {
                        const participant = person(s, participantId);
                        const code = selectedInvite.encounterCodes?.[participantId];
                        const label =
                          participant?.gender === "male"
                            ? "男生"
                            : participant?.gender === "female"
                              ? "女生"
                              : "参与者";
                        return `${label} ${participant?.name || participantId}：${code || "待分配"}`;
                      })
                      .join(" · ")
                  : selectedInvite.code}
              </strong>
            </div>
            <div>
              <small>发出时间</small>
              <strong>{timeText(selectedInvite.createdAt)}</strong>
            </div>
          </div>
          {s.helps
            .filter((h) => h.invitationId === selectedInvite.id)
            .map((h) => (
              <div className="help-detail" key={h.id}>
                <h3>{person(s, h.participantId)?.name}需要帮助</h3>
                <p>{h.reply || "等待工作人员接单"}</p>
                <div className="detail-actions">
                  <Button
                    kind="secondary"
                    disabled={h.status !== "NEW" || a.busy}
                    onClick={() =>
                      perform({
                        type: "help-status",
                        helpId: h.id,
                        status: "ACK",
                      })
                    }
                  >
                    接单处理
                  </Button>
                  <Button
                    kind="secondary"
                    disabled={h.status === "RESOLVED" || a.busy}
                    onClick={() =>
                      perform({
                        type: "help-status",
                        helpId: h.id,
                        status: "RESOLVED",
                      })
                    }
                  >
                    标记已处理
                  </Button>
                </div>
              </div>
            ))}
          {ACTIVE_STATUSES.includes(selectedInvite.status) && (
            <Button
              kind="danger"
              onClick={() =>
                confirm(
                  "结束本次相遇安排？",
                  "请确认现场情况。此操作不会增加真实相遇计数。",
                  { type: "cancel", invitationId: selectedInvite.id },
                )
              }
            >
              结束本次安排
            </Button>
          )}
          <Notice>工作人员不能代替参与者记录本人的相遇。</Notice>
          <section className="detail-section">
            <h3>相遇时间线</h3>
            {s.events
              .filter((e) => e.invitationId === selectedInvite.id)
              .slice(-10)
              .reverse()
              .map((e) => (
                <div className="feed-item" key={e.id}>
                  <time>{timeText(e.at)}</time>
                  <span>{e.text}</span>
                </div>
              ))}
          </section>
        </Modal>
      )}
      {confirmation && (
        <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p>{confirmation.body}</p>
          <Button
            disabled={a.busy}
            onClick={() =>
              a.run(confirmation.command, () => {
                setConfirmation(null);
                setSuccess("操作已保存。");
              })
            }
          >
            确认操作
          </Button>
          {a.error && <Notice tone="error">{a.error}</Notice>}
          <Button kind="text" onClick={() => setConfirmation(null)}>
            取消
          </Button>
        </Modal>
      )}
    </div>
  );
}
function Panel({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel${wide ? " wide" : ""}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        <small>{subtitle}</small>
      </div>
      {children}
    </section>
  );
}
function MeetPointPanel({
  state: s,
  busy,
  onOpenInvitation,
  onRun,
  onConfirm,
}: {
  state: DemoState;
  busy: boolean;
  onOpenInvitation: (id: string) => void;
  onRun: (command: Command) => void;
  onConfirm: (title: string, body: string, command: Command) => void;
}) {
  const activePoints = s.points.filter((point) => point.deletedAt === undefined);
  const deletedPoints = s.points.filter((point) => point.deletedAt !== undefined);
  const missingCapacityPoints = activePoints.filter(
    (point) => point.capacity === undefined,
  );
  const occupancy = activePoints.flatMap((point) =>
    pointOccupants(point).map((invitationId) => ({
      point,
      invitationId,
      invitation: s.invitations.find((item) => item.id === invitationId),
    })),
  );
  const remaining = activePoints.reduce(
    (total, point) =>
      total +
      (point.closed
        ? 0
        : Math.max(0, pointCapacity(point) - pointOccupants(point).length)),
    0,
  );
  const inUse = occupancy.filter(
    ({ invitation }) =>
      invitation && ACTIVE_STATUSES.includes(invitation.status),
  ).length;
  const pendingFree = occupancy.filter(
    ({ invitation }) =>
      !invitation || !ACTIVE_STATUSES.includes(invitation.status),
  ).length + activePoints.reduce(
    (total, point) => total + Math.ceil((point.retainedCodes?.length || 0) / 2),
    0,
  );
  const waiting = s.invitations.filter(
    (invitation) => invitation.status === "ACCEPTED" && !invitation.pointId,
  ).length;
  const totalOpenCapacity = activePoints.reduce(
    (total, point) => total + (point.closed ? 0 : pointCapacity(point)),
    0,
  );
  const summaries = [
    ["相遇点", activePoints.length, "个"],
    ["开放点", activePoints.filter((point) => !point.closed).length, "个"],
    ["开放点总容量", totalOpenCapacity, "对"],
    ["可分配剩余容量", remaining, "对"],
    ["当前使用中", inUse, "对"],
    ["待确认空闲", pendingFree, "对"],
    ["等待分配", waiting, "对"],
    ["已删除点位", deletedPoints.length, "个"],
  ] as const;
  const usedNames = new Set(s.points.map((point) => point.name));
  const usedNumbers = new Set(
    s.points.flatMap((point) => {
      const match = point.name.match(/^Meet(\d{2,3})$/);
      return match ? [Number(match[1])] : [];
    }),
  );
  let suggestedNumber = 1;
  while (suggestedNumber <= 999 && usedNumbers.has(suggestedNumber))
    suggestedNumber += 1;
  const suggestedName =
    suggestedNumber <= 999
      ? `Meet${String(suggestedNumber).padStart(2, "0")}`
      : "";
  return (
    <Panel
      wide
      title="相遇点配置与状态"
      subtitle="容量按可同时接待的配对数计算；单点最多160对，实际分配仍受活动相遇码池限制"
    >
      <div className="meet-point-summary" aria-label="相遇点数量统计">
        {summaries.map(([label, value, unit]) => (
          <div key={label}>
            <span>{label}（{unit}）</span>
            <strong>{value} <small>{unit}</small></strong>
          </div>
        ))}
      </div>
      <AddMeetPointForm
        suggestedName={suggestedName}
        usedNames={usedNames}
        busy={busy}
        onRun={onRun}
      />
      <section className="point-capacity-defaults" aria-label="缺省容量预览">
        <div>
          <strong>缺省容量预览</strong>
          <p>
            {missingCapacityPoints.length
              ? `${missingCapacityPoints.length} 个未配置容量的点位将设为30对；已有明确容量的点位保持原值。`
              : "没有需要补齐的点位。"}
          </p>
          {missingCapacityPoints.length > 0 && (
            <details>
              <summary>查看待补齐点位</summary>
              <p>{missingCapacityPoints.map((point) => point.name).join("、")}</p>
            </details>
          )}
        </div>
        <button
          className="table-action"
          disabled={busy || missingCapacityPoints.length === 0}
          onClick={() =>
            onConfirm(
              "将未配置容量设为30对？",
              `当前预览：${missingCapacityPoints.map((point) => point.name).join("、")}，共${missingCapacityPoints.length}个。应用时会把活动事务中所有仍有效且未配置容量的点位设为30对；已经明确设置的容量不变。`,
              { type: "point-capacity-defaults", mode: "apply" },
            )
          }
        >
          应用缺省30对
        </button>
      </section>
      <div className="table-scroll meet-point-table-scroll">
        <table className="data-table meet-point-table">
          <thead>
            <tr>
              <th>编号与现场位置</th>
              <th>使用状态</th>
              <th>关联配对</th>
              <th>配置</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {activePoints.map((point) => {
              const occupants = pointOccupants(point);
              const pairs = occupants.map((invitationId) => ({
                invitationId,
                invitation: s.invitations.find(
                  (item) => item.id === invitationId,
                ),
              }));
              const activeCount = pairs.filter(
                ({ invitation }) =>
                  invitation && ACTIVE_STATUSES.includes(invitation.status),
              ).length;
              const endedCount = pairs.length - activeCount;
              const retainedPairCount = Math.ceil(
                (point.retainedCodes?.length || 0) / 2,
              );
              const activeReferences = s.invitations.some(
                (invitation) =>
                  invitation.pointId === point.id &&
                  ACTIVE_STATUSES.includes(invitation.status),
              );
              const removalBlocked =
                occupants.length > 0 ||
                retainedPairCount > 0 ||
                activeReferences;
              const removalReason = occupants.length || retainedPairCount
                ? "请先结束相关安排、确认现场空闲并释放全部占用后再删除。"
                : activeReferences
                  ? "仍有进行中的邀请引用此点位，请先结束安排。"
                  : "";
              const stateLabel = retainedPairCount
                ? "已归档占用待确认空闲"
                : point.closed
                  ? "停用"
                  : activeCount
                    ? "使用中"
                    : endedCount
                      ? "待确认空闲"
                      : occupants.length >= pointCapacity(point)
                        ? "容量已满"
                        : "可分配";
              return (
                <tr key={point.id}>
                  <td>
                    <strong>{point.name}</strong>
                    <div className="fine">
                      {point.location || "尚未填写现场位置"}
                    </div>
                    <small className="meet-point-capacity">
                      {occupants.length} / {pointCapacity(point)} 对
                    </small>
                  </td>
                  <td>
                    <Badge
                      tone={
                        stateLabel === "可分配"
                          ? "success"
                          : stateLabel === "使用中"
                            ? "wine"
                            : "warning"
                      }
                    >
                      {stateLabel}
                    </Badge>
                  </td>
                  <td>
                    {pairs.length || retainedPairCount ? (
                      <div className="meet-point-pairs">
                        {pairs.map(({ invitationId, invitation }) => (
                          <div
                            className="meet-point-pair"
                            key={invitationId}
                          >
                            {invitation ? (
                              <>
                                <button
                                  className="table-action"
                                  onClick={() =>
                                    onOpenInvitation(invitation.id)
                                  }
                                >
                                  {person(s, invitation.from)?.name ||
                                    invitation.from}{" "}
                                  · {person(s, invitation.to)?.name || invitation.to}
                                </button>
                                <small>
                                  {ACTIVE_STATUSES.includes(invitation.status)
                                    ? "使用中"
                                    : "已结束，待核实空闲"}
                                </small>
                                {!ACTIVE_STATUSES.includes(
                                  invitation.status,
                                ) && (
                                  <button
                                    className="table-action"
                                    disabled={busy}
                                    onClick={() =>
                                      onConfirm(
                                        `释放 ${point.name} 上的这对占用？`,
                                        "请先确认这对参与者已离开该点位。系统只释放这条已结束的相遇关系，并可能自动安排等待中的配对。",
                                        {
                                          type: "release",
                                          pointId: point.id,
                                          invitationId: invitation.id,
                                        },
                                      )
                                    }
                                  >
                                    确认已空闲并释放
                                  </button>
                                )}
                              </>
                            ) : (
                              <span>占用记录待核对 · {invitationId}</span>
                            )}
                          </div>
                        ))}
                        {retainedPairCount > 0 && (
                          <div className="meet-point-pair">
                            <small>
                              已归档占用待确认空闲 · {retainedPairCount} 对
                            </small>
                            <button
                              className="table-action"
                              disabled={busy || activeCount > 0}
                              title={
                                activeCount > 0
                                  ? "请先结束并释放此点位上的进行中安排"
                                  : undefined
                              }
                              onClick={() =>
                                onConfirm(
                                  `确认 ${point.name} 整点空闲？`,
                                  "请先确认现场已无人使用。此操作会释放该点位所有已结束占用，并清除已归档配对的码对保留；有进行中占用时不能执行。",
                                  { type: "release", pointId: point.id },
                                )
                              }
                            >
                              确认整点空闲并释放
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span>暂无配对占用</span>
                    )}
                  </td>
                  <td>
                    <PointConfiguration
                      key={`${point.id}:${point.location}:${point.capacity ?? 1}`}
                      point={point}
                      currentOccupancy={occupants.length + Math.ceil((point.retainedCodes?.length || 0) / 2)}
                      disabled={busy}
                      onRun={onRun}
                    />
                  </td>
                  <td>
                    <div className="meet-point-actions">
                      <button
                        className="table-action"
                        disabled={
                          busy ||
                          occupants.length > 0 ||
                          (point.closed && retainedPairCount > 0)
                        }
                        title={
                          point.closed && retainedPairCount > 0
                            ? "请先确认归档配对的场地已空闲，再启用点位"
                            : occupants.length > 0
                              ? "请先逐对确认已结束的占用并释放"
                              : undefined
                        }
                        onClick={() =>
                          onConfirm(
                            `${point.closed ? "启用" : "停用"} ${point.name}？`,
                            point.closed
                              ? "启用后，系统可把等待配对自动分配到此点位。"
                              : "停用后，系统不再把新配对分配到此点位。",
                            {
                              type: "point-status",
                              pointId: point.id,
                              enabled: point.closed,
                            },
                          )
                        }
                      >
                        {point.closed ? "启用" : "停用"}
                      </button>
                      <button
                        className="table-action danger"
                        disabled={busy || removalBlocked}
                        title={removalBlocked ? removalReason : undefined}
                        onClick={() =>
                          onConfirm(
                            `删除 ${point.name}？`,
                            `此点位将从可分配清单移除。历史相遇仍保留原编号和位置（${point.location || "未填写位置"}），且该编号不会再次使用。`,
                            { type: "point-remove", pointId: point.id },
                          )
                        }
                      >
                        删除
                      </button>
                      {removalBlocked && (
                        <small className="point-remove-reason">
                          {removalReason}
                        </small>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {deletedPoints.length > 0 && (
        <details className="deleted-point-history">
          <summary>已删除点位历史 · {deletedPoints.length} 个</summary>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>原编号</th>
                  <th>原现场位置</th>
                  <th>历史相遇</th>
                  <th>删除时间</th>
                </tr>
              </thead>
              <tbody>
                {deletedPoints.map((point) => (
                  <tr key={point.id}>
                    <td><strong>{point.name}</strong></td>
                    <td>{point.location || "未填写位置"}</td>
                    <td>
                      {s.invitations.filter(
                        (invitation) => invitation.pointId === point.id,
                      ).length} 对
                    </td>
                    <td>{point.deletedAt ? timeText(point.deletedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Panel>
  );
}
function AddMeetPointForm({
  suggestedName,
  usedNames,
  busy,
  onRun,
}: {
  suggestedName: string;
  usedNames: Set<string>;
  busy: boolean;
  onRun: (command: Command) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("30");
  const pointName = name.trim() || suggestedName;
  const parsedCapacity = Number(capacity);
  const nameValid = /^Meet\d{2,3}$/.test(pointName) && !usedNames.has(pointName);
  const capacityValid =
    Number.isInteger(parsedCapacity) && parsedCapacity >= 1 && parsedCapacity <= 160;
  return (
    <form
      className="add-meet-point-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!nameValid || !capacityValid || location.trim().length > 100) return;
        onRun({
          type: "point-add",
          name: pointName,
          location: location.trim(),
          capacity: parsedCapacity,
        });
        setName("");
        setLocation("");
        setCapacity("30");
      }}
    >
      <div className="add-meet-point-copy">
        <strong>新增相遇点</strong>
        <small>自动建议下一个未使用编号；新点默认30对，可在此修改。</small>
      </div>
      <label>
        编号
        <input
          value={name}
          placeholder={suggestedName || "编号已用尽"}
          maxLength={7}
          disabled={busy || !suggestedName}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="add-point-location">
        现场位置
        <input
          value={location}
          maxLength={100}
          disabled={busy}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="填写现场可识别的位置"
        />
      </label>
      <label>
        容量（对）
        <input
          type="number"
          min="1"
          max="160"
          step="1"
          required
          value={capacity}
          disabled={busy}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </label>
      <button
        className="table-action"
        type="submit"
        disabled={busy || !suggestedName || !nameValid || !capacityValid || location.trim().length > 100}
      >
        新增点位
      </button>
      {!nameValid && name.trim() !== "" && (
        <small className="point-form-error">编号须为未使用的 Meet 加2至3位数字。</small>
      )}
      {!suggestedName && <small className="point-form-error">已无可用的三位数字编号。</small>}
    </form>
  );
}
function PointConfiguration({
  point,
  currentOccupancy,
  disabled,
  onRun,
}: {
  point: MeetPoint;
  currentOccupancy: number;
  disabled: boolean;
  onRun: (command: Command) => void;
}) {
  const [location, setLocation] = useState(point.location);
  const [capacity, setCapacity] = useState(String(pointCapacity(point)));
  const parsedCapacity = Number(capacity);
  return (
    <form
      className="meet-point-config"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          location.trim().length > 100 ||
          !Number.isInteger(parsedCapacity) ||
          parsedCapacity < Math.max(1, currentOccupancy) ||
          parsedCapacity > 160
        )
          return;
        onRun({
          type: "point-config",
          pointId: point.id,
          location: location.trim(),
          capacity: parsedCapacity,
        });
      }}
    >
      <label>
        现场位置
        <input
          value={location}
          maxLength={100}
          disabled={disabled}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="填写现场可识别的位置"
        />
      </label>
      <label>
        容量（对）
        <input
          type="number"
          min={Math.max(1, currentOccupancy)}
          max="160"
          step="1"
          required
          value={capacity}
          disabled={disabled}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </label>
      <button
        className="table-action"
        type="submit"
        disabled={
          disabled ||
          location.trim().length > 100 ||
          !Number.isInteger(parsedCapacity) ||
          parsedCapacity < Math.max(1, currentOccupancy) ||
          parsedCapacity > 160
        }
      >
        保存配置
      </button>
    </form>
  );
}
function EncounterCard({
  state: s,
  invitation: i,
  onOpen,
}: {
  state: DemoState;
  invitation: Invitation;
  onOpen: () => void;
}) {
  const from = person(s, i.from)!,
    to = person(s, i.to)!;
  const pointName = s.points.find((point) => point.id === i.pointId)?.name;
  const fromRecorded = hasPersonalEncounter(i, from.id);
  const toRecorded = hasPersonalEncounter(i, to.id);
  const fromRecordedAt =
    i.confirmations[from.id] ||
    (i.status === "CONFIRMED" ? i.realMeetAt : undefined);
  const toRecordedAt =
    i.confirmations[to.id] ||
    (i.status === "CONFIRMED" ? i.realMeetAt : undefined);
  const statusLabel =
    fromRecorded && toRecorded
      ? "双方已记录"
      : fromRecorded || toRecorded
        ? "单方已记录"
        : i.pointId
          ? "已分配相遇点"
          : i.status === "ACCEPTED"
            ? "等待相遇点"
            : STATUS_LABELS[i.status];
  return (
    <button className="encounter-card" onClick={onOpen}>
      <div className="encounter-people">
        <Avatar person={from} size="xs" />
        <strong>{from.name}</strong>
        <span>·</span>
        <Avatar person={to} size="xs" />
        <strong>{to.name}</strong>
      </div>
      <Badge
        tone={
          i.status === "CONFIRMED"
            ? "success"
            : i.status === "SENT"
              ? "warning"
              : "wine"
        }
      >
        {statusLabel}
      </Badge>
      <div className="encounter-meta">
        <div>
          <span>
            {pointName || "相遇点待分配"}
          </span>
          <span>{timeText(i.createdAt)}</span>
        </div>
        <div>
          <span>
            {from.name}：{fromRecorded
              ? `已记录相遇 · ${fromRecordedAt ? timeText(fromRecordedAt) : "时间未知"}`
              : "未记录相遇"}
          </span>
          <span>
            {to.name}：{toRecorded
              ? `已记录相遇 · ${toRecordedAt ? timeText(toRecordedAt) : "时间未知"}`
              : "未记录相遇"}
          </span>
        </div>
        {s.helps.some(
          (h) => h.invitationId === i.id && h.status !== "RESOLVED",
        ) && <Badge tone="warning">需要工作人员帮助</Badge>}
      </div>
    </button>
  );
}
function ParticipantList({
  state: s,
  initialStage,
  onOpen,
}: {
  state: DemoState;
  initialStage: string;
  onOpen: (id: string) => void;
}) {
  const [term, setTerm] = useState(""),
    [stage, setStage] = useState(initialStage),
    [page, setPage] = useState(1);
  const filter = (p: Participant) => {
    if (stage === "active") return p.present;
    if (stage === "ready") return available(s, p);
    if (stage === "left") return !p.present;
    if (stage === "answered") return !!p.answers.q1;
    if (stage === "completed") return complete(p);
    if (stage === "invited") return s.invitations.some((i) => i.from === p.id);
    if (stage === "real")
      return s.invitations.some(
        (i) => [i.from, i.to].includes(p.id) && hasPersonalEncounter(i, p.id),
      );
    return true;
  };
  const list = s.participants.filter((p) => p.name.includes(term) && filter(p));
  const totalPages = Math.max(1, Math.ceil(list.length / 12));
  const currentPage = Math.min(page, totalPages);
  return (
    <>
      <div className="filter-bar">
        <div>
          <Icon name="search" size={18} />
          <input
            aria-label="搜索昵称"
            placeholder="搜索参与者昵称"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="筛选参与阶段"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(1);
            }}
          >
            {[
              ["all", "全部参与者"],
              ["active", "当前在场"],
              ["ready", "现在可以认识"],
              ["answered", "已完成首答"],
              ["completed", "已完成探索"],
              ["invited", "已发出邀请"],
              ["real", "已记录相遇"],
              ["left", "已离场"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <small>共 {list.length} 人</small>
      </div>
      {["answered", "all"].includes(stage) && (
        <p className="fine" style={{ marginBottom: 13 }}>
          列表展示已建立参与资料的人。首答统计另外包含未建立资料的匿名回答；邀请和相遇统计以次数计，此表按参与者去重。
        </p>
      )}
      <ParticipantSelection
        key={`${s.epoch}:${term}:${stage}:${currentPage}`}
        state={s}
        people={list.slice((currentPage - 1) * 12, currentPage * 12)}
        onOpen={onOpen}
      />
      <div className="pagination">
        <Button
          kind="text"
          disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}
        >
          上一页
        </Button>
        <span>
          {currentPage} / {totalPages}
        </span>
        <Button
          kind="text"
          disabled={currentPage >= totalPages}
          onClick={() => setPage(currentPage + 1)}
        >
          下一页
        </Button>
      </div>
    </>
  );
}

function EventRow({
  text,
  at,
  animate,
}: {
  text: string;
  at: number;
  animate: boolean;
}) {
  // The keyed component remains mounted across polling updates; Motion runs once.
  return animate ? (
    <Motion className="feed-item" preset="soft">
      <time>{timeText(at)}</time>
      <span>{text}</span>
    </Motion>
  ) : (
    <div className="feed-item">
      <time>{timeText(at)}</time>
      <span>{text}</span>
    </div>
  );
}

function ParticipantSelection({
  state,
  people,
  onOpen,
}: {
  state: DemoState;
  people: Participant[];
  onOpen: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const ids = selected.filter((id) => people.some((p) => p.id === id));
  return (
    <section className="panel participant-selection">
      {state.live && (
        <FieldActions state={state} ids={ids} onDone={() => setSelected([])} />
      )}
      <div
        className="table-scroll admin-roster-scroll"
        role="region"
        aria-label="现场名单，可横向滚动"
        tabIndex={0}
      >
        <table className="data-table admin-roster participant-roster">
          <thead>
            <tr>
              <th className="roster-select" scope="col">
                <input
                  aria-label="选择本页全部参与者"
                  type="checkbox"
                  checked={!!people.length && ids.length === people.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? people.map((p) => p.id) : [])
                  }
                />
              </th>
              <th className="roster-identity" scope="col">
                参与者
              </th>
              <th>在场状态</th>
              <th>性别 / 年龄段</th>
              <th>当前阶段</th>
              <th className="roster-actions" scope="col">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td className="roster-select">
                  <input
                    aria-label={`选择${p.name || "匿名参与者"}`}
                    type="checkbox"
                    checked={ids.includes(p.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...ids, p.id]
                          : ids.filter((id) => id !== p.id),
                      )
                    }
                  />
                </td>
                <td className="roster-identity">
                  <div className="table-person">
                    <Avatar person={p} size="xs" />
                    <strong
                      className="roster-name"
                      title={p.name || "尚未填写昵称"}
                    >
                      {p.name || "尚未填写昵称"}
                    </strong>
                  </div>
                </td>
                <td>
                  <PresenceStatus present={p.present} />
                </td>
                <td>
                  {p.gender === "male" ? "男生" : "女生"} · {p.age || "未填写"}
                </td>
                <td>
                  <PhaseStatus label={phase(state, p)} />
                </td>
                <td className="roster-actions">
                  <button className="table-action" onClick={() => onOpen(p.id)}>
                    查看详情
                  </button>
                  <button
                    className="table-action"
                    onClick={() => setSelected([p.id])}
                  >
                    选择并管理
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!people.length && (
          <p className="empty-list">暂无符合条件的现场参与者</p>
        )}
      </div>
    </section>
  );
}
