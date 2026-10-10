"use client";
import { Component, createRef, type ReactNode } from "react";
import { ease, screenMotion } from "@/lib/motion-tokens";
import { reduceQuery } from "../lifecycle";

type Props = { scene: string; children: ReactNode };
type Snapshot = { node: HTMLElement; rect: DOMRect } | null;

/** Capture the live old layer before React changes its content or the parent's theme. */
export class SceneTransition extends Component<Props> {
  private host = createRef<HTMLDivElement>();
  private stop = () => {};
  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (previous.scene === this.props.scene) return null;
    const current = this.host.current!.firstElementChild as HTMLElement;
    const node = current.cloneNode(true) as HTMLElement;
    // Preserve inherited typography/colors, including mutual-theme styles, in the frozen exit layer.
    const sources = [current, ...current.querySelectorAll<HTMLElement>("*")];
    const copies = [node, ...node.querySelectorAll<HTMLElement>("*")];
    sources.forEach((source, index) => {
      const style = getComputedStyle(source);
      for (const property of [
        "color",
        "font-size",
        "line-height",
        "letter-spacing",
        "visibility",
      ])
        copies[index].style.setProperty(
          property,
          style.getPropertyValue(property),
        );
    });
    return { node, rect: current.getBoundingClientRect() };
  }
  componentDidMount() {
    this.enter(null);
  }
  componentDidUpdate(previous: Props, _state: unknown, snapshot: Snapshot) {
    if (previous.scene !== this.props.scene) this.enter(snapshot);
  }
  componentWillUnmount() {
    this.stop();
  }
  private enter(snapshot: Snapshot) {
    this.stop();
    const host = this.host.current!;
    const current = host.firstElementChild as HTMLElement;
    const preference = matchMedia(reduceQuery);
    if (preference.matches || document.visibilityState !== "visible") return;
    const animations: Animation[] = [];
    const outgoing = snapshot?.node;
    if (outgoing && snapshot) {
      outgoing.className = "screen-scene-layer screen-scene-outgoing";
      outgoing.setAttribute("aria-hidden", "true");
      outgoing.inert = true;
      for (const el of [outgoing, ...outgoing.querySelectorAll("*")])
        for (const name of [
          "id",
          "data-testid",
          "data-scene-current",
          "aria-live",
        ])
          el.removeAttribute(name);
      const parent = host.getBoundingClientRect();
      Object.assign(outgoing.style, {
        left: `${snapshot.rect.left - parent.left}px`,
        top: `${snapshot.rect.top - parent.top}px`,
        width: `${snapshot.rect.width}px`,
        height: `${snapshot.rect.height}px`,
        opacity: "0",
      });
      host.append(outgoing);
      const exit = outgoing.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-10px)" },
        ],
        {
          duration: screenMotion.dissolve * 1000,
          easing: ease(),
          fill: "both",
        },
      );
      // Remove before cancelling. The fallback CSS is also transparent, never visible again.
      exit.onfinish = () => {
        outgoing.remove();
        exit.cancel();
      };
      animations.push(exit);
    }
    animations.push(
      current.animate(
        [
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: screenMotion.dissolve * 1000,
          easing: ease(),
          fill: "backwards",
        },
      ),
    );
    if (!snapshot)
      current.querySelectorAll(".screen-bar").forEach((row, index) => {
        animations.push(
          row.animate(
            [
              { opacity: 0, transform: "translateY(8px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            {
              duration: 650,
              delay: 180 + index * 140,
              fill: "backwards",
              easing: ease(),
            },
          ),
        );
      });
    const finish = () => {
      outgoing?.remove();
      animations.forEach((animation) => animation.cancel());
    };
    const environment = () => {
      if (preference.matches || document.visibilityState !== "visible")
        finish();
    };
    preference.addEventListener("change", environment);
    document.addEventListener("visibilitychange", environment);
    window.addEventListener("resize", finish);
    this.stop = () => {
      finish();
      preference.removeEventListener("change", environment);
      document.removeEventListener("visibilitychange", environment);
      window.removeEventListener("resize", finish);
    };
  }
  render() {
    return (
      <div ref={this.host} className="screen-scene-transition">
        <div
          key={this.props.scene}
          data-scene-current={this.props.scene}
          className="screen-scene-layer screen-scene-current"
        >
          {this.props.children}
        </div>
      </div>
    );
  }
}
