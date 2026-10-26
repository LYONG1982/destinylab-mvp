"use client";
import Image from "next/image";
import { useState } from "react";
import { getAvatarById } from "@/config/avatars";
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
const pixels: Record<AvatarSize, number> = {
  xs: 32,
  sm: 43,
  md: 64,
  lg: 80,
  xl: 106,
};
export function ParticipantAvatar({
  avatarId,
  size = "md",
  alt,
  className = "",
}: {
  avatarId: string | null;
  size?: AvatarSize;
  alt?: string;
  className?: string;
}) {
  const avatar = getAvatarById(avatarId);
  const [failed, setFailed] = useState("");
  const classes = `avatar avatar-${size} ${className}`;
  if (!avatar || failed === avatar.src)
    return (
      <span
        className={`${classes} avatar-placeholder`}
        role="img"
        aria-label={alt ? `${alt}，头像暂不可用` : "尚未选择本次活动头像"}
      >
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="24" r="10" />
          <path d="M14 55c0-22 36-22 36 0" />
        </svg>
      </span>
    );
  return (
    <Image
      className={classes}
      src={avatar.src}
      alt={alt || `${avatar.alt}，不代表本人长相`}
      width={pixels[size]}
      height={pixels[size]}
      data-avatar-id={avatar.id}
      onError={() => setFailed(avatar.src)}
    />
  );
}
