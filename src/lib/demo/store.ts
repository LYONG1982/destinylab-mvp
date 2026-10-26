"use client";
import { withCompatibleAvatar } from "@/config/avatars";
import { createSeed } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import { isTongzhouCommand, readTongzhouSubmissions } from "@/domain/tongzhou";
import type { Command, DemoState } from "@/domain/types";
import * as live from "@/lib/api/live-client";
import { clientId } from "@/lib/client-id";
const KEY = "destinylab:v1.1:state";
const ACTOR = "destinylab:v1.1:actor";
const LOCK = "destinylab:v1.1:write";
let snapshot: DemoState | null = null;
let channel: BroadcastChannel | null = null;
let problem = "";
let unreadable = false;
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
    return {
      ...s,
      participants: s.participants.map(withCompatibleAvatar),
      tongzhouSubmissions: readTongzhouSubmissions(s.tongzhouSubmissions),
    };
  } catch {
    throw new Error("保存的演示状态无法读取，请在演示入口重置。");
  }
}
function read(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    const state = raw ? check(raw) : snapshot || createSeed();
    unreadable = false;
    return state;
  } catch (e) {
    unreadable = true;
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
  unreadable = false;
  notify();
  channel?.postMessage({ revision: s.revision, epoch: s.epoch });
}
function reload() {
  try {
    const wasUnreadable = unreadable;
    const s = read();
    if (wasUnreadable) problem = "";
    if (s.epoch !== snapshot?.epoch || s.revision !== snapshot?.revision) {
      snapshot = s;
      notify();
    } else if (wasUnreadable) {
      notify();
    }
  } catch {
    notify();
  }
}
export function initialize() {
  if (live.isLive()) return live.initialize();
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
  if (live.isLive()) return live.subscribe(listener);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getSnapshot = () => live.isLive() ? live.getState() : snapshot;
export const getServerSnapshot = () => null;
export const storageProblem = () => live.isLive() ? live.getProblem() : problem;
export const storageUnreadable = () => live.isLive() ? false : unreadable;
export function actorFromSession() {
  if (live.isLive()) return live.getActor();
  try {
    return sessionStorage.getItem(ACTOR) || "p-shanfeng";
  } catch {
    return "p-shanfeng";
  }
}
export function setActor(actor: string) {
  if (live.isLive()) return;
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
  if (live.isLive()) throw new Error("共享服务不提供演示重置。");
  await locked(() => persist(createSeed(name)));
}
export async function command(
  actor: string,
  c: Command,
  id = clientId(),
  signal?: AbortSignal,
) {
  if (live.isLive()) return live.command(c, signal);
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
    if (isTongzhouCommand(c) && signal?.aborted)
      throw new Error("本次填报操作已取消。");
    const next = applyCommand(read(), { actor, id, epoch, command: c });
    persist(next);
    return next;
  });
}
export const mockApi = { command, resetScenario };
