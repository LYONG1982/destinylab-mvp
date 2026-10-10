import { projectMeetPairs, type PairDisplayConsent } from "./pair-adapter";
import { getAvatarById, validAvatar } from "@/config/avatars";
import { QUESTIONS } from "@/data/questions";
import {
  available,
  complete,
  nowOf,
  screenProjection,
} from "@/domain/selectors";
import type { DemoState, Participant } from "@/domain/types";
import type { WorldData, WorldEvent, WorldPlayer } from "./types";

/** Hamilton allocation; stable option order resolves equal remainders. */
export function allocatePercentages(counts: readonly number[]): number[] {
  const safe = counts.map((n) => (Number.isFinite(n) ? Math.max(0, n) : 0));
  const total = safe.reduce((sum, n) => sum + n, 0);
  if (!total) return safe.map(() => 0);
  const exact = safe.map((n) => (n * 100) / total);
  const result = exact.map(Math.floor);
  const order = exact
    .map((n, index) => ({ index, remainder: n - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const missing = 100 - result.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < missing; i++) result[order[i].index]++;
  return result;
}
export function visualSeed(value: string): number {
  let seed = 2166136261;
  for (const char of value)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}
const optionId = (label: string | undefined, questionId = "q1") => {
  const question = QUESTIONS.find((q) => q.id === questionId) || QUESTIONS[0];
  const index = (question.options as readonly string[]).indexOf(
    label ?? "",
  );
  return index < 0 ? null : `${question.id}:${index}`;
};
const visible = (p: Participant) =>
  p.present &&
  p.profileComplete &&
  !!p.name.trim() &&
  validAvatar(p.avatarId, p.gender);

/** Read-only projection. First snapshot and epoch changes never replay old events. */
export class WorldAdapter {
  constructor(private readonly pairConsent?: PairDisplayConsent,
    private readonly stableToken?: (id: string) => string) {}
  private consentRevision: number | string | undefined;
  private previous: DemoState | null = null;
  private cached: WorldData | null = null;
  private visualIds = new Map<string, string>();
  private idSequence = 0;
  private eventSequence = 0;
  private token(id: string) {
    if (this.stableToken) {
      const token = this.stableToken(id);
      this.visualIds.set(id, token);
      return token;
    }
    if (!this.visualIds.has(id))
      this.visualIds.set(id, `player-${++this.idSequence}`);
    return this.visualIds.get(id)!;
  }
  read(state: DemoState): WorldData {
    if (
      state === this.previous &&
      this.cached &&
      this.consentRevision === this.pairConsent?.revision
    )
      return this.cached;
    this.consentRevision = this.pairConsent?.revision;
    const old = this.previous?.epoch === state.epoch &&
      this.previous.displayQuestionId === state.displayQuestionId ? this.previous : null;
    const question = QUESTIONS.find((q) => q.id === state.displayQuestionId) || QUESTIONS[0];
    const responses = question.id === "q1" ? state.responses : Object.fromEntries(
      state.participants.filter((p) => p.answers[question.id]).map((p) => [p.id, p.answers[question.id]]),
    );
    const oldResponses = !old ? {} : question.id === "q1" ? old.responses : Object.fromEntries(
      old.participants.filter((p) => p.answers[question.id]).map((p) => [p.id, p.answers[question.id]]),
    );
    if (!old) {
      this.visualIds.clear();
      this.idSequence = 0;
      this.eventSequence = 0;
    }
    const roster = new Set(state.participants.map((p) => p.id));
    const projection = screenProjection(state);
    const percent = allocatePercentages(projection.options.map((o) => o.count));
    const events: WorldEvent[] = [];
    const emit = (
      event: Omit<WorldEvent, "id" | "timestamp">,
      timestamp = Date.now(),
    ) => {
      events.push({
        ...event,
        id: `world-event-${++this.eventSequence}`,
        timestamp,
      });
    };
    const before = new Map(old?.participants.map((p) => [p.id, p]) ?? []);
    const participants: WorldPlayer[] = state.participants
      .filter(visible)
      .map((p) => {
        const id = this.token(p.id);
        const ready = available(state, p);
        return {
          id,
          nickname: [...p.name.trim()].slice(0, 5).join(""),
          avatar: getAvatarById(p.avatarId)!.src,
          gender: p.gender,
          joinedAt: p.joinedAt,
          field: optionId(responses[p.id], question.id),
          status: p.paused
            ? "paused"
            : !complete(p)
              ? "answering"
              : ready
                ? "available"
                : "exploring",
          isAvailable: ready,
          activity: 0,
          seed: visualSeed(id),
        };
      });
    const players = new Map(participants.map((p) => [p.id, p]));
    if (old) {
      const current = new Map(state.participants.map((p) => [p.id, p]));
      const identity = (p: Participant | undefined) => {
        const playerId = p ? this.visualIds.get(p.id) : undefined;
        return {
          ...(playerId ? { playerId } : {}),
          ...(p?.profileComplete && validAvatar(p.avatarId, p.gender)
            ? { gender: p.gender }
            : {}),
        };
      };
      // Presence and public-avatar eligibility are different transitions.
      for (const id of new Set([...before.keys(), ...current.keys()])) {
        const p = current.get(id);
        const prior = before.get(id);
        if (!!p?.present !== !!prior?.present)
          emit({
            type: "presence_changed",
            ...identity(p?.present ? p : prior),
            presentDelta: p?.present ? 1 : -1,
          });
      }
      for (const p of state.participants.filter((p) => p.present)) {
        const prior = before.get(p.id);
        const player = visible(p) ? players.get(this.token(p.id)) : undefined;
        const field = optionId(responses[p.id], question.id);
        const joined = !!player && (!prior || !visible(prior));
        if (joined)
          emit({
            type: "join",
            playerId: player.id,
            gender: player.gender,
            ...(field ? { field } : {}),
          });
        const answeredOther = Object.entries(p.answers).some(
          ([question, answer]) =>
            question !== (state.displayQuestionId || "q1") && prior?.answers[question] !== answer,
        );
        if (answeredOther && !joined)
          emit({
            type: "answer",
            ...(player ? { playerId: player.id, gender: player.gender } : {}),
            ...(field ? { field } : {}),
            completed: complete(p),
          });
        if (
          player &&
          prior &&
          !joined &&
          available(old, prior) !== player.isAvailable
        )
          emit({
            type: "availability_changed",
            playerId: player.id,
            gender: player.gender,
            isAvailable: player.isAvailable,
          });
      }
      // A first answer counts once, even when a profile is completed later.
      // Anonymous history has statistics but never receives an invented Player.
      const anonymous = new Map<string, Omit<WorldEvent, "id" | "timestamp">>();
      for (const [id, answer] of Object.entries(responses)) {
        const field = optionId(answer, question.id);
        if (!field || oldResponses[id] === answer) continue;
        const previousField = optionId(oldResponses[id], question.id);
        const first = !Object.hasOwn(oldResponses, id);
        const p = current.get(id);
        const player =
          p && visible(p) ? players.get(this.token(id)) : undefined;
        const detail: Omit<WorldEvent, "id" | "timestamp"> = {
          type: first ? "choice_selected" : "field_changed",
          field,
          ...(previousField ? { previousField } : {}),
          countDelta: first ? 1 : 0,
          aggregateCount: 1,
          ...(player ? { playerId: player.id, gender: player.gender } : {}),
        };
        if (p) emit(detail);
        else {
          const key = `${detail.type}:${previousField ?? "none"}:${field}`;
          const prior = anonymous.get(key);
          if (prior) {
            prior.aggregateCount = (prior.aggregateCount ?? 0) + 1;
            prior.countDelta = (prior.countDelta ?? 0) + (first ? 1 : 0);
          } else anonymous.set(key, detail);
        }
      }
      for (const detail of anonymous.values()) emit(detail);
      const invites = new Map(old.invitations.map((i) => [i.id, i]));
      for (const invitation of state.invitations) {
        const prior = invites.get(invitation.id);
        // Convert the demo clock to wall time so returning tabs can discard stale cues.
        const timestamp = (at: number) =>
          Date.now() - Math.max(0, nowOf(state) - at);
        if (invitation.acceptedAt && !prior?.acceptedAt)
          emit(
            { type: "mutual_confirmed", aggregateCount: 1 },
            timestamp(invitation.acceptedAt),
          );
        if (invitation.realMeetAt && !prior?.realMeetAt)
          emit(
            { type: "meeting_confirmed", aggregateCount: 1 },
            timestamp(invitation.realMeetAt),
          );
      }
    }
    for (const id of this.visualIds.keys())
      if (
        !roster.has(id) &&
        !state.invitations.some((i) => `invitation:${i.id}` === id)
      )
        this.visualIds.delete(id);
    const active = new Set(
      events.flatMap((e) => (e.playerId ? [e.playerId] : [])),
    );
    for (const player of participants)
      if (active.has(player.id)) player.activity = 1;
    this.previous = state;
    this.cached = {
      epoch: state.epoch,
      revision: state.revision,
      source: "business",
      totalParticipants: projection.total,
      currentParticipants: projection.active,
      availableParticipants: projection.canMeet,
      totalMeetings: projection.real,
      question: {
        id: question.id,
        title: question.title,
        options: projection.options.map((o, index) => ({
          id: `${question.id}:${index}`,
          label: o.label,
          count: o.count,
          percent: percent[index],
        })),
      },
      participants,
      events: events.slice(-64),
      meetScene: {
        connection: "live",
        permissionVerified: true,
        statisticsKnown: Number.isFinite(projection.real),
        snapshotAt: Date.now(),
        qualifiedPairs: projectMeetPairs(
          state,
          old,
          (id) => this.token(id),
          this.pairConsent,
        ),
      },
    };
    return this.cached;
  }
}
