"use client";

import styles from "./EncounterGuide.module.css";

type EncounterGuideProps = {
  pointName?: string;
  pointLocation?: string;
  hasPoint: boolean;
  encounterCode: string;
  is520: boolean;
  onConfirm: () => void;
  onPause: () => void;
  onHelp?: () => void;
  busy: boolean;
};

function formatPointName(name?: string) {
  if (!name) return "相遇点待分配";
  const meet = name.match(/^Meet\s*0*(\d+)$/i);
  if (meet) return `Meet ${meet[1].padStart(2, "0")}`;
  return name;
}

export function EncounterGuide({
  pointName,
  pointLocation,
  hasPoint,
  encounterCode,
  is520,
  onConfirm,
  onPause,
  onHelp,
  busy,
}: EncounterGuideProps) {
  const pointReady = hasPoint && Boolean(pointName);
  const codeReady = Boolean(encounterCode);
  const canConfirm = pointReady && codeReady && !busy;
  const formattedName = formatPointName(pointName);
  const pointNumber = formattedName.match(/^Meet\s*(\d+)$/i)?.[1];
  const pointTitle = pointNumber ? `${pointNumber}号相遇点` : formattedName;

  return (
    <section className={styles.guide} aria-label="相遇点指引">
      <section className={styles.pointCard} aria-label="你的相遇地点">
        <div className={styles.eyebrow}>YOUR MEETING POINT</div>
        {pointNumber ? (
          <div className={styles.meetName}>{formattedName}</div>
        ) : (
          <div className={styles.pointName}>{formattedName}</div>
        )}
        <h2 className={styles.pointTitle}>{pointTitle}</h2>
        <p className={`${styles.location} mutual-place-copy`}>
          {pointReady
            ? pointLocation || "现场位置待补充"
            : "相遇点正在分配，准备好后会自动更新。"}
        </p>
        {pointReady && <p className={styles.pointHint}>请前往这里，与 TA 相遇。</p>}
      </section>

      <section
        className={`${styles.codeCard} mutual-code-copy`}
        aria-label="相遇码"
      >
        <div className={styles.codeHeading}>
          <span>{is520 ? "相遇暗号·520" : "缘分相遇码"}</span>
          <span className={styles.codeCaption}>
            {is520 ? "见面时交换并核对" : "见面时核对"}
          </span>
        </div>
        {is520 ? (
          <div className={styles.codePair}>
            <div className={styles.codeCell}>
              <span>我的相遇码</span>
              <strong data-testid="own-encounter-code">
                {encounterCode || "—"}
              </strong>
            </div>
            <div className={styles.codeCell}>
              <span>对方的相遇码</span>
              <strong aria-label="对方相遇码隐藏">???</strong>
            </div>
          </div>
        ) : (
          <div className={styles.sharedCode}>
            <span>本次相遇码</span>
            <strong data-testid="own-encounter-code">{encounterCode || "—"}</strong>
          </div>
        )}
        <p className={styles.codeHint}>
          {is520
            ? "见面时交换相遇码，两人的数字相加等于 520，就找对人啦。"
            : "见面时核对相遇码与活动昵称，请勿仅凭头像认人。"}
        </p>
      </section>

      <ol className={styles.steps}>
        <li>
          <span>01</span>
          <p>找到{pointReady ? pointTitle : "相遇点"}</p>
        </li>
        <li>
          <span>02</span>
          <p>{is520 ? "交换相遇码" : "核对相遇码"}</p>
        </li>
        <li>
          <span>03</span>
          <p>核对双方活动昵称，开始交流</p>
        </li>
      </ol>

      <div className={styles.actions}>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {busy ? "正在记录…" : "我已遇见 TA"}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={busy}
          onClick={onPause}
        >
          暂时不见面
        </button>
        {onHelp && (
          <button
            className={styles.helpButton}
            type="button"
            disabled={busy}
            onClick={onHelp}
          >
            需要工作人员帮助
          </button>
        )}
      </div>
    </section>
  );
}
