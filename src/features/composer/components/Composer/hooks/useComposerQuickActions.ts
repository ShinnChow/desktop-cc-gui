import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ComposerProps } from "../types";
import { pushErrorToast } from "../../../../../services/toasts";

export interface UseComposerQuickActionsOptions {
  selectedEngine: ComposerProps["selectedEngine"];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  disabled: boolean;
  effectiveSubmitDisabled: boolean;
  collabLocksComposer: boolean;
  isReviewQuickActionEngine: boolean;
  onRequestContextCompaction: ComposerProps["onRequestContextCompaction"];
  onForkQuickStart: ComposerProps["onForkQuickStart"];
  onSend: ComposerProps["onSend"];
}

export function useComposerQuickActions({
  selectedEngine,
  activeWorkspaceId,
  activeThreadId,
  disabled,
  effectiveSubmitDisabled,
  collabLocksComposer,
  isReviewQuickActionEngine,
  onRequestContextCompaction,
  onForkQuickStart,
  onSend,
}: UseComposerQuickActionsOptions) {
  const { t } = useTranslation();
  const handleManualCompactContext = useCallback(async () => {
    if (selectedEngine !== "codex") {
      return;
    }
    if (!activeWorkspaceId || !activeThreadId || !onRequestContextCompaction) {
      pushErrorToast({
        title: t("chat.contextDualViewManualCompact"),
        message: t("chat.contextDualViewManualCompactUnavailable"),
      });
      return;
    }
    try {
      await onRequestContextCompaction();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushErrorToast({
        title: t("chat.contextDualViewManualCompact"),
        message: message || t("chat.contextDualViewManualCompactFailed"),
      });
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    onRequestContextCompaction,
    selectedEngine,
    t,
  ]);

  const handleCodexQuickCommand = useCallback(
    (command: string) => {
      if (disabled || effectiveSubmitDisabled || collabLocksComposer) {
        return;
      }
      const normalized = command.trim().toLowerCase();
      const isReviewCommand = /^\/review\b/.test(normalized);
      const isFastCommand = /^\/fast\b/.test(normalized);
      if (isFastCommand && selectedEngine !== "codex") {
        return;
      }
      if (isReviewCommand && !isReviewQuickActionEngine) {
        return;
      }
      if (!isReviewCommand && !isFastCommand && selectedEngine !== "codex") {
        return;
      }
      void onSend(command, []);
    },
    [
      collabLocksComposer,
      disabled,
      effectiveSubmitDisabled,
      isReviewQuickActionEngine,
      onSend,
      selectedEngine,
    ],
  );

  const handleForkQuickStart = useCallback(() => {
    if (disabled || effectiveSubmitDisabled || collabLocksComposer) {
      return;
    }
    if (onForkQuickStart) {
      onForkQuickStart();
      return;
    }
    if (selectedEngine !== "codex" && selectedEngine !== "claude") {
      return;
    }
    void onSend("/fork", []);
  }, [
    collabLocksComposer,
    disabled,
    effectiveSubmitDisabled,
    onForkQuickStart,
    onSend,
    selectedEngine,
  ]);
  return {
    handleManualCompactContext,
    handleCodexQuickCommand,
    handleForkQuickStart,
  };
}
