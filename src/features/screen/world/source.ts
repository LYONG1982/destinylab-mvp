"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import * as store from "@/lib/demo/store";
import { WorldAdapter } from "./adapter";
import { mockWorld } from "./mock";
import type { WorldData } from "./types";
import * as live from "@/lib/api/live-client";
export { mockWorld } from "./mock";
const serverSnapshot = () => null;

class ScreenObserver {
  private adapter = new WorldAdapter();
  private unavailable = false;
  read(): WorldData | "unavailable" | null {
    if (store.storageUnreadable()) {
      this.unavailable = true;
      return "unavailable";
    }
    if (this.unavailable) {
      this.adapter = new WorldAdapter();
      this.unavailable = false;
    }
    const state = store.getSnapshot();
    return state ? this.adapter.read(state) : null;
  }
}

/** Screen subscription: no sweep, invitation mutation, actor change or broadcast consume. */
export function useWorldData(requestMock: boolean): WorldData | "unavailable" | null {
  const mock = requestMock && process.env.NODE_ENV === "development";
  const observer = useMemo(() => new ScreenObserver(), []);
  const getSnapshot = useCallback(
    () => (live.isLive() ? live.getWorld() || (live.getProblem() ? "unavailable" : null) : mock ? mockWorld.getSnapshot() : observer.read()),
    [observer, mock],
  );
  const data = useSyncExternalStore(
    live.isLive() ? live.subscribe : mock ? mockWorld.subscribe : store.subscribe,
    getSnapshot,
    serverSnapshot,
  );
  useEffect(() => {
    if (live.isLive()) live.initialize();
    else if (!mock) store.initialize();
  }, [mock]);
  return data;
}
