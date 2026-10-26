import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { QUESTIONS } from "@/data/questions";
import { defaultMeetPoints } from "@/domain/meet-points";
import type { DemoState, Participant } from "@/domain/types";
import {
  commonAnswers,
  complete,
  distribution,
  recommendations,
  stats,
} from "@/domain/selectors";
import {
  WorldAdapter,
  allocatePercentages,
} from "@/features/screen/world/adapter";
import type { WorldEvent } from "@/features/screen/world/types";
import { liveConfig } from "./config";

export function emptyActivity(): DemoState {
  const now = Date.now();
  return {
    schema: 1,
    epoch: randomUUID(),
    revision: 0,
    now,
    wallAt: now,
    scenario: "live",
    activityPaused: false,
    participants: [],
    invitations: [],
    points: defaultMeetPoints(),
    helps: [],
    merchants: [],
    events: [],
    scans: [],
    responses: {},
    merchantViews: [],
    commands: [],
    broadcastConsumed: [],
    tongzhouSubmissions: [],
    displayQuestionId: "q1",
    displayGrants: {},
  };
}
export function newParticipant(): Participant {
  return {
    id: randomUUID(),
    name: "",
    gender: "male",
    age: "",
    avatarId: null,
    ready: false,
    present: true,
    paused: false,
    profileComplete: false,
    answers: {},
    currentId: null,
    joinedAt: Date.now(),
  };
}
export function questionSummaries(state: DemoState) {
  return QUESTIONS.map((question) => {
    const raw = distribution(state, question.id);
    const percentages = allocatePercentages(raw.map((o) => o.count));
    return {
      id: question.id,
      title: question.title,
      total: raw.reduce((n, o) => n + o.count, 0),
      options: raw.map((o, i) => ({ ...o, percentage: percentages[i] })),
    };
  });
}
export function mobileProjection(
  state: DemoState,
  actor: string,
  activity: string,
): DemoState {
  const me = state.participants.find((p) => p.id === actor);
  if (!me) throw new Error("PARTICIPANT_MISSING");
  const candidates = recommendations(state, actor);
  const invitation = state.invitations.find((i) => i.id === me.currentId);
  const allowed = new Set([
    actor,
    ...candidates.map((p) => p.participant.id),
    ...(invitation ? [invitation.from, invitation.to] : []),
  ]);
  const participants = state.participants
    .filter((p) => allowed.has(p.id))
    .map((p) => {
      if (p.id === actor) return { ...structuredClone(p), photo: null };
      return {
        ...p,
        photo: null,
        joinedAt: 0,
        answerComplete: complete(p),
        currentId:
          invitation && [invitation.from, invitation.to].includes(p.id)
            ? invitation.id
            : null,
        answers: Object.fromEntries(
          commonAnswers(me, p).map((a) => [a.questionId, a.answer]),
        ),
      };
    });
  const ownInvitation = invitation ? structuredClone(invitation) : null;
  if (ownInvitation)
    ownInvitation.choices = ownInvitation.choices[actor]
      ? { [actor]: ownInvitation.choices[actor] }
      : {};
  return {
    ...state,
    participants,
    invitations: ownInvitation ? [ownInvitation] : [],
    points: state.points.map((p) => ({
      ...p,
      occupant: p.occupant === invitation?.id ? p.occupant : null,
    })),
    helps: state.helps.filter((h) => h.participantId === actor),
    events: state.events
      .filter((e) => e.type === "HINT" && e.participantId === actor)
      .slice(-1),
    responses: {},
    scans: [],
    merchantViews: [],
    commands: [],
    broadcastConsumed: [],
    tongzhouSubmissions: [],
    displayGrants: invitation
      ? {
          [invitation.id]: {
            [actor]: !!state.displayGrants?.[invitation.id]?.[actor],
          },
        }
      : {},
    live: {
      activity,
      role: "participant",
      metrics: stats(state),
      // Only the current public question is available to participants; full per-question analytics are operator-only.
      questions: questionSummaries(state).filter(
        (q) => q.id === (state.displayQuestionId || "q1"),
      ),
      displayPermissions: state.invitations
        .filter(
          (i) =>
            i.id !== me.currentId &&
            [i.from, i.to].includes(actor) &&
            state.displayGrants?.[i.id]?.[actor] === true,
        )
        .map((i) => ({
          invitationId: i.id,
          otherName:
            state.participants.find(
              (p) => p.id === (i.from === actor ? i.to : i.from),
            )?.name || "对方",
        })),
      recommendationIds: candidates.map((p) => p.participant.id),
    },
  };
}
export function operatorProjection(
  state: DemoState,
  activity: string,
): DemoState {
  return {
    ...state,
    participants: state.participants.map((p) => ({ ...p, photo: null })),
    commands: [],
    broadcastConsumed: [],
    tongzhouSubmissions: [],
    live: {
      activity,
      role: "operator",
      metrics: stats(state),
      questions: questionSummaries(state),
      recommendationIds: [],
    },
  };
}
export function worldProjection(
  state: DemoState,
  activity: string,
  previous?: DemoState,
) {
  const config = liveConfig();
  {
    // Historical photos remain in storage but never enter live projections.
    state = {
      ...state,
      participants: state.participants.map((p) => ({ ...p, photo: null })),
    };
    if (previous)
      previous = {
        ...previous,
        participants: previous.participants.map((p) => ({ ...p, photo: null })),
      };
  }
  const consent = {
    revision: state.revision,
    allows: (invitationId: string, participantId: string) =>
      state.displayGrants?.[invitationId]?.[participantId] === true,
  };
  const adapter = new WorldAdapter(
    consent,
    (id) =>
      `public-${createHmac("sha256", config.secret)
        .update(`${activity}:${id}`)
        .digest("hex")
        .slice(0, 24)}`,
  );
  if (previous) adapter.read(previous);
  const result = adapter.read(state);
  result.events = result.events.map((e, index) => ({
    ...e,
    id: `${state.epoch}:${state.revision}:${index}`,
  }));
  result.joinUrl = `${config.origin}/mobile/01-start?activity=${encodeURIComponent(activity)}`;
  return result;
}
export function liveEvents(
  state: DemoState,
  before: DemoState,
  activity: string,
): WorldEvent[] {
  return worldProjection(state, activity, before).events;
}
