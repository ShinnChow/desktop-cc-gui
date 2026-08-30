import type { Dispatch, MutableRefObject } from "react";
import type {
  AccessMode,
  MemoryContextInjectionMode,
  RateLimitSnapshot,
  ThreadTokenUsage,
  CustomPromptOption,
  DebugEntry,
  WorkspaceInfo,
  BrowserContextSendAttachment,
  IntentCanvasContextSendAttachment,
  SelectedAgentOption,
  SharedQueuedExecutionTarget,
  ExecutionTargetSnapshot,
  SkillInvocation,
} from "../../../types";
import type { AutoSessionMetadata } from "../../../services/tauri";
import type { SendSharedSessionTurnV2Result } from "../../shared-session/runtime/sendSharedSessionTurnV2";
import type { LegacyMemoryReferenceMode } from "../../project-memory/memoryPick/memoryPickTypes";
import type { WorkspaceScopedMap } from "./workspaceScopedMap";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

export type SendMessageOptions = {
  skillInvocations?: SkillInvocation[];
  skipPromptExpansion?: boolean;
  skipOptimisticUserBubble?: boolean;
  suppressUserMessageRender?: boolean;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  resumeSource?: "queue-fusion-cutover" | null;
  resumeTurnId?: string | null;
  selectedMemoryIds?: string[];
  selectedMemoryInjectionMode?: MemoryContextInjectionMode;
  /** @deprecated 使用 memoryReferenceMode；true 视为 always 静默兼容 */
  memoryReferenceEnabled?: boolean;
  /**
   * 记忆参考三态：off | pick | always（single 读入时归一为 pick）。
   * Shared / Native 同一语义。
   */
  memoryReferenceMode?: LegacyMemoryReferenceMode;
  selectedNoteCardIds?: string[];
  selectedAgent?: SelectedAgentOption | null;
  dshAgentPreset?: string | null;
  browserContextAttachment?: BrowserContextSendAttachment | null;
  intentCanvasContextAttachments?: IntentCanvasContextSendAttachment[];
  codexInvalidThreadRetryAttempted?: boolean;
  autoSession?: AutoSessionMetadata | null;
  sharedExecutionTarget?: SharedQueuedExecutionTarget;
  /** Native 发送边界冻结的执行目标快照（Composer 传入；缺失时按 resolved 值兜底）。 */
  nativeExecutionTarget?: ExecutionTargetSnapshot;
  squadRequest?: true;
  originKind?: "shared-provider-retry";
  providerRetryAttempt?: number;
  providerRetryAtMs?: number;
};

export type ThreadMessageDispatchResult =
  | SendSharedSessionTurnV2Result
  | {
      status: "ambiguous-error";
      reason: string;
    }
  | undefined;

export type SendMessageToThreadFn = (
  workspace: WorkspaceInfo,
  threadId: string,
  text: string,
  images?: string[],
  options?: SendMessageOptions,
) => Promise<ThreadMessageDispatchResult>;

export type HandleFusionStalledOptions = {
  message?: string | null;
};

export type RunWithCreateSessionLoading = <T>(
  params: {
    workspace: WorkspaceInfo;
    engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";
  },
  action: () => Promise<T>,
) => Promise<T>;

export type UseThreadMessagingOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  accessMode?: "default" | "read-only" | "current" | "full-access";
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  resolveComposerSelection?: (threadId?: string | null) => {
    threadId?: string | null;
    id?: string | null;
    model: string | null;
    source?: string | null;
    providerProfileId?: string | null;
    effort: string | null;
    collaborationMode: Record<string, unknown> | null;
  };
  claudeThinkingVisible?: boolean;
  steerEnabled: boolean;
  customPrompts: CustomPromptOption[];
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";
  threadStatusById: ThreadState["threadStatusById"];
  itemsByThread: ThreadState["itemsByThread"];
  activeTurnIdByThread: ThreadState["activeTurnIdByThread"];
  codexAcceptedTurnByThread: ThreadState["codexAcceptedTurnByThread"];
  tokenUsageByThread: Record<string, ThreadTokenUsage>;
  rateLimitsByWorkspace: Record<string, RateLimitSnapshot | null>;
  codexCompactionInFlightByThreadRef?: MutableRefObject<
    Record<string, boolean>
  >;
  pendingInterruptsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  getThreadEngine: (
    workspaceId: string,
    threadId: string,
  ) => "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder" | undefined;
  getThreadKind?: (
    workspaceId: string,
    threadId: string,
  ) => "native" | "shared";
  getThreadProviderProfileId?: (
    workspaceId: string,
    threadId: string,
  ) => string | null | undefined;
  getThreadDshAgentPreset?: (
    workspaceId: string,
    threadId: string,
  ) => string | null | undefined;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  safeMessageActivity: () => void;
  onDebug?: (entry: DebugEntry) => void;
  pushThreadErrorMessage: (
    workspaceId: string,
    threadId: string,
    message: string,
  ) => void;
  ensureThreadForActiveWorkspace: () => Promise<string | null>;
  ensureThreadForWorkspace: (workspaceId: string) => Promise<string | null>;
  refreshThread: (
    workspaceId: string,
    threadId: string,
  ) => Promise<string | null>;
  forkThreadForWorkspace: (
    workspaceId: string,
    threadId: string,
    options?: { activate?: boolean; providerProfileId?: string | null },
  ) => Promise<string | null>;
  updateThreadParent: (parentId: string, childIds: string[]) => void;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";
      folderId?: string | null;
      autoSession?: AutoSessionMetadata | null;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
  finalizeCodexPendingThread?: (
    workspaceId: string,
    pendingThreadId: string,
  ) => Promise<string | null>;
  resolveOpenCodeAgent?: (threadId: string | null) => string | null;
  resolveOpenCodeVariant?: (threadId: string | null) => string | null;
  onInputMemoryCaptured?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
    inputText: string;
    memoryId: string | null;
    workspaceName: string | null;
    workspacePath: string | null;
    engine: string | null;
  }) => void;
  resolveCollaborationRuntimeMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  runWithCreateSessionLoading?: RunWithCreateSessionLoading;
  onSharedDurableTurnCommitted?: (
    threadId: string,
    runtimeTurnId: string,
  ) => void;
};
