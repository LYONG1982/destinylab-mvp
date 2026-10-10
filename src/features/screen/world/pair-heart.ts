import * as THREE from "three";
import { PAIR_HEART as H } from "./pair-config";

import { SEGMENTS, RINGS, raw, width, centerY } from "./pair-heart-shape";

/** Closed front/back volume. One center per side avoids the demo's degenerate center rings. */
export function createHeartGeometry() {
  const positions: number[] = [],
    indices: number[] = [];
  const perSide = 1 + RINGS * SEGMENTS;
  for (const side of [1, -1]) {
    const base = positions.length / 3;
    positions.push(0, -centerY / width, (side * 1.075) / (2.55 * width));
    for (let ring = 1; ring <= RINGS; ring++) {
      const r = ring / RINGS,
        scale = r ** 0.85;
      for (const p of raw)
        positions.push(
          (p.x * scale) / width,
          (p.y * scale - centerY) / width,
          (side * (0.075 + Math.sqrt(Math.max(0, 1 - r * r)))) / (2.55 * width),
        );
    }
    const triangle = (a: number, b: number, c: number) => {
      indices.push(
        base + a,
        base + (side === 1 ? c : b),
        base + (side === 1 ? b : c),
      );
    };
    for (let i = 0; i < SEGMENTS; i++) {
      const next = (i + 1) % SEGMENTS;
      triangle(0, 1 + i, 1 + next);
      for (let ring = 1; ring < RINGS; ring++) {
        const a = 1 + (ring - 1) * SEGMENTS + i,
          b = 1 + (ring - 1) * SEGMENTS + next;
        const c = 1 + ring * SEGMENTS + i,
          d = 1 + ring * SEGMENTS + next;
        triangle(a, c, d);
        triangle(a, d, b);
      }
      const a = 1 + (RINGS - 1) * SEGMENTS + i,
        b = 1 + (RINGS - 1) * SEGMENTS + next;
      if (side === 1)
        indices.push(a, b, b + perSide, a, b + perSide, a + perSide);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export type HeartState = { alpha: number; scale: number; presence: number };
/** Writes into a reused state object; rendering and replay share the same collision clock. */
export function heartState(age: number, reduced: boolean, out: HeartState) {
  out.alpha = 0;
  out.scale = 1;
  out.presence = 0;
  if (reduced) {
    out.alpha = 0.88;
    out.presence = 1;
    return out;
  }
  if (age < 0 || age >= H.durationMs) return out;
  const enter = smooth(age / H.appearMs);
  out.alpha =
    enter *
    (1 - smooth((age - H.sparkStartMs) / (H.fadeEndMs - H.sparkStartMs)));
  out.scale =
    age < H.appearMs
      ? 0.78 + 0.22 * enter
      : age < H.sparkStartMs
        ? 1 +
          (H.beatScale - 1) *
            Math.sin(
              (Math.PI * (age - H.appearMs)) / (H.sparkStartMs - H.appearMs),
            ) **
              2
        : 1;
  out.presence =
    enter * (1 - smooth((age - H.fadeEndMs) / (H.durationMs - H.fadeEndMs)));
  return out;
}

export function createHeartMesh() {
  const geometry = createHeartGeometry();
  geometry.setAttribute(
    "heartAlpha",
    new THREE.InstancedBufferAttribute(new Float32Array(3), 1).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      core: { value: new THREE.Color("#B74658") },
      rim: { value: new THREE.Color("#EFD2A0") },
    },
    vertexShader: `attribute float heartAlpha; varying float alpha; varying vec3 surfaceNormal;
      void main(){alpha=heartAlpha; surfaceNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);
      gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float alpha; varying vec3 surfaceNormal; uniform vec3 core,rim;
      void main(){if(alpha<.001)discard;vec3 n=normalize(surfaceNormal);vec3 light=normalize(vec3(-.4,.65,1.));
      float diffuse=max(0.,dot(n,light));float edge=pow(1.-max(0.,n.z),2.);
      float spec=pow(max(0.,dot(n,normalize(light+vec3(0.,0.,1.)))),32.);
      vec3 color=core*(.48+.65*diffuse);color=mix(color,rim,edge*.68);color+=rim*spec*.48;
      gl_FragColor=vec4(color,alpha*.94);
      #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, 3);
  mesh.name = "pair-heart";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}
