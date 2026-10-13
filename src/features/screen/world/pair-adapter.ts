import {avatarSource, allowedAvatarSource} from "@/domain/photo";
import {
  validAvatar,
} from "@/config/avatars";
import type { DemoState, Participant } from "@/domain/types";
import type { MeetPair, MeetParticipant } from "./types";

/** A separate, pair-specific display grant. No provider means no public pair.
 * The provider must change revision and notify its owner when a grant is withdrawn. */
export interface PairDisplayConsent {
  readonly revision: number | string;
  allows(invitationId: string, participantId: string): boolean;
}
export function displayablePair(pair: MeetPair): boolean {
  return (
    (pair.status === "meet_confirmed" || pair.status === "mutual_confirmed") &&
    !!pair.id &&
    pair.male?.allowPublicDisplay === true &&
    pair.female?.allowPublicDisplay === true &&
    pair.male.gender === "male" &&
    pair.female.gender === "female" &&
    pair.male.id !== pair.female.id &&
    !!pair.male.nickname?.trim() &&
    !!pair.female.nickname?.trim() &&
    allowedAvatarSource(pair.male.avatar) &&
    allowedAvatarSource(pair.female.avatar) &&
    Number.isFinite(pair.confirmedAt) &&
    pair.confirmedAt > 0
  );
}
export const pairKey = (p: MeetPair) =>
  [p.male.id, p.female.id].sort().join("|");
export function uniqueQualifiedPairs(pairs: readonly MeetPair[]): MeetPair[] {
  const records = new Map<string, MeetPair>();
  for (const p of pairs)
    if (displayablePair(p)) {
      const prev = records.get(p.id);
      if (
        !prev ||
        (p.status === "meet_confirmed" && prev.status !== "meet_confirmed") ||
        (p.status === prev.status && p.confirmedAt > prev.confirmedAt)
      )
        records.set(p.id, p);
    }
  const unique = new Map<string, MeetPair>();
  for (const p of records.values())
    if (displayablePair(p)) {
      const key = pairKey(p),
        previous = unique.get(key);
      if (
        !previous ||
        (p.status === "meet_confirmed" &&
          previous.status !== "meet_confirmed") ||
        (p.status === previous.status && p.confirmedAt > previous.confirmedAt)
      )
        unique.set(key, p);
    }
  return [...unique.values()].sort(
    (a, b) => a.confirmedAt - b.confirmedAt || a.id.localeCompare(b.id),
  );
}
export function projectMeetPairs(
  state: DemoState,
  previous: DemoState | null,
  token: (id: string) => string,
  consent?: PairDisplayConsent,
): MeetPair[] {
  if (!consent) return [];
  const people = new Map(state.participants.map((p) => [p.id, p]));
  const old = new Map(previous?.invitations.map((i) => [i.id, i]) ?? []);
  const eligible = (p: Participant | undefined): p is Participant =>
    !!p &&
    p.profileComplete &&
    !!p.name.trim() &&
    validAvatar(p.avatarId, p.gender);
  const ref = (p: Participant): MeetParticipant => ({
    id: token(p.id),
    nickname: [...p.name.trim()].slice(0, 5).join(""),
    avatar: avatarSource(p, true),
    gender: p.gender,
    joinedAt: p.joinedAt,
    field: null,
    status: "met",
    isAvailable: false,
    activity: 0,
    seed: 0,
    allowPublicDisplay: true,
  });
  const pairs: MeetPair[] = [];
  for (const i of state.invitations) {
    const met = Number.isFinite(i.realMeetAt) && !!i.realMeetAt;
    const mutual =
      Number.isFinite(i.acceptedAt) &&
      !!i.acceptedAt &&
      ["ACCEPTED", "MEET_ASSIGNED", "ARRIVING"].includes(i.status);
    if (!met && !mutual) continue;
    const a = people.get(i.from),
      b = people.get(i.to);
    if (!eligible(a) || !eligible(b) || a.gender === b.gender || a.id === b.id)
      continue;
    // Fail closed even if an external permission source fails.
    try {
      if (!consent.allows(i.id, a.id) || !consent.allows(i.id, b.id)) continue;
    } catch {
      continue;
    }
    const male = ref(a.gender === "male" ? a : b),
      female = ref(a.gender === "female" ? a : b);
    pairs.push({
      id: `pair-${token(`invitation:${i.id}`)}`,
      male,
      female,
      status: met ? "meet_confirmed" : "mutual_confirmed",
      confirmedAt: (met ? i.realMeetAt : i.acceptedAt)!,
      justConfirmed:
        !!previous &&
        !(met ? old.get(i.id)?.realMeetAt : old.get(i.id)?.acceptedAt),
    });
  }
  return uniqueQualifiedPairs(pairs);
}
