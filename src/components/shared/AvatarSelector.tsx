"use client";
import { useId, type Ref } from "react";
import { PRODUCT } from "@/config/product";
import type { Gender } from "@/domain/types";
import { getAvatarsByGender } from "@/config/avatars";
import { ParticipantAvatar } from "./ParticipantAvatar";
export function AvatarSelector({
  gender,
  value,
  onChange,
  disabled,
  message,
  required,
  ref,
}: {
  gender: Gender | null;
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  message?: string;
  required?: boolean;
  ref?: Ref<HTMLFieldSetElement>;
}) {
  const id = useId();
  return (
    <fieldset
      ref={ref}
      tabIndex={-1}
      className="avatar-selector"
      disabled={disabled}
      aria-invalid={!!message}
      aria-describedby={`${id}-help ${id}-message`}
    >
      <legend className="field-label">
        选择一个头像{required ? "（必选）" : ""}
      </legend>
      <p className="fine" id={`${id}-help`}>
        这是你在{PRODUCT.name}里的临时形象。
      </p>
      {gender ? (
        <div className="avatar-grid">
          {getAvatarsByGender(gender).map((avatar) => (
            <label className="avatar-option" key={avatar.id}>
              <input
                type="radio"
                name={`${id}-avatar`}
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
      {value && (
        <p className="fine">已选择本次活动头像，可点击其他头像更换。</p>
      )}
      <p id={`${id}-message`} className="field-error" aria-live="polite">
        {message}
      </p>
    </fieldset>
  );
}
