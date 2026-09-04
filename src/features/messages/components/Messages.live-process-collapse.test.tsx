// @vitest-environment jsdom
import {
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

// History collapsing ships effectively disabled in production (window = 10000).
// These behavior tests exercise the collapse/expand logic at its original
// threshold; only the three >30-item cases below are affected.
vi.mock("../utils/messagesRenderUtils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/messagesRenderUtils")>();
  return {
    ...actual,
    VISIBLE_MESSAGE_WINDOW: 30,
  };
});

describe("Messages live behavior", () => {
  it("collapses only the causal process run above assistant prose", () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-collapse",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-live-collapse",
        kind: "reasoning",
        summary: "分析中",
        content: "thinking body",
      },
      {
        id: "tool-live-collapse",
        kind: "tool",
        toolType: "fileRead",
        title: "Read causal.ts",
        detail: "causal.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-live-collapse",
        kind: "message",
        role: "assistant",
        text: "最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const chip = container.querySelector(".messages-process-phase-toggle");
    expect(chip).toBeTruthy();
    expect(chip?.classList.contains("is-collapsed")).toBe(true);
    // Hard-unmount: process body is not in the tree while collapsed.
    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").not.toContain("Read causal.ts");
    expect(container.textContent ?? "").toContain("最终输出");
    expect(container.textContent ?? "").toContain("思考 1 次");
    expect(container.textContent ?? "").toContain("工具调用 1 次");
    expect(container.textContent ?? "").not.toContain("已处理");
  });

  it("collapses a single process step including lone reasoning into the chip", () => {
    const toolItems: ConversationItem[] = [
      {
        id: "user-single-step",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "tool-single",
        kind: "tool",
        toolType: "fileRead",
        title: "Read single.ts",
        detail: "single.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-single",
        kind: "message",
        role: "assistant",
        text: "单步输出",
      },
    ];

    const { container: toolContainer } = render(
      <Messages
        items={toolItems}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      toolContainer.querySelector(".messages-process-phase-toggle"),
    ).toBeTruthy();
    expect(toolContainer.textContent ?? "").toContain("工具调用 1 次");
    expect(toolContainer.textContent ?? "").not.toContain("已处理");
    expect(toolContainer.textContent ?? "").not.toContain("Read single.ts");
    expect(toolContainer.textContent ?? "").toContain("单步输出");

    const reasoningItems: ConversationItem[] = [
      {
        id: "user-reason-only",
        kind: "message",
        role: "user",
        text: "你是谁",
      },
      {
        id: "reason-alone",
        kind: "reasoning",
        summary: "分析身份",
        content: "thinking body",
      },
      {
        id: "assistant-reason-only",
        kind: "message",
        role: "assistant",
        text: "我是助手",
      },
    ];

    const { container: reasonContainer } = render(
      <Messages
        items={reasoningItems}
        threadId="thread-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      reasonContainer.querySelector(".messages-process-phase-toggle"),
    ).toBeTruthy();
    expect(reasonContainer.querySelector(".thinking-block")).toBeNull();
    expect(reasonContainer.textContent ?? "").toContain("思考 1 次");
    expect(reasonContainer.textContent ?? "").not.toContain("已处理");
    expect(reasonContainer.textContent ?? "").toContain("我是助手");
  });

  it("keeps trailing open process expanded after earlier multi-step phase collapsed", () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-trailing",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-done",
        kind: "reasoning",
        summary: "done",
        content: "done-thinking",
      },
      {
        id: "tool-done",
        kind: "tool",
        toolType: "fileRead",
        title: "Read done.ts",
        detail: "done.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-done",
        kind: "message",
        role: "assistant",
        text: "第一段输出",
      },
      {
        id: "tool-running",
        kind: "tool",
        toolType: "fileRead",
        title: "Read running.ts",
        detail: "running.ts",
        status: "running",
        output: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".messages-process-phase-toggle"),
    ).toBeTruthy();
    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").not.toContain("Read done.ts");
    expect(container.textContent ?? "").toContain("Read running.ts");
    expect(container.textContent ?? "").toContain("第一段输出");
  });

  it("does not show a phase chip for pure shell noise (pwd/ls stay off canvas)", () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-collapse-commands-only",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "tool-live-collapse-commands-only-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: pwd",
        detail: JSON.stringify({ command: "pwd" }),
        status: "completed",
        output: "/repo",
      },
      {
        id: "tool-live-collapse-commands-only-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls -la",
        detail: JSON.stringify({ command: "ls -la" }),
        status: "completed",
        output: "",
      },
      {
        id: "assistant-live-collapse-commands-only",
        kind: "message",
        role: "assistant",
        text: "最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".messages-live-middle-collapsed-indicator"),
    ).toBeNull();
    expect(container.textContent ?? "").toContain("最终输出");
    expect(container.textContent ?? "").not.toContain("pwd");
    expect(container.textContent ?? "").not.toContain("ls -la");
  });

  it("collapses the process phase above historical assistant prose", () => {
    const items: ConversationItem[] = [
      {
        id: "user-history-collapse",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-history-collapse",
        kind: "reasoning",
        summary: "分析中",
        content: "thinking",
      },
      {
        id: "tool-history-collapse",
        kind: "tool",
        toolType: "fileRead",
        title: "Read Messages.tsx",
        detail: "Messages.tsx",
        status: "completed",
        output: "",
        durationMs: 63_000,
      },
      {
        id: "assistant-history-collapse",
        kind: "message",
        role: "assistant",
        text: "历史最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").not.toContain("Read Messages.tsx");
    expect(container.textContent ?? "").toContain("历史最终输出");
    const indicator = container.querySelector(".messages-process-phase-toggle");
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent ?? "").toContain("思考 1 次");
    expect(indicator?.textContent ?? "").toContain("工具调用 1 次");
    expect(indicator?.textContent ?? "").not.toContain("已处理");
    expect(indicator?.textContent ?? "").not.toMatch(/\d+m\s*\d+s|\d+s/);
  });

  it("expands one causal phase when its process chip is clicked", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-history-expand",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-history-expand",
        kind: "reasoning",
        summary: "expand-me-reasoning",
        content: "expand-me-reasoning-body",
      },
      {
        id: "tool-history-expand",
        kind: "tool",
        toolType: "fileRead",
        title: "Read expand-me.ts",
        detail: "expand-me.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-history-expand",
        kind: "message",
        role: "assistant",
        text: "展开后可见过程",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeNull();
    const chip = container.querySelector(
      ".messages-process-phase-toggle",
    ) as HTMLButtonElement | null;
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chip!);

    await waitFor(() => {
      // Remount on expand (hard-unmount model).
      const expandedChip = container.querySelector(
        ".messages-process-phase-toggle.is-expanded",
      );
      expect(expandedChip).toBeTruthy();
      expect(expandedChip?.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector(".thinking-block")).toBeTruthy();
      expect(container.textContent ?? "").toMatch(/expand-me/);
    });
  });

  it("interleaves a process chip above each assistant segment in one turn", () => {
    const items: ConversationItem[] = [
      {
        id: "user-segmented",
        kind: "message",
        role: "user",
        text: "请分段处理",
      },
      {
        id: "tool-segment-1",
        kind: "tool",
        toolType: "fileRead",
        title: "Read first.ts",
        detail: "first.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-segment-1",
        kind: "message",
        role: "assistant",
        text: "第一段结论",
      },
      {
        id: "tool-segment-2a",
        kind: "tool",
        toolType: "fileRead",
        title: "Read second-a.ts",
        detail: "second-a.ts",
        status: "completed",
        output: "",
      },
      {
        id: "tool-segment-2b",
        kind: "tool",
        toolType: "fileRead",
        title: "Read second-b.ts",
        detail: "second-b.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-segment-2",
        kind: "message",
        role: "assistant",
        text: "第二段结论",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const chips = Array.from(
      container.querySelectorAll(".messages-process-phase-toggle"),
    );
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent ?? "").toContain("工具调用 1 次");
    expect(chips[1]?.textContent ?? "").toContain("工具调用 2 次");
    expect(container.textContent ?? "").not.toContain("Read first.ts");
    expect(container.textContent ?? "").not.toContain("Read second-a.ts");

    const surface = container.textContent ?? "";
    const chip1At = surface.indexOf("工具调用 1 次");
    const prose1At = surface.indexOf("第一段结论");
    const chip2At = surface.indexOf("工具调用 2 次");
    const prose2At = surface.indexOf("第二段结论");
    expect(chip1At).toBeGreaterThan(-1);
    expect(chip1At).toBeLessThan(prose1At);
    expect(prose1At).toBeLessThan(chip2At);
    expect(chip2At).toBeLessThan(prose2At);
  });

  it("collapses each historical turn phase independently", () => {
    const items: ConversationItem[] = [
      {
        id: "user-history-turn-1",
        kind: "message",
        role: "user",
        text: "第一个问题",
      },
      {
        id: "reasoning-history-turn-1",
        kind: "reasoning",
        summary: "第一轮分析",
        content: "turn-1-thinking",
      },
      {
        id: "tool-history-turn-1",
        kind: "tool",
        toolType: "fileRead",
        title: "Read turn1.ts",
        detail: "turn1.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-history-turn-1",
        kind: "message",
        role: "assistant",
        text: "第一轮答案",
      },
      {
        id: "user-history-turn-2",
        kind: "message",
        role: "user",
        text: "第二个问题",
      },
      {
        id: "reasoning-history-turn-2",
        kind: "reasoning",
        summary: "第二轮分析",
        content: "turn-2-thinking",
      },
      {
        id: "tool-history-turn-2",
        kind: "tool",
        toolType: "fileRead",
        title: "Read turn2.ts",
        detail: "turn2.ts",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-history-turn-2",
        kind: "message",
        role: "assistant",
        text: "第二轮答案",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent ?? "").toContain("第一轮答案");
    expect(container.textContent ?? "").toContain("第二轮答案");
    expect(
      container.querySelectorAll(".messages-process-phase-toggle"),
    ).toHaveLength(2);
    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").not.toContain("Read turn1.ts");
    expect(container.textContent ?? "").not.toContain("Read turn2.ts");
  });
});
