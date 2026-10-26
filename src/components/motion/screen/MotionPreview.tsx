"use client";
import type { MotionController } from "./controller";
import { displayNode } from "./model";
/** Development-only fictional identities. These methods never write business state. */
export function MotionPreview({
  controller,
  onFields,
  onFieldEvent,
}: {
  controller: MotionController;
  onFields?: (count: number | null) => void;
  onFieldEvent?: (kind: "join" | "answer") => void;
}) {
  if (process.env.NODE_ENV !== "development") return null;
  const mockJoin = () => {
    if (controller.fieldActive && onFieldEvent) {
      onFieldEvent("join");
      return;
    }
    const now = performance.now();
    const node = displayNode("preview", {
      mode: "PUBLIC",
      name: "虚构小雨",
      image: "/assets/avatar-female.png",
      displayGranted: true,
    });
    controller.preview(node, now);
    controller.receive({
      type: "JOIN",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      node: node.key,
    });
    window.dispatchEvent(new Event("resize"));
  };
  const mockAnswer = () => {
    if (controller.fieldActive && onFieldEvent) {
      onFieldEvent("answer");
      return;
    }
    controller.receive({
      type: "ANSWER",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      option: 1,
    });
  };
  const mockMatch = () =>
    controller.receive({
      type: "MATCH",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      phase: "confirmed",
      aggregate: true,
    });
  return (
    <details className="screen-motion-preview">
      <summary>虚构动效预览</summary>
      <p>虚构视觉数据，不写入业务答案、人数或相遇次数</p>
      <button onClick={mockJoin}>+ Join</button>
      <button onClick={mockAnswer}>+ Answer</button>
      <button onClick={mockMatch}>+ Match</button>
      {onFields && (
        <div>
          {[2, 3, 4, 0].map((count) => (
            <button key={count} onClick={() => onFields(count)}>
              {count ? `${count} 个答案` : "冷启动"}
            </button>
          ))}
          <button onClick={() => onFields(null)}>返回业务数据</button>
        </div>
      )}
    </details>
  );
}
