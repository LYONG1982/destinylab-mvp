"use client";
import { useEffect, type RefObject } from "react";

export const reduceQuery = "(prefers-reduced-motion: reduce)";

/** Final styles are the default. Cancellation always restores a readable final state. */
export function useVisualEffect<T extends Element>(
  ref: RefObject<T | null>,
  setup: (element: T) => () => void,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = matchMedia(reduceQuery);
    let started = false;
    let cleanup = () => {};
    const finish = () => {
      cleanup();
      cleanup = () => {};
      started = true;
    };
    const start = () => {
      if (started) return;
      started = true;
      if (!preference.matches && document.visibilityState === "visible")
        cleanup = setup(element);
    };
    const environmentalChange = () => {
      if (preference.matches || document.visibilityState !== "visible")
        finish();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start();
      else if (started) finish();
    });
    observer.observe(element);
    environmentalChange();
    preference.addEventListener("change", environmentalChange);
    document.addEventListener("visibilitychange", environmentalChange);
    return () => {
      finish();
      observer.disconnect();
      preference.removeEventListener("change", environmentalChange);
      document.removeEventListener("visibilitychange", environmentalChange);
    };
  }, [ref, setup]);
}

const memory = new Set<string>();
export function hasPlayed(key: string) {
  if (memory.has(key)) return true;
  try {
    return sessionStorage.getItem(`destinylab:motion:${key}`) === "true";
  } catch {
    return false;
  }
}
export function markPlayed(key: string) {
  memory.add(key);
  try {
    sessionStorage.setItem(`destinylab:motion:${key}`, "true");
  } catch {
    /* Storage denial must never block a business action. */
  }
}
