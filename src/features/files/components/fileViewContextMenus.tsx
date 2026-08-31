import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import ClipboardPaste from "lucide-react/dist/esm/icons/clipboard-paste";
import Code from "lucide-react/dist/esm/icons/code";
import Copy from "lucide-react/dist/esm/icons/copy";
import CopyX from "lucide-react/dist/esm/icons/copy-x";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Eye from "lucide-react/dist/esm/icons/eye";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import History from "lucide-react/dist/esm/icons/history";
import LocateFixed from "lucide-react/dist/esm/icons/locate-fixed";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import PanelTopClose from "lucide-react/dist/esm/icons/panel-top-close";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Save from "lucide-react/dist/esm/icons/save";
import Scissors from "lucide-react/dist/esm/icons/scissors";
import Search from "lucide-react/dist/esm/icons/search";
import TextSelect from "lucide-react/dist/esm/icons/text-select";
import X from "lucide-react/dist/esm/icons/x";
import { pushErrorToast } from "../../../services/toasts";
import { formatShortcutForPlatform } from "../../../utils/shortcuts";
import {
  clampRendererContextMenuPosition,
  estimateRendererContextMenuHeight,
  type RendererContextMenuItem,
  type RendererContextMenuLeafItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import type { NoteCaptureDraft } from "../../note-cards/types";
import { buildCodeSelectionChatSnippet } from "../utils/codeSelectionChatSnippet";
import { buildCodeSelectionNoteDraft } from "../../note-cards/utils/noteCapture";
import { FILE_CONTEXT_MENU_SHORTCUTS } from "../utils/fileContextMenuShortcuts";
import {
  formatOpenHtmlInBrowserError,
  isHtmlFilePath,
  openHtmlInBrowser,
} from "../utils/openHtmlInBrowser";
import type { useFileDocumentState } from "../hooks/useFileDocumentState";
import type { useFileGitBlame } from "../hooks/useFileGitBlame";
import type { useFileNavigation } from "../hooks/useFileNavigation";
import type { resolveFileRenderProfile } from "../utils/fileRenderProfile";
import { resolveAbsolutePath } from "./fileViewPanelShared";
import type { FileCodeMirrorEditorHandle } from "./FileCodeMirrorEditor";
import type { FileViewPanelProps } from "./FileViewPanelContract";

type FileNavigation = ReturnType<typeof useFileNavigation>;

export interface FileViewContextMenuDeps {
  activeFileGitScope: { repositoryRoot: string; path: string } | null;
  canEditDocument: boolean;
  cmRef: { current: FileCodeMirrorEditorHandle | null };
  content: string;
  documentSnapshot: ReturnType<typeof useFileDocumentState>["documentSnapshot"];
  effectiveIsDirty: boolean;
  event: ReactMouseEvent<HTMLDivElement>;
  expandSelectionShortcut: string | null;
  filePath: string;
  gitBlame: Pick<ReturnType<typeof useFileGitBlame>, "enabled" | "toggle">;
  gitBlameActionLabel: string;
  gitBlameEligible: boolean;
  handleAssociateIntentCanvasCodeAnchor: () => void;
  handleEnterEdit: () => void;
  handleEnterPreview: () => void;
  handleSave: () => Promise<void>;
  isDefinitionLoading: FileNavigation["isDefinitionLoading"];
  isImplementationsLoading: FileNavigation["isImplementationsLoading"];
  isReferencesLoading: FileNavigation["isReferencesLoading"];
  isSaving: boolean;
  mode: "preview" | "edit";
  onAssociateIntentCanvasCodeAnchor: FileViewPanelProps["onAssociateIntentCanvasCodeAnchor"];
  onCaptureNote: FileViewPanelProps["onCaptureNote"];
  onInsertText: FileViewPanelProps["onInsertText"];
  onOpenFileHistory: FileViewPanelProps["onOpenFileHistory"];
  onRevealInFileTree: FileViewPanelProps["onRevealInFileTree"];
  renderProfile: ReturnType<typeof resolveFileRenderProfile>;
  runDefinitionFromCursor: FileNavigation["runDefinitionFromCursor"];
  runImplementationsFromCursor: FileNavigation["runImplementationsFromCursor"];
  runReferencesFromCursor: FileNavigation["runReferencesFromCursor"];
  saveFileShortcut: string | null;
  selectionNoteDraft?: NoteCaptureDraft;
  setFileContextMenu: Dispatch<SetStateAction<RendererContextMenuState | null>>;
  showClipboardError: (action: string, error: unknown) => void;
  skipTextRead: boolean;
  t: TFunction;
  truncated: boolean;
  workspaceId: string;
  workspacePath: string;
}

export function buildFileViewContextMenu({
  activeFileGitScope,
  canEditDocument,
  cmRef,
  content,
  documentSnapshot,
  effectiveIsDirty,
  event,
  expandSelectionShortcut,
  filePath,
  gitBlame,
  gitBlameActionLabel,
  gitBlameEligible,
  handleAssociateIntentCanvasCodeAnchor,
  handleEnterEdit,
  handleEnterPreview,
  handleSave,
  isDefinitionLoading,
  isImplementationsLoading,
  isReferencesLoading,
  isSaving,
  mode,
  onAssociateIntentCanvasCodeAnchor,
  onCaptureNote,
  onInsertText,
  onOpenFileHistory,
  onRevealInFileTree,
  renderProfile,
  runDefinitionFromCursor,
  runImplementationsFromCursor,
  runReferencesFromCursor,
  saveFileShortcut,
  selectionNoteDraft,
  setFileContextMenu,
  showClipboardError,
  skipTextRead,
  t,
  truncated,
  workspaceId,
  workspacePath,
}: FileViewContextMenuDeps): void {
  const target = event.target instanceof Element ? event.target : null;
  const isCodeMirrorTarget = Boolean(target?.closest(".cm-editor"));
  const isIndependentEditableTarget = Boolean(
    target?.closest('input, textarea, [contenteditable="true"]'),
  );
  if (!isCodeMirrorTarget && isIndependentEditableTarget) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const editorView = mode === "edit" ? (cmRef.current?.view ?? null) : null;
  const editorSelectionText = editorView
    ? editorView.state.selection.ranges
        .filter((range) => !range.empty)
        .map((range) => editorView.state.sliceDoc(range.from, range.to))
        .join(editorView.state.lineBreak)
    : "";
  const selectedText = editorView
    ? editorSelectionText
    : (window.getSelection()?.toString() ?? "");
  const canMutateEditor = Boolean(
    editorView && canEditDocument && mode === "edit" && !truncated,
  );
  const wholeFileNoteDraft =
    !selectionNoteDraft && onCaptureNote && !skipTextRead && !truncated
      ? buildCodeSelectionNoteDraft({
          path: filePath,
          content: editorView
            ? editorView.state.doc.sliceString(
                0,
                editorView.state.doc.length,
              )
            : content,
          startLine: 1,
          endLine: editorView
            ? editorView.state.doc.lines
            : documentSnapshot.lineCount,
          language: renderProfile.previewLanguage,
        })
      : null;
  const noteCaptureDraft = selectionNoteDraft ?? wholeFileNoteDraft;
  const selectionSource =
    selectionNoteDraft?.source.kind === "codeSelection"
      ? selectionNoteDraft.source
      : null;
  // Preview mode keeps logical line selection outside window.getSelection();
  // fall back to the snapshot range from note-capture draft when needed.
  const selectionContentFromSnapshot = selectionSource
    ? documentSnapshot
        .getLines(selectionSource.startLine - 1, selectionSource.endLine)
        .join("\n")
    : "";
  const selectionContent =
    selectedText.trim().length > 0
      ? selectedText
      : selectionContentFromSnapshot;
  const selectionChatSnippet =
    onInsertText && selectionContent.trim().length > 0
      ? selectionSource
        ? buildCodeSelectionChatSnippet({
            path: selectionSource.path,
            content: selectionContent,
            startLine: selectionSource.startLine,
            endLine: selectionSource.endLine,
            language:
              selectionSource.language ?? renderProfile.previewLanguage,
          })
        : editorView
          ? (() => {
              const selection = editorView.state.selection.main;
              if (selection.empty) {
                return null;
              }
              const endOffset = Math.max(selection.from, selection.to - 1);
              return buildCodeSelectionChatSnippet({
                path: filePath,
                content: selectionContent,
                startLine: editorView.state.doc.lineAt(selection.from)
                  .number,
                endLine: editorView.state.doc.lineAt(endOffset).number,
                language: renderProfile.previewLanguage,
              });
            })()
          : null
      : null;

  const writeClipboardText = async (action: string, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error(t("files.clipboardUnavailable"));
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      showClipboardError(action, error);
      return false;
    }
  };

  const clipboardItems: RendererContextMenuItem[] = [
    {
      type: "item",
      id: "cut-selection",
      label: t("files.cutItem"),
      icon: <Scissors size={15} />,
      shortcut: formatShortcutForPlatform(FILE_CONTEXT_MENU_SHORTCUTS.cut),
      disabled: !canMutateEditor || !selectedText,
      onSelect: async () => {
        if (
          !editorView ||
          !(await writeClipboardText(t("files.cutItem"), selectedText))
        ) {
          return;
        }
        editorView.dispatch(editorView.state.replaceSelection(""));
        editorView.focus();
      },
    },
    {
      type: "item",
      id: "copy-selection",
      label: t("files.copyItem"),
      icon: <Copy size={15} />,
      shortcut: formatShortcutForPlatform(FILE_CONTEXT_MENU_SHORTCUTS.copy),
      disabled: !selectedText,
      onSelect: async () => {
        await writeClipboardText(t("files.copyItem"), selectedText);
      },
    },
    {
      type: "item",
      id: "paste-selection",
      label: t("files.pasteItem"),
      icon: <ClipboardPaste size={15} />,
      shortcut: formatShortcutForPlatform(
        FILE_CONTEXT_MENU_SHORTCUTS.paste,
      ),
      disabled: !canMutateEditor,
      onSelect: async () => {
        try {
          if (!editorView || !navigator.clipboard?.readText) {
            throw new Error(t("files.clipboardUnavailable"));
          }
          const clipboardText = await navigator.clipboard.readText();
          editorView.dispatch(
            editorView.state.replaceSelection(clipboardText),
          );
          editorView.focus();
        } catch (error) {
          showClipboardError(t("files.pasteItem"), error);
        }
      },
    },
  ];

  const gitItems: RendererContextMenuLeafItem[] = [
    ...(activeFileGitScope && onOpenFileHistory
      ? [
          {
            type: "item" as const,
            id: "show-file-history",
            label: t("files.tabShowFileHistory"),
            icon: <History size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.showFileHistory,
            ),
            onSelect: () =>
              onOpenFileHistory({
                workspaceId,
                workspacePath,
                repositoryRoot: activeFileGitScope.repositoryRoot,
                path: activeFileGitScope.path,
                displayPath: filePath,
              }),
          },
        ]
      : []),
    ...(mode === "edit" && (gitBlameEligible || gitBlame.enabled)
      ? [
          {
            type: "item" as const,
            id: "toggle-file-git-blame",
            label: gitBlameActionLabel,
            icon: <GitCommitHorizontal size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.toggleGitBlame,
            ),
            disabled: !gitBlameEligible && !gitBlame.enabled,
            onSelect: gitBlame.toggle,
          },
        ]
      : []),
  ];

  const commandItems: RendererContextMenuItem[] = !canEditDocument
    ? []
    : mode === "preview"
      ? [
          {
            type: "item",
            id: "enter-edit-mode",
            label: t("files.edit"),
            icon: <Pencil size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.togglePreview,
            ),
            disabled: truncated,
            onSelect: handleEnterEdit,
          },
        ]
      : [
          ...(onAssociateIntentCanvasCodeAnchor
            ? [
                {
                  type: "item" as const,
                  id: "associate-intent-canvas",
                  label: t("files.associateIntentCanvas"),
                  icon: <ExternalLink size={15} />,
                  shortcut: formatShortcutForPlatform(
                    FILE_CONTEXT_MENU_SHORTCUTS.associateIntentCanvas,
                  ),
                  onSelect: handleAssociateIntentCanvasCodeAnchor,
                },
              ]
            : []),
          ...(editorView && canMutateEditor
            ? [
                {
                  type: "item" as const,
                  id: "expand-selection",
                  label: t("files.expandSelection"),
                  icon: <TextSelect size={15} />,
                  shortcut: expandSelectionShortcut
                    ? formatShortcutForPlatform(expandSelectionShortcut)
                    : undefined,
                  onSelect: () => {
                    cmRef.current?.expandSelection();
                  },
                },
              ]
            : []),
          {
            type: "item",
            id: "goto-definition",
            label: isDefinitionLoading
              ? t("files.navigating")
              : t("files.gotoDefinition"),
            icon: <Code size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.gotoDefinition,
            ),
            onSelect: runDefinitionFromCursor,
          },
          {
            type: "item",
            id: "goto-implementations",
            label: isImplementationsLoading
              ? t("files.navigating")
              : t("files.gotoImplementations"),
            icon: <Code size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.gotoImplementations,
            ),
            onSelect: runImplementationsFromCursor,
          },
          {
            type: "item",
            id: "find-references",
            label: isReferencesLoading
              ? t("files.searchingReferences")
              : t("files.findReferences"),
            icon: <Search size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.findReferences,
            ),
            onSelect: runReferencesFromCursor,
          },
          {
            type: "item",
            id: "enter-preview-mode",
            label: t("files.preview"),
            icon: <Eye size={15} />,
            shortcut: formatShortcutForPlatform(
              FILE_CONTEXT_MENU_SHORTCUTS.togglePreview,
            ),
            onSelect: handleEnterPreview,
          },
          {
            type: "item",
            id: "save-file",
            label: isSaving
              ? t("files.saving")
              : effectiveIsDirty
                ? t("files.save")
                : t("files.saved"),
            icon: <Save size={15} />,
            shortcut: saveFileShortcut
              ? formatShortcutForPlatform(saveFileShortcut)
              : undefined,
            disabled: !effectiveIsDirty || isSaving,
            onSelect: handleSave,
          },
        ];

  const itemGroups: RendererContextMenuItem[][] = [
    ...(noteCaptureDraft && onCaptureNote
      ? [
          [
            {
              type: "item" as const,
              id: "capture-file-note",
              label: selectionNoteDraft
                ? t("noteCards.captureSelection")
                : t("noteCards.captureWholeFile"),
              icon: <NotebookPen size={15} />,
              shortcut:
                mode === "edit"
                  ? formatShortcutForPlatform(
                      FILE_CONTEXT_MENU_SHORTCUTS.captureNote,
                    )
                  : undefined,
              onSelect: () => onCaptureNote(noteCaptureDraft),
            },
          ],
        ]
      : []),
    ...(selectionChatSnippet && onInsertText
      ? [
          [
            {
              type: "item" as const,
              id: "add-selection-to-chat",
              label: t("files.addToChat"),
              icon: <MessageSquare size={15} />,
              shortcut: formatShortcutForPlatform(
                FILE_CONTEXT_MENU_SHORTCUTS.addToChat,
              ),
              onSelect: () => onInsertText(selectionChatSnippet),
            },
          ],
        ]
      : []),
    clipboardItems,
    ...(gitItems.length > 0
      ? [
          [
            {
              type: "submenu" as const,
              id: "git-actions",
              label: t("files.tabGitActions"),
              icon: <GitBranch size={15} />,
              items: gitItems,
            },
          ],
        ]
      : []),
    ...(onRevealInFileTree
      ? [
          [
            {
              type: "item" as const,
              id: "reveal-in-file-tree",
              label: t("files.revealInFileTree"),
              icon: <LocateFixed size={15} />,
              shortcut: formatShortcutForPlatform(
                FILE_CONTEXT_MENU_SHORTCUTS.revealInFileTree,
              ),
              onSelect: () => onRevealInFileTree(filePath),
            },
          ],
        ]
      : []),
    ...(isHtmlFilePath(filePath)
      ? [
          [
            {
              type: "item" as const,
              id: "open-in-browser",
              label: t("files.openInBrowser"),
              icon: <ExternalLink size={15} />,
              onSelect: () => {
                void openHtmlInBrowser(
                  resolveAbsolutePath(workspacePath, filePath),
                  { workspaceId },
                ).catch((error) => {
                  console.warn("[file-view] openHtmlInBrowser failed", error);
                  pushErrorToast({
                    title: t("files.openInBrowser"),
                    message: formatOpenHtmlInBrowserError(error, t),
                  });
                });
              },
            },
          ],
        ]
      : []),
    ...(commandItems.length > 0 ? [commandItems] : []),
  ];
  const items = itemGroups.flatMap((group, groupIndex) =>
    groupIndex === 0
      ? group
      : [
          {
            type: "separator" as const,
            id: `file-command-separator-${groupIndex}`,
          },
          ...group,
        ],
  );
  const position = clampRendererContextMenuPosition(
    event.clientX,
    event.clientY,
    {
      width: 248,
      height: estimateRendererContextMenuHeight(items),
      padding: 10,
    },
  );
  setFileContextMenu({
    ...position,
    label: t("files.fileContextMenu"),
    items,
  });
}

export interface FileViewTabContextMenuDeps {
  canCloseAllTabs: boolean;
  event: ReactMouseEvent;
  filePath: string;
  gitBlame: Pick<ReturnType<typeof useFileGitBlame>, "enabled" | "toggle">;
  gitBlameEligible: boolean;
  handleOpenDetachedTab: (tabPath: string) => void;
  handleTabGitBlame: (tabPath: string) => void;
  onActivateTab: FileViewPanelProps["onActivateTab"];
  onCloseAllTabs: FileViewPanelProps["onCloseAllTabs"];
  onCloseOtherTabs: FileViewPanelProps["onCloseOtherTabs"];
  onCloseTab: FileViewPanelProps["onCloseTab"];
  onOpenFileHistory: FileViewPanelProps["onOpenFileHistory"];
  resolveTabGitScope: (
    tabPath: string,
  ) => { repositoryRoot: string; path: string } | null;
  setTabContextMenu: Dispatch<SetStateAction<RendererContextMenuState | null>>;
  t: TFunction;
  tabPath: string;
  visibleTabs: string[];
  workspaceId: string;
  workspacePath: string;
}

export function buildFileViewTabContextMenu({
  canCloseAllTabs,
  event,
  filePath,
  gitBlame,
  gitBlameEligible,
  handleOpenDetachedTab,
  handleTabGitBlame,
  onActivateTab,
  onCloseAllTabs,
  onCloseOtherTabs,
  onCloseTab,
  onOpenFileHistory,
  resolveTabGitScope,
  setTabContextMenu,
  t,
  tabPath,
  visibleTabs,
  workspaceId,
  workspacePath,
}: FileViewTabContextMenuDeps): void {
  event.preventDefault();
  event.stopPropagation();
  const gitScope = resolveTabGitScope(tabPath);
  const canOpenHistory = Boolean(gitScope && onOpenFileHistory);
  const canToggleBlame = Boolean(
    gitScope &&
    (tabPath === filePath
      ? gitBlameEligible || gitBlame.enabled
      : onActivateTab),
  );
  const gitItems: RendererContextMenuLeafItem[] = [
    ...(canOpenHistory
      ? [
          {
            type: "item" as const,
            id: "show-file-history",
            label: t("files.tabShowFileHistory"),
            icon: <History size={15} />,
            onSelect: () => {
              if (!gitScope || !onOpenFileHistory) {
                return;
              }
              onOpenFileHistory({
                workspaceId,
                workspacePath,
                repositoryRoot: gitScope.repositoryRoot,
                path: gitScope.path,
                displayPath: tabPath,
              });
            },
          },
        ]
      : []),
    ...(canToggleBlame
      ? [
          {
            type: "item" as const,
            id: "toggle-git-blame",
            label:
              tabPath === filePath && gitBlame.enabled
                ? t("files.gitBlameDisable")
                : t("files.gitBlameEnable"),
            icon: <GitCommitHorizontal size={15} />,
            onSelect: () => handleTabGitBlame(tabPath),
          },
        ]
      : []),
  ];
  const items: RendererContextMenuItem[] = [
    ...(gitItems.length > 0
      ? [
          {
            type: "submenu" as const,
            id: "git-actions",
            label: t("files.tabGitActions"),
            icon: <GitBranch size={15} />,
            items: gitItems,
          },
          { type: "separator" as const, id: "tab-close-separator" },
        ]
      : []),
    {
      type: "item",
      id: "close-current-tab",
      label: t("files.closeCurrentTab"),
      icon: <X size={15} />,
      disabled: !onCloseTab,
      onSelect: () => onCloseTab?.(tabPath),
    },
    {
      type: "item",
      id: "close-other-tabs",
      label: t("files.closeOtherTabs"),
      icon: <CopyX size={15} />,
      disabled: !onCloseOtherTabs || visibleTabs.length <= 1,
      onSelect: () => onCloseOtherTabs?.(tabPath),
    },
    {
      type: "item",
      id: "close-all-tabs",
      label: t("files.closeAllTabs"),
      icon: <PanelTopClose size={15} />,
      disabled: !canCloseAllTabs,
      onSelect: () => onCloseAllTabs?.(),
    },
    { type: "separator", id: "tab-detach-separator" },
    {
      type: "item",
      id: "open-detached-tab",
      label: t("files.openDetachedTab"),
      icon: <ExternalLink size={15} />,
      onSelect: () => handleOpenDetachedTab(tabPath),
    },
  ];
  const position = clampRendererContextMenuPosition(
    event.clientX,
    event.clientY,
    {
      width: 248,
      height: estimateRendererContextMenuHeight(items),
      padding: 10,
    },
  );
  setTabContextMenu({
    ...position,
    label: t("files.tabContextMenu"),
    items,
  });
}
