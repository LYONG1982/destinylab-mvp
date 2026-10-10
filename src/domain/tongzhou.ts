import type { Command, CommandEnvelope, DemoState } from "./types";

export const TONGZHOU_CONSENT_VERSION = "tongzhou-2026-10-06-v1";
export const TONGZHOU_CONSENT_TEXT =
  "我同意将本次填报资料提供给同舟婚恋，用于线下联系、了解婚恋需求及后续人工服务。我可以在此修改资料、撤回授权或删除资料。";

export interface TongzhouProfile {
  realName: string;
  phone: string;
  gender: string;
  birthYear: string;
  city: string;
  ethnicity: string;
  maritalStatus: string;
  children: string;
  height: string;
  education: string;
  occupation: string;
  income: string;
  housing: string;
  vehicle: string;
  family: string;
  expectations: string;
  contactTime: string;
}
export type TongzhouField = keyof TongzhouProfile;
interface FieldDefinition {
  key: TongzhouField;
  label: string;
  required?: boolean;
  options?: readonly string[];
  maxLength?: number;
  multiline?: boolean;
  hint?: string;
}
export const TONGZHOU_FIELDS: readonly FieldDefinition[] = [
  { key: "realName", label: "真实姓名", required: true, maxLength: 40 },
  {
    key: "phone",
    label: "手机号",
    required: true,
    maxLength: 11,
    hint: "仅用于同舟联系，手机号未核验",
  },
  { key: "gender", label: "性别", required: true, options: ["男", "女"] },
  {
    key: "birthYear",
    label: "出生年份",
    required: true,
    maxLength: 4,
    hint: "填写完整年份，如 1995；年龄按年份估算",
  },
  {
    key: "city",
    label: "所在城市",
    required: true,
    maxLength: 40,
    hint: "填写城市即可，无需详细住址",
  },
  {
    key: "ethnicity",
    label: "民族",
    required: true,
    maxLength: 30,
    hint: "选择或输入你的民族",
  },
  {
    key: "maritalStatus",
    label: "婚姻状况",
    required: true,
    options: ["未婚", "离异", "丧偶"],
  },
  {
    key: "children",
    label: "生育情况",
    options: ["未育", "有子女", "不便透露"],
  },
  { key: "height", label: "身高（cm）", maxLength: 3 },
  {
    key: "education",
    label: "学历",
    options: [
      "高中/中专及以下",
      "大专",
      "本科",
      "硕士",
      "博士",
      "其他",
      "不便透露",
    ],
  },
  {
    key: "occupation",
    label: "职业/行业",
    maxLength: 60,
    hint: "无需填写具体单位",
  },
  {
    key: "income",
    label: "月收入范围",
    options: [
      "3000 元以下",
      "3000–5999 元",
      "6000–9999 元",
      "10000–19999 元",
      "20000 元及以上",
      "不便透露",
    ],
  },
  {
    key: "housing",
    label: "住房情况",
    options: ["自有住房", "与家人同住", "租住", "其他", "不便透露"],
  },
  { key: "vehicle", label: "车辆情况", options: ["有车", "暂无", "不便透露"] },
  {
    key: "family",
    label: "家庭简述",
    maxLength: 200,
    multiline: true,
    hint: "自愿简述，不填写家人姓名、健康或联系方式",
  },
  {
    key: "expectations",
    label: "择偶期待",
    maxLength: 300,
    multiline: true,
    hint: "可写期望年龄、城市，以及你看重的相处方式",
  },
  {
    key: "contactTime",
    label: "方便联系时段",
    maxLength: 60,
    hint: "例如：工作日 18:00 后",
  },
];
export const emptyTongzhouProfile = (): TongzhouProfile =>
  Object.fromEntries(
    TONGZHOU_FIELDS.map(({ key }) => [key, ""]),
  ) as unknown as TongzhouProfile;

export function validateTongzhouProfile(
  input: unknown,
  year = new Date().getFullYear(),
) {
  const fields = emptyTongzhouProfile();
  const errors: Partial<Record<TongzhouField, string>> = {};
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  for (const field of TONGZHOU_FIELDS) {
    const value = raw[field.key];
    fields[field.key] = typeof value === "string" ? value.trim() : "";
    const text = fields[field.key];
    if (value !== undefined && typeof value !== "string")
      errors[field.key] = `请填写有效的${field.label}`;
    else if (field.required && !text)
      errors[field.key] = `请填写${field.label}`;
    else if (text && field.options && !field.options.includes(text))
      errors[field.key] = `请选择有效的${field.label}`;
    else if (text.length > (field.maxLength || 40))
      errors[field.key] = `${field.label}最多 ${field.maxLength || 40} 字`;
  }
  if (fields.phone && !/^1[3-9]\d{9}$/.test(fields.phone))
    errors.phone = "请填写 11 位手机号";
  if (
    fields.birthYear &&
    (!/^\d{4}$/.test(fields.birthYear) ||
      +fields.birthYear < 1900 ||
      +fields.birthYear > year - 18)
  )
    errors.birthYear = `请填写 1900–${year - 18} 年之间的出生年份（仅限成年人）`;
  if (
    fields.height &&
    (!/^\d{2,3}$/.test(fields.height) ||
      +fields.height < 80 ||
      +fields.height > 250)
  )
    errors.height = "请填写 80–250 cm 之间的身高";
  return { fields, errors };
}

export interface TongzhouSubmission {
  participantId: string;
  organizationId: "tongzhou";
  version: number;
  status: "active" | "withdrawn" | "deleted";
  fields: TongzhouProfile | null;
  submittedAt: number;
  updatedAt: number;
  consent: { version: string; at: number } | null;
}
export type TongzhouCommand =
  | {
      type: "tongzhou-submit";
      fields: TongzhouProfile;
      consent: boolean;
      consentVersion: string;
      expectedVersion: number;
    }
  | { type: "tongzhou-withdraw" | "tongzhou-delete"; expectedVersion: number };
export const isTongzhouCommand = (c: Command): c is TongzhouCommand =>
  c.type === "tongzhou-submit" ||
  c.type === "tongzhou-withdraw" ||
  c.type === "tongzhou-delete";

// Private submissions never become participant properties or public domain events.
export function applyTongzhouCommand(
  source: DemoState,
  envelope: CommandEnvelope,
  at: number,
): DemoState {
  const c = envelope.command;
  if (!isTongzhouCommand(c)) throw new Error("无法识别的填报操作。");
  if (!source.participants.some((p) => p.id === envelope.actor))
    throw new Error("只有本人可以管理填报资料。");
  const previous = ownTongzhouSubmission(source, envelope.actor);
  if (c.expectedVersion !== (previous?.version || 0))
    throw new Error("填报已在其他页面更新，请查看最新资料后再操作。");
  let next: TongzhouSubmission;
  if (c.type === "tongzhou-submit") {
    if (c.consent !== true || c.consentVersion !== TONGZHOU_CONSENT_VERSION)
      throw new Error("请阅读并确认本次资料授权。");
    const { fields, errors } = validateTongzhouProfile(c.fields);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    next = {
      participantId: envelope.actor,
      organizationId: "tongzhou",
      version: (previous?.version || 0) + 1,
      status: "active",
      fields,
      submittedAt: previous?.status === "active" ? previous.submittedAt : at,
      updatedAt: at,
      consent: { version: TONGZHOU_CONSENT_VERSION, at },
    };
  } else {
    if (!previous || previous.status === "deleted")
      throw new Error("当前没有可操作的填报资料。");
    if (c.type === "tongzhou-withdraw" && previous.status !== "active")
      throw new Error("本次授权已经撤回。");
    next = {
      ...previous,
      version: previous.version + 1,
      updatedAt: at,
      status: c.type === "tongzhou-delete" ? "deleted" : "withdrawn",
      fields: c.type === "tongzhou-delete" ? null : previous.fields,
      consent: null,
    };
  }
  // Do not run invitation expiry or point assignment as a side effect of filling a form.
  return {
    ...source,
    revision: source.revision + 1,
    commands: [...source.commands, `${envelope.actor}:${envelope.id}`],
    tongzhouSubmissions: [
      ...(source.tongzhouSubmissions || []).filter(
        (s) => s.participantId !== envelope.actor,
      ),
      next,
    ],
  };
}
export const ownTongzhouSubmission = (s: DemoState, actor: string) =>
  (s.tongzhouSubmissions || []).find(
    (record) => record.participantId === actor,
  );
export function authorizedTongzhouSubmissions(s: DemoState, actor: string) {
  if (actor !== "tongzhou") return [];
  return (s.tongzhouSubmissions || [])
    .filter(
      (r) =>
        r.status === "active" &&
        r.organizationId === "tongzhou" &&
        r.fields &&
        r.consent?.version === TONGZHOU_CONSENT_VERSION,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export const maskedPhone = (phone: string) =>
  phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
export const approximateAge = (birthYear: string) =>
  `约 ${new Date().getFullYear() - Number(birthYear)} 岁`;

// Absent collection is an older compatible snapshot. Malformed data is never silently reset.
export function readTongzhouSubmissions(value: unknown): TongzhouSubmission[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("填报数据无法读取");
  const ids = new Set<string>();
  for (const r of value) {
    if (
      !r ||
      typeof r.participantId !== "string" ||
      ids.has(r.participantId) ||
      r.organizationId !== "tongzhou" ||
      !Number.isInteger(r.version) ||
      r.version < 1 ||
      !Number.isFinite(r.submittedAt) ||
      !Number.isFinite(r.updatedAt) ||
      !["active", "withdrawn", "deleted"].includes(r.status) ||
      (r.status === "deleted"
        ? r.fields !== null
        : Object.keys(validateTongzhouProfile(r.fields).errors).length > 0) ||
      (r.status === "active"
        ? r.consent?.version !== TONGZHOU_CONSENT_VERSION ||
          !Number.isFinite(r.consent?.at)
        : r.consent !== null)
    )
      throw new Error("填报数据无法读取");
    ids.add(r.participantId);
  }
  return value;
}
