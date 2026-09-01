import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import type { HistoryLoadingProgressListener } from "../utils/historyLoadingProgress";
import { createPiFamilyHistoryLoader } from "./piHistoryLoader";

type OmpHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadOmpSession: (workspacePath: string, sessionId: string) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

export function createOmpHistoryLoader({
  workspaceId,
  workspacePath,
  loadOmpSession,
  onProgress,
}: OmpHistoryLoaderOptions): HistoryLoader {
  return createPiFamilyHistoryLoader({
    engine: "omp",
    workspaceId,
    workspacePath,
    loadSession: loadOmpSession,
    onProgress,
  });
}
