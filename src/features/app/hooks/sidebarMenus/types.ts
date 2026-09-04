import type { EngineType } from "../../../../types";
import type { RendererContextMenuState } from "../../../../components/ui/RendererContextMenu";
import type {
  NativeProviderContinuationInput,
} from "../../../../services/tauri";
import type { NativeProviderContinuationProgressPhase } from "../../../../services/events";
import { pushGlobalRuntimeNotice } from "../../../../services/globalRuntimeNotices";
import {
  activateEngineProviderProfileAndNotify,
} from "../../../vendors/activateEngineProviderProfile";
import {
  writeLastProviderProfileId,
} from "../../../vendors/lastProviderProfileMemory";
import {
  QODER_CN_PROVIDER_PROFILE_ID,
  QODER_CN_PROVIDER_PROFILE_NAME,
  QODER_GLOBAL_PROVIDER_PROFILE_ID,
  QODER_GLOBAL_PROVIDER_PROFILE_NAME,
  type EngineProviderProfileOption,
  type EngineProviderProfileSelection,
} from "../../../threads/constants/codexProviderProfiles";
import type { ThreadSummary, WorkspaceGroup, WorkspaceInfo } from "../../../../types";
import type { SharedSessionSupportedEngine } from "../../../shared-session/utils/sharedSessionEngines";
import type { ThreadPinScope } from "../../../threads/utils/threadStorage";
import type {
  EngineDisplayInfo,
  EngineRefreshResult,
} from "../../../engine/hooks/useEngineController";
import type { LastProviderEngine } from "../../../vendors/lastProviderProfileMemory";

export type ProviderEngine = LastProviderEngine;

export const QODER_GLOBAL_PROFILE: EngineProviderProfileOption = {
  id: QODER_GLOBAL_PROVIDER_PROFILE_ID,
  name: QODER_GLOBAL_PROVIDER_PROFILE_NAME,
  source: "managed",
};
export const QODER_CN_PROFILE: EngineProviderProfileOption = {
  id: QODER_CN_PROVIDER_PROFILE_ID,
  name: QODER_CN_PROVIDER_PROFILE_NAME,
  source: "managed",
};
export const QODER_DISTRIBUTION_PROFILES: readonly EngineProviderProfileOption[] = [
  QODER_GLOBAL_PROFILE,
  QODER_CN_PROFILE,
];

export type ProviderContinuationDialogState = {
  workspaceId: string;
  sourceSessionId: string;
  sourceTitle: string;
  sourceLabel: string;
  destinationLabel: string;
  request: NativeProviderContinuationInput;
  operationKey: string;
  stage: "preparing" | "confirm" | "running" | "error";
  retryAction: "prepare" | "execute" | null;
  detail: string | null;
  technicalDetail: string | null;
  sourceEstimatedTokens: number | null;
  packageEstimatedTokens: number | null;
  progressPhase: NativeProviderContinuationProgressPhase | null;
  progressPercent: number;
};

export function providerContinuationRecoveryMessage(errorCode: string | null): string {
  if (
    errorCode?.includes("acceptance-ambiguous") ||
    errorCode?.includes("recovery-required")
  ) {
    return "目标会话可能已经创建。重试只会校验同一个会话，不会重复创建。";
  }
  if (errorCode?.includes("catalog-commit-failed")) {
    return "目标会话已创建，但客户端登记尚未完成。重试会补全登记。";
  }
  if (errorCode?.includes("artifact-integrity")) {
    return "续接上下文校验失败。来源会话未被修改，请重新发起续接。";
  }
  return "续接没有完成。来源会话保持不变，可以安全重试。";
}

export function selectProviderForCreate(
  engine: ProviderEngine,
  profile: EngineProviderProfileOption,
  setSelectedProfileId: (id: string) => void,
  noticeMessageKey: string,
) {
  writeLastProviderProfileId(engine, profile.id);
  setSelectedProfileId(profile.id);
  pushGlobalRuntimeNotice({
    severity: "info",
    category: "runtime",
    messageKey: noticeMessageKey,
    messageParams: { name: profile.name },
    dedupeKey: `${engine}-provider-selected-${profile.id}`,
  });

  void activateEngineProviderProfileAndNotify(engine, profile.id).catch(
    (error: unknown) => {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "unknown";
      pushGlobalRuntimeNotice({
        severity: "warning",
        category: "runtime",
        messageKey: "runtimeNotice.vendor.activateProviderFailed",
        messageParams: { name: profile.name, detail },
        dedupeKey: `${engine}-provider-activate-failed-${profile.id}`,
      });
    },
  );
}

/** 左侧「创建会话」时始终携带完整 profile，避免只传 id 丢失 source/name。 */
export function creationProviderSelection(
  profile: EngineProviderProfileOption,
): EngineProviderProfileSelection {
  return {
    providerProfileId: profile.id,
    providerProfile: profile,
  };
}

export type WorkspaceMenuIconKind =
  | "engine-claude"
  | "engine-codex"
  | "engine-opencode"
  | "engine-gemini"
  | "engine-kimi"
  | "engine-grok"
  | "engine-pi"
  | "engine-omp"
  | "engine-dsh"
  | "engine-qoder"
  | "new-shared"
  | "alias"
  | "assign-group"
  | "activate"
  | "exited-sessions-hidden"
  | "exited-sessions-visible"
  | "new-folder"
  | "reload"
  | "remove"
  | "new-worktree";

export type WorkspaceMenuAction = {
  id: string;
  label: string;
  iconKind: WorkspaceMenuIconKind;
  badgeLabel?: string;
  submenuTitle?: string;
  tone?: "default" | "danger";
  deprecated?: boolean;
  unavailable?: boolean;
  statusLabel?: string | null;
  refreshable?: boolean;
  refreshing?: boolean;
  selected?: boolean;
  keepMenuOpen?: boolean;
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePinned?: () => void;
  /** Hint shown inside the submenu after one of its children is selected. */
  selectionHint?: string;
  /** 当前记住的供应商名，直接展示在父行上（抽屉内可见「创建的是谁」）。 */
  selectedChildLabel?: string;
  /** Parent click opens its submenu instead of running a default leaf action. */
  submenuOnly?: boolean;
  /** 二级子菜单标题旁「?」悬停的长说明（如供应商选择的效果与配置入口）。 */
  submenuHelpTip?: string;
  onSelect: () => void;
  onRefresh?: () => Promise<void> | void;
  children?: WorkspaceMenuAction[];
};

export type WorkspaceMenuGroup = {
  id: string;
  label: string;
  /** 节标题后的简短说明小字（如 Shared/Native 的引擎语义）。 */
  hint?: string;
  /** 悬停「?」图标时的长语义说明（给不熟悉概念的用户）。 */
  helpTip?: string;
  actions: WorkspaceMenuAction[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

export type WorkspaceMenuState = {
  x: number;
  y: number;
  workspaceId: string;
  groups: WorkspaceMenuGroup[];
  workspace?: WorkspaceInfo;
  targetFolderId?: string | null;
};

export type SidebarContextMenuState = RendererContextMenuState & {
  source: "thread" | "worktree";
};

export type SidebarMenuHandlers = {
  onAddAgent: (
    workspace: WorkspaceInfo,
    engine?: EngineType,
    options?: { folderId?: string | null } & EngineProviderProfileSelection,
  ) => Promise<string | null> | string | null | void;
  claudeProviderProfiles?: EngineProviderProfileOption[];
  codexProviderProfiles?: EngineProviderProfileOption[];
  kimiProviderProfiles?: EngineProviderProfileOption[];
  grokProviderProfiles?: EngineProviderProfileOption[];
  opencodeProviderProfiles?: EngineProviderProfileOption[];
  engineOptions?: EngineDisplayInfo[];
  onRefreshEngineOptions?: () =>
    | Promise<EngineRefreshResult | void>
    | EngineRefreshResult
    | void;
  onAddSharedAgent?: (
    workspace: WorkspaceInfo,
    engine: SharedSessionSupportedEngine,
    options?: { providerProfileId?: string },
  ) => Promise<string | null> | string | null | void;
  onAssignNewSessionToFolder?: (
    workspaceId: string,
    threadId: string,
    folderId: string,
  ) => Promise<void> | void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onArchiveThread: (workspaceId: string, threadId: string) => void;
  onOpenSessionManagement?: () => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  onPinThread: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => void;
  onUnpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onAutoNameThread: (workspaceId: string, threadId: string) => void;
  onMoveThreadToFolder?: (
    workspaceId: string,
    threadId: string,
    folderId: string | null,
  ) => void;
  onOpenThreadFolderPicker?: (
    workspaceId: string,
    threadId: string,
    targets: ThreadMoveFolderTarget[],
    currentFolderId: string | null,
  ) => void;
  onOpenClaudeTui?: (input: {
    workspaceId: string;
    workspacePath: string;
    sessionId: string;
  }) => void;
  onReloadWorkspaceThreads: (
    workspaceId: string,
  ) => Promise<void> | void;
  threadListLoadingByWorkspace?: Record<string, boolean>;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  /**
   * Provider 续接成功后：把目标 model/effort 落到新会话 composer，
   * 并可由上层触发 provider-scoped 模型目录刷新。
   */
  onProviderContinuationTargetReady?: (input: {
    workspaceId: string;
    threadId: string;
    engine: string;
    providerProfileId: string | null;
    /** 优先 catalog entry id；可与 modelRuntime 二选一或同时给 */
    modelId: string | null;
    /** CLI runtime 名（如 MiniMax-M3），用于反查 catalog entry */
    modelRuntime?: string | null;
    effort: string | null;
  }) => void | Promise<void>;
  isThreadAvailable?: (workspaceId: string, threadId: string) => boolean;
  getThreadSummary?: (
    workspaceId: string,
    threadId: string,
  ) => ThreadSummary | undefined;
  onActivateWorkspace?: (workspaceId: string) => void;
  onCreateSessionFolder?: (workspaceId: string) => void;
  onToggleExitedSessions?: (workspacePath: string) => void;
  shouldShowExitedSessionsToggle?: (workspace: WorkspaceInfo) => boolean;
  isExitedSessionsHidden?: (workspacePath: string) => boolean;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onRenameWorkspaceAlias: (workspace: WorkspaceInfo) => void;
  /** 侧栏快捷改分组；与设置 → 项目管理 → 分组 同源。仅 main workspace 可用。 */
  workspaceGroups?: WorkspaceGroup[];
  onAssignWorkspaceGroup?: (
    workspaceId: string,
    groupId: string | null,
  ) => void | Promise<unknown>;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
};

export type ThreadMoveFolderTarget = {
  folderId: string | null;
  label: string;
};

export function resolveEngineDisplayName(engineType: EngineType): string {
  switch (engineType) {
    case "codex":
      return "Codex CLI";
    case "gemini":
      return "Gemini CLI";
    case "opencode":
      return "OpenCode";
    case "kimi":
      return "Kimi CLI";
    case "grok":
      return "Grok CLI";
    case "dsh":
      return "DeepSeek Harness";
    case "claude":
    default:
      return "Claude Code";
  }
}
