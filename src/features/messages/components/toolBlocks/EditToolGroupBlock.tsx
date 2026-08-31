/**
 * 批量编辑文件分组组件（文件修改场景）
 * - 唯一文件：直接 FileChangeRow，不套「文件修改（1 个）」组头
 * - 多文件：默认折叠 header（icon + 文件修改（N 个）+ 聚合 status）；展开体为文件列表
 * 入参可混排 edit / write / fileChange；多文件折叠态不解析 diff 正文，仅在展开后按行懒加载。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FilePen from 'lucide-react/dist/esm/icons/file-pen';
import type { ConversationItem } from '../../../../types';
import {
  parseToolArgs,
  resolveToolStatus,
  type ToolStatusTone,
  asRecord,
  pickStringField,
  EDIT_PATH_KEYS,
  EDIT_OLD_KEYS,
  EDIT_NEW_KEYS,
  EDIT_CONTENT_KEYS,
} from './toolConstants';
import { computeDiff, computeDiffFromUnifiedPatch, type DiffStats } from '../../../../utils/diff';
import { ToolMarkerShell, ToolStatusIcon } from './ToolMarkerShell';
import {
  FileChangeRow,
  structuredDiffToLines,
  unifiedDiffToPreview,
  type FileChangeDiffLine,
  type FileChangeDiffPreview,
} from './FileChangeRow';
import {
  extractUnifiedDiffForPath,
  mergeEditSceneStatus,
  normalizeEditScenePath,
} from './fileEditSceneUtils';



type ToolItem = Extract<ConversationItem, { kind: 'tool' }>;

interface EditToolGroupBlockProps {
  items: ToolItem[];
  /** Prefer in-app editor when a row has no expandable inline diff. */
  onOpenFilePath?: (path: string) => void;
  /** Legacy git dual-pane open (only when onOpenFilePath is absent). */
  onOpenDiffPath?: (path: string) => void;
  /** 默认折叠；测试或未来设置可覆盖 */
  defaultCollapsed?: boolean;
}

/** 折叠态只保留 path/status；stats/diff 在场景展开后按行解析。 */
interface ParsedEditSceneItem {
  id: string;
  filePath: string;
  status: ToolStatusTone;
  resolveStats: () => DiffStats;
  loadDiff?: () => FileChangeDiffPreview;
}

const MAX_VISIBLE_ITEMS = 6;
const ITEM_HEIGHT = 32;

/** 同一路径多次修改时保留最后一次（count 按唯一文件计）。 */
function dedupeParsedEditsByPath(entries: ParsedEditSceneItem[]): ParsedEditSceneItem[] {
  const byPath = new Map<string, ParsedEditSceneItem>();
  for (const entry of entries) {
    byPath.set(entry.filePath, entry);
  }
  return Array.from(byPath.values());
}

function parseEditSceneItems(item: ToolItem): ParsedEditSceneItem[] {
  const hasOutput = Boolean(item.output) || Boolean(item.changes?.length);
  const status = resolveToolStatus(item.status, hasOutput);

  if (item.toolType === 'fileChange' && item.changes?.length) {
    const rows: ParsedEditSceneItem[] = [];
    const sharedOutput = item.output ?? '';
    item.changes.forEach((change, index) => {
      const filePath = normalizeEditScenePath(change.path ?? '');
      if (!filePath) {
        return;
      }
      // Prefer per-file diff; fall back to carving a slice from shared tool output.
      const diffText =
        (change.diff ?? '').trim() ||
        extractUnifiedDiffForPath(sharedOutput, filePath);
      rows.push({
        id: `${item.id}::${filePath}::${index}`,
        filePath,
        status,
        resolveStats: () => computeDiffFromUnifiedPatch(diffText),
        loadDiff: diffText
          ? () => unifiedDiffToPreview(diffText)
          : undefined,
      });
    });
    return rows;
  }

  const args = parseToolArgs(item.detail);
  const nestedInput = asRecord(args?.input);
  const nestedArgs = asRecord(args?.arguments);
  const filePath = normalizeEditScenePath(
    pickStringField(args, nestedInput, nestedArgs, EDIT_PATH_KEYS),
  );
  if (!filePath) {
    return [];
  }

  const oldString = pickStringField(args, nestedInput, nestedArgs, EDIT_OLD_KEYS);
  const newString = pickStringField(args, nestedInput, nestedArgs, EDIT_NEW_KEYS);
  const content = pickStringField(args, nestedInput, nestedArgs, EDIT_CONTENT_KEYS);
  const hasInlineDiff = Boolean(oldString || newString || content);

  let cachedStructured: { stats: DiffStats; lines: FileChangeDiffLine[] } | null = null;
  const resolveStructured = (): { stats: DiffStats; lines: FileChangeDiffLine[] } => {
    if (cachedStructured) {
      return cachedStructured;
    }
    if (oldString || newString) {
      const result = computeDiff(oldString, newString);
      cachedStructured = {
        stats: { additions: result.additions, deletions: result.deletions },
        lines: structuredDiffToLines(result.lines),
      };
      return cachedStructured;
    }
    if (content) {
      const result = computeDiff('', content);
      cachedStructured = {
        stats: { additions: result.additions, deletions: result.deletions },
        lines: structuredDiffToLines(result.lines),
      };
      return cachedStructured;
    }
    cachedStructured = { stats: { additions: 0, deletions: 0 }, lines: [] };
    return cachedStructured;
  };

  return [
    {
      id: item.id,
      filePath,
      status,
      resolveStats: () => resolveStructured().stats,
      loadDiff: hasInlineDiff
        ? () => ({ lines: resolveStructured().lines })
        : undefined,
    },
  ];
}

export const EditToolGroupBlock = memo(function EditToolGroupBlock({
  items,
  onOpenFilePath,
  onOpenDiffPath,
  defaultCollapsed = true,
}: EditToolGroupBlockProps) {
  // Missing inline diff → open workspace editor (friendly). Avoid git dual-pane
  // which shows broken "Asrc/..." chrome for brand-new files without a baseline.
  const openMissingDiffPath = onOpenFilePath ?? onOpenDiffPath;
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousCountRef = useRef(0);

  // 折叠态只建轻量索引（path/status + 懒闭包），不触发 diff 正文解析。
  const sceneItems = useMemo(
    () => dedupeParsedEditsByPath(items.flatMap(parseEditSceneItems)),
    [items],
  );

  const sceneStatus = useMemo(
    () => mergeEditSceneStatus(sceneItems.map((entry) => entry.status)),
    [sceneItems],
  );

  // 仅在场景展开后解析 per-file stats，避免折叠付全量 diff 成本。
  const expandedRows = useMemo(() => {
    if (!isExpanded) {
      return [];
    }
    return sceneItems.map((entry) => {
      const stats = entry.resolveStats();
      return {
        id: entry.id,
        filePath: entry.filePath,
        status: entry.status,
        additions: stats.additions,
        deletions: stats.deletions,
        loadDiff: entry.loadDiff,
      };
    });
  }, [isExpanded, sceneItems]);

  useEffect(() => {
    if (
      isExpanded &&
      sceneItems.length > previousCountRef.current &&
      listRef.current
    ) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    previousCountRef.current = sceneItems.length;
  }, [sceneItems.length, isExpanded]);

  if (!sceneItems.length) {
    return null;
  }

  // 单文件不走组模式：与 EditToolBlock 同款 FileChangeRow，避免「文件修改（1 个）→ 再缩进一行」
  if (sceneItems.length === 1) {
    const entry = sceneItems[0]!;
    const stats = entry.resolveStats();
    return (
      <FileChangeRow
        filePath={entry.filePath}
        additions={stats.additions}
        deletions={stats.deletions}
        status={entry.status}
        canExpand={Boolean(entry.loadDiff)}
        loadDiff={entry.loadDiff}
        onOpenDiffPath={entry.loadDiff ? onOpenDiffPath : openMissingDiffPath}
        defaultExpanded={!defaultCollapsed}
      />
    );
  }

  const fileCount = sceneItems.length;
  const needsScroll = expandedRows.length > MAX_VISIBLE_ITEMS;
  const listHeight = Math.min(expandedRows.length, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT;
  const sceneLabel = t('tools.fileEditSceneCount', { count: fileCount });
  const sceneAriaLabel = t('tools.fileEditSceneToggle', { count: fileCount });

  return (
    <ToolMarkerShell
      icon={<FilePen size={14} aria-hidden />}
      label={sceneLabel}
      ariaLabel={sceneAriaLabel}
      expanded={isExpanded}
      onToggle={() => setIsExpanded((previous) => !previous)}
      trailing={<ToolStatusIcon status={sceneStatus} />}
      body={
        <div
          ref={listRef}
          className="file-list-container file-edit-scene-list mt-1 ml-4 overflow-hidden"
          data-testid="file-edit-scene-list"
          style={{
            maxHeight: needsScroll ? `${listHeight + 12}px` : undefined,
            overflowY: needsScroll ? 'auto' : 'hidden',
            overflowX: 'hidden',
          }}
        >
          {expandedRows.map((entry) => (
            <FileChangeRow
              key={entry.id}
              filePath={entry.filePath}
              additions={entry.additions}
              deletions={entry.deletions}
              status={entry.status}
              canExpand={Boolean(entry.loadDiff)}
              loadDiff={entry.loadDiff}
              onOpenDiffPath={
                entry.loadDiff ? onOpenDiffPath : openMissingDiffPath
              }
            />
          ))}
        </div>
      }
    />
  );
});
