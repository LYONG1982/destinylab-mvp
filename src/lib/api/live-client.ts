"use client";
import type { DemoState } from "@/domain/types";
import type { WorldData } from "@/features/screen/world/types";
import type { Audience, LiveCommand, LiveSnapshot } from "./live-types";
import { clientId } from "@/lib/client-id";

export const isLive = () =>
  typeof document !== "undefined" &&
  document.documentElement.dataset.dataMode === "server";
export function activity() {
  const requested = new URLSearchParams(location.search).get("activity");
  if (requested && /^[a-z0-9][a-z0-9-]{0,47}$/.test(requested)) {
    try {
      sessionStorage.setItem("destinylab:live-activity", requested);
    } catch {}
    return requested;
  }
  try {
    return (
      sessionStorage.getItem("destinylab:live-activity") ||
      document.documentElement.dataset.activity ||
      "meet"
    );
  } catch {
    return document.documentElement.dataset.activity || "meet";
  }
}
function audience(): Audience {
  return location.pathname.startsWith("/admin")
    ? "operator"
    : location.pathname.startsWith("/screen")
      ? "screen"
      : "participant";
}
let state: DemoState | null = null,
  world: WorldData | null = null;
let actor = "",
  problem = "",
  unauthorized = false;
let key = "",
  generation = 0,
  version = -1;
let source: EventSource | null = null,
  timer: ReturnType<typeof setInterval> | undefined;
let loading = false,
  again = false,
  lastSuccess = 0;
let bound = false;
const listeners = new Set<() => void>();
const pending = new Map<string, string>();
const notify = () => listeners.forEach((f) => f());
const endpoint = (path: string, role = audience(), act = activity()) =>
  `/api/live/${path}?activity=${encodeURIComponent(act)}&audience=${role}`;
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function fetchTimed(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok)
      throw new RequestError(
        response.status,
        body.error || "请求未完成，请重试。",
      );
    return body;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
async function request(
  path: string,
  options: RequestInit = {},
  role = audience(),
  act = activity(),
) {
  return fetchTimed(endpoint(path, role, act), {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}
function accept(next: LiveSnapshot, ticket: number) {
  if (
    ticket !== generation ||
    next.activity !== activity() ||
    next.revision < version
  )
    return;
  version = next.revision;
  state = next.state || null;
  world = next.world || null;
  actor = next.actor || "";
  problem = "";
  unauthorized = false;
  lastSuccess = Date.now();
  notify();
}
function report(error: unknown, ticket: number) {
  if (ticket !== generation) return;
  unauthorized = error instanceof RequestError && error.status === 401;
  problem = unauthorized
    ? lastSuccess
      ? "登录状态已失效，请重新登录。"
      : "请使用运营账号登录。"
    : error instanceof RequestError
      ? error.message
      : "连接暂时中断，正在重新同步；尚未提交的操作请重试。";
  if (!unauthorized && lastSuccess)
    problem += ` 上次同步 ${new Date(lastSuccess).toLocaleTimeString("zh-CN", { hour12: false })}。`;
  if (unauthorized) {
    state = null;
    actor = "";
    source?.close();
    source = null;
  }
  if (world)
    world = {
      ...world,
      events: [],
      meetScene: {
        ...world.meetScene,
        connection: "offline",
        permissionVerified: false,
        qualifiedPairs: [],
      },
    };
  notify();
}
async function refresh() {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  const ticket = generation;
  const role = audience(),
    act = activity();
  try {
    const suffix = version >= 0 ? `&after=${version}` : "";
    const data = await fetchTimed(
      `${endpoint("snapshot", role, act)}${suffix}`,
      {
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    accept(data, ticket);
  } catch (e) {
    report(e, ticket);
  } finally {
    loading = false;
    if (again) {
      again = false;
      void refresh();
    }
  }
}
function connect(ticket: number) {
  if (ticket !== generation || unauthorized || source) return;
  source = new EventSource(endpoint("events"));
  source.addEventListener("version", (event) => {
    if (ticket !== generation) return;
    try {
      const next = JSON.parse((event as MessageEvent).data);
      if (Number(next.revision) > version || problem) void refresh();
    } catch {
      void refresh();
    }
  });
  source.onopen = () => {
    if (ticket === generation) void refresh();
  };
  source.onerror = () => {
    if (ticket !== generation) return;
    // SSE is intentionally rotated by the server; verify with a snapshot before showing an outage.
    void refresh();
  };
}
async function start(ticket: number) {
  try {
    if (audience() === "participant") {
      const open = async () =>
        accept(
          await request("session", { method: "POST", body: "{}" }),
          ticket,
        );
      if (navigator.locks)
        await navigator.locks.request(`destinylab:join:${activity()}`, open);
      else await open();
    } else await refresh();
    connect(ticket);
  } catch (e) {
    report(e, ticket);
  }
}
export function initialize() {
  if (!isLive()) return;
  const nextKey = `${audience()}:${activity()}`;
  if (key === nextKey) return;
  key = nextKey;
  generation++;
  version = -1;
  source?.close();
  source = null;
  clearInterval(timer);
  state = null;
  world = null;
  actor = "";
  problem = "";
  unauthorized = false;
  lastSuccess = 0;
  pending.clear();
  notify();
  const ticket = generation;
  void start(ticket);
  timer = setInterval(() => {
    if (
      !unauthorized &&
      document.visibilityState === "visible" &&
      Date.now() - lastSuccess > 5000
    ) {
      if (!state && !world && audience() === "participant")
        void start(generation);
      else {
        void refresh();
        connect(generation);
      }
    }
  }, 5000);
  if (!bound) {
    bound = true;
    window.addEventListener("online", retry);
    window.addEventListener("offline", () =>
      report(new Error("offline"), generation),
    );
    window.addEventListener("focus", () => {
      if (isLive() && !unauthorized) void refresh();
    });
  }
}
export function retry() {
  if (isLive()) {
    unauthorized = false;
    void start(generation);
  }
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const getState = () => state;
export const getWorld = () => world;
export const getActor = () => actor;
export const getProblem = () => problem;
export const loginRequired = () => unauthorized;
export async function login(username: string, password: string) {
  await request("login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  unauthorized = false;
  await refresh();
  connect(generation);
}
export async function signOut() {
  await request("logout", { method: "POST", body: "{}" });
  generation++;
  source?.close();
  source = null;
  state = null;
  actor = "";
  unauthorized = true;
  problem = "已退出登录。";
  notify();
}
export async function command(command: LiveCommand, signal?: AbortSignal) {
  const ticket = generation,
    epoch = state?.epoch;
  if (!epoch) throw new Error("数据尚未就绪，请稍后重试。");
  const signature = JSON.stringify({ epoch, command });
  const id = pending.get(signature) || clientId();
  pending.set(signature, id);
  try {
    const commandPath = command.type.startsWith("tongzhou-") ? "tongzhou" : command.type === "avatar" ? "avatar" : null;
    const options: RequestInit = {
      method: "POST",
      body: signature,
      headers: { "Idempotency-Key": id },
      signal,
    };
    const next = commandPath ? await fetchTimed(`/api/${commandPath}/command?activity=${encodeURIComponent(activity())}`, { ...options, credentials: "same-origin", cache: "no-store", headers: {"Content-Type":"application/json", ...options.headers} }) : await request("command", options);
    pending.delete(signature);
    accept(next, ticket);
    return next.state as DemoState;
  } catch (e) {
    if (e instanceof RequestError && e.status < 500) pending.delete(signature);
    if (e instanceof RequestError && e.status === 401) report(e, ticket);
    throw e;
  }
}
