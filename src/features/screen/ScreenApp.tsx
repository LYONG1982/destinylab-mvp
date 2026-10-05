"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { QUESTIONS } from "@/data/questions";
import { screenMotion } from "@/lib/motion-tokens";
import { useDemo } from "@/lib/demo/hooks";
import { command } from "@/lib/demo/store";
import type { DemoState } from "@/domain/types";
import { ScreenAdapter } from "@/components/motion/screen/model";
import { ScreenMotion } from "@/components/motion/screen/ScreenMotion";
import { SceneTransition } from "@/components/motion/screen/SceneTransition";
import { MotionController } from "@/components/motion/screen/controller";
import { MotionPreview } from "@/components/motion/screen/MotionPreview";
import { Brand, Loading } from "@/components/ui";
import { AnimatedCounter } from "@/components/motion/AnimatedCounter";
import { AnimatedBar } from "@/components/motion/AnimatedBar";
import { DestinyTrack } from "@/components/motion/DestinyTrack";

export type ScreenState = "question" | "presence" | "mutual" | "real-meet";

export function ScreenApp({ fixed }: { fixed?: ScreenState }) {
  const { state } = useDemo();
  if (!state) return <Loading />;
  return <ScreenView key={state.epoch} state={state} fixed={fixed} />;
}
function ScreenView({
  state,
  fixed,
}: {
  state: DemoState;
  fixed?: ScreenState;
}) {
  const [adapter] = useState(() => new ScreenAdapter());
  const [controller] = useState(() => new MotionController());
  const snapshot = useMemo(() => adapter.read(state), [adapter, state]);
  const p = snapshot.projection;
  const [mode, setMode] = useState<ScreenState>(fixed || "question");
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState("");
  const [url] = useState(() => {
    try {
      return (
        localStorage.getItem("destinylab:qr-url") ||
        "http://localhost:3210/mobile/01-start"
      );
    } catch {
      return "http://localhost:3210/mobile/01-start";
    }
  });
  useEffect(() => {
    const target = url;
    void QRCode.toDataURL(target, {
      width: 768,
      margin: 3,
      errorCorrectionLevel: "M",
      color: { dark: "#5c1724", light: "#fffdf9" },
    })
      .then(setQr)
      .catch(() => setQrError("二维码生成失败，请检查演示入口配置。"));
  }, [url]);
  useEffect(() => {
    if (fixed) return;
    const delays: Record<ScreenState, number> = {
      question: 12000,
      presence: 8000,
      "real-meet": 8000,
      mutual: 6000,
    };
    const timer = setTimeout(() => {
      if (mode === "mutual") {
        setMode("question");
        return;
      }
      if (p.canBroadcast) {
        void command("operator", { type: "broadcast-consume" })
          .then(() => setMode("mutual"))
          .catch(() =>
            setMode(
              mode === "question"
                ? "presence"
                : mode === "presence"
                  ? "real-meet"
                  : "question",
            ),
          );
      } else
        setMode(
          mode === "question"
            ? "presence"
            : mode === "presence"
              ? "real-meet"
              : "question",
        );
    }, delays[mode]);
    return () => clearTimeout(timer);
  }, [mode, fixed, p.canBroadcast]);
  return (
    <main className="screen-viewport">
      <div
        className={`screen-canvas ${mode === "mutual" ? "screen-mutual" : ""}`}
        data-testid="screen-canvas"
        style={
          {
            "--screen-background-duration": `${screenMotion.background}s`,
            "--screen-qr-duration": `${screenMotion.qrHalo}s`,
          } as CSSProperties
        }
      >
        <div className="screen-background" aria-hidden="true" />
        <ScreenMotion
          snapshot={snapshot}
          controller={controller}
          scene={mode}
        />
        {process.env.NODE_ENV === "development" && (
          <MotionPreview controller={controller} />
        )}
        <header className="screen-top">
          <Brand light={mode === "mutual"} />
          <span>银川 · 鼓楼步行街 ／ 让一座城更温柔</span>
        </header>
        <div className="screen-main">
          <section className="screen-content">
            <SceneTransition scene={mode}>
              {mode === "question" && (
                <>
                  <div className="eyebrow">ONE QUESTION. MANY CONNECTIONS.</div>
                  <h1>
                    今天，
                    <br />
                    <span>想怎样遇见？</span>
                  </h1>
                  <div className="screen-distribution">
                    {p.options.map((v) => (
                      <div className="screen-bar" key={v.label}>
                        <span>{v.label}</span>
                        <div>
                          <AnimatedBar percentage={v.percentage} fromZero />
                        </div>
                        <strong>
                          <AnimatedCounter
                            value={v.percentage}
                            suffix="%"
                            fromZero
                          />
                        </strong>
                      </div>
                    ))}
                  </div>
                  <p className="fine">
                    今天已回答此题的 {p.total} 位参与者 · 演示数据
                  </p>
                </>
              )}
              {mode === "presence" && (
                <>
                  <div className="eyebrow">HERE & NOW · 此刻在场</div>
                  <div className="screen-number">
                    <AnimatedCounter value={p.active} fromZero />
                  </div>
                  <h1>人正在鼓楼探索</h1>
                  <p className="screen-subtext">
                    其中 {p.canMeet} 人，现在可以认识新朋友
                  </p>
                  <div className="presence-network" aria-hidden="true">
                    {Array.from({ length: 8 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          left: `${50 + 48 * Math.cos((i * Math.PI) / 4)}%`,
                          top: `${50 + 48 * Math.sin((i * Math.PI) / 4)}%`,
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
              {mode === "mutual" && (
                <>
                  <div className="eyebrow">WHEN PATHS CROSS</div>
                  <div className="relationship-tracks" aria-hidden="true">
                    <DestinyTrack />
                  </div>
                  <h1>
                    今天，又有人
                    <br />
                    愿意认识彼此
                  </h1>
                  <p className="screen-subtext">从共同话题，走向真实的相遇</p>
                  <p className="fine" style={{ color: "#d7b8b8" }}>
                    {fixed
                      ? "独立视觉预览 · 虚构场景"
                      : "匿名聚合播报 · 不展示个人身份"}
                  </p>
                </>
              )}
              {mode === "real-meet" && (
                <>
                  <div className="eyebrow">REAL MOMENTS · 认真发生</div>
                  <div
                    className="screen-number"
                    data-testid="screen-real-count"
                  >
                    <AnimatedCounter value={p.real} fromZero />
                  </div>
                  <h1>
                    次真实相遇，
                    <br />
                    今天已经在鼓楼发生
                  </h1>
                  <p className="screen-subtext">双方均确认已经见面</p>
                </>
              )}
            </SceneTransition>
          </section>
          <aside className="screen-qr">
            {qr ? (
              <img src={qr} alt="扫码进入缘分实验室" width="768" height="768" />
            ) : (
              <div>{qrError || "正在生成二维码…"}</div>
            )}
            <h2>
              扫码加入
              <br />
              今天的遇见
            </h2>
            <p>
              回答 {QUESTIONS.length} 个轻问题
              <br />
              发现现场同频的人
            </p>
            <small>
              {url.includes("localhost")
                ? "本机入口 · 手机扫码需可访问的局域网地址"
                : "请在可访问此地址的网络中扫码"}
            </small>
          </aside>
        </div>
        <footer className="screen-bottom">
          <span>
            DESTINY LAB ／{" "}
            {p.paused ? "新邀请暂时休息中" : "从一个共同话题，开始认识"}
          </span>
          <div className="rotation-dots">
            {["question", "presence", "real-meet"].map((v) => (
              <i key={v} className={mode === v ? "active" : ""} />
            ))}
          </div>
          <span>本地演示 · 不显示个人信息</span>
        </footer>
      </div>
    </main>
  );
}
