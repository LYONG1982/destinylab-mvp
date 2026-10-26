/** Presentation only: never use the grouped value as an API identifier. */
export function displayEncounterCode(raw: string) {
  return /^\d{6}$/.test(raw) ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}
type Day = { year: number; month: number; day: number };
const months = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const fullDate = /^(\d{4})(?:年(\d{1,2})月(\d{1,2})日|-(\d{2})-(\d{2}))/;
function valid(d: Day) {
  const date = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return (
    d.year >= 1000 &&
    date.getUTCFullYear() === d.year &&
    date.getUTCMonth() + 1 === d.month &&
    date.getUTCDate() === d.day
  );
}
function readFull(s: string) {
  const m = fullDate.exec(s);
  return m
    ? {
        value: { year: +m[1], month: +(m[2] || m[4]), day: +(m[3] || m[5]) },
        length: m[0].length,
      }
    : null;
}
const chinese = (d: Day) => `${d.year}年${d.month}月${d.day}日`;
const short = (d: Day) =>
  `${months[d.month - 1]} ${String(d.day).padStart(2, "0")}`;
const stamp = (d: Day) => Date.UTC(d.year, d.month - 1, d.day);
/** Only recognize complete, unambiguous calendar dates; all other text stays intact. */
export function encounterDate(raw: string): {
  text: string;
  accent?: string;
  edition?: string;
} {
  const value = raw.trim(),
    fallback = { text: value || "活动时间待公布" };
  const first = readFull(value);
  if (!first || !valid(first.value)) return fallback;
  const rest = value.slice(first.length).trim();
  const start = first.value;
  if (!rest)
    return {
      text: chinese(start),
      accent: short(start),
      edition: String(start.year),
    };
  const range = /^(?:至|到|[-—–~～])\s*(.+)$/.exec(rest);
  if (!range) return fallback;
  const endText = range[1],
    fullEnd = readFull(endText);
  let end: Day;
  if (fullEnd && fullEnd.length === endText.length) end = fullEnd.value;
  else {
    const partial = /^(?:(\d{1,2})月)?(\d{1,2})日$/.exec(endText);
    if (!partial) return fallback;
    end = {
      year: start.year,
      month: partial[1] ? +partial[1] : start.month,
      day: +partial[2],
    };
  }
  if (!valid(end) || stamp(end) < stamp(start)) return fallback;
  const sameYear = start.year === end.year;
  const accent = sameYear
    ? `${short(start)} — ${start.month === end.month ? String(end.day).padStart(2, "0") : short(end)}`
    : `${short(start)}, ${start.year} — ${short(end)}, ${end.year}`;
  return {
    text: `${chinese(start)} — ${chinese(end)}`,
    accent,
    edition: sameYear ? String(start.year) : `${start.year} / ${end.year}`,
  };
}
