import type { ThreadSummary } from "../../../types";
import { renameBackgroundTasksForThread } from "../../messages/utils/backgroundTaskStore";
import {
  isCollabWorkerNativeThreadId,
  rememberCollabWorkerNativeThreadId,
} from "../../multi-agent/runtime/collabNativeHideRegistry";
import { isClaudeForkThreadId } from "../utils/claudeForkThread";
import { resolvePendingThreadIdForSession } from "../utils/threadPendingResolution";
import { scheduleRenameTurnFinalMetaThreadId } from "../utils/turnFinalMetaStorage";
import {
  scheduleTombstoneLocalPendingDraftIndexRow,
  writeRemappedClientSessionIndex,
} from "../../../services/tauri/sessionIndex";
import { withThreadStatusDefaults } from "./threadReducerCoreHelpers";
import {
  normalizeEnsureThreadMetadataValue,
  parentThreadIdFromEnsureThreadAction,
  providerBindingFieldsEqual,
  providerBindingFromEnsureThreadAction,
} from "./threadReducerProviderBinding";
import { attachReplacedThreadId } from "./threadReducerThreadIdentity";
import type { ThreadAction, ThreadState } from "./threadReducerTypes";

export function reduceEnsureThread(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "ensureThread" }>,
): ThreadState {
  const hidden =
    state.hiddenThreadIdsByWorkspace[action.workspaceId]?.[action.threadId] ??
    false;
  if (hidden) {
    return state;
  }
  // agent-canvas: 仅作 Inspector 流式键，永不进侧栏
  if (action.threadId.startsWith("agent-canvas:")) {
    return state;
  }
  // 协作 worker native：登记 hide，且禁止 ensure 出侧栏行（防 Agent N 下崽）
  const ensureParent = parentThreadIdFromEnsureThreadAction(action);
  if (
    isCollabWorkerNativeThreadId(action.threadId) ||
    (typeof ensureParent === "string" && ensureParent.startsWith("shared:"))
  ) {
    rememberCollabWorkerNativeThreadId(action.threadId);
    const listNow = state.threadsByWorkspace[action.workspaceId] ?? [];
    const withoutWorker = listNow.filter(
      (thread) => thread.id !== action.threadId,
    );
    if (withoutWorker.length !== listNow.length) {
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: withoutWorker,
        },
      };
    }
    return state;
  }
  const list = state.threadsByWorkspace[action.workspaceId] ?? [];
  const wasReplacedByCanonicalThread = list.some(
    (thread) =>
      thread.id !== action.threadId &&
      (thread.nativeThreadIds ?? []).includes(action.threadId),
  );
  if (wasReplacedByCanonicalThread) {
    return state;
  }
  let existingIndex = list.findIndex((thread) => thread.id === action.threadId);
  if (existingIndex < 0 && !action.threadId.includes(":")) {
    const aliasIndexes = list
      .map((thread, index) => ({ thread, index }))
      .filter(({ thread }) => thread.id.endsWith(`:${action.threadId}`))
      .map(({ index }) => index);
    if (aliasIndexes.length === 1) {
      existingIndex = aliasIndexes[0] ?? -1;
    }
  }
  if (existingIndex >= 0) {
    const existing = list[existingIndex];
    if (!existing) {
      return state;
    }
    // BUG FIX: Only update engineSource if action.engine is explicitly provided
    // AND the existing engineSource is not already set.
    // This prevents inferred engines (from inferEngineFromThreadId) from
    // overwriting explicitly set engines.
    if (
      (!action.engine || existing.engineSource) &&
      action.name === undefined &&
      action.dshAgentPreset === undefined &&
      action.parentThreadId === undefined &&
      action.folderId === undefined &&
      action.autoSession === undefined &&
      action.sourceLabel === undefined &&
      action.providerProfileId === undefined &&
      action.providerProfileSource === undefined &&
      action.providerProfileName === undefined &&
      action.providerAvailability === undefined
    ) {
      return state;
    }
    const ensuredName = normalizeEnsureThreadMetadataValue(action.name);
    const ensuredDshAgentPreset = normalizeEnsureThreadMetadataValue(
      action.dshAgentPreset,
    );
    const ensuredParentThreadId = parentThreadIdFromEnsureThreadAction(action);
    const providerBindingPatch = providerBindingFromEnsureThreadAction(action);
    const updated = {
      ...existing,
      engineSource: existing.engineSource ?? action.engine,
      name: ensuredName ?? existing.name,
      dshAgentPreset: ensuredDshAgentPreset ?? existing.dshAgentPreset,
      parentThreadId:
        ensuredParentThreadId && ensuredParentThreadId !== existing.id
          ? ensuredParentThreadId
          : existing.parentThreadId,
      folderId: action.folderId ?? existing.folderId,
      autoSession: action.autoSession ?? existing.autoSession ?? null,
      ...providerBindingPatch,
    };
    if (
      updated.engineSource === existing.engineSource &&
      updated.name === existing.name &&
      (updated.dshAgentPreset ?? null) === (existing.dshAgentPreset ?? null) &&
      (updated.parentThreadId ?? null) === (existing.parentThreadId ?? null) &&
      updated.folderId === existing.folderId &&
      updated.autoSession === existing.autoSession &&
      providerBindingFieldsEqual(updated, existing)
    ) {
      return state;
    }
    const nextList = [...list];
    nextList[existingIndex] = updated;
    // 同步 parentThreadId → threadParentById（Status / 树兜底与侧栏 summary 同源）
    let nextThreadParentById = state.threadParentById;
    const nextParent = updated.parentThreadId?.trim() || "";
    if (
      nextParent &&
      nextParent !== updated.id &&
      state.threadParentById[updated.id] !== nextParent
    ) {
      nextThreadParentById = {
        ...state.threadParentById,
        [updated.id]: nextParent,
      };
    }
    return {
      ...state,
      threadsByWorkspace: {
        ...state.threadsByWorkspace,
        [action.workspaceId]: nextList,
      },
      ...(nextThreadParentById !== state.threadParentById
        ? { threadParentById: nextThreadParentById }
        : {}),
    };
  }

  // CRITICAL FIX: Handle race condition between renameThreadId and subsequent events.
  // If threadId is engine:{sessionId} but not found, check for pending thread to rename.
  const pendingEngine = action.threadId.startsWith("claude:")
    ? "claude"
    : action.threadId.startsWith("gemini:")
      ? "gemini"
      : action.threadId.startsWith("grok:")
        ? "grok"
        : action.threadId.startsWith("kimi:")
          ? "kimi"
          : action.threadId.startsWith("pi:")
            ? "pi"
            : action.threadId.startsWith("omp:")
              ? "omp"
              : action.threadId.startsWith("qoder:")
              ? "qoder"
              : action.threadId.startsWith("opencode:")
                ? "opencode"
                : action.threadId.startsWith("dsh:")
                  ? "dsh"
                  : null;
  if (pendingEngine) {
    const pendingThreadId = resolvePendingThreadIdForSession({
      workspaceId: action.workspaceId,
      engine: pendingEngine,
      threadsByWorkspace: state.threadsByWorkspace,
      activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
      threadStatusById: state.threadStatusById,
      activeTurnIdByThread: state.activeTurnIdByThread,
      itemsByThread: state.itemsByThread,
    });
    const pendingIndex =
      pendingThreadId === null
        ? -1
        : list.findIndex((thread) => thread.id === pendingThreadId);

    if (pendingIndex >= 0) {
      // Found a pending thread - perform inline rename to avoid race condition
      const pendingThread = list[pendingIndex];
      if (!pendingThread) {
        return state;
      }
      const oldThreadId = pendingThread.id;
      const newThreadId = action.threadId;
      scheduleRenameTurnFinalMetaThreadId(oldThreadId, newThreadId);
      scheduleTombstoneLocalPendingDraftIndexRow(oldThreadId);
      // 后台任务表随迁：pending→final rename 后 watcher/回写改挂新 id。
      renameBackgroundTasksForThread(
        action.workspaceId,
        oldThreadId,
        newThreadId,
      );
      writeRemappedClientSessionIndex({
        workspaceId: action.workspaceId,
        threadId: newThreadId,
        engine: pendingEngine ?? pendingThread.engineSource,
        providerProfileId:
          action.providerProfileId ?? pendingThread.providerProfileId,
        providerProfileName:
          action.providerProfileName ?? pendingThread.providerProfileName,
      });

      // Rename thread inline (similar to renameThreadId action)
      const updatedThread = attachReplacedThreadId(
        {
          ...pendingThread,
          id: newThreadId,
          name:
            normalizeEnsureThreadMetadataValue(action.name) ??
            pendingThread.name,
          dshAgentPreset:
            normalizeEnsureThreadMetadataValue(action.dshAgentPreset) ??
            pendingThread.dshAgentPreset,
          parentThreadId:
            parentThreadIdFromEnsureThreadAction(action) ??
            pendingThread.parentThreadId,
          ...providerBindingFromEnsureThreadAction(action),
        },
        oldThreadId,
      );
      const nextList = [...list];
      nextList[pendingIndex] = updatedThread;

      // Update all related state maps
      const newItemsByThread = { ...state.itemsByThread };
      if (newItemsByThread[oldThreadId]) {
        newItemsByThread[newThreadId] = newItemsByThread[oldThreadId];
        delete newItemsByThread[oldThreadId];
      }

      const newThreadStatusById = { ...state.threadStatusById };
      if (newThreadStatusById[oldThreadId]) {
        newThreadStatusById[newThreadId] = newThreadStatusById[oldThreadId];
        delete newThreadStatusById[oldThreadId];
      }

      const newActiveTurnIdByThread = { ...state.activeTurnIdByThread };
      if (newActiveTurnIdByThread[oldThreadId] !== undefined) {
        newActiveTurnIdByThread[newThreadId] =
          newActiveTurnIdByThread[oldThreadId];
        delete newActiveTurnIdByThread[oldThreadId];
      }

      const newCodexAcceptedTurnByThread = {
        ...state.codexAcceptedTurnByThread,
      };
      if (newCodexAcceptedTurnByThread[oldThreadId]) {
        newCodexAcceptedTurnByThread[newThreadId] =
          newCodexAcceptedTurnByThread[oldThreadId];
        delete newCodexAcceptedTurnByThread[oldThreadId];
      }

      const newActiveThreadIdByWorkspace = {
        ...state.activeThreadIdByWorkspace,
      };
      if (newActiveThreadIdByWorkspace[action.workspaceId] === oldThreadId) {
        newActiveThreadIdByWorkspace[action.workspaceId] = newThreadId;
      }

      const newTokenUsageByThread = { ...state.tokenUsageByThread };
      if (newTokenUsageByThread[oldThreadId]) {
        newTokenUsageByThread[newThreadId] = newTokenUsageByThread[oldThreadId];
        delete newTokenUsageByThread[oldThreadId];
      }

      const newPlanByThread = { ...state.planByThread };
      if (newPlanByThread[oldThreadId] !== undefined) {
        newPlanByThread[newThreadId] = newPlanByThread[oldThreadId];
        delete newPlanByThread[oldThreadId];
      }

      const newLastAgentMessageByThread = { ...state.lastAgentMessageByThread };
      if (newLastAgentMessageByThread[oldThreadId]) {
        newLastAgentMessageByThread[newThreadId] =
          newLastAgentMessageByThread[oldThreadId];
        delete newLastAgentMessageByThread[oldThreadId];
      }

      const newAgentSegmentByThread = { ...state.agentSegmentByThread };
      if (newAgentSegmentByThread[oldThreadId] !== undefined) {
        newAgentSegmentByThread[newThreadId] =
          newAgentSegmentByThread[oldThreadId];
        delete newAgentSegmentByThread[oldThreadId];
      }

      const newThreadParentById = { ...state.threadParentById };
      if (newThreadParentById[oldThreadId]) {
        if (!isClaudeForkThreadId(oldThreadId)) {
          newThreadParentById[newThreadId] = newThreadParentById[oldThreadId];
        }
        delete newThreadParentById[oldThreadId];
      }
      for (const [threadId, parentId] of Object.entries(newThreadParentById)) {
        if (parentId === oldThreadId) {
          newThreadParentById[threadId] = newThreadId;
        }
      }

      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: nextList,
        },
        itemsByThread: newItemsByThread,
        threadStatusById: newThreadStatusById,
        activeTurnIdByThread: newActiveTurnIdByThread,
        codexAcceptedTurnByThread: newCodexAcceptedTurnByThread,
        activeThreadIdByWorkspace: newActiveThreadIdByWorkspace,
        tokenUsageByThread: newTokenUsageByThread,
        planByThread: newPlanByThread,
        lastAgentMessageByThread: newLastAgentMessageByThread,
        agentSegmentByThread: newAgentSegmentByThread,
        threadParentById: newThreadParentById,
      };
    }
  }

  // No existing thread and no pending thread to rename - create new thread
  const fallbackName = action.threadId.startsWith("claude:")
    ? "Claude Session"
    : `Agent ${list.length + 1}`;
  const parentThreadId = parentThreadIdFromEnsureThreadAction(action);
  const createdAt = Date.now();
  const thread: ThreadSummary = {
    id: action.threadId,
    name: normalizeEnsureThreadMetadataValue(action.name) ?? fallbackName,
    // 新建会话用 createdAt 排到顶部；之后只刷新 updatedAt，避免侧栏跳动。
    createdAt,
    updatedAt: createdAt,
    engineSource: action.engine,
    ...(normalizeEnsureThreadMetadataValue(action.dshAgentPreset)
      ? {
          dshAgentPreset: normalizeEnsureThreadMetadataValue(
            action.dshAgentPreset,
          ),
        }
      : {}),
    folderId: action.folderId ?? null,
    autoSession: action.autoSession ?? null,
    ...(parentThreadId ? { parentThreadId } : {}),
    ...providerBindingFromEnsureThreadAction(action),
  };
  // live subagent：summary.parentThreadId 与 threadParentById 必须同事务写入，
  // 否则 Status 树兜底读不到侧栏已有的 children。
  const nextThreadParentById =
    parentThreadId && parentThreadId !== action.threadId
      ? {
          ...state.threadParentById,
          [action.threadId]: parentThreadId,
        }
      : state.threadParentById;
  return {
    ...state,
    threadsByWorkspace: {
      ...state.threadsByWorkspace,
      [action.workspaceId]: [thread, ...list],
    },
    threadStatusById: {
      ...state.threadStatusById,
      [action.threadId]: withThreadStatusDefaults(),
    },
    activeThreadIdByWorkspace: {
      ...state.activeThreadIdByWorkspace,
      [action.workspaceId]:
        state.activeThreadIdByWorkspace[action.workspaceId] ?? action.threadId,
    },
    ...(nextThreadParentById !== state.threadParentById
      ? { threadParentById: nextThreadParentById }
      : {}),
  };
}
