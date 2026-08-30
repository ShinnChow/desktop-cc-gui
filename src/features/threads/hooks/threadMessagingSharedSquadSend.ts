import type { Dispatch } from "react";
import type { TFunction } from "i18next";
import type { WorkspaceInfo, ConversationItem } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";
import {
  isResolvedExecutionTarget,
  freezeTurnSnapshot,
  type ExecutionTarget,
} from "../../shared-session/target/types";
import { injectCollabSkillContext } from "../../multi-agent/runtime/skillContextInjection";
import { injectMainCanvasContext } from "../../multi-agent/runtime/mainCanvasContextInjection";
import { getSelectedTemplate } from "../../multi-agent/templates/templateStore";
import { templateToStageBindings } from "../../multi-agent/templates/types";
import { requestAgentPlan } from "../../multi-agent/runtime/executor";
import { readExternalAbsoluteFile } from "../../../services/tauri/workspaceFiles";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import { injectSelectedMemoriesContext } from "../../project-memory/utils/memoryContextInjection";
import { injectMemoryScoutBriefContext, scoutProjectMemory } from "../../project-memory/utils/memoryScout";
import { injectMemoryPickContext } from "../../project-memory/memoryPick/injectMemoryPickContext";
import { emitMemoryPickTelemetry } from "../../project-memory/memoryPick/memoryPickTelemetry";
import { normalizeMemoryPickComposerMode, type MemoryPickComposerMode } from "../../project-memory/memoryPick/memoryPickTypes";
import { decideMemoryPickGateEntry } from "../../project-memory/memoryPick/memoryPickPolicy";
import {
  getMemoryPickSessionPolicy,
  markMemoryPickFirstPickDone,
  markMemoryPickSessionDismissed,
  setMemoryPickComposerMode,
} from "../../project-memory/memoryPick/memoryPickSessionStore";
import { openMemoryPickGate } from "../../project-memory/memoryPick/memoryPickGateStore";
import { noteCardsFacade } from "../../note-cards/services/noteCardsFacade";
import { injectSelectedNoteCardsContext } from "../../note-cards/utils/noteCardContextInjection";
import { emitMessagesForcePinBottom } from "../../../live-canvas/liveCanvasControls";
import {
  engineSupportsImageInput,
  findOversizedImageAttachment,
  formatEngineImageTooLargeMessage,
  sanitizeImageAttachmentPaths,
} from "../../engine/utils/engineImageInput";
import {
  buildMemoryPickEmptyTimelineText,
  emitMemoryPickComposerModeSync,
  resolvePickSemanticContext,
  retrieveMemoryPickWithObservability,
} from "./threadMessagingMemoryPick";
import { withMemoryScoutTimeout } from "./messageRuntimeController";
import type { SendMessageOptions } from "./threadMessagingTypes";

export async function runSquadRequestSend(params: {
  workspace: WorkspaceInfo;
  threadId: string;
  threadKind: "native" | "shared";
  sharedV2SendEnabled: boolean;
  supportedStoredSharedTarget: ExecutionTarget | null;
  messageText: string;
  images: string[];
  options?: SendMessageOptions;
  itemsByThread: Record<string, ConversationItem[]>;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  safeMessageActivity: () => void;
  t: TFunction;
}): Promise<void> {
  const {
    workspace,
    threadId,
    threadKind,
    sharedV2SendEnabled,
    supportedStoredSharedTarget,
    messageText,
    images,
    options,
    itemsByThread,
    dispatch,
    getCustomName,
    markProcessing,
    safeMessageActivity,
    t,
  } = params;
  if (options?.squadRequest) {
    // Shared 内已走协作发送：不再二次判断 feature flag；
    // 仍强制 shared + V2 + 完整 target，避免 native / 半开 target 越界。
    // Context Fan-in（§8.6）：图/skill/记忆/便签对齐注入首段，不再整类拒绝。
    if (
      threadKind !== "shared" ||
      !sharedV2SendEnabled ||
      !isResolvedExecutionTarget(supportedStoredSharedTarget)
    ) {
      throw new Error(
        "agent-request-unavailable: Multi-Agent requires Shared Session V2 and a complete target",
      );
    }
    const snapshot = freezeTurnSnapshot(supportedStoredSharedTarget);
    const collabTarget = {
      engine: snapshot.engine,
      providerProfileId: snapshot.providerProfileId,
      modelCatalogEntryId: snapshot.modelCatalogEntryId,
      model: snapshot.model,
      reasoningEffort: snapshot.reasoning?.effort ?? null,
      providerProfileNameSnapshot: snapshot.providerProfileNameSnapshot,
      providerProfileSource: snapshot.providerProfileSource,
      runtimeCapabilityFingerprint: snapshot.runtimeCapabilityFingerprint,
    };
    // 可见原文（主幕气泡）；model text 在此基础上叠 skill/记忆/便签/主幕历史
    // 纯图：可见可空，model 侧在 executor 内补占位
    // Context Fan-in 口径：
    // - 主幕已有对话：digest 置顶注入 modelText（不进 visibleText / 主幕卡标题）
    // - 记忆/便签：正文注入进 modelText（与图不同，不走独立 image_refs 通道）
    // - skill：协作 prompt 包层后 slash 常失效 → 读 SKILL.md 正文注入首段
    // - 图 / 便签附图：firstStageImages + dispatch durable 回填
    const visibleUserText = messageText.trim();
    let modelText = messageText.trim() || messageText;
    const skillRefs = (options?.skillInvocations ?? [])
      .map((entry) => ({
        name: entry.name?.trim() ?? "",
        path: entry.path?.trim() || null,
      }))
      .filter((entry) => entry.name.length > 0);
    if (skillRefs.length > 0) {
      const skillInjection = await injectCollabSkillContext({
        workspaceId: workspace.id,
        userText: modelText,
        skills: skillRefs,
        readFile: readExternalAbsoluteFile,
      });
      modelText = skillInjection.finalText;
    }
    const selectedMemoryIds = Array.from(
      new Set(
        (options?.selectedMemoryIds ?? [])
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
    if (selectedMemoryIds.length > 0) {
      const retrievalStart = Date.now();
      const selectedMemoryInjectionMode =
        options?.selectedMemoryInjectionMode === "summary"
          ? "summary"
          : "detail";
      const selectedMemories = (
        await Promise.all(
          selectedMemoryIds.map((memoryId) =>
            projectMemoryFacade
              .get(memoryId, workspace.id)
              .catch(() => null),
          ),
        )
      ).filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      modelText = injectSelectedMemoriesContext({
        userText: modelText,
        memories: selectedMemories,
        mode: selectedMemoryInjectionMode,
        retrievalMs: Date.now() - retrievalStart,
      }).finalText;
    }
    // 协作首段：与 Native/Shared 同一记忆参考三态（pick 闸门 / always TopK）
    {
      const collabComposerMode = normalizeMemoryPickComposerMode(
        options?.memoryReferenceMode ??
          (options?.memoryReferenceEnabled === true ? "always" : "off"),
      );
      setMemoryPickComposerMode(
        workspace.id,
        threadId,
        collabComposerMode,
      );
      const collabPolicy = getMemoryPickSessionPolicy(
        workspace.id,
        threadId,
      );
      const collabDecision = decideMemoryPickGateEntry({
        composerMode: collabPolicy.composerMode,
        policy: collabPolicy,
        queryText: visibleUserText,
        hasRetrievableText: visibleUserText.trim().length > 0,
      });
      let collabPickIds: string[] = [];
      let collabPickMode: MemoryPickComposerMode = "pick";
      if (collabDecision.kind === "show-ui") {
        const resolution = await openMemoryPickGate({
          workspaceId: workspace.id,
          threadId,
          queryText: visibleUserText,
          mode:
            collabDecision.reason === "always-mode" ||
            collabPolicy.composerMode === "always"
              ? "always"
              : "pick",
          firstPick: collabDecision.reason === "first-pick",
          retrieve: () =>
            retrieveMemoryPickWithObservability({
              workspaceId: workspace.id,
              query: visibleUserText,
            }),
        });
        if (resolution.action === "cancel") {
          return;
        }
        if (resolution.action === "dismiss") {
          markMemoryPickSessionDismissed(workspace.id, threadId);
          markMemoryPickFirstPickDone(workspace.id, threadId);
        } else if (resolution.action === "skip") {
          markMemoryPickFirstPickDone(workspace.id, threadId);
          // 跳过不自动把 off 升级为 pick；仅用户已开启 pick/always 时维持模式
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
          collabPickIds = resolution.selectedIds;
          collabPickMode = resolution.mode;
          markMemoryPickFirstPickDone(workspace.id, threadId);
          if (resolution.mode === "always") {
            setMemoryPickComposerMode(workspace.id, threadId, "always");
            emitMemoryPickComposerModeSync(
              workspace.id,
              threadId,
              "always",
            );
          } else {
            setMemoryPickComposerMode(workspace.id, threadId, "pick");
            emitMemoryPickComposerModeSync(workspace.id, threadId, "pick");
          }
        }
      } else if (options?.memoryReferenceEnabled === true) {
        const { semanticProvider } = await resolvePickSemanticContext(
          workspace.id,
        );
        const memoryBrief = await withMemoryScoutTimeout(
          scoutProjectMemory({
            workspaceId: workspace.id,
            query: visibleUserText,
            listFn: projectMemoryFacade.listSummary,
            semanticProvider,
          }),
        );
        modelText = injectMemoryScoutBriefContext({
          userText: modelText,
          brief: memoryBrief,
          startIndex: 1,
        }).finalText;
      }
      if (collabPickIds.length > 0) {
        const manualIdSet = new Set(selectedMemoryIds);
        const pickMemories = (
          await Promise.all(
            collabPickIds.map((memoryId) =>
              projectMemoryFacade
                .get(memoryId, workspace.id)
                .catch(() => null),
            ),
          )
        ).filter(
          (entry): entry is NonNullable<typeof entry> =>
            entry !== null && !manualIdSet.has(entry.id),
        );
        if (pickMemories.length > 0) {
          const collabInject = injectMemoryPickContext({
            userText: modelText,
            memories: pickMemories,
            mode: collabPickMode,
            queryText: visibleUserText,
          });
          modelText = collabInject.finalText;
          emitMemoryPickTelemetry("memory_pick_inject", {
            mode: collabPickMode,
            injectedCount: collabInject.injectedCount,
            packChars: collabInject.injectedChars,
            cleanerStatus: "cleaned",
          });
        }
      }
    }
    let finalImages = [...images];
    const selectedNoteCardIds = Array.from(
      new Set(
        (options?.selectedNoteCardIds ?? [])
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
    if (selectedNoteCardIds.length > 0) {
      const selectedNotes = (
        await Promise.all(
          selectedNoteCardIds.map((noteId) =>
            noteCardsFacade
              .get({
                noteId,
                workspaceId: workspace.id,
                workspaceName: workspace.name,
                workspacePath: workspace.path,
              })
              .catch(() => null),
          ),
        )
      ).filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      const noteInjection = injectSelectedNoteCardsContext({
        userText: modelText,
        noteCards: selectedNotes,
      });
      modelText = noteInjection.finalText;
      finalImages = Array.from(
        new Set([...finalImages, ...noteInjection.imagePaths]),
      );
    }
    // 主幕历史 digest 置顶（在 skill/记忆/便签之后 prepend，保证块在最终 modelText 头部）
    // 不污染 visibleUserText / 主幕气泡；空历史 no-op
    modelText = injectMainCanvasContext({
      userText: modelText,
      items: itemsByThread[threadId] ?? [],
    }).finalText;
    finalImages = sanitizeImageAttachmentPaths(finalImages);
    if (
      finalImages.length > 0 &&
      !engineSupportsImageInput(collabTarget.engine)
    ) {
      throw new Error(
        `agent-request-images-unsupported: engine ${collabTarget.engine} does not support image input`,
      );
    }
    const oversizedCollabImage = findOversizedImageAttachment(
      finalImages,
      collabTarget.engine,
    );
    if (oversizedCollabImage) {
      throw new Error(
        `agent-request-images-too-large: ${formatEngineImageTooLargeMessage(
          collabTarget.engine,
          oversizedCollabImage.bytes,
          oversizedCollabImage.maxBytes,
          t as (key: string, options?: Record<string, unknown>) => string,
        )}`,
      );
    }
    // 按当前选中模板生成每段独立 stageBindings（CLI·模型·思考强度）。
    const stageBindings = templateToStageBindings(
      getSelectedTemplate(),
      collabTarget,
    );
    // A：入口只负责点亮 + 异常熄灭；终态/审批/停止由 executor（B）权威收口，
    // 避免 A 晚到的 false 盖掉「停→立刻再开」的新 run。
    // 纯图/首发：await requestAgentPlan 前先上屏用户气泡，避免 emptyThread 闪屏。
    if (
      !options?.suppressUserMessageRender &&
      (visibleUserText.length > 0 || finalImages.length > 0)
    ) {
      dispatch({
        type: "upsertItem",
        workspaceId: workspace.id,
        threadId,
        item: {
          id: `optimistic-user-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          kind: "message",
          role: "user",
          text: visibleUserText,
          images: finalImages.length > 0 ? finalImages : undefined,
        },
        hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
      });
      emitMessagesForcePinBottom();
    }
    markProcessing(threadId, true);
    safeMessageActivity();
    try {
      await requestAgentPlan({
        workspaceId: workspace.id,
        threadId,
        text: modelText,
        visibleText: visibleUserText,
        images: finalImages,
        target: collabTarget,
        stageBindings,
      });
    } catch (error) {
      markProcessing(threadId, false);
      throw error;
    }
    return;
  }
}
