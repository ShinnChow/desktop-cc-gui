import type { Dispatch } from "react";
import type { TFunction } from "i18next";
import type { WorkspaceInfo } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";
import {
  normalizeMemoryPickComposerMode,
  type MemoryPickComposerMode,
} from "../../project-memory/memoryPick/memoryPickTypes";
import { decideMemoryPickGateEntry } from "../../project-memory/memoryPick/memoryPickPolicy";
import {
  getMemoryPickSessionPolicy,
  markMemoryPickFirstPickDone,
  markMemoryPickSessionDismissed,
  setMemoryPickComposerMode,
} from "../../project-memory/memoryPick/memoryPickSessionStore";
import { openMemoryPickGate } from "../../project-memory/memoryPick/memoryPickGateStore";
import {
  buildMemoryPickEmptyTimelineText,
  emitMemoryPickComposerModeSync,
  retrieveMemoryPickWithObservability,
} from "./threadMessagingMemoryPick";
import type { SendMessageOptions } from "./threadMessagingTypes";

export type MemoryPickGateOutcome = {
  cancelled: boolean;
  pickMemoryIds: string[];
  pickInjectMode: MemoryPickComposerMode;
  usedMemoryPickPath: boolean;
};

export async function runMemoryPickGate(params: {
  workspace: WorkspaceInfo;
  threadId: string;
  visibleUserText: string;
  options?: SendMessageOptions;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  safeMessageActivity: () => void;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  t: TFunction;
}): Promise<MemoryPickGateOutcome> {
  const {
    workspace,
    threadId,
    visibleUserText,
    options,
    markProcessing,
    safeMessageActivity,
    dispatch,
    getCustomName,
    t,
  } = params;
  // 记忆参考：三态 off|pick|always（Shared/Native 统一）；兼容旧 memoryReferenceEnabled
  // opt-in：Composer 传什么就用什么；off 默认不进闸门，需用户从菜单开启 pick/always
  const composerModeFromOptions = normalizeMemoryPickComposerMode(
    options?.memoryReferenceMode ??
      (options?.memoryReferenceEnabled === true ? "always" : "off"),
  );
  const sessionPolicyBefore = getMemoryPickSessionPolicy(
    workspace.id,
    threadId,
  );
  const effectiveComposerMode: MemoryPickComposerMode =
    composerModeFromOptions;
  if (effectiveComposerMode !== sessionPolicyBefore.composerMode) {
    setMemoryPickComposerMode(
      workspace.id,
      threadId,
      effectiveComposerMode,
    );
  }
  const pickPolicy = {
    ...getMemoryPickSessionPolicy(workspace.id, threadId),
    composerMode: effectiveComposerMode,
  };
  const pickDecision = decideMemoryPickGateEntry({
    composerMode: pickPolicy.composerMode,
    policy: pickPolicy,
    queryText: visibleUserText,
    hasRetrievableText: visibleUserText.trim().length > 0,
  });

  let pickMemoryIds: string[] = [];
  let pickInjectMode: MemoryPickComposerMode = "pick";
  let usedMemoryPickPath = false;

  if (pickDecision.kind === "show-ui") {
    usedMemoryPickPath = true;
    // 闸门等待期间不占用 processing 灯（尚未调模型）
    markProcessing(threadId, false);
    const resolution = await openMemoryPickGate({
      workspaceId: workspace.id,
      threadId,
      queryText: visibleUserText,
      mode:
        pickDecision.reason === "always-mode" ||
        pickPolicy.composerMode === "always"
          ? "always"
          : "pick",
      firstPick: pickDecision.reason === "first-pick",
      retrieve: () =>
        retrieveMemoryPickWithObservability({
          workspaceId: workspace.id,
          query: visibleUserText,
        }),
    });

    if (resolution.action === "cancel") {
      safeMessageActivity();
      return { cancelled: true, pickMemoryIds, pickInjectMode, usedMemoryPickPath };
    }
    if (resolution.action === "dismiss") {
      markMemoryPickSessionDismissed(workspace.id, threadId);
      markMemoryPickFirstPickDone(workspace.id, threadId);
    } else if (resolution.action === "skip") {
      markMemoryPickFirstPickDone(workspace.id, threadId);
      // 跳过不自动升级为 pick；用户已在 Composer 选 pick/always 时保持原模式
      // 检索空/超时/失败：时间线可感（非全局 toast）
      const emptyTimeline = resolution.emptyReason
        ? buildMemoryPickEmptyTimelineText(resolution.emptyReason, t)
        : null;
      if (emptyTimeline) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `memory-pick-empty-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: emptyTimeline,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
    } else if (resolution.action === "confirm") {
      pickMemoryIds = resolution.selectedIds;
      pickInjectMode = resolution.mode;
      markMemoryPickFirstPickDone(workspace.id, threadId);
      if (resolution.mode === "always") {
        setMemoryPickComposerMode(workspace.id, threadId, "always");
        emitMemoryPickComposerModeSync(workspace.id, threadId, "always");
      } else {
        // 本轮挑选确认（含 0 勾）：固化 pick，避免回到 off 导致「下次没了」
        setMemoryPickComposerMode(workspace.id, threadId, "pick");
        emitMemoryPickComposerModeSync(workspace.id, threadId, "pick");
      }
    }
    markProcessing(threadId, true);
    safeMessageActivity();
  }
  // always 已并入 show-ui（每轮 matching + Top3 预览），不再 silent-always

  return { cancelled: false, pickMemoryIds, pickInjectMode, usedMemoryPickPath };
}
