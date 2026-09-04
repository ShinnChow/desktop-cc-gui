// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { baseProps } from "./Sidebar.test-utils";
import { openWorkspaceActionsMenu } from "./SidebarTestSetup";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("keeps workspace reload in the workspace actions menu when the thread list is incomplete", () => {
    const workspace = {
      id: "ws-root",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Refresh incomplete thread list" }),
    ).toBeNull();
    const workspaceCard = screen
      .getByText("codemoss")
      .closest(".workspace-card");
    expect(workspaceCard).toBeTruthy();
    if (!workspaceCard) {
      throw new Error("Missing workspace card");
    }
    const menu = openWorkspaceActionsMenu(workspaceCard as HTMLElement);
    expect(
      within(menu).getByRole("menuitem", { name: "threads.reloadThreads" }),
    ).toBeTruthy();
  });

  it("keeps worktree incomplete refresh on the worktree row only", () => {
    const workspace = {
      id: "ws-root",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const worktree = {
      id: "ws-worktree",
      name: "codemoss/worktree",
      path: "/tmp/codemoss-worktree",
      connected: true,
      parentId: "ws-root",
      kind: "worktree" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
      worktree: {
        branch: "feature/incomplete",
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-worktree": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              partialSource: "local-session-scan-unavailable",
            },
          ],
        }}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "Refresh incomplete thread list" }),
    ).toHaveLength(1);
  });

  it("refreshes the degraded workspace from the workspace actions reload item", async () => {
    const workspace = {
      id: "ws-root",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const onQuickReloadWorkspaceThreads = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    const workspaceCard = screen
      .getByText("codemoss")
      .closest(".workspace-card");
    expect(workspaceCard).toBeTruthy();
    if (!workspaceCard) {
      throw new Error("Missing workspace card");
    }
    const menu = openWorkspaceActionsMenu(workspaceCard as HTMLElement);
    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "threads.reloadThreads" }),
      );
      await Promise.resolve();
    });
    expect(onQuickReloadWorkspaceThreads).toHaveBeenCalledWith("ws-root");
  });

  it("does not render a row refresh spinner while degraded threads are reloading", () => {
    const workspace = {
      id: "ws-root",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    const { container } = render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadListLoadingByWorkspace={{ "ws-root": true }}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    expect(
      container.querySelector(".sidebar-refresh-icon.is-spinning"),
    ).toBeNull();
  });

  it("hides the degraded refresh action when no quick reload handler is available", () => {
    const workspace = {
      id: "ws-root",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        onQuickReloadWorkspaceThreads={undefined}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Refresh incomplete thread list" }),
    ).toBeNull();
    const workspaceCard = screen
      .getByText("codemoss")
      .closest(".workspace-card");
    expect(workspaceCard).toBeTruthy();
    if (!workspaceCard) {
      throw new Error("Missing workspace card");
    }
    const menu = openWorkspaceActionsMenu(workspaceCard as HTMLElement);
    expect(
      within(menu).getByRole("menuitem", { name: "threads.reloadThreads" }),
    ).toBeTruthy();
  });

  it("toggles group collapse on whole header row click", async () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };

    const { container } = render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: "group-1",
            name: "Group One",
            workspaces: [workspace],
          },
        ]}
      />,
    );

    const groupHeader = container.querySelector(
      ".workspace-group-header",
    ) as HTMLElement | null;
    expect(groupHeader).toBeTruthy();
    if (!groupHeader) {
      throw new Error("Expected workspace group header");
    }
    expect(screen.getByText("codemoss")).toBeTruthy();

    await act(async () => {
      fireEvent.click(groupHeader);
    });
    expect(screen.queryByText("codemoss")).toBeNull();

    await act(async () => {
      fireEvent.click(groupHeader);
    });
    expect(screen.getByText("codemoss")).toBeTruthy();
  });

  it("renders ungrouped projects without showing an ungrouped section header", () => {
    const ungroupedWorkspace = {
      id: "ws-ungrouped",
      name: "codeg",
      path: "/tmp/codeg",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const groupedWorkspace = {
      id: "ws-grouped",
      name: "springboot-demo",
      path: "/tmp/springboot-demo",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[ungroupedWorkspace, groupedWorkspace]}
        groupedWorkspaces={[
          {
            id: "group-visible",
            name: "RCD",
            workspaces: [groupedWorkspace],
          },
          {
            id: null,
            name: "Ungrouped",
            workspaces: [ungroupedWorkspace],
          },
        ]}
      />,
    );

    expect(screen.getByText("codeg")).toBeTruthy();
    expect(screen.getByText("springboot-demo")).toBeTruthy();
    expect(screen.getByText("RCD")).toBeTruthy();
    expect(screen.queryByText("Ungrouped")).toBeNull();
  });

  it("selects an inactive workspace on single row click without opening home", () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };
    const onSelectWorkspace = vi.fn();
    const onOpenWorkspaceHome = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        onSelectWorkspace={onSelectWorkspace}
        onOpenWorkspaceHome={onOpenWorkspaceHome}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
      />,
    );

    const workspaceLabel = screen.getByText("codemoss");

    fireEvent.click(workspaceLabel);
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(onOpenWorkspaceHome).not.toHaveBeenCalled();
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("opens workspace home only when the already-active workspace row is clicked", () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const onSelectWorkspace = vi.fn();
    const onOpenWorkspaceHome = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        activeWorkspaceId="ws-1"
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        onSelectWorkspace={onSelectWorkspace}
        onOpenWorkspaceHome={onOpenWorkspaceHome}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
      />,
    );

    fireEvent.click(screen.getByText("codemoss"));
    expect(onOpenWorkspaceHome).toHaveBeenCalledWith("ws-1");
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("does not toggle the workspace when opening workspace actions", () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };
    const onSelectWorkspace = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        onSelectWorkspace={onSelectWorkspace}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));

    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it("triggers workspace engine refresh from the menu refresh button", async () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };
    const onRefreshEngineOptions = vi.fn(async () => ({
      activeEngine: "claude" as const,
      availableEngines: [
        {
          type: "claude" as const,
          displayName: "Claude Code",
          shortName: "Claude Code",
          installed: true,
          version: "1.0.0",
          error: null,
          availabilityState: "ready" as const,
          availabilityLabelKey: null,
        },
      ],
    }));

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        engineOptions={[]}
        onRefreshEngineOptions={onRefreshEngineOptions}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });

    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    await act(async () => {
      fireEvent.mouseDown(refreshButtons[0]!);
      fireEvent.click(refreshButtons[0]!);
      await Promise.resolve();
    });

    expect(onRefreshEngineOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("activates the workspace from the explicit main-panel action without toggling collapse", async () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };
    const onSelectWorkspace = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        onSelectWorkspace={onSelectWorkspace}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
      />,
    );

    const workspaceCard = screen
      .getByText("codemoss")
      .closest(".workspace-card");
    expect(workspaceCard).toBeTruthy();
    if (!workspaceCard) {
      throw new Error("Missing workspace card");
    }
    const menu = openWorkspaceActionsMenu(workspaceCard as HTMLElement);
    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "Open in main panel" }),
      );
      await Promise.resolve();
    });

    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("shows tooltips for the add workspace and workspace actions icons", async () => {
    vi.useFakeTimers();
    try {
      const workspace = {
        id: "ws-1",
        name: "codemoss",
        path: "/tmp/codemoss",
        connected: true,
        kind: "main" as const,
        settings: {
          sidebarCollapsed: true,
          worktreeSetupScript: null,
        },
      };

      render(
        <Sidebar
          {...baseProps}
          workspaces={[workspace]}
          groupedWorkspaces={[
            {
              id: null,
              name: "Ungrouped",
              workspaces: [workspace],
            },
          ]}
        />,
      );

      await act(async () => {
        fireEvent.mouseEnter(
          screen.getByRole("button", { name: "Add workspace" }),
        );
        await vi.advanceTimersByTimeAsync(250);
      });
      let tooltips = screen.getAllByRole("tooltip");
      expect(tooltips[tooltips.length - 1]?.textContent).toContain(
        "Add workspace",
      );

      await act(async () => {
        fireEvent.mouseLeave(
          screen.getByRole("button", { name: "Add workspace" }),
        );
        fireEvent.mouseEnter(
          screen.getByRole("button", { name: "New Session" }),
        );
        await vi.advanceTimersByTimeAsync(250);
      });
      tooltips = screen.getAllByRole("tooltip");
      expect(tooltips[tooltips.length - 1]?.textContent).toContain(
        "New Session",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("enables long-press reorder on collapse controls without a separate grip column", () => {
    const workspaces = [
      {
        id: "ws-a",
        name: "alpha",
        path: "/tmp/alpha",
        connected: true,
        kind: "main" as const,
        settings: { sidebarCollapsed: true, groupId: "g1", sortOrder: 0 },
      },
      {
        id: "ws-b",
        name: "beta",
        path: "/tmp/beta",
        connected: true,
        kind: "main" as const,
        settings: { sidebarCollapsed: true, groupId: "g1", sortOrder: 1 },
      },
    ];
    const { container } = render(
      <Sidebar
        {...baseProps}
        workspaces={workspaces}
        groupedWorkspaces={[
          {
            id: "g1",
            name: "开源项目",
            workspaces,
          },
        ]}
        onReorderWorkspaces={vi.fn()}
      />,
    );

    expect(container.querySelector(".workspace-sortable-list")).not.toBeNull();
    expect(container.querySelectorAll(".workspace-drag-handle")).toHaveLength(
      0,
    );
    expect(
      container.querySelectorAll(".workspace-card.is-reorderable"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".workspace-collapse-toggle.is-reorder-entry"),
    ).toHaveLength(2);
  });

  it("disables long-press reorder when callback is missing or the group has one project", () => {
    const alone = {
      id: "ws-a",
      name: "alpha",
      path: "/tmp/alpha",
      connected: true,
      kind: "main" as const,
      settings: { sidebarCollapsed: true, groupId: null, sortOrder: 0 },
    };
    const pair = [
      alone,
      {
        id: "ws-b",
        name: "beta",
        path: "/tmp/beta",
        connected: true,
        kind: "main" as const,
        settings: { sidebarCollapsed: true, groupId: null, sortOrder: 1 },
      },
    ];

    const withoutCallback = render(
      <Sidebar
        {...baseProps}
        workspaces={pair}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: pair }]}
      />,
    );
    expect(
      withoutCallback.container.querySelectorAll(
        ".workspace-card.is-reorderable",
      ),
    ).toHaveLength(0);
    withoutCallback.unmount();

    const single = render(
      <Sidebar
        {...baseProps}
        workspaces={[alone]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [alone] },
        ]}
        onReorderWorkspaces={vi.fn()}
      />,
    );
    expect(
      single.container.querySelectorAll(".workspace-card.is-reorderable"),
    ).toHaveLength(0);
  });
});
