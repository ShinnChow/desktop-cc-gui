// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { baseProps } from "./Sidebar.test-utils";
import { openWorkspaceActionsMenu } from "./SidebarTestSetup";
import {
  getClaudeProviders,
  getCodexProviders,
  getKimiProviders,
} from "../../../services/tauri";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY } from "../hooks/useSidebarSettingsPinnedActions";
import { pushErrorToast } from "../../../services/toasts";

import { Sidebar } from "./Sidebar";
import { isSessionCatalogNotReadyError } from "./sidebarInternals";

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
});
