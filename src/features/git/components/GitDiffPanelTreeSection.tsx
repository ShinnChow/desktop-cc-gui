import { useCallback, useMemo, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isEditableTarget, isFileMutationDisabled } from "./GitDiffPanel";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import {
  DiffFileRow,
  DiffFolderRow,
  type DiffFile,
  type DiffSectionProps,
  getTreeLineOpacity,
  GitFileTreeIcon,
  renderSectionCountBadge,
  renderSectionLineStatsBadge,
  renderSectionIndicator,
  TREE_INDENT_STEP,
} from "./GitDiffPanelFileSections";
import {
  buildDiffTree,
  compactDiffTree,
  type DiffTreeFolderNode,
} from "../utils/diffTree";
import { GitDiffPanelSectionActions } from "./GitDiffPanelSectionActions";
import {
  getFileInclusionState,
  normalizeDiffPath,
} from "./GitDiffPanelInclusion";

export type DiffTreeSectionProps = DiffSectionProps & {
  collapsedFolders: Set<string>;
  onToggleFolder: (key: string) => void;
  rootFolderName: string;
  rootTrailingAction?: ReactNode;
  leadingMeta?: ReactNode;
  compactHeader?: boolean;
};

export function DiffTreeSection({
  title,
  files,
  section,
  includedPaths,
  excludedPaths,
  partialPaths,
  selectedFiles,
  selectedPath,
  onActivateFile,
  onStageAllChanges,
  onStageFile,
  onUnstageAllChanges,
  onUnstageFile,
  onUnstageFiles,
  onDiscardFile,
  onDiscardFiles,
  isCommitPathLocked,
  onSetCommitSelection,
  onFileClick,
  onOpenInlinePreview,
  onOpenFilePreview,
  onRevealInFileManager,
  onOpenInBrowser,
  onShowFileMenu,
  collapsedFolders,
  onToggleFolder,
  rootFolderName,
  rootTrailingAction,
  leadingMeta,
  compactHeader = false,
  isCollapsed = false,
  onToggleCollapsed,
}: DiffTreeSectionProps) {
  const { t } = useTranslation();
  const tree = useMemo(() => compactDiffTree(buildDiffTree(files, section)), [files, section]);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const normalizedIncludedPaths = useMemo(
    () => includedPaths.map((path) => normalizeDiffPath(path)),
    [includedPaths],
  );
  const normalizedExcludedPaths = useMemo(
    () => excludedPaths.map((path) => normalizeDiffPath(path)),
    [excludedPaths],
  );
  const normalizedPartialPaths = useMemo(
    () => partialPaths.map((path) => normalizeDiffPath(path)),
    [partialPaths],
  );
  const includedPathSet = useMemo(
    () => new Set(normalizedIncludedPaths),
    [normalizedIncludedPaths],
  );
  const excludedPathSet = useMemo(
    () => new Set(normalizedExcludedPaths),
    [normalizedExcludedPaths],
  );
  const partialPathSet = useMemo(
    () => new Set(normalizedPartialPaths),
    [normalizedPartialPaths],
  );
  const actionFilePaths = useMemo(
    () =>
      files
        .filter((file) => !isFileMutationDisabled(file))
        .map((file) => file.path),
    [files],
  );
  const toggleableFilePaths = useMemo(
    () => files
      .filter((file) => !isFileMutationDisabled(file))
      .map((file) => file.path)
      .filter((path) => !isCommitPathLocked?.(path)),
    [files, isCommitPathLocked],
  );
  const sectionInclusionState = useMemo(() => {
    if (files.length === 0) {
      return "none";
    }
    const fileStates = files.map((file) =>
      getFileInclusionState(file.path, includedPathSet, excludedPathSet, partialPathSet),
    );
    if (fileStates.every((state) => state === "all")) {
      return "all";
    }
    if (fileStates.every((state) => state === "none")) {
      return "none";
    }
    return "partial";
  }, [excludedPathSet, files, includedPathSet, partialPathSet]);
  const sectionLineStats = useMemo(() => files.reduce(
    (acc, file) => ({
      additions: acc.additions + (file.additions ?? 0),
      deletions: acc.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  ), [files]);
  const showSectionActions =
    toggleableFilePaths.length > 0 ||
    actionFilePaths.length > 0;
  const hasTreeNodes = tree.folders.size > 0 || tree.files.length > 0;
  const hasRootFolderName = rootFolderName.trim().length > 0;
  const rootFolderKey = `${section}:__repo_root__/`;
  const rootCollapsed = collapsedFolders.has(rootFolderKey);
  const useCompactHeader = compactHeader && hasRootFolderName;

  const focusSiblingTreeNode = useCallback((from: HTMLElement, direction: -1 | 1) => {
    const container = treeContainerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(".diff-tree-folder-row, .diff-row"),
    );
    const currentIndex = nodes.indexOf(from);
    if (currentIndex < 0) {
      return;
    }
    const nextNode = nodes[currentIndex + direction];
    if (!nextNode) {
      return;
    }
    nextNode.focus();
  }, []);

  const focusParentFolder = useCallback((from: HTMLElement) => {
    const container = treeContainerRef.current;
    if (!container) {
      return;
    }
    const depth = Number(from.dataset.treeDepth ?? "0");
    if (!Number.isFinite(depth) || depth <= 0) {
      return;
    }
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(".diff-tree-folder-row, .diff-row"),
    );
    const currentIndex = nodes.indexOf(from);
    if (currentIndex <= 0) {
      return;
    }
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidate = nodes[index];
      if (!candidate) {
        continue;
      }
      const candidateDepth = Number(candidate.dataset.treeDepth ?? "0");
      if (!Number.isFinite(candidateDepth)) {
        continue;
      }
      if (candidateDepth < depth && candidate.classList.contains("diff-tree-folder-row")) {
        candidate.focus();
        return;
      }
    }
  }, []);

  const handleTreeKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (target.closest(".diff-row-action, .diff-section-actions button, .git-commit-scope-toggle")) {
        return;
      }
      const currentNode = target.closest<HTMLElement>(".diff-tree-folder-row, .diff-row");
      if (!currentNode) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusSiblingTreeNode(currentNode, 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusSiblingTreeNode(currentNode, -1);
        return;
      }
      const isFolder = currentNode.classList.contains("diff-tree-folder-row");
      if (event.key === "ArrowRight" && isFolder) {
        const isCollapsed = currentNode.dataset.collapsed === "true";
        if (isCollapsed) {
          event.preventDefault();
          currentNode.click();
          return;
        }
        event.preventDefault();
        focusSiblingTreeNode(currentNode, 1);
        return;
      }
      if (event.key === "ArrowLeft") {
        if (isFolder && currentNode.dataset.collapsed !== "true") {
          event.preventDefault();
          currentNode.click();
          return;
        }
        event.preventDefault();
        focusParentFolder(currentNode);
      }
    },
    [focusParentFolder, focusSiblingTreeNode],
  );

  const renderFolder = useCallback(
    (folder: DiffTreeFolderNode<DiffFile>, depth: number, parentKey?: string) => {
      const isCollapsed = collapsedFolders.has(folder.key);
      const hasChildren = folder.folders.size > 0 || folder.files.length > 0;
      const childTreeStyle = {
        ["--git-tree-branch-x" as string]: `${Math.max((depth + 1) * TREE_INDENT_STEP - 5, 0)}px`,
        ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(depth + 1),
      } as CSSProperties;
      return (
        <div key={folder.key} className="diff-tree-folder-group">
          <DiffFolderRow
            name={folder.name}
            depth={depth}
            collapsed={isCollapsed}
            hasChildren={hasChildren}
            onToggle={() => onToggleFolder(folder.key)}
          />
          {!isCollapsed && (
            <div className="diff-tree-folder-children" style={childTreeStyle}>
              {Array.from(folder.folders.values()).map((child) =>
                renderFolder(child, depth + 1, folder.key),
              )}
              {folder.files.map((file) => {
                const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
                const isActive = selectedPath === file.path;
                return (
                  <DiffFileRow
                    key={`${section}-${file.path}`}
                    file={file}
                    isSelected={isSelected}
                    isActive={isActive}
                    section={section}
                    inclusionState={getFileInclusionState(
                      file.path,
                      includedPathSet,
                      excludedPathSet,
                      partialPathSet,
                    )}
                    inclusionDisabled={Boolean(
                      isFileMutationDisabled(file) ||
                        isCommitPathLocked?.(file.path),
                    )}
                    indentLevel={depth + 1}
                    showDirectory={false}
                    treeItem
                    treeDepth={depth + 2}
                    treeParentFolderKey={parentKey ?? folder.key}
                    onClick={(event) => onFileClick(event, file.path, section)}
                    onKeySelect={() => onActivateFile?.(file.path, section)}
                    onOpenInlinePreview={
                      onOpenInlinePreview
                        ? () => onOpenInlinePreview(file.path)
                        : undefined
                    }
                    onOpenPreview={
                      onOpenFilePreview
                        ? () => onOpenFilePreview(file, section)
                        : undefined
                    }
                    onRevealInFileManager={
                      onRevealInFileManager
                        ? () => onRevealInFileManager(file.path)
                        : undefined
                    }
                    onOpenInBrowser={
                      onOpenInBrowser
                        ? () => onOpenInBrowser(file.path)
                        : undefined
                    }
                    onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                    onStageFile={onStageFile}
                    onUnstageFile={onUnstageFile}
                    onDiscardFile={onDiscardFile}
                    onSetCommitSelection={onSetCommitSelection}
                  />
                );
              })}
            </div>
          )}
        </div>
      );
    },
    [
      collapsedFolders,
      onFileClick,
      onOpenInlinePreview,
      onOpenFilePreview,
      onRevealInFileManager,
      onOpenInBrowser,
      onActivateFile,
      onShowFileMenu,
      includedPathSet,
      excludedPathSet,
      partialPathSet,
      isCommitPathLocked,
      onStageFile,
      onToggleFolder,
      onUnstageFile,
      onDiscardFile,
      onSetCommitSelection,
      section,
      selectedFiles,
      selectedPath,
    ],
  );

  return (
    <div
      className={`diff-section git-filetree-section diff-section--${section}${
        isCollapsed ? " is-collapsed" : ""
      }`}
    >
      <div
        className={`diff-section-title diff-section-title--row git-filetree-section-header${
          useCompactHeader ? " is-compact" : ""
        }`}
      >
        <span className="diff-tree-summary-section-label">
          {renderSectionIndicator(
            section,
            files.length,
            t,
            isCollapsed,
            onToggleCollapsed,
          )}
        </span>
        {!isCollapsed && rootTrailingAction ? (
          <span className="diff-tree-summary-root-action">{rootTrailingAction}</span>
        ) : null}
        {!isCollapsed && leadingMeta ? <span className="diff-tree-summary-meta">{leadingMeta}</span> : null}
        {!isCollapsed && showSectionActions && (
          <GitDiffPanelSectionActions
            title={title}
            section={section}
            sectionInclusionState={sectionInclusionState}
            toggleableFilePaths={toggleableFilePaths}
            filePaths={actionFilePaths}
            onSetCommitSelection={onSetCommitSelection}
            onStageAllChanges={
              actionFilePaths.length === files.length ? onStageAllChanges : undefined
            }
            onStageFile={onStageFile}
            onUnstageAllChanges={
              actionFilePaths.length === files.length ? onUnstageAllChanges : undefined
            }
            onUnstageFile={onUnstageFile}
            onUnstageFiles={onUnstageFiles}
            onDiscardFiles={onDiscardFiles}
          />
        )}
        {renderSectionLineStatsBadge(sectionLineStats.additions, sectionLineStats.deletions)}
        {renderSectionCountBadge(files.length)}
      </div>
      {!isCollapsed ? (
        <div
          ref={treeContainerRef}
          className={`diff-section-list diff-section-tree-list git-filetree-list git-filetree-list--tree${
            useCompactHeader ? " is-compact-root" : ""
          }`}
          role="tree"
          aria-label={title}
          onKeyDownCapture={handleTreeKeyDownCapture}
        >
        {hasTreeNodes && hasRootFolderName && (
          <div className="diff-tree-folder-group">
            <div
              className="diff-tree-folder-row git-filetree-folder-row"
              style={{ paddingLeft: "0px" }}
              data-folder-key={rootFolderKey}
              data-tree-depth={1}
              data-collapsed={String(rootCollapsed)}
              role="treeitem"
              tabIndex={0}
              aria-level={1}
              aria-label={rootFolderName}
              aria-expanded={!rootCollapsed}
              onClick={() => onToggleFolder(rootFolderKey)}
              onKeyDown={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button")) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleFolder(rootFolderKey);
                }
              }}
            >
              <span className="diff-tree-folder-toggle" aria-hidden>
                {rootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </span>
              <GitFileTreeIcon
                name={rootFolderName}
                isFolder
                isOpen={!rootCollapsed}
                className="diff-tree-folder-icon"
              />
              <span className="diff-tree-folder-name">{rootFolderName}</span>
            </div>
            {!rootCollapsed && (
              <div
                className="diff-tree-folder-children"
                style={
                  {
                    ["--git-tree-branch-x" as string]: `${Math.max(TREE_INDENT_STEP - 5, 0)}px`,
                    ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(1),
                  } as CSSProperties
                }
              >
                {Array.from(tree.folders.values()).map((folder) =>
                  renderFolder(folder, 1, rootFolderKey),
                )}
                {tree.files.map((file) => {
                  const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
                  const isActive = selectedPath === file.path;
                  return (
                    <DiffFileRow
                      key={`${section}-${file.path}`}
                      file={file}
                      isSelected={isSelected}
                      isActive={isActive}
                      section={section}
                      inclusionState={getFileInclusionState(
                        file.path,
                        includedPathSet,
                        excludedPathSet,
                        partialPathSet,
                      )}
                      inclusionDisabled={Boolean(
                        isFileMutationDisabled(file) ||
                          isCommitPathLocked?.(file.path),
                      )}
                      indentLevel={1}
                      showDirectory={false}
                      treeItem
                      treeDepth={2}
                      treeParentFolderKey={rootFolderKey}
                      onClick={(event) => onFileClick(event, file.path, section)}
                      onKeySelect={() => onActivateFile?.(file.path, section)}
                      onOpenInlinePreview={
                        onOpenInlinePreview
                          ? () => onOpenInlinePreview(file.path)
                          : undefined
                      }
                      onOpenPreview={
                        onOpenFilePreview
                          ? () => onOpenFilePreview(file, section)
                          : undefined
                      }
                      onRevealInFileManager={
                        onRevealInFileManager
                          ? () => onRevealInFileManager(file.path)
                          : undefined
                      }
                      onOpenInBrowser={
                        onOpenInBrowser
                          ? () => onOpenInBrowser(file.path)
                          : undefined
                      }
                      onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                      onStageFile={onStageFile}
                      onUnstageFile={onUnstageFile}
                      onDiscardFile={onDiscardFile}
                      onSetCommitSelection={onSetCommitSelection}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
        {hasTreeNodes && !hasRootFolderName && (
          <>
            {Array.from(tree.folders.values()).map((folder) => renderFolder(folder, 0))}
            {tree.files.map((file) => {
              const isSelected = selectedFiles.size > 1 && selectedFiles.has(file.path);
              const isActive = selectedPath === file.path;
              return (
                <DiffFileRow
                  key={`${section}-${file.path}`}
                  file={file}
                  isSelected={isSelected}
                  isActive={isActive}
                  section={section}
                  inclusionState={getFileInclusionState(
                    file.path,
                    includedPathSet,
                    excludedPathSet,
                    partialPathSet,
                  )}
                  inclusionDisabled={Boolean(
                    isFileMutationDisabled(file) ||
                      isCommitPathLocked?.(file.path),
                  )}
                  indentLevel={0}
                  showDirectory={false}
                  treeItem
                  treeDepth={1}
                  onClick={(event) => onFileClick(event, file.path, section)}
                  onKeySelect={() => onActivateFile?.(file.path, section)}
                  onOpenInlinePreview={
                    onOpenInlinePreview
                      ? () => onOpenInlinePreview(file.path)
                      : undefined
                  }
                  onOpenPreview={
                    onOpenFilePreview
                      ? () => onOpenFilePreview(file, section)
                      : undefined
                  }
                  onRevealInFileManager={
                    onRevealInFileManager
                      ? () => onRevealInFileManager(file.path)
                      : undefined
                  }
                  onOpenInBrowser={
                    onOpenInBrowser
                      ? () => onOpenInBrowser(file.path)
                      : undefined
                  }
                  onContextMenu={(event) => onShowFileMenu(event, file.path, section)}
                  onStageFile={onStageFile}
                  onUnstageFile={onUnstageFile}
                  onDiscardFile={onDiscardFile}
                  onSetCommitSelection={onSetCommitSelection}
                />
              );
            })}
          </>
        )}
        </div>
      ) : null}
    </div>
  );
}

