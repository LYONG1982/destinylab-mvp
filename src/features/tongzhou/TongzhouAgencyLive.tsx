"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { activity } from "@/lib/api/live-client";
import { TONGZHOU_FIELDS, type TongzhouSubmission } from "@/domain/tongzhou";
import {
  PUBLIC_FIELDS,
  defaultPublicFields,
  SERVICE_LABELS,
  type AgencyDraft,
  type AgencyGallery,
  type AgencyManagement,
  type PublicProfile,
} from "@/domain/agency";
import { AgencyPhotoGallery, type GalleryTask } from "./AgencyPhotoGallery";
import { PublicProfileCard } from "./PublicProfileCard";
import { ProfileShare } from "./ProfileShare";
import { submissionTime } from "./TongzhouDetails";
import styles from "./agency.module.css";
import { ActivitySwitch } from "@/features/admin/ActivityManagement";
const SOURCE_LABELS: Record<string, string> = {
  registration: "报名入口",
  encounter: "活动遇见",
};
function SourceBadges({ sources }: { sources: string[] }) {
  return (
    <span className={styles.sources}>
      {sources.map((source) => (
        <span key={source} className={styles.pill}>
          {SOURCE_LABELS[source] || source}
        </span>
      ))}
    </span>
  );
}
type Row = {
  sources: string[];
  actor: string;
  name: string;
  gender: string;
  birthyear: string;
  city: string;
  phone: string;
  updated: string;
  nickname: string;
  code: string;
  signed: boolean;
  service: keyof typeof SERVICE_LABELS;
  published: boolean;
};
type Listing = {
  records: Row[];
  total: number;
  stats: {
    total: number;
    male: number;
    female: number;
    signed: number;
    none: number;
    active: number;
    done: number;
  };
};
type Detail = {
  sources: string[];
  latestSource: string;
  history: {
    note: string;
    signed: boolean;
    service: keyof typeof SERVICE_LABELS;
    source: string;
  }[];
  record: TongzhouSubmission;
  management: AgencyManagement;
  photo: string | null;
  gallery: AgencyGallery;
};
class Failure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const endpoint = (path: string) =>
  `/api/tongzhou/${path}?activity=${encodeURIComponent(activity())}`;
async function api<T>(path: string, options: RequestInit = {}) {
  const r = await fetch(endpoint(path), {
    ...options,
    cache: "no-store",
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
  });
  const data = await r.json();
  if (!r.ok) throw new Failure(r.status, data.error || "操作未完成，请重试。");
  return data as T;
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "连接暂不可用，请重试。";
const draftFrom = (d: AgencyManagement, available: string[]): AgencyDraft => ({
  note: d.note,
  signed: d.signed,
  service: d.service,
  nickname: d.nickname,
  code: d.code,
  intro: d.intro,
  fields: d.fields,
  photoIds: (d.photoIds || []).filter((id) => available.includes(id)),
});
export function TongzhouAgencyLive() {
  const [logged, setLogged] = useState<boolean | null>(null),
    [listing, setListing] = useState<Listing | null>(null),
    [query, setQuery] = useState(""),
    [gender, setGender] = useState(""),
    [signed, setSigned] = useState(""),
    [service, setService] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [refresh, setRefresh] = useState(0),
    [logoutFailed, setLogoutFailed] = useState(false);
  const generation = useRef(0),
    activeRow = useRef<HTMLElement | null>(null);
  const expire = useCallback(() => {
    ++generation.current;
    setLogged(false);
    setListing(null);
    setSelected("");
    setError("登录已失效，请重新登录。");
  }, []);
  useEffect(() => {
    if (logged === false) return;
    const ticket = ++generation.current;
    const controller = new AbortController();
    let loading = false;
    async function fetchList() {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const r = await fetch(
          endpoint("records") +
            `&q=${encodeURIComponent(query)}&gender=${encodeURIComponent(gender)}&signed=${signed}&service=${service}&page=${page}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        const data = await r.json();
        if (!r.ok) throw new Failure(r.status, data.error);
        if (ticket !== generation.current || document.hidden) return;
        setListing(data);
        setLogged(true);
        setError("");
        if (page > 1 && data.total <= (page - 1) * 20)
          setPage(Math.max(1, Math.ceil(data.total / 20)));
      } catch (e) {
        if (controller.signal.aborted || ticket !== generation.current) return;
        setListing(null);
        if (e instanceof Failure && e.status === 401) {
          setLogged(false);
          setSelected("");
          setError("");
        } else setError("连接暂不可用，请刷新重试。");
      } finally {
        loading = false;
      }
    }
    void fetchList();
    const timer = setInterval(fetchList, 5000);
    const visibility = () => {
      if (document.hidden) setListing(null);
      else void fetchList();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [logged, query, gender, signed, service, page, refresh]);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = e.currentTarget,
      values = new FormData(form);
    try {
      await api("login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: values.get("username"),
          password: values.get("password"),
        }),
      });
      form.reset();
      setShowPassword(false);
      setLogged(true);
      setLogoutFailed(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    ++generation.current;
    setLogged(false);
    setListing(null);
    setSelected("");
    setBusy(true);
    setError("");
    try {
      await api("logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setLogoutFailed(false);
    } catch (e) {
      if (e instanceof Failure && e.status === 401) setLogoutFailed(false);
      else {
        setLogoutFailed(true);
        setError("退出未完成，请重试。");
      }
    } finally {
      setBusy(false);
    }
  }
  function filter(set: (v: string) => void, value: string) {
    set(value);
    setPage(1);
    setListing(null);
  }
  function open(actor: string, target: HTMLElement) {
    activeRow.current = target;
    setSelected(actor);
  }
  const close = useCallback(() => {
    setSelected("");
    setRefresh((x) => x + 1);
    setTimeout(() => activeRow.current?.focus(), 0);
  }, []);
  const stats = listing?.stats;
  return (
    <main className={styles.shell}>
      {logged !== true ? (
        <div className={styles.login}>
          <form className={styles.loginCard} onSubmit={login}>
            <h1>
              <span>同舟婚恋</span>
              <span>机构用户管理平台</span>
            </h1>
            {logged === null ? (
              <p className={styles.hint}>正在连接…</p>
            ) : (
              <>
                <label className={styles.field}>
                  账号
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={80}
                  />
                </label>
                <label className={styles.field}>
                  密码
                  <div className={styles.password}>
                    <input
                      name="password"
                      aria-label="密码"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      maxLength={256}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? "隐藏" : "显示"}
                    </button>
                  </div>
                </label>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <button
                  className={styles.primary}
                  disabled={busy || logoutFailed}
                >
                  {busy ? "登录中…" : "登录"}
                </button>
                {logoutFailed && (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={logout}
                  >
                    重试退出
                  </button>
                )}
              </>
            )}
            {logged === null && error && (
              <>
                <p className={styles.error}>{error}</p>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setRefresh((x) => x + 1)}
                >
                  重试
                </button>
              </>
            )}
          </form>
          <footer className={styles.copyright}>copyright by lvyong</footer>
        </div>
      ) : (
        <>
          <header className={styles.topbar}>
            <ActivitySwitch activity={activity()} agency />
            <div className={styles.brand}>
              同舟婚恋<small>机构工作台 · {activity()}</small>
            </div>
            <button
              className={styles.textButton}
              disabled={busy}
              onClick={logout}
            >
              退出登录
            </button>
          </header>
          <div className={styles.content}>
            <div className={styles.heading}>
              <div>
                <h1>用户资料</h1>
                <p>查看资料，记录跟进，安排下一次相遇。</p>
              </div>
              <button
                className={styles.secondary}
                onClick={() => setRefresh((x) => x + 1)}
              >
                刷新
              </button>
            </div>
            <div className={styles.stats}>
              {(
                [
                  ["全部资料", stats?.total],
                  ["男生", stats?.male],
                  ["女生", stats?.female],
                  ["已签约", stats?.signed],
                  ["未服务", stats?.none],
                  ["服务中", stats?.active],
                  ["已完成", stats?.done],
                ] as const
              ).map(([label, value]) => (
                <div className={styles.stat} key={label}>
                  <span>{label}</span>
                  <strong>{value ?? "—"}</strong>
                </div>
              ))}
            </div>
            <div className={styles.filters}>
              <input
                aria-label="搜索用户"
                placeholder="搜索姓名、城市、昵称或编号"
                value={query}
                maxLength={80}
                onChange={(e) => filter(setQuery, e.target.value)}
              />
              <select
                aria-label="性别筛选"
                value={gender}
                onChange={(e) => filter(setGender, e.target.value)}
              >
                <option value="">全部性别</option>
                <option>男</option>
                <option>女</option>
              </select>
              <select
                aria-label="签约筛选"
                value={signed}
                onChange={(e) => filter(setSigned, e.target.value)}
              >
                <option value="">全部签约状态</option>
                <option value="false">未签约</option>
                <option value="true">已签约</option>
              </select>
              <select
                aria-label="服务筛选"
                value={service}
                onChange={(e) => filter(setService, e.target.value)}
              >
                <option value="">全部服务状态</option>
                {Object.entries(SERVICE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {[
                      "用户",
                      "资料来源",
                      "性别 / 年龄",
                      "城市",
                      "手机号",
                      "签约",
                      "服务",
                      "宣传页",
                      "更新时间",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listing?.records.map((r) => (
                    <tr
                      key={r.actor}
                      className={styles.row}
                      onClick={(e) =>
                        open(r.actor, e.currentTarget.querySelector("button")!)
                      }
                    >
                      <td>
                        <button
                          className={`${styles.textButton} ${styles.nameButton}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            open(r.actor, e.currentTarget);
                          }}
                        >
                          {r.name}
                        </button>
                        <small className={styles.subline}>
                          {r.nickname || r.code || "待设置公开昵称"}
                        </small>
                      </td>
                      <td>
                        <SourceBadges sources={r.sources} />
                      </td>
                      <td>
                        {r.gender} ·{" "}
                        {new Date().getFullYear() - Number(r.birthyear)} 岁
                      </td>
                      <td>{r.city}</td>
                      <td>{r.phone}</td>
                      <td>
                        <span
                          className={`${styles.pill} ${r.signed ? styles.positive : ""}`}
                        >
                          {r.signed ? "已签约" : "未签约"}
                        </span>
                      </td>
                      <td>{SERVICE_LABELS[r.service]}</td>
                      <td>
                        <span
                          className={`${styles.pill} ${r.published ? styles.published : ""}`}
                        >
                          {r.published ? "已发布" : "未发布"}
                        </span>
                      </td>
                      <td>
                        <small>{submissionTime(Number(r.updated))}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!listing?.records.length && (
                <div className={styles.empty}>
                  {listing ? "暂无符合条件的用户资料" : "正在读取…"}
                </div>
              )}
            </div>
            <div className={styles.mobileRows}>
              {listing?.records.map((r) => (
                <button
                  className={styles.mobileRow}
                  key={r.actor}
                  onClick={(e) => open(r.actor, e.currentTarget)}
                >
                  <strong>{r.name}</strong>
                  <SourceBadges sources={r.sources} />
                  <small className={styles.subline}>
                    {r.nickname || r.code}
                  </small>
                  <p>
                    {r.gender} ·{" "}
                    {new Date().getFullYear() - Number(r.birthyear)} 岁 ·{" "}
                    {r.city}
                  </p>
                  <p>{r.phone}</p>
                  <span className={styles.pill}>
                    {r.signed ? "已签约" : "未签约"}
                  </span>
                  <span className={styles.pill}>
                    {SERVICE_LABELS[r.service]}
                  </span>
                  <span className={styles.pill}>
                    {r.published ? "已发布" : "未发布"}
                  </span>
                </button>
              ))}
              {!listing?.records.length && (
                <div className={styles.empty}>
                  {listing ? "暂无符合条件的用户资料" : "正在读取…"}
                </div>
              )}
            </div>
            <div className={styles.pagination}>
              <span>
                共 {listing?.total ?? "—"} 条 · 第 {page} 页
              </span>
              <div>
                <button
                  className={styles.textButton}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </button>
                <button
                  className={styles.textButton}
                  disabled={!listing || page * 20 >= listing.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {logged === true && selected && (
        <DetailDrawer
          key={selected}
          actor={selected}
          onClose={close}
          onExpired={expire}
        />
      )}
    </main>
  );
}
function DetailDrawer({
  actor,
  onClose,
  onExpired,
}: {
  actor: string;
  onClose: () => void;
  onExpired: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [draft, setDraft] = useState<AgencyDraft | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      preview: PublicProfile;
      photoUrl: string | null;
      photoId: string | null;
      photoUrls: string[];
      galleryVersion: number;
      userPhotoId: string | null;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [previewExpired, setPreviewExpired] = useState(false),
    [retry, setRetry] = useState(false),
    [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">(
      "mobile",
    ),
    [tab, setTab] = useState<"basic" | "photos" | "publication">("basic");
  const publishedResult = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null),
    base = useRef<Detail | null>(null),
    draftRef = useRef<AgencyDraft | null>(null),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true),
    lock = useRef(false),
    pending = useRef<{ body: object; id: string } | null>(null),
    dirty = useRef(false),
    scroller = useRef<HTMLDivElement>(null),
    scrollPositions = useRef<Record<string, number>>({}),
    readGeneration = useRef(0),
    galleryPending = useRef<{
      task: GalleryTask;
      id: string;
      version: number;
      managementVersion: number;
      sourceVersion: number;
    } | null>(null);
  function switchTab(next: typeof tab) {
    scrollPositions.current[tab] = scroller.current?.scrollTop || 0;
    setTab(next);
    requestAnimationFrame(() => {
      if (scroller.current)
        scroller.current.scrollTop = scrollPositions.current[next] || 0;
    });
  }
  const read = useCallback(
    async (
      reset: boolean | "followup" | "publication" | "gallery" = false,
      expectedManagement?: number,
      expectedSource?: number,
    ) => {
      const ticket = ++readGeneration.current;
      const r = await fetch(
        endpoint("records") + "&id=" + encodeURIComponent(actor),
        {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.current!.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Failure(r.status, d.error);
      if (
        !alive.current ||
        document.hidden ||
        ticket !== readGeneration.current
      )
        return;
      setDetail(d);
      if (
        reset === "gallery" &&
        ((expectedManagement !== undefined &&
          d.management.version !== expectedManagement) ||
          (expectedSource !== undefined && d.record.version !== expectedSource))
      )
        throw new Failure(
          409,
          "相册操作已完成，但资料也已在其他页面更新。请复制未保存内容，再关闭并重新打开详情。",
        );
      if (reset || !base.current) {
        base.current = d;
        const saved = draftFrom(
          d.management,
          d.gallery.photos.map((p: { id: string }) => p.id),
        );
        const previous = draftRef.current;
        draftRef.current =
          previous && typeof reset === "string"
            ? {
                ...saved,
                ...(reset === "followup" || reset === "gallery"
                  ? {
                      nickname: previous.nickname,
                      code: previous.code,
                      intro: previous.intro,
                      fields: previous.fields,
                      photoIds: (previous.photoIds || []).filter((id) =>
                        d.gallery.photos.some(
                          (p: { id: string }) => p.id === id,
                        ),
                      ),
                    }
                  : {}),
                ...(reset === "publication" || reset === "gallery"
                  ? {
                      note: previous.note,
                      signed: previous.signed,
                      service: previous.service,
                    }
                  : {}),
              }
            : saved;
        setDraft(draftRef.current);
        dirty.current =
          JSON.stringify(draftRef.current) !== JSON.stringify(saved);
      } else if (
        base.current.management.version !== d.management.version ||
        base.current.record.version !== d.record.version ||
        base.current.gallery.version !== d.gallery.version ||
        base.current.gallery.userPhotoId !== d.gallery.userPhotoId
      )
        setError("资料已更新。请复制未保存内容，再关闭并重新打开详情。");
    },
    [actor],
  );
  useEffect(() => {
    alive.current = true;
    controller.current = new AbortController();
    let reading = false;
    async function poll() {
      if (reading || document.hidden || lock.current) return;
      reading = true;
      try {
        await read();
      } catch (e) {
        if (!alive.current) return;
        setDetail(null);
        if (e instanceof Failure && e.status === 401) onExpired();
        else if (e instanceof Failure && e.status === 404) onClose();
        else setError("详情暂不可用，正在重试。");
      } finally {
        reading = false;
      }
    }
    void poll();
    const timer = setInterval(poll, 5000);
    const visible = () => {
      if (document.hidden) {
        setDetail(null);
        setPreview(null);
        setConfirmed(false);
        setPreviewExpired(true);
      } else void poll();
    };
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("visibilitychange", visible);
    panel.current?.focus();
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current || pending.current || galleryPending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      alive.current = false;
      controller.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("beforeunload", before);
      document.body.style.overflow = old;
    };
  }, [read, onExpired, onClose]);
  function change(patch: Partial<AgencyDraft>) {
    if (!draftRef.current) return;
    draftRef.current = { ...draftRef.current, ...patch };
    setDraft(draftRef.current);
    dirty.current = true;
    setPreviewExpired(false);
    setPreview(null);
    setConfirmed(false);
    setNotice("");
  }
  function close() {
    if (lock.current) return;
    if (
      (dirty.current || pending.current || galleryPending.current) &&
      !window.confirm("还有未保存内容，确定关闭？")
    )
      return;
    onClose();
  }
  async function act(action: string, resume = false) {
    if (lock.current || !draftRef.current || !base.current) return;
    lock.current = true;
    ++readGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    const task = resume
      ? pending.current
      : {
          id:
            "agency-" +
            Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
          body: {
            actor,
            action,
            expectedVersion: base.current.management.version,
            sourceVersion: base.current.record.version,
            draft: draftRef.current,
            confirmed,
            expectedUserPhoto:
              action === "publish"
                ? preview?.userPhotoId
                : base.current.gallery.userPhotoId,
            expectedGalleryVersion:
              action === "publish"
                ? preview?.galleryVersion
                : base.current.gallery.version,
            scope: tab === "basic" ? "followup" : "publication",
          },
        };
    if (!task) {
      lock.current = false;
      setBusy(false);
      return;
    }
    try {
      const result = await api<{
        preview: PublicProfile;
        photoUrl: string | null;
        photoId: string | null;
        photoUrls: string[];
        galleryVersion: number;
        userPhotoId: string | null;
      }>("manage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": task.id,
        },
        body: JSON.stringify(task.body),
        signal: controller.current!.signal,
      });
      if (!alive.current || document.hidden) return;
      pending.current = null;
      setRetry(false);
      if (action === "preview") {
        setPreview(result);
        setPreviewExpired(false);
        setConfirmed(false);
      } else {
        await read((task.body as { scope: "followup" | "publication" }).scope);
        setPreview(null);
        setConfirmed(false);
        if (action === "publish")
          requestAnimationFrame(() => {
            if (scroller.current) scroller.current.scrollTop = 0;
            publishedResult.current?.focus({ preventScroll: true });
          });
        setNotice(
          action === "publish"
            ? "宣传页已发布"
            : action === "unpublish"
              ? "宣传页已下架"
              : "已保存",
        );
      }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof Failure && e.status === 401) {
        onExpired();
        return;
      }
      if (
        action !== "preview" &&
        (!(e instanceof Failure) || e.status >= 500)
      ) {
        pending.current = task;
        setRetry(true);
      } else {
        pending.current = null;
        setRetry(false);
      }
      setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function photoTask(task: GalleryTask, resume = false) {
    if (lock.current || !base.current) return;
    if (task.kind === "upload" && task.file.size > 10 * 1024 * 1024) {
      setError("每张照片不超过 10MB。");
      return;
    }
    lock.current = true;
    ++readGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    const request = resume
      ? galleryPending.current
      : {
          task,
          version: base.current.gallery.version,
          managementVersion: base.current.management.version,
          sourceVersion: base.current.record.version,
          id:
            "gallery-" +
            Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
        };
    if (!request) {
      lock.current = false;
      setBusy(false);
      return;
    }
    try {
      const t = request.task;
      const url =
        t.kind === "upload"
          ? endpoint("gallery-upload") +
            `&id=${encodeURIComponent(actor)}&version=${request.version}`
          : endpoint("gallery");
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":
            t.kind === "upload"
              ? "application/octet-stream"
              : "application/json",
          "Idempotency-Key": request.id,
        },
        body:
          t.kind === "upload"
            ? t.file
            : JSON.stringify({
                actor,
                expectedVersion: request.version,
                action: t.kind,
                ...(t.kind === "delete"
                  ? { id: t.id, confirmed: t.confirmed }
                  : { ids: t.ids }),
              }),
        signal: AbortSignal.any([
          controller.current!.signal,
          AbortSignal.timeout(60000),
        ]),
      });
      const data = await r.json();
      if (!r.ok) throw new Failure(r.status, data.error);
      if (!alive.current || document.hidden) return;
      galleryPending.current = null;
      setRetry(false);
      setPreview(null);
      setConfirmed(false);
      await read(
        "gallery",
        request.managementVersion +
          (t.kind === "delete" && request.managementVersion > 0 ? 1 : 0),
        request.sourceVersion,
      );
      setNotice(
        t.kind === "upload"
          ? "照片已上传，仅机构可见"
          : t.kind === "delete"
            ? "照片已移除"
            : "照片顺序已保存",
      );
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof Failure && e.status === 401) {
        onExpired();
        return;
      }
      if (e instanceof Failure && e.status === 404) {
        onClose();
        return;
      }
      if (!(e instanceof Failure) || e.status >= 500) {
        galleryPending.current = request;
        setRetry(true);
      } else {
        galleryPending.current = null;
        setRetry(false);
      }
      setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const disabled = busy || retry;
  const valid = !!detail && !!draft;
  const publicUrl =
    detail?.management.published && typeof window !== "undefined"
      ? new URL(detail.management.url, window.location.origin).href
      : "";
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
          if (e.key === "Tab") {
            const items = Array.from(
              panel.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary",
              ) || [],
            ).filter((el) => el.getClientRects().length > 0);
            if (!items?.length) return;
            const first = items[0],
              last = items[items.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === panel.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className={styles.drawerHead}>
          <div>
            <h2 id="detail-title">
              {detail?.record.fields?.realName || "用户详情"}
            </h2>
            <p>
              {detail?.record.fields?.city}{" "}
              {detail?.record.fields?.gender &&
                " · " + detail.record.fields.gender}
            </p>
          </div>
          <button
            className={styles.textButton}
            aria-label="关闭详情"
            disabled={busy}
            onClick={close}
          >
            关闭
          </button>
        </header>
        <div role="tablist" aria-label="用户详情页签" className={styles.tabs}>
          {(
            [
              ["basic", "基本资料"],
              ["photos", "用户照片"],
              ["publication", "宣传设置"],
            ] as const
          ).map(([key, label], index, all) => (
            <button
              key={key}
              id={`tab-${key}`}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => switchTab(key)}
              onKeyDown={(e) => {
                let n = index;
                if (e.key === "ArrowRight") n = (index + 1) % all.length;
                else if (e.key === "ArrowLeft")
                  n = (index + all.length - 1) % all.length;
                else if (e.key === "Home") n = 0;
                else if (e.key === "End") n = all.length - 1;
                else return;
                e.preventDefault();
                switchTab(all[n][0]);
                document.getElementById(`tab-${all[n][0]}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div ref={scroller} className={styles.drawerBody}>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
              {retry && (
                <button
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() =>
                    galleryPending.current
                      ? void photoTask(galleryPending.current.task, true)
                      : void act(
                          (pending.current?.body as { action: string }).action,
                          true,
                        )
                  }
                >
                  重试上次操作
                </button>
              )}
            </div>
          )}
          {notice && (
            <p role="status" className={styles.success}>
              {notice}
            </p>
          )}
          {!valid ? (
            <div className={styles.empty}>正在读取详情…</div>
          ) : (
            <>
              <div
                role="tabpanel"
                id="panel-basic"
                aria-labelledby="tab-basic"
                hidden={tab !== "basic"}
              >
                <section className={styles.section}>
                  <h3>资料来源</h3>
                  <SourceBadges sources={detail.sources} />
                  <p className={styles.subline}>
                    当前资料来自{SOURCE_LABELS[detail.latestSource]} ·{" "}
                    {submissionTime(detail.record.updatedAt)}
                  </p>
                </section>
                <section className={styles.section}>
                  {[
                    [
                      "基本资料",
                      [
                        "realName",
                        "phone",
                        "gender",
                        "birthYear",
                        "city",
                        "ethnicity",
                      ],
                    ],
                    [
                      "生活情况",
                      [
                        "maritalStatus",
                        "children",
                        "height",
                        "education",
                        "occupation",
                        "income",
                        "housing",
                        "vehicle",
                      ],
                    ],
                    ["择偶与联系", ["family", "expectations", "contactTime"]],
                  ].map(([title, fields]) => (
                    <div key={title as string}>
                      <h3>{title}</h3>
                      <dl className={styles.detailGrid}>
                        {TONGZHOU_FIELDS.filter((f) =>
                          (fields as string[]).includes(f.key),
                        ).map((f) => (
                          <div
                            key={f.key}
                            className={f.multiline ? styles.detailWide : ""}
                          >
                            <dt>{f.label}</dt>
                            <dd>{detail.record.fields?.[f.key] || "未填写"}</dd>
                          </div>
                        ))}
                      </dl>
                      <br />
                    </div>
                  ))}
                </section>
                <section className={styles.section}>
                  <h3>服务跟进</h3>
                  {!!detail.history.length && (
                    <details className={styles.followupHistory}>
                      <summary>合并前跟进记录（保留原文）</summary>
                      {detail.history.map((item, index) => (
                        <div key={index}>
                          <strong>
                            {SOURCE_LABELS[item.source]} ·{" "}
                            {item.signed ? "已签约" : "未签约"} ·{" "}
                            {SERVICE_LABELS[item.service]}
                          </strong>
                          <p>{item.note || "无备注"}</p>
                        </div>
                      ))}
                    </details>
                  )}
                  <div className={styles.twoColumns}>
                    <label className={styles.field}>
                      签约状态
                      <select
                        disabled={disabled}
                        aria-label="签约状态"
                        value={String(draft.signed)}
                        onChange={(e) =>
                          change({ signed: e.target.value === "true" })
                        }
                      >
                        <option value="false">未签约</option>
                        <option value="true">已签约</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      服务状态
                      <select
                        disabled={disabled}
                        aria-label="服务状态"
                        value={draft.service}
                        onChange={(e) =>
                          change({
                            service: e.target.value as AgencyDraft["service"],
                          })
                        }
                      >
                        {Object.entries(SERVICE_LABELS).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className={styles.field}>
                    工作人员备注
                    <textarea
                      disabled={disabled}
                      aria-label="工作人员备注"
                      value={draft.note}
                      maxLength={2000}
                      onChange={(e) => change({ note: e.target.value })}
                      placeholder="记录沟通情况、需求与下一步安排"
                    />
                  </label>
                  <p className={styles.hint}>
                    仅机构内部可见 · {draft.note.length}/2000
                    {detail.management.updatedAt
                      ? " · 更新于 " +
                        submissionTime(
                          new Date(detail.management.updatedAt).getTime(),
                        )
                      : ""}
                  </p>
                </section>
              </div>
              <div
                role="tabpanel"
                id="panel-photos"
                aria-labelledby="tab-photos"
                hidden={tab !== "photos"}
              >
                <AgencyPhotoGallery
                  gallery={detail.gallery}
                  selected={draft.photoIds || []}
                  disabled={disabled}
                  onTask={photoTask}
                  onSelect={(ids) =>
                    change({
                      photoIds: ids,
                      fields: ids.length
                        ? [...new Set([...draft.fields, "photo"])]
                        : draft.fields.filter((f) => f !== "photo"),
                    })
                  }
                />
              </div>
              <div
                role="tabpanel"
                id="panel-publication"
                aria-labelledby="tab-publication"
                hidden={tab !== "publication"}
              >
                {detail.management.published && (
                  <div
                    ref={publishedResult}
                    tabIndex={-1}
                    className={styles.publishedResult}
                    aria-label="发布成功"
                  >
                    <h3>个人主页已发布</h3>
                    <p>
                      {detail.management.nickname || detail.management.code}
                    </p>
                    <a
                      className={styles.publishedUrl}
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="个人主页专属链接"
                    >
                      {publicUrl}
                    </a>
                    <p className={styles.hint}>
                      专属链接保持不变，更新发布后展示最新内容。
                    </p>
                    <a
                      href={detail.management.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开个人主页 ↗
                    </a>
                    <ProfileShare url={detail.management.url} agency />
                    <button
                      className={styles.textButton}
                      disabled={disabled}
                      onClick={() => void act("unpublish")}
                    >
                      下架
                    </button>
                  </div>
                )}

                <section className={styles.section}>
                  <h3>
                    宣传页设置{" "}
                    <span className={styles.pill}>
                      {detail.management.published
                        ? detail.management.needsUpdate
                          ? "已发布 · 待更新"
                          : "已发布"
                        : "未发布"}
                    </span>
                  </h3>
                  <div className={styles.twoColumns}>
                    <label className={styles.field}>
                      公开昵称
                      <input
                        disabled={disabled}
                        value={draft.nickname}
                        maxLength={40}
                        onChange={(e) => change({ nickname: e.target.value })}
                        placeholder="未填写时不显示昵称"
                      />
                    </label>
                    <label className={styles.field}>
                      展示编号
                      <input
                        disabled={disabled}
                        value={draft.code}
                        maxLength={32}
                        onChange={(e) => change({ code: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className={styles.field}>
                    个人介绍
                    <textarea
                      disabled={disabled}
                      aria-label="个人介绍"
                      value={draft.intro}
                      maxLength={600}
                      onChange={(e) => change({ intro: e.target.value })}
                      placeholder="填写经本人确认的个人介绍"
                    />
                  </label>
                  <h3>选择公开字段</h3>
                  <div className={styles.fieldActions}>
                    <button
                      className={styles.textButton}
                      disabled={disabled}
                      onClick={() => change({ fields: defaultPublicFields() })}
                    >
                      全选
                    </button>
                    <button
                      className={styles.textButton}
                      disabled={disabled}
                      onClick={() => change({ fields: [] })}
                    >
                      取消全选
                    </button>
                  </div>
                  <div className={styles.checks}>
                    {PUBLIC_FIELDS.map((f) => (
                      <label key={f.key}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={draft.fields.includes(f.key)}
                          onChange={(e) =>
                            change({
                              fields: e.target.checked
                                ? [...draft.fields, f.key]
                                : draft.fields.filter((k) => k !== f.key),
                            })
                          }
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                  <p className={styles.hint}>
                    页面以昵称展示，不公开真实姓名和手机号。其余字段按勾选展示，照片需另行选择并预览。
                  </p>
                  {detail.management.legacyPhoto && (
                    <p className={styles.hint}>
                      当前宣传页含历史发布照片。重新发布时，请选择独立相册照片，或取消“本人照片”以发布无照片页面。
                    </p>
                  )}
                  <h3 className={styles.albumTitle}>公开照片与封面</h3>
                  {!detail.gallery.photos.length ? (
                    <p className={styles.hint}>
                      暂无可用照片，本次预览和发布将显示无照片页面。
                    </p>
                  ) : (
                    <div className={styles.coverChoices}>
                      {detail.gallery.photos.map((p, index) => (
                        <div key={p.id}>
                          <img
                            src={p.thumbnail}
                            alt={`候选照片 ${index + 1}`}
                          />
                          <span className={styles.pill}>
                            {p.source === "user" ||
                            p.uploadedBy === "participant"
                              ? "用户上传"
                              : "机构上传"}
                          </span>
                          <label>
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={(draft.photoIds || []).includes(p.id)}
                              onChange={(e) => {
                                const ids = e.target.checked
                                  ? [...(draft.photoIds || []), p.id]
                                  : (draft.photoIds || []).filter(
                                      (id) => id !== p.id,
                                    );
                                change({ photoIds: ids });
                              }}
                            />
                            公开照片 {index + 1}
                          </label>
                          {(draft.photoIds || []).includes(p.id) && (
                            <button
                              className={styles.textButton}
                              disabled={
                                disabled || draft.photoIds?.[0] === p.id
                              }
                              onClick={() =>
                                change({
                                  photoIds: [
                                    p.id,
                                    ...(draft.photoIds || []).filter(
                                      (id) => id !== p.id,
                                    ),
                                  ],
                                })
                              }
                            >
                              {draft.photoIds?.[0] === p.id
                                ? "当前封面"
                                : "设为封面"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className={styles.hint}>
                    昵称或编号作为标题。只展示选中的内容，内部备注不公开。
                  </p>
                </section>
                {preview && (
                  <section className={styles.section}>
                    <h3>发布预览</h3>
                    <div
                      className={styles.previewSwitch}
                      role="group"
                      aria-label="预览设备"
                    >
                      <button
                        type="button"
                        aria-pressed={previewDevice === "mobile"}
                        onClick={() => setPreviewDevice("mobile")}
                      >
                        手机预览
                      </button>
                      <button
                        type="button"
                        aria-pressed={previewDevice === "desktop"}
                        onClick={() => setPreviewDevice("desktop")}
                      >
                        电脑预览
                      </button>
                    </div>
                    <div
                      className={styles.previewViewport}
                      tabIndex={0}
                      role="region"
                      aria-label="宣传页预览内容"
                    >
                      <div
                        className={
                          previewDevice === "mobile"
                            ? styles.previewPhone
                            : styles.previewDesktop
                        }
                      >
                        <PublicProfileCard
                          preview
                          profile={preview.preview}
                          photoUrl={preview.photoUrl}
                          photoUrls={preview.photoUrls}
                        />
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </div>
        <footer
          className={`${styles.drawerFooter} ${tab === "publication" ? styles.publicationFooter : ""}`}
        >
          {tab === "publication" && (
            <div className={styles.publishRequirements}>
              <p id="publish-requirements">
                {!preview
                  ? previewExpired
                    ? "页面切换后预览已清除，请重新点击“预览”。"
                    : "请先点击“预览”，检查本次公开内容。"
                  : !confirmed
                    ? "预览已生成，请勾选下方确认项后发布。"
                    : "已确认，可以发布。"}
              </p>
              <label className={styles.publishConsent}>
                <input
                  type="checkbox"
                  disabled={disabled || !preview}
                  checked={!!preview && confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  已取得本人对本次所选内容及照片的公开许可，并确认预览内容。
                </span>
              </label>
            </div>
          )}
          {tab === "photos" ? (
            <>
              <span className={styles.hint}>
                上传、排序和移除即时保存；宣传候选需保存设置。
              </span>
              <button
                className={styles.primary}
                onClick={() => switchTab("publication")}
              >
                前往宣传设置
              </button>
            </>
          ) : (
            <>
              <button
                className={styles.secondary}
                disabled={!valid || disabled}
                onClick={() => void act("save")}
              >
                {tab === "basic" ? "保存跟进" : "保存设置"}
              </button>
              {tab === "publication" && (
                <>
                  <button
                    className={styles.secondary}
                    disabled={!valid || disabled}
                    onClick={() => void act("preview")}
                  >
                    预览
                  </button>
                  <button
                    className={styles.primary}
                    disabled={!valid || disabled || !preview || !confirmed}
                    aria-describedby="publish-requirements"
                    onClick={() => void act("publish")}
                  >
                    {busy
                      ? "处理中…"
                      : detail?.management.published
                        ? "更新发布"
                        : "发布"}
                  </button>
                </>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
