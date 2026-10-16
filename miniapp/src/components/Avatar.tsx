import { useEffect, useState } from "react";
import { Image, View } from "@tarojs/components";
import { useDidHide, useDidShow } from "@tarojs/taro";
import type { Participant } from "@/domain/types";
import { getAvatarById } from "@/config/avatars";
import { API_ORIGIN, client } from "../lib/client";
export function Avatar({ participant }: { participant: Participant }) {
  const [source, setSource] = useState(""),
    [visible, setVisible] = useState(true),
    [version, setVersion] = useState(0);
  useDidHide(() => {
    setVisible(false);
    setSource("");
  });
  useDidShow(() => {
    setVisible(true);
    setVersion((v) => v + 1);
  });
  const id = participant.photo?.id;
  useEffect(() => {
    let current = true;
    setSource("");
    if (visible && id)
      client
        .photo(id)
        .then((path) => {
          if (current) setSource(path);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [id, visible, version]);
  const fallback = getAvatarById(participant.avatarId);
  return source || fallback ? (
    <Image
      className="avatar"
      mode="aspectFill"
      src={source || API_ORIGIN + fallback!.src}
      onError={() => setSource("")}
    />
  ) : (
    <View className="avatar placeholder">遇</View>
  );
}
