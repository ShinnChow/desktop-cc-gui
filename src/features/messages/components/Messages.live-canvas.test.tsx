// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ConversationItem } from "../../../types";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
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
  it("keeps only the latest title-only reasoning row for gemini and shows tool activity in the working indicator", () => {
    const items: ConversationItem[] = [
      {
        id: "user-gemini-title-only",
        kind: "message",
        role: "user",
        text: "索引仓库",
      },
      {
        id: "reasoning-title-only-old",
        kind: "reasoning",
        summary: "Planning old step",
        content: "",
      },
      {
        id: "reasoning-title-only",
        kind: "reasoning",
        summary: "Indexing workspace",
        content: "",
      },
      {
        id: "tool-after-reasoning",
        kind: "tool",
        title: "Command: rg --files",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "",
        status: "running",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="gemini"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    // Working bar: spinner + timer + fixed status + tool activity; no reasoning first-line echo.
    expect(container.querySelector(".working")).toBeTruthy();
    expect(
      container.querySelector(".working-text")?.textContent ?? "",
    ).toContain("响应中");
    expect(
      container.querySelector(".working-activity")?.textContent ?? "",
    ).toContain("Command: rg --files");
    expect(
      container.querySelector(".working-activity")?.textContent ?? "",
    ).not.toContain("Indexing workspace");
    const reasoningRows = container.querySelectorAll(".thinking-block");
    expect(reasoningRows.length).toBe(1);
    expect(container.querySelector(".thinking-title")).toBeTruthy();
  });

  it("keeps the latest Claude title-only reasoning row on the curtain before the first assistant chunk", () => {
    const items: ConversationItem[] = [
      {
        id: "user-claude-reasoning-visible",
        kind: "message",
        role: "user",
        text: "帮我分析一下项目结构",
      },
      {
        id: "reasoning-claude-old",
        kind: "reasoning",
        summary: "先定位仓库入口",
        content: "",
      },
      {
        id: "reasoning-claude-latest",
        kind: "reasoning",
        summary: "这是一个包含多个子项目的目录。让我探索一下项目结构。",
        content: "",
      },
      {
        id: "tool-claude-read-old",
        kind: "tool",
        title: "批量读取2个文件",
        detail: "package.json pyproject.toml",
        toolType: "read",
        output: "",
        status: "completed",
      },
      {
        id: "tool-claude-read-latest",
        kind: "tool",
        title: "批量读取4个文件",
        detail: "AGENTS.md next.config.ts README.md",
        toolType: "read",
        output: "",
        status: "running",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="claude:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningRows = container.querySelectorAll(".thinking-block");
    expect(reasoningRows.length).toBe(1);
    const reasoningTitle = container.querySelector(".thinking-title");
    expect(reasoningTitle?.textContent ?? "").toBeTruthy();
    expect(
      container.querySelector(".working-text")?.textContent ?? "",
    ).not.toContain("这是一个包含多个子项目的目录。让我探索一下项目结构。");
    expect(
      container.querySelector(".working-activity")?.textContent ?? "",
    ).toContain("批量读取4个文件");
  });

  it("renders Claude reasoning and assistant message together when conversation state reuses the same item id", () => {
    const conversationState: ConversationState = {
      items: [
        {
          id: "user-shared-id",
          kind: "message",
          role: "user",
          text: "分析一下这个项目",
        },
        {
          id: "claude-live-shared",
          kind: "reasoning",
          summary: "我先梳理目录结构。",
          content: "我先梳理目录结构。",
        },
        {
          id: "claude-live-shared",
          kind: "message",
          role: "assistant",
          text: "# 项目分析\n\n这里是实时正文。",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "claude:thread-shared-id",
        engine: "claude",
        activeTurnId: "turn-1",
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
    };

    const { container } = render(
      <Messages
        items={[]}
        threadId="claude:thread-shared-id"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        conversationState={conversationState}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("这里是实时正文。");
  });

  it("hides command cards on codex canvas while keeping file-edit cards", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-codex-command-1",
        kind: "tool",
        title: "Command: pwd && ls -la",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
      {
        id: "tool-codex-command-2",
        kind: "tool",
        title: "Command: echo done",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
      {
        id: "tool-codex-edit-1",
        kind: "tool",
        title: "Tool: edit",
        detail: JSON.stringify({
          file_path: "src/keep.ts",
          old_string: "before",
          new_string: "after",
        }),
        toolType: "edit",
        status: "completed",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent ?? "").not.toContain("pwd && ls -la");
    expect(container.textContent ?? "").not.toContain("echo done");
    // File edits render in a default-collapsed scene shell; expand to assert path.
    const editScene = container.querySelector(
      '[data-testid="file-edit-scene-list"]',
    )?.previousElementSibling as HTMLElement | null;
    const editToggle =
      container.querySelector('[aria-expanded="false"]') ??
      Array.from(container.querySelectorAll("button, [role='button']")).find(
        (node) =>
          (node.textContent ?? "").includes("批量修改") ||
          (node.textContent ?? "").includes("文件修改") ||
          (node.textContent ?? "").includes("Batch edit") ||
          (node.textContent ?? "").includes("File changes") ||
          (node.textContent ?? "").includes("fileEditSceneCount"),
      );
    if (editToggle) {
      fireEvent.click(editToggle);
    }
    expect(container.textContent ?? "").toContain("keep.ts");
    void editScene;
  });

  it("hides command cards on claude canvas", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-claude-command-1",
        kind: "tool",
        title: "Command: pwd && ls -la",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
      {
        id: "tool-claude-command-2",
        kind: "tool",
        title: "Command: echo done",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent ?? "").not.toContain("pwd && ls -la");
    expect(container.textContent ?? "").not.toContain("echo done");
  });

  it.each(["claude", "gemini", "codex"] as const)(
    "uses a unified simple working indicator for %s (no phase glow FX)",
    (activeEngine) => {
      const baseItems: ConversationItem[] = [
        {
          id: "user-stream-phase",
          kind: "message",
          role: "user",
          text: "继续输出",
        },
        {
          id: "assistant-stream-phase",
          kind: "message",
          role: "assistant",
          text: "",
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={baseItems}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine={activeEngine}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const waitingNode = container.querySelector(".working");
      expect(waitingNode).toBeTruthy();
      expect(waitingNode?.className ?? "").toBe("working");
      expect(waitingNode?.querySelector(".working-spinner")).toBeTruthy();
      expect(waitingNode?.className ?? "").not.toContain("is-waiting");
      expect(waitingNode?.className ?? "").not.toContain("is-ingress");

      rerender(
        <Messages
          items={[
            baseItems[0]!,
            {
              id: "assistant-stream-phase",
              kind: "message",
              role: "assistant",
              text: "增量片段",
            },
          ]}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine={activeEngine}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const streamingNode = container.querySelector(".working");
      expect(streamingNode?.className ?? "").toBe("working");
      expect(streamingNode?.className ?? "").not.toContain("is-ingress");
      expect(streamingNode?.className ?? "").not.toContain("is-waiting");
    },
  );

  it("shows a working indicator while context compaction is in progress", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "assistant-before-compaction",
            kind: "message",
            role: "assistant",
            text: "已有上下文",
          },
        ]}
        threadId="claude:thread-compact-1"
        workspaceId="ws-1"
        isThinking={false}
        isContextCompacting={true}
        activeEngine="claude"
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingNode = container.querySelector(".working");
    const workingText = container.querySelector(".working-text");
    expect(workingNode).toBeTruthy();
    expect(workingText?.textContent ?? "").toContain("Compacting context");
  });

  it("shows Codex first-text waiting state before assistant text arrives", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "user-codex-first-text",
            kind: "message",
            role: "user",
            text: "继续推进",
          },
        ]}
        threadId="codex-thread-first-text"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".working-text")?.textContent ?? "",
    ).toContain("messages.waitingForFirstText");
  });

  it("shows Qoder first-text waiting state before assistant text arrives", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "user-qoder-first-text",
            kind: "message",
            role: "user",
            text: "你是谁",
          },
        ]}
        threadId="qoder:session-first-text"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="qoder"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".working-text")?.textContent ?? "",
    ).toContain("messages.waitingForFirstText");
  });

  it("keeps Codex silent suspected state above the first-text waiting state", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "user-codex-silent",
            kind: "message",
            role: "user",
            text: "继续推进",
          },
        ]}
        threadId="codex-thread-silent"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 13_000}
        codexSilentSuspectedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const label = container.querySelector(".working-text")?.textContent ?? "";
    expect(label).toContain("messages.codexSilentSuspected");
    expect(label).not.toContain("messages.waitingForFirstText");
  });

  it("shows approval resume status as the primary working label for Claude file approvals", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "user-approval-resume",
            kind: "message",
            role: "user",
            text: "创建 3 个文件",
          },
          {
            id: "assistant-before-approval",
            kind: "message",
            role: "assistant",
            text: "我会先创建文件。",
            isFinal: true,
          },
          {
            id: "file-approval-running",
            kind: "tool",
            toolType: "fileChange",
            title: "Applying approved file change",
            detail: '{"file_path":"aaa.txt"}',
            status: "running",
            output:
              "Approved. Applying the change locally and resuming Claude...",
          },
        ]}
        threadId="claude:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 800}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container.querySelector(".working-text")?.textContent ?? "",
    ).toContain("resuming Claude");
    expect(
      container.querySelector(".working-activity")?.textContent ?? "",
    ).toContain("Applying approved file change");
  });

  it("does not render Codex session file-change summary cards in the timeline", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-codex-file-summary",
        kind: "message",
        role: "user",
        text: "更新文件",
      },
      {
        id: "tool-codex-file-summary",
        kind: "tool",
        toolType: "fileChange",
        title: "File changes",
        detail: "",
        status: "completed",
        changes: [
          {
            path: "src/App.tsx",
            kind: "modified",
            diff: "@@ -1,1 +1,1 @@\n-old\n+new",
          },
        ],
      },
      {
        id: "assistant-codex-file-summary",
        kind: "message",
        role: "assistant",
        text: "生产代码已改，继续验证。",
        isFinal: true,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-codex-file-summary"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("messages.turnFilesChanged.title")).toBeNull();
    });
  });

  it.each(["claude", "gemini"] as const)(
    "keeps %s working indicator simple when chunk content changes at same length",
    (activeEngine) => {
      const { container, rerender } = render(
        <Messages
          items={[
            {
              id: "user-stream-same-length",
              kind: "message",
              role: "user",
              text: "继续输出",
            },
            {
              id: "assistant-stream-same-length",
              kind: "message",
              role: "assistant",
              text: "aaaa",
            },
          ]}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine={activeEngine}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const baselineNode = container.querySelector(".working");
      expect(baselineNode?.className ?? "").toBe("working");

      rerender(
        <Messages
          items={[
            {
              id: "user-stream-same-length",
              kind: "message",
              role: "user",
              text: "继续输出",
            },
            {
              id: "assistant-stream-same-length",
              kind: "message",
              role: "assistant",
              text: "bbbb",
            },
          ]}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine={activeEngine}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const afterNode = container.querySelector(".working");
      expect(afterNode?.className ?? "").toBe("working");
      expect(afterNode?.className ?? "").not.toContain("is-ingress");
    },
  );
});
