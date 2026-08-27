// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "../../../types";
import {
  DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
  THREAD_ROW_TOOLTIP_DELAY_MS,
} from "../constants";
import { ThreadList } from "./ThreadList";
import { ScrollArea } from "../../../components/ui/scroll-area";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  // This mock returns the key as-is for testing
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "threads.showLess": "Show less",
        "threads.more": "More...",
        "threads.loading": "Loading...",
        "threads.searchOlder": "Search older...",
        "threads.loadOlder": "Load older...",
        "threads.degradedThreadListBadge": "Incomplete",
        "threads.degradedThreadListTooltip":
          "These thread results are not fully refreshed yet and may be missing some conversations.",
        "threads.autoNaming": "Auto naming...",
        "threads.pin": "Pin",
        "threads.unpin": "Unpin",
        "threads.hideExitedSessions": "Hide exited sessions",
        "threads.showExitedSessions": "Show exited sessions",
        "threads.exitedSessionsHidden": "{{count}} exited hidden",
        "threads.subagentTag": "Subagent",
        "threads.providerContinuation": "供应商续接",
        "threads.providerContinuationShort": "续接",
        "threads.providerContinuationHint":
          "Provider 续接：可在会话顶部查看来源",
        "threads.providerContinuationFamilyGroup": "续接会话 · {{count}} 个",
        "threads.subagentTreeExpanded": "Subagent tree expanded",
        "threads.subagentTreeExpand": "Expand subagent tree",
        "threads.subagentTreeCollapse": "Collapse subagent tree",
        "threads.runtimeProcessing": "Processing",
        "threads.runtimeReviewing": "Reviewing",
        "threads.runtimeCompleted": "Completed",
        "threads.runtimeBackgroundTasks": "Background tasks running",
        "threads.deleteThreadTitle": "Delete conversation",
        "threads.deleteThreadMessage":
          "Are you sure you want to delete this thread?",
        "threads.deleteThreadHint": "This cannot be undone.",
        "threads.delete": "Delete",
        "threads.renameThread": "Rename thread",
        "common.cancel": "Cancel",
        "common.deleting": "Deleting",
      };
      const template = translations[key] || key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) =>
        String(options?.[token] ?? ""),
      );
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

const nestedThread: ThreadSummary = {
  id: "thread-2",
  name: "Nested Agent",
  updatedAt: 900,
};

const thread: ThreadSummary = {
  id: "thread-1",
  name: "Alpha",
  updatedAt: 1000,
  sizeBytes: 1536,
};

const statusMap = {
  "thread-1": { isProcessing: false, hasUnread: true, isReviewing: false },
  "thread-2": { isProcessing: false, hasUnread: false, isReviewing: false },
};

const baseProps = {
  workspaceId: "ws-1",
  workspacePath: "/tmp/ws-1",
  pinnedRows: [],
  unpinnedRows: [{ thread, depth: 0 }],
  totalThreadRoots: 1,
  visibleThreadRootCount: DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
  isExpanded: false,
  nextCursor: null,
  isPaging: false,
  nested: false,
  activeWorkspaceId: "ws-1",
  activeThreadId: "thread-1",
  threadStatusById: statusMap,
  getThreadTime: () => "2m",
  isThreadPinned: () => false,
  isThreadAutoNaming: () => false,
  onToggleExpanded: vi.fn(),
  onLoadOlderThreads: vi.fn(),
  onSelectThread: vi.fn(),
  onShowThreadMenu: vi.fn(),
};

describe("ThreadList background task row status", () => {
  it("renders bg-running breathe dot with count badge when bg tasks run and turn settled", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
            backgroundTaskRunningCount: 2,
          },
        }}
      />,
    );

    const row = container.querySelector(".thread-row");
    expect(row?.querySelector(".thread-status")?.className).toContain(
      "bg-running",
    );
    const badge = row?.querySelector(".thread-bg-task-count");
    expect(badge?.textContent).toBe("2");
  });

  it("keeps processing priority while showing the count badge alongside", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
            backgroundTaskRunningCount: 1,
          },
        }}
      />,
    );

    const row = container.querySelector(".thread-row");
    expect(row?.querySelector(".thread-status")?.className).toContain(
      "processing",
    );
    expect(
      row?.querySelector(".thread-status")?.className,
    ).not.toContain("bg-running");
    expect(row?.querySelector(".thread-bg-task-count")?.textContent).toBe("1");
  });

  it("falls back to unread after all bg tasks turn terminal (count 0)", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: true,
            isReviewing: false,
            backgroundTaskRunningCount: 0,
          },
        }}
      />,
    );

    const row = container.querySelector(".thread-row");
    expect(row?.querySelector(".thread-status")?.className).toContain("unread");
    expect(row?.querySelector(".thread-bg-task-count")).toBeNull();
  });
});

describe("ThreadList", () => {
  it("hydrates multiple rows in StrictMode without mounting Radix row anchors", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const rows = Array.from({ length: 8 }, (_, index) => ({
      thread: {
        ...thread,
        id: `thread-${index + 10}`,
        name: `Thread ${index + 1}`,
      },
      depth: 0,
    }));

    try {
      const { container } = render(
        <StrictMode>
          <ScrollArea style={{ width: 320, height: 480 }}>
            <ThreadList
              {...baseProps}
              unpinnedRows={rows}
              totalThreadRoots={rows.length}
              visibleThreadRootCount={rows.length}
              isExpanded
            />
          </ScrollArea>
        </StrictMode>,
      );

      expect(container.querySelectorAll(".thread-row")).toHaveLength(
        rows.length,
      );
      expect(
        container.querySelector('[data-slot="tooltip-trigger"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-slot="popover-anchor"]'),
      ).toBeNull();
      expect(
        consoleErrorSpy.mock.calls.some((call) =>
          call.some((entry) =>
            /Maximum update depth exceeded|Minified React error #185/.test(
              String(entry),
            ),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("renders active row and handles click/context menu", () => {
    const onSelectThread = vi.fn();
    const onShowThreadMenu = vi.fn();

    render(
      <ThreadList
        {...baseProps}
        onSelectThread={onSelectThread}
        onShowThreadMenu={onShowThreadMenu}
      />,
    );

    const row = screen.getByText("Alpha").closest(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing thread row");
    }
    expect(row.classList.contains("active")).toBe(true);
    expect(row.querySelector(".thread-status")?.className).toContain("unread");
    // 无后台任务：不渲染计数徽标。
    expect(row.querySelector(".thread-bg-task-count")).toBeNull();

    fireEvent.click(row);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "thread-1");

    fireEvent.contextMenu(row);
    expect(onShowThreadMenu).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "thread-1",
      true,
      1536,
      undefined,
      null,
      true,
      "/tmp/ws-1",
    );
  });

  function mockThreadNameOverflow(
    row: Element,
    options: { truncated: boolean },
  ) {
    const name = row.querySelector(".thread-name");
    expect(name).toBeTruthy();
    if (!(name instanceof HTMLElement)) {
      throw new Error("Missing thread name");
    }
    Object.defineProperty(name, "scrollWidth", {
      configurable: true,
      get: () => (options.truncated ? 240 : 80),
    });
    Object.defineProperty(name, "clientWidth", {
      configurable: true,
      get: () => 80,
    });
    return name;
  }

  it("delays thread row tooltip enough to avoid incidental pass-over hovers", async () => {
    vi.useFakeTimers();
    const view = render(<ThreadList {...baseProps} />);

    try {
      const row = screen.getByText("Alpha").closest(".thread-row");
      expect(row).toBeTruthy();
      if (!row) {
        throw new Error("Missing thread row");
      }
      mockThreadNameOverflow(row, { truncated: true });

      await act(async () => {
        fireEvent.mouseEnter(row);
        await vi.advanceTimersByTimeAsync(THREAD_ROW_TOOLTIP_DELAY_MS - 1);
      });
      expect(document.querySelector('[data-slot="tooltip-popup"]')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        document.querySelector('[data-slot="tooltip-popup"]')?.textContent,
      ).toContain("Alpha");
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("hides the thread name bubble when the title is fully visible", async () => {
    vi.useFakeTimers();
    const view = render(<ThreadList {...baseProps} />);

    try {
      const row = screen.getByText("Alpha").closest(".thread-row");
      expect(row).toBeTruthy();
      if (!row) {
        throw new Error("Missing thread row");
      }
      mockThreadNameOverflow(row, { truncated: false });

      await act(async () => {
        fireEvent.mouseEnter(row);
        await vi.advanceTimersByTimeAsync(THREAD_ROW_TOOLTIP_DELAY_MS + 20);
      });
      expect(document.querySelector('[data-slot="tooltip-popup"]')).toBeNull();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("shows the thread name bubble only when the title is truncated", async () => {
    vi.useFakeTimers();
    const view = render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              name: "你好1+1=2? 这是一段会被截断的长标题",
            },
            depth: 0,
          },
        ]}
      />,
    );

    try {
      const row = screen
        .getByText("你好1+1=2? 这是一段会被截断的长标题")
        .closest(".thread-row");
      expect(row).toBeTruthy();
      if (!row) {
        throw new Error("Missing thread row");
      }
      mockThreadNameOverflow(row, { truncated: true });

      await act(async () => {
        fireEvent.mouseEnter(row);
        await vi.advanceTimersByTimeAsync(THREAD_ROW_TOOLTIP_DELAY_MS + 20);
      });
      expect(
        document.querySelector('[data-slot="tooltip-popup"]')?.textContent,
      ).toContain("你好1+1=2? 这是一段会被截断的长标题");
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
  it("marks shared threads as not archivable for the context menu", () => {
    const onShowThreadMenu = vi.fn();

    render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "shared:thread-1",
              threadKind: "shared",
            },
            depth: 0,
          },
        ]}
        onShowThreadMenu={onShowThreadMenu}
      />,
    );

    const row = screen.getByText("Alpha").closest(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing shared thread row");
    }

    fireEvent.contextMenu(row);
    expect(onShowThreadMenu).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "shared:thread-1",
      true,
      1536,
      undefined,
      null,
      false,
      "/tmp/ws-1",
    );
  });

  it("keeps SharedSessionIcon when shared: id has lost or native threadKind projection", () => {
    const cases: Array<{
      label: string;
      threadKind?: "native" | "shared";
      engineSource?: ThreadSummary["engineSource"];
    }> = [
      { label: "missing kind", engineSource: "grok" },
      { label: "native projection", threadKind: "native", engineSource: "claude" },
      { label: "shared projection", threadKind: "shared", engineSource: "codex" },
    ];

    for (const testCase of cases) {
      const { container, unmount } = render(
        <ThreadList
          {...baseProps}
          unpinnedRows={[
            {
              thread: {
                ...thread,
                id: "shared:icon-stable",
                name: `Shared ${testCase.label}`,
                threadKind: testCase.threadKind,
                engineSource: testCase.engineSource,
              },
              depth: 0,
            },
          ]}
        />,
      );

      const badge = container.querySelector(".thread-engine-badge");
      expect(badge, testCase.label).toBeTruthy();
      expect(badge?.className, testCase.label).toContain("thread-engine-shared");
      expect(badge?.className, testCase.label).not.toMatch(
        /thread-engine-(codex|claude|grok|kimi|gemini|opencode)/,
      );
      // SharedSessionIcon is path/circle SVG without img; EngineIcon may use img for claude
      expect(badge?.querySelector("img"), testCase.label).toBeNull();
      unmount();
    }
  });

  it("still renders EngineIcon for native sessions", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "claude:native-1",
              threadKind: "native",
              engineSource: "claude",
            },
            depth: 0,
          },
        ]}
      />,
    );

    const badge = container.querySelector(".thread-engine-badge");
    expect(badge?.className).toContain("thread-engine-claude");
    expect(badge?.className).not.toContain("thread-engine-shared");
  });

  it("shows pin toggle and allows pinning without selecting the row", () => {
    const onToggleThreadPin = vi.fn();
    const onSelectThread = vi.fn();

    const { container } = render(
      <ThreadList
        {...baseProps}
        onToggleThreadPin={onToggleThreadPin}
        onSelectThread={onSelectThread}
      />,
    );

    const row = container.querySelector(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing thread row");
    }
    const pinButton = row.querySelector(
      ".thread-pin-toggle",
    ) as HTMLButtonElement | null;
    expect(pinButton).toBeTruthy();
    if (!pinButton) {
      throw new Error("Missing pin toggle");
    }

    fireEvent.click(pinButton);
    expect(onToggleThreadPin).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("shows the more button and pages incrementally", () => {
    const onLoadOlderThreads = vi.fn();
    render(
      <ThreadList
        {...baseProps}
        totalThreadRoots={DEFAULT_VISIBLE_THREAD_ROOT_COUNT + 1}
        onLoadOlderThreads={onLoadOlderThreads}
      />,
    );

    const moreButton = screen.getByRole("button", { name: "More..." });
    fireEvent.click(moreButton);
    expect(onLoadOlderThreads).toHaveBeenCalledWith("ws-1");
    expect(screen.queryByRole("button", { name: "Load older..." })).toBeNull();
  });

  it("uses more to fetch the next page when a cursor is available", () => {
    const onLoadOlderThreads = vi.fn();
    render(
      <ThreadList
        {...baseProps}
        nextCursor="cursor"
        onLoadOlderThreads={onLoadOlderThreads}
      />,
    );

    const moreButton = screen.getByRole("button", { name: "More..." });
    fireEvent.click(moreButton);
    expect(onLoadOlderThreads).toHaveBeenCalledWith("ws-1");
    expect(screen.queryByRole("button", { name: "Load older..." })).toBeNull();
  });

  it("shows collapse after paging without a separate load-older link", () => {
    render(
      <ThreadList
        {...baseProps}
        totalThreadRoots={DEFAULT_VISIBLE_THREAD_ROOT_COUNT * 2}
        visibleThreadRootCount={DEFAULT_VISIBLE_THREAD_ROOT_COUNT * 2}
        isExpanded
        nextCursor="cursor"
      />,
    );

    expect(screen.queryByRole("button", { name: "Load older..." })).toBeNull();
    expect(screen.getByRole("button", { name: "More..." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("renders nested rows with indentation and disables pinning", () => {
    const onShowThreadMenu = vi.fn();
    render(
      <ThreadList
        {...baseProps}
        nested
        unpinnedRows={[
          { thread, depth: 0 },
          { thread: nestedThread, depth: 1 },
        ]}
        onShowThreadMenu={onShowThreadMenu}
      />,
    );

    const nestedRow = screen.getByText("Nested Agent").closest(".thread-row");
    expect(nestedRow).toBeTruthy();
    if (!nestedRow) {
      throw new Error("Missing nested thread row");
    }
    expect(nestedRow.getAttribute("style")).toContain("--thread-indent");

    fireEvent.contextMenu(nestedRow);
    expect(onShowThreadMenu).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "thread-2",
      false,
      undefined,
      undefined,
      null,
      true,
      "/tmp/ws-1",
    );
  });

  it("renders subagent child rows with status and opens the child session", () => {
    const onSelectThread = vi.fn();
    const childThread: ThreadSummary = {
      ...nestedThread,
      id: "claude:agent-parent-agent",
      parentThreadId: "claude:parent",
      engineSource: "claude",
    };

    render(
      <ThreadList
        {...baseProps}
        activeThreadId="claude:agent-parent-agent"
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "claude:parent",
              engineSource: "claude",
            },
            depth: 0,
            hasChildren: true,
          },
          { thread: childThread, depth: 1 },
        ]}
        onSelectThread={onSelectThread}
      />,
    );

    const parentRow = screen.getByText("Alpha").closest(".thread-row");
    expect(parentRow?.classList.contains("is-subagent-parent")).toBe(true);
    expect(parentRow?.classList.contains("is-active-subagent-parent")).toBe(
      true,
    );
    // Subagent trees collapse by default; expand to reveal the child session row.
    fireEvent.click(
      parentRow?.querySelector(".thread-tree-expander") as HTMLElement,
    );
    expect(parentRow?.getAttribute("aria-expanded")).toBe("true");
    expect(
      parentRow
        ?.querySelector(".thread-tree-expander")
        ?.getAttribute("aria-label"),
    ).toBe("Collapse subagent tree");
    const childRow = screen.getByText("Nested Agent").closest(".thread-row");
    expect(childRow).toBeTruthy();
    if (!childRow) {
      throw new Error("Missing subagent child row");
    }
    expect(childRow.classList.contains("is-subagent")).toBe(true);
    expect(childRow.classList.contains("is-active-subagent-group")).toBe(true);
    expect(childRow.querySelector(".thread-subagent-branch")).toBeNull();
    expect(childRow.querySelector(".thread-engine-badge")).toBeNull();
    expect(childRow.querySelector(".thread-subagent-tag")?.textContent).toBe(
      "Subagent",
    );

    fireEvent.click(childRow);
    expect(onSelectThread).toHaveBeenCalledWith(
      "ws-1",
      "claude:agent-parent-agent",
    );
  });

  it("renders user forks as roots while real subagents stay nested and collapsed", () => {
    render(
      <ThreadList
        {...baseProps}
        activeThreadId="claude-fork:parent:local-1"
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "claude:parent",
              name: "Parent",
              engineSource: "claude",
            },
            depth: 0,
            hasChildren: true,
          },
          {
            thread: {
              ...nestedThread,
              id: "claude:real-subagent",
              parentThreadId: "claude:parent",
              engineSource: "claude",
            },
            depth: 1,
          },
          {
            thread: {
              id: "claude-fork:parent:local-1",
              name: "fork-Parent",
              updatedAt: 1100,
              engineSource: "claude",
            },
            depth: 0,
          },
        ]}
      />,
    );

    const forkRow = screen.getByText("fork-Parent").closest(".thread-row");
    expect(forkRow?.classList.contains("is-subagent")).toBe(false);
    expect(forkRow?.querySelector(".thread-subagent-tag")).toBeNull();
    expect(screen.queryByText("Nested Agent")).toBeNull();

    const parentRow = screen.getByText("Parent").closest(".thread-row");
    fireEvent.click(
      parentRow?.querySelector(".thread-tree-expander") as HTMLElement,
    );

    const subagentRow = screen.getByText("Nested Agent").closest(".thread-row");
    expect(subagentRow?.classList.contains("is-subagent")).toBe(true);
    expect(
      subagentRow?.querySelector(".thread-subagent-tag")?.textContent,
    ).toBe("Subagent");
  });

  it("does not expose subagent parent controls on deeper nested child rows", () => {
    render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "claude:parent",
              engineSource: "claude",
            },
            depth: 0,
            hasChildren: true,
          },
          {
            thread: {
              id: "claude:agent-mid",
              name: "Mid Agent",
              updatedAt: 800,
              parentThreadId: "claude:parent",
              engineSource: "claude",
            },
            depth: 1,
            hasChildren: true,
          },
          {
            thread: {
              id: "claude:agent-leaf",
              name: "Leaf Agent",
              updatedAt: 700,
              parentThreadId: "claude:agent-mid",
              engineSource: "claude",
            },
            depth: 2,
          },
        ]}
      />,
    );

    const topLevelRow = screen.getByText("Alpha").closest(".thread-row");
    // Subagent trees collapse by default; expand the top-level parent to reveal its child.
    fireEvent.click(
      topLevelRow?.querySelector(".thread-tree-expander") as HTMLElement,
    );
    const midRow = screen.getByText("Mid Agent").closest(".thread-row");
    expect(topLevelRow?.classList.contains("is-subagent-parent")).toBe(true);
    expect(topLevelRow?.querySelector(".thread-tree-expander")).toBeTruthy();
    expect(midRow?.classList.contains("has-child-threads")).toBe(true);
    expect(midRow?.classList.contains("is-subagent-parent")).toBe(false);
    expect(midRow?.getAttribute("aria-expanded")).toBeNull();
    expect(midRow?.querySelector(".thread-tree-expander")).toBeNull();
  });

  it("routes pending subagent child row clicks back to the parent session", () => {
    const onSelectThread = vi.fn();
    const pendingChildThread: ThreadSummary = {
      ...nestedThread,
      id: "claude-pending-subagent:claude:parent:toolu_agent_1",
      parentThreadId: "claude:parent",
      engineSource: "claude",
      isDegraded: true,
      degradedReason: "Subagent is running; transcript is not available yet.",
    };

    render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "claude:parent",
              engineSource: "claude",
            },
            depth: 0,
            hasChildren: true,
          },
          { thread: pendingChildThread, depth: 1 },
        ]}
        onSelectThread={onSelectThread}
      />,
    );

    // Subagent trees collapse by default; expand the parent to reveal the pending child.
    fireEvent.click(
      screen
        .getByText("Alpha")
        .closest(".thread-row")
        ?.querySelector(".thread-tree-expander") as HTMLElement,
    );
    const childRow = screen.getByText("Nested Agent").closest(".thread-row");
    expect(childRow?.classList.contains("is-pending-subagent")).toBe(true);
    expect(childRow?.querySelector(".thread-engine-badge")).toBeNull();
    expect(childRow?.querySelector(".thread-subagent-tag")).toBeTruthy();
    if (!childRow) {
      throw new Error("Missing pending subagent child row");
    }
    fireEvent.click(childRow);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "claude:parent");
  });

  it("collapses and expands subagent child rows from the right-side expander", () => {
    const onSelectThread = vi.fn();
    const childThread: ThreadSummary = {
      ...nestedThread,
      id: "claude:agent-parent-agent",
      parentThreadId: "claude:parent",
      engineSource: "claude",
    };

    render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "claude:parent",
              engineSource: "claude",
            },
            depth: 0,
            hasChildren: true,
          },
          { thread: childThread, depth: 1 },
        ]}
        onSelectThread={onSelectThread}
      />,
    );

    const parentRow = screen.getByText("Alpha").closest(".thread-row");
    const expander = parentRow?.querySelector(".thread-tree-expander");
    expect(expander).toBeTruthy();
    if (!parentRow) {
      throw new Error("Missing subagent parent row");
    }
    if (!expander) {
      throw new Error("Missing subagent tree expander");
    }

    // Subagent trees collapse by default.
    expect(parentRow?.getAttribute("aria-expanded")).toBe("false");
    expect(expander.getAttribute("aria-label")).toBe("Expand subagent tree");
    expect(screen.queryByText("Nested Agent")).toBeNull();

    fireEvent.click(expander);
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(parentRow?.getAttribute("aria-expanded")).toBe("true");
    expect(expander.getAttribute("aria-label")).toBe("Collapse subagent tree");
    expect(screen.getByText("Nested Agent")).toBeTruthy();

    fireEvent.click(parentRow);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "claude:parent");
    fireEvent.keyDown(expander, { key: "Enter" });
    expect(parentRow?.getAttribute("aria-expanded")).toBe("false");
    expect(expander.getAttribute("aria-label")).toBe("Expand subagent tree");
    expect(screen.queryByText("Nested Agent")).toBeNull();
  });

  it("shows inline delete confirmation bubble beside the row", () => {
    const onCancelDeleteConfirm = vi.fn();
    const onConfirmDeleteConfirm = vi.fn();

    const view = render(<ThreadList {...baseProps} />);
    const row = screen
      .getByText("Alpha")
      .closest<HTMLButtonElement>(".thread-row");
    expect(row).toBeTruthy();
    row?.focus();

    view.rerender(
      <ThreadList
        {...baseProps}
        deleteConfirmWorkspaceId="ws-1"
        deleteConfirmThreadId="thread-1"
        onCancelDeleteConfirm={onCancelDeleteConfirm}
        onConfirmDeleteConfirm={onConfirmDeleteConfirm}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Delete conversation" }),
    ).toBeTruthy();
    expect(screen.getByText("Alpha").closest(".thread-row")).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(row?.closest('[data-slot="popover-anchor"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirmDeleteConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelDeleteConfirm).toHaveBeenCalledTimes(1);

    view.rerender(<ThreadList {...baseProps} />);
    expect(screen.getByText("Alpha").closest(".thread-row")).toBe(row);
  });

  it("supports inline thread rename without a modal dialog", () => {
    const onRenameChange = vi.fn();
    const onRenameCancel = vi.fn();
    const onRenameConfirm = vi.fn();

    const view = render(
      <ThreadList
        {...baseProps}
        renameWorkspaceId="ws-1"
        renameThreadId="thread-1"
        renameName="Alpha"
        onRenameChange={onRenameChange}
        onRenameCancel={onRenameCancel}
        onRenameConfirm={onRenameConfirm}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Rename thread" });
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("Alpha");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".worktree-modal")).toBeNull();
    expect(document.querySelector(".thread-row.is-renaming")).toBeTruthy();

    fireEvent.change(input, { target: { value: "Beta" } });
    expect(onRenameChange).toHaveBeenCalledWith("Beta");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameConfirm).toHaveBeenCalledTimes(1);

    view.rerender(
      <ThreadList
        {...baseProps}
        renameWorkspaceId="ws-1"
        renameThreadId="thread-1"
        renameName="Beta"
        onRenameChange={onRenameChange}
        onRenameCancel={onRenameCancel}
        onRenameConfirm={onRenameConfirm}
      />,
    );
    const renameInput = screen.getByRole("textbox", { name: "Rename thread" });
    fireEvent.keyDown(renameInput, { key: "Escape" });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
  });

  it("shows auto naming loading badge when thread is auto naming", () => {
    render(
      <ThreadList
        {...baseProps}
        isThreadAutoNaming={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-1"
        }
      />,
    );

    expect(screen.getByText("Auto naming...")).toBeTruthy();
  });

  it("can hide exited sessions from the workspace thread list", () => {
    render(
      <ThreadList
        {...baseProps}
        hideExitedSessions
        unpinnedRows={[
          {
            thread: { id: "thread-running", name: "Running", updatedAt: 2 },
            depth: 0,
          },
          {
            thread: { id: "thread-exited", name: "Exited", updatedAt: 1 },
            depth: 0,
          },
        ]}
        threadStatusById={{
          "thread-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "thread-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText("Exited")).toBeNull();
    expect(screen.queryByText("1 exited hidden")).toBeNull();
  });

  it("keeps exited parent rows visible when a running child remains visible", () => {
    render(
      <ThreadList
        {...baseProps}
        hideExitedSessions
        unpinnedRows={[
          {
            thread: { id: "thread-parent", name: "Parent", updatedAt: 3 },
            depth: 0,
          },
          {
            thread: { id: "thread-child", name: "Running child", updatedAt: 2 },
            depth: 1,
          },
          {
            thread: {
              id: "thread-exited",
              name: "Exited sibling",
              updatedAt: 1,
            },
            depth: 0,
          },
        ]}
        threadStatusById={{
          "thread-parent": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
          "thread-child": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "thread-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    expect(screen.getByText("Parent")).toBeTruthy();
    expect(screen.getByText("Running child")).toBeTruthy();
    expect(screen.queryByText("Exited sibling")).toBeNull();
    expect(screen.queryByText("1 exited hidden")).toBeNull();
  });

  it("shows a muted hidden summary when all visible rows are filtered out", () => {
    render(
      <ThreadList
        {...baseProps}
        hideExitedSessions
        unpinnedRows={[
          {
            thread: { id: "thread-exited", name: "Exited", updatedAt: 1 },
            depth: 0,
          },
        ]}
        threadStatusById={{
          "thread-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    expect(screen.queryByText("Exited")).toBeNull();
    expect(screen.getByText("1 exited hidden")).toBeTruthy();
  });

  it("renders only relative time inline when size is available", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const meta = container.querySelector(".thread-meta");
    expect(meta).toBeTruthy();
    if (!meta) {
      throw new Error("Missing thread meta");
    }
    const size = meta.querySelector(".thread-size");
    const time = meta.querySelector(".thread-time");
    expect(size).toBeNull();
    expect(time?.textContent).toBe("2m");
    expect(meta.querySelector(".thread-runtime-dot")).toBeNull();
  });

  it("shows a breathing status dot and hides relative time while thread is running", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const meta = container.querySelector(".thread-meta");
    expect(meta).toBeTruthy();
    const dot = meta?.querySelector(".thread-runtime-dot");
    expect(dot).toBeTruthy();
    expect(dot?.classList.contains("thread-runtime-dot--processing")).toBe(
      true,
    );
    expect(dot?.getAttribute("aria-label")).toBe("Processing");
    expect(dot?.getAttribute("title")).toBe("Processing");
    expect(meta?.querySelector(".thread-time")).toBeNull();
    expect(meta?.querySelector(".thread-runtime-badge")).toBeNull();
  });

  it("shows a static reviewing status dot while thread is reviewing", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: true,
          },
        }}
      />,
    );

    const meta = container.querySelector(".thread-meta");
    const dot = meta?.querySelector(".thread-runtime-dot");
    expect(dot?.classList.contains("thread-runtime-dot--reviewing")).toBe(true);
    expect(dot?.getAttribute("aria-label")).toBe("Reviewing");
    expect(meta?.querySelector(".thread-time")).toBeNull();
  });

  it("shows a green completed dot when finished while away (hasUnread)", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: true,
            isReviewing: false,
          },
        }}
      />,
    );

    const meta = container.querySelector(".thread-meta");
    const dot = meta?.querySelector(".thread-runtime-dot");
    expect(dot?.classList.contains("thread-runtime-dot--completed")).toBe(true);
    expect(dot?.getAttribute("aria-label")).toBe("Completed");
    expect(dot?.getAttribute("title")).toBe("Completed");
    expect(meta?.querySelector(".thread-time")).toBeNull();
  });

  it("prefers processing breath over completed unread while still running", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: true,
            hasUnread: true,
            isReviewing: false,
          },
        }}
      />,
    );

    const dot = container.querySelector(".thread-runtime-dot");
    expect(dot?.classList.contains("thread-runtime-dot--processing")).toBe(
      true,
    );
    expect(dot?.classList.contains("thread-runtime-dot--completed")).toBe(
      false,
    );
  });

  it("marks engine badge as processing when thread is running", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        threadStatusById={{
          "thread-1": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const row = container.querySelector(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing thread row");
    }
    const engineBadge = row.querySelector(".thread-engine-badge");
    expect(engineBadge?.classList.contains("is-processing")).toBe(true);
  });

  it("shows a compact proxy badge on a processing row even when workspace is inactive", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        workspaceId="ws-2"
        activeWorkspaceId="ws-1"
        activeThreadId={null}
        systemProxyEnabled
        systemProxyUrl="http://127.0.0.1:7890"
        threadStatusById={{
          "thread-1": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const row = container.querySelector(".thread-row");
    const badge = row?.querySelector(".thread-proxy-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent ?? "").toBe("");
    expect(badge?.classList.contains("proxy-status-badge--animated")).toBe(
      false,
    );
  });

  it("keeps an unchanged target row stable across unrelated status updates", () => {
    const renderCountByThreadId = new Map<string, number>();
    const rows = [
      { thread, depth: 0 },
      {
        thread: { id: "thread-other", name: "Other", updatedAt: 999 },
        depth: 0,
      },
    ];
    const onThreadRowRender = vi.fn((threadId: string) => {
      renderCountByThreadId.set(
        threadId,
        (renderCountByThreadId.get(threadId) ?? 0) + 1,
      );
    });

    const { rerender } = render(
      <ThreadList
        {...baseProps}
        unpinnedRows={rows}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: true,
            isReviewing: false,
          },
          "thread-other": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
        onThreadRowRender={onThreadRowRender}
      />,
    );

    expect(renderCountByThreadId.get("thread-1")).toBe(1);

    for (let index = 0; index < 1000; index += 1) {
      rerender(
        <ThreadList
          {...baseProps}
          unpinnedRows={rows}
          threadStatusById={{
            "thread-1": {
              isProcessing: false,
              hasUnread: true,
              isReviewing: false,
            },
            "thread-other": {
              isProcessing: index % 2 === 0,
              hasUnread: false,
              isReviewing: false,
            },
          }}
          onThreadRowRender={onThreadRowRender}
        />,
      );
    }

    expect(renderCountByThreadId.get("thread-1")).toBe(1);
    expect(onThreadRowRender).toHaveBeenCalledWith("thread-other");
  });

  it("hides codex provider metadata by default and keeps explicit badges opt-in", () => {
    const { container, rerender } = render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              sourceLabel: "custom/openai",
            },
            depth: 0,
          },
        ]}
      />,
    );

    expect(container.querySelector(".thread-provider-label")).toBeNull();

    rerender(
      <ThreadList
        {...baseProps}
        showProviderLabels
        unpinnedRows={[
          {
            thread: {
              ...thread,
              sourceLabel: "custom/openai",
            },
            depth: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("custom/openai")).toBeTruthy();

    rerender(
      <ThreadList
        {...baseProps}
        showProviderLabels
        unpinnedRows={[
          {
            thread: {
              ...thread,
              engineSource: "codex",
              providerProfileId: "   ",
              providerProfileName: "   ",
              sourceLabel: "   ",
            },
            depth: 0,
          },
        ]}
      />,
    );

    expect(container.querySelector(".thread-provider-label")).toBeNull();
  });

  it("shows provider continuation as a top-level origin badge", () => {
    render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "target-1",
              parentThreadId: null,
              originKind: "provider-continuation",
              sourceSessionId: "claude:source-1",
            },
            depth: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("续接")).toBeTruthy();
    expect(screen.queryByText("Subagent")).toBeNull();
  });

  it("defaults a continuation family to collapsed and toggles all members", () => {
    const onSelectThread = vi.fn();
    const { container } = render(
      <ThreadList
        {...baseProps}
        activeThreadId="target-2"
        onSelectThread={onSelectThread}
        totalThreadRoots={4}
        visibleThreadRootCount={4}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              id: "target-2",
              name: "Newest continuation",
              familyId: "family-1",
              originKind: "provider-continuation",
              lineageKind: "provider-continuation",
              sourceSessionId: "target-1",
              lineageParentSessionId: "target-1",
            },
            depth: 0,
          },
          {
            thread: { ...thread, id: "unrelated", name: "Unrelated" },
            depth: 0,
          },
          {
            thread: {
              ...thread,
              id: "target-1",
              name: "Earlier continuation",
              familyId: "family-1",
              originKind: "provider-continuation",
              lineageKind: "provider-continuation",
              sourceSessionId: "source",
              lineageParentSessionId: "source",
            },
            depth: 0,
          },
          {
            thread: { ...thread, id: "source", name: "Source session" },
            depth: 0,
          },
        ]}
      />,
    );

    const familyToggle = screen.getByRole("button", {
      name: "续接会话 · 3 个",
    });
    expect(familyToggle.getAttribute("aria-expanded")).toBe("false");
    let rows = Array.from(container.querySelectorAll(".thread-row"));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newest continuation"),
      expect.stringContaining("Unrelated"),
    ]);

    let segments = container.querySelectorAll(
      '[data-continuation-family-id="family-1"]',
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.getAttribute("data-continuation-family-position")).toBe(
      "start",
    );
    expect(segments[0]?.classList.contains("is-collapsed")).toBe(true);
    expect(rows[0]?.classList.contains("active")).toBe(true);

    fireEvent.click(familyToggle);
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(familyToggle.getAttribute("aria-expanded")).toBe("true");

    rows = Array.from(container.querySelectorAll(".thread-row"));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newest continuation"),
      expect.stringContaining("Earlier continuation"),
      expect.stringContaining("Source session"),
      expect.stringContaining("Unrelated"),
    ]);
    segments = container.querySelectorAll(
      '[data-continuation-family-id="family-1"]',
    );
    expect(segments).toHaveLength(3);
    expect(segments[2]?.getAttribute("data-continuation-family-position")).toBe(
      "end",
    );
    expect(rows[0]?.hasAttribute("aria-expanded")).toBe(false);
    expect(rows[1]?.classList.contains("is-subagent")).toBe(false);

    fireEvent.click(rows[1] as HTMLElement);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "target-1");

    fireEvent.click(familyToggle);
    expect(familyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".thread-row")).toHaveLength(2);
  });

  it("omits family chrome when only one member is visible", () => {
    const { container } = render(
      <ThreadList
        {...baseProps}
        unpinnedRows={[
          {
            thread: {
              ...thread,
              familyId: "family-1",
              originKind: "provider-continuation",
            },
            depth: 0,
          },
        ]}
      />,
    );

    expect(
      container.querySelector(".thread-continuation-family-segment"),
    ).toBeNull();
    expect(screen.getByText("续接")).toBeTruthy();
  });

  it("opens the pin scope menu at the exact click coordinates for unpinned rows", () => {
    const onShowPinScopeMenu = vi.fn();
    const onToggleThreadPin = vi.fn();
    const { container } = render(
      <ThreadList
        {...baseProps}
        onToggleThreadPin={onToggleThreadPin}
        onShowPinScopeMenu={onShowPinScopeMenu}
      />,
    );

    const pinToggle = container.querySelector(".thread-pin-toggle");
    if (!pinToggle) {
      throw new Error("Missing pin toggle");
    }
    fireEvent.click(pinToggle, { clientX: 321, clientY: 654 });

    expect(onShowPinScopeMenu).toHaveBeenCalledTimes(1);
    const [event, workspaceId, threadId] = onShowPinScopeMenu.mock.calls[0];
    expect(event.clientX).toBe(321);
    expect(event.clientY).toBe(654);
    expect(workspaceId).toBe("ws-1");
    expect(threadId).toBe("thread-1");
    // 未置顶点击不得直接改变置顶状态
    expect(onToggleThreadPin).not.toHaveBeenCalled();
    expect(baseProps.onSelectThread).not.toHaveBeenCalled();
  });

  it("unpins directly when a pinned row pin toggle is clicked", () => {
    const onShowPinScopeMenu = vi.fn();
    const onToggleThreadPin = vi.fn();
    const { container } = render(
      <ThreadList
        {...baseProps}
        isThreadPinned={() => true}
        onToggleThreadPin={onToggleThreadPin}
        onShowPinScopeMenu={onShowPinScopeMenu}
      />,
    );

    const pinToggle = container.querySelector(".thread-pin-toggle");
    if (!pinToggle) {
      throw new Error("Missing pin toggle");
    }
    fireEvent.click(pinToggle, { clientX: 100, clientY: 200 });

    expect(onToggleThreadPin).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(onShowPinScopeMenu).not.toHaveBeenCalled();
  });
});

it("marks the list as virtualized when 200 threads are present", () => {
  const longRows = Array.from({ length: 200 }, (_, index) => ({
    thread: {
      id: `thread-long-${index}`,
      name: `Thread ${index}`,
      updatedAt: 1_700_000_000_000 + index,
      engineSource: "codex" as const,
    },
    depth: 0,
  }));
  const { container } = render(
    <ThreadList
      {...baseProps}
      unpinnedRows={longRows}
      totalThreadRoots={longRows.length}
      visibleThreadRootCount={longRows.length}
      isExpanded={false}
    />,
  );
  const listEl = container.querySelector(".thread-list");
  expect(listEl).toBeTruthy();
  expect(listEl?.getAttribute("data-virtualized")).toBe("true");
  const spacer = container.querySelector(".thread-list-virtual-spacer");
  expect(spacer).toBeTruthy();
  // The whole point of virtualization: with 200 rows, the DOM MUST NOT
  // mount all 200 .thread-row elements at once. With the sidebar thread
  // row estimate (32) and overscan=8 and no measured scroll element in
  // jsdom, the virtualizer may report zero items; in that case the bound
  // is "fewer than 200" rows in the DOM. Either way, the count must stay
  // bounded.
  const mountedRows = container.querySelectorAll(".thread-row").length;
  expect(mountedRows).toBeLessThan(200);
});

it("does not virtualize a small thread list", () => {
  const { container } = render(
    <ThreadList
      {...baseProps}
      totalThreadRoots={2}
      visibleThreadRootCount={2}
      isExpanded={false}
    />,
  );
  const listEl = container.querySelector(".thread-list");
  expect(listEl?.getAttribute("data-virtualized")).toBeNull();
  expect(container.querySelector(".thread-list-virtual-spacer")).toBeNull();
});
