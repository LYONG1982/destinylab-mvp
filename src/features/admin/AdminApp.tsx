"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useDemo, useAction } from "@/lib/demo/hooks";
import type {
  Command,
  DemoState,
  Invitation,
  Participant,
} from "@/domain/types";
import {
  ACTIVE_STATUSES,
  alerts,
  available,
  complete,
  nowOf,
  person,
  phase,
  stats,
} from "@/domain/selectors";
import { QUESTIONS, STATUS_LABELS } from "@/data/questions";
import {
  Avatar,
  Badge,
  Brand,
  Button,
  Empty,
  Icon,
  Loading,
  Modal,
  Notice,
  timeText,
} from "@/components/ui";
import { AnimatedCounter } from "@/components/motion/AnimatedCounter";
import { Motion } from "@/components/motion/Motion";

const NAV = [
  ["dashboard", "现场总览", "grid"],
  ["encounters", "邀请相遇", "heart"],
  ["participants", "参与用户", "people"],
  ["partners", "相遇伙伴", "coffee"],
];
export function AdminApp({ page }: { page: string }) {
  const { state, problem } = useDemo();
  if (!state) return <Loading />;
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
            href={`/admin/${href}`}
            className={page === href ? "active" : ""}
            aria-current={page === href ? "page" : undefined}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </Link>
        ))}
        <Link href="/demo">
          <Icon name="help" />
          <span>演示入口</span>
        </Link>
      </nav>
      <header className="admin-topbar">
        <div>
          <strong>
            缘分实验室{" "}
            <span style={{ fontWeight: 300, color: "#b5a496" }}>／</span>{" "}
            银川鼓楼
          </strong>
          <span className="activity-status">
            {s.activityPaused ? "新邀请已暂停" : "活动运行中"}
          </span>
        </div>
        <div>
          <small>SOCIAL</small>
          <Badge>本地演示</Badge>
          <span className="fine">现场运营</span>
        </div>
      </header>
      <main className="admin-main">
        <div className="admin-title">
          <div>
            <div className="eyebrow">DESTINY LAB · OPERATIONS</div>
            <h1>{title}</h1>
            <p>
              2026 年 11 月 7 日 · 鼓楼步行街{" "}
              <span>／ 演示时间 {timeText(nowOf(s))}</span>
            </p>
          </div>
          <div className="admin-actions">
            <Button
              kind="secondary"
              onClick={() =>
                confirm(
                  s.activityPaused ? "恢复新邀请？" : "暂停新邀请？",
                  "这只影响新邀请，已经接受的相遇可以继续。",
                  { type: "pause", value: !s.activityPaused },
                )
              }
            >
              {s.activityPaused ? "恢复新邀请" : "暂停新邀请"}
            </Button>
            <Link href="/screen" target="_blank">
              <Icon name="screen" size={17} />
              查看大屏
            </Link>
          </div>
        </div>
        {problem && <Notice tone="error">{problem}</Notice>}
        {a.error && <Notice tone="error">{a.error}</Notice>}
        {success && <Notice tone="success">{success}</Notice>}
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
                  label: "正在前往",
                  value: m.going,
                  hint: "已出发的相遇安排",
                  icon: "pin",
                },
                {
                  label: "今日真实相遇",
                  value: m.real,
                  hint: "双方均确认已经见面",
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
                      href={`/admin/participants?stage=${x.filter}`}
                    >
                      <span>{x.title}</span>
                      <div>
                        <i style={{ width: `${(x.value / m.scans) * 100}%` }} />
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
              <Panel
                title="相遇点状态"
                subtitle="见面确认后，场地仍需单独确认空闲"
              >
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>相遇点</th>
                        <th>状态</th>
                        <th>当前相遇</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.points.map((p) => {
                        const i = s.invitations.find(
                          (i) => i.id === p.occupant,
                        );
                        return (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                              <div className="fine">{p.location}</div>
                            </td>
                            <td>
                              <Badge
                                tone={
                                  !p.occupant && !p.closed
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {p.closed
                                  ? "暂停开放"
                                  : i
                                    ? i.status === "CONFIRMED" ||
                                      !ACTIVE_STATUSES.includes(i.status)
                                      ? "待确认空闲"
                                      : "使用中"
                                    : "空闲"}
                              </Badge>
                            </td>
                            <td>
                              {i ? (
                                <button
                                  className="table-action"
                                  onClick={() => setInviteId(i.id)}
                                >
                                  {person(s, i.from)?.name} ·{" "}
                                  {person(s, i.to)?.name}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              <button
                                className="table-action"
                                disabled={
                                  (!!i && ACTIVE_STATUSES.includes(i.status)) ||
                                  (!p.occupant && !p.closed)
                                }
                                onClick={() =>
                                  confirm(
                                    `确认 ${p.name} 已空闲？`,
                                    "确认场地已无人使用后，系统可能为等待中的两人分配此处。",
                                    { type: "release", pointId: p.id },
                                  )
                                }
                              >
                                确认空闲
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
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
              <small>不可拖拽改变见面事实</small>
            </div>
            <div className="kanban">
              {[
                { title: "等待回应", states: ["SENT"] },
                {
                  title: "双方愿意见面",
                  states: ["ACCEPTED", "MEET_ASSIGNED"],
                },
                { title: "前往相遇点", states: ["ARRIVING"] },
                { title: "已确认见面", states: ["CONFIRMED"] },
              ].map((col) => {
                const items = s.invitations.filter(
                  (i) =>
                    col.states.includes(i.status) &&
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
              当前 MVP 保留商户展示与去向选择。商户核销和服务授权暂不实现。
            </Notice>
          </>
        )}
        <p className="local-note">
          本地演示数据 · 不包含真实联系方式 · 当前操作不会发送外部消息
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
              <Badge>{phase(s, selectedPerson)}</Badge>
            </div>
          </div>
          <div className="detail-meta">
            <div>
              <small>加入时间</small>
              <strong>{timeText(selectedPerson.joinedAt)}</strong>
            </div>
            <div>
              <small>在场状态</small>
              <strong>{selectedPerson.present ? "在场" : "已离场"}</strong>
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
                  "进行中的邀请将结束；已出发的相遇点仍需工作人员确认空闲。",
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
              return (
                <div key={id}>
                  <Avatar person={p} size="md" />
                  <strong>{p.name}</strong>
                  <small>
                    {selectedInvite.confirmations[id]
                      ? "已确认见面"
                      : selectedInvite.arrivals[id]
                        ? "已到达"
                        : selectedInvite.departures[id]
                          ? "已出发"
                          : "尚未出发"}
                  </small>
                </div>
              );
            })}
          </div>
          <div className="detail-meta">
            <div>
              <small>状态</small>
              <strong>{STATUS_LABELS[selectedInvite.status]}</strong>
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
          <Notice>工作人员不能代替任一参与者确认出发、到达或已经见面。</Notice>
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <small>{subtitle}</small>
      </div>
      {children}
    </section>
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
        {STATUS_LABELS[i.status]}
      </Badge>
      <div className="encounter-meta">
        <div>
          <span>
            {s.points.find((p) => p.id === i.pointId)?.name || "相遇点待分配"}
          </span>
          <span>{timeText(i.createdAt)}</span>
        </div>
        <div>
          <span>
            {from.name}：
            {i.confirmations[from.id]
              ? "已见面"
              : i.arrivals[from.id]
                ? "已到达"
                : i.departures[from.id]
                  ? "已出发"
                  : "待出发"}
          </span>
          <span>
            {to.name}：
            {i.confirmations[to.id]
              ? "已见面"
              : i.arrivals[to.id]
                ? "已到达"
                : i.departures[to.id]
                  ? "已出发"
                  : "待出发"}
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
        (i) => !!i.realMeetAt && [i.from, i.to].includes(p.id),
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
              ["real", "已有真实见面"],
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
      <section className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>参与者</th>
                <th>性别 / 年龄段</th>
                <th>加入时间</th>
                <th>在场状态</th>
                <th>当前阶段</th>
                <th>发出邀请</th>
                <th>真实见面</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.slice((currentPage - 1) * 12, currentPage * 12).map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="table-person">
                      <Avatar person={p} size="xs" />
                      <strong>{p.name}</strong>
                    </div>
                  </td>
                  <td>
                    {p.gender === "male" ? "男生" : "女生"} · {p.age}
                  </td>
                  <td>{timeText(p.joinedAt)}</td>
                  <td>
                    <Badge tone={p.present ? "success" : "neutral"}>
                      {p.present ? "在场" : "已离场"}
                    </Badge>
                  </td>
                  <td>{phase(s, p)}</td>
                  <td>{s.invitations.filter((i) => i.from === p.id).length}</td>
                  <td>
                    {
                      s.invitations.filter(
                        (i) => i.realMeetAt && [i.from, i.to].includes(p.id),
                      ).length
                    }
                  </td>
                  <td>
                    <button
                      className="table-action"
                      onClick={() => onOpen(p.id)}
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty title="没有符合条件的参与者">换一个昵称或筛选条件试试</Empty>
        )}
        <div className="pagination">
          <button
            aria-label="上一页"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            ‹
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            aria-label="下一页"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            ›
          </button>
        </div>
      </section>
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
