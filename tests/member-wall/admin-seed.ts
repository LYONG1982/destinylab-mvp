import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { database } from "../../src/server/db";
import { emptyActivity, newParticipant } from "../../src/server/state";
import { wallConsent } from "../../src/server/member-wall-service";
import { digest } from "../../src/server/service";
import {
  WALL_CONSENT_VERSION,
  DEFAULT_WALL_CONFIG,
} from "../../src/domain/member-wall";
import { QUESTIONS } from "../../src/data/questions";
async function main() {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("_test") ||
    !process.env.WALL_UX_EVIDENCE
  )
    throw Error("Protected local _test database required");
  const db = database(),
    activity = "wallux-" + randomUUID().slice(0, 8),
    empty = activity + "-empty",
    legacy = activity + "-demo";
  try {
    const s = emptyActivity();
    s.fieldOpen = true;
    s.participants = Array.from({ length: 8 }, (_, i) => ({
      ...newParticipant(),
      name: `测试参与者${i}`,
      gender: i < 6 ? ("male" as const) : ("female" as const),
      profileComplete: true,
      paused: false,
      avatarId: i < 6 ? "male_01" : "female_01",
      age: "26–29",
      answers: Object.fromEntries(
        QUESTIONS.map((q, n) => [q.id, q.options[(n + i) % q.options.length]]),
      ),
    }));
    for (const [id, state] of [
      [activity, s],
      [empty, emptyActivity()],
      [legacy, emptyActivity()],
    ] as const)
      await db.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
        id,
        JSON.stringify(state),
      ]);
    for (let i = 0; i < 7; i++)
      await wallConsent(
        activity,
        { role: "participant", actor: s.participants[i].id },
        {
          allow: true,
          nickname: `清禾${i}`,
          expectedVersion: 0,
          consentVersion: WALL_CONSENT_VERSION,
        },
      );
    const current = (
      await db.query("SELECT state FROM dl_activities WHERE id=$1", [activity])
    ).rows[0].state;
    current.participants[4].paused = true;
    current.participants[5].profileComplete = false;
    current.participants[6].present = false;
    await db.query("UPDATE dl_activities SET state=$2 WHERE id=$1", [
      activity,
      JSON.stringify(current),
    ]);
    await db.query(
      "INSERT INTO dl_member_wall_config(activity_id,config) VALUES($1,$2)",
      [legacy, JSON.stringify({ ...DEFAULT_WALL_CONFIG, mode: "demo" })],
    );
    const cookies = [];
    for (const id of [activity, empty, legacy]) {
      const token = randomBytes(32).toString("base64url");
      await db.query(
        "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'operator','operator',now()+interval '8 hours')",
        [digest(token), id],
      );
      cookies.push({ name: `dl-operator-${id}`, value: token });
    }
    const token = randomBytes(32).toString("base64url");
    await db.query(
      "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '8 hours')",
      [digest(token), activity, s.participants[0].id],
    );
    writeFileSync(
      process.env.WALL_UX_EVIDENCE + "/ux-fixture.json",
      JSON.stringify({
        activity,
        empty,
        legacy,
        epoch: s.epoch,
        cookies,
        participant: { name: `dl-participant-${activity}`, value: token },
        actor: s.participants[0].id,
        leaveActor: s.participants[1].id,
      }),
      { mode: 0o600 },
    );
    console.log("Wall UX synthetic fixture ready", activity);
  } finally {
    await db.end();
  }
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
