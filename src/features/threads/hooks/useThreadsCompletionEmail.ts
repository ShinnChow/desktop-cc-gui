import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type {
  ConversationItem,
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { type ConversationCompletionEmailMetadata } from "../utils/conversationCompletionEmail";
import { useThreadCompletionEmail } from "./useThreadCompletionEmail";

type UseThreadsCompletionEmailOptions = {
  activeThreadId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  activeEngine:
    | "claude"
    | "codex"
    | "gemini"
    | "grok"
    | "kimi"
    | "opencode"
    | "pi"
    | "dsh"
    | "qoder";
  activeTurnIdByThreadRef: MutableRefObject<Record<string, string | null>>;
  itemsByThreadRef: MutableRefObject<Record<string, ConversationItem[]>>;
  threadsByWorkspaceRef: MutableRefObject<Record<string, ThreadSummary[]>>;
  resolveCanonicalThreadId: (threadId: string) => string;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  onDebug?: (entry: DebugEntry) => void;
};

export function useThreadsCompletionEmail({
  activeThreadId,
  activeWorkspace,
  activeEngine,
  activeTurnIdByThreadRef,
  itemsByThreadRef,
  threadsByWorkspaceRef,
  resolveCanonicalThreadId,
  setActiveTurnId,
  onDebug,
}: UseThreadsCompletionEmailOptions) {
  const getCompletionEmailMetadata = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
    ): ConversationCompletionEmailMetadata => {
      const threadSummary =
        (threadsByWorkspaceRef.current[workspaceId] ?? []).find(
          (thread) => thread.id === threadId,
        ) ?? null;
      return {
        workspaceId,
        workspaceName:
          activeWorkspace?.id === workspaceId ? activeWorkspace.name : null,
        workspacePath:
          activeWorkspace?.id === workspaceId ? activeWorkspace.path : null,
        threadId,
        threadName: threadSummary?.name ?? null,
        turnId,
        engine: threadSummary?.engineSource ?? activeEngine ?? null,
      };
    },
    [activeEngine, activeWorkspace],
  );
  const {
    completionEmailIntentByThread,
    armMailDrivenCompletionEmail,
    clearCompletionEmailIntent,
    toggleCompletionEmailIntent,
    setActiveTurnIdWithCompletionEmail,
    renameCompletionEmailIntentThread,
    settleCompletionEmailIntent,
  } = useThreadCompletionEmail({
    activeThreadId,
    activeTurnIdByThreadRef,
    itemsByThreadRef,
    resolveCanonicalThreadId,
    setActiveTurnId,
    getCompletionEmailMetadata,
    onDebug,
  });

  return {
    completionEmailIntentByThread,
    armMailDrivenCompletionEmail,
    clearCompletionEmailIntent,
    toggleCompletionEmailIntent,
    setActiveTurnIdWithCompletionEmail,
    renameCompletionEmailIntentThread,
    settleCompletionEmailIntent,
  };
}
