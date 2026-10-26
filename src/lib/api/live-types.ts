import type { Command, DemoState } from "@/domain/types";
import type { WorldData } from "@/features/screen/world/types";

export type Audience = "participant" | "operator" | "screen";
export type LiveCommand =
  | Command
  | { type: "point-add"; name: string }
  | { type: "display-question"; questionId: string }
  | { type: "display-consent"; invitationId: string; allow: boolean };
export interface LiveSnapshot {
  activity: string;
  revision: number;
  actor?: string;
  state?: DemoState;
  world?: WorldData;
}
export interface QuestionSummary {
  id: string;
  title: string;
  total: number;
  options: { label: string; count: number; percentage: number }[];
}
