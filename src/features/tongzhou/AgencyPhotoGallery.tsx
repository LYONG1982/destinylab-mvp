"use client";
import { useRef, useState } from "react";
import type { AgencyGallery } from "@/domain/agency";
import styles from "./agency.module.css";
export type GalleryTask =
  | { kind: "upload"; file: File }
  | { kind: "reorder"; ids: string[] }
  | { kind: "delete"; id: string; confirmed: boolean };
export function AgencyPhotoGallery({
  gallery,
  selected,
  disabled,
  onSelect,
  onTask,
}: {
  gallery: AgencyGallery;
  selected: string[];
  disabled: boolean;
  onSelect: (ids: string[]) => void;
  onTask: (task: GalleryTask) => Promise<void>;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const agencyPhotos = gallery.photos.filter((p) => p.source === "agency");
  const photo = gallery.photos.find((p) => p.id === opened);
  return (
    <section className={styles.section}>
      <div className={styles.galleryHeading}>
        <div>
          <h3>
            用户照片{" "}
            <span className={styles.pill}>
              机构 {agencyPhotos.length}/9 · 用户 {gallery.userPhotoId ? 1 : 0}
              /1
            </span>
          </h3>
          <p className={styles.hint}>
            用户已保存的照片与机构生活照在此统一展示，选择发布后才对外可见。
          </p>
        </div>
        <button
          className={styles.secondary}
          disabled={disabled || agencyPhotos.length >= 9}
          onClick={() => fileInput.current?.click()}
        >
          上传照片
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp"
          aria-label="上传用户照片"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onTask({ kind: "upload", file });
          }}
        />
      </div>
      <p className={styles.hint}>
        机构可上传 JPG、PNG、WebP，每张不超过 10MB，最多 9
        张。用户上传区显示当前已保存的照片；历史照片为已有裁剪版。
      </p>
      {photo && (
        <div className={styles.photoViewer}>
          <button className={styles.textButton} onClick={() => setOpened(null)}>
            关闭大图
          </button>
          <img src={photo.url} alt="用户生活照片大图" />
        </div>
      )}
      {!gallery.photos.length ? (
        <div className={styles.empty}>暂无生活照片，点击“上传照片”添加。</div>
      ) : (
        <div className={styles.photoGrid}>
          {gallery.photos.map((p, i) => {
            const agencyIndex = agencyPhotos.findIndex(
              (item) => item.id === p.id,
            );
            return (
              <article key={p.id} className={styles.photoTile}>
                <button
                  className={styles.photoImage}
                  aria-label={`查看照片 ${i + 1}`}
                  onClick={() => setOpened(p.id)}
                >
                  <img src={p.thumbnail} alt={`生活照片 ${i + 1}`} />
                </button>
                <p className={styles.photoSource}>
                  {p.source === "user" || p.uploadedBy === "participant" ? "用户上传" : "机构上传"}
                </p>
                <label className={styles.photoChoice}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      onSelect(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      )
                    }
                  />
                  宣传候选{" "}
                  {p.published && <span className={styles.pill}>已公开</span>}
                </label>
                {p.source === "user" ? (
                  <p className={styles.hint}>由用户更新，可选择用于宣传</p>
                ) : (
                  <div className={styles.photoActions}>
                    <button
                      className={styles.textButton}
                      disabled={disabled || agencyIndex === 0}
                      aria-label={`照片 ${i + 1} 前移`}
                      onClick={() => {
                        const ids = agencyPhotos.map((p) => p.id);
                        [ids[agencyIndex - 1], ids[agencyIndex]] = [
                          ids[agencyIndex],
                          ids[agencyIndex - 1],
                        ];
                        void onTask({ kind: "reorder", ids });
                      }}
                    >
                      前移
                    </button>
                    <button
                      className={styles.textButton}
                      disabled={
                        disabled || agencyIndex === agencyPhotos.length - 1
                      }
                      aria-label={`照片 ${i + 1} 后移`}
                      onClick={() => {
                        const ids = agencyPhotos.map((p) => p.id);
                        [ids[agencyIndex + 1], ids[agencyIndex]] = [
                          ids[agencyIndex],
                          ids[agencyIndex + 1],
                        ];
                        void onTask({ kind: "reorder", ids });
                      }}
                    >
                      后移
                    </button>
                    <button
                      className={styles.textButton}
                      disabled={disabled}
                      aria-label={`移除照片 ${i + 1}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            p.published
                              ? "该照片已公开。移除后，宣传页也会立即移除该照片，确定继续？"
                              : "确定移除这张照片？",
                          )
                        )
                          void onTask({
                            kind: "delete",
                            id: p.id,
                            confirmed: true,
                          });
                      }}
                    >
                      移除
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
