import { useEffect, useState } from "react";
import { View, Text, Input, Button, Switch, Image } from "@tarojs/components";
import { WALL_CONSENT_VERSION, wallAgeLabel, wallNickname, type WallConsentView } from "@/domain/member-wall";
import { API_ORIGIN, client } from "../lib/client";
export function MemberWallConsent({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<WallConsentView | null>(null), [nickname, setNickname] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    client.wallMe().then((d) => { if (active) { setData(d); setNickname(d.nickname || d.preview?.nickname || ""); } }).catch((e) => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, []);
  async function save(allow: boolean) {
    if (!data || busy || (allow && !confirmed)) return;
    setBusy(true); setMessage("");
    try {
      if (allow) wallNickname(nickname);
      const d = await client.wallConsent({ allow, nickname, expectedVersion: data.version, consentVersion: WALL_CONSENT_VERSION });
      setData(d); setConfirmed(false); setMessage(allow ? "已开启，符合条件后在下一换人周期加入。" : "已停止在卡牌墙展示。");
    } catch (e) { setMessage(e instanceof Error ? e.message : "暂时无法保存。"); } finally { setBusy(false); }
  }
  return <View className="card"><Text className="title">我的遇见卡牌</Text><Text className="muted">可选展示，不影响答题和相遇。</Text>
    <Text className="label">公开昵称（请勿使用真实姓名）</Text><Input className="input" value={nickname} maxlength={16} disabled={busy} onInput={(e) => { setNickname(e.detail.value); setConfirmed(false); }} />
    {data?.preview && <View className={`wall-consent-preview wall-consent-${data.preview.gender}`}><Text className="label">正面</Text><Image className="wall-consent-avatar" src={API_ORIGIN + data.preview.avatarUrl} mode="aspectFit" />
      <Text className="wall-consent-gender">{data.preview.gender === "male" ? "♂ 男生" : "♀ 女生"}</Text><Text className="title">{nickname}</Text>{data.preview.ageRange && <Text>{wallAgeLabel(data.preview.ageRange)}</Text>}<Text>{data.preview.tags.join(" · ")}</Text>
      <Text className="label">背面</Text>{data.preview.preferences.map((p) => <Text key={p.label}>{p.label}：{p.value}</Text>)}</View>}
    <Text className="muted">仅公开昵称、性别标识、年龄段、系统虚拟头像及聊天偏好、周末偏好、见面看重、沟通方式、关系期待；未答项目不展示。此范围内的改答会同步更新。不展示真实照片、姓名字段、电话或同舟资料。请勿填写联系方式。</Text>
    <View className="permission"><Switch checked={confirmed} disabled={busy || !data?.preview} onChange={(e) => setConfirmed(e.detail.value)} /><Text>我已预览正反面，自愿公开上述范围，且可以随时停止展示。</Text></View>
    <Button className="primary" disabled={busy || !data?.preview || !confirmed} onClick={() => void save(true)}>{data?.allowed ? "保存公开设置" : "自愿开启卡牌展示"}</Button>
    {data?.allowed && <Button disabled={busy} onClick={() => void save(false)}>停止在卡牌墙展示</Button>}
    {!!message && <Text className="notice">{message}</Text>}<Button disabled={busy} onClick={onBack}>返回活动</Button>
  </View>;
}
