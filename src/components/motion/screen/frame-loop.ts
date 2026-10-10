/** One RAF owner per screen, shared by Canvas 2D and the lazy WebGL scene. */
export class ScreenFrameLoop {
  private listeners = new Set<(time: number) => void>();
  private frame = 0;
  private ticking = false;
  private tick = (time: number) => {
    this.frame = 0;
    this.ticking = true;
    for (const listener of [...this.listeners]) listener(time);
    this.ticking = false;
    if (this.listeners.size) this.frame = requestAnimationFrame(this.tick);
  };
  add(listener: (time: number) => void) {
    this.listeners.add(listener);
    if (!this.frame && !this.ticking)
      this.frame = requestAnimationFrame(this.tick);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    };
  }
  get size() {
    return this.listeners.size;
  }
  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.listeners.clear();
  }
}
