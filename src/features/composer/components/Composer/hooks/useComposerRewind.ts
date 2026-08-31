import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEventCallback } from "../../../../../utils/useEventCallback";
import type {
  ConversationItem,
  EngineType,
} from "../../../../../types";
import type { ClaudeRewindPreviewState } from "../../ClaudeRewindConfirmDialog";
import type { ComposerProps, ComposerRewindDialogRequest } from "../types";
import type { RewindMode } from "../../../../threads/utils/rewindMode";
import { exportRewindFiles } from "../../../../../services/tauri";
import { pushErrorToast } from "../../../../../services/toasts";
import {
  buildLatestRewindPreview,
  buildRewindPreviewForMessage,
  normalizeRewindExportPath,
  resolvePreferredStatus,
  resolveRewindSupportedEngineFromThreadId,
  toRewindPathDedupeKey,
  type RewindFileChangeStatus,
} from "../../../utils/composerFileReferences";

export interface UseComposerRewindOptions {
  items: ConversationItem[];
  activeThreadId: string | null;
  selectedEngine: EngineType | undefined;
  activeWorkspaceId: string | null;
  onRewind: ComposerProps["onRewind"];
  rewindDialogRequest: ComposerRewindDialogRequest | null;
  onRewindDialogRequestConsumed:
    | ((requestId: number) => void)
    | undefined;
}

export function useComposerRewind({
  items,
  activeThreadId,
  selectedEngine,
  activeWorkspaceId,
  onRewind,
  rewindDialogRequest,
  onRewindDialogRequestConsumed,
}: UseComposerRewindOptions) {
  const { t } = useTranslation();
  const [rewindInFlight, setRewindInFlight] = useState(false);
  const [rewindPreviewState, setRewindPreviewState] =
    useState<ClaudeRewindPreviewState | null>(null);
  const [rewindMode, setRewindMode] =
    useState<RewindMode>("messages-and-files");
  const rewindInFlightRef = useRef(false);
  const handledRewindDialogRequestIdRef = useRef<number | null>(null);
  const rewindSupportedEngine =
    resolveRewindSupportedEngineFromThreadId(activeThreadId);
  const canRewindSession = Boolean(onRewind && rewindSupportedEngine);
  const resetRewindState = useEventCallback(() => {
    if (rewindPreviewState !== null) {
      setRewindPreviewState(null);
    }
    if (rewindMode !== "messages-and-files") {
      setRewindMode("messages-and-files");
    }
  });

  useEffect(() => {
    resetRewindState();
  }, [activeThreadId, resetRewindState]);

  useEffect(() => {
    if (!canRewindSession) {
      resetRewindState();
    }
  }, [canRewindSession, resetRewindState]);

  const handleCancelRewind = useCallback(() => {
    if (rewindInFlight) {
      return;
    }
    setRewindPreviewState(null);
    setRewindMode("messages-and-files");
  }, [rewindInFlight]);

  const openRewindDialogForMessage = useCallback(
    (userMessageId: string) => {
      if (rewindInFlightRef.current || rewindInFlight) {
        return;
      }
      if (!canRewindSession || !onRewind) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.notAvailable"),
        });
        return;
      }
      const preview = buildRewindPreviewForMessage(
        items,
        userMessageId,
        activeThreadId,
        selectedEngine,
      );
      if (!preview) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.noEligibleMessage"),
        });
        return;
      }
      setRewindMode("messages-and-files");
      setRewindPreviewState(preview);
    },
    [
      activeThreadId,
      canRewindSession,
      items,
      onRewind,
      rewindInFlight,
      selectedEngine,
      t,
    ],
  );

  const handleRewind = useCallback(() => {
    if (rewindInFlightRef.current || rewindInFlight) {
      return;
    }
    if (canRewindSession && onRewind) {
      const preview = buildLatestRewindPreview(
        items,
        activeThreadId,
        selectedEngine,
      );
      if (!preview) {
        pushErrorToast({
          title: t("rewind.title"),
          message: t("rewind.noEligibleMessage"),
        });
        return;
      }
      setRewindMode("messages-and-files");
      setRewindPreviewState(preview);
      return;
    }
    pushErrorToast({
      title: t("rewind.title"),
      message: t("rewind.notAvailable"),
    });
  }, [
    activeThreadId,
    canRewindSession,
    items,
    onRewind,
    rewindInFlight,
    selectedEngine,
    t,
  ]);

  useEffect(() => {
    if (!rewindDialogRequest) {
      return;
    }
    if (
      handledRewindDialogRequestIdRef.current === rewindDialogRequest.requestId
    ) {
      return;
    }
    handledRewindDialogRequestIdRef.current = rewindDialogRequest.requestId;
    openRewindDialogForMessage(rewindDialogRequest.userMessageId);
    onRewindDialogRequestConsumed?.(rewindDialogRequest.requestId);
  }, [
    onRewindDialogRequestConsumed,
    openRewindDialogForMessage,
    rewindDialogRequest,
  ]);

  const handleConfirmRewind = useCallback(async () => {
    const preview = rewindPreviewState;
    if (!preview) {
      return;
    }
    if (!onRewind) {
      pushErrorToast({
        title: t("rewind.title"),
        message: t("rewind.notAvailable"),
      });
      setRewindPreviewState(null);
      setRewindMode("messages-and-files");
      return;
    }
    if (rewindInFlightRef.current || rewindInFlight) {
      return;
    }

    rewindInFlightRef.current = true;
    try {
      setRewindInFlight(true);
      await onRewind(preview.targetMessageId, { mode: rewindMode });
      setRewindPreviewState(null);
      setRewindMode("messages-and-files");
    } catch (error) {
      pushErrorToast({
        title: t("rewind.title"),
        message:
          (error instanceof Error ? error.message : String(error)) ||
          t("rewind.failed"),
      });
    } finally {
      setRewindInFlight(false);
      rewindInFlightRef.current = false;
    }
  }, [onRewind, rewindMode, rewindInFlight, rewindPreviewState, t]);

  const handleStoreRewindChanges = useCallback(
    async (preview: ClaudeRewindPreviewState) => {
      const workspaceId = activeWorkspaceId?.trim() ?? "";
      const sessionId = preview.sessionId?.trim() ?? "";
      if (!workspaceId || !sessionId) {
        throw new Error(t("rewind.storeUnavailable"));
      }
      const filesByPath = new Map<
        string,
        { path: string; status?: RewindFileChangeStatus }
      >();
      for (const file of preview.affectedFiles) {
        const path = normalizeRewindExportPath(file.filePath);
        const dedupeKey = toRewindPathDedupeKey(file.filePath);
        if (!path || !dedupeKey) {
          continue;
        }
        const existing = filesByPath.get(dedupeKey);
        if (!existing) {
          filesByPath.set(dedupeKey, { path, status: file.status });
          continue;
        }
        const currentStatus = existing.status ?? "M";
        const incomingStatus = file.status ?? "M";
        existing.status = resolvePreferredStatus(currentStatus, incomingStatus);
      }
      const exportFiles = Array.from(filesByPath.values());
      if (exportFiles.length === 0) {
        throw new Error(t("rewind.filesEmpty"));
      }
      return exportRewindFiles({
        workspaceId,
        engine: preview.engine,
        sessionId,
        targetMessageId: preview.targetMessageId,
        conversationLabel: preview.conversationLabel,
        files: exportFiles,
      });
    },
    [activeWorkspaceId, t],
  );
  return {
    rewindInFlight,
    rewindPreviewState,
    rewindMode,
    setRewindMode,
    canRewindSession,
    handleRewind,
    handleCancelRewind,
    handleConfirmRewind,
    handleStoreRewindChanges,
  };
}
