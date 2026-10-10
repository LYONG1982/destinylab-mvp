import type { WorldGender, WorldMode, WorldPlayer } from "./types";

export type PlayerQueuePhase = "enter" | "hold" | "move" | "exit";
export type PlayerLayoutMode = Exclude<WorldMode, "MEET">;
export const DEFAULT_WORLD_FIELDS = ["q1:0", "q1:1", "q1:2"] as const;
export const PLAYER_LAYOUT = {
  width: 1920,
  height: 1080,
  CHOICE: {
    capacity: 5,
    avatarSize: 80,
    nameSize: 24,
    nameWidth: 128,
    gap: 12,
    firstCenterY: 352,
    rowGap: 104,
    fieldCenters: [328, 832, 1336] as readonly number[],
  },
  LIVE: {
    capacity: 6,
    avatarSize: 96,
    nameSize: 28,
    nameWidth: 148,
    gap: 20,
    firstCenterY: 348,
    rowGap: 112,
  },
} as const;

/** Coordinates are item top-left in the shared 1920 x 1080 logical canvas. */
export interface PlayerPlacement {
  id: string;
  player: WorldPlayer;
  mode: WorldMode;
  nameY?: number;
  pairId?: string;
  pairPhase?: string;
  centeredName?: boolean;
  gender: WorldGender;
  field: string | null;
  queueKey: string;
  slot: number;
  x: number;
  y: number;
  width: number;
  height: number;
  avatarSize: number;
  avatarCenterX: number;
  avatarCenterY: number;
  nameSize: number;
  nameWidth: number;
  gap: number;
  reverse: boolean;
  opacity: number;
  phase: PlayerQueuePhase;
}
export interface SlotPlacement {
  player: WorldPlayer;
  mode: PlayerLayoutMode;
  queueKey: string;
  slot: number;
  fieldIndex?: number;
  offsetY?: number;
  opacity?: number;
  phase?: PlayerQueuePhase;
}
export function placementForSlot({
  player,
  mode,
  queueKey,
  slot,
  fieldIndex = 0,
  offsetY = 0,
  opacity = 1,
  phase = "hold",
}: SlotPlacement): PlayerPlacement {
  const spec = PLAYER_LAYOUT[mode];
  const reverse = mode === "LIVE" && player.gender === "female";
  const center =
    PLAYER_LAYOUT.CHOICE.fieldCenters[Math.max(0, Math.min(2, fieldIndex))];
  const x =
    mode === "CHOICE"
      ? center + (player.gender === "male" ? -240 : 20)
      : player.gender === "male"
        ? 368
        : 1288;
  const y =
    spec.firstCenterY - spec.avatarSize / 2 + slot * spec.rowGap + offsetY;
  const width = spec.avatarSize + spec.gap + spec.nameWidth;
  return {
    id: player.id,
    player,
    mode,
    gender: player.gender,
    field: player.field,
    queueKey,
    slot,
    x,
    y,
    width,
    height: spec.avatarSize,
    avatarSize: spec.avatarSize,
    avatarCenterX:
      x + (reverse ? width - spec.avatarSize / 2 : spec.avatarSize / 2),
    avatarCenterY: y + spec.avatarSize / 2,
    nameSize: spec.nameSize,
    nameWidth: spec.nameWidth,
    gap: spec.gap,
    reverse,
    opacity: Math.max(0, Math.min(1, opacity)),
    phase,
  };
}
