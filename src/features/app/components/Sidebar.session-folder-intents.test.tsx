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
import {
  assignWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("moves pending engine folder intent after the real session exists", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
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
    const onAddAgent = vi.fn(async () => "claude-pending-123");

    const { rerender } = render(
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
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddAgent={onAddAgent}
        engineOptions={[
          {
            type: "claude",
            displayName: "Claude Code",
            shortName: "Claude",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
          },
        ]}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" }));
    });

    await vi.waitFor(() => {
      expect(onAddAgent).toHaveBeenCalledWith(
        workspace,
        "claude",
        expect.objectContaining({
          folderId: "folder-parent",
          providerProfileId: "__local_settings_json__",
        }),
      );
    });
    expect(assignWorkspaceSessionFolder).not.toHaveBeenCalled();
    expect(pushErrorToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not move session" }),
    );

    await act(async () => {
      rerender(
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
            "ws-1": [
              {
                id: "claude:older-session",
                name: "Older Claude session",
                updatedAt: 2,
                engineSource: "claude",
              },
              {
                id: "claude:real-session",
                name: "Real Claude session",
                updatedAt: 3,
                engineSource: "claude",
                nativeThreadIds: ["claude-pending-123"],
              },
            ],
          }}
          hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
          onAddAgent={onAddAgent}
          engineOptions={[
            {
              type: "claude",
              displayName: "Claude Code",
              shortName: "Claude",
              installed: true,
              version: "1.0.0",
              error: null,
              availabilityState: "ready",
            },
          ]}
        />,
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(assignWorkspaceSessionFolder).toHaveBeenCalledWith(
        "ws-1",
        "claude:real-session",
        "folder-parent",
      );
    });
  });

  it("does not guess a pending Claude folder intent when multiple real sessions exist", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
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
    const onAddAgent = vi.fn(async () => "claude-pending-123");

    const { rerender } = render(
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
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddAgent={onAddAgent}
        engineOptions={[
          {
            type: "claude",
            displayName: "Claude Code",
            shortName: "Claude",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
          },
        ]}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" }));
    });

    expect(assignWorkspaceSessionFolder).not.toHaveBeenCalled();

    await act(async () => {
      rerender(
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
            "ws-1": [
              {
                id: "claude:older-session",
                name: "Older Claude session",
                updatedAt: 2,
                engineSource: "claude",
              },
              {
                id: "claude:new-session-without-alias",
                name: "New Claude session without alias",
                updatedAt: 3,
                engineSource: "claude",
              },
            ],
          }}
          hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
          onAddAgent={onAddAgent}
          engineOptions={[
            {
              type: "claude",
              displayName: "Claude Code",
              shortName: "Claude",
              installed: true,
              version: "1.0.0",
              error: null,
              availabilityState: "ready",
            },
          ]}
        />,
      );
      await Promise.resolve();
    });

    expect(assignWorkspaceSessionFolder).not.toHaveBeenCalled();
  });

  it("keeps pending folder intent after retryable assignment failure", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    vi.mocked(assignWorkspaceSessionFolder)
      .mockRejectedValueOnce(
        new Error("session does not belong to target workspace"),
      )
      .mockResolvedValueOnce({
        sessionId: "claude:real-session",
        folderId: "folder-parent",
      });
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
    const onAddAgent = vi.fn(async () => "claude-pending-123");

    const { rerender } = render(
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
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddAgent={onAddAgent}
        engineOptions={[
          {
            type: "claude",
            displayName: "Claude Code",
            shortName: "Claude",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
          },
        ]}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" }));
    });

    const renderRealThread = (updatedAt: number) => (
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
          "ws-1": [
            {
              id: "claude:real-session",
              name: "Real Claude session",
              updatedAt,
              engineSource: "claude",
              nativeThreadIds: ["claude-pending-123"],
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddAgent={onAddAgent}
        engineOptions={[
          {
            type: "claude",
            displayName: "Claude Code",
            shortName: "Claude",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
          },
        ]}
      />
    );

    await act(async () => {
      rerender(renderRealThread(3));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(assignWorkspaceSessionFolder).toHaveBeenCalledTimes(1);
    });
    expect(pushErrorToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not move session" }),
    );

    await act(async () => {
      rerender(renderRealThread(4));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(assignWorkspaceSessionFolder).toHaveBeenCalledTimes(2);
      expect(assignWorkspaceSessionFolder).toHaveBeenLastCalledWith(
        "ws-1",
        "claude:real-session",
        "folder-parent",
      );
    });
  });

  it("keeps the real Claude session visibly in the folder after non-retryable assignment failure", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    vi.mocked(assignWorkspaceSessionFolder).mockRejectedValueOnce(
      new Error("permission denied"),
    );
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
    const onAddAgent = vi.fn(async () => "claude-pending-123");

    const { rerender } = render(
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
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddAgent={onAddAgent}
        engineOptions={[
          {
            type: "claude",
            displayName: "Claude Code",
            shortName: "Claude",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
          },
        ]}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" }));
    });

    await act(async () => {
      rerender(
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
            "ws-1": [
              {
                id: "claude:real-session",
                name: "Real Claude session",
                updatedAt: 3,
                engineSource: "claude",
                nativeThreadIds: ["claude-pending-123"],
              },
            ],
          }}
          hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
          onAddAgent={onAddAgent}
          engineOptions={[
            {
              type: "claude",
              displayName: "Claude Code",
              shortName: "Claude",
              installed: true,
              version: "1.0.0",
              error: null,
              availabilityState: "ready",
            },
          ]}
        />,
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(assignWorkspaceSessionFolder).toHaveBeenCalledWith(
        "ws-1",
        "claude:real-session",
        "folder-parent",
      );
      expect(pushErrorToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not move session",
          message: "permission denied",
        }),
      );
    });

    await vi.waitFor(() => {
      const planningGroup = screen
        .getByRole("treeitem", { name: "Planning" })
        .closest(".workspace-session-folder-group") as HTMLElement | null;
      expect(planningGroup).toBeTruthy();
      if (!planningGroup) {
        throw new Error("Missing Planning folder group");
      }
      expect(
        within(planningGroup).getByText("Real Claude session"),
      ).toBeTruthy();
    });
  });

  it("moves codex pending folder intent after catalog-backed session exists", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
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
    const onAddAgent = vi.fn(async () => "codex-pending-123");

    const { rerender } = render(
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
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddAgent={onAddAgent}
        engineOptions={[
          {
            type: "codex",
            displayName: "Codex",
            shortName: "Codex",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
          },
        ]}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    // Shared / Native 拆组后 Codex 有两行；此处要 native 行（带供应商子菜单）。
    const codexItem = screen
      .getAllByRole("menuitem", { name: "Codex" })
      .find((item) => item.getAttribute("aria-haspopup") === "menu")!;
    fireEvent.mouseEnter(codexItem);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: /本地配置/ }));
      fireEvent.click(codexItem);
    });

    await vi.waitFor(() => {
      expect(onAddAgent).toHaveBeenCalledWith(workspace, "codex", {
        folderId: "folder-parent",
        providerProfileId: "__disk__",
        providerProfile: {
          id: "__disk__",
          name: "本地配置",
          source: "disk",
        },
      });
    });
    expect(assignWorkspaceSessionFolder).not.toHaveBeenCalled();

    await act(async () => {
      rerender(
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
            "ws-1": [
              {
                id: "codex:real-session",
                name: "Real Codex session",
                updatedAt: 3,
                engineSource: "codex",
              },
            ],
          }}
          hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
          onAddAgent={onAddAgent}
          engineOptions={[
            {
              type: "codex",
              displayName: "Codex",
              shortName: "Codex",
              installed: true,
              version: "1.0.0",
              error: null,
              availabilityState: "ready",
            },
          ]}
        />,
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(assignWorkspaceSessionFolder).toHaveBeenCalledWith(
        "ws-1",
        "codex:real-session",
        "folder-parent",
      );
    });
  });
});
