import type { DisplayNode } from "../model";

export interface FieldOption {
  key: string;
  label: string;
  count: number;
  percentage: number;
}
export interface FieldQuestion {
  id: string;
  title: string;
  total: number;
  options: FieldOption[];
}
export interface FieldNode extends DisplayNode {
  optionKey: string;
  seed: number;
}
export type Quality = "HIGH" | "MEDIUM" | "LOW";
export const qualitySettings = {
  HIGH: { avatars: 12, particles: 30 },
  MEDIUM: { avatars: 8, particles: 20 },
  LOW: { avatars: 6, particles: 0 },
} as const;
export function stableSeed(value: string) {
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return hash >>> 0;
}
export const unit = (seed: number, salt = 0) =>
  ((Math.imul(seed ^ (salt * 2654435761), 1597334677) >>> 0) % 10000) / 10000;
export function fieldLayout(
  question: FieldQuestion,
  width: number,
  height: number,
) {
  const coordinates =
    question.options.length === 2
      ? [
          [0.27, 0.5],
          [0.73, 0.5],
        ]
      : question.options.length === 4
        ? [
            [0.25, 0.27],
            [0.75, 0.27],
            [0.25, 0.77],
            [0.75, 0.77],
          ]
        : [
            [0.18, 0.6],
            [0.5, 0.46],
            [0.82, 0.6],
          ];
  const max = Math.max(1, ...question.options.map((o) => o.count));
  const base = Math.min(
    width * (question.options.length === 2 ? 0.2 : 0.145),
    height * (question.options.length === 4 ? 0.2 : 0.39),
  );
  return question.options.map((option, i) => ({
    ...option,
    x: width * (coordinates[i]?.[0] ?? 0.5),
    y: height * (coordinates[i]?.[1] ?? 0.5),
    radius: base * (0.84 + 0.16 * Math.sqrt(option.count / max)),
  }));
}
/** Preserve occupied slots across snapshots; never reshuffle everybody on join. */
export function sampleNodes(
  nodes: FieldNode[],
  optionKey: string,
  limit: number,
  priority: string[] = [],
) {
  return nodes
    .filter((n) => n.optionKey === optionKey && !!n.image)
    .sort(
      (a, b) =>
        Number(priority.includes(b.key)) - Number(priority.includes(a.key)) ||
        a.seed - b.seed ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit);
}
export function placeSlots(
  nodes: FieldNode[],
  previous: Map<string, number>,
  capacity: number,
) {
  const slots = new Map<string, number>();
  for (const node of nodes) {
    const slot = previous.get(node.key);
    if (
      slot !== undefined &&
      slot < capacity &&
      ![...slots.values()].includes(slot)
    )
      slots.set(node.key, slot);
  }
  for (const node of nodes)
    if (!slots.has(node.key)) {
      const start = node.seed % capacity;
      for (let i = 0; i < capacity; i++) {
        const slot = (start + i) % capacity;
        if (![...slots.values()].includes(slot)) {
          slots.set(node.key, slot);
          break;
        }
      }
    }
  return slots;
}
