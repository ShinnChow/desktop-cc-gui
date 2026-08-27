import { describe, expect, it } from "vitest";
import type { ComposerSessionSelection } from "../domains/selectedComposerSession";
import {
  getThreadComposerSelectionStorageKey,
  shouldApplyDraftComposerSelectionToThread,
  shouldMigrateComposerSelectionBetweenThreadIds,
} from "../domains/selectedComposerSession";

type SessionMap = Record<string, ComposerSessionSelection | null>;

function migrateSelection(
  state: SessionMap,
  input: {
    previousThreadId: string | null;
    activeThreadId: string | null;
    previousSessionKey: string | null;
    activeSessionKey: string | null;
    resolveCanonicalThreadId: (threadId: string) => string;
  },
): SessionMap {
  if (
    !shouldMigrateComposerSelectionBetweenThreadIds({
      ...input,
      hasSourceSelection:
        (input.previousSessionKey ? state[input.previousSessionKey] ?? null : null) !== null,
      hasTargetSelection:
        (input.activeSessionKey ? state[input.activeSessionKey] ?? null : null) !== null,
    })
  ) {
    return state;
  }
  const sourceSessionKey = input.previousSessionKey!;
  const targetSessionKey = input.activeSessionKey!;
  return {
    ...state,
    [targetSessionKey]: state[sourceSessionKey] ?? null,
  };
}

describe("selected composer session flow", () => {
  it("keeps model and effort after pending -> finalized thread migration", () => {
    const workspaceId = "ws-frontend";
    const pendingThreadId = "codex-pending-1001";
    const finalizedThreadId = "codex:session-abc";
    const draftSelection: ComposerSessionSelection = {
      modelId: "gpt-5.4",
      effort: "high",
    };

    let selectionBySessionKey: SessionMap = {};
    let shouldApplyDraftToNextThread = true;

    const pendingSessionKey = getThreadComposerSelectionStorageKey(
      workspaceId,
      pendingThreadId,
    );
    const pendingCandidate = selectionBySessionKey[pendingSessionKey] ?? null;
    const shouldApplyToPending = shouldApplyDraftComposerSelectionToThread({
      candidate: pendingCandidate,
      shouldApplyDraftToNextThread,
      draftComposerSelection: draftSelection,
      activeThreadId: pendingThreadId,
    });
    expect(shouldApplyToPending).toBe(true);
    if (shouldApplyToPending) {
      selectionBySessionKey[pendingSessionKey] = draftSelection;
      shouldApplyDraftToNextThread = false;
    }

    const finalizedSessionKey = getThreadComposerSelectionStorageKey(
      workspaceId,
      finalizedThreadId,
    );
    selectionBySessionKey = migrateSelection(selectionBySessionKey, {
      previousThreadId: pendingThreadId,
      activeThreadId: finalizedThreadId,
      previousSessionKey: pendingSessionKey,
      activeSessionKey: finalizedSessionKey,
      resolveCanonicalThreadId: (threadId) =>
        threadId === pendingThreadId ? finalizedThreadId : threadId,
    });

    expect(selectionBySessionKey[finalizedSessionKey]).toEqual(draftSelection);
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: selectionBySessionKey[finalizedSessionKey] ?? null,
        shouldApplyDraftToNextThread,
        draftComposerSelection: draftSelection,
        activeThreadId: finalizedThreadId,
      }),
    ).toBe(false);
  });

  it("keeps selections isolated across workspaces even for identical thread ids", () => {
    const threadId = "codex:session-shared";
    const workspaceAKey = getThreadComposerSelectionStorageKey("ws-a", threadId);
    const workspaceBKey = getThreadComposerSelectionStorageKey("ws-b", threadId);
    const state: SessionMap = {
      [workspaceAKey]: { modelId: "gpt-5.4", effort: "high" },
      [workspaceBKey]: { modelId: "gpt-5.5", effort: "medium" },
    };

    expect(state[workspaceAKey]).toEqual({ modelId: "gpt-5.4", effort: "high" });
    expect(state[workspaceBKey]).toEqual({ modelId: "gpt-5.5", effort: "medium" });
  });

  // fix-composer-cross-engine-draft-selection-leak：
  // 离开 Claude 会话产生的草稿不得写进下一条 Codex pending 的账本；
  // 同引擎（grok）链路保持既有继承行为。
  it("rejects carrying a Claude draft onto a Codex pending session", () => {
    const claudeThreadId = "claude:session-1";
    const codexPendingThreadId = "codex-pending-2001";
    const claudeDraft: ComposerSessionSelection = {
      modelId: "grok-4.6",
      effort: "high",
    };

    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: claudeDraft,
        activeThreadId: codexPendingThreadId,
        draftSourceThreadId: claudeThreadId,
      }),
    ).toBe(false);
  });

  it("still carries a grok draft onto a new grok pending session", () => {
    const grokDraft: ComposerSessionSelection = {
      modelId: "grok-4.6",
      effort: "high",
    };
    const sessionMap: SessionMap = {};
    const targetSessionKey = getThreadComposerSelectionStorageKey(
      "ws-frontend",
      "grok-pending-3001",
    );
    const shouldApply = shouldApplyDraftComposerSelectionToThread({
      candidate: sessionMap[targetSessionKey] ?? null,
      shouldApplyDraftToNextThread: true,
      draftComposerSelection: grokDraft,
      activeThreadId: "grok-pending-3001",
      draftSourceThreadId: "grok:session-0",
    });

    expect(shouldApply).toBe(true);
    if (shouldApply) {
      sessionMap[targetSessionKey] = grokDraft;
    }
    expect(sessionMap[targetSessionKey]).toEqual(grokDraft);
  });
});
