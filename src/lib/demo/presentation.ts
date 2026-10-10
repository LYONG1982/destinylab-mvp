import type { DemoState } from "@/domain/types";
/** Local adapter metadata only. A future real adapter must opt in with real evidence. */
export const demoPresentation = { isDemoData: true } as const;
export function cityResponseFor(
  state: DemoState,
  actor: string,
  question: string,
  answer: string,
) {
  if (state.live) {
    const count = state.live.questions.find((q) => q.id === question)?.options.find((o) => o.label === answer)?.count || 0;
    return count > 1 ? `现场也有人选择了“${answer}”。` : "";
  }
  if (!demoPresentation.isDemoData) return "";
  return state.participants.some(
    (p) => p.id !== actor && p.present && p.answers[question] === answer,
  )
    ? `演示数据中，也有人选择了“${answer}”。`
    : "";
}
