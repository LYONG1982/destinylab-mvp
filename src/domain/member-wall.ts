import { AGES, QUESTIONS } from "../data/questions";
import { defaultAvatarId, getAvatarById } from "../config/avatars";
import type { Participant } from "./types";

export const WALL_CONSENT_VERSION = "member-wall-2026-10-12-v4";
export const WALL_QUESTION_IDS = ["q3", "q5", "q6", "q8", "q9"] as const;
export const WALL_TTL_MS = 15000;
export const WALL_COLUMNS = 6;
export const WALL_CAPACITY = 24;
export const WALL_GROUP_CAPACITY = 12;
export type WallSlots = (string | null)[];
export interface PublicMemberCard {
  id: string;
  encounterCode: string;
  nickname: string;
  gender: Participant["gender"];
  slot?: number;
  avatarUrl: string;
  ageRange: string | null;
  tags: string[];
  preferences: { label: string; value: string }[];
  consentToPublicDisplay: true;
  displayStatus: "active";
}
export interface WallConfig {
  mode: "real" | "demo";
  running: boolean;
  flipSeconds: number;
  rotationSeconds: number;
  ratio: 25 | 50 | 100;
  minColumns: number;
  maxColumns: number;
}
export const DEFAULT_WALL_CONFIG: WallConfig = {
  mode: "real", running: true, flipSeconds: 10, rotationSeconds: 40,
  ratio: 25, minColumns: WALL_COLUMNS, maxColumns: WALL_COLUMNS,
};
export interface WallSnapshot {
  activity: string;
  epoch: string;
  revision: number;
  configVersion: number;
  config: WallConfig;
  cards: PublicMemberCard[];
  total: number;
  male: number;
  female: number;
  eligible: number;
  activeScreen: boolean;
  batch: number;
  serverTime: number;
  cycleStartedAt: number;
  validForMs: number;
  joinUrl: string;
}
export interface WallConsentView {
  version: number;
  allowed: boolean;
  nickname: string;
  preview: PublicMemberCard | null;
  eligible: boolean;
  consentVersion: string;
}
export function wallNickname(value: unknown): string {
  if (typeof value !== "string") throw Error("请填写公开昵称。");
  const s = value.normalize("NFC").trim();
  if (!s || Array.from(s).length > 8 || /[\p{C}\p{Zl}\p{Zp}<>@:/\\]/u.test(s) ||
    /\d{5}|https?|www\.|微信|微.?信号|手机号|电话|联系方式|wechat|vx|qq/i.test(s))
    throw Error("请使用 1–8 字昵称，不含联系方式、网址或特殊控制字符。");
  return s;
}
export function validateWallConfig(input: unknown): WallConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("展示配置无效。");
  const c = input as WallConfig;
  if (Object.keys(c).sort().join() !== Object.keys(DEFAULT_WALL_CONFIG).sort().join() ||
    !["real", "demo"].includes(c.mode) || typeof c.running !== "boolean" ||
    !Number.isInteger(c.flipSeconds) || c.flipSeconds < 8 || c.flipSeconds > 60 ||
    !Number.isInteger(c.rotationSeconds) || c.rotationSeconds < c.flipSeconds * 2 || c.rotationSeconds > 600 ||
    ![25, 50, 100].includes(c.ratio) || !Number.isInteger(c.minColumns) || !Number.isInteger(c.maxColumns) ||
    c.minColumns < 3 || c.maxColumns > 8 || c.minColumns > c.maxColumns)
    throw Error("请检查周期、比例和列数；换人周期至少为翻面周期的两倍。");
  return { ...c, minColumns: WALL_COLUMNS, maxColumns: WALL_COLUMNS };
}
export function wallDemographics(people: readonly { gender?: unknown }[]) {
  return { total: people.length, male: people.filter((p) => p.gender === "male").length,
    female: people.filter((p) => p.gender === "female").length };
}
export function wallAgeRange(value: unknown): string | null {
  return typeof value === "string" && AGES.includes(value) ? value : null;
}
export function wallAgeLabel(value: unknown): string {
  const age = wallAgeRange(value);
  return age === "38+" ? "38岁及以上" : age ? `${age}岁` : "";
}
export function memberCard(p: Participant, id: string, code: string, nickname: string): PublicMemberCard {
  if (!["male", "female"].includes(p.gender)) throw Error("请先完善性别资料。");
  const choice = (key: string) => {
    const q = QUESTIONS.find((q) => q.id === key);
    return q && (q.options as readonly string[]).includes(p.answers[key])
      ? { label: q.short, value: p.answers[key] } : null;
  };
  const avatar = getAvatarById(p.avatarId) || getAvatarById(defaultAvatarId(p.id, p.gender));
  return { id, encounterCode: code, nickname: wallNickname(nickname), gender: p.gender, avatarUrl: avatar!.src, ageRange: wallAgeRange(p.age),
    tags: ["q3", "q5"].flatMap((key) => { const c = choice(key); return c ? [c.value] : []; }),
    preferences: [["q5", "周末偏好"], ["q6", "见面看重"], ["q8", "沟通方式"], ["q9", "关系期待"]].flatMap(([key, label]) => { const c = choice(key); return c ? [{ ...c, label }] : []; }),
    consentToPublicDisplay: true, displayStatus: "active" };
}
export function safeWallCard(value: PublicMemberCard): boolean {
  try {
    return value.consentToPublicDisplay === true && value.displayStatus === "active" &&
      ["male", "female"].includes(value.gender) && typeof value.id === "string" && /^MW-[A-F0-9]{8}$/.test(value.encounterCode) &&
      (value.slot === undefined || (Number.isInteger(value.slot) && value.slot >= 0 && value.slot < WALL_CAPACITY && wallSlotGender(value.slot) === value.gender)) &&
      wallNickname(value.nickname) === value.nickname &&
      (value.ageRange === null || (typeof value.ageRange === "string" && wallAgeRange(value.ageRange) === value.ageRange)) &&
      /^\/assets\/avatars\/(male|female)\/\1_(0[1-9]|10)\.png$/.test(value.avatarUrl) &&
      Array.isArray(value.tags) && value.tags.length <= 2 && value.tags.every((s) => typeof s === "string" && s.length <= 20) &&
      Array.isArray(value.preferences) && value.preferences.length <= 4 && value.preferences.every((p) =>
        typeof p.label === "string" && p.label.length <= 20 && typeof p.value === "string" && p.value.length <= 20);
  } catch { return false; }
}
export interface WallCandidate { id: string; seconds: number; last: number; joined: number }
export function fairOrder(a: WallCandidate, b: WallCandidate) {
  return a.seconds - b.seconds || a.last - b.last || a.joined - b.joined || a.id.localeCompare(b.id);
}
export function rotateWall(candidates: WallCandidate[], visible: string[], capacity: number, ratio: number, rotate: boolean): string[] {
  const roster = [...new Map(candidates.map((c) => [c.id, c])).values()].sort(fairOrder);
  const allowed = new Set(roster.map((c) => c.id));
  const current = [...new Set(visible)].filter((id) => allowed.has(id)).slice(0, capacity);
  const waiting = roster.filter((c) => !current.includes(c.id));
  // Fill missing slots first; a replacement never duplicates somebody still on screen.
  while (current.length < capacity && waiting.length) current.push(waiting.shift()!.id);
  if (!rotate || !waiting.length) return current;
  const count = Math.min(waiting.length, Math.max(1, Math.ceil(capacity * ratio / 100)));
  const outgoing = roster.filter((c) => current.includes(c.id)).sort((a, b) => fairOrder(b, a)).slice(0, count);
  for (const c of outgoing) current[current.indexOf(c.id)] = waiting.shift()!.id;
  return current;
}
export type GenderCandidate = WallCandidate & { gender: Participant["gender"] };
export function wallSlotGender(slot: number): Participant["gender"] { return slot % WALL_COLUMNS < 3 ? "male" : "female"; }
export function pruneWallSlots(candidates: GenderCandidate[], slots: WallSlots): WallSlots {
  const roster = new Map(candidates.map((c) => [c.id, c])), seen = new Set<string>();
  return Array.from({ length: WALL_CAPACITY }, (_, index) => {
    const id = slots[index], person = id ? roster.get(id) : undefined;
    if (!id || !person || person.gender !== wallSlotGender(index) || seen.has(id)) return null;
    seen.add(id); return id;
  });
}
export function rotateWallSlots(candidates: GenderCandidate[], visible: WallSlots, ratio: number, rotate: boolean): WallSlots {
  const slots = pruneWallSlots(candidates, visible);
  for (const gender of ["male", "female"] as const) {
    const indexes = Array.from({ length: WALL_CAPACITY }, (_, i) => i).filter((i) => wallSlotGender(i) === gender);
    const current = indexes.flatMap((i) => slots[i] || []);
    const next = rotateWall(candidates.filter((c) => c.gender === gender), current, WALL_GROUP_CAPACITY, ratio, rotate);
    const keep = new Set(next), newcomers = next.filter((id) => !current.includes(id));
    // Existing people keep their exact seat; holes and outgoing seats receive newcomers only at rotation.
    for (const i of indexes) if (!slots[i] || !keep.has(slots[i]!)) slots[i] = newcomers.shift() || null;
  }
  return slots;
}
export function wallCardSlots(cards: PublicMemberCard[]): (PublicMemberCard | undefined)[] {
  const slots = Array<PublicMemberCard | undefined>(WALL_CAPACITY).fill(undefined), seen = new Set<string>();
  for (const card of cards) {
    const slot = card.slot ?? slots.findIndex((c, i) => !c && wallSlotGender(i) === card.gender);
    if (slot < 0 || slot >= WALL_CAPACITY || wallSlotGender(slot) !== card.gender || slots[slot] || seen.has(card.id)) continue;
    slots[slot] = card; seen.add(card.id);
  }
  return slots;
}
export function wallColumns(width: number, height: number) {
  const fittedScale = Math.min(2, height / 820, width / 1824);
  return { columns: WALL_COLUMNS, scale: Math.max(.45, fittedScale), readable: Number.isFinite(fittedScale) && fittedScale >= .45 };
}
