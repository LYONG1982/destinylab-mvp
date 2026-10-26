import { useState } from "react";
import {
  View,
  Text,
  Input,
  Textarea,
  Picker,
  Switch,
  Button,
} from "@tarojs/components";
import Taro from "@tarojs/taro";
import {
  emptyTongzhouProfile,
  TONGZHOU_FIELDS,
  TONGZHOU_CONSENT_TEXT,
  TONGZHOU_CONSENT_VERSION,
} from "@/domain/tongzhou";
import type { TongzhouSubmission } from "@/domain/tongzhou";
import { client } from "../lib/client";
export function ServiceForm({
  record,
  busy,
  onBack,
}: {
  record?: TongzhouSubmission;
  busy: boolean;
  onBack: () => void;
}) {
  const [fields, setFields] = useState(() => ({
    ...emptyTongzhouProfile(),
    ...record?.fields,
  }));
  const [consent, setConsent] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  function set(key: string, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }
  async function leave() {
    if (busy) return;
    if (
      dirty &&
      !(
        await Taro.showModal({
          title: "离开填写页面？",
          content: "尚未提交的修改将不会保存。",
          confirmText: "离开",
        })
      ).confirm
    )
      return;
    onBack();
  }
  async function submit() {
    try {
      await client.send({
        type: "tongzhou-submit",
        fields,
        consent,
        consentVersion: TONGZHOU_CONSENT_VERSION,
        expectedVersion: record?.version || 0,
      });
      setDirty(false);
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请重试。");
    }
  }
  async function change(type: string) {
    if (
      !(
        await Taro.showModal({
          title:
            type === "tongzhou-delete" ? "删除已填资料？" : "撤回资料授权？",
          content: "同舟机构将无法继续查看这份资料。",
          confirmText: "确认",
        })
      ).confirm
    )
      return;
    try {
      await client.send({ type, expectedVersion: record?.version || 0 });
      setFields(emptyTongzhouProfile());
      setDirty(false);
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成。");
    }
  }
  return (
    <View className="card service">
      <Button className="text-button" disabled={busy} onClick={leave}>
        返回继续答题
      </Button>
      <Text className="title">同舟专业婚恋服务</Text>
      <Text className="muted">
        填写资料，让同舟顾问了解你的婚恋需求，为后续联系与服务做好准备。
      </Text>
      {record && (
        <Text className="notice">
          {record.status === "active"
            ? "资料已提交，可继续修改"
            : record.status === "deleted"
              ? "资料已删除"
              : "授权已撤回"}
        </Text>
      )}
      {TONGZHOU_FIELDS.map((field) => (
        <View className="field" key={field.key}>
          <Text>
            {field.label}
            {field.required ? " *" : ""}
          </Text>
          {field.options ? (
            <Picker
              disabled={busy}
              range={["请选择", ...field.options]}
              value={Math.max(
                0,
                ["请选择", ...field.options].indexOf(fields[field.key]),
              )}
              onChange={(e) =>
                set(
                  field.key,
                  Number(e.detail.value) === 0
                    ? ""
                    : field.options![Number(e.detail.value) - 1],
                )
              }
            >
              <View className="input">{fields[field.key] || "请选择"}</View>
            </Picker>
          ) : field.multiline ? (
            <Textarea
              disabled={busy}
              className="input textarea"
              value={fields[field.key]}
              maxlength={field.maxLength || 500}
              onInput={(e) => set(field.key, e.detail.value)}
            />
          ) : (
            <Input
              disabled={busy}
              className="input"
              value={fields[field.key]}
              maxlength={field.maxLength || 100}
              type={
                ["phone", "birthYear", "height"].includes(field.key)
                  ? "number"
                  : "text"
              }
              onInput={(e) => set(field.key, e.detail.value)}
            />
          )}
          {field.hint && <Text className="hint">{field.hint}</Text>}
        </View>
      ))}
      <View className="permission">
        <Switch
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.detail.value)}
        />
        <Text>{TONGZHOU_CONSENT_TEXT.replace("、撤回授权", "")}</Text>
      </View>
      <Button className="primary" disabled={busy || !consent} onClick={submit}>
        {busy ? "正在提交…" : "确认授权并提交资料"}
      </Button>
      {record && record.status !== "deleted" && (
        <Button disabled={busy} onClick={() => change("tongzhou-delete")}>
          删除资料
        </Button>
      )}
      {error && <Text className="error">{error}</Text>}
    </View>
  );
}
