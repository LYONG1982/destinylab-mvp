import { hasPersonalEncounter } from "@/domain/selectors";
import type { Invitation } from "@/domain/types";

const VISITS_KEY = "destinylab:encounter-guide-visits:v1";
const MAX_VISITS = 200;
type VisitStorage = Pick<Storage, "getItem" | "setItem">;

function tabStorage(): VisitStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Presentation acknowledgement only; never a meeting or consent record. */
export function createEncounterGuideVisits() {
  const memory = new Set<string>();
  const trim = () => {
    while (memory.size > MAX_VISITS) memory.delete(memory.values().next().value!);
  };
  const restore = (storage?: VisitStorage) => {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(VISITS_KEY) || "[]");
      if (Array.isArray(saved))
        for (const key of saved.slice(-MAX_VISITS))
          if (typeof key === "string" && key.length <= 512) memory.add(key);
      trim();
    } catch {}
  };
  return {
    has(key: string, storage = tabStorage()) {
      restore(storage);
      return memory.has(key);
    },
    remember(key: string, storage = tabStorage()) {
      restore(storage);
      memory.delete(key);
      memory.add(key);
      trim();
      try {
        storage?.setItem(VISITS_KEY, JSON.stringify([...memory]));
      } catch {}
    },
  };
}

export const encounterGuideVisits = createEncounterGuideVisits();
export const encounterGuideVisitKey = (
  activity: string,
  epoch: string,
  actor: string,
  invitationId: string,
) => JSON.stringify([activity, epoch, actor, invitationId]);

export function automaticEncounterRoute({
  page,
  invitation,
  actor,
  present,
  paused,
  fieldOpen,
  seen,
}: {
  page: string;
  invitation?: Invitation;
  actor: string;
  present: boolean;
  paused: boolean;
  fieldOpen?: boolean;
  seen: boolean;
}): string {
  if (!present || paused || fieldOpen === false || !invitation ||
      ![invitation.from, invitation.to].includes(actor)) return "";
  if (hasPersonalEncounter(invitation, actor))
    return page === "07-invitation" ? "10-next-step" : "";
  if (!["ACCEPTED", "MEET_ASSIGNED", "ARRIVING"].includes(invitation.status))
    return "";
  if (page !== "07-invitation" &&
      (seen || !["05-discover", "06-common"].includes(page))) return "";
  return invitation.status === "ARRIVING" ? "09-meet" : "08-mutual";
}

export function mobileFlowUrl(page: string, activity?: string, targetId?: string) {
  const query = new URLSearchParams();
  if (activity) query.set("activity", activity);
  if (targetId) query.set("target", targetId);
  return `/mobile/${page}${query.size ? `?${query}` : ""}`;
}
