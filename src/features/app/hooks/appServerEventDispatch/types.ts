import type {
  AppServerEventHandlers,
  DispatchAppServerEventOptions,
} from "../appServerEventTypes";
import type { SharedSessionNativeBinding } from "../../../shared-session/runtime/sharedSessionBridge";

export type AppServerEventDispatchContext = {
  handlers: AppServerEventHandlers;
  params: Record<string, unknown>;
  rawThreadId: string;
  sharedBridge: SharedSessionNativeBinding | null;
  threadAgentDeltaSeenRef: DispatchAppServerEventOptions["threadAgentDeltaSeenRef"];
  threadAgentCompletedSeenRef: DispatchAppServerEventOptions["threadAgentCompletedSeenRef"];
  threadAgentSnapshotSeenRef: DispatchAppServerEventOptions["threadAgentSnapshotSeenRef"];
};
