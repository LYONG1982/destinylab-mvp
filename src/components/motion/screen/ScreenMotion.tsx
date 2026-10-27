"use client";
import { useEffect, useRef } from "react";
import { getImageProps } from "next/image";
import { isPublicSystemAvatarSource } from "@/domain/photo";
import { screenMotion } from "@/lib/motion-tokens";
import { reduceQuery } from "../lifecycle";
import { MotionController } from "./controller";
import type { ScreenSnapshot } from "./model";
import { reconcile, step, type Body, type Rect } from "./physics";

type Particle = {
  x: number;
  y: number;
  speed: number;
  age: number;
  life: number;
  phase: number;
  kind: number;
};
type Metrics = {
  width: number;
  height: number;
  scale: number;
  qr: Rect;
  area: Rect;
  bars: Rect[];
  obstacles: Rect[];
};
const empty: Rect = { x: 0, y: 0, width: 0, height: 0 };
const circle = (
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) => {
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
};
function safeClip(c: CanvasRenderingContext2D, m: Metrics, obstacles = false) {
  c.beginPath();
  c.rect(0, 0, m.width, m.height);
  for (const r of [m.qr, ...(obstacles ? m.obstacles : [])])
    c.rect(r.x, r.y, r.width, r.height);
  c.clip("evenodd");
}
function UserNode(
  c: CanvasRenderingContext2D,
  body: Body,
  time: number,
  scale: number,
  reduced: boolean,
  controller: MotionController,
  images: Map<string, HTMLImageElement>,
) {
  const effect = controller.effects.find(
    (e) => e.node === body.node.key && e.type !== "MATCH",
  );
  const t = effect ? Math.min(1, (time - effect.started) / effect.duration) : 1;
  const birth = effect?.type === "JOIN";
  body.state = body.leaving
    ? "leaving"
    : birth
      ? "entering"
      : effect
        ? "active"
        : "idle";
  body.activity = effect ? 1 - t : 0;
  body.visibility = body.leaving
    ? Math.max(0, 1 - (time - body.leaving) / 600)
    : birth
      ? Math.min(1, t * 3)
      : 1;
  const breath = reduced ? 1 : 0.94 + Math.sin(time / 1900 + body.phase) * 0.06;
  const radius = birth
    ? body.radius * (0.2 + 0.8 * Math.min(1, t * 2))
    : body.radius;
  c.save();
  c.globalAlpha = body.visibility * (effect ? 0.88 : 0.48) * breath;
  c.fillStyle = "#f9f2e7";
  circle(c, body.x, body.y, radius);
  c.fill();
  const source = body.node.image;
  const img = source ? images.get(source) : undefined;
  if (img?.complete && img.naturalWidth > 0) {
    c.save();
    circle(c, body.x, body.y, radius - 2 * scale);
    c.clip();
    c.drawImage(img, body.x - radius, body.y - radius, radius * 2, radius * 2);
    c.restore();
  } else {
    c.fillStyle = effect ? "#965765" : "#b49469";
    circle(c, body.x, body.y, radius * 0.16);
    c.fill();
    c.strokeStyle = "#b89a7066";
    circle(c, body.x, body.y, radius * 0.48);
    c.stroke();
  }
  c.strokeStyle = effect ? "#965765" : "#b4946999";
  c.lineWidth = scale;
  circle(c, body.x, body.y, radius);
  c.stroke();
  if (effect && !reduced) {
    c.globalAlpha = (1 - t) * 0.3;
    circle(c, body.x, body.y, radius + t * 18 * scale);
    c.stroke();
    if (controller.trails && !birth)
      for (let i = 1; i <= 3; i++) {
        c.globalAlpha = 0.12 - i * 0.03;
        circle(
          c,
          body.x - body.vx * i * 0.4,
          body.y - body.vy * i * 0.4,
          radius,
        );
        c.stroke();
      }
  }
  if (!birth || t > 0.5) {
    c.globalAlpha =
      body.visibility * (birth ? Math.min(0.8, (t - 0.5) * 3) : 0.8);
    c.fillStyle = "#714b43";
    c.font = `${11 * scale}px sans-serif`;
    c.textAlign = "center";
    c.fillText(body.node.label, body.x, body.y + radius + 13 * scale);
  }
  c.restore();
}
function AmbientParticleCanvas(
  c: CanvasRenderingContext2D,
  particles: Particle[],
  m: Metrics,
  dt: number,
  time: number,
  controller: MotionController,
  reduced: boolean,
) {
  c.clearRect(0, 0, m.width, m.height);
  if (reduced || !controller.enabled) return;
  c.save();
  safeClip(c, m, true);
  const match = controller.effects.find((e) => e.type === "MATCH");
  const cx = m.area.x + m.area.width / 2,
    cy = m.area.y + m.area.height / 2;
  for (const p of particles) {
    p.age += dt;
    if (p.age >= p.life || p.x < -20 || p.y > m.height + 20) {
      p.x = Math.random() * m.width;
      p.y = Math.random() * m.height;
      p.age = 0;
      p.life = 8 + Math.random() * 12;
    }
    p.x += (-p.speed + Math.sin(time / 4200 + p.phase) * 2) * dt * m.scale;
    p.y += (p.speed * 0.5 + Math.cos(time / 6500 + p.phase)) * dt * m.scale;
    const life = Math.sin((Math.PI * p.age) / p.life);
    const response =
      match && Math.hypot(p.x - cx, p.y - cy) < 140 * m.scale ? 1.3 : 1;
    c.globalAlpha =
      life *
      (0.08 + (Math.sin(time / 3000 + p.phase) + 1) * 0.025) *
      controller.energy *
      response;
    c.fillStyle = p.kind < 18 ? "#bd8b48" : p.kind < 26 ? "#7f2439" : "#b87546";
    if (p.kind >= 26) {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.phase + time / 18000);
      c.beginPath();
      c.ellipse(0, 0, 2 * m.scale, 5 * m.scale, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    } else {
      circle(c, p.x, p.y, (1.1 + Math.sin(p.phase) * 0.4) * m.scale);
      c.fill();
    }
  }
  c.restore();
}
function EventEffectLayer(
  c: CanvasRenderingContext2D,
  m: Metrics,
  controller: MotionController,
  snapshot: ScreenSnapshot,
  time: number,
  reduced: boolean,
) {
  c.clearRect(0, 0, m.width, m.height);
  if (reduced || !controller.enabled) return;
  c.save();
  safeClip(c, m);
  for (const event of controller.effects) {
    const progress = Math.min(
      1,
      Math.max(0, (time - event.started) / event.duration),
    );
    if (
      event.type === "ANSWER" &&
      event.option !== undefined &&
      m.bars[event.option]
    ) {
      const bar = m.bars[event.option];
      const x =
          bar.x +
          (bar.width * snapshot.projection.options[event.option].percentage) /
            100,
        y = bar.y + bar.height / 2;
      c.fillStyle = "#8e344b";
      c.globalAlpha = Math.sin(progress * Math.PI) * 0.32;
      for (let i = 0; i < 3; i++) {
        circle(
          c,
          x + Math.sin(i * 2.1) * progress * 9 * m.scale,
          y - progress * (i + 1) * 4 * m.scale,
          1.3 * m.scale,
        );
        c.fill();
      }
    }
    if (event.type !== "MATCH" || m.area.width < 80 * m.scale) continue;
    c.save();
    c.beginPath();
    c.rect(m.area.x, m.area.y, m.area.width, m.area.height);
    c.clip();
    const x = m.area.x + m.area.width / 2,
      y = m.area.y + m.area.height / 2;
    const travel = Math.max(0, 1 - progress / 0.55),
      span = Math.min(70 * m.scale, m.area.width * 0.3);
    c.globalAlpha = Math.sin(progress * Math.PI) * 0.65;
    ["#9a4052", "#c8a26b"].forEach((color, index) => {
      c.fillStyle = color;
      circle(
        c,
        x + (index ? -1 : 1) * travel * span,
        y + (index ? 1 : -1) * travel * 9 * m.scale,
        3 * m.scale,
      );
      c.fill();
    });
    if (event.phase === "mutual") {
      c.lineWidth = 0.65 * m.scale;
      c.strokeStyle = "#ba8c6e";
      for (const offset of [-3, 3]) {
        c.beginPath();
        c.moveTo(x - span, y + offset * m.scale);
        c.quadraticCurveTo(
          x,
          y - offset * 2 * m.scale,
          x + span,
          y + offset * m.scale,
        );
        c.stroke();
      }
    }
    if (progress > 0.4) {
      const pulse = (progress - 0.4) / 0.6;
      ["#963d53", "#c2a16c"].forEach((color, i) => {
        c.strokeStyle = color;
        c.globalAlpha = (1 - pulse) * 0.38;
        circle(c, x, y, (8 + pulse * (38 + i * 8)) * m.scale);
        c.stroke();
      });
      c.globalAlpha = Math.sin(pulse * Math.PI) * 0.65;
      c.fillStyle = "#8a6254";
      c.font = `${12 * m.scale}px sans-serif`;
      c.textAlign = "center";
      c.fillText(
        event.phase === "confirmed" ? "双方已确认见面" : "又有人愿意认识彼此",
        x,
        y + 65 * m.scale,
      );
    }
    c.restore();
  }
  c.restore();
}

export function ScreenMotion({
  snapshot,
  controller,
  scene,
}: {
  snapshot: ScreenSnapshot;
  controller: MotionController;
  scene: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef(snapshot);
  const sceneRef = useRef(scene);
  const syncRef = useRef<(() => void) | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    snapshotRef.current = snapshot;
    sceneRef.current = scene;
    controller.setFieldActive(scene === "question");
    snapshot.events.forEach((event) => controller.receive(event));
    syncRef.current?.();
  }, [snapshot, controller, scene]);
  useEffect(() => {
    const host = hostRef.current!,
      root = host.closest<HTMLElement>(".screen-canvas")!;
    const canvases = Array.from(host.querySelectorAll("canvas"));
    const contexts = canvases.map((canvas) => canvas.getContext("2d"));
    if (contexts.some((c) => !c)) return;
    const [ambient, relation, eventLayer] =
      contexts as CanvasRenderingContext2D[];
    let metrics: Metrics = {
      width: 0,
      height: 0,
      scale: 1,
      qr: empty,
      area: empty,
      bars: [],
      obstacles: [],
    };
    let bodies: Body[] = [],
      clustered = 0,
      stopFrame: (() => void) | undefined,
      last = 0,
      visible = true,
      frames = 0,
      elapsed = 0,
      fps = Number(screenMotion.fps);
    let disposed = false;
    const preference = matchMedia(reduceQuery);
    const particles: Particle[] = Array.from(
      { length: Math.min(screenMotion.particles, screenMotion.particleLimit) },
      (_, kind) => ({
        x: 0,
        y: 0,
        speed: 6 + Math.random() * 12,
        age: Math.random() * 8,
        life: 8 + Math.random() * 12,
        phase: Math.random() * Math.PI * 2,
        kind,
      }),
    );
    const images = new Map<string, HTMLImageElement>();
    const draw = (time: number, dt: number) => {
      if (sceneRef.current === "question") {
        for (const context of [ambient, relation, eventLayer])
          context.clearRect(0, 0, metrics.width, metrics.height);
        return;
      }
      const previewCount = controller.previews.length;
      controller.prune(time);
      if (previewCount !== controller.previews.length) {
        const next = reconcile(
          bodies,
          [
            ...snapshotRef.current.nodes,
            ...controller.previews.map((p) => p.node),
          ],
          metrics.area,
          metrics.scale,
          time,
        );
        bodies = next.bodies;
        clustered = next.clustered;
      }
      const reduced = preference.matches || !controller.enabled;
      AmbientParticleCanvas(
        ambient,
        particles,
        metrics,
        dt,
        time,
        controller,
        reduced,
      );
      relation.clearRect(0, 0, metrics.width, metrics.height);
      relation.save();
      safeClip(relation, metrics, true);
      const area = metrics.area,
        scale = metrics.scale;
      relation.beginPath();
      relation.rect(area.x, area.y, area.width, area.height);
      relation.clip();
      if (!reduced) step(bodies, area, dt, time, scale);
      const cx = area.x + area.width / 2,
        cy = area.y + area.height / 2;
      if (area.width >= 80 * scale) {
        const radius = Math.min(area.width * 0.42, area.height * 0.23);
        relation.strokeStyle = "#b7966966";
        relation.lineWidth = 0.8 * scale;
        for (let i = 0; i < 3; i++) {
          const t = reduced
            ? (i + 1) / 3
            : (time / (screenMotion.ring * 1000) + i / 3) % 1;
          relation.globalAlpha = (1 - t) * 0.3;
          circle(relation, cx, cy, radius * (0.35 + t * 0.65));
          relation.stroke();
        }
        relation.globalAlpha = reduced
          ? 0.12
          : 0.12 + Math.sin(time / 1900) * 0.02;
        relation.fillStyle = "#b79669";
        circle(relation, cx, cy, 5 * scale);
        relation.fill();
      }
      bodies = bodies.filter(
        (body) => !body.leaving || time - body.leaving < 600,
      );
      for (const body of bodies)
        UserNode(relation, body, time, scale, reduced, controller, images);
      if (clustered > 0) {
        relation.globalAlpha = 0.65;
        relation.fillStyle = "#8b705a";
        relation.font = `${12 * scale}px sans-serif`;
        relation.textAlign = "center";
        relation.fillText(
          `还有 ${clustered} 位探索者`,
          cx,
          area.y + area.height - 4 * scale,
        );
      }
      relation.restore();
      EventEffectLayer(
        eventLayer,
        metrics,
        controller,
        snapshotRef.current,
        time,
        reduced,
      );
      host.dataset.nodes = String(bodies.length);
      host.dataset.clustered = String(clustered);
      host.dataset.effects = String(controller.effects.length);
    };
    const measure = () => {
      if (disposed) return;
      const box = root.getBoundingClientRect(),
        scale = box.width / 1920;
      const rect = (r: DOMRect, pad = 0): Rect => ({
        x: r.x - box.x - pad,
        y: r.y - box.y - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
      const main = root.querySelector(".screen-main")!.getBoundingClientRect();
      const qr = root.querySelector(".screen-qr")!.getBoundingClientRect();
      const content = root.querySelector("[data-scene-current]")!;
      const obstacles: Rect[] = [];
      let right = box.x + box.width * 0.43;
      content
        .querySelectorAll(
          "h1, .eyebrow, .screen-number, .screen-subtext, .fine, .screen-distribution, .relationship-tracks",
        )
        .forEach((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = el.matches(".screen-distribution, .relationship-tracks")
            ? el.getBoundingClientRect()
            : range.getBoundingClientRect();
          right = Math.max(right, r.right);
          obstacles.push(rect(r, 10 * scale));
        });
      const width = Math.max(0, qr.left - right - 50 * scale);
      metrics = {
        width: box.width,
        height: box.height,
        scale,
        qr: rect(qr, 16 * scale),
        obstacles,
        area: {
          x: right - box.x + 24 * scale,
          y: main.top - box.y + 30 * scale,
          width,
          height: Math.max(0, main.height - 70 * scale),
        },
        bars: Array.from(content.querySelectorAll(".screen-bar > div")).map(
          (el) => rect(el.getBoundingClientRect()),
        ),
      };
      const dpr = Math.min(devicePixelRatio || 1, screenMotion.dpr);
      canvases.forEach((canvas, i) => {
        const width = Math.round(box.width * dpr),
          height = Math.round(box.height * dpr);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          contexts[i]!.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      });
      if (!particles[0].x)
        particles.forEach((p) => {
          p.x = Math.random() * box.width;
          p.y = Math.random() * box.height;
        });
      if (!visible) controller.clear();
      const nodes = [
        ...snapshotRef.current.nodes,
        ...controller.previews.map((p) => p.node),
      ];
      const active = controller.effects.flatMap((e) =>
        e.node ? [e.node] : [],
      );
      const next = reconcile(
        bodies,
        nodes,
        metrics.area,
        scale,
        performance.now(),
        active,
      );
      bodies = next.bodies;
      if (preference.matches || !controller.enabled)
        bodies.forEach((body) => {
          body.x = body.tx;
          body.y = body.ty;
          body.vx = 0;
          body.vy = 0;
        });
      clustered = next.clustered;
      // Only display-policy approved, allowlisted local assets may be loaded.
      const needed = new Set(
        nodes.map((n) => n.image).filter((src): src is string => !!src),
      );
      for (const [src, img] of images)
        if (!needed.has(src)) {
          img.onload = null;
          img.onerror = null;
          images.delete(src);
        }
      for (const src of needed)
        if (
          !images.has(src) &&
          (/^\/assets\/avatar-(male|female)\.png$/.test(src) ||
            isPublicSystemAvatarSource(src))
        ) {
          const img = new Image();
          img.onload = () => {
            if (!disposed) draw(performance.now(), 0);
          };
          images.set(src, img);
          img.src = getImageProps({
            src,
            alt: "系统虚拟头像",
            width: 64,
            height: 64,
          }).props.src;
        }
      host.dataset.area = JSON.stringify(metrics.area);
      host.dataset.safe = JSON.stringify(metrics.qr);
      draw(performance.now(), 0);
    };
    const tick = (now: number) => {
      if (disposed) return;
      if (now - last >= 1000 / fps - 1) {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        elapsed += last ? now - last : 0;
        last = now;
        frames++;
        const start = performance.now();
        draw(now, dt);
        if (performance.now() - start > 18) {
          fps = screenMotion.fallbackFps;
          particles.splice(24);
        }
        if (frames % 120 === 0) {
          host.dataset.fps = String(Math.round(120000 / Math.max(1, elapsed)));
          elapsed = 0;
        }
      }
    };
    const sync = () => {
      stopFrame?.();
      stopFrame = undefined;
      last = 0;
      elapsed = 0;
      const running =
        sceneRef.current !== "question" &&
        visible &&
        document.visibilityState === "visible" &&
        !preference.matches &&
        controller.enabled;
      host.dataset.running = String(running);
      if (
        !visible ||
        document.visibilityState !== "visible" ||
        preference.matches ||
        !controller.enabled
      )
        controller.clear();
      measure();
      if (running) stopFrame = controller.frames.add(tick);
    };
    refreshRef.current = measure;
    syncRef.current = sync;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(root.querySelector(".screen-content")!);
    observer.observe(root.querySelector(".screen-qr")!);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(host);
    window.addEventListener("resize", measure);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    void document.fonts.ready.then(() => {
      if (!disposed) measure();
    });
    sync();
    return () => {
      disposed = true;
      stopFrame?.();
      observer.disconnect();
      intersection.disconnect();
      window.removeEventListener("resize", measure);
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      images.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
      images.clear();
      controller.dispose();
      refreshRef.current = null;
      syncRef.current = null;
    };
  }, [controller]);
  return (
    <div
      ref={hostRef}
      className="screen-motion-layers"
      aria-hidden="true"
      data-testid="screen-motion"
    >
      <canvas data-layer="ambient" />
      <canvas data-layer="relationship" />
      <canvas data-layer="events" />
    </div>
  );
}
