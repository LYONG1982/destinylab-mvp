import { uniqueQualifiedPairs } from "./pair-adapter";
import { PAIR_TIMING } from "./pair-config";
import { StableQueueController } from "./stable-queue";
import type { PlayerPlacement } from "./player-layout";
import type {
  WorldData,
  WorldEvent,
  WorldFrame,
  WorldMode,
  WorldPlayer,
  PairSceneFrame,
} from "./types";
import type { WorldPlayerPose, WorldRenderer } from "./WorldRenderer";

type VisualPose = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  avatarOffset: number;
  nameX: number;
  nameWidth: number;
  nameSize: number;
  nameY: number;
  nameOpacity: number;
};
type PlayerNode = {
  el: HTMLDivElement;
  avatar: HTMLDivElement;
  img: HTMLImageElement;
  name: HTMLSpanElement;
  pose: VisualPose;
  seenAt: number;
  enteredAt: number;
  painted: string;
};
type Cue = {
  key: string;
  target: number | "male" | "female";
  count: number;
  playerIds: Set<string>;
  started: number;
  received: number;
  el: HTMLDivElement;
  fired: boolean;
};
const ease = (n: number) => {
  const t = Math.min(1, Math.max(0, n));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const unit = (n: number) => `${n / 19.2}cqw`;
const variants = ["line", "ripple", "gather", "sweep", "lift"] as const;

/** Persistent DOM portraits, driven by the World's sole scheduler; no React frame updates. */
export class PlayerLayer {
  private readonly queue = new StableQueueController();
  private readonly nodes = new Map<string, PlayerNode>();
  private readonly cues = new Map<string, Cue>();
  private readonly seen = new Set<string>();
  private readonly highlights = new Map<string, number>();
  private readonly first = new Map<string, VisualPose>();
  private outgoingCandidates: string[] = [];
  private outgoingPrepared = false;
  private data: WorldData;
  private mode: WorldMode;
  private time = 0;
  private transitionAt = -Infinity;
  private storyAt = 0;
  private availableAt = 0;
  private pairLayoutCount = 0;
  private readonly story: HTMLElement | null;
  private readonly availableCopy: HTMLElement | null;

  constructor(
    private container: HTMLElement,
    private effects: HTMLElement,
    private host: HTMLElement,
    data: WorldData,
    mode: WorldMode,
  ) {
    this.data = data;
    this.mode = mode;
    this.story = host.querySelector("[data-story-copy]");
    this.availableCopy = host.querySelector("[data-available-copy]");
    this.queue.update(
      data.participants,
      data.question.options.map((o) => o.id),
    );
  }

  update(data: WorldData, acceptEvents = true) {
    const previousAvailable = this.data.availableParticipants;
    this.data = data;
    this.queue.update(
      data.participants,
      data.question.options.map((o) => o.id),
    );
    const pairs =
      data.meetScene?.permissionVerified === false
        ? []
        : uniqueQualifiedPairs(data.meetScene?.qualifiedPairs ?? []);
    const players = new Map(
      [...pairs.flatMap((p) => [p.male, p.female]), ...data.participants].map(
        (p) => [p.id, p],
      ),
    );
    const pairIds = new Set(pairs.map((p) => p.id));
    for (const [id, node] of this.nodes)
      if (node.el.dataset.pairId && !pairIds.has(node.el.dataset.pairId)) {
        node.el.hidden = true;
        node.el.dataset.visible = "false";
        node.el.dataset.pairId = "";
        node.el.dataset.pairMember = "false";
        this.first.delete(id);
        this.outgoingCandidates = this.outgoingCandidates.filter(
          (candidate) => candidate !== id,
        );
      }
    for (const [id, node] of this.nodes) {
      const player = players.get(id);
      if (!player) {
        node.el.remove();
        this.nodes.delete(id);
        this.highlights.delete(id);
      } else this.updateNode(node, player);
    }
    if (!previousAvailable && data.availableParticipants)
      this.availableAt = this.time;
    if (acceptEvents) this.receive(data.events);
  }

  private receive(events: readonly WorldEvent[]) {
    const grouped = new Map<
      string,
      { target: Cue["target"]; count: number; ids: Set<string> }
    >();
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (Date.now() - event.timestamp > 10000 || this.mode === "MEET")
        continue;
      const player = this.data.participants.find(
        (p) => p.id === event.playerId,
      );
      const field = this.data.question.options.findIndex(
        (o) => o.id === (event.field || player?.field),
      );
      const gender = event.gender || player?.gender;
      let count = 0;
      let relevant = false;
      if (this.mode === "CHOICE") {
        count =
          event.type === "choice_selected"
            ? Math.max(0, event.countDelta ?? 1)
            : 0;
        relevant =
          field >= 0 &&
          (count > 0 ||
            event.type === "join" ||
            event.type === "field_changed");
      } else {
        count =
          event.type === "presence_changed" && event.presentDelta === 1 ? 1 : 0;
        relevant = !!gender && (count > 0 || event.type === "join");
      }
      if (!relevant) continue;
      const target = this.mode === "CHOICE" ? field : gender!;
      const key = `${this.mode}:${target}`;
      const group = grouped.get(key) || {
        target,
        count: 0,
        ids: new Set<string>(),
      };
      group.count += count;
      if (
        player &&
        (event.type === "join" ||
          event.type === "field_changed" ||
          event.type === "choice_selected")
      ) {
        group.ids.add(player.id);
        this.highlights.set(player.id, this.time);
      }
      grouped.set(key, group);
    }
    while (this.seen.size > 512)
      this.seen.delete(this.seen.values().next().value!);
    for (const [key, group] of grouped) {
      let cue = this.cues.get(key);
      if (cue && this.time - cue.received < 5000) {
        cue.count += group.count;
        group.ids.forEach((id) => cue!.playerIds.add(id));
        cue.received = this.time;
        // Extend a burst once, with a strict five-second visual lifetime.
        cue.el.textContent = cue.count ? `+${cue.count}` : "";
      } else {
        cue?.el.remove();
        const el = document.createElement("div");
        el.className = "destiny-newcomer-count";
        el.dataset.eventTarget = key;
        el.setAttribute("aria-hidden", "true");
        el.textContent = group.count ? `+${group.count}` : "";
        const x =
          typeof group.target === "number"
            ? [328, 832, 1336][group.target] + 100
            : group.target === "male"
              ? 605
              : 1515;
        const y = typeof group.target === "number" ? 928 : 242;
        el.style.left = unit(x);
        el.style.top = unit(y);
        this.effects.append(el);
        cue = {
          key,
          target: group.target,
          count: group.count,
          playerIds: group.ids,
          started: this.time,
          received: this.time,
          el,
          fired: false,
        };
        this.cues.set(key, cue);
      }
    }
  }

  private updateNode(node: PlayerNode, player: WorldPlayer) {
    if (node.img.getAttribute("src") !== player.avatar) {
      node.img.dataset.failed = "false";
      node.img.src = player.avatar;
    }
    if (node.name.textContent !== player.nickname)
      node.name.textContent = player.nickname;
    const failed =
      this.data.source === "mock" &&
      this.data.meetScene?.failedAvatarIds?.includes(player.id);
    node.avatar.dataset.failed = String(
      !!failed || node.img.dataset.failed === "true",
    );
    node.img.hidden = !!failed || node.img.dataset.failed === "true";
    node.img.alt = `${player.nickname}的虚拟头像`;
    node.el.dataset.avatar = player.avatar;
    node.el.dataset.playerField = player.field || "neutral";
    node.el.dataset.playerGender = player.gender;
    node.el.dataset.available = String(player.isAvailable);
    node.el.style.setProperty("--breath-delay", `${-(player.seed % 3200)}ms`);
    node.el.style.setProperty(
      "--breath-duration",
      `${2800 + (player.seed % 800)}ms`,
    );
  }

  private make(player: WorldPlayer, placement: PlayerPlacement) {
    const el = document.createElement("div");
    el.className = "destiny-player";
    el.dataset.worldPlayer = "";
    el.dataset.playerKey = player.id;
    const avatar = document.createElement("div");
    avatar.className = "destiny-player-avatar";
    const img = document.createElement("img");
    img.width = 108;
    img.height = 108;
    img.decoding = "async";
    img.draggable = false;
    img.onerror = () => {
      img.dataset.failed = "true";
      img.hidden = true;
      avatar.dataset.failed = "true";
    };
    img.onload = () => {
      img.dataset.failed = "false";
      const fail =
        this.data.source === "mock" &&
        this.data.meetScene?.failedAvatarIds?.includes(el.dataset.playerKey!);
      img.hidden = !!fail;
      avatar.dataset.failed = String(!!fail);
    };
    avatar.append(img);
    const name = document.createElement("span");
    name.className = "destiny-player-nickname";
    el.append(avatar, name);
    const pose = this.targetPose(placement);
    const node: PlayerNode = {
      el,
      avatar,
      img,
      name,
      pose,
      enteredAt: this.time,
      seenAt: this.time,
      painted: "",
    };
    this.updateNode(node, player);
    this.container.append(el);
    this.nodes.set(player.id, node);
    return node;
  }

  private targetPose(p: PlayerPlacement): VisualPose {
    return {
      x: p.x,
      y: p.y,
      size: p.avatarSize,
      opacity: p.opacity,
      avatarOffset: p.centeredName
        ? (p.width - p.avatarSize) / 2
        : p.reverse
          ? p.width - p.avatarSize
          : 0,
      nameX: p.centeredName || p.reverse ? 0 : p.avatarSize + p.gap,
      nameWidth: p.nameWidth,
      nameSize: p.nameSize,
      nameY: p.nameY ?? p.avatarSize / 2,
      nameOpacity: 1,
    };
  }

  get modeName() {
    return this.mode;
  }
  getPlayerPoses(): WorldPlayerPose[] {
    return [...this.nodes]
      .filter(([, n]) => !n.el.hidden)
      .map(([id, n]) => ({
        id,
        x: n.pose.x + n.pose.avatarOffset + n.pose.size / 2,
        y: n.pose.y + n.pose.size / 2,
        radius: n.pose.size / 2,
        opacity: n.pose.opacity,
      }));
  }

  changeMode(mode: WorldMode, fromThree: readonly WorldPlayerPose[] = []) {
    this.first.clear();
    this.outgoingCandidates = [];
    this.outgoingPrepared = false;
    for (const [id, node] of this.nodes)
      if (!node.el.hidden) this.first.set(id, { ...node.pose });
    if (this.mode === "MEET")
      for (const pose of fromThree)
        this.first.set(pose.id, {
          x: pose.x - pose.radius,
          y: pose.y - pose.radius,
          size: pose.radius * 2,
          opacity: pose.opacity ?? 1,
          avatarOffset: 0,
          nameX: pose.radius * 2 + 12,
          nameWidth: 128,
          nameSize: 24,
          nameY: pose.radius,
          nameOpacity: 0,
        });
    this.mode = mode;
    this.transitionAt = this.time;
    this.storyAt = this.time;
    this.availableAt = this.time;
    this.clearCues();
  }

  private clearCues() {
    this.cues.forEach((cue) => cue.el.remove());
    this.cues.clear();
    this.highlights.clear();
    this.host.dataset.newcomer = "false";
  }
  suspend() {
    this.clearCues();
  }

  draw(
    deltaMs: number,
    frame: WorldFrame,
    reduced: boolean,
    renderer: WorldRenderer | null,
    pairFrame?: PairSceneFrame,
  ) {
    const paused = !!frame.intersection;
    const delta = deltaMs > 15000 ? 0 : Math.max(0, deltaMs);
    if (!paused) this.time += delta;
    if (
      frame.mode === "MEET" &&
      pairFrame &&
      pairFrame.layoutCount !== this.pairLayoutCount
    ) {
      this.pairLayoutCount = pairFrame.layoutCount;
      this.changeMode("MEET");
    }
    const transition = reduced
      ? 1
      : ease(
          (this.time - this.transitionAt) /
            (frame.mode === "MEET" ? PAIR_TIMING.handoff : 2200),
        );
    let placements = this.queue.advance(
      delta,
      frame.mode,
      paused || transition < 1,
      reduced,
    );
    if (frame.mode === "MEET") {
      placements = (pairFrame?.slots ?? []).flatMap((s) => {
        const l = s.layout;
        return [s.pair.male, s.pair.female].map((player, index) => ({
          id: player.id,
          player,
          mode: "MEET" as const,
          gender: player.gender,
          field: null,
          queueKey: `MEET:${s.slot}:${player.gender}`,
          slot: s.slot,
          pairId: s.pair.id,
          pairPhase: s.phase,
          x: l.centerX + (index ? l.spread : -l.spread) - l.nameWidth / 2,
          y: l.centerY - l.avatarSize / 2,
          width: l.nameWidth,
          height: l.avatarSize,
          avatarSize: l.avatarSize,
          avatarCenterX: l.centerX + (index ? l.spread : -l.spread),
          avatarCenterY: l.centerY,
          nameSize: l.nameSize,
          nameWidth: l.nameWidth,
          nameY: l.avatarSize + 42,
          centeredName: true,
          gap: 0,
          reverse: false,
          opacity: reduced ? (s.phase === "out" ? 0 : 1) : s.opacity,
          phase: s.phase === "out" ? ("exit" as const) : ("hold" as const),
        }));
      });
    }
    const active = new Set<string>();
    for (const placement of placements) {
      active.add(placement.id);
      const node =
        this.nodes.get(placement.id) || this.make(placement.player, placement);
      const target = this.targetPose(placement);
      const first = this.first.get(placement.id);
      if (!first && placement.mode === "MEET" && transition < 1) {
        target.x += (placement.gender === "male" ? -16 : 16) * (1 - transition);
        target.opacity *= transition;
      }
      const born = reduced ? 1 : ease((this.time - node.enteredAt) / 650);
      const pose =
        first && transition < 1
          ? {
              x: mix(first.x, target.x, transition),
              y: mix(first.y, target.y, transition),
              size: mix(first.size, target.size, transition),
              nameX: mix(first.nameX, target.nameX, transition),
              nameWidth: mix(first.nameWidth, target.nameWidth, transition),
              nameSize: mix(first.nameSize, target.nameSize, transition),
              nameY: mix(first.nameY, target.nameY, transition),
              nameOpacity: mix(
                first.nameOpacity,
                target.nameOpacity,
                transition,
              ),
              opacity: mix(first.opacity, target.opacity, transition),
              avatarOffset: mix(
                first.avatarOffset,
                target.avatarOffset,
                transition,
              ),
            }
          : {
              ...target,
              y: target.y + (1 - born) * 8,
              opacity: target.opacity * born,
            };
      node.pose = pose;
      node.seenAt = this.time;
      node.el.hidden = false;
      node.el.dataset.visible = String(pose.opacity > 0.01);
      node.el.dataset.windowRole = "active";
      node.el.dataset.queueKey = placement.queueKey;
      node.el.dataset.pairMember = String(placement.mode === "MEET");
      node.el.dataset.pairId =
        placement.mode === "MEET" ? (placement.pairId ?? "") : "";
      node.el.dataset.slot = String(placement.slot);
      node.el.dataset.pairPhase = placement.pairPhase ?? "";
      node.el.dataset.queuePhase = placement.phase;
      node.el.dataset.reverse = String(placement.reverse);
      node.el.dataset.x = pose.x.toFixed(2);
      node.el.dataset.y = pose.y.toFixed(2);
      const highlightedAt = this.highlights.get(placement.id);
      const highlightAge =
        highlightedAt === undefined ? Infinity : this.time - highlightedAt;
      const highlight =
        !reduced && highlightAge >= 200 && highlightAge < 2200
          ? Math.sin((Math.PI * (highlightAge - 200)) / 2000)
          : 0;
      node.el.dataset.highlight = String(highlight > 0.01);
      const imageScale = 1 + highlight * 0.12;
      const turnsAround =
        !!first &&
        !placement.centeredName &&
        first.nameY <= first.size &&
        first.avatarOffset > 0 !== placement.reverse;
      const changesLayout =
        !!first && first.nameY > first.size !== (placement.mode === "MEET");
      const edge = changesLayout ? 0.06 : 0.16;
      const nameFade =
        (!turnsAround && !changesLayout) || transition >= 1
          ? 1
          : transition < edge
            ? 1 - ease(transition / edge)
            : transition > 1 - edge
              ? ease((transition - (1 - edge)) / edge)
              : 0;
      const reverse =
        turnsAround && transition < 0.5
          ? first!.avatarOffset > 0
          : placement.reverse;
      // Fade only the nickname while it exchanges sides with its own portrait.
      // Both anchors interpolate; alignment switches when the nickname is invisible.
      const firstGap = first
        ? first.avatarOffset > 0
          ? first.avatarOffset - first.nameX - first.nameWidth
          : first.nameX - first.size
        : placement.gap;
      const safeGap = mix(firstGap, placement.gap, transition);
      const nameAnchor =
        turnsAround && !changesLayout && transition < 1
          ? reverse
            ? pose.avatarOffset - safeGap - pose.nameWidth
            : pose.avatarOffset + pose.size + safeGap
          : pose.nameX;
      const signature =
        [
          pose.x,
          pose.y,
          pose.size,
          pose.opacity,
          pose.avatarOffset,
          pose.nameX,
          pose.nameWidth,
          pose.nameSize,
          pose.nameY,
          pose.nameOpacity,
          nameFade,
          nameAnchor,
          reverse ? 1 : 0,
          placement.centeredName && transition >= 0.5 ? 1 : 0,
          imageScale,
        ]
          .map((v) => v.toFixed(3))
          .join(":") + `:${placement.mode}`;
      if (signature !== node.painted) {
        node.painted = signature;
        node.el.style.transform = `translate3d(${unit(pose.x)},${unit(pose.y)},0)`;
        node.el.style.width = unit(
          Math.max(pose.avatarOffset + pose.size, pose.nameX + pose.nameWidth),
        );
        node.el.style.height = unit(pose.size);
        node.el.style.opacity = String(pose.opacity);
        node.avatar.style.width = node.avatar.style.height = unit(pose.size);
        node.avatar.style.transform = `translateX(${unit(pose.avatarOffset)}) scale(${imageScale})`;
        node.name.style.left = unit(nameAnchor);
        node.name.style.top = unit(pose.nameY);
        node.name.style.width = unit(pose.nameWidth);
        node.name.style.fontSize = unit(pose.nameSize);
        node.name.style.opacity = String(nameFade * pose.nameOpacity);
        node.name.style.textAlign =
          placement.centeredName && transition >= 0.5
            ? "center"
            : reverse
              ? "right"
              : "left";
      }
    }
    if (!this.outgoingPrepared) {
      // Freeze the handoff selection once. Prioritize the most visible source
      // portraits, then their stable visual IDs; never resample on each frame.
      this.outgoingCandidates = [...this.first]
        .filter(
          ([id, pose]) =>
            !active.has(id) && this.nodes.has(id) && pose.opacity > 0.01,
        )
        .sort((a, b) => b[1].opacity - a[1].opacity || a[0].localeCompare(b[0]))
        .slice(0, 30)
        .map(([id]) => id);
      this.outgoingPrepared = true;
    }
    const outgoing = new Set(
      this.outgoingCandidates
        .filter((id) => !active.has(id) && this.nodes.has(id))
        .slice(0, Math.max(0, Math.min(30, 60 - active.size))),
    );
    for (const [id, node] of this.nodes)
      if (!active.has(id)) {
        const from = this.first.get(id);
        const exitAge = this.time - this.transitionAt;
        const exiting = !reduced && !!from && outgoing.has(id) && exitAge < 650;
        node.el.hidden = !exiting;
        node.el.dataset.windowRole = exiting ? "outgoing" : "hidden";
        node.el.dataset.visible = "false";
        if (exiting) {
          // A retained DOM node may still carry the previous CHOICE/LIVE pose.
          // Draw the full handoff pose, including the smaller MEET portrait and
          // hidden nickname, before making that node visible for its fade-out.
          const pose = {
            ...from,
            opacity: from.opacity * (1 - ease(exitAge / 650)),
          };
          node.pose = pose;
          node.el.dataset.queuePhase = "exit";
          node.el.dataset.visible = String(pose.opacity > 0.01);
          node.el.dataset.x = pose.x.toFixed(2);
          node.el.dataset.y = pose.y.toFixed(2);
          node.el.dataset.reverse = String(pose.avatarOffset > 0);
          node.el.dataset.highlight = "false";
          const signature =
            "outgoing:" +
            [
              pose.x,
              pose.y,
              pose.size,
              pose.opacity,
              pose.avatarOffset,
              pose.nameX,
              pose.nameWidth,
              pose.nameSize,
              pose.nameY,
              pose.nameOpacity,
            ]
              .map((value) => value.toFixed(3))
              .join(":");
          if (signature !== node.painted) {
            node.painted = signature;
            node.el.style.transform = `translate3d(${unit(pose.x)},${unit(pose.y)},0)`;
            node.el.style.width = unit(
              Math.max(
                pose.avatarOffset + pose.size,
                pose.nameX + pose.nameWidth,
              ),
            );
            node.el.style.height = unit(pose.size);
            node.el.style.opacity = String(pose.opacity);
            node.avatar.style.width = node.avatar.style.height = unit(
              pose.size,
            );
            node.avatar.style.transform = `translateX(${unit(pose.avatarOffset)}) scale(1)`;
            node.name.style.left = unit(pose.nameX);
            node.name.style.top = unit(pose.nameY);
            node.name.style.width = unit(pose.nameWidth);
            node.name.style.fontSize = unit(pose.nameSize);
            node.name.style.opacity = String(pose.nameOpacity);
            node.name.style.textAlign =
              pose.avatarOffset > 0 ? "right" : "left";
          }
        }
        // Retain recent DOM identities across windows and modes with a bounded pool.
        if (this.nodes.size > 120 && this.time - node.seenAt > 28000) {
          node.el.remove();
          this.nodes.delete(id);
        }
      }
    let activeCue = false;
    for (const [key, cue] of this.cues) {
      const age = this.time - cue.started;
      const duration = Math.min(
        5000,
        Math.max(2700, cue.received - cue.started + 1500),
      );
      if (age > duration) {
        cue.el.remove();
        this.cues.delete(key);
        continue;
      }
      activeCue = true;
      if (!cue.fired && renderer && !paused) {
        renderer.eventBackgroundPulse(
          cue.target,
          variants[Math.floor(Math.random() * variants.length)],
          Math.max(1, cue.count),
        );
        cue.fired = true;
      }
      const opacity = reduced
        ? 0.85
        : Math.min(ease(age / 300), ease((duration - age) / 650));
      cue.el.style.opacity = String(paused ? 0 : opacity);
      cue.el.style.transform = reduced
        ? "none"
        : `translateY(${unit(8 - 20 * Math.min(1, age / 1500))})`;
    }
    for (const [id, started] of this.highlights)
      if (this.time - started > 6000) this.highlights.delete(id);
    this.host.dataset.newcomer = String(activeCue && !paused);
    {
      this.host.dataset.players = String(
        placements.filter((p) => p.opacity > 0.01).length,
      );
      this.host.dataset.visiblePlayers = this.host.dataset.players;
    }
    const storyPhase = (this.time - this.storyAt) % 9400;
    const storyOpacity =
      storyPhase < 1400
        ? ease(storyPhase / 1400)
        : storyPhase < 5400
          ? 1
          : storyPhase < 6800
            ? 1 - ease((storyPhase - 5400) / 1400)
            : 0;
    if (this.story)
      this.story.style.opacity = String(
        reduced ? 0.8 : storyOpacity * (activeCue ? 0.3 : 0.82),
      );
    if (this.availableCopy) {
      const age = this.time - this.availableAt;
      this.availableCopy.style.opacity =
        this.data.availableParticipants <= 0
          ? "0"
          : String(
              reduced
                ? 0.85
                : Math.min(ease(age / 1000), ease((5500 - age) / 1000)),
            );
    }
  }
  dispose() {
    this.clearCues();
    this.nodes.clear();
    this.container.replaceChildren();
    this.seen.clear();
  }
}
