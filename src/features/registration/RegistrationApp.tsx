"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  emptyTongzhouProfile,
  TONGZHOU_FIELDS,
  type TongzhouField,
  type TongzhouProfile,
} from "@/domain/tongzhou";
import {
  BASIC_REGISTRATION_FIELDS,
  REGISTRATION_AGENCY_CONSENT,
  REGISTRATION_CONSENT_VERSION,
  REGISTRATION_STATUS,
  type RegistrationRecord,
  type RegistrationView,
} from "@/domain/registration";
import { BirthDateField } from "./BirthDateField";
import {
  joinBirthDate,
  splitBirthDate,
  type BirthParts,
} from "@/domain/birth-date";
import { EncounterPass, EncounterPassSkeleton } from "./EncounterPass";
import { RegistrationProfileEditor } from "./RegistrationProfileEditor";
import { clientId } from "@/lib/client-id";
import { RegistrationApiError, registrationApi } from "./client";
import "./registration.css";
type Screen = "home" | "basic" | "success" | "details" | "info";
export function RegistrationApp() {
  const searchParams = useSearchParams();
  const activity = searchParams.get("activity") || "meet";
  const [view, setView] = useState<RegistrationView | null>(null),
    [screen, setScreen] = useState<Screen>(() =>
      searchParams.get("view") === "success" ? "success" : "home",
    ),
    [fields, setFields] = useState<TongzhouProfile>(emptyTongzhouProfile),
    [nickname, setNickname] = useState(""),
    [birth, setBirth] = useState<BirthParts>({ year: "", month: "", day: "" }),
    [birthConflict, setBirthConflict] = useState(false),
    [consent, setConsent] = useState(false),
    [agency, setAgency] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [terms, setTerms] = useState(false),
    [firstSuccess, setFirstSuccess] = useState(false);
  const lock = useRef(false),
    guard = useRef<null | (() => Promise<boolean>)>(null),
    activeScreen = useRef<Screen>(screen),
    saveAttempt = useRef<{ id: string; body: unknown } | null>(null);
  const setGuard = useCallback((fn: null | (() => Promise<boolean>)) => {
    guard.current = fn;
  }, []);
  const acceptProfile = useCallback((r: RegistrationRecord) => {
    setView((v) => (v ? { ...v, record: r } : v));
    setFields(r.fields);
    setBirth(splitBirthDate(r.fields.birthYear, r.birthDate));
    setNickname(r.nickname);
    setAgency(r.agencyAllowed);
    if (r.status === "cancelled") {
      setFirstSuccess(false);
      setScreen("success");
      activeScreen.current = "success";
      const url = new URL(window.location.href);
      url.searchParams.set("view", "success");
      url.searchParams.delete("step");
      url.searchParams.delete("from");
      window.history.replaceState(null, "", url);
    }
  }, []);
  const api = <T,>(path: string, input?: unknown, upload?: File) =>
    registrationApi<T>(activity, path, input, upload);
  const adopt = (record: RegistrationRecord) => {
    setView((v) => (v ? { ...v, record } : v));
    setFields(record.fields);
    setBirth(splitBirthDate(record.fields.birthYear, record.birthDate));
    setBirthConflict(false);
    setNickname(record.nickname);
    setAgency(record.agencyAllowed);
  };
  useEffect(() => {
    let active = true;
    registrationApi<RegistrationView>(activity, "session", {})
      .then((v) => {
        if (active) {
          setView(v);
          if (v.record) {
            setFields(v.record.fields);
            setBirth(
              splitBirthDate(v.record.fields.birthYear, v.record.birthDate),
            );
            setNickname(v.record.nickname);
            setAgency(v.record.agencyAllowed);
            const target = new URLSearchParams(window.location.search).get(
              "view",
            );
            const restored: Screen =
              target === "details" && v.record.status !== "cancelled"
                ? "details"
                : target === "info"
                  ? "info"
                  : "success";
            setScreen(restored);
            activeScreen.current = restored;
          } else {
            setScreen("home");
            activeScreen.current = "home";
            try {
              for (const key of Object.keys(sessionStorage))
                if (key.startsWith(`dl-profile-draft:${activity}:`))
                  sessionStorage.removeItem(key);
            } catch {}
          }
          try {
            const saved = JSON.parse(
              sessionStorage.getItem(
                `dl-birth-draft:${activity}:${v.record?.id || "new"}`,
              ) || "null",
            );
            const remote = splitBirthDate(
              v.record?.fields.birthYear || "",
              v.record?.birthDate,
            );
            if (
              saved?.schema === 1 &&
              saved.parts &&
              ["year", "month", "day"].every(
                (k) =>
                  typeof saved.parts[k] === "string" &&
                  /^\d{0,4}$/.test(saved.parts[k]),
              )
            ) {
              if (JSON.stringify(saved.parts) !== JSON.stringify(remote)) {
                setBirth(saved.parts);
                setFields((f) => ({ ...f, birthYear: saved.parts.year }));
                setBirthConflict(
                  JSON.stringify(saved.base) !== JSON.stringify(remote),
                );
              }
            }
          } catch {
            /* Unavailable or obsolete draft; the server remains authoritative. */
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [activity]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const move = (next: Screen) => {
    if (next !== "success" || activeScreen.current === "success")
      setFirstSuccess(false);
    setScreen(next);
    activeScreen.current = next;
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    if (next !== "details") {
      url.searchParams.delete("step");
      url.searchParams.delete("from");
    }
    window.history.pushState(null, "", url);
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  async function leaveProfile() {
    if (!guard.current || (await guard.current())) move("success");
  }
  useEffect(() => {
    const pop = async () => {
      const url = new URL(window.location.href),
        value = url.searchParams.get("view");
      const next: Screen = [
        "home",
        "basic",
        "success",
        "details",
        "info",
      ].includes(value || "")
        ? (value as Screen)
        : "success";
      if (
        activeScreen.current === "details" &&
        next !== "details" &&
        guard.current &&
        !(await guard.current())
      ) {
        url.searchParams.set("view", "details");
        window.history.pushState(null, "", url);
        return;
      }
      setFirstSuccess(false);
      setScreen(next);
      activeScreen.current = next;
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "网络连接未完成，请重试；上次获取的状态保持不变。"
          : e instanceof Error
            ? e.message
            : "操作未完成，请重试。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!view || birthConflict || !["basic", "info"].includes(screen)) return;
    const key = `dl-birth-draft:${activity}:${view.record?.id || "new"}`;
    const base = splitBirthDate(
      view.record?.fields.birthYear || "",
      view.record?.birthDate,
    );
    try {
      if (JSON.stringify(birth) === JSON.stringify(base))
        sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({ schema: 1, parts: birth, base }),
        );
    } catch {
      /* Keep in-memory editing available when storage is blocked. */
    }
  }, [activity, birth, birthConflict, screen, view]);
  function returnFromBasic() {
    const fromPreview =
      new URLSearchParams(window.location.search).get("from") === "preview";
    if (fromPreview) {
      const url = new URL(window.location.href);
      url.searchParams.set("step", "preview");
      url.searchParams.delete("from");
      window.history.replaceState(null, "", url);
    }
    return fromPreview ? ("details" as const) : ("success" as const);
  }
  async function persist(next?: Screen) {
    await run(async () => {
      if (birthConflict)
        throw Error(
          "出生日期在其他页面有更新，请先选择保留草稿或使用已保存日期。",
        );
      const birthDate = joinBirthDate(birth);
      const body = {
        nickname,
        fields,
        birthDate,
        version: view?.record?.version || 0,
        consent: consent ? REGISTRATION_CONSENT_VERSION : "",
        agencyAllowed: agency,
        agencyConsent: agency ? REGISTRATION_AGENCY_CONSENT : "",
      };
      if (
        saveAttempt.current &&
        JSON.stringify(saveAttempt.current.body) !== JSON.stringify(body)
      ) {
        await registrationApi(
          activity,
          "save",
          saveAttempt.current.body,
          undefined,
          saveAttempt.current.id,
        );
        saveAttempt.current = null;
        const fresh = await api<RegistrationView>("me");
        setView(fresh);
        throw new Error("上一项提交已确认，当前输入已保留，请核对后再次保存。");
      }
      saveAttempt.current ||= { id: clientId(), body };
      let r: RegistrationRecord;
      try {
        r = await registrationApi<RegistrationRecord>(
          activity,
          "save",
          body,
          undefined,
          saveAttempt.current.id,
        );
        saveAttempt.current = null;
      } catch (e) {
        if (e instanceof RegistrationApiError && e.status < 500)
          saveAttempt.current = null;
        throw e;
      }
      if (!view?.record) setFirstSuccess(true);
      try {
        sessionStorage.removeItem(
          `dl-birth-draft:${activity}:${view?.record?.id || "new"}`,
        );
      } catch {}
      adopt(r);
      if (next)
        move(
          next === "success" && screen === "info" ? returnFromBasic() : next,
        );
      else setNotice("资料已保存");
    });
  }
  const record = view?.record,
    config = view?.config;
  const field = (key: TongzhouField) => {
    if (key === "birthYear")
      return (
        <div key={key} className="reg-wide reg-birth-wrapper">
          <BirthDateField
            value={birth}
            onChange={(v) => {
              setBirth(v);
              setFields((f) => ({ ...f, birthYear: v.year }));
            }}
          />
          {birthConflict && (
            <div className="reg-conflicts" role="alert">
              <p>出生日期已有更新，请选择保留哪一份。</p>
              <button
                type="button"
                className="reg-secondary"
                onClick={() => setBirthConflict(false)}
              >
                保留生日草稿
              </button>
              <button
                type="button"
                className="reg-text"
                onClick={() => {
                  setBirth(
                    splitBirthDate(
                      record?.fields.birthYear || "",
                      record?.birthDate,
                    ),
                  );
                  setFields((f) => ({
                    ...f,
                    birthYear: record?.fields.birthYear || "",
                  }));
                  setBirthConflict(false);
                }}
              >
                使用已保存日期
              </button>
            </div>
          )}
        </div>
      );
    const f = TONGZHOU_FIELDS.find((x) => x.key === key)!;
    const label =
      key === "phone" ? "联系电话" : key === "city" ? "常住城市" : f.label;
    return (
      <label className={`reg-field ${f.multiline ? "reg-wide" : ""}`} key={key}>
        <span>
          {label}
          {(BASIC_REGISTRATION_FIELDS as readonly string[]).includes(key) && (
            <i aria-label="必填"> *</i>
          )}
        </span>
        {f.options ? (
          key === "gender" ? (
            <div className="reg-genders">
              {f.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option === "男" ? "♂ 男生" : "♀ 女生"}
                  aria-pressed={fields[key] === option}
                  onClick={() => setFields((v) => ({ ...v, [key]: option }))}
                >
                  {option === "男" ? "♂ 男生" : "♀ 女生"}
                </button>
              ))}
            </div>
          ) : (
            <select
              value={fields[key]}
              onChange={(e) =>
                setFields((v) => ({ ...v, [key]: e.target.value }))
              }
            >
              <option value="">请选择 · 可暂不填写</option>
              {f.options.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          )
        ) : f.multiline ? (
          <>
            <textarea
              rows={4}
              maxLength={f.maxLength}
              value={fields[key]}
              placeholder={
                key === "expectations"
                  ? "期待怎样的相处？写下你在意的小事。"
                  : key === "family"
                    ? "简单介绍你的家庭与生活氛围。"
                    : "写一点关于你"
              }
              onChange={(e) =>
                setFields((v) => ({ ...v, [key]: e.target.value }))
              }
            />
            <small className="reg-count">
              {fields[key].length}/{f.maxLength}
            </small>
          </>
        ) : (
          <input
            required={(BASIC_REGISTRATION_FIELDS as readonly string[]).includes(
              key,
            )}
            type={key === "phone" ? "tel" : "text"}
            inputMode={
              ["phone", "birthYear", "height"].includes(key)
                ? "numeric"
                : "text"
            }
            autoComplete={key === "phone" ? "tel" : "off"}
            maxLength={f.maxLength || 40}
            value={fields[key]}
            placeholder={
              key === "city"
                ? "如 银川"
                : key === "phone"
                  ? "用于活动联系，不会公开"
                  : key === "contactTime"
                    ? "如 工作日 18:00 后"
                    : "请输入" + label
            }
            onChange={(e) =>
              setFields((v) => ({ ...v, [key]: e.target.value }))
            }
          />
        )}
      </label>
    );
  };
  const nick = (
    <label className="reg-field">
      <span>
        活动昵称<i aria-label="必填"> *</i>
      </span>
      <input
        value={nickname}
        maxLength={5}
        required
        placeholder="希望大家怎样称呼你"
        onChange={(e) => setNickname(e.target.value)}
      />
      <small>1–5 个汉字，现场互动会使用这个昵称</small>
    </label>
  );
  const heading = (eyebrow: string, title: string, sub: string) => (
    <div className="reg-heading">
      <p className="reg-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
  const eventInfo = (
    <div className="reg-event">
      <p>
        <span>◷</span>
        {config?.date || "活动时间待公布"}
      </p>
      <p>
        <span>⌖</span>
        {config?.location || "活动地点待公布"}
      </p>
    </div>
  );
  return (
    <main
      className={`registration ${screen === "home" ? "registration-home" : "registration-v12"} ${screen === "success" ? "registration-pass" : ""}`}
    >
      <div className="reg-shell">
        <header className="reg-nav">
          {screen === "home" ? (
            <span className="reg-brand">
              遇见 <b>·</b> 缘分实验室
            </span>
          ) : (
            <button
              type="button"
              aria-label="返回"
              onClick={() => {
                if (screen === "details") void leaveProfile();
                else
                  move(
                    screen === "basic" || screen === "success"
                      ? "home"
                      : "success",
                  );
              }}
            >
              ‹
            </button>
          )}
          <span>
            {screen === "home"
              ? "MEET IN YINCHUAN"
              : screen === "basic"
                ? "活动报名"
                : screen === "details"
                  ? "我的遇见档案"
                  : screen === "info"
                    ? "我的报名"
                    : "遇见 · 缘分实验室"}
          </span>
          {screen !== "home" && <span className="reg-nav-spacer" />}
        </header>
        {screen === "home" && (
          <>
            <section className="reg-hero">
              <div className="reg-hero-copy">
                <p className="reg-eyebrow">
                  {config?.title || "爱在凤城 · 初冬有约"}
                </p>
                <h1>
                  在凤城
                  <br />
                  {config?.headline || "认真遇见一个人"}
                </h1>
                <p>
                  遇见，是故事的开始
                  <br />
                  也是温暖的抵达。
                </p>
                <span className="reg-heart" aria-hidden="true">
                  ♡
                </span>
              </div>
              <div className="reg-photo-caption">好的相遇，从一座城市开始</div>
            </section>
            <section className="reg-home-content">
              {eventInfo}
              <div className="reg-features">
                <div>
                  <span>♡</span>
                  <strong>轻松认识</strong>
                  <small>让第一句问候自然发生</small>
                </div>
                <div>
                  <span>✧</span>
                  <strong>同频相遇</strong>
                  <small>从一个共同话题开始</small>
                </div>
              </div>
              <p className="reg-home-note">
                {config?.description || "给自己一次机会，让相遇慢慢发生。"}
              </p>
              <button
                className="reg-primary"
                disabled={!view || busy || (!record && !config?.open)}
                onClick={() => move(record ? "success" : "basic")}
              >
                {record
                  ? "查看我的报名"
                  : config?.open
                    ? "我要报名"
                    : "报名暂未开放"}
              </button>
              <button
                className="reg-text"
                disabled={!view}
                onClick={() => {
                  if (record) move("success");
                  else
                    setNotice(
                      "当前浏览器暂无报名记录。已在其他设备报名，请使用原设备查看或联系工作人员。",
                    );
                }}
              >
                查看我的报名 <span>→</span>
              </button>
              <footer>
                LOVE YINCHUAN <span>遇见 · 相知 · 相伴</span>
              </footer>
            </section>
          </>
        )}
        {screen === "basic" && (
          <>
            <section className="reg-body">
              {heading(
                "A LITTLE ABOUT YOU",
                "先认识一下你",
                "简单填写，给相遇一个开始。",
              )}
              <div className="reg-step">
                <span>01 基本信息</span>
                <span>02 报名完成</span>
              </div>
              <form
                id="registration-basic"
                onSubmit={(e) => {
                  e.preventDefault();
                  void persist("success");
                }}
              >
                {nick}
                <div className="reg-form-grid">
                  {BASIC_REGISTRATION_FIELDS.map(field)}
                </div>
                <label className="reg-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    我已阅读并同意
                    <button
                      type="button"
                      className="reg-inline"
                      onClick={() => setTerms(true)}
                    >
                      《活动报名须知》
                    </button>
                  </span>
                </label>
                <p className="reg-footnote">生活资料与照片，可在报名后补充。</p>
              </form>
            </section>
            <div className="reg-bottom">
              <button
                className="reg-primary"
                form="registration-basic"
                disabled={busy || !consent}
              >
                {busy ? "正在提交…" : "确认报名"}
              </button>
            </div>
          </>
        )}
        {screen === "success" && record && (
          <EncounterPass
            record={record}
            config={config}
            busy={busy}
            firstSuccess={firstSuccess}
            onRefresh={() =>
              void run(async () => {
                const v = await api<RegistrationView>("me");
                if (!v.record) throw Error("未找到当前报名，请联系工作人员。");
                const previous = record.effectiveStatus;
                setView(v);
                adopt(v.record);
                setNotice(
                  v.record.effectiveStatus === previous
                    ? "状态未变化，已获取最新签到状态。"
                    : v.record.effectiveStatus === "checked_in"
                      ? "签到已确认，可以进入活动。"
                      : "签到状态已更新。",
                );
              })
            }
            onCopy={() =>
              void run(async () => {
                await navigator.clipboard.writeText(record.receipt);
                setNotice("遇见码已复制");
              })
            }
            onProfile={() => {
              const url = new URL(window.location.href);
              url.searchParams.set(
                "step",
                record.profileConfirmedAt ||
                  record.profileProgress.saved.includes("album")
                  ? "preview"
                  : record.profileProgress.current,
              );
              window.history.replaceState(null, "", url);
              move("details");
            }}
            onDetails={() => move("info")}
            onEnter={() =>
              void run(async () => {
                const v = await api<{ url: string }>("enter", {});
                window.location.assign(v.url);
              })
            }
          />
        )}
        {screen === "success" && !view && !error && <EncounterPassSkeleton />}
        {screen === "details" && record && record.status !== "cancelled" && (
          <RegistrationProfileEditor
            key={record.id}
            activity={activity}
            initial={record}
            onRecord={acceptProfile}
            onExit={() => void leaveProfile()}
            onGuard={setGuard}
            onEditBasic={() => {
              move("info");
              const url = new URL(window.location.href);
              url.searchParams.set("from", "preview");
              window.history.replaceState(null, "", url);
            }}
          />
        )}
        {screen === "info" && record && (
          <>
            <section className="reg-body">
              {heading(
                "MY REGISTRATION",
                "关于你的报名",
                "基本信息可随时核对和修改。",
              )}
              <p className="reg-section-note">
                当前状态：{REGISTRATION_STATUS[record.status]}
              </p>
              <form
                id="registration-info"
                onSubmit={(e) => {
                  e.preventDefault();
                  void persist("success");
                }}
              >
                {nick}
                {BASIC_REGISTRATION_FIELDS.map(field)}
                <p className="reg-footnote">
                  联系电话仅用于活动联系，尚未进行短信核验。修改报名资料不会改写已有互动答案。
                </p>
              </form>
            </section>
            <div className="reg-bottom">
              <button
                className="reg-primary"
                form="registration-info"
                disabled={busy || record.status === "cancelled"}
              >
                保存修改
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="reg-message reg-error" role="alert">
            {error}
            <button
              onClick={() =>
                void run(async () => {
                  const v = await api<RegistrationView>("session", {});
                  setView(v);
                  if (v.record) adopt(v.record);
                  setNotice("已刷新最新资料，请重新操作。");
                })
              }
            >
              刷新资料
            </button>
          </div>
        )}
        {notice && (
          <div className="reg-message" role="status">
            {notice}
          </div>
        )}
        {!view && !error && (
          <div className="reg-loading" role="status">
            正在读取活动信息…
          </div>
        )}
        {terms && (
          <div
            className="reg-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="活动报名须知"
          >
            <button
              className="reg-close"
              onClick={() => {
                setTerms(false);
              }}
              aria-label="关闭"
            >
              ×
            </button>
            <article>
              <h2>活动报名须知</h2>
              <p>
                本活动面向成年人。请填写本人真实有效的资料，联系电话用于活动安排与必要联系，目前未进行短信核验。
              </p>
              <p>
                报名成功后保留凭证，到场由工作人员核验签到。昵称用于现场互动；联系电话、生活资料和相册不会随报名自动公开到大屏。
              </p>
              <p>
                补充资料和照片自愿填写，运营工作人员可查看报名资料。只有你主动选择同舟专业服务后，资料和相册才会提供给同舟机构。
              </p>
              <p>
                请在当前浏览器查看和修改报名。更换设备或清除浏览器记录后，请联系工作人员核验，勿重复报名。
              </p>
              <button className="reg-primary" onClick={() => setTerms(false)}>
                我已了解
              </button>
            </article>
          </div>
        )}
      </div>
    </main>
  );
}
