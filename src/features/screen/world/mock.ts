import { femaleAvatars, maleAvatars } from "@/config/avatars";
import { QUESTIONS } from "@/data/questions";
import { allocatePercentages, visualSeed } from "./adapter";
import type {
  WorldData,
  WorldEvent,
  WorldPlayer,
  WorldGender,
  MeetPair,
} from "./types";
type MockPlayer = WorldPlayer & { present: boolean; completed: boolean };
const FIELDS = ["q1:0", "q1:1", "q1:2"];
const firstNames = [
  "云",
  "青",
  "秋",
  "林",
  "南",
  "北",
  "星",
  "月",
  "溪",
  "夏",
  "清",
  "晚",
  "若",
];
const lastNames = [
  "初",
  "禾",
  "棠",
  "言",
  "晓",
  "白",
  "舟",
  "安",
  "宁",
  "雨",
  "桐",
  "晴",
];

/** Entirely in memory. Never imports the demo store or writes business state. */
export class WorldMockSource {
  private roster: MockPlayer[] = [];
  private pairs: MeetPair[] = [];
  private pairSequence = 0;
  private connected = true;
  private grantsVerified = true;
  private statisticsKnown = true;
  private failedAvatarIds: string[] = [];
  private listeners = new Set<() => void>();
  private snapshot!: WorldData;
  private sequence = 0;
  private generation = 0;
  private selection = 0;
  private totalMeetings = 28;
  private baselineAt = Date.now();
  constructor() {
    this.reset();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private make(
    index: number,
    field: string | null,
    present: boolean,
    gender: WorldGender = index % 2 ? "female" : "male",
  ): MockPlayer {
    const id = `mock-player-${index + 1}`;
    const avatars = gender === "male" ? maleAvatars : femaleAvatars;
    return {
      id,
      nickname: `${firstNames[Math.floor(index / lastNames.length) % firstNames.length]}${lastNames[index % lastNames.length]}`,
      avatar: avatars[Math.floor(index / 2) % avatars.length].src,
      gender,
      joinedAt: this.baselineAt + index,
      field,
      status: field ? "exploring" : "answering",
      isAvailable: false,
      activity: 0,
      seed: visualSeed(id),
      present,
      completed: !!field,
    };
  }
  private emit(
    type: WorldEvent["type"],
    detail: Omit<WorldEvent, "id" | "timestamp" | "type"> = {},
  ): WorldEvent {
    return {
      id: `mock-event-${this.generation}-${++this.sequence}`,
      type,
      timestamp: Date.now(),
      ...detail,
    };
  }
  private publish(events: WorldEvent[] = []): WorldData {
    const counts = FIELDS.map(
      (field) => this.roster.filter((p) => p.field === field).length,
    );
    const percent = allocatePercentages(counts);
    const active = new Set(
      events.flatMap((event) => (event.playerId ? [event.playerId] : [])),
    );
    this.snapshot = {
      epoch: `mock-world-${this.generation}`,
      revision: this.sequence,
      source: "mock",
      totalParticipants: counts.reduce((sum, n) => sum + n, 0),
      currentParticipants: this.roster.filter((p) => p.present).length,
      availableParticipants: this.roster.filter(
        (p) => p.present && p.isAvailable,
      ).length,
      totalMeetings: this.totalMeetings,
      question: {
        id: "q1",
        title: QUESTIONS[0].title,
        options: FIELDS.map((id, index) => ({
          id,
          label: QUESTIONS[0].options[index],
          count: counts[index],
          percent: percent[index],
        })),
      },
      participants: this.roster
        .filter((p) => p.present)
        .map((player) => ({
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          gender: player.gender,
          joinedAt: player.joinedAt,
          field: player.field,
          status: player.status,
          isAvailable: player.isAvailable,
          activity: active.has(player.id) ? 1 : 0,
          seed: player.seed,
        })),
      events,
      meetScene: {
        connection: this.connected ? "live" : "offline",
        permissionVerified: this.grantsVerified,
        statisticsKnown: this.statisticsKnown,
        snapshotAt: this.baselineAt,
        failedAvatarIds: this.failedAvatarIds,
        qualifiedPairs: this.pairs.map((p) => ({
          ...p,
          male: { ...p.male },
          female: { ...p.female },
        })),
      },
    };
    this.listeners.forEach((listener) => listener());
    return this.snapshot;
  }
  private choose(
    id?: string,
    predicate: (p: MockPlayer) => boolean = () => true,
  ) {
    if (id)
      return this.roster.find((p) => p.id === id && p.present && predicate(p));
    const matching = this.roster.filter((p) => p.present && predicate(p));
    return matching.length
      ? matching[this.selection++ % matching.length]
      : undefined;
  }
  reset = (): WorldData => {
    this.generation++;
    this.connected = this.grantsVerified = this.statisticsKnown = true;
    this.failedAvatarIds = [];
    this.sequence = 0;
    this.selection = 0;
    this.totalMeetings = 28;
    this.baselineAt = Date.now();
    // Deterministic interleaving spreads the visible 37 across all three fields.
    const remaining = [48, 58, 37];
    const assigned = [0, 0, 0];
    this.roster = Array.from({ length: 143 }, (_, index) => {
      const desired = [48, 58, 37].map(
        (n, field) => (n * (index + 1)) / 143 - assigned[field],
      );
      const field = [0, 1, 2]
        .filter((n) => remaining[n] > 0)
        .sort((a, b) => desired[b] - desired[a] || a - b)[0];
      assigned[field]++;
      remaining[field]--;
      return this.make(index, FIELDS[field], index < 37);
    });
    this.pairSequence = 10;
    this.pairs = Array.from({ length: 10 }, (_, index) =>
      this.fixturePair(index, false),
    ).filter((pair): pair is MeetPair => pair !== null);
    return this.publish();
  };
  private fixturePair(index: number, fresh: boolean): MeetPair | null {
    // Explicit fictional fixture pairs; never joins unrelated business profiles.
    const n = index % Math.max(1, Math.floor(this.roster.length / 2));
    const a = this.roster[n * 2],
      b = this.roster[n * 2 + 1];
    if (!a || !b || a.gender === b.gender) return null;
    const male = a.gender === "male" ? a : b;
    const female = a.gender === "female" ? a : b;
    return {
      id: `mock-meet-${n}`,
      male: { ...male, allowPublicDisplay: true },
      female: { ...female, allowPublicDisplay: true },
      status: "meet_confirmed",
      confirmedAt: this.baselineAt - 100000 + index * 1000,
      justConfirmed: fresh,
    };
  }
  private add(gender?: WorldGender, fieldId?: string): WorldEvent[] {
    const field = FIELDS.includes(fieldId ?? "") ? fieldId! : null;
    const player = this.make(this.roster.length, field, true, gender);
    player.completed = false;
    player.status = "answering";
    this.roster.push(player);
    return [
      this.emit("join", {
        playerId: player.id,
        gender: player.gender,
        ...(field ? { field } : {}),
      }),
      this.emit("presence_changed", {
        playerId: player.id,
        gender: player.gender,
        presentDelta: 1,
      }),
      ...(field
        ? [
            this.emit("choice_selected", {
              playerId: player.id,
              gender: player.gender,
              field,
              countDelta: 1,
              aggregateCount: 1,
            }),
          ]
        : []),
    ];
  }
  /** No arguments preserves the original neutral arrival demonstration. */
  join = (gender?: WorldGender, fieldId?: string): WorldData =>
    this.publish(this.add(gender, fieldId));
  burst = (count = 5, gender?: WorldGender, fieldId?: string): WorldData => {
    const amount = Math.max(1, Math.min(100, Math.floor(count) || 5));
    const events: WorldEvent[] = [];
    for (let index = 0; index < amount; index++)
      events.push(
        ...this.add(gender, fieldId ?? FIELDS[index % FIELDS.length]),
      );
    return this.publish(events);
  };
  answer = (id?: string, fieldId?: string): WorldData => {
    const player = id
      ? this.choose(id)
      : (this.choose(undefined, (p) => !p.completed) ?? this.choose());
    if (!player) return this.snapshot;
    const previousField = player.field;
    const next = FIELDS.includes(fieldId ?? "")
      ? fieldId!
      : (player.field ?? FIELDS[this.selection % FIELDS.length]);
    const wasComplete = player.completed;
    if (wasComplete && previousField === next) return this.snapshot;
    player.field = next;
    player.completed = true;
    player.status = player.isAvailable ? "available" : "exploring";
    return this.publish([
      this.emit(
        !previousField
          ? "choice_selected"
          : previousField !== next
            ? "field_changed"
            : "answer",
        {
          playerId: player.id,
          gender: player.gender,
          field: next,
          ...(previousField && previousField !== next ? { previousField } : {}),
          countDelta: previousField ? 0 : 1,
          aggregateCount: 1,
          completed: true,
        },
      ),
    ]);
  };
  field = (id?: string, fieldId?: string): WorldData => {
    const player = this.choose(id);
    if (!player) return this.snapshot;
    const previousField = player.field;
    const next = FIELDS.includes(fieldId ?? "")
      ? fieldId!
      : FIELDS[(FIELDS.indexOf(previousField ?? "") + 1) % FIELDS.length];
    if (next === previousField) return this.snapshot;
    player.field = next;
    return this.publish([
      this.emit(previousField ? "field_changed" : "choice_selected", {
        playerId: player.id,
        gender: player.gender,
        field: next,
        ...(previousField ? { previousField } : {}),
        countDelta: previousField ? 0 : 1,
        aggregateCount: 1,
        completed: player.completed,
      }),
    ]);
  };
  open = (id?: string): WorldData => {
    const player = this.choose(id, (p) => p.completed && !p.isAvailable);
    if (!player) return this.snapshot;
    player.isAvailable = true;
    player.status = "available";
    return this.publish([
      this.emit("availability_changed", {
        playerId: player.id,
        isAvailable: true,
      }),
    ]);
  };
  close = (id?: string): WorldData => {
    const player = this.choose(id, (p) => p.isAvailable);
    if (!player) return this.snapshot;
    player.isAvailable = false;
    player.status = "exploring";
    return this.publish([
      this.emit("availability_changed", {
        playerId: player.id,
        isAvailable: false,
      }),
    ]);
  };
  mutual = (count = 1): WorldData =>
    this.publish([
      this.emit("mutual_confirmed", {
        aggregateCount: Math.max(1, Math.min(99, Math.floor(count) || 1)),
      }),
    ]);
  meet = (count = 1): WorldData => {
    const amount = Math.max(1, Math.min(99, Math.floor(count) || 1));
    this.totalMeetings += amount;
    this.pairs = this.pairs.map((p) => ({ ...p, justConfirmed: false }));
    if (this.roster.length >= 2)
      for (let i = 0; i < amount; i++) {
        const pair = this.fixturePair(this.pairSequence++, true);
        if (!pair) continue;
        this.pairs = this.pairs.filter((p) => p.id !== pair.id);
        this.pairs.push(pair);
      }
    return this.publish([
      this.emit("meeting_confirmed", { aggregateCount: amount }),
    ]);
  };
  revokePairs = (): WorldData => {
    this.pairs = [];
    this.sequence++;
    return this.publish();
  };
  onePair = (): WorldData => {
    const pair = this.fixturePair(0, false);
    this.pairs = pair ? [pair] : [];
    this.sequence++;
    return this.publish();
  };
  pairCount = (count: number): WorldData => {
    this.pairs = Array.from(
      { length: Math.min(40, Math.max(0, count)) },
      (_, i) => this.fixturePair(i, false),
    ).filter((p): p is MeetPair => !!p);
    this.pairSequence = Math.max(10, count);
    this.sequence++;
    return this.publish();
  };
  revokePair = (id?: string): WorldData => {
    const target = id ?? this.pairs[0]?.id;
    this.pairs = this.pairs.filter((p) => p.id !== target);
    this.sequence++;
    return this.publish();
  };
  duplicatePair = (): WorldData => {
    this.sequence++;
    return this.publish();
  };
  connectPair = (): WorldData => {
    const p = this.fixturePair(this.pairSequence++, true);
    this.pairs = this.pairs.map((p) => ({ ...p, justConfirmed: false }));
    if (p) this.pairs.push({ ...p, status: "mutual_confirmed" });
    this.sequence++;
    return this.publish();
  };
  upgradePair = (): WorldData => {
    const p = this.pairs.find((p) => p.status === "mutual_confirmed");
    if (p) {
      p.status = "meet_confirmed";
      p.confirmedAt = Date.now();
      p.justConfirmed = true;
      this.totalMeetings++;
    }
    this.sequence++;
    return this.publish();
  };
  network = (connected: boolean, verified = false): WorldData => {
    this.connected = connected;
    this.grantsVerified = connected || verified;
    this.pairs = this.pairs.map((p) => ({ ...p, justConfirmed: false }));
    this.sequence++;
    return this.publish();
  };
  unknownStatistics = (): WorldData => {
    this.statisticsKnown = false;
    this.sequence++;
    return this.publish();
  };
  failedAvatar = (): WorldData => {
    this.failedAvatarIds = this.pairs[0] ? [this.pairs[0].male.id] : [];
    this.sequence++;
    return this.publish();
  };
  conflictPair = (): WorldData => {
    const p = this.fixturePair(10, true),
      first = this.pairs[0];
    if (p && first) this.pairs.push({ ...p, male: { ...first.male } });
    this.sequence++;
    return this.publish();
  };
  stress = (): WorldData => {
    this.reset();
    this.roster.forEach((p) => {
      p.present = true;
    });
    this.sequence++;
    return this.publish();
  };
  empty = (): WorldData => {
    this.generation++;
    this.connected = this.grantsVerified = this.statisticsKnown = true;
    this.failedAvatarIds = [];
    this.sequence = 0;
    this.roster = [];
    this.pairs = [];
    this.totalMeetings = 0;
    return this.publish();
  };
}
export const mockWorld = new WorldMockSource();
