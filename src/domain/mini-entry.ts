export const MINI_ENTRY_PAGES = {
  registration: "pages/registration/index",
  encounter: "pages/encounter/index",
} as const;
export type MiniEntry = keyof typeof MINI_ENTRY_PAGES;
export function entryType(value: unknown): MiniEntry {
  if (value === undefined || value === null || value === "") return "encounter";
  if (value !== "registration" && value !== "encounter")
    throw Error("入口类型无效。");
  return value;
}
