import type { ScreenEvent } from "../model";
import type { FieldNode } from "./layout";
export type FieldEvent = ScreenEvent & {
  field: NonNullable<ScreenEvent["field"]>;
};
export type FieldArrival = FieldEvent & { started: number };
export class JoinEventQueue {
  pending: FieldEvent[] = [];
  active: FieldArrival[] = [];
  notice: { text: string; until: number } | null = null;
  private next = 0;
  private window = -Infinity;
  private individuals = 0;
  private aggregate = new Map<
    string,
    { count: number; label: string; timestamp: number }
  >();
  private priority = new Map<string, number>();
  enqueue(event: FieldEvent, now: number) {
    if (event.node) {
      this.pending = this.pending.filter((e) => e.node !== event.node);
      this.active = this.active.filter((e) => e.node !== event.node);
    }
    if (now - this.window > 600) {
      this.window = now;
      this.individuals = 0;
    }
    if (this.individuals >= 3 || !event.node) {
      const key = `${event.field.questionKey}:${event.field.optionKey}:${event.field.kind}`;
      const group = this.aggregate.get(key) ?? {
        count: 0,
        label: event.field.optionLabel,
        timestamp: event.timestamp,
      };
      group.count += event.field.amount ?? 1;
      group.timestamp = event.timestamp;
      this.aggregate.set(key, group);
      if (this.aggregate.size > 8)
        this.aggregate.delete(this.aggregate.keys().next().value!);
      return;
    }
    this.individuals++;
    this.pending.push(event);
    this.pending = this.pending.slice(-32);
  }
  reconcile(nodes: FieldNode[], questionKey: string) {
    const valid = (e: FieldEvent) =>
      e.field.questionKey === questionKey &&
      nodes.some((n) => n.key === e.node && n.optionKey === e.field.optionKey);
    this.pending = this.pending.filter(valid);
    this.active = this.active.filter(valid);
    const keys = new Set(nodes.map((n) => n.key));
    for (const key of this.priority.keys())
      if (!keys.has(key)) this.priority.delete(key);
  }
  tick(now: number, wall = Date.now()) {
    this.pending = this.pending.filter((e) => wall - e.timestamp <= 5000);
    this.active = this.active.filter((e) => now - e.started < 1500);
    for (const [key, until] of this.priority)
      if (until <= now) this.priority.delete(key);
    if (now >= this.next && this.active.length < 3 && this.pending.length) {
      const e = this.pending.shift()!;
      this.active.push({ ...e, started: now });
      this.priority.set(e.node!, now + 12000);
      while (this.priority.size > 36)
        this.priority.delete(this.priority.keys().next().value!);
      this.next = now + 350;
      const name = e.field.label ? `「${e.field.label}」` : "有 1 个人";
      this.notice = {
        text:
          e.field.kind === "move"
            ? `刚刚，${name}更新了选择：${e.field.optionLabel}`
            : `刚刚，${name}加入了「${e.field.optionLabel}」`,
        until: now + 3000,
      };
    } else if (
      !this.pending.length &&
      this.aggregate.size &&
      now >= this.next
    ) {
      const entry = this.aggregate.entries().next().value!;
      this.aggregate.delete(entry[0]);
      if (wall - entry[1].timestamp <= 5000)
        this.notice = {
          text: `${entry[1].count} 个人更新了「${entry[1].label}」的选择`,
          until: now + 3000,
        };
      this.next = now + 3000;
    }
    if (this.notice && now >= this.notice.until) this.notice = null;
  }
  priorities() {
    return [...this.priority.keys()];
  }
  clear() {
    this.pending = [];
    this.active = [];
    this.notice = null;
    this.aggregate.clear();
    this.priority.clear();
    this.next = 0;
    this.window = -Infinity;
    this.individuals = 0;
  }
}
