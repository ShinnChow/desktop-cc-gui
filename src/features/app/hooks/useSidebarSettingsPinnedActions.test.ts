// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY,
  SIDEBAR_SETTINGS_PINNED_MAX,
  readSidebarSettingsPinnedActionIds,
  toggleSidebarSettingsPinnedActionId,
  useSidebarSettingsPinnedActions,
} from "./useSidebarSettingsPinnedActions";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

describe("useSidebarSettingsPinnedActions", () => {
  beforeEach(() => {
    vi.mocked(getClientStoreSync).mockReset();
    vi.mocked(writeClientStoreValue).mockReset();
    vi.mocked(getClientStoreSync).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads only known pinnable action ids", () => {
    vi.mocked(getClientStoreSync).mockReturnValue([
      "lock",
      "unknown",
      "spec-hub",
      12,
    ]);
    expect(readSidebarSettingsPinnedActionIds()).toEqual(["lock", "spec-hub"]);
  });

  it("pins until the max of four, then ignores further pins", () => {
    const store: string[] = [];
    vi.mocked(getClientStoreSync).mockImplementation(() => [...store]);
    vi.mocked(writeClientStoreValue).mockImplementation((_ns, _key, value) => {
      store.splice(0, store.length, ...(value as string[]));
    });

    expect(toggleSidebarSettingsPinnedActionId("lock")).toEqual(["lock"]);
    expect(toggleSidebarSettingsPinnedActionId("spec-hub")).toEqual([
      "lock",
      "spec-hub",
    ]);
    expect(toggleSidebarSettingsPinnedActionId("git-history")).toEqual([
      "lock",
      "spec-hub",
      "git-history",
    ]);
    expect(toggleSidebarSettingsPinnedActionId("system-proxy")).toEqual([
      "lock",
      "spec-hub",
      "git-history",
      "system-proxy",
    ]);
    // 已满 4 个，再 pin 保持不变。
    expect(toggleSidebarSettingsPinnedActionId("project-memory")).toEqual([
      "lock",
      "spec-hub",
      "git-history",
      "system-proxy",
    ]);
    expect(writeClientStoreValue).toHaveBeenCalledTimes(4);
    expect(SIDEBAR_SETTINGS_PINNED_MAX).toBe(4);

    // 取消一个后再 pin 成功。
    expect(toggleSidebarSettingsPinnedActionId("lock")).toEqual([
      "spec-hub",
      "git-history",
      "system-proxy",
    ]);
    expect(toggleSidebarSettingsPinnedActionId("project-memory")).toEqual([
      "spec-hub",
      "git-history",
      "system-proxy",
      "project-memory",
    ]);
  });

  it("unpins an existing id", () => {
    const store = ["project-memory", "runtime-notice"];
    vi.mocked(getClientStoreSync).mockImplementation(() => [...store]);
    vi.mocked(writeClientStoreValue).mockImplementation((_ns, _key, value) => {
      store.splice(0, store.length, ...(value as string[]));
    });

    expect(toggleSidebarSettingsPinnedActionId("project-memory")).toEqual([
      "runtime-notice",
    ]);
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "app",
      SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY,
      ["runtime-notice"],
    );
  });

  it("syncs hook state through the change event", () => {
    const store: string[] = [];
    vi.mocked(getClientStoreSync).mockImplementation(() => [...store]);
    vi.mocked(writeClientStoreValue).mockImplementation((_ns, _key, value) => {
      store.splice(0, store.length, ...(value as string[]));
    });

    const { result } = renderHook(() => useSidebarSettingsPinnedActions());
    expect(result.current.pinnedIds).toEqual([]);
    expect(result.current.maxPinned).toBe(4);

    act(() => {
      result.current.togglePinned("lock");
    });
    expect(result.current.pinnedIds).toEqual(["lock"]);

    act(() => {
      result.current.togglePinned("spec-hub");
    });
    expect(result.current.pinnedIds).toEqual(["lock", "spec-hub"]);

    act(() => {
      result.current.togglePinned("git-history");
    });
    expect(result.current.pinnedIds).toEqual(["lock", "spec-hub"]);
  });
});
