import type {
  RegistrationView,
  RegistrationRecord,
} from "@/domain/registration";
import { MINI_ENTRY_PAGES, type MiniEntry } from "@/domain/mini-entry";
import type { WallConsentView } from "@/domain/member-wall";
import Taro from "@tarojs/taro";
import type { DemoState } from "@/domain/types";
import { SnapshotGate, retryDelay } from "./session-core";
export const API_ORIGIN = process.env.TARO_APP_API_ORIGIN || "";
export interface Snapshot {
  activity: string;
  revision: number;
  actor: string;
  state: DemoState;
}
interface Features {
  avatars: boolean;
  tongzhou: boolean;
  memberWall?: boolean;
}
export interface ViewState {
  snapshot: Snapshot | null;
  busy: boolean;
  error: string;
  online: boolean;
  features: Features;
  pending: boolean;
  authenticated: boolean;
}
let view: ViewState = {
  snapshot: null,
  busy: false,
  error: "",
  online: false,
  features: { avatars: false, tongzhou: false },
  pending: false,
  authenticated: false,
};
const listeners = new Set<() => void>();
const gate = new SnapshotGate();
let token = "",
  activity = process.env.TARO_APP_ACTIVITY_ID || "meet",
  visible = false,
  failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false;
let pending: {
  command: Record<string, unknown>;
  id: string;
  epoch: string;
} | null = null;
const photos = new Map<string, string>();
const key = () => `destiny-mini:${API_ORIGIN}:${activity}`;
function update(patch: Partial<ViewState>) {
  view = { ...view, ...patch };
  listeners.forEach((fn) => fn());
}
function assertOrigin() {
  if (
    !API_ORIGIN ||
    (!/^https:\/\/[^/]+$/.test(API_ORIGIN) &&
      !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_ORIGIN))
  )
    throw new Error("服务地址尚未配置，请联系活动工作人员。");
}
function endpoint(path: string) {
  assertOrigin();
  return `${API_ORIGIN}/api/mini/${path}${path.includes("?") ? "&" : "?"}activity=${encodeURIComponent(activity)}`;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  data?: object | ArrayBuffer,
  extra = {},
) {
  const response = await Taro.request<T & { error?: string }>({
    url: endpoint(path),
    method,
    data,
    header: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    timeout: 15000,
  });
  if (response.statusCode !== 200)
    throw new ApiError(
      response.data?.error || "服务暂不可用，请重试。",
      response.statusCode,
    );
  return response.data as T;
}
function erasePhotos() {
  photos.forEach((path) =>
    Taro.getFileSystemManager().unlink({ filePath: path, fail: () => {} }),
  );
  photos.clear();
}
function apply(value: Snapshot, generation: number) {
  if (
    !value.state ||
    !value.actor ||
    !gate.accept(generation, value.state.epoch, value.revision)
  )
    return;
  const valid = new Set(
    value.state.participants.map((p) => p.photo?.id).filter(Boolean),
  );
  photos.forEach((path, id) => {
    if (!valid.has(id)) {
      Taro.getFileSystemManager().unlink({ filePath: path, fail: () => {} });
      photos.delete(id);
    }
  });
  update({ snapshot: value, online: true, error: "" });
}
function clearSession() {
  gate.reset();
  token = "";
  pending = null;
  Taro.removeStorageSync(key());
  erasePhotos();
  update({
    snapshot: null,
    authenticated: false,
    online: false,
    pending: false,
    busy: false,
  });
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "网络暂不可用，请稍后重试。";
}
async function refresh() {
  if (!visible || !token || reading || view.busy) return;
  reading = true;
  const generation = gate.generation;
  try {
    const result = await request<Snapshot & { features: Features }>("snapshot");
    if (generation !== gate.generation) return;
    if (gate.epoch && gate.epoch !== result.state.epoch) {
      clearSession();
      update({ error: "活动状态已变化，请重新登录。" });
      return;
    }
    apply(result, generation);
    if (result.features) update({ features: result.features });
    failures = 0;
  } catch (e) {
    if (generation !== gate.generation) return;
    failures++;
    if (e instanceof ApiError && e.status === 401) clearSession();
    if (e instanceof ApiError && e.status === 410) {
      gate.reset();
      pending = null;
      erasePhotos();
      update({ snapshot: null, pending: false, busy: false });
    }
    update({ error: errorText(e), online: false });
  } finally {
    reading = false;
  }
}
function schedule() {
  clearTimeout(timer);
  if (visible && token && view.snapshot)
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, retryDelay(failures));
}
export const client = {
  async registration() {
    try {
      return await request<RegistrationView>("registration/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearSession();
      throw error;
    }
  },
  async saveRegistration(
    path: "save" | "profile" | "delete-photo",
    input: object,
    id: string,
  ) {
    return request<RegistrationRecord>(`registration/${path}`, "POST", input, {
      "Idempotency-Key": id,
    });
  },
  async uploadRegistration(path: string, version: number, id: string) {
    const data = await new Promise<ArrayBuffer>((resolve, reject) =>
      Taro.getFileSystemManager().readFile({
        filePath: path,
        success: (r) => resolve(r.data as ArrayBuffer),
        fail: reject,
      }),
    );
    if (data.byteLength > 10 * 1024 * 1024)
      throw new Error("照片不能超过10MB。");
    return request<RegistrationRecord>(
      `registration/upload?version=${version}`,
      "POST",
      data,
      { "Content-Type": "application/octet-stream", "Idempotency-Key": id },
    );
  },
  async registrationPhoto(id: string) {
    const generation = gate.generation;
    const response = await Taro.downloadFile({
      url: endpoint(
        `registration/photo?photo=${encodeURIComponent(id)}&thumb=1`,
      ),
      header: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    if (response.statusCode !== 200 || generation !== gate.generation) {
      if (response.tempFilePath)
        Taro.getFileSystemManager().unlink({
          filePath: response.tempFilePath,
          fail: () => {},
        });
      throw new Error("照片暂不可查看，请重试。");
    }
    photos.set(`registration:${id}`, response.tempFilePath);
    return response.tempFilePath;
  },
  clearPhotos: erasePhotos,
  async startInteraction() {
    await request<Snapshot>("enter", "POST", {});
    await Taro.redirectTo({
      url: `/pages/index/index?activity=${encodeURIComponent(activity)}`,
    });
  },

  async wallMe() {
    const generation = gate.generation;
    const result = await request<WallConsentView>("wall/me");
    if (generation !== gate.generation || !token)
      throw new Error("活动身份已变化，请重新进入。");
    return result;
  },
  async wallConsent(input: {
    allow: boolean;
    nickname: string;
    expectedVersion: number;
    consentVersion: string;
  }) {
    const generation = gate.generation;
    const result = await request<WallConsentView>(
      "wall/consent",
      "POST",
      input,
    );
    if (generation !== gate.generation || !token)
      throw new Error("活动身份已变化，请重新进入。");
    return result;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  state: () => view,
  activity: () => activity,
  async enter(
    query: Record<string, string | undefined>,
    readSnapshot = true,
    defaultEntry: MiniEntry = "encounter",
  ) {
    clearTimeout(timer);
    gate.reset();
    erasePhotos();
    pending = null;
    token = "";
    update({
      snapshot: null,
      authenticated: false,
      pending: false,
      busy: false,
      error: "",
    });
    const generation = gate.generation;
    try {
      assertOrigin();
      let entry = defaultEntry;
      if (query.scene) {
        const scene = decodeURIComponent(query.scene);
        const result = await request<{ activity: string; entry: MiniEntry }>(
          `resolve?scene=${encodeURIComponent(scene)}`,
        );
        if (generation !== gate.generation) return;
        activity = result.activity;
        entry = result.entry;
      } else
        activity = query.activity || process.env.TARO_APP_ACTIVITY_ID || "meet";
      if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(activity))
        throw new Error("活动入口无效。");
      token = Taro.getStorageSync(key()) || "";
      visible = readSnapshot;
      update({ authenticated: !!token });
      if (entry !== defaultEntry) {
        await Taro.redirectTo({
          url: `/${MINI_ENTRY_PAGES[entry]}?activity=${encodeURIComponent(activity)}`,
        });
        return;
      }
      if (readSnapshot) {
        await refresh();
        schedule();
      }
      return entry;
    } catch (e) {
      if (generation === gate.generation) update({ error: errorText(e) });
    }
  },
  async login() {
    if (view.busy) return;
    update({ busy: true, error: "" });
    const generation = gate.generation;
    try {
      assertOrigin();
      const login = await Taro.login();
      if (generation !== gate.generation) return;
      const result = await request<{
        token: string;
      }>("login", "POST", { code: login.code });
      if (generation !== gate.generation) return;
      token = result.token;
      Taro.setStorageSync(key(), token);
      update({ authenticated: true });
    } catch (e) {
      if (generation === gate.generation) update({ error: errorText(e) });
    } finally {
      if (generation === gate.generation) update({ busy: false });
    }
  },
  async send(command: Record<string, unknown>, retry = false) {
    if (view.busy || !view.snapshot) throw new Error("请等待当前操作完成。");
    if (pending && !retry)
      throw new Error("上次提交结果尚未确认，请先重试该提交。");
    if (!pending)
      pending = {
        command,
        id: `mini-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
        epoch: view.snapshot.state.epoch,
      };
    update({ busy: true, error: "", pending: true });
    const generation = gate.generation;
    const task = pending;
    const type = String(task.command.type);
    const path = type.startsWith("tongzhou-")
      ? "tongzhou/command"
      : type === "avatar"
        ? "avatar/command"
        : "command";
    try {
      const result = await request<Snapshot>(
        path,
        "POST",
        { epoch: task.epoch, command: task.command },
        { "Idempotency-Key": task.id },
      );
      if (generation !== gate.generation) throw new Error("会话已变化。");
      pending = null;
      apply(result, generation);
      update({ pending: false });
      return result;
    } catch (e) {
      if (generation === gate.generation) {
        if (e instanceof ApiError && e.status < 500) {
          pending = null;
          update({ pending: false });
        }
        if (e instanceof ApiError && e.status === 401) clearSession();
        update({ error: errorText(e) });
      }
      throw e;
    } finally {
      if (generation === gate.generation) {
        update({ busy: false });
        schedule();
      }
    }
  },
  async retry() {
    if (pending) return client.send(pending.command, true);
    await refresh();
  },
  show() {
    visible = true;
    void refresh().then(schedule);
  },
  hide() {
    visible = false;
    clearTimeout(timer);
    erasePhotos();
  },
  async logout() {
    if (view.busy) return;
    update({ busy: true });
    try {
      await request("logout", "POST", {});
      clearSession();
    } catch (e) {
      update({ error: errorText(e) });
    } finally {
      update({ busy: false });
    }
  },
  async upload(path: string) {
    const data = await new Promise<ArrayBuffer>((resolve, reject) =>
      Taro.getFileSystemManager().readFile({
        filePath: path,
        success: (result) => resolve(result.data as ArrayBuffer),
        fail: reject,
      }),
    );
    if (data.byteLength > 10 * 1024 * 1024)
      throw new Error("照片不能超过 10MB。");
    const info = await Taro.getImageInfo({ src: path });
    const type = info.type === "jpg" ? "jpeg" : info.type;
    if (!["jpeg", "png", "webp"].includes(type))
      throw new Error("请选择 JPG、PNG 或 WebP 照片。");
    return request<{ id: string }>("avatar/upload", "POST", data, {
      "Content-Type": `image/${type}`,
    });
  },
  async reviewAvatar(assetId: string) {
    return request<{
      status: "pending" | "pass" | "review" | "risky" | "error";
    }>("avatar/review", "POST", { assetId });
  },
  async photo(id: string) {
    if (photos.has(id)) return photos.get(id)!;
    const generation = gate.generation;
    const response = await Taro.downloadFile({
      url: endpoint(`avatar/${id}`),
      header: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    const valid = view.snapshot?.state.participants.some(
      (p) => p.photo?.id === id,
    );
    if (
      response.statusCode !== 200 ||
      generation !== gate.generation ||
      !visible ||
      !valid
    ) {
      if (response.tempFilePath)
        Taro.getFileSystemManager().unlink({
          filePath: response.tempFilePath,
          fail: () => {},
        });
      throw new Error("照片不可查看。");
    }
    photos.set(id, response.tempFilePath);
    return response.tempFilePath;
  },
};
