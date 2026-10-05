import { getAvatarById, validAvatar } from "@/config/avatars";
import type { DemoState } from "@/domain/types";
import { screenProjection } from "@/domain/selectors";

export type DisplayMode = "PUBLIC" | "LIGHT" | "ANONYMOUS";
export type MotionState =
  | "hidden"
  | "entering"
  | "idle"
  | "active"
  | "connecting"
  | "matched"
  | "leaving";
export interface DisplayNode {
  key: string;
  label: string;
  displayMode: DisplayMode;
  image?: string;
}
export type ScreenEvent = {
  id: string;
  type: "JOIN" | "ANSWER" | "ACTIVE" | "MATCH";
  timestamp: number;
  node?: string;
  option?: number;
  phase?: "mutual" | "confirmed";
  /** MATCH is an aggregate cue, never an identifiable pair. */
  aggregate?: true;
};
export interface ScreenSnapshot {
  projection: ReturnType<typeof screenProjection>;
  nodes: DisplayNode[];
  events: ScreenEvent[];
}

/** Only an explicit trusted display grant can expose a public/light identity. */
export function displayNode(
  key: string,
  input?: {
    mode: DisplayMode;
    name: string;
    image?: string;
    displayGranted: boolean;
  },
): DisplayNode {
  const anonymous: DisplayNode = {
    key,
    label: `探索者 ${key.slice(1).padStart(3, "0")}`,
    displayMode: "ANONYMOUS",
  };
  if (!input?.displayGranted || input.mode === "ANONYMOUS") return anonymous;
  return {
    key,
    displayMode: input.mode,
    label:
      input.mode === "LIGHT"
        ? `${[...input.name][0] || "访"}*`
        : input.name.slice(0, 6),
    image: input.image,
  };
}

/** Session-only mapping. Raw identity and pair ids never leave this adapter. */
export class ScreenAdapter {
  private ids = new Map<string, string>();
  private sequence = 0;
  private eventSequence = 0;
  private previous: DemoState | null = null;
  private cached: ScreenSnapshot | null = null;
  read(s: DemoState): ScreenSnapshot {
    if (this.previous === s && this.cached) return this.cached;
    const old = this.previous?.epoch === s.epoch ? this.previous : null;
    if (!old) {
      this.ids.clear();
      this.sequence = 0;
    }
    const roster = new Set(s.participants.map((p) => p.id));
    for (const id of this.ids.keys()) if (!roster.has(id)) this.ids.delete(id);
    const token = (id: string) => {
      if (!this.ids.has(id)) this.ids.set(id, `n${++this.sequence}`);
      return this.ids.get(id)!;
    };
    const projection = screenProjection(s);
    const nodes = s.participants
      .filter((p) => p.present)
      .map((p) => {
        const node = displayNode(token(p.id));
        const avatar = validAvatar(p.avatarId, p.gender)
          ? getAvatarById(p.avatarId)
          : undefined;
        return {
          ...node,
          displayMode: avatar ? ("LIGHT" as const) : ("ANONYMOUS" as const),
          image: avatar?.src,
        };
      });
    const events: ScreenEvent[] = [];
    const emit = (event: Omit<ScreenEvent, "id" | "timestamp">) =>
      events.push({
        ...event,
        id: `visual-${++this.eventSequence}`,
        timestamp: Date.now(),
      });
    if (old) {
      const before = new Map(old.participants.map((p) => [p.id, p]));
      for (const p of s.participants.filter((p) => p.present)) {
        const previous = before.get(p.id);
        if (
          p.profileComplete &&
          (!previous?.present || !previous.profileComplete)
        )
          emit({ type: "JOIN", node: token(p.id) });
        if (
          previous &&
          Object.entries(p.answers).some(([q, a]) => previous.answers[q] !== a)
        )
          emit({ type: "ACTIVE", node: token(p.id) });
      }
      const oldProjection = screenProjection(old);
      projection.options.forEach((option, index) => {
        if (option.count > oldProjection.options[index].count)
          emit({ type: "ANSWER", option: index });
      });
      if (projection.real > oldProjection.real)
        emit({ type: "MATCH", phase: "confirmed", aggregate: true });
      // The existing business command is the authority for the >=3 pair gate.
      if (
        s.broadcastConsumed.filter((id) => !old.broadcastConsumed.includes(id))
          .length >= 3
      )
        emit({ type: "MATCH", phase: "mutual", aggregate: true });
    }
    this.previous = s;
    this.cached = { projection, nodes, events: events.slice(-32) };
    return this.cached;
  }
}
