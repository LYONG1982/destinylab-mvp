// Run only with a protected local _test environment. Never seed an active event.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { database } from "../../src/server/db";
import { emptyActivity, newParticipant } from "../../src/server/state";
import { digest } from "../../src/server/service";
import {
  registrationWrite,
  registrationManage,
} from "../../src/server/registration-service";
import {
  DEFAULT_REGISTRATION_CONFIG,
  REGISTRATION_CONSENT_VERSION,
} from "../../src/domain/registration";
import { emptyTongzhouProfile } from "../../src/domain/tongzhou";

async function main() {
  const db = new URL(process.env.DATABASE_URL || "http://invalid");
  if (
    !["127.0.0.1", "localhost"].includes(db.hostname) ||
    !db.pathname.endsWith("_test") ||
    !process.env.ADMIN_VISUAL_FIXTURE
  ) {
    throw Error(
      "Protected local _test database and ADMIN_VISUAL_FIXTURE required",
    );
  }
  const activity = "visual-" + randomUUID().slice(0, 8);
  const state = emptyActivity();
  state.fieldOpen = true;
  const names = ["测试清禾", "测试远山", "晚霞轻轻落"];
  state.participants = names.map((name, i) => ({
    ...newParticipant(),
    name,
    gender: i === 1 ? ("male" as const) : ("female" as const),
    age: "26–29",
    avatarId: i === 1 ? "male_01" : "female_01",
    present: i !== 1,
    paused: i === 2,
    profileComplete: true,
  }));
  try {
    await database().query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2)",
      [activity, JSON.stringify(state)],
    );
    await database().query(
      "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2)",
      [
        activity,
        JSON.stringify({ ...DEFAULT_REGISTRATION_CONFIG, open: true }),
      ],
    );
    const registrations = [];
    for (let i = 0; i < names.length; i++) {
      const hash = digest(randomUUID());
      await database().query(
        "INSERT INTO dl_registration_sessions(token_hash,activity_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [hash, activity],
      );
      const record = await registrationWrite(
        activity,
        hash,
        {
          nickname: names[i],
          fields: {
            ...emptyTongzhouProfile(),
            realName: "合成测试用户",
            phone: `1380000001${i}`,
            gender: i === 1 ? "男" : "女",
            birthYear: "1995",
            city: "银川",
            ethnicity: "汉族",
            maritalStatus: "未婚",
          },
          birthDate: "1995-02-18",
          version: 0,
          consent: REGISTRATION_CONSENT_VERSION,
          agencyAllowed: false,
        },
        randomUUID(),
      );
      if (i > 0) {
        await registrationManage(
          activity,
          {
            action: i === 1 ? "checkin" : "cancel",
            id: record.id,
            version: record.version,
            receipt: record.receipt,
          },
          randomUUID(),
        );
      }
      registrations.push({ id: record.id, nickname: record.nickname });
    }
    writeFileSync(
      process.env.ADMIN_VISUAL_FIXTURE!,
      JSON.stringify({ activity, registrations }),
      { mode: 0o600 },
    );
    console.log("Synthetic visual fixture ready:", activity);
  } finally {
    await database().end();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
