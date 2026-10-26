/** Screen-only data. Public pair identities require explicit permission. No business IDs or real names. */
export type WorldMode = "CHOICE" | "LIVE" | "MEET";
export type WorldGender = "male" | "female";
export interface WorldPlayer {
  id: string;
  nickname: string;
  avatar: string;
  gender: WorldGender;
  joinedAt: number;
  field: string | null;
  status: string;
  isAvailable: boolean;
  activity: number;
  seed: number;
}
export type WorldEventType =
  | "join"
  | "choice_selected"
  | "presence_changed"
  | "answer"
  | "field_changed"
  | "availability_changed"
  | "mutual_confirmed"
  | "meeting_confirmed";
export interface WorldEvent {
  id: string;
  type: WorldEventType;
  timestamp: number;
  playerId?: string;
  field?: string;
  previousField?: string;
  gender?: WorldGender;
  /** Feedback only. Counts are always read from the snapshot. */
  countDelta?: number;
  presentDelta?: 1 | -1;
  isAvailable?: boolean;
  completed?: boolean;
  aggregateCount?: number;
}
export interface WorldData {
  /** Server-generated activity entry, absent for the isolated visual Mock. */
  joinUrl?: string;
  epoch: string;
  revision: number;
  source: "business" | "mock";
  totalParticipants: number;
  currentParticipants: number;
  availableParticipants: number;
  totalMeetings: number;
  question: {
    id: string;
    title: string;
    options: { id: string; label: string; count: number; percent: number }[];
  };
  participants: WorldPlayer[];
  events: WorldEvent[];
  meetScene?: MeetSceneData;
}
export interface WorldFrame {
  mode: WorldMode;
  modeElapsedMs: number;
  remainingMs: number;
  intersection: null | { id: string; elapsedMs: number; count: number };
}

export interface MeetParticipant extends WorldPlayer {
  allowPublicDisplay: true;
}
export interface MeetPair {
  id: string;
  male: MeetParticipant;
  female: MeetParticipant;
  status: "mutual_confirmed" | "meet_confirmed";
  confirmedAt: number;
  /** Set only by a new confirmed business transition, never a historical load. */
  justConfirmed?: boolean;
}
export interface MeetSceneData {
  qualifiedPairs: MeetPair[];
  connection?: "live" | "offline";
  permissionVerified?: boolean;
  statisticsKnown?: boolean;
  snapshotAt?: number;
  failedAvatarIds?: string[];
}
export type PairCommand = "next" | "previous" | "collision" | "trail" | "spark";
export type PairPhase =
  | "empty"
  | "in"
  | "breathe"
  | "connection"
  | "collision"
  | "hold"
  | "out"
  | "gap";
export interface PairLayout {
  centerX: number;
  centerY: number;
  spread: number;
  avatarSize: number;
  nameSize: number;
  nameWidth: number;
  meetY: number;
}
export interface PairFrame {
  pair: MeetPair;
  slot: number;
  token: number;
  elapsedMs: number;
  phase: PairPhase;
  pattern: number;
  opacity: number;
  justConfirmed: boolean;
  layout: PairLayout;
}
export interface PairSceneFrame {
  slots: PairFrame[];
  elapsedMs: number;
  layoutCount: number;
  trail: boolean;
  spark: boolean;
}
