// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMenuAction } from "../hooks/useSidebarMenus";
import {
  readSidebarWorkspaceMenuCollapsedSectionIds,
  SIDEBAR_WORKSPACE_MENU_COLLAPSED_SECTIONS_KEY,
} from "../hooks/useSidebarWorkspaceMenuSectionCollapse";
import {
  resetClientStorageForTests,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { SidebarWorkspaceMenuOverlay } from "./SidebarWorkspaceMenuOverlay";

const translations: Record<string, string> = {
  "sidebar.sessionActionsGroup": "New session",
  "sidebar.workspaceActionsGroup": "Workspace actions",
  "sidebar.unavailableTag": "Unavailable",
  "sidebar.nativeCliGroupLabel": "Native CLI",
  "sidebar.sharedCliHint": "Switchable engines",
  "sidebar.nativeCliHint": "Dedicated engine",
  "sidebar.sharedCliHelp": "Multiple CLIs share one context",
  "sidebar.nativeCliHelp": "Each session binds one engine",
  "sidebar.providerChoiceHelp":
    "Remembered for new sessions; manage in Settings → CLI Config.",
  "common.refresh": "Refresh",
  "common.close": "Close",
  "common.showOnWorkspaceRow": "Show on project row",
};

function t(key: string) {
  return translations[key] ?? key;
}

function createCodexAction(): WorkspaceMenuAction {
  return {
    id: "new-session-codex",
    label: "Codex",
    iconKind: "engine-codex",
    submenuTitle: "Provider selection",
    submenuHelpTip: t("sidebar.providerChoiceHelp"),
    selectionHint: "Selected. Click Codex to create a session.",
    selectedChildLabel: "Local config",
    onSelect: vi.fn(),
    children: [
      {
        id: "provider-disk",
        label: "Disk config",
        badgeLabel: "Disk config",
        iconKind: "engine-codex",
        keepMenuOpen: true,
        onSelect: vi.fn(),
      },
      {
        id: "provider-openai",
        label: "OpenAI",
        badgeLabel: "Custom config",
        iconKind: "engine-codex",
        keepMenuOpen: true,
        onSelect: vi.fn(),
      },
    ],
  };
}

function createSharedEngineAction(): WorkspaceMenuAction {
  return {
    id: "new-session-shared-grok",
    label: "Grok CLI",
    iconKind: "engine-grok",
    onSelect: vi.fn(),
  };
}

describe("SidebarWorkspaceMenuOverlay", () => {
  beforeEach(() => {
    resetClientStorageForTests();
  });

  it("renders Shared CLI engines as flat rows in their own group and runs the picked engine", () => {
    const sharedEngineAction = createSharedEngineAction();
    const onAction = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session-shared",
              label: "Shared CLI",
              actions: [sharedEngineAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    expect(screen.getByText("Shared CLI")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Grok CLI" }));

    expect(onAction).toHaveBeenCalledWith(sharedEngineAction);
  });

  it("scopes the drawer title to the workspace and renders section hints", () => {
    const workspaceStub = {
      id: "ws-1",
      name: "guanjia",
      path: "/tmp/guanjia",
      connected: true,
      kind: "main",
      settings: {},
    } as never;

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          workspace: workspaceStub,
          groups: [
            {
              id: "new-session-shared",
              label: "Shared CLI",
              hint: t("sidebar.sharedCliHint"),
              helpTip: t("sidebar.sharedCliHelp"),
              collapsible: true,
              actions: [createSharedEngineAction()],
            },
            {
              id: "new-session",
              label: "Native CLI",
              hint: t("sidebar.nativeCliHint"),
              helpTip: t("sidebar.nativeCliHelp"),
              collapsible: true,
              actions: [createCodexAction()],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    expect(
      screen.getByRole("menu", { name: "New session · guanjia" }),
    ).toBeTruthy();
    expect(screen.getByText("Switchable engines")).toBeTruthy();
    expect(screen.getByText("Dedicated engine")).toBeTruthy();
    // 「?」图标携带长语义说明（悬停气泡 data-tip / 读屏 aria-label）。
    expect(
      screen.getByRole("img", { name: "Multiple CLIs share one context" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Each session binds one engine" }),
    ).toBeTruthy();
  });

  it("renders the drawer header with a close button that closes the drawer", () => {
    const onClose = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "Native CLI",
              actions: [createCodexAction()],
            },
          ],
        }}
        t={t}
        onClose={onClose}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    expect(
      screen.getByRole("menu", { name: "New session" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("slides the drawer from the right edge when the sidebar layout is swapped", () => {
    const swappedApp = document.createElement("div");
    swappedApp.className = "app layout-swapped";
    document.body.appendChild(swappedApp);

    try {
      render(
        <SidebarWorkspaceMenuOverlay
          menu={{
            x: 32,
            y: 28,
            groups: [
              {
                id: "new-session",
                label: "Native CLI",
                actions: [createCodexAction()],
              },
            ],
          }}
          t={t}
          onClose={vi.fn()}
          onAction={vi.fn()}
          renderIcon={() => null}
        />,
      );

      const drawer = document.querySelector(".sidebar-workspace-drawer");
      expect(drawer).toBeTruthy();
      expect(drawer?.classList.contains("is-swapped")).toBe(true);
    } finally {
      swappedApp.remove();
    }
  });

  it("still opens an unavailable parent submenu so the user can pick another provider", () => {
    const claudeAction: WorkspaceMenuAction = {
      id: "new-session-claude",
      label: "Claude Code",
      iconKind: "engine-claude",
      unavailable: true,
      statusLabel: "Provider unavailable",
      onSelect: vi.fn(),
      children: [
        {
          id: "provider-local",
          label: "Local",
          iconKind: "engine-claude",
          keepMenuOpen: true,
          onSelect: vi.fn(),
        },
        {
          id: "provider-dead",
          label: "DS-zkp",
          iconKind: "engine-claude",
          unavailable: true,
          keepMenuOpen: true,
          onSelect: vi.fn(),
        },
      ],
    };
    const onAction = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [claudeAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Claude Code/ }),
    );

    expect(screen.getByRole("menuitemradio", { name: "Local" })).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(claudeAction.onSelect).not.toHaveBeenCalled();
  });

  it("expands every collapsible section by default and persists toggles locally", () => {
    const reloadAction: WorkspaceMenuAction = {
      id: "reload-threads",
      label: "Reload threads",
      iconKind: "reload",
      onSelect: vi.fn(),
    };

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session-shared",
              label: "Shared CLI",
              collapsible: true,
              actions: [createSharedEngineAction()],
            },
            {
              id: "new-session",
              label: "Native CLI",
              collapsible: true,
              actions: [createCodexAction()],
            },
            {
              id: "workspace-actions",
              label: "Workspace actions",
              collapsible: true,
              actions: [reloadAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    // 默认全部展开。
    expect(screen.getByRole("menuitem", { name: "Grok CLI" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Codex" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Reload threads" })).toBeTruthy();

    const toggle = screen.getByRole("button", { name: "Workspace actions" });
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menuitem", { name: "Reload threads" })).toBeNull();
    // 折叠态写入本地存储。
    expect(readSidebarWorkspaceMenuCollapsedSectionIds()).toEqual([
      "workspace-actions",
    ]);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Reload threads" })).toBeTruthy();
    expect(readSidebarWorkspaceMenuCollapsedSectionIds()).toEqual([]);
  });

  it("shows a busy disabled reload action while sessions are loading", () => {
    const action: WorkspaceMenuAction = {
      id: "reload-threads",
      label: "Reload threads",
      iconKind: "reload",
      refreshing: true,
      onSelect: vi.fn(),
    };
    render(
      <SidebarWorkspaceMenuOverlay
        menu={{ x: 0, y: 0, groups: [{ id: "workspace-actions", label: "Workspace actions", actions: [action] }] }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const item = screen.getByRole("menuitem", { name: "Reload threads" });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(item.getAttribute("aria-busy")).toBe("true");
    expect(item.classList.contains("is-refreshing")).toBe(true);
  });

  it("restores locally persisted collapsed sections on mount", () => {
    writeClientStoreValue("app", SIDEBAR_WORKSPACE_MENU_COLLAPSED_SECTIONS_KEY, [
      "new-session-shared",
    ]);

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session-shared",
              label: "Shared CLI",
              collapsible: true,
              actions: [createSharedEngineAction()],
            },
            {
              id: "new-session",
              label: "Native CLI",
              collapsible: true,
              actions: [createCodexAction()],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    expect(
      screen.queryByRole("menuitem", { name: "Grok CLI" }),
    ).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Codex" })).toBeTruthy();
  });

  it("renders child options in a fixed flyout outside the root menu", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 560,
    });
    const codexAction = createCodexAction();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const trigger = screen.getByRole("menuitem", { name: "Codex" });
    const rootMenu = screen.getByRole("menu", { name: "New session" });
    rootMenu.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 32,
          right: 272,
          top: 28,
          bottom: 160,
          width: 240,
          height: 132,
          x: 32,
          y: 28,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    trigger.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 40,
          right: 296,
          top: 96,
          bottom: 130,
          width: 256,
          height: 34,
          x: 40,
          y: 96,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    fireEvent.mouseEnter(trigger);

    const submenu = screen.getByRole("menu", { name: "Codex" });
    expect(submenu.classList.contains("sidebar-workspace-submenu")).toBe(true);
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-x")).toBe("272px");
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-y")).toBe("96px");
    expect(screen.getByText("Provider selection")).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getAllByText("Disk config")).toHaveLength(2);
    expect(screen.getByText("Custom config")).toBeTruthy();
    // 父行内联展示当前记住的供应商名。
    expect(
      screen.getByText("Local config").className,
    ).toBe("sidebar-workspace-menu-item-provider");
    // 子菜单标题旁「?」携带供应商说明（悬停气泡 / 读屏）。
    expect(
      screen.getByRole("img", {
        name: "Remembered for new sessions; manage in Settings → CLI Config.",
      }),
    ).toBeTruthy();
  });

  it("shows the selection hint after picking a provider that keeps the menu open", () => {
    const codexAction = createCodexAction();
    const onAction = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Codex" }));
    expect(
      screen.queryByText("Selected. Click Codex to create a session."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /OpenAI/ }));

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "provider-openai" }),
    );
    expect(
      screen.getByText("Selected. Click Codex to create a session."),
    ).toBeTruthy();
  });

  it("toggles pinned workspace actions without running the action", () => {
    const onAction = vi.fn();
    const onSelect = vi.fn();
    const onTogglePinned = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "workspace-actions",
              label: "Workspace actions",
              actions: [
                {
                  id: "reload-threads",
                  label: "Reload threads",
                  iconKind: "reload",
                  onSelect,
                  pinnable: true,
                  pinned: true,
                  onTogglePinned,
                },
              ],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Show on project row" });
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkbox);

    expect(onTogglePinned).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the child flyout to the left of the root menu near the viewport edge", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 620,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 560,
    });
    const codexAction = createCodexAction();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 330,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const trigger = screen.getByRole("menuitem", { name: "Codex" });
    const rootMenu = screen.getByRole("menu", { name: "New session" });
    rootMenu.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 330,
          right: 570,
          top: 28,
          bottom: 160,
          width: 240,
          height: 132,
          x: 330,
          y: 28,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    trigger.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 338,
          right: 562,
          top: 96,
          bottom: 130,
          width: 224,
          height: 34,
          x: 338,
          y: 96,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    fireEvent.mouseEnter(trigger);

    const submenu = screen.getByRole("menu", { name: "Codex" });
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-x")).toBe("70px");
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-y")).toBe("96px");
  });

  it("opens the child flyout with ArrowRight on the parent menu item", () => {
    const codexAction = createCodexAction();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const trigger = screen.getByRole("menuitem", { name: "Codex" });
    expect(screen.queryByRole("menu", { name: "Codex" })).toBeNull();

    fireEvent.keyDown(trigger, { key: "ArrowRight" });

    expect(screen.getByRole("menu", { name: "Codex" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: /OpenAI/ })).toBeTruthy();
  });

  it("portals the overlay to document.body so wallpaper stacking cannot bury it", () => {
    const { container } = render(
      <div className="sidebar">
        <SidebarWorkspaceMenuOverlay
          menu={{
            x: 32,
            y: 28,
            groups: [
              {
                id: "new-session-shared",
                label: "Shared CLI",
                actions: [createSharedEngineAction()],
              },
            ],
          }}
          t={t}
          onClose={vi.fn()}
          onAction={vi.fn()}
          renderIcon={() => null}
        />
      </div>,
    );

    const menu = screen.getByRole("menu", { name: "New session" });
    expect(menu.closest(".sidebar")).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
    expect(container.querySelector(".sidebar-workspace-menu")).toBeNull();
  });
});
