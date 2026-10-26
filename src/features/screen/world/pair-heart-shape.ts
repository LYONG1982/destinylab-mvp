export const SEGMENTS = 64,
  RINGS = 12;
const rawOutline = (t: number) => ({
  x: (16 * Math.sin(t) ** 3) / 18,
  y:
    (13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t)) /
    18,
});
export const raw = Array.from({ length: SEGMENTS }, (_, i) =>
  rawOutline((i * Math.PI * 2) / SEGMENTS),
);
export const width =
  Math.max(...raw.map((p) => p.x)) - Math.min(...raw.map((p) => p.x));
export const centerY =
  (Math.max(...raw.map((p) => p.y)) + Math.min(...raw.map((p) => p.y))) / 2;
/** Same centered silhouette for the volume, spark origins and SVG fallback. Y points up. */
export const HEART_OUTLINE = raw.map((p) => ({
  x: p.x / width,
  y: (p.y - centerY) / width,
}));
export const HEART_SVG_PATH =
  HEART_OUTLINE.map(
    (p, i) => `${i ? "L" : "M"}${p.x.toFixed(6)},${(-p.y).toFixed(6)}`,
  ).join(" ") + " Z";
