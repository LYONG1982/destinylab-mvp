"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { DemoState } from "@/domain/types";
import { Button, Notice } from "@/components/ui";
import { LiveOperatorPanel } from "@/components/LiveControls";
import { RegistrationAdmin } from "@/features/registration/RegistrationAdmin";
import * as live from "@/lib/api/live-client";
import { clientId } from "@/lib/client-id";
import { AdminDialog } from "./AdminPrimitives";

type Activity = {
  id: string;
  title: string;
  open: boolean;
  registration_open: boolean;
};
type Overview = {
  activities: Activity[];
  actions: {
    action: string;
    staff: string;
    created_at: string;
    result: { count: number };
  }[];
  archives: {
    id: string;
    action: string;
    created_at: string;
    participants: number;
  }[];
};
const labels: Record<string, string> = {
  leave: "标记离场",
  return: "恢复入场",
  remove: "从本场移除",
  reset: "结束本轮并清零现场",
  open: "开放现场",
  close: "关闭现场",
  create: "创建活动",
};
const confirmations: Record<string, string> = {
  leave: "确认离场",
  return: "确认恢复",
  remove: "确认移除",
  reset: "确认清零",
};
export async function fieldApi<T>(
  activity: string,
  path: string,
  input?: unknown,
  id?: string,
): Promise<T> {
  const response = await fetch(
    `/api/field/${path}?activity=${encodeURIComponent(activity)}`,
    {
      method: input ? "POST" : "GET",
      cache: "no-store",
      headers: input
        ? {
            "Content-Type": "application/json",
            "Idempotency-Key": id || clientId(),
          }
        : undefined,
      body: input ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "请求失败，请重试。");
  return body;
}
export function ActivitySwitch({
  activity,
  agency = false,
}: {
  activity: string;
  agency?: boolean;
}) {
  const [items, setItems] = useState<Activity[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    const url = agency
      ? `/api/tongzhou/activities?activity=${encodeURIComponent(activity)}`
      : `/api/field/overview?activity=${encodeURIComponent(activity)}`;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error || "活动列表读取失败");
        return b;
      })
      .then((b) => {
        if (current) setItems(agency ? b : b.activities);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [activity, agency]);
  return (
    <label className="activity-switch">
      活动{" "}
      <select
        aria-label="切换活动"
        value={activity}
        onChange={async (e) => {
          const target = e.target.value;
          try {
            if (agency) {
              const r = await fetch(
                `/api/tongzhou/switch?activity=${encodeURIComponent(activity)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ target }),
                },
              );
              if (!r.ok) throw Error((await r.json()).error);
            } else await fieldApi(activity, "switch", { target });
            // A full navigation resets the activity-scoped singleton SSE client.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            location.assign(
              `${agency ? "/agency/tongzhou" : location.pathname}?activity=${encodeURIComponent(target)}`,
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "切换失败");
          }
        }}
      >
        <option value={activity}>{activity}</option>
        {items
          .filter((a) => a.id !== activity)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} · {a.title}
            </option>
          ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
export function FieldActions({
  state,
  ids = [],
  reset = false,
  onDone,
}: {
  state: DemoState;
  ids?: string[];
  reset?: boolean;
  onDone?: () => void;
}) {
  const activity = state.live?.activity || "meet";
  const previewTrigger = useRef<HTMLElement | null>(null);
  const [task, setTask] = useState<{
      action: string;
      preview: string;
      count: number;
      invitations: number;
      ids: string[];
      epoch: string;
      id: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [cleared, setCleared] = useState(false);
  async function preview(action: string) {
    if (busy) return;
    previewTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const p = await fieldApi<{
        token: string;
        participants: number;
        invitations: number;
      }>(activity, "preview", { action, ids, epoch: state.epoch });
      setTask({
        action,
        preview: p.token,
        count: p.participants,
        invitations: p.invitations,
        ids: [...ids],
        epoch: state.epoch,
        id: clientId(),
      });
      setConfirmation("");
      setCleared(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="field-actions"
      aria-label={reset ? "现场清零" : "批量现场操作"}
    >
      {reset ? (
        <Button
          disabled={busy || state.fieldOpen !== false}
          kind="secondary"
          className="admin-danger-action"
          onClick={() => preview("reset")}
        >
          结束本轮并清零现场
        </Button>
      ) : ids.length ? (
        <>
          <span className="field-selection-count" role="status">
            已选 <strong>{ids.length}</strong> 人
          </span>
          <div className="field-routine-actions">
            {["leave", "return"].map((a) => (
              <Button
                key={a}
                kind="secondary"
                disabled={busy || !ids.length}
                onClick={() => preview(a)}
              >
                {labels[a]}
              </Button>
            ))}
          </div>
          <div className="field-remove-action">
            <Button
              kind="secondary"
              className="admin-danger-action"
              disabled={busy}
              onClick={() => preview("remove")}
            >
              从本场移除
            </Button>
          </div>
        </>
      ) : (
        <span className="field-selection-hint">
          勾选名单，可批量标记离场或恢复入场。
        </span>
      )}
      {error && !task && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {task && (
        <AdminDialog
          title={labels[task.action]}
          variant="confirm"
          busy={busy}
          returnFocus={previewTrigger}
          onClose={() => {
            setTask(null);
            setError("");
          }}
        >
          <div className="field-confirm-content">
            <div className="field-impact">
              <span>
                影响参与者
                <strong>
                  {task.count}
                  <small> 人</small>
                </strong>
              </span>
              <span>
                关联相遇记录
                <strong>
                  {task.invitations}
                  <small> 条</small>
                </strong>
              </span>
            </div>
            <div className="field-retention">
              <strong>报名与同舟档案保留</strong>
              <p>已授权照片、跟进记录与公开主页保持不变。</p>
            </div>
            <p>
              {task.action === "leave"
                ? "离场将停止当前互动；现场开放时，本人可点击继续参与再次入场。已使用的遇见地点仍需工作人员确认空闲。"
                : task.action === "remove"
                  ? "从本场有效名单和统计中移除，历史记录保留在受限归档。"
                  : task.action === "return"
                    ? "恢复本轮身份，参与者可继续完善资料并主动开启遇见。"
                    : "清零后现场保持关闭，需要手动开放新一轮。"}
            </p>
            {task.action === "reset" && (
              <>
                <label>
                  输入活动标识 {activity}
                  <input
                    aria-label="确认活动标识"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={cleared}
                    onChange={(e) => setCleared(e.target.checked)}
                  />
                  已确认现场所有遇见地点空闲
                </label>
              </>
            )}
            {error && (
              <Notice tone="error">
                {error}。如状态已变化，请取消后重新预览。
              </Notice>
            )}
            <div className="field-confirm-buttons">
              <Button
                className={
                  task.action === "remove" || task.action === "reset"
                    ? "admin-danger-confirm"
                    : undefined
                }
                disabled={
                  busy ||
                  (task.action === "reset" &&
                    (confirmation !== activity || !cleared))
                }
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await fieldApi(
                      activity,
                      "action",
                      {
                        action: task.action,
                        ids: task.ids,
                        epoch: task.epoch,
                        preview: task.preview,
                        confirmation,
                        cleared,
                      },
                      task.id,
                    );
                    setMessage("操作已由服务器确认。");
                    setTask(null);
                    onDone?.();
                    live.retry();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "正在处理…" : confirmations[task.action]}
              </Button>
              <Button
                kind="text"
                disabled={busy}
                onClick={() => {
                  setTask(null);
                  setError("");
                }}
              >
                取消
              </Button>
            </div>
          </div>
        </AdminDialog>
      )}
    </section>
  );
}
function EntryCards({ activity }: { activity: string }) {
  const [cards, setCards] = useState<
      { title: string; url: string; image: string; generatedAt: string }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all(
      [
        ["活动报名", "register"],
        ["现场互动", "01-start"],
      ].map(async ([title, path]) => {
        const url = `${location.origin}/mobile/${path}?activity=${encodeURIComponent(activity)}`;
        return {
          title,
          url,
          generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          image: await QRCode.toDataURL(url, {
            width: 2120,
            margin: 4,
            errorCorrectionLevel: "H",
            color: { dark: "#800020", light: "#ffffff" },
          }),
        };
      }),
    )
      .then((x) => {
        if (active) setCards(x);
      })
      .catch(() => setError("二维码生成失败，请刷新重试。"));
    return () => {
      active = false;
    };
  }, [activity]);
  return (
    <section className="entry-cards">
      {error && <Notice tone="error">{error}</Notice>}
      {cards.map((c) => (
        <article key={c.title}>
          <div>
            <h3>{c.title}二维码</h3>
            <p>
              {c.title === "活动报名"
                ? "填写报名资料，领取邀请函，完善个人档案。"
                : "无需提前报名，直接参与答题与现场相遇。"}
            </p>
            <small>
              H5 网页 · 活动 {activity}
              <br />
              生成于 {c.generatedAt}
            </small>
            <a href={c.url} target="_blank" rel="noreferrer">
              打开入口 ↗
            </a>
            <a href={c.image} download={`${activity}-${c.title}-H5.png`}>
              下载高清二维码
            </a>
          </div>
          <img
            src={c.image}
            width="144"
            height="144"
            alt={`${c.title}二维码`}
          />
        </article>
      ))}
    </section>
  );
}
export function ActivityManagement({
  state,
  problem,
}: {
  state: DemoState;
  problem: string;
}) {
  const activity = state.live?.activity || "meet";
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState(""),
    [copy, setCopy] = useState(false);
  async function load() {
    setData(await fieldApi<Overview>(activity, "overview"));
  }
  useEffect(() => {
    let active = true;
    fieldApi<Overview>(activity, "overview")
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [activity, state.epoch, state.fieldOpen]);
  async function run(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await fieldApi(activity, "action", { ...input, epoch: state.epoch });
      await load();
      live.retry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="activity-management">
      {error && <Notice tone="error">{error}</Notice>}
      <section className="panel management-panel">
        <h2>现场控制</h2>
        <p>
          现场{state.fieldOpen === false ? "已关闭" : "已开放"}
          。报名开放状态独立设置；关闭现场保留当前记录。
        </p>
        <Button
          disabled={busy}
          kind="secondary"
          onClick={() => {
            if (
              confirm(
                state.fieldOpen === false
                  ? "开放现场，允许用户主动加入？"
                  : "关闭现场后暂停现场互动，报名和同舟资料不受影响，是否继续？",
              )
            )
              void run({
                action: state.fieldOpen === false ? "open" : "close",
              });
          }}
        >
          {state.fieldOpen === false ? "开放现场" : "关闭现场"}
        </Button>
        <Button
          kind="text"
          disabled={busy}
          onClick={() => {
            if (confirm("只影响新邀请，已接受的相遇可继续，是否确认？"))
              void live
                .command({ type: "pause", value: !state.activityPaused })
                .catch((e) => setError(e.message));
          }}
        >
          {state.activityPaused ? "恢复新邀请" : "暂停新邀请"}
        </Button>
      </section>
      <EntryCards activity={activity} />
      <RegistrationAdmin activity={activity} settingsOnly />
      <LiveOperatorPanel state={state} problem={problem} />
      <section className="panel management-panel">
        <h2>创建另一场活动</h2>
        <p>不同活动使用独立入口和数据。新活动默认关闭报名与现场。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "create", target, copySettings: copy });
          }}
        >
          <input
            aria-label="新活动标识"
            placeholder="例如 meet-autumn"
            required
            pattern="[a-z0-9][a-z0-9-]{0,47}"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={copy}
              onChange={(e) => setCopy(e.target.checked)}
            />
            复制地点、商户和展示题配置
          </label>
          <Button disabled={busy} type="submit">
            创建活动
          </Button>
        </form>
        {data && (
          <div className="activity-list">
            {data.activities.map((a) => (
              <div key={a.id}>
                <strong>{a.id}</strong>
                <span>
                  报名{a.registration_open ? "开放" : "关闭"} · 现场
                  {a.open ? "开放" : "关闭"}
                </span>
                <Button
                  kind="text"
                  onClick={async () => {
                    try {
                      await fieldApi(activity, "switch", { target: a.id });
                      // A full navigation resets the activity-scoped singleton SSE client.
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                      location.assign(`/admin/activities?activity=${a.id}`);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  管理
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel management-panel danger-zone">
        <h2>数据维护</h2>
        <p>
          仅清现场互动。请先关闭现场并确认场地空闲；报名与同舟档案继续保留。
        </p>
        <FieldActions
          state={state}
          reset
          onDone={() => void load().catch((e) => setError(e.message))}
        />
      </section>
      <section className="panel management-panel">
        <h2>操作记录与历史轮次</h2>
        {!data ? (
          <p>记录加载中…</p>
        ) : (
          <>
            <ul>
              {data.actions.map((x, i) => (
                <li key={i}>
                  {new Date(x.created_at).toLocaleString("zh-CN")} · {x.staff} ·{" "}
                  {labels[x.action] || x.action} · {x.result.count} 人
                </li>
              ))}
            </ul>
            <p>受限归档 {data.archives.length} 条（最多显示最近30条）</p>
            {data.archives.map((a) => (
              <p key={a.id}>
                {new Date(a.created_at).toLocaleString("zh-CN")} ·{" "}
                {labels[a.action]} · {a.participants} 人
              </p>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
