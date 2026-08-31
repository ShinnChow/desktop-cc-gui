import type { QoderSettingsHighlightTarget } from "../../../app/hooks/useSettingsModalState";
import type {
  ComposerSendShortcut,
  ComposerEditorSettings,
  ConversationItem,
  CustomCommandOption,
  CustomPromptOption,
  EngineType,
  MessageSendOptions,
  ModelOption,
  OpenCodeAgentOption,
  QueuedMessage,
  RateLimitSnapshot,
  RequestUserInputRequest,
  RuntimeLifecycleState,
  ThreadTokenUsage,
  TurnPlan,
} from "../../../../types";
import type { EngineDisplayInfo } from "../../../engine/hooks/useEngineController";
import type {
  ReviewPromptState,
  ReviewPromptStep,
} from "../../../threads/hooks/useReviewPrompt";
import type { CodexCompactionSource, SelectedAgent as ChatInputSelectedAgent } from "../ChatInputBox/types";
import type { ComposerBranchControl } from "../ComposerBranchBadge";
import type { IntentCanvasDocument } from "../../../intent-canvas/types";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../../code-annotations/types";
import type { RewindMode } from "../../../threads/utils/rewindMode";

export type RewindExecutionOptions = {
  mode?: RewindMode;
};

export type ComposerRewindDialogRequest = {
  requestId: number;
  userMessageId: string;
};

export type ComposerProps = {
  items?: ConversationItem[];
  onSend: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => void | Promise<void>;
  onQueue: (
    text: string,
    images: string[],
    options?: MessageSendOptions,
  ) => void | Promise<void>;
  onRequestContextCompaction?: () => Promise<void> | void;
  onStop: () => void;
  canStop: boolean;
  disabled?: boolean;
  /** 禁止提交但保留文本编辑；Shared non-idle 用于维持 Turn 线性顺序。 */
  submitDisabled?: boolean;
  isProcessing: boolean;
  steerEnabled: boolean;
  collaborationModes: { id: string; label: string }[];
  collaborationModesEnabled: boolean;
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  isSharedSession?: boolean;
  /** New Home 仅复用双栏 picker，不启用 Shared Session durable semantics。 */
  createSessionTargetPicker?: boolean;
  /** New Home 标题只接收 creation target 的 Engine projection；完整 Target 仍由 Composer 持有。 */
  onCreationTargetEngineChange?: (engine: EngineType | null) => void;
  /** Wave 4 / B.6：Shared Send 状态机非 idle 时锁定四级 Picker（§14.5.3）。 */
  sharedTargetPickerLocked?: boolean;
  // Engine props
  engines?: EngineDisplayInfo[];
  selectedEngine?: EngineType;
  onSelectEngine?: (engine: EngineType) => void;
  // Model props
  models: { id: string; displayName: string; model: string }[];
  providerModelCatalogs?: Partial<Record<EngineType, ModelOption[]>>;
  providerProfileId?: string | null;
  /** 当前会话创建时的供应商显示名（切老会话时底栏渠道芯片用，避免回落到列表首项 DeepSeek） */
  providerProfileName?: string | null;
  /** Existing DSH session header preset; used only after first user turn. */
  dshAgentPreset?: string | null;
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string | null) => void;
  reasoningSupported: boolean;
  onResolvedAlwaysThinkingChange?: (enabled: boolean) => void;
  opencodeAgents?: OpenCodeAgentOption[];
  selectedOpenCodeAgent?: string | null;
  onSelectOpenCodeAgent?: (agentId: string | null) => void;
  selectedAgent?: ChatInputSelectedAgent | null;
  onAgentSelect?: (agent: ChatInputSelectedAgent | null) => void;
  onOpenAgentSettings?: () => void;
  onOpenPromptSettings?: () => void;
  onOpenModelSettings?: (providerId?: string) => void;
  onOpenCliSettings?: (
    highlightTarget?: QoderSettingsHighlightTarget,
  ) => void;
  onRefreshModelConfig?: (providerId?: string) => Promise<void> | void;
  isModelConfigRefreshing?: boolean;
  onForkQuickStart?: () => void;
  opencodeVariantOptions?: string[];
  selectedOpenCodeVariant?: string | null;
  onSelectOpenCodeVariant?: (variant: string | null) => void;
  accessMode: "default" | "read-only" | "current" | "full-access";
  onSelectAccessMode: (
    mode: "default" | "read-only" | "current" | "full-access",
  ) => void;
  skills: {
    name: string;
    path: string;
    description?: string;
    source?: string;
  }[];
  customSkillDirectories?: string[];
  prompts: CustomPromptOption[];
  commands?: CustomCommandOption[];
  files: string[];
  directories?: string[];
  contextUsage?: ThreadTokenUsage | null;
  contextDualViewEnabled?: boolean;
  isContextCompacting?: boolean;
  codexCompactionLifecycleState?: "idle" | "compacting" | "completed";
  codexCompactionSource?: CodexCompactionSource | null;
  codexCompactionCompletedAt?: number | null;
  lastTokenUsageUpdatedAt?: number | null;
  codexAutoCompactionEnabled?: boolean;
  codexAutoCompactionThresholdPercent?: number;
  onCodexAutoCompactionSettingsChange?: (patch: {
    enabled?: boolean;
    thresholdPercent?: number;
  }) => Promise<void> | void;
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  queuedMessages?: QueuedMessage[];
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
  onFuseQueued?: (id: string) => void | Promise<void>;
  canFuseQueuedMessages?: boolean;
  fuseDisabledReasonKey?: string | null;
  fusingQueuedMessageId?: string | null;
  userInputRequests?: RequestUserInputRequest[];
  onJumpToUserInputRequest?: (request: RequestUserInputRequest) => void;
  runtimeLifecycleState?: RuntimeLifecycleState | null;
  sendLabel?: string;
  onDraftChange?: (text: string) => void;
  attachedImages?: string[];
  onPickImages?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveImage?: (path: string) => void;
  intentCanvasAttachments?: IntentCanvasDocument[];
  onRemoveIntentCanvasAttachment?: (documentId: string) => void;
  prefillDraft?: QueuedMessage | null;
  onPrefillHandled?: (id: string) => void;
  insertText?: QueuedMessage | null;
  onInsertHandled?: (id: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  editorSettings?: ComposerEditorSettings;
  sendShortcut?: ComposerSendShortcut;
  /** 停止按钮悬停提示里展示的中断快捷键（展示值；空则不展示） */
  interruptShortcutLabel?: string | null;
  textareaHeight?: number;
  onTextareaHeightChange?: (height: number) => void;
  onOpenSkillsSettings?: () => void;
  onOpenExperimentalSettings?: () => void;
  reviewPrompt?: ReviewPromptState;
  onReviewPromptClose?: () => void;
  onReviewPromptShowPreset?: () => void;
  onReviewPromptChoosePreset?: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  highlightedPresetIndex?: number;
  onReviewPromptHighlightPreset?: (index: number) => void;
  highlightedBranchIndex?: number;
  onReviewPromptHighlightBranch?: (index: number) => void;
  highlightedCommitIndex?: number;
  onReviewPromptHighlightCommit?: (index: number) => void;
  onReviewPromptKeyDown?: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
  onReviewPromptSelectBranch?: (value: string) => void;
  onReviewPromptSelectBranchAtIndex?: (index: number) => void;
  onReviewPromptConfirmBranch?: () => Promise<void>;
  onReviewPromptSelectCommit?: (sha: string, title: string) => void;
  onReviewPromptSelectCommitAtIndex?: (index: number) => void;
  onReviewPromptConfirmCommit?: () => Promise<void>;
  onReviewPromptUpdateCustomInstructions?: (value: string) => void;
  onReviewPromptConfirmCustom?: () => Promise<void>;
  activeFilePath?: string | null;
  activeFileLineRange?: { startLine: number; endLine: number } | null;
  fileReferenceMode?: "path" | "none";
  activeWorkspaceId?: string | null;
  activeWorkspaceName?: string | null;
  activeWorkspacePath?: string | null;
  branchControl?: ComposerBranchControl | null;
  /** 输入框下方分支行右侧的上下文占用指示器；首页由 HomeChat 自行渲染，置 false 关闭 */
  footerUsageIndicatorEnabled?: boolean;
  rewindWorkspaceGitState?: {
    isGitRepository: boolean;
    hasDetectedChanges: boolean;
  } | null;
  activeThreadId?: string | null;
  threadItemsByThread?: Record<string, ConversationItem[]>;
  threadParentById?: Record<string, string>;
  threadStatusById?: Record<string, { isProcessing?: boolean } | undefined>;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  onOpenDiffPath?: (path: string) => void;
  /**
   * 工作区 git 脏文件（含行统计）。会话「已编辑」pill 的 +/− 以此为准，
   * path 集合仍来自本会话 AI 工具调用。
   */
  gitChangedFiles?: Array<{
    path: string;
    additions: number;
    deletions: number;
  }> | null;
  /** 非 git 仓库时传 false，退回 tool 统计 */
  isGitRepository?: boolean;
  /** AI 改文件后请求刷新 git status（防抖由 Composer 侧触发） */
  onRequestGitStatusRefresh?: () => void;
  /** 撤销会话已编辑列表中的单个文件（git restore） */
  onRevertFile?: (path: string) => void | Promise<void>;
  /** 撤销会话已编辑列表中的多个文件 */
  onRevertAllFiles?: (paths: string[]) => void | Promise<void>;
  onRewind?: (
    userMessageId: string,
    options?: RewindExecutionOptions,
  ) => void | Promise<void>;
  rewindDialogRequest?: ComposerRewindDialogRequest | null;
  onRewindDialogRequestConsumed?: (requestId: number) => void;
  showStatusPanelToggleOverride?: boolean;
  statusPanelExpandedOverride?: boolean;
  onToggleStatusPanelOverride?: () => void;
  completionEmailSelected?: boolean;
  completionEmailDisabled?: boolean;
  onToggleCompletionEmail?: () => void;
  pendingCodeAnnotation?: CodeAnnotationDraftInput | null;
  onCodeAnnotationConsumed?: (dedupeKey: string) => void;
  selectedCodeAnnotations?: CodeAnnotationSelection[];
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  onClearCodeAnnotations?: () => void;
  externalNoteCardSelectionRequest?: ComposerNoteCardSelectionRequest | null;
};

export type ManualMemorySelection = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  kind: string;
  importance: string;
  updatedAt: number;
  tags: string[];
};

export type NoteCardSelection = {
  id: string;
  title: string;
  plainTextExcerpt: string;
  bodyMarkdown: string;
  updatedAt: number;
  archived: boolean;
  imageCount: number;
  previewAttachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    absolutePath: string;
  }>;
};

export type ComposerNoteCardSelectionRequest = {
  requestId: number;
  noteCard: NoteCardSelection;
};
