/** A stale read may never restore a logged-out identity or replace a newer revision. */
export class SnapshotGate {
  generation = 0;
  epoch = "";
  revision = -1;
  reset() {
    this.generation++;
    this.epoch = "";
    this.revision = -1;
  }
  accept(generation: number, epoch: string, revision: number) {
    if (generation !== this.generation || !Number.isSafeInteger(revision))
      return false;
    if (this.epoch && this.epoch !== epoch) return false;
    if (revision < this.revision) return false;
    this.epoch = epoch;
    this.revision = revision;
    return true;
  }
}
export function retryDelay(failures: number, jitter = Math.random()) {
  return (
    Math.min(30000, 2000 * 2 ** Math.min(failures, 4)) +
    Math.floor(jitter * 400)
  );
}
