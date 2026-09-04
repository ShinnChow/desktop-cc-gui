import {
  useCallback,
  useEffect,
  useMemo,
  type MouseEvent,
} from "react";
import type { TFunction } from "i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readWorkspaceFile } from "../../../services/tauri";
import { languageFromPath } from "../../../utils/syntax";
import { buildCodeSelectionChatSnippet } from "../utils/codeSelectionChatSnippet";
import { createFileDocumentSnapshot } from "../utils/fileDocumentSnapshot";
import { isImagePath } from "../components/fileTreePanelInternals";
import type { useFileTreeViewState } from "../components/useFileTreeViewState";

type FileTreeViewState = ReturnType<typeof useFileTreeViewState>;

export function useFileTreePreviewPopover({
  viewState,
  workspaceId,
  resolvePath,
  onInsertText,
  t,
}: {
  viewState: FileTreeViewState;
  workspaceId: string;
  resolvePath: (relativePath: string) => string;
  onInsertText?: (text: string) => void;
  t: TFunction;
}) {
  const {
    closePreview,
    dragAnchorLineRef,
    dragMovedRef,
    isDragSelecting,
    previewContent,
    previewPath,
    previewSelection,
    previewTruncated,
    setIsDragSelecting,
    setPreviewAnchor,
    setPreviewContent,
    setPreviewError,
    setPreviewLoading,
    setPreviewPath,
    setPreviewSelection,
    setPreviewTruncated,
  } = viewState;

  const previewKind = useMemo(
    () => (previewPath && isImagePath(previewPath) ? "image" : "text"),
    [previewPath],
  );

  useEffect(() => {
    if (!previewPath) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewPath, closePreview]);

  const previewImageSrc = useMemo(() => {
    if (!previewPath || previewKind !== "image") {
      return null;
    }
    try {
      return convertFileSrc(resolvePath(previewPath));
    } catch {
      return null;
    }
  }, [previewPath, previewKind, resolvePath]);

  const openPreview = useCallback((path: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const estimatedWidth = 640;
    const estimatedHeight = 520;
    const padding = 16;
    const maxHeight = Math.min(estimatedHeight, window.innerHeight - padding * 2);
    const left = Math.min(
      Math.max(padding, rect.left - estimatedWidth - padding),
      Math.max(padding, window.innerWidth - estimatedWidth - padding),
    );
    const top = Math.min(
      Math.max(padding, rect.top - maxHeight * 0.35),
      Math.max(padding, window.innerHeight - maxHeight - padding),
    );
    const arrowTop = Math.min(
      Math.max(16, rect.top + rect.height / 2 - top),
      Math.max(16, maxHeight - 16),
    );
    setPreviewPath(path);
    setPreviewAnchor({ top, left, arrowTop, height: maxHeight });
    setPreviewSelection(null);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
  }, [
    dragAnchorLineRef,
    dragMovedRef,
    setIsDragSelecting,
    setPreviewAnchor,
    setPreviewPath,
    setPreviewSelection,
  ]);

  useEffect(() => {
    if (!previewPath) {
      return;
    }
    let cancelled = false;
    if (previewKind === "image") {
      setPreviewContent("");
      setPreviewTruncated(false);
      setPreviewError(null);
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    setPreviewError(null);
    readWorkspaceFile(workspaceId, previewPath)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPreviewContent(response.content ?? "");
        setPreviewTruncated(Boolean(response.truncated));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    previewKind,
    previewPath,
    setPreviewContent,
    setPreviewError,
    setPreviewLoading,
    setPreviewTruncated,
    workspaceId,
  ]);

  useEffect(() => {
    if (!isDragSelecting) {
      return;
    }
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      dragAnchorLineRef.current = null;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [dragAnchorLineRef, isDragSelecting, setIsDragSelecting]);

  const selectRangeFromAnchor = useCallback((anchor: number, index: number) => {
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    setPreviewSelection({ start, end });
  }, [setPreviewSelection]);

  const handleSelectLine = useCallback(
    (index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      if (event.shiftKey && previewSelection) {
        const anchor = previewSelection.start;
        selectRangeFromAnchor(anchor, index);
        return;
      }
      setPreviewSelection({ start: index, end: index });
    },
    [dragMovedRef, previewSelection, selectRangeFromAnchor, setPreviewSelection],
  );

  const handleLineMouseDown = useCallback(
    (index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (previewKind !== "text" || event.button !== 0) {
        return;
      }
      event.preventDefault();
      setIsDragSelecting(true);
      const anchor =
        event.shiftKey && previewSelection ? previewSelection.start : index;
      dragAnchorLineRef.current = anchor;
      dragMovedRef.current = false;
      selectRangeFromAnchor(anchor, index);
    },
    [
      dragAnchorLineRef,
      dragMovedRef,
      previewKind,
      previewSelection,
      selectRangeFromAnchor,
      setIsDragSelecting,
    ],
  );

  const handleLineMouseEnter = useCallback(
    (index: number, _event: MouseEvent<HTMLButtonElement>) => {
      if (!isDragSelecting) {
        return;
      }
      const anchor = dragAnchorLineRef.current;
      if (anchor === null) {
        return;
      }
      if (anchor !== index) {
        dragMovedRef.current = true;
      }
      selectRangeFromAnchor(anchor, index);
    },
    [dragAnchorLineRef, dragMovedRef, isDragSelecting, selectRangeFromAnchor],
  );

  const handleLineMouseUp = useCallback(() => {
    if (!isDragSelecting) {
      return;
    }
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
  }, [dragAnchorLineRef, isDragSelecting, setIsDragSelecting]);

  const selectionHints = useMemo(
    () =>
      previewKind === "text"
        ? [t("files.selectionHintShiftClick"), t("files.selectionHintMultiLine")]
        : [],
    [previewKind, t],
  );

  const previewDocumentSnapshot = useMemo(
    () => createFileDocumentSnapshot(previewContent, previewTruncated, 0),
    [previewContent, previewTruncated],
  );

  const handleAddSelection = useCallback(() => {
    if (previewKind !== "text" || !previewPath || !previewSelection || !onInsertText) {
      return;
    }
    const selected = previewDocumentSnapshot.getLines(
      previewSelection.start,
      previewSelection.end + 1,
    );
    const snippet = buildCodeSelectionChatSnippet({
      path: previewPath,
      content: selected.join("\n"),
      startLine: previewSelection.start + 1,
      endLine: previewSelection.end + 1,
      language: languageFromPath(previewPath),
    });
    if (!snippet) {
      return;
    }
    onInsertText(snippet);
    closePreview();
  }, [
    previewDocumentSnapshot,
    previewKind,
    previewPath,
    previewSelection,
    onInsertText,
    closePreview,
  ]);

  return {
    previewKind: previewKind as "image" | "text",
    previewImageSrc,
    openPreview,
    handleSelectLine,
    handleLineMouseDown,
    handleLineMouseEnter,
    handleLineMouseUp,
    selectionHints,
    handleAddSelection,
  };
}
