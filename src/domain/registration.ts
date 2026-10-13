import type { ProfileProgress } from "./registration-profile";
import {
  emptyTongzhouProfile,
  TONGZHOU_FIELDS,
  type TongzhouProfile,
} from "./tongzhou";
import { nicknameError } from "./selectors";
export const REGISTRATION_CONSENT_VERSION = "registration-2026-10-12-v1";
export const REGISTRATION_AGENCY_CONSENT =
  "registration-tongzhou-2026-10-12-v1";
export const REGISTRATION_STATUS = {
  registered: "待签到",
  checked_in: "已签到",
  cancelled: "已取消",
} as const;
export interface RegistrationConfig {
  title: string;
  headline: string;
  date: string;
  location: string;
  description: string;
  open: boolean;
}
export const DEFAULT_REGISTRATION_CONFIG: RegistrationConfig = {
  title: "遇见 · 缘分实验室",
  headline: "认真遇见一个人",
  date: "",
  location: "",
  description: "从一个共同话题，开始认识。",
  open: false,
};
export interface RegistrationRecord {
  id: string;
  nickname: string;
  birthDate?: string | null;
  zodiac?: string | null;
  fields: TongzhouProfile;
  status: keyof typeof REGISTRATION_STATUS;
  receipt: string;
  version: number;
  agencyAllowed: boolean;
  createdAt: string;
  checkedInAt: string | null;
  effectiveStatus: keyof typeof REGISTRATION_STATUS;
  profileProgress: ProfileProgress;
  profileConfirmedAt: string | null;
  entered: boolean;
  photos: { id: string; url: string; thumbnail: string }[];
}
export interface RegistrationView {
  config: RegistrationConfig;
  record: RegistrationRecord | null;
}
export const BASIC_REGISTRATION_FIELDS = [
  "gender",
  "birthYear",
  "city",
  "phone",
] as const;
export const LIFE_REGISTRATION_FIELDS = [
  "maritalStatus",
  "children",
  "height",
  "education",
  "occupation",
  "income",
  "housing",
  "vehicle",
] as const;
export const EXPECTATION_FIELDS = [
  "expectations",
  "family",
  "contactTime",
] as const;
export function validateRegistration(
  input: unknown,
  nickname: unknown,
  year = new Date().getFullYear(),
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("请填写报名资料。");
  const raw = input as Record<string, unknown>,
    fields = emptyTongzhouProfile();
  if (Object.keys(raw).some((k) => !TONGZHOU_FIELDS.some((f) => f.key === k)))
    throw Error("包含不支持的资料字段。");
  if (typeof nickname !== "string" || nicknameError(nickname.trim()))
    throw Error(
      typeof nickname === "string"
        ? nicknameError(nickname.trim())
        : "请填写活动昵称。",
    );
  for (const f of TONGZHOU_FIELDS) {
    const v = raw[f.key];
    if (v !== undefined && typeof v !== "string")
      throw Error(`请填写有效的${f.label}`);
    const s = ((v as string) || "").trim();
    fields[f.key] = s;
    if (
      s.length > (f.maxLength || 40) ||
      (s && f.options && !f.options.includes(s))
    )
      throw Error(`请检查${f.label}`);
  }
  for (const key of BASIC_REGISTRATION_FIELDS)
    if (!fields[key])
      throw Error(`请填写${TONGZHOU_FIELDS.find((f) => f.key === key)!.label}`);
  if (!/^1[3-9]\d{9}$/.test(fields.phone)) throw Error("请填写11位手机号。");
  if (
    !/^\d{4}$/.test(fields.birthYear) ||
    +fields.birthYear < 1900 ||
    +fields.birthYear > year - 18
  )
    throw Error(`出生年份须为1900–${year - 18}年，仅限成年人。`);
  if (
    fields.height &&
    (!/^\d{2,3}$/.test(fields.height) ||
      +fields.height < 80 ||
      +fields.height > 250)
  )
    throw Error("身高须在80–250cm之间。");
  return { nickname: nickname.trim(), fields };
}
export function validateRegistrationConfig(value: unknown): RegistrationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("活动配置无效。");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join() !==
      Object.keys(DEFAULT_REGISTRATION_CONFIG).sort().join() ||
    typeof v.open !== "boolean"
  )
    throw Error("活动配置无效。");
  for (const k of [
    "title",
    "headline",
    "date",
    "location",
    "description",
  ] as const)
    if (
      typeof v[k] !== "string" ||
      v[k].length > (k === "description" ? 240 : 80)
    )
      throw Error("活动文案过长或无效。");
  if (!(v.title as string).trim() || !(v.headline as string).trim())
    throw Error("请填写活动名称和主标题。");
  return v as unknown as RegistrationConfig;
}
