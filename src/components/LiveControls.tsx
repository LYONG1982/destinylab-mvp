"use client";
import { useState, useSyncExternalStore } from "react";
import type { DemoState, Invitation } from "@/domain/types";
import * as live from "@/lib/api/live-client";
import { Brand, Button, Loading, Notice } from "./ui";

const subscribe = () => () => {};
export function LiveGate({ problem }: { problem: string }) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!mounted || !live.isLive()) return <Loading />;
  const operator = location.pathname.startsWith("/admin");
  return (
    <main className="live-access">
      <Brand />
      <h1>{operator ? "现场运营登录" : "正在连接活动"}</h1>
      <p>活动：{live.activity()}</p>
      {operator ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await live.login(username, password);
              setPassword("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败。");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            运营账号
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "正在登录…" : "登录"}
          </Button>
        </form>
      ) : (
        <Button onClick={live.retry}>重新连接</Button>
      )}
      {(error || problem) && (
        <Notice
          tone={!error && problem === "请使用运营账号登录。" ? "info" : "error"}
        >
          {error || problem}
        </Notice>
      )}
    </main>
  );
}
export function LiveOperatorPanel({
  state,
  problem,
}: {
  state: DemoState;
  problem: string;
}) {
  const [questionId, setQuestionId] = useState("q1"),
    [point, setPoint] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (!state.live) return null;
  const question = state.live.questions.find((q) => q.id === questionId);
  return (
    <section className="live-operator" aria-label="实时活动数据">
      <div className="live-toolbar">
        <strong>
          活动 {state.live.activity} · {problem ? "连接中断" : "数据已同步"}
        </strong>
        <span>大屏当前展示第一题</span>
        {typeof document !== "undefined" &&
          document.documentElement.dataset.mini === "true" &&
          (["registration", "encounter"] as const).map((entry) => (
            <div key={entry}>
              <Button
                kind="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMessage("");
                  try {
                    const response = await fetch(
                      `/api/mini/code?activity=${encodeURIComponent(state.live!.activity)}&entry=${entry}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                      },
                    );
                    const result = await response.json();
                    if (!response.ok)
                      throw new Error(result.error || "生成失败。");
                    setMessage(
                      `${entry === "registration" ? "报名" : "现场互动"}小程序码已准备，可查看或下载。`,
                    );
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "生成失败。");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                生成{entry === "registration" ? "报名" : "现场互动"}码
              </Button>
              <a
                href={`/api/mini/code?activity=${encodeURIComponent(state.live!.activity)}&entry=${entry}`}
                target="_blank"
                rel="noreferrer"
              >
                查看{entry === "registration" ? "报名" : "现场互动"}码
              </a>
              <a
                href={`/api/mini/code?activity=${encodeURIComponent(state.live!.activity)}&entry=${entry}`}
                download={`遇见-${entry}.png`}
              >
                下载
              </a>
            </div>
          ))}
        <Button
          kind="text"
          onClick={() =>
            void live.signOut().catch(() => setMessage("退出失败，请重试。"))
          }
        >
          退出登录
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      <details>
        <summary>题目统计与相遇点配置</summary>
        <div className="live-settings">
          <div>
            <label>
              查看题目统计
              <select
                value={questionId}
                onChange={(e) => setQuestionId(e.target.value)}
              >
                {state.live.questions.map((q, i) => (
                  <option key={q.id} value={q.id}>
                    {i + 1}. {q.title}
                  </option>
                ))}
              </select>
            </label>
            <p>已回答 {question?.total || 0} 人</p>
            <ul>
              {question?.options.map((o) => (
                <li key={o.label}>
                  {o.label}：{o.count} 人（{o.percentage}%）
                </li>
              ))}
            </ul>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setMessage("");
              try {
                await live.command({ type: "point-add", name: point });
                setPoint("");
                setMessage("相遇点已添加。");
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "添加失败。");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              添加现场已设置的相遇点
              <input
                value={point}
                required
                pattern="Meet[0-9]{2,3}"
                placeholder="例如 Meet01"
                onChange={(e) => setPoint(e.target.value)}
              />
            </label>
            <p>
              默认 Meet01–Meet20，可继续添加编号。当前 {state.points.length}{" "}
              个相遇点，{state.points.filter((p) => !p.closed).length}{" "}
              个已启用。
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? "正在保存…" : "添加相遇点"}
            </Button>
            {message && <p role="status">{message}</p>}
          </form>
        </div>
      </details>
    </section>
  );
}
export function PairDisplayPermission({
  state,
  invitation,
  actor,
}: {
  state: DemoState;
  invitation: Invitation;
  actor: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (
    !state.live ||
    !invitation.acceptedAt ||
    (!invitation.realMeetAt &&
      !["ACCEPTED", "MEET_ASSIGNED", "ARRIVING"].includes(invitation.status))
  )
    return null;
  const allowed = state.displayGrants?.[invitation.id]?.[actor] === true;
  return (
    <section className="live-permission" aria-label="本次相遇公开展示">
      <strong>让这次相遇被看见</strong>
      <p>
        双方都同意后，大屏才会展示你们的活动昵称、系统头像与相遇连线。你可随时撤回，不影响见面。
      </p>
      <Button
        kind="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await live.command({
              type: "display-consent",
              invitationId: invitation.id,
              allow: !allowed,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "未能保存，请重试。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在保存…" : allowed ? "撤回本次公开展示" : "允许本次公开展示"}
      </Button>
      {allowed && <small>你已允许，展示还需对方独立同意。</small>}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

export function PastDisplayPermissions({ state }: { state: DemoState }) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  if (!state.live?.displayPermissions?.length) return null;
  return (
    <details className="live-permission">
      <summary>管理之前相遇的公开展示许可</summary>
      {state.live.displayPermissions.map((p) => (
        <div key={p.invitationId}>
          <span>与 {p.otherName} 的相遇</span>
          <Button
            kind="text"
            disabled={!!busy}
            onClick={async () => {
              setBusy(p.invitationId);
              setError("");
              try {
                await live.command({
                  type: "display-consent",
                  invitationId: p.invitationId,
                  allow: false,
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : "撤回失败，请重试。");
              } finally {
                setBusy("");
              }
            }}
          >
            撤回公开展示
          </Button>
        </div>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </details>
  );
}
