import { useEffect } from "react";
import type { i18n, TFunction } from "i18next";
import type { EngineType, WorkspaceInfo } from "../../../types";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";
import {
  SharedActiveAttemptObserverError,
  type SendSharedSessionTurnV2Result,
} from "../../shared-session/runtime/sendSharedSessionTurnV2";
import { subscribeSharedSessionAttemptSettlements } from "../../shared-session/runtime/reattachSharedSessionAttempt";
import { isSharedV2SendEnabled } from "../../shared-session/runtime/sharedV2SendFlag";
import {
  getSharedSendActiveAttemptId,
  getSharedSendState,
  releaseSharedSendAdmission,
  tryAcquireSharedSend,
} from "../../shared-session/runtime/sharedSendStateStore";
import {
  getSharedTargetState,
  selectNextTarget,
} from "../../shared-session/target/targetStore";
import {
  isResolvedExecutionTarget,
  type ExecutionTarget,
} from "../../shared-session/target/types";
import { rememberRuntimeReceipt } from "../utils/runtimeModelReceipt";
import { reconcileAtomicReasoningEffort } from "../../models/atomicModelReasoning";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import { asString } from "../utils/threadNormalize";
import {
  isSharedSessionSupportedEngine,
  normalizeSharedSessionEngine,
} from "../../shared-session/utils/sharedSessionEngines";
import {
  noteSharedProviderRetryTurnSettled,
  noteSharedProviderRetryUserSend,
  cancelSharedProviderRetry,
} from "../../shared-session/provider-retry/noteSharedProviderRetryTurn";
import { workspaceScopedHas } from "./workspaceScopedMap";
import { resolveWorkspaceSpecRoot } from "./threadMessagingSpecRoot";
import { runSquadRequestSend } from "./threadMessagingSharedSquadSend";
import type {
  SendMessageOptions,
  ThreadMessageDispatchResult,
  UseThreadMessagingOptions,
} from "./threadMessagingTypes";

const isThreadMessagingTestMode = (() => {
  try {
    return import.meta.env.MODE === "test";
  } catch {
    return false;
  }
})();
export const shouldEmitThreadMessagingDevLogs = (() => {
  try {
    return import.meta.env.DEV && !isThreadMessagingTestMode;
  } catch {
    return false;
  }
})();

export type SharedSendContext = {
  dispatch: UseThreadMessagingOptions["dispatch"];
  getCustomName: UseThreadMessagingOptions["getCustomName"];
  markProcessing: UseThreadMessagingOptions["markProcessing"];
  setActiveTurnId: UseThreadMessagingOptions["setActiveTurnId"];
  safeMessageActivity: UseThreadMessagingOptions["safeMessageActivity"];
  pushThreadErrorMessage: UseThreadMessagingOptions["pushThreadErrorMessage"];
  onDebug: UseThreadMessagingOptions["onDebug"];
  onSharedDurableTurnCommitted: UseThreadMessagingOptions["onSharedDurableTurnCommitted"];
  onInputMemoryCaptured: UseThreadMessagingOptions["onInputMemoryCaptured"];
  itemsByThread: UseThreadMessagingOptions["itemsByThread"];
  interruptedThreadsRef: UseThreadMessagingOptions["interruptedThreadsRef"];
  i18n: i18n;
  t: TFunction;
};

export function subscribeSharedAttemptSettlementCleanup(params: {
  onSharedDurableTurnCommitted: SharedSendContext["onSharedDurableTurnCommitted"];
  markProcessing: SharedSendContext["markProcessing"];
  setActiveTurnId: SharedSendContext["setActiveTurnId"];
  safeMessageActivity: SharedSendContext["safeMessageActivity"];
}): () => void {
  const {
    onSharedDurableTurnCommitted,
    markProcessing,
    setActiveTurnId,
    safeMessageActivity,
  } = params;
  return subscribeSharedSessionAttemptSettlements(
    ({ workspaceId, threadId, attemptId, runtimeTurnId }) => {
      // Reattachment 绕过原 send Promise；必须复用正常 V2 terminal 的
      // barrier → processing cleanup 顺序，避免迟到 realtime event 复燃 Stop。
      onSharedDurableTurnCommitted?.(threadId, runtimeTurnId);
      if (getSharedSendActiveAttemptId(workspaceId, threadId) !== attemptId) {
        return;
      }
      markProcessing(threadId, false);
      setActiveTurnId(threadId, null);
      safeMessageActivity();
    },
  );
}

export function useSharedAttemptSettlementCleanup(params: {
  onSharedDurableTurnCommitted: SharedSendContext["onSharedDurableTurnCommitted"];
  markProcessing: SharedSendContext["markProcessing"];
  setActiveTurnId: SharedSendContext["setActiveTurnId"];
  safeMessageActivity: SharedSendContext["safeMessageActivity"];
}): void {
  const {
    onSharedDurableTurnCommitted,
    markProcessing,
    setActiveTurnId,
    safeMessageActivity,
  } = params;
  useEffect(
    () =>
      subscribeSharedAttemptSettlementCleanup({
        onSharedDurableTurnCommitted,
        markProcessing,
        setActiveTurnId,
        safeMessageActivity,
      }),
    [
      markProcessing,
      onSharedDurableTurnCommitted,
      safeMessageActivity,
      setActiveTurnId,
    ],
  );
}

export type SharedSendPreflightOutcome =
  | {
      kind: "return";
      result: ThreadMessageDispatchResult;
    }
  | {
      kind: "ok";
      sharedV2SendEnabled: boolean;
      supportedStoredSharedTarget: ExecutionTarget | null;
    };

export async function resolveSharedSendPreflight(
  ctx: SharedSendContext,
  args: {
    workspace: WorkspaceInfo;
    threadId: string;
    threadKind: "native" | "shared";
    messageText: string;
    images: string[];
    options?: SendMessageOptions;
  },
): Promise<SharedSendPreflightOutcome> {
  const {
    onDebug,
    pushThreadErrorMessage,
    safeMessageActivity,
    itemsByThread,
    dispatch,
    getCustomName,
    markProcessing,
    t,
  } = ctx;
  const { workspace, threadId, threadKind, messageText, images, options } =
    args;
  const sharedV2SendEnabled =
    threadKind === "shared" && isSharedV2SendEnabled();
  const storedSharedTarget =
    threadKind === "shared"
      ? (options?.sharedExecutionTarget ??
        getSharedTargetState(workspace.id, threadId).selectedNextTarget)
      : null;
  const supportedStoredSharedTarget =
    storedSharedTarget &&
    isSharedSessionSupportedEngine(storedSharedTarget.engine)
      ? storedSharedTarget
      : null;
  const sharedSendState = sharedV2SendEnabled
    ? getSharedSendState(workspace.id, threadId)
    : null;
  if (sharedSendState && sharedSendState.state !== "idle") {
    onDebug?.({
      id: `${Date.now()}-client-shared-turn-submit-blocked`,
      timestamp: Date.now(),
      source: "client",
      label: "shared-session/turn blocked",
      payload: {
        workspaceId: workspace.id,
        threadId,
        state: sharedSendState.state,
      },
    });
    if (options?.squadRequest) {
      throw new Error(
        `agent-request-busy: Shared Session state=${sharedSendState.state}`,
      );
    }
    return {
      kind: "return",
      result: {
        status: "blocked",
        state: sharedSendState.state,
        reason: "shared-send-not-idle",
      },
    };
  }
  if (storedSharedTarget && !supportedStoredSharedTarget) {
    if (options?.squadRequest) {
      throw new Error(
        "agent-request-target-unavailable: stored Shared Session target is unsupported",
      );
    }
    pushThreadErrorMessage(
      workspace.id,
      threadId,
      "当前 Shared Session 目标暂不可执行，请重新选择可用的 CLI 和 Provider。",
    );
    safeMessageActivity();
    return {
      kind: "return",
      result: {
        status: "target-unavailable",
        reason: "shared-target-unsupported",
      },
    };
  }
  if (
    sharedV2SendEnabled &&
    !isResolvedExecutionTarget(supportedStoredSharedTarget)
  ) {
    if (options?.squadRequest) {
      throw new Error(
        "agent-request-target-incomplete: Shared Session target is incomplete",
      );
    }
    pushThreadErrorMessage(
      workspace.id,
      threadId,
      "当前 Shared Session 目标不完整，请重新选择 CLI、Provider 和 Model。",
    );
    safeMessageActivity();
    return {
      kind: "return",
      result: {
        status: "target-unavailable",
        reason: "shared-target-incomplete",
      },
    };
  }
  if (options?.squadRequest) {
    await runSquadRequestSend({
      workspace,
      threadId,
      threadKind,
      sharedV2SendEnabled,
      supportedStoredSharedTarget,
      messageText,
      images,
      options,
      itemsByThread,
      dispatch,
      getCustomName,
      markProcessing,
      safeMessageActivity,
      t,
    });
    return { kind: "return", result: undefined };
  }
  return { kind: "ok", sharedV2SendEnabled, supportedStoredSharedTarget };
}

export function noteSharedProviderRetryUserSendIfShared(args: {
  workspace: WorkspaceInfo;
  threadId: string;
  threadKind: "native" | "shared";
  options?: SendMessageOptions;
}): void {
  const { workspace, threadId, threadKind, options } = args;
  if (threadKind === "shared") {
    noteSharedProviderRetryUserSend({
      workspaceId: workspace.id,
      threadId,
      originKind: options?.originKind ?? null,
    });
  }
}

export type SharedSendAdmissionOutcome =
  | { acquired: true; revision: number | undefined }
  | { acquired: false };

export function acquireSharedSendAdmission(
  ctx: SharedSendContext,
  args: {
    workspace: WorkspaceInfo;
    threadId: string;
    sharedV2SendEnabled: boolean;
  },
): SharedSendAdmissionOutcome {
  const { onDebug } = ctx;
  const { workspace, threadId, sharedV2SendEnabled } = args;
  let sharedSendAdmissionRevision: number | undefined;
  if (sharedV2SendEnabled) {
    const admission = tryAcquireSharedSend(workspace.id, threadId);
    if (!admission.acquired) {
      onDebug?.({
        id: `${Date.now()}-client-shared-turn-admission-blocked`,
        timestamp: Date.now(),
        source: "client",
        label: "shared-session/turn blocked",
        payload: {
          workspaceId: workspace.id,
          threadId,
          state: admission.state,
          phase: "atomic-admission",
        },
      });
      return { acquired: false };
    }
    sharedSendAdmissionRevision = admission.revision;
    // handoff 前若同步 UI mutation 抛错/早退，精确释放本 caller 的 admission。
    // 正常路径中 V2 在第一个 await 前消费 revision，此 microtask 不会误解锁。
    queueMicrotask(() => {
      releaseSharedSendAdmission(workspace.id, threadId, admission.revision);
    });
  }
  return { acquired: true, revision: sharedSendAdmissionRevision };
}

export type SharedV2SendOutcome =
  | { kind: "return"; result: SendSharedSessionTurnV2Result }
  | { kind: "continue"; response: Record<string, unknown> };

export async function runSharedV2Send(
  ctx: SharedSendContext,
  args: {
    workspace: WorkspaceInfo;
    threadId: string;
    resolvedEngine: EngineType;
    supportedStoredSharedTarget: ExecutionTarget | null;
    sharedV2SendEnabled: boolean;
    resolvedComposerSelection: {
      id?: string | null;
      providerProfileId?: string | null;
    } | null;
    modelForSend: string | null | undefined;
    resolvedEffort: string | null;
    disableThinkingForClaude: boolean;
    sanitizedCollaborationMode: Record<string, unknown> | null;
    resolvedAccessMode:
      | "default"
      | "read-only"
      | "current"
      | "full-access"
      | undefined;
    finalText: string;
    visibleUserText: string;
    finalImages: string[];
    sharedSendAdmissionRevision: number | undefined;
  },
): Promise<SharedV2SendOutcome> {
  const {
    dispatch,
    markProcessing,
    setActiveTurnId,
    safeMessageActivity,
    onDebug,
    onSharedDurableTurnCommitted,
    onInputMemoryCaptured,
    i18n,
  } = ctx;
  const {
    workspace,
    threadId,
    resolvedEngine,
    supportedStoredSharedTarget,
    sharedV2SendEnabled,
    resolvedComposerSelection,
    modelForSend,
    resolvedEffort,
    disableThinkingForClaude,
    sanitizedCollaborationMode,
    resolvedAccessMode,
    finalText,
    visibleUserText,
    finalImages,
    sharedSendAdmissionRevision,
  } = args;
  let response: Record<string, unknown>;
  const sharedResolvedEngine = normalizeSharedSessionEngine(
    supportedStoredSharedTarget?.engine ?? resolvedEngine,
  );
  dispatch({
    type: "setThreadEngine",
    workspaceId: workspace.id,
    threadId,
    engine: sharedResolvedEngine,
  });
  // Shared Picker 写入的 selectedNextTarget 是下一轮唯一权威输入。
  // 旧的全局 Composer selection 可能仍指向上一个 CLI/Provider，不能在
  // send boundary 重新组装并覆盖用户刚选中的 Target。
  // effort：对 Codex catalog 模型在 send 边界再 reconcile 一次，
  // 避免 hydrate 遗留 null / 非法档位直送 CLI。
  const sharedTargetBase = supportedStoredSharedTarget ?? {
    engine: sharedResolvedEngine,
    providerProfileId:
      resolvedComposerSelection?.providerProfileId?.trim() || null,
    model: modelForSend ?? null,
    modelCatalogEntryId: resolvedComposerSelection?.id?.trim() || null,
    reasoning: resolvedEffort ? { effort: resolvedEffort } : null,
  };
  const sharedReconciledEffort = reconcileAtomicReasoningEffort({
    engine: sharedTargetBase.engine,
    model: {
      id:
        sharedTargetBase.modelCatalogEntryId?.trim() ||
        sharedTargetBase.model?.trim() ||
        null,
      model: sharedTargetBase.model?.trim() || null,
    },
    effort: sharedTargetBase.reasoning?.effort ?? null,
  });
  const sharedNextTarget = {
    ...sharedTargetBase,
    reasoning: sharedReconciledEffort
      ? { effort: sharedReconciledEffort }
      : null,
  };
  if (!sharedV2SendEnabled && !supportedStoredSharedTarget) {
    selectNextTarget(workspace.id, threadId, sharedNextTarget);
  }
  rememberRuntimeReceipt(workspace.id, threadId, {
    model: sharedNextTarget.model ?? undefined,
    modelSource: "send.request",
  });
  response = (await sendSharedSessionTurnRouted({
    workspaceId: workspace.id,
    threadId,
    engine: sharedResolvedEngine,
    text: finalText,
    model: sharedNextTarget.model ?? null,
    effort: sharedNextTarget.reasoning?.effort ?? null,
    disableThinking: disableThinkingForClaude,
    collaborationMode: sanitizedCollaborationMode,
    accessMode: resolvedAccessMode,
    images: finalImages,
    preferredLanguage: i18n.language.toLowerCase().startsWith("zh")
      ? "zh"
      : "en",
    customSpecRoot: resolveWorkspaceSpecRoot(workspace.id),
    sharedSendAdmissionRevision,
    target: sharedNextTarget,
  })) as Record<string, unknown>;
  // V2 begin 早退（recovery-required / target-unavailable）：编排层已驱动
  // send 状态机，这里不按发送失败处理，也不抛出；复位 processing，
  // 让 Composer 按状态机渲染恢复/不可用 UI。
  if (
    sharedV2SendEnabled &&
    (response?.status === "blocked" ||
      response?.status === "recovery-required" ||
      response?.status === "target-unavailable")
  ) {
    markProcessing(threadId, false);
    setActiveTurnId(threadId, null);
    safeMessageActivity();
    cancelSharedProviderRetry(workspace.id, threadId, "idle");
    return {
      kind: "return",
      result: response as SendSharedSessionTurnV2Result,
    };
  }
  const sharedNativeThreadId = asString(response?.nativeThreadId ?? "").trim();
  if (sharedNativeThreadId && !sharedNativeThreadId.startsWith("shared:")) {
    dispatch({
      type: "hideThread",
      workspaceId: workspace.id,
      threadId: sharedNativeThreadId,
    });
  }

  onDebug?.({
    id: `${Date.now()}-server-shared-turn-start`,
    timestamp: Date.now(),
    source: "server",
    label: "shared-session/turn/start response",
    payload: response,
  });
  const sharedV2Result =
    response.v2 && typeof response.v2 === "object"
      ? (response.v2 as Record<string, unknown>)
      : null;
  if (sharedV2SendEnabled && sharedV2Result?.committed === true) {
    // Shared V2 command 直到 Runtime terminal 被 canonical commit 后才返回。
    // 先用 exact Runtime identity 建立 terminal barrier，避免已排队的
    // assistant/reasoning/item event 在 UI cleanup 后复燃 Stop。
    const sharedRuntimeTurnId = asString(response.runtimeTurnId ?? "").trim();
    if (sharedRuntimeTurnId) {
      onSharedDurableTurnCommitted?.(threadId, sharedRuntimeTurnId);
    } else {
      onDebug?.({
        id: `${Date.now()}-shared-durable-terminal-runtime-id-missing`,
        timestamp: Date.now(),
        source: "error",
        label: "shared-session/durable-terminal-runtime-id-missing",
        payload: {
          workspaceId: workspace.id,
          threadId,
          attemptId: asString(sharedV2Result.attemptId).trim() || null,
          logicalTurnId: asString(sharedV2Result.logicalTurnId).trim() || null,
        },
      });
    }
    // Project-memory input capture for shared V2 (native path is skipped
    // by this early return). Prefer runtimeTurnId so fusion matches
    // turn/completed / onAgentMessageCompleted turnId.
    const sharedMemoryTurnId =
      sharedRuntimeTurnId || asString(sharedV2Result.logicalTurnId).trim();
    if (sharedMemoryTurnId && visibleUserText.trim()) {
      void projectMemoryFacade
        .captureTurnInput({
          workspaceId: workspace.id,
          userInput: visibleUserText,
          threadId,
          turnId: sharedMemoryTurnId,
          workspaceName: workspace.name ?? null,
          workspacePath: workspace.path ?? null,
          engine: sharedResolvedEngine,
        })
        .then((captured) => {
          onInputMemoryCaptured?.({
            workspaceId: workspace.id,
            threadId,
            turnId: sharedMemoryTurnId,
            inputText: visibleUserText,
            memoryId: captured?.id ?? null,
            workspaceName: workspace.name ?? null,
            workspacePath: workspace.path ?? null,
            engine: sharedResolvedEngine,
          });
        })
        .catch((err) => {
          if (shouldEmitThreadMessagingDevLogs) {
            console.warn("[project-memory] shared auto capture failed:", err);
          }
        });
    }
    // 此处只收敛 Shared UI projection；不得落入 Native turn-start lifecycle。
    markProcessing(threadId, false);
    setActiveTurnId(threadId, null);
    safeMessageActivity();
    return {
      kind: "return",
      result: response as SendSharedSessionTurnV2Result,
    };
  }
  // Shared V1 (or V2 without committed): still capture input when we have
  // a stable turn identity; native capture block is not reached.
  const sharedV1MemoryTurnId =
    asString(response.runtimeTurnId ?? "").trim() ||
    asString(sharedV2Result?.logicalTurnId).trim() ||
    asString(response.logicalTurnId ?? response.turnId ?? "").trim();
  if (sharedV1MemoryTurnId && visibleUserText.trim()) {
    void projectMemoryFacade
      .captureTurnInput({
        workspaceId: workspace.id,
        userInput: visibleUserText,
        threadId,
        turnId: sharedV1MemoryTurnId,
        workspaceName: workspace.name ?? null,
        workspacePath: workspace.path ?? null,
        engine: sharedResolvedEngine,
      })
      .then((captured) => {
        onInputMemoryCaptured?.({
          workspaceId: workspace.id,
          threadId,
          turnId: sharedV1MemoryTurnId,
          inputText: visibleUserText,
          memoryId: captured?.id ?? null,
          workspaceName: workspace.name ?? null,
          workspacePath: workspace.path ?? null,
          engine: sharedResolvedEngine,
        });
      })
      .catch((err) => {
        if (shouldEmitThreadMessagingDevLogs) {
          console.warn("[project-memory] shared auto capture failed:", err);
        }
      });
  }
  return { kind: "continue", response };
}

export function resolveSharedActiveLifecycleCatch(
  ctx: SharedSendContext,
  args: {
    workspace: WorkspaceInfo;
    threadId: string;
    threadKind: "native" | "shared";
    error: unknown;
    rawMessage: string;
  },
): ThreadMessageDispatchResult | null {
  const { onDebug, safeMessageActivity } = ctx;
  const { workspace, threadId, threadKind, error, rawMessage } = args;
  const preserveSharedActiveLifecycle =
    threadKind === "shared" &&
    error instanceof SharedActiveAttemptObserverError &&
    getSharedSendActiveAttemptId(workspace.id, threadId) === error.attemptId;
  if (preserveSharedActiveLifecycle) {
    // Runtime 已 accepted；这里只是 frontend observer 脱离。禁止把它投影成
    // Turn failure 或清 processing，recovery card 负责 exact-Attempt reattach。
    onDebug?.({
      id: `${Date.now()}-shared-terminal-observer-detached`,
      timestamp: Date.now(),
      source: "error",
      label: "shared terminal observer detached",
      payload: {
        threadId,
        attemptId: error.attemptId,
        rawMessage,
      },
    });
    safeMessageActivity();
    return {
      status: "ambiguous-error",
      reason: rawMessage,
    };
  }
  return null;
}

export function settleSharedSendFailure(
  ctx: SharedSendContext,
  args: {
    workspace: WorkspaceInfo;
    threadId: string;
    resolvedEngine: EngineType;
    supportedStoredSharedTarget: ExecutionTarget | null;
    options?: SendMessageOptions;
    rawMessage: string;
  },
): ThreadMessageDispatchResult {
  const { interruptedThreadsRef } = ctx;
  const {
    workspace,
    threadId,
    resolvedEngine,
    supportedStoredSharedTarget,
    options,
    rawMessage,
  } = args;
  noteSharedProviderRetryTurnSettled({
    workspaceId: workspace.id,
    threadId,
    engine: resolvedEngine,
    providerProfileId:
      supportedStoredSharedTarget?.providerProfileId ??
      getSharedTargetState(workspace.id, threadId).selectedNextTarget
        ?.providerProfileId ??
      null,
    model:
      supportedStoredSharedTarget?.model ??
      getSharedTargetState(workspace.id, threadId).selectedNextTarget?.model ??
      null,
    message: rawMessage,
    outcome: "failed",
    wasLocalInterrupt: workspaceScopedHas(
      interruptedThreadsRef.current,
      workspace.id,
      threadId,
    ),
    originKind: options?.originKind ?? null,
  });
  return {
    status: "ambiguous-error",
    reason: rawMessage,
  };
}
