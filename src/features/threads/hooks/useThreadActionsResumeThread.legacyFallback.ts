import { type MutableRefObject } from "react";
import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  loadClaudeSession as loadClaudeSessionService,
  loadDshSession as loadDshSessionService,
  loadGeminiSession as loadGeminiSessionService,
  loadGrokSession as loadGrokSessionService,
  loadKimiSession as loadKimiSessionService,
  loadOmpSession as loadOmpSessionService,
  loadPiSession as loadPiSessionService,
  loadQoderSession as loadQoderSessionService,
} from "../../../services/tauri";
import {
  CLAUDE_UI_HISTORY_WINDOW,
  extractClaudeHistoryTokenUsage,
  parseClaudeHistoryMessagesWithShadowRecovery,
} from "../loaders/claudeHistoryLoader";
import { parseGeminiHistoryMessages } from "../loaders/geminiHistoryParser";
import { parseGrokHistoryMessages } from "../loaders/grokHistoryParser";
import { parseKimiHistoryMessages } from "../loaders/kimiHistoryParser";
import {
  DSH_UI_HISTORY_WINDOW,
  extractDshHistoryCurrentModel,
  extractDshHistoryTodos,
  extractDshHistoryTokenUsage,
} from "../loaders/dshHistoryLoader";
import { parseDshHistoryMessages } from "../loaders/dshHistoryParser";
import { seedDshComposerSelectionFromHost } from "../../../app-shell-parts/selectedComposerSession";
import {
  collectPiHistoryBackgroundTasks,
  parsePiHistoryMessages,
} from "../loaders/piHistoryParser";
import { hydrateBackgroundTasksFromHistory } from "../../messages/utils/backgroundTaskStore";
import { parseQoderHistoryMessages } from "../loaders/qoderHistoryParser";
import { parseQoderSessionIdentity } from "../utils/qoderSessionIdentity";
import { isThreadResumeNotFoundError } from "./useThreadActions.helpers";
import { createThreadHistoryReadableSurfaceDebugEntry } from "./useThreadActions.recoveryDiagnostics";
import { resolveThreadStabilityDiagnostic } from "../utils/stabilityDiagnostics";
import { runNativeHistoryOpenStages } from "../utils/runNativeHistoryOpenStages";
import { subscribeMappedDshHistoryLoadProgress } from "../utils/subscribeMappedDshHistoryLoadProgress";
import type { HistoryLoadingProgress } from "../utils/historyLoadingProgress";
import type { DispatchThreadItemsResult } from "../utils/dispatchThreadItemsProgressively";
import { type UseThreadActionsOptions } from "./useThreadActions.types";

// harden-pi-session-curtain-fidelity：pi load 连续失败达上限后置 loaded
// 停止自动重试，防止会话文件永久缺失时每次切回都全量扫盘。
const PI_HISTORY_LOAD_MAX_ATTEMPTS = 3;

export type LegacyEngineHistoryFallbackParams = {
  workspaceId: string;
  threadId: string;
  force: boolean;
  localItems: ConversationItem[];
  dispatch: UseThreadActionsOptions["dispatch"];
  isCurrentResumeRequest: () => boolean;
  setThreadLoaded: (targetThreadId: string, loaded: boolean) => void;
  setThreadHistoryRecoveryFailed: (
    targetThreadId: string,
    failed: boolean,
  ) => void;
  markHistoryRecoveryFailure: (
    targetThreadId: string,
    targetLocalItems: ConversationItem[],
    reasonCode: string,
    fallbackWarningCount?: number,
  ) => void;
  applyHydratedItems: (
    targetThreadId: string,
    items: ConversationItem[],
    options?: { mode?: "tail-first" | "atomic" },
  ) => Promise<DispatchThreadItemsResult | null>;
  setThreadHistoryLoadingProgress?: (
    threadId: string,
    progress: HistoryLoadingProgress | null,
  ) => void;
  loadedThreadsRef: UseThreadActionsOptions["loadedThreadsRef"];
  reconcileMissingClaudeThread: (
    workspaceId: string,
    threadId: string,
  ) => boolean;
  onDebug: UseThreadActionsOptions["onDebug"];
  piHistoryLoadFailureCountByThreadRef: MutableRefObject<
    Record<string, number>
  >;
  latestThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[]>
  >;
  threadsByWorkspaceRef: MutableRefObject<Record<string, ThreadSummary[]>>;
  itemsByThread: UseThreadActionsOptions["itemsByThread"];
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
  resolveWorkspacePath: UseThreadActionsOptions["resolveWorkspacePath"];
};

// 段级外移（大文件拆分 A3）：per-engine legacy fallback 分支段逐字搬运，
// 闭包依赖经参数对象注入（每渲染新建，禁缓存）。返回 undefined 表示线程
// 不属于任何 legacy 引擎分支，调用方继续走 codex resume RPC 尾段。
export async function runLegacyEngineHistoryFallback(
  params: LegacyEngineHistoryFallbackParams,
): Promise<string | null | undefined> {
  const {
    workspaceId,
    threadId,
    force,
    localItems,
    dispatch,
    isCurrentResumeRequest,
    setThreadLoaded,
    setThreadHistoryRecoveryFailed,
    markHistoryRecoveryFailure,
    applyHydratedItems,
    setThreadHistoryLoadingProgress,
    loadedThreadsRef,
    reconcileMissingClaudeThread,
    onDebug,
    piHistoryLoadFailureCountByThreadRef,
    latestThreadsByWorkspaceRef,
    threadsByWorkspaceRef,
    itemsByThread,
    workspacePathsByIdRef,
    resolveWorkspacePath,
  } = params;
  // Claude sessions don't use Codex thread/resume RPC —
  // load message history from JSONL and populate the thread
  const workspacePath =
    workspacePathsByIdRef.current[workspaceId] ??
    resolveWorkspacePath?.(workspaceId) ??
    "";
  if (threadId.startsWith("claude:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "claude",
    });
    if (!workspacePath) {
      markHistoryRecoveryFailure(
        threadId,
        localItems,
        "history-workspace-path-missing",
      );
      return threadId;
    }
    if (force || !loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("claude:".length);
      try {
        const result = await loadClaudeSessionService(
          workspacePath,
          realSessionId,
          { limit: CLAUDE_UI_HISTORY_WINDOW },
        );
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        const claudeRecord = result as {
          messages?: unknown;
          hasMore?: boolean;
          nextCursor?: string | null;
        };
        // Handle both new format { messages, usage } and old format (array)
        const messagesData = claudeRecord.messages ?? result;

        const items = parseClaudeHistoryMessagesWithShadowRecovery({
          messagesData,
          workspacePath,
          workspaceId,
          threadId,
        });
        if (items.length > 0) {
          setThreadHistoryRecoveryFailed(threadId, false);
          const appliedClaudeItems = await applyHydratedItems(
            threadId,
            items,
          );
          if (!appliedClaudeItems) {
            return threadId;
          }
          onDebug?.(
            createThreadHistoryReadableSurfaceDebugEntry({
              workspaceId,
              threadId,
              reopenOutcome: "recovered",
              snapshotItemCount: items.length,
              localItemCount: localItems.length,
            }),
          );
        } else {
          markHistoryRecoveryFailure(
            threadId,
            localItems,
            "history-hydrate-empty",
          );
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
        dispatch({
          type: "setThreadHistoryWindow",
          threadId,
          hasMore: claudeRecord.hasMore === true,
          nextCursor: claudeRecord.nextCursor ?? null,
        });

        // Dispatch usage data if available
        const restoredTokenUsage = extractClaudeHistoryTokenUsage(result);
        if (restoredTokenUsage) {
          dispatch({
            type: "setThreadTokenUsage",
            threadId,
            tokenUsage: restoredTokenUsage,
          });
        }
      } catch (error) {
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        const diagnostic =
          error instanceof Error
            ? resolveThreadStabilityDiagnostic(error.message)
            : resolveThreadStabilityDiagnostic(String(error));
        onDebug?.({
          id: `${Date.now()}-claude-history-load-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/claude history load error",
          payload: {
            workspaceId,
            threadId,
            error: error instanceof Error ? error.message : String(error),
            diagnosticCategory: diagnostic?.category ?? "partial_history",
            reopenOutcome:
              localItems.length > 0 ? "degraded-readable" : "failed",
          },
        });
        if (isThreadResumeNotFoundError(error)) {
          const preservedReadableSurface = reconcileMissingClaudeThread(
            workspaceId,
            threadId,
          );
          if (preservedReadableSurface) {
            markHistoryRecoveryFailure(
              threadId,
              localItems,
              "history-load-failed",
            );
          } else {
            setThreadHistoryRecoveryFailed(threadId, false);
          }
          return preservedReadableSurface ? threadId : null;
        }
        markHistoryRecoveryFailure(
          threadId,
          localItems,
          "history-load-failed",
        );
        return threadId;
      }
    }
    setThreadLoaded(threadId, true);
    return threadId;
  }
  if (threadId.startsWith("opencode:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "opencode",
    });
    setThreadLoaded(threadId, true);
    return threadId;
  }
  if (threadId.startsWith("gemini:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "gemini",
    });
    if (!workspacePath) {
      markHistoryRecoveryFailure(
        threadId,
        localItems,
        "history-workspace-path-missing",
      );
      return threadId;
    }
    if (!loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("gemini:".length);
      try {
        const result = await loadGeminiSessionService(
          workspacePath,
          realSessionId,
        );
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        const messagesData =
          (result as { messages?: unknown }).messages ?? result;
        const items = parseGeminiHistoryMessages(messagesData);
        if (items.length > 0) {
          setThreadHistoryRecoveryFailed(threadId, false);
          const appliedGeminiItems = await applyHydratedItems(
            threadId,
            items,
          );
          if (!appliedGeminiItems) {
            return threadId;
          }
        } else {
          markHistoryRecoveryFailure(
            threadId,
            localItems,
            "history-hydrate-empty",
          );
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
      } catch {
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        markHistoryRecoveryFailure(
          threadId,
          localItems,
          "history-load-failed",
        );
        return threadId;
      }
    }
    setThreadLoaded(threadId, true);
    return threadId;
  }
  if (threadId.startsWith("grok:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "grok",
    });
    if (workspacePath && !loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("grok:".length);
      try {
        await runNativeHistoryOpenStages({
          report: (progress) => {
            if (!isCurrentResumeRequest()) {
              return;
            }
            setThreadHistoryLoadingProgress?.(threadId, progress);
          },
          shouldContinue: isCurrentResumeRequest,
          load: () =>
            loadGrokSessionService(workspacePath, realSessionId),
          extractMessages: (payload) =>
            (payload as { messages?: unknown }).messages ?? payload,
          parse: parseGrokHistoryMessages,
          hydrate: async (items) => {
            if (items.length > 0) {
              await applyHydratedItems(threadId, items);
            }
          },
        });
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
      } catch {
        // Failed to load Grok session history — not fatal
      }
    }
    loadedThreadsRef.current[threadId] = true;
    return threadId;
  }
  if (threadId.startsWith("kimi:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "kimi",
    });
    if (workspacePath && !loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("kimi:".length);
      try {
        await runNativeHistoryOpenStages({
          report: (progress) => {
            if (!isCurrentResumeRequest()) {
              return;
            }
            setThreadHistoryLoadingProgress?.(threadId, progress);
          },
          shouldContinue: isCurrentResumeRequest,
          load: () =>
            loadKimiSessionService(workspacePath, realSessionId),
          extractMessages: (payload) =>
            (payload as { messages?: unknown }).messages ?? payload,
          parse: parseKimiHistoryMessages,
          hydrate: async (items) => {
            if (items.length > 0) {
              await applyHydratedItems(threadId, items);
            }
          },
        });
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
      } catch {
        // Failed to load Kimi session history — not fatal
      }
    }
    loadedThreadsRef.current[threadId] = true;
    return threadId;
  }
  if (threadId.startsWith("dsh:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "dsh",
    });
    if (workspacePath && !loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("dsh:".length);
      const reportDshProgress = (progress: HistoryLoadingProgress) => {
        if (!isCurrentResumeRequest()) {
          return;
        }
        setThreadHistoryLoadingProgress?.(threadId, progress);
      };
      const stopPageProgress = subscribeMappedDshHistoryLoadProgress({
        threadId,
        hostSessionId: realSessionId,
        onProgress: reportDshProgress,
      });
      try {
        const staged = await runNativeHistoryOpenStages({
          report: reportDshProgress,
          shouldContinue: isCurrentResumeRequest,
          load: () =>
            loadDshSessionService(workspacePath, realSessionId, {
              limit: DSH_UI_HISTORY_WINDOW,
            }),
          extractMessages: (payload) =>
            (payload as { messages?: unknown }).messages ?? payload,
          parse: parseDshHistoryMessages,
          hydrate: async (items) => {
            if (items.length > 0) {
              await applyHydratedItems(threadId, items);
            }
          },
        });
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        const restoredCurrentModel = extractDshHistoryCurrentModel(
          staged?.result ?? null,
        );
        if (restoredCurrentModel) {
          seedDshComposerSelectionFromHost({
            workspaceId,
            threadId,
            catalogId: restoredCurrentModel.catalogId,
            effort: restoredCurrentModel.effort,
          });
        }
        const restoredTokenUsage = extractDshHistoryTokenUsage(
          staged?.result ?? null,
        );
        if (restoredTokenUsage) {
          dispatch({
            type: "setThreadTokenUsage",
            threadId,
            tokenUsage: restoredTokenUsage,
          });
        } else {
          const restoredTodos = extractDshHistoryTodos(staged?.result ?? null);
          if (restoredTodos !== undefined) {
            dispatch({
              type: "setThreadDshTodos",
              threadId,
              todos: restoredTodos,
            });
          }
        }
        const dshWindow = staged?.result as
          | { hasMore?: boolean; nextCursor?: string | null }
          | null
          | undefined;
        dispatch({
          type: "setThreadHistoryWindow",
          threadId,
          hasMore: dshWindow?.hasMore === true,
          nextCursor: dshWindow?.nextCursor ?? null,
        });
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
      } catch {
        // Failed to load DSH session history — not fatal
      } finally {
        stopPageProgress();
      }
    }
    loadedThreadsRef.current[threadId] = true;
    return threadId;
  }
  if (threadId.startsWith("pi:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "pi",
    });
    if (workspacePath && !loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("pi:".length);
      try {
        await runNativeHistoryOpenStages({
          report: (progress) => {
            if (!isCurrentResumeRequest()) {
              return;
            }
            setThreadHistoryLoadingProgress?.(threadId, progress);
          },
          shouldContinue: isCurrentResumeRequest,
          load: () => loadPiSessionService(workspacePath, realSessionId),
          extractMessages: (payload) => {
            const rawMessages =
              (payload as { messages?: unknown }).messages ?? payload;
            hydrateBackgroundTasksFromHistory(
              workspaceId,
              threadId,
              collectPiHistoryBackgroundTasks(rawMessages),
            );
            return rawMessages;
          },
          parse: parsePiHistoryMessages,
          hydrate: async (items) => {
            if (items.length > 0) {
              await applyHydratedItems(threadId, items);
            }
          },
        });
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
        delete piHistoryLoadFailureCountByThreadRef.current[threadId];
      } catch {
        // harden-pi-session-curtain-fidelity：load 失败不再无条件置
        // loaded——置位会阻止 20s 切回 refresh 与下次选中重试，形成
        // 「吞了刷新也回不来」的 sticky 丢失。降级记录只打 debug entry
        //（不走 markHistoryRecoveryFailure：那会置 automatic-recovery-
        // failed 拦截后续 resume，关死重试通道）；连续失败达上限后置
        // loaded 防风暴。
        const failureCount =
          (piHistoryLoadFailureCountByThreadRef.current[threadId] ?? 0) + 1;
        piHistoryLoadFailureCountByThreadRef.current[threadId] =
          failureCount;
        onDebug?.(
          createThreadHistoryReadableSurfaceDebugEntry({
            workspaceId,
            threadId,
            sourceThreadId: threadId,
            reopenOutcome:
              (itemsByThread[threadId]?.length ?? 0) > 0
                ? "degraded-readable"
                : "failed",
            reasonCode:
              (itemsByThread[threadId]?.length ?? 0) > 0
                ? "last-good-local-items-preserved"
                : "pi-history-load-failed",
            localItemCount: itemsByThread[threadId]?.length ?? 0,
            snapshotItemCount: 0,
            fallbackWarningCount: failureCount,
          }),
        );
        if (failureCount >= PI_HISTORY_LOAD_MAX_ATTEMPTS) {
          setThreadLoaded(threadId, true);
        }
      }
    }
    if (!piHistoryLoadFailureCountByThreadRef.current[threadId]) {
      loadedThreadsRef.current[threadId] = true;
    }
    return threadId;
  }
  if (threadId.startsWith("omp:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "omp",
    });
    if (workspacePath && !loadedThreadsRef.current[threadId]) {
      const realSessionId = threadId.slice("omp:".length);
      try {
        await runNativeHistoryOpenStages({
          report: (progress) => {
            if (!isCurrentResumeRequest()) {
              return;
            }
            setThreadHistoryLoadingProgress?.(threadId, progress);
          },
          shouldContinue: isCurrentResumeRequest,
          load: () => loadOmpSessionService(workspacePath, realSessionId),
          extractMessages: (payload) => {
            const rawMessages =
              (payload as { messages?: unknown }).messages ?? payload;
            hydrateBackgroundTasksFromHistory(
              workspaceId,
              threadId,
              collectPiHistoryBackgroundTasks(rawMessages),
            );
            return rawMessages;
          },
          // omp 与 pi 的 history 载荷同构（pi-family），解析零复制。
          parse: parsePiHistoryMessages,
          hydrate: async (items) => {
            if (items.length > 0) {
              await applyHydratedItems(threadId, items);
            }
          },
        });
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
        delete piHistoryLoadFailureCountByThreadRef.current[threadId];
      } catch {
        // 与 pi 同纪律（harden-pi-session-curtain-fidelity）：load 失败不
        // 无条件置 loaded；omp: 前缀与 pi: 永不冲突，复用同一按线程计数。
        const failureCount =
          (piHistoryLoadFailureCountByThreadRef.current[threadId] ?? 0) + 1;
        piHistoryLoadFailureCountByThreadRef.current[threadId] =
          failureCount;
        onDebug?.(
          createThreadHistoryReadableSurfaceDebugEntry({
            workspaceId,
            threadId,
            sourceThreadId: threadId,
            reopenOutcome:
              (itemsByThread[threadId]?.length ?? 0) > 0
                ? "degraded-readable"
                : "failed",
            reasonCode:
              (itemsByThread[threadId]?.length ?? 0) > 0
                ? "last-good-local-items-preserved"
                : "pi-history-load-failed",
            localItemCount: itemsByThread[threadId]?.length ?? 0,
            snapshotItemCount: 0,
            fallbackWarningCount: failureCount,
          }),
        );
        if (failureCount >= PI_HISTORY_LOAD_MAX_ATTEMPTS) {
          setThreadLoaded(threadId, true);
        }
      }
    }
    if (!piHistoryLoadFailureCountByThreadRef.current[threadId]) {
      loadedThreadsRef.current[threadId] = true;
    }
    return threadId;
  }
  if (threadId.startsWith("qoder:")) {
    dispatch({
      type: "ensureThread",
      workspaceId,
      threadId,
      engine: "qoder",
    });
    if (workspacePath && !loadedThreadsRef.current[threadId]) {
      const storedQoderProviderProfileId =
        latestThreadsByWorkspaceRef.current[workspaceId]?.find(
          (thread) => thread.id === threadId,
        )?.providerProfileId ??
        threadsByWorkspaceRef.current[workspaceId]?.find(
          (thread) => thread.id === threadId,
        )?.providerProfileId ??
        null;
      const qoderIdentity = parseQoderSessionIdentity(
        threadId,
        storedQoderProviderProfileId,
      );
      if (!qoderIdentity) {
        // Embedded profile 与 stored owner 冲突时不回落到 Global，避免同 raw
        // id 的 Global/CN 历史被错误读取。
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      try {
        await runNativeHistoryOpenStages({
          report: (progress) => {
            if (!isCurrentResumeRequest()) {
              return;
            }
            setThreadHistoryLoadingProgress?.(threadId, progress);
          },
          shouldContinue: isCurrentResumeRequest,
          load: () =>
            loadQoderSessionService(
              workspacePath,
              qoderIdentity.rawSessionId,
              qoderIdentity.providerProfileId,
            ),
          extractMessages: (payload) =>
            (payload as { messages?: unknown }).messages ?? payload,
          parse: parseQoderHistoryMessages,
          hydrate: async (items) => {
            if (items.length > 0) {
              await applyHydratedItems(threadId, items);
            }
          },
        });
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        dispatch({
          type: "setThreadHistoryRestoredAt",
          threadId,
          timestamp: Date.now(),
        });
      } catch {
        // Failed to load Qoder session history — not fatal
      }
    }
    loadedThreadsRef.current[threadId] = true;
    return threadId;
  }
  return undefined;
}
