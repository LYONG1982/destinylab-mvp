import type { TongzhouCommand, TongzhouSubmission } from "./tongzhou";
export type Gender = "male" | "female";
export type InviteStatus =
  | "SENT"
  | "ACCEPTED"
  | "MEET_ASSIGNED"
  | "ARRIVING"
  | "CONFIRMED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED"
  | "MEET_FAILED";
export type NextChoice = "WALK" | "MERCHANT" | "END";
export interface Participant {
  id: string;
  name: string;
  gender: Gender;
  avatarId: string | null;
  photo?: import("./photo").PhotoAvatar | null;
  avatarVersion?: number;
  age: string;
  ready: boolean;
  present: boolean;
  paused: boolean;
  profileComplete: boolean;
  answers: Record<string, string>;
  currentId: string | null;
  joinedAt: number;
  /** Server-projected completion flag; never accepted as participant input. */
  answerComplete?: boolean;
}
export interface CommonAnswer {
  questionId: string;
  answer: string;
}
export interface Invitation {
  id: string;
  from: string;
  to: string;
  status: InviteStatus;
  createdAt: number;
  acceptedAt?: number;
  realMeetAt?: number;
  pointId: string | null;
  departures: Record<string, number>;
  arrivals: Record<string, number>;
  confirmations: Record<string, number>;
  common: CommonAnswer[];
  choices: Record<string, NextChoice>;
  pass: string;
  code: string;
  /** New pairs allocate personal complementary codes only after mutual acceptance. */
  codeVersion?: "520";
  encounterCodes?: Record<string, string>;
}
export interface MeetPoint {
  id: string;
  name: string;
  location: string;
  distance: number;
  occupant: string | null;
  /** Legacy occupant remains the first entry; reads safely preserve old single slots. */
  occupants?: string[];
  capacity?: number;
  /** Unix timestamp marking a soft-deleted point while preserving its historical identity. */
  deletedAt?: number;
  /** Private numeric holds after archived occupants leave the live list; clear only on physical release. */
  retainedCodes?: string[];
  closed: boolean;
}
export interface HelpRequest {
  id: string;
  participantId: string;
  invitationId: string;
  createdAt: number;
  status: "NEW" | "ACK" | "RESOLVED";
  reply: string;
}
export interface Merchant {
  id: string;
  name: string;
  category: string;
  active: boolean;
  minutes: number;
}
export interface DomainEvent {
  id: string;
  at: number;
  type: string;
  text: string;
  participantId?: string;
  invitationId?: string;
}
export interface DemoState {
  schema: 1;
  epoch: string;
  revision: number;
  now: number;
  wallAt: number;
  scenario: string;
  activityPaused: boolean;
  fieldOpen?: boolean;
  participants: Participant[];
  invitations: Invitation[];
  points: MeetPoint[];
  helps: HelpRequest[];
  merchants: Merchant[];
  events: DomainEvent[];
  scans: string[];
  responses: Record<string, string>;
  merchantViews: string[];
  commands: string[];
  broadcastConsumed: string[];
  tongzhouSubmissions: TongzhouSubmission[];
  displayQuestionId?: string;
  displayGrants?: Record<string, Record<string, boolean>>;
  /** Role-limited network view. Absent from authoritative state and local Mock. */
  live?: {
    activity: string;
    role: "participant" | "operator";
    metrics: ActivityMetrics;
    questions: import("@/lib/api/live-types").QuestionSummary[];
    recommendationIds: string[];
    displayPermissions?: { invitationId: string; otherName: string }[];
  };
}
export interface ActivityMetrics {
  active: number;
  canMeet: number;
  waiting: number;
  mutual: number;
  going: number;
  real: number;
  scans: number;
  answered: number;
  completed: number;
  sent: number;
  merchant: number;
}
export type Actor = string | "operator";
export type Command =
  | import("./photo").AvatarCommand
  | TongzhouCommand
  | { type: "answer"; questionId: string; value: string }
  | {
      type: "profile";
      name: string;
      gender: Gender;
      avatarId: string | null;
      age: string;
      ready: boolean;
    }
  | { type: "ready"; value: boolean }
  | { type: "invite"; targetId: string }
  | {
      type:
        | "accept"
        | "decline"
        | "cancel"
        | "depart"
        | "arrive"
        | "confirm"
        | "help"
        | "rediscover";
      invitationId: string;
    }
  | { type: "next"; invitationId: string; choice: NextChoice }
  | { type: "merchant-view"; invitationId: string; merchantId: string }
  | { type: "pause"; value: boolean }
  | {
      type: "participant";
      participantId: string;
      action: "pause" | "resume" | "leave" | "return" | "hint";
    }
  | { type: "help-status"; helpId: string; status: HelpRequest["status"] }
  | { type: "release"; pointId: string; invitationId?: string }
  | { type: "point-config"; pointId: string; location: string; capacity: number }
  | { type: "point-status"; pointId: string; enabled: boolean }
  | { type: "point-add"; name: string; location?: string; capacity?: number }
  | { type: "point-remove"; pointId: string }
  | { type: "point-capacity-defaults"; mode: "apply" }
  | { type: "merchant"; merchantId: string; active: boolean }
  | { type: "advance"; minutes: number }
  | { type: "broadcast-consume" }
  | { type: "sweep" };
export interface CommandEnvelope {
  id: string;
  actor: Actor;
  epoch: string;
  command: Command;
}
