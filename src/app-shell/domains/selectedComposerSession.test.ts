import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractClaudeForkParentThreadId,
  fillPendingComposerSelectionEffortFromEnginePref,
  getThreadComposerSelectionStorageKey,
  normalizeComposerSessionSelectionForThread,
  seedDshComposerSelectionFromHost,
  shouldApplyDraftComposerSelectionToThread,
  shouldInheritComposerSelectionFromClaudeForkParent,
  shouldMigrateComposerSelectionBetweenThreadIds,
  type ComposerSessionSelection,
} from "./selectedComposerSession";

const { getComposerEnginePrefForEngine } = vi.hoisted(() => ({
  getComposerEnginePrefForEngine: vi.fn(),
}));

const composerStore: Record<string, unknown> = {};

vi.mock("../../features/composer/hooks/composerEnginePrefsStore", () => ({
  getComposerEnginePrefForEngine,
}));

vi.mock("../../services/clientStorage", () => ({
  isClientStoreReady: () => true,
  getClientStoreSync: (_store: string, key: string) => composerStore[key],
  writeClientStoreValue: (_store: string, key: string, value: unknown) => {
    composerStore[key] = value;
  },
}));

describe("selectedComposerSession", () => {
  const identity = (threadId: string) => threadId;
  const draftSelection: ComposerSessionSelection = {
    modelId: "gpt-5.4",
    effort: "high",
  };

  beforeEach(() => {
    Object.keys(composerStore).forEach((key) => delete composerStore[key]);
  });

  it("builds a workspace-scoped session key for each thread", () => {
    expect(getThreadComposerSelectionStorageKey("ws-a", "codex:session-1")).toBe(
      "selectedModelByThread.ws-a:codex:session-1",
    );
    expect(getThreadComposerSelectionStorageKey("ws-b", "codex:session-1")).toBe(
      "selectedModelByThread.ws-b:codex:session-1",
    );
  });

  it("applies a draft selection to the first pending thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex-pending-1",
      }),
    ).toBe(true);
  });

  it("does not apply a draft selection to a finalized thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex:session-1",
      }),
    ).toBe(false);
  });

  // fix-composer-cross-engine-draft-selection-leak：
  // carry 来源线程引擎已知时，draft 只允许进入同引擎 pending（composer-session-selection-isolation）。
  it("applies a same-engine draft onto its own pending thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "claude-pending-2",
        draftSourceThreadId: "claude:session-1",
      }),
    ).toBe(true);
  });

  it("rejects a cross-engine draft (Claude draft onto Codex pending)", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex-pending-1",
        draftSourceThreadId: "claude:session-1",
      }),
    ).toBe(false);
  });

  it("keeps legacy behavior when the draft has no source thread (home pick)", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex-pending-1",
        draftSourceThreadId: null,
      }),
    ).toBe(true);
  });

  it("keeps legacy behavior when either side resolves no engine", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex-pending-1",
        draftSourceThreadId: "unprefixed-local-thread",
      }),
    ).toBe(true);
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "shared-pending-9",
        draftSourceThreadId: "unprefixed-local-thread",
      }),
    ).toBe(true);
  });

  // composer-session-selection-isolation 的引擎无关性锁：
  // resolveThreadEngine 登记的全部 native CLI 两两组合都必须被同一道闸口拦截。
  const ENGINE_SOURCE_THREAD_IDS: Record<string, string> = {
    claude: "claude:a",
    codex: "codex:b",
    gemini: "gemini:c",
    grok: "grok:d",
    kimi: "kimi:e",
    opencode: "opencode:f",
    pi: "pi:g",
    dsh: "dsh:h",
    qoder: "qoder:i",
  };

  for (const [sourceEngine, sourceThreadId] of Object.entries(
    ENGINE_SOURCE_THREAD_IDS,
  )) {
    it(`rejects ${sourceEngine} drafts onto every other engine's pending thread`, () => {
      for (const [targetEngine] of Object.entries(ENGINE_SOURCE_THREAD_IDS)) {
        if (targetEngine === sourceEngine) {
          continue;
        }
        expect(
          shouldApplyDraftComposerSelectionToThread({
            candidate: null,
            shouldApplyDraftToNextThread: true,
            draftComposerSelection: { modelId: "some-model", effort: null },
            activeThreadId: `${targetEngine}-pending-1`,
            draftSourceThreadId: sourceThreadId,
          }),
          `${sourceEngine} draft must not apply to ${targetEngine} pending`,
        ).toBe(false);
      }
    });
  }

  it("still applies drafts within every single engine", () => {
    for (const [engine, sourceThreadId] of Object.entries(
      ENGINE_SOURCE_THREAD_IDS,
    )) {
      expect(
        shouldApplyDraftComposerSelectionToThread({
          candidate: null,
          shouldApplyDraftToNextThread: true,
          draftComposerSelection: { modelId: "some-model", effort: null },
          activeThreadId: `${engine}-pending-2`,
          draftSourceThreadId: sourceThreadId,
        }),
        `same-engine ${engine} carry must keep working`,
      ).toBe(true);
    }
  });

  // 并行 native：离开会话 A 后 draft 不得污染历史会话 B（finalized）。
  it("does not apply MiniMax draft onto a finalized DeepSeek-bound historical session", () => {
    const minimaxDraft: ComposerSessionSelection = {
      modelId: "MiniMax-M3",
      effort: null,
    };
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: minimaxDraft,
        activeThreadId: "claude:historical-deepseek-session",
      }),
    ).toBe(false);
  });

  it("migrates a persisted selection from pending to finalized thread ids", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex-pending-1",
        activeThreadId: "codex:session-1",
        previousSessionKey: "selectedModelByThread.ws-a:codex-pending-1",
        activeSessionKey: "selectedModelByThread.ws-a:codex:session-1",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(true);
  });

  it("does not migrate across unrelated threads or engines", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex:session-1",
        activeThreadId: "claude:session-2",
        previousSessionKey: "selectedModelByThread.ws-a:codex:session-1",
        activeSessionKey: "selectedModelByThread.ws-a:claude:session-2",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("treats temporary Claude fork ids as Claude children", () => {
    expect(extractClaudeForkParentThreadId("claude-fork:session-1:local-1")).toBe(
      "claude:session-1",
    );
    expect(
      shouldInheritComposerSelectionFromClaudeForkParent({
        activeThreadId: "claude-fork:session-1:local-1",
        hasCandidate: false,
        hasParentSelection: true,
      }),
    ).toBe(true);
  });

  it("normalizes stored effort by thread engine capability", () => {
    expect(
      normalizeComposerSessionSelectionForThread("claude:session-1", {
        modelId: "claude-opus-4-1",
        effort: " high ",
      }),
    ).toEqual({
      modelId: "claude-opus-4-1",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("claude:session-1", {
        modelId: "claude-opus-4-1",
        effort: "ultra",
      }),
    ).toEqual({
      modelId: "claude-opus-4-1",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("gemini:session-1", {
        modelId: "gemini-2.5-pro",
        effort: "high",
      }),
    ).toEqual({
      modelId: "gemini-2.5-pro",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("grok:session-1", {
        modelId: "grok-4.5",
        effort: " high ",
      }),
    ).toEqual({
      modelId: "grok-4.5",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("grok:session-1", {
        modelId: "grok-4.5",
        effort: "xhigh",
      }),
    ).toEqual({
      modelId: "grok-4.5",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("codex:session-1", {
        modelId: "gpt-5.4",
        effort: "high",
      }),
    ).toEqual({
      modelId: "gpt-5.4",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("pi:session-1", {
        modelId: "kimi-coding/k3",
        effort: "high",
      }),
    ).toEqual({
      modelId: "kimi-coding/k3",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("pi:session-1", {
        modelId: "kimi-coding/k3",
        effort: "low",
      }),
    ).toEqual({
      modelId: "kimi-coding/k3",
      effort: "low",
    });
    expect(
      normalizeComposerSessionSelectionForThread("pi:session-1", {
        modelId: "kimi-coding/k3",
        effort: "ultra",
      }),
    ).toEqual({
      modelId: "kimi-coding/k3",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("dsh:session-1", {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: " high ",
      }),
    ).toEqual({
      modelId: "deepseek-official/deepseek-v4-flash",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("dsh:session-1", {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: "off",
      }),
    ).toEqual({
      modelId: "deepseek-official/deepseek-v4-flash",
      effort: "off",
    });
    expect(
      normalizeComposerSessionSelectionForThread("dsh:session-1", {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: "medium",
      }),
    ).toEqual({
      modelId: "deepseek-official/deepseek-v4-flash",
      effort: null,
    });
  });

  describe("fillPendingComposerSelectionEffortFromEnginePref", () => {
    beforeEach(() => {
      getComposerEnginePrefForEngine.mockReset();
      getComposerEnginePrefForEngine.mockReturnValue({
        modelId: "grok-4.5",
        effort: "high",
        accessMode: null,
        collaborationModeId: null,
        dshAgentPreset: null,
      });
    });

    it("fills null effort on a Grok pending thread from the engine pref", () => {
      expect(
        fillPendingComposerSelectionEffortFromEnginePref(
          { modelId: "grok-4.5", effort: null },
          "grok-pending-1",
        ),
      ).toEqual({ modelId: "grok-4.5", effort: "high" });
    });

    it("does not override an explicit effort on the pending thread", () => {
      expect(
        fillPendingComposerSelectionEffortFromEnginePref(
          { modelId: "grok-4.5", effort: "low" },
          "grok-pending-1",
        ),
      ).toEqual({ modelId: "grok-4.5", effort: "low" });
    });

    it("does not fill finalized threads or engines without effort prefs", () => {
      expect(
        fillPendingComposerSelectionEffortFromEnginePref(
          { modelId: "grok-4.5", effort: null },
          "grok:session-1",
        ),
      ).toEqual({ modelId: "grok-4.5", effort: null });

      getComposerEnginePrefForEngine.mockReturnValue({
        modelId: "gemini-2.5-pro",
        effort: "high",
        accessMode: null,
        collaborationModeId: null,
        dshAgentPreset: null,
      });
      // gemini normalizes effort away; fill still runs only when prefEffort is truthy
      // but normalize strips unsupported effort → stays null for model-only selection.
      expect(
        fillPendingComposerSelectionEffortFromEnginePref(
          { modelId: "gemini-2.5-pro", effort: null },
          "gemini-pending-1",
        ),
      ).toEqual({ modelId: "gemini-2.5-pro", effort: null });
    });

    it("does not invent effort when the engine pref effort is also null", () => {
      getComposerEnginePrefForEngine.mockReturnValue({
        modelId: "grok-4.5",
        effort: null,
        accessMode: null,
        collaborationModeId: null,
        dshAgentPreset: null,
      });
      expect(
        fillPendingComposerSelectionEffortFromEnginePref(
          { modelId: "grok-4.5", effort: null },
          "grok-pending-1",
        ),
      ).toEqual({ modelId: "grok-4.5", effort: null });
    });
  });

  describe("seedDshComposerSelectionFromHost", () => {
    it("writes a trusted host catalog id onto an empty DSH ledger", () => {
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: "gork-zhu/grok-4.6",
          effort: "low",
        }),
      ).toBe(true);
      expect(
        composerStore["selectedModelByThread.ws-a:dsh:session-1"],
      ).toEqual({
        modelId: "gork-zhu/grok-4.6",
        effort: "low",
      });
    });

    it("does not overwrite a trusted existing DSH ledger", () => {
      composerStore["selectedModelByThread.ws-a:dsh:session-1"] = {
        modelId: "acme/deepseek-v4-flash",
        effort: null,
      };
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: "gork-zhu/grok-4.6",
        }),
      ).toBe(false);
      expect(
        composerStore["selectedModelByThread.ws-a:dsh:session-1"],
      ).toEqual({
        modelId: "acme/deepseek-v4-flash",
        effort: null,
      });
    });

    it("replaces an untrusted leftover ledger", () => {
      composerStore["selectedModelByThread.ws-a:dsh:session-1"] = {
        modelId: "gpt-5.5",
        effort: null,
      };
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: "gork-zhu/grok-4.6",
        }),
      ).toBe(true);
      expect(
        composerStore["selectedModelByThread.ws-a:dsh:session-1"],
      ).toEqual({
        modelId: "gork-zhu/grok-4.6",
        effort: null,
      });
    });

    it("rejects reserved mossx providers and non-dsh threads", () => {
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: "ccgui/grok-4.5",
        }),
      ).toBe(false);
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "codex:session-1",
          catalogId: "gork-zhu/grok-4.6",
        }),
      ).toBe(false);
    });

    it("refreshes the host effort when the ledger model matches and effort differs", () => {
      composerStore["selectedModelByThread.ws-a:dsh:session-1"] = {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: "low",
      };
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: "deepseek-official/deepseek-v4-flash",
          effort: "max",
        }),
      ).toBe(true);
      expect(
        composerStore["selectedModelByThread.ws-a:dsh:session-1"],
      ).toEqual({
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: "max",
      });
    });

    it("keeps the ledger effort when the host has no effort to restore", () => {
      composerStore["selectedModelByThread.ws-a:dsh:session-1"] = {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: "low",
      };
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: "deepseek-official/deepseek-v4-flash",
          effort: null,
        }),
      ).toBe(false);
      expect(
        composerStore["selectedModelByThread.ws-a:dsh:session-1"],
      ).toEqual({
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: "low",
      });
    });

    it("does not use the global DSH engine pref as a restore source", () => {
      getComposerEnginePrefForEngine.mockReturnValue({
        modelId: "other-dsh/other-model",
        effort: "high",
        accessMode: null,
        collaborationModeId: null,
        dshAgentPreset: null,
      });
      expect(
        seedDshComposerSelectionFromHost({
          workspaceId: "ws-a",
          threadId: "dsh:session-1",
          catalogId: null,
        }),
      ).toBe(false);
      expect(
        composerStore["selectedModelByThread.ws-a:dsh:session-1"],
      ).toBeUndefined();
    });
  });
});

describe("D5 裁决守卫：thread-id 迁移不得覆盖目标线程已有账本", () => {
  it("目标已有 selection 时拒绝迁移（canonical 匹配也不覆盖）", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex-pending-1",
        activeThreadId: "codex:real-1",
        previousSessionKey: "k-prev",
        activeSessionKey: "k-active",
        hasSourceSelection: true,
        hasTargetSelection: true,
        resolveCanonicalThreadId: (id: string) => id.replace("codex-pending-1", "codex:real-1"),
      }),
    ).toBe(false);
  });
});
