import { useRef, useState } from "react";
import { View, Text, Image, Button } from "@tarojs/components";
import type { Participant } from "@/domain/types";
import { getAvatarsByGender } from "@/config/avatars";
import { client, API_ORIGIN } from "../lib/client";
export function AvatarEditor({
  participant: me,
  onBack,
}: {
  participant: Participant;
  onBack: () => void;
}) {
  const [system, setSystem] = useState(me.avatarId || `${me.gender}_01`);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.send({
        type: "avatar",
        assetId: null,
        avatarId: system,
        allowScreen: false,
        expectedVersion: me.avatarVersion || 0,
      });
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "头像保存失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View className="card">
      <Text className="title">选择你的头像</Text>
      <Text className="muted">
        本活动统一使用系统头像，不支持上传自定义照片。
      </Text>
      <View className="avatar-grid">
        {getAvatarsByGender(me.gender).map((a) => (
          <Image
            key={a.id}
            className={`avatar ${system === a.id ? "selected" : ""}`}
            src={API_ORIGIN + a.src}
            onClick={() => {
              if (!busy) {
                setSystem(a.id);
              }
            }}
          />
        ))}
      </View>
      <Button className="primary" disabled={busy} onClick={save}>
        {busy ? "正在保存…" : "确认使用"}
      </Button>
      <Button className="text-button" disabled={busy} onClick={onBack}>
        返回
      </Button>
      {error && <Text className="error">{error}</Text>}
    </View>
  );
}
