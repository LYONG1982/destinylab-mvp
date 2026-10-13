"use client";
import {
  REGISTRATION_STATUS,
  type RegistrationConfig,
  type RegistrationRecord,
} from "@/domain/registration";
import { displayEncounterCode, encounterDate } from "./encounter-pass";
export function EncounterPass({
  record,
  config,
  busy,
  firstSuccess,
  onRefresh,
  onCopy,
  onProfile,
  onDetails,
  onEnter,
}: {
  record: RegistrationRecord;
  config?: RegistrationConfig;
  busy: boolean;
  firstSuccess: boolean;
  onRefresh: () => void;
  onCopy: () => void;
  onProfile: () => void;
  onDetails: () => void;
  onEnter: () => void;
}) {
  const date = encounterDate(config?.date || "");
  const cancelled = record.effectiveStatus === "cancelled";
  return (
    <section className="reg-body reg-pass-page">
      <header className="reg-pass-heading">
        <p className="reg-pass-eyebrow">ENCOUNTER PASS</p>
        <h1>{cancelled ? "报名已取消" : "我的遇见邀请函"}</h1>
        <p>
          {cancelled
            ? "如需帮助，请联系现场工作人员。"
            : "带上这份邀请，赴一场认真相遇。"}
        </p>
      </header>
      {firstSuccess && !cancelled && (
        <p className="reg-pass-first" role="status">
          ✓ 报名成功，你的邀请函已准备好
        </p>
      )}
      <article className="reg-pass-ticket" aria-label="电子遇见邀请函">
        <div className="reg-pass-ticket-main">
          {date.edition && (
            <p className="reg-pass-edition">THE ENCOUNTER · {date.edition}</p>
          )}
          <div className="reg-pass-event-heading">
            <h2>{config?.title || "活动名称待公布"}</h2>
            <button
              type="button"
              className={`reg-pass-status is-${record.effectiveStatus}`}
              aria-label="刷新签到状态"
              aria-busy={busy}
              disabled={busy}
              onClick={onRefresh}
            >
              <span>{REGISTRATION_STATUS[record.effectiveStatus]}</span>
              <span aria-hidden="true">{busy ? "…" : "↻"}</span>
            </button>
          </div>
          <div className="reg-pass-meta">
            <div>
              <span className="reg-pass-meta-label">相遇时间</span>
              {date.accent && (
                <p className="reg-pass-date-accent" aria-hidden="true">
                  {date.accent}
                </p>
              )}
              <p className="reg-pass-date">{date.text}</p>
            </div>
            <div>
              <span className="reg-pass-meta-label">相遇地点</span>
              <p className="reg-pass-location">
                {config?.location?.trim() || "活动地点待公布"}
              </p>
            </div>
          </div>
        </div>
        <div className="reg-pass-perforation" aria-hidden="true" />
        <div className="reg-pass-code reg-receipt">
          <small>YOUR ENCOUNTER ID</small>
          <strong
            className={
              /^\d{6}$/.test(record.receipt)
                ? "is-six-digits"
                : "is-legacy-code"
            }
            aria-label={`专属遇见码 ${record.receipt}`}
          >
            <span aria-hidden="true">
              {displayEncounterCode(record.receipt)}
            </span>
          </strong>
          <p>
            {cancelled
              ? "本次报名已取消 · 此凭证不可用于签到"
              : "专属遇见码 · 现场签到凭证"}
          </p>
          {record.nickname && (
            <span
              className="reg-pass-nickname"
              aria-label={`受邀人 ${record.nickname}`}
            >
              致 · {record.nickname}
            </span>
          )}
          {typeof navigator !== "undefined" && navigator.clipboard && (
            <button
              type="button"
              className="reg-inline reg-copy"
              disabled={busy}
              onClick={onCopy}
            >
              复制遇见码
            </button>
          )}
        </div>
      </article>
      <div className="reg-pass-actions">
        {!cancelled && (
          <button className="reg-primary" disabled={busy} onClick={onProfile}>
            查看我的遇见档案 <span aria-hidden="true">→</span>
          </button>
        )}
        <div className="reg-pass-secondary">
          <button className="reg-text" onClick={onDetails}>
            查看报名详情
          </button>
          {!cancelled && record.effectiveStatus === "checked_in" && (
            <button className="reg-text" disabled={busy} onClick={onEnter}>
              进入活动 <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </div>
      <p className="reg-pass-footer">相遇不必匆忙，好故事慢慢开始。</p>
    </section>
  );
}
export function EncounterPassSkeleton() {
  return (
    <div className="reg-pass-skeleton" aria-hidden="true">
      <div />
      <div />
      <div />
    </div>
  );
}
