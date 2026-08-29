// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { baseProps, resetSidebarTestMocks } from "./Sidebar.test-utils";
import {
  assignWorkspaceSessionFolder,
  createWorkspaceSessionFolder,
  getClaudeProviders,
  getCodexProviders,
  getKimiProviders,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
} from "../../../services/tauri";
import {
  resetClientStorageForTests,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY } from "../hooks/useSidebarSettingsPinnedActions";
import { pushErrorToast } from "../../../services/toasts";

import { Sidebar } from "./Sidebar";
import { isSessionCatalogNotReadyError } from "./sidebarInternals";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resetSidebarTestMocks();
  resetClientStorageForTests();
});

function openWorkspaceActionsMenu(workspaceCard: HTMLElement) {
  act(() => {
    fireEvent.click(
      within(workspaceCard).getByRole("button", { name: "New Session" }),
    );
  });
  const menu = screen.getByRole("menu", { name: /New Session/ });
  const sectionToggle = within(menu).getByRole("button", {
    name: "Workspace actions",
  });
  // 三栏默认全部展开：仅在被本地折叠时才点开展开。
  if (sectionToggle.getAttribute("aria-expanded") === "false") {
    act(() => {
      fireEvent.click(sectionToggle);
    });
  }
  return menu;
}

describe("sidebarInternals", () => {
  it("recognizes legacy and Codex provider-home unresolved session errors as retryable", () => {
    expect(
      isSessionCatalogNotReadyError(
        new Error("session does not belong to target workspace"),
      ),
    ).toBe(true);
    expect(
      isSessionCatalogNotReadyError(
        new Error(
          "Codex session target could not be resolved safely for this workspace; provider-home source may be incomplete or the session no longer belongs to this workspace",
        ),
      ),
    ).toBe(true);
  });
});

describe("Sidebar", () => {
  it("places workspace settings after add project and opens the dialog", async () => {
    const onChangeDefaultVisibleThreadRootCount = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        onChangeDefaultVisibleThreadRootCount={
          onChangeDefaultVisibleThreadRootCount
        }
      />,
    );

    const addButton = screen.getByRole("button", { name: "Add workspace" });
    const settingsButton = screen.getByTestId("workspace-settings-button");
    expect(settingsButton.getAttribute("aria-label")).toBe(
      "Workspace settings",
    );
    expect(addButton.nextElementSibling).toBe(settingsButton);

    fireEvent.click(settingsButton);
    expect(await screen.findByTestId("workspace-settings-dialog")).toBeTruthy();
  });

  it("loads Claude, Codex, and Kimi provider catalogs once on mount", async () => {
    render(<Sidebar {...baseProps} />);

    await waitFor(() => {
      expect(getClaudeProviders).toHaveBeenCalledTimes(1);
      expect(getCodexProviders).toHaveBeenCalledTimes(1);
      expect(getKimiProviders).toHaveBeenCalledTimes(1);
    });
  });

  it("reloads provider catalogs when settings invalidate the catalog", async () => {
    render(<Sidebar {...baseProps} />);

    await waitFor(() => {
      expect(getClaudeProviders).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(
      new CustomEvent("ccgui:provider-target-catalog-invalidated"),
    );

    await waitFor(() => {
      expect(getClaudeProviders).toHaveBeenCalledTimes(2);
      expect(getCodexProviders).toHaveBeenCalledTimes(2);
      expect(getKimiProviders).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces provider catalog load failures instead of silently clearing selection", async () => {
    vi.mocked(getKimiProviders).mockRejectedValueOnce(
      new Error("provider catalog unavailable"),
    );

    render(<Sidebar {...baseProps} />);

    await waitFor(() => {
      expect(pushErrorToast).toHaveBeenCalledWith({
        title: "sidebar.providerCatalogLoadFailed",
        message: "provider catalog unavailable",
        durationMs: 5000,
      });
    });
  });

  it("keeps search input hidden when search toggle is not present", () => {
    render(<Sidebar {...baseProps} />);

    expect(screen.queryByRole("button", { name: "Toggle search" })).toBeNull();
    expect(screen.queryByLabelText("Search projects")).toBeNull();
  });

  it("hides quick skills entry", () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
  });

  it("renders quick nav and workspace list containers", () => {
    const { container } = render(<Sidebar {...baseProps} />);

    expect(container.querySelector(".sidebar-primary-nav")).toBeTruthy();
    expect(container.querySelector(".sidebar-quick-icon-strip")).toBeNull();
    expect(container.querySelector(".sidebar-content-column")).toBeTruthy();
    expect(container.querySelector(".workspace-list")).toBeTruthy();
    expect(
      container.querySelector(".sidebar-section-title-icon-image"),
    ).toBeNull();
  });

  it("routes root session folder drafts through the controlled owner", async () => {
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
    const onRequestRootSessionFolderDraft = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        onRequestRootSessionFolderDraft={onRequestRootSessionFolderDraft}
      />,
    );

    await waitFor(() => expect(screen.getByText("codemoss")).toBeTruthy());
    const workspaceCard = screen
      .getByText("codemoss")
      .closest(".workspace-card");
    expect(workspaceCard).toBeTruthy();
    if (!workspaceCard) {
      throw new Error("Missing workspace card");
    }

    const menu = openWorkspaceActionsMenu(workspaceCard as HTMLElement);
    act(() => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "New folder" }),
      );
    });

    expect(onRequestRootSessionFolderDraft).toHaveBeenCalledWith("ws-1");
  });

  it("keeps runtime notice dock anchored in the bottom nav without an outer bubble entry", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        showRuntimeNoticeMenuItem
        runtimeNoticeDockNode={
          <div className="global-runtime-notice-dock-shell is-menu-anchored">
            <span className="global-runtime-notice-dock-anchor" />
          </div>
        }
      />,
    );

    const bottomNav = container.querySelector(".sidebar-bottom-nav");
    expect(bottomNav).toBeTruthy();
    const settingsButton = bottomNav?.querySelector(
      ".sidebar-primary-nav-item-bottom",
    );
    const runtimeNoticeBubble = bottomNav?.querySelector(
      ".global-runtime-notice-dock-bubble",
    );
    const runtimeNoticeAnchor = bottomNav?.querySelector(
      ".global-runtime-notice-dock-shell.is-menu-anchored",
    );
    expect(settingsButton).toBeTruthy();
    expect(runtimeNoticeBubble).toBeNull();
    expect(runtimeNoticeAnchor).toBeTruthy();
  });

  it("opens runtime notice from the settings secondary menu", async () => {
    const onOpenRuntimeNotice = vi.fn();
    const { container } = render(
      <Sidebar
        {...baseProps}
        showRuntimeNoticeMenuItem
        onOpenRuntimeNotice={onOpenRuntimeNotice}
      />,
    );

    const settingsToggle = container.querySelector(
      ".sidebar-primary-nav-item-bottom",
    );
    expect(settingsToggle).toBeTruthy();
    await act(async () => {
      fireEvent.click(settingsToggle as Element);
    });

    const dropdown = container.querySelector(".sidebar-settings-dropdown");
    expect(dropdown).toBeTruthy();
    const runtimeNoticeItem = within(dropdown as HTMLElement).getByRole(
      "menuitem",
      {
        name: "Runtime Notice",
      },
    );
    fireEvent.click(runtimeNoticeItem);
    expect(onOpenRuntimeNotice).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".sidebar-settings-dropdown")).toBeNull();
  });

  it("switches the runtime notice menu icon to alert when errors exist", async () => {
    const { container, rerender } = render(
      <Sidebar
        {...baseProps}
        showRuntimeNoticeMenuItem
        onOpenRuntimeNotice={vi.fn()}
        runtimeNoticeHasError={false}
      />,
    );

    const settingsToggle = container.querySelector(
      ".sidebar-primary-nav-item-bottom",
    );
    expect(settingsToggle).toBeTruthy();
    await act(async () => {
      fireEvent.click(settingsToggle as Element);
    });

    expect(
      container.querySelector(".sidebar-settings-runtime-notice-icon.is-idle"),
    ).toBeTruthy();
    expect(
      container.querySelector(
        ".sidebar-settings-runtime-notice-icon.is-has-error",
      ),
    ).toBeNull();

    await act(async () => {
      rerender(
        <Sidebar
          {...baseProps}
          showRuntimeNoticeMenuItem
          onOpenRuntimeNotice={vi.fn()}
          runtimeNoticeHasError
        />,
      );
    });

    expect(
      container.querySelector(
        ".sidebar-settings-runtime-notice-icon.is-has-error",
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(".sidebar-settings-runtime-notice-icon.is-idle"),
    ).toBeNull();
  });

  it("mirrors runtime notice error state on the pinned settings entry", async () => {
    writeClientStoreValue("app", SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY, [
      "runtime-notice",
    ]);

    const { container, rerender } = render(
      <Sidebar
        {...baseProps}
        showRuntimeNoticeMenuItem
        onOpenRuntimeNotice={vi.fn()}
        runtimeNoticeHasError={false}
      />,
    );

    const pinnedIdle = container.querySelector(
      '.sidebar-settings-pinned-item[data-runtime-notice-status="idle"]',
    );
    expect(pinnedIdle).toBeTruthy();
    expect(pinnedIdle?.classList.contains("is-runtime-notice-error")).toBe(
      false,
    );
    expect(
      pinnedIdle?.querySelector(
        ".sidebar-settings-runtime-notice-icon.is-idle",
      ),
    ).toBeTruthy();

    await act(async () => {
      rerender(
        <Sidebar
          {...baseProps}
          showRuntimeNoticeMenuItem
          onOpenRuntimeNotice={vi.fn()}
          runtimeNoticeHasError
        />,
      );
    });

    const pinnedError = container.querySelector(
      '.sidebar-settings-pinned-item[data-runtime-notice-status="has-error"]',
    );
    expect(pinnedError).toBeTruthy();
    expect(pinnedError?.classList.contains("is-runtime-notice-error")).toBe(
      true,
    );
    expect(
      pinnedError?.querySelector(
        ".sidebar-settings-runtime-notice-icon.is-has-error",
      ),
    ).toBeTruthy();
  });

  it("pins up to four settings actions, including network proxy, and blocks a fifth", async () => {
    const { container } = render(<Sidebar {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const dropdown = screen.getByRole("menu");
    const getPinBoxes = () =>
      within(dropdown).getAllByRole("checkbox", {
        name: "Show next to settings",
      });

    // lock / spec hub / project memory / git graph / network proxy
    expect(getPinBoxes()).toHaveLength(5);
    expect(
      within(dropdown).getByRole("menuitem", { name: "Network Proxy" }),
    ).toBeTruthy();

    for (const pinBox of getPinBoxes().slice(0, 4)) {
      await act(async () => {
        fireEvent.click(pinBox);
      });
    }

    const updatedPinBoxes =
      within(dropdown).getAllByRole<HTMLInputElement>("checkbox");
    expect(updatedPinBoxes.filter((pinBox) => pinBox.disabled)).toHaveLength(1);
    expect(updatedPinBoxes[4]?.disabled).toBe(true);
    expect(
      container.querySelectorAll(".sidebar-settings-pinned-item"),
    ).toHaveLength(4);
  });
  it("marks the macOS sidebar titlebar placeholder as a drag region", () => {
    const { container } = render(<Sidebar {...baseProps} />);

    const placeholder = container.querySelector(".sidebar-topbar-placeholder");
    expect(placeholder?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("keeps the sidebar topbar shell draggable around injected controls", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        topbarNode={
          <div
            data-testid="sidebar-topbar-interactive"
            data-tauri-drag-region="false"
          >
            toggle
          </div>
        }
      />,
    );

    const placeholder = container.querySelector(".sidebar-topbar-placeholder");
    const content = container.querySelector(".sidebar-topbar-content");
    expect(placeholder?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(content?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(
      screen
        .getByTestId("sidebar-topbar-interactive")
        .getAttribute("data-tauri-drag-region"),
    ).toBe("false");
  });

  it("shows search entry and triggers callback", () => {
    const onOpenGlobalSearch = vi.fn();
    render(<Sidebar {...baseProps} onOpenGlobalSearch={onOpenGlobalSearch} />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.click(searchButton);

    expect(onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it("does not render an automation entry in the primary nav", () => {
    const { container } = render(<Sidebar {...baseProps} />);

    expect(screen.queryByRole("button", { name: "Automation" })).toBeNull();
    expect(container.querySelector(".sidebar-primary-nav-badge")).toBeNull();
  });

  it("keeps Windows quick nav shortcuts in sync with configured settings while hiding J", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onOpenQuickSwitcher = vi.fn();
      const { container } = render(
        <Sidebar {...baseProps} onOpenQuickSwitcher={onOpenQuickSwitcher} />,
      );
      expect(screen.queryByText("Ctrl+J")).toBeNull();
      expect(screen.queryByText("Ctrl+K")).toBeNull();
      expect(screen.getByText("Ctrl+O")).toBeTruthy();
      expect(screen.getByText("Ctrl+E")).toBeTruthy();
      expect(
        container.querySelectorAll(
          ".sidebar-primary-nav .sidebar-primary-nav-shortcut",
        ),
      ).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Home" }).getAttribute("title"),
      ).toContain("Ctrl+J");
      expect(screen.queryByRole("button", { name: "Automation" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Search" }).getAttribute("title"),
      ).toContain("Ctrl+O");
      expect(
        screen
          .getByRole("button", { name: "Quick Switcher" })
          .getAttribute("title"),
      ).toContain("Ctrl+E");
      fireEvent.click(screen.getByRole("button", { name: "Quick Switcher" }));
      expect(onOpenQuickSwitcher).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("exposes hide conversation sidebar in settings menu when collapse handler is provided", async () => {
    const onCollapseSidebar = vi.fn();
    const { container } = render(
      <Sidebar {...baseProps} onCollapseSidebar={onCollapseSidebar} />,
    );

    const settingsToggle = container.querySelector(
      ".sidebar-primary-nav-item-bottom",
    );
    expect(settingsToggle).toBeTruthy();
    await act(async () => {
      fireEvent.click(settingsToggle as Element);
    });

    const dropdown = container.querySelector(".sidebar-settings-dropdown");
    expect(dropdown).toBeTruthy();
    const hideItem = within(dropdown as HTMLElement).getByRole("menuitem", {
      name: "Hide conversation sidebar",
    });
    fireEvent.click(hideItem);
    expect(onCollapseSidebar).toHaveBeenCalledTimes(1);
  });

  it("reflects cleared quick mode shortcuts in button hints", () => {
    render(
      <Sidebar
        {...baseProps}
        openChatShortcut={null}
        globalSearchShortcut={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Home" }).getAttribute("title"),
    ).toContain("Not set");
    expect(
      screen.getByRole("button", { name: "Search" }).getAttribute("title"),
    ).toContain("Not set");
  });

  it("hides removed and primary navigation entries in settings dropdown", async () => {
    const onToggleTerminal = vi.fn();
    const onAppModeChange = vi.fn();
    const { container } = render(
      <Sidebar
        {...baseProps}
        showTerminalButton
        isTerminalOpen={false}
        onToggleTerminal={onToggleTerminal}
        onAppModeChange={onAppModeChange}
      />,
    );

    const settingsToggle = container.querySelector(
      ".sidebar-primary-nav-item-bottom",
    );
    expect(settingsToggle).toBeTruthy();
    await act(async () => {
      fireEvent.click(settingsToggle as Element);
    });

    const dropdown = container.querySelector(".sidebar-settings-dropdown");
    expect(dropdown).toBeTruthy();
    const menu = within(dropdown as HTMLElement);

    expect(menu.queryByRole("menuitem", { name: "Home" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Automation" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Skills" })).toBeNull();
    expect(
      menu.queryByRole("menuitem", { name: "Hide conversation sidebar" }),
    ).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Lock" })).toBeTruthy();
    expect(
      menu.queryByRole("menuitem", { name: "Long-term Memory" }),
    ).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Spec Hub" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Project Memory" })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: "Release Notes" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Terminal" })).toBeNull();
    const gitGraphItem = menu.getByRole("menuitem", { name: "Git Graph" });
    expect(
      gitGraphItem.querySelector(".lucide-git-commit-horizontal"),
    ).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: "Open home" })).toBeNull();

    fireEvent.click(gitGraphItem);
    expect(onAppModeChange).toHaveBeenCalledWith("gitHistory");
    expect(container.querySelector(".sidebar-settings-dropdown")).toBeNull();
  });

  it("opens a proxy drawer from settings with the default address and persists edits", async () => {
    const onUpdateSystemProxy = vi.fn().mockResolvedValue(undefined);
    render(
      <Sidebar
        {...baseProps}
        systemProxyEnabled={false}
        systemProxyUrl={null}
        onUpdateSystemProxy={onUpdateSystemProxy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Network Proxy" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Network Proxy" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Proxy address") as HTMLInputElement).value,
    ).toBe("http://127.0.0.1:7890");

    fireEvent.click(screen.getByRole("switch", { name: "Enable proxy" }));
    await waitFor(() => {
      expect(onUpdateSystemProxy).toHaveBeenCalledWith({
        systemProxyEnabled: true,
        systemProxyUrl: "http://127.0.0.1:7890",
      });
    });

    fireEvent.change(screen.getByLabelText("Proxy address"), {
      target: { value: "socks5://127.0.0.1:1080" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save proxy settings" }),
    );
    await waitFor(() => {
      expect(onUpdateSystemProxy).toHaveBeenLastCalledWith({
        systemProxyEnabled: true,
        systemProxyUrl: "socks5://127.0.0.1:1080",
      });
    });
  });

  it("toggles the proxy drawer closed when the pinned network proxy button is clicked again", async () => {
    render(<Sidebar {...baseProps} />);

    // 先把 Network Proxy 勾选外显为 pinned 按钮
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dropdown = screen.getByRole("menu");
    await act(async () => {
      fireEvent.click(
        within(dropdown)
          .getAllByRole("checkbox", { name: "Show next to settings" })[4],
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Network Proxy" }));
    expect(screen.getByRole("dialog", { name: "Network Proxy" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Network Proxy" }));
    expect(screen.queryByRole("dialog", { name: "Network Proxy" })).toBeNull();
  });

  it("keeps Market disabled and opens Extensions as a separate mode", () => {
    const onAppModeChange = vi.fn();
    render(<Sidebar {...baseProps} onAppModeChange={onAppModeChange} />);

    expect(
      (screen.getByRole("button", { name: "Market" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    expect(onAppModeChange).toHaveBeenCalledWith("extensions");
  });

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

  it("restores locally persisted section collapse across drawer reopens", async () => {
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

    // 第一次打开：折叠 Native CLI 栏。
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });
    const menu = screen.getByRole("menu", { name: /New Session/ });
    // 标题点明所属工作区。
    expect(
      screen.getByRole("menu", { name: "New Session · service" }),
    ).toBeTruthy();
    // 测试环境无翻译：native 栏标题 name 即 i18n key。
    fireEvent.click(
      within(menu).getByRole("button", { name: /sidebar\.nativeCliGroupLabel/ }),
    );
    const nativeGroupBody = document.getElementById(
      "sidebar-workspace-menu-group-new-session",
    );
    expect(nativeGroupBody?.hasAttribute("hidden")).toBe(true);

    // 关闭抽屉（点击遮罩）。
    const backdrop = document.querySelector(".sidebar-workspace-drawer-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);
    expect(screen.queryByRole("menu", { name: "New Session" })).toBeNull();

    // 重新打开：Native CLI 应保持折叠。
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });
    const reopened = screen.getByRole("menu", { name: /New Session/ });
    expect(
      within(reopened)
        .getByRole("button", { name: /sidebar\.nativeCliGroupLabel/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      document
        .getElementById("sidebar-workspace-menu-group-new-session")
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
    // Shared CLI 已平铺成分组行：直接在 shared 分组容器内点 Claude Code。
    await act(async () => {
      const sharedGroupBody = document.getElementById(
        "sidebar-workspace-menu-group-new-session-shared",
      );
      fireEvent.click(
        within(sharedGroupBody!).getByRole("menuitem", { name: "Claude Code" }),
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
