/**
 * 通用工具块组件 - 用于展示各种工具调用
 * Generic Tool Block Component - for displaying various tool calls
 * 使用 task-container 样式 + codicon 图标（匹配参考项目）
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../../../types';
import {
  getToolDisplayName,
  isMcpTool,
  isReadTool,
  isEditTool,
  isBashTool,
  isSearchTool,
  isWebTool,
} from './toolConstants';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { isAskUserQuestionToolName } from '../../../../utils/toolSemantics';
import { FileIcon } from './FileIcon';
import { cn } from '@/lib/utils';
import { Marker, MarkerContent, MarkerIcon } from '../../../../components/ui/marker';
import { CollapsibleReveal } from '../../../../components/common/CollapsibleReveal';
import { TOOL_META_ROW_CLASS, ToolStatusIcon } from './ToolMarkerShell';
import { ExitPlanToolContent, type ExitPlanToolCopy } from './ExitPlanToolContent';
import { FileChangeToolContent } from './FileChangeToolContent';
import {
  ImageViewToolContent,
  resolveImageViewPreviewSrc,
} from './ImageViewToolContent';
import {
  buildGenericToolPresentation,
  type ExitPlanExecutionMode,
} from './genericToolPresentation';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import FilePen from 'lucide-react/dist/esm/icons/file-pen';
import FilePlus from 'lucide-react/dist/esm/icons/file-plus';
import Terminal from 'lucide-react/dist/esm/icons/terminal';
import Search from 'lucide-react/dist/esm/icons/search';
import FolderSearch from 'lucide-react/dist/esm/icons/folder-search';
import Globe from 'lucide-react/dist/esm/icons/globe';
import FileDiff from 'lucide-react/dist/esm/icons/file-diff';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks';
import Zap from 'lucide-react/dist/esm/icons/zap';
import NotebookPen from 'lucide-react/dist/esm/icons/notebook-pen';
import Database from 'lucide-react/dist/esm/icons/database';
import MessagesSquare from 'lucide-react/dist/esm/icons/messages-square';
import CheckCheck from 'lucide-react/dist/esm/icons/check-check';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Wrench from 'lucide-react/dist/esm/icons/wrench';

interface GenericToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  workspaceId?: string | null;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  activeCollaborationModeId?: string | null;
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  hasPendingUserInputRequest?: boolean;
  onOpenFilePath?: (path: string) => void;
  onOpenDiffPath?: (path: string) => void;
  selectedExitPlanExecutionMode?: ExitPlanExecutionMode | null;
  onExitPlanModeExecute?: (
    itemId: string,
    mode: ExitPlanExecutionMode,
  ) => Promise<void> | void;
}

// codicon 图标映射（匹配参考项目）
const CODICON_MAP: Record<string, string> = {
  read: 'codicon-eye',
  read_file: 'codicon-eye',
  edit: 'codicon-edit',
  edit_file: 'codicon-edit',
  write: 'codicon-pencil',
  write_to_file: 'codicon-pencil',
  save: 'codicon-pencil',
  'save-file': 'codicon-pencil',
  bash: 'codicon-terminal',
  run_terminal_cmd: 'codicon-terminal',
  execute_command: 'codicon-terminal',
  executecommand: 'codicon-terminal',
  shell_command: 'codicon-terminal',
  grep: 'codicon-search',
  glob: 'codicon-folder',
  search: 'codicon-search',
  find: 'codicon-folder',
  task: 'codicon-tools',
  todowrite: 'codicon-checklist',
  todo_write: 'codicon-checklist',
  webfetch: 'codicon-globe',
  websearch: 'codicon-search',
  delete: 'codicon-trash',
  skill: 'codicon-zap',
  useskill: 'codicon-zap',
  runskill: 'codicon-zap',
  run_skill: 'codicon-zap',
  execute_skill: 'codicon-zap',
  diff: 'codicon-diff',
  update_plan: 'codicon-checklist',
  exitplanmode: 'codicon-check-all',
  askuserquestion: 'codicon-comment-discussion',
  notebookedit: 'codicon-notebook',
};

function normalizeToolIdentifier(toolName: string): string {
  return toolName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 根据工具名称获取 codicon 图标类名
 */
function getCodiconClass(toolName: string, title: string): string {
  const lower = toolName.toLowerCase();
  const normalized = normalizeToolIdentifier(toolName);
  const lowerTitle = title.toLowerCase();

  if (
    lower === 'filechange' ||
    lower === 'file change' ||
    lower === 'file changes' ||
    lowerTitle.includes('file change')
  ) {
    return 'codicon-diff';
  }

  // 直接映射
  if (CODICON_MAP[lower]) return CODICON_MAP[lower];
  if (CODICON_MAP[normalized]) return CODICON_MAP[normalized];

  // 分类匹配
  if (isReadTool(lower)) return 'codicon-eye';
  if (isEditTool(lower)) return 'codicon-edit';
  if (isBashTool(lower)) return 'codicon-terminal';
  if (lower.includes('grep')) return 'codicon-search';
  if (lower.includes('glob') || lower.includes('find')) return 'codicon-folder';
  if (isSearchTool(lower)) return 'codicon-search';
  if (isWebTool(lower)) return 'codicon-globe';
  if (lower.includes('skill')) return 'codicon-zap';
  if (lower.includes('diff')) return 'codicon-diff';

  // MCP 工具根据名称猜测
  if (isMcpTool(title)) {
    if (lowerTitle.includes('search') || lowerTitle.includes('context')) return 'codicon-search';
    if (lowerTitle.includes('read') || lowerTitle.includes('file')) return 'codicon-eye';
    if (lowerTitle.includes('database') || lowerTitle.includes('sql')) return 'codicon-database';
    if (lowerTitle.includes('web') || lowerTitle.includes('fetch')) return 'codicon-globe';
  }

  return 'codicon-tools';
}

/**
 * 将 codicon 类名映射为灰色 lucide 描边图标（marker 风格前置图标）
 */
function resolveToolMarkerIcon(codiconClass: string) {
  // 必须带 size-3.5 class：仅 size={14} 属性挡不住 Marker 默认 size-4（16px）
  const iconProps = {
    size: 14 as const,
    className: 'size-3.5 shrink-0',
    'aria-hidden': true as const,
  };
  switch (codiconClass) {
    case 'codicon-eye':
      return <FileText {...iconProps} />;
    case 'codicon-edit':
      return <FilePen {...iconProps} />;
    case 'codicon-pencil':
      return <FilePlus {...iconProps} />;
    case 'codicon-terminal':
      return <Terminal {...iconProps} />;
    case 'codicon-search':
      return <Search {...iconProps} />;
    case 'codicon-folder':
      return <FolderSearch {...iconProps} />;
    case 'codicon-globe':
      return <Globe {...iconProps} />;
    case 'codicon-diff':
      return <FileDiff {...iconProps} />;
    case 'codicon-checklist':
      return <ListChecks {...iconProps} />;
    case 'codicon-zap':
      return <Zap {...iconProps} />;
    case 'codicon-notebook':
      return <NotebookPen {...iconProps} />;
    case 'codicon-database':
      return <Database {...iconProps} />;
    case 'codicon-comment-discussion':
      return <MessagesSquare {...iconProps} />;
    case 'codicon-check-all':
      return <CheckCheck {...iconProps} />;
    case 'codicon-trash':
      return <Trash2 {...iconProps} />;
    default:
      return <Wrench {...iconProps} />;
  }
}

export const GenericToolBlock = memo(function GenericToolBlock({
  item,
  workspaceId = null,
  isExpanded: externalExpanded,
  onToggle,
  activeCollaborationModeId = null,
  activeEngine,
  hasPendingUserInputRequest = false,
  onOpenFilePath,
  onOpenDiffPath,
  selectedExitPlanExecutionMode = null,
  onExitPlanModeExecute,
}: GenericToolBlockProps) {
  const { t } = useTranslation();
  const translateWithFallback = useCallback((key: string, fallback: string) => {
    const translated = t(key, { defaultValue: fallback });
    return translated && translated !== key ? translated : fallback;
  }, [t]);
  const presentation = useMemo(() => buildGenericToolPresentation(item), [item]);
  const {
    toolName,
    summary,
    isCollapsible,
    variant,
    hasChanges,
    exitPlanContent,
    shouldShowExitPlanRawOutput,
    displayChanges,
    imageCandidate,
    imageFallbackLocalPath,
    fileName,
    isDirectory,
    isFile,
    otherParams,
    markerStatus,
    hydrationWeight,
  } = presentation;
  const displayName = getToolDisplayName(toolName, item.title);
  const codiconClass = getCodiconClass(toolName, item.title);
  const isExitPlanTool = variant === 'exit-plan';
  const isFileChangeTool = variant === 'file-change';
  const isImageViewTool = variant === 'image-view';
  const exitPlanCopy = useMemo<ExitPlanToolCopy>(
    () => ({
      ariaLabel: translateWithFallback('messages.exitPlanCard.ariaLabel', 'Plan ready card'),
      title: translateWithFallback('messages.exitPlanCard.title', 'Execution Plan Ready'),
      modeLabel: translateWithFallback('messages.exitPlanCard.modeLabel', 'Exit Plan mode'),
      planSummary: translateWithFallback('messages.exitPlanCard.planSummary', 'Plan summary'),
      executionHandoff: translateWithFallback(
        'messages.exitPlanCard.executionHandoff',
        'Execution handoff',
      ),
      executionHandoffDescription: translateWithFallback(
        'messages.exitPlanCard.executionHandoffDescription',
        'The planning step is complete. Exit Plan mode to continue with implementation against this approved plan.',
      ),
      executionModeLabel: translateWithFallback(
        'messages.exitPlanCard.executionModeLabel',
        'Choose execution mode',
      ),
      executionModeDescription: translateWithFallback(
        'messages.exitPlanCard.executionModeDescription',
        'Approved plan confirmed. Continue by leaving Plan mode and choosing how to execute.',
      ),
      executeDefaultAction: translateWithFallback(
        'messages.exitPlanCard.executeDefaultAction',
        'Switch to default approval mode and run',
      ),
      executeFullAccessAction: translateWithFallback(
        'messages.exitPlanCard.executeFullAccessAction',
        'Switch to full auto and run',
      ),
      planFile: translateWithFallback('messages.exitPlanCard.planFile', 'Plan file'),
      rawOutput: translateWithFallback('messages.exitPlanCard.rawOutput', 'Raw output'),
      copy: t('messages.copy'),
      copied: t('messages.copied'),
    }),
    [t, translateWithFallback],
  );

  const [internalExpanded, setInternalExpanded] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [copiedPlanMarkdown, setCopiedPlanMarkdown] = useState(false);
  const [toolDetailHydrated, setToolDetailHydrated] = useState(false);
  useEffect(() => {
    setToolDetailHydrated(false);
  }, [item.id]);
  const isExpanded = isExitPlanTool
    ? externalExpanded
    : isCollapsible ? internalExpanded : externalExpanded;
  const shouldDeferToolOutput =
    isExpanded &&
    Boolean(item.output) &&
    !hasChanges &&
    !toolDetailHydrated &&
    hydrationWeight.isHeavyOutput;
  const imageViewPreviewSrc = useMemo(
    () => resolveImageViewPreviewSrc(imageCandidate),
    [imageCandidate],
  );

  const isAskUserQuestionTool = isAskUserQuestionToolName(toolName, item.title);
  const usesNativeAskUserQuestion =
    activeEngine === "claude" || activeEngine === "dsh";
  const showPlanModeHint =
    isAskUserQuestionTool &&
    activeCollaborationModeId === "code" &&
    !usesNativeAskUserQuestion;
  const suppressAskUserQuestionDump =
    isAskUserQuestionTool &&
    (usesNativeAskUserQuestion || hasPendingUserInputRequest);
  const shouldShowDetails =
    !suppressAskUserQuestionDump && otherParams.length > 0 && isExpanded;
  const isInteractive = Boolean(
    isCollapsible || otherParams.length > 0 || item.output || hasChanges,
  );

  const handleClick = () => {
    if (isExitPlanTool) {
      onToggle(item.id);
      return;
    }
    if (isCollapsible) {
      setInternalExpanded(prev => !prev);
    } else {
      onToggle(item.id);
    }
  };
  const renderToolDetailPlaceholder = (
    kind: string,
    metricValue: number,
  ) => (
    <div className="tool-heavy-detail-placeholder">
      <strong>{t("messages.toolHeavyDetailDeferred")}</strong>
      <span>
        {t("messages.toolHeavyDetailMeta", {
          kind,
          count: metricValue,
        })}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setToolDetailHydrated(true);
        }}
      >
        {t("messages.toolHeavyDetailShow")}
      </button>
    </div>
  );

  if (isExitPlanTool && exitPlanContent) {
    return (
      <ExitPlanToolContent
        itemId={item.id}
        content={exitPlanContent}
        copy={exitPlanCopy}
        workspaceId={workspaceId}
        isExpanded={isExpanded}
        copiedPlanMarkdown={copiedPlanMarkdown}
        onToggle={handleClick}
        onCopiedPlanMarkdownChange={setCopiedPlanMarkdown}
        activeEngine={activeEngine}
        selectedExecutionMode={selectedExitPlanExecutionMode}
        onExecute={onExitPlanModeExecute}
        shouldShowRawOutput={shouldShowExitPlanRawOutput}
      />
    );
  }

  // 文件变更统一渲染为「每文件一行」的共享 FileChangeRow：
  // 与 EditToolBlock / 分组编辑同源同款，单文件 / 多文件、实时 / 历史处处一致。
  // diff 由 FileChangeRow 展开时懒解析（折叠态不触发 parseDiff）。
  if (isFileChangeTool && hasChanges) {
    return (
      <FileChangeToolContent
        changes={displayChanges}
        status={markerStatus}
        onOpenFilePath={onOpenFilePath}
        onOpenDiffPath={onOpenDiffPath}
      />
    );
  }

  return (
    <div>
      <Marker
        {...(isInteractive ? { onClick: handleClick } : {})}
        className={cn(
          TOOL_META_ROW_CLASS,
          '[&_svg]:!size-3.5',
          isInteractive && 'cursor-pointer select-none hover:bg-accent/50',
        )}
      >
        <MarkerIcon className="size-3.5 shrink-0 [&_svg]:!size-3.5">
          {resolveToolMarkerIcon(codiconClass)}
        </MarkerIcon>
        <span className="shrink-0">{displayName}</span>
        {summary ? <span className="tool-meta-sep" aria-hidden /> : null}
        <MarkerContent className="flex min-w-0 items-center gap-2">
          {summary && (
            <span
              className={cn('truncate', (isFile || isDirectory) && 'tool-meta-path')}
              title={summary}
              style={(isFile || isDirectory) ? { display: 'inline-flex', alignItems: 'center', gap: '4px' } : undefined}
            >
              {(isFile || isDirectory) && (
                <FileIcon fileName={isDirectory ? fileName + '/' : fileName} size={14} />
              )}
              {summary}
            </span>
          )}
        </MarkerContent>
        <ToolStatusIcon status={markerStatus} />
      </Marker>

      {shouldShowDetails && (
        <div className="task-details" style={{ border: 'none' }}>
          <div className="task-content-wrapper">
            {otherParams.map(([key, value]) => (
              <div key={key} className="task-field">
                <div className="task-field-label">{key}</div>
                <div className="task-field-content">
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CollapsibleReveal
        open={Boolean(
          !suppressAskUserQuestionDump &&
          isExpanded && item.output && !hasChanges && (!isImageViewTool || !imageViewPreviewSrc),
        )}
      >
        <div className="task-details" style={{ padding: '12px', border: 'none' }}>
          <div className="task-field-content tool-output-raw-shell" style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}>
            <div className="tool-output-toolbar">
              <button
                type="button"
                className="bash-command-copy-btn"
                onClick={async (event) => {
                  event.stopPropagation();
                  if (await copyTextToClipboard(item.output ?? "")) {
                    setCopiedOutput(true);
                    window.setTimeout(() => setCopiedOutput(false), 1200);
                  } else {
                    setCopiedOutput(false);
                  }
                }}
              >
                {copiedOutput ? t("messages.copied") : t("messages.copy")}
              </button>
            </div>
            {shouldDeferToolOutput
              ? renderToolDetailPlaceholder(
                t("messages.toolHeavyOutput"),
                item.output?.length ?? 0,
              )
              : <pre className="tool-output-raw-pre">{item.output}</pre>}
          </div>
        </div>
      </CollapsibleReveal>

      {isImageViewTool && imageViewPreviewSrc && (
        <ImageViewToolContent
          previewSrc={imageViewPreviewSrc}
          workspaceId={workspaceId}
          localPath={imageFallbackLocalPath}
          alt={fileName || 'image preview'}
        />
      )}

      <CollapsibleReveal
        open={Boolean(
          !suppressAskUserQuestionDump &&
          isExpanded && !shouldShowDetails && !item.output && !hasChanges && item.detail,
        )}
      >
        <div className="task-details" style={{ padding: '12px', border: 'none' }}>
          <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{item.detail}</pre>
        </div>
      </CollapsibleReveal>

      {showPlanModeHint && (
        <div className="task-details" style={{ border: 'none' }}>
          <div className="task-content-wrapper">
            <div className="task-field-content">This feature requires Plan mode</div>
          </div>
        </div>
      )}
    </div>
  );
});
