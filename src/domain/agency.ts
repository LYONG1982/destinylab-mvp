import { TONGZHOU_FIELDS, type TongzhouProfile } from "./tongzhou";
export const SERVICE_LABELS = {
  none: "未服务",
  active: "服务中",
  done: "已完成",
} as const;
export const PUBLIC_FIELDS = [
  ...TONGZHOU_FIELDS.filter(
    (f) => f.key !== "realName" && f.key !== "phone",
  ).map((f) => ({ key: f.key as string, label: f.label })),
  { key: "photo", label: "本人照片" },
  { key: "intro", label: "个人介绍" },
];
export const allowedPublicFields = (fields: string[]) =>
  fields.filter((key) => PUBLIC_FIELDS.some((f) => f.key === key));
export const defaultPublicFields = () => PUBLIC_FIELDS.map((f) => f.key).sort();
export interface AgencyDraft {
  note: string;
  signed: boolean;
  service: keyof typeof SERVICE_LABELS;
  nickname: string;
  code: string;
  intro: string;
  fields: string[];
  photoIds?: string[];
}
export interface PublicProfile {
  title: string;
  code: string;
  intro?: string;
  photo: boolean;
  photos?: string[];
  items: { key: string; label: string; value: string }[];
}
export interface AgencyManagement extends AgencyDraft {
  version: number;
  published: boolean;
  url: string;
  publishedAt: string | null;
  updatedAt: string | null;
  needsUpdate: boolean;
  legacyPhoto?: boolean;
}
export function validateAgencyDraft(value: unknown): AgencyDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("跟进资料无效。");
  const v = value as Record<string, unknown>;
  const keys = [
    "note",
    "signed",
    "service",
    "nickname",
    "code",
    "intro",
    "fields",
    "photoIds",
  ];
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw Error("包含不支持的跟进字段。");
  for (const [k, max] of [
    ["note", 2000],
    ["nickname", 40],
    ["code", 32],
    ["intro", 600],
  ] as const)
    if (typeof v[k] !== "string" || v[k].length > max)
      throw Error("请检查文本长度。");
  if (
    typeof v.signed !== "boolean" ||
    !["none", "active", "done"].includes(String(v.service))
  )
    throw Error("跟进状态无效。");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(v.code as string))
    throw Error("编号为 3–32 位字母、数字、横线或下划线。");
  if (
    !Array.isArray(v.fields) ||
    v.fields.some(
      (k) =>
        typeof k !== "string" ||
        (!PUBLIC_FIELDS.some((f) => f.key === k) &&
          k !== "realName" &&
          k !== "phone"),
    )
  )
    throw Error("公开字段无效。");
  if (
    v.photoIds !== undefined &&
    (!Array.isArray(v.photoIds) ||
      v.photoIds.length > 10 ||
      new Set(v.photoIds).size !== v.photoIds.length ||
      v.photoIds.some(
        (id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id),
      ))
  )
    throw Error("公开照片选择无效。");
  return {
    ...v,
    photoIds: v.photoIds || [],
    nickname: (v.nickname as string).trim(),
    code: (v.code as string).toUpperCase(),
    fields: allowedPublicFields([...new Set(v.fields as string[])]).sort(),
  } as unknown as AgencyDraft;
}
export function publicProfile(
  fields: TongzhouProfile,
  draft: AgencyDraft,
  hasPhoto: boolean,
): PublicProfile {
  return {
    title: draft.nickname,
    code: draft.code,
    photo: draft.fields.includes("photo") && hasPhoto,
    ...(draft.fields.includes("intro") && draft.intro
      ? { intro: draft.intro }
      : {}),
    items: TONGZHOU_FIELDS.filter(
      (f) =>
        f.key !== "realName" &&
        f.key !== "phone" &&
        draft.fields.includes(f.key) &&
        fields[f.key],
    ).map((f) => ({ key: f.key, label: f.label, value: fields[f.key] })),
  };
}

// Apply the current public contract to historical snapshots as well as new ones.
export function safePublicProfile(profile: PublicProfile): PublicProfile {
  return {
    title: profile.title === profile.code ? "" : profile.title || "",
    code: profile.code,
    photo: profile.photo,
    ...(profile.photos ? { photos: profile.photos } : {}),
    ...(profile.intro ? { intro: profile.intro } : {}),
    items: profile.items
      .filter(
        (item) =>
          TONGZHOU_FIELDS.some((f) => f.key === item.key) &&
          item.key !== "realName" &&
          item.key !== "phone",
      )
      .map(({ key, label, value }) => ({ key, label, value })),
  };
}

export interface AgencyGallery {
  version: number;
  userPhotoId: string | null;
  photos: {
    id: string;
    width: number;
    height: number;
    createdAt: string;
    source: "user" | "agency";
    uploadedBy?: "participant" | "staff";
    url: string;
    thumbnail: string;
    published: boolean;
  }[];
}
