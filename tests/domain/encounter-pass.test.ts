import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encounterDate,
  displayEncounterCode,
} from "../../src/features/registration/encounter-pass";
test("invitation formats exact dates and ranges without guessing missing years", () => {
  assert.deepEqual(encounterDate("2026-11-06"), {
    text: "2026年11月6日",
    accent: "NOV 06",
    edition: "2026",
  });
  assert.deepEqual(encounterDate("2026年11月6日 – 8日"), {
    text: "2026年11月6日 — 2026年11月8日",
    accent: "NOV 06 — 08",
    edition: "2026",
  });
  assert.equal(
    encounterDate("2026年11月30日至12月2日").accent,
    "NOV 30 — DEC 02",
  );
  assert.equal(encounterDate("2026-12-31 — 2027-01-02").edition, "2026 / 2027");
  assert.equal(encounterDate("2028年2月29日").accent, "FEB 29");
  assert.equal(encounterDate("2026-11-06 - 2026-11-08").accent, "NOV 06 — 08");
  for (const raw of [
    "2026年2月29日",
    "2026-04-31",
    "2026-13-01",
    "2026-00-12",
    "2026年12月31日至1月2日",
    "2026年11月8日至6日",
    "每周六 14:00—17:00",
    "2026-11-06 18:00",
    "11月6日至8日",
    "2026年11月6日另行通知",
  ]) {
    assert.deepEqual(encounterDate(raw), { text: raw }, raw);
  }
  assert.deepEqual(encounterDate("  "), { text: "活动时间待公布" });
});
test("invitation groups only six-digit display values and preserves all other codes", () => {
  assert.equal(displayEncounterCode("012345"), "012 345");
  assert.equal(displayEncounterCode("123456"), "123 456");
  for (const code of [
    "TZ-172BFE5B528E",
    "12345",
    "1234567",
    "a12345",
    "0000000000000011",
    "",
  ])
    assert.equal(displayEncounterCode(code), code);
});
