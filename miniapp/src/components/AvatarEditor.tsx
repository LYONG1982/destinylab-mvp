import { useState } from "react";
import Taro from "@tarojs/taro";
import { View, Text, Image, Switch, Button } from "@tarojs/components";
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
  const [file, setFile] = useState(""),
    [asset, setAsset] = useState(me.photo?.id || null),
    [system, setSystem] = useState(me.avatarId || `${me.gender}_01`);
  const [allow, setAllow] = useState(me.photo?.screen || false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function choose() {
    setBusy(true);
    setError("");
    try {
      if (Taro.canIUse("requirePrivacyAuthorize"))
        await Taro.requirePrivacyAuthorize();
      const selected = await Taro.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album"],
        sizeType: ["compressed"],
      });
      if (!Taro.canIUse("cropImage"))
        throw new Error("当前微信版本不支持照片裁剪，请升级微信后重试。");
      const crop = await Taro.cropImage({
        src: selected.tempFiles[0].tempFilePath,
        cropScale: "1:1",
      });
      const compressed = await Taro.compressImage({
        src: crop.tempFilePath,
        quality: 85,
      });
      setFile(compressed.tempFilePath);
      setAsset(null);
      setAllow(true);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : String((e as { errMsg?: string }).errMsg || "照片选择未完成。");
      if (!msg.includes("cancel")) setError(msg);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const id = file ? (await client.upload(file)).id : asset;
      if (id) {
        // Retain the uploaded asset so checking again never uploads another copy.
        setAsset(id);
        setFile("");
        const result = await client.reviewAvatar(id);
        if (result.status !== "pass")
          throw new Error(
            result.status === "pending"
              ? "照片正在检测中，请稍后再次点击保存。通过后才会更新头像。"
              : "该照片暂不能展示，请更换照片后重试。",
          );
      }
      await client.send({
        type: "avatar",
        assetId: id,
        avatarId: system,
        allowScreen: !!id && allow,
        expectedVersion: me.avatarVersion || 0,
      });
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "头像保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="card">
      <Text className="title">选择你的头像</Text>
      <Button disabled={busy} onClick={choose}>
        从相册选择照片
      </Button>
      {file && <Image className="photo-preview" mode="aspectFill" src={file} />}
      <Text className="muted">
        系统头像也用于照片未获大屏展示许可时的替代展示。
      </Text>
      <View className="avatar-grid">
        {getAvatarsByGender(me.gender).map((a) => (
          <Image
            key={a.id}
            className={`avatar ${system === a.id ? "selected" : ""}`}
            src={API_ORIGIN + a.src}
            onClick={() => {
              if (!busy) setSystem(a.id);
            }}
          />
        ))}
      </View>
      {(file || asset) && (
        <View className="permission">
          <Switch
            checked={allow}
            disabled={busy}
            onChange={(e) => setAllow(e.detail.value)}
          />
          <Text>允许本人照片在现场大屏展示</Text>
        </View>
      )}
      <Button
        disabled={busy}
        onClick={() => {
          setFile("");
          setAsset(null);
          setAllow(true);
        }}
      >
        移除照片，使用系统头像
      </Button>
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
