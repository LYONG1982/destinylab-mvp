import "server-only";
import { randomBytes } from "node:crypto";
import { database, transaction } from "./db";
import { digest, HttpError, rateLimit } from "./service";
import { keys } from "./private-http";
import {
  TONGZHOU_CONSENT_VERSION,
  type TongzhouSubmission,
} from "@/domain/tongzhou";
import {
  validateAgencyDraft,
  defaultPublicFields,
  publicProfile,
  safePublicProfile,
  allowedPublicFields,
  type AgencyDraft,
  type AgencyManagement,
  type PublicProfile,
} from "@/domain/agency";
import {
  agencyCurrent as current,
  agencyPredicate as predicate,
} from "./agency-access";
import { galleryState, galleryUrl } from "./agency-gallery";
const generatedCode = (activity: string, actor: string) =>
  "TZ-" +
  digest(activity + ":" + actor)
    .slice(0, 12)
    .toUpperCase();
function defaults(activity: string, actor: string): AgencyDraft {
  return {
    note: "",
    signed: false,
    service: "none",
    nickname: "",
    code: generatedCode(activity, actor),
    intro: "",
    fields: defaultPublicFields(),
    photoIds: [],
  };
}
function publicDraft(d: AgencyDraft) {
  return {
    nickname: d.nickname,
    code: d.code,
    intro: d.intro,
    fields: allowedPublicFields(d.fields || []),
    photoIds: d.photoIds || [],
  };
}
type ManagedRow = AgencyDraft & {
  version: number;
  slug: string;
  published: boolean;
  published_at: Date | null;
  updated_at: Date;
  source_version: number | null;
  source_photo: string | null;
  photo_ids: string[];
  source_album_version: number | null;
  snapshot: PublicProfile | null;
  published_draft: unknown;
};
function management(
  activity: string,
  actor: string,
  row: ManagedRow | undefined,
  record: TongzhouSubmission,
  albumVersion: number,
  userPhotoId: string | null,
): AgencyManagement {
  const d = row
    ? {
        note: row.note,
        signed: row.signed,
        service: row.service,
        nickname: row.nickname,
        code: row.code,
        intro: row.intro,
        fields: allowedPublicFields(row.fields),
        photoIds: row.photo_ids || [],
      }
    : defaults(activity, actor);
  return {
    ...d,
    version: row?.version || 0,
    published: row?.published || false,
    url: row ? "/tongzhou/p/" + row.slug : "",
    publishedAt: row?.published_at?.toISOString() || null,
    updatedAt: row?.updated_at?.toISOString() || null,
    legacyPhoto:
      !!row?.published && !!row.snapshot?.photo && !row.snapshot?.photos,
    needsUpdate:
      !!row?.published &&
      (row.source_version !== record.version ||
        JSON.stringify(
          publicDraft((row.published_draft || {}) as AgencyDraft),
        ) !== JSON.stringify(publicDraft(d)) ||
        (d.fields.includes("photo") &&
          (row.source_album_version !== albumVersion ||
            (row.source_photo !== null && row.source_photo !== userPhotoId)))),
  };
}
export async function agencyDetail(activity: string, actor: string) {
  return transaction(async (c) => {
    const { record, photo, sources, latestSource } = await current(
      c,
      activity,
      actor,
    );
    const r = await c.query(
      "SELECT * FROM dl_agency_profiles WHERE activity_id=$1 AND actor=$2",
      [activity, actor],
    );
    const gallery = await galleryState(c, activity, actor);
    return {
      record,
      sources,
      latestSource,
      history: (
        await c.query(
          "SELECT m.note,m.signed,m.service,s.source FROM dl_agency_profiles m JOIN dl_agency_sources s USING(activity_id,actor) WHERE s.activity_id=$1 AND s.member_actor=$2 AND s.actor<>$2 AND s.active AND (m.note<>'' OR m.signed OR m.service<>'none') ORDER BY m.updated_at",
          [activity, actor],
        )
      ).rows,
      gallery,
      photoId: photo,
      management: management(
        activity,
        actor,
        r.rows[0],
        record,
        gallery.version,
        gallery.userPhotoId,
      ),
      photo: photo
        ? `/api/tongzhou/photo?activity=${encodeURIComponent(activity)}&id=${encodeURIComponent(actor)}`
        : null,
    };
  });
}
export async function agencyPhoto(activity: string, actor: string) {
  return transaction(async (c) => {
    const { photo, photoActor } = await current(c, activity, actor);
    if (!photo) throw new HttpError(404, "暂无照片。");
    const r = await c.query(
      "SELECT bytes FROM dl_avatar_assets WHERE id=$1 AND activity_id=$2 AND actor=$3",
      [photo, activity, photoActor],
    );
    if (!r.rowCount) throw new HttpError(404, "暂无照片。");
    return r.rows[0].bytes as Buffer;
  });
}
export async function agencyList(
  activity: string,
  query: string,
  page: number,
  gender: string,
  signed: string,
  service: string,
) {
  if (
    !["", "男", "女"].includes(gender) ||
    !["", "true", "false"].includes(signed) ||
    !["", "none", "active", "done"].includes(service)
  )
    throw new HttpError(400, "筛选条件无效。");
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const base = `FROM dl_agency_members s LEFT JOIN dl_agency_profiles m USING(activity_id,actor) WHERE s.activity_id=$1 AND ${predicate}`;
    const stats = await c.query(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE s.record->'fields'->>'gender'='男')::int AS male,count(*) FILTER(WHERE s.record->'fields'->>'gender'='女')::int AS female,count(*) FILTER(WHERE m.signed)::int AS signed,count(*) FILTER(WHERE COALESCE(m.service,'none')='none')::int AS none,count(*) FILTER(WHERE m.service='active')::int AS active,count(*) FILTER(WHERE m.service='done')::int AS done ${base}`,
      [activity, TONGZHOU_CONSENT_VERSION],
    );
    const filter =
      " AND (strpos(s.record->'fields'->>'realName',$3)>0 OR strpos(s.record->'fields'->>'city',$3)>0 OR strpos(COALESCE(m.nickname,''),$3)>0 OR strpos(COALESCE(m.code,''),upper($3))>0) AND ($4='' OR s.record->'fields'->>'gender'=$4) AND ($5='' OR COALESCE(m.signed,false)::text=$5) AND ($6='' OR COALESCE(m.service,'none')=$6)";
    const args = [
      activity,
      TONGZHOU_CONSENT_VERSION,
      query.trim(),
      gender,
      signed,
      service,
    ];
    const total = await c.query(
      `SELECT count(*)::int AS total ${base}${filter}`,
      args,
    );
    const rows = await c.query(
      `SELECT s.actor,s.sources,s.latest_source,s.record->>'version' AS version,s.record->'fields'->>'realName' AS name,s.record->'fields'->>'gender' AS gender,s.record->'fields'->>'birthYear' AS birthYear,s.record->'fields'->>'city' AS city,regexp_replace(s.record->'fields'->>'phone','^([0-9]{3})[0-9]{4}([0-9]{4})$','\\1****\\2') AS phone,s.record->>'updatedAt' AS updated,COALESCE(m.nickname,'') AS nickname,COALESCE(m.code,'') AS code,COALESCE(m.signed,false) AS signed,COALESCE(m.service,'none') AS service,COALESCE(m.published,false) AS published ${base}${filter} ORDER BY s.updated_at DESC,s.actor LIMIT 20 OFFSET $7`,
      [...args, (page - 1) * 20],
    );
    return {
      records: rows.rows,
      stats: stats.rows[0],
      total: total.rows[0].total,
      page,
    };
  });
}
export async function agencyAction(
  activity: string,
  input: Record<string, unknown>,
  commandId: string,
) {
  keys(input, [
    "actor",
    "action",
    "expectedVersion",
    "sourceVersion",
    "draft",
    "confirmed",
    "expectedPhoto",
    "expectedGalleryVersion",
    "expectedUserPhoto",
    "scope",
  ]);
  if (
    typeof input.actor !== "string" ||
    input.actor.length > 100 ||
    !["save", "preview", "publish", "unpublish"].includes(
      String(input.action),
    ) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    !Number.isSafeInteger(input.sourceVersion)
  )
    throw new HttpError(400, "操作或版本无效。");
  if (
    input.scope !== undefined &&
    !["followup", "publication"].includes(String(input.scope))
  )
    throw new HttpError(400, "保存范围无效。");
  const actor = input.actor,
    action = String(input.action);
  if (action !== "preview" && !/^[A-Za-z0-9_-]{8,120}$/.test(commandId))
    throw new HttpError(400, "操作标识无效。");
  if (action === "publish" && input.confirmed !== true)
    throw new HttpError(400, "请确认已取得所选内容和照片的公开许可。");
  await rateLimit(`agency-action:${activity}`, 120);
  try {
    return await transaction(async (c) => {
      const { record } = await current(c, activity, actor);
      const old = await c.query(
        "SELECT * FROM dl_agency_profiles WHERE activity_id=$1 AND actor=$2 FOR UPDATE",
        [activity, actor],
      );
      const row = old.rows[0] as ManagedRow | undefined;
      const hash = digest(JSON.stringify(input));
      if (action !== "preview") {
        const done = await c.query(
          "SELECT payload_hash FROM dl_agency_actions WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
          [activity, actor, commandId],
        );
        if (done.rowCount) {
          if (done.rows[0].payload_hash !== hash)
            throw new HttpError(409, "重复操作内容不同。");
          return { ok: true };
        }
      }
      if (
        input.expectedVersion !== (row?.version || 0) ||
        input.sourceVersion !== record.version
      )
        throw new HttpError(409, "资料已更新，请重新打开详情后保存。");
      const gallery = await galleryState(c, activity, actor);
      const stored = management(
        activity,
        actor,
        row,
        record,
        gallery.version,
        gallery.userPhotoId,
      );
      const rawDraft = input.draft;
      if (!rawDraft || typeof rawDraft !== "object" || Array.isArray(rawDraft))
        throw new HttpError(400, "跟进资料无效。");
      let candidate = rawDraft as Record<string, unknown>;
      if (input.scope === "followup" && action === "save")
        candidate = { ...candidate, ...publicDraft(stored) };
      else if (
        input.scope === "publication" ||
        action === "publish" ||
        action === "unpublish"
      )
        candidate = {
          ...candidate,
          note: stored.note,
          signed: stored.signed,
          service: stored.service,
        };
      let draft: AgencyDraft;
      try {
        draft = validateAgencyDraft(candidate);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const usesGallery =
        action === "preview" ||
        action === "publish" ||
        (action === "save" && input.scope !== "followup");
      if (
        usesGallery &&
        (input.expectedGalleryVersion !== gallery.version ||
          (input.expectedUserPhoto ?? null) !== gallery.userPhotoId)
      )
        throw new HttpError(409, "相册已变化，请重新打开详情并预览。");
      const ids = draft.photoIds || [];
      if (
        usesGallery &&
        ids.some((id) => !gallery.photos.some((p) => p.id === id))
      )
        throw new HttpError(400, "所选照片已失效，请重新选择。");
      if (
        (action === "preview" || action === "publish") &&
        draft.fields.includes("photo") &&
        gallery.photos.length > 0 &&
        !ids.length
      )
        throw new HttpError(
          400,
          "请选择需要公开的相册照片，或取消“本人照片”。",
        );
      const preview = publicProfile(record.fields!, draft, ids.length > 0);
      preview.photos = preview.photo ? ids : [];
      const photoUrls = preview.photos.map((id) =>
        galleryUrl(activity, actor, id),
      );
      if (action === "preview")
        return {
          preview,
          photoUrl: photoUrls[0] || null,
          photoUrls,
          galleryVersion: gallery.version,
          userPhotoId: gallery.userPhotoId,
          photoId: null,
        };
      await c.query(
        `INSERT INTO dl_agency_profiles(activity_id,actor,code,slug) VALUES($1,$2,$3,$4) ON CONFLICT(activity_id,actor) DO NOTHING`,
        [activity, actor, draft.code, randomBytes(24).toString("base64url")],
      );
      await c.query(
        `UPDATE dl_agency_profiles SET note=$3,signed=$4,service=$5,nickname=$6,code=$7,intro=$8,fields=$9,photo_ids=$10,version=version+1,updated_at=now() WHERE activity_id=$1 AND actor=$2`,
        [
          activity,
          actor,
          draft.note,
          draft.signed,
          draft.service,
          draft.nickname,
          draft.code,
          draft.intro,
          JSON.stringify(draft.fields),
          JSON.stringify(draft.photoIds || []),
        ],
      );
      if (action === "publish") {
        await c.query(
          "DELETE FROM dl_agency_user_photo_snapshots WHERE activity_id=$1 AND actor=$2",
          [activity, actor],
        );
        const userSelected =
          preview.photo &&
          gallery.userPhotoId &&
          ids.includes(gallery.userPhotoId);
        if (userSelected)
          await c.query(
            "INSERT INTO dl_agency_user_photo_snapshots(activity_id,actor,id,bytes) SELECT activity_id,$2,id,bytes FROM dl_avatar_assets WHERE activity_id=$1 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND member_actor=$2 AND active) AND id=$3 AND attached",
            [activity, actor, gallery.userPhotoId],
          );
        const cover = preview.photo
          ? (
              await c.query(
                "SELECT thumbnail FROM dl_agency_photos WHERE id=$1 AND activity_id=$2 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$2 AND member_actor=$3 AND active) UNION ALL SELECT bytes AS thumbnail FROM dl_agency_user_photo_snapshots WHERE id=$1 AND activity_id=$2 AND actor=$3",
                [ids[0], activity, actor],
              )
            ).rows[0]?.thumbnail
          : null;
        await c.query(
          `UPDATE dl_agency_profiles SET published=true,snapshot=$3,photo=$4,source_version=$5,source_photo=$8,published_draft=$6,published_at=now(),source_album_version=$7 WHERE activity_id=$1 AND actor=$2`,
          [
            activity,
            actor,
            JSON.stringify(preview),
            cover,
            record.version,
            JSON.stringify(publicDraft(draft)),
            gallery.version,
            userSelected ? gallery.userPhotoId : null,
          ],
        );
      }
      if (action === "unpublish") {
        await c.query(
          "DELETE FROM dl_agency_user_photo_snapshots WHERE activity_id=$1 AND actor=$2",
          [activity, actor],
        );
        await c.query(
          "UPDATE dl_agency_profiles SET published=false,snapshot=NULL,photo=NULL WHERE activity_id=$1 AND actor=$2",
          [activity, actor],
        );
      }
      await c.query(
        "INSERT INTO dl_agency_actions(activity_id,actor,command_id,payload_hash,action,staff,public_permission_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          activity,
          actor,
          commandId,
          hash,
          action,
          process.env.DESTINY_AGENCY_USERNAME || "tongzhou",
          action === "publish" && input.confirmed === true,
        ],
      );
      return { ok: true };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw new HttpError(409, "该编号已被使用，请更换。");
    throw e;
  }
}
export async function publishedProfile(
  slug: string,
): Promise<{ profile: PublicProfile; photo: Buffer | null }> {
  if (!/^(?:[A-Za-z0-9_-]{24}|[A-Za-z0-9_-]{32})$/.test(slug))
    throw new HttpError(404, "页面不存在或已下架。");
  const r = await database().query(
    `SELECT m.snapshot,m.photo FROM dl_agency_profiles alias JOIN dl_agency_sources origin USING(activity_id,actor) JOIN dl_agency_profiles m ON m.activity_id=origin.activity_id AND m.actor=origin.member_actor JOIN dl_agency_members s ON s.activity_id=m.activity_id AND s.actor=m.actor WHERE alias.slug=$1 AND m.published=true AND ${predicate}`,
    [slug, TONGZHOU_CONSENT_VERSION],
  );
  if (!r.rowCount || !r.rows[0].snapshot)
    throw new HttpError(404, "页面不存在或已下架。");
  return {
    profile: safePublicProfile(r.rows[0].snapshot),
    photo: r.rows[0].photo,
  };
}

export async function publishedGalleryPhoto(
  slug: string,
  id: string,
): Promise<Buffer> {
  if (
    !/^(?:[A-Za-z0-9_-]{24}|[A-Za-z0-9_-]{32})$/.test(slug) ||
    !/^[a-f0-9-]{36}$/.test(id)
  )
    throw new HttpError(404, "照片不可查看。");
  const r = await database().query(
    `SELECT p.bytes FROM dl_agency_profiles alias JOIN dl_agency_sources origin USING(activity_id,actor) JOIN dl_agency_profiles m ON m.activity_id=origin.activity_id AND m.actor=origin.member_actor JOIN dl_agency_members s ON s.activity_id=m.activity_id AND s.actor=m.actor JOIN (SELECT id,activity_id,actor,bytes,false AS user_snapshot FROM dl_agency_photos UNION ALL SELECT id,activity_id,actor,bytes,true AS user_snapshot FROM dl_agency_user_photo_snapshots) p ON p.activity_id=m.activity_id AND (p.actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=m.activity_id AND member_actor=m.actor AND active) OR (p.user_snapshot AND p.actor=m.actor)) WHERE alias.slug=$1 AND ${predicate} AND m.published AND m.snapshot->'photos' ? $3 AND p.id=$3::uuid`,
    [slug, TONGZHOU_CONSENT_VERSION, id],
  );
  if (!r.rowCount) throw new HttpError(404, "照片不可查看。");
  return r.rows[0].bytes;
}
