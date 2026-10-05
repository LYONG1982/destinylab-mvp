"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import * as store from "./store";
import type { Command } from "@/domain/types";
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
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get("actor");
    if (requested) {
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
    if (!state) return;
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        state.invitations.some((i) => i.status === "SENT")
      )
        void store.command("operator", { type: "sweep" }).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [state]);
  return { state, actor, problem };
}
export function useAction(actor: string) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(c: Command, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await store.command(actor, c);
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
