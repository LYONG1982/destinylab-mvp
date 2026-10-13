"use client";
import { useEffect, useRef, useState } from "react";
import type { Participant } from "@/domain/types";
import { activity, isLive } from "@/lib/api/live-client";
import { defaultAvatarId, validAvatar } from "@/config/avatars";
import { useAction } from "@/lib/demo/hooks";
import { Avatar, Button, Modal, Notice } from "@/components/ui";
import { AvatarSelector } from "./AvatarSelector";
type Crop = { url: string; width: number; height: number };
export function AvatarEditor({
  me,
  onSaved,
}: {
  me: Participant;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!isLive() || document.documentElement.dataset.avatars === "false")
    return null;
  return (
    <>
      <Button type="button" kind="text" onClick={() => setOpen(true)}>
        {me.profileComplete ? "更换头像" : "上传我的照片"}
      </Button>
      {open && (
        <Editor
          key={me.id}
          me={me}
          onSaved={() => {
            onSaved?.();
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
  onSaved: () => void;
  onClose: () => void;
}) {
  const a = useAction(me.id, "avatar-editor"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [crop, setCrop] = useState<Crop | null>(null),
    [zoom, setZoom] = useState(1),
    [pos, setPos] = useState({ x: 0, y: 0 }),
    [asset, setAsset] = useState(me.photo?.id || null),
    [system, setSystem] = useState(
      validAvatar(me.avatarId, me.gender)
        ? me.avatarId
        : defaultAvatarId(me.id, me.gender),
    ),
    [allow, setAllow] = useState(me.photo?.screen || false),
    [version] = useState(me.avatarVersion || 0);
  const selection = useRef(0);
  const lock = useRef(false),
    drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
      null,
    ),
    input = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (crop) URL.revokeObjectURL(crop.url);
    },
    [crop],
  );
  async function choose(file?: File) {
    if (!file) return;
    const ticket = ++selection.current;
    setError("");
    if (file.size > 10 * 1024 * 1024) {
      setError("照片不能超过 10 MB。");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("请选择 JPG、PNG 或 WebP 照片；此照片格式暂不可用。");
      return;
    }
    const url = URL.createObjectURL(file),
      img = new window.Image();
    img.src = url;
    try {
      await img.decode();
      if (img.naturalWidth * img.naturalHeight > 24000000) throw new Error();
      if (!mounted.current || ticket !== selection.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setCrop({ url, width: img.naturalWidth, height: img.naturalHeight });
      setZoom(1);
      setPos({ x: 0, y: 0 });
      setAllow(false);
    } catch {
      URL.revokeObjectURL(url);
      setError("照片无法读取或超过 2400 万像素，请换一张。");
    }
  }
  const scale = crop ? Math.max(240 / crop.width, 240 / crop.height) * zoom : 1;
  const dx = crop ? (crop.width * scale - 240) / 2 : 0,
    dy = crop ? (crop.height * scale - 240) / 2 : 0;
  async function save() {
    if (lock.current || a.busy) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let id = asset;
      if (crop) {
        const img = new window.Image();
        img.src = crop.url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 512;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器暂不能处理照片。");
        ctx.scale(512 / 240, 512 / 240);
        ctx.drawImage(
          img,
          -dx + pos.x * dx,
          -dy + pos.y * dy,
          crop.width * scale,
          crop.height * scale,
        );
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("照片处理失败。"))),
            "image/webp",
            0.85,
          ),
        );
        const r = await fetch(
          `/api/avatar/upload?activity=${encodeURIComponent(activity())}`,
          {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
            signal: AbortSignal.timeout(20000),
          },
        );
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        id = result.id;
      }
      if (!mounted.current) return;
      await a.run(
        {
          type: "avatar",
          assetId: id,
          avatarId: system!,
          allowScreen: !!id && allow,
          expectedVersion: version,
        },
        () => onSaved(),
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
        <p className="fine">
          头像会显示给活动中可查看你资料的参与者。上传照片不代表身份认证。
        </p>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          kind="secondary"
          disabled={busy || a.busy}
          onClick={() => input.current?.click()}
        >
          从相册选择照片
        </Button>
        {crop ? (
          <>
            <div
              className="photo-crop"
              role="img"
              aria-label="拖动照片调整圆形头像"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  px: pos.x,
                  py: pos.y,
                };
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                setPos({
                  x: dx
                    ? Math.max(
                        -1,
                        Math.min(
                          1,
                          drag.current.px + (e.clientX - drag.current.x) / dx,
                        ),
                      )
                    : 0,
                  y: dy
                    ? Math.max(
                        -1,
                        Math.min(
                          1,
                          drag.current.py + (e.clientY - drag.current.y) / dy,
                        ),
                      )
                    : 0,
                });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              {/* Local object URL only; never sent to the Next image optimizer. */}
              <img
                alt="照片裁剪预览"
                src={crop.url}
                draggable={false}
                style={{
                  width: crop.width * scale,
                  height: crop.height * scale,
                  left: -dx + pos.x * dx,
                  top: -dy + pos.y * dy,
                }}
              />
              <span />
            </div>
            <label>
              缩放
              <input
                aria-label="照片缩放"
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <p className="fine">拖动调整位置，圆形内为最终显示区域。</p>
          </>
        ) : (
          <div className="photo-current">
            <Avatar
              person={{
                ...me,
                avatarId: system,
                photo: asset ? me.photo : null,
              }}
              size="xl"
            />
          </div>
        )}
        {(crop || asset) && (
          <label className="photo-consent">
            <input
              type="checkbox"
              checked={allow}
              disabled={busy || a.busy}
              onChange={(e) => setAllow(e.target.checked)}
            />
            允许本人照片在现场大屏展示
          </label>
        )}
        <details>
          <summary>选择系统头像</summary>
          <AvatarSelector
            gender={me.gender}
            value={system}
            disabled={busy || a.busy}
            onChange={(id) => {
              setSystem(id);
              setCrop(null);
              setAsset(null);
              setAllow(false);
            }}
          />
        </details>
        {me.photo && (
          <Button
            type="button"
            kind="text"
            disabled={busy || a.busy}
            onClick={() => {
              setCrop(null);
              setAsset(null);
              setAllow(false);
            }}
          >
            移除照片，换回系统头像
          </Button>
        )}
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
