import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConversationItem,
  EngineType,
  WorkspaceInfo,
} from "../../../../../types";
import {
  buildItemsFromThread,
  mergeThreadItems,
} from "../../../../../utils/threadItems";
import { parseClaudeHistoryMessagesWithShadowRecovery } from "../../../../threads/loaders/claudeHistoryLoader";
import { parseCodexSessionHistory } from "../../../../threads/loaders/codexSessionHistory";
import { parseGeminiHistoryMessages } from "../../../../threads/loaders/geminiHistoryParser";
import {
  buildWorkspaceSessionSelectionKey,
  type WorkspaceSessionCatalogMutationResponse,
} from "../hooks/useWorkspaceSessionCatalog";
import type { WorkspaceSessionCatalogEntry } from "../../../../../services/tauri";
import {
  normalizeEngineType,
  isSharedCatalogEntry,
} from "./sessionManagementSectionUtils";
import {
  loadCodexSession,
  loadClaudeSession,
  loadGeminiSession,
  resumeThread,
} from "../../../../../services/tauri";
import {
  loadSharedProjection,
  loadSharedSession,
} from "../../../../shared-session/services/sharedSessions";
import { createSharedHistoryLoader } from "../../../../threads/loaders/sharedHistoryLoader";

const CODEX_SESSION_CURTAIN_LOAD_TIMEOUT_MS = 10_000;

export type SessionCurtainState = {
  entry: WorkspaceSessionCatalogEntry;
  items: ConversationItem[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  notice: string | null;
};

export type CodexCurtainSourceResult = {
  source: "local" | "resume";
  items: ConversationItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function resolveNativeSessionId(
  entry: WorkspaceSessionCatalogEntry,
  engine: EngineType,
) {
  const explicitSessionId =
    entry.canonicalSessionId?.trim() || entry.sessionId.trim();
  const enginePrefix = `${engine}:`;
  return explicitSessionId.startsWith(enginePrefix)
    ? explicitSessionId.slice(enginePrefix.length)
    : explicitSessionId;
}

export function extractThreadFromResumeResponse(
  response: unknown,
): Record<string, unknown> | null {
  const root = asRecord(response);
  const result = asRecord(root?.result);
  const candidates = [
    asRecord(result?.thread),
    asRecord(root?.thread),
    Array.isArray(root?.turns) ? root : null,
  ];
  return (
    candidates.find((candidate): candidate is Record<string, unknown> =>
      Boolean(candidate),
    ) ?? null
  );
}

export function extractHistoryMessagesPayload(
  response: Record<string, unknown> | null,
) {
  return asRecord(response)?.messages ?? response;
}

async function loadCodexSessionForCurtain(
  workspaceId: string,
  requestedThreadId: string,
  entry: WorkspaceSessionCatalogEntry,
) {
  const candidates = [
    requestedThreadId,
    resolveNativeSessionId(entry, "codex"),
    entry.sessionId,
    entry.canonicalSessionId ?? "",
  ]
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  let lastError: unknown = null;

  for (const sessionId of uniqueCandidates) {
    try {
      const response = await loadCodexSession(workspaceId, sessionId);
      if (response) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}


async function resumeCodexThreadForCurtain(
  workspaceId: string,
  requestedThreadId: string,
  entry: WorkspaceSessionCatalogEntry,
) {
  const candidates = [
    requestedThreadId,
    entry.sessionId,
    resolveNativeSessionId(entry, "codex"),
    entry.canonicalSessionId ?? "",
  ]
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  let lastResponse: Record<string, unknown> | null = null;
  let lastError: unknown = null;

  for (const threadId of uniqueCandidates) {
    try {
      const response = await resumeThread(workspaceId, threadId);
      lastResponse = response;
      if (extractThreadFromResumeResponse(response)) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  if (lastError) {
    throw lastError;
  }
  return null;
}

export async function loadCodexLocalCurtainItems(
  workspaceId: string,
  requestedThreadId: string,
  entry: WorkspaceSessionCatalogEntry,
): Promise<CodexCurtainSourceResult> {
  const response = await loadCodexSessionForCurtain(
    workspaceId,
    requestedThreadId,
    entry,
  );
  return {
    source: "local",
    items: parseCodexSessionHistory(response),
  };
}

export async function loadCodexResumeCurtainItems(
  workspaceId: string,
  requestedThreadId: string,
  entry: WorkspaceSessionCatalogEntry,
): Promise<CodexCurtainSourceResult> {
  const response = await resumeCodexThreadForCurtain(
    workspaceId,
    requestedThreadId,
    entry,
  );
  const thread = extractThreadFromResumeResponse(response);
  return {
    source: "resume",
    items: thread ? buildItemsFromThread(thread) : [],
  };
}

export async function loadCodexCurtainItemsWithTimeout(
  entry: WorkspaceSessionCatalogEntry,
): Promise<ConversationItem[]> {
  return new Promise((resolve) => {
    let settledCount = 0;
    let resolved = false;
    const fallbackItems: ConversationItem[] = [];
    const timeoutId = window.setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(fallbackItems);
      }
    }, CODEX_SESSION_CURTAIN_LOAD_TIMEOUT_MS);

    const settle = (items: ConversationItem[]) => {
      if (resolved) {
        return;
      }
      settledCount += 1;
      if (items.length > 0) {
        resolved = true;
        window.clearTimeout(timeoutId);
        resolve(items);
        return;
      }
      if (settledCount >= 2) {
        resolved = true;
        window.clearTimeout(timeoutId);
        resolve(fallbackItems);
      }
    };

    void loadCodexLocalCurtainItems(entry.workspaceId, entry.sessionId, entry)
      .then((result) => settle(result.items))
      .catch(() => settle([]));
    void loadCodexResumeCurtainItems(entry.workspaceId, entry.sessionId, entry)
      .then((result) => settle(result.items))
      .catch(() => settle([]));
  });
}

export function getConversationItemText(item: ConversationItem) {
  if (item.kind === "message") {
    return item.text;
  }
  if (item.kind === "reasoning") {
    return item.content || item.summary;
  }
  if (item.kind === "diff") {
    return item.diff;
  }
  if (item.kind === "review") {
    return item.text;
  }
  if (item.kind === "explore") {
    return item.entries
      .map((entry) => [entry.label, entry.detail].filter(Boolean).join("\n"))
      .join("\n\n");
  }
  if (item.kind === "tool") {
    return [item.detail, item.output].filter(Boolean).join("\n\n");
  }
  if (item.kind === "generatedImage") {
    return item.promptText ?? item.fallbackText ?? "";
  }
  return "";
}

export function getConversationItemLabel(
  item: ConversationItem,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (item.kind === "message") {
    return item.role === "user"
      ? t("settings.sessionManagementCurtainRoleUser")
      : t("settings.sessionManagementCurtainRoleAssistant");
  }
  if (item.kind === "reasoning") {
    return t("settings.sessionManagementCurtainRoleReasoning");
  }
  if (item.kind === "tool") {
    return item.title || t("settings.sessionManagementCurtainRoleTool");
  }
  if (item.kind === "diff") {
    return item.title || t("settings.sessionManagementCurtainRoleDiff");
  }
  if (item.kind === "review") {
    return t("settings.sessionManagementCurtainRoleReview");
  }
  if (item.kind === "explore") {
    return item.title || t("settings.sessionManagementCurtainRoleExplore");
  }
  return t("settings.sessionManagementCurtainRoleImage");
}

export function useSessionCurtain({
  workspaces,
}: {
  workspaces: WorkspaceInfo[];
}) {
  const { t } = useTranslation();
  const sessionCurtainLoadSeqRef = useRef(0);
  const sessionCurtainTimeoutCleanupRef = useRef<(() => void) | null>(null);
  const sessionCurtainRef = useRef<SessionCurtainState | null>(null);
  const [sessionCurtain, setSessionCurtain] =
    useState<SessionCurtainState | null>(null);
  sessionCurtainRef.current = sessionCurtain;

  const loadSessionCurtainItems = async (
    entry: WorkspaceSessionCatalogEntry,
  ) => {
    const engineRaw = entry.engine.trim().toLowerCase();
    const engine = normalizeEngineType(entry.engine);
    const nativeSessionId = resolveNativeSessionId(entry, engine);
    const ownerWorkspace =
      workspaces.find((workspace) => workspace.id === entry.workspaceId) ??
      null;

    if (
      engineRaw === "shared" ||
      entry.threadKind === "shared" ||
      entry.sessionId.startsWith("shared:")
    ) {
      const threadId = entry.sessionId.startsWith("shared:")
        ? entry.sessionId
        : `shared:${nativeSessionId || entry.sessionId}`;
      const loader = createSharedHistoryLoader({
        workspaceId: entry.workspaceId,
        loadSharedSession,
        loadSharedProjection,
      });
      const snapshot = await loader.load(threadId);
      return snapshot.items;
    }

    if ((engine === "claude" || engine === "gemini") && !ownerWorkspace?.path) {
      throw new Error(
        t("settings.sessionManagementCurtainMissingWorkspacePath"),
      );
    }

    if (engine === "claude") {
      const response = await loadClaudeSession(
        ownerWorkspace!.path,
        nativeSessionId,
      );
      return parseClaudeHistoryMessagesWithShadowRecovery({
        messagesData: extractHistoryMessagesPayload(response),
        workspaceId: entry.workspaceId,
        workspacePath: ownerWorkspace!.path,
        threadId: `claude:${nativeSessionId}`,
        sessionId: nativeSessionId,
      });
    }

    if (engine === "gemini") {
      const response = await loadGeminiSession(
        ownerWorkspace!.path,
        nativeSessionId,
      );
      return parseGeminiHistoryMessages(
        extractHistoryMessagesPayload(response),
      );
    }

    if (engine === "codex") {
      return loadCodexCurtainItemsWithTimeout(entry);
    }

    const response = await resumeThread(entry.workspaceId, entry.sessionId);
    const thread = extractThreadFromResumeResponse(response);
    return thread ? buildItemsFromThread(thread) : [];
  };

  const clearActiveSessionCurtainTimeout = useCallback(() => {
    sessionCurtainTimeoutCleanupRef.current?.();
    sessionCurtainTimeoutCleanupRef.current = null;
  }, []);

  const appendCodexCurtainItems = (
    loadSeq: number,
    entry: WorkspaceSessionCatalogEntry,
    items: ConversationItem[],
  ) => {
    if (items.length === 0) {
      return false;
    }
    let didApply = false;
    setSessionCurtain((current) => {
      if (
        !current ||
        current.entry.sessionId !== entry.sessionId ||
        current.entry.workspaceId !== entry.workspaceId ||
        sessionCurtainLoadSeqRef.current !== loadSeq
      ) {
        return current;
      }
      didApply = true;
      return {
        ...current,
        items: mergeThreadItems(current.items, items),
        isLoading: false,
        error: null,
        notice: null,
      };
    });
    return didApply;
  };

  const startCodexSessionCurtainLoad = (
    entry: WorkspaceSessionCatalogEntry,
    loadSeq: number,
  ) => {
    clearActiveSessionCurtainTimeout();
    let settledCount = 0;
    let hasVisibleItems = false;
    let timedOutWithoutItems = false;
    let latestError: string | null = null;
    let timeoutId: number | null = null;

    const clearLoadTimeout = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (sessionCurtainTimeoutCleanupRef.current === clearLoadTimeout) {
        sessionCurtainTimeoutCleanupRef.current = null;
      }
    };

    const finishIfAllSourcesSettled = () => {
      if (settledCount < 2 || hasVisibleItems) {
        return;
      }
      if (timedOutWithoutItems) {
        return;
      }
      clearLoadTimeout();
      setSessionCurtain((current) => {
        if (
          !current ||
          current.entry.sessionId !== entry.sessionId ||
          current.entry.workspaceId !== entry.workspaceId ||
          sessionCurtainLoadSeqRef.current !== loadSeq
        ) {
          return current;
        }
        return {
          ...current,
          isLoading: false,
          error: latestError,
        };
      });
    };

    const handleSourceSettled = (result: CodexCurtainSourceResult) => {
      settledCount += 1;
      if (result.items.length > 0) {
        hasVisibleItems =
          appendCodexCurtainItems(loadSeq, entry, result.items) ||
          hasVisibleItems;
        if (hasVisibleItems) {
          clearLoadTimeout();
        }
      }
      finishIfAllSourcesSettled();
    };

    const handleSourceError = (error: unknown) => {
      settledCount += 1;
      latestError = error instanceof Error ? error.message : String(error);
      finishIfAllSourcesSettled();
    };

    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      if (sessionCurtainTimeoutCleanupRef.current === clearLoadTimeout) {
        sessionCurtainTimeoutCleanupRef.current = null;
      }
      timedOutWithoutItems = true;
      setSessionCurtain((current) => {
        if (
          !current ||
          current.entry.sessionId !== entry.sessionId ||
          current.entry.workspaceId !== entry.workspaceId ||
          sessionCurtainLoadSeqRef.current !== loadSeq ||
          current.items.length > 0
        ) {
          return current;
        }
        return {
          ...current,
          isLoading: false,
          error: t("settings.sessionManagementCurtainLoadTimeout"),
        };
      });
    }, CODEX_SESSION_CURTAIN_LOAD_TIMEOUT_MS);
    sessionCurtainTimeoutCleanupRef.current = clearLoadTimeout;

    void loadCodexLocalCurtainItems(entry.workspaceId, entry.sessionId, entry)
      .then(handleSourceSettled)
      .catch(handleSourceError);
    void loadCodexResumeCurtainItems(entry.workspaceId, entry.sessionId, entry)
      .then(handleSourceSettled)
      .catch(handleSourceError);
  };

  const handleOpenSessionCurtain = async (
    entry: WorkspaceSessionCatalogEntry,
  ) => {
    clearActiveSessionCurtainTimeout();
    const loadSeq = sessionCurtainLoadSeqRef.current + 1;
    sessionCurtainLoadSeqRef.current = loadSeq;
    setSessionCurtain({
      entry,
      items: [],
      isLoading: true,
      isSending: false,
      error: null,
      notice: null,
    });
    // Shared catalog engine normalizes to codex for icons; keep curtain load separate.
    if (
      !isSharedCatalogEntry(entry) &&
      normalizeEngineType(entry.engine) === "codex"
    ) {
      startCodexSessionCurtainLoad(entry, loadSeq);
      return;
    }
    try {
      const items = await loadSessionCurtainItems(entry);
      setSessionCurtain((current) =>
        current?.entry.sessionId === entry.sessionId &&
        sessionCurtainLoadSeqRef.current === loadSeq
          ? {
              ...current,
              items,
              isLoading: false,
              error: null,
              notice: null,
            }
          : current,
      );
    } catch (error) {
      setSessionCurtain((current) =>
        current?.entry.sessionId === entry.sessionId &&
        sessionCurtainLoadSeqRef.current === loadSeq
          ? {
              ...current,
              isLoading: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  };

  const handleReloadSessionCurtain = async () => {
    const entry = sessionCurtain?.entry;
    if (!entry || sessionCurtain.isLoading) {
      return;
    }
    clearActiveSessionCurtainTimeout();
    const loadSeq = sessionCurtainLoadSeqRef.current + 1;
    sessionCurtainLoadSeqRef.current = loadSeq;
    setSessionCurtain((current) =>
      current
        ? { ...current, isLoading: true, error: null, notice: null }
        : current,
    );
    // Shared catalog engine normalizes to codex for icons; keep curtain load separate.
    if (
      !isSharedCatalogEntry(entry) &&
      normalizeEngineType(entry.engine) === "codex"
    ) {
      startCodexSessionCurtainLoad(entry, loadSeq);
      return;
    }
    try {
      const items = await loadSessionCurtainItems(entry);
      setSessionCurtain((current) =>
        current?.entry.sessionId === entry.sessionId &&
        sessionCurtainLoadSeqRef.current === loadSeq
          ? { ...current, items, isLoading: false, error: null }
          : current,
      );
    } catch (error) {
      setSessionCurtain((current) =>
        current?.entry.sessionId === entry.sessionId &&
        sessionCurtainLoadSeqRef.current === loadSeq
          ? {
              ...current,
              isLoading: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  };

  const handleCloseSessionCurtain = () => {
    clearActiveSessionCurtainTimeout();
    sessionCurtainLoadSeqRef.current += 1;
    setSessionCurtain(null);
  };

  const closeSessionCurtainIfDeleted = (
    results: WorkspaceSessionCatalogMutationResponse["results"],
  ) => {
    const current = sessionCurtainRef.current;
    if (!current) {
      return;
    }
    const deletedSelectionKeys = new Set(
      results.filter((item) => item.ok).map((item) => item.selectionKey),
    );
    if (
      !deletedSelectionKeys.has(buildWorkspaceSessionSelectionKey(current.entry))
    ) {
      return;
    }
    clearActiveSessionCurtainTimeout();
    sessionCurtainLoadSeqRef.current += 1;
    setSessionCurtain(null);
  };

  useEffect(
    () => () => clearActiveSessionCurtainTimeout(),
    [clearActiveSessionCurtainTimeout],
  );

  return {
    sessionCurtain,
    handleOpenSessionCurtain,
    handleReloadSessionCurtain,
    handleCloseSessionCurtain,
    closeSessionCurtainIfDeleted,
  };
}
