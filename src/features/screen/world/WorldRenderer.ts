import { PairConnection } from "./PairConnection";
import * as THREE from "three";
import { getImageProps } from "next/image";
import type { WorldData, WorldFrame, WorldPlayer, PairSceneFrame } from "./types";
import { clamp, constrainBody, fieldTarget, flowNoise, freeTarget, neutralTarget, safeRects, seedUnit, settleBodies, stepBodies, type PhysicsBody } from "./world-physics";
import { FIELD_ANCHORS, QUALITY_LIMITS, WORLD_HEIGHT as H, WORLD_LIMITS, WORLD_WIDTH as W, type WorldQuality } from "./world-tokens";

const NEUTRAL_TINT = "#ac9c8e";
const ACT_FIELD_X = [328, 832, 1336] as const;
const ACT_LIVE_X = [500, 960, 1420] as const;
const BACKGROUND_CUE_LIMIT = 3;
export type WorldPlayerPose = { id: string; x: number; y: number; radius: number; opacity?: number };
export type BackgroundPulseVariant = "line" | "ripple" | "gather" | "sweep" | "lift";
type PoseHandoff = WorldPlayerPose & { start: number; duration: number };
type BackgroundCue = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  coords: Float32Array;
  start: number;
  duration: number;
  x: number;
  y: number;
  strength: number;
  variant: BackgroundPulseVariant;
};
const VERTEX = `varying vec2 vUv;varying vec2 vWorld;void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1.)).xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const BACKGROUND = `
precision highp float;varying vec2 vUv;uniform float time,dim,coverage;
void main(){
 vec2 uv=vUv;vec3 base=mix(vec3(.031,.028,.035),vec3(.105,.041,.060),uv.x);
 float mist=exp(-dot((uv-vec2(.51,.27))*vec2(1.4,2.6),(uv-vec2(.51,.27))*vec2(1.4,2.6))*4.);
 base+=vec3(.093,.053,.039)*mist;
 float cloud=sin(uv.x*8.+sin(uv.y*7.+time*.012))*sin(uv.y*9.-time*.016);
 base+=vec3(.008,.005,.006)*cloud;
 float horizon=exp(-pow((uv.y-.12)*15.,2.))*exp(-pow((uv.x-.50)*2.1,2.));
 base+=vec3(.045,.023,.013)*horizon;
 float vignette=1.-.33*pow(length((uv-.5)*vec2(1.,.7)),1.4);
 gl_FragColor=vec4(base*vignette*dim,coverage);
}`;
const FIELD = `
precision highp float;varying vec2 vUv;varying vec2 vWorld;uniform vec3 tint;uniform float time,phase,strength,pulse,contourWeight;
void main(){
 if(vWorld.x>1572.&&vWorld.y<405.)discard;
 vec2 p=(vUv-.5)*2.;float a=atan(p.y,p.x);float r=length(p);
 float shape=.76+.024*sin(a*3.+phase)+.010*sin(a*7.-phase);
 float breath=.004*sin(time*.4+phase);
 float edge=1.-smoothstep(.0015,.008,abs(r-shape-breath));
 float contour=1.-smoothstep(.002,.008,abs(r-(shape*.94+.007*sin(a*5.+phase))));
 float inner=exp(-r*r*4.)*.065;
 float halo=exp(-pow((r-shape)*25.,2.))*.17;
 float spoke=pow(.5+.5*sin(a+phase+time*.016),2.);
 float pRing=(1.-smoothstep(.002,.012,abs(r-(.40+pulse*.48))))*sin(pulse*3.14159)*.16;
 float flow=1.-smoothstep(.001,.005,abs(r-(.62+.038*sin(a*2.+phase+time*.025))));
 float alpha=inner+halo*(.18+.82*spoke)+(edge*.94+contour*.24)*(.16+.84*spoke)*contourWeight+flow*.075*spoke*contourWeight+pRing;
 vec3 visibleTint=mix(tint,sqrt(tint),.72);
 gl_FragColor=vec4(visibleTint,alpha*strength*(1.-smoothstep(.93,1.,r)));
}`;
const SOFT = `precision mediump float;varying vec2 vUv;varying vec2 vWorld;uniform vec3 tint;uniform float opacity;void main(){if(vWorld.x>1572.&&vWorld.y<405.)discard;float r=length((vUv-.5)*2.);float a=exp(-r*r*5.)*(1.-smoothstep(.7,1.,r));gl_FragColor=vec4(tint,a*opacity);}`;
const pointVertex = `attribute float intensity;attribute float pointScale;varying float alpha;uniform float size;void main(){alpha=intensity;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size*pointScale;}`;
const pointFragment = `precision mediump float;varying float alpha;uniform vec3 tint;uniform float opacity;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(tint,(1.-smoothstep(.05,1.,r))*alpha*opacity);}`;

type Face = THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
type Body = PhysicsBody & {
  data: WorldPlayer | null;
  slot: number;
  mesh: Face;
  rim: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  available: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  aura: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  name: HTMLSpanElement;
  opacity: number;
  active: boolean;
  fieldIndex: number;
  choiceX: number;
  choiceY: number;
  liveX: number;
  liveY: number;
  trail: Float32Array;
  trailHead: number;
  trailTick: number;
  pulse: number;
};
type PooledPath = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  coords: Float32Array;
  kind: "history" | "event";
  meetCoords: Float32Array;
  choiceCoords: Float32Array;
  liveCoords: Float32Array;
  meetTint: THREE.Color;
  choiceTint: THREE.Color;
  liveTint: THREE.Color;
};
type Pulse = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  start: number;
  x: number;
  y: number;
  life: number;
};

/** One persistent visual world. The host owns time and the only animation frame
 * loop; this class neither mutates business data nor schedules its own frame. */
export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly pairConnection = new PairConnection();
  private pairFrame: PairSceneFrame | undefined;
  setPairFrame(frame:PairSceneFrame) { this.pairFrame=frame; }
  private readonly camera = new THREE.OrthographicCamera(0, W, H, 0, .1, 2000);
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly circle = new THREE.CircleGeometry(1, 36);
  private readonly ring = new THREE.RingGeometry(1, 1.036, 40);
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly failedTextures = new Set<string>();
  private readonly loadedTextures = new Set<string>();
  private readonly loader = new THREE.TextureLoader();
  private readonly bodies: Body[] = [];
  private readonly activeBodies: Body[] = [];
  private readonly seenEvents = new Set<string>();
  private readonly paths: PooledPath[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly backgroundCues: BackgroundCue[] = [];
  private readonly poseHandoffs = new Map<string, PoseHandoff>();
  private mode: WorldFrame["mode"] = "CHOICE";
  private cueTime = 0;
  private cueParticles = 0;
  private readonly fields: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private readonly fieldBeacons: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private readonly background: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly spark: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly trails: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly trailPositions = new Float32Array(WORLD_LIMITS.players * (WORLD_LIMITS.trailsPerPlayer - 1) * 6);
  private readonly trailColors = new Float32Array(WORLD_LIMITS.players * (WORLD_LIMITS.trailsPerPlayer - 1) * 6);
  private data: WorldData;
  private width = W;
  private height = H;
  private last = -1;
  private elapsed = 0;
  private ambientTime = 0;
  private choiceWeight = 1;
  private meetWeight = 0;
  private firstFrame = true;
  private disposed = false;
  private frames = 0;
  private metricAt = 0;
  private metricFrames = 0;
  private quality: WorldQuality = "MEDIUM";
  private slowWindows = 0;
  private fastWindows = 0;
  private reduced = false;
  private pendingPulse: { playerId?: string; field?: string }[] = [];
  private lastIntersection = "";
  private intersectionActive = false;
  private readonly onLost: (event: Event) => void;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLDivElement, private host: HTMLElement, data: WorldData, onFailure: () => void) {
    this.data = data;
    const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
    if (!context) throw new Error("WebGL2 unavailable");
    this.renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    this.renderer.setClearColor("#100d12", 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_LIMITS[this.quality].dpr));
    this.camera.position.z = 900;
    this.background = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BACKGROUND, transparent: true, depthWrite: false, uniforms: { time: { value: 0 }, dim: { value: 1 }, coverage: { value: 0 } } }));
    this.background.position.set(W / 2, H / 2, -100);
    this.background.scale.set(W / 2, H / 2, 1);
    this.background.renderOrder = -20;
    this.scene.add(this.background);
    for (let i = 0; i < 3; i++) {
      const anchor = FIELD_ANCHORS[i];
      const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FIELD, transparent: true, depthWrite: false, uniforms: { tint: { value: new THREE.Color(anchor.tint) }, time: { value: 0 }, phase: { value: i * 1.6 }, strength: { value: 1 }, pulse: { value: 0 }, contourWeight: { value: 1 } } });
      const field = new THREE.Mesh(this.plane, material);
      field.position.set(anchor.x, H - anchor.y, -25);
      field.scale.set(307, 327, 1);
      field.renderOrder = -5;
      this.fields.push(field); this.scene.add(field);
      // Three of the existing forty ambient points supply the sharp cores;
      // these shared-geometry glows add no particles or postprocessing pass.
      const beacon = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: SOFT, transparent: true, depthWrite: false, uniforms: { tint: { value: new THREE.Color(anchor.tint).lerp(new THREE.Color("#f2ddbc"), .38) }, opacity: { value: 0 } } }));
      beacon.scale.setScalar(20); beacon.renderOrder = -1;
      this.fieldBeacons.push(beacon); this.scene.add(beacon);
    }
    this.dust = this.makePoints(WORLD_LIMITS.particles, "#d6b88c", 2.8);
    this.spark = this.makePoints(WORLD_LIMITS.eventParticles, "#edc995", 4.3);
    this.dust.renderOrder = -2; this.spark.renderOrder = 5;
    this.scene.add(this.dust, this.spark);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(this.trailColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.trails = new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .45, depthWrite: false }));
    this.trails.frustumCulled = false; this.trails.renderOrder = -1; this.scene.add(this.trails);
    for (let i = 0; i < WORLD_LIMITS.historyPaths + 2; i++) {
      const coords = new Float32Array(72 * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(coords, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: i % 2 ? "#b57285" : "#c8a273", transparent: true, opacity: 0, depthWrite: false }));
      line.frustumCulled = false; line.renderOrder = -1;
      this.paths.push({ line, coords, kind: i < WORLD_LIMITS.historyPaths ? "history" : "event", meetCoords: new Float32Array(coords.length), choiceCoords: new Float32Array(coords.length), liveCoords: new Float32Array(coords.length), meetTint: line.material.color.clone(), choiceTint: new THREE.Color(i < 6 ? FIELD_ANCHORS[Math.floor(i / 2)].tint : "#b28e64"), liveTint: new THREE.Color(i < 2 ? FIELD_ANCHORS[0].tint : i < 4 ? FIELD_ANCHORS[2].tint : "#d0ad79") });
      this.scene.add(line);
    }
    this.glow = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: SOFT, transparent: true, depthWrite: false, uniforms: { tint: { value: new THREE.Color("#ebc59a") }, opacity: { value: 0 } } }));
    this.glow.position.set(W * .49, H * .47, 12); this.glow.scale.set(85, 85, 1); this.glow.renderOrder = 6; this.scene.add(this.glow);
    for (let i = 0; i < WORLD_LIMITS.pulsePool; i++) {
      const mesh = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: "#cbaa7f", transparent: true, opacity: 0, depthWrite: false }));
      mesh.renderOrder = 4; this.scene.add(mesh); this.pulses.push({ mesh, start: -10, x: 0, y: 0, life: 1.8 });
    }
    for (let i = 0; i < BACKGROUND_CUE_LIMIT; i++) this.backgroundCues.push(this.makeBackgroundCue());
    // All three acts use the persistent DOM portrait layer.
    this.scene.add(this.pairConnection.group);
    this.onLost = (event) => { event.preventDefault(); if (!this.disposed) onFailure(); };
    canvas.addEventListener("webglcontextlost", this.onLost);
    this.host.dataset.renderer = "webgl";
    this.update(data);
    this.resize(this.host.clientWidth || W, this.host.clientHeight || H);
  }
  private makeBackgroundCue(): BackgroundCue {
    const coords = new Float32Array(72 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(coords, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#c8a273", transparent: true, opacity: 0, depthWrite: false }));
    const ring = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: "#c8a273", transparent: true, opacity: 0, depthWrite: false }));
    const glow = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: SOFT, transparent: true, depthWrite: false, uniforms: { tint: { value: new THREE.Color("#c8a273") }, opacity: { value: 0 } } }));
    line.frustumCulled = false;
    line.renderOrder = 0; ring.renderOrder = 0; glow.renderOrder = -3;
    this.scene.add(line, ring, glow);
    return { line, ring, glow, coords, start: -10, duration: 2, x: 0, y: 0, strength: 1, variant: "lift" };
  }
  private makePoints(count: number, color: string, size: number) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("intensity", new THREE.BufferAttribute(new Float32Array(count).fill(.5), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("pointScale", new THREE.BufferAttribute(new Float32Array(count).fill(1), 1).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(geometry, new THREE.ShaderMaterial({ vertexShader: pointVertex, fragmentShader: pointFragment, transparent: true, depthWrite: false, uniforms: { size: { value: size }, tint: { value: new THREE.Color(color) }, opacity: { value: .45 } } }));
    points.frustumCulled = false; return points;
  }
  private makeBody(slot: number): Body {
    const mesh = new THREE.Mesh(this.circle, new THREE.MeshBasicMaterial({ color: "#c2aaa0", transparent: true, opacity: 0, depthWrite: false }));
    const rim = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: "#e9d3b7", transparent: true, opacity: 0, depthWrite: false }));
    const available = new THREE.Mesh(this.ring, new THREE.MeshBasicMaterial({ color: "#d5c49d", transparent: true, opacity: 0, depthWrite: false }));
    const aura = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: SOFT, transparent: true, depthWrite: false, uniforms: { tint: { value: new THREE.Color("#bd9068") }, opacity: { value: 0 } } }));
    mesh.renderOrder = 3; rim.renderOrder = 4; available.renderOrder = 2; aura.renderOrder = 1;
    this.scene.add(mesh, rim, available, aura);
    const name = document.createElement("span");
    name.className = "destiny-player-name";
    name.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;color:#e6d9cc;letter-spacing:.045em;line-height:1.2;will-change:transform;opacity:0;visibility:hidden;text-shadow:0 1px 8px #100a11;font-family:var(--font-sans),sans-serif;";
    name.setAttribute("aria-hidden", "true");
    this.overlay.append(name);
    mesh.visible = false; rim.visible = false; available.visible = false; aura.visible = false;
    return { id: "", data: null, slot, mesh, rim, available, aura, name, opacity: 0, active: false, fieldIndex: 0, x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0, seed: slot, radius: 28, choiceX: 0, choiceY: 0, liveX: 0, liveY: 0, trail: new Float32Array(WORLD_LIMITS.trailsPerPlayer * 2), trailHead: 0, trailTick: 0, pulse: -10 };
  }
  resize(width: number, height: number) {
    if (this.disposed || width < 2 || height < 2) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.dust.material.uniforms.size.value = 2.8 * width / W * this.renderer.getPixelRatio();
    this.spark.material.uniforms.size.value = 4.3 * width / W * this.renderer.getPixelRatio();
    this.pairConnection.resize(width/W*this.renderer.getPixelRatio());
    this.layoutHistory();
  }
  private texture(path: string): THREE.Texture | null {
    if (!/^\/assets\/avatars\/(male|female)\/\1_(0[1-9]|10)\.png$/.test(path) || this.failedTextures.has(path)) return null;
    const existing = this.textures.get(path); if (existing) return this.loadedTextures.has(path) ? existing : null;
    if (this.textures.size >= WORLD_LIMITS.textures) return null;
    const image = getImageProps({ src: path, alt: "", width: 96, height: 96, quality: 75 }).props;
    const texture = this.loader.load(image.src, (loaded) => {
      if (this.disposed) { loaded.dispose(); return; }
      loaded.colorSpace = THREE.SRGBColorSpace;
      this.loadedTextures.add(path);
      for (const body of this.bodies) if (body.data?.avatar === path) { body.mesh.material.color.set("#ffffff"); body.mesh.material.map = loaded; body.mesh.material.needsUpdate = true; }
      // The host coalesces image-ready updates, including reduced motion and
      // hidden tabs, into its single lifecycle-owned render loop.
      this.host.dispatchEvent(new Event("world-invalidate"));
    }, undefined, () => {
      if (this.disposed) return;
      this.failedTextures.add(path);
      for (const body of this.bodies) if (body.data?.avatar === path) { body.mesh.material.map = null; body.mesh.material.color.set("#bba399"); body.mesh.material.needsUpdate = true; }
      this.host.dispatchEvent(new Event("world-invalidate"));
    });
    texture.colorSpace = THREE.SRGBColorSpace; this.textures.set(path, texture); return null;
  }
  update(data: WorldData) {
    if (this.disposed) return;
    const epochChanged = data.epoch !== this.data.epoch;
    this.data = data;
    if (epochChanged) { this.seenEvents.clear(); this.poseHandoffs.clear(); this.clearEffects(); }
    const now = Date.now();
    const canAnimate = document.visibilityState === "visible" && !this.reduced && this.mode === "MEET";
    const priority = new Set(data.events.filter((event) => event.playerId && now - event.timestamp <= 10000).map((event) => event.playerId));
    const previous = new Set(this.bodies.filter((b) => b.active).map((b) => b.id));
    const ordered = [...data.participants].sort((a, b) => {
      const score = (p: WorldPlayer) => (this.poseHandoffs.has(p.id) ? 1000 : 0) + (priority.has(p.id) ? 100 : 0) + (p.isAvailable ? 20 : 0) + (previous.has(p.id) ? 10 : 0);
      return score(b) - score(a) || b.activity - a.activity || a.id.localeCompare(b.id);
    }).slice(0, QUALITY_LIMITS[this.quality].players);
    const ids = new Set(ordered.map((p) => p.id));
    for (const body of this.bodies) if (!ids.has(body.id)) { body.active = false; body.name.removeAttribute("data-world-player"); }
    for (const player of ordered) {
      let body = this.bodies.find((b) => b.id === player.id && b.data);
      const isNew = !body;
      if (!body) body = this.bodies.find((b) => !b.active && b.opacity < .01) ?? this.bodies.find((b) => !b.active);
      if (!body) continue;
      const avatarChanged = player.avatar !== body.data?.avatar;
      body.id = player.id; body.data = player; body.seed = player.seed; body.active = true;
      body.fieldIndex = player.field === null ? -1 : data.question.options.findIndex((o) => o.id === player.field);
      body.name.textContent = Array.from(player.nickname).slice(0, 5).join("");
      if (this.mode === "MEET") body.name.dataset.worldPlayer = "";
      else body.name.removeAttribute("data-world-player");
      body.name.dataset.playerKey = player.id; body.name.dataset.player = player.id; body.name.dataset.avatar = player.avatar;
      body.name.dataset.available = String(player.isAvailable);
      body.name.dataset.playerField = body.fieldIndex < 0 ? "neutral" : data.question.options[body.fieldIndex].id;
      if (avatarChanged) { body.mesh.material.map = this.texture(player.avatar); body.mesh.material.color.set(body.mesh.material.map ? "#ffffff" : "#c2aaa0"); body.mesh.material.needsUpdate = true; }
      if (isNew) {
        const target = freeTarget(player.seed);
        body.liveX = target.x; body.liveY = target.y;
        body.opacity = this.firstFrame ? .84 : 0; body.vx = 0; body.vy = 0; body.pulse = this.elapsed;
      }
    }
    for (let f = -1; f < 3; f++) {
      const members = this.bodies.filter((b) => b.active && b.fieldIndex === f).sort((a, b) => a.id.localeCompare(b.id));
      members.forEach((body, ordinal) => {
        const choice = f < 0 ? neutralTarget(body.seed, ordinal, members.length) : fieldTarget(f, ordinal, members.length, body.seed);
        body.choiceX = choice.x; body.choiceY = choice.y;
        if ((body.opacity <= 0 || this.firstFrame) && !this.poseHandoffs.has(body.id)) {
          body.x = choice.x; body.y = choice.y; body.targetX = choice.x; body.targetY = choice.y;
          constrainBody(body, safeRects(1));
          for (let n = 0; n < WORLD_LIMITS.trailsPerPlayer; n++) { body.trail[n * 2] = body.x; body.trail[n * 2 + 1] = body.y; }
        }
      });
    }
    for (const event of data.events) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);
      if (!canAnimate || now - event.timestamp > 10000) continue;
      if (!["mutual_confirmed", "meeting_confirmed"].includes(event.type)) this.pendingPulse.push({ playerId: event.playerId, field: event.field });
      else if (event.type === "meeting_confirmed") this.pendingPulse.push({});
    }
    if (this.pendingPulse.length > WORLD_LIMITS.pulsePool) this.pendingPulse.splice(0, this.pendingPulse.length - WORLD_LIMITS.pulsePool);
    while (this.seenEvents.size > 256) this.seenEvents.delete(this.seenEvents.values().next().value!);
    this.activeBodies.length = 0;
    for (const body of this.bodies) if (body.active || body.opacity > .01) this.activeBodies.push(body);

  }
  /** Positions use the unscaled 1920 × 1080 stage and avatar centres. */
  getPlayerPoses(): WorldPlayerPose[] {
    return this.activeBodies.filter((body) => body.active && body.opacity > .01).map((body) => ({ id: body.id, x: body.x, y: body.y, radius: body.radius, opacity: body.opacity }));
  }
  /** Reuses the same player pool at the DOM → MEET boundary. Supplied IDs win
   * sampling before extra players gently appear, even at LOW quality. */
  setPlayerPoses(poses: readonly WorldPlayerPose[], handoffMs = 900) {
    if (this.disposed) return;
    this.poseHandoffs.clear();
    for (const pose of poses.slice(0, WORLD_LIMITS.players)) {
      if (!pose.id || !Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.radius)) continue;
      this.poseHandoffs.set(pose.id, { ...pose, radius: clamp(pose.radius, 20, 60), start: this.elapsed, duration: clamp(handoffMs, 0, 2200) / 1000 });
    }
    this.update(this.data);
    for (const body of this.activeBodies) {
      const pose = this.poseHandoffs.get(body.id);
      body.opacity = pose ? clamp(pose.opacity ?? 1, 0, 1) : 0;
      if (pose) { body.x = pose.x; body.y = pose.y; body.radius = pose.radius; body.vx = 0; body.vy = 0; }
      else { body.x = body.liveX; body.y = body.liveY; }
      body.trailHead = 0; body.trailTick = 0;
      for (let i = 0; i < WORLD_LIMITS.trailsPerPlayer; i++) { body.trail[i * 2] = body.x; body.trail[i * 2 + 1] = body.y; }
    }
  }
  /** A bounded decorative cue. Counts remain snapshot-owned; this never adds a
   * person, changes statistics, or connects identifiable player coordinates. */
  eventBackgroundPulse(target: number | "male" | "female", variant: BackgroundPulseVariant, count = 1) {
    if (this.disposed || this.reduced || this.mode === "MEET" || document.visibilityState !== "visible") return;
    const field = typeof target === "number" ? Math.floor(clamp(target, 0, 2)) : target === "male" ? 0 : 2;
    if (!Number.isFinite(field)) return;
    const cue = this.backgroundCues.reduce((oldest, next) => oldest.start < next.start ? oldest : next);
    cue.start = this.cueTime; cue.duration = 1.8 + field * .18; cue.variant = variant;
    cue.x = typeof target === "number" ? ACT_FIELD_X[field] : target === "male" ? 500 : 1420;
    cue.y = typeof target === "number" ? 570 : 620;
    cue.strength = 1 + Math.min(4, Math.max(0, (Number.isFinite(count) ? count : 1) - 1)) * .035;
    const tint = FIELD_ANCHORS[field].tint;
    cue.line.material.color.set(tint); cue.ring.material.color.set(tint); cue.glow.material.uniforms.tint.value.set(tint);
    this.host.dispatchEvent(new Event("world-invalidate"));
  }
  private layoutHistory() {
    for (let n = 0; n < WORLD_LIMITS.historyPaths; n++) {
      const path = this.paths[n];
      for (let i = 0; i < 72; i++) {
        const t = i / 71;
        const x = -70 + t * (W + 140);
        // Four spanning paths give the world depth; the remaining paths settle
        // near the lower horizon. Neither set represents an identifiable pair.
        let y = n < 4
          ? 832 - Math.sin(t * Math.PI + (n - 1.5) * .29) * (235 + n * 23) + Math.sin(t * Math.PI * 2 + n * 1.4) * 95
          : 820 + Math.sin(t * Math.PI * (1 + (n % 3) * .19) + n * .43) * (65 + n * 5) + (n - 8) * 10;
        const avoidQr = clamp((x - 1320) / 230, 0, 1);
        y += (Math.min(y, 648) - y) * avoidQr * avoidQr * (3 - 2 * avoidQr);
        path.meetCoords[i * 3] = x; path.meetCoords[i * 3 + 1] = H - y; path.meetCoords[i * 3 + 2] = -15 - n;
        let choiceX: number, choiceY: number;
        if (n < 6) {
          const angle = (.12 + t * 1.76) * Math.PI + (n % 2) * .08;
          choiceX = ACT_FIELD_X[Math.floor(n / 2)] + Math.cos(angle) * (248 + (n % 2) * 15);
          choiceY = 548 + Math.sin(angle) * (304 + (n % 2) * 13);
        } else {
          choiceX = 35 + t * 1510;
          choiceY = 933 + Math.sin(t * Math.PI + n * .47) * (28 + n * 3);
        }
        let liveX = choiceX, liveY = choiceY;
        if (n < 4) {
          const angle = (.14 + t * 1.76) * Math.PI + (n % 2) * .07;
          liveX = (n < 2 ? 500 : 1420) + Math.cos(angle) * (142 + (n % 2) * 9);
          liveY = 620 + Math.sin(angle) * (330 + (n % 2) * 9);
        } else if (n < 8) {
          // Anonymous S-curves begin in the empty field margins, not at a
          // person's centre. The opposing curvatures cross below the story.
          const reverse = n % 2 === 1, support = n >= 6 ? 19 : 0, u = 1 - t;
          liveX = u*u*u*640 + 3*u*u*t*795 + 3*u*t*t*1035 + t*t*t*1280;
          liveY = reverse
            ? u*u*u*(745-support) + 3*u*u*t*(422+support) + 3*u*t*t*(898-support) + t*t*t*(528+support)
            : u*u*u*(510+support) + 3*u*u*t*(916-support) + 3*u*t*t*(429+support) + t*t*t*(762-support);
        }
        path.choiceCoords[i * 3] = choiceX; path.choiceCoords[i * 3 + 1] = H - choiceY; path.choiceCoords[i * 3 + 2] = -15 - n;
        path.liveCoords[i * 3] = liveX; path.liveCoords[i * 3 + 1] = H - liveY; path.liveCoords[i * 3 + 2] = -15 - n;
      }
      path.coords.set(path.meetCoords);
      path.line.geometry.getAttribute("position").needsUpdate = true;
    }
  }
  setQuality(quality: WorldQuality) {
    if (this.disposed || this.quality === quality) return;
    this.quality = quality; this.slowWindows = 0; this.fastWindows = 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_LIMITS[quality].dpr));
    this.resize(this.width, this.height); this.update(this.data);
  }
  clearEffects() {
    this.pendingPulse = [];
    this.cueParticles = 0;
    for (const cue of this.backgroundCues) { cue.start = -10; cue.line.material.opacity = 0; cue.ring.material.opacity = 0; cue.glow.material.uniforms.opacity.value = 0; }
    this.lastIntersection = ""; this.intersectionActive = false;
    for (const pulse of this.pulses) { pulse.start = -10; pulse.mesh.material.opacity = 0; }
    for (const path of this.paths) if (path.kind === "event") path.line.material.opacity = 0;
    this.glow.material.uniforms.opacity.value = 0;
    const intensities = this.spark.geometry.getAttribute("intensity") as THREE.BufferAttribute;
    for (let i = 0; i < WORLD_LIMITS.eventParticles; i++) intensities.setX(i, 0);
    intensities.needsUpdate = true;
  }
  resetTime() {
    this.last = -1; this.metricAt = 0; this.metricFrames = 0;
    if (document.visibilityState !== "visible") this.clearEffects();
  }
  draw(time: number, frame: WorldFrame, reduced: boolean) {
    if (this.disposed) return;
    this.reduced = reduced;
    const enteringMeet = this.mode !== "MEET" && frame.mode === "MEET";
    const leavingMeet = this.mode === "MEET" && frame.mode !== "MEET";
    this.mode = frame.mode;
    this.host.dataset.rendererPlayers="0";
    if (leavingMeet) this.poseHandoffs.clear();
    if (frame.mode !== "MEET") this.pendingPulse = [];
    if (reduced) this.clearEffects();
    const dt = this.last < 0 ? 1 / 60 : clamp((time - this.last) / 1000, 0, .04);
    this.last = time;
    if (!reduced) this.elapsed += dt;
    if (!reduced && !frame.intersection) this.cueTime += dt;
    const seconds = this.elapsed;
    const transition = this.firstFrame || reduced ? 1 : 1 - Math.exp(-dt * 1.05);
    this.choiceWeight += ((frame.mode === "CHOICE" ? 1 : 0) - this.choiceWeight) * transition;
    this.meetWeight += ((frame.mode === "MEET" ? 1 : 0) - this.meetWeight) * transition;
    const eventSeconds = frame.intersection ? frame.intersection.elapsedMs / 1000 : -1;
    const eventWeight = eventSeconds < 0 || reduced ? 0 : Math.min(1, eventSeconds) * (1 - clamp((eventSeconds - 4.5) / 1.5, 0, 1));
    if (!reduced) this.ambientTime += dt * (1 - .8 * eventWeight);
    const worldDim = 1 - .20 * this.meetWeight - .17 * eventWeight;
    this.background.material.uniforms.time.value = seconds;
    this.background.material.uniforms.dim.value = worldDim;
    // The CSS autumn atmosphere plate remains visible in the DOM acts. The
    // original opaque background returns continuously when entering MEET.
    this.background.material.uniforms.coverage.value = this.meetWeight * .16 + eventWeight * .2;
    for (let i = 0; i < 3; i++) {
      const field = this.fields[i];
      field.material.uniforms.time.value = reduced ? 0 : seconds;
      const liveWeight = Math.max(0, 1 - this.choiceWeight - this.meetWeight);
      field.material.uniforms.strength.value = (this.choiceWeight * .9 + liveWeight * (i === 1 ? .08 : .74)) * (1 - .45 * eventWeight);
      field.material.uniforms.contourWeight.value = this.choiceWeight * .96 + liveWeight * (i === 1 ? 0 : .84);
      field.position.set(ACT_FIELD_X[i] * this.choiceWeight + ACT_LIVE_X[i] * (1 - this.choiceWeight), H - (548 + 72 * liveWeight), -25);
      field.scale.set(328 * this.choiceWeight + (i === 1 ? 400 : 195) * (1 - this.choiceWeight), 400 + 50 * liveWeight, 1);
    }
    for (const pending of this.pendingPulse.splice(0)) {
      const body = this.bodies.find((b) => b.active && b.id === pending.playerId);
      const index = this.data.question.options.findIndex((o) => o.id === pending.field);
      const anchor = FIELD_ANCHORS[Math.max(0, index) % 3];
      const pulse = this.pulses.reduce((a, b) => a.start < b.start ? a : b);
      pulse.start = seconds; pulse.x = body?.x ?? (pending.field ? anchor.x : W * .5); pulse.y = body?.y ?? (pending.field ? anchor.y : H * .76);
      if (body) body.pulse = seconds;
    }
    const showPlayers = false;
    this.trails.visible = showPlayers;
    if (!showPlayers) for (const body of this.bodies) {
      if (body.name.hidden && !body.mesh.visible) continue;
      body.mesh.visible = false; body.rim.visible = false; body.available.visible = false; body.aura.visible = false;
      body.name.style.visibility = "hidden"; body.name.style.opacity = "0";
      body.name.hidden = true; body.name.removeAttribute("data-world-player"); body.name.dataset.visible = "false"; body.name.setAttribute("aria-hidden", "true");
    }
    if (showPlayers) for (const body of this.activeBodies) {
      body.targetX = body.liveX + (body.choiceX - body.liveX) * this.choiceWeight + flowNoise(body.seed, seconds, 3) * 13;
      body.targetY = body.liveY + (body.choiceY - body.liveY) * this.choiceWeight + flowNoise(body.seed, seconds, 4) * 11;
      if ((this.firstFrame || enteringMeet) && !this.poseHandoffs.has(body.id)) {
        body.x = body.targetX; body.y = body.targetY;
        constrainBody(body, safeRects(this.choiceWeight));
        for (let n = 0; n < WORLD_LIMITS.trailsPerPlayer; n++) { body.trail[n * 2] = body.x; body.trail[n * 2 + 1] = body.y; }
      }
    }
    if (showPlayers) {
      if (reduced) settleBodies(this.activeBodies, 0);
      else if (!enteringMeet) stepBodies(this.activeBodies, seconds, dt * (1 - .6 * eventWeight), 0);
    }
    const scaleX = this.width / W, scaleY = this.height / H;
    let trailOffset = 0;
    if (showPlayers) for (const body of this.activeBodies) {
      const targetOpacity = body.active ? 1 : 0;
      body.opacity += (targetOpacity - body.opacity) * (reduced ? 1 : 1 - Math.exp(-dt * 1.6));
      const weight = body.opacity * (1 - .48 * eventWeight) * (1 - .10 * this.meetWeight);
      const handoff = this.poseHandoffs.get(body.id);
      const handoffProgress = reduced || !handoff || handoff.duration === 0 ? 1 : clamp((seconds - handoff.start) / handoff.duration, 0, 1);
      const easedHandoff = handoffProgress * handoffProgress * (3 - 2 * handoffProgress);
      const naturalRadius = 25.5 + seedUnit(body.seed, 9) * 5.5;
      const radius = handoff ? handoff.radius + (naturalRadius - handoff.radius) * easedHandoff : naturalRadius;
      body.radius = radius;
      const z = 4 + seedUnit(body.seed, 11) * 3;
      body.mesh.visible = weight > .01; body.rim.visible = weight > .01; body.aura.visible = weight > .01;
      body.available.visible = weight > .01 && Boolean(body.data?.isAvailable);
      body.mesh.position.set(body.x, H - body.y, z);
      body.mesh.scale.setScalar(radius);
      body.mesh.material.opacity = weight;
      body.rim.position.set(body.x, H - body.y, z + .1);
      body.rim.scale.setScalar(radius + 2.1);
      body.rim.material.opacity = weight * .72;
      const breathe = reduced ? .2 : (.5 + .5 * Math.sin(seconds * (Math.PI * 2 / (2.4 + seedUnit(body.seed, 14) * .8)) + body.seed * .74));
      body.available.position.set(body.x, H - body.y, z - .1);
      body.available.scale.setScalar(radius + 8 + breathe * 6);
      body.available.material.opacity = body.data?.isAvailable ? weight * (.16 + breathe * .22) : 0;
      body.aura.position.set(body.x, H - body.y, z - .2);
      body.aura.scale.setScalar(radius * 2.05);
      body.aura.material.uniforms.opacity.value = weight * (.12 + (body.data?.isAvailable ? breathe * .09 : 0));
      body.aura.material.uniforms.tint.value.set(body.fieldIndex < 0 ? NEUTRAL_TINT : FIELD_ANCHORS[body.fieldIndex].tint);
      if (body.active && weight > .015) body.name.dataset.worldPlayer = "";
      else body.name.removeAttribute("data-world-player");
      body.name.hidden = weight <= .015;
      body.name.dataset.visible = String(weight > .015 && body.active);
      body.name.setAttribute("aria-hidden", String(weight <= .015 || !body.active));
      body.name.style.fontSize = `${17.5 * scaleX}px`;
      body.name.style.transform = `translate3d(${body.x * scaleX}px,${(body.y + radius + 9) * scaleY}px,0) translateX(-50%)`;
      body.name.style.opacity = String(weight * .85);
      body.name.style.visibility = weight > .015 ? "visible" : "hidden";
      body.name.dataset.x = String(Math.round(body.x)); body.name.dataset.y = String(Math.round(body.y));
      if (!reduced) body.trailTick += dt;
      if (body.trailTick > .10) {
        body.trailTick = 0; body.trailHead = (body.trailHead + 1) % WORLD_LIMITS.trailsPerPlayer;
        body.trail[body.trailHead * 2] = body.x; body.trail[body.trailHead * 2 + 1] = body.y;
      }
      const color = body.fieldIndex < 0 ? NEUTRAL_TINT : FIELD_ANCHORS[body.fieldIndex].tint;
      const tint = body.rim.material.color;
      tint.set(color);
      for (let j = 0; j < WORLD_LIMITS.trailsPerPlayer - 1; j++) {
        const a = (body.trailHead + 1 + j) % WORLD_LIMITS.trailsPerPlayer;
        const b = (a + 1) % WORLD_LIMITS.trailsPerPlayer;
        const alpha = j / WORLD_LIMITS.trailsPerPlayer * weight * (reduced ? 0 : .5 + .5 * this.meetWeight);
        this.trailPositions[trailOffset] = body.trail[a * 2]; this.trailPositions[trailOffset + 1] = H - body.trail[a * 2 + 1]; this.trailPositions[trailOffset + 2] = 0;
        this.trailPositions[trailOffset + 3] = body.trail[b * 2]; this.trailPositions[trailOffset + 4] = H - body.trail[b * 2 + 1]; this.trailPositions[trailOffset + 5] = 0;
        for (let vertex = 0; vertex < 2; vertex++) { this.trailColors[trailOffset + vertex * 3] = tint.r * alpha; this.trailColors[trailOffset + vertex * 3 + 1] = tint.g * alpha; this.trailColors[trailOffset + vertex * 3 + 2] = tint.b * alpha; }
        trailOffset += 6;
      }
    }
    if (showPlayers) {
      this.trails.geometry.setDrawRange(0, trailOffset / 3);
      this.trails.geometry.getAttribute("position").needsUpdate = true; this.trails.geometry.getAttribute("color").needsUpdate = true;
    }
    this.drawEnvironment(this.ambientTime, worldDim, reduced);
    this.drawIntersection(frame, reduced);
    this.drawBackgroundCues(frame, reduced);
    for (const pulse of this.pulses) {
      const t = clamp((seconds - pulse.start) / pulse.life, 0, 1);
      pulse.mesh.position.set(pulse.x, H - pulse.y, 15);
      pulse.mesh.scale.setScalar(28 + t * 67);
      pulse.mesh.material.opacity = reduced ? 0 : Math.sin(t * Math.PI) * .15;
    }
    this.pairConnection.draw(this.pairFrame,reduced,!!frame.intersection,this.quality);
    this.renderer.render(this.scene, this.camera);
    this.firstFrame = false; this.frames++; this.metricFrames++;
    this.updateMetrics(time, reduced);
  }
  private drawEnvironment(seconds: number, dim: number, reduced: boolean) {
    const position = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
    const intensities = this.dust.geometry.getAttribute("intensity") as THREE.BufferAttribute;
    const pointScale = this.dust.geometry.getAttribute("pointScale") as THREE.BufferAttribute;
    const count = reduced ? 10 : QUALITY_LIMITS[this.quality].particles;
    const liveWeight = Math.max(0, 1 - this.choiceWeight - this.meetWeight);
    const cueActive = this.backgroundCues.some((cue) => this.cueTime >= cue.start && this.cueTime - cue.start < cue.duration);
    for (let n = 0; n < WORLD_LIMITS.historyPaths; n++) {
      const path = this.paths[n];
      for (let i = 0; i < path.coords.length; i++) path.coords[i] = path.choiceCoords[i] * this.choiceWeight + path.liveCoords[i] * liveWeight + path.meetCoords[i] * this.meetWeight;
      path.line.geometry.getAttribute("position").needsUpdate = true;
      path.line.material.color.lerpColors(path.choiceTint, path.liveTint, liveWeight / Math.max(.0001, 1 - this.meetWeight)).lerp(path.meetTint, this.meetWeight);
    }
    for (let i = 0; i < WORLD_LIMITS.particles; i++) {
      const seed = i * 7.71;
      let x = ((seedUnit(seed, 2) * W + seconds * (1.1 + seedUnit(seed, 6))) % (W + 160)) - 80;
      let y = 235 + seedUnit(seed, 3) * 720 + flowNoise(seed, seconds * .3) * 16;
      if (i < 8) {
        const n = i % 4;
        const phase = (seedUnit(seed, 3) + seconds * .0018) % 1;
        const index = Math.min(70, Math.floor(phase * 71)), blend = phase * 71 - index;
        const coords = this.paths[n].coords;
        x = coords[index * 3] + (coords[(index + 1) * 3] - coords[index * 3]) * blend;
        y = H - (coords[index * 3 + 1] + (coords[(index + 1) * 3 + 1] - coords[index * 3 + 1]) * blend);
      }
      const actWeight = 1 - this.meetWeight;
      if (i < 3) {
        const field = this.fields[i], phase = field.material.uniforms.phase.value;
        const angle = phase - 1.24 + (reduced ? 0 : seconds * .033);
        const radius = .76 + .024 * Math.sin(angle * 3 + phase) + .010 * Math.sin(angle * 7 - phase) + .004 * Math.sin(this.elapsed * .4 + phase);
        let beaconX = field.position.x + Math.cos(angle) * radius * field.scale.x;
        let beaconY = H - field.position.y - Math.sin(angle) * radius * field.scale.y;
        if (i === 1 && liveWeight > 0) {
          const phaseOnPath = (seedUnit(113, 2) + seconds * .004) % 1;
          const index = Math.min(70, Math.floor(phaseOnPath * 71)), blend = phaseOnPath * 71 - index;
          const coords = this.paths[4].liveCoords;
          const liveX = coords[index * 3] + (coords[(index + 1) * 3] - coords[index * 3]) * blend;
          const liveY = H - (coords[index * 3 + 1] + (coords[(index + 1) * 3 + 1] - coords[index * 3 + 1]) * blend);
          beaconX += (liveX - beaconX) * liveWeight; beaconY += (liveY - beaconY) * liveWeight;
        }
        x += (beaconX - x) * actWeight; y += (beaconY - y) * actWeight;
        const beacon = this.fieldBeacons[i];
        beacon.position.set(x, H - y, -8);
        beacon.material.uniforms.opacity.value = reduced || (x > 1550 && y > 655) ? 0 : actWeight * .62 * dim * (cueActive ? .58 : 1);
      }
      const excluded = x > 1550 && y > 655;
      const beaconStrength = i < 3 && !reduced ? actWeight : 0;
      pointScale.setX(i, 1 + beaconStrength * 1.8);
      position.setXYZ(i, x, H - y, -10 - seedUnit(seed, 5) * 30);
      intensities.setX(i, i < count && !excluded ? (.22 + .34 * (.5 + .5 * Math.sin(seconds * .33 + seed)) + beaconStrength * 1.7) * dim * (cueActive ? .58 : 1) : 0);
    }
    position.needsUpdate = true; intensities.needsUpdate = true; pointScale.needsUpdate = true;
    this.dust.geometry.setDrawRange(0, count);
    const historicalDensity = Math.min(WORLD_LIMITS.historyPaths, Math.ceil(this.data.totalMeetings / 3));
    for (let i = 0; i < WORLD_LIMITS.historyPaths; i++) {
      const oldOpacity = (i < historicalDensity ? .15 : 0) + (i < 4 ? .105 : .058);
      const choiceOpacity = i < 6 ? (i % 2 ? .095 : .19) : .032;
      const liveOpacity = i < 4 ? (i % 2 ? .105 : .22) : i < 6 ? .44 : i < 8 ? .10 : .035;
      const actOpacity = choiceOpacity * this.choiceWeight + liveOpacity * liveWeight;
      this.paths[i].line.material.opacity = (oldOpacity * this.meetWeight * .23 + actOpacity) * (cueActive ? .78 : 1);
    }
  }
  private drawBackgroundCues(frame: WorldFrame, reduced: boolean) {
    this.cueParticles = 0;
    const paused = Boolean(frame.intersection) || reduced || frame.mode === "MEET";
    const positions = this.spark.geometry.getAttribute("position") as THREE.BufferAttribute;
    const intensities = this.spark.geometry.getAttribute("intensity") as THREE.BufferAttribute;
    this.backgroundCues.forEach((cue, slot) => {
      const age = (this.cueTime - cue.start) / cue.duration;
      const active = !paused && age >= 0 && age < 1;
      const t = clamp(age, 0, 1), envelope = active ? Math.sin(t * Math.PI) * cue.strength : 0;
      cue.line.material.opacity = 0; cue.ring.material.opacity = 0; cue.glow.material.uniforms.opacity.value = 0;
      if (!active) return;
      if (cue.variant === "line") {
        const reach = Math.min(1, t * 1.55);
        for (let i = 0; i < 72; i++) {
          const u = i / 71 * reach;
          const x = cue.x - 165 + u * 310;
          const y = cue.y + 130 - u * 165 + Math.sin(u * Math.PI) * 33;
          cue.coords[i * 3] = x; cue.coords[i * 3 + 1] = H - y; cue.coords[i * 3 + 2] = -2;
        }
        cue.line.geometry.getAttribute("position").needsUpdate = true;
        cue.line.material.opacity = .32 * envelope;
      } else if (cue.variant === "ripple") {
        cue.ring.position.set(cue.x, H - cue.y, -3);
        cue.ring.scale.setScalar(24 + t * 116);
        cue.ring.material.opacity = .18 * envelope;
      } else if (cue.variant === "gather") {
        for (let i = 0; i < 6; i++) {
          const index = slot * 6 + i, angle = seedUnit(index + 19, 5) * Math.PI * 2;
          const radius = (1 - t) * (70 + seedUnit(index + 19, 8) * 62) + 9;
          positions.setXYZ(index, cue.x + Math.cos(angle) * radius, H - cue.y + Math.sin(angle) * radius * .78, -2);
          intensities.setX(index, envelope * .68);
        }
        this.cueParticles += 6;
      } else {
        const sweep = cue.variant === "sweep";
        cue.glow.position.set(cue.x + (sweep ? (t - .5) * 250 : 0), H - cue.y, -6);
        cue.glow.scale.set(sweep ? 95 : 245, sweep ? 220 : 290, 1);
        cue.glow.material.uniforms.opacity.value = envelope * (sweep ? .20 : .15);
      }
    });
    positions.needsUpdate = true; intensities.needsUpdate = true;
  }
  private drawIntersection(frame: WorldFrame, reduced: boolean) {
    const intersection = frame.intersection;
    const t = intersection ? intersection.elapsedMs / 1000 : -1;
    const active = t >= 1 && t < 6 && !reduced;
    this.intersectionActive = active;
    const progress = clamp((t - 1) / 2.7, 0, 1);
    const fade = 1 - clamp((t - 4.1) / 1.9, 0, 1);
    const centerX = W * .49, centerY = H * .53;
    if (intersection && intersection.id !== this.lastIntersection) this.lastIntersection = intersection.id;
    for (let side = 0; side < 2; side++) {
      const path = this.paths[WORLD_LIMITS.historyPaths + side];
      for (let i = 0; i < 72; i++) {
        const u = i / 71 * progress;
        // Both paths cross at u=.56, while their different curvatures and
        // continuation remain abstract, unrelated to the player positions.
        const x = centerX + (u - .56) * (side ? -1440 : 1440);
        const y = centerY + Math.sin((u - .56) * Math.PI) * (side ? 220 : -170) + Math.pow(u - .56, 2) * (side ? -150 : 180);
        path.coords[i * 3] = x; path.coords[i * 3 + 1] = H - y; path.coords[i * 3 + 2] = 18;
      }
      path.line.geometry.getAttribute("position").needsUpdate = true;
      path.line.material.opacity = active ? .76 * fade : 0;
    }
    const flash = active ? Math.exp(-Math.pow((t - 2.55) / .36, 2)) : 0;
    this.glow.material.uniforms.opacity.value = flash * .54;
    const sparklePosition = this.spark.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sparkleAlpha = this.spark.geometry.getAttribute("intensity") as THREE.BufferAttribute;
    const age = t - 2.5;
    for (let i = 0; i < WORLD_LIMITS.eventParticles; i++) {
      const angle = seedUnit(i + 101, 2) * Math.PI * 2;
      const length = Math.max(0, age) * (19 + seedUnit(i, 6) * 45);
      sparklePosition.setXYZ(i, centerX + Math.cos(angle) * length, H - centerY + Math.sin(angle) * length * .64, 20);
      sparkleAlpha.setX(i, active && age > 0 ? Math.exp(-age * 2.8) * (.4 + seedUnit(i, 3) * .6) : 0);
    }
    sparklePosition.needsUpdate = true; sparkleAlpha.needsUpdate = true;
    if (intersection && t >= 2.5 && t <= 3.5 && !reduced) {
      const pulse = this.pulses[0]; pulse.x = centerX; pulse.y = centerY; pulse.start = this.elapsed - (t - 2.5); pulse.life = 1.5;
    }
  }
  private updateMetrics(time: number, reduced: boolean) {
    if (!this.metricAt) this.metricAt = time;
    if (time - this.metricAt < 1000 && this.frames > 1) return;
    const duration = Math.max(1, time - this.metricAt);
    const fps = Math.min(240, this.metricFrames * 1000 / duration);
    this.host.dataset.rendererPlayers = "0";
    this.host.dataset.pairParticles = String(this.pairConnection.visibleParticles);
    this.host.dataset.frames = String(this.frames);
    this.host.dataset.fps = fps.toFixed(1);
    this.host.dataset.quality = this.quality;
    this.host.dataset.paths = String(this.paths.length + this.backgroundCues.length);
    this.host.dataset.particles = String((reduced ? 10 : QUALITY_LIMITS[this.quality].particles) + (this.intersectionActive ? WORLD_LIMITS.eventParticles : this.cueParticles) + this.pairConnection.visibleParticles);
    this.host.dataset.resources = JSON.stringify({ geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, programs: this.renderer.info.programs?.length ?? 0, calls: this.renderer.info.render.calls });
    if (!reduced && duration < 2500 && this.frames > 120) {
      this.slowWindows = fps < 44 ? this.slowWindows + 1 : Math.max(0, this.slowWindows - 1);
      this.fastWindows = fps > 57 ? this.fastWindows + 1 : 0;
      let next = this.quality;
      if (this.slowWindows >= 5) next = this.quality === "HIGH" ? "MEDIUM" : "LOW";
      if (this.fastWindows >= 14 && this.quality === "MEDIUM" && this.data.participants.length > 45) next = "HIGH";
      if (next !== this.quality) {
        this.quality = next; this.slowWindows = 0; this.fastWindows = 0;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_LIMITS[next].dpr));
        this.resize(this.width, this.height); this.update(this.data);
      }
    }
    this.metricAt = time; this.metricFrames = 0;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.bodies.forEach((body) => body.name.remove());
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose()); this.textures.clear();
    this.scene.clear(); this.renderer.dispose();
    this.activeBodies.length = 0; this.pendingPulse = []; this.seenEvents.clear(); this.poseHandoffs.clear(); this.backgroundCues.length = 0;
  }
}
