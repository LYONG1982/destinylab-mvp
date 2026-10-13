import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarToday,
  daysInMonth,
  joinBirthDate,
  validateBirthDate,
  zodiacFor,
} from "../../src/domain/birth-date";
test("birthday Gregorian validity, adulthood and year-only compatibility", () => {
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(validateBirthDate(null, "1996"), null);
  assert.equal(joinBirthDate({ year: "1996", month: "", day: "" }), null);
  assert.throws(
    () => joinBirthDate({ year: "1996", month: "02", day: "" }),
    /补齐/,
  );
  for (const d of [
    "1999-02-29",
    "1996-04-31",
    "1996-13-01",
    "1996-00-01",
    "1996-01-00",
    "1996-2-01",
    "1996-01-01T00:00:00Z",
  ])
    assert.throws(() => validateBirthDate(d, "1996"));
  assert.equal(
    validateBirthDate("2008-10-13", "2008", "2026-10-13"),
    "2008-10-13",
  );
  assert.throws(
    () => validateBirthDate("2008-10-14", "2008", "2026-10-13"),
    /18/,
  );
  assert.throws(() => validateBirthDate("1996-02-29", "1995"), /不一致/);
  assert.equal(validateBirthDate("1996-02-29", "1996"), "1996-02-29");
  assert.equal(calendarToday(new Date("2026-10-12T16:01:00Z")), "2026-10-13");
});
test("all fixed zodiac boundaries and incomplete dates", () => {
  const changes = [
    ["01-20", "摩羯座", "水瓶座"],
    ["02-19", "水瓶座", "双鱼座"],
    ["03-21", "双鱼座", "白羊座"],
    ["04-20", "白羊座", "金牛座"],
    ["05-21", "金牛座", "双子座"],
    ["06-22", "双子座", "巨蟹座"],
    ["07-23", "巨蟹座", "狮子座"],
    ["08-23", "狮子座", "处女座"],
    ["09-23", "处女座", "天秤座"],
    ["10-24", "天秤座", "天蝎座"],
    ["11-23", "天蝎座", "射手座"],
    ["12-22", "射手座", "摩羯座"],
  ];
  for (const [date, before, after] of changes) {
    const [m, d] = date.split("-");
    assert.equal(
      zodiacFor(`1996-${m}-${String(Number(d) - 1).padStart(2, "0")}`),
      before,
    );
    assert.equal(zodiacFor(`1996-${date}`), after);
  }
  assert.equal(zodiacFor("1996-12-31"), "摩羯座");
  assert.equal(zodiacFor("1996-01-01"), "摩羯座");
  assert.equal(zodiacFor("1996-02-29"), "双鱼座");
  assert.equal(zodiacFor("1997-02-29"), null);
  assert.equal(zodiacFor(null), null);
});
