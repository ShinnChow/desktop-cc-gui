/* @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  isWindowsPlatform: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock("../../../utils/platform", () => ({
  isWindowsPlatform: mocks.isWindowsPlatform,
}));

import { useWindowDrag } from "./useWindowDrag";

function flushMicrotasks() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

describe("useWindowDrag", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const titlebar = document.createElement("div");
    titlebar.id = "titlebar";
    titlebar.setAttribute("data-tauri-drag-region", "");
    document.body.appendChild(titlebar);

    mocks.getCurrentWindow.mockReset();
    mocks.isWindowsPlatform.mockReset();
    mocks.isWindowsPlatform.mockReturnValue(false);
  });

  it("swallows non-Windows startDragging failures", async () => {
    const isFullscreen = vi.fn().mockResolvedValue(false);
    const startDragging = vi.fn().mockRejectedValue(new Error("drag failed"));
    mocks.getCurrentWindow.mockReturnValue({
      isFullscreen,
      startDragging,
    });

    renderHook(() => useWindowDrag("titlebar"));

    const titlebar = document.getElementById("titlebar");
    if (!titlebar) {
      throw new Error("titlebar missing");
    }

    titlebar.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );

    await flushMicrotasks();

    expect(isFullscreen).toHaveBeenCalledTimes(1);
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("skips dragging when non-Windows window is fullscreen", async () => {
    const isFullscreen = vi.fn().mockResolvedValue(true);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    mocks.getCurrentWindow.mockReturnValue({
      isFullscreen,
      startDragging,
    });

    renderHook(() => useWindowDrag("titlebar"));

    const titlebar = document.getElementById("titlebar");
    if (!titlebar) {
      throw new Error("titlebar missing");
    }

    titlebar.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );

    await flushMicrotasks();

    expect(isFullscreen).toHaveBeenCalledTimes(1);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("starts non-Windows dragging from the right toolbar blank region", async () => {
    const isFullscreen = vi.fn().mockResolvedValue(false);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    mocks.getCurrentWindow.mockReturnValue({ isFullscreen, startDragging });
    const toolbar = document.createElement("div");
    toolbar.className = "right-panel-toolbar";
    toolbar.setAttribute("data-tauri-drag-region", "");
    document.body.appendChild(toolbar);

    renderHook(() => useWindowDrag("titlebar"));
    toolbar.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    await flushMicrotasks();

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("keeps right toolbar controls non-draggable", async () => {
    const isFullscreen = vi.fn().mockResolvedValue(false);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    mocks.getCurrentWindow.mockReturnValue({ isFullscreen, startDragging });
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-tauri-drag-region", "");
    const button = document.createElement("button");
    button.setAttribute("data-tauri-drag-region", "false");
    toolbar.appendChild(button);
    document.body.appendChild(toolbar);

    renderHook(() => useWindowDrag("titlebar"));
    button.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    await flushMicrotasks();

    expect(startDragging).not.toHaveBeenCalled();
  });

  it("starts Windows titlebar dragging on first movement without a fixed delay", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    const isFullscreen = vi.fn().mockResolvedValue(false);
    const startDragging = vi.fn().mockResolvedValue(undefined);
    mocks.getCurrentWindow.mockReturnValue({
      isFullscreen,
      startDragging,
    });
    const topbar = document.createElement("div");
    topbar.className = "main-topbar";
    document.body.appendChild(topbar);

    renderHook(() => useWindowDrag("titlebar"));

    topbar.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        detail: 1,
      }),
    );
    await flushMicrotasks();
    expect(isFullscreen).not.toHaveBeenCalled();

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientX: 14,
        clientY: 10,
      }),
    );
    await flushMicrotasks();

    expect(isFullscreen).toHaveBeenCalledTimes(1);
    expect(startDragging).toHaveBeenCalledTimes(1);
  });
});
