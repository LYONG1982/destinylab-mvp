export const isRegistrationReceipt = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{5}$/.test(value);
export const isLegacyRegistrationReceipt = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9A-F]{16}$/.test(value);
export const normalizeRegistrationReceipt = (value: string) =>
  value.replace(/\s/g, "").toUpperCase();
