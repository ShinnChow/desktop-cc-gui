import type { MutableRefObject } from "react";
import type { TFunction } from "i18next";
import type { EngineType, WorkspaceInfo } from "../../../types";
import type { ExecutionTarget } from "../../shared-session/target/types";
import { getComposerEnginePrefForEngine } from "../../composer/hooks/composerEnginePrefsStore";
import { pushErrorToast } from "../../../services/toasts";
import {
  recordNativeTurnTarget,
  resolveNativeSendExecutionTarget,
} from "../utils/nativeTurnTargetLedger";
import { appendTurnTargetBadge } from "../utils/turnTargetBadgeStorage";
import {
  resolveDshModelForSend,
  resolveDshSendFallbackCatalogId,
  isLikelyForeignModelForGemini,
  normalizeAccessMode,
  resolveCollaborationModeIdFromPayload,
} from "./threadMessagingHelpers";
import { normalizeEngineScopedEffort } from "./messageRuntimeController";
import { isClaudeForkThreadId } from "../utils/claudeForkThread";
import { parseQoderSessionIdentity } from "../utils/qoderSessionIdentity";
import type {
  SendMessageOptions,
  UseThreadMessagingOptions,
} from "./threadMessagingTypes";

export type NativeResolveContext = {
  resolveComposerSelection: UseThreadMessagingOptions["resolveComposerSelection"];
  model: UseThreadMessagingOptions["model"];
  effort: UseThreadMessagingOptions["effort"];
  collaborationMode: UseThreadMessagingOptions["collaborationMode"];
  accessMode: UseThreadMessagingOptions["accessMode"];
  claudeThinkingVisible: UseThreadMessagingOptions["claudeThinkingVisible"];
  resolveOpenCodeAgent: UseThreadMessagingOptions["resolveOpenCodeAgent"];
  resolveOpenCodeVariant: UseThreadMessagingOptions["resolveOpenCodeVariant"];
  lastOpenCodeModelByThreadRef: MutableRefObject<Map<string, string>>;
  onDebug: UseThreadMessagingOptions["onDebug"];
  t: TFunction;
};

export type NativeSendComposerSelection = {
  threadId?: string | null;
  id?: string | null;
  model: string | null;
  source?: string | null;
  providerProfileId?: string | null;
  effort: string | null;
  collaborationMode: Record<string, unknown> | null;
} | null;

export type NativeSendResolution = {
  resolvedComposerSelection: NativeSendComposerSelection;
  selectedModelId: string | null;
  resolvedEffort: string | null;
  disableThinkingForClaude: boolean;
  sanitizedCollaborationMode: Record<string, unknown> | null;
  userCollaborationMode: "plan" | "code" | null;
  resolvedAccessMode:
    | "default"
    | "read-only"
    | "current"
    | "full-access"
    | undefined;
  resolvedOpenCodeAgent: string | null;
  resolvedOpenCodeVariant: string | null;
  modelForSend: string | null | undefined;
  sanitizedModel: string | null | undefined;
};

export function runNativeSendResolve(
  ctx: NativeResolveContext,
  args: {
    threadId: string;
    threadKind: "native" | "shared";
    options?: SendMessageOptions;
    resolvedEngine: EngineType;
    supportedStoredSharedTarget: ExecutionTarget | null;
  },
): NativeSendResolution {
  const {
    resolveComposerSelection,
    model,
    effort,
    collaborationMode,
    accessMode,
    claudeThinkingVisible,
    resolveOpenCodeAgent,
    resolveOpenCodeVariant,
    lastOpenCodeModelByThreadRef,
    onDebug,
    t,
  } = ctx;
  const {
    threadId,
    threadKind,
    options,
    resolvedEngine,
    supportedStoredSharedTarget,
  } = args;
  const rawComposerSelection = resolveComposerSelection?.(threadId) ?? null;
  // A stale render may still expose the previous native thread snapshot.
  // Do not let it cross the send boundary even if an injected resolver
  // ignores the requested thread argument.
  const resolvedComposerSelection =
    rawComposerSelection?.threadId && rawComposerSelection.threadId !== threadId
      ? null
      : rawComposerSelection;
  const modelFromOptions =
    options?.model !== undefined ? options.model : undefined;
  // resolver 在场时是 Native send 唯一模型权威：禁止回落到全局 / 其他会话 hook model。
  // A frozen native target is the Composer/send boundary contract. Without
  // one, an existing resolver remains authoritative; a mismatched resolver
  // must fail closed rather than falling back to another thread's global model.
  const modelFromHook =
    options?.nativeExecutionTarget?.model?.trim() ||
    options?.nativeExecutionTarget?.modelCatalogEntryId?.trim() ||
    (resolveComposerSelection
      ? resolvedComposerSelection?.model?.trim() ||
        resolvedComposerSelection?.id?.trim() ||
        null
      : model);
  const selectedModelId =
    threadKind === "shared"
      ? (supportedStoredSharedTarget?.modelCatalogEntryId ?? null)
      : options?.nativeExecutionTarget?.modelCatalogEntryId?.trim() ||
        resolvedComposerSelection?.id?.trim() ||
        null;
  const selectedModelSource =
    threadKind === "shared"
      ? (supportedStoredSharedTarget?.providerProfileSource ?? "unknown")
      : (resolvedComposerSelection?.source ?? "unknown");
  const resolvedModel =
    threadKind === "shared" && supportedStoredSharedTarget
      ? (supportedStoredSharedTarget.model ?? null)
      : modelFromOptions !== undefined
        ? modelFromOptions
        : modelFromHook;
  const rawResolvedEffort =
    threadKind === "shared" && supportedStoredSharedTarget
      ? (supportedStoredSharedTarget.reasoning?.effort ?? null)
      : (options?.nativeExecutionTarget?.reasoning?.effort ??
        (options?.effort !== undefined
          ? options.effort
          : (resolvedComposerSelection?.effort ?? effort)));
  const resolvedEffort = normalizeEngineScopedEffort(
    resolvedEngine,
    rawResolvedEffort,
  );
  const disableThinkingForClaude =
    resolvedEngine === "claude" && claudeThinkingVisible === false;
  const resolvedCollaborationMode =
    options?.collaborationMode !== undefined
      ? options.collaborationMode
      : (resolvedComposerSelection?.collaborationMode ?? collaborationMode);
  const sanitizedCollaborationMode =
    resolvedCollaborationMode &&
    typeof resolvedCollaborationMode === "object" &&
    "settings" in resolvedCollaborationMode
      ? resolvedCollaborationMode
      : null;
  const resolvedCollaborationModeIdForSend =
    resolveCollaborationModeIdFromPayload(sanitizedCollaborationMode);
  const userCollaborationMode =
    resolvedEngine === "codex" ? resolvedCollaborationModeIdForSend : null;
  const accessModeForSend =
    resolvedEngine === "claude" && resolvedCollaborationModeIdForSend === "plan"
      ? "read-only"
      : options?.accessMode !== undefined
        ? options.accessMode
        : accessMode;
  const resolvedAccessMode = normalizeAccessMode(
    accessModeForSend,
    resolvedEngine,
  );
  const resolvedOpenCodeAgent =
    resolvedEngine === "opencode"
      ? (resolveOpenCodeAgent?.(threadId) ?? null)
      : null;
  const resolvedOpenCodeVariant =
    resolvedEngine === "opencode"
      ? (resolveOpenCodeVariant?.(threadId) ?? null)
      : null;
  const sanitizeOpenCodeModel = (candidate: string | null | undefined) => {
    if (!candidate) {
      return null;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }
    // Guard against cross-engine leakage like "claude-sonnet-*".
    if (trimmed.startsWith("claude-")) {
      return null;
    }
    return trimmed;
  };
  const sanitizedModel =
    resolvedEngine === "claude" && resolvedModel
      ? resolvedModel.trim() || null
      : resolvedEngine === "codex" &&
          resolvedModel &&
          resolvedModel.startsWith("claude-")
        ? null
        : resolvedEngine === "gemini" &&
            resolvedModel &&
            isLikelyForeignModelForGemini(resolvedModel)
          ? null
          : resolvedModel;
  const sanitizedOpenCodeModel =
    resolvedEngine === "opencode"
      ? sanitizeOpenCodeModel(sanitizedModel)
      : sanitizedModel;
  const modelForSend =
    resolvedEngine === "opencode"
      ? (sanitizedOpenCodeModel ?? "openai/gpt-5.3-codex")
      : resolvedEngine === "dsh"
        ? resolveDshModelForSend({
            // Picker catalog id first: official kimi/minimax must not lose
            // to a stale DeepSeek ledger after a same-id PI catalog collision.
            catalogId: modelFromOptions ?? selectedModelId,
            runtimeModel: selectedModelId ?? sanitizedOpenCodeModel,
            fallbackCatalogId: resolveDshSendFallbackCatalogId(
              threadId,
              getComposerEnginePrefForEngine("dsh").modelId,
            ),
          })
        : sanitizedOpenCodeModel;
  if (resolvedEngine === "opencode") {
    const normalizedModel = (modelForSend ?? "").trim().toLowerCase();
    const prevModel = lastOpenCodeModelByThreadRef.current.get(threadId);
    const isSessionThread = threadId.startsWith("opencode:");
    if (
      isSessionThread &&
      prevModel &&
      normalizedModel &&
      prevModel !== normalizedModel
    ) {
      pushErrorToast({
        title: t("messages.opencodeModelSwitchTitle"),
        message: t("messages.opencodeModelSwitchMessage"),
        durationMs: 3200,
      });
    }
    if (normalizedModel) {
      lastOpenCodeModelByThreadRef.current.set(threadId, normalizedModel);
    }
  }
  if (
    resolvedEngine === "opencode" &&
    resolvedModel &&
    !sanitizedOpenCodeModel
  ) {
    onDebug?.({
      id: `${Date.now()}-client-opencode-model-sanitize`,
      timestamp: Date.now(),
      source: "client",
      label: "model/sanitize",
      payload: {
        reason: "invalid-opencode-model",
        model: resolvedModel,
        fallback: "openai/gpt-5.3-codex",
      },
    });
  }
  onDebug?.({
    id: `${Date.now()}-client-model-resolve`,
    timestamp: Date.now(),
    source: "client",
    label: "model/resolve",
    payload: {
      threadId,
      engine: resolvedEngine,
      selectedModelId,
      selectedModelSource,
      modelFromOptions: modelFromOptions ?? null,
      modelFromHook: modelFromHook ?? null,
      resolvedModel: resolvedModel ?? null,
      sanitizedModel: sanitizedModel ?? null,
      modelForSend: modelForSend ?? null,
    },
  });
  return {
    resolvedComposerSelection,
    selectedModelId,
    resolvedEffort,
    disableThinkingForClaude,
    sanitizedCollaborationMode,
    userCollaborationMode,
    resolvedAccessMode,
    resolvedOpenCodeAgent,
    resolvedOpenCodeVariant,
    modelForSend,
    sanitizedModel,
  };
}

export function recordNativeSendTurnTarget(args: {
  workspace: WorkspaceInfo;
  threadId: string;
  options?: SendMessageOptions;
  resolvedEngine: EngineType;
  providerProfileId: string | null;
  selectedModelId: string | null;
  modelForSend: string | null | undefined;
  sanitizedModel: string | null | undefined;
  sendEffort: string | null;
}): void {
  const {
    workspace,
    threadId,
    options,
    resolvedEngine,
    providerProfileId,
    selectedModelId,
    modelForSend,
    sanitizedModel,
    sendEffort,
  } = args;
  // Native 发送边界固化本轮执行目标（对齐 Shared 的 beginTurn /
  // send.request receipt 时序）：queue drain / recovery resend 等
  // 无 composer options 的路径走 resolved 值兜底合成。
  const nativeTurnExecutionSnapshot = resolveNativeSendExecutionTarget({
    frozen: options?.nativeExecutionTarget ?? null,
    engine: resolvedEngine,
    providerProfileId,
    modelCatalogEntryId: selectedModelId,
    model: modelForSend ?? sanitizedModel,
    effort: sendEffort,
  });
  recordNativeTurnTarget(workspace.id, threadId, nativeTurnExecutionSnapshot);
  appendTurnTargetBadge(threadId, nativeTurnExecutionSnapshot);
}

export type NativeRealSessionContext = {
  geminiSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  grokSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  kimiSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  dshSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  piSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  qoderSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  getThreadProviderProfileId: UseThreadMessagingOptions["getThreadProviderProfileId"];
};

export function resolveNativeRealSessionId(
  ctx: NativeRealSessionContext,
  args: {
    resolvedEngine: EngineType;
    threadId: string;
    isClaudeSession: boolean;
    isOpenCodeSession: boolean;
    workspace: WorkspaceInfo;
  },
): string | null {
  const {
    geminiSessionIdByPendingThreadRef,
    grokSessionIdByPendingThreadRef,
    kimiSessionIdByPendingThreadRef,
    dshSessionIdByPendingThreadRef,
    piSessionIdByPendingThreadRef,
    qoderSessionIdByPendingThreadRef,
    getThreadProviderProfileId,
  } = ctx;
  const { resolvedEngine, threadId, isClaudeSession, isOpenCodeSession, workspace } =
    args;
  const realSessionId =
    resolvedEngine === "claude" && isClaudeSession
      ? threadId.slice("claude:".length)
      : resolvedEngine === "claude" && isClaudeForkThreadId(threadId)
        ? null
        : resolvedEngine === "claude" &&
            threadId.startsWith("claude-pending-")
          ? null
          : resolvedEngine === "gemini" &&
              threadId.startsWith("gemini:")
            ? threadId.slice("gemini:".length)
            : resolvedEngine === "gemini" &&
                threadId.startsWith("gemini-pending-")
              ? (geminiSessionIdByPendingThreadRef.current.get(
                  threadId,
                ) ?? null)
              : resolvedEngine === "grok" &&
                  threadId.startsWith("grok:")
                ? threadId.slice("grok:".length)
                : resolvedEngine === "grok" &&
                    threadId.startsWith("grok-pending-")
                  ? (grokSessionIdByPendingThreadRef.current.get(
                      threadId,
                    ) ?? null)
                  : resolvedEngine === "kimi" &&
                      threadId.startsWith("kimi:")
                    ? threadId.slice("kimi:".length)
                    : resolvedEngine === "kimi" &&
                        threadId.startsWith("kimi-pending-")
                      ? (kimiSessionIdByPendingThreadRef.current.get(
                          threadId,
                        ) ?? null)
                      : resolvedEngine === "dsh" &&
                          threadId.startsWith("dsh:")
                        ? threadId.slice("dsh:".length)
                        : resolvedEngine === "dsh" &&
                            threadId.startsWith("dsh-pending-")
                          ? (dshSessionIdByPendingThreadRef.current.get(
                              threadId,
                            ) ?? null)
                          : resolvedEngine === "pi" &&
                              threadId.startsWith("pi:")
                            ? threadId.slice("pi:".length)
                            : resolvedEngine === "pi" &&
                                threadId.startsWith("pi-pending-")
                              ? (piSessionIdByPendingThreadRef.current.get(
                                  threadId,
                                ) ?? null)
                              : resolvedEngine === "qoder" &&
                                  threadId.startsWith("qoder:")
                                ? (() => {
                                    const threadProviderProfileId =
                                      getThreadProviderProfileId?.(
                                        workspace.id,
                                        threadId,
                                      ) ?? null;
                                    const identity =
                                      parseQoderSessionIdentity(
                                        threadId,
                                        threadProviderProfileId,
                                      );
                                    return identity?.rawSessionId ?? null;
                                  })()
                                : resolvedEngine === "qoder" &&
                                    threadId.startsWith("qoder-pending-")
                                  ? (qoderSessionIdByPendingThreadRef.current.get(
                                      threadId,
                                    ) ?? null)
                              : resolvedEngine === "opencode" &&
                                  isOpenCodeSession
                                ? threadId.slice("opencode:".length)
                                : null;
  return realSessionId;
}
