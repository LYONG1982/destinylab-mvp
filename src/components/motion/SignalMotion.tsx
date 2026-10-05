"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import * as store from "@/lib/demo/store";
import { ease, motionDuration, motionTiming, ms } from "@/lib/motion-tokens";
import {
  hasPlayed,
  markPlayed,
  reduceQuery,
  useVisualEffect,
} from "./lifecycle";

function animateSignal(el: HTMLElement) {
  const path = el.querySelector<SVGPathElement>("path")!;
  const dot = el.querySelector<SVGCircleElement>("circle")!;
  const length = path.getTotalLength();
  let frame = 0;
  const start = performance.now();
  const draw = (progress: number) => {
    const point = path.getPointAtLength(length * progress);
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
  };
  draw(0);
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / ms(motionTiming.signal));
    draw(progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    draw(1);
  };
}
function SignalPath({ arrival = false }: { arrival?: boolean }) {
  return (
    <svg
      className="signal-path"
      viewBox="0 0 280 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={
          arrival
            ? "M8 25 C52 25 84 12 140 17"
            : "M8 25 C90 25 90 10 145 17 S215 25 272 12"
        }
      />
      <circle cx={arrival ? 140 : 272} cy={arrival ? 17 : 12} r="3" />
    </svg>
  );
}
export function SignalMotion({ target }: { target: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useVisualEffect(ref, animateSignal);
  return (
    <div
      ref={ref}
      className="signal-motion"
      data-testid="sent-signal"
      aria-hidden="true"
    >
      <div className="signal-labels">
        <span>我</span>
        <span>{target}</span>
      </div>
      <SignalPath />
      <p>邀请已经发出。</p>
    </div>
  );
}
type Cue = {
  epoch: string;
  actor: string;
  invitationId: string;
  target: string;
};
const SignalContext = createContext<(cue: Cue) => void>(() => {});
export const useSendSignal = () => useContext(SignalContext);
export function MobileMotionBoundary({ children }: { children: ReactNode }) {
  const [cue, setCue] = useState<Cue | null>(null);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const actor = useSyncExternalStore(
    store.subscribe,
    store.actorFromSession,
    () => "p-shanfeng",
  );
  const path = usePathname();
  const show = useCallback((next: Cue) => setCue(next), []);
  useEffect(() => {
    if (!cue) return;
    const timer = setTimeout(() => setCue(null), ms(motionTiming.toast));
    const hide = () => {
      if (document.visibilityState !== "visible") setCue(null);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [cue]);
  const valid =
    cue &&
    state?.epoch === cue.epoch &&
    actor === cue.actor &&
    state.invitations.some(
      (i) => i.id === cue.invitationId && i.status === "SENT",
    ) &&
    ["/mobile/06-common", "/mobile/07-invitation"].includes(path);
  // Drop invalid presentation cues immediately; returning to the route cannot replay them.
  if (cue && !valid) setCue(null);
  return (
    <SignalContext.Provider value={show}>
      {children}
      {valid && <SignalMotion key={cue.invitationId} target={cue.target} />}
    </SignalContext.Provider>
  );
}
export function SignalArrival({
  identity,
  children,
}: {
  identity: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `arrival:${identity}`;
  useEffect(() => {
    if (matchMedia(reduceQuery).matches) markPlayed(key);
  }, [key]);
  const animate = useCallback(
    (el: HTMLDivElement) => {
      if (hasPlayed(key)) return () => {};
      markPlayed(key);
      const stop = animateSignal(el);
      const card = el.querySelector(".arrival-card")!;
      const animation = card.animate(
        [
          { opacity: 0.5, transform: "translateY(-8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: ms(motionDuration.normal),
          delay: ms(motionTiming.signal),
          easing: ease(),
          fill: "backwards",
        },
      );
      if (navigator.userActivation?.hasBeenActive) {
        try {
          navigator.vibrate?.(ms(motionTiming.haptic));
        } catch {
          /* Auxiliary only. */
        }
      }
      return () => {
        stop();
        animation.cancel();
      };
    },
    [key],
  );
  useVisualEffect(ref, animate);
  return (
    <div ref={ref} className="signal-arrival">
      <SignalPath arrival />
      <div className="arrival-card">{children}</div>
    </div>
  );
}
