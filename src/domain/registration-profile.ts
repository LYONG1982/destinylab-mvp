import { EXPECTATION_FIELDS, LIFE_REGISTRATION_FIELDS } from "./registration";
import type { TongzhouField, TongzhouProfile } from "./tongzhou";
export const PROFILE_STEPS = [
  "life",
  "expectation",
  "album",
  "preview",
] as const;
export type ProfileStep = (typeof PROFILE_STEPS)[number];
export type ProfileProgress = {
  current: ProfileStep;
  visited: ProfileStep[];
  saved: ProfileStep[];
};
export const PROFILE_FIELDS: Record<ProfileStep, readonly TongzhouField[]> = {
  life: [...LIFE_REGISTRATION_FIELDS, "realName", "ethnicity"],
  expectation: EXPECTATION_FIELDS,
  album: [],
  preview: [
    ...LIFE_REGISTRATION_FIELDS,
    "realName",
    "ethnicity",
    ...EXPECTATION_FIELDS,
  ],
};
export const isProfileStep = (s: unknown): s is ProfileStep =>
  PROFILE_STEPS.includes(s as ProfileStep);
export function profileProgress(value: unknown): ProfileProgress {
  const v = (value || {}) as Partial<ProfileProgress>;
  return {
    current: isProfileStep(v.current) ? v.current : "life",
    visited: Array.isArray(v.visited) ? v.visited.filter(isProfileStep) : [],
    saved: Array.isArray(v.saved) ? v.saved.filter(isProfileStep) : [],
  };
}
export function profilePatch(
  base: TongzhouProfile,
  draft: TongzhouProfile,
  step: ProfileStep,
) {
  return Object.fromEntries(
    PROFILE_FIELDS[step]
      .filter((k) => draft[k] !== base[k])
      .map((k) => [k, draft[k]]),
  ) as Partial<TongzhouProfile>;
}
// Three-way merge: keep local edits, adopt untouched remote values, surface overlapping edits.
export function mergeProfileDraft(
  base: TongzhouProfile,
  draft: TongzhouProfile,
  remote: TongzhouProfile,
) {
  const merged = { ...remote };
  const conflicts: TongzhouField[] = [];
  for (const key of Object.keys(base) as TongzhouField[]) {
    if (draft[key] !== base[key]) {
      merged[key] = draft[key];
      if (remote[key] !== base[key] && remote[key] !== draft[key])
        conflicts.push(key);
    }
  }
  return { fields: merged, conflicts };
}
