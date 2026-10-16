import type { Participant } from "./types";
import { getAvatarById } from "@/config/avatars";
export interface PhotoAvatar {
  id: string;
  screen: boolean;
}
export interface AvatarCommand {
  type: "avatar";
  assetId: string | null;
  avatarId: string;
  allowScreen: boolean;
  expectedVersion: number;
}
export const assetIdValid = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export function avatarSource(
  p: Pick<Participant, "avatarId" | "photo">,
  screen = false,
) {
  if (p.photo && assetIdValid(p.photo.id) && (!screen || p.photo.screen))
    return `/api/avatar/${p.photo.id}${screen ? "?screen=1" : ""}`;
  return getAvatarById(p.avatarId)?.src || "";
}
export function allowedAvatarSource(src: string) {
  return (
    /^\/assets\/avatars\/(male|female)\/\1_(0[1-9]|10)\.png$/.test(src) ||
    /^\/api\/avatar\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\?screen=1$/.test(
      src,
    )
  );
}
export function avatarDescription(p: Pick<Participant, "photo">) {
  return p.photo ? "用户上传照片，身份未核验" : "系统虚拟头像，不代表本人长相";
}
