"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { TONGZHOU_FIELDS } from "@/domain/tongzhou";
import {
  REGISTRATION_STATUS,
  type RegistrationConfig,
  type RegistrationRecord,
} from "@/domain/registration";
import {
  isRegistrationReceipt,
  isLegacyRegistrationReceipt,
  normalizeRegistrationReceipt,
} from "@/domain/registration-receipt";
import { registrationApi } from "./client";
import "./registration.css";
type Listing = {
  items: {
    id: string;
    nickname: string;
    gender: string;
    birth_year: string;
    city: string;
    phone: string;
    status: keyof typeof REGISTRATION_STATUS;
    created_at: string;
    agency_allowed: boolean;
  }[];
  total: number;
  stats: { total: number; checked_in: number; male: number; female: number };
  config: RegistrationConfig;
};
export function RegistrationAdmin({
  activity,
  settingsOnly = false,
}: {
  activity: string;
  settingsOnly?: boolean;
}) {
  const [data, setData] = useState<Listing | null>(null),
    [term, setTerm] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<RegistrationRecord | null>(null),
    [config, setConfig] = useState<RegistrationConfig | null>(null),
    [receipt, setReceipt] = useState(""),
    [legacyReceipt, setLegacyReceipt] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(""),
    [url, setUrl] = useState("");
  const [refreshing, setLoading] = useState(false),
    [status, setStatus] = useState(""),
    [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState("");
  const loading =
    refreshing || settledKey !== [activity, query, page, status].join("|");
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    const d = await registrationApi<Listing>(
      activity,
      `records?q=${encodeURIComponent(query)}&page=${page}&status=${status}`,
    );
    setData(d);
    setLastUpdated(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    setError("");
    setConfig((c) => c || d.config);
  }, [activity, query, page, status]);
  useEffect(() => {
    let active = true;
    registrationApi<Listing>(
      activity,
      `records?q=${encodeURIComponent(query)}&page=${page}&status=${status}`,
    )
      .then((d) => {
        if (active) {
          setData(d);
          setLastUpdated(
            new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          );
          setError("");
          setConfig((c) => c || d.config);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setSettledKey([activity, query, page, status].join("|"));
      });
    return () => {
      active = false;
    };
  }, [activity, query, page, status]);
  useEffect(() => {
    const link =
      window.location.origin +
      `/mobile/register?activity=${encodeURIComponent(activity)}`;
    void QRCode.toDataURL(link, {
      width: 240,
      margin: 2,
      color: { dark: "#741f2f", light: "#fffdf9" },
    }).then((value) => {
      setQr(value);
      setUrl(link);
    });
  }, [activity]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function manage(action: string) {
    if (!detail) return;
    await run(async () => {
      await registrationApi(activity, "manage", {
        action,
        id: detail.id,
        version: detail.version,
        receipt: normalizeRegistrationReceipt(receipt),
      });
      setDetail(await registrationApi(activity, `records?id=${detail.id}`));
      await refresh();
      setMessage(
        action === "checkin"
          ? "签到已确认。现场互动入口独立开放。"
          : "报名已取消。",
      );
    });
  }
  return (
    <section className="reg-admin">
      {error && (
        <p className="reg-admin-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="reg-admin-hint" role="status">
          {message}
        </p>
      )}
      {!settingsOnly && (
        <>
          <div className="reg-sync" role="status">
            <span>
              {loading
                ? "正在读取报名数据…"
                : error
                  ? "报名数据读取失败，当前内容可能不是最新"
                  : lastUpdated
                    ? `报名数据更新于 ${lastUpdated}`
                    : "尚未读取报名数据"}
            </span>
            <a
              href={`/admin/activities?activity=${encodeURIComponent(activity)}`}
            >
              活动管理与二维码 ↗
            </a>
          </div>
          {data && (
            <div className="reg-admin-summary">
              <span>
                有效报名<strong>{data.stats.total}</strong>
              </span>
              <span>
                男生<strong>{data.stats.male}</strong>
              </span>
              <span>
                女生<strong>{data.stats.female}</strong>
              </span>
              <span>
                已签到<strong>{data.stats.checked_in}</strong>
              </span>
            </div>
          )}
          <p className="reg-admin-hint">
            本活动有效报名（不含已取消，不受搜索影响）
          </p>
          <form
            className="reg-admin-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(term);
              setPage(1);
            }}
          >
            <input
              aria-label="搜索报名"
              placeholder="昵称 / 完整手机号 / 报名凭证"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              maxLength={80}
            />
            <select
              aria-label="报名状态筛选"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部报名状态</option>
              {Object.entries(REGISTRATION_STATUS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || loading}
              onClick={() => {
                setTerm("");
                setQuery("");
                setStatus("");
                setPage(1);
              }}
            >
              重置
            </button>
            <button
              className="button button-secondary"
              disabled={busy || loading}
            >
              查询
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setLoading(true);
                  try {
                    await refresh();
                  } finally {
                    setLoading(false);
                  }
                })
              }
            >
              刷新
            </button>
            <a
              className="reg-admin-link"
              href={`/mobile/register?activity=${activity}`}
              target="_blank"
              rel="noreferrer"
            >
              打开手机报名入口 ↗
            </a>
          </form>
          <section className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {[
                      "昵称",
                      "性别 / 出生年份",
                      "常住城市",
                      "联系电话",
                      "报名状态",
                      "同舟服务",
                      "报名时间",
                      "操作",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.nickname}</strong>
                      </td>
                      <td>
                        {r.gender} · {r.birth_year}
                      </td>
                      <td>{r.city}</td>
                      <td>{r.phone}</td>
                      <td>{REGISTRATION_STATUS[r.status]}</td>
                      <td>{r.agency_allowed ? "已选择" : "未选择"}</td>
                      <td>
                        {new Date(r.created_at).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td>
                        <button
                          className="table-action"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              setDetail(
                                await registrationApi(
                                  activity,
                                  `records?id=${r.id}`,
                                ),
                              );
                              setReceipt("");
                              setLegacyReceipt(false);
                            })
                          }
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && !loading && !error && !data.items.length && (
              <p className="reg-admin-hint" style={{ padding: 24 }}>
                {query || status
                  ? "没有符合筛选条件的报名，可重置条件后重试。"
                  : "当前活动还没有报名，可分享报名二维码。"}
              </p>
            )}
            {data && (
              <div className="pagination">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ‹
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil((data?.total || 0) / 20))} ·
                  共 {data?.total || 0} 人
                </span>
                <button
                  disabled={page * 20 >= (data?.total || 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  ›
                </button>
              </div>
            )}
          </section>
          <p className="reg-admin-hint">
            报名与现场互动独立管理。报名不自动加入现场，也不会自动公开生活资料或照片。
          </p>
        </>
      )}
      {settingsOnly && (
        <details className="reg-admin-config" open>
          <summary>报名入口与活动配置</summary>
          {qr && (
            <img className="reg-admin-qr" src={qr} alt="手机报名入口二维码" />
          )}
          <p>
            <a
              className="reg-admin-link"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {url}
            </a>
          </p>
          <p className="reg-admin-hint">
            二维码只包含当前活动报名入口，不包含个人资料。
          </p>
          {config && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await registrationApi(activity, "manage", {
                    action: "config",
                    config,
                  });
                  await refresh();
                  setMessage("活动报名配置已保存。");
                });
              }}
            >
              {(
                [
                  "title",
                  "headline",
                  "date",
                  "location",
                  "description",
                ] as const
              ).map((k, i) => (
                <label className="reg-field" key={k}>
                  <span>
                    {
                      [
                        "活动名称",
                        "首页主标题",
                        "活动时间",
                        "活动地点",
                        "活动说明",
                      ][i]
                    }
                  </span>
                  <input
                    value={config[k]}
                    maxLength={k === "description" ? 240 : 80}
                    required={k === "title" || k === "headline"}
                    onChange={(e) =>
                      setConfig({ ...config, [k]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className="reg-check">
                <input
                  type="checkbox"
                  checked={config.open}
                  onChange={(e) =>
                    setConfig({ ...config, open: e.target.checked })
                  }
                />
                <span>开放新报名（关闭后已有用户仍可查看和完善资料）</span>
              </label>
              <button
                className="button button-primary"
                style={{ marginTop: 20 }}
                disabled={busy}
              >
                保存配置
              </button>
            </form>
          )}
        </details>
      )}
      {detail && (
        <div className="reg-admin-drawer-wrap">
          <aside
            className="reg-admin-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="报名详情"
          >
            <button
              className="reg-admin-close"
              aria-label="关闭详情"
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            <h2>{detail.nickname}</h2>
            <p className="reg-admin-hint">
              {REGISTRATION_STATUS[detail.status]} ·{" "}
              {detail.agencyAllowed
                ? "已选择同舟专业服务"
                : "尚未选择同舟专业服务"}
            </p>
            <div className="reg-admin-detail">
              {TONGZHOU_FIELDS.map((f) => (
                <div key={f.key}>
                  <small>{f.label}</small>
                  <p>{detail.fields[f.key] || "未填写"}</p>
                </div>
              ))}
            </div>
            <h3 style={{ marginTop: 28 }}>
              个人相册 · {detail.photos.length} 张
            </h3>
            <div className="reg-admin-photos">
              {detail.photos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                  <img src={p.thumbnail} alt="报名用户生活照片" />
                </a>
              ))}
            </div>
            <div className="reg-admin-checkin">
              <p className="reg-admin-hint">
                请现场核对用户信息，并输入用户手机上的报名凭证。签到不会代替用户进入互动。
              </p>
              <input
                aria-label="核验报名凭证"
                value={receipt}
                maxLength={legacyReceipt ? 16 : 6}
                inputMode={legacyReceipt ? "text" : "numeric"}
                autoComplete="off"
                placeholder={
                  legacyReceipt ? "输入旧版 16 位凭证" : "输入六位数字签到凭证"
                }
                onChange={(e) =>
                  setReceipt(
                    normalizeRegistrationReceipt(e.target.value).replace(
                      legacyReceipt ? /[^0-9A-F]/g : /[^0-9]/g,
                      "",
                    ),
                  )
                }
                onPaste={(e) => {
                  e.preventDefault();
                  setReceipt(
                    normalizeRegistrationReceipt(
                      e.clipboardData.getData("text"),
                    )
                      .replace(legacyReceipt ? /[^0-9A-F]/g : /[^0-9]/g, "")
                      .slice(0, legacyReceipt ? 16 : 6),
                  );
                }}
              />
              <button
                type="button"
                className="reg-admin-link"
                disabled={busy}
                onClick={() => {
                  setLegacyReceipt(!legacyReceipt);
                  setReceipt("");
                }}
              >
                {legacyReceipt ? "返回六位数字核验" : "使用旧版凭证"}
              </button>
              <div>
                <button
                  className="button button-primary"
                  disabled={
                    busy ||
                    detail.status === "cancelled" ||
                    !(legacyReceipt
                      ? isLegacyRegistrationReceipt(receipt)
                      : isRegistrationReceipt(receipt))
                  }
                  onClick={() => void manage("checkin")}
                >
                  核验并签到
                </button>
                <button
                  className="button button-secondary"
                  disabled={
                    busy || detail.status === "cancelled" || detail.entered
                  }
                  onClick={() => {
                    if (window.confirm("确认取消此用户的活动报名？"))
                      void manage("cancel");
                  }}
                >
                  取消报名
                </button>
              </div>
              {error && (
                <p className="reg-admin-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="reg-admin-hint" role="status">
                  {message}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
