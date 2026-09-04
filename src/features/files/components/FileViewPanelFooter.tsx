import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { TFunction } from "i18next";
import Columns2 from "lucide-react/dist/esm/icons/columns-2";
import Eye from "lucide-react/dist/esm/icons/eye";
import FileSearch from "lucide-react/dist/esm/icons/file-search";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Rows2 from "lucide-react/dist/esm/icons/rows-2";
import { OpenAppMenu } from "../../app/components/OpenAppMenu";
import type { CodeAnnotationLineRange } from "../../code-annotations/types";
import { buildFileChatReference } from "../utils/codeSelectionChatSnippet";
import type { useFileGitBlame } from "../hooks/useFileGitBlame";
import type { useFileNavigation } from "../hooks/useFileNavigation";
import type { resolveFileViewSurface } from "../utils/fileViewSurface";
import type { FileViewPanelProps } from "./FileViewPanelContract";

export interface FileViewPanelFooterProps {
  absolutePath: string;
  activeAnnotationLineRange: CodeAnnotationLineRange | null;
  activeFileLineLabel: string | null;
  canEditDocument: boolean;
  content: string;
  editorSplitLayout: FileViewPanelProps["editorSplitLayout"];
  effectiveIsDirty: boolean;
  filePath: string;
  fileReferenceShouldRender: boolean;
  fileReferenceVisible: boolean;
  gitBlame: Pick<
    ReturnType<typeof useFileGitBlame>,
    "enabled" | "status" | "toggle"
  >;
  gitBlameActionLabel: string;
  gitBlameEligible: boolean;
  handleEnterEdit: () => void;
  handleEnterPreview: () => void;
  handleOpenFindPanel: () => void;
  handleStartEditorAnnotation: () => void;
  isEditorFileMaximized: boolean;
  mode: "preview" | "edit";
  navigationStatus: ReturnType<typeof useFileNavigation>["navigationStatus"];
  onInsertText: FileViewPanelProps["onInsertText"];
  onSelectOpenAppId: FileViewPanelProps["onSelectOpenAppId"];
  onToggleEditorFileMaximized: FileViewPanelProps["onToggleEditorFileMaximized"];
  onToggleEditorSplitLayout: FileViewPanelProps["onToggleEditorSplitLayout"];
  openAppIconById: FileViewPanelProps["openAppIconById"];
  openTargets: FileViewPanelProps["openTargets"];
  selectedOpenAppId: FileViewPanelProps["selectedOpenAppId"];
  skipTextRead: boolean;
  t: TFunction;
  truncated: boolean;
  viewSurface: ReturnType<typeof resolveFileViewSurface>;
  workspacePath: string;
}

export function FileViewPanelFooter({
  absolutePath,
  activeAnnotationLineRange,
  activeFileLineLabel,
  canEditDocument,
  content,
  editorSplitLayout,
  effectiveIsDirty,
  filePath,
  fileReferenceShouldRender,
  fileReferenceVisible,
  gitBlame,
  gitBlameActionLabel,
  gitBlameEligible,
  handleEnterEdit,
  handleEnterPreview,
  handleOpenFindPanel,
  handleStartEditorAnnotation,
  isEditorFileMaximized,
  mode,
  navigationStatus,
  onInsertText,
  onSelectOpenAppId,
  onToggleEditorFileMaximized,
  onToggleEditorSplitLayout,
  openAppIconById,
  openTargets,
  selectedOpenAppId,
  skipTextRead,
  t,
  truncated,
  viewSurface,
  workspacePath,
}: FileViewPanelFooterProps) {
  const splitResizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = null;
    };
  }, []);


  const handleFooterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "button,a,input,textarea,select,[role='button'],[role='menuitem']",
        )
      ) {
        return;
      }
      const footer = event.currentTarget;
      const splitRoot = footer.closest(
        ".content.is-editor-split-vertical",
      ) as HTMLElement | null;
      if (!splitRoot) {
        return;
      }
      const editorLayer = splitRoot.querySelector(
        ".content-layer--editor",
      ) as HTMLElement | null;
      const chatLayer = splitRoot.querySelector(
        ".content-layer--editor-companion",
      ) as HTMLElement | null;
      if (!editorLayer || !chatLayer) {
        return;
      }
      const editorRect = editorLayer.getBoundingClientRect();
      const chatRect = chatLayer.getBoundingClientRect();
      const totalHeight = editorRect.height + chatRect.height;
      if (totalHeight <= 0) {
        return;
      }

      event.preventDefault();

      const startY = event.clientY;
      const startEditorHeight = editorRect.height;
      const minEditorHeight = Math.max(140, totalHeight * 0.28);
      const maxEditorHeight = Math.min(totalHeight - 120, totalHeight * 0.82);
      if (maxEditorHeight <= minEditorHeight) {
        return;
      }

      document.body.classList.add("editor-split-resizing");

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.classList.remove("editor-split-resizing");
        splitResizeCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const nextHeight = Math.min(
          maxEditorHeight,
          Math.max(minEditorHeight, startEditorHeight + deltaY),
        );
        const nextRatio = (nextHeight / totalHeight) * 100;
        splitRoot.style.setProperty(
          "--editor-split-ratio",
          nextRatio.toFixed(2),
        );
      };

      const handlePointerUp = () => {
        cleanup();
      };

      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [],
  );

  const navigationModeLabel =
    navigationStatus?.phase === "loading"
      ? t("files.navigationPreparing")
      : navigationStatus?.phase === "indexing"
        ? navigationStatus.lifecycle === "indexing"
          ? t("files.navigationIndexing")
          : t("files.navigationTemporarilyDegraded")
        : navigationStatus?.mode === "semantic"
          ? t("files.navigationModeSemantic")
          : navigationStatus
            ? navigationStatus.fallbackReasonCode
              ? t("files.navigationModeFastSearchFallback")
              : t("files.navigationModeFastSearch")
            : null;

  return (
    <div
      className="fvp-footer"
      onPointerDown={handleFooterPointerDown}
      title={t("layout.resizePlanPanel")}
    >
      <div className="fvp-footer-left">
        {canEditDocument && mode === "edit" && effectiveIsDirty && (
          <span className="fvp-footer-hint">
            <span className="fvp-dirty-dot" />
            {t("files.unsavedChanges")}
            <span className="fvp-footer-shortcut">
              {t("files.saveShortcut")}
            </span>
          </span>
        )}
        {canEditDocument && mode === "edit" && !effectiveIsDirty && (
          <span className="fvp-footer-hint fvp-footer-saved">
            {t("files.saved")}
          </span>
        )}
        {mode === "preview" && (truncated || !canEditDocument) && (
          <span className="fvp-footer-hint">{t("files.readOnly")}</span>
        )}
        {navigationStatus && navigationModeLabel ? (
          <span
            className={`fvp-navigation-mode is-${navigationStatus.phase}`}
            title={navigationStatus.provider}
          >
            {navigationModeLabel}
            {navigationStatus.language ? ` · ${navigationStatus.language}` : ""}
          </span>
        ) : null}
      </div>
      <div className="fvp-footer-right">
        {fileReferenceShouldRender ? (
          <div
            className={`fvp-file-reference-bar${fileReferenceVisible ? " is-visible" : ""}`}
            role="group"
            aria-label={t("composer.fileReference")}
          >
            <span className="fvp-file-reference-label">
              {t("composer.activeFile")}:
            </span>
            <code className="fvp-file-reference-path" title={filePath}>
              {filePath.split("/").pop() || filePath}
            </code>
            {activeFileLineLabel ? (
              <span className="fvp-file-reference-lines">
                {activeFileLineLabel}
              </span>
            ) : null}
            {viewSurface.kind === "editor" && activeAnnotationLineRange ? (
              <button
                type="button"
                className="fvp-annotation-trigger fvp-file-reference-annotation"
                onClick={handleStartEditorAnnotation}
              >
                {t("files.annotateForAi")}
              </button>
            ) : null}
          </div>
        ) : null}
        {mode === "edit" && (gitBlameEligible || gitBlame.enabled) ? (
          <button
            type="button"
            className={`ghost fvp-action-btn fvp-git-blame-toggle${
              gitBlame.enabled ? " is-active" : ""
            }${gitBlame.status === "error" ? " is-error" : ""}`}
            aria-label={gitBlameActionLabel}
            aria-pressed={gitBlame.enabled}
            title={gitBlameActionLabel}
            onClick={gitBlame.toggle}
            disabled={!gitBlameEligible && !gitBlame.enabled}
          >
            <GitCommitHorizontal size={12} aria-hidden />
          </button>
        ) : null}
        {canEditDocument ? (
          mode === "preview" ? (
            <button
              type="button"
              className="ghost fvp-action-btn fvp-mode-toggle"
              aria-label={t("files.edit")}
              title={t("files.edit")}
              onClick={handleEnterEdit}
              disabled={truncated}
            >
              <Pencil size={12} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="ghost fvp-action-btn fvp-mode-toggle"
              aria-label={t("files.preview")}
              title={t("files.preview")}
              onClick={handleEnterPreview}
            >
              <Eye size={12} aria-hidden />
            </button>
          )
        ) : null}
        {mode === "preview" && onInsertText && content.trim().length > 0 && (
          <button
            type="button"
            className="ghost fvp-action-btn"
            onClick={() => {
              const reference = buildFileChatReference(filePath);
              if (reference) {
                onInsertText(reference);
              }
            }}
          >
            {t("files.addToChat")}
          </button>
        )}
        {!skipTextRead && !truncated ? (
          <button
            type="button"
            className="ghost fvp-action-btn fvp-find-toggle"
            aria-label={t("files.openFind")}
            title={t("files.openFind")}
            onClick={handleOpenFindPanel}
          >
            <FileSearch size={12} aria-hidden />
          </button>
        ) : null}
        {onToggleEditorFileMaximized ? (
          <button
            type="button"
            className="ghost fvp-action-btn fvp-maximize-toggle"
            aria-label={
              isEditorFileMaximized ? t("common.restore") : t("menu.maximize")
            }
            title={
              isEditorFileMaximized ? t("common.restore") : t("menu.maximize")
            }
            onClick={onToggleEditorFileMaximized}
          >
            {isEditorFileMaximized ? (
              <Minimize2 size={12} aria-hidden />
            ) : (
              <Maximize2 size={12} aria-hidden />
            )}
          </button>
        ) : null}
        {onToggleEditorSplitLayout ? (
          <button
            type="button"
            className={`ghost fvp-action-btn fvp-layout-toggle${
              editorSplitLayout === "horizontal" ? " is-side-by-side" : ""
            }`}
            aria-label={
              editorSplitLayout === "horizontal"
                ? t("files.switchToStackedSplit")
                : t("files.switchToSideBySideSplit")
            }
            title={
              editorSplitLayout === "horizontal"
                ? t("files.switchToStackedSplit")
                : t("files.switchToSideBySideSplit")
            }
            onClick={onToggleEditorSplitLayout}
          >
            {editorSplitLayout === "horizontal" ? (
              <Rows2 size={12} aria-hidden />
            ) : (
              <Columns2 size={12} aria-hidden />
            )}
          </button>
        ) : null}
        <OpenAppMenu
          path={absolutePath || workspacePath}
          activeFilePath={absolutePath}
          openTargets={openTargets}
          selectedOpenAppId={selectedOpenAppId}
          onSelectOpenAppId={onSelectOpenAppId}
          iconById={openAppIconById}
          menuPlacement="up"
        />
      </div>
    </div>
  );
}
