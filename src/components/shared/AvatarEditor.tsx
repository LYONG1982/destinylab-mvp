"use client";
import { useEffect, useRef, useState } from "react";
import type { Participant } from "@/domain/types";
import { isLive } from "@/lib/api/live-client";
import { defaultAvatarId, validAvatar } from "@/config/avatars";
import { useAction } from "@/lib/demo/hooks";
import { getSnapshot } from "@/lib/demo/store";
import { Button, Modal, Notice } from "@/components/ui";
import { AvatarSelector } from "./AvatarSelector";
type AvatarSaveResult = Pick<Participant, "gender" | "avatarId" | "photo">;
export function AvatarEditor({
  me,
  onSaved,
  disabled,
}: {
  me: Participant;
  onSaved?: (result: AvatarSaveResult) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!isLive() || document.documentElement.dataset.avatars === "false")
    return null;
  return (
    <>
      <Button
        type="button"
        kind="text"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {me.profileComplete ? "更换头像" : "选择系统头像"}
      </Button>
      {open && (
        <Editor
          key={me.id}
          me={me}
          onSaved={(result) => {
            onSaved?.(result);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function Editor({
  me,
  onSaved,
  onClose,
}: {
  me: Participant;
  onSaved: (result: AvatarSaveResult) => void;
  onClose: () => void;
}) {
  const a = useAction(me.id, "avatar-editor"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [system, setSystem] = useState(
      validAvatar(me.avatarId, me.gender)
        ? me.avatarId
        : defaultAvatarId(me.id, me.gender),
    ),
    [version] = useState(me.avatarVersion || 0);
  const lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save() {
    if (lock.current || a.busy) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!mounted.current) return;
      await a.run(
        {
          type: "avatar",
          assetId: null,
          avatarId: system!,
          allowScreen: false,
          expectedVersion: version,
        },
        () => {
          const saved = getSnapshot()?.participants.find((p) => p.id === me.id);
          if (saved)
            onSaved({
              gender: saved.gender,
              avatarId: saved.avatarId,
              photo: saved.photo,
            });
        },
      );
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "头像保存未完成。");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal
      title="选择你的头像"
      onClose={() => {
        if (!busy && !a.busy) onClose();
      }}
    >
      <div className="photo-editor">
        <p className="fine">本活动统一使用系统头像，不支持上传自定义照片。</p>
        <div>
          <AvatarSelector
            gender={me.gender}
            value={system}
            disabled={busy || a.busy}
            onChange={(id) => {
              setSystem(id);
            }}
          />
        </div>
        {(error || a.error) && <Notice tone="error">{error || a.error}</Notice>}
        <Button
          type="button"
          disabled={busy || a.busy}
          onClick={() => void save()}
        >
          {busy || a.busy ? "正在保存头像…" : "确认使用"}
        </Button>
        <Button
          type="button"
          kind="text"
          disabled={busy || a.busy}
          onClick={onClose}
        >
          取消
        </Button>
      </div>
    </Modal>
  );
}
