import * as THREE from "three";
import { getImageProps } from "next/image";
import type { ScreenSnapshot } from "../model";
import type { MotionController } from "../controller";
import {
  fieldLayout,
  placeSlots,
  qualitySettings,
  sampleNodes,
  unit,
  type FieldNode,
  type Quality,
} from "./layout";
import type { FieldArrival } from "./queue";

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragment = `
precision mediump float;
varying vec2 vUv;
uniform float time, phase, pulse, quiet, simple;
uniform vec3 tint;
void main(){
  vec2 p=(vUv-.5)*2.; float r=length(p); float a=atan(p.y,p.x);
  float edge=.77+.018*sin(a*3.+phase)+.012*sin(a*5.-phase);
  float breath=quiet>.5?0.:.008*sin(time*.5235987756+phase);
  float contour=1.-smoothstep(.002,.016,abs(r-edge-breath));
  float core=exp(-r*r*4.)*.10;
  float halo=(1.-smoothstep(.50,.96,r))*.035;
  float ring=1.-smoothstep(.001,.008,abs(r-(.56+fract(time/6.+phase)*.24)));
  float ripple=(1.-smoothstep(.006,.018,abs(r-(.40+pulse*.45))))*sin(pulse*3.14159)*.12;
  float alpha=core+halo+contour*.18+ring*(1.-fract(time/6.+phase))*.025*(1.-quiet)*(1.-simple)+ripple;
  gl_FragColor=vec4(mix(vec3(.98,.96,.92),tint,clamp(contour+ring*.15,0.,1.)),alpha*(1.-smoothstep(.95,1.,r)));
}`;
type Field = ReturnType<typeof fieldLayout>[number];
type Body = {
  node: FieldNode;
  group: THREE.Group;
  face: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  label: HTMLSpanElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  depth: number;
  size: number;
  field: Field;
};
type Path = {
  event: FieldArrival;
  curve: THREE.QuadraticBezierCurve3;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

/** Owns visual resources only. Counters, memberships and event identity come from ScreenAdapter. */
export class DestinyWorld {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  private plane = new THREE.PlaneGeometry(2, 2);
  private circle = new THREE.CircleGeometry(1, 40);
  private ring = new THREE.RingGeometry(1.025, 1.07, 40);
  private border = new THREE.MeshBasicMaterial({
    color: "#fff9ee",
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  private fields: {
    data: Field;
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  }[] = [];
  private bodies = new Map<string, Body>();
  private slots = new Map<string, Map<string, number>>();
  private textures = new Map<string, THREE.Texture>();
  private failedTextures = new Set<string>();
  private paths = new Map<string, Path>();
  private particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private snapshot: ScreenSnapshot;
  private width = 1;
  private height = 1;
  private disposed = false;
  private reduced = false;
  private quality: Quality = "HIGH";
  private last = 0;
  private elapsed = 0;
  private frames = 0;
  private frameCount = 0;
  private priorityKey = "";
  private featured = new Map<string, number>();
  private eventSnapshot: ScreenSnapshot | null = null;
  private position = new THREE.Vector3();
  private downgradeAt = 0;
  private loader = new THREE.TextureLoader();
  private lost: (event: Event) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLElement,
    private host: HTMLElement,
    snapshot: ScreenSnapshot,
    private controller: MotionController,
    onFailure: () => void,
  ) {
    this.snapshot = snapshot;
    // Preflight avoids Three logging an expected renderer creation failure.
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    if (!context) throw new Error("WebGL2 unavailable");
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    const positions = new Float32Array(40 * 3);
    this.particles = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: "#b99157",
        size: 2.2,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    this.particles.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.scene.add(this.particles);
    this.lost = (event) => {
      event.preventDefault();
      onFailure();
    };
    canvas.addEventListener("webglcontextlost", this.lost);
    host.dataset.renderer = "webgl";
    host.dataset.quality = this.quality;
  }
  resize(width: number, height: number) {
    if (this.disposed || width < 2 || height < 2) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.z =
      height / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.update(this.snapshot, this.reduced);
  }
  update(snapshot: ScreenSnapshot, reduced: boolean) {
    if (this.disposed) return;
    if (snapshot !== this.eventSnapshot) {
      this.eventSnapshot = snapshot;
      for (const event of snapshot.events)
        if (event.field && event.node && Date.now() - event.timestamp <= 5000)
          this.featured.set(event.node, performance.now() + 12000);
      while (this.featured.size > 36)
        this.featured.delete(this.featured.keys().next().value!);
    }
    const changed = snapshot.question.id !== this.snapshot.question.id;
    this.snapshot = snapshot;
    this.reduced = reduced;
    this.controller.joins.reconcile(snapshot.members, snapshot.question.id);
    if (changed) {
      this.clearPaths();
      this.slots.clear();
    }
    const layout = fieldLayout(snapshot.question, this.width, this.height);
    const rebuild =
      layout.length !== this.fields.length ||
      layout.some((f, i) => f.key !== this.fields[i]?.data.key);
    if (rebuild) {
      for (const f of this.fields) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
      }
      this.fields = layout.map((data, i) => {
        const material = new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: fragment,
          transparent: true,
          depthWrite: false,
          uniforms: {
            time: { value: 0 },
            phase: { value: i * 1.7 },
            pulse: { value: 0 },
            quiet: { value: 0 },
            simple: { value: 0 },
            tint: { value: new THREE.Color(i % 2 ? "#b79960" : "#975567") },
          },
        });
        const mesh = new THREE.Mesh(this.plane, material);
        mesh.renderOrder = -2;
        this.scene.add(mesh);
        return { data, mesh };
      });
    }
    this.fields.forEach((field, i) => {
      field.data = layout[i];
      field.mesh.position.set(
        field.data.x - this.width / 2,
        this.height / 2 - field.data.y,
        -4,
      );
      field.mesh.scale.set(field.data.radius, field.data.radius, 1);
      field.mesh.material.uniforms.quiet.value = reduced ? 1 : 0;
      field.mesh.material.uniforms.simple.value =
        this.quality === "LOW" ? 1 : 0;
      const projected = this.project(field.data.x, field.data.y, 0);
      const label = this.host.querySelector<HTMLElement>(
        `[data-field-key="${field.data.key}"]`,
      );
      if (label) {
        label.style.left = `${projected.x}px`;
        label.style.top = `${projected.y}px`;
      }
    });
    this.reconcileBodies();
    this.draw(performance.now(), false);
  }
  private project(x: number, y: number, z: number) {
    this.position
      .set(x - this.width / 2, this.height / 2 - y, z)
      .project(this.camera);
    return {
      x: ((this.position.x + 1) * this.width) / 2,
      y: ((1 - this.position.y) * this.height) / 2,
    };
  }
  private texture(source: string): THREE.Texture | null {
    if (this.failedTextures.has(source)) return null;
    if (this.textures.has(source)) return this.textures.get(source)!;
    const url = getImageProps({
      src: source,
      alt: "系统虚拟头像",
      width: 96,
      height: 96,
    }).props.src;
    const texture = this.loader.load(
      url,
      (loaded) => {
        if (this.disposed) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        this.draw(performance.now(), false);
      },
      undefined,
      () => {
        if (!this.disposed) {
          this.failedTextures.add(source);
          this.host.dataset.textureFallback = "true";
          this.textures.get(source)?.dispose();
          this.textures.delete(source);
          for (const body of this.bodies.values())
            if (body.node.image === source) {
              body.face.material.map = null;
              body.face.material.color.set("#d7bda9");
              body.face.material.needsUpdate = true;
            }
          this.draw(performance.now(), false);
        }
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(source, texture);
    return texture;
  }
  private reconcileBodies() {
    const desired = new Set<string>();
    for (const [key, until] of this.featured)
      if (
        until < performance.now() ||
        !this.snapshot.members.some((n) => n.key === key)
      )
        this.featured.delete(key);
    const priority = [
      ...this.controller.joins.priorities(),
      ...this.featured.keys(),
    ];
    for (const field of this.fields.map((f) => f.data)) {
      // Preserve room for each nickname; a dense scene shows fewer representatives, never invented users.
      const capacity = Math.min(
        qualitySettings[this.quality].avatars,
        this.snapshot.question.options.length === 4 ? 4 : 8,
      );
      const nodes = sampleNodes(
        this.snapshot.members,
        field.key,
        capacity,
        priority,
      );
      const slots = placeSlots(
        nodes,
        this.slots.get(field.key) ?? new Map(),
        capacity,
      );
      this.slots.set(field.key, slots);
      for (const node of nodes) {
        desired.add(node.key);
        const four = this.snapshot.question.options.length === 4;
        const angle =
          (slots.get(node.key)! / capacity) * Math.PI * 2 -
          Math.PI / 2 +
          (four ? Math.PI / 4 : 0);
        const orbit = field.radius * (four ? 0.98 : 0.77);
        const size = Math.max(
          10,
          Math.min(field.radius * 0.17, this.width * 0.023),
        );
        const tx = field.x + Math.cos(angle) * orbit,
          ty = field.y + Math.sin(angle) * orbit;
        let body = this.bodies.get(node.key);
        if (!body) {
          const face = new THREE.Mesh(
            this.circle,
            new THREE.MeshBasicMaterial({
              transparent: true,
              depthWrite: false,
              color: "#ffffff",
            }),
          );
          const group = new THREE.Group();
          group.add(face, new THREE.Mesh(this.ring, this.border));
          group.renderOrder = 2;
          const label = document.createElement("span");
          label.className = "field-avatar-name";
          label.dataset.nodeKey = node.key;
          this.overlay.appendChild(label);
          this.scene.add(group);
          body = {
            node,
            face,
            group,
            label,
            x: tx,
            y: ty,
            tx,
            ty,
            size,
            depth: 0,
            field,
          };
          this.bodies.set(node.key, body);
        }
        if (body.node.image !== node.image || !body.face.material.map) {
          body.face.material.map = this.texture(node.image!);
          body.face.material.color.set(
            body.face.material.map ? "#ffffff" : "#d7bda9",
          );
          body.face.material.needsUpdate = true;
        }
        Object.assign(body, {
          node,
          tx,
          ty,
          size,
          depth: (unit(node.seed, 2) - 0.5) * 3,
          field,
        });
        body.label.textContent = node.label;
        body.label.title = node.label;
        body.label.style.fontSize = `${Math.max(9, this.width * 0.0105)}px`;
        body.label.style.width = `${size * 3.3}px`;
      }
    }
    for (const [key, body] of this.bodies)
      if (!desired.has(key)) {
        this.scene.remove(body.group);
        body.face.material.dispose();
        body.label.remove();
        this.bodies.delete(key);
      }
    this.host.dataset.nodes = String(this.bodies.size);
  }
  private path(event: FieldArrival, body: Body) {
    const end = new THREE.Vector3(
      body.tx - this.width / 2,
      this.height / 2 - body.ty,
      1,
    );
    const start =
      event.field.kind === "move"
        ? new THREE.Vector3(
            body.x - this.width / 2,
            this.height / 2 - body.y,
            1,
          )
        : new THREE.Vector3(
            Math.min(this.width - 20, body.field.x + body.field.radius * 1.2) -
              this.width / 2,
            this.height / 2 -
              Math.max(20, body.field.y - body.field.radius * 1.1),
            1,
          );
    const control = start.clone().lerp(end, 0.5);
    control.y += body.field.radius * 0.35;
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(36)),
      new THREE.LineBasicMaterial({
        color: "#b28b52",
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const wave = new THREE.Mesh(
      this.ring,
      new THREE.MeshBasicMaterial({
        color: "#9b5465",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.scene.add(line, wave);
    const path = { event, curve, line, wave };
    this.paths.set(event.id, path);
    return path;
  }
  private removePath(path: Path) {
    this.scene.remove(path.line, path.wave);
    path.line.geometry.dispose();
    path.line.material.dispose();
    path.wave.material.dispose();
  }
  private clearPaths() {
    this.paths.forEach((p) => this.removePath(p));
    this.paths.clear();
  }
  resetTime() {
    this.last = 0;
    this.elapsed = 0;
    this.frames = 0;
  }
  draw(now: number, animate = true) {
    if (this.disposed) return;
    const quiet = this.reduced || !animate;
    if (animate) {
      this.controller.prune(now);
      this.controller.joins.tick(now);
      const priorities = this.controller.joins.priorities().join("|");
      if (priorities !== this.priorityKey) {
        this.priorityKey = priorities;
        this.reconcileBodies();
      }
    }
    const active = this.controller.joins.active;
    const valid = new Set(active.map((e) => e.id));
    for (const [id, path] of this.paths)
      if (!valid.has(id)) {
        this.removePath(path);
        this.paths.delete(id);
      }
    const time = this.reduced ? 0 : now / 1000;
    for (const field of this.fields) {
      const arrival = active.find((e) => e.field.optionKey === field.data.key);
      const pulse =
        arrival && !this.reduced
          ? Math.min(1, Math.max(0, (now - arrival.started - 900) / 600))
          : 0;
      field.mesh.material.uniforms.time.value = time % 120;
      field.mesh.material.uniforms.pulse.value = pulse;
      const scale = field.data.radius * (1 + Math.sin(pulse * Math.PI) * 0.022);
      field.mesh.scale.set(scale, scale, 1);
    }
    for (const body of this.bodies.values()) {
      const event = active.find((e) => e.node === body.node.key);
      let alpha = 1,
        size = body.size;
      const sway = this.reduced
        ? 0
        : ((this.snapshot.question.options.length === 4
            ? 3
            : 4 + unit(body.node.seed, 3) * 4) *
            this.width) /
          1200;
      const phase = unit(body.node.seed, 4) * Math.PI * 2;
      if (event && !this.reduced) {
        const path = this.paths.get(event.id) ?? this.path(event, body);
        const t = Math.min(1, (now - event.started) / 1300),
          eased = t * t * (3 - 2 * t);
        path.curve.getPoint(eased, this.position);
        body.x = this.position.x + this.width / 2;
        body.y = this.height / 2 - this.position.y;
        alpha = Math.min(1, t * 4);
        size *= 0.65 + 0.35 * Math.min(1, t * 4);
        path.line.material.opacity = Math.sin(t * Math.PI) * 0.22;
        const pulse = Math.max(0, (now - event.started - 900) / 600);
        path.wave.position.set(
          body.tx - this.width / 2,
          this.height / 2 - body.ty,
          2,
        );
        path.wave.scale.setScalar(size * (1 + pulse * 1.5));
        path.wave.material.opacity =
          Math.sin(Math.min(1, pulse) * Math.PI) * 0.22;
      } else {
        const blend =
          this.last && !quiet ? Math.min(1, (now - this.last) / 280) : 1;
        body.x +=
          (body.tx + Math.sin(time * 0.65 + phase) * sway - body.x) * blend;
        body.y +=
          (body.ty + Math.cos(time * 0.7 + phase) * sway - body.y) * blend;
        if (this.controller.joins.pending.some((e) => e.node === body.node.key))
          alpha = 0;
      }
      body.group.position.set(
        body.x - this.width / 2,
        this.height / 2 - body.y,
        body.depth,
      );
      body.group.scale.setScalar(size);
      body.face.material.opacity = alpha;
      body.group.visible = alpha > 0;
      const point = this.project(body.x, body.y, body.depth);
      const upperDiagonal = body.ty < body.field.y - body.field.radius * 0.35;
      const nameY = upperDiagonal
        ? point.y - size - (18 * this.width) / 1200
        : point.y + size + 5;
      body.label.style.transform = `translate(${point.x}px,${nameY}px) translateX(-50%)`;
      body.label.style.opacity = String(alpha);
    }
    const count = this.reduced ? 0 : qualitySettings[this.quality].particles;
    this.particles.visible = count > 0;
    this.particles.geometry.setDrawRange(0, count);
    const buffer = this.particles.geometry.attributes
      .position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const x =
        (((unit(i + 11, 1) * this.width - time * (1.8 + unit(i, 2) * 2)) %
          this.width) +
          this.width) %
        this.width;
      const y = (unit(i + 17, 4) * this.height + time * 1.5) % this.height;
      buffer.setXYZ(i, x - this.width / 2, this.height / 2 - y, -2);
    }
    buffer.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    const ticker = this.host.querySelector<HTMLElement>("[data-live-ticker]");
    if (ticker) {
      const text = this.controller.joins.notice?.text ?? "";
      if (ticker.textContent !== text) ticker.textContent = text;
      ticker.dataset.visible = String(!!text);
    }
    this.host.dataset.queue = String(this.controller.joins.pending.length);
    this.host.dataset.paths = String(this.paths.size);
    this.frameCount++;
    this.host.dataset.frames = String(this.frameCount);
    if (animate) {
      if (this.last) {
        this.elapsed += now - this.last;
        this.frames++;
      }
      if (this.frames >= 120) {
        const fps = (this.frames * 1000) / Math.max(1, this.elapsed);
        this.host.dataset.fps = String(Math.round(fps));
        this.host.dataset.resources = JSON.stringify({
          ...this.renderer.info.memory,
          programs: this.renderer.info.programs?.length ?? 0,
        });
        if (
          fps < 38 &&
          now - this.downgradeAt > 6000 &&
          this.quality !== "LOW"
        ) {
          this.quality = this.quality === "HIGH" ? "MEDIUM" : "LOW";
          this.downgradeAt = now;
          this.host.dataset.quality = this.quality;
          this.reconcileBodies();
        }
        this.elapsed = 0;
        this.frames = 0;
      }
      this.last = now;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    this.clearPaths();
    this.bodies.forEach((b) => {
      b.face.material.dispose();
      b.label.remove();
    });
    this.bodies.clear();
    this.fields.forEach((f) => f.mesh.material.dispose());
    this.fields = [];
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
    this.plane.dispose();
    this.circle.dispose();
    this.ring.dispose();
    this.border.dispose();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
