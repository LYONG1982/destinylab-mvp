"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { safePublicProfile, type PublicProfile } from "@/domain/agency";
import { ProfileShare } from "./ProfileShare";
import styles from "./public-profile.module.css";

const basicKeys = [
  "gender",
  "birthYear",
  "city",
  "ethnicity",
  "height",
  "education",
  "occupation",
  "maritalStatus",
  "children",
];
const lifeKeys = ["income", "housing", "vehicle", "family"];
const knownKeys = [...basicKeys, ...lifeKeys, "expectations", "contactTime"];

function ProfileImage({
  src,
  alt,
  priority = false,
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className={styles.imageMissing}>照片暂不可用</span>
  ) : (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function CoverPortrait({
  src,
  onOpen,
}: {
  src: string;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  // A cached image may finish before React attaches its load handler.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) setStatus(image.naturalWidth > 0 ? "ready" : "failed");
  }, []);
  return (
    <button
      className={styles.coverButton}
      type="button"
      aria-label="查看封面照片"
      aria-busy={status === "loading"}
      disabled={status !== "ready"}
      data-portrait-state={status}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {status === "ready" && (
        <span className={styles.coverAtmosphere} aria-hidden="true">
          <span
            className={styles.coverBackdrop}
            style={{ backgroundImage: `url(${JSON.stringify(src)})` }}
          />
          <span className={styles.coverTint} />
        </span>
      )}
      {status !== "failed" && (
        <img
          ref={imageRef}
          className={styles.coverImage}
          src={src}
          alt="封面照片"
          loading="eager"
          decoding="async"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("failed")}
        />
      )}
      {status === "ready" ? (
        <span className={styles.coverHint}>
          查看完整照片 <span aria-hidden="true">↗</span>
        </span>
      ) : (
        <span className={styles.coverStatus} role="status">
          {status === "failed" ? "照片暂不可用" : "照片加载中…"}
        </span>
      )}
    </button>
  );
}

export function PublicProfileCard({
  profile: raw,
  photoUrl,
  photoUrls,
  preview = false,
}: {
  profile: PublicProfile;
  photoUrl?: string | null;
  photoUrls?: string[];
  preview?: boolean;
}) {
  const profile = safePublicProfile(raw);
  const pictures = profile.photo
    ? photoUrls?.length
      ? photoUrls
      : photoUrl
        ? [photoUrl]
        : []
    : [];
  const [active, setActive] = useState(0);
  const viewer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!opened) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [opened]);
  const open = (index: number, button: HTMLButtonElement) => {
    setActive(index);
    trigger.current = button;
    setOpened(true);
    viewer.current?.showModal();
  };
  const close = () => viewer.current?.close();
  const facts = (keys: string[]) => {
    const items = keys.flatMap((key) =>
      profile.items.filter((item) => item.key === key),
    );
    return items.length ? (
      <dl className={styles.facts}>
        {items.map((item) => (
          <div
            key={item.key}
            className={
              item.key === "family" || item.value.length > 32
                ? styles.fullFact
                : undefined
            }
          >
            <dt>{item.key === "height" ? "身高" : item.label}</dt>
            <dd>
              {item.value}
              {item.key === "height" && /^\d+$/.test(item.value) ? " cm" : ""}
              {item.key === "birthYear" && /^\d{4}$/.test(item.value)
                ? "年"
                : ""}
            </dd>
          </div>
        ))}
      </dl>
    ) : null;
  };
  const sections: { title: string; content: ReactNode; wide?: boolean }[] = [
    { title: "基本资料", content: facts(basicKeys) },
    {
      title: "关于我",
      content: profile.intro ? (
        <p className={styles.prose}>{profile.intro}</p>
      ) : null,
    },
    {
      title: "生活相册",
      wide: true,
      content:
        pictures.length > 1 ? (
          <div className={styles.gallery}>
            {pictures.map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={(e) => open(index, e.currentTarget)}
                aria-label={`查看生活照片 ${index + 1}`}
              >
                <ProfileImage src={url} alt={`生活照片 ${index + 1}`} />
                <span>{String(index + 1).padStart(2, "0")}</span>
              </button>
            ))}
          </div>
        ) : null,
    },
    { title: "生活与家庭", content: facts(lifeKeys) },
    {
      title: "期待的你",
      content: profile.items.find((f) => f.key === "expectations")?.value ? (
        <p className={styles.prose}>
          {profile.items.find((f) => f.key === "expectations")!.value}
        </p>
      ) : null,
    },
    {
      title: "方便联系时段",
      content: profile.items.find((f) => f.key === "contactTime")?.value ? (
        <p className={styles.contactTime}>
          {profile.items.find((f) => f.key === "contactTime")!.value}
        </p>
      ) : null,
    },
    {
      title: "更多资料",
      content: facts(
        profile.items
          .filter((f) => !knownKeys.includes(f.key))
          .map((f) => f.key),
      ),
    },
  ].filter((section) => section.content);
  return (
    <article className={styles.page} data-profile-page="true">
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.brand}>
            同舟婚恋<small>个人专属介绍</small>
          </div>
          {!preview && <ProfileShare compact />}
        </header>
        <div className={styles.cover}>
          {pictures.length ? (
            <CoverPortrait
              key={pictures[0]}
              src={pictures[0]}
              onOpen={(button) => open(0, button)}
            />
          ) : (
            <div className={styles.noPhoto}>
              <span>同 舟</span>
              <p>个人介绍</p>
            </div>
          )}
        </div>
        {profile.title && (
          <div className={styles.identity}>
            <h1>{profile.title}</h1>
          </div>
        )}
        <div className={styles.content}>
          {sections.map((section, index) => (
            <section
              className={`${styles.section}${section.wide ? ` ${styles.wideSection}` : ""}`}
              key={section.title}
            >
              <h2>
                <span aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.title}
              </h2>
              {section.content}
            </section>
          ))}
        </div>
        {!preview && (
          <div className={styles.bottomShare}>
            <ProfileShare />
          </div>
        )}
        <footer className={styles.footer}>
          <span>同舟婚恋</span>
          <i />
          个人介绍
        </footer>
      </div>
      <dialog
        ref={viewer}
        className={styles.viewer}
        aria-label="生活照片查看器"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClose={() => {
          setOpened(false);
          trigger.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setActive((i) => (i + 1) % pictures.length);
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setActive((i) => (i + pictures.length - 1) % pictures.length);
          }
        }}
      >
        <div className={styles.viewerToolbar}>
          <span aria-live="polite">
            {active + 1} / {pictures.length}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="关闭照片查看器"
            autoFocus
          >
            关闭 ✕
          </button>
        </div>
        {pictures[active] && (
          <ProfileImage
            key={pictures[active]}
            src={pictures[active]}
            alt={`完整照片 ${active + 1}`}
            priority
          />
        )}
        {pictures.length > 1 && (
          <div className={styles.viewerNavigation}>
            <button
              type="button"
              onClick={() =>
                setActive((i) => (i + pictures.length - 1) % pictures.length)
              }
            >
              ← 上一张
            </button>
            <button
              type="button"
              onClick={() => setActive((i) => (i + 1) % pictures.length)}
            >
              下一张 →
            </button>
          </div>
        )}
      </dialog>
    </article>
  );
}
