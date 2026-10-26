import type { WorldEvent, WorldFrame, WorldMode } from "./types";
export const WORLD_DURATIONS = {
  CHOICE: 12000,
  LIVE: 8000,
  MEET: 18000,
} as const;
const NEXT: Record<WorldMode, WorldMode> = {
  CHOICE: "LIVE",
  LIVE: "MEET",
  MEET: "CHOICE",
};
const INTERSECTION_MS = 6000;
const NORMAL_WINDOW_MS = 2400;
type Cue = { id: string; count: number; timestamp: number };

/** Pure visual clock: event overlays pause the mode clock, never reset the World. */
export class WorldClock {
  private mode: WorldMode;
  private fixed: boolean;
  private modeElapsedMs = 0;
  private intersection: WorldFrame["intersection"] = null;
  private normalWindowMs = 0;
  private pending: Cue[] = [];
  private seen = new Set<string>();
  constructor(mode: WorldMode = "CHOICE", fixed = false) {
    this.mode = mode;
    this.fixed = fixed;
  }
  reset(mode: WorldMode = this.mode, fixed = this.fixed) {
    this.mode = mode;
    this.fixed = fixed;
    this.modeElapsedMs = 0;
    this.intersection = null;
    this.normalWindowMs = 0;
    this.pending = [];
    this.seen.clear();
    return this.frame();
  }
  /** Hidden tabs discard visual cues without consuming any remaining mode time. */
  clearEvents() {
    this.intersection = null;
    this.pending = [];
    this.normalWindowMs = 0;
    return this.frame();
  }
  private frame(): WorldFrame {
    return {
      mode: this.mode,
      modeElapsedMs: this.modeElapsedMs,
      remainingMs: Math.max(0, WORLD_DURATIONS[this.mode] - this.modeElapsedMs),
      intersection: this.intersection ? { ...this.intersection } : null,
    };
  }
  private start(cue: Cue) {
    this.intersection = { id: cue.id, count: cue.count, elapsedMs: 0 };
  }
  receive(event: WorldEvent) {
    if (event.type !== "mutual_confirmed" || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    while (this.seen.size > 512)
      this.seen.delete(this.seen.values().next().value!);
    const age = Date.now() - event.timestamp;
    if (age > 10000 || age < -5000) return;
    const cue = {
      id: event.id,
      count: Math.max(1, Math.min(999, event.aggregateCount ?? 1)),
      timestamp: event.timestamp,
    };
    if (!this.intersection && this.normalWindowMs <= 0) {
      this.start(cue);
      return;
    }
    const tail = this.pending.at(-1);
    if (
      tail &&
      (cue.timestamp - tail.timestamp <= 5000 || this.pending.length >= 4)
    ) {
      tail.count = Math.min(999, tail.count + cue.count);
      tail.timestamp = Math.max(tail.timestamp, cue.timestamp);
    } else this.pending.push(cue);
  }
  /** A long suspension freezes the world and drops queued cues, not fast-forwards it. */
  tick(deltaMs: number): WorldFrame {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return this.frame();
    if (deltaMs > 15000) {
      this.pending = [];
      return this.frame();
    }
    let remaining = deltaMs;
    while (remaining > 0) {
      if (this.intersection) {
        const spent = Math.min(
          remaining,
          INTERSECTION_MS - this.intersection.elapsedMs,
        );
        this.intersection.elapsedMs += spent;
        remaining -= spent;
        if (this.intersection.elapsedMs >= INTERSECTION_MS) {
          this.intersection = null;
          this.normalWindowMs = NORMAL_WINDOW_MS;
        }
        continue;
      }
      this.pending = this.pending.filter(
        (cue) => Date.now() - cue.timestamp <= 10000,
      );
      if (this.pending.length && this.normalWindowMs <= 0) {
        this.start(this.pending.shift()!);
        continue;
      }
      const untilMode = this.fixed
        ? Infinity
        : WORLD_DURATIONS[this.mode] - this.modeElapsedMs;
      const untilCue =
        this.pending.length && this.normalWindowMs > 0
          ? this.normalWindowMs
          : Infinity;
      const spent = Math.min(remaining, untilMode, untilCue);
      if (!this.fixed) this.modeElapsedMs += spent;
      this.normalWindowMs = Math.max(0, this.normalWindowMs - spent);
      remaining -= spent;
      if (!this.fixed && this.modeElapsedMs >= WORLD_DURATIONS[this.mode]) {
        this.mode = NEXT[this.mode];
        this.modeElapsedMs = 0;
      }
    }
    return this.frame();
  }
  get queuedCount() {
    return this.pending.length;
  }
}
