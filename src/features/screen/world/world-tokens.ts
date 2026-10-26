/** Logical stage coordinates. DOM HUD and Three share these anchors. */
export const WORLD_WIDTH = 1920;
export const WORLD_HEIGHT = 1080;
export const FIELD_ANCHORS = [
  { x: 384, y: 518, tint: "#7999a3" },
  { x: 960, y: 518, tint: "#c99c65" },
  { x: 1517, y: 518, tint: "#b97787" },
] as const;
export const WORLD_LIMITS = {
  players: 60,
  particles: 40,
  eventParticles: 18,
  trailsPerPlayer: 24,
  historyPaths: 12,
  pulsePool: 8,
  textures: 20,
} as const;
export const QUALITY_LIMITS = {
  HIGH: { players: 60, particles: 40, dpr: 1.5 },
  MEDIUM: { players: 45, particles: 30, dpr: 1.25 },
  LOW: { players: 30, particles: 16, dpr: 1 },
} as const;
export type WorldQuality = keyof typeof QUALITY_LIMITS;
