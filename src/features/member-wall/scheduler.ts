import type { WallConfig } from "@/domain/member-wall";
export interface WallFrame { side: "front" | "back"; flipping: boolean; rotate: boolean; step: number }
/** One monotonic clock for the entire wall; rendering and network work are separate. */
export class WallClock {
  private start = 0;
  private rotated = 0;
  reset(now: number) { this.start = now; this.rotated = 0; }
  frame(now: number, config: WallConfig, columns: number, reduced = false): WallFrame {
    if (!config.running) return { side: "front", flipping: false, rotate: false, step: 0 };
    const elapsed = Math.max(0, now - this.start), interval = config.flipSeconds * 1000;
    const step = Math.floor(elapsed / interval), side = step % 2 ? "back" : "front";
    const flipping = step > 0 && elapsed % interval < (reduced ? 180 : 720 + (columns - 1) * 90);
    const due = Math.floor(elapsed / (config.rotationSeconds * 1000));
    return { side, flipping, step, rotate: due > this.rotated && !flipping && side === "front" };
  }
  didRotate(now: number, config: WallConfig) { this.rotated = Math.floor((now - this.start) / (config.rotationSeconds * 1000)); }
}
