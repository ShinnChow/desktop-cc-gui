import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationItem } from "../../../../../types";
import type { ComposerProps } from "../types";
import { useStatusPanelData } from "../../../../status-panel/hooks/useStatusPanelData";
import {
  collectRunStatusSubagentSourceItems,
} from "../../run-status";
import { isEngineCapabilityAvailable } from "../../../../engine/engineCapabilityMatrix";
import { overlaySessionFileChangesWithGitStats } from "../../../../messages/utils/turnFileChanges";
import {
  ingestFileEditsFromConversationItems,
  removeFileEditPaths,
} from "../../../../session-side-effects/sessionSideEffectLedger";
import { useActiveCanvasSelector } from "../../../../layout/hooks/activeCanvasStore";
import { enrichTimelineWithSyntheticSubagentsBeforeCollapse } from "../../../../subagent-ui";
import {
  openPiTreeOverlay,
  usePiSessionTree,
  usePiTreeOverlayKey,
} from "../../../../pi-session/store/piSessionStore";

export interface UseComposerRunStatusProjectionOptions {
  items: ConversationItem[];
  performanceScopedItems: ConversationItem[];
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  activeWorkspacePath: string | null;
  selectedEngine: ComposerProps["selectedEngine"];
  threadParentById: ComposerProps["threadParentById"];
  threadItemsByThread: ComposerProps["threadItemsByThread"];
  threadStatusById: ComposerProps["threadStatusById"];
  plan: ComposerProps["plan"];
  isPlanMode: boolean;
  isProcessing: boolean;
  gitChangedFiles: ComposerProps["gitChangedFiles"];
  isGitRepository: boolean;
  shouldDeferStatusSummary: boolean;
  statusPanelExpandedOverride: boolean | undefined;
  isSharedSessionResolved: boolean;
  contextUsage: ComposerProps["contextUsage"];
  onRequestGitStatusRefresh: ComposerProps["onRequestGitStatusRefresh"];
  onRevertFile: ComposerProps["onRevertFile"];
  onRevertAllFiles: ComposerProps["onRevertAllFiles"];
}

export function useComposerRunStatusProjection({
  items,
  performanceScopedItems,
  activeThreadId,
  activeWorkspaceId,
  activeWorkspacePath,
  selectedEngine,
  threadParentById,
  threadItemsByThread,
  threadStatusById,
  plan,
  isPlanMode,
  isProcessing,
  gitChangedFiles,
  isGitRepository,
  shouldDeferStatusSummary,
  statusPanelExpandedOverride,
  isSharedSessionResolved,
  contextUsage,
  onRequestGitStatusRefresh,
  onRevertFile,
  onRevertAllFiles,
}: UseComposerRunStatusProjectionOptions) {
  const isCodexEngine = selectedEngine === "codex";
  // —— 子代理 Strip 源：S10 同源合成，只喂 Strip，不进主幕布 ——
  // 断点修复：useStatusPanelData 在传入 itemsByThread 时只扫表内条目，
  // 必须把「含 synthetic spawn」的 items 写回 activeThread 槽位，否则合成等于没接。
  const canvasChildSubagentThreads = useActiveCanvasSelector(
    (snapshot) => snapshot.childSubagentThreads,
  );
  const canvasThreadIdForStrip = useActiveCanvasSelector(
    (snapshot) => snapshot.threadId,
  );
  const canvasStatusById = useActiveCanvasSelector(
    (snapshot) => snapshot.threadStatusById,
  );
  const canvasItemsByThread = useActiveCanvasSelector(
    (snapshot) => snapshot.threadItemsByThread,
  );
  // 子线程：canvas 过滤 + threadParentById 上挂到当前会话的 id（Shared 历史常用）
  const stripChildThreads = useMemo(() => {
    const byId = new Map(
      canvasChildSubagentThreads.map((thread) => [thread.id, thread]),
    );
    const parentMap = threadParentById ?? {};
    const activeId = (activeThreadId ?? "").trim();
    if (activeId) {
      for (const [childId, parentId] of Object.entries(parentMap)) {
        if (parentId !== activeId || !childId || childId === activeId) continue;
        // pi fork 派生会话不是子代理（分支归会话树控制，不计子代理条）
        // capability-router-allow-engine-branch: pi 分域，见 enhance-pi-native-rpc-session
        if (childId.startsWith("pi:")) continue;
        if (byId.has(childId)) continue;
        byId.set(childId, {
          id: childId,
          name: childId,
          updatedAt: 0,
          engineSource: selectedEngine ?? "claude",
        });
      }
    }
    return Array.from(byId.values());
  }, [
    canvasChildSubagentThreads,
    threadParentById,
    activeThreadId,
    selectedEngine,
  ]);
  const runStatusItemsWithSyntheticSubagents = useMemo(
    () =>
      enrichTimelineWithSyntheticSubagentsBeforeCollapse({
        items: performanceScopedItems,
        ownThreadId: activeThreadId,
        canvasThreadId: canvasThreadIdForStrip ?? activeThreadId,
        activeEngine: selectedEngine ?? null,
        childThreads: stripChildThreads,
        statusById: canvasStatusById,
        itemsByThread: canvasItemsByThread,
      }),
    [
      performanceScopedItems,
      activeThreadId,
      canvasThreadIdForStrip,
      selectedEngine,
      stripChildThreads,
      canvasStatusById,
      canvasItemsByThread,
    ],
  );
  // 实时协作：worker 工具事实隔离在 agent-canvas:{shared}:{attempt}，
  // 主幕 shared: 只有消息/汇总 → 把本会话 agent-canvas 的 subagent 工具并入扫描源。
  const runStatusItemsForStrip = useMemo(
    () =>
      collectRunStatusSubagentSourceItems({
        mainItems: runStatusItemsWithSyntheticSubagents,
        threadItemsByThread: canvasItemsByThread ?? threadItemsByThread,
        activeThreadId,
      }),
    [
      runStatusItemsWithSyntheticSubagents,
      canvasItemsByThread,
      threadItemsByThread,
      activeThreadId,
    ],
  );
  // 关键：把合成后的 items 写入 activeThread，供 collectScopedToolEntries 扫到
  const itemsByThreadForRunStatus = useMemo(() => {
    const base = {
      ...(canvasItemsByThread ?? {}),
      ...(threadItemsByThread ?? {}),
    };
    const activeId = (activeThreadId ?? "").trim();
    if (!activeId) return base;
    return {
      ...base,
      [activeId]: runStatusItemsForStrip,
    };
  }, [
    canvasItemsByThread,
    threadItemsByThread,
    activeThreadId,
    runStatusItemsForStrip,
  ]);
  const {
    todos: scannedStatusTodos,
    subagents: statusSubagents,
    todoTotal,
    commandTotal,
  } = useStatusPanelData(runStatusItemsForStrip, {
    isCodexEngine,
    activeEngine: selectedEngine ?? null,
    activeThreadId,
    itemsByThread: itemsByThreadForRunStatus,
    threadParentById,
    threadStatusById: threadStatusById ?? canvasStatusById,
    // S10 同源子代理线程（含 Shared 无 parent 的 claude:subagent:owner:*）
    childSubagentThreadIds: stripChildThreads.map((thread) => thread.id),
    deferSummary: shouldDeferStatusSummary,
  });
  // pi 会话树 pill（native pi 专属）：run-status 条上与 todo/subagent/plan/edit 平级
  const piTreeOverlayKey = usePiTreeOverlayKey();
  const piSessionTree = usePiSessionTree(
    activeWorkspaceId ?? "",
    activeThreadId ?? "",
  );
  const piTreePill = useMemo(() => {
    // native pi 专属：shared 会话（含 pi 作为 Shared target）不显示 pill，
    // 避免把 Shared-owned binding 拉进会话树（隔离纪律）
    if (
      selectedEngine !== "pi" || // capability-router-allow-engine-branch: pi-only 会话树 pill, 见 enhance-pi-native-rpc-session
      isSharedSessionResolved ||
      !activeWorkspaceId ||
      !activeThreadId
    ) {
      return undefined;
    }
    const key = `${activeWorkspaceId}:${activeThreadId}`;
    return {
      active: piTreeOverlayKey === key,
      laneCount: piSessionTree?.laneCount ?? null,
      onToggle: () => openPiTreeOverlay(activeWorkspaceId, activeThreadId),
    };
  }, [
    selectedEngine,
    isSharedSessionResolved,
    activeWorkspaceId,
    activeThreadId,
    piTreeOverlayKey,
    piSessionTree,
  ]);

  const statusTodos = useMemo(() => {
    if (selectedEngine !== "dsh") {
      return scannedStatusTodos;
    }
    const projected = contextUsage?.dshTodos;
    return projected == null ? scannedStatusTodos : projected;
  }, [contextUsage?.dshTodos, scannedStatusTodos, selectedEngine]);
  // 已编辑：ledger 合成主线∪agent-canvas（Shared/协作 fan-in），用未 deferred items 保证实时
  const sessionToolFileChanges = useMemo(() => {
    return ingestFileEditsFromConversationItems({
      threadId: activeThreadId,
      mainItems: items,
      threadItemsByThread: threadItemsByThread ?? canvasItemsByThread,
    });
  }, [items, threadItemsByThread, canvasItemsByThread, activeThreadId]);

  // 回合结束后 git 刷新有延迟：短 grace 内仍允许 tool 临时数，避免 pill 闪空
  const [gitOverlayGrace, setGitOverlayGrace] = useState(false);
  useEffect(() => {
    if (isProcessing) {
      setGitOverlayGrace(true);
      return;
    }
    const timer = window.setTimeout(() => setGitOverlayGrace(false), 1600);
    return () => window.clearTimeout(timer);
  }, [isProcessing]);

  // 行统计对齐 git status；进行中/grace 内允许 tool 临时数，稳定后只保留仍 dirty 的 path
  const sessionFileChanges = useMemo(
    () =>
      overlaySessionFileChangesWithGitStats(
        sessionToolFileChanges,
        isGitRepository ? gitChangedFiles : null,
        {
          workspacePath: activeWorkspacePath ?? null,
          allowToolProvisional: Boolean(isProcessing) || gitOverlayGrace,
        },
      ),
    [
      activeWorkspacePath,
      gitChangedFiles,
      gitOverlayGrace,
      isGitRepository,
      isProcessing,
      sessionToolFileChanges,
    ],
  );

  // AI 改文件后尽快刷 git，避免 pill 长期停在 tool 临时数或虚高累加
  const sessionToolFileSignature = useMemo(() => {
    if (!sessionToolFileChanges) return "";
    return sessionToolFileChanges.files
      .map((file) => `${file.path}:${file.additions}:${file.deletions}`)
      .join("|");
  }, [sessionToolFileChanges]);

  useEffect(() => {
    if (!onRequestGitStatusRefresh || !isGitRepository) return;
    if (!sessionToolFileSignature) return;
    const timer = window.setTimeout(() => {
      onRequestGitStatusRefresh();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    isGitRepository,
    onRequestGitStatusRefresh,
    sessionToolFileSignature,
  ]);

  const handleRevertFileForStrip = useCallback(
    async (path: string) => {
      await onRevertFile?.(path);
      removeFileEditPaths(activeThreadId, [path]);
    },
    [activeThreadId, onRevertFile],
  );
  const handleRevertAllFilesForStrip = useCallback(
    async (paths: string[]) => {
      await onRevertAllFiles?.(paths);
      removeFileEditPaths(activeThreadId, paths);
    },
    [activeThreadId, onRevertAllFiles],
  );
  const mergePlanIntoTodos =
    isCodexEngine &&
    selectedEngine != null &&
    isEngineCapabilityAvailable(selectedEngine, "collaboration.mode");
  // 底部 legacy dock 活动：子代理已迁到 Strip 独立判定，不并入此铁律
  const hasStatusPanelActivity = useMemo(() => {
    const hasLegacyActivity =
      todoTotal > 0 ||
      Boolean(sessionFileChanges) ||
      isPlanMode ||
      Boolean(plan);
    if (isCodexEngine) {
      return hasLegacyActivity || commandTotal > 0;
    }
    return hasLegacyActivity;
  }, [
    commandTotal,
    isCodexEngine,
    isPlanMode,
    plan,
    sessionFileChanges,
    todoTotal,
  ]);
  // 底部 dock 已退役；toggle 仅兼容旧 override，默认不再展示。
  const [statusPanelExpanded, setStatusPanelExpanded] = useState(false);
  const previousStatusPanelActivityRef = useRef(hasStatusPanelActivity);

  useEffect(() => {
    if (statusPanelExpandedOverride !== undefined) {
      return;
    }
    const hadActivity = previousStatusPanelActivityRef.current;
    if (!hasStatusPanelActivity) {
      setStatusPanelExpanded((prev) => (prev ? false : prev));
    } else if (!hadActivity) {
      setStatusPanelExpanded((prev) => (prev ? prev : true));
    }
    previousStatusPanelActivityRef.current = hasStatusPanelActivity;
  }, [hasStatusPanelActivity, statusPanelExpandedOverride]);
  return {
    statusTodos,
    statusSubagents,
    mergePlanIntoTodos,
    sessionFileChanges,
    piTreePill,
    handleRevertFileForStrip,
    handleRevertAllFilesForStrip,
    statusPanelExpanded,
    setStatusPanelExpanded,
  };
}
