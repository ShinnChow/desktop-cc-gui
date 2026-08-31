import { useRuntimeLogSession } from "../../runtime-log/hooks/useRuntimeLogSession";
import type {
  RuntimeLogSessionState,
} from "../../runtime-log/hooks/useRuntimeLogSession";
import type { WorkspaceInfo } from "../../../types";

type UseWorkspaceRuntimeRunOptions = {
  activeWorkspace: WorkspaceInfo | null;
};



export type WorkspaceRuntimeRunState = RuntimeLogSessionState;

export function useWorkspaceRuntimeRun({
  activeWorkspace,
}: UseWorkspaceRuntimeRunOptions): WorkspaceRuntimeRunState {
  return useRuntimeLogSession({ activeWorkspace });
}
