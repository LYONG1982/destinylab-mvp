"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_WALL_CONFIG, WALL_COLUMNS, WALL_CAPACITY, rotateWallSlots, wallDemographics, type WallSlots, type PublicMemberCard, type WallConfig } from "@/domain/member-wall";
import { MemberWallView } from "./MemberWallView";
import { demoMembers } from "./demo";
import { WallClock } from "./scheduler";
import { usePublicMembers } from "./usePublicMembers";

export function MemberWallPage({ preview = false }: { preview?: boolean }) {
  const params = useSearchParams(), activity = params.get("activity") || "meet";
  const scenario = preview ? params.get("state") || "front" : "motion";
  const count = preview && scenario === "low" ? 8 : preview && ["empty", "offline"].includes(scenario) ? 0 :
    preview && [10, 28, 50, 200].includes(Number(params.get("count"))) ? Number(params.get("count")) : scenario === "motion" ? 50 : 28;
  const [columns, setColumns] = useState<number>(WALL_COLUMNS), [reduced, setReduced] = useState(false), [readable, setReadable] = useState(false);
  const layout = useCallback((value: number, safe: boolean) => { setColumns(value); setReadable(safe); }, []);
  const live = usePublicMembers(activity, preview, columns, readable), demo = preview || live.snapshot?.config.mode === "demo";
  const configKey = JSON.stringify(live.snapshot?.config || DEFAULT_WALL_CONFIG);
  const config = useMemo<WallConfig>(() => ({ ...JSON.parse(configKey), ...(demo ? { mode: "demo" } : {}) }), [configKey, demo]);
  const cycleStartedAt = live.snapshot?.cycleStartedAt || 0;
  const snapshotRef = useRef(live.snapshot);
  useEffect(() => { snapshotRef.current = live.snapshot; }, [live.snapshot]);
  const roster = useMemo(() => demoMembers(count), [count]);
  const demographics = demo ? wallDemographics(roster) : { total: live.snapshot?.total || 0, male: live.snapshot?.male || 0, female: live.snapshot?.female || 0 };
  const [demoIds, setDemoIds] = useState<WallSlots>([]), [frame, setFrame] = useState({ side: "front" as "front" | "back", flipping: false, step: 0 });
  const [swap, setSwap] = useState<"idle" | "out" | "in">("idle"), [painted, setPainted] = useState<PublicMemberCard[]>([]);
  const clock = useRef(new WallClock()), visible = useRef<WallSlots>([]), exposed = useRef(new Map<string, number>());
  const operations = useRef({ busy: false, disposed: false }), incoming = useRef<PublicMemberCard[]>([]);
  const rotateRequest = live.rotate;
  const sourceCards = useMemo(() => demo ? demoIds.flatMap((id, slot) => { const card = roster.find((c) => c.id === id); return card ? [{ ...card, slot }] : []; }) :
    live.status === "ready" ? live.snapshot?.cards || [] : [], [demo, demoIds, roster, live.status, live.snapshot]);
  useEffect(() => { incoming.current = sourceCards; }, [sourceCards]);
  // Revocation wins even while a flip is in progress; new/edited cards wait for a stable front.
  const allowed = new Map(sourceCards.map((c) => [c.id, c]));
  const display = painted.filter((c) => allowed.get(c.id)?.gender === c.gender && allowed.get(c.id)?.slot === c.slot);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches); update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!demo) return;
    exposed.current.clear();
    const ids = rotateWallSlots(roster.map((c, i) => ({ id: c.id, gender: c.gender, seconds: 0, last: 0, joined: i })), [], config.ratio, false);
    visible.current = ids;
    const frame = requestAnimationFrame(() => { setDemoIds(ids); setPainted(ids.flatMap((id, slot) => { const card = roster.find((c) => c.id === id); return card ? [{ ...card, slot }] : []; })); });
    return () => cancelAnimationFrame(frame);
  }, [roster, demo, columns, config.ratio]);
  useEffect(() => {
    const staticSide = preview && scenario !== "motion" ? scenario === "back" ? "back" : "front" : null;
    if (staticSide) return;
    let stopped = false, last = performance.now(), lastAttempt = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const delay = (ms: number) => new Promise<void>((resolve) => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms); timers.add(timer); });
    const age = !demo && cycleStartedAt ? Math.max(0, (snapshotRef.current?.serverTime || 0) - cycleStartedAt) : 0;
    clock.current.reset(last - age); operations.current = { busy: false, disposed: false };
    const run = async () => {
      const now = performance.now();
      if (document.hidden) { last = now; return; }
      if (demo) for (const id of visible.current.filter((id): id is string => id !== null)) exposed.current.set(id, (exposed.current.get(id) || 0) + Math.min(250, now - last) / 1000);
      last = now;
      const next = clock.current.frame(now, config, columns, reduced);
      setFrame((old) => old.side === next.side && old.flipping === next.flipping && old.step === next.step ? old : next);
      if (next.side === "front" && !next.flipping && !operations.current.busy) setPainted((old) => old === incoming.current ? old : incoming.current);
      if (!next.rotate || operations.current.busy || (!demo && !live.primary) || now - lastAttempt < 5000) return;
      if ((demo ? roster.length : snapshotRef.current?.eligible || 0) === incoming.current.length && incoming.current.length <= WALL_CAPACITY) { clock.current.didRotate(now, config); return; }
      lastAttempt = now; operations.current.busy = true; setSwap("out");
      await delay(reduced ? 0 : 220);
      if (stopped || document.hidden) return;
      let cards: PublicMemberCard[] | null = null;
      if (demo) {
        const candidates = roster.map((c, i) => ({ id: c.id, gender: c.gender, seconds: exposed.current.get(c.id) || 0, last: visible.current.includes(c.id) ? now : 0, joined: i }));
        const ids = rotateWallSlots(candidates, visible.current, config.ratio, true);
        visible.current = ids; setDemoIds(ids); cards = ids.flatMap((id, slot) => { const card = roster.find((c) => c.id === id); return card ? [{ ...card, slot }] : []; });
      } else { const result = await rotateRequest(); cards = result?.cards || null; }
      if (stopped || document.hidden) return;
      if (cards) { setPainted(cards); clock.current.didRotate(now, config); }
      setSwap("in"); await delay(reduced ? 0 : 320);
      if (stopped) return; setSwap("idle"); operations.current.busy = false;
    };
    const timer = setInterval(() => void run(), 80);
    const visibility = () => { clock.current.reset(performance.now()); last = performance.now(); operations.current.busy = false; setSwap("idle"); setFrame({ side: "front", flipping: false, step: 0 }); };
    document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; operations.current.disposed = true; clearInterval(timer); timers.forEach(clearTimeout); document.removeEventListener("visibilitychange", visibility); };
  }, [preview, scenario, demo, roster, columns, reduced, config, live.primary, cycleStartedAt, rotateRequest]);
  return <MemberWallView cards={display} config={config} side={preview && scenario !== "motion" ? scenario === "back" ? "back" : "front" : frame.side} flipping={frame.flipping} swap={swap}
    demo={demo} {...demographics}
    status={preview ? scenario === "offline" ? "expired" : "ready" : live.status} joinUrl={demo ? undefined : live.snapshot?.joinUrl}
    activity={activity} reduced={reduced} onLayout={layout}
    controls={preview ? <><a href="?state=front">正面</a><a href="?state=back">背面</a><a href="?state=low">8 人</a><a href="?state=motion">动效</a></> : <>
      {!demo && <button type="button" disabled={live.primary || !readable} onClick={() => void live.claim()}>{live.primary ? "本窗口为主屏" : "启动主屏"}</button>}
      <a href={`/admin/member-wall?activity=${encodeURIComponent(activity)}`}>运营设置</a>{live.message && <span role="alert">{live.message}</span>}</>} />;
}
