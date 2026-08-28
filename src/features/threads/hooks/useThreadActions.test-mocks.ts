import { vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  connectWorkspace,
  deleteCodexSession,
  deleteClaudeSession,
  deleteGeminiSession,
  deleteGrokSession,
  deleteKimiSession,
  deleteOpenCodeSession,
  deletePiSession,
  deleteWorkspaceSessions,
  tombstoneSessionIndexRows,
  getOpenCodeSessionList,
  listClaudeSessions,
  listGeminiSessions,
  listGrokSessions,
  listKimiSessions,
  listDshSessions,
  listPiSessions,
  listQoderSessions,
  listThreadTitles,
  listWorkspaceSessionArchiveEvidence,
  listWorkspaceSessions,
  listSessionIndexForWorkspace,
  loadGeminiSession,
  loadGrokSession,
  loadKimiSession,
  loadPiSession,
  readWorkspaceFile,
  renameThreadTitleKey,
  setThreadTitle,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import { mergeThreadItems, previewThreadName } from "../../../utils/threadItems";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";

vi.mock("../../../services/tauri", () => ({
  startThread: vi.fn(),
  connectWorkspace: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  forkClaudeSession: vi.fn(),
  forkClaudeSessionFromMessage: vi.fn(),
  forkThread: vi.fn(),
  rewindCodexThread: vi.fn(),
  listClaudeSessions: vi.fn(),
  listGeminiSessions: vi.fn(),
  listGrokSessions: vi.fn(),
  listKimiSessions: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  listWorkspaceSessionArchiveEvidence: vi.fn(),
  listSessionIndexForWorkspace: vi.fn(),
  rememberSessionIndexWorkspacePath: vi.fn(),
  listDshSessions: vi.fn(),
  listPiSessions: vi.fn(),
  listQoderSessions: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadGeminiSession: vi.fn(),
  loadGrokSession: vi.fn(),
  loadKimiSession: vi.fn(),
  loadPiSession: vi.fn(),
  loadQoderSession: vi.fn(),
  loadCodexSession: vi.fn(),
  listThreadTitles: vi.fn(),
  readWorkspaceFile: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  setThreadTitle: vi.fn(),
  resumeThread: vi.fn(),
  listThreads: vi.fn(),
  writeClientCreatedSessionIndex: vi.fn(),
  deleteCodexSession: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteGeminiSession: vi.fn(),
  deleteGrokSession: vi.fn(),
  deleteKimiSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  deletePiSession: vi.fn(),
  deleteQoderSession: vi.fn(),
  deleteWorkspaceSessions: vi.fn(),
  tombstoneSessionIndexRows: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../../utils/threadItems", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../utils/threadItems")
  >();
  return {
    buildItemsFromThread: vi.fn(),
    extractClaudeApprovalResumeEntries: vi.fn(() => []),
    getThreadTimestamp: vi.fn(),
    isReviewingFromThread: vi.fn(),
    mergeThreadItems: vi.fn(),
    normalizeItem: vi.fn((item: ConversationItem) => item),
    previewThreadName: vi.fn(),
    stripClaudeApprovalResumeArtifacts: vi.fn((text: string) => text),
    // harden-pi-session-curtain-fidelity：原生历史 parse（pi/qoder 等）
    // 依赖真实 item builder；此前 mock 缺失导致 parse 在测试环境必抛，
    // pi 成功路径永远走 catch、被旧 catch 的无条件置 loaded 掩盖。
    buildConversationItem: actual.buildConversationItem,
    buildConversationItemFromThreadItem:
      actual.buildConversationItemFromThreadItem,
  };
});

vi.mock("../utils/threadStorage", () => ({
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  saveThreadActivity: vi.fn(),
}));

vi.mock("../utils/sidebarSnapshot", () => ({
  loadSidebarSnapshot: vi.fn(() => null),
}));

vi.mock("../../../services/globalRuntimeNotices", async () => {
  const actual = await vi.importActual<typeof import("../../../services/globalRuntimeNotices")>(
    "../../../services/globalRuntimeNotices",
  );
  return actual;
});

// F4（enhance-perf-diagnostics-evidence）：perf.thread-switch 证据走
// appendRendererDiagnostic；spy 掉避免真实落盘，同时供断言。
export const appendRendererDiagnosticMock = vi.fn();
vi.mock("../../../services/rendererDiagnostics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/rendererDiagnostics")>();
  return {
    ...actual,
    appendRendererDiagnostic: appendRendererDiagnosticMock,
  };
});

export function resetUseThreadActionsTestMocks() {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.mocked(listThreadTitles).mockResolvedValue({});
  vi.mocked(listClaudeSessions).mockResolvedValue([]);
  vi.mocked(listGeminiSessions).mockResolvedValue([]);
  vi.mocked(listGrokSessions).mockResolvedValue([]);
  vi.mocked(listKimiSessions).mockResolvedValue([]);
  vi.mocked(listPiSessions).mockResolvedValue([]);
  vi.mocked(listQoderSessions).mockResolvedValue([]);
  vi.mocked(listDshSessions).mockResolvedValue([]);
  vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
  vi.mocked(listWorkspaceSessions).mockResolvedValue({
    data: [],
    nextCursor: null,
    partialSource: null,
  });
  vi.mocked(listWorkspaceSessionArchiveEvidence).mockResolvedValue({
    archivedAtBySessionId: {},
    partialSource: null,
    sourceStatuses: [],
  });
  vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
    data: [],
    source: "session-index",
    synced: false,
    engines: [],
    hasMore: false,
    visibility: {
      available: true,
      freshness: "verified",
      hiddenNativeIds: [],
    },
  });
  vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
  vi.mocked(setThreadTitle).mockResolvedValue("title");
  vi.mocked(connectWorkspace).mockResolvedValue(undefined);
  vi.mocked(previewThreadName).mockImplementation((text: string, fallback: string) => {
    const trimmed = text.trim();
    return trimmed || fallback;
  });
  vi.mocked(deleteClaudeSession).mockResolvedValue(undefined);
  vi.mocked(deleteGeminiSession).mockResolvedValue(undefined);
  vi.mocked(deleteGrokSession).mockResolvedValue(undefined);
  vi.mocked(deleteKimiSession).mockResolvedValue(undefined);
  vi.mocked(deleteOpenCodeSession).mockResolvedValue({
    deleted: true,
    method: "filesystem",
  });
  vi.mocked(deletePiSession).mockResolvedValue(undefined);
  vi.mocked(deleteWorkspaceSessions).mockImplementation(
    async (_workspaceId: string, sessionIds: string[]) => ({
      results: sessionIds.map((sessionId) => ({
        sessionId,
        ok: true,
        archivedAt: null,
        error: null,
        code: "SESSION_DELETED",
        deletedFromDisk: true,
        metadataCleaned: true,
      })),
    }),
  );
  vi.mocked(tombstoneSessionIndexRows).mockResolvedValue(0);
  vi.mocked(deleteCodexSession).mockResolvedValue({
    deleted: true,
    deletedCount: 1,
    method: "filesystem",
    archivedBeforeDelete: true,
  });
  vi.mocked(loadGeminiSession).mockResolvedValue({ messages: [] });
  vi.mocked(loadGrokSession).mockResolvedValue({ messages: [] });
  vi.mocked(loadKimiSession).mockResolvedValue({ messages: [] });
  vi.mocked(loadPiSession).mockResolvedValue({ messages: [] });
  vi.mocked(readWorkspaceFile).mockResolvedValue({
    content: "",
    truncated: false,
  });
  vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
  vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
  vi.mocked(loadSidebarSnapshot).mockReturnValue(null);
  vi.mocked(mergeThreadItems).mockImplementation(
    (primaryItems: ConversationItem[]) => primaryItems,
  );
}
