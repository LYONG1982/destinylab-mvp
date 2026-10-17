import "server-only";
import { fieldParticipant } from "./field-guard";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { database, transaction } from "./db";
import {
  digest,
  HttpError,
  load,
  rateLimit,
  save,
  sessionFor,
  type Session,
} from "./service";
import { keys } from "./private-http";
import { validAvatar } from "@/config/avatars";
import { assetIdValid } from "@/domain/photo";
import { mobileProjection } from "./state";
import type { DemoState } from "@/domain/types";
export async function uploadAvatar(
  activity: string,
  session: Session,
  bytes: Buffer,
) {
  await rateLimit(`upload:${activity}:${session.actor}`, 15);
  let output: Buffer;
  try {
    const image = sharp(bytes, {
        limitInputPixels: 24000000,
        failOn: "warning",
      }),
      meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw new Error();
    output = await image
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();
    if (output.length > 204800) throw new Error();
  } catch {
    throw new HttpError(
      400,
      "请选择有效的 JPG、PNG 或 WebP 静态照片（不超过 2400 万像素）。",
    );
  }
  const id = randomUUID();
  await transaction(async (client) => {
    const state = await load(client, activity, true);
    fieldParticipant(state, session.actor);
    if (!state.participants.some((p) => p.id === session.actor))
      throw new HttpError(403, "参与身份已失效。");
    await client.query(
      "DELETE FROM dl_avatar_assets WHERE attached=false AND created_at<now()-interval '24 hours'",
    );
    // Bound abandoned uploads even before their 24-hour expiry.
    await client.query(
      "DELETE FROM dl_avatar_assets WHERE activity_id=$1 AND actor=$2 AND attached=false AND id NOT IN (SELECT id FROM dl_avatar_assets WHERE activity_id=$1 AND actor=$2 AND attached=false ORDER BY created_at DESC LIMIT 3)",
      [activity, session.actor],
    );
    await client.query(
      "INSERT INTO dl_avatar_assets(id,activity_id,actor,bytes) VALUES($1,$2,$3,$4)",
      [id, activity, session.actor, output],
    );
  });
  return { id, bytes: output.length };
}
export async function avatarCommand(
  activity: string,
  session: Session,
  input: Record<string, unknown>,
  id: string,
) {
  keys(input, ["epoch", "command"]);
  const c = input.command as Record<string, unknown>;
  if (!c || typeof c !== "object" || Array.isArray(c))
    throw new HttpError(400, "操作无效。");
  keys(c, ["type", "assetId", "avatarId", "allowScreen", "expectedVersion"]);
  if (
    c.type !== "avatar" ||
    (c.assetId !== null && !assetIdValid(c.assetId)) ||
    typeof c.avatarId !== "string" ||
    typeof c.allowScreen !== "boolean" ||
    !Number.isSafeInteger(c.expectedVersion) ||
    Number(c.expectedVersion) < 0 ||
    !/^[A-Za-z0-9_-]{8,120}$/.test(id)
  )
    throw new HttpError(400, "头像设置无效。");
  await rateLimit(`avatar:${activity}:${session.actor}`, 30);
  await transaction(async (client) => {
    const state = await load(client, activity, true),
      next = structuredClone(state),
      me = next.participants.find((p) => p.id === session.actor);
    fieldParticipant(state, session.actor);
    if (!me || input.epoch !== state.epoch)
      throw new HttpError(409, "活动状态已变化，请刷新。");
    const hash = digest(JSON.stringify(c));
    const done = await client.query(
      "SELECT payload_hash FROM dl_private_commands WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
      [activity, session.actor, id],
    );
    if (done.rowCount) {
      if (done.rows[0].payload_hash !== hash)
        throw new HttpError(409, "重复请求内容不一致。");
      return;
    }
    if (c.expectedVersion !== (me.avatarVersion || 0))
      throw new HttpError(409, "头像已在其他页面更新，请刷新后再试。");
    if (!validAvatar(c.avatarId as string, me.gender))
      throw new HttpError(400, "系统备用头像无效。");
    if (c.assetId) {
      const asset = await client.query(
        "SELECT id FROM dl_avatar_assets WHERE id=$1 AND activity_id=$2 AND actor=$3 AND (attached OR created_at>now()-interval '24 hours') FOR UPDATE",
        [c.assetId, activity, session.actor],
      );
      if (!asset.rowCount)
        throw new HttpError(403, "照片无效、已过期或不属于你。");
      await client.query(
        "UPDATE dl_avatar_assets SET attached=true WHERE id=$1",
        [c.assetId],
      );
    }
    me.avatarId = c.avatarId as string;
    me.photo = c.assetId
      ? { id: c.assetId as string, screen: c.allowScreen as boolean }
      : null;
    me.avatarVersion = (me.avatarVersion || 0) + 1;
    await save(client, activity, state, next);
    await client.query(
      "DELETE FROM dl_avatar_assets WHERE activity_id=$1 AND actor=$2 AND attached=true AND ($3::uuid IS NULL OR id<>$3::uuid)",
      [activity, session.actor, c.assetId],
    );
    await client.query(
      "INSERT INTO dl_private_commands(activity_id,actor,command_id,payload_hash) VALUES($1,$2,$3,$4)",
      [activity, session.actor, id, hash],
    );
  });
}
export async function readAvatar(request: Request, id: string) {
  if (!assetIdValid(id)) throw new HttpError(404, "照片不可查看。");
  const asset = await database().query(
    "SELECT a.activity_id,a.actor,a.bytes,a.attached,d.state FROM dl_avatar_assets a JOIN dl_activities d ON d.id=a.activity_id WHERE a.id=$1 AND (a.attached OR a.created_at>now()-interval '24 hours')",
    [id],
  );
  const row = asset.rows[0];
  if (!row) throw new HttpError(404, "照片不可查看。");
  const state = row.state as DemoState,
    owner = state.participants.find((p) => p.id === row.actor),
    screen = new URL(request.url).searchParams.get("screen") === "1";
  let allowed = !!(
    screen &&
    owner?.profileComplete &&
    owner?.present &&
    owner?.photo?.id === id &&
    owner.photo.screen
  );
  if (!screen) {
    for (const role of ["participant", "operator"] as const) {
      try {
        const session = await sessionFor(request, row.activity_id, role);
        allowed =
          role === "operator"
            ? owner?.photo?.id === id
            : session.actor === row.actor ||
              (owner?.photo?.id === id &&
                mobileProjection(
                  state,
                  session.actor,
                  row.activity_id,
                ).participants.some((p) => p.id === row.actor));
        if (allowed) break;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 401)) throw e;
      }
    }
  }
  if (!allowed) throw new HttpError(404, "照片不可查看。");
  return row.bytes as Buffer;
}

/** Small-program downloads use the same projection boundary, with a verified bearer session. */
export async function readMiniAvatar(
  activity: string,
  session: Session,
  id: string,
) {
  if (!assetIdValid(id)) throw new HttpError(404, "照片不可查看。");
  const result = await database().query(
    "SELECT a.actor,a.bytes,a.attached,d.state FROM dl_avatar_assets a JOIN dl_activities d ON d.id=a.activity_id WHERE a.id=$1 AND a.activity_id=$2 AND (a.attached OR a.created_at>now()-interval '24 hours')",
    [id, activity],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "照片不可查看。");
  const state = row.state as DemoState;
  const owner = state.participants.find((p) => p.id === row.actor);
  const allowed =
    session.actor === row.actor ||
    (owner?.photo?.id === id &&
      mobileProjection(state, session.actor, activity).participants.some(
        (p) => p.id === row.actor,
      ));
  if (!allowed) throw new HttpError(404, "照片不可查看。");
  return row.bytes as Buffer;
}
