import { uniqueQualifiedPairs, pairKey } from "./pair-adapter";
import { PAIR_TIMING as T, PAIR_HEART, pairLayout } from "./pair-config";
import type {
  MeetPair,
  MeetSceneData,
  PairCommand,
  PairSceneFrame,
  PairPhase,
  WorldFrame,
} from "./types";
type Slot = {
  pair: MeetPair;
  token: number;
  start: number;
  exitAt: number | null;
  next: string | null;
  fresh: boolean;
};
export function pairSeed(id: string) {
  let n = 2166136261;
  for (const c of id) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function pairPhase(ms: number): PairPhase {
  return ms < 0
    ? "breathe"
    : ms < T.enter
      ? "in"
      : ms < T.collision
        ? "connection"
        : ms < T.hold
          ? "collision"
          : "hold";
}
/** One director and clock, three bounded slots; no domain mutation or independent timers. */
export class PairSceneController {
  private pairs = new Map<string, MeetPair>();
  private slots: (Slot | null)[] = [null, null, null];
  private queue: string[] = [];
  private priority: string[] = [];
  private observed = new Set<string>();
  private history: string[] = [];
  private fresh = new Set<string>();
  private initialized = false;
  private serial = 0;
  private round = 0;
  private priorityStreak = 0;
  private time = 0;
  private nextReplacement = T.firstReplacement as number;
  private mode = "";
  private layoutCount = 0;
  private trail = true;
  private spark = true;
  update(data: MeetSceneData | undefined, acceptEvents = true) {
    const qualified =
      data?.permissionVerified === false
        ? []
        : uniqueQualifiedPairs(data?.qualifiedPairs ?? []);
    const next = new Map(qualified.map((p) => [p.id, p]));
    const valid = (id: string) => next.has(id);
    this.queue = this.queue.filter(valid);
    this.priority = this.priority.filter(valid);
    this.history = this.history.filter(valid).slice(-6);
    for (const id of this.fresh) if (!valid(id)) this.fresh.delete(id);
    for (let i = 0; i < 3; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      const pair = next.get(slot.pair.id);
      if (!pair) {
        this.slots[i] = null;
        continue;
      }
      slot.pair = pair;
      if (slot.next && !valid(slot.next)) {
        slot.next = null;
        slot.exitAt = null;
      }
    }
    for (const p of qualified) {
      const transition = `${p.id}:${p.status}:${p.confirmedAt}`;
      const active = this.slots.some((s) => s?.pair.id === p.id);
      if (
        this.initialized &&
        !this.observed.has(transition) &&
        p.justConfirmed &&
        acceptEvents &&
        !active
      ) {
        if (!this.priority.includes(p.id)) this.priority.push(p.id);
        this.fresh.add(p.id);
      }
      if (!this.pairs.has(p.id) && !this.queue.includes(p.id))
        this.queue.push(p.id);
      this.observed.add(transition);
    }
    while (this.observed.size > T.seenLimit)
      this.observed.delete(this.observed.values().next().value!);
    this.priority = this.priority.slice(-T.priorityLimit);
    this.pairs = next;
    this.initialized = true;
    const occupied = new Set<string>();
    let capacity = 0;
    for (const p of [
      ...this.slots.flatMap((s) => (s ? [s.pair] : [])),
      ...qualified,
    ]) {
      if (occupied.has(p.male.id) || occupied.has(p.female.id)) continue;
      occupied.add(p.male.id);
      occupied.add(p.female.id);
      if (++capacity === 3) break;
    }
    if (capacity < this.layoutCount) {
      this.layoutCount = capacity;
      const kept = this.slots.filter((s): s is Slot => !!s);
      this.slots = [kept[0] ?? null, kept[1] ?? null, kept[2] ?? null];
    }
  }
  private choose(replacing = -1): string | undefined {
    const occupied = new Set<string>(),
      displayed = new Set<string>();
    this.slots.forEach((s, i) => {
      if (!s) return;
      displayed.add(s.pair.id);
      if (i !== replacing) {
        occupied.add(s.pair.male.id);
        occupied.add(s.pair.female.id);
      }
    });
    const eligible = (id: string) => {
      const p = this.pairs.get(id);
      return (
        !!p &&
        !displayed.has(id) &&
        !occupied.has(p.male.id) &&
        !occupied.has(p.female.id)
      );
    };
    let regular = this.queue.find(eligible);
    if (
      !regular &&
      !this.queue.some((id) => this.pairs.has(id) && !displayed.has(id))
    ) {
      const round = ++this.round;
      this.queue = [...this.pairs.keys()].sort(
        (a, b) => pairSeed(`${round}:${a}`) - pairSeed(`${round}:${b}`),
      );
      regular = this.queue.find(eligible);
    }
    // A currently-conflicting regular candidate must not prevent another safe historical pair.
    regular ??= [...this.pairs.keys()]
      .filter(eligible)
      .sort(
        (a, b) => this.history.lastIndexOf(a) - this.history.lastIndexOf(b),
      )[0];
    const urgent = this.priority.find(eligible);
    const id =
      this.priorityStreak >= 2 && regular ? regular : (urgent ?? regular);
    if (id) {
      this.priorityStreak = id === urgent ? this.priorityStreak + 1 : 0;
      this.queue = this.queue.filter((x) => x !== id);
      this.priority = this.priority.filter((x) => x !== id);
    }
    return id;
  }
  private assign(index: number, id: string, start: number) {
    const pair = this.pairs.get(id);
    if (!pair) return;
    this.slots[index] = {
      pair,
      token: ++this.serial,
      start,
      exitAt: null,
      next: null,
      fresh: this.fresh.delete(id),
    };
    this.history.push(id);
    this.history = this.history.slice(-6);
  }
  advance(delta: number, world: WorldFrame, fixed: boolean): PairSceneFrame {
    const entered = world.mode !== this.mode;
    this.mode = world.mode;
    if (world.mode !== "MEET") return this.frame(false);
    if (entered) {
      this.slots = [null, null, null];
      this.time = 0;
      this.nextReplacement = T.firstReplacement;
      for (let i = 0; i < 3; i++) {
        const id = this.choose();
        if (!id) break;
        this.assign(i, id, i * T.stagger);
      }
      this.layoutCount = this.slots.filter(Boolean).length;
    } else if (!world.intersection && delta >= 0 && delta <= 15000)
      this.time += delta;
    if (world.intersection) return this.frame();
    // Finish only the selected slot; no other pair's start time or token changes.
    for (let i = 0; i < 3; i++) {
      const s = this.slots[i];
      if (
        s?.exitAt !== null &&
        s?.exitAt !== undefined &&
        this.time - s.exitAt >= T.exit
      ) {
        const next = s.next;
        this.slots[i] = null;
        if (next) this.assign(i, next, this.time);
      }
    }
    const busy = this.slots.some(
      (s) => s && (s.exitAt !== null || this.time - s.start < T.hold),
    );
    const enough = fixed || world.remainingMs >= T.remainingRequired;
    if (!busy && enough) {
      const empty = this.slots.findIndex((s) => !s);
      if (empty >= 0) {
        const id = this.choose();
        if (id) {
          this.assign(empty, id, this.time);
          this.layoutCount = Math.max(this.layoutCount, empty + 1);
          return this.frame();
        }
      }
      if (this.time >= this.nextReplacement) {
        const oldest = this.slots
          .map((s, i) => ({ s, i }))
          .filter(
            ({ s }) => s && this.time - s.start >= T.hold + T.stableMinimum,
          )
          .sort((a, b) => a.s!.start - b.s!.start);
        for (const { s, i } of oldest) {
          const id = this.choose(i);
          if (id) {
            s!.exitAt = this.time;
            s!.next = id;
            this.nextReplacement = this.time + T.replacementInterval;
            break;
          }
        }
      }
    }
    return this.frame();
  }
  command(command: PairCommand) {
    if (command === "trail") this.trail = !this.trail;
    else if (command === "spark") this.spark = !this.spark;
    else if (command === "collision") {
      if (
        this.slots.every(
          (s) =>
            !s ||
            (s.exitAt === null &&
              this.time - s.start >= T.collision + PAIR_HEART.durationMs),
        )
      ) {
        const s = this.slots.find(Boolean);
        if (s) s.start = this.time - T.collision;
      }
    } else {
      if (command === "previous") {
        const id = [...this.history]
          .reverse()
          .find((id) => !this.slots.some((s) => s?.pair.id === id));
        if (id)
          this.priority = [id, ...this.priority.filter((x) => x !== id)].slice(
            0,
            T.priorityLimit,
          );
      }
      this.nextReplacement = Math.max(T.firstReplacement, this.time);
    }
  }
  clearFresh() {
    this.priority = [];
    this.fresh.clear();
    this.slots.forEach((s) => {
      if (s) s.fresh = false;
    });
  }
  frame(visible = true): PairSceneFrame {
    return {
      elapsedMs: this.time,
      layoutCount: this.layoutCount,
      trail: this.trail,
      spark: this.spark,
      slots: visible
        ? this.slots.flatMap((s, slot) => {
            if (!s) return [];
            const age = this.time - s.start,
              exiting = s.exitAt !== null;
            return [
              {
                pair: s.pair,
                slot,
                token: s.token,
                elapsedMs: age,
                phase: exiting ? ("out" as const) : pairPhase(age),
                pattern: pairSeed(pairKey(s.pair)) % 5,
                opacity: exiting
                  ? Math.max(0, 1 - (this.time - s.exitAt!) / T.exit)
                  : Math.min(
                      1,
                      Math.max(
                        0,
                        (s.start > T.stagger * 2 ? age : this.time) / T.enter,
                      ),
                    ),
                justConfirmed: s.fresh && age < T.hold,
                layout: pairLayout(this.layoutCount, slot),
              },
            ];
          })
        : [],
    };
  }
  get queuedCount() {
    return this.queue.length + this.priority.length;
  }
}
