/** Explicitly approved local fixtures. Never invoke from application startup. */
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { database, transaction } from "../src/server/db";
import { agencyDetail, agencyAction } from "../src/server/agency-service";
import { uploadAgencyPhoto } from "../src/server/agency-gallery";
import { defaultPublicFields } from "../src/domain/agency";
import {
  emptyTongzhouProfile,
  TONGZHOU_CONSENT_VERSION,
} from "../src/domain/tongzhou";

const batch = "tongzhou-20261011-women";
const target = process.argv[2];
const activity = process.argv[3];
const dbUrl = new URL(process.env.DATABASE_URL || "http://invalid");
const origin = process.env.DESTINY_PUBLIC_URL;
const isTest =
  target === "test" &&
  dbUrl.pathname === "/destiny_agency_20261011_test" &&
  origin === "http://127.0.0.1:3217" &&
  /^cloudtest-agency-[a-f0-9-]+$/.test(activity || "");
const isUat =
  target === "uat" &&
  dbUrl.pathname === "/destiny_lan_uat_20261011" &&
  origin === "http://192.168.43.70:3216" &&
  activity === "meet";
if (
  (!isTest && !isUat) ||
  !["localhost", "127.0.0.1"].includes(dbUrl.hostname) ||
  dbUrl.port !== "55464"
)
  throw Error(
    "Only the exact isolated test or approved LAN UAT database is allowed",
  );
if (isUat) {
  const backup = process.env.DESTINY_UAT_BACKUP;
  if (
    !backup ||
    !backup.startsWith(
      process.env.HOME + "/.config/destinylab/2026-10-11-lan/",
    ) ||
    !backup.endsWith(".dump") ||
    statSync(backup).size < 1000 ||
    readFileSync(backup).subarray(0, 5).toString() !== "PGDMP"
  )
    throw Error("A protected PostgreSQL backup is required before UAT import");
}
const samples = [
  {
    key: "linjian",
    nickname: "林间",
    birthYear: "1998",
    city: "上海",
    height: "166",
    education: "本科",
    occupation: "产品设计",
    income: "10000–19999 元",
    housing: "租住",
    vehicle: "暂无",
    family: "家庭氛围温暖，尊重彼此独立的生活选择。",
    expectations:
      "期待在同一座城市生活，愿意沟通，也愿意一起探索周末的小美好。",
    intro:
      "喜欢散步、做饭与逛展，记录日常里细微的光。希望两个人既能分享生活，也能保留各自热爱的事。",
  },
  {
    key: "qinghe",
    nickname: "晴禾",
    birthYear: "1995",
    city: "杭州",
    height: "162",
    education: "硕士",
    occupation: "文化编辑",
    income: "10000–19999 元",
    housing: "自有住房",
    vehicle: "暂无",
    family: "与家人相处融洽，生活规律，重视真诚与尊重。",
    expectations:
      "希望对方情绪稳定，喜欢交流，能一起阅读、旅行，认真经营日常。",
    intro:
      "书店与咖啡馆是周末的常去之处，也喜欢徒步和听现场音乐。比起热闹，更珍惜舒服自在的相处。",
  },
  {
    key: "zhixia",
    nickname: "知夏",
    birthYear: "1993",
    city: "苏州",
    height: "168",
    education: "硕士",
    occupation: "建筑设计",
    income: "20000 元及以上",
    housing: "自有住房",
    vehicle: "有车",
    family: "家人支持独立发展，平时保持联系，也尊重个人空间。",
    expectations: "期待彼此有责任感，愿意分享想法、协商分歧，一起规划未来。",
    intro:
      "喜欢城市漫步、建筑与摄影，习惯用速写记录旅行。工作认真，生活中也愿意放慢脚步，享受一顿好饭。",
  },
  {
    key: "anning",
    nickname: "安宁",
    birthYear: "1990",
    city: "南京",
    height: "164",
    education: "本科",
    occupation: "项目管理",
    income: "10000–19999 元",
    housing: "自有住房",
    vehicle: "有车",
    family: "家庭关系和睦，独立生活，愿意以平等方式经营新的家庭。",
    expectations:
      "希望遇到真诚、温和、做事有回应的人，步调相近，愿意共同成长。",
    intro:
      "喜欢园艺、游泳与周末短途旅行。对生活保持好奇，珍惜承诺，也期待平凡日常里踏实而长久的陪伴。",
  },
];
const actors = samples.map((s) => "uat-women-20261011-" + s.key);
const images = samples.map((s) =>
  ["portrait", "life"].map((kind) =>
    readFileSync(
      resolve("assets/uat/tongzhou-20261011", s.key + "-" + kind + ".png"),
    ),
  ),
);
async function main() {
  const pool = database();
  const lock = await pool.connect();
  try {
    if (
      !(
        await lock.query(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
          [batch],
        )
      ).rows[0].locked
    )
      throw Error("Another fixture import is running");
    const current = await pool.query(
      "SELECT actor,record->>'_uatBatch' AS batch FROM dl_tongzhou_submissions WHERE activity_id=$1 AND actor=ANY($2::text[])",
      [activity, actors],
    );
    if (
      current.rowCount &&
      (current.rowCount !== 4 || current.rows.some((r) => r.batch !== batch))
    )
      throw Error(
        "Partial import or identifier collision; inspect before retrying. No records overwritten.",
      );
    if (current.rowCount) {
      const completed = await pool.query(
        "SELECT p.actor FROM dl_agency_profiles p WHERE p.activity_id=$1 AND p.actor=ANY($2::text[]) AND p.slug IS NOT NULL AND p.snapshot IS NOT NULL AND (SELECT count(*) FROM dl_agency_photos f WHERE f.activity_id=p.activity_id AND f.actor=p.actor)=2",
        [activity, actors],
      );
      if (completed.rowCount !== 4)
        throw Error(
          "Incomplete or subsequently edited sample batch; inspect manually. No records overwritten.",
        );
    }
    const fingerprint = async () =>
      createHash("sha256")
        .update(
          JSON.stringify(
            (
              await pool.query("SELECT state FROM dl_activities WHERE id=$1", [
                activity,
              ])
            ).rows,
          ),
        )
        .digest("hex");
    const stateBefore = await fingerprint();
    if (!current.rowCount) {
      await transaction(async (c) => {
        if (
          !(
            await c.query(
              "SELECT id FROM dl_activities WHERE id=$1 FOR UPDATE",
              [activity],
            )
          ).rowCount
        )
          throw Error("Activity must already exist");
        for (const [i, s] of samples.entries()) {
          const now = Date.now();
          const record = {
            participantId: actors[i],
            organizationId: "tongzhou",
            version: 1,
            status: "active",
            _uatBatch: batch,
            fields: {
              ...emptyTongzhouProfile(),
              realName: s.nickname + "（UAT虚构）",
              phone: "",
              gender: "女",
              birthYear: s.birthYear,
              city: s.city,
              ethnicity: "汉族",
              maritalStatus: "未婚",
              children: "未育",
              height: s.height,
              education: s.education,
              occupation: s.occupation,
              income: s.income,
              housing: s.housing,
              vehicle: s.vehicle,
              family: s.family,
              expectations: s.expectations,
              contactTime: "UAT 虚构测试，请勿联系",
            },
            submittedAt: now,
            updatedAt: now,
            consent: { version: TONGZHOU_CONSENT_VERSION, at: now },
          };
          await c.query(
            "INSERT INTO dl_tongzhou_submissions(activity_id,actor,record) VALUES($1,$2,$3)",
            [activity, actors[i], JSON.stringify(record)],
          );
        }
      });
      for (const [i, s] of samples.entries()) {
        const actor = actors[i];
        let detail = await agencyDetail(activity, actor);
        for (const bytes of images[i]) {
          await uploadAgencyPhoto(
            activity,
            actor,
            detail.gallery.version,
            randomUUID(),
            bytes,
          );
          detail = await agencyDetail(activity, actor);
        }
        await agencyAction(
          activity,
          {
            actor,
            action: "publish",
            expectedVersion: detail.management.version,
            sourceVersion: detail.record.version,
            expectedGalleryVersion: detail.gallery.version,
            expectedUserPhoto: detail.gallery.userPhotoId,
            confirmed: true,
            draft: {
              note: "UAT 虚构测试；模拟授权流程；照片由 AI 生成，不对应真实客户。",
              signed: false,
              service: "none",
              nickname: s.nickname + "（UAT）",
              code: "UAT-WOMEN-20261011-0" + (i + 1),
              intro: "【UAT 虚构测试资料，照片由 AI 生成】\n" + s.intro,
              fields: defaultPublicFields(),
              photoIds: detail.gallery.photos.map((p) => p.id),
            },
          },
          randomUUID(),
        );
      }
    }
    if (stateBefore !== (await fingerprint()))
      throw Error(
        "Activity state changed during import; inspect concurrent activity before acceptance",
      );
    const records = [];
    for (const actor of actors) {
      const detail = await agencyDetail(activity, actor);
      if (
        !current.rowCount &&
        (!detail.management.published || detail.gallery.photos.length !== 2)
      )
        throw Error("Fixture publication is incomplete");
      records.push({
        actor,
        nickname: detail.management.nickname,
        code: detail.management.code,
        published: detail.management.published,
        url: origin + detail.management.url,
        photoIds: detail.gallery.photos.map((p) => p.id),
      });
    }
    const report = {
      batch,
      target,
      activity,
      reused: !!current.rowCount,
      activityStateUnchanged: true,
      records,
    };
    const directory = "docs/verification/uat-women-20261011";
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      directory + "/" + target + "-manifest.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [batch]);
    lock.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Fixture import failed. Inspect this exact batch before retrying; credentials are never logged.",
  );
  process.exitCode = 1;
});
