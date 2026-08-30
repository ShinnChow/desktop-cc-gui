// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundTaskCard,
  isTerminalBackgroundTaskStatus,
  type CanonicalBackgroundTask,
} from "./BackgroundTaskCard";

afterEach(() => {
  cleanup();
});

const runningTask: CanonicalBackgroundTask = {
  id: "b2e2f48ad",
  name: "spike-task",
  command: "sleep 3 && echo spike-done",
  status: "running",
  outputPath: ".pi/tasks/session-1-1/b2e2f48ad.output",
  startTime: Date.now() - 5_000,
  pid: 26137,
};

describe("isTerminalBackgroundTaskStatus", () => {
  it("recognizes terminal and non-terminal statuses", () => {
    expect(isTerminalBackgroundTaskStatus("completed")).toBe(true);
    expect(isTerminalBackgroundTaskStatus("failed")).toBe(true);
    expect(isTerminalBackgroundTaskStatus("killed")).toBe(true);
    expect(isTerminalBackgroundTaskStatus("running")).toBe(false);
    expect(isTerminalBackgroundTaskStatus(null)).toBe(false);
    expect(isTerminalBackgroundTaskStatus(undefined)).toBe(false);
  });
});

describe("BackgroundTaskCard live（运行中）", () => {
  it("renders the live card with task id, command and elapsed time", () => {
    const { getByTestId, getByText } = render(
      <BackgroundTaskCard
        toolName="bg_run"
        task={runningTask}
        terminal={false}
      />,
    );
    const card = getByTestId("background-task-card-live");
    expect(card.dataset.taskId).toBe("b2e2f48ad");
    expect(getByText("b2e2f48ad")).toBeTruthy();
    expect(getByText("sleep 3 && echo spike-done")).toBeTruthy();
    expect(getByText("bg_run")).toBeTruthy();
    // startTime 5 秒前 → elapsed 至少 00:05
    expect(getByText(/^00:0[5-9]$/)).toBeTruthy();
    // 运行中状态 pill 带 pulse 样式
    expect(
      card.querySelector(".message-agent-task-fold-status.is-running"),
    ).toBeTruthy();
  });

  it("falls back to tool input name/command before the receipt arrives", () => {
    const { getByTestId, getByText, queryByText } = render(
      <BackgroundTaskCard
        toolName="bg_run"
        input={{ name: "input-name", command: "npm run build" }}
        terminal={false}
      />,
    );
    const card = getByTestId("background-task-card-live");
    expect(card.dataset.taskId).toBeUndefined();
    expect(getByText("npm run build")).toBeTruthy();
    expect(getByText(/input-name/)).toBeTruthy();
    expect(queryByText("b2e2f48ad")).toBeNull();
    // 无 startTime：elapsed 停在 00:00
    expect(getByText("00:00")).toBeTruthy();
  });
});

describe("BackgroundTaskCard fold（终态原地折叠）", () => {
  const completedTask: CanonicalBackgroundTask = {
    ...runningTask,
    status: "completed",
    exitCode: 0,
    endTime: runningTask.startTime! + 3_000,
  };

  it("renders the fold row with duration and exit code", () => {
    const { getByTestId, queryByTestId } = render(
      <BackgroundTaskCard toolName="bg_run" task={completedTask} terminal />,
    );
    expect(queryByTestId("background-task-card-live")).toBeNull();
    const fold = getByTestId("background-task-card-fold");
    expect(fold.dataset.taskId).toBe("b2e2f48ad");
    const label = fold.querySelector(".message-agent-task-fold-label");
    expect(label?.textContent).toContain("exit 0");
    expect(label?.textContent).toContain("3s");
    expect(
      fold.querySelector(".message-agent-task-fold-status.is-completed"),
    ).toBeTruthy();
  });

  it("marks failed tasks with the error tone", () => {
    const failed: CanonicalBackgroundTask = {
      ...completedTask,
      status: "failed",
      exitCode: 137,
    };
    const { getByTestId } = render(
      <BackgroundTaskCard toolName="bg_run" task={failed} terminal />,
    );
    const fold = getByTestId("background-task-card-fold");
    expect(
      fold.querySelector(".message-agent-task-fold-status.is-error"),
    ).toBeTruthy();
    expect(
      fold.querySelector(".message-agent-task-fold-label")?.textContent,
    ).toContain("exit 137");
  });

  it("expands kv rows on chevron click and exposes the log action", () => {
    const onOpenLog = vi.fn();
    const { getByTestId, getByText } = render(
      <BackgroundTaskCard
        toolName="bg_run"
        task={completedTask}
        terminal
        onOpenLog={onOpenLog}
      />,
    );
    const toggle = getByTestId("background-task-card-fold").querySelector(
      "button",
    );
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    // kv：taskId / command / outputPath 原值可见
    expect(getByText("b2e2f48ad")).toBeTruthy();
    expect(getByText("sleep 3 && echo spike-done")).toBeTruthy();
    expect(getByText(".pi/tasks/session-1-1/b2e2f48ad.output")).toBeTruthy();
    const logButton = document.querySelector(".background-task-card-log-link");
    expect(logButton).toBeTruthy();
    fireEvent.click(logButton!);
    expect(onOpenLog).toHaveBeenCalledWith(completedTask);
  });

  it("hides the log action when outputPath or handler is missing", () => {
    const noOutput: CanonicalBackgroundTask = {
      id: "b_noout",
      status: "completed",
      exitCode: 0,
    };
    const { getByTestId, queryByText } = render(
      <BackgroundTaskCard
        toolName="bg_run"
        task={noOutput}
        terminal
        onOpenLog={vi.fn()}
      />,
    );
    fireEvent.click(
      getByTestId("background-task-card-fold").querySelector("button")!,
    );
    expect(document.querySelector(".background-task-card-log-link")).toBeNull();
    expect(queryByText("b_noout")).toBeTruthy();
  });

  it("shows the notification summary row when completionText is present (实时/历史同源)", () => {
    // pi 终态通知的 `<summary>` 清洗文本随快照走：实时（store/时间线 upsert）
    // 与历史（toolOutput 合并）两侧都渲染同一行，幕布对齐不另起气泡。
    const withSummary: CanonicalBackgroundTask = {
      ...completedTask,
      completionText: "Hello world 5s",
    };
    const first = render(
      <BackgroundTaskCard toolName="bg_run" task={withSummary} terminal />,
    );
    fireEvent.click(
      first.getByTestId("background-task-card-fold").querySelector("button")!,
    );
    expect(first.getByText("Hello world 5s")).toBeTruthy();
    first.unmount();

    // 无 completionText 时不渲染 summary 行。
    const second = render(
      <BackgroundTaskCard toolName="bg_run" task={completedTask} terminal />,
    );
    fireEvent.click(
      second.getByTestId("background-task-card-fold").querySelector("button")!,
    );
    expect(second.queryByText("Hello world 5s")).toBeNull();
  });
});
