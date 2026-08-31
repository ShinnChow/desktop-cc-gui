import type { MouseEvent as ReactMouseEvent } from "react";
import type { TFunction } from "i18next";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import X from "lucide-react/dist/esm/icons/x";
import { getFileTreeIconSvg } from "../utils/fileTreeIcons";
import type { useFileTabDrag } from "../hooks/useFileTabDrag";
import type { FileViewPanelProps } from "./FileViewPanelContract";

type FileViewTabDrag = ReturnType<typeof useFileTabDrag>;

export interface FileViewPanelTabsProps {
  activeTabPath: FileViewPanelProps["activeTabPath"];
  canReorderTabs: boolean;
  className?: string;
  draggingTabPath: string | null;
  dragOverTabPath: string | null;
  endTabDrag: FileViewTabDrag["endTabDrag"];
  filePath: string;
  handleOpenDetachedTab: (tabPath: string) => void;
  handleTabPointerDown: FileViewTabDrag["handleTabPointerDown"];
  handleTabPointerMove: FileViewTabDrag["handleTabPointerMove"];
  handleTabPointerUp: FileViewTabDrag["handleTabPointerUp"];
  onActivateTab: FileViewPanelProps["onActivateTab"];
  onCloseTab: FileViewPanelProps["onCloseTab"];
  onToggleEditorFileMaximized: FileViewPanelProps["onToggleEditorFileMaximized"];
  openTabContextMenu: (event: ReactMouseEvent, tabPath: string) => void;
  resolveMatchedGitStatusByPath: (
    path: string,
  ) => { status: string; path: string } | null;
  suppressTabClickRef: FileViewTabDrag["suppressTabClickRef"];
  t: TFunction;
  tabsContainerRef: { current: HTMLDivElement | null };
  visibleTabs: string[];
}

export function FileViewPanelTabs({
  activeTabPath,
  canReorderTabs,
  className,
  draggingTabPath,
  dragOverTabPath,
  endTabDrag,
  filePath,
  handleOpenDetachedTab,
  handleTabPointerDown,
  handleTabPointerMove,
  handleTabPointerUp,
  onActivateTab,
  onCloseTab,
  onToggleEditorFileMaximized,
  openTabContextMenu,
  resolveMatchedGitStatusByPath,
  suppressTabClickRef,
  t,
  tabsContainerRef,
  visibleTabs,
}: FileViewPanelTabsProps) {
  return (
    <div
      ref={tabsContainerRef}
      className={`fvp-tabs${className ? ` ${className}` : ""}`}
      role="tablist"
      aria-label="Open files"
    >
      <div className="fvp-tabs-track">
        {visibleTabs.map((tabPath) => {
          const isActive = (activeTabPath ?? filePath) === tabPath;
          const tabName = tabPath.split("/").pop() || tabPath;
          const tabGitStatus =
            resolveMatchedGitStatusByPath(tabPath)?.status ?? null;
          const tabGitStatusClass = tabGitStatus
            ? `git-${tabGitStatus.toLowerCase()}`
            : "";
          const isDragging = draggingTabPath === tabPath;
          const isDragOver =
            Boolean(draggingTabPath) &&
            dragOverTabPath === tabPath &&
            draggingTabPath !== tabPath;
          return (
            <div
              key={tabPath}
              className={`fvp-tab ${isActive ? "is-active" : ""} ${
                isDragging ? "is-dragging" : ""
              } ${isDragOver ? "is-drag-over" : ""} ${tabGitStatusClass}`
                .replace(/\s+/g, " ")
                .trim()}
              role="presentation"
              data-tab-path={tabPath}
              data-tauri-drag-region={canReorderTabs ? "false" : undefined}
              onPointerDown={
                canReorderTabs
                  ? (event) => handleTabPointerDown(event, tabPath)
                  : undefined
              }
              onPointerMove={canReorderTabs ? handleTabPointerMove : undefined}
              onPointerUp={canReorderTabs ? handleTabPointerUp : undefined}
              onPointerCancel={canReorderTabs ? endTabDrag : undefined}
            >
              <button
                type="button"
                className="fvp-tab-main"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  if (suppressTabClickRef.current) {
                    suppressTabClickRef.current = false;
                    return;
                  }
                  onActivateTab?.(tabPath);
                }}
                onDoubleClick={() => onToggleEditorFileMaximized?.()}
                onContextMenu={(event) => openTabContextMenu(event, tabPath)}
                title={tabPath}
                data-tauri-drag-region="false"
              >
                <span className="fvp-tab-main-content">
                  <span
                    className="fvp-tab-icon"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: getFileTreeIconSvg(tabName, false),
                    }}
                  />
                  <span className="fvp-tab-main-label">{tabName}</span>
                </span>
              </button>
              <button
                type="button"
                className="fvp-tab-detach"
                aria-label={t("files.openDetachedTabFor", { name: tabName })}
                title={t("files.openDetachedTab")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleOpenDetachedTab(tabPath);
                }}
                onContextMenu={(event) => openTabContextMenu(event, tabPath)}
                data-tauri-drag-region="false"
              >
                <ExternalLink size={11} aria-hidden />
              </button>
              {onCloseTab ? (
                <button
                  type="button"
                  className="fvp-tab-close"
                  aria-label={`Close ${tabName}`}
                  onClick={() => onCloseTab(tabPath)}
                  onContextMenu={(event) => openTabContextMenu(event, tabPath)}
                  data-tauri-drag-region="false"
                >
                  <X size={11} aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
