import * as THREE from "three";
import { pairPoint } from "./pair-geometry";
import {
  PAIR_TIMING as T,
  PAIR_EFFECT as E,
  PAIR_HEART as HEART,
} from "./pair-config";
import { createHeartMesh, heartState } from "./pair-heart";
import { HEART_OUTLINE } from "./pair-heart-shape";
import type { PairSceneFrame } from "./types";
import type { WorldQuality } from "./world-tokens";
const H = 1080,
  TAIL_CAPACITY = 192,
  SPARKS = 16;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const vertex = `attribute float intensity;attribute float radius;attribute vec3 tint;varying float alpha;varying vec3 hue;uniform float pixelScale;void main(){alpha=intensity;hue=tint;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=radius*pixelScale;}`;
const fragment = `precision mediump float;varying float alpha;varying vec3 hue;void main(){float r=length(gl_PointCoord-.5)*2.;float core=exp(-r*r*8.);float halo=exp(-r*r*2.8);gl_FragColor=vec4(mix(hue,vec3(1.),core*.24),(core*.65+halo*.35)*alpha*(1.-smoothstep(.8,1.,r)));}`;
// A distinct crisp core keeps the collision particles legible without brightening the tails.
const sparkFragment = `precision mediump float;varying float alpha;varying vec3 hue;void main(){float r=length(gl_PointCoord-.5)*2.;float core=1.-smoothstep(.15,.58,r);float halo=exp(-r*r*3.);gl_FragColor=vec4(mix(hue,vec3(1.),core*.3),(core*.85+halo*.15)*alpha*(1.-smoothstep(.8,1.,r)));
#include <colorspace_fragment>
}`;
const glowVertex = `attribute float instanceAlpha;attribute float instanceStar;attribute vec3 instanceTint;varying vec2 vUv;varying float alpha,star;varying vec3 hue;void main(){vUv=uv;alpha=instanceAlpha;star=instanceStar;hue=instanceTint;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;
const glowFragment = `precision mediump float;varying vec2 vUv;varying float alpha,star;varying vec3 hue;void main(){vec2 p=(vUv-.5)*2.;float r=length(p);float glow=exp(-r*r*6.);float ray=exp(-abs(p.x*p.y)*130.)*exp(-r*3.);gl_FragColor=vec4(hue,(glow*.52+ray*star*.7)*alpha*(1.-smoothstep(.7,1.,r)));}`;
function pool(count: number, fragmentShader = fragment) {
  const g = new THREE.BufferGeometry();
  for (const [key, size] of [
    ["position", 3],
    ["intensity", 1],
    ["radius", 1],
    ["tint", 3],
  ] as const)
    g.setAttribute(
      key,
      new THREE.BufferAttribute(new Float32Array(count * size), size).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: { pixelScale: { value: 1 } },
  });
  const mesh = new THREE.Points(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return mesh;
}
/** One fixed pool per effect kind, including one instanced material for all nine glows. */
export class PairConnection {
  readonly group = new THREE.Group();
  private hearts = createHeartMesh();
  private heart = { alpha: 0, scale: 1, presence: 0 };
  private tails = pool(TAIL_CAPACITY);
  private sparks = pool(SPARKS, sparkFragment);
  private glows: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private wave = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.012, 64),
    new THREE.MeshBasicMaterial({
      color: "#e2c194",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  private point = { x: 0, y: 0 };
  private transform = new THREE.Object3D();
  private colors = [
    new THREE.Color("#97c3dc"),
    new THREE.Color("#cf8294"),
    new THREE.Color("#efd2a0"),
  ];
  visibleParticles = 0;
  constructor() {
    const plane = new THREE.PlaneGeometry(2, 2);
    plane.setAttribute(
      "instanceAlpha",
      new THREE.InstancedBufferAttribute(new Float32Array(9), 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    plane.setAttribute(
      "instanceStar",
      new THREE.InstancedBufferAttribute(new Float32Array(9), 1),
    );
    plane.setAttribute(
      "instanceTint",
      new THREE.InstancedBufferAttribute(new Float32Array(27), 3),
    );
    this.glows = new THREE.InstancedMesh(
      plane,
      new THREE.ShaderMaterial({
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
      }),
      9,
    );
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 7;
    this.glows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 9; i++) {
      const c = this.colors[i % 3];
      plane.getAttribute("instanceTint").setXYZ(i, c.r, c.g, c.b);
      plane.getAttribute("instanceStar").setX(i, i % 3 === 2 ? 1 : 0);
    }
    this.sparks.renderOrder = 10;
    this.group.add(this.tails, this.sparks, this.glows, this.wave, this.hearts);
    this.group.visible = false;
  }
  resize(scale: number) {
    for (const p of [this.tails, this.sparks])
      p.material.uniforms.pixelScale.value = scale;
  }
  private pointAt(
    pool: typeof this.tails,
    index: number,
    x: number,
    y: number,
    z: number,
    alpha: number,
    radius: number,
    color: THREE.Color,
  ) {
    pool.geometry.getAttribute("position").setXYZ(index, x, H - y, z);
    pool.geometry.getAttribute("intensity").setX(index, alpha);
    pool.geometry.getAttribute("radius").setX(index, radius);
    pool.geometry.getAttribute("tint").setXYZ(index, color.r, color.g, color.b);
  }
  private glow(
    index: number,
    x: number,
    y: number,
    size: number,
    alpha: number,
  ) {
    this.transform.position.set(x, H - y, 20);
    this.transform.scale.setScalar(size);
    this.transform.updateMatrix();
    this.glows.setMatrixAt(index, this.transform.matrix);
    this.glows.geometry.getAttribute("instanceAlpha").setX(index, alpha);
  }
  draw(
    frame: PairSceneFrame | undefined,
    reduced: boolean,
    interrupted: boolean,
    quality: WorldQuality = "MEDIUM",
  ) {
    this.visibleParticles = 0;
    this.group.visible = !!frame?.slots.length && !interrupted;
    if (!frame || !this.group.visible) return;
    const count = reduced ? 8 : { HIGH: 32, MEDIUM: 24, LOW: 12 }[quality];
    let tailIndex = 0,
      sparkIndex = 0;
    for (let i = 0; i < 9; i++) this.glow(i, 0, 0, 0, 0);
    this.wave.material.opacity = 0;
    const heartAlpha = this.hearts.geometry.getAttribute("heartAlpha");
    for (let i = 0; i < 3; i++) heartAlpha.setX(i, 0);
    let anyHeart = false;
    for (const s of frame.slots) {
      const l = s.layout,
        ms = s.elapsedMs,
        age = (ms - T.collision) / 1000;
      const single = frame.layoutCount === 1;
      const heartWidth = single ? HEART.singleWidth : HEART.width;
      const footprint = single ? HEART.singleFootprint : HEART.footprint;
      heartState(ms - T.collision, reduced, this.heart);
      if (!frame.spark && !reduced) this.heart.alpha = this.heart.presence = 0;
      heartAlpha.setX(s.slot, this.heart.alpha * s.opacity);
      if (this.heart.alpha > 0 && s.opacity > 0) {
        this.transform.position.set(l.centerX, H - l.meetY, 24);
        this.transform.scale.setScalar(heartWidth * this.heart.scale);
        this.transform.updateMatrix();
        this.hearts.setMatrixAt(s.slot, this.transform.matrix);
        anyHeart = true;
      }
      const moving = ms >= T.enter && ms < T.collision;
      const holding = ms >= T.collision || s.phase === "out";
      const showing = moving || holding;
      const travel =
        1 - Math.pow(1 - clamp((ms - T.enter) / (T.collision - T.enter)), 1.6);
      const arrival = Math.exp(-Math.pow(age / 0.18, 2));
      const settle = reduced ? 1 : smooth((ms - T.collision) / E.settleMs);
      for (let side = 0; side < 2; side++) {
        if (showing && frame.trail) {
          for (let i = 0; i < count; i++) {
            const f = i / (count - 1),
              movingT = Math.max(0, travel - (1 - f) * E.tailLength),
              t = reduced ? f : movingT + (f - movingT) * settle;
            pairPoint(s.pattern, side, t, this.point, l);
            const movingEnergy = Math.pow(f, 1.8) * 0.84,
              steadyEnergy =
                0.68 +
                0.18 * Math.pow(0.5 + 0.5 * Math.sin(t * 19 - ms * 0.002), 6),
              energy = movingEnergy + (steadyEnergy - movingEnergy) * settle,
              movingSize = (2 + f * f * 8) * E.movingTailScale;
            this.pointAt(
              this.tails,
              tailIndex++,
              this.point.x,
              this.point.y,
              18,
              energy * s.opacity * (t > 0 || holding ? 1 : 0),
              reduced ? 2.5 : movingSize + (4 + f * 3 - movingSize) * settle,
              this.colors[side],
            );
          }
        }
        pairPoint(s.pattern, side, reduced ? 1 : travel, this.point, l);
        this.glow(
          s.slot * 3 + side,
          this.point.x,
          this.point.y,
          reduced
            ? 10
            : (18 + arrival * 5) * (E.headScale + (1 - E.headScale) * settle),
          showing ? s.opacity * (reduced ? 0.08 : 0.65 - 0.57 * settle) : 0,
        );
      }
      this.glow(
        s.slot * 3 + 2,
        l.centerX,
        l.meetY,
        reduced ? 20 : Math.min(footprint / 2, 32 + arrival * 14),
        holding
          ? s.opacity *
              (0.7 + arrival * 0.26) *
              (1 - this.heart.presence * 0.94)
          : 0,
      );
      const sparkAge = ms - T.collision - HEART.sparkStartMs;
      // A single shared collision pool is reserved by the director.
      if (
        !reduced &&
        frame.spark &&
        sparkAge >= 0 &&
        sparkAge < E.sparkDurationMs &&
        sparkIndex === 0
      ) {
        const spread =
            1 - Math.pow(1 - clamp(sparkAge / E.sparkDurationMs), 1.3),
          opacity =
            E.sparkPeak *
            (1 -
              smooth(
                (sparkAge - E.sparkHoldMs) /
                  (E.sparkDurationMs - E.sparkHoldMs),
              ));
        for (let i = 0; i < SPARKS; i++) {
          const origin = HEART_OUTLINE[i * (HEART_OUTLINE.length / SPARKS)],
            x = origin.x * heartWidth,
            y = -origin.y * heartWidth,
            radius = Math.hypot(x, y),
            size = E.sparkMinSize + (i % 3) * E.sparkSizeStep,
            // Endpoints fit the total footprint, including the particle radius.
            limit = footprint / 2 - size / 2,
            end = Math.max(radius, limit - (i % 3) * 1.5),
            scale = 1 + spread * (end / radius - 1);
          this.pointAt(
            this.sparks,
            sparkIndex++,
            l.centerX + x * scale,
            l.meetY + y * scale,
            21,
            opacity * s.opacity,
            size,
            this.colors[i % 6 === 0 ? 0 : i % 6 === 3 ? 1 : 2],
          );
        }
        if (sparkAge < 600) {
          this.wave.position.set(l.centerX, H - l.meetY, 16);
          this.wave.scale.setScalar(
            heartWidth / 2 +
              (clamp(sparkAge / 600) * (footprint - heartWidth)) / 2,
          );
          this.wave.material.opacity =
            Math.sin(clamp(sparkAge / 600) * Math.PI) * 0.1 * s.opacity;
        }
      }
    }
    this.hearts.visible = anyHeart;
    heartAlpha.needsUpdate = true;
    this.hearts.instanceMatrix.needsUpdate = true;
    this.tails.geometry.setDrawRange(0, tailIndex);
    this.sparks.geometry.setDrawRange(0, sparkIndex);
    for (const p of [this.tails, this.sparks])
      for (const key of ["position", "intensity", "radius", "tint"])
        p.geometry.getAttribute(key).needsUpdate = true;
    this.glows.geometry.getAttribute("instanceAlpha").needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    this.visibleParticles = tailIndex + sparkIndex;
  }
}
