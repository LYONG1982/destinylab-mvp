import type { DemoState, Invitation, MeetPoint } from "./types";

const ACTIVE = new Set(["SENT", "ACCEPTED", "MEET_ASSIGNED", "ARRIVING"]);
export const CODE_PAIRS = Array.from({ length: 160 }, (_, n) => [100 + n, 420 - n] as const);
export const pointOccupants = (point: MeetPoint): string[] =>
  [...new Set([...(point.occupants || []), ...(point.occupant ? [point.occupant] : [])])];
export const pointCapacity = (point: MeetPoint): number =>
  Number.isInteger(point.capacity) && point.capacity! >= 1 && point.capacity! <= 160 ? point.capacity! : 1;
export const isPointDeleted = (point: MeetPoint): boolean => point.deletedAt !== undefined;
export function setPointOccupants(point: MeetPoint, occupants: string[]) {
  point.occupants = [...new Set(occupants)];
  point.occupant = point.occupants[0] || null;
}
export const is520Encounter = (invitation: Invitation) => invitation.codeVersion === "520";
export const ownEncounterCode = (invitation: Invitation, actor: string): string =>
  is520Encounter(invitation) ? invitation.encounterCodes?.[actor] || "" : invitation.code;

function unusedCodes(state: DemoState) {
  const held = new Set(state.points.flatMap(pointOccupants));
  const codes = new Set<string>(state.points.flatMap(p => p.retainedCodes || []));
  for (const i of state.invitations) {
    if (!ACTIVE.has(i.status) && !held.has(i.id) && !state.participants.some(p => p.currentId === i.id)) continue;
    Object.values(i.encounterCodes || {}).forEach(code => codes.add(code));
  }
  return CODE_PAIRS.filter(([a, b]) => !codes.has(String(a)) && !codes.has(String(b)));
}
const hasCodes = (i: Invitation) => !is520Encounter(i) || !!(i.encounterCodes?.[i.from] && i.encounterCodes?.[i.to]);
export function hasEncounterWork(state: DemoState) {
  if (state.fieldOpen === false) return false;
  const vacant = state.points.some(p => !isPointDeleted(p) && !p.closed && pointOccupants(p).length < pointCapacity(p));
  const freeCodes = unusedCodes(state).length > 0;
  return state.invitations.some(i => i.status === "ACCEPTED" && [i.from, i.to].every(id => state.participants.some(p => p.id === id && p.present && !p.paused)) &&
    (hasCodes(i) ? vacant : freeCodes));
}
/** Caller holds the activity transaction lock. No timer or event is added when no work exists. */
export function reconcileEncounters(state: DemoState, at: number): boolean {
  if (state.fieldOpen === false) return false;
  let changed = false;
  for (const invitation of state.invitations.filter(i => i.status === "ACCEPTED")) {
    const people = [invitation.from, invitation.to].map(id => state.participants.find(p => p.id === id));
    if (people.some(p => !p?.present || p.paused)) continue;
    if (!hasCodes(invitation)) {
      const choices = unusedCodes(state);
      if (!choices.length) continue;
      const seed = [...invitation.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
      const [a, b] = choices[seed % choices.length];
      const male = people.find(p => p?.gender === "male");
      const female = people.find(p => p?.gender === "female");
      if (!male || !female) continue;
      invitation.encounterCodes = { [male.id]: String(a), [female.id]: String(b) };
      state.events.push({ id: `codes-${invitation.id}`, at, type: "ENCOUNTER_CODES", text: "双方确认认识，系统生成本次相遇码", invitationId: invitation.id });
      changed = true;
    }
    const point = state.points.filter(p => !isPointDeleted(p) && !p.closed && pointOccupants(p).length < pointCapacity(p))
      .sort((a, b) => pointOccupants(a).length / pointCapacity(a) - pointOccupants(b).length / pointCapacity(b))[0];
    if (!point) continue;
    setPointOccupants(point, [...pointOccupants(point), invitation.id]);
    invitation.pointId = point.id;
    invitation.status = "MEET_ASSIGNED";
    state.events.push({ id: `assigned-${invitation.id}`, at, type: "ASSIGNED", text: `系统分配了 ${point.name}`, invitationId: invitation.id });
    changed = true;
  }
  return changed;
}
