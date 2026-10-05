"use client";
import { useState } from "react";
import Link from "next/link";
import { useDemo, useAction } from "@/lib/demo/hooks";
import { resetScenario } from "@/lib/demo/store";
import { SCENARIOS } from "@/data/seed";
import { MOBILE_ROUTES, MOBILE_TITLES } from "@/data/questions";
import { person, routeFor, stats } from "@/domain/selectors";
import {
  Avatar,
  Badge,
  Brand,
  Button,
  Icon,
  Loading,
  Modal,
  Notice,
  timeText,
} from "@/components/ui";
export function DemoHub() {
  const { state, problem } = useDemo();
  const a = useAction("operator");
  const [reset, setReset] = useState<string | null>(null),
    [resetting, setResetting] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [qr, setQr] = useState("http://localhost:3210/mobile/01-start");
  if (!state) return <Loading />;
  const shan = person(state, "p-shanfeng")!,
    xiao = person(state, "p-xiaoman")!,
    m = stats(state);
  async function load(name: string) {
    setResetting(true);
    setError("");
    try {
      await resetScenario(name);
      setReset(null);
      setInfo("场景已载入，已打开的同源标签页会同步更新。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "场景载入失败");
    } finally {
      setResetting(false);
    }
  }
  return (
    <main className="demo-shell">
      <header className="demo-header">
        <Brand />
        <Badge tone="wine">本地体验 · MVP 1.1</Badge>
      </header>
      <div className="demo-main">
        <section className="demo-intro">
          <div>
            <div className="eyebrow">LET GOOD CONNECTIONS HAPPEN</div>
            <h1>
              让一次相遇，
              <br />
              <span>认真地发生。</span>
            </h1>
            <p>
              这里是缘分实验室的本地体验入口。在同一浏览器中分别打开山风、小满、运营后台和现场大屏，亲手走完一段相遇。
            </p>
            <div className="demo-status">
              <Badge tone="success">
                当前：{SCENARIOS.find((v) => v[0] === state.scenario)?.[1]}
              </Badge>
              <span>真实相遇 {m.real} 次</span>
              <span>演示时间 {timeText(state.now)}</span>
            </div>
          </div>
          <div className="demo-scene">
            <span>在凤城，认真遇见一个人</span>
          </div>
        </section>
        {problem && <Notice tone="error">{problem}</Notice>}
        {!navigator.locks && (
          <Notice>
            此浏览器不支持多标签并发锁，请使用 Chrome
            体验双方联动；当前仅支持单标签顺序操作。
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {a.error && <Notice tone="error">{a.error}</Notice>}
        {info && <Notice tone="success">{info}</Notice>}
        <section className="demo-section">
          <h2>01 · 打开你的体验视角</h2>
          <p>
            山风发出邀请后不会自动变成小满。请在小满的标签页中决定是否接受。
          </p>
          <div className="demo-entry-grid">
            {[shan, xiao].map((p) => (
              <a
                key={p.id}
                className="demo-entry"
                href={`/mobile/${routeFor(state, p)}?actor=${p.id}`}
                target="_blank"
                rel="noopener"
              >
                <Avatar person={p} size="md" />
                <span>
                  <strong>{p.name}视角</strong>
                  <small>
                    {p.id === "p-shanfeng"
                      ? "发起邀请的一方"
                      : "接收邀请的一方"}
                  </small>
                </span>
                <Icon name="arrow" size={18} />
              </a>
            ))}
            <a
              className="demo-entry"
              href="/admin/dashboard"
              target="_blank"
              rel="noopener"
            >
              <Icon name="grid" size={29} />
              <span>
                <strong>现场运营</strong>
                <small>状态、帮助与相遇点</small>
              </span>
              <Icon name="arrow" size={18} />
            </a>
            <a
              className="demo-entry"
              href="/screen"
              target="_blank"
              rel="noopener"
            >
              <Icon name="screen" size={29} />
              <span>
                <strong>现场大屏</strong>
                <small>匿名聚合与自动轮播</small>
              </span>
              <Icon name="arrow" size={18} />
            </a>
          </div>
        </section>
        <section className="demo-section">
          <h2>02 · 选择一个开始的地方</h2>
          <p>
            场景切换会重置本项目的演示状态。建议先“从头体验”，再验证等待、退出和恢复。
          </p>
          <div className="scenario-grid">
            {SCENARIOS.map(([key, title, description]) => (
              <button
                data-testid={`scenario-${key}`}
                className={`scenario-card ${state.scenario === key ? "active" : ""}`}
                key={key}
                onClick={() => setReset(key)}
              >
                <strong>{title}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="demo-section">
          <h2>03 · 验证不那么顺利的时刻</h2>
          <p>
            时间前进会同步影响所有视角。连接模拟只作用于本标签页，设置后点击“本标签继续山风体验”进行验证。
          </p>
          <div className="demo-controls">
            <Button
              kind="secondary"
              onClick={() => a.run({ type: "advance", minutes: 4 })}
            >
              时间前进 4 分钟
            </Button>
            <Button
              kind="secondary"
              onClick={() => a.run({ type: "advance", minutes: 16 })}
            >
              时间前进 16 分钟
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                sessionStorage.setItem("destinylab:fail-next", "yes");
                setInfo(
                  "本标签页的下一次操作会模拟失败。请从下方进入参与者页面验证重试。",
                );
              }}
            >
              下一次请求失败
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                sessionStorage.setItem("destinylab:delay", "2500");
                setInfo("本标签页设为 2.5 秒延迟。");
              }}
            >
              模拟慢连接
            </Button>
            <Button
              kind="secondary"
              onClick={() => {
                sessionStorage.removeItem("destinylab:delay");
                sessionStorage.removeItem("destinylab:fail-next");
                setInfo("本标签页连接已恢复。");
              }}
            >
              恢复连接
            </Button>
            <a
              className="button button-secondary"
              href={`/mobile/${routeFor(state, shan)}?actor=p-shanfeng`}
            >
              本标签继续山风体验
            </a>
          </div>
        </section>
        <section className="demo-section">
          <h2>页面索引</h2>
          <p>
            索引不会替你改变业务状态。状态不满足时会返回当前可操作步骤；先选择对应预设场景再查看后续页面。
          </p>
          <div className="route-index">
            {MOBILE_ROUTES.map((route, i) => (
              <Link href={`/mobile/${route}?actor=p-shanfeng`} key={route}>
                {String(i + 1).padStart(2, "0")} · {MOBILE_TITLES[i]}
              </Link>
            ))}
          </div>
        </section>
        <section className="demo-section">
          <h2>大屏二维码目标地址</h2>
          <p>
            默认 localhost
            仅适用于这台电脑。改为可访问地址后重新打开大屏；不会自动开放网络或启用跨设备状态同步。
          </p>
          <form
            className="qr-setting"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const parsed = new URL(qr);
                if (!["http:", "https:"].includes(parsed.protocol))
                  throw new Error();
                localStorage.setItem("destinylab:qr-url", parsed.toString());
                setInfo("二维码地址已保存，重新打开大屏后生效。");
              } catch {
                setError("请输入有效的 http 或 https 地址。");
              }
            }}
          >
            <input
              aria-label="二维码目标地址"
              value={qr}
              onChange={(e) => setQr(e.target.value)}
            />
            <Button
              type="submit"
              kind="secondary"
              style={{ width: "auto", minHeight: 48, fontSize: 12 }}
            >
              保存二维码地址
            </Button>
          </form>
        </section>
        <footer className="demo-footer">
          <span>
            全部人物、事件和日期均为演示数据。角色选择不是正式身份认证。
          </span>
          <span>首期：同一浏览器多标签联动 ／ 商户核销与服务授权暂不实现</span>
        </footer>
      </div>
      {reset && (
        <Modal
          title={`载入“${SCENARIOS.find((v) => v[0] === reset)?.[1]}”？`}
          onClose={() => setReset(null)}
        >
          <p>
            将重置本项目的演示进度，并同步更新已打开的同源标签页。不会清理其他网站数据。
          </p>
          <Button disabled={resetting} onClick={() => load(reset)}>
            确认载入
          </Button>
          <Button kind="text" onClick={() => setReset(null)}>
            保留当前进度
          </Button>
        </Modal>
      )}
    </main>
  );
}
