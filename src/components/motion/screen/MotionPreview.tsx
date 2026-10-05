"use client";
import type { MotionController } from "./controller";
import { displayNode } from "./model";
/** Development-only fictional identities. These methods never write business state. */
export function MotionPreview({
  controller,
}: {
  controller: MotionController;
}) {
  if (process.env.NODE_ENV !== "development") return null;
  const mockJoin = () => {
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
  const mockAnswer = () =>
    controller.receive({
      type: "ANSWER",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      option: 1,
    });
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
      <p>只预览效果，不改变人数、答案或相遇次数</p>
      <button onClick={mockJoin}>+ Join</button>
      <button onClick={mockAnswer}>+ Answer</button>
      <button onClick={mockMatch}>+ Match</button>
    </details>
  );
}
