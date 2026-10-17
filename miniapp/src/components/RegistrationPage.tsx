import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Taro, {
  useDidHide,
  useDidShow,
  useLoad,
  useShareAppMessage,
} from "@tarojs/taro";
import {
  Button,
  Image,
  Input,
  Picker,
  Switch,
  Text,
  Textarea,
  View,
} from "@tarojs/components";
import { client, API_ORIGIN, ApiError } from "../lib/client";
import { MINI_ENTRY_PAGES, type MiniEntry } from "@/domain/mini-entry";
import {
  REGISTRATION_AGENCY_CONSENT,
  REGISTRATION_CONSENT_VERSION,
  type RegistrationRecord,
  type RegistrationView,
} from "@/domain/registration";
import {
  PROFILE_FIELDS,
  PROFILE_STEPS,
  type ProfileStep,
} from "@/domain/registration-profile";
import {
  emptyTongzhouProfile,
  TONGZHOU_FIELDS,
  type TongzhouField,
  type TongzhouProfile,
} from "@/domain/tongzhou";
import { daysInMonth, validBirthDate, zodiacFor } from "@/domain/birth-date";
import "./registration.scss";
const labels = {
  life: "生活档案",
  expectation: "我的期待",
  album: "个人相册",
  preview: "遇见档案",
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "操作未完成，请检查网络后重试。";
const commandId = () =>
  `reg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function Field({
  name,
  value,
  onChange,
  disabled,
}: {
  name: TongzhouField;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const f = TONGZHOU_FIELDS.find((item) => item.key === name)!;
  return (
    <View className="reg-field">
      <Text>{f.key === "realName" ? "姓名" : f.label}</Text>
      {f.options ? (
        <Picker
          disabled={disabled}
          range={["请选择", ...f.options]}
          value={Math.max(0, f.options.indexOf(value) + 1)}
          onChange={(e) =>
            onChange(f.options![Number(e.detail.value) - 1] || "")
          }
        >
          <View className="reg-input">
            {value || "请选择"}
            <Text>⌄</Text>
          </View>
        </Picker>
      ) : f.multiline ? (
        <Textarea
          className="reg-input reg-textarea"
          disabled={disabled}
          maxlength={f.maxLength || 200}
          value={value}
          onInput={(e) => onChange(e.detail.value)}
          placeholder={f.hint || "填写内容"}
        />
      ) : (
        <Input
          className="reg-input"
          disabled={disabled}
          maxlength={f.maxLength || 40}
          type={
            ["phone", "height", "birthYear"].includes(name) ? "number" : "text"
          }
          value={value}
          onInput={(e) => onChange(e.detail.value)}
          placeholder={name === "phone" ? "11位手机号" : "请输入"}
        />
      )}
    </View>
  );
}
function Photo({
  id,
  revision,
  onRemove,
}: {
  id: string;
  revision: number;
  onRemove?: () => void;
}) {
  const [path, setPath] = useState(""),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setPath("");
    setError(false);
    client
      .registrationPhoto(id)
      .then((p) => {
        if (active) setPath(p);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id, revision, retry]);
  return (
    <View className="reg-photo">
      {path ? (
        <Image
          mode="aspectFill"
          src={path}
          onClick={() => Taro.previewImage({ urls: [path] })}
        />
      ) : (
        <Button onClick={() => setRetry(retry + 1)}>
          {error ? "点击重试照片" : "照片加载中"}
        </Button>
      )}
      {onRemove && (
        <Button className="reg-remove" onClick={onRemove}>
          删除
        </Button>
      )}
    </View>
  );
}
export function RegistrationPage({ entry }: { entry: MiniEntry }) {
  const auth = useSyncExternalStore(
    client.subscribe,
    client.state,
    client.state,
  );
  const [view, setView] = useState<RegistrationView | null>(null),
    [panel, setPanel] = useState<"pass" | "basic" | "profile">("pass");
  const [step, setStep] = useState<ProfileStep>("life"),
    [returnPreview, setReturnPreview] = useState(false);
  const [fields, setFields] = useState<TongzhouProfile>(emptyTongzhouProfile),
    [nickname, setNickname] = useState("");
  const [month, setMonth] = useState(""),
    [day, setDay] = useState(""),
    [agency, setAgency] = useState(false),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [photoRevision, setPhotoRevision] = useState(0);
  const ready = useRef(false),
    lock = useRef(false),
    retry = useRef<null | (() => Promise<void>)>(null);
  const record = view?.record;
  function draft(r: RegistrationRecord | null) {
    setFields(r ? { ...r.fields } : emptyTongzhouProfile());
    setNickname(r?.nickname || "");
    setMonth(r?.birthDate?.slice(5, 7) || "");
    setDay(r?.birthDate?.slice(8, 10) || "");
    setAgency(r?.agencyAllowed || false);
  }
  function receive(r: RegistrationRecord) {
    setView((v) => (v ? { ...v, record: r } : v));
    draft(r);
  }
  async function load() {
    const data = await client.registration();
    setView(data);
    draft(data.record);
    if (!data.record) setPanel("basic");
  }
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    retry.current = operation;
    try {
      await operation();
      retry.current = null;
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.status < 500) retry.current = null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useLoad((options) => {
    void run(async () => {
      const resolved = await client.enter(options || {}, false, entry);
      if (!resolved) return;
      ready.current = true;
      if (client.state().authenticated) await load();
    });
  });
  useDidShow(() => {
    setPhotoRevision((n) => n + 1);
    if (ready.current && client.state().authenticated && panel === "pass")
      void run(load);
  });
  useDidHide(() => {
    client.clearPhotos();
  });
  useShareAppMessage(() => ({
    title:
      entry === "registration" ? "遇见 · 认真遇见一个人" : "遇见 · 现场互动",
    path: `/${MINI_ENTRY_PAGES[entry]}?activity=${encodeURIComponent(client.activity())}`,
  }));
  const updateField = (name: TongzhouField, value: string) =>
    setFields((old) => ({ ...old, [name]: value }));
  function edit(section: ProfileStep) {
    draft(record || null);
    setStep(section);
    setReturnPreview(true);
    setPanel("profile");
  }
  function visit(section: ProfileStep) {
    draft(record || null);
    setReturnPreview(step === "preview" && section !== "preview");
    setStep(section);
    setPanel("profile");
    if (section === "preview") void run(load);
  }
  function saveBasic() {
    const id = commandId();
    let birthDate: string | null = null;
    if (month || day) {
      birthDate = `${fields.birthYear}-${month}-${day}`;
      if (!validBirthDate(birthDate)) {
        setError("请补齐有效的出生年月日，或清空月日。");
        return;
      }
    }
    const input = {
      nickname,
      fields,
      birthDate,
      version: record?.version || 0,
      consent: consent ? REGISTRATION_CONSENT_VERSION : "",
      agencyAllowed: record?.agencyAllowed || false,
      agencyConsent: "",
    };
    void run(async () => {
      receive(await client.saveRegistration("save", input, id));
      setPanel(returnPreview ? "profile" : "pass");
      if (returnPreview) setStep("preview");
    });
  }
  function saveStep() {
    if (!record || step === "preview") return;
    const id = commandId(),
      next = returnPreview
        ? "preview"
        : PROFILE_STEPS[PROFILE_STEPS.indexOf(step) + 1];
    const input = {
      section: step,
      intent: "save",
      next,
      fields: Object.fromEntries(
        PROFILE_FIELDS[step].map((key) => [key, fields[key]]),
      ),
      version: record.version,
      ...(step === "album"
        ? { agencyAllowed: agency, agencyConsent: REGISTRATION_AGENCY_CONSENT }
        : {}),
    };
    void run(async () => {
      receive(await client.saveRegistration("profile", input, id));
      setStep(next);
      setReturnPreview(false);
    });
  }
  async function upload() {
    if (!record || lock.current) return;
    try {
      if (Taro.canIUse("requirePrivacyAuthorize"))
        await Taro.requirePrivacyAuthorize();
      const chosen = await Taro.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["compressed"],
      });
      const path = chosen.tempFiles[0].tempFilePath,
        version = record.version,
        id = commandId();
      await run(async () =>
        receive(await client.uploadRegistration(path, version, id)),
      );
    } catch (e) {
      const text = String((e as { errMsg?: string })?.errMsg || message(e));
      if (!text.includes("cancel")) setError(text);
    }
  }
  const years = [
    "年",
    ...Array.from({ length: new Date().getFullYear() - 1900 - 17 }, (_, n) =>
      String(new Date().getFullYear() - 18 - n),
    ),
  ];
  const months = [
    "月",
    ...Array.from({ length: 12 }, (_, n) => String(n + 1).padStart(2, "0")),
  ];
  const days = [
    "日",
    ...Array.from(
      { length: daysInMonth(Number(fields.birthYear), Number(month)) },
      (_, n) => String(n + 1).padStart(2, "0"),
    ),
  ];
  const date = `${fields.birthYear}-${month}-${day}`,
    zodiac = zodiacFor(date);
  return (
    <View className="reg-page">
      <View className="reg-brand">
        <Text>遇见</Text>
        <Text>缘分实验室</Text>
      </View>
      <View className="reg-heading">
        <Text className="reg-eyebrow">MEET SOMEONE, MEET YOURSELF</Text>
        <Text className="reg-title">
          {entry === "encounter" ? "让相遇，从这里开始" : "认真遇见一个人"}
        </Text>
        <Text className="reg-subtitle">
          {entry === "encounter" ? "现场互动入口" : "一份邀请，一段新的故事"}
        </Text>
      </View>
      {(error || auth.error) && (
        <View className="reg-error">
          <Text>{error || auth.error}</Text>
          {retry.current && (
            <Button
              disabled={busy}
              onClick={() => retry.current && run(retry.current)}
            >
              重试本次操作
            </Button>
          )}
          {auth.authenticated && (
            <Button
              disabled={busy}
              onClick={async () => {
                const answer = await Taro.showModal({
                  title: "重新加载",
                  content: "将加载服务器资料，未保存的编辑会被替换。",
                });
                if (answer.confirm) void run(load);
              }}
            >
              重新加载资料
            </Button>
          )}
        </View>
      )}
      {!auth.authenticated ? (
        <View className="reg-card">
          <Text className="reg-card-title">
            {entry === "registration" ? "领取你的遇见邀请函" : "进入现场互动"}
          </Text>
          <Text className="reg-copy">
            使用微信登录，保存并找回你的报名和活动进度。
          </Text>
          <View className="reg-consent">
            <Switch
              checked={consent}
              color="#81283e"
              onChange={(e) => setConsent(e.detail.value)}
            />
            <Text>我已阅读并同意活动报名须知与隐私说明</Text>
          </View>
          <Button
            className="reg-link"
            onClick={() => Taro.navigateTo({ url: "/pages/privacy/index" })}
          >
            查看须知与隐私说明
          </Button>
          <Button
            className="reg-primary"
            disabled={!consent || busy || auth.busy || !API_ORIGIN}
            onClick={() =>
              run(async () => {
                await client.login();
                if (client.state().authenticated) await load();
              })
            }
          >
            微信登录
          </Button>
          {!API_ORIGIN && (
            <Text className="reg-copy">开发包尚未配置服务地址</Text>
          )}
        </View>
      ) : !view ? (
        <View className="reg-card">
          <Text>正在加载资料…</Text>
        </View>
      ) : entry === "encounter" ? (
        <View className="reg-card">
          <Text className="reg-card-title">
            {!record
              ? "先领取你的邀请函"
              : record.effectiveStatus === "checked_in"
                ? "欢迎来到遇见现场"
                : record.effectiveStatus === "cancelled"
                  ? "报名已取消"
                  : "出示凭证，完成签到"}
          </Text>
          {record && (
            <View className="reg-digits">
              {record.receipt.split("").map((digit, n) => (
                <Text key={n}>{digit}</Text>
              ))}
            </View>
          )}
          <Text className="reg-copy">
            {record?.effectiveStatus === "checked_in"
              ? "你的报名已核验，可以开始答题与发现同频的人。"
              : "请由现场工作人员核验签到，扫码不会自动签到。"}
          </Text>
          {record && record.status !== "cancelled" && (
            <Button
              className="reg-primary"
              disabled={busy}
              onClick={() => run(() => client.startInteraction())}
            >
              进入现场互动
            </Button>
          )}
          <Button disabled={busy} onClick={() => run(load)}>
            刷新签到状态
          </Button>
          <Button
            className="reg-link"
            onClick={() =>
              Taro.redirectTo({
                url: `/pages/registration/index?activity=${encodeURIComponent(client.activity())}`,
              })
            }
          >
            {record ? "查看邀请函与档案" : "前往报名"}
          </Button>
        </View>
      ) : panel === "basic" ? (
        <View className="reg-card">
          <Text className="reg-card-title">
            {record ? "编辑报名资料" : "认识你，从这里开始"}
          </Text>
          <Field
            name="realName"
            value={fields.realName}
            disabled={busy}
            onChange={(v) => updateField("realName", v)}
          />
          <View className="reg-field">
            <Text>活动昵称</Text>
            <Input
              className="reg-input"
              value={nickname}
              maxlength={12}
              disabled={busy}
              placeholder="现场希望大家如何称呼你"
              onInput={(e) => setNickname(e.detail.value)}
            />
          </View>
          <Field
            name="gender"
            value={fields.gender}
            disabled={busy}
            onChange={(v) => updateField("gender", v)}
          />
          <View className="reg-field">
            <Text>出生日期</Text>
            <View className="reg-date">
              {[
                [years, fields.birthYear, "year"],
                [months, month, "month"],
                [days, day, "day"],
              ].map(([options, value, key]) => (
                <Picker
                  key={key as string}
                  disabled={busy}
                  range={options as string[]}
                  value={Math.max(
                    0,
                    (options as string[]).indexOf(value as string),
                  )}
                  onChange={(e) => {
                    const v = Number(e.detail.value)
                      ? (options as string[])[Number(e.detail.value)]
                      : "";
                    if (key === "year") {
                      updateField("birthYear", v);
                      setDay("");
                    } else if (key === "month") {
                      setMonth(v);
                      setDay("");
                    } else setDay(v);
                  }}
                >
                  <View className="reg-input">
                    {(value as string) || (options as string[])[0]}⌄
                  </View>
                </Picker>
              ))}
            </View>
            {zodiac && <Text className="reg-zodiac">{zodiac}</Text>}
          </View>
          {(["city", "phone"] as TongzhouField[]).map((key) => (
            <Field
              key={key}
              name={key}
              value={fields[key]}
              disabled={busy}
              onChange={(v) => updateField(key, v)}
            />
          ))}
          {!record && (
            <View className="reg-consent">
              <Switch
                color="#81283e"
                checked={consent}
                onChange={(e) => setConsent(e.detail.value)}
              />
              <Text>同意报名须知，仅限年满18周岁的成年人</Text>
            </View>
          )}
          <Button
            className="reg-primary"
            disabled={busy || (!record && !consent)}
            onClick={saveBasic}
          >
            {busy ? "正在保存…" : record ? "保存资料" : "领取邀请函"}
          </Button>
          {record && (
            <Button
              className="reg-link"
              disabled={busy}
              onClick={() => {
                draft(record);
                setPanel(returnPreview ? "profile" : "pass");
                if (returnPreview) setStep("preview");
              }}
            >
              取消编辑
            </Button>
          )}
        </View>
      ) : panel === "pass" && record ? (
        <View className="reg-card reg-pass">
          <Text className="reg-eyebrow">YOUR ENCOUNTER INVITATION</Text>
          <Text className="reg-pass-name">{record.nickname}，期待与你相遇</Text>
          <Text className="reg-card-title">{view.config.title}</Text>
          <Text className="reg-copy">
            {view.config.date || "活动时间以现场通知为准"}
          </Text>
          <Text className="reg-copy">
            {view.config.location || "活动地点以现场通知为准"}
          </Text>
          <View className="reg-ticket">
            <Text>签到凭证</Text>
            <View className="reg-digits">
              {record.receipt.split("").map((digit, n) => (
                <Text key={n}>{digit}</Text>
              ))}
            </View>
            <Text>
              {record.effectiveStatus === "checked_in"
                ? "已签到"
                : record.effectiveStatus === "cancelled"
                  ? "已取消"
                  : "待现场核验"}
            </Text>
          </View>
          <Button
            className="reg-primary"
            disabled={busy}
            onClick={() => {
              draft(record);
              setReturnPreview(false);
              setStep(
                record.profileProgress.saved.includes("album")
                  ? "preview"
                  : record.profileProgress.current,
              );
              setPanel("profile");
            }}
          >
            查看与完善遇见档案
          </Button>
          <Button
            className="reg-link"
            onClick={() => {
              draft(record);
              setReturnPreview(false);
              setPanel("basic");
            }}
          >
            编辑报名资料
          </Button>
        </View>
      ) : (
        record && (
          <View>
            <View className="reg-metro">
              {PROFILE_STEPS.map((item, n) => (
                <View
                  key={item}
                  className={
                    step === item ? "reg-station active" : "reg-station"
                  }
                  onClick={() => {
                    if (!busy) visit(item);
                  }}
                >
                  <Text>{n + 1}</Text>
                  <Text>{labels[item]}</Text>
                </View>
              ))}
            </View>
            {step === "preview" ? (
              <View>
                <View className="reg-saved">
                  <Text>✓ 已保存</Text>
                  <Text>你的遇见档案已保存，随时可以回来完善</Text>
                </View>
                <View className="reg-card">
                  <View className="reg-card-head">
                    <Text>报名资料</Text>
                    <Button
                      className="reg-link"
                      onClick={() => {
                        draft(record);
                        setReturnPreview(true);
                        setPanel("basic");
                      }}
                    >
                      编辑
                    </Button>
                  </View>
                  <Text className="reg-copy">
                    {record.nickname} · {record.fields.gender} ·{" "}
                    {record.fields.city}
                  </Text>
                  <Text className="reg-copy">
                    {record.birthDate || record.fields.birthYear}
                    {record.zodiac ? ` · ${record.zodiac}` : ""}
                  </Text>
                </View>
                {(["life", "expectation", "album"] as const).map((section) => (
                  <View className="reg-card" key={section}>
                    <View className="reg-card-head">
                      <Text>{labels[section]}</Text>
                      <Button
                        className="reg-link"
                        onClick={() => edit(section)}
                      >
                        编辑
                      </Button>
                    </View>
                    {section === "album" ? (
                      <View className="reg-album">
                        {record.photos.map((p) => (
                          <Photo
                            key={p.id}
                            id={p.id}
                            revision={photoRevision}
                          />
                        ))}
                        {!record.photos.length && (
                          <Text className="reg-copy">尚未添加照片</Text>
                        )}
                      </View>
                    ) : (
                      PROFILE_FIELDS[section].map((key) =>
                        record.fields[key] ? (
                          <View className="reg-detail" key={key}>
                            <Text>
                              {
                                TONGZHOU_FIELDS.find((f) => f.key === key)!
                                  .label
                              }
                            </Text>
                            <Text>{record.fields[key]}</Text>
                          </View>
                        ) : null,
                      )
                    )}
                  </View>
                ))}
                <View className="reg-actions">
                  <Button
                    className="reg-primary"
                    onClick={() => setPanel("pass")}
                  >
                    返回报名凭证
                  </Button>
                </View>
              </View>
            ) : (
              <View className="reg-card">
                <Text className="reg-card-title">{labels[step]}</Text>
                {step === "album" ? (
                  <View>
                    <View className="reg-album">
                      {record.photos.map((p) => (
                        <Photo
                          key={p.id}
                          id={p.id}
                          revision={photoRevision}
                          onRemove={
                            busy
                              ? undefined
                              : () => {
                                  void Taro.showModal({
                                    title: "删除照片",
                                    content: "确定从个人相册删除这张照片？",
                                  }).then((answer) => {
                                    if (answer.confirm) {
                                      const id = commandId(),
                                        input = {
                                          photo: p.id,
                                          version: record.version,
                                        };
                                      void run(async () =>
                                        receive(
                                          await client.saveRegistration(
                                            "delete-photo",
                                            input,
                                            id,
                                          ),
                                        ),
                                      );
                                    }
                                  });
                                }
                          }
                        />
                      ))}
                    </View>
                    <Button
                      disabled={busy || record.photos.length >= 6}
                      onClick={upload}
                    >
                      添加生活照片 · {record.photos.length}/6
                    </Button>
                    <View className="reg-consent">
                      <Switch
                        checked={agency}
                        disabled={busy}
                        color="#81283e"
                        onChange={(e) => setAgency(e.detail.value)}
                      />
                      <Text>
                        寻求同舟专业服务，同意将填报资料与相册提供给同舟婚恋工作人员联系与服务。
                      </Text>
                    </View>
                  </View>
                ) : (
                  [
                    ...(step === "life" ? ["realName" as TongzhouField] : []),
                    ...PROFILE_FIELDS[step].filter(
                      (key) => step !== "life" || key !== "realName",
                    ),
                  ].map((key) => (
                    <Field
                      key={key}
                      name={key}
                      value={fields[key]}
                      disabled={busy}
                      onChange={(v) => updateField(key, v)}
                    />
                  ))
                )}
                <Button
                  className="reg-primary"
                  disabled={busy}
                  onClick={saveStep}
                >
                  {busy
                    ? "正在保存…"
                    : returnPreview
                      ? "保存并返回档案"
                      : step === "album"
                        ? "保存并查看档案"
                        : "保存并继续"}
                </Button>
                <Button
                  className="reg-link"
                  disabled={busy}
                  onClick={() => {
                    draft(record);
                    setPanel("pass");
                  }}
                >
                  返回报名凭证
                </Button>
              </View>
            )}
          </View>
        )
      )}
      <Text className="reg-footer">遇见 · 缘分实验室</Text>
    </View>
  );
}
