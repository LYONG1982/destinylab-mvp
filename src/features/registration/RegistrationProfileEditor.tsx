"use client";
import { useEffect, useRef, useState } from "react";
import type { RegistrationRecord } from "@/domain/registration";
import {
  PROFILE_FIELDS,
  PROFILE_STEPS,
  isProfileStep,
  profilePatch,
  type ProfileStep,
} from "@/domain/registration-profile";
import { TONGZHOU_FIELDS, type TongzhouField } from "@/domain/tongzhou";
import { MetroStepper } from "./MetroStepper";
import { useProfileEditor } from "./useProfileEditor";
const titles: Record<ProfileStep, [string, string]> = {
  life: ["让我们，多了解一点你", "每一个小细节，都是独一无二的你。"],
  expectation: ["你期待，遇见怎样的人？", ""],
  album: ["分享一点，你眼中的生活。", "一张照片，也许就是故事的开始。"],
  preview: ["这就是，独一无二的你。", "你的遇见档案已保存，随时可以回来完善"],
};
export function RegistrationProfileEditor({
  activity,
  initial,
  onRecord,
  onExit,
  onGuard,
  onEditBasic,
}: {
  activity: string;
  initial: RegistrationRecord;
  onRecord: (r: RegistrationRecord) => void;
  onExit: () => void;
  onEditBasic: () => void;
  onGuard: (guard: (() => Promise<boolean>) | null) => void;
}) {
  const editor = useProfileEditor(activity, initial, onRecord);
  const [step, setStep] = useState<ProfileStep>(() => {
    const requested =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("step")
        : null;
    return isProfileStep(requested)
      ? requested
      : initial.profileProgress.current;
  });
  const [returnPreview, setReturnPreview] = useState(
      () =>
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("from") === "preview",
    ),
    [photoPreview, setPhotoPreview] = useState("");
  const [failedUpload, setFailedUpload] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const latest = useRef(editor);
  const stepRef = useRef(step);
  useEffect(() => {
    latest.current = editor;
    stepRef.current = step;
  }, [editor, step]);
  function locate(next: ProfileStep, replace = false, fromPreview = false) {
    if (next === "preview") latest.current.resetPreview();
    setStep(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "details");
    url.searchParams.set("step", next);
    if (fromPreview) url.searchParams.set("from", "preview");
    else url.searchParams.delete("from");
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    const pop = async () => {
      const url = new URL(window.location.href),
        s = url.searchParams.get("step");
      if (url.searchParams.get("view") === "details" && isProfileStep(s)) {
        const e = latest.current;
        if (e.blocked.current) {
          url.searchParams.set("step", stepRef.current);
          window.history.replaceState(null, "", url);
          return;
        }
        if (
          stepRef.current !== "preview" &&
          (e.dirty || e.conflicts.length || e.uncertain) &&
          !(await e.save(stepRef.current, s))
        ) {
          url.searchParams.set("step", stepRef.current);
          window.history.replaceState(null, "", url);
          return;
        }
        if (s === "preview") {
          if (stepRef.current === "preview") void e.loadPreview();
          else e.resetPreview();
        }
        setStep(s);
        setReturnPreview(url.searchParams.get("from") === "preview");
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    onGuard(async () => {
      const e = latest.current;
      if (e.blocked.current) return false;
      if (stepRef.current === "preview") return true;
      if (!e.dirty && !e.conflicts.length && !e.uncertain) return true;
      if (await e.save(stepRef.current, stepRef.current)) return true;
      return window.confirm(
        "资料尚未保存到服务器。保留此浏览器草稿并返回凭证？关闭浏览器可能丢失未同步内容。",
      );
    });
    return () => onGuard(null);
  }, [onGuard]);
  const changed =
    Object.keys(profilePatch(editor.record.fields, editor.draft.fields, step))
      .length > 0 ||
    (step === "album" && editor.draft.agency !== editor.record.agencyAllowed);
  useEffect(() => {
    if (
      !editor.ready ||
      editor.busy ||
      editor.error ||
      editor.conflicts.length ||
      !changed ||
      step === "preview"
    )
      return;
    const timer = setTimeout(() => void latest.current.save(step), 700);
    return () => clearTimeout(timer);
  }, [
    editor.ready,
    editor.busy,
    editor.error,
    editor.conflicts.length,
    editor.draft,
    changed,
    step,
  ]);
  useEffect(() => {
    if (step === "preview" && editor.ready) void latest.current.loadPreview();
  }, [step, editor.ready]);
  const unsynced =
    editor.dirty ||
    editor.conflicts.length > 0 ||
    editor.uncertain ||
    !!failedUpload;
  const previewSaved =
    !!editor.preview && !editor.readError && !editor.busy && !unsynced;
  async function navigate(
    target: ProfileStep,
    fromPreview = step === "preview" || returnPreview,
  ) {
    if (editor.blocked.current || target === step) return;
    if (step === "album" && failedUpload) {
      editor.setNotice("照片尚未上传成功，请重新上传，或取消本次上传后继续。");
      return;
    }
    if (step === "preview" || (await editor.save(step, target))) {
      setReturnPreview(fromPreview);
      locate(target, false, fromPreview);
    }
  }
  async function next() {
    if (step === "preview") return;
    const target = returnPreview
      ? "preview"
      : PROFILE_STEPS[PROFILE_STEPS.indexOf(step) + 1];
    await navigate(target, false);
  }
  function field(k: TongzhouField) {
    const f = TONGZHOU_FIELDS.find((f) => f.key === k)!;
    return (
      <label className={`reg-field ${f.multiline ? "reg-wide" : ""}`} key={k}>
        <span id={`profile-label-${k}`}>{f.label}</span>
        {f.options ? (
          <select
            aria-labelledby={`profile-label-${k}`}
            value={editor.draft.fields[k]}
            onChange={(e) => editor.changeField(k, e.target.value)}
          >
            <option value="">暂不填写</option>
            {f.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : f.multiline ? (
          <>
            <textarea
              aria-labelledby={`profile-label-${k}`}
              rows={4}
              maxLength={f.maxLength}
              value={editor.draft.fields[k]}
              placeholder={
                k === "expectations"
                  ? "你最期待的相处方式是什么？"
                  : k === "family"
                    ? "简单介绍你的家庭与生活氛围。"
                    : "写一点关于你"
              }
              onChange={(e) => editor.changeField(k, e.target.value)}
            />
            <small className="reg-count">
              {editor.draft.fields[k].length}/{f.maxLength}
            </small>
          </>
        ) : (
          <input
            aria-labelledby={`profile-label-${k}`}
            inputMode={k === "height" ? "numeric" : "text"}
            autoComplete="off"
            maxLength={f.maxLength || 40}
            value={editor.draft.fields[k]}
            placeholder={
              k === "height"
                ? "如 168"
                : k === "contactTime"
                  ? "如 工作日 18:00 后"
                  : "选填"
            }
            onChange={(e) => editor.changeField(k, e.target.value)}
          />
        )}
      </label>
    );
  }
  function previewCard(section: ProfileStep, label: string) {
    const saved = editor.preview;
    if (!saved) return null;
    const values = PROFILE_FIELDS[section].filter((k) => saved.fields[k]);
    return (
      <section className="reg-preview-card" key={section}>
        <header>
          <h2>{label}</h2>
          <button
            type="button"
            className="reg-inline"
            disabled={editor.busy}
            aria-label={`编辑${label}`}
            onClick={() => void navigate(section, true)}
          >
            编辑 <span aria-hidden="true">↗</span>
          </button>
        </header>
        {section === "album" ? (
          <>
            <div className="reg-album">
              {saved.photos.map((p) => (
                <button
                  type="button"
                  className="reg-preview-photo"
                  key={p.id}
                  onClick={() => setPhotoPreview(p.url)}
                >
                  <img src={p.thumbnail} alt="我的生活照片" />
                </button>
              ))}
            </div>
            {!saved.photos.length && <p className="reg-empty">暂未添加照片</p>}
            <p className="reg-privacy">
              {saved.agencyAllowed
                ? "已选择同舟专业服务，资料与相册提供给机构。"
                : "尚未选择同舟专业服务。"}
              照片不会自动公开展示。
            </p>
          </>
        ) : values.length ? (
          <dl>
            {values.map((k) => (
              <div key={k}>
                <dt>{TONGZHOU_FIELDS.find((f) => f.key === k)?.label}</dt>
                <dd>
                  {saved.fields[k]}
                  {k === "height" ? " cm" : ""}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="reg-empty">暂未填写</p>
        )}
      </section>
    );
  }
  async function upload(f: File) {
    if (await editor.photo(f)) setFailedUpload(null);
    else setFailedUpload(f);
  }
  return (
    <div
      className="reg-profile-editor"
      aria-busy={editor.busy}
      data-save-state={
        editor.error ? "error" : editor.dirty ? "dirty" : "saved"
      }
    >
      <section className="reg-body">
        <MetroStepper
          current={step}
          saved={[
            ...editor.record.profileProgress.saved.filter(
              (s) => s !== "preview",
            ),
            ...(previewSaved ? ["preview" as const] : []),
          ].filter(
            (s) =>
              !Object.keys(
                profilePatch(editor.record.fields, editor.draft.fields, s),
              ).length &&
              !(
                ["album", "preview"].includes(s) &&
                editor.draft.agency !== editor.record.agencyAllowed
              ),
          )}
          busy={editor.busy}
          onSelect={(s) => void navigate(s)}
        />
        <div className="reg-profile-heading">
          <p className="reg-station-caption">
            第 {String(PROFILE_STEPS.indexOf(step) + 1).padStart(2, "0")} 站 ·
            我的遇见档案
          </p>
          <h1 ref={title} tabIndex={-1}>
            {titles[step][0]}
          </h1>
          {(step === "preview" || titles[step][1]) && (
            <p>
              {step === "preview" && !previewSaved
                ? "查看服务器已保存的档案，随时可以回来完善"
                : titles[step][1]}
            </p>
          )}
        </div>
        {(step === "preview" ||
          editor.busy ||
          editor.conflicts.length > 0 ||
          editor.error ||
          editor.dirty) && (
          <p className="reg-save-state" role="status" aria-live="polite">
            {step === "preview"
              ? editor.busy || (!editor.preview && !editor.readError)
                ? "正在读取已保存的档案…"
                : editor.readError
                  ? "档案读取未完成"
                  : unsynced
                    ? "以下为服务器已保存版本，仍有未同步内容"
                    : "✓ 已保存"
              : editor.busy
                ? "正在保存，请稍候…"
                : editor.conflicts.length
                  ? "有更新需要你确认"
                  : editor.error
                    ? "保存未完成，输入已保留"
                    : editor.dirty
                      ? "有尚未保存的修改"
                      : ""}
          </p>
        )}
        {step !== "preview" && editor.conflicts.length > 0 && (
          <section className="reg-conflicts" aria-label="资料冲突">
            <h2>请核对更新</h2>
            <p>以下内容在其他页面发生了变化，请选择保留哪一份。</p>
            {editor.conflicts.map((k) => (
              <div key={k}>
                <strong>
                  {k === "agency"
                    ? "同舟服务选择"
                    : TONGZHOU_FIELDS.find((f) => f.key === k)?.label}
                </strong>
                <p>
                  我的草稿：
                  {k === "agency"
                    ? String(editor.draft.agency)
                    : editor.draft.fields[k] || "未填写"}
                </p>
                <p>
                  服务器最新：
                  {k === "agency"
                    ? String(editor.record.agencyAllowed)
                    : editor.record.fields[k] || "未填写"}
                </p>
              </div>
            ))}
            <button
              className="reg-secondary"
              onClick={() => editor.resolve("draft")}
            >
              保留我的草稿
            </button>
            <button
              className="reg-text"
              onClick={() => editor.resolve("server")}
            >
              使用服务器最新内容
            </button>
          </section>
        )}
        <form
          id="registration-profile"
          onSubmit={(e) => {
            e.preventDefault();
            void next();
          }}
        >
          <div className="reg-station-content" key={step}>
            {step === "life" && (
              <>
                {field("realName")}
                {[
                  ["基本生活", ["maritalStatus", "children", "height"]],
                  ["工作与生活", ["education", "occupation", "income"]],
                  ["生活条件", ["housing", "vehicle"]],
                ].map(([label, keys]) => (
                  <fieldset className="reg-profile-group" key={label as string}>
                    <legend>{label}</legend>
                    <div className="reg-form-grid">
                      {(keys as TongzhouField[]).map(field)}
                    </div>
                  </fieldset>
                ))}
                <details className="reg-more">
                  <summary>更多个人信息 · 选填</summary>
                  {field("ethnicity")}
                </details>
              </>
            )}
            {step === "expectation" && (
              <>{PROFILE_FIELDS.expectation.map(field)}</>
            )}
            {step === "album" && (
              <>
                <p className="reg-section-note">
                  <span aria-label="已上传照片数量">
                    {editor.record.photos.length}/6 张
                  </span>
                </p>
                <div className="reg-album">
                  {editor.record.photos.map((p) => (
                    <div className="reg-photo" key={p.id}>
                      <button
                        type="button"
                        aria-label="预览照片"
                        onClick={() => setPhotoPreview(p.url)}
                      >
                        <img src={p.thumbnail} alt="我的生活照片" />
                      </button>
                      <button
                        className="reg-photo-delete"
                        type="button"
                        aria-label="删除照片"
                        disabled={editor.busy}
                        onClick={() => {
                          if (window.confirm("删除这张照片？"))
                            void editor.photo(p.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {editor.record.photos.length < 6 && (
                    <button
                      type="button"
                      className="reg-upload"
                      disabled={editor.busy}
                      onClick={() => file.current?.click()}
                    >
                      <span aria-hidden="true">＋</span>
                      {editor.busy ? "处理中…" : "添加照片"}
                    </button>
                  )}
                </div>
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
                {failedUpload && (
                  <>
                    <button
                      type="button"
                      className="reg-text"
                      disabled={editor.busy}
                      onClick={() => void upload(failedUpload)}
                    >
                      重新上传这张照片
                    </button>
                    <button
                      type="button"
                      className="reg-text"
                      disabled={editor.busy}
                      onClick={() => setFailedUpload(null)}
                    >
                      取消本次上传
                    </button>
                  </>
                )}
                <p className="reg-privacy">
                  JPG / PNG / WebP，每张不超过 10MB，最多 6
                  张。照片即时保存至私有相册，不会自动展示到大屏或公开主页。
                </p>
                <div className="reg-service">
                  <h2>让专业陪伴，靠近你的期待</h2>
                  <p>同舟婚恋专业服务 · 自愿选择</p>
                  <label className="reg-check">
                    <input
                      type="checkbox"
                      checked={editor.draft.agency}
                      onChange={(e) => editor.changeAgency(e.target.checked)}
                    />
                    <span>
                      我希望获得同舟专业服务，同意将本次资料与相册提供给同舟婚恋，用于联系和人工服务。
                    </span>
                  </label>
                  <small>
                    保存后生效。提供给机构不等于公开展示，个人主页仍由工作人员另行设置和发布。
                  </small>
                </div>
              </>
            )}
            {step === "preview" && editor.preview && !editor.busy && (
              <>
                <p className="reg-privacy reg-preview-notice">
                  这是你自己的私有预览，不代表以下内容会对外公开。
                </p>
                {unsynced && (
                  <p className="reg-profile-error" role="alert">
                    此浏览器仍有未同步的修改或待确认的操作。请通过顶部站点或下方“编辑”返回对应站完成保存；草稿会保留。
                  </p>
                )}
                <section className="reg-birth-preview">
                  <div>
                    <strong>出生日期</strong>
                    <span>
                      {editor.preview.birthDate ||
                        `${editor.preview.fields.birthYear} 年`}
                    </span>
                    {editor.preview.zodiac && (
                      <span className="reg-zodiac">
                        {editor.preview.zodiac}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="reg-inline"
                    onClick={onEditBasic}
                  >
                    编辑出生日期
                  </button>
                </section>
                {previewCard("life", "生活情况")}
                {previewCard("expectation", "择偶期待")}
                {previewCard("album", "个人相册")}
              </>
            )}
          </div>
        </form>
        {step === "preview" && editor.readError && (
          <div className="reg-profile-error" role="alert">
            {editor.readError}
            <button
              type="button"
              className="reg-text"
              disabled={editor.busy}
              onClick={() => void editor.loadPreview()}
            >
              重试读取
            </button>
          </div>
        )}
        {step !== "preview" && editor.error && (
          <div className="reg-profile-error" role="alert">
            {editor.error}
            <button
              type="button"
              className="reg-text"
              disabled={editor.busy || !!editor.conflicts.length}
              onClick={() => void (returnPreview ? next() : editor.save(step))}
            >
              重试保存
            </button>
          </div>
        )}
        {step !== "preview" && editor.notice && (
          <p className="reg-profile-notice" role="status">
            {editor.notice}
          </p>
        )}
      </section>
      <div className="reg-bottom">
        {step === "preview" ? (
          <button
            type="button"
            className="reg-primary"
            disabled={editor.busy}
            onClick={onExit}
          >
            返回报名凭证
          </button>
        ) : (
          <>
            <button
              className="reg-primary"
              form="registration-profile"
              disabled={
                !editor.ready || editor.busy || !!editor.conflicts.length
              }
            >
              {editor.busy
                ? "正在保存…"
                : returnPreview
                  ? "保存并返回预览"
                  : step === "album"
                    ? "完成填写，预览档案"
                    : "保存并前往下一站"}
            </button>
            <div className="reg-profile-secondary">
              {step !== "life" && (
                <button
                  type="button"
                  className="reg-text"
                  disabled={editor.busy}
                  onClick={() =>
                    void navigate(
                      PROFILE_STEPS[PROFILE_STEPS.indexOf(step) - 1],
                    )
                  }
                >
                  返回上一站
                </button>
              )}
              <button
                type="button"
                className="reg-text"
                disabled={editor.busy}
                onClick={onExit}
              >
                返回报名凭证
              </button>
            </div>
            <p className="reg-bottom-hint">选填内容可跳过，也可以稍后再来</p>
          </>
        )}
      </div>
      {photoPreview && (
        <div
          className="reg-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="照片预览"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPhotoPreview("");
          }}
        >
          <button
            autoFocus
            className="reg-close"
            aria-label="关闭照片预览"
            onClick={() => setPhotoPreview("")}
          >
            ×
          </button>
          <img src={photoPreview} alt="生活照片大图" />
        </div>
      )}
    </div>
  );
}
