"use client";
import { useCallback, useRef } from "react";
import { useAnimatedValue } from "./useAnimatedValue";
export function AnimatedBar({
  percentage,
  fromZero = false,
}: {
  percentage: number;
  fromZero?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const draw = useCallback((el: HTMLElement, next: number) => {
    el.style.transform = `scaleX(${next / 100})`;
  }, []);
  useAnimatedValue(ref, percentage, fromZero, draw);
  return (
    <i
      className="animated-bar"
      ref={ref}
      style={{
        width: "100%",
        transform: `scaleX(${percentage / 100})`,
        transformOrigin: "left",
      }}
    />
  );
}
