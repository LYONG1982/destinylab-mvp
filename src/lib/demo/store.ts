"use client";
import { withCompatibleAvatar } from "@/config/avatars";
import { createSeed } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import type { Command, DemoState } from "@/domain/types";
const KEY = "destinylab:v1.1:state";
const ACTOR = "destinylab:v1.1:actor";
const LOCK = "destinylab:v1.1:write";
let snapshot: DemoState | null = null;
let channel: BroadcastChannel | null = null;
let problem = "";
let started = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
function check(raw: string): DemoState {
  try {
    const s = JSON.parse(raw) as DemoState;
    const arrays = [
      "participants",
      "invitations",
      "points",
      "helps",
      "merchants",
      "events",
      "scans",
      "merchantViews",
      "commands",
      "broadcastConsumed",
    ] as const;
    if (
      !s ||
      s.schema !== 1 ||
      typeof s.epoch !== "string" ||
      !s.epoch ||
      !Number.isFinite(s.revision) ||
      !Number.isFinite(s.now) ||
      !Number.isFinite(s.wallAt) ||
      typeof s.scenario !== "string" ||
      typeof s.activityPaused !== "boolean" ||
      arrays.some((key) => !Array.isArray(s[key])) ||
      !s.responses ||
      typeof s.responses !== "object" ||
      !s.participants.every(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          p.answers &&
          typeof p.answers === "object",
      ) ||
      !["p-shanfeng", "p-xiaoman"].every((id) =>
        s.participants.some((p) => p.id === id),
      ) ||
      !s.invitations.every(
        (i) =>
          i &&
          typeof i.id === "string" &&
          Array.isArray(i.common) &&
          i.departures &&
          i.arrivals &&
          i.confirmations &&
          i.choices,
      ) ||
      !s.points.every((p) => p && typeof p.id === "string") ||
      !s.merchants.every((m) => m && typeof m.id === "string") ||
      !s.helps.every((h) => h && typeof h.id === "string") ||
      !s.events.every((e) => e && typeof e.id === "string")
    )
      throw new Error();
    return { ...s, participants: s.participants.map(withCompatibleAvatar) };
  } catch {
    throw new Error("保存的演示状态无法读取，请在演示入口重置。");
  }
}
function read(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? check(raw) : snapshot || createSeed();
  } catch (e) {
    problem = e instanceof Error ? e.message : "浏览器无法读取保存的演示状态。";
    throw new Error(problem);
  }
}
function persist(s: DemoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    problem =
      "浏览器无法保存演示状态，本次操作未提交。请允许此站点存储后重试。";
    notify();
    throw new Error(problem);
  }
  snapshot = s;
  problem = "";
  notify();
  channel?.postMessage({ revision: s.revision, epoch: s.epoch });
}
function reload() {
  try {
    const s = read();
    if (s.epoch !== snapshot?.epoch || s.revision !== snapshot?.revision) {
      snapshot = s;
      notify();
    }
  } catch {
    notify();
  }
}
export function initialize() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    snapshot = read();
    if (!localStorage.getItem(KEY)) persist(snapshot);
  } catch {
    snapshot = createSeed();
  }
  try {
    channel = new BroadcastChannel(LOCK);
    channel.onmessage = reload;
  } catch {}
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) reload();
  });
  window.addEventListener("focus", reload);
  notify();
}
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => null;
export const storageProblem = () => problem;
export function actorFromSession() {
  try {
    return sessionStorage.getItem(ACTOR) || "p-shanfeng";
  } catch {
    return "p-shanfeng";
  }
}
export function setActor(actor: string) {
  try {
    sessionStorage.setItem(ACTOR, actor);
  } catch {}
  notify();
}
let serial: Promise<unknown> = Promise.resolve();
async function locked<T>(fn: () => T | Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(LOCK, fn);
  const next = serial.then(fn, fn);
  serial = next.catch(() => {});
  return next;
}
export async function resetScenario(name: string) {
  await locked(() => persist(createSeed(name)));
}
export async function command(
  actor: string,
  c: Command,
  id = crypto.randomUUID(),
) {
  const epoch = snapshot?.epoch;
  if (!epoch) throw new Error("演示正在加载，请稍候。");
  const delay = Number(sessionStorage.getItem("destinylab:delay") || "250");
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(200, Math.min(delay, 3000))),
  );
  if (sessionStorage.getItem("destinylab:fail-next") === "yes") {
    sessionStorage.removeItem("destinylab:fail-next");
    throw new Error("模拟连接中断，本次操作未提交，请重试。");
  }
  return locked(() => {
    const next = applyCommand(read(), { actor, id, epoch, command: c });
    persist(next);
    return next;
  });
}
export const mockApi = { command, resetScenario };
