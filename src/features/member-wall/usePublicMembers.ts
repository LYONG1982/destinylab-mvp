"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  safeWallCard,
  WALL_TTL_MS,
  type WallSnapshot,
} from "@/domain/member-wall";
import { clientId } from "@/lib/client-id";

export function usePublicMembers(
  activity: string,
  preview: boolean,
  columns: number,
  readable: boolean,
) {
  const [snapshot, setSnapshot] = useState<WallSnapshot | null>(null);
  const [status, setStatus] = useState("connecting"),
    [primary, setPrimary] = useState(false),
    [message, setMessage] = useState("");
  const token = useRef(""),
    seq = useRef(0),
    batch = useRef(0),
    validUntil = useRef(0),
    acceptedRevision = useRef(-1);
  const owner = useRef(""),
    latest = useRef<WallSnapshot | null>(null),
    serial = useRef(Promise.resolve());
  const generation = useRef(0),
    lastHeartbeat = useRef(0),
    active = useRef(true),
    aborts = useRef(new Set<AbortController>());
  const viewport = useRef({ columns, readable });
  useEffect(() => {
    viewport.current = { columns, readable };
  }, [columns, readable]);
  const accept = useCallback(
    (data: WallSnapshot, started: number) => {
      if (!active.current || document.hidden || data.activity !== activity)
        return;
      // Requests are serialized: a new activity epoch is authoritative even when its revision restarts at zero.
      if (latest.current && latest.current.epoch !== data.epoch)
        acceptedRevision.current = -1;
      if (data.revision < acceptedRevision.current) return;
      acceptedRevision.current = data.revision;
      const ttl = Math.max(
        0,
        Math.min(WALL_TTL_MS, data.validForMs) - (performance.now() - started),
      );
      validUntil.current = performance.now() + ttl;
      const safe = { ...data, cards: data.cards.filter(safeWallCard) };
      latest.current = safe;
      batch.current = data.batch;
      setSnapshot(safe);
      setStatus(ttl ? "ready" : "expired");
    },
    [activity],
  );
  const request = useCallback(
    (path: string, input?: object): Promise<WallSnapshot | null> => {
      const currentGeneration = generation.current;
      let result: WallSnapshot | null = null;
      const work = serial.current
        .catch(() => {})
        .then(async () => {
          if (
            !active.current ||
            document.hidden ||
            currentGeneration !== generation.current
          )
            return;
          const abort = new AbortController();
          aborts.current.add(abort);
          const timeout = setTimeout(() => abort.abort(), 7000),
            started = performance.now();
          try {
            const response = await fetch(
              `/api/member-wall/${path}?activity=${encodeURIComponent(activity)}`,
              {
                cache: "no-store",
                signal: abort.signal,
                ...(input
                  ? {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(input),
                    }
                  : {}),
              },
            );
            const data = await response.json();
            if (
              currentGeneration !== generation.current ||
              !active.current ||
              document.hidden
            )
              return;
            if (!response.ok) {
              if (path !== "snapshot")
                setMessage(data.error || "操作未完成，请重试。");
              if (
                response.status === 401 ||
                (path === "heartbeat" && response.status === 409)
              ) {
                token.current = "";
                setPrimary(false);
              }
              return;
            }
            if (path === "claim") {
              token.current = data.token;
              seq.current = 0;
              lastHeartbeat.current = performance.now();
              setPrimary(true);
              setMessage("");
            }
            result = data.snapshot || data;
            accept(result!, started);
          } catch {
            if (path !== "snapshot" && active.current)
              setMessage("连接失败，请检查网络后重试；过期资料将自动隐藏。");
          } finally {
            clearTimeout(timeout);
            aborts.current.delete(abort);
          }
        });
      serial.current = work;
      return work.then(() => result);
    },
    [activity, accept],
  );
  useEffect(() => {
    if (preview) return;
    const controllers = aborts.current;
    const invalidate = () => {
      generation.current++;
      controllers.forEach((a) => a.abort());
    };
    active.current = true;
    owner.current = clientId();
    acceptedRevision.current = -1;
    let disposed = false,
      refreshPending = false,
      pulseBusy = false,
      eventTimer: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | null = null;
    const read = () => {
      if (disposed || document.hidden || refreshPending) return;
      refreshPending = true;
      void request("snapshot").finally(() => {
        refreshPending = false;
      });
    };
    const connect = () => {
      source?.close();
      source = new EventSource(
        `/api/live/events?audience=screen&activity=${encodeURIComponent(activity)}`,
      );
      source.addEventListener("version", () => {
        clearTimeout(eventTimer);
        eventTimer = setTimeout(read, 30);
      });
    };
    read();
    connect();
    const tick = setInterval(() => {
      if (document.hidden || pulseBusy) return;
      if (token.current) {
        const canCount =
          viewport.current.readable &&
          (latest.current?.cards.length || 0) <= viewport.current.columns * 4;
        const now = performance.now(),
          elapsedMs = canCount
            ? Math.min(5000, Math.max(0, now - lastHeartbeat.current))
            : 0;
        lastHeartbeat.current = now;
        pulseBusy = true;
        void request("heartbeat", {
          token: token.current,
          sequence: ++seq.current,
          batch: batch.current,
          elapsedMs,
        }).finally(() => {
          pulseBusy = false;
        });
      } else read();
    }, 5000);
    const expiry = setInterval(() => {
      if (performance.now() >= validUntil.current) setStatus("expired");
    }, 200);
    const visibility = () => {
      invalidate();
      source?.close();
      validUntil.current = 0;
      setSnapshot(null);
      setStatus("connecting");
      lastHeartbeat.current = performance.now();
      // A returning primary reacquires a fresh lease; hidden time is never credited.
      token.current = "";
      setPrimary(false);
      if (!document.hidden) {
        read();
        connect();
      }
    };
    const online = () => read();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      active.current = false;
      invalidate();
      clearInterval(tick);
      clearInterval(expiry);
      clearTimeout(eventTimer);
      source?.close();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
    };
  }, [activity, preview, request]);
  const claim = useCallback(
    () => request("claim", { owner: owner.current, capacity: columns * 4 }),
    [request, columns],
  );
  const rotate = useCallback(
    () =>
      token.current
        ? request("rotate", {
            token: token.current,
            batch: batch.current,
            capacity: columns * 4,
          })
        : Promise.resolve(null),
    [columns, request],
  );
  const sameActivity = snapshot?.activity === activity;
  return {
    snapshot: sameActivity ? snapshot : null,
    status,
    primary: sameActivity && primary,
    message,
    claim,
    rotate,
  };
}
