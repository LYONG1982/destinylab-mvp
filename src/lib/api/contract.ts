import type { Command, DemoState } from "@/domain/types";
/** Replace this adapter with an authenticated HTTP service after the local acceptance phase. */
export interface DestinyLabApi {
  command(actor: string, command: Command, id?: string): Promise<DemoState>;
  resetScenario(name: string): Promise<void>;
}
