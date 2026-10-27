"use client";
import type { DemoState } from "@/domain/types";
import type { WorldData } from "@/features/screen/world/types";
import type {
  Audience,
  LiveCommand,
  LiveSnapshot,
  RemovedEntry,
} from "./live-types";
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
  timer: ReturnType<typeof setInterval> | undefined,
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let loading: Promise<void> | null = null,
  requestedRevision = -1,
  reconnectAttempt = 0,
  lastSuccess = 0;
let bound = false;
const listeners = new Set<() => void>();
const pending = new Map<string, string>();
const memoryEntryKeys = new Map<string, string>();
let removedEntry: RemovedEntry | null = null;
let rejoining = false;
let startFlight: { ticket: number; promise: Promise<void> } | null = null;
const protocolHeader = { "X-Destiny-Protocol": "520-v1" };
const notify = () => listeners.forEach((f) => f());
const endpoint = (path: string, role = audience(), act = activity()) =>
  `/api/live/${path}?activity=${encodeURIComponent(act)}&audience=${role}`;
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public removedEntry?: RemovedEntry,
  ) {
    super(message);
  }
}
async function fetchTimed(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const abort = () => {
    externallyAborted = true;
    controller.abort();
  };
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);
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
        body.removedEntry,
      );
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        timedOut
          ? "请求超时，请稍后重试并等待状态同步。"
          : externallyAborted
            ? "操作已取消。"
            : "请求已取消。",
      );
    }
    throw error;
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
    headers: {
      "Content-Type": "application/json",
      ...protocolHeader,
      ...options.headers,
    },
  });
}
function accept(next: LiveSnapshot, ticket: number) {
  if (
    ticket !== generation ||
    next.activity !== activity() ||
    next.revision < version
  )
    return;
  const previousEpoch = state?.epoch;
  version = next.revision;
  state = next.state || null;
  world = next.world || null;
  actor = next.actor || "";
  removedEntry = null;
  problem = "";
  unauthorized = false;
  lastSuccess = Date.now();
  if (
    audience() === "participant" &&
    previousEpoch &&
    state?.epoch !== previousEpoch
  )
    rotateEntryKey(activity());
  notify();
}
function report(error: unknown, ticket: number) {
  if (ticket !== generation) return;
  const ended = error instanceof RequestError && error.status === 410;
  unauthorized = error instanceof RequestError && error.status === 401;
  if (ended) {
    if (audience() === "participant") rotateEntryKey(activity());
    removedEntry = error.removedEntry || null;
    state = null;
    actor = "";
    source?.close();
    source = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  problem = unauthorized
    ? lastSuccess
      ? "登录状态已失效，请重新登录。"
      : "请使用运营账号登录。"
    : error instanceof RequestError ||
        (error instanceof Error && /超时|取消/.test(error.message))
      ? error.message
      : "连接暂时中断，正在重新同步；尚未提交的操作请重试。";
  if (!unauthorized && lastSuccess)
    problem += ` 上次同步 ${new Date(lastSuccess).toLocaleTimeString("zh-CN", { hour12: false })}。`;
  if (unauthorized) {
    removedEntry = null;
    state = null;
    actor = "";
    source?.close();
    source = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
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
function refresh(requiredRevision = -1): Promise<void> {
  if (rejoining) return Promise.resolve();
  requestedRevision = Math.max(requestedRevision, requiredRevision);
  if (loading) return loading;
  const ticket = generation;
  const role = audience(),
    act = activity();
  const run = async () => {
    try {
      do {
        requestedRevision = -1;
        const suffix = version >= 0 ? `&after=${version}` : "";
        const data = await fetchTimed(
          `${endpoint("snapshot", role, act)}${suffix}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            headers: protocolHeader,
          },
        );
        accept(data, ticket);
      } while (
        ticket === generation &&
        requestedRevision > version &&
        !rejoining
      );
    } catch (e) {
      report(e, ticket);
    }
  };
  const promise = run().finally(() => {
    if (loading === promise) loading = null;
  });
  loading = promise;
  return promise;
}
function connect(ticket: number) {
  if (ticket !== generation || unauthorized || source || reconnectTimer) return;
  source = new EventSource(endpoint("events"));
  source.addEventListener("version", (event) => {
    if (ticket !== generation) return;
    try {
      const next = JSON.parse((event as MessageEvent).data);
      if (Number(next.revision) > version || problem)
        void refresh(Number(next.revision));
      reconnectAttempt = 0;
    } catch {
      void refresh();
    }
  });
  source.onerror = () => {
    if (ticket !== generation) return;
    void refresh();
    source?.close();
    source = null;
    const base = Math.min(1000 * 2 ** reconnectAttempt, 15000);
    reconnectAttempt++;
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined;
        connect(ticket);
      },
      Math.round(base * (0.5 + Math.random())),
    );
  };
}
function newEntryKey() {
  const webCrypto: Crypto | undefined = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  if (!webCrypto) throw new Error("浏览器不支持安全随机数，无法建立活动身份。");
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function rotateEntryKey(act: string) {
  memoryEntryKeys.delete(act);
  try {
    sessionStorage.removeItem(`destinylab:entry-key:${act}`);
  } catch {}
}
function entryKey(act: string, rotate = false) {
  const storageKey = `destinylab:entry-key:${act}`;
  if (rotate) rotateEntryKey(act);
  const remembered = memoryEntryKeys.get(act);
  if (remembered && !rotate) return remembered;
  try {
    const current = sessionStorage.getItem(storageKey);
    if (current && /^[0-9a-f-]{36}$/i.test(current)) {
      memoryEntryKeys.set(act, current);
      return current;
    }
    const next = newEntryKey();
    memoryEntryKeys.set(act, next);
    sessionStorage.setItem(storageKey, next);
    return next;
  } catch {
    const next = newEntryKey();
    memoryEntryKeys.set(act, next);
    return next;
  }
}
function start(ticket: number, explicit = false): Promise<void> {
  if (rejoining) return Promise.resolve();
  if (!explicit && startFlight?.ticket === ticket) return startFlight.promise;
  const promise = (async () => {
    try {
      if (audience() === "participant") {
        const act = activity();
        const id = entryKey(act, explicit);
        const open = async () =>
          accept(
            await request("session", {
              method: "POST",
              body: JSON.stringify(explicit ? { enter: true } : {}),
              headers: { "X-Destiny-Entry-Key": id },
            }),
            ticket,
          );
        if (navigator.locks)
          await navigator.locks.request(`destinylab:join:${act}`, open);
        else await open();
      } else await refresh();
      connect(ticket);
    } catch (e) {
      report(e, ticket);
    }
  })();
  if (!explicit) {
    const flight = { ticket, promise };
    startFlight = flight;
    void promise.finally(() => {
      if (startFlight === flight) startFlight = null;
    });
  }
  return promise;
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
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearInterval(timer);
  state = null;
  world = null;
  actor = "";
  problem = "";
  unauthorized = false;
  lastSuccess = 0;
  loading = null;
  requestedRevision = -1;
  startFlight = null;
  reconnectAttempt = 0;
  pending.clear();
  removedEntry = null;
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
export function reenter() {
  void start(generation, true);
}
export const getRemovedEntry = () => removedEntry;
export async function rejoin() {
  if (rejoining || !removedEntry || audience() !== "participant") return;
  rejoining = true;
  const input = removedEntry;
  // Invalidate reads begun against the archived identity before accepting a new one.
  const ticket = ++generation;
  source?.close();
  source = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  pending.clear();
  try {
    const next = await request("rejoin", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (ticket !== generation) return;
    accept(next, ticket);
    connect(ticket);
  } catch (e) {
    report(e, ticket);
    throw e;
  } finally {
    rejoining = false;
  }
}
export async function resumePresence() {
  const ticket = generation,
    epoch = state?.epoch,
    owner = actor;
  if (!epoch || !owner || audience() !== "participant")
    throw new Error("身份尚未就绪，请刷新后重试。");
  const signature = JSON.stringify({ type: "field-reenter", epoch, owner });
  const id = pending.get(signature) || clientId();
  pending.set(signature, id);
  try {
    const next = await request("reenter", {
      method: "POST",
      body: JSON.stringify({ epoch }),
      headers: { "Idempotency-Key": id, "X-Destiny-Actor": actor },
    });
    if (ticket !== generation || actor !== owner || state?.epoch !== epoch)
      throw new Error("活动身份已变化，请重新进入。");
    accept(next, ticket);
    pending.delete(signature);
    if (
      !state?.participants.find((p) => p.id === owner)?.present ||
      state.fieldOpen === false
    )
      throw new Error("现场状态已变化，请确认当前状态后再试。");
    return { state, actor: owner };
  } catch (e) {
    if (e instanceof RequestError && e.status < 500) {
      pending.delete(signature);
      if (e.status === 401 || e.status === 410) report(e, ticket);
      else await refresh();
    }
    throw e;
  }
}
export const getLastSuccess = () => lastSuccess;
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
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
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
    const commandPath = command.type.startsWith("tongzhou-")
      ? "tongzhou"
      : command.type === "avatar"
        ? "avatar"
        : null;
    const options: RequestInit = {
      method: "POST",
      body: signature,
      headers: { "Idempotency-Key": id, "X-Destiny-Actor": actor },
      signal,
    };
    const next = commandPath
      ? await fetchTimed(
          `/api/${commandPath}/command?activity=${encodeURIComponent(activity())}`,
          {
            ...options,
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              ...protocolHeader,
              ...options.headers,
            },
          },
        )
      : await request("command", options);
    pending.delete(signature);
    accept(next, ticket);
    return next.state as DemoState;
  } catch (e) {
    if (e instanceof RequestError && e.status < 500) pending.delete(signature);
    if (e instanceof RequestError && e.status === 401) report(e, ticket);
    throw e;
  }
}
