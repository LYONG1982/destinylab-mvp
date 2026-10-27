"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import type { DemoState } from "@/domain/types";
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
  const locked = useRef(false);
  if (!mounted || !live.isLive()) return <Loading />;
  const operator = location.pathname.startsWith("/admin");
  const removed = !operator && !!live.getRemovedEntry();
  return (
    <main className="live-access">
      <Brand />
      <h1>
        {operator
          ? "现场运营登录"
          : removed
            ? "上次参与已结束"
            : "正在连接活动"}
      </h1>
      <p>活动：{live.activity()}</p>
      {removed && <p>原参与记录已归档。重新参与需填写本场资料并重新答题。</p>}
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
        <Button
          disabled={busy}
          onClick={async () => {
            if (locked.current) return;
            if (!removed) {
              (problem.includes("本轮参与已结束")
                ? live.reenter
                : live.retry)();
              return;
            }
            locked.current = true;
            setBusy(true);
            setError("");
            try {
              await live.rejoin();
            } catch (e) {
              setError(e instanceof Error ? e.message : "进入失败，请重试。");
            } finally {
              locked.current = false;
              setBusy(false);
            }
          }}
        >
          {busy
            ? "正在进入…"
            : removed
              ? "重新参与"
              : problem.includes("本轮参与已结束")
                ? "重新进入现场"
                : "重新连接"}
        </Button>
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
        <span>
          当前展示：
          {state.live.questions.find((q) => q.id === state.displayQuestionId)
            ?.title || "第一题"}
        </span>
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
                生成{entry === "registration" ? "报名" : "现场互动"}小程序码
              </Button>
              <a
                href={`/api/mini/code?activity=${encodeURIComponent(state.live!.activity)}&entry=${entry}`}
                target="_blank"
                rel="noreferrer"
              >
                查看{entry === "registration" ? "报名" : "现场互动"}小程序码
              </a>
              <a
                href={`/api/mini/code?activity=${encodeURIComponent(state.live!.activity)}&entry=${entry}`}
                download={`遇见-${entry}.png`}
              >
                下载
              </a>
            </div>
          ))}
      </div>
      {message && <p role="status">{message}</p>}
      <details open>
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
              默认 Meet01–Meet30，可继续添加编号。当前 {state.points.length}{" "}
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
