import { JoinEventQueue } from "./relationship/queue";
import { ScreenFrameLoop } from "./frame-loop";
import { screenMotion } from "@/lib/motion-tokens";
import type { DisplayNode, ScreenEvent } from "./model";
export type Effect = ScreenEvent & { started: number; duration: number };
/** Future SSE/WS adapters must first apply the same approved nickname/aggregate policy. */
export interface ScreenEventSource {
  subscribe(listener: (event: ScreenEvent) => void): () => void;
}
export class MotionController {
  readonly frames = new ScreenFrameLoop();
  readonly joins = new JoinEventQueue();
  fieldActive = false;
  setFieldActive(active: boolean) {
    this.fieldActive = active;
  }
  enabled = true;
  energy = 0.7;
  trails = true;
  effects: Effect[] = [];
  previews: { node: DisplayNode; until: number }[] = [];
  private seen = new Set<string>();
  preview(node: DisplayNode, now = performance.now()) {
    this.previews = [{ node, until: now + 6000 }];
  }
  connect(source: ScreenEventSource) {
    return source.subscribe((event) => this.receive(event));
  }
  receive(event: ScreenEvent, now = performance.now()) {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 128)
      this.seen.delete(this.seen.values().next().value!);
    if (
      !this.enabled ||
      (typeof matchMedia !== "undefined" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches) ||
      (typeof document !== "undefined" &&
        document.visibilityState !== "visible") ||
      Date.now() - event.timestamp > 5000
    )
      return;
    if (event.type === "MATCH" && !event.aggregate) return;
    if (event.field && this.fieldActive)
      this.joins.enqueue({ ...event, field: event.field }, now);
    const duration =
      event.type === "MATCH"
        ? event.phase === "mutual"
          ? screenMotion.mutual
          : screenMotion.match
        : event.type === "JOIN"
          ? screenMotion.birth
          : screenMotion.feedback;
    // Coalesce repeated signals for one node/statistic; MATCH preempts lower-level pulses.
    this.effects = this.effects.filter(
      (e) =>
        !(event.type === "MATCH"
          ? e.type === "MATCH"
          : e.type === event.type &&
            e.node === event.node &&
            e.option === event.option),
    );
    this.effects.push({ ...event, started: now, duration: duration * 1000 });
    this.effects = this.effects.slice(-8);
  }
  prune(now: number) {
    this.effects = this.effects.filter((e) => now - e.started < e.duration);
    this.previews = this.previews.filter((p) => p.until > now);
  }
  clear() {
    this.joins.clear();
    this.effects = [];
    this.previews = [];
  }
  dispose() {
    this.clear();
    this.seen.clear();
    this.frames.dispose();
  }
}
