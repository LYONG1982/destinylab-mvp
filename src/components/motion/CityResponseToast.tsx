"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import * as store from "@/lib/demo/store";
import { cityResponseFor } from "@/lib/demo/presentation";
import { motionTiming, ms } from "@/lib/motion-tokens";
import { Motion } from "./Motion";

type Response = {
  epoch: string;
  actor: string;
  question: string;
  answer: string;
  text: string;
};
const Context = createContext<
  (actor: string, question: string, answer: string) => void
>(() => {});
export const useCityResponse = () => useContext(Context);
export function CityResponseToast({ text }: { text: string }) {
  return (
    <div className="city-response" role="status">
      <Motion preset="soft">{text}</Motion>
    </div>
  );
}
export function CityResponseBoundary({ children }: { children: ReactNode }) {
  const [response, setResponse] = useState<Response | null>(null);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const actor = useSyncExternalStore(
    store.subscribe,
    store.actorFromSession,
    () => "p-shanfeng",
  );
  const pathname = usePathname();
  const show = useCallback(
    (actor: string, question: string, answer: string) => {
      const saved = store.getSnapshot();
      if (
        !saved ||
        saved.participants.find((p) => p.id === actor)?.answers[question] !==
          answer
      )
        return;
      const text = [
        question === "q1" ? "已加入今晚的答案。" : "",
        cityResponseFor(saved, actor, question, answer),
      ]
        .filter(Boolean)
        .join(" ");
      if (text)
        setResponse({ epoch: saved.epoch, actor, question, answer, text });
    },
    [],
  );
  useEffect(() => {
    if (!response) return;
    const timer = setTimeout(() => setResponse(null), ms(motionTiming.toast));
    const hide = () => {
      if (document.visibilityState !== "visible") setResponse(null);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [response]);
  const valid =
    response &&
    state?.epoch === response.epoch &&
    actor === response.actor &&
    state.participants.find((p) => p.id === actor)?.answers[
      response.question
    ] === response.answer &&
    /\/mobile\/(01|02|04|05)-/.test(pathname);
  // Drop invalid presentation cues immediately; returning to the route cannot replay them.
  if (response && !valid) setResponse(null);
  return (
    <Context.Provider value={show}>
      {children}
      {valid && (
        <CityResponseToast
          key={`${response.epoch}:${response.question}:${response.answer}`}
          text={response.text}
        />
      )}
    </Context.Provider>
  );
}
