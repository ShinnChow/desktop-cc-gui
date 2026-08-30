/** @vitest-environment jsdom */

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Messages } from "./Messages";
import {
  applyBackgroundTaskUpdate,
  resetBackgroundTaskStoreForTests,
} from "../utils/backgroundTaskStore";

describe("Messages background-task awaiting", () => {
  afterEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("shows the PI conversation tail when a scoped task starts", () => {
    const view = render(
      <Messages
        items={[]}
        threadId="background-awaiting-thread"
        workspaceId="background-awaiting-workspace"
        isThinking={false}
        activeEngine="pi"
        processingStartedAt={null}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    act(() => {
      applyBackgroundTaskUpdate(
        "background-awaiting-workspace",
        "background-awaiting-thread",
        {
          toolId: "background-awaiting-tool",
          source: "notification",
          task: { id: "background-awaiting-task", status: "running" },
        },
      );
    });

    const curtain = view.container.querySelector(
      '[data-background-task-awaiting="true"]',
    );
    expect(curtain).not.toBeNull();
    // 幕布标签必须携带 running count（spec：正在等待 N 个后台任务完成）。
    const tailText =
      curtain?.parentElement?.textContent ?? curtain?.textContent ?? "";
    expect(tailText).toContain("正在等待 1 个后台任务完成");
    expect(tailText).toContain("任务完成后主对话将自动继续");
    view.unmount();
  });

  it("does not affect a non-PI conversation", () => {
    const view = render(
      <Messages
        items={[]}
        threadId="background-awaiting-thread"
        workspaceId="background-awaiting-workspace"
        isThinking={false}
        activeEngine="claude"
        processingStartedAt={null}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    act(() => {
      applyBackgroundTaskUpdate(
        "background-awaiting-workspace",
        "background-awaiting-thread",
        {
          toolId: "background-awaiting-tool",
          source: "notification",
          task: { id: "background-awaiting-task", status: "running" },
        },
      );
    });

    expect(
      view.container.querySelector('[data-background-task-awaiting="true"]'),
    ).toBeNull();
    view.unmount();
  });
});
