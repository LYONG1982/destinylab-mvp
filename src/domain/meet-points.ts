import type { MeetPoint } from "./types";

export function defaultMeetPoints(): MeetPoint[] {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `meet-${index + 1}`,
    name: `Meet${String(index + 1).padStart(2, "0")}`,
    location: "",
    distance: 0,
    occupant: null,
    closed: false,
  }));
}

/** Preserve existing IDs, configuration and occupancy; append missing defaults only. */
export function completeMeetPoints(existing: MeetPoint[]): MeetPoint[] {
  const names = new Set(existing.map((point) => point.name));
  const ids = new Set(existing.map((point) => point.id));
  const additions = defaultMeetPoints().filter(
    (point) => !names.has(point.name),
  );
  for (const point of additions) {
    const base = `point-${point.name}`;
    let suffix = 0;
    while (ids.has(point.id)) point.id = `${base}-${suffix++}`;
    ids.add(point.id);
  }
  return [...existing, ...additions];
}
