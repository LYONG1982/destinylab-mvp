"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import QRCode from "qrcode";
import { AnimatedCounter } from "@/components/motion/AnimatedCounter";
import { WorldClock } from "./state-machine";
import { pairPath } from "./pair-geometry";
import { HEART_SVG_PATH } from "./pair-heart-shape";
import { PAIR_HEART } from "./pair-config";
import { PairSceneController } from "./pair-controller";
import { PlayerLayer } from "./PlayerLayer";
import type { WorldData, WorldFrame, WorldMode, PairCommand } from "./types";
import type { WorldRenderer } from "./WorldRenderer";
import styles from "./world.module.css";

type Control = { mode: WorldMode; fixed: boolean; revision: number };
const fieldX = [328 / 19.2, 832 / 19.2, 1336 / 19.2];
const reduceQuery = "(prefers-reduced-motion: reduce)";

function WorldQR({ joinUrl }: { joinUrl?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    if (document.documentElement.dataset.mini === "true") {
      const activity = new URL(joinUrl || location.href, location.origin).searchParams.get("activity") || document.documentElement.dataset.activity || "meet";
      const controller = new AbortController();
      let objectUrl = "", timer: ReturnType<typeof setTimeout>;
      const update = async () => {
        try {
          const response = await fetch(`/api/mini/code?activity=${encodeURIComponent(activity)}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error();
          const blob = await response.blob();
          if (!alive) return;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(blob); setCode(objectUrl); setError(false);
        } catch { if (alive) { setCode(""); setError(true); } }
        if (alive) timer = setTimeout(update, 15000);
      };
      void update();
      return () => { alive = false; controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    let url = joinUrl || "http://localhost:3210/mobile/01-start";
    try {
      if (!joinUrl) url = localStorage.getItem("destinylab:qr-url") || url;
    } catch {}
    void QRCode.toDataURL(url, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#21191e", light: "#fff9ec" },
    })
      .then((value) => {
        if (alive) setCode(value);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [joinUrl]);
  return (
    <aside className={styles.qr} data-testid="world-qr" aria-label="扫码入口">
      {code ? (
        <img src={code} width={1024} height={1024} alt="扫码加入" />
      ) : (
        <div className={styles.qrPlaceholder}>
          {error ? "活动入口待配置" : ""}
        </div>
      )}
      <strong>你呢？</strong>
      <small>扫码加入</small>
    </aside>
  );
}

function ChoiceMark({ index }: { index: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {index === 0 ? (
        <>
          <path d="M15 13h34a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H31L18 58v-9h-3a7 7 0 0 1-7-7V20a7 7 0 0 1 7-7Z" />
          <circle cx="21" cy="31" r="1.5" />
          <circle cx="32" cy="31" r="1.5" />
          <circle cx="43" cy="31" r="1.5" />
        </>
      ) : index === 1 ? (
        <>
          <path d="m14 35 8-22 9 5 8-7 6 18 10 7c5 4 4 10-2 12L19 58c-9 2-15-6-11-13l6-10Z" />
          <path d="m10 48 39-11M20 29l10 3m-6-11 11 4M12 55l43-12" />
        </>
      ) : (
        <>
          <path d="M34 18c-10-14-30-3-23 11 4 8 12 11 21 20 9-9 17-12 21-20 7-14-13-25-23-11" />
        </>
      )}
    </svg>
  );
}

export function WorldStage({
  data,
  control,
  previewIntersection,
  pairControl,
}: {
  data: WorldData;
  control: Control;
  previewIntersection: boolean;
  pairControl?: { action: PairCommand; revision: number };
}) {
  const pairControllerRef = useRef<PairSceneController | null>(null);
  const latestControl = useRef(control);
  const latestPairControl = useRef(pairControl);
  useLayoutEffect(() => {
    latestControl.current = control;
    latestPairControl.current = pairControl;
  }, [control, pairControl]);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const namesRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<HTMLDivElement>(null);
  const effectsRef = useRef<HTMLDivElement>(null);
  const playerLayerRef = useRef<PlayerLayer | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const latest = useRef(data);
  const dirty = useRef(true);
  const requestDraw = useRef<(() => void) | null>(null);
  const commits = useRef(0);
  const instanceId = useId();
  const [clock] = useState(() => new WorldClock(control.mode, control.fixed));
  const [rendererStatus, setRendererStatus] = useState("loading");
  useLayoutEffect(() => {
    latest.current = data;
    rendererRef.current?.update(data);
    pairControllerRef.current?.update(
      data.meetScene,
      document.visibilityState === "visible",
    );
    playerLayerRef.current?.update(
      data,
      document.visibilityState === "visible",
    );
    if (document.visibilityState === "visible")
      data.events.forEach((event) => clock.receive(event));
    dirty.current = true;
    requestDraw.current?.();
  }, [data, clock]);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host) host.dataset.renderCommits = String(++commits.current);
  });
  useEffect(() => {
    clock.reset(control.mode, control.fixed);
    dirty.current = true;
    requestDraw.current?.();
  }, [control, clock]);

  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const names = namesRef.current!;
    const preference = matchMedia(reduceQuery);
    const pairController = new PairSceneController();
    pairController.update(latest.current.meetScene, false);
    pairControllerRef.current = pairController;
    let pairRevision = 0;
    let pairUiKey = "";
    const playerLayer = new PlayerLayer(
      playersRef.current!,
      effectsRef.current!,
      host,
      latest.current,
      clock.tick(0).mode,
    );
    playerLayerRef.current = playerLayer;
    let alive = true,
      raf = 0,
      timer = 0,
      last = 0,
      metricsAt = 0;
    let uiKey = "",
      priorMode = "";
    let fallbackFrames = 0;
    const writeFrame = (frame: WorldFrame, now: number) => {
      const event = frame.intersection;
      const phase = event
        ? event.elapsedMs < 2500
          ? "gather"
          : event.elapsedMs < 3500
            ? "cross"
            : event.elapsedMs < 4700
              ? "meaning"
              : "release"
        : "idle";
      const key = `${frame.mode}:${event?.id || ""}:${phase}`;
      const changed = key !== uiKey;
      if (changed) {
        uiKey = key;
        host.dataset.mode = frame.mode;
        host.dataset.intersection = String(Boolean(event));
        host.dataset.eventPhase = phase;
        host
          .querySelectorAll<HTMLElement>("[data-world-copy]")
          .forEach((el) => {
            el.setAttribute(
              "aria-hidden",
              String(el.dataset.worldCopy !== frame.mode || Boolean(event)),
            );
          });
        host
          .querySelector<HTMLElement>("[data-intersection-copy]")
          ?.setAttribute(
            "aria-hidden",
            String(!event || event.elapsedMs < 2500),
          );
        if (priorMode !== frame.mode) {
          priorMode = frame.mode;
          dirty.current = true;
        }
      }
      if (now - metricsAt > 100 || changed) {
        host.dataset.modeRemainingMs = String(Math.round(frame.remainingMs));
        host.dataset.eventElapsedMs = String(Math.round(event?.elapsedMs || 0));
        host.dataset.eventQueue = String(clock.queuedCount);
        metricsAt = now;
      }
      return changed;
    };
    const draw = (time: number) => {
      if (!alive || document.visibilityState !== "visible") return;
      const delta = last ? time - last : 0;
      last = time;
      const frame = clock.tick(delta);
      const changed = writeFrame(frame, time);
      let pair = pairController.advance(
        delta,
        frame,
        latestControl.current.fixed,
      );
      const command = latestPairControl.current;
      if (
        process.env.NODE_ENV === "development" &&
        latest.current.source === "mock" &&
        command &&
        command.revision !== pairRevision
      ) {
        pairRevision = command.revision;
        pairController.command(command.action);
        pair = pairController.frame(frame.mode === "MEET");
      }
      if (playerLayer.modeName !== frame.mode)
        playerLayer.changeMode(frame.mode);
      playerLayer.draw(
        delta,
        frame,
        preference.matches,
        rendererRef.current,
        pair,
      );
      rendererRef.current?.setPairFrame(pair);
      const nextPairKey = `${pair.slots.map((s) => `${s.slot}:${s.token}:${s.phase}:${s.pair.status}`).join("|")}:${pair.layoutCount}:${pair.trail}:${pair.spark}`;
      const pairChanged = nextPairKey !== pairUiKey;
      pairUiKey = nextPairKey;
      host.dataset.pairId = pair.slots.map((s) => s.pair.id).join(",");
      host.dataset.pairPhase =
        pair.slots.map((s) => s.phase).join(",") || "empty";
      host.dataset.pairElapsedMs = String(Math.round(pair.elapsedMs));
      host.dataset.pairCount = String(pair.slots.length);
      host.dataset.pairVisible = String(
        pair.slots.length > 0 && frame.mode === "MEET",
      );
      host.dataset.pairQueue = String(pairController.queuedCount);
      host.dataset.qualifiedPairs = String(
        latest.current.meetScene?.permissionVerified === false
          ? 0
          : (latest.current.meetScene?.qualifiedPairs.length ?? 0),
      );
      host.dataset.pairTrail = String(pair.trail);
      host.dataset.pairSpark = String(pair.spark);
      host
        .querySelectorAll<HTMLElement>("[data-pair-caption]")
        .forEach((el, index) => {
          const s = pair.slots.find((s) => s.slot === index);
          el.hidden = !s;
          if (!s) return;
          el.dataset.pairId = s.pair.id;
          el.dataset.phase = s.phase;
          el.dataset.token = String(s.token);
          el.dataset.elapsedMs = String(Math.round(s.elapsedMs));
          el.style.left = `${s.layout.centerX / 19.2}cqw`;
          el.style.top = `${(pair.layoutCount === 1 ? 706 : 602) / 19.2}cqw`;
          el.style.opacity = String(s.opacity);
          const label = `${s.justConfirmed ? "刚刚 · " : ""}${s.pair.status === "meet_confirmed" ? "已确认见面" : "建立连接"}`;
          if (el.textContent !== label) el.textContent = label;
        });
      if (!rendererRef.current && (pairChanged || dirty.current)) {
        host
          .querySelectorAll<SVGGElement>("[data-pair-fallback-slot]")
          .forEach((el, index) => {
            const s = pair.slots.find((s) => s.slot === index);
            el.style.display = s ? "" : "none";
            if (!s) return;
            el.querySelectorAll("[data-pair-fallback-trail]").forEach(
              (path, side) =>
                path.setAttribute("d", pairPath(s.pattern, side, s.layout)),
            );
            const heart = el.querySelector("[data-pair-fallback-heart]")!;
            const width =
              pair.layoutCount === 1
                ? PAIR_HEART.singleWidth
                : PAIR_HEART.width;
            heart.setAttribute(
              "transform",
              `translate(${s.layout.centerX} ${s.layout.meetY}) scale(${width})`,
            );
          });
      }
      if (!preference.matches || changed || pairChanged || dirty.current) {
        rendererRef.current?.draw(time, frame, preference.matches);
        if (!rendererRef.current) {
          host.dataset.frames = String(++fallbackFrames);
        }
        dirty.current = false;
      }
    };
    const cancel = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
    };
    const tick = (time: number) => {
      draw(time);
      if (alive) raf = requestAnimationFrame(tick);
    };
    const quietTick = () => {
      draw(performance.now());
      if (alive) timer = window.setTimeout(quietTick, 200);
    };
    const sync = () => {
      cancel();
      last = 0;
      rendererRef.current?.resetTime();
      host.dataset.reduced = String(preference.matches);
      host.dataset.running = String(
        document.visibilityState === "visible" && !preference.matches,
      );
      if (document.visibilityState !== "visible") {
        clock.clearEvents();
        playerLayer.suspend();
        pairController.clearFresh();
        dirty.current = true;
        return;
      }
      dirty.current = true;
      if (preference.matches) quietTick();
      else raf = requestAnimationFrame(tick);
    };
    requestDraw.current = () => {
      dirty.current = true;
    };
    // Group asynchronous texture invalidations into the next shared frame/quiet tick.
    const invalidate = () => {
      dirty.current = true;
    };
    host.addEventListener("world-invalidate", invalidate);
    const fail = () => {
      if (!alive) return;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      names.replaceChildren();
      host.dataset.renderer = "fallback";
      host.dataset.resources = JSON.stringify({
        geometries: 0,
        textures: 0,
        programs: 0,
      });
      setRendererStatus("fallback");
      dirty.current = true;
    };
    const resize = () => {
      const box = host.getBoundingClientRect();
      rendererRef.current?.resize(box.width, box.height);
      dirty.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    void import("./WorldRenderer")
      .then(({ WorldRenderer }) => {
        if (!alive) return;
        if (previewIntersection)
          clock.receive({
            id: "fixed-intersection-preview",
            type: "mutual_confirmed",
            timestamp: Date.now(),
          });
        try {
          rendererRef.current = new WorldRenderer(
            canvas,
            names,
            host,
            latest.current,
            fail,
          );
          host.dataset.renderer = "webgl";
          setRendererStatus("webgl");
          resize();
          sync();
        } catch {
          fail();
          sync();
        }
      })
      .catch(() => {
        if (previewIntersection)
          clock.receive({
            id: "fixed-intersection-preview",
            type: "mutual_confirmed",
            timestamp: Date.now(),
          });
        fail();
        sync();
      });
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      alive = false;
      cancel();
      observer.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("world-invalidate", invalidate);
      requestDraw.current = null;
      playerLayer.dispose();
      playerLayerRef.current = null;
      pairControllerRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [clock, previewIntersection]);

  return (
    <div
      ref={hostRef}
      className={styles.stage}
      data-testid="destiny-world"
      data-mode={control.mode}
      data-renderer={rendererStatus}
      data-scene-id={instanceId}
      data-source={data.source}
      data-total={data.totalParticipants}
      data-current={data.currentParticipants}
      data-available={data.availableParticipants}
      data-meetings={data.totalMeetings}
    >
      <div className={styles.atmosphere} aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        data-layer="destiny-world"
        aria-hidden="true"
      />
      <div ref={namesRef} className={styles.playerNames} />
      <div
        ref={playersRef}
        className={styles.stablePlayers}
        data-testid="world-player-layer"
      />
      <div
        ref={effectsRef}
        className={styles.newcomerEffects}
        aria-hidden="true"
      />
      <svg
        className={styles.pairFallback}
        viewBox="0 0 1920 1080"
        aria-hidden="true"
        data-pair-fallback
      >
        {[0, 1, 2].map((slot) => (
          <g key={slot} data-pair-fallback-slot={slot}>
            <path data-pair-fallback-trail stroke="#96bdd5" />
            <path data-pair-fallback-trail stroke="#cc8b9a" />
            <path
              data-pair-fallback-heart
              d={HEART_SVG_PATH}
              fill="#B74658"
              stroke="#EFD2A0"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      <div className={styles.modeCopy} data-testid="world-mode-copy">
        <section className={styles.choice} data-world-copy="CHOICE">
          <h1>{data.question.title}</h1>
          <div className={styles.fields}>
            {data.question.options.map((option, index) => (
              <div
                key={option.id}
                className={styles.fieldLabel}
                data-field-id={option.id}
                style={
                  {
                    left: `${fieldX[index] ?? 50}%`,
                    "--field-color": ["#beddeb", "#edd0a5", "#e6b6bf"][index],
                    "--field-delay": `${300 + index * 200}ms`,
                  } as CSSProperties
                }
              >
                <div className={styles.fieldSigil} aria-hidden="true">
                  <ChoiceMark index={index} />
                </div>
                <h2>{option.label}</h2>
                <div className={styles.genderLabels}>
                  <span>男生</span>
                  <span>女生</span>
                </div>
                {data.totalParticipants > 0 ? (
                  <>
                    <span className={styles.percent} data-field-percent>
                      <AnimatedCounter
                        value={option.percent}
                        suffix="%"
                        duration={0.45}
                      />
                    </span>
                    <p data-field-count>
                      <AnimatedCounter value={option.count} duration={0.45} />{" "}
                      <small>人选择</small>
                    </p>
                  </>
                ) : (
                  <p className={styles.empty}>等待第一个选择</p>
                )}
              </div>
            ))}
          </div>
          <p className={styles.story} data-story-copy>
            每个人，都在选择自己舒服的靠近方式。
          </p>
        </section>
        <section
          className={styles.live}
          data-world-copy="LIVE"
          aria-hidden="true"
        >
          <div className={styles.liveHeadline}>
            <span>有</span>
            <div
              className={styles.liveNumber}
              style={
                {
                  "--number-size": `${Math.min(200, 570 / Math.max(2, String(data.currentParticipants).length)) / 19.2}cqw`,
                } as CSSProperties
              }
            >
              <AnimatedCounter
                value={data.currentParticipants}
                duration={0.5}
              />
            </div>
            <span>人</span>
          </div>
          <h1>正在等一次自然的靠近。</h1>
          <h2 className={styles.maleHeading}>男生</h2>
          <h2 className={styles.femaleHeading}>女生</h2>
          <p
            className={styles.availableCopy}
            data-available-copy
            aria-hidden={data.availableParticipants === 0}
          >
            {data.availableParticipants > 0 ? "有人，愿意先靠近一步。" : ""}
          </p>
        </section>
        <section
          className={styles.meet}
          data-world-copy="MEET"
          aria-hidden="true"
        >
          <h1>有些靠近，真的发生了。</h1>
          <p className={styles.meetSubtitle} data-meet-subtitle>
            在这座城市，每一次相遇，都值得被看见。
          </p>
          <p className={styles.pairEmpty} data-pair-empty>
            每一次靠近，都从一个勇敢的选择开始。
          </p>
          {[0, 1, 2].map((slot) => (
            <div
              key={slot}
              className={styles.pairCaption}
              data-pair-caption={slot}
              hidden
            />
          ))}
          <div
            className={styles.meetStatistic}
            hidden={data.meetScene?.statisticsKnown === false}
          >
            <div>
              <span className={styles.coreNumber}>
                <AnimatedCounter value={data.totalMeetings} duration={0.5} />
              </span>
              <span>次相遇</span>
            </div>
            <p>已确认见面</p>
          </div>
          {data.meetScene?.connection === "offline" && (
            <p className={styles.connectionStatus} role="status">
              数据连接中断
              {data.meetScene.statisticsKnown !== false
                ? " · 显示最近统计"
                : ""}
            </p>
          )}
        </section>
      </div>
      <div
        className={styles.intersectionCopy}
        data-intersection-copy
        aria-hidden="true"
        aria-live="polite"
      >
        <strong>又一次交汇</strong>
        <span>愿意认识彼此</span>
      </div>
      <WorldQR joinUrl={data.joinUrl} />
      {data.joinUrl && data.meetScene?.connection === "offline" &&
        <div className="live-screen-status" role="status">连接中断，正在重新同步 · 暂停展示具体相遇
          {data.meetScene?.snapshotAt && <> · 最近数据 {new Date(data.meetScene.snapshotAt).toLocaleTimeString("zh-CN", { hour12: false })}</>}
        </div>}
    </div>
  );
}
