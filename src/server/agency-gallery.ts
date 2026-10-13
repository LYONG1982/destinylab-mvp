import "server-only";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { agencyCurrent } from "./agency-access";
import { digest, HttpError, rateLimit } from "./service";
import type { AgencyGallery, PublicProfile } from "@/domain/agency";
import { keys } from "./private-http";

export const galleryUrl = (
  activity: string,
  actor: string,
  id: string,
  thumb = false,
) =>
  `/api/tongzhou/gallery-photo?activity=${encodeURIComponent(activity)}&id=${encodeURIComponent(actor)}&photo=${id}${thumb ? "&thumb=1" : ""}`;
export async function galleryState(
  c: PoolClient,
  activity: string,
  actor: string,
): Promise<AgencyGallery> {
  const version = await c.query(
    "SELECT COALESCE(sum(version),0)::int AS version FROM dl_agency_albums WHERE activity_id=$1 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND member_actor=$2)",
    [activity, actor],
  );
  const photos = await c.query(
    "SELECT id,width,height,created_at,staff FROM dl_agency_photos WHERE activity_id=$1 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND member_actor=$2 AND active) ORDER BY position,created_at,id",
    [activity, actor],
  );
  const published = await c.query(
    "SELECT snapshot->'photos' AS photos FROM dl_agency_profiles WHERE activity_id=$1 AND actor=$2 AND published",
    [activity, actor],
  );
  const user = (
    await c.query(
      "SELECT a.id,a.created_at FROM dl_avatar_assets a JOIN dl_activities d ON d.id=a.activity_id CROSS JOIN LATERAL jsonb_array_elements(d.state->'participants') p WHERE a.activity_id=$1 AND a.actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND member_actor=$2 AND active) AND a.attached AND p->>'id'=a.actor AND p->'photo'->>'id'=a.id::text ORDER BY a.created_at DESC LIMIT 1",
      [activity, actor],
    )
  ).rows[0];
  const all = [
    ...(user
      ? [{ ...user, width: 512, height: 512, source: "user" as const }]
      : []),
    ...photos.rows.map((p) => ({ ...p, source: "agency" as const })),
  ];
  return {
    version: version.rows[0]?.version || 0,
    userPhotoId: user?.id || null,
    photos: all.map((p) => ({
      id: p.id,
      source: p.source,
      uploadedBy:
        p.source === "user" || p.staff === "registration"
          ? "participant"
          : "staff",
      width: p.width,
      height: p.height,
      createdAt: p.created_at.toISOString(),
      url: galleryUrl(activity, actor, p.id),
      thumbnail: galleryUrl(activity, actor, p.id, true),
      published: (published.rows[0]?.photos || []).includes(p.id),
    })),
  };
}
export async function galleryPhoto(
  activity: string,
  actor: string,
  id: string,
  thumb: boolean,
) {
  return transaction(async (c) => {
    const { photo, photoActor } = await agencyCurrent(c, activity, actor);
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, "照片不可查看。");
    if (id === photo) {
      const user = await c.query(
        "SELECT bytes FROM dl_avatar_assets WHERE id=$1 AND activity_id=$2 AND actor=$3 AND attached",
        [id, activity, photoActor],
      );
      if (!user.rowCount) throw new HttpError(404, "照片不可查看。");
      return user.rows[0].bytes as Buffer;
    }
    const r = await c.query(
      `SELECT ${thumb ? "thumbnail" : "bytes"} AS bytes FROM dl_agency_photos WHERE activity_id=$1 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND member_actor=$2 AND active) AND id=$3`,
      [activity, actor, id],
    );
    if (!r.rowCount) throw new HttpError(404, "照片不可查看。");
    return r.rows[0].bytes as Buffer;
  });
}
async function duplicate(
  c: PoolClient,
  activity: string,
  actor: string,
  command: string,
  hash: string,
) {
  const r = await c.query(
    "SELECT payload_hash FROM dl_agency_actions WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
    [activity, actor, command],
  );
  if (r.rowCount && r.rows[0].payload_hash !== hash)
    throw new HttpError(409, "重复操作内容不同。");
  return !!r.rowCount;
}
async function log(
  c: PoolClient,
  activity: string,
  actor: string,
  command: string,
  hash: string,
  action: string,
) {
  await c.query(
    "INSERT INTO dl_agency_actions(activity_id,actor,command_id,payload_hash,action,staff) VALUES($1,$2,$3,$4,$5,$6)",
    [
      activity,
      actor,
      command,
      hash,
      action,
      process.env.DESTINY_AGENCY_USERNAME || "tongzhou",
    ],
  );
}
function validate(actor: string, version: number, command: string) {
  if (
    !actor ||
    actor.length > 100 ||
    !Number.isSafeInteger(version) ||
    version < 0 ||
    !/^[A-Za-z0-9_-]{8,120}$/.test(command)
  )
    throw new HttpError(400, "相册操作或版本无效。");
}
async function checkVersion(
  c: PoolClient,
  activity: string,
  actor: string,
  expected: number,
) {
  const gallery = await galleryState(c, activity, actor);
  if (gallery.version !== expected)
    throw new HttpError(409, "相册已更新，请重新打开详情。");
  return gallery;
}
async function bump(c: PoolClient, activity: string, actor: string) {
  await c.query(
    "INSERT INTO dl_agency_albums(activity_id,actor,version) VALUES($1,$2,1) ON CONFLICT(activity_id,actor) DO UPDATE SET version=dl_agency_albums.version+1",
    [activity, actor],
  );
}
export async function uploadAgencyPhoto(
  activity: string,
  actor: string,
  expected: number,
  command: string,
  source: Buffer,
) {
  validate(actor, expected, command);
  await rateLimit(`agency-upload:${activity}:${actor}`, 30);
  // Reject inaccessible submissions before spending resources decoding a photo.
  await transaction((c) => agencyCurrent(c, activity, actor));
  let bytes: Buffer, thumbnail: Buffer, width: number, height: number;
  try {
    const input = sharp(source, {
      limitInputPixels: 24000000,
      failOn: "warning",
    });
    const meta = await input.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw Error();
    const result = await input
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
    bytes = result.data;
    width = result.info.width;
    height = result.info.height;
    thumbnail = await sharp(bytes)
      .resize({
        width: 480,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 76 })
      .toBuffer();
    if (bytes.length > 2097152 || thumbnail.length > 204800) throw Error();
  } catch {
    throw new HttpError(
      400,
      "请选择 JPG、PNG 或 WebP 静态照片（不超过 10MB、2400 万像素）。",
    );
  }
  const hash = digest(
    `upload:${actor}:${expected}:` +
      createHash("sha256").update(source).digest("hex"),
  );
  return transaction(async (c) => {
    const { sourceActor } = await agencyCurrent(c, activity, actor);
    if (await duplicate(c, activity, actor, command, hash))
      return galleryState(c, activity, actor);
    const g = await checkVersion(c, activity, actor, expected);
    const agencyPhotos = g.photos.filter((p) => p.source === "agency");
    if (agencyPhotos.length >= 9)
      throw new HttpError(400, "每位用户最多保留 9 张机构上传照片。");
    await c.query(
      "INSERT INTO dl_agency_photos(id,activity_id,actor,bytes,thumbnail,width,height,position,staff) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        activity,
        sourceActor,
        bytes,
        thumbnail,
        width,
        height,
        agencyPhotos.length,
        process.env.DESTINY_AGENCY_USERNAME || "tongzhou",
      ],
    );
    await bump(c, activity, actor);
    await log(c, activity, actor, command, hash, "photo-upload");
    return galleryState(c, activity, actor);
  });
}
export async function galleryAction(
  activity: string,
  input: Record<string, unknown>,
  command: string,
) {
  keys(input, ["actor", "expectedVersion", "action", "ids", "id", "confirmed"]);
  const actor = String(input.actor || ""),
    expected = Number(input.expectedVersion);
  validate(actor, expected, command);
  if (!["delete", "reorder"].includes(String(input.action)))
    throw new HttpError(400, "相册操作无效。");
  await rateLimit(`agency-gallery:${activity}:${actor}`, 90);
  const hash = digest(JSON.stringify(input));
  return transaction(async (c) => {
    await agencyCurrent(c, activity, actor);
    if (await duplicate(c, activity, actor, command, hash))
      return galleryState(c, activity, actor);
    const g = await checkVersion(c, activity, actor, expected);
    const agencyPhotos = g.photos.filter((p) => p.source === "agency");
    if (input.action === "reorder") {
      const ids = input.ids;
      if (
        !Array.isArray(ids) ||
        ids.length !== agencyPhotos.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !agencyPhotos.some((p) => p.id === id))
      )
        throw new HttpError(400, "照片顺序无效。");
      for (let i = 0; i < ids.length; i++)
        await c.query("UPDATE dl_agency_photos SET position=$2 WHERE id=$1", [
          ids[i],
          i,
        ]);
    } else {
      const p = agencyPhotos.find((p) => p.id === input.id);
      if (!p) throw new HttpError(404, "照片不可查看。");
      if (p.published && input.confirmed !== true)
        throw new HttpError(400, "该照片已公开，请确认同时从宣传页移除。");
      const row = (
        await c.query(
          "SELECT snapshot,photo_ids FROM dl_agency_profiles WHERE activity_id=$1 AND actor=$2 FOR UPDATE",
          [activity, actor],
        )
      ).rows[0];
      if (row) {
        const snapshot = row.snapshot as PublicProfile | null;
        if (snapshot?.photos?.includes(p.id)) {
          snapshot.photos = snapshot.photos.filter((id) => id !== p.id);
          snapshot.photo = snapshot.photos.length > 0;
          const cover = snapshot.photos.length
            ? (
                await c.query(
                  "SELECT thumbnail FROM dl_agency_photos WHERE id=$1 AND activity_id=$2 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$2 AND member_actor=$3 AND active) UNION ALL SELECT bytes AS thumbnail FROM dl_agency_user_photo_snapshots WHERE id=$1 AND activity_id=$2 AND actor=$3",
                  [snapshot.photos[0], activity, actor],
                )
              ).rows[0]?.thumbnail
            : null;
          await c.query(
            "UPDATE dl_agency_profiles SET snapshot=$3,photo=$4 WHERE activity_id=$1 AND actor=$2",
            [activity, actor, JSON.stringify(snapshot), cover],
          );
        }
        await c.query(
          "UPDATE dl_agency_profiles SET photo_ids=photo_ids-$3,version=version+1,updated_at=now() WHERE activity_id=$1 AND actor=$2",
          [activity, actor, p.id],
        );
      }
      await c.query("DELETE FROM dl_agency_photos WHERE id=$1", [p.id]);
      // Keep compact ordering after removals so subsequent uploads append reliably.
      const remaining = agencyPhotos.filter((photo) => photo.id !== p.id);
      for (let i = 0; i < remaining.length; i++)
        await c.query("UPDATE dl_agency_photos SET position=$2 WHERE id=$1", [
          remaining[i].id,
          i,
        ]);
    }
    await bump(c, activity, actor);
    await log(c, activity, actor, command, hash, `photo-${input.action}`);
    return galleryState(c, activity, actor);
  });
}
