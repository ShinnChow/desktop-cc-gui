// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_EXECUTION_OUTPUT_BUDGET,
  COMMAND_EXECUTION_OUTPUT_HEAD,
} from "./boundToolOutput";
import {
  appendLiveItemDelta,
  clearLiveItemDelta,
  clearLiveItemDeltaForItem,
  drainLiveItemDeltaTail,
  getLiveItemDeltaSnapshot,
  LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS,
  LIVE_TOOL_OUTPUT_DISPLAY_LINES,
  LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING,
  peekLiveItemDelta,
  peekLiveItemDeltaEntry,
  resetLiveItemDeltaChannelForTests,
  subscribeLiveItemDelta,
  takeLastLines,
} from "./liveItemDeltaChannel";
import {
  __resetRealtimePerfFlagCacheForTests,
  LIVE_TOOL_OUTPUT_STREAMING_TAIL_FLAG_KEY,
  resetRealtimePerfFlags,
} from "./realtimePerfFlags";

describe("liveItemDeltaChannel", () => {
  beforeEach(() => {
    resetLiveItemDeltaChannelForTests();
    resetRealtimePerfFlags();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    resetLiveItemDeltaChannelForTests();
    resetRealtimePerfFlags();
    __resetRealtimePerfFlagCacheForTests();
    vi.useRealTimers();
  });

  it("returns isFirst:true for the first delta of an item lane, false afterwards", () => {
    expect(appendLiveItemDelta("t1", "item-1", "reasoningContent", "先")).toEqual({
      isFirst: true,
    });
    expect(appendLiveItemDelta("t1", "item-1", "reasoningContent", "后")).toEqual({
      isFirst: false,
    });
  });

  it("returns isFirst:true again for a different lane or item", () => {
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    expect(appendLiveItemDelta("t1", "item-1", "reasoningSummary", "b")).toEqual({
      isFirst: true,
    });
    expect(appendLiveItemDelta("t1", "item-2", "reasoningContent", "c")).toEqual({
      isFirst: true,
    });
  });

  it("accumulates deltas within the same lane", () => {
    appendLiveItemDelta("t1", "item-1", "toolOutput", "chunk-1 ");
    appendLiveItemDelta("t1", "item-1", "toolOutput", "chunk-2 ");
    appendLiveItemDelta("t1", "item-1", "toolOutput", "chunk-3");
    expect(peekLiveItemDelta("t1", "item-1", "toolOutput")).toBe(
      "chunk-1 chunk-2 chunk-3",
    );
  });

  it("keeps lanes isolated from each other", () => {
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "content-");
    appendLiveItemDelta("t1", "item-1", "reasoningSummary", "summary-");
    appendLiveItemDelta("t1", "item-1", "toolOutput", "output-");
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "more");

    expect(peekLiveItemDelta("t1", "item-1", "reasoningContent")).toBe("content-more");
    expect(peekLiveItemDelta("t1", "item-1", "reasoningSummary")).toBe("summary-");
    expect(peekLiveItemDelta("t1", "item-1", "toolOutput")).toBe("output-");
    expect(peekLiveItemDelta("t1", "missing", "reasoningContent")).toBe("");
  });

  it("publishes the first delta immediately, then throttles with a trailing publish", () => {
    const listener = vi.fn();
    subscribeLiveItemDelta("t1", listener);

    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveItemDeltaSnapshot("t1").get("item-1:reasoningContent")).toBe("a");

    // 紧接着的累积只调度一次 trailing 发布。
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "b");
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "c");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveItemDeltaSnapshot("t1").get("item-1:reasoningContent")).toBe("a");

    vi.advanceTimersByTime(LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getLiveItemDeltaSnapshot("t1").get("item-1:reasoningContent")).toBe("abc");

    // 距上次发布已超过 cadence：下一条累积立即发布（leading）。
    vi.advanceTimersByTime(LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "d");
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLiveItemDeltaSnapshot("t1").get("item-1:reasoningContent")).toBe("abcd");

    // trailing 保证最后一次累积必发。
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "e");
    vi.advanceTimersByTime(LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS);
    expect(getLiveItemDeltaSnapshot("t1").get("item-1:reasoningContent")).toBe("abcde");
  });

  it("keeps peek authoritative even before the throttled publish fires", () => {
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "tail");
    expect(peekLiveItemDelta("t1", "item-1", "reasoningContent")).toBe("atail");
    expect(getLiveItemDeltaSnapshot("t1").get("item-1:reasoningContent")).toBe("a");
  });

  it("drains only the unpublished tail and clears the thread", () => {
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "shell");
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "-tail");
    appendLiveItemDelta("t1", "item-2", "toolOutput", "only-shell");

    const drained = drainLiveItemDeltaTail("t1");
    expect(drained).toEqual([
      { itemId: "item-1", lane: "reasoningContent", text: "-tail" },
    ]);
    expect(peekLiveItemDelta("t1", "item-1", "reasoningContent")).toBe("");
    expect(peekLiveItemDeltaEntry("t1", "item-1", "reasoningContent")).toBeNull();
    expect(drainLiveItemDeltaTail("t1")).toEqual([]);
  });

  it("notifies subscribers with an empty snapshot after drain", () => {
    const listener = vi.fn();
    subscribeLiveItemDelta("t1", listener);
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "b");
    listener.mockClear();

    drainLiveItemDeltaTail("t1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveItemDeltaSnapshot("t1").size).toBe(0);
  });

  it("notifies subscribers with an empty snapshot after clear", () => {
    const listener = vi.fn();
    subscribeLiveItemDelta("t1", listener);
    appendLiveItemDelta("t1", "item-1", "reasoningSummary", "s");
    listener.mockClear();

    clearLiveItemDelta("t1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveItemDeltaSnapshot("t1").size).toBe(0);
    // 再有 pending trailing 也不许复活条目。
    vi.advanceTimersByTime(LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS * 2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLiveItemDeltaSnapshot("t1").size).toBe(0);
  });

  it("clears a single item without touching other items", () => {
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    appendLiveItemDelta("t1", "item-1", "reasoningSummary", "b");
    appendLiveItemDelta("t1", "item-2", "toolOutput", "c");

    expect(clearLiveItemDeltaForItem("t1", "item-1")).toBe(true);
    expect(peekLiveItemDelta("t1", "item-1", "reasoningContent")).toBe("");
    expect(peekLiveItemDelta("t1", "item-1", "reasoningSummary")).toBe("");
    expect(peekLiveItemDelta("t1", "item-2", "toolOutput")).toBe("c");
    expect(clearLiveItemDeltaForItem("t1", "missing")).toBe(false);
  });

  it("keeps snapshot references stable between publishes and shares the empty map", () => {
    const emptyA = getLiveItemDeltaSnapshot("no-such-thread");
    const emptyB = getLiveItemDeltaSnapshot("another-missing");
    expect(emptyA).toBe(emptyB);

    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    const snapshot = getLiveItemDeltaSnapshot("t1");
    expect(getLiveItemDeltaSnapshot("t1")).toBe(snapshot);

    appendLiveItemDelta("t1", "item-1", "reasoningContent", "b");
    vi.advanceTimersByTime(LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS);
    const nextSnapshot = getLiveItemDeltaSnapshot("t1");
    expect(nextSnapshot).not.toBe(snapshot);
    expect(getLiveItemDeltaSnapshot("t1")).toBe(nextSnapshot);
  });

  it("unsubscribes listeners cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveItemDelta("t1", listener);
    unsubscribe();
    appendLiveItemDelta("t1", "item-1", "reasoningContent", "a");
    expect(listener).not.toHaveBeenCalled();
  });

  it("takeLastLines keeps the original text when under the cap", () => {
    expect(takeLastLines("a\nb\nc", 10)).toBe("a\nb\nc");
    expect(takeLastLines("a\nb\nc", 3)).toBe("a\nb\nc");
  });

  it("takeLastLines returns only the last N lines", () => {
    expect(takeLastLines("a\nb\nc", 2)).toBe("b\nc");
    const lines = Array.from({ length: LIVE_TOOL_OUTPUT_DISPLAY_LINES + 1 }, (_, i) => `L${i}`);
    const tailed = takeLastLines(lines.join("\n"), LIVE_TOOL_OUTPUT_DISPLAY_LINES);
    expect(tailed.split("\n")).toHaveLength(LIVE_TOOL_OUTPUT_DISPLAY_LINES);
    expect(tailed.startsWith("L1\n")).toBe(true);
    expect(tailed.endsWith(`L${LIVE_TOOL_OUTPUT_DISPLAY_LINES}`)).toBe(true);
  });

  it("bounds commandExecution toolOutput and keeps reasoning unbounded", () => {
    const head = "H".repeat(COMMAND_EXECUTION_OUTPUT_HEAD);
    const middle = "M".repeat(400_000);
    const tail = "T".repeat(80_000);
    appendLiveItemDelta("t1", "cmd-1", "toolOutput", `${head}${middle}${tail}`);
    appendLiveItemDelta("t1", "think-1", "reasoningContent", "R".repeat(300_000));

    const bounded = peekLiveItemDelta("t1", "cmd-1", "toolOutput");
    expect(bounded.length).toBeLessThanOrEqual(COMMAND_EXECUTION_OUTPUT_BUDGET);
    expect(bounded.startsWith(head)).toBe(true);
    expect(bounded).toMatch(/omitted \d+ chars/);
    expect(peekLiveItemDelta("t1", "think-1", "reasoningContent").length).toBe(300_000);
  });

  it("keeps drain prefix-stable after bounding commandExecution output", () => {
    const first = "S".repeat(1000);
    appendLiveItemDelta("t1", "cmd-1", "toolOutput", first, "commandExecution");
    appendLiveItemDelta(
      "t1",
      "cmd-1",
      "toolOutput",
      `${"X".repeat(400_000)}Y`.repeat(1),
      "commandExecution",
    );
    const peek = peekLiveItemDelta("t1", "cmd-1", "toolOutput");
    const entry = peekLiveItemDeltaEntry("t1", "cmd-1", "toolOutput");
    expect(entry).not.toBeNull();
    const drained = drainLiveItemDeltaTail("t1");
    expect(drained).toHaveLength(1);
    expect(`${first}${drained[0]?.text}`).toBe(peek);
  });

  it("publishes only the streaming display tail for commandExecution toolOutput", () => {
    const lines = Array.from(
      { length: LIVE_TOOL_OUTPUT_DISPLAY_LINES + 50 },
      (_, i) => `row-${i}`,
    );
    appendLiveItemDelta("t1", "cmd-1", "toolOutput", lines.join("\n"), "commandExecution");
    const snapshot = getLiveItemDeltaSnapshot("t1").get("cmd-1:toolOutput") ?? "";
    // live 流式期帽低于 settle 显示帽（published 快照只在流式期被订阅消费）。
    expect(snapshot.split("\n").length).toBe(LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING);
    expect(snapshot.startsWith("row-150\n")).toBe(true);
    expect(peekLiveItemDelta("t1", "cmd-1", "toolOutput").split("\n").length).toBe(
      LIVE_TOOL_OUTPUT_DISPLAY_LINES + 50,
    );
  });

  it("falls back to the settled display tail when the streaming tail flag is off", () => {
    window.localStorage.setItem(LIVE_TOOL_OUTPUT_STREAMING_TAIL_FLAG_KEY, "off");
    __resetRealtimePerfFlagCacheForTests();
    const lines = Array.from(
      { length: LIVE_TOOL_OUTPUT_DISPLAY_LINES + 50 },
      (_, i) => `row-${i}`,
    );
    appendLiveItemDelta("t1", "cmd-1", "toolOutput", lines.join("\n"), "commandExecution");
    const snapshot = getLiveItemDeltaSnapshot("t1").get("cmd-1:toolOutput") ?? "";
    expect(snapshot.split("\n").length).toBe(LIVE_TOOL_OUTPUT_DISPLAY_LINES);
    expect(snapshot.startsWith("row-50\n")).toBe(true);
  });

  it("does not apply the 256KiB command cap to fileChange live output", () => {
    const diff = "d".repeat(300_000);
    appendLiveItemDelta("t1", "diff-1", "toolOutput", diff, "fileChange");
    expect(peekLiveItemDelta("t1", "diff-1", "toolOutput")).toBe(diff);
    expect(getLiveItemDeltaSnapshot("t1").get("diff-1:toolOutput")).toBe(diff);
  });

  it("returns unbounded commandExecution toolOutput when the budget flag is off", () => {
    window.localStorage.setItem("ccgui.perf.toolOutputBudget", "off");
    __resetRealtimePerfFlagCacheForTests();
    const text = "z".repeat(COMMAND_EXECUTION_OUTPUT_BUDGET + 10_000);
    appendLiveItemDelta("t1", "cmd-1", "toolOutput", text, "commandExecution");
    expect(peekLiveItemDelta("t1", "cmd-1", "toolOutput")).toBe(text);
  });

  it("bounds a path-agnostic listing streamed in 4KiB chunks", () => {
    const line = "dir/file-0000.txt extra-padding-for-chunk-size\n";
    const listing = line.repeat(20_000);
    const chunkSize = 4 * 1024;
    for (let offset = 0; offset < listing.length; offset += chunkSize) {
      appendLiveItemDelta(
        "t1",
        "cmd-1",
        "toolOutput",
        listing.slice(offset, offset + chunkSize),
        "commandExecution",
      );
    }
    const peek = peekLiveItemDelta("t1", "cmd-1", "toolOutput");
    expect(peek.length).toBeLessThanOrEqual(COMMAND_EXECUTION_OUTPUT_BUDGET);
    expect(peek).toMatch(/omitted \d+ chars/);
    vi.advanceTimersByTime(LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS);
    const snapshot = getLiveItemDeltaSnapshot("t1").get("cmd-1:toolOutput") ?? "";
    expect(snapshot.split("\n").length).toBeLessThanOrEqual(LIVE_TOOL_OUTPUT_DISPLAY_LINES);
    expect(snapshot.length).toBeLessThanOrEqual(COMMAND_EXECUTION_OUTPUT_HEAD);
  });
});
