import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import type { HistoryLoadingProgressListener } from "../utils/historyLoadingProgress";
import { runNativeHistoryFetchAndParse } from "../utils/runNativeHistoryOpenStages";
import {
  collectPiHistoryBackgroundTasks,
  parsePiHistoryMessages,
} from "./piHistoryParser";
import { hydrateBackgroundTasksFromHistory } from "../../messages/utils/backgroundTaskStore";

type PiFamilyHistoryEngine = "pi" | "omp";

type PiFamilyHistoryLoaderOptions = {
  engine: PiFamilyHistoryEngine;
  workspaceId: string;
  workspacePath: string | null;
  loadSession: (workspacePath: string, sessionId: string) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

/**
 * pi-family（pi / omp）共享历史加载器：omp 与 pi 的 history 载荷同构
 * （NDJSON 投影为相同的 messages 数组），仅引擎身份 / thread 前缀 /
 * 后端命令不同，全部经 options 注入，解析逻辑零复制。
 */
export function createPiFamilyHistoryLoader({
  engine,
  workspaceId,
  workspacePath,
  loadSession,
  onProgress,
}: PiFamilyHistoryLoaderOptions): HistoryLoader {
  const threadPrefix = `${engine}:`;
  return {
    engine,
    async load(threadId: string) {
      const sessionId = threadId.startsWith(threadPrefix)
        ? threadId.slice(threadPrefix.length)
        : threadId;
      if (!workspacePath) {
        return normalizeHistorySnapshot({
          engine,
          workspaceId,
          threadId,
          meta: {
            workspaceId,
            threadId,
            engine,
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        });
      }

      let rawMessages: unknown = null;
      const staged = await runNativeHistoryFetchAndParse({
        report: (progress) => {
          onProgress?.(progress);
        },
        shouldContinue: () => true,
        load: () => loadSession(workspacePath, sessionId),
        extractMessages: (payload) => {
          rawMessages =
            payload && typeof payload === "object" && "messages" in payload
              ? (payload.messages ?? payload)
              : payload;
          return rawMessages;
        },
        parse: parsePiHistoryMessages,
      });
      const items = staged?.items ?? [];
      // 1.5/pill 联动：历史合并任务回灌会话级状态表，重开会话后
      // composer 后台任务 pill 仍出现（只补缺，不动 live 记录）。
      hydrateBackgroundTasksFromHistory(
        workspaceId,
        threadId,
        collectPiHistoryBackgroundTasks(rawMessages),
      );

      return normalizeHistorySnapshot({
        engine,
        workspaceId,
        threadId,
        items,
        plan: null,
        userInputQueue: [],
        meta: {
          workspaceId,
          threadId,
          engine,
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
          historyHasMore: false,
          historyNextCursor: null,
        },
      });
    },
  };
}

type PiHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadPiSession: (workspacePath: string, sessionId: string) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

export function createPiHistoryLoader({
  workspaceId,
  workspacePath,
  loadPiSession,
  onProgress,
}: PiHistoryLoaderOptions): HistoryLoader {
  return createPiFamilyHistoryLoader({
    engine: "pi",
    workspaceId,
    workspacePath,
    loadSession: loadPiSession,
    onProgress,
  });
}
