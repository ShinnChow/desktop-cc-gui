// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRealtimePerfFlagCacheForTests,
  LIVE_TOOL_RENDER_BUDGET_FLAG_KEY,
  resetRealtimePerfFlags,
} from "../../../threads/utils/realtimePerfFlags";
import type { ConversationItem } from "../../../../types";
import { BashToolBlock } from "./BashToolBlock";

const failedCommandItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "bash-tool-1",
  kind: "tool",
  toolType: "commandExecution",
  title: "Command: npm run test",
  detail: '{"command":"npm run test"}',
  status: "failed",
  output: "Error: test failed",
};

// Prism bash 一定产生 token class 的命令行（string/builtin token）。
const highlightableOutput = 'echo "hello" && ls -la\n';

const runningHighlightItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "bash-live-highlight",
  kind: "tool",
  toolType: "commandExecution",
  title: "Command: echo hello",
  detail: '{"command":"echo hello"}',
  status: "processing",
  output: highlightableOutput,
};

// 长跑命令（durationMs ≥ 1200ms → isLongRunning 硬展开）。
const longRunningItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "bash-live-collapse",
  kind: "tool",
  toolType: "commandExecution",
  title: "Command: npm run scan",
  detail: '{"command":"npm run scan"}',
  status: "processing",
  output: "scanning ./node_modules ...\n",
  durationMs: 5000,
};

function queryHeader() {
  return screen.getByRole("button", { name: /npm run scan/ });
}

describe("BashToolBlock", () => {
  afterEach(() => {
    cleanup();
    resetRealtimePerfFlags();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("shows short terminal-command header without embedding full command", () => {
    render(
      <BashToolBlock
        item={failedCommandItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("tools.terminalCommand")).toBeTruthy();
    // Full command stays out of the collapsed header line.
    expect(screen.queryByText("npm run test")).toBeNull();
    const errorLine = screen.getByText("Error: test failed");
    expect(errorLine).toBeTruthy();
    expect(errorLine.className).toContain("bash-output-line-error");
  });

  it("shows command and output sections when expanded", () => {
    render(
      <BashToolBlock
        item={failedCommandItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("tools.commandLabel")).toBeTruthy();
    expect(screen.getByText("tools.outputLabel")).toBeTruthy();
    expect(screen.getByText("npm run test")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "messages.copy" }).length).toBeGreaterThan(0);
  });

  it("keeps short header when only output is available", () => {
    const outputOnlyItem: Extract<ConversationItem, { kind: "tool" }> = {
      id: "bash-tool-output-only",
      kind: "tool",
      toolType: "bash",
      title: "Bash",
      detail: "",
      status: "completed",
      output: "199\n",
    };
    render(
      <BashToolBlock
        item={outputOnlyItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("tools.terminalCommand")).toBeTruthy();
    // Collapsed completed output is hidden until expand (not long-running / not error).
    expect(screen.queryByText("199")).toBeNull();
  });

  it("shows bash toolType command only after expand", () => {
    const bashItem: Extract<ConversationItem, { kind: "tool" }> = {
      id: "bash-tool-json",
      kind: "tool",
      toolType: "bash",
      title: "Bash",
      detail: JSON.stringify({ command: "find src -type f | wc -l" }),
      status: "completed",
      output: "42\n",
    };
    const { rerender } = render(
      <BashToolBlock
        item={bashItem}
        isExpanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("tools.terminalCommand")).toBeTruthy();
    expect(screen.queryByText("find src -type f | wc -l")).toBeNull();

    rerender(
      <BashToolBlock
        item={bashItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("find src -type f | wc -l")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("keeps markdown-like output as raw text", () => {
    const markdownOutputItem: Extract<ConversationItem, { kind: "tool" }> = {
      ...failedCommandItem,
      id: "bash-tool-md",
      status: "completed",
      output: "## Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    };
    render(
      <BashToolBlock
        item={markdownOutputItem}
        isExpanded
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("## Title")).toBeTruthy();
    expect(screen.getByText("| A | B |")).toBeTruthy();
  });

  it("renders live output as plain text and re-highlights after settle", () => {
    const onToggle = vi.fn();
    const { rerender, container } = render(
      <BashToolBlock item={runningHighlightItem} isExpanded onToggle={onToggle} />,
    );

    // live 流式期：文本可见，但不做逐行 Prism tokenize。
    expect(screen.getByText('echo "hello" && ls -la')).toBeTruthy();
    expect(container.querySelectorAll(".token")).toHaveLength(0);

    // settle 后恢复带高亮渲染。
    rerender(
      <BashToolBlock
        item={{ ...runningHighlightItem, status: "completed", durationMs: 500 }}
        isExpanded
        onToggle={onToggle}
      />,
    );
    expect(container.querySelectorAll(".token").length).toBeGreaterThan(0);
  });

  it("keeps live highlighting when the render budget flag is off", () => {
    window.localStorage.setItem(LIVE_TOOL_RENDER_BUDGET_FLAG_KEY, "off");
    __resetRealtimePerfFlagCacheForTests();
    const { container } = render(
      <BashToolBlock item={runningHighlightItem} isExpanded onToggle={vi.fn()} />,
    );
    expect(container.querySelectorAll(".token").length).toBeGreaterThan(0);
  });

  it("auto-expands long-running output and lets the user collapse it without touching the parent toggle", () => {
    const onToggle = vi.fn();
    render(
      <BashToolBlock item={longRunningItem} isExpanded={false} onToggle={onToggle} />,
    );

    // isLongRunning 自动展开。
    expect(screen.getByText("scanning ./node_modules ...")).toBeTruthy();

    // 用户点击 header → 折叠 live 输出，且不污染父层展开状态机。
    fireEvent.click(queryHeader());
    expect(screen.queryByText("scanning ./node_modules ...")).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();

    // 再次点击 → 恢复自动展开。
    fireEvent.click(queryHeader());
    expect(screen.getByText("scanning ./node_modules ...")).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps the user collapse intent across settle", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <BashToolBlock item={longRunningItem} isExpanded={false} onToggle={onToggle} />,
    );
    fireEvent.click(queryHeader());
    expect(screen.queryByText("scanning ./node_modules ...")).toBeNull();

    // settle（completed + durationMs 仍 ≥1200）后不因长跑条件弹回展开。
    rerender(
      <BashToolBlock
        item={{ ...longRunningItem, status: "completed" }}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );
    expect(screen.queryByText("scanning ./node_modules ...")).toBeNull();

    // 用户再次点击恢复展开（settle 后 Prism 会把文本 tokenize 打碎，
    // 用 textContent 断言完整输出）。
    fireEvent.click(queryHeader());
    const outputBlock = document.querySelector(".bash-output-block");
    expect(outputBlock?.textContent).toContain("scanning ./node_modules ...");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("does not hijack the parent toggle while externally expanded", () => {
    const onToggle = vi.fn();
    render(
      <BashToolBlock item={longRunningItem} isExpanded onToggle={onToggle} />,
    );
    fireEvent.click(queryHeader());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
