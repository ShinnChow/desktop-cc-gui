// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import {
  DEFAULT_UI_FONT_FAMILY,
} from "@/utils/fonts";
import { BasicAppearanceSection } from "./BasicAppearanceSection";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../../../../i18n", () => ({
  saveLanguage: vi.fn(),
  SUPPORTED_LANGUAGES: [
    { code: "zh", nativeName: "简体中文" },
    { code: "en", nativeName: "English" },
  ],
  default: {
    use: () => ({ init: vi.fn() }),
  },
}));

vi.mock("../../../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../../../services/tauri", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../../../../../services/tauri",
  );
  return {
    ...actual,
    importWorkspaceWallpaper: vi.fn(),
    removeWorkspaceWallpaper: vi.fn(),
    readWorkspaceWallpaperPreview: vi.fn(),
    searchWorkspaceWallpaperMarket: vi.fn(),
    downloadWorkspaceWallpaper: vi.fn(),
  };
});

const mockedLocalFonts = [
  { family: "Monaco" },
  { family: "Avenir" },
  { family: "SF Pro Text" },
] as const;

type WindowWithLocalFonts = Window & {
  queryLocalFonts?: () => Promise<Array<{ family: string }>>;
};

const queryLocalFontsMock = vi.fn<() => Promise<Array<{ family: string }>>>(
  () => new Promise<Array<{ family: string }>>(() => {}),
);

beforeEach(() => {
  queryLocalFontsMock.mockReset();
  queryLocalFontsMock.mockImplementation(
    () => new Promise<Array<{ family: string }>>(() => {}),
  );
  (window as WindowWithLocalFonts).queryLocalFonts = queryLocalFontsMock;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as WindowWithLocalFonts).queryLocalFonts;
});

const baseSettings = {
  uiScale: 1,
  theme: "system",
  lightThemePresetId: "vscode-light-modern",
  darkThemePresetId: "vscode-dark-modern",
  customThemePresetId: "vscode-dark-modern",
  canvasWidthMode: "narrow",
  layoutMode: "default",
  workspaceWallpaper: {
    mode: "none",
    customImagePath: null,
    fluidPreset: "mist",
    fluidMotion: "drift",
    veilOpacity: 0,
  },
  userMsgColor: "",
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  codeFontFamily: 'Monaco, "SF Mono", "SFMono-Regular", Menlo, monospace',
  codeFontSize: 11,
  openAppTargets: [],
  selectedOpenAppId: "",
} as unknown as AppSettings;

function renderSection(
  options: {
    appSettings?: Partial<AppSettings>;
    onUpdateAppSettings?: ComponentProps<
      typeof BasicAppearanceSection
    >["onUpdateAppSettings"];
    windowTransparencyEnabled?: boolean;
    onToggleWindowTransparency?: ComponentProps<
      typeof BasicAppearanceSection
    >["onToggleWindowTransparency"];
    windowOpacity?: number;
    onWindowOpacityChange?: ComponentProps<
      typeof BasicAppearanceSection
    >["onWindowOpacityChange"];
  } = {},
) {
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const onToggleWindowTransparency =
    options.onToggleWindowTransparency ?? vi.fn();
  const onWindowOpacityChange = options.onWindowOpacityChange ?? vi.fn();
  const props: ComponentProps<typeof BasicAppearanceSection> = {
    appSettings: { ...baseSettings, ...options.appSettings },
    onUpdateAppSettings,
    windowTransparencyEnabled: options.windowTransparencyEnabled ?? false,
    onToggleWindowTransparency,
    windowOpacity: options.windowOpacity ?? 88,
    onWindowOpacityChange,
    uiScaleDraft: 1,
    handleCommitUiScale: vi.fn(),
    handleResetUiScale: vi.fn(),
    scaleShortcutTitle: "Zoom in/out shortcut",
    scaleShortcutText: "Cmd + / Cmd -",
  };
  const view = render(<BasicAppearanceSection {...props} />);
  return {
    ...view,
    onUpdateAppSettings,
    onToggleWindowTransparency,
    onWindowOpacityChange,
  };
}

describe("BasicAppearanceSection", () => {
  it("commits ui font selection and code font dropdown changes", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    queryLocalFontsMock.mockResolvedValue([...mockedLocalFonts]);
    renderSection({ onUpdateAppSettings });

    const uiFontSelect = screen.getByTestId("settings-ui-font-select");
    await waitFor(() => {
      expect(
        within(uiFontSelect).getByRole("option", { name: "Avenir" }),
      ).toBeTruthy();
    });
    fireEvent.change(uiFontSelect, { target: { value: "Avenir" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiFontFamily: "Avenir" }),
      );
    });

    const codeFontSelect = screen.getByTestId("settings-code-font-select");
    fireEvent.change(codeFontSelect, { target: { value: "Avenir" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeFontFamily: "Avenir" }),
      );
    });
  });

  it("updates code font size from preset dropdown options", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderSection({ onUpdateAppSettings });

    const sizeSelect = screen.getByTestId(
      "settings-code-font-size-select",
    ) as HTMLSelectElement;

    expect(within(sizeSelect).getByRole("option", { name: "10px" })).toBeTruthy();
    expect(within(sizeSelect).getByRole("option", { name: "15px" })).toBeTruthy();

    fireEvent.change(sizeSelect, { target: { value: "14" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeFontSize: 14 }),
      );
    });
  });

  it("updates the active theme preset for dark appearance", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderSection({
      onUpdateAppSettings,
      appSettings: {
        theme: "custom",
        customThemePresetId: "vscode-dark-modern",
      },
    });

    fireEvent.change(await screen.findByLabelText("Theme Palette"), {
      target: { value: "vscode-dark-plus" },
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          customThemePresetId: "vscode-dark-plus",
          lightThemePresetId: "vscode-light-modern",
          darkThemePresetId: "vscode-dark-modern",
        }),
      );
    });
  });

  it("updates user message color using reference-compatible format", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const appRoot = document.createElement("div");
    appRoot.className = "app reduced-transparency";
    document.body.appendChild(appRoot);
    renderSection({ onUpdateAppSettings });

    fireEvent.click(
      screen.getByTestId("settings-user-msg-color-preset-6e40c9"),
    );

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ userMsgColor: "#6e40c9" }),
      );
    });
    expect(
      document.documentElement.style.getPropertyValue(
        "--color-message-user-bg",
      ),
    ).toBe("#6e40c9");
    expect(appRoot.style.getPropertyValue("--color-message-user-bg")).toBe(
      "#6e40c9",
    );

    fireEvent.change(screen.getByTestId("settings-user-msg-color-hex-input"), {
      target: { value: "#cf222e" },
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ userMsgColor: "#cf222e" }),
      );
    });

    const callCountBeforeInvalid = onUpdateAppSettings.mock.calls.length;
    fireEvent.change(screen.getByTestId("settings-user-msg-color-hex-input"), {
      target: { value: "#zzzzzz" },
    });

    expect(onUpdateAppSettings).toHaveBeenCalledTimes(callCountBeforeInvalid);
    appRoot.remove();
  });

  it("forwards window transparency toggle and opacity changes", async () => {
    const onToggleWindowTransparency = vi.fn();
    const onWindowOpacityChange = vi.fn();
    renderSection({
      windowTransparencyEnabled: false,
      onToggleWindowTransparency,
      onWindowOpacityChange,
    });

    fireEvent.click(screen.getByRole("switch", { name: "Window transparency" }));

    expect(onToggleWindowTransparency).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText("Overall opacity")).toBeNull();

    cleanup();
    renderSection({
      windowTransparencyEnabled: true,
      windowOpacity: 88,
      onToggleWindowTransparency,
      onWindowOpacityChange,
    });

    fireEvent.change(screen.getByLabelText("Overall opacity"), {
      target: { value: "72" },
    });

    expect(onWindowOpacityChange).toHaveBeenCalledWith(72);
  });
});
