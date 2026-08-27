import { describe, expect, it } from "vitest";
import {
  resolveThreadSelectionOnSwitch,
  type ThreadSelectionSwitchInput,
} from "./resolveThreadSelectionOnSwitch";
import type { ComposerSessionSelection } from "../selectedComposerSession";

function makeInput(
  overrides: Partial<ThreadSelectionSwitchInput> = {},
): ThreadSelectionSwitchInput {
  return {
    workspaceId: "ws-1",
    threadId: "claude:thread-a",
    storedSelection: { exists: false, value: null },
    cachedSelection: null,
    hasCacheEntry: false,
    forkParentThreadId: null,
    forkParentStoredSelection: null,
    draft: null,
    engineDefaultSelection: null,
    engineDefaultSelectionReady: true,
    enginePrefEffort: null,
    ...overrides,
  };
}

describe("resolveThreadSelectionOnSwitch · 切会话选择决策核心（Phase 1 特征契约）", () => {
  it("L1 持久账本优先：stored 存在 → 直接显示，不产生任何写入", () => {
    const stored: ComposerSessionSelection = {
      modelId: "claude-opus-4",
      effort: "high",
    };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        storedSelection: { exists: true, value: stored },
        cachedSelection: { modelId: "cache-stale", effort: null },
        hasCacheEntry: true,
      }),
    );
    expect(decision.display).toEqual(stored);
    expect(decision.writes).toEqual([]);
  });

  it("L2 内存 cache 兜底：store 未 ready 窗口写入过的 cache → 显示 cache 值", () => {
    const cached: ComposerSelection = { modelId: "kimi-k3", effort: "low" };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({ cachedSelection: cached, hasCacheEntry: true }),
    );
    expect(decision.display).toEqual(cached);
    expect(decision.writes).toEqual([]);
  });

  it("L3a Claude fork 继承：无自身候选 + fork parent 有账本 → 显示继承值并落盘", () => {
    const parentValue: ComposerSelection = {
      modelId: "claude-sonnet-4",
      effort: null,
    };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "claude-fork:abc123",
        forkParentThreadId: "claude:parent-1",
        forkParentStoredSelection: parentValue,
      }),
    );
    expect(decision.display).toEqual(parentValue);
    expect(decision.writes).toEqual([
      {
        kind: "thread-ledger",
        sessionKey: expect.any(String),
        value: parentValue,
        reason: "fork-inherit",
      },
    ]);
  });

  it("L3b draft carry：store miss + workspace 匹配 + 引擎门禁通过 → 应用并清 carry 标志", () => {
    const draftValue: ComposerSelection = { modelId: "grok-4", effort: null };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "grok-pending-new-1",
        draft: {
          value: draftValue,
          workspaceId: "ws-1",
          sourceThreadId: "grok:thread-prev",
          applyToNextThread: true,
        },
      }),
    );
    expect(decision.display).toEqual(draftValue);
    expect(decision.writes).toContainEqual(
      expect.objectContaining({
        kind: "thread-ledger",
        value: draftValue,
        reason: "draft-apply",
      }),
    );
    expect(decision.writes).toContainEqual({ kind: "clear-draft-apply-flag" });
  });

  it("L3b 引擎门禁拒绝：draft 源引擎与目标线程引擎不同 → 不应用（display=null，无写入）", () => {
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "claude-pending-new-1",
        draft: {
          value: { modelId: "grok-4", effort: null },
          workspaceId: "ws-1",
          sourceThreadId: "grok:thread-prev",
          applyToNextThread: true,
        },
      }),
    );
    expect(decision.display).toBeNull();
    expect(decision.writes).toEqual([]);
  });

  it("L3c engine default：仅 pending 线程 + 无候选 → 种入并落盘", () => {
    const engineDefault: ComposerSelection = {
      modelId: "pi-default",
      effort: "medium",
    };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "pi-pending-new-9",
        engineDefaultSelection: engineDefault,
        engineDefaultSelectionReady: true,
      }),
    );
    expect(decision.display).toEqual(engineDefault);
    expect(decision.writes).toEqual([
      {
        kind: "thread-ledger",
        sessionKey: expect.any(String),
        value: engineDefault,
        reason: "engine-default",
      },
    ]);
  });

  it("L3c 已定稿线程不种 engine default：display=null 且无写入", () => {
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "pi:real-history-thread",
        engineDefaultSelection: { modelId: "pi-default", effort: "medium" },
        engineDefaultSelectionReady: true,
      }),
    );
    expect(decision.display).toBeNull();
    expect(decision.writes).toEqual([]);
  });

  it("L3c engine default 未就绪时等待：不种入", () => {
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "pi-pending-new-9",
        engineDefaultSelection: { modelId: "pi-default", effort: "medium" },
        engineDefaultSelectionReady: false,
      }),
    );
    expect(decision.display).toBeNull();
    expect(decision.writes).toEqual([]);
  });

  it("L4 pending effort 回填：候选 effort=null + 引擎 pref 有档位 → 只补 effort 不动 model", () => {
    const cached: ComposerSelection = { modelId: "grok-4", effort: null };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "grok-pending-new-2",
        cachedSelection: cached,
        hasCacheEntry: true,
        enginePrefEffort: "high",
      }),
    );
    // 现状语义：fill 仅当 effort===null 时从 pref 取；model 不变
    expect(decision.display).toEqual({ modelId: "grok-4", effort: "high" });
  });

  it("无 activeThread（Home）：显示同 workspace 的 draft，无写入", () => {
    const draftValue: ComposerSelection = {
      modelId: "claude-opus-4",
      effort: null,
    };
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: null,
        draft: {
          value: draftValue,
          workspaceId: "ws-1",
          sourceThreadId: null,
          applyToNextThread: false,
        },
      }),
    );
    expect(decision.display).toEqual(draftValue);
    expect(decision.writes).toEqual([]);
  });

  it("跨 workspace 的 draft 不带入：display=null", () => {
    const decision = resolveThreadSelectionOnSwitch(
      makeInput({
        threadId: "grok-pending-new-3",
        draft: {
          value: { modelId: "grok-4", effort: null },
          workspaceId: "ws-OTHER",
          sourceThreadId: "grok:thread-prev",
          applyToNextThread: true,
        },
      }),
    );
    expect(decision.display).toBeNull();
    expect(decision.writes).toEqual([]);
  });
});

/** 本地别名，避免与决策核心类型耦合的测试内引用。 */
type ComposerSelection = ComposerSessionSelection;

// 2026-08-27: 与同目录 resolveThreadSelectionOnSwitch.ts 配对（重刷 LSP buffer）。
