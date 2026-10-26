// Calendar dates only: never convert a birthday through a timezone-dependent Date.
export type BirthParts = { year: string; month: string; day: string };
export function calendarToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function daysInMonth(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return 0;
  return month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;
}
export function splitBirthDate(year: string, date?: string | null): BirthParts {
  return {
    year,
    month: date?.slice(5, 7) || "",
    day: date?.slice(8, 10) || "",
  };
}
export function validBirthDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  return y >= 1900 && d >= 1 && d <= daysInMonth(y, m);
}
export function validateBirthDate(
  value: unknown,
  year: string,
  today = calendarToday(),
): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !validBirthDate(value))
    throw Error("请选择有效的出生日期。");
  if (value.slice(0, 4) !== year)
    throw Error("出生日期与出生年份不一致，请重新选择。");
  const cutoff = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
  if (value > cutoff) throw Error("本活动仅限已满18周岁的成年人报名。");
  return value;
}
export function joinBirthDate(parts: BirthParts): string | null {
  if (!parts.month && !parts.day) return null;
  if (!parts.year || !parts.month || !parts.day)
    throw Error("请补齐出生月日，或清空月日后继续。");
  return validateBirthDate(
    `${parts.year}-${parts.month}-${parts.day}`,
    parts.year,
  );
}
// Product convention: fixed Gregorian month/day boundaries, shared by client and server.
export function zodiacFor(date?: string | null): string | null {
  if (!date || !validBirthDate(date)) return null;
  const month = Number(date.slice(5, 7)),
    day = Number(date.slice(8, 10));
  const boundaries = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
  const signs = [
    "摩羯座",
    "水瓶座",
    "双鱼座",
    "白羊座",
    "金牛座",
    "双子座",
    "巨蟹座",
    "狮子座",
    "处女座",
    "天秤座",
    "天蝎座",
    "射手座",
    "摩羯座",
  ];
  return signs[month - 1 + (day >= boundaries[month - 1] ? 1 : 0)];
}
