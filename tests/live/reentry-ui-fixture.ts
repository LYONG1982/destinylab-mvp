import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import { digest, execute, join } from "../../src/server/service";
import { miniEnter, miniLogin } from "../../src/server/wechat-service";
import { QUESTIONS, AGES } from "../../src/data/questions";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
const out = process.env.REENTRY_UI_DIR;
if (
  url.hostname !== "127.0.0.1" ||
  !url.pathname.endsWith("_test") ||
  !out?.startsWith("/tmp/destinylab-reentry-")
)
  throw Error("Dedicated local synthetic environment required");
async function main() {
  const fixtures = [];
  for (const kind of ["h5", "mini", "h5-partial", "mini-partial"]) {
    const activity = `reentry-ui-${randomUUID().slice(0, 8)}`,
      state = emptyActivity();
    await database().query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2)",
      [activity, JSON.stringify(state)],
    );
    let actor: string, token: string;
    if (kind.startsWith("h5")) {
      const joined = await join(new Request("http://localhost"), activity);
      actor = joined.session.actor;
      token = joined.token;
    } else {
      const auth = await miniLogin(activity, randomUUID(), async () => ({
        appid: process.env.DESTINY_WECHAT_APPID!,
        openid: randomUUID(),
      }));
      actor = (await miniEnter(auth.identity, activity)).actor;
      token = auth.token;
    }
    for (const command of [
      {
        type: "profile",
        name: "测试清禾",
        gender: "female",
        age: AGES[1],
        avatarId: "female_01",
        ready: true,
      },
      ...QUESTIONS.slice(
        0,
        kind.endsWith("partial") ? 3 : QUESTIONS.length,
      ).map((q) => ({ type: "answer", questionId: q.id, value: q.options[0] })),
    ])
      await execute(
        activity,
        { actor, role: "participant" },
        command,
        randomUUID(),
        state.epoch,
      );
    // Historical custom photo: retained in storage, but all live clients must use system avatars.
    const legacyPhoto = randomUUID();
    await database().query(
      "INSERT INTO dl_avatar_assets(id,activity_id,actor,bytes,attached) VALUES($1,$2,$3,$4,true)",
      [legacyPhoto, activity, actor, Buffer.from("synthetic-legacy-photo")],
    );
    await database().query(
      "UPDATE dl_activities SET state=jsonb_set(state,'{participants,0,photo}',$2::jsonb) WHERE id=$1",
      [activity, JSON.stringify({ id: legacyPhoto, screen: true })],
    );
    const operatorToken = randomBytes(32).toString("base64url");
    await database().query(
      "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'operator','operator',now()+interval '2 hours')",
      [digest(operatorToken), activity],
    );
    const scene = randomBytes(12).toString("hex");
    if (kind.startsWith("mini"))
      await database().query(
        "INSERT INTO dl_wechat_entry_codes(activity_id,appid,env_version,scene,image,entry_type) VALUES($1,$2,'trial',$3,$4,'encounter')",
        [
          activity,
          process.env.DESTINY_WECHAT_APPID,
          scene,
          Buffer.from("synthetic-code"),
        ],
      );
    fixtures.push({
      kind,
      activity,
      actor,
      token,
      operatorToken,
      epoch: state.epoch,
      scene,
    });
  }
  writeFileSync(`${out}/ui-fixture.json`, JSON.stringify(fixtures), {
    mode: 0o600,
  });
  console.log(
    "Four isolated UI fixtures prepared; authentication provider is synthetic.",
  );
}
main().finally(() => database().end());
