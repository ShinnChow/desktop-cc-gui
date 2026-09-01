import { isEngineExecutionEnabled } from "../../utils/engineExecutionPolicy";

type ManualRecoveryEngine = "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
type ManualRecoveryWorkspace = {
  id: string;
  connected: boolean;
};
type ManualRecoveryResendMessage = {
  text: string;
  images?: string[];
};
type ManualRecoveryResendOptions = {
  suppressUserMessageRender: boolean;
  skipOptimisticUserBubble: boolean;
};

export type ManualThreadRecoveryResult =
  | { kind: "rebound"; threadId: string; retryable: false; userAction: "retry" }
  | {
      kind: "forked";
      threadId: string;
      retryable: true;
      userAction: "start-fresh-thread";
    }
  | {
      kind: "fresh";
      threadId: string;
      retryable: true;
      userAction: "start-fresh-thread";
    }
  | {
      kind: "failed";
      reason?: string | null;
      retryable: boolean;
      userAction: "recover-thread" | "start-fresh-thread";
    };

export function shouldSuppressManualRecoveryResendUserMessage(
  result: ManualThreadRecoveryResult,
): boolean {
  return result.kind === "rebound";
}

function normalizeManualRecoveryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function inferManualRecoveryEngine(
  workspaceId: string,
  threadId: string,
  threadsByWorkspace: Record<string, Array<{ id: string; engineSource?: ManualRecoveryEngine }>>,
): ManualRecoveryEngine {
  const thread = (threadsByWorkspace[workspaceId] ?? []).find((entry) => entry.id === threadId);
  if (thread?.engineSource) {
    return thread.engineSource;
  }
  const normalizedThreadId = threadId.trim().toLowerCase();
  if (normalizedThreadId.startsWith("claude:") || normalizedThreadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (normalizedThreadId.startsWith("gemini:") || normalizedThreadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (normalizedThreadId.startsWith("grok:") || normalizedThreadId.startsWith("grok-pending-")) {
    return "grok";
  }
  if (normalizedThreadId.startsWith("kimi:") || normalizedThreadId.startsWith("kimi-pending-")) {
    return "kimi";
  }
  if (normalizedThreadId.startsWith("pi:") || normalizedThreadId.startsWith("pi-pending-")) {
    return "pi";
  }
  if (normalizedThreadId.startsWith("omp:") || normalizedThreadId.startsWith("omp-pending-")) {
    return "omp";
  }
  if (normalizedThreadId.startsWith("opencode:") || normalizedThreadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  if (normalizedThreadId.startsWith("dsh:") || normalizedThreadId.startsWith("dsh-pending-")) {
    return "dsh";
  }
  if (normalizedThreadId.startsWith("qoder:") || normalizedThreadId.startsWith("qoder-pending-")) {
    return "qoder";
  }
  return "codex";
}

function buildManualRecoveryFailure(
  reason: string | null,
  allowFreshThread: boolean,
): ManualThreadRecoveryResult {
  return {
    kind: "failed",
    reason,
    retryable: true,
    userAction: allowFreshThread ? "start-fresh-thread" : "recover-thread",
  };
}

type ManualRecoveryThreadMeta = {
  id: string;
  engineSource?: ManualRecoveryEngine;
  providerProfileId?: string | null;
};

function resolveManualRecoveryProviderProfileId(
  workspaceId: string,
  threadId: string,
  threadsByWorkspace: Record<string, ManualRecoveryThreadMeta[]>,
): string | null {
  const thread = (threadsByWorkspace[workspaceId] ?? []).find((entry) => entry.id === threadId);
  const providerProfileId = thread?.providerProfileId?.trim() || "";
  return providerProfileId || null;
}

/**
 * Recovery-card Fork path: explicit continuation without forced resend.
 * Prefer native fork; if the dead parent cannot be forked, start a fresh thread.
 */
export async function continueStaleThreadBindingForManualRecovery(params: {
  workspaceId: string;
  threadId: string;
  threadsByWorkspace: Record<string, ManualRecoveryThreadMeta[]>;
  forkThreadForWorkspace?: (
    workspaceId: string,
    threadId: string,
    options?: {
      activate?: boolean;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: ManualRecoveryEngine;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
}): Promise<ManualThreadRecoveryResult> {
  const normalizedWorkspaceId = params.workspaceId.trim();
  const normalizedThreadId = params.threadId.trim();
  if (!normalizedWorkspaceId || !normalizedThreadId) {
    return buildManualRecoveryFailure("missing workspace or thread id", true);
  }

  const recoveryEngine = inferManualRecoveryEngine(
    normalizedWorkspaceId,
    normalizedThreadId,
    params.threadsByWorkspace,
  );
  if (!isEngineExecutionEnabled(recoveryEngine)) {
    return buildManualRecoveryFailure("unsupported_engine", true);
  }

  const providerProfileId = resolveManualRecoveryProviderProfileId(
    normalizedWorkspaceId,
    normalizedThreadId,
    params.threadsByWorkspace,
  );
  const providerOptions = providerProfileId ? { providerProfileId } : {};

  let forkErrorMessage: string | null = null;
  if (params.forkThreadForWorkspace) {
    try {
      const forkedThreadId = await params.forkThreadForWorkspace(
        normalizedWorkspaceId,
        normalizedThreadId,
        { activate: true, ...providerOptions },
      );
      const normalizedForkedThreadId =
        typeof forkedThreadId === "string" ? forkedThreadId.trim() : "";
      if (normalizedForkedThreadId) {
        return {
          kind: "forked",
          threadId: normalizedForkedThreadId,
          retryable: true,
          userAction: "start-fresh-thread",
        };
      }
      forkErrorMessage = "fork thread unavailable";
    } catch (error) {
      forkErrorMessage = normalizeManualRecoveryError(error);
      console.warn(
        "[thread-recovery] Native fork failed for stale parent; trying fresh continuation",
        forkErrorMessage,
      );
    }
  }

  let freshThreadId: string | null = null;
  let freshErrorMessage: string | null = null;
  try {
    freshThreadId = await params.startThreadForWorkspace(normalizedWorkspaceId, {
      activate: true,
      engine: recoveryEngine,
      ...providerOptions,
    });
  } catch (error) {
    freshErrorMessage = normalizeManualRecoveryError(error);
  }

  const normalizedFreshThreadId =
    typeof freshThreadId === "string" ? freshThreadId.trim() : "";
  if (normalizedFreshThreadId) {
    return {
      kind: "fresh",
      threadId: normalizedFreshThreadId,
      retryable: true,
      userAction: "start-fresh-thread",
    };
  }

  return buildManualRecoveryFailure(
    freshErrorMessage || "fresh thread unavailable",
    true,
  );
}

export async function recoverThreadBindingForManualRecovery(params: {
  workspaceId: string;
  threadId: string;
  threadsByWorkspace: Record<string, Array<{ id: string; engineSource?: ManualRecoveryEngine }>>;
  refreshThread: (workspaceId: string, threadId: string) => Promise<string | null>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: ManualRecoveryEngine;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
  allowFreshThread?: boolean;
}): Promise<ManualThreadRecoveryResult> {
  const normalizedWorkspaceId = params.workspaceId.trim();
  const normalizedThreadId = params.threadId.trim();
  const allowFreshThread = params.allowFreshThread === true;
  if (!normalizedWorkspaceId || !normalizedThreadId) {
    return buildManualRecoveryFailure("missing workspace or thread id", allowFreshThread);
  }
  const recoveryEngine = inferManualRecoveryEngine(
    normalizedWorkspaceId,
    normalizedThreadId,
    params.threadsByWorkspace,
  );
  if (!isEngineExecutionEnabled(recoveryEngine)) {
    return buildManualRecoveryFailure("unsupported_engine", allowFreshThread);
  }

  let recoveredThreadId: string | null = null;
  let refreshErrorMessage: string | null = null;
  try {
    recoveredThreadId = await params.refreshThread(normalizedWorkspaceId, normalizedThreadId);
  } catch (error) {
    refreshErrorMessage = normalizeManualRecoveryError(error);
    recoveredThreadId = null;
  }
  const normalizedRecoveredThreadId =
    typeof recoveredThreadId === "string" ? recoveredThreadId.trim() : "";
  if (normalizedRecoveredThreadId) {
    return {
      kind: "rebound",
      threadId: normalizedRecoveredThreadId,
      retryable: false,
      userAction: "retry",
    };
  }
  if (!allowFreshThread) {
    return buildManualRecoveryFailure(
      refreshErrorMessage ?? "no verified replacement thread",
      allowFreshThread,
    );
  }
  let freshThreadId: string | null = null;
  try {
    freshThreadId = await params.startThreadForWorkspace(normalizedWorkspaceId, {
      activate: true,
      engine: recoveryEngine,
    });
  } catch (error) {
    return buildManualRecoveryFailure(normalizeManualRecoveryError(error), allowFreshThread);
  }
  const normalizedFreshThreadId =
    typeof freshThreadId === "string" ? freshThreadId.trim() : "";
  return normalizedFreshThreadId
    ? {
        kind: "fresh",
        threadId: normalizedFreshThreadId,
        retryable: true,
        userAction: "start-fresh-thread",
      }
    : buildManualRecoveryFailure(
        refreshErrorMessage ?? "fresh thread unavailable",
        allowFreshThread,
      );
}

export async function recoverThreadBindingAndResendForManualRecovery<
  Workspace extends ManualRecoveryWorkspace,
>(params: {
  workspaceId: string;
  threadId: string;
  message: ManualRecoveryResendMessage;
  threadsByWorkspace: Record<string, Array<{ id: string; engineSource?: ManualRecoveryEngine }>>;
  resolveWorkspace: (workspaceId: string) => Workspace | null;
  refreshThread: (workspaceId: string, threadId: string) => Promise<string | null>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: ManualRecoveryEngine;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
  forkThreadForWorkspace?: (
    workspaceId: string,
    threadId: string,
    options?: {
      activate?: boolean;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
  connectWorkspace: (workspace: Workspace) => Promise<void>;
  sendUserMessageToThread: (
    workspace: Workspace,
    threadId: string,
    text: string,
    images: string[],
    options: ManualRecoveryResendOptions,
  ) => Promise<unknown>;
}): Promise<ManualThreadRecoveryResult> {
  const normalizedWorkspaceId = params.workspaceId.trim();
  const normalizedThreadId = params.threadId.trim();
  const nextText = params.message.text.trim();
  const nextImages = params.message.images ?? [];
  if (!normalizedWorkspaceId || !normalizedThreadId) {
    return buildManualRecoveryFailure("missing workspace or thread id", true);
  }
  if (!nextText && nextImages.length === 0) {
    return buildManualRecoveryFailure("missing message to resend", true);
  }
  const recoveryEngine = inferManualRecoveryEngine(
    normalizedWorkspaceId,
    normalizedThreadId,
    params.threadsByWorkspace,
  );
  if (!isEngineExecutionEnabled(recoveryEngine)) {
    return buildManualRecoveryFailure("unsupported_engine", true);
  }

  const workspace = params.resolveWorkspace(normalizedWorkspaceId);
  if (!workspace) {
    return buildManualRecoveryFailure("workspace unavailable", true);
  }

  const recoveryResult = await recoverThreadBindingForManualRecovery({
    workspaceId: normalizedWorkspaceId,
    threadId: normalizedThreadId,
    threadsByWorkspace: params.threadsByWorkspace,
    refreshThread: params.refreshThread,
    startThreadForWorkspace: params.startThreadForWorkspace,
    allowFreshThread: false,
  });

  let continuationResult = recoveryResult;
  if (
    continuationResult.kind === "failed" &&
    recoveryEngine === "codex" &&
    params.forkThreadForWorkspace
  ) {
    try {
      const forkedThreadId = await params.forkThreadForWorkspace(
        normalizedWorkspaceId,
        normalizedThreadId,
        { activate: true },
      );
      const normalizedForkedThreadId =
        typeof forkedThreadId === "string" ? forkedThreadId.trim() : "";
      if (normalizedForkedThreadId) {
        continuationResult = {
          kind: "forked",
          threadId: normalizedForkedThreadId,
          retryable: true,
          userAction: "start-fresh-thread",
        };
      }
    } catch (error) {
      console.warn(
        "[thread-recovery] Failed to fork stale Codex thread before fresh fallback",
        normalizeManualRecoveryError(error),
      );
      continuationResult = recoveryResult;
    }
  }
  if (continuationResult.kind === "failed") {
    const freshResult = await recoverThreadBindingForManualRecovery({
      workspaceId: normalizedWorkspaceId,
      threadId: normalizedThreadId,
      threadsByWorkspace: params.threadsByWorkspace,
      refreshThread: async () => null,
      startThreadForWorkspace: params.startThreadForWorkspace,
      allowFreshThread: true,
    });
    continuationResult = freshResult;
  }
  if (continuationResult.kind === "failed") {
    return continuationResult;
  }

  const targetThreadId = continuationResult.threadId.trim();
  if (!targetThreadId) {
    return buildManualRecoveryFailure("recovery target unavailable", true);
  }

  try {
    if (!workspace.connected) {
      await params.connectWorkspace(workspace);
    }
    const suppressRecoveredUserMessage =
      shouldSuppressManualRecoveryResendUserMessage(continuationResult);
    await params.sendUserMessageToThread(
      workspace,
      targetThreadId,
      nextText,
      nextImages,
      {
        suppressUserMessageRender: suppressRecoveredUserMessage,
        skipOptimisticUserBubble: suppressRecoveredUserMessage,
      },
    );
  } catch (error) {
    return buildManualRecoveryFailure(normalizeManualRecoveryError(error), true);
  }

  return continuationResult;
}
