import { Image, View } from "@tarojs/components";
import type { Participant } from "@/domain/types";
import { getAvatarById } from "@/config/avatars";
import { API_ORIGIN } from "../lib/client";
export function Avatar({ participant }: { participant: Participant }) {
  const avatar = getAvatarById(participant.avatarId);
  return avatar ? (
    <Image className="avatar" mode="aspectFill" src={API_ORIGIN + avatar.src} />
  ) : (
    <View className="avatar placeholder">遇</View>
  );
}
