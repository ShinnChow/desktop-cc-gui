import { useCallback } from "react";
import type { LoadingProgressDialogConfig } from "../../features/app/hooks/useLoadingProgressDialogState";
import { runWithLoadingProgress } from "../../features/app/utils/loadingProgressActions";
import type { EngineType, WorkspaceInfo } from "../../types";

type UseCreateSessionLoadingOptions = {
  showLoadingProgressDialog: (config: LoadingProgressDialogConfig) => string;
  hideLoadingProgressDialog: (requestId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  createSessionTimeoutMs?: number;
};

export const DEFAULT_CREATE_SESSION_LOADING_TIMEOUT_MS = 45_000;

function createSessionTimeoutError(timeoutMs: number): Error {
  return new Error(
    `Create session timed out after ${timeoutMs}ms while waiting for the engine to initialize.`,
  );
}

async function runCreateSessionWithTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return action();
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createSessionTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([action(), timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function useCreateSessionLoading({
  showLoadingProgressDialog,
  hideLoadingProgressDialog,
  t,
  createSessionTimeoutMs = DEFAULT_CREATE_SESSION_LOADING_TIMEOUT_MS,
}: UseCreateSessionLoadingOptions) {
  return useCallback(
    async <T,>(
      params: {
        workspace: WorkspaceInfo;
        engine: EngineType;
      },
      action: () => Promise<T>,
    ): Promise<T> => {
      const engineLabel =
        params.engine === "codex"
          ? t("workspace.engineCodex")
          : params.engine === "gemini"
            ? t("workspace.engineGemini")
            : params.engine === "grok"
              ? t("workspace.engineGrok")
            : params.engine === "kimi"
              ? t("workspace.engineKimi")
            : params.engine === "pi"
              ? t("workspace.enginePi")
            : params.engine === "omp"
              ? t("workspace.engineOmp")
            : params.engine === "qoder"
              ? t("workspace.engineQoder")
            : params.engine === "opencode"
              ? t("workspace.engineOpenCode")
              : params.engine === "dsh"
                ? t("workspace.engineDsh")
              : t("workspace.engineClaudeCode");
      const workspaceLabel = params.workspace.name.trim() || params.workspace.path;
      return runWithLoadingProgress(
        { showLoadingProgressDialog, hideLoadingProgressDialog },
        {
          title: t("workspace.loadingProgressCreateSessionTitle"),
          message: t("workspace.loadingProgressCreateSessionMessage", {
            engine: engineLabel,
            workspace: workspaceLabel,
          }),
        },
        () => runCreateSessionWithTimeout(action, createSessionTimeoutMs),
      );
    },
    [
      createSessionTimeoutMs,
      hideLoadingProgressDialog,
      showLoadingProgressDialog,
      t,
    ],
  );
}
