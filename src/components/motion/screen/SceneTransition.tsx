"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { ease, screenMotion } from "@/lib/motion-tokens";
import { reduceQuery } from "../lifecycle";

/** Only the content is copied. Background, relationship field and QR keep their identities. */
export function SceneTransition({
  scene,
  children,
}: {
  scene: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const host = ref.current!;
    const current = host.firstElementChild as HTMLElement;
    const outgoing = previous.current;
    const preference = matchMedia(reduceQuery);
    let animations: Animation[] = [];
    if (!preference.matches && document.visibilityState === "visible") {
      if (outgoing) {
        outgoing.className = "screen-scene-outgoing";
        outgoing.setAttribute("aria-hidden", "true");
        outgoing.inert = true;
        outgoing.querySelectorAll("[id], [data-testid]").forEach((el) => {
          el.removeAttribute("id");
          el.removeAttribute("data-testid");
        });
        host.append(outgoing);
        animations.push(
          outgoing.animate(
            [
              { opacity: 1, transform: "translateY(0)" },
              { opacity: 0, transform: "translateY(-10px)" },
            ],
            { duration: screenMotion.dissolve * 1000, easing: ease() },
          ),
        );
      }
      animations.push(
        current.animate(
          [
            { opacity: 0, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: screenMotion.dissolve * 1000, easing: ease() },
        ),
      );
      current.querySelectorAll(".screen-bar").forEach((row, index) =>
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
        ),
      );
    }
    const finish = () => {
      animations.forEach((a) => a.cancel());
      animations = [];
      outgoing?.remove();
    };
    const timer = setTimeout(finish, 1250);
    const environmentalChange = () => {
      if (preference.matches || document.visibilityState !== "visible")
        finish();
    };
    preference.addEventListener("change", environmentalChange);
    document.addEventListener("visibilitychange", environmentalChange);
    return () => {
      previous.current = current.cloneNode(true) as HTMLElement;
      clearTimeout(timer);
      finish();
      preference.removeEventListener("change", environmentalChange);
      document.removeEventListener("visibilitychange", environmentalChange);
    };
  }, [scene]);
  return (
    <div ref={ref} className="screen-scene-transition">
      <div
        key={scene}
        data-scene-current={scene}
        className="screen-scene-current"
      >
        {children}
      </div>
    </div>
  );
}
