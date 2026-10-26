import { QUESTIONS } from "@/data/questions";
import {
  stableSeed,
  type FieldNode,
  type FieldQuestion,
} from "./relationship/layout";
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
  field?: {
    questionKey: string;
    optionKey: string;
    optionLabel: string;
    kind: "join" | "move" | "answer";
    amount?: number;
    label?: string;
    image?: string;
  };
  /** MATCH is an aggregate cue, never an identifiable pair. */
  aggregate?: true;
};
export interface ScreenSnapshot {
  projection: ReturnType<typeof screenProjection>;
  nodes: DisplayNode[];
  question: FieldQuestion;
  members: FieldNode[];
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
        : [...input.name.trim()].slice(0, 8).join(""),
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
  private questionKey = "";
  read(
    s: DemoState,
    question: {
      id: string;
      title: string;
      options: readonly string[];
    } = QUESTIONS[0],
  ): ScreenSnapshot {
    const questionKey = `${question.id}:${question.options.join("|")}`;
    if (this.previous === s && this.cached && questionKey === this.questionKey)
      return this.cached;
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
    const counts =
      question.id === "q1"
        ? projection.options
        : question.options.map((label) => ({
            label,
            count: s.participants.filter(
              (p) => p.answers[question.id] === label,
            ).length,
            percentage: 0,
          }));
    const total =
      question.id === "q1"
        ? projection.total
        : counts.reduce((n, o) => n + o.count, 0);
    const fields: FieldQuestion = {
      id: question.id,
      title: question.title,
      total,
      options: question.options.map((label, index) => ({
        key: `${question.id}:${index}`,
        label,
        count: counts.find((o) => o.label === label)?.count ?? 0,
        percentage: total
          ? Math.round(
              ((counts.find((o) => o.label === label)?.count ?? 0) / total) *
                100,
            )
          : 0,
      })),
    };
    const answerOf = (
      p: DemoState["participants"][number],
      state: DemoState,
    ) =>
      question.id === "q1" ? state.responses[p.id] : p.answers[question.id];
    const optionOf = (answer?: string) =>
      fields.options.find((o) => o.label === answer);
    const nodes = s.participants
      .filter((p) => p.present)
      .map((p) => {
        const node = displayNode(token(p.id), {
          mode: "PUBLIC",
          name: p.name,
          displayGranted: p.profileComplete && !!p.name.trim(),
        });
        const avatar = validAvatar(p.avatarId, p.gender)
          ? getAvatarById(p.avatarId)
          : undefined;
        return {
          ...node,
          image: avatar?.src,
        };
      });
    const members: FieldNode[] = s.participants
      .filter((p) => p.present && p.profileComplete)
      .flatMap((p) => {
        const option = optionOf(answerOf(p, s));
        const node = nodes.find((n) => n.key === token(p.id));
        return option && node?.image
          ? [{ ...node, optionKey: option.key, seed: stableSeed(p.id) }]
          : [];
      });
    const events: ScreenEvent[] = [];
    const emit = (event: Omit<ScreenEvent, "id" | "timestamp">) =>
      events.push({
        ...event,
        id: `visual-${++this.eventSequence}`,
        timestamp: Date.now(),
      });
    if (old && questionKey === this.questionKey) {
      const before = new Map(old.participants.map((p) => [p.id, p]));
      for (const p of s.participants.filter((p) => p.present)) {
        const previous = before.get(p.id);
        const node = nodes.find((n) => n.key === token(p.id));
        const option = optionOf(answerOf(p, s));
        const prior = previous ? optionOf(answerOf(previous, old)) : undefined;
        const born =
          p.profileComplete &&
          (!previous?.present || !previous.profileComplete);
        const changed = option && option.key !== prior?.key;
        const field =
          option && node?.image && p.profileComplete && (born || changed)
            ? {
                questionKey: question.id,
                optionKey: option.key,
                optionLabel: option.label,
                kind: (prior && !born ? "move" : "join") as "move" | "join",
                label: node.displayMode === "PUBLIC" ? node.label : undefined,
                image: node.image,
              }
            : undefined;
        if (born) emit({ type: "JOIN", node: token(p.id), field });
        if (
          !born &&
          previous &&
          Object.entries(p.answers).some(([q, a]) => previous.answers[q] !== a)
        )
          emit({ type: "ACTIVE", node: token(p.id), field });
      }
      const oldProjection = screenProjection(old);
      projection.options.forEach((option, index) => {
        if (option.count > oldProjection.options[index].count) {
          const covered = events.filter(
            (e) => e.field?.optionKey === fields.options[index]?.key,
          ).length;
          const amount =
            option.count - oldProjection.options[index].count - covered;
          emit({
            type: "ANSWER",
            option: index,
            field:
              question.id === "q1" && amount > 0
                ? {
                    questionKey: question.id,
                    optionKey: fields.options[index].key,
                    optionLabel: option.label,
                    kind: "answer",
                    amount,
                  }
                : undefined,
          });
        }
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
    this.questionKey = questionKey;
    this.cached = {
      projection,
      nodes,
      question: fields,
      members,
      events: events.slice(-32),
    };
    return this.cached;
  }
}
