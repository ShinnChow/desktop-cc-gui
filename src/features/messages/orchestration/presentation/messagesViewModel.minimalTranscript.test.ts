import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../../types";
import { resolveCollapsedTimelineItems } from "./messagesViewModel";

function user(id: string, text = "你好"): ConversationItem {
  return { id, kind: "message", role: "user", text };
}

function assistant(
  id: string,
  text: string,
  isFinal = false,
): ConversationItem {
  return { id, kind: "message", role: "assistant", text, isFinal };
}

function reasoning(id: string, content = "thinking"): ConversationItem {
  return { id, kind: "reasoning", summary: content, content };
}

function tool(
  id: string,
  status: "running" | "completed" = "completed",
  durationMs?: number,
): ConversationItem {
  return {
    id,
    kind: "tool",
    toolType: "fileRead",
    title: "Read foo.ts",
    detail: "foo.ts",
    status,
    output: "",
    durationMs,
  };
}

function ids(result: { timelineItems: ConversationItem[] }): string[] {
  return result.timelineItems.map((item) => item.id);
}

function contextEvent(
  turnId: string,
): ConversationItem {
  return {
    id: `context-compacted-${turnId}`,
    kind: "context-event",
    eventType: "compacted",
    reason: "threshold",
    tokensBefore: 236_505,
    estimatedTokensAfter: 41_200,
    turnId,
    timestampMs: 1_000,
  };
}

describe("resolveCollapsedTimelineItems minimal transcript mode", () => {
  it("keeps interstitial prose visible when the flag is off (default isolation)", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      tool("t1", "completed", 1_000),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      assistant("a2", "最终答案", true),
      user("u2"),
      assistant("a3", "第二轮答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      timelineSourceItems: items,
    });

    // 默认模式：per-phase 折叠，中间叙述 a1 保留在时间线；a3 上方无过程不产 chip。
    expect(ids(result)).toEqual(["u1", "a1", "a2", "u2", "a3"]);
    expect(result.phases.map((phase) => phase.phaseKey)).toEqual(["a1", "a2"]);
  });

  it("folds a completed turn's process and interstitial prose into a single turn chip", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      tool("t1", "completed", 1_000),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      tool("t2"),
      assistant("a2", "最终答案", true),
      user("u2"),
      assistant("a3", "第二轮答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 完成 turn：只剩最终答案；过程与中间叙述全部 hard-unmount。
    expect(ids(result)).toEqual(["u1", "a2", "u2", "a3"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "turn:a2",
      assistantItemId: "a2",
      insertBeforeItemId: "r1",
      expanded: false,
      durationMs: 1_000,
      hiddenItemIds: ["r1", "t1", "a1", "r2", "t2"],
      breakdown: {
        reasoningCount: 2,
        toolCount: 2,
        exploreCount: 0,
        proseCount: 1,
      },
    });
  });

  it("never anchors the turn chip on a compaction marker and keeps the marker visible", () => {
    // 回归（2026-08-27 用户反馈）：pi compaction_end 先于 settle 入库留痕，
    // 若留痕参与 prose 竞选，真实回答会被折进 chip、幕布只剩留痕。
    const items = [
      user("u1"),
      tool("t1", "completed", 1_000),
      assistant("a1", "真实回答", true),
      contextEvent("turn-1"),
      user("u2"),
      assistant("a2", "第二轮回答", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "pi",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 锚点必须是真实回答 a1；留痕按时间线原位保持可见（a1 之后）且不折进 chip。
    expect(ids(result)).toEqual([
      "u1",
      "a1",
      "context-compacted-turn-1",
      "u2",
      "a2",
    ]);
    const turnPhase = result.phases.find(
      (phase) => phase.phaseKey === "turn:a1",
    );
    expect(turnPhase).toBeDefined();
    expect(turnPhase?.assistantItemId).toBe("a1");
    expect(turnPhase?.hiddenItemIds).toEqual(["t1"]);
  });

  it("anchors on the last visible assistant prose when no prose is final and a marker trails", () => {
    const items = [
      user("u1"),
      assistant("a1", "中间叙述"),
      assistant("a2", "最终回答"),
      contextEvent("turn-1"),
      user("u2"),
      assistant("a3", "第二轮回答", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "pi",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(ids(result)).toEqual([
      "u1",
      "a2",
      "context-compacted-turn-1",
      "u2",
      "a3",
    ]);
    const turnPhase = result.phases.find(
      (phase) => phase.phaseKey === "turn:a2",
    );
    expect(turnPhase).toBeDefined();
    expect(turnPhase?.assistantItemId).toBe("a2");
    expect(turnPhase?.hiddenItemIds).toEqual(["a1"]);
  });

  it("renders an expanded turn chip with default-mode per-phase folding", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      tool("t1"),
      assistant("a2", "最终答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      expandedPhaseKeys: new Set(["turn:a2"]),
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 外层 chip 保持渲染；turn 内部按默认模式 per-phase 折叠：过程行 unmount，
    // 中间叙述 prose 保持可见。
    expect(ids(result)).toEqual(["u1", "a1", "a2"]);
    expect(result.phases).toHaveLength(3);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "turn:a2",
      expanded: true,
      insertBeforeItemId: "a1",
    });
    expect(result.phases[1]).toMatchObject({ phaseKey: "a1", expanded: false });
    expect(result.phases[2]).toMatchObject({ phaseKey: "a2", expanded: false });
  });

  it("lets inner per-phase chips expand independently inside an expanded turn", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      tool("t1"),
      assistant("a2", "最终答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      expandedPhaseKeys: new Set(["turn:a2", "a1"]),
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 内层 a1 chip 展开 → r1 remount；a2 chip 仍折叠 → t1 保持 unmount。
    expect(ids(result)).toEqual(["u1", "r1", "a1", "a2"]);
    expect(result.phases[1]).toMatchObject({ phaseKey: "a1", expanded: true });
    expect(result.phases[2]).toMatchObject({ phaseKey: "a2", expanded: false });
  });

  it("emits no inner per-phase chips while the turn chip stays collapsed", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      tool("t1"),
      assistant("a2", "最终答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(ids(result)).toEqual(["u1", "a2"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "turn:a2",
      expanded: false,
    });
  });

  it("folds settled content of the active streaming turn into a live turn chip", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "生长中的叙述"),
      reasoning("r2"),
      tool("t1", "running"),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 活跃 turn：a1 之前的过程 r1 折进 live chip；a1 与尾部窗口（≤4）保持可见。
    expect(ids(result)).toEqual(["u1", "a1", "r2", "t1"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "liveturn:u1",
      assistantItemId: "a1",
      insertBeforeItemId: "r1",
      expanded: false,
      hiddenItemIds: ["r1"],
      breakdown: { reasoningCount: 1, proseCount: 0 },
    });
  });

  it("folds interstitial prose of the streaming turn and counts it", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      tool("t1"),
      assistant("a2", "生长中的回答"),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 生长中的 a2 保持可见，此前过程与中间叙述全部 hard-unmount 进单个 live chip。
    expect(ids(result)).toEqual(["u1", "a2"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "liveturn:u1",
      assistantItemId: "a2",
      hiddenItemIds: ["r1", "a1", "r2", "t1"],
      breakdown: { reasoningCount: 2, toolCount: 1, proseCount: 1 },
    });
  });

  it("keeps the streaming trailing window visible at the minimal threshold of 4", () => {
    const fourEntries = [
      user("u1"),
      reasoning("r1"),
      tool("t1", "running"),
      reasoning("r2"),
      tool("t2", "running"),
    ];
    const visible = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: fourEntries,
    });
    // 无 prose 且 entry 数 = 4（未超阈值）：全可见、无 chip。
    expect(visible.phases).toEqual([]);
    expect(ids(visible)).toEqual(["u1", "r1", "t1", "r2", "t2"]);

    const fiveEntries = [
      user("u1"),
      reasoning("r1"),
      tool("t1"),
      reasoning("r2"),
      tool("t2"),
      reasoning("r3", "still running"),
    ];
    const folded = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: fiveEntries,
    });
    // 5 entries > 4：隐藏至仅剩尾部 3 条，chip 自锚第一个可见尾部 entry 之前。
    expect(ids(folded)).toEqual(["u1", "r2", "t2", "r3"]);
    expect(folded.phases).toHaveLength(1);
    expect(folded.phases[0]).toMatchObject({
      phaseKey: "liveturn:u1",
      assistantItemId: "liveturn:u1",
      insertBeforeItemId: "r1",
      collapsedAnchorItemId: "r2",
      hiddenItemIds: ["r1", "t1"],
    });
  });

  it("merges the post-prose trailing overflow into the same live chip", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "生长中的叙述"),
      reasoning("r2"),
      tool("t1"),
      reasoning("r3"),
      tool("t2", "running"),
      reasoning("r4"),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // anchor 后 5 entries > 4：超出的 r2/t1 与 anchor 前的 r1 并入同一 live chip。
    expect(ids(result)).toEqual(["u1", "a1", "r3", "t2", "r4"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "liveturn:u1",
      assistantItemId: "a1",
      hiddenItemIds: ["r1", "r2", "t1"],
      breakdown: { reasoningCount: 2, toolCount: 1, proseCount: 0 },
    });
  });

  it("produces no chip for a streaming turn with a single growing prose", () => {
    const items = [user("u1"), reasoning("r1"), assistant("a1", "生长中")];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // r1 折进 live chip、a1 可见；若完全没有过程则连 chip 都不产。
    expect(ids(result)).toEqual(["u1", "a1"]);
    expect(result.phases.map((phase) => phase.phaseKey)).toEqual(["liveturn:u1"]);

    const proseOnly = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: [user("u1"), assistant("a1", "生长中"), reasoning("r0")],
    });
    expect(ids(proseOnly)).toEqual(["u1", "a1", "r0"]);
    expect(proseOnly.phases).toEqual([]);
  });

  it("keeps an expanded live chip expanded when the turn completes", () => {
    const streamingItems = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      assistant("a2", "生长中的回答"),
    ];
    const streaming = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      expandedPhaseKeys: new Set(["liveturn:u1"]),
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: streamingItems,
    });
    // 展开态：外层 live chip 保持渲染，内层按默认模式 per-phase 折叠。
    expect(ids(streaming)).toEqual(["u1", "a1", "a2"]);
    expect(streaming.phases[0]).toMatchObject({
      phaseKey: "liveturn:u1",
      expanded: true,
      insertBeforeItemId: "a1",
    });

    const completedItems = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      assistant("a2", "最终答案", true),
    ];
    const completed = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      expandedPhaseKeys: new Set(["liveturn:u1"]),
      isThinking: false,
      minimalTranscriptEnabled: true,
      timelineSourceItems: completedItems,
    });
    // 完成瞬间：liveturn: 展开态迁移到 turn: chip，不突然折回；内层仍按
    // per-phase 折叠形态渲染。
    expect(ids(completed)).toEqual(["u1", "a1", "a2"]);
    expect(completed.phases[0]).toMatchObject({
      phaseKey: "turn:a2",
      expanded: true,
      insertBeforeItemId: "a1",
    });
  });

  it("produces no chip for a single-prose turn without process", () => {
    const items = [user("u1"), assistant("a1", "直接回答", true)];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(result.phases).toEqual([]);
    expect(ids(result)).toEqual(["u1", "a1"]);
  });

  it("never folds a turn without any visible prose", () => {
    const items = [
      user("u1"),
      tool("t1"),
      tool("t2"),
      user("u2"),
      assistant("a1", "答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 纯工具 turn 不折叠；单 prose turn 无 chip。
    expect(result.phases).toEqual([]);
    expect(ids(result)).toEqual(["u1", "t1", "t2", "u2", "a1"]);
  });

  it("folds each completed turn independently in multi-turn history", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "第一轮答案", true),
      user("u2"),
      reasoning("r2"),
      assistant("a2", "第二轮中间叙述"),
      reasoning("r3"),
      assistant("a3", "第二轮答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(ids(result)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(result.phases.map((phase) => phase.phaseKey)).toEqual([
      "turn:a1",
      "turn:a3",
    ]);
    expect(result.phases[1]).toMatchObject({
      hiddenItemIds: ["r2", "a2", "r3"],
      breakdown: { reasoningCount: 2, proseCount: 1 },
    });
  });
});
