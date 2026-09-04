// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetClientStorageForTests } from "../../../services/clientStorage";
import { PanelTabs } from "./PanelTabs";

describe("PanelTabs", () => {
  beforeEach(() => {
    // 隔离每个用例的 pin 状态，回到默认外显 files/git
    resetClientStorageForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the active tab and overflow trigger as non-drag interactive controls", () => {
    const onSelect = vi.fn();

    render(<PanelTabs active="files" onSelect={onSelect} />);

    const filesButton = screen.getByRole("button", { name: "panels.files" });
    const moreButton = screen.getByRole("button", { name: "common.moreActions" });

    expect(screen.getByRole("tablist").hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(filesButton.getAttribute("data-tauri-drag-region")).toBe("false");
    expect(moreButton.getAttribute("data-tauri-drag-region")).toBe("false");

    fireEvent.pointerDown(moreButton, {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "panels.search" }));
    expect(onSelect).toHaveBeenCalledWith("search");
  });

  it("keeps the memoized identity visible to interaction-lane guards", () => {
    expect(PanelTabs.displayName).toBe("PanelTabs");
  });

  it("shows a tooltip when hovering an icon-only panel tab", async () => {
    const onSelect = vi.fn();

    render(<PanelTabs active="search" onSelect={onSelect} />);

    await act(async () => {
      fireEvent.mouseEnter(screen.getByRole("button", { name: "panels.search" }));
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByRole("tooltip").textContent).toContain("panels.search");
  });

  it("does not expose the activity tab while session-activity kill-switch is on", () => {
    const onSelect = vi.fn();

    render(
      <PanelTabs active="files" onSelect={onSelect} liveStates={{ activity: true }} />,
    );

    expect(screen.queryByRole("button", { name: "panels.activity" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "common.moreActions" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByRole("menuitem", { name: "panels.activity" })).toBeNull();
  });

  it("marks the radar tab as live when global running sessions exist", () => {
    const onSelect = vi.fn();

    render(<PanelTabs active="radar" onSelect={onSelect} liveStates={{ radar: true }} />);

    const radarButton = screen.getByRole("button", { name: "panels.radar" });
    expect(radarButton.classList.contains("is-live")).toBe(true);
  });

  it("removes hidden toolbar entries from the DOM", () => {
    const onSelect = vi.fn();

    render(
      <PanelTabs
        active="files"
        onSelect={onSelect}
        visibleTabs={{ activity: false, git: false, search: false }}
      />,
    );

    expect(screen.queryByRole("button", { name: "panels.activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.git" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.search" })).toBeNull();
    expect(screen.getByRole("button", { name: "panels.files" })).toBeTruthy();
  });

  it("keeps git, files, search, and custom memory tabs selectable after adding activity", () => {
    const onSelect = vi.fn();

    render(
      <PanelTabs
        active="memory"
        onSelect={onSelect}
        tabs={[
          { id: "git", label: "panels.git", icon: <span>git</span> },
          { id: "files", label: "panels.files", icon: <span>files</span> },
          { id: "search", label: "panels.search", icon: <span>search</span> },
          { id: "memory", label: "panels.memory", icon: <span>memory</span> },
          { id: "activity", label: "panels.activity", icon: <span>activity</span> },
        ]}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "common.moreActions" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "panels.git" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "common.moreActions" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "panels.files" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "common.moreActions" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "panels.search" }));
    fireEvent.click(screen.getByRole("button", { name: "panels.memory" }));

    expect(onSelect).toHaveBeenNthCalledWith(1, "git");
    expect(onSelect).toHaveBeenNthCalledWith(2, "files");
    expect(onSelect).toHaveBeenNthCalledWith(3, "search");
    expect(onSelect).toHaveBeenNthCalledWith(4, "memory");
  });

  it("externalizes the default pinned tabs (files, git) as toolbar buttons", () => {
    render(<PanelTabs active="files" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "panels.files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "panels.git" })).toBeTruthy();
    // 搜索 / 雷达默认不勾选，只留在「更多」菜单里
    expect(screen.queryByRole("button", { name: "panels.search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.radar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.notes" })).toBeNull();
  });

  it("keeps search and radar in the overflow list unchecked by default", () => {
    render(<PanelTabs active="files" onSelect={vi.fn()} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "common.moreActions" }),
      { button: 0, ctrlKey: false },
    );

    const searchMenuItem = screen.getByRole("menuitem", { name: "panels.search" });
    const radarMenuItem = screen.getByRole("menuitem", { name: "panels.radar" });
    expect(
      (within(searchMenuItem).getByRole("checkbox") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (within(radarMenuItem).getByRole("checkbox") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("still lists search and radar when client visibility hides them", () => {
    render(
      <PanelTabs
        active="files"
        onSelect={vi.fn()}
        visibleTabs={{ search: false, radar: false }}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "common.moreActions" }),
      { button: 0, ctrlKey: false },
    );

    expect(screen.getByRole("menuitem", { name: "panels.search" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "panels.radar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "panels.search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.radar" })).toBeNull();
  });

  it("does not externalize a live tab when it is neither active nor pinned", () => {
    render(
      <PanelTabs
        active="files"
        onSelect={vi.fn()}
        liveStates={{ activity: true, radar: true }}
      />,
    );

    // live 状态不再强制外显：未勾选且非激活的面板只留在「更多」菜单里
    expect(screen.queryByRole("button", { name: "panels.activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "panels.radar" })).toBeNull();
  });

  it("pins an inactive tab as a toolbar button when its checkbox is checked", () => {
    render(<PanelTabs active="files" onSelect={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "panels.radar" })).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "common.moreActions" }),
      { button: 0, ctrlKey: false },
    );
    const radarMenuItem = screen.getByRole("menuitem", {
      name: "panels.radar",
    });
    const radarCheckbox = within(radarMenuItem).getByRole("checkbox");
    expect((radarCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(radarCheckbox);

    // 菜单仍开着时 Radix 会把工具栏标记为 aria-hidden，故用 hidden 查询
    expect((radarCheckbox as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getByRole("button", { name: "panels.radar", hidden: true }),
    ).toBeTruthy();
  });

  it("removes a pinned tab's toolbar button when its checkbox is unchecked", () => {
    render(<PanelTabs active="files" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "panels.git" })).toBeTruthy();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "common.moreActions" }),
      { button: 0, ctrlKey: false },
    );
    const gitMenuItem = screen.getByRole("menuitem", { name: "panels.git" });
    const gitCheckbox = within(gitMenuItem).getByRole("checkbox");
    expect((gitCheckbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(gitCheckbox);

    expect((gitCheckbox as HTMLInputElement).checked).toBe(false);
    // 取消勾选后彻底从工具栏移除（含 aria-hidden 也查不到）
    expect(
      screen.queryByRole("button", { name: "panels.git", hidden: true }),
    ).toBeNull();
  });

  it("keeps the active tab visible even when it is not pinned", () => {
    render(<PanelTabs active="notes" onSelect={vi.fn()} />);

    // notes 不在默认外显里，但作为激活项必须外显
    expect(screen.getByRole("button", { name: "panels.notes" })).toBeTruthy();
  });

  it("offers spec hub and detached explorer as menu actions without promoting them", () => {
    const onSelect = vi.fn();

    render(<PanelTabs active="files" onSelect={onSelect} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "common.moreActions" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "files.openDetachedExplorer" }));

    expect(onSelect).toHaveBeenCalledWith("detachedExplorer");
    // 动作项不外显到工具栏
    expect(
      screen.queryByRole("button", { name: "files.openDetachedExplorer" }),
    ).toBeNull();

    fireEvent.pointerDown(screen.getByRole("button", { name: "common.moreActions" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "sidebar.specHub" }));

    expect(onSelect).toHaveBeenCalledWith("specHub");
    expect(screen.queryByRole("button", { name: "sidebar.specHub" })).toBeNull();
  });
});
