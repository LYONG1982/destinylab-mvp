import test from "node:test";
import assert from "node:assert/strict";
import type { Invitation } from "@/domain/types";
import {
  automaticEncounterRoute,
  createEncounterGuideVisits,
  encounterGuideVisitKey,
  mobileFlowUrl,
} from "@/features/mobile/encounter-navigation";

const invitation: Invitation = {
  id: "inv-current", from: "male", to: "female", status: "MEET_ASSIGNED",
  createdAt: 1, acceptedAt: 2, pointId: "meet-1", departures: {}, arrivals: {},
  confirmations: {}, common: [], choices: {}, pass: "A-001", code: "",
};
const input = {
  page: "07-invitation", invitation, actor: "male", present: true,
  paused: false, fieldOpen: true, seen: false,
};

test("both actors automatically leave invitation waiting after mutual consent, including resource waiting", () => {
  for (const actor of ["male", "female"])
    for (const status of ["ACCEPTED", "MEET_ASSIGNED", "ARRIVING"] as const)
      assert.equal(automaticEncounterRoute({ ...input, actor, invitation: { ...invitation, status } }),
        status === "ARRIVING" ? "09-meet" : "08-mutual");
  assert.equal(automaticEncounterRoute({ ...input, seen: true }), "08-mutual");
});

test("a new mutual task interrupts discovery once; acknowledging it preserves deliberate browsing", () => {
  for (const page of ["05-discover", "06-common"]) {
    assert.equal(automaticEncounterRoute({ ...input, page }), "08-mutual");
    assert.equal(automaticEncounterRoute({ ...input, page, seen: true }), "");
  }
  for (const page of ["01-start", "03-profile", "04-question", "08-mutual", "09-meet", "10-next-step"])
    assert.equal(automaticEncounterRoute({ ...input, page }), "");
});

test("ready alone, ended tasks, foreign identities, pauses and closed fields cannot trigger success navigation", () => {
  for (const status of ["SENT", "DECLINED", "CANCELLED", "EXPIRED", "MEET_FAILED"] as const)
    assert.equal(automaticEncounterRoute({ ...input, invitation: { ...invitation, status } }), "");
  for (const patch of [{ invitation: undefined }, { actor: "other" }, { present: false }, { paused: true }, { fieldOpen: false }])
    assert.equal(automaticEncounterRoute({ ...input, ...patch }), "");
});

test("a saved personal record restores its next step rather than reopening the guide", () => {
  const recorded = { ...invitation, confirmations: { male: 3 } };
  assert.equal(automaticEncounterRoute({ ...input, invitation: recorded }), "10-next-step");
  assert.equal(automaticEncounterRoute({ ...input, invitation: recorded, page: "05-discover" }), "");
  assert.equal(automaticEncounterRoute({ ...input, invitation: recorded, actor: "female" }), "08-mutual");
});

test("acknowledgements are scoped to activity, epoch, actor and invitation, and survive storage failures", () => {
  const visits = createEncounterGuideVisits();
  const blocked = { getItem(): string | null { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  const key = encounterGuideVisitKey("meet-a", "epoch-a", "male", "inv-a");
  visits.remember(key, blocked);
  assert.equal(visits.has(key, blocked), true);
  for (const parts of [
    ["meet-b", "epoch-a", "male", "inv-a"], ["meet-a", "epoch-b", "male", "inv-a"],
    ["meet-a", "epoch-a", "female", "inv-a"], ["meet-a", "epoch-a", "male", "inv-b"],
  ]) assert.equal(visits.has(encounterGuideVisitKey(...parts as [string, string, string, string]), blocked), false);
});

test("tab acknowledgements restore on reload, reject malformed data and stay bounded", () => {
  let saved = "not-json";
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
  const visits = createEncounterGuideVisits();
  assert.equal(visits.has("unknown", storage), false);
  visits.remember("current", storage);
  assert.equal(createEncounterGuideVisits().has("current", storage), true);
  for (let n = 0; n < 205; n++) visits.remember(`task-${n}`, storage);
  assert.equal(JSON.parse(saved).length, 200);
  assert.equal(visits.has("task-204", storage), true);
});

test("navigation keeps the activity and encodes target parameters", () => {
  assert.equal(mobileFlowUrl("08-mutual", "meet-uat"), "/mobile/08-mutual?activity=meet-uat");
  assert.equal(mobileFlowUrl("06-common", "meet-uat", "person&other"), "/mobile/06-common?activity=meet-uat&target=person%26other");
  assert.equal(mobileFlowUrl("05-discover"), "/mobile/05-discover");
});
