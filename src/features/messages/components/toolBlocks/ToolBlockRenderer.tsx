/**
 * 工具块分发器 - 根据工具类型选择合适的组件展示
 * Tool Block Renderer - selects appropriate component based on tool type
 */
import { memo, useMemo } from 'react';
import type { ConversationItem } from '../../../../types';
import {
  resolveCanonicalToolName,
  isMcpTool,
  isReadTool,
  isEditTool,
  isBashTool,
  isSearchTool,
  resolveToolStatus,
} from './toolConstants';
import { GenericToolBlock } from './GenericToolBlock';
import { ReadToolBlock } from './ReadToolBlock';
import { EditToolBlock } from './EditToolBlock';
import { BashToolBlock } from './BashToolBlock';
import { SearchToolBlock } from './SearchToolBlock';
import { McpToolBlock } from './McpToolBlock';
import { RequestUserInputSubmittedBlock } from './RequestUserInputSubmittedBlock';
import {
  BackgroundTaskCard,
  canonicalBackgroundTaskFromRecord,
  isTerminalBackgroundTaskStatus,
  parseBackgroundTaskInput,
  parseBackgroundTaskSnapshot,
} from '../../rows/components/BackgroundTaskCard';
import {
  resolveResidualLiveItemDeltaText,
  useLiveItemDelta,
} from '../../../threads/hooks/useLiveItemDelta';
import { isLiveDeltaExternalizationEnabled } from '../../../threads/utils/realtimePerfFlags';
import { useBackgroundTaskLiveSnapshot } from '../../utils/useBackgroundTaskLiveSnapshot';

// A4 二期 live-delta 外部化：模块加载时读一次，翻转 flag 需刷新页面
//（与 MessageRow 的 LIVE_TEXT_EXTERNALIZATION_ENABLED 同语义）。
const LIVE_DELTA_EXTERNALIZATION_ENABLED = isLiveDeltaExternalizationEnabled();

interface ToolBlockRendererProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  workspaceId?: string | null;
  threadId?: string | null;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
  activeCollaborationModeId?: string | null;
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  hasPendingUserInputRequest?: boolean;
  onOpenFilePath?: (path: string) => void;
  onOpenDiffPath?: (path: string) => void;
  selectedExitPlanExecutionMode?: 'default' | 'full-access' | null;
  onExitPlanModeExecute?: (
    itemId: string,
    mode: 'default' | 'full-access',
  ) => Promise<void> | void;
}

/**
 * 工具块分发器组件
 * 根据工具类型分发到对应的专用组件
 */
export const ToolBlockRenderer = memo(function ToolBlockRenderer({
  item,
  workspaceId = null,
  threadId = null,
  isExpanded,
  onToggle,
  onRequestAutoScroll,
  activeCollaborationModeId,
  activeEngine,
  hasPendingUserInputRequest = false,
  onOpenFilePath,
  onOpenDiffPath,
  selectedExitPlanExecutionMode = null,
  onExitPlanModeExecute,
}: ToolBlockRendererProps) {
  const isToolStreaming =
    resolveToolStatus(item.status, Boolean(item.output)) === 'processing';
  // A4 二期：流式中的工具输出订阅 liveItemDeltaChannel 的 toolOutput lane
  //（通道自首条 delta 起全量累计，durable output 仅为建壳首段），后续 delta
  // 只驱动本块小树渲染；非流式/flag 关闭时订阅为空、零开销。residual 兜底
  // settle 竞态（对齐 MessageRow 正文 residual 模式）。
  const liveToolOutput = useLiveItemDelta(
    threadId,
    item.id,
    'toolOutput',
    LIVE_DELTA_EXTERNALIZATION_ENABLED && isToolStreaming,
  );
  const residualToolOutput =
    LIVE_DELTA_EXTERNALIZATION_ENABLED && !isToolStreaming && threadId
      ? resolveResidualLiveItemDeltaText(
          threadId,
          item.id,
          'toolOutput',
          item.output ?? '',
        )
      : null;
  const liveOutputOverride = liveToolOutput ?? residualToolOutput;
  // 后台任务卡片权威快照直读（无条件 hook，仅 backgroundTask 分支消费）：
  // store 四路合流的 live 记录优先于时间线 output 快照——sink upsert 丢失
  // （并行双 resident 等运行时条件）时卡片仍能翻终态自愈。
  const liveTaskRecord = useBackgroundTaskLiveSnapshot(
    workspaceId,
    threadId,
    item.id,
  );
  // 覆盖 output 后的展示 item：下游所有工具块（Bash/Generic/...）原样读
  // item.output，无需逐块改接线。
  const displayItem = useMemo(
    () =>
      liveOutputOverride != null && liveOutputOverride !== item.output
        ? { ...item, output: liveOutputOverride }
        : item,
    [item, liveOutputOverride],
  );
  const toolName = resolveCanonicalToolName(
    displayItem.title,
    displayItem.toolType,
    displayItem.detail,
  );
  const lower = toolName.toLowerCase();
  const normalizedToolName = toolName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedTitle = displayItem.title.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const isExitPlanModeTool =
    normalizedToolName === "exitplanmode" ||
    normalizedToolName.endsWith("exitplanmode") ||
    normalizedTitle.includes("exitplanmode");

  // 0. 已提交的 request user input 历史卡片
  if (displayItem.toolType === 'requestUserInputSubmitted') {
    return <RequestUserInputSubmittedBlock item={displayItem} />;
  }

  // 0.5 PI 后台任务卡（bg_run / bg_delegate / fusion_*）：运行中活体卡，
  // 终态原地折叠；不走普通工具块（折叠/分组语义由卡片自治）。
  if (displayItem.toolType === 'backgroundTask') {
    const parsed = parseBackgroundTaskSnapshot(displayItem.output);
    const live = canonicalBackgroundTaskFromRecord(liveTaskRecord?.task);
    // store live 快照优先（新），时间线 output 快照兜底（历史/未 hydrate 场景）。
    const task = live ?? parsed;
    const input = parseBackgroundTaskInput(displayItem.detail);
    const terminal = isTerminalBackgroundTaskStatus(
      task?.status ?? displayItem.status,
    );
    return (
      <BackgroundTaskCard
        toolName={displayItem.title || 'bg_run'}
        input={input}
        task={task}
        terminal={terminal}
      />
    );
  }

  // ExitPlanMode handoff must keep its dedicated card even if the runtime
  // classifies it as a command-like tool item.
  if (isExitPlanModeTool) {
    return (
      <GenericToolBlock
        item={displayItem}
        workspaceId={workspaceId}
        isExpanded={isExpanded}
        onToggle={onToggle}
        activeCollaborationModeId={activeCollaborationModeId}
        activeEngine={activeEngine}
        hasPendingUserInputRequest={hasPendingUserInputRequest}
        onOpenFilePath={onOpenFilePath}
        onOpenDiffPath={onOpenDiffPath}
        selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
        onExitPlanModeExecute={onExitPlanModeExecute}
      />
    );
  }

  // 1. 命令执行工具
  if (displayItem.toolType === 'commandExecution' || isBashTool(lower)) {
    return (
      <BashToolBlock
        item={displayItem}
        isExpanded={isExpanded}
        onToggle={onToggle}
        onRequestAutoScroll={onRequestAutoScroll}
      />
    );
  }

  // 2. 读取文件工具（Grok/Kimi/OpenCode Read / read_file / list_dir…）
  // 图片读取在 ReadToolBlock 内展开为真实预览（ImageViewToolContent），
  // 不再只显示 “Read image file: /path” 文案。
  if (isReadTool(lower)) {
    return (
      <ReadToolBlock
        item={displayItem}
        workspaceId={workspaceId}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  // 3. Codex / structured multi-file fileChange (changes[])
  // MUST keep GenericToolBlock → FileChangeToolContent path: +N/-N stats, unified
  // diff expand, and onOpenDiffPath for open-file when diff is missing.
  // Do NOT route these through EditToolBlock (single-file arg polish only).
  if (displayItem.toolType === 'fileChange') {
    return (
      <GenericToolBlock
        item={displayItem}
        workspaceId={workspaceId}
        isExpanded={isExpanded}
        onToggle={onToggle}
        activeCollaborationModeId={activeCollaborationModeId}
        activeEngine={activeEngine}
        hasPendingUserInputRequest={hasPendingUserInputRequest}
        onOpenFilePath={onOpenFilePath}
        onOpenDiffPath={onOpenDiffPath}
        selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
        onExitPlanModeExecute={onExitPlanModeExecute}
      />
    );
  }

  // 4. Claude/Grok/Kimi 单文件 write/edit（detail 里是 path/old/new JSON）
  if (isEditTool(lower)) {
    return (
      <EditToolBlock
        item={displayItem}
        onOpenDiffPath={onOpenFilePath ?? onOpenDiffPath}
      />
    );
  }

  // 5. 搜索工具 (grep, glob, search)
  if (isSearchTool(lower)) {
    return (
      <SearchToolBlock
        item={displayItem}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  // 6. MCP 工具（仅真正 mcp__ 前缀；agent 通用 tool 名走专用块或 generic）
  if (isMcpTool(displayItem.title) || (displayItem.toolType === 'mcpToolCall' && isMcpTool(displayItem.title))) {
    return (
      <McpToolBlock
        item={displayItem}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  // 7. 其他工具使用通用组件（Task / Web / 未知 agent 工具）
  return (
    <GenericToolBlock
      item={displayItem}
      workspaceId={workspaceId}
      isExpanded={isExpanded}
      onToggle={onToggle}
      activeCollaborationModeId={activeCollaborationModeId}
      activeEngine={activeEngine}
      hasPendingUserInputRequest={hasPendingUserInputRequest}
      onOpenFilePath={onOpenFilePath}
      onOpenDiffPath={onOpenDiffPath}
      selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
      onExitPlanModeExecute={onExitPlanModeExecute}
    />
  );
});
