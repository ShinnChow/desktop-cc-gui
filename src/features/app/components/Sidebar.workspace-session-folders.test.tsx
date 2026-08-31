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
import {
  assignWorkspaceSessionFolder,
  createWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders workspace session folders without changing visible session membership", async () => {
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
        {
          id: "folder-child",
          workspaceId: "ws-1",
          parentId: "folder-parent",
          name: "Claude fixes",
          createdAt: 2,
          updatedAt: 2,
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
          "ws-1": [
            {
              id: "root-session",
              name: "Root session",
              updatedAt: 3,
              folderId: null,
            },
            {
              id: "claude:folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-child",
              engineSource: "claude",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    expect(await screen.findByText("Planning")).toBeTruthy();
    expect(screen.getByText("Claude fixes")).toBeTruthy();
    const workspaceCard = screen
      .getByText("codemoss")
      .closest(".workspace-card");
    expect(workspaceCard).toBeTruthy();
    if (!workspaceCard) {
      throw new Error("Missing workspace card");
    }
    const menu = openWorkspaceActionsMenu(workspaceCard as HTMLElement);
    expect(
      within(menu).getByRole("menuitem", { name: "New folder" }),
    ).toBeTruthy();
    expect(screen.getByText("Root session")).toBeTruthy();
    expect(screen.getByText("Folder session")).toBeTruthy();
    expect(document.querySelectorAll(".thread-row")).toHaveLength(2);
  });

  it("creates and renames workspace session folders in the current project scope", async () => {
    vi.mocked(listWorkspaceSessionFolders)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
          {
            id: "folder-child",
            workspaceId: "ws-1",
            parentId: "folder-parent",
            name: "Follow ups",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [
          {
            id: "folder-parent",
            workspaceId: "ws-1",
            parentId: null,
            name: "Roadmap",
            createdAt: 1,
            updatedAt: 3,
          },
          {
            id: "folder-child",
            workspaceId: "ws-1",
            parentId: "folder-parent",
            name: "Follow ups",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });
    vi.mocked(createWorkspaceSessionFolder).mockResolvedValueOnce({
      folder: {
        id: "folder-child",
        workspaceId: "ws-1",
        parentId: "folder-parent",
        name: "Follow ups",
        createdAt: 2,
        updatedAt: 2,
      },
    });
    vi.mocked(renameWorkspaceSessionFolder).mockResolvedValueOnce({
      folder: {
        id: "folder-parent",
        workspaceId: "ws-1",
        parentId: null,
        name: "Roadmap",
        createdAt: 1,
        updatedAt: 3,
      },
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
          "ws-1": [
            { id: "root-session", name: "Root session", updatedAt: 7 },
            {
              id: "folder-session-1",
              name: "Folder session 1",
              updatedAt: 6,
              folderId: "folder-target",
            },
            {
              id: "folder-session-2",
              name: "Folder session 2",
              updatedAt: 5,
              folderId: "folder-target",
            },
            {
              id: "folder-session-3",
              name: "Folder session 3",
              updatedAt: 4,
              folderId: "folder-target",
            },
            {
              id: "folder-session-4",
              name: "Folder session 4",
              updatedAt: 3,
              folderId: "folder-target",
            },
            {
              id: "folder-session-5",
              name: "Folder session 5",
              updatedAt: 2,
              folderId: "folder-target",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    expect(await screen.findByText("Planning")).toBeTruthy();
    const planningRow = screen
      .getByText("Planning")
      .closest(".workspace-session-folder-row") as HTMLElement | null;
    expect(planningRow).toBeTruthy();
    if (!planningRow) {
      throw new Error("Missing Planning folder row");
    }
    fireEvent.click(
      within(planningRow).getByRole("button", { name: "Folder actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "New folder in project" }),
    );
    fireEvent.change(screen.getByLabelText("Folder name"), {
      target: { value: " Follow ups " },
    });
    fireEvent.keyDown(screen.getByLabelText("Folder name"), { key: "Enter" });

    expect(createWorkspaceSessionFolder).toHaveBeenCalledWith(
      "ws-1",
      "Follow ups",
      "folder-parent",
    );
    expect(await screen.findByText("Follow ups")).toBeTruthy();

    fireEvent.click(
      within(planningRow).getByRole("button", { name: "Folder actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename folder" }));
    const renameInput = screen.getByDisplayValue("Planning");
    fireEvent.change(renameInput, { target: { value: " Roadmap " } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(renameWorkspaceSessionFolder).toHaveBeenCalledWith(
      "ws-1",
      "folder-parent",
      "Roadmap",
    );
    expect(await screen.findByText("Roadmap")).toBeTruthy();
  });

  it("creates a new session directly inside a workspace session folder", async () => {
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
    vi.mocked(assignWorkspaceSessionFolder).mockResolvedValueOnce({
      sessionId: "thread-created",
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
    const onAddAgent = vi.fn(async () => "thread-created");
    const onQuickReloadWorkspaceThreads = vi.fn();

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
        onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    expect(screen.getByRole("menuitem", { name: "Claude Code" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", {
        name: /Claude Code.*CLI not installed/,
      }),
    ).toBeNull();
    // Shared / Native 拆组后 Codex 有两行；此处要 native 行（带供应商子菜单）。
    const codexItem = screen
      .getAllByRole("menuitem", { name: /Codex/ })
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
      expect(assignWorkspaceSessionFolder).toHaveBeenCalledWith(
        "ws-1",
        "thread-created",
        "folder-parent",
      );
    });
    expect(onQuickReloadWorkspaceThreads).toHaveBeenCalledWith("ws-1");
  });

  it("keeps shared session folder placement local without native assignment retry", async () => {
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
    const onAddSharedAgent = vi.fn(async () => "shared:session-1");

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
          "ws-1": [
            {
              id: "shared:session-1",
              name: "Shared Session",
              updatedAt: 3,
              threadKind: "shared",
              engineSource: "claude",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onAddSharedAgent={onAddSharedAgent}
        engineOptions={[
          {
            type: "claude",
            displayName: "Claude Code",
            shortName: "Claude Code",
            installed: true,
            version: "1.0.0",
            error: null,
            availabilityState: "ready",
            availabilityLabelKey: null,
          },
        ]}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.click(
      within(folderRow).getByRole("button", { name: "New session in project" }),
    );
    // Shared CLI 回归首行二级菜单：点父行展开 flyout，再点其中的 Claude Code。
    await act(async () => {
      const sessionGroupBody = document.getElementById(
        "sidebar-workspace-menu-group-new-session",
      );
      fireEvent.click(
        within(sessionGroupBody!).getByRole("menuitem", {
          name: /Shared CLI/,
        }),
      );
    });
    await act(async () => {
      fireEvent.click(
        // 子行名带 badgeLabel（记住的供应商），用正则匹配引擎名。
        screen.getByRole("menuitemradio", { name: /Claude Code/ }),
      );
    });

    await vi.waitFor(() => {
      expect(onAddSharedAgent).toHaveBeenCalledWith(workspace, "claude");
    });
    expect(assignWorkspaceSessionFolder).not.toHaveBeenCalled();
    expect(pushErrorToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not move session" }),
    );
    expect(await screen.findByText("Shared Session")).toBeTruthy();
  });
});
