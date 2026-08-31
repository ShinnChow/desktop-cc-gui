// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { baseProps } from "./Sidebar.test-utils";
import { openWorkspaceActionsMenu } from "./SidebarTestSetup";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("shows pinned threads even when pinned version is zero", () => {
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
    const thread = {
      id: "thread-1",
      name: "Pinned Restored",
      updatedAt: 123,
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
        threadsByWorkspace={{ "ws-1": [thread] }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        getPinTimestamp={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-1" ? 111 : null
        }
        isThreadPinned={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-1"
        }
      />,
    );

    expect(screen.getByText("Pinned Restored")).toBeTruthy();
  });

  it("keeps pinned and workspace thread rows aligned with thread summary titles", () => {
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
    const pinnedThread = {
      id: "thread-pinned",
      name: "项目分析",
      updatedAt: 500,
      engineSource: "codex" as const,
      providerProfileName: "Pinned Provider",
      isDegraded: true,
      partialSource: "local-session-scan-unavailable",
      degradedReason: "partial-thread-list",
    };
    const regularThread = {
      id: "thread-regular",
      name: "给我生成一张图",
      updatedAt: 400,
      engineSource: "codex" as const,
      sourceLabel: "Regular Provider",
    };

    const { container, rerender } = render(
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
        threadsByWorkspace={{ "ws-1": [pinnedThread, regularThread] }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        getPinTimestamp={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-pinned" ? 111 : null
        }
        isThreadPinned={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-pinned"
        }
        pinnedThreadsVersion={1}
      />,
    );

    const pinnedSection = container.querySelector(".sidebar-pinned-section");
    expect(pinnedSection).toBeTruthy();
    expect(
      within(pinnedSection as HTMLElement).getByText("项目分析"),
    ).toBeTruthy();

    const workspaceList = container.querySelector(".workspace-list");
    expect(workspaceList).toBeTruthy();
    expect(
      within(workspaceList as HTMLElement).getByText("给我生成一张图"),
    ).toBeTruthy();
    expect(screen.queryByText("Agent 20")).toBeNull();
    expect(screen.queryByText("Codex Session")).toBeNull();
    expect(screen.queryByText("Pinned Provider")).toBeNull();
    expect(screen.queryByText("Regular Provider")).toBeNull();

    rerender(
      <Sidebar
        {...baseProps}
        showProviderLabels
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{ "ws-1": [pinnedThread, regularThread] }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        getPinTimestamp={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-pinned" ? 111 : null
        }
        isThreadPinned={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-pinned"
        }
        pinnedThreadsVersion={1}
      />,
    );

    expect(screen.getByText("Pinned Provider")).toBeTruthy();
    expect(screen.getByText("Regular Provider")).toBeTruthy();
  });

  it("removes newly pinned thread from project list immediately", () => {
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
    const thread = {
      id: "thread-1",
      name: "Pin Me",
      updatedAt: 123,
    };
    let isPinned = false;
    const getPinTimestamp = (workspaceId: string, threadId: string) =>
      workspaceId === "ws-1" && threadId === "thread-1" && isPinned
        ? 111
        : null;
    const isThreadPinned = (workspaceId: string, threadId: string) =>
      workspaceId === "ws-1" && threadId === "thread-1" && isPinned;

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
        threadsByWorkspace={{ "ws-1": [thread] }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        getPinTimestamp={getPinTimestamp}
        isThreadPinned={isThreadPinned}
        pinnedThreadsVersion={0}
      />,
    );

    expect(screen.getAllByText("Pin Me")).toHaveLength(1);

    isPinned = true;
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
        threadsByWorkspace={{ "ws-1": [thread] }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        getPinTimestamp={getPinTimestamp}
        isThreadPinned={isThreadPinned}
        pinnedThreadsVersion={1}
      />,
    );

    expect(screen.getAllByText("Pin Me")).toHaveLength(1);
  });

  it("adds running animation class to the project folder collapse affordance when any session is processing", () => {
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
        branch: "feature/running",
      },
    };
    const runningThread = {
      id: "thread-running",
      name: "Running thread",
      updatedAt: 123,
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
        threadsByWorkspace={{ "ws-worktree": [runningThread] }}
        threadStatusById={{
          "thread-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const rootWorkspaceCard = container.querySelector(".workspace-card");
    const projectCollapseToggle = rootWorkspaceCard?.querySelector(
      ".workspace-collapse-toggle",
    );
    expect(
      projectCollapseToggle?.classList.contains("workspace-folder-btn"),
    ).toBe(true);
    expect(
      projectCollapseToggle?.classList.contains("is-session-running"),
    ).toBe(true);
    const worktreeIcon = container.querySelector(".worktree-node-icon");
    expect(worktreeIcon?.classList.contains("is-session-running")).toBe(true);
  });

  it("keeps exited-session visibility isolated per workspace", async () => {
    const workspaceAlpha = {
      id: "ws-alpha",
      name: "alpha",
      path: "/tmp/alpha",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const workspaceBeta = {
      id: "ws-beta",
      name: "beta",
      path: "/tmp/beta",
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
        workspaces={[workspaceAlpha, workspaceBeta]}
        hydratedThreadListWorkspaceIds={new Set(["ws-alpha", "ws-beta"])}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspaceAlpha, workspaceBeta],
          },
        ]}
        threadsByWorkspace={{
          "ws-alpha": [
            { id: "alpha-running", name: "Alpha running", updatedAt: 2 },
            { id: "alpha-exited", name: "Alpha exited", updatedAt: 1 },
          ],
          "ws-beta": [
            { id: "beta-running", name: "Beta running", updatedAt: 2 },
            { id: "beta-exited", name: "Beta exited", updatedAt: 1 },
          ],
        }}
        threadStatusById={{
          "alpha-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "alpha-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
          "beta-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "beta-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const alphaCard = screen
      .getByText("alpha")
      .closest(".workspace-card") as HTMLElement | null;
    const betaCard = screen
      .getByText("beta")
      .closest(".workspace-card") as HTMLElement | null;
    expect(alphaCard).toBeTruthy();
    expect(betaCard).toBeTruthy();
    if (!alphaCard || !betaCard) {
      throw new Error("Missing workspace cards");
    }

    const menu = openWorkspaceActionsMenu(alphaCard);
    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "Hide exited sessions" }),
      );
      await Promise.resolve();
    });

    expect(within(alphaCard).queryByText("Alpha exited")).toBeNull();
    expect(within(alphaCard).queryByText("Alpha running")).toBeTruthy();
    const alphaMenu = openWorkspaceActionsMenu(alphaCard);
    expect(
      within(alphaMenu).getByRole("menuitem", { name: "Show exited sessions" }),
    ).toBeTruthy();

    expect(within(betaCard).getByText("Beta exited")).toBeTruthy();
    expect(within(betaCard).getByText("Beta running")).toBeTruthy();
  });

  it("does not collapse the workspace row when the exited-session toggle is activated by keyboard", async () => {
    const workspace = {
      id: "ws-alpha",
      name: "alpha",
      path: "/tmp/alpha",
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
          "ws-alpha": [
            { id: "alpha-running", name: "Alpha running", updatedAt: 2 },
            { id: "alpha-exited", name: "Alpha exited", updatedAt: 1 },
          ],
        }}
        threadStatusById={{
          "alpha-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "alpha-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-alpha"])}
      />,
    );

    const alphaCard = screen
      .getByText("alpha")
      .closest(".workspace-card") as HTMLElement | null;
    expect(alphaCard).toBeTruthy();
    if (!alphaCard) {
      throw new Error("Missing workspace card");
    }

    const menu = openWorkspaceActionsMenu(alphaCard);
    const toggle = within(menu).getByRole("menuitem", {
      name: "Hide exited sessions",
    });
    await act(async () => {
      fireEvent.keyDown(toggle, { key: "Enter" });
      fireEvent.click(toggle);
      fireEvent.keyUp(toggle, { key: "Enter" });
      await Promise.resolve();
    });

    expect(within(alphaCard).queryByText("Alpha exited")).toBeNull();
    expect(within(alphaCard).getByText("Alpha running")).toBeTruthy();
  });

  it("lets worktrees toggle exited-session visibility without affecting the parent project", async () => {
    const workspace = {
      id: "ws-root",
      name: "root",
      path: "/tmp/root",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const worktree = {
      id: "ws-worktree",
      name: "root/feature-hidden",
      path: "/tmp/root-feature-hidden",
      connected: true,
      parentId: "ws-root",
      kind: "worktree" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
      worktree: {
        branch: "feature-hidden",
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
          "ws-root": [
            { id: "root-running", name: "Root running", updatedAt: 2 },
            { id: "root-exited", name: "Root exited", updatedAt: 1 },
          ],
          "ws-worktree": [
            { id: "worktree-running", name: "Worktree running", updatedAt: 2 },
            { id: "worktree-exited", name: "Worktree exited", updatedAt: 1 },
          ],
        }}
        threadStatusById={{
          "root-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "root-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
          "worktree-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "worktree-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const worktreeCard = screen
      .getByText("feature-hidden")
      .closest(".worktree-card") as HTMLElement | null;
    expect(worktreeCard).toBeTruthy();
    if (!worktreeCard) {
      throw new Error("Missing worktree card");
    }

    await act(async () => {
      fireEvent.click(
        within(worktreeCard).getByRole("button", {
          name: "Hide exited sessions",
        }),
      );
    });

    expect(within(worktreeCard).queryByText("Worktree exited")).toBeNull();
    expect(within(worktreeCard).getByText("Worktree running")).toBeTruthy();
    expect(screen.getByText("Root exited")).toBeTruthy();
  });

  it("does not collapse the worktree row when the exited-session toggle is activated by keyboard", async () => {
    const workspace = {
      id: "ws-root",
      name: "root",
      path: "/tmp/root",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const worktree = {
      id: "ws-worktree",
      name: "root/feature-hidden",
      path: "/tmp/root-feature-hidden",
      connected: true,
      parentId: "ws-root",
      kind: "worktree" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
      worktree: {
        branch: "feature-hidden",
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
          "ws-root": [
            { id: "root-running", name: "Root running", updatedAt: 2 },
          ],
          "ws-worktree": [
            { id: "worktree-running", name: "Worktree running", updatedAt: 2 },
            { id: "worktree-exited", name: "Worktree exited", updatedAt: 1 },
          ],
        }}
        threadStatusById={{
          "root-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "worktree-running": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
          },
          "worktree-exited": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
      />,
    );

    const worktreeCard = screen
      .getByText("feature-hidden")
      .closest(".worktree-card") as HTMLElement | null;
    expect(worktreeCard).toBeTruthy();
    if (!worktreeCard) {
      throw new Error("Missing worktree card");
    }

    const toggle = within(worktreeCard).getByRole("button", {
      name: "Hide exited sessions",
    });
    await act(async () => {
      fireEvent.keyDown(toggle, { key: "Spacebar" });
      fireEvent.click(toggle);
      fireEvent.keyUp(toggle, { key: "Spacebar" });
    });

    expect(within(worktreeCard).queryByText("Worktree exited")).toBeNull();
    expect(within(worktreeCard).getByText("Worktree running")).toBeTruthy();
  });
});
