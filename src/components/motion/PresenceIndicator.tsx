import { Ambient } from "./Motion";
import { AnimatedCounter } from "./AnimatedCounter";
export function PresenceIndicator({ count }: { count: number }) {
  return (
    <div className="presence-indicator">
      <span>此刻 · 鼓楼</span>
      <span>
        <Ambient>
          <i className="pulse-dot" />
        </Ambient>
        <AnimatedCounter value={count} /> 人在探索
      </span>
    </div>
  );
}
