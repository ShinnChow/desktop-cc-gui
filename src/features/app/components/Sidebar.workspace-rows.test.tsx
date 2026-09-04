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
import "./SidebarTestSetup";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("uses project alias only for the sidebar workspace label", () => {
    const workspace = {
      id: "ws-alias",
      name: "service",
      path: "/legacy/a/service",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
        projectAlias: "Billing Legacy",
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

    expect(screen.getByText("Billing Legacy")).toBeTruthy();
    expect(
      screen.getByLabelText("Workspace alias. Original name: service"),
    ).toBeTruthy();
    expect(screen.queryByText("service")).toBeNull();
  });

  it("does not show alias badge when project alias equals the original name", () => {
    const workspace = {
      id: "ws-alias-same",
      name: "service",
      path: "/legacy/a/service",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
        projectAlias: "service",
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

    expect(screen.getByText("service")).toBeTruthy();
    expect(
      screen.queryByLabelText("Workspace alias. Original name: service"),
    ).toBeNull();
  });

  it("restores locally persisted section collapse across menu reopens", async () => {
    const workspace = {
      id: "ws-collapse-persist",
      name: "service",
      path: "/legacy/a/service",
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

    // 第一次打开：折叠「工作区操作」栏（单组 new-session 不再 collapsible）。
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });
    const menu = screen.getByRole("menu", { name: /New Session/ });
    // 标题点明所属工作区。
    expect(
      screen.getByRole("menu", { name: "New Session · service" }),
    ).toBeTruthy();
    // 测试环境有翻译：工作区操作栏标题为 stub 文案。
    fireEvent.click(
      within(menu).getByRole("button", {
        name: "Workspace actions",
      }),
    );
    const workspaceActionsBody = document.getElementById(
      "sidebar-workspace-menu-group-workspace-actions",
    );
    expect(workspaceActionsBody?.hasAttribute("hidden")).toBe(true);

    // 关闭弹窗（点击遮罩）。
    const backdrop = document.querySelector(".sidebar-workspace-menu-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);
    expect(screen.queryByRole("menu", { name: "New Session" })).toBeNull();

    // 重新打开：「工作区操作」应保持折叠。
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });
    const reopened = screen.getByRole("menu", { name: /New Session/ });
    expect(
      within(reopened)
        .getByRole("button", {
          name: "Workspace actions",
        })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      document
        .getElementById("sidebar-workspace-menu-group-workspace-actions")
        ?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("triggers workspace alias prompt from the workspace menu", async () => {
    const workspace = {
      id: "ws-alias-menu",
      name: "service",
      path: "/legacy/a/service",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };
    const onRenameWorkspaceAlias = vi.fn();

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
        onRenameWorkspaceAlias={onRenameWorkspaceAlias}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });
    const menu = screen.getByRole("menu", { name: /New Session/ });
    const sectionToggle = within(menu).getByRole("button", {
      name: "Workspace actions",
    });
    if (sectionToggle.getAttribute("aria-expanded") === "false") {
      fireEvent.click(sectionToggle);
    }
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Set alias" }));

    expect(onRenameWorkspaceAlias).toHaveBeenCalledTimes(1);
    expect(onRenameWorkspaceAlias).toHaveBeenCalledWith(workspace);
  });

  it("shows neither an empty session message nor a loading skeleton for empty workspaces", () => {
    const workspace = {
      id: "ws-empty",
      name: "empty-workspace",
      path: "/tmp/empty-workspace",
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
        hydratedThreadListWorkspaceIds={new Set(["ws-empty"])}
        threadListLoadingByWorkspace={{ "ws-empty": true }}
      />,
    );

    // 「暂无会话」占位已下线：空工作区不再渲染任何占位文案。
    expect(screen.queryByText("No sessions yet.")).toBeNull();
    expect(screen.queryByLabelText("Loading agents")).toBeNull();
  });

  it("does not show the empty session message before the workspace thread list hydrates", () => {
    const workspace = {
      id: "ws-loading",
      name: "loading-workspace",
      path: "/tmp/loading-workspace",
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
        threadListLoadingByWorkspace={{ "ws-loading": true }}
      />,
    );

    expect(screen.queryByText("No sessions yet.")).toBeNull();
  });

  it("shows a loading state for a connected expanded workspace before its sessions hydrate", () => {
    const workspace = {
      id: "ws-unhydrated",
      name: "unhydrated-workspace",
      path: "/tmp/unhydrated-workspace",
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
      />,
    );

    expect(screen.getByText("Reading session index…")).toBeTruthy();
    expect(screen.queryByText("No sessions yet.")).toBeNull();
  });

  it("shows cached sessions before hydration finishes instead of masking them with loading", () => {
    const workspace = {
      id: "ws-cached",
      name: "cached-workspace",
      path: "/tmp/cached-workspace",
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
          "ws-cached": [
            {
              id: "thread-cached",
              name: "Cached session",
              updatedAt: 1,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Cached session")).toBeTruthy();
    expect(screen.queryByText("Reading session index…")).toBeNull();
  });

  it("shows neither loading nor an empty message for disconnected workspaces", () => {
    const workspace = {
      id: "ws-disconnected",
      name: "disconnected-workspace",
      path: "/tmp/disconnected-workspace",
      connected: false,
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
      />,
    );

    expect(screen.queryByText("Reading session index…")).toBeNull();
    expect(screen.queryByText("No sessions yet.")).toBeNull();
  });

  it("does not render workspace or worktree session count badges", () => {
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
        branch: "feature/countless",
      },
    };

    const { container } = render(
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
        runningSessionCountByWorkspaceId={{
          "ws-root": 13,
          "ws-worktree": 2,
        }}
        recentSessionCountByWorkspaceId={{
          "ws-root": 5,
          "ws-worktree": 3,
        }}
      />,
    );

    expect(container.querySelector(".workspace-session-signal")).toBeNull();
    expect(container.querySelector(".worktree-session-signal")).toBeNull();
  });
});
