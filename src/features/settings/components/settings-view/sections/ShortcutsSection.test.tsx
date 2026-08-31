// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { getDefaultInterruptShortcut } from "@/utils/shortcuts";
import {
  shortcutActions,
  type ShortcutSettingKey,
} from "../settingsViewShortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

afterEach(cleanup);

function renderSection(
  overrides: {
    appSettings?: Partial<AppSettings>;
    onUpdateAppSettings?: (next: AppSettings) => Promise<void>;
  } = {},
) {
  const settings = Object.fromEntries(
    shortcutActions.map((action) => [action.setting, action.defaultShortcut]),
  ) as Record<ShortcutSettingKey, string | null>;
  const onUpdateAppSettings =
    overrides.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  // Shortcut key records structurally satisfy the AppSettings fields the
  // section reads; the rest of AppSettings is irrelevant to this subtree.
  const appSettings = {
    ...settings,
    ...overrides.appSettings,
  } as unknown as AppSettings;
  const view = render(
    <ShortcutsSection
      active
      t={(key) => key}
      appSettings={appSettings}
      onUpdateAppSettings={onUpdateAppSettings}
    />,
  );
  return { onUpdateAppSettings, ...view };
}

describe("ShortcutsSection", () => {
  it("renders the twelve featured module actions in the first group", () => {
    const { container } = renderSection();

    const groups = container.querySelectorAll(".settings-shortcuts-group");
    const commonGroup = groups[0];
    expect(commonGroup?.textContent).toContain(
      "settings.commonModulesSubtitle",
    );
    expect(
      commonGroup?.querySelectorAll(".settings-shortcuts-row"),
    ).toHaveLength(12);
    expect(
      Array.from(
        commonGroup?.querySelectorAll(".settings-shortcuts-row-label") ?? [],
      ).map((node) => node.textContent),
    ).toEqual([
      "settings.toggleLeftConversationSidebar",
      "settings.toggleRightConversationSidebar",
      "git.historyQuickAction",
      "panels.files",
      "panels.git",
      "panels.notes",
      "panels.intentCanvas",
      "panels.radar",
      "panels.projectMap",
      "browserAgent.dock.panelTitle",
      "files.fileCompare.title",
      "settings.toggleTerminalPanel",
    ]);
  });

  it("exposes expand selection as a configurable editor shortcut", () => {
    const action = shortcutActions.find(
      (entry) => entry.id === "expand-selection",
    );

    expect(action).toMatchObject({
      setting: "expandSelectionShortcut",
      defaultShortcut: "cmd+w",
      category: "editor",
      scope: "editor",
      triggerSurface: "editor",
    });
  });

  it("shows the selected action in the detail panel when a row is clicked", () => {
    const { container } = renderSection();

    const layout = container.querySelector(".settings-shortcuts-layout");
    expect(layout?.getAttribute("data-mobile-pane")).toBe("list");

    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settings-shortcuts-row"),
    );
    const target = rows.find((row) =>
      row.textContent?.includes("settings.openSettings"),
    );
    expect(target).toBeTruthy();
    fireEvent.click(target!);

    expect(
      container.querySelector(".settings-shortcuts-detail-title")?.textContent,
    ).toBe("settings.openSettings");
    expect(target?.className).toContain("settings-shortcuts-row--selected");
    expect(layout?.getAttribute("data-mobile-pane")).toBe("detail");

    const back = container.querySelector<HTMLButtonElement>(
      ".settings-shortcuts-mobile-back",
    );
    expect(back).toBeTruthy();
    fireEvent.click(back!);
    expect(layout?.getAttribute("data-mobile-pane")).toBe("list");
  });

  it("filters rows by search query and shows an empty state when nothing matches", () => {
    const { container } = renderSection();

    const search = container.querySelector<HTMLInputElement>(
      ".settings-shortcuts-search-input",
    );
    expect(search).toBeTruthy();
    fireEvent.change(search!, { target: { value: "openSettings" } });

    const rows = container.querySelectorAll(".settings-shortcuts-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(
      Array.from(rows).every((row) =>
        row.textContent?.toLowerCase().includes("opensettings"),
      ),
    ).toBe(true);

    fireEvent.change(search!, { target: { value: "no-such-shortcut-xyz" } });
    expect(container.querySelectorAll(".settings-shortcuts-row")).toHaveLength(
      0,
    );
    expect(
      container.querySelector(".settings-shortcuts-empty")?.textContent,
    ).toBe("settings.noShortcutsFound");
  });

  it("resets only non-default shortcuts when reset-all is clicked", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const settings = Object.fromEntries(
      shortcutActions.map((action) => [action.setting, action.defaultShortcut]),
    ) as Record<ShortcutSettingKey, string | null>;
    settings.interruptShortcut = getDefaultInterruptShortcut();
    settings.openSettingsShortcut = "cmd+alt+o";
    const { container } = renderSection({
      appSettings: settings as unknown as Partial<AppSettings>,
      onUpdateAppSettings,
    });

    const resetAll = container.querySelector<HTMLButtonElement>(
      ".settings-shortcuts-reset-all",
    );
    expect(resetAll).toBeTruthy();
    fireEvent.click(resetAll!);

    await waitFor(() => expect(onUpdateAppSettings).toHaveBeenCalledTimes(1));
    expect(onUpdateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openSettingsShortcut: "cmd+," }),
    );
  });

  it("enters recording mode on recorder focus and persists the captured shortcut", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const { container } = renderSection({ onUpdateAppSettings });

    const recorder = container.querySelector<HTMLElement>(
      ".settings-shortcuts-recorder",
    );
    expect(recorder).toBeTruthy();

    fireEvent.focus(recorder!);
    expect(recorder?.className).toContain(
      "settings-shortcuts-recorder--recording",
    );
    expect(recorder?.textContent).toContain("settings.pressShortcutPrompt");

    fireEvent.keyDown(recorder!, { key: "k", metaKey: true });
    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          toggleLeftConversationSidebarShortcut: "cmd+k",
        }),
      );
    });

    fireEvent.blur(recorder!);
    expect(recorder?.className).not.toContain(
      "settings-shortcuts-recorder--recording",
    );
  });

  it("cancels recording on Escape without persisting a shortcut", () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const { container } = renderSection({ onUpdateAppSettings });

    const recorder = container.querySelector<HTMLElement>(
      ".settings-shortcuts-recorder",
    );
    fireEvent.focus(recorder!);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    recorder!.dispatchEvent(event);

    expect(onUpdateAppSettings).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
