"use client";
import type { Gender } from "@/domain/types";
import { getAvatarsByGender } from "@/config/avatars";
import { ParticipantAvatar } from "./ParticipantAvatar";
export function AvatarSelector({
  gender,
  value,
  onChange,
  disabled,
  message,
}: {
  gender: Gender | null;
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  message?: string;
}) {
  return (
    <fieldset
      className="avatar-selector"
      disabled={disabled}
      aria-describedby="avatar-help avatar-message"
    >
      <legend className="field-label">选择一个头像</legend>
      <p className="fine" id="avatar-help">
        这是你在缘分实验室里的临时形象。
      </p>
      {gender ? (
        <div className="avatar-grid">
          {getAvatarsByGender(gender).map((avatar) => (
            <label className="avatar-option" key={avatar.id}>
              <input
                type="radio"
                name="avatar"
                value={avatar.id}
                checked={value === avatar.id}
                onChange={() => onChange(avatar.id)}
                aria-label={avatar.alt}
              />
              <span className="avatar-option-image">
                <ParticipantAvatar avatarId={avatar.id} />
                <span className="avatar-check" aria-hidden="true">
                  ✓
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="fine">先选择性别，再选一个本次活动头像。</p>
      )}
      <p className="fine">系统虚拟头像，不代表本人长相。</p>
      <p id="avatar-message" className="field-error" aria-live="polite">
        {message}
      </p>
    </fieldset>
  );
}
