/**
 * 全真实链路集成测试（真 store + 真 buildConversationItem + 真 reducer 合并 +
 * 真 watcher hook，仅 mock readFile）：
 * receipt 建卡（running 快照）→ 任务被 kill（registry metadata killed，无通知
 * ——被 kill 的任务不发 <background-task-notification>）→ watcher probe →
 * sink 全路径 → 时间线卡片 item 的 output 必须翻成 killed 快照。
 * 背景：2026-08-28 真机「并行双 pi 会话」场景卡片永停运行中（pill 已终态）。
 */
/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  applyBackgroundTaskUpdate,
  listBackgroundTasks,
  resetBackgroundTaskStoreForTests,
  setBackgroundTaskUpdateSink,
} from "./backgroundTaskStore";
import { useBackgroundTaskRegistryWatcherForRunningThreads } from "./useBackgroundTaskRegistryWatcher";
import { BackgroundTaskCard } from "../rows/components/BackgroundTaskCard";
import { buildConversationItem } from "../../../utils/threadItems";
import {
  initialState,
  threadReducer,
} from "../../threads/hooks/useThreadsReducer";

const WS = "ws-parallel";
const THREAD = "pi:01a045ee";

const KILLED_REGISTRY_JSON = JSON.stringify({
  id: "b522a07e6",
  name: "task1-sleep60",
  command: 'sleep 60 && echo "task1 done"',
  status: "killed",
  outputPath: ".pi/tasks/session-45015-45015/b522a07e6.output",
  cwd: "/Users/chenxiangning/code/AI/reach/ai-reach",
  startTime: 1787882417652,
  endTime: 1787882426631,
  exitCode: null,
  pid: 48169,
});

function upsertViaRealPipeline(state: any, rawItem: Record<string, unknown>) {
  // 与 useThreadItemEvents.handleItemUpdate 同构：buildConversationItem → upsertItem。
  const converted = buildConversationItem(rawItem);
  expect(converted).toBeTruthy();
  return threadReducer(state, {
    type: "upsertItem",
    workspaceId: WS,
    threadId: THREAD,
    item: converted!,
    hasCustomName: false,
  });
}

describe("background task killed terminal round-trip (真实管线)", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("watcher 经 sink 把 killed 快照写进时间线卡片 item（卡片应折叠）", async () => {
    // 1) item/started 建卡（receipt 前占位，output 为空）。
    let state = threadReducer(initialState, {
      type: "ensureThread",
      workspaceId: WS,
      threadId: THREAD,
      engine: "pi",
    });
    state = upsertViaRealPipeline(state, {
      id: "call_a8ca821af3d84629a7dd094c",
      type: "backgroundTask",
      tool: "bg_run",
      title: "bg_run",
      input: { name: "task1-sleep60", command: "sleep 60" },
    });

    // 2) receipt 到达：store 迁移到 taskId key + 时间线写入 running 快照。
    const receipt = applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "call_a8ca821af3d84629a7dd094c",
      task: {
        id: "b522a07e6",
        name: "task1-sleep60",
        status: "running",
        outputPath: ".pi/tasks/session-45015-45015/b522a07e6.output",
        pid: 48169,
      },
      source: "receipt",
    });
    expect(receipt).toBeTruthy();
    state = upsertViaRealPipeline(state, receipt!.item);
    expect(listBackgroundTasks(WS, THREAD)[0]?.task.status).toBe("running");

    // 3) watcher（真 hook）+ sink（由 useThreadItemEvents 同层注册的等价物）。
    const dispatched: any[] = [];
    setBackgroundTaskUpdateSink((_ws, _thread, payload) => {
      const result = applyBackgroundTaskUpdate(WS, THREAD, payload);
      if (!result) return;
      // 与 onBackgroundTaskUpdated 相同参数（D12：shouldMarkProcessing=false）。
      const converted = buildConversationItem(result.item);
      expect(converted).toBeTruthy();
      dispatched.push(converted);
    });
    const readFile = vi.fn(async () => ({
      content: KILLED_REGISTRY_JSON,
      truncated: false,
    }));

    renderHook(() =>
      useBackgroundTaskRegistryWatcherForRunningThreads({
        pollMs: 1000,
        staleAfterMs: 30000,
        readFile,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // 4) store 翻终态。
    expect(listBackgroundTasks(WS, THREAD)[0]?.task.status).toBe("killed");
    // 5) sink 收到终态合成 item，output 是 killed 快照。
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].kind).toBe("tool");
    expect(dispatched[0].status).toBe("killed");
    const snapshot = JSON.parse(dispatched[0].output);
    expect(snapshot.status).toBe("killed");

    // 6) reducer merge：existing（running 快照）+ incoming（killed 快照）。
    state = threadReducer(state, {
      type: "upsertItem",
      workspaceId: WS,
      threadId: THREAD,
      item: dispatched[0],
      hasCustomName: false,
    });
    const timelineItem = (state.itemsByThread[THREAD] as any[]).find(
      (item) => item.id === "call_a8ca821af3d84629a7dd094c",
    );
    expect(timelineItem?.status).toBe("killed");
    expect(JSON.parse(timelineItem?.output ?? "{}").status).toBe("killed");

    // 7) 渲染层：卡片按该 item 渲染应为折叠条（非活体卡）。
    render(
      <BackgroundTaskCard
        toolName="bg_run"
        task={JSON.parse(timelineItem?.output ?? "{}")}
        terminal
      />,
    );
    expect(screen.getByTestId("background-task-card-fold")).toBeTruthy();

    setBackgroundTaskUpdateSink(null);
  });
});
