"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as store from "./store";
import type { Command } from "@/domain/types";
import { isLive } from "@/lib/api/live-client";
export function useDemo() {
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
  const problem = useSyncExternalStore(
    store.subscribe,
    store.storageProblem,
    () => "",
  );
  const unreadable = useSyncExternalStore(
    store.subscribe,
    store.storageUnreadable,
    () => false,
  );
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get("actor");
    if (requested && !isLive()) {
      store.setActor(requested);
      query.delete("actor");
      const suffix = query.toString();
      history.replaceState(
        null,
        "",
        `${location.pathname}${suffix ? "?" + suffix : ""}`,
      );
    }
    store.initialize();
  }, []);
  useEffect(() => {
    if (!state || isLive()) return;
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        state.invitations.some((i) => i.status === "SENT")
      )
        void store.command("operator", { type: "sweep" }).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [state]);
  return { state, actor, problem, unreadable };
}
export function useAction(actor: string, scope = actor) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const version = ++generation.current;
    locked.current = false;
    return () => {
      generation.current = version + 1;
      pending.current?.abort();
    };
  }, [actor, scope]);
  async function run(
    c: Command,
    after?: (isCurrent: () => boolean) => void | Promise<void>,
  ) {
    if (locked.current) return;
    locked.current = true;
    const version = generation.current;
    const epoch = store.getSnapshot()?.epoch;
    const path = location.pathname;
    const isCurrent = () =>
      generation.current === version &&
      store.getSnapshot()?.epoch === epoch &&
      location.pathname === path;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      await store.command(actor, c, undefined, controller.signal);
      if (isCurrent()) await after?.(isCurrent);
    } catch (e) {
      if (isCurrent())
        setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      if (generation.current === version) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  return { busy, error, setError, run };
}
