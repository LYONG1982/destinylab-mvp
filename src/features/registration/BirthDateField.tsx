"use client";
import { useState } from "react";
import {
  calendarToday,
  daysInMonth,
  zodiacFor,
  type BirthParts,
} from "@/domain/birth-date";
export function BirthDateField({
  value,
  onChange,
}: {
  value: BirthParts;
  onChange: (value: BirthParts) => void;
}) {
  const [notice, setNotice] = useState("");
  const maxYear = Number(calendarToday().slice(0, 4)) - 18;
  const days = daysInMonth(Number(value.year), Number(value.month));
  const zodiac = zodiacFor(`${value.year}-${value.month}-${value.day}`);
  function change(key: keyof BirthParts, next: string) {
    const updated = { ...value, [key]: next };
    setNotice("");
    if (key === "month" && !next) updated.day = "";
    if (key === "year" && !next) {
      updated.month = "";
      updated.day = "";
    }
    if (
      updated.day &&
      Number(updated.day) >
        daysInMonth(Number(updated.year), Number(updated.month))
    ) {
      updated.day = "";
      setNotice("该月没有原选日期，请重新选择日。");
    }
    onChange(updated);
  }
  const options = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      const v = String(i + 1).padStart(2, "0");
      return (
        <option key={v} value={v}>
          {i + 1}
        </option>
      );
    });
  return (
    <fieldset className="reg-birth-field reg-wide">
      <legend>出生日期</legend>
      <div className="reg-birth-selects">
        <label className="reg-field">
          <span>
            年 <i aria-label="必填">*</i>
          </span>
          <select
            aria-label="出生年份"
            required
            value={value.year}
            onChange={(e) => change("year", e.target.value)}
          >
            <option value="">请选择</option>
            {Array.from({ length: maxYear - 1899 }, (_, i) => (
              <option key={maxYear - i} value={String(maxYear - i)}>
                {maxYear - i}
              </option>
            ))}
          </select>
        </label>
        <label className="reg-field">
          <span>月</span>
          <select
            aria-label="出生月份"
            disabled={!value.year}
            value={value.month}
            onChange={(e) => change("month", e.target.value)}
          >
            <option value="">选填</option>
            {options(12)}
          </select>
        </label>
        <label className="reg-field">
          <span>日</span>
          <select
            aria-label="出生日期中的日"
            disabled={!value.year || !value.month}
            value={value.day}
            onChange={(e) => change("day", e.target.value)}
          >
            <option value="">选填</option>
            {options(days)}
          </select>
        </label>
      </div>
      {zodiac && (
        <span className="reg-zodiac" aria-label={`星座：${zodiac}`}>
          {zodiac}
        </span>
      )}
      {notice && (
        <p className="reg-date-notice" role="status">
          {notice}
        </p>
      )}
    </fieldset>
  );
}
