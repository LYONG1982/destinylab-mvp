import type { WorldGender, WorldMode, WorldPlayer } from "./types";
import {
  DEFAULT_WORLD_FIELDS,
  PLAYER_LAYOUT,
  placementForSlot,
  type PlayerLayoutMode,
  type PlayerPlacement,
} from "./player-layout";

interface QueueMove {
  from: string[];
  next: string[];
  elapsed: number;
}
interface QueueState {
  key: string;
  mode: PlayerLayoutMode;
  gender: WorldGender;
  fieldIndex: number;
  roster: string[];
  visible: string[];
  pending: string[];
  elapsed: number;
  holdMs: number;
  moveMs: number;
  move: QueueMove | null;
  urgent: boolean;
  initialized: boolean;
}
const genders: readonly WorldGender[] = ["male", "female"];
const ease = (value: number) => value * value * (3 - 2 * value);
const order = (a: WorldPlayer, b: WorldPlayer) =>
  (Number.isFinite(a.joinedAt) ? a.joinedAt : 0) -
    (Number.isFinite(b.joinedAt) ? b.joinedAt : 0) || a.id.localeCompare(b.id);

/** No timers, RAF or React state. The persistent World scheduler owns time. */
export class StableQueueController {
  private players = new Map<string, WorldPlayer>();
  private queues = new Map<string, QueueState>();
  private fields: readonly string[] = DEFAULT_WORLD_FIELDS;

  constructor(
    players: readonly WorldPlayer[] = [],
    fieldIds?: readonly string[],
  ) {
    if (players.length) this.update(players, fieldIds);
    else if (fieldIds) this.fields = [...new Set(fieldIds)].slice(0, 3);
  }

  update(players: readonly WorldPlayer[], fieldIds?: readonly string[]): void {
    if (fieldIds) this.fields = [...new Set(fieldIds)].slice(0, 3);
    this.players = new Map(players.map((player) => [player.id, player]));
    const sorted = [...this.players.values()].sort(order);
    const activeKeys = new Set<string>();
    for (const mode of ["CHOICE", "LIVE"] as const) {
      const fields = mode === "CHOICE" ? this.fields : [null];
      fields.forEach((field, fieldIndex) => {
        genders.forEach((gender, genderIndex) => {
          const key = `${mode}:${field ?? "all"}:${gender}`;
          activeKeys.add(key);
          let queue = this.queues.get(key);
          if (!queue) {
            // Independent deterministic timing, with no per-frame randomness.
            const stagger = fieldIndex * 113 + genderIndex * 271;
            queue = {
              key,
              mode,
              gender,
              fieldIndex,
              roster: [],
              visible: [],
              pending: [],
              elapsed: 0,
              holdMs: (mode === "CHOICE" ? 3200 : 3700) + (stagger % 650),
              moveMs: (mode === "CHOICE" ? 680 : 780) + (stagger % 170),
              move: null,
              urgent: false,
              initialized: false,
            };
            this.queues.set(key, queue);
          }
          const ids = sorted
            .filter(
              (player) =>
                player.gender === gender &&
                (mode === "LIVE" || player.field === field),
            )
            .map((player) => player.id);
          this.reconcile(queue, ids);
        });
      });
    }
    for (const key of this.queues.keys())
      if (!activeKeys.has(key)) this.queues.delete(key);
  }

  private reconcile(queue: QueueState, ids: string[]): void {
    const capacity = PLAYER_LAYOUT[queue.mode].capacity;
    const allowed = new Set(ids);
    const previous = new Set(queue.roster);
    const newcomers = ids.filter((id) => !previous.has(id));
    queue.roster = ids;
    if (!queue.initialized) {
      queue.initialized = true;
      queue.visible = ids.slice(0, capacity);
      return;
    }
    if (
      queue.move &&
      [...queue.move.from, ...queue.move.next].some((id) => !allowed.has(id))
    ) {
      queue.visible =
        queue.move.elapsed < queue.moveMs * 0.22
          ? queue.move.from
          : queue.move.next;
      queue.move = null;
      queue.elapsed = 0;
    }
    queue.visible = queue.visible.filter((id) => allowed.has(id));
    const reserved = new Set(queue.move?.next ?? queue.visible);
    queue.pending = [...new Set([...queue.pending, ...newcomers])].filter(
      (id) => allowed.has(id) && !reserved.has(id),
    );
    if (!queue.move && queue.visible.length < capacity) {
      const fill = [...queue.pending, ...ids].filter(
        (id) => !queue.visible.includes(id),
      );
      queue.visible = [...new Set([...queue.visible, ...fill])].slice(
        0,
        capacity,
      );
      queue.pending = queue.pending.filter((id) => !queue.visible.includes(id));
    }
    if (newcomers.some((id) => queue.pending.includes(id))) queue.urgent = true;
    if (ids.length <= capacity) {
      queue.move = null;
      queue.visible = [...new Set([...queue.visible, ...ids])].slice(
        0,
        capacity,
      );
      queue.pending = [];
      queue.elapsed = 0;
      queue.urgent = false;
    }
  }

  private start(queue: QueueState): boolean {
    const capacity = PLAYER_LAYOUT[queue.mode].capacity;
    if (queue.roster.length <= capacity) return false;
    const visible = new Set(queue.visible);
    let incoming = queue.pending.find((id) => !visible.has(id));
    if (!incoming) {
      const last = queue.roster.indexOf(queue.visible.at(-1) ?? "");
      for (let step = 1; step <= queue.roster.length; step++) {
        const candidate = queue.roster[(last + step) % queue.roster.length];
        if (!visible.has(candidate)) {
          incoming = candidate;
          break;
        }
      }
    }
    if (!incoming) return false;
    queue.pending = queue.pending.filter((id) => id !== incoming);
    queue.move = {
      from: [...queue.visible],
      next: [...queue.visible.slice(1), incoming],
      elapsed: 0,
    };
    queue.urgent = false;
    queue.elapsed = 0;
    return true;
  }

  private tick(queue: QueueState, delta: number, reduced: boolean): void {
    if (queue.roster.length <= PLAYER_LAYOUT[queue.mode].capacity) return;
    if (reduced) {
      if (queue.move) {
        queue.visible = queue.move.next;
        queue.move = null;
        queue.elapsed = 0;
      }
      queue.elapsed += delta;
      if (
        (queue.urgent || queue.elapsed >= queue.holdMs + queue.moveMs) &&
        this.start(queue)
      ) {
        queue.visible = queue.move!.next;
        queue.move = null;
        queue.elapsed = 0;
      }
      return;
    }
    let remaining = delta;
    // Large scheduler deltas remain bounded; hidden-tab policy belongs to WorldStage.
    for (let step = 0; step < 64; step++) {
      if (queue.move) {
        const consumed = Math.min(remaining, queue.moveMs - queue.move.elapsed);
        queue.move.elapsed += consumed;
        remaining -= consumed;
        if (queue.move.elapsed < queue.moveMs) break;
        queue.visible = queue.move.next;
        queue.move = null;
        queue.elapsed = 0;
      } else {
        const consumed = queue.urgent
          ? 0
          : Math.min(remaining, queue.holdMs - queue.elapsed);
        queue.elapsed += consumed;
        remaining -= consumed;
        if (!queue.urgent && queue.elapsed < queue.holdMs) break;
        if (!this.start(queue)) break;
      }
      if (remaining <= 0) break;
    }
  }

  private placements(queue: QueueState): PlayerPlacement[] {
    const move = queue.move;
    const firstPhase = !!move && move.elapsed < queue.moveMs * 0.22;
    const ids = move ? (firstPhase ? move.from : move.next) : queue.visible;
    const progress = move
      ? Math.max(0, (move.elapsed / queue.moveMs - 0.22) / 0.78)
      : 0;
    const eased = ease(Math.min(1, progress));
    return ids.flatMap((id, slot) => {
      const player = this.players.get(id);
      if (!player) return [];
      const isOutgoing = firstPhase && slot === 0;
      const isIncoming = !!move && !firstPhase && slot === ids.length - 1;
      return [
        placementForSlot({
          player,
          mode: queue.mode,
          queueKey: queue.key,
          fieldIndex: queue.fieldIndex,
          slot,
          offsetY:
            move && !firstPhase
              ? (isIncoming ? 16 : PLAYER_LAYOUT[queue.mode].rowGap) *
                (1 - eased)
              : 0,
          opacity: isOutgoing
            ? 1 - move!.elapsed / (queue.moveMs * 0.22)
            : isIncoming
              ? Math.max(0, Math.min(1, (progress - 0.78) / 0.22))
              : 1,
          phase: isOutgoing
            ? "exit"
            : isIncoming
              ? "enter"
              : move && !firstPhase
                ? "move"
                : "hold",
        }),
      ];
    });
  }

  advance(
    deltaMs: number,
    mode: WorldMode,
    paused = false,
    reduced = false,
  ): PlayerPlacement[] {
    if (mode === "MEET") return [];
    const delta = Number.isFinite(deltaMs)
      ? Math.max(0, Math.min(60000, deltaMs))
      : 0;
    const result: PlayerPlacement[] = [];
    for (const queue of this.queues.values()) {
      if (queue.mode !== mode) continue;
      if (!paused) this.tick(queue, delta, reduced);
      result.push(...this.placements(queue));
    }
    return result;
  }
}
