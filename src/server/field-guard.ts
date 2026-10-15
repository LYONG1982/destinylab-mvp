import type { DemoState } from "@/domain/types";
import { HttpError } from "./service";
export function fieldParticipant(state: DemoState, actor: string) {
  if (state.fieldOpen === false)
    throw new HttpError(409, "现场已关闭，报名与同舟资料仍可维护。");
  const p = state.participants.find((p) => p.id === actor);
  if (!p) throw new HttpError(410, "本轮参与已结束，请主动重新进入现场。");
  if (!p.present)
    throw new HttpError(409, "你已离场，请联系工作人员恢复入场。");
  return p;
}
