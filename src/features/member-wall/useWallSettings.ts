"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_WALL_CONFIG,
  wallConfigErrors,
  type WallConfig,
  type WallAdminView,
} from "@/domain/member-wall";

export type WallDraft = Omit<WallConfig, "flipSeconds" | "rotationSeconds"> & {
  flipSeconds: string;
  rotationSeconds: string;
};
export const toDraft = (c: WallConfig): WallDraft => ({
  ...c,
  flipSeconds: String(c.flipSeconds),
  rotationSeconds: String(c.rotationSeconds),
});
export const toConfig = (c: WallDraft): WallConfig => ({
  ...c,
  flipSeconds: Number(c.flipSeconds),
  rotationSeconds: Number(c.rotationSeconds),
});
const equal = (a: WallDraft, b: WallDraft) =>
  Object.keys(a).every(
    (k) => a[k as keyof WallDraft] === b[k as keyof WallDraft],
  );
type Form = { baseline: WallDraft; draft: WallDraft; version: number };
function persist(key: string, form: Form) {
  try {
    if (equal(form.draft, form.baseline)) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(form));
  } catch {
    /* Native leave protection remains active if storage is unavailable. */
  }
}
function restore(key: string): Form | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    const valid = (d: WallDraft) =>
      d &&
      Object.keys(d).sort().join() ===
        Object.keys(DEFAULT_WALL_CONFIG).sort().join() &&
      ["real", "demo"].includes(d.mode) &&
      typeof d.running === "boolean" &&
      typeof d.flipSeconds === "string" &&
      d.flipSeconds.length < 20 &&
      typeof d.rotationSeconds === "string" &&
      d.rotationSeconds.length < 20 &&
      [25, 50, 100].includes(d.ratio) &&
      d.minColumns === 6 &&
      d.maxColumns === 6;
    return value &&
      valid(value.draft) &&
      valid(value.baseline) &&
      Number.isInteger(value.version)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function useWallSettings(activity: string) {
  const key = `destiny-wall-draft:${activity}`;
  const [data, setData] = useState<WallAdminView | null>(null);
  const [form, setForm] = useState<Form>({
    baseline: toDraft(DEFAULT_WALL_CONFIG),
    draft: toDraft(DEFAULT_WALL_CONFIG),
    version: -1,
  });
  const [reading, setReading] = useState(true),
    [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [syncedAt, setSyncedAt] = useState(0);
  const latest = useRef(form),
    saving = useRef(false),
    initialized = useRef(false),
    active = useRef(false),
    sequence = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const loading = useRef(false);
  const dirty = !equal(form.draft, form.baseline);
  const config = toConfig(form.draft),
    errors = wallConfigErrors(config);
  const conflict = !!data && data.configVersion !== form.version;
  function update(next: Form) {
    latest.current = next;
    setForm(next);
    persist(key, next);
  }
  function edit(change: Partial<WallDraft>) {
    update({
      ...latest.current,
      draft: { ...latest.current.draft, ...change },
    });
    setMessage("");
    setError("");
  }
  const reload = useCallback(async () => {
    if (saving.current || loading.current || !active.current) return;
    loading.current = true;
    const seq = ++sequence.current,
      abort = new AbortController();
    controllers.current.add(abort);
    const timer = setTimeout(() => abort.abort(), 7000);
    setReading(true);
    try {
      const r = await fetch(
        `/api/member-wall/admin?activity=${encodeURIComponent(activity)}`,
        { cache: "no-store", signal: abort.signal },
      );
      const d: WallAdminView & { error?: string } = await r.json();
      if (!r.ok) throw Error(d.error || "运行状态读取失败。");
      if (!active.current || seq !== sequence.current) return;
      if (d.activity !== activity) throw Error("活动数据不匹配，请重试。");
      setData(d);
      setSyncedAt(Date.now());
      setReadError("");
      const cached = !initialized.current ? restore(key) : null;
      if (cached) {
        latest.current = cached;
        setForm(cached);
        setMessage(
          "已恢复本窗口的未保存配置，请核对后保存；现场仍使用服务器配置。",
        );
      } else if (
        !initialized.current ||
        equal(latest.current.draft, latest.current.baseline)
      ) {
        const next = {
          baseline: toDraft(d.config),
          draft: toDraft(d.config),
          version: d.configVersion,
        };
        latest.current = next;
        setForm(next);
      }
      initialized.current = true;
    } catch (e) {
      if (active.current && seq === sequence.current)
        setReadError(
          e instanceof Error && e.name !== "AbortError"
            ? e.message
            : "读取超时，请重试。",
        );
    } finally {
      clearTimeout(timer);
      loading.current = false;
      controllers.current.delete(abort);
      if (active.current && seq === sequence.current) setReading(false);
    }
  }, [activity, key]);
  useEffect(() => {
    active.current = true;
    const pending = controllers.current;
    const initial = setTimeout(() => void reload(), 0);
    const invalidate = () => {
      sequence.current++;
      pending.forEach((c) => c.abort());
    };
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 5000);
    const visible = () => {
      if (!document.hidden) void reload();
    };
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active.current = false;
      clearTimeout(initial);
      invalidate();
      clearInterval(timer);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload]);
  useEffect(() => {
    const hasDraft = () =>
      !equal(latest.current.draft, latest.current.baseline);
    const allowed = () => {
      if (saving.current) {
        window.alert("配置正在保存，请等待服务器结果。");
        return false;
      }
      return (
        !hasDraft() ||
        window.confirm(
          "配置尚未保存。继续操作将使用服务器已保存的设置；本窗口草稿会保留，是否继续？",
        )
      );
    };
    let restoringHistory = false;
    const unload = (e: BeforeUnloadEvent) => {
      if (restoringHistory) return;
      if (hasDraft() || saving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const click = (e: MouseEvent) => {
      const node =
        e.target instanceof Element
          ? e.target.closest("a[href], [data-wall-leave]")
          : null;
      if (!node || node.closest("[data-wall-preview]")) return;
      if (!allowed()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const change = (e: Event) => {
      if (
        e.target instanceof HTMLSelectElement &&
        e.target.getAttribute("aria-label") === "切换活动" &&
        !allowed()
      ) {
        e.target.value = activity;
        e.stopImmediatePropagation();
      }
    };
    // Preserve Next's history entries. Supported browsers expose the traversal
    // index; undo a cancelled traversal without replacing either history entry.
    const currentUrl = location.href;
    const navigation = (
      window as Window & {
        navigation?: EventTarget & { currentEntry?: { index: number } };
      }
    ).navigation;
    const currentIndex = navigation?.currentEntry?.index;
    let approvedTraversal = false;
    const beforeTraverse = (event: Event) => {
      const e = event as Event & {
        navigationType?: string;
        destination?: { url: string };
      };
      if (
        e.navigationType !== "traverse" ||
        !e.cancelable ||
        restoringHistory ||
        e.destination?.url === location.href
      )
        return;
      if (!allowed()) e.preventDefault();
      else approvedTraversal = true;
    };
    navigation?.addEventListener("navigate", beforeTraverse);
    const pop = (e: PopStateEvent) => {
      if (approvedTraversal) {
        approvedTraversal = false;
        return;
      }
      if (restoringHistory) {
        restoringHistory = false;
        e.stopImmediatePropagation();
        return;
      }
      if (!allowed()) {
        e.stopImmediatePropagation();
        restoringHistory = true;
        const targetIndex = navigation?.currentEntry?.index;
        if (
          currentIndex !== undefined &&
          targetIndex !== undefined &&
          targetIndex !== currentIndex
        )
          history.go(currentIndex - targetIndex);
        else location.assign(currentUrl); // Fallback reload restores the scoped draft.
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    window.addEventListener("popstate", pop, true);
    return () => {
      navigation?.removeEventListener("navigate", beforeTraverse);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      window.removeEventListener("popstate", pop, true);
    };
  }, [activity]);
  function cancel() {
    if (
      !data ||
      (dirty &&
        !window.confirm("放弃本窗口未保存修改，重新使用当前服务器配置？"))
    )
      return;
    update({
      baseline: toDraft(data.config),
      draft: toDraft(data.config),
      version: data.configVersion,
    });
    setError("");
    setMessage("");
  }
  async function save() {
    if (
      !data ||
      saving.current ||
      !dirty ||
      conflict ||
      Object.keys(errors).length ||
      readError
    )
      return;
    // Always disclose the impact: a different window could claim the screen after our last read.
    if (
      !window.confirm(
        "保存配置会结束当前主屏会话（如有）。保存后需在大屏页重新点击“启动主屏”。是否保存？",
      )
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    sequence.current++;
    controllers.current.forEach((c) => c.abort());
    setReading(false);
    const abort = new AbortController();
    controllers.current.add(abort);
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const r = await fetch(
        `/api/member-wall/config?activity=${encodeURIComponent(activity)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({ config, expectedVersion: form.version }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "保存失败，请重试。");
      if (!active.current) return;
      setData(d);
      setSyncedAt(Date.now());
      setReadError("");
      update({
        baseline: toDraft(d.config),
        draft: toDraft(d.config),
        version: d.configVersion,
      });
      setMessage(
        `已保存 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}。请打开大屏并启动主屏。`,
      );
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error && e.name !== "AbortError"
            ? e.message
            : "未收到保存结果，请刷新运行状态核对；草稿已保留。",
        );
    } finally {
      clearTimeout(timer);
      controllers.current.delete(abort);
      saving.current = false;
      if (active.current) {
        setBusy(false);
        void reload();
      }
    }
  }
  return {
    data,
    draft: form.draft,
    config,
    errors,
    dirty,
    conflict,
    reading,
    busy,
    readError,
    error,
    message,
    syncedAt,
    reload,
    edit,
    cancel,
    save,
  };
}
