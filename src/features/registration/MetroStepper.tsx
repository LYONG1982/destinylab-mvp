"use client";
import { PROFILE_STEPS, type ProfileStep } from "@/domain/registration-profile";
const labels = ["生活", "期待", "相册", "完成"];
export function MetroStepper({
  current,
  saved,
  busy,
  onSelect,
}: {
  current: ProfileStep;
  saved: ProfileStep[];
  busy: boolean;
  onSelect: (step: ProfileStep) => void;
}) {
  return (
    <nav className="reg-metro" aria-label="遇见档案填写进度">
      <ol>
        {PROFILE_STEPS.map((step, i) => (
          <li
            key={step}
            className={`${current === step ? "is-current" : ""} ${saved.includes(step) ? "is-saved" : ""}`}
          >
            <button
              type="button"
              disabled={busy}
              aria-current={current === step ? "step" : undefined}
              aria-label={`第${i + 1}站 ${labels[i]}${saved.includes(step) ? "，已保存" : ""}`}
              onClick={() => onSelect(step)}
            >
              <span
                className={`reg-station ${i === 3 ? "reg-station-end" : ""}`}
                aria-hidden="true"
              >
                <span>
                  {saved.includes(step) ? "✓" : String(i + 1).padStart(2, "0")}
                </span>
              </span>
              <span>{labels[i]}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
