/**
 * 切会话选择决策核心（openspec change refactor-composer-thread-selection Phase 1）。
 *
 * 从 useSelectedComposerSession.reloadSelectedComposerSelection 平移取值规则：
 * 纯函数不做 IO（不读 store、不发 setState），全部上下文由 hook 注入；
 * 产出 { display, writes }，副作用（账本落盘 / cache 同步 / 清锁）由 hook 应用。
 *
 * 优先级（与原 hook 语义逐一等价）：
 *   L1 持久账本 stored → L2 内存 cache → L3 无候选分支
 *   { Claude fork 继承 | draft carry（引擎门禁）| engine default（仅 pending）}
 *   → L4 pending effort 回填（只补 null，不覆盖显式值）。
 *
 * L3c 种入与 L4 回填是两条独立取数通道（忠实原实现语义）：
 * - engineDefaultSelection：hook 注入的 resolveEngineDefaultComposerSelection 输出（含 codex→null）；
 * - enginePrefEffort：hook 直接读 composerEnginePrefsStore 的当前引擎档位（fillPending 同源，codex 由调用方置 null）。
 */
import {
  normalizeComposerSessionSelectionForThread,
  shouldApplyDraftComposerSelectionToThread,
  shouldInheritComposerSelectionFromClaudeForkParent,
  getThreadComposerSelectionStorageKey,
  type ComposerSessionSelection,
} from "../selectedComposerSession";

export type ThreadSelectionDraftInput = {
  value: ComposerSessionSelection | null;
  workspaceId: string | null;
  /** carry 来源线程 id；Home 点选等无线程来源为 null */
  sourceThreadId: string | null;
  applyToNextThread: boolean;
};

export type ThreadSelectionSwitchInput = {
  workspaceId: string | null;
  threadId: string | null;
  /** 持久账本读取结果（hook 注入；exists 区分「无 entry」与「entry 为 null」） */
  storedSelection: { exists: boolean; value: ComposerSessionSelection | null };
  /** 内存 cache 读取结果；hasCacheEntry 区分「无 entry」与「entry 为 null」 */
  cachedSelection: ComposerSessionSelection | null;
  hasCacheEntry: boolean;
  /** Claude fork 父线程 id（extractClaudeForkParentThreadId 结果，非 fork 为 null） */
  forkParentThreadId: string | null;
  /** fork 父线程的持久账本值 */
  forkParentStoredSelection: ComposerSessionSelection | null;
  draft: ThreadSelectionDraftInput | null;
  /** D6 闸2：目标线程引擎 catalog 成员资格 key 集（id+model）；null=不可得放行 */
  targetEngineModelKeys?: readonly string[] | null;
  /** L3c 种入用：注入的 resolveEngineDefaultComposerSelection 输出（含 codex→null）。 */
  engineDefaultSelection: ComposerSessionSelection | null;
  engineDefaultSelectionReady: boolean;
  /** L4 回填用：直接读 composerEnginePrefsStore 的当前引擎档位（codex 置 null）。 */
  enginePrefEffort: string | null;
};

export type SelectionWrite =
  | {
      kind: "thread-ledger";
      sessionKey: string;
      value: ComposerSessionSelection;
      reason:
        | "draft-apply"
        | "fork-inherit"
        | "engine-default"
        | "effort-fill"
        | "migration";
    }
  | { kind: "clear-draft-apply-flag" };

export type ThreadSelectionSwitchDecision = {
  display: ComposerSessionSelection | null;
  writes: SelectionWrite[];
};

export function resolveThreadSelectionOnSwitch(
  input: ThreadSelectionSwitchInput,
): ThreadSelectionSwitchDecision {
  const { workspaceId, threadId } = input;

  // 无 activeThread（Home）：显示同 workspace 的 draft，无写入。
  if (!threadId) {
    const draftForWorkspace =
      input.draft?.workspaceId === (workspaceId ?? null)
        ? normalizeDraft(input.draft)
        : null;
    return { display: draftForWorkspace, writes: [] };
  }

  const sessionKey = getThreadComposerSelectionStorageKey(
    workspaceId,
    threadId,
  );
  if (!sessionKey) {
    return { display: null, writes: [] };
  }

  let candidate: ComposerSessionSelection | null = null;
  let hasCandidate = false;
  const writes: SelectionWrite[] = [];

  // L1 持久账本优先（DSH seed 直写 store；store 优先于可能 stale 的内存 cache）。
  if (input.storedSelection.exists) {
    candidate = normalizeForThread(threadId, input.storedSelection.value);
    hasCandidate = true;
  } else if (input.hasCacheEntry) {
    // L2 内存 cache 兜底（store 未 ready 窗口的写入）。
    candidate = normalizeForThread(threadId, input.cachedSelection);
    hasCandidate = true;
  } else {
    // L3 无候选分支。
    // a) Claude fork 继承
    const parentSelection = input.forkParentThreadId
      ? normalizeForThread(
          input.forkParentThreadId,
          input.forkParentStoredSelection,
        )
      : null;
    const inherited = normalizeForThread(threadId, parentSelection);
    if (
      inherited &&
      shouldInheritComposerSelectionFromClaudeForkParent({
        activeThreadId: threadId,
        hasCandidate,
        hasParentSelection: Boolean(parentSelection),
      })
    ) {
      candidate = inherited;
      hasCandidate = true;
      writes.push({
        kind: "thread-ledger",
        sessionKey,
        value: inherited,
        reason: "fork-inherit",
      });
    }

    // b) draft carry（workspace 门禁 + 引擎门禁在 shouldApply 内）
    const draftForActiveThread = normalizeForThread(
      threadId,
      normalizeDraft(input.draft),
    );
    const draftWorkspaceMatches =
      input.draft?.workspaceId === (workspaceId ?? null);
    if (
      draftForActiveThread &&
      draftWorkspaceMatches &&
      shouldApplyDraftComposerSelectionToThread({
        candidate,
        shouldApplyDraftToNextThread: input.draft?.applyToNextThread ?? false,
        draftComposerSelection: draftForActiveThread,
        activeThreadId: threadId,
        draftSourceThreadId: input.draft?.sourceThreadId ?? null,
        targetEngineModelKeys: input.targetEngineModelKeys ?? null,
      })
    ) {
      candidate = draftForActiveThread;
      hasCandidate = true;
      writes.push({
        kind: "thread-ledger",
        sessionKey,
        value: draftForActiveThread,
        reason: "draft-apply",
      });
      writes.push({ kind: "clear-draft-apply-flag" });
    }

    // c) engine default：仅 pending 新会话，且注入侧已应用 codex 除外规则。
    if (
      !hasCandidate &&
      input.engineDefaultSelectionReady &&
      threadId.includes("-pending-")
    ) {
      const engineDefault = normalizeForThread(
        threadId,
        input.engineDefaultSelection,
      );
      if (engineDefault) {
        candidate = engineDefault;
        hasCandidate = true;
        writes.push({
          kind: "thread-ledger",
          sessionKey,
          value: candidate,
          reason: "engine-default",
        });
      }
    }
  }

  // L4 pending effort 回填：只补 null，不覆盖显式值（含用户刻意清空后的「默认」）。
  if (candidate && threadId.includes("-pending-")) {
    const prefEffort = input.enginePrefEffort;
    if (!candidate.effort && prefEffort) {
      const filled = normalizeForThread(threadId, {
        modelId: candidate.modelId,
        effort: prefEffort,
      });
      if (filled && filled.effort !== candidate.effort) {
        candidate = filled;
        writes.push({
          kind: "thread-ledger",
          sessionKey,
          value: candidate,
          reason: "effort-fill",
        });
      }
    }
  }

  return { display: candidate, writes };
}

function normalizeDraft(
  draft: ThreadSelectionDraftInput | null,
): ComposerSessionSelection | null {
  return draft?.value ?? null;
}

function normalizeForThread(
  threadId: string | null,
  selection: ComposerSessionSelection | null,
): ComposerSessionSelection | null {
  if (!threadId) {
    return selection;
  }
  return normalizeComposerSessionSelectionForThread(threadId, selection);
}
