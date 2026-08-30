import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
  type PendingMemoryCapture,
  buildMemoryTurnKey,
  joinPendingAssistantCompletionText,
  memoryDebugLog,
  normalizeAssistantOutputForMemory,
  normalizeDigestSummaryForMemory,
  PENDING_MEMORY_STALE_MS,
  upsertPendingAssistantCompletionSegment,
} from "./threadMemoryCaptureHelpers";
import {
  type PendingAssistantCompletionBucket,
  type PendingMemoryCaptureBucket,
  deletePendingMemoryEntry,
  getPendingMemoryEntries,
  setPendingMemoryEntry,
  shouldKeepPendingCaptureForAdditionalAssistantSegments,
} from "./threadRuntimeOwnershipHelpers";
import {
  workspaceScopedEntries,
  workspaceScopedGet,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";
import { projectMemoryCompleteTurn } from "../../../services/tauri";
import { buildAssistantOutputDigest } from "../../project-memory/utils/outputDigest";
import {
  classifyMemoryImportance,
  classifyMemoryKind,
} from "../../project-memory/utils/memoryKindClassifier";
import {
  shouldMergeOnAssistantCompleted,
  shouldMergeOnInputCapture,
} from "../utils/memoryCaptureRace";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

function normalizeMemoryTurnId(turnId: string | null | undefined) {
  return turnId?.trim() || "__unknown_turn__";
}

function isSameMemoryTurn(
  leftTurnId: string | null | undefined,
  rightTurnId: string | null | undefined,
) {
  return (
    normalizeMemoryTurnId(leftTurnId) === normalizeMemoryTurnId(rightTurnId)
  );
}

type UseThreadsMemoryCaptureOptions = {
  collectRelatedThreadIds: (threadId: string) => string[];
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  rememberThreadAlias: (oldThreadId: string, newThreadId: string) => void;
  renameCompletionEmailIntentThread: (
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  resolveCanonicalThreadId: (threadId: string) => string;
  pendingMemoryCaptureRef: MutableRefObject<
    WorkspaceScopedMap<PendingMemoryCaptureBucket>
  >;
  pendingAssistantCompletionRef: MutableRefObject<
    WorkspaceScopedMap<PendingAssistantCompletionBucket>
  >;
  state: ThreadState;
};

export function useThreadsMemoryCapture({
  collectRelatedThreadIds,
  dispatch,
  getCustomName,
  rememberThreadAlias,
  renameCompletionEmailIntentThread,
  resolveCanonicalThreadId,
  pendingMemoryCaptureRef,
  pendingAssistantCompletionRef,
  state,
}: UseThreadsMemoryCaptureOptions) {
  const renamePendingMemoryCaptureKey = useCallback(
    (oldThreadId: string, newThreadId: string) => {
      renameCompletionEmailIntentThread(oldThreadId, newThreadId);
      rememberThreadAlias(oldThreadId, newThreadId);
      const oldCanonicalThreadId = resolveCanonicalThreadId(oldThreadId);
      const newCanonicalThreadId = resolveCanonicalThreadId(newThreadId);
      const pendingEntries = workspaceScopedEntries(
        pendingMemoryCaptureRef.current,
      ).flatMap(({ workspaceId, threadId, value }) =>
        Object.entries(value)
          .filter(
            ([, entry]) =>
              entry.threadId === oldThreadId ||
              entry.threadId === oldCanonicalThreadId,
          )
          .map(([key, pending]) => ({ workspaceId, threadId, key, pending })),
      );
      if (pendingEntries.length > 0) {
        memoryDebugLog("rename pending capture key", {
          oldThreadId,
          newThreadId,
          count: pendingEntries.length,
        });
        pendingEntries.forEach(({ workspaceId, threadId, key, pending }) => {
          deletePendingMemoryEntry(
            pendingMemoryCaptureRef.current,
            workspaceId,
            threadId,
            key,
          );
          setPendingMemoryEntry(
            pendingMemoryCaptureRef.current,
            workspaceId,
            newCanonicalThreadId,
            buildMemoryTurnKey(newCanonicalThreadId, pending.turnId),
            {
              ...pending,
              threadId: newCanonicalThreadId,
            },
          );
        });
      }
      const completedEntries = workspaceScopedEntries(
        pendingAssistantCompletionRef.current,
      ).flatMap(({ workspaceId, threadId, value }) =>
        Object.entries(value)
          .filter(
            ([, entry]) =>
              entry.threadId === oldThreadId ||
              entry.threadId === oldCanonicalThreadId,
          )
          .map(([key, completed]) => ({
            workspaceId,
            threadId,
            key,
            completed,
          })),
      );
      if (completedEntries.length === 0) {
        return;
      }
      memoryDebugLog("rename pending assistant completion key", {
        oldThreadId,
        newThreadId,
        count: completedEntries.length,
      });
      completedEntries.forEach(({ workspaceId, threadId, key, completed }) => {
        deletePendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          workspaceId,
          threadId,
          key,
        );
        setPendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          workspaceId,
          newCanonicalThreadId,
          buildMemoryTurnKey(newCanonicalThreadId, completed.turnId),
          {
            ...completed,
            threadId: newCanonicalThreadId,
          },
        );
      });
    },
    [
      rememberThreadAlias,
      renameCompletionEmailIntentThread,
      resolveCanonicalThreadId,
    ],
  );

  const mergeMemoryFromPendingCapture = useCallback(
    (
      pending: Omit<PendingMemoryCapture, "createdAt">,
      payload: { threadId: string; itemId: string; text: string },
    ) => {
      const normalizedAssistantOutput = normalizeAssistantOutputForMemory(
        payload.text,
      );
      const digest = buildAssistantOutputDigest(normalizedAssistantOutput);
      const normalizedSummary = digest
        ? normalizeDigestSummaryForMemory(digest.summary) || digest.summary
        : "";
      const mergedDetail = [
        `用户输入：\n${pending.inputText}`,
        `AI 回复：\n${normalizedAssistantOutput}`,
      ].join("\n\n");
      const classifiedKind = classifyMemoryKind(mergedDetail);
      const mergedKind =
        classifiedKind === "note" ? "conversation" : classifiedKind;
      const mergedImportance = classifyMemoryImportance(mergedDetail);

      const mergeWrite = async () => {
        try {
          await projectMemoryCompleteTurn({
            workspaceId: pending.workspaceId,
            threadId: payload.threadId,
            turnId: pending.turnId,
            memoryId: pending.memoryId,
            kind: mergedKind,
            userInput: pending.inputText,
            assistantResponse: normalizedAssistantOutput,
            assistantMessageId: payload.itemId,
            title: digest?.title ?? "",
            summary: normalizedSummary,
            importance: mergedImportance,
            workspaceName: pending.workspaceName,
            workspacePath: pending.workspacePath,
            engine: pending.engine,
          });
          memoryDebugLog("merge write completed turn memory", {
            threadId: payload.threadId,
            turnId: pending.turnId,
            itemId: payload.itemId,
            assistantResponseLength: normalizedAssistantOutput.length,
          });
        } catch (completeErr) {
          if (import.meta.env.DEV) {
            console.warn("[project-memory] merge complete failed:", {
              threadId: payload.threadId,
              error: completeErr,
            });
          }
          memoryDebugLog("merge complete failed", {
            threadId: payload.threadId,
            error:
              completeErr instanceof Error
                ? completeErr.message
                : String(completeErr),
          });
        }
      };

      void mergeWrite();
    },
    [],
  );

  /** 输入侧采集成功后，将 pending 数据存入 ref（仅保留该 thread 最新一条） */
  const handleInputMemoryCaptured = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId: string;
      inputText: string;
      memoryId: string | null;
      workspaceName: string | null;
      workspacePath: string | null;
      engine: string | null;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      const normalizedPayload = {
        ...payload,
        threadId: canonicalThreadId,
      };
      const captureKey = buildMemoryTurnKey(canonicalThreadId, payload.turnId);
      setPendingMemoryEntry(
        pendingMemoryCaptureRef.current,
        payload.workspaceId,
        canonicalThreadId,
        captureKey,
        {
          ...normalizedPayload,
          createdAt: Date.now(),
        },
      );
      const completedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const completedEntry = completedThreadIds
        .flatMap((threadId) =>
          getPendingMemoryEntries(
            pendingAssistantCompletionRef.current,
            payload.workspaceId,
            [threadId],
          )
            .filter(({ entry: completion }) => {
              if (!completion.turnId || !payload.turnId) {
                return true;
              }
              return completion.turnId === payload.turnId;
            })
            .map(({ key, threadId, entry: completion }) => ({
              key,
              threadId,
              completion,
            })),
        )
        .find((entry) => Boolean(entry.completion));
      const nowMs = Date.now();
      if (
        completedEntry?.completion &&
        shouldMergeOnInputCapture(
          completedEntry.completion.createdAt,
          nowMs,
          PENDING_MEMORY_STALE_MS,
        )
      ) {
        const keepPendingCapture =
          shouldKeepPendingCaptureForAdditionalAssistantSegments(
            normalizedPayload,
          );
        completedThreadIds.forEach((threadId) => {
          getPendingMemoryEntries(
            pendingAssistantCompletionRef.current,
            payload.workspaceId,
            [threadId],
          ).forEach(({ key, entry }) => {
            if (isSameMemoryTurn(entry.turnId, payload.turnId)) {
              if (!keepPendingCapture) {
                deletePendingMemoryEntry(
                  pendingAssistantCompletionRef.current,
                  payload.workspaceId,
                  threadId,
                  key,
                );
              }
            }
          });
          getPendingMemoryEntries(
            pendingMemoryCaptureRef.current,
            payload.workspaceId,
            [threadId],
          ).forEach(({ key, entry }) => {
            if (isSameMemoryTurn(entry.turnId, payload.turnId)) {
              const isSameCanonicalEntry = key === captureKey;
              if (!keepPendingCapture || !isSameCanonicalEntry) {
                deletePendingMemoryEntry(
                  pendingMemoryCaptureRef.current,
                  payload.workspaceId,
                  threadId,
                  key,
                );
              }
            }
          });
        });
        memoryDebugLog(
          "capture resolved after assistant completion, merging now",
          {
            threadId: canonicalThreadId,
            itemId: completedEntry.completion.itemId,
            memoryId: normalizedPayload.memoryId,
          },
        );
        mergeMemoryFromPendingCapture(normalizedPayload, {
          ...completedEntry.completion,
          threadId: canonicalThreadId,
          text: joinPendingAssistantCompletionText(completedEntry.completion),
        });
        return;
      }
      if (completedEntry) {
        deletePendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          completedEntry.threadId,
          completedEntry.key,
        );
      }
      memoryDebugLog("input captured", {
        threadId: canonicalThreadId,
        turnId: payload.turnId,
        memoryId: payload.memoryId,
      });
    },
    [
      collectRelatedThreadIds,
      mergeMemoryFromPendingCapture,
      resolveCanonicalThreadId,
    ],
  );

  /**
   * 回合融合写入 —— assistant 输出完成后，与 pending 输入采集合并写入。
   * 优先 update（若输入侧已产生 memoryId），失败则回退 create。
   */
  const handleAgentMessageCompletedForMemory = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId?: string | null;
      itemId: string;
      text: string;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      const completionTurnId = payload.turnId?.trim() || null;
      const sharedThread = (
        state.threadsByWorkspace[payload.workspaceId] ?? []
      ).find((thread) => thread.id === canonicalThreadId);
      if (sharedThread?.threadKind === "shared" && sharedThread.engineSource) {
        dispatch({
          type: "upsertItem",
          workspaceId: payload.workspaceId,
          threadId: canonicalThreadId,
          item: {
            id: payload.itemId,
            kind: "message",
            role: "assistant",
            text: payload.text,
            engineSource: sharedThread.engineSource,
            isFinal: true,
          },
          hasCustomName: Boolean(
            getCustomName(payload.workspaceId, canonicalThreadId),
          ),
        });
      }
      const relatedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const pendingEntry = relatedThreadIds
        .flatMap((threadId) =>
          getPendingMemoryEntries(
            pendingMemoryCaptureRef.current,
            payload.workspaceId,
            [threadId],
          )
            .filter(({ entry: capture }) => {
              if (!completionTurnId || !capture.turnId) {
                return true;
              }
              return capture.turnId === completionTurnId;
            })
            .map(({ key, threadId, entry: capture }) => ({
              key,
              threadId,
              capture,
            })),
        )
        .find((entry) => Boolean(entry.capture));
      if (!pendingEntry?.capture) {
        const completionKey = buildMemoryTurnKey(
          canonicalThreadId,
          completionTurnId,
        );
        const existingBucket = workspaceScopedGet(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          canonicalThreadId,
        );
        setPendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          canonicalThreadId,
          completionKey,
          upsertPendingAssistantCompletionSegment(
            existingBucket?.[completionKey],
            {
              ...payload,
              threadId: canonicalThreadId,
              turnId: completionTurnId,
            },
            Date.now(),
          ),
        );
        memoryDebugLog("assistant completed but no pending capture", {
          threadId: canonicalThreadId,
          turnId: completionTurnId,
          itemId: payload.itemId,
        });
        return;
      }
      if (
        !shouldMergeOnAssistantCompleted(
          pendingEntry.capture.createdAt,
          Date.now(),
          PENDING_MEMORY_STALE_MS,
        )
      ) {
        deletePendingMemoryEntry(
          pendingMemoryCaptureRef.current,
          payload.workspaceId,
          pendingEntry.threadId,
          pendingEntry.key,
        );
        memoryDebugLog("pending capture is stale, skip merge", {
          threadId: pendingEntry.threadId,
          turnId: pendingEntry.capture.turnId,
          itemId: payload.itemId,
        });
        return;
      }
      const completionKey = buildMemoryTurnKey(
        canonicalThreadId,
        pendingEntry.capture.turnId,
      );
      const previousCompletion = workspaceScopedGet(
        pendingAssistantCompletionRef.current,
        payload.workspaceId,
        canonicalThreadId,
      )?.[completionKey];
      const previousAssistantText = previousCompletion
        ? joinPendingAssistantCompletionText(previousCompletion)
        : "";
      const nextCompletion = upsertPendingAssistantCompletionSegment(
        previousCompletion,
        {
          ...payload,
          threadId: canonicalThreadId,
          turnId: pendingEntry.capture.turnId,
        },
        Date.now(),
      );
      setPendingMemoryEntry(
        pendingAssistantCompletionRef.current,
        payload.workspaceId,
        canonicalThreadId,
        completionKey,
        nextCompletion,
      );
      const mergedAssistantText =
        joinPendingAssistantCompletionText(nextCompletion);
      if (previousAssistantText === mergedAssistantText) {
        memoryDebugLog(
          "assistant completed text unchanged, skip memory rewrite",
          {
            threadId: canonicalThreadId,
            turnId: pendingEntry.capture.turnId,
            itemId: payload.itemId,
          },
        );
        return;
      }
      const keepPendingCapture =
        shouldKeepPendingCaptureForAdditionalAssistantSegments(
          pendingEntry.capture,
        );
      relatedThreadIds.forEach((threadId) => {
        getPendingMemoryEntries(
          pendingMemoryCaptureRef.current,
          payload.workspaceId,
          [threadId],
        ).forEach(({ key, entry }) => {
          if (isSameMemoryTurn(entry.turnId, pendingEntry.capture.turnId)) {
            const isSameCanonicalEntry = key === pendingEntry.key;
            if (!keepPendingCapture || !isSameCanonicalEntry) {
              deletePendingMemoryEntry(
                pendingMemoryCaptureRef.current,
                payload.workspaceId,
                threadId,
                key,
              );
            }
          }
        });
        getPendingMemoryEntries(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          [threadId],
        ).forEach(({ key, entry }) => {
          if (isSameMemoryTurn(entry.turnId, pendingEntry.capture.turnId)) {
            if (keepPendingCapture) {
              setPendingMemoryEntry(
                pendingAssistantCompletionRef.current,
                payload.workspaceId,
                threadId,
                key,
                nextCompletion,
              );
            } else {
              deletePendingMemoryEntry(
                pendingAssistantCompletionRef.current,
                payload.workspaceId,
                threadId,
                key,
              );
            }
          }
        });
      });
      mergeMemoryFromPendingCapture(pendingEntry.capture, {
        ...payload,
        threadId: canonicalThreadId,
        text: mergedAssistantText,
      });
    },
    [
      collectRelatedThreadIds,
      dispatch,
      getCustomName,
      mergeMemoryFromPendingCapture,
      resolveCanonicalThreadId,
      state.threadsByWorkspace,
    ],
  );

  return {
    renamePendingMemoryCaptureKey,
    handleInputMemoryCaptured,
    handleAgentMessageCompletedForMemory,
  };
}
