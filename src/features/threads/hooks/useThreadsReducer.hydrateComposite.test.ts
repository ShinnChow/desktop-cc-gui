// F4（fix-session-switch-jank-red-lines）：hydrate 元数据合批契约。
// 组合 action hydrateThreadHistorySnapshot 单次状态转移覆盖
// ensureThread → setThreadPlan → setThreadHistoryRestoredAt → setThreadHistoryWindow
// → setThreadTokenUsage，且终态必须与逐个细粒度 dispatch bit 级一致。
import { describe, expect, it } from "vitest";
import type { TurnPlan } from "../../../types";
import {
  createInitialThreadState,
  threadReducer,
  type ThreadAction,
} from "./useThreadsReducer";
import type { ThreadState } from "./threadReducerTypes";

const WORKSPACE_ID = "ws-1";
const THREAD_ID = "thread-1";

function buildHydrateAction(): Extract<
  ThreadAction,
  { type: "hydrateThreadHistorySnapshot" }
> {
  return {
    type: "hydrateThreadHistorySnapshot",
    workspaceId: WORKSPACE_ID,
    threadId: THREAD_ID,
    engine: "codex",
    plan: {
      steps: [{ id: "step-1", label: "Investigate", status: "in_progress" }],
    } as never,
    historyRestoredAtMs: 1_234,
    historyHasMore: true,
    historyNextCursor: "cursor-1",
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      contextUsedTokens: 120,
    } as never,
  };
}

function applySequentialActions(
  state: ThreadState,
  overrides?: { plan?: TurnPlan | null },
): ThreadState {
  const actions: ThreadAction[] = [
    {
      type: "ensureThread",
      workspaceId: WORKSPACE_ID,
      threadId: THREAD_ID,
      engine: "codex",
    },
    {
      type: "setThreadPlan",
      threadId: THREAD_ID,
      plan:
        overrides && overrides.plan !== undefined
          ? overrides.plan
          : (buildHydrateAction().plan ?? null),
    },
    {
      type: "setThreadHistoryRestoredAt",
      threadId: THREAD_ID,
      timestamp: 1_234,
    },
    {
      type: "setThreadHistoryWindow",
      threadId: THREAD_ID,
      hasMore: true,
      nextCursor: "cursor-1",
    },
    {
      type: "setThreadTokenUsage",
      threadId: THREAD_ID,
      tokenUsage: buildHydrateAction().tokenUsage as never,
    },
  ];
  return actions.reduce(threadReducer, state);
}

describe("threadReducer hydrateThreadHistorySnapshot 合批", () => {
  it("单次转移覆盖 ensure + plan + restoredAt + window + tokenUsage", () => {
    const state = threadReducer(
      createInitialThreadState(),
      buildHydrateAction(),
    );

    expect(
      state.threadsByWorkspace[WORKSPACE_ID]?.map((thread) => thread.id),
    ).toContain(THREAD_ID);
    expect(state.planByThread[THREAD_ID]).toEqual(buildHydrateAction().plan);
    expect(state.historyRestoredAtMsByThread[THREAD_ID]).toBe(1_234);
    expect(state.historyWindowByThread[THREAD_ID]).toEqual({
      hasMore: true,
      nextCursor: "cursor-1",
    });
    expect(state.tokenUsageByThread[THREAD_ID]).toEqual(
      buildHydrateAction().tokenUsage,
    );
  });

  it("终态与逐个细粒度 dispatch bit 级一致", () => {
    const compositeState = threadReducer(
      createInitialThreadState(),
      buildHydrateAction(),
    );
    const sequentialState = applySequentialActions(createInitialThreadState());

    expect(compositeState).toEqual(sequentialState);
  });

  it("无 tokenUsage 时跳过该字段且其余字段照常生效", () => {
    const action = { ...buildHydrateAction(), tokenUsage: undefined };
    const state = threadReducer(createInitialThreadState(), action);

    expect(state.tokenUsageByThread[THREAD_ID]).toBeUndefined();
    expect(state.planByThread[THREAD_ID]).toEqual(action.plan);
    expect(state.historyWindowByThread[THREAD_ID]).toEqual({
      hasMore: true,
      nextCursor: "cursor-1",
    });
  });

  it("空 plan（null）与既有 setThreadPlan(null) 语义一致", () => {
    const action = { ...buildHydrateAction(), plan: null };
    const state = threadReducer(createInitialThreadState(), action);
    const sequentialState = applySequentialActions(createInitialThreadState(), {
      plan: null,
    });

    expect(state.planByThread[THREAD_ID]).toBeNull();
    expect(state).toEqual(sequentialState);
  });
});
