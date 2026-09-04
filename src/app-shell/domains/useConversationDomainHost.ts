import { useEffect, useRef } from "react";
import type { DebugEntry } from "../../types";
import { useCopyThread } from "../../features/threads/hooks/useCopyThread";
import { useRenameThreadPrompt } from "../../features/threads/hooks/useRenameThreadPrompt";
import { useDeleteThreadPrompt } from "../../features/threads/hooks/useDeleteThreadPrompt";
import { useThreadRows } from "../../features/app/hooks/useThreadRows";
import { forceRefreshAgents } from "../../features/composer/components/ChatInputBox/providers";
import type { RuntimeThreadShellBoundary } from "./runtimeThreadBoundary";

/**
 * S4 PR-D：Conversation / Messages 域 host（无 UI）。
 *
 * - 接收 useRuntimeThreadDomainHost 装配好的 runtimeThreadBoundary
 *   （与 live channel / threads bags 对齐）
 * - thread chrome：copy / rename / delete
 * - activeThreadIdRef 同步
 * - settings 关闭时刷新 agent catalog（与会话工具栏耦合的轻副作用）
 */
export function useConversationDomainHost(input: {
  runtimeThreadBoundary: RuntimeThreadShellBoundary;
  activeThreadId: string | null;
  threadParentById: Record<string, string>;
  activeItems: unknown[];
  threadsByWorkspace: Record<string, any[] | undefined>;
  renameThread: any;
  removeThread: any;
  clearDraftForThread: (threadId: string) => void;
  removeImagesForThread: (threadId: string) => void;
  alertError: (message: string) => void;
  deleteConversationFailedMessage: string;
  addDebugEntry: (entry: DebugEntry) => void;
  reloadAgentCatalog: () => void | Promise<void>;
  settingsOpen: boolean;
}) {
  const runtimeThreadBoundary = input.runtimeThreadBoundary;

  const activeThreadIdRef = useRef<string | null>(input.activeThreadId ?? null);
  useEffect(() => {
    activeThreadIdRef.current = input.activeThreadId ?? null;
  }, [input.activeThreadId]);

  const { getThreadRows } = useThreadRows(input.threadParentById);

  const { handleCopyThread } = useCopyThread({
    activeItems: input.activeItems as any,
    onDebug: input.addDebugEntry as any,
  });

  const {
    renamePrompt,
    openRenamePrompt,
    handleRenamePromptChange,
    handleRenamePromptCancel,
    handleRenamePromptConfirm,
  } = useRenameThreadPrompt({
    threadsByWorkspace: input.threadsByWorkspace as any,
    renameThread: input.renameThread,
  });

  const {
    deletePrompt: deleteThreadPrompt,
    isDeleting: isDeleteThreadPromptBusy,
    openDeletePrompt: openDeleteThreadPrompt,
    handleDeletePromptCancel: handleDeleteThreadPromptCancel,
    handleDeletePromptConfirm: handleDeleteThreadPromptConfirm,
  } = useDeleteThreadPrompt({
    threadsByWorkspace: input.threadsByWorkspace as any,
    removeThread: input.removeThread,
    onDeleteSuccess: (threadId: string) => {
      input.clearDraftForThread(threadId);
      input.removeImagesForThread(threadId);
    },
    onDeleteError: (message: string | null) => {
      input.alertError(
        message ?? input.deleteConversationFailedMessage,
      );
    },
  });

  const { reloadAgentCatalog, settingsOpen } = input;
  useEffect(() => {
    if (!settingsOpen) {
      forceRefreshAgents();
      void reloadAgentCatalog();
    }
  }, [reloadAgentCatalog, settingsOpen]);

  return {
    runtimeThreadBoundary,
    activeThreadIdRef,
    getThreadRows,
    handleCopyThread,
    renamePrompt,
    openRenamePrompt,
    handleRenamePromptChange,
    handleRenamePromptCancel,
    handleRenamePromptConfirm,
    deleteThreadPrompt,
    isDeleteThreadPromptBusy,
    openDeleteThreadPrompt,
    handleDeleteThreadPromptCancel,
    handleDeleteThreadPromptConfirm,
  };
}


