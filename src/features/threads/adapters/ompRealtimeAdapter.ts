import type { RealtimeAdapter } from "../contracts/conversationCurtainContracts";
import { mapCommonRealtimeEvent } from "./sharedRealtimeAdapter";

export const ompRealtimeAdapter: RealtimeAdapter = {
  engine: "omp",
  mapEvent(input: unknown) {
    return mapCommonRealtimeEvent("omp", input, {
      allowTextDeltaAlias: true,
    });
  },
};
