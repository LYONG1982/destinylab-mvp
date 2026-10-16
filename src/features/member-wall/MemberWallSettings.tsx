"use client";
import { useRef, useState } from "react";
import { DEFAULT_WALL_CONFIG } from "@/domain/member-wall";
import { Button, Notice, Icon } from "@/components/ui";
import { AdminDialog } from "@/features/admin/AdminPrimitives";
import { useWallSettings, toDraft } from "./useWallSettings";
import { WallPreview, wallPreviewUrl } from "./WallPreview";
import styles from "./settings.module.css";
const time = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
export function MemberWallSettings({ activity }: { activity: string }) {
  const f = useWallSettings(activity),
    d = f.data;
  const [help, setHelp] = useState(false),
    helpTrigger = useRef<HTMLButtonElement>(null);
  const valid = !Object.keys(f.errors).length;
  const diagnostics = d?.diagnostics;
  const screenLabels = {
    idle: "未启动",
    active: "主屏会话运行中",
    expired: "主屏会话已到期",
    incompatible: "需重新启动主屏",
    demo: "现场演示模式",
  };
  const state = f.readError
    ? "连接中断 · 状态待确认"
    : !d
      ? "正在连接"
      : diagnostics
        ? screenLabels[diagnostics.screen.status]
        : d.activeScreen
          ? "主屏会话运行中"
          : "当前无有效主控";
  const screenHref = `/display/member-wall?activity=${encodeURIComponent(activity)}`;
  const previewConfig = valid ? f.config : DEFAULT_WALL_CONFIG;
  return (
    <section className={styles.settings} data-testid="wall-settings">
      <header className={styles.pageHead}>
        <div>
          <div className={styles.eyebrow}>DISPLAY · CONTROL</div>
          <h1>遇见卡牌墙</h1>
          <p>配置现场大屏展示内容与播放方式</p>
        </div>
        <div className={styles.actions}>
          <a
            data-wall-preview
            href={wallPreviewUrl(activity, previewConfig)}
            target="_blank"
            rel="noopener noreferrer"
          >
            预览效果
          </a>
          {d && !f.readError ? (
            <a
              className={styles.primaryLink}
              href={screenHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="screen" size={17} />
              打开大屏
            </a>
          ) : (
            <button disabled title="请先成功读取活动状态">
              打开大屏
            </button>
          )}
        </div>
      </header>
      <section
        className={styles.statusPanel}
        aria-label="运行状态"
        aria-busy={!d && f.reading}
      >
        <div className={styles.statusLine}>
          <strong data-testid="wall-screen-status">
            <span
              className={styles.dot}
              data-online={!!d?.activeScreen && !f.readError}
            />
            {state}
          </strong>
          <div>
            <span>
              {f.reading
                ? "正在同步…"
                : f.syncedAt
                  ? `最近同步 ${time(f.syncedAt)}`
                  : "尚未同步"}
            </span>
            <Button
              kind="text"
              disabled={f.reading || f.busy}
              onClick={() => void f.reload()}
            >
              刷新状态
            </Button>
          </div>
        </div>
        <dl className={styles.metrics}>
          {[
            ["在场人数", d?.total],
            ["有效授权人数", diagnostics?.authorizedPresent],
            ["可展示人数", d?.eligible],
            ["当前上屏人数", diagnostics?.onScreen ?? d?.cards.length],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {value ?? "—"}
                <small>{value === undefined ? "" : "人"}</small>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.hint}>
          {f.readError
            ? "以下为上次成功读取的数据，当前状态待确认。"
            : diagnostics?.screen.status === "active"
              ? `由窗口 ${diagnostics.screen.window} 控制 · 最近心跳 ${time(diagnostics.screen.heartbeatAt)} · 本设置页不占用主控`
              : "打开大屏后，需在大屏窗口点击“启动主屏”。预览和保存都不会自动启动。"}
        </p>
        {f.readError && (
          <div className={styles.errorRow}>
            <Notice tone="error">{f.readError}</Notice>
            <Button
              kind="secondary"
              disabled={f.reading}
              onClick={() => void f.reload()}
            >
              重试读取
            </Button>
          </div>
        )}
        {d && !f.readError && d.eligible === 0 && (
          <div className={styles.emptyHint}>
            <strong>
              {d.total === 0
                ? "当前没有在场参与者"
                : diagnostics?.authorizedPresent === 0
                  ? "在场参与者尚无有效展示许可"
                  : "暂时没有符合全部展示条件的参与者"}
            </strong>
            <span>可先用模拟资料预览效果，再查看参与者状态与展示条件。</span>
            <a
              href={`/admin/participants?activity=${encodeURIComponent(activity)}`}
            >
              查看现场参与者 ↗
            </a>
          </div>
        )}
      </section>
      <div className={styles.workspace}>
        <div className={styles.configColumn}>
          <section className={styles.group}>
            <div className={styles.sectionHead}>
              <h2>
                <span>01</span> 数据来源
              </h2>
              <span className={styles.pill}>
                {d
                  ? d.config.mode === "real"
                    ? "真实活动"
                    : "历史演示模式"
                  : "待同步"}
              </span>
            </div>
            <p>使用本场活动中符合展示条件的参与者资料。</p>
            {d?.config.mode === "demo" && (
              <div className={styles.warning}>
                <strong>现场当前为演示模式</strong>
                <p>
                  右侧预览与现场独立。切回真实资料需要保存配置，并重新启动主屏。
                </p>
                <Button
                  kind="secondary"
                  disabled={f.busy}
                  onClick={() => f.edit({ mode: "real" })}
                >
                  {f.draft.mode === "real"
                    ? "已选择真实资料，待保存"
                    : "切回真实活动资料"}
                </Button>
              </div>
            )}
            <details className={styles.conditions}>
              <summary>查看展示条件与人数口径</summary>
              <p>
                在场 → 当前轮次有效展示许可 → 未暂停推荐 →
                资料完整且公开卡片有效。有效授权人数仅统计在场用户；当前上屏人数以服务器槽位为准。
              </p>
              {diagnostics && (
                <ul>
                  <li>已离场：{diagnostics.excluded.left} 人</li>
                  <li>在场但无有效许可：{diagnostics.excluded.consent} 人</li>
                  <li>已许可但暂停推荐：{diagnostics.excluded.paused} 人</li>
                  <li>资料待完善：{diagnostics.excluded.profile} 人</li>
                  <li>公开卡片待校验：{diagnostics.excluded.invalid} 人</li>
                </ul>
              )}
              <p>
                原因按以上顺序归类，不重复计数。运营不能代替用户同意公开；年龄段、昵称、虚拟头像及互动偏好遵循当前展示许可。
              </p>
            </details>
          </section>
          <section className={styles.group}>
            <div className={styles.sectionHead}>
              <h2>
                <span>02</span> 布局规则
              </h2>
              <span className={styles.pill}>固定布局</span>
            </div>
            <div className={styles.layoutRule}>
              <div
                className={styles.seats}
                aria-label="四行六列，每行左三男右三女"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <i key={i} data-gender={i % 6 < 3 ? "male" : "female"} />
                ))}
              </div>
              <div>
                <strong>4 行 × 6 列 · 24 席</strong>
                <p>
                  每行左三男、右三女，男女各12席。
                  <br />
                  不足留空，不重复展示，也不跨区补位。
                </p>
              </div>
            </div>
          </section>
          <section className={styles.group}>
            <div className={styles.sectionHead}>
              <h2>
                <span>03</span> 动效与轮播
              </h2>
            </div>
            <fieldset disabled={!d || f.busy} className={styles.fields}>
              <legend className={styles.srOnly}>动效参数</legend>
              <label htmlFor="wall-flip">
                卡片翻面间隔（秒）
                <input
                  id="wall-flip"
                  type="number"
                  min={8}
                  max={60}
                  step={1}
                  value={f.draft.flipSeconds}
                  aria-invalid={!!f.errors.flipSeconds}
                  aria-describedby="wall-flip-help"
                  onChange={(e) => f.edit({ flipSeconds: e.target.value })}
                />
                <small
                  id="wall-flip-help"
                  className={f.errors.flipSeconds ? styles.fieldError : ""}
                >
                  {f.errors.flipSeconds || "8–60秒，默认10秒；正反面交替。"}
                </small>
              </label>
              <label htmlFor="wall-rotation">
                换人间隔（秒）
                <input
                  id="wall-rotation"
                  type="number"
                  min={Math.max(16, f.config.flipSeconds * 2)}
                  max={600}
                  step={1}
                  value={f.draft.rotationSeconds}
                  aria-invalid={!!f.errors.rotationSeconds}
                  aria-describedby="wall-rotation-help"
                  onChange={(e) => f.edit({ rotationSeconds: e.target.value })}
                />
                <small
                  id="wall-rotation-help"
                  className={f.errors.rotationSeconds ? styles.fieldError : ""}
                >
                  {f.errors.rotationSeconds ||
                    "至少为翻面间隔2倍，最多600秒；默认40秒。"}
                </small>
              </label>
              <label htmlFor="wall-ratio">
                每轮换人比例
                <select
                  id="wall-ratio"
                  value={f.draft.ratio}
                  onChange={(e) =>
                    f.edit({ ratio: Number(e.target.value) as 25 | 50 | 100 })
                  }
                >
                  {[25, 50, 100].map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
                <small>
                  默认25%，男女各最多替换{Math.ceil((12 * f.draft.ratio) / 100)}
                  席。
                </small>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={f.draft.running}
                  onChange={(e) => f.edit({ running: e.target.checked })}
                />
                <span>
                  启用翻面与轮播<small>关闭后停留正面，仍更新展示许可。</small>
                </span>
              </label>
            </fieldset>
            <p className={styles.hint}>
              按每组12席向上取整，实际替换受等待人数限制；换人等待翻面结束、正面稳定后执行。
            </p>
            <div className={styles.privacy}>
              <Icon name="check" size={16} />
              展示许可持续校验，无法关闭
            </div>
          </section>
        </div>
        <div className={styles.sideColumn}>
          <WallPreview activity={activity} config={previewConfig} />
          {!valid && (
            <p className={styles.fieldError}>
              参数尚未有效，预览暂用默认节奏。
            </p>
          )}
          <div className={styles.helpCard}>
            <strong>现场操作指南</strong>
            <p>保存配置 → 打开大屏 → 启动主屏</p>
            <button
              type="button"
              className="button button-text"
              ref={helpTrigger}
              onClick={() => setHelp(true)}
            >
              连接、主控与异常帮助
            </button>
          </div>
        </div>
      </div>
      <details className={styles.statistics}>
        <summary>
          运行统计 <span>累计上屏时长，不是观看人数</span>
        </summary>
        {!d ? (
          <p>读取状态后显示统计。</p>
        ) : !d.exposure.length ? (
          <p>暂无符合展示条件的参与者时长记录。</p>
        ) : (
          <div className={styles.table}>
            <table>
              <thead>
                <tr>
                  <th>公开昵称</th>
                  <th>累计上屏秒数</th>
                  <th>最近上屏</th>
                </tr>
              </thead>
              <tbody>
                {d.exposure.map((x) => (
                  <tr key={x.code}>
                    <td>{x.nickname}</td>
                    <td>{Math.round(x.seconds)}</td>
                    <td>{time(x.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          仅统计当前符合展示条件的参与者，由主控窗口有效心跳累计，不代表观看人数或历史全部参与者。
        </p>
      </details>
      <footer className={styles.saveBar}>
        <div>
          <Button
            kind="text"
            disabled={!d || f.busy}
            onClick={() =>
              f.edit(toDraft({ ...DEFAULT_WALL_CONFIG, mode: f.draft.mode }))
            }
          >
            恢复默认设置
          </Button>
          <span role="status">
            {f.busy
              ? "正在保存…"
              : f.dirty
                ? "有未保存修改"
                : d
                  ? "与服务器配置一致"
                  : "等待配置读取"}
          </span>
        </div>
        <div>
          <Button
            kind="secondary"
            disabled={!d || f.busy || (!f.dirty && !f.conflict)}
            onClick={f.cancel}
          >
            取消更改
          </Button>
          <Button
            disabled={
              !d || f.busy || !f.dirty || !valid || f.conflict || !!f.readError
            }
            onClick={() => void f.save()}
          >
            保存配置
          </Button>
        </div>
        {(f.error ||
          f.conflict ||
          f.message ||
          (!valid && f.dirty) ||
          f.readError) && (
          <div className={styles.saveFeedback}>
            {f.conflict && (
              <Notice tone="error">
                服务器配置已由其他窗口更新。草稿已保留；核对后点击“取消更改”读取新配置，再重新编辑。
              </Notice>
            )}
            {f.error && <Notice tone="error">{f.error}</Notice>}
            {f.message && (
              <Notice tone={f.dirty ? "info" : "success"}>{f.message}</Notice>
            )}
            {!valid && f.dirty && (
              <p className={styles.fieldError}>请修正上方标出的参数后保存。</p>
            )}
            {f.readError && <p>连接恢复前暂停保存，请重试读取。</p>}
          </div>
        )}
      </footer>
      {help && (
        <AdminDialog
          title="现场操作帮助"
          variant="drawer"
          returnFocus={helpTrigger}
          onClose={() => setHelp(false)}
        >
          <div className={styles.helpContent}>
            <h3>主控与只读</h3>
            <p>
              同一活动只有一个有效主控窗口。其他大屏窗口只读，不会抢占；设置和模拟预览页不申请主控。窗口编号是匿名标识，心跳不代表物理显示器播放情况。
            </p>
            <h3>主控断开</h3>
            <p>
              主控约每5秒发送心跳。关闭或断开后，原租约最长15秒到期；确认到期后，在大屏页面手动启动。不能强行接管仍有效的主控。
            </p>
            <h3>保存与恢复</h3>
            <p>
              保存将结束原主屏会话；需要重新启动。网络失败时保留草稿，先重试读取再核对。暂停动效仍持续校验许可；数据失效时大屏隐藏资料，恢复连接后重新读取。
            </p>
            <h3>全屏与布局</h3>
            <p>
              请在大屏窗口主动点击全屏。若浏览器禁止全屏，可使用浏览器自身的全屏功能。小窗口先预览，正式显示建议横屏。
            </p>
          </div>
        </AdminDialog>
      )}
    </section>
  );
}
