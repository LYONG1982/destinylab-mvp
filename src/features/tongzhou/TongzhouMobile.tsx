"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {isLive} from "@/lib/api/live-client";
import { useEffect, useRef, useState } from "react";
import {
  Brand,
  Button,
  DemoLink,
  Footer,
  Icon,
  Loading,
  Modal,
  Notice,
} from "@/components/ui";
import { person, routeFor } from "@/domain/selectors";
import {
  emptyTongzhouProfile,
  ownTongzhouSubmission,
  TONGZHOU_CONSENT_TEXT,
  TONGZHOU_CONSENT_VERSION,
  TONGZHOU_FIELDS,
  validateTongzhouProfile,
  type TongzhouField,
  type TongzhouProfile,
  type TongzhouSubmission,
} from "@/domain/tongzhou";
import type { DemoState, Participant } from "@/domain/types";
import { useAction, useDemo } from "@/lib/demo/hooks";
import { submissionTime, TongzhouDetails } from "./TongzhouDetails";

export function TongzhouEntry({
  state,
  actor,
  questionId,
  disabled,
  canLeave,
}: {
  state: DemoState;
  actor: string;
  questionId?: string;
  disabled?: boolean;
  canLeave?: () => boolean;
}) {
  const submitted = ownTongzhouSubmission(state, actor)?.status === "active";
  if (state.live && document.documentElement.dataset.tongzhou === "false") return null;
  return (
    <aside className="tongzhou-entry">
      <div className="eyebrow">TONGZHOU · 同舟婚恋</div>
      <p>同舟专业婚恋服务</p>
      <span className="fine">填写资料，让同舟顾问了解你的婚恋需求，为后续联系与服务做好准备。</span>
      <Link href={questionId ? `/mobile/tongzhou?from=questions&q=${questionId}` : "/mobile/tongzhou"} aria-disabled={disabled} onClick={e=>{if(disabled || canLeave?.() === false)e.preventDefault();}}>
        {submitted ? "查看我的填报" : "申请同舟专业婚恋服务"}
        <Icon name="arrow" size={17} />
      </Link>
      <small>自愿填报，后续由同舟在线下联系与服务</small>
    </aside>
  );
}

export function TongzhouMobile() {
  const { state, actor, problem, unreadable } = useDemo();
  if (!state) return <Loading />;
  const me = person(state, actor);
  if (!me || unreadable)
    return (
      <main className="mobile-shell tongzhou-unavailable">
        <Brand />
        <Notice tone="error">{problem || "请先选择参与者身份。"}</Notice>
        <DemoLink />
      </main>
    );
  const submission = ownTongzhouSubmission(state, actor);
  return (
    <TongzhouPage
      key={`${state.epoch}:${actor}:${submission?.version || 0}`}
      state={state}
      me={me}
      submission={submission}
    />
  );
}

function TongzhouPage({
  state,
  me,
  submission,
}: {
  state: DemoState;
  me: Participant;
  submission?: TongzhouSubmission;
}) {
  const [editing, setEditing] = useState(!submission);
  const [confirm, setConfirm] = useState<"withdraw" | "delete" | null>(null);
  const a = useAction(me.id);
  const query = useSearchParams();
  const returningQuestion = query.get("from") === "questions" && /^q([2-9]|10)$/.test(query.get("q") || "") ? query.get("q") : null;
  const back = returningQuestion ? `/mobile/04-question?q=${returningQuestion}` : `/mobile/${routeFor(state, me)}`;
  const status = submission?.status;
  return (
    <main className="mobile-shell tongzhou-mobile">
      <header className="mobile-header">
        <Brand />
        <span>
          同舟婚恋
          <br />
          自愿资料填报
        </span>
      </header>
      <div className="mobile-utility">
        <Link className="back-link" href={back}>
          <Icon name="back" size={16} />
          {returningQuestion ? "返回继续答题" : "返回现场"}
        </Link>
        <span>{me.name}的填报</span>
      </div>
      <div className="page-hero">
        <div className="eyebrow">LET US KNOW YOU</div>
        <h1>
          让同舟<span>了解你</span>
        </h1>
        <p>留下你的真实期待，后续由同舟在线下联系、了解需求与人工匹配。</p>
      </div>
      <div className="mobile-content">
        <Notice>
          {state.live ? "自愿提交，授权后仅同舟婚恋可查看本次填报。你可以随时修改、撤回授权或删除资料。" : "本地演示，请勿填写真实个人信息。资料仅保存在此浏览器，尚未发送给同舟。"}
        </Notice>
        {editing ? (
          <TongzhouForm
            me={me}
            submission={submission}
            onCancel={submission ? () => setEditing(false) : undefined}
          />
        ) : (
          <>
            <section
              className="tongzhou-receipt"
              aria-labelledby="receipt-title"
            >
              <span className="tongzhou-receipt-mark">
                <Icon name={status === "active" ? "check" : "leaf"} size={25} />
              </span>
              <h2 id="receipt-title">
                {status === "active"
                  ? "资料已提交"
                  : status === "withdrawn"
                    ? "授权已撤回"
                    : "填报资料已删除"}
              </h2>
              <p>
                {status === "active"
                  ? state.live ? "同舟婚恋已可查看本次授权资料。你可以随时修改或撤回，后续由同舟联系与服务。" : "你可以随时修改或撤回。本地同舟视角可查看本次授权资料，后续服务在线下完成。"
                  : status === "withdrawn"
                    ? "同舟资料名单中已移除本次填报，你仍可查看或删除自己的资料。"
                    : "填报内容已清除，如有需要可以重新填写。"}
              </p>
              {submission && (
                <small>更新时间：{submissionTime(submission.updatedAt)}</small>
              )}
            </section>
            {submission?.fields && (
              <section className="tongzhou-card">
                <h2>我的填报资料</h2>
                <p className="fine">本人填写 · 信息及手机号未核验</p>
                <TongzhouDetails submission={submission} />
              </section>
            )}
            {a.error && <Notice tone="error">{a.error}</Notice>}
            <Button disabled={a.busy} onClick={() => setEditing(true)}>
              {status === "active"
                ? "修改填报资料"
                : status === "withdrawn"
                  ? "重新授权并提交"
                  : "重新填写资料"}
            </Button>
            {status === "active" && (
              <Button
                kind="secondary"
                disabled={a.busy}
                onClick={() => setConfirm("withdraw")}
              >
                撤回授权
              </Button>
            )}
            {submission?.fields && (
              <Button
                kind="text"
                disabled={a.busy}
                onClick={() => setConfirm("delete")}
              >
                删除填报资料
              </Button>
            )}
          </>
        )}
        <Link className="button button-secondary" href={back}>
          {returningQuestion ? "返回继续答题" : "返回现场探索 / 当前任务"}
        </Link>
      </div>
      <Footer />
      <DemoLink />
      {confirm && (
        <Modal
          title={confirm === "delete" ? "删除填报资料？" : "撤回同舟资料授权？"}
          onClose={() => {
            if (!a.busy) setConfirm(null);
          }}
        >
          <p>
            {confirm === "delete"
              ? "填报内容将被清除，同舟后台同步停止展示。现有现场答题和相遇记录保留。"
              : "撤回后，同舟资料视角将停止展示你的填报。你仍可查看、删除，或自行重新授权。"}
          </p>
          {a.error && <Notice tone="error">{a.error}</Notice>}
          <Button
            kind="danger"
            disabled={a.busy}
            onClick={() =>
              a.run({
                type:
                  confirm === "delete"
                    ? "tongzhou-delete"
                    : "tongzhou-withdraw",
                expectedVersion: submission?.version || 0,
              })
            }
          >
            {a.busy
              ? "正在处理…"
              : confirm === "delete"
                ? "确认删除资料"
                : "确认撤回授权"}
          </Button>
          <Button
            kind="text"
            disabled={a.busy}
            onClick={() => setConfirm(null)}
          >
            暂不操作
          </Button>
        </Modal>
      )}
    </main>
  );
}

function TongzhouForm({
  me,
  submission,
  onCancel,
}: {
  me: Participant;
  submission?: TongzhouSubmission;
  onCancel?: () => void;
}) {
  const [fields, setFields] = useState<TongzhouProfile>(() =>
    submission?.fields
      ? { ...submission.fields }
      : {
          ...emptyTongzhouProfile(),
          gender: me.gender === "male" ? "男" : "女",
        },
  );
  const dirty = JSON.stringify(fields) !== JSON.stringify(submission?.fields || {...emptyTongzhouProfile(),gender:me.gender === "male" ? "男" : "女"});
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const click = (e: MouseEvent) => { if ((e.target as Element).closest("a[href]") && !window.confirm("资料尚未提交，确定放弃本次填写并离开？")) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<TongzhouField, string>>>(
    {},
  );
  const [retryError, setRetryError] = useState("");
  const a = useAction(me.id);
  const feedback = a.error || (a.busy ? retryError : "");
  const ref = useRef<HTMLFormElement>(null);
  function example() {
    setFields({
      ...emptyTongzhouProfile(),
      realName: "演示用户",
      phone: "13800000000",
      gender: me.gender === "male" ? "男" : "女",
      birthYear: "1995",
      city: "银川市",
      ethnicity: "回族",
      maritalStatus: "未婚",
    });
    setErrors({});
    setConsent(false);
    a.setError("");
  }
  function renderField(field: (typeof TONGZHOU_FIELDS)[number]) {
    const id = `tongzhou-${field.key}`;
    const props = {
      id,
      name: field.key,
      value: fields[field.key],
      required: !!field.required,
      "aria-invalid": !!errors[field.key],
      "aria-describedby": `${id}-help`,
      onChange: (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >,
      ) => {
        setFields({ ...fields, [field.key]: e.target.value });
        setErrors({ ...errors, [field.key]: undefined });
      },
    };
    return (
      <div className="tongzhou-field" key={field.key}>
        <label htmlFor={id}>
          {field.label}
          {field.required && <span aria-hidden="true"> *</span>}
        </label>
        {field.options ? (
          <select {...props}>
            <option value="">{field.required ? "请选择" : "暂不填写"}</option>
            {field.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        ) : field.multiline ? (
          <textarea {...props} rows={3} maxLength={field.maxLength} />
        ) : (
          <input
            {...props}
            type={field.key === "phone" ? "tel" : "text"}
            inputMode={
              ["phone", "birthYear", "height"].includes(field.key)
                ? "numeric"
                : "text"
            }
            autoComplete="off"
            maxLength={field.maxLength}
            list={
              field.key === "ethnicity" ? "tongzhou-ethnicities" : undefined
            }
          />
        )}
        <small
          id={`${id}-help`}
          className={errors[field.key] ? "field-error" : "fine"}
        >
          {errors[field.key] || field.hint}
        </small>
      </div>
    );
  }
  return (
    <form
      ref={ref}
      className="tongzhou-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (a.busy) return;
        const checked = validateTongzhouProfile(fields);
        setErrors(checked.errors);
        const first = Object.keys(checked.errors)[0];
        if (first) {
          const control = ref.current?.querySelector<HTMLElement>(
            `#tongzhou-${first}`,
          );
          const section = control?.closest("details");
          if (section) section.open = true;
          control?.focus();
          return;
        }
        if (!consent) {
          a.setError("请阅读并确认本次资料授权。");
          return;
        }
        // Keep the failed message in place while retrying so a second tap
        // cannot land on the return link after the layout shrinks.
        setRetryError(a.error);
        void a.run({
          type: "tongzhou-submit",
          fields: checked.fields,
          consent,
          consentVersion: TONGZHOU_CONSENT_VERSION,
          expectedVersion: submission?.version || 0,
        });
      }}
    >
      <fieldset disabled={a.busy}>
        <section className="tongzhou-card">
          <div className="tongzhou-section-head">
            <h2>基本信息</h2>
            <span>7 项必填</span>
          </div>
          <p className="fine">带 * 为必填，仅用于同舟了解与联系。</p>
          {!isLive() && <Button kind="text" type="button" onClick={example}>
            填入虚构示例
          </Button>}
          <div className="tongzhou-fields">
            {TONGZHOU_FIELDS.filter((field) => field.required).map(renderField)}
          </div>
          <datalist id="tongzhou-ethnicities">
            {[
              "汉族",
              "回族",
              "满族",
              "蒙古族",
              "藏族",
              "壮族",
              "维吾尔族",
              "苗族",
              "彝族",
              "土家族",
              "侗族",
              "瑶族",
              "白族",
              "朝鲜族",
            ].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </section>
        <details className="tongzhou-card tongzhou-optional">
          <summary>
            补充资料<span>选填，可稍后完善</span>
          </summary>
          <p className="fine">帮助同舟进一步了解你，不填写也可提交。</p>
          <div className="tongzhou-fields">
            {TONGZHOU_FIELDS.filter((field) => !field.required).map(
              renderField,
            )}
          </div>
        </details>
        <section className="tongzhou-card tongzhou-consent">
          <h2>资料交给谁、用于什么</h2>
          <p>
            接收方：同舟婚恋。仅使用本次填报资料开展线下联系、需求了解与人工婚恋服务；不包含活动十题答案，不在现场推荐卡或大屏展示。
          </p>
          <p className="fine">
            {isLive() ? "资料保留至你主动删除；撤回授权后同舟停止查看。提交手机号仅用于后续联系，不用于登录或自动分享。" : "当前为本地演示。正式经营主体全称、联系渠道及保存期限将在正式启用前补齐。"}
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{TONGZHOU_CONSENT_TEXT}</span>
          </label>
        </section>
      </fieldset>
      {Object.values(errors).some(Boolean) && (
        <Notice tone="error">请补全或修正标注的资料，再提交。</Notice>
      )}
      {feedback && <Notice tone="error">{feedback}</Notice>}
      <Button type="submit" disabled={a.busy || !consent}>
        {a.busy ? "正在保存资料…" : "确认授权并提交资料"}
      </Button>
      {onCancel && (
        <Button kind="text" type="button" disabled={a.busy} onClick={onCancel}>
          取消修改
        </Button>
      )}
    </form>
  );
}
