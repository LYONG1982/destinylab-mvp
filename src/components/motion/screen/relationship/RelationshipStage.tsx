"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatedCounter } from "../../AnimatedCounter";
import { reduceQuery } from "../../lifecycle";
import type { MotionController } from "../controller";
import type { ScreenSnapshot } from "../model";
import { fieldLayout, sampleNodes } from "./layout";
import type { DestinyWorld } from "./DestinyWorld";

/** Persistent canvas, outside SceneTransition's DOM clone. No frame-driven React updates. */
export function RelationshipStage({
  snapshot,
  controller,
  active,
}: {
  snapshot: ScreenSnapshot;
  controller: MotionController;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarsRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<DestinyWorld | null>(null);
  const syncRef = useRef<(() => void) | null>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState("loading");
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [displayed, setDisplayed] = useState(snapshot);
  const shown =
    displayed.question.id === snapshot.question.id ? snapshot : displayed;
  const latest = useRef({ snapshot: shown, active });
  const phaseRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    latest.current = { snapshot: shown, active };
  }, [shown, active]);
  useEffect(() => {
    if (snapshot.question.id === displayed.question.id) return;
    const phase = phaseRef.current!;
    const reduced = matchMedia(reduceQuery).matches;
    phase.dataset.phase = "out";
    controller.joins.clear();
    const timer = setTimeout(
      () => {
        setDisplayed(snapshot);
        phase.dataset.phase = "in";
      },
      reduced ? 0 : 400,
    );
    return () => clearTimeout(timer);
  }, [snapshot, displayed.question.id, controller]);
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const root = host.closest<HTMLElement>(".screen-canvas")!;
    const measure = () => {
      const slot = root.querySelector<HTMLElement>(
        "[data-scene-current] [data-field-slot]",
      );
      if (!slot) return;
      let x = 0,
        y = 0;
      for (
        let node: HTMLElement | null = slot;
        node && node !== root;
        node = node.offsetParent as HTMLElement | null
      ) {
        x += node.offsetLeft;
        y += node.offsetTop;
      }
      const b = { width: slot.clientWidth, height: slot.clientHeight };
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.width = `${b.width}px`;
      host.style.height = `${b.height}px`;
      const height = phaseRef.current?.clientHeight || b.height;
      setDimensions((old) =>
        old.width === b.width && old.height === height
          ? old
          : { width: b.width, height },
      );
      worldRef.current?.resize(b.width, height);
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(root.querySelector(".screen-content")!);
    window.addEventListener("resize", measure);
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) measure();
    });
    measure();
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      measureRef.current = null;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    const host = hostRef.current!;
    const preference = matchMedia(reduceQuery);
    const fail = () => {
      stop?.();
      stop = undefined;
      worldRef.current?.dispose();
      worldRef.current = null;
      if (alive) {
        host.dataset.running = "false";
        setStatus("fallback");
      }
    };
    const sync = () => {
      stop?.();
      stop = undefined;
      const world = worldRef.current;
      const visible = document.visibilityState === "visible";
      const running =
        latest.current.active &&
        visible &&
        !preference.matches &&
        controller.enabled &&
        !!world;
      host.dataset.running = String(running);
      controller.setFieldActive(latest.current.active);
      if (!running) controller.joins.clear();
      world?.resetTime();
      world?.update(
        latest.current.snapshot,
        preference.matches || !controller.enabled,
      );
      if (running) stop = controller.frames.add((time) => world?.draw(time));
    };
    syncRef.current = sync;
    void import("./DestinyWorld")
      .then(({ DestinyWorld }) => {
        if (!alive) return;
        try {
          worldRef.current = new DestinyWorld(
            canvasRef.current!,
            avatarsRef.current!,
            host,
            latest.current.snapshot,
            controller,
            fail,
          );
          setStatus("webgl");
          measureRef.current?.();
          sync();
        } catch {
          fail();
        }
      })
      .catch(fail);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      stop?.();
      syncRef.current = null;
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      worldRef.current?.dispose();
      worldRef.current = null;
    };
  }, [controller]);
  useEffect(() => {
    measureRef.current?.();
    syncRef.current?.();
  }, [shown, active, status]);
  const fields = fieldLayout(
    shown.question,
    dimensions.width,
    dimensions.height,
  );
  return (
    <div
      ref={hostRef}
      className={`relationship-stage ${active ? "is-active" : ""}`}
      data-testid="relationship-stage"
      data-renderer={status}
      data-option-count={fields.length}
      aria-hidden={!active}
    >
      <div className="relationship-phase" ref={phaseRef} data-phase="in">
        <canvas
          ref={canvasRef}
          className="relationship-webgl"
          data-layer="destiny-world"
          aria-hidden="true"
        />
        <div
          ref={avatarsRef}
          className="field-avatar-labels"
          aria-hidden="true"
        />
        {status !== "webgl" && (
          <div className="field-fallback" aria-label="关系场">
            {fields.map((field) => (
              <div
                key={field.key}
                className="field-fallback-ring"
                style={{
                  left: field.x,
                  top: field.y,
                  width: field.radius * 1.6,
                  height: field.radius * 1.6,
                }}
              />
            ))}
            {fields.flatMap((field) =>
              sampleNodes(shown.members, field.key, 6).map((node, index) => {
                const angle = (index * Math.PI) / 3 - Math.PI / 2;
                return (
                  <div
                    className="field-fallback-avatar"
                    key={node.key}
                    style={{
                      left: field.x + Math.cos(angle) * field.radius * 0.8,
                      top: field.y + Math.sin(angle) * field.radius * 0.8,
                    }}
                  >
                    <img
                      src={node.image}
                      alt="系统虚拟头像"
                      width="40"
                      height="40"
                    />
                    <span>{node.label}</span>
                  </div>
                );
              }),
            )}
          </div>
        )}
        <div className="relationship-field-labels">
          {fields.map((field) => (
            <div
              className="relationship-field-label"
              data-field-key={field.key}
              key={field.key}
              style={{ left: field.x, top: field.y } as CSSProperties}
            >
              <h2>{field.label}</h2>
              {shown.question.total === 0 ? (
                <p className="field-empty">等待第一个选择</p>
              ) : (
                <>
                  <strong
                    className={
                      shown.question.total < 10 ? "field-count-primary" : ""
                    }
                  >
                    <AnimatedCounter value={field.count} duration={0.5} />
                    <small> 人</small>
                  </strong>
                  <span
                    className={`field-percent ${shown.question.total < 10 ? "is-quiet" : ""}`}
                  >
                    <AnimatedCounter
                      value={field.percentage}
                      duration={0.5}
                      suffix="%"
                    />
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <div
        className="field-live-ticker"
        data-live-ticker
        role="status"
        aria-live="polite"
      />
    </div>
  );
}
