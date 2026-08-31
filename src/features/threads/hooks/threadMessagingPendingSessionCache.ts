import type { MutableRefObject } from "react";
import type { EngineType, WorkspaceInfo } from "../../../types";
import {
  listGeminiSessions as listGeminiSessionsService,
  listGrokSessions as listGrokSessionsService,
  listKimiSessions as listKimiSessionsService,
  listPiSessions as listPiSessionsService,
  listQoderSessions as listQoderSessionsService,
  invalidateSessionIndexForWorkspace as invalidateSessionIndexForWorkspaceService,
} from "../../../services/tauri";
import { parseQoderSessionIdentity } from "../utils/qoderSessionIdentity";
import {
  collectOccupiedGrokSessionIds,
  extractSessionIdFromEngineSendResponse,
  pickLikelyGeminiSessionId,
  pickLikelyGrokSessionId,
  pickLikelyKimiSessionId,
  pickLikelyPiSessionId,
  pickLikelyQoderSessionId,
} from "./threadMessagingHelpers";
import { extractClaudeCandidateSessionId } from "./messageRuntimeController";
import type { UseThreadMessagingOptions } from "./threadMessagingTypes";

export type PendingSessionCacheContext = {
  claudeCandidateSessionIdByPendingThreadRef: MutableRefObject<
    Map<string, string>
  >;
  claudePendingThreadAwaitingNativeSessionRef: MutableRefObject<Set<string>>;
  geminiSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  grokSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  kimiSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  dshSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  piSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  qoderSessionIdByPendingThreadRef: MutableRefObject<Map<string, string>>;
  onDebug: UseThreadMessagingOptions["onDebug"];
};

export async function cachePendingEngineSessionFromResponse(
  ctx: PendingSessionCacheContext,
  args: {
    resolvedEngine: EngineType;
    threadId: string;
    response: Record<string, unknown>;
    workspace: WorkspaceInfo;
    sendRequestedAt: number;
    itemsByThread: UseThreadMessagingOptions["itemsByThread"];
    providerProfileId: string | null;
  },
): Promise<void> {
  const {
    claudeCandidateSessionIdByPendingThreadRef,
    claudePendingThreadAwaitingNativeSessionRef,
    geminiSessionIdByPendingThreadRef,
    grokSessionIdByPendingThreadRef,
    kimiSessionIdByPendingThreadRef,
    dshSessionIdByPendingThreadRef,
    piSessionIdByPendingThreadRef,
    qoderSessionIdByPendingThreadRef,
    onDebug,
  } = ctx;
  const {
    resolvedEngine,
    threadId,
    response,
    workspace,
    sendRequestedAt,
    itemsByThread,
    providerProfileId,
  } = args;
  if (
    resolvedEngine === "claude" &&
    threadId.startsWith("claude-pending-")
  ) {
    const candidateSessionId =
      extractClaudeCandidateSessionId(response);
    if (candidateSessionId) {
      claudeCandidateSessionIdByPendingThreadRef.current.set(
        threadId,
        candidateSessionId,
      );
    }
    claudePendingThreadAwaitingNativeSessionRef.current.add(threadId);
    onDebug?.({
      id: `${Date.now()}-client-claude-session-await-native`,
      timestamp: Date.now(),
      source: "client",
      label: "thread/session awaiting native confirmation",
      payload: {
        workspaceId: workspace.id,
        threadId,
        sessionId: candidateSessionId,
        source: "engineSendMessageResponse",
      },
    });
  }
  if (
    resolvedEngine === "gemini" &&
    threadId.startsWith("gemini-pending-")
  ) {
    let responseSessionId =
      extractSessionIdFromEngineSendResponse(response);
    if (!responseSessionId) {
      const workspacePath = workspace.path?.trim();
      if (workspacePath) {
        try {
          const sessions = await listGeminiSessionsService(
            workspacePath,
            6,
          );
          responseSessionId = pickLikelyGeminiSessionId(
            sessions,
            sendRequestedAt - 120_000,
          );
        } catch {
          responseSessionId = null;
        }
      }
    }
    if (responseSessionId) {
      geminiSessionIdByPendingThreadRef.current.set(
        threadId,
        responseSessionId,
      );
      onDebug?.({
        id: `${Date.now()}-client-gemini-session-cache`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session cached",
        payload: {
          workspaceId: workspace.id,
          threadId,
          sessionId: responseSessionId,
          source: "geminiSessionListFallback",
        },
      });
    }
  }
  if (
    resolvedEngine === "grok" &&
    threadId.startsWith("grok-pending-")
  ) {
    let responseSessionId =
      extractSessionIdFromEngineSendResponse(response);
    if (!responseSessionId) {
      const workspacePath = workspace.path?.trim();
      if (workspacePath) {
        try {
          const occupancy = collectOccupiedGrokSessionIds({
            itemsByThread,
            pendingSessionIdByThread:
              grokSessionIdByPendingThreadRef.current,
            currentThreadId: threadId,
          });
          if (!occupancy.hasOtherPendingWithItems) {
            const sessions = await listGrokSessionsService(
              workspacePath,
              6,
            );
            responseSessionId = pickLikelyGrokSessionId(
              sessions,
              sendRequestedAt - 120_000,
              occupancy.occupiedSessionIds,
            );
          }
        } catch {
          responseSessionId = null;
        }
      }
    }
    if (responseSessionId) {
      grokSessionIdByPendingThreadRef.current.set(
        threadId,
        responseSessionId,
      );
      onDebug?.({
        id: `${Date.now()}-client-grok-session-cache`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session cached",
        payload: {
          workspaceId: workspace.id,
          threadId,
          sessionId: responseSessionId,
          source: "grokSessionListFallback",
        },
      });
    }
  }
  if (
    resolvedEngine === "kimi" &&
    threadId.startsWith("kimi-pending-")
  ) {
    let responseSessionId =
      extractSessionIdFromEngineSendResponse(response);
    if (!responseSessionId) {
      const workspacePath = workspace.path?.trim();
      if (workspacePath) {
        try {
          const sessions = await listKimiSessionsService(
            workspacePath,
            6,
          );
          responseSessionId = pickLikelyKimiSessionId(
            sessions,
            sendRequestedAt - 120_000,
          );
        } catch {
          responseSessionId = null;
        }
      }
    }
    if (responseSessionId) {
      kimiSessionIdByPendingThreadRef.current.set(
        threadId,
        responseSessionId,
      );
      onDebug?.({
        id: `${Date.now()}-client-kimi-session-cache`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session cached",
        payload: {
          workspaceId: workspace.id,
          threadId,
          sessionId: responseSessionId,
          source: "kimiSessionListFallback",
        },
      });
    }
  }
  if (
    resolvedEngine === "dsh" &&
    threadId.startsWith("dsh-pending-")
  ) {
    const rawSessionId =
      extractSessionIdFromEngineSendResponse(response);
    const responseSessionId = rawSessionId?.startsWith("dsh:")
      ? rawSessionId.slice("dsh:".length)
      : rawSessionId;
    if (responseSessionId) {
      dshSessionIdByPendingThreadRef.current.set(
        threadId,
        responseSessionId,
      );
      onDebug?.({
        id: `${Date.now()}-client-dsh-session-cache`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session cached",
        payload: {
          workspaceId: workspace.id,
          threadId,
          sessionId: responseSessionId,
          source: "engineSendMessageResponse",
        },
      });
    }
  }
  if (
    resolvedEngine === "pi" &&
    threadId.startsWith("pi-pending-")
  ) {
    let responseSessionId =
      extractSessionIdFromEngineSendResponse(response);
    if (!responseSessionId) {
      const workspacePath = workspace.path?.trim();
      if (workspacePath) {
        try {
          const sessions = await listPiSessionsService(
            workspacePath,
            6,
          );
          responseSessionId = pickLikelyPiSessionId(
            sessions,
            sendRequestedAt - 120_000,
          );
        } catch {
          responseSessionId = null;
        }
      }
    }
    if (responseSessionId) {
      piSessionIdByPendingThreadRef.current.set(
        threadId,
        responseSessionId,
      );
      if (
        typeof invalidateSessionIndexForWorkspaceService === "function"
      ) {
        void invalidateSessionIndexForWorkspaceService(
          workspace.id,
        ).catch(() => undefined);
      }
      onDebug?.({
        id: `${Date.now()}-client-pi-session-cache`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session cached",
        payload: {
          workspaceId: workspace.id,
          threadId,
          sessionId: responseSessionId,
          source: "piSessionListFallback",
        },
      });
    }
  }
  if (
    resolvedEngine === "qoder" &&
    threadId.startsWith("qoder-pending-")
  ) {
    const responseIdentity = parseQoderSessionIdentity(
      extractSessionIdFromEngineSendResponse(response),
      providerProfileId,
    );
    let responseSessionId = responseIdentity?.rawSessionId ?? null;
    if (!responseSessionId) {
      const workspacePath = workspace.path?.trim();
      if (workspacePath) {
        try {
          const sessions = await listQoderSessionsService(
            workspacePath,
            6,
            providerProfileId,
          );
          responseSessionId = pickLikelyQoderSessionId(
            sessions,
            sendRequestedAt - 120_000,
          );
        } catch {
          responseSessionId = null;
        }
      }
    }
    if (responseSessionId) {
      qoderSessionIdByPendingThreadRef.current.set(
        threadId,
        responseSessionId,
      );
      if (
        typeof invalidateSessionIndexForWorkspaceService === "function"
      ) {
        void invalidateSessionIndexForWorkspaceService(
          workspace.id,
        ).catch(() => undefined);
      }
      onDebug?.({
        id: `${Date.now()}-client-qoder-session-cache`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session cached",
        payload: {
          workspaceId: workspace.id,
          threadId,
          sessionId: responseSessionId,
          source: "qoderSessionListFallback",
        },
      });
    }
  }
}
