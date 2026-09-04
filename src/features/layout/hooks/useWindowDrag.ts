import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowsPlatform } from "../../../utils/platform";

export function useWindowDrag(_targetId: string) {
  useEffect(() => {
    const isWindowsDesktop = isWindowsPlatform();

    if (isWindowsDesktop) {
      const WINDOWS_DRAG_MOVE_THRESHOLD_PX = 2;
      let pendingDragStart: { clientX: number; clientY: number } | null = null;
      let dragStartInFlight = false;

      const clearPendingDragStart = () => {
        pendingDragStart = null;
      };

      const getTitlebarHeight = () => {
        const raw = getComputedStyle(document.documentElement)
          .getPropertyValue("--titlebar-height")
          .trim();
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : 44;
      };

      const isMainTopbarArea = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) {
          return false;
        }
        return Boolean(
          el.closest(
            [
              ".main-topbar",
              ".main-header",
              ".right-panel-toolbar",
              ".sidebar-topbar-placeholder",
              ".sidebar-topbar-content",
            ].join(","),
          ),
        );
      };

      const DRAG_IGNORE_SELECTOR = [
        // Data attributes for explicit opt-out
        '[data-tauri-drag-region="false"]',
        "[data-window-drag-ignore='true']",
        // Interactive elements
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
        // Window controls
        ".titlebar-window-controls",
        // Popovers and dropdowns
        "[class*='-dropdown']",
        "[class*='-popover']",
        // Resizers and dividers
        "[class*='-resizer']",
        "[class*='-divider']",
        "[class*='-resize-handle']",
      ].join(",");

      const shouldIgnoreTarget = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) {
          return false;
        }
        return Boolean(el.closest(DRAG_IGNORE_SELECTOR));
      };

      const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0 || event.detail > 1) {
          return;
        }
        const inTopTitlebarLane = event.clientY <= getTitlebarHeight();
        const inMainTopbarBlankArea = isMainTopbarArea(event.target);
        if (!inTopTitlebarLane && !inMainTopbarBlankArea) {
          return;
        }
        if (shouldIgnoreTarget(event.target)) {
          return;
        }
        pendingDragStart = {
          clientX: event.clientX,
          clientY: event.clientY,
        };
      };

      const startWindowDrag = () => {
        if (dragStartInFlight) {
          return;
        }
        dragStartInFlight = true;
        clearPendingDragStart();
        void (async () => {
          try {
            const windowHandle = getCurrentWindow();
            const fullscreen = await windowHandle.isFullscreen();
            if (fullscreen) {
              return;
            }
            await windowHandle.startDragging();
          } catch {
            // Ignore in non-Tauri test/runtime cases.
          } finally {
            dragStartInFlight = false;
          }
        })();
      };

      const onMouseMove = (event: MouseEvent) => {
        if (!pendingDragStart) {
          return;
        }
        if (event.buttons !== 1) {
          clearPendingDragStart();
          return;
        }
        const deltaX = event.clientX - pendingDragStart.clientX;
        const deltaY = event.clientY - pendingDragStart.clientY;
        const movedEnough =
          deltaX * deltaX + deltaY * deltaY >=
          WINDOWS_DRAG_MOVE_THRESHOLD_PX * WINDOWS_DRAG_MOVE_THRESHOLD_PX;
        if (!movedEnough) {
          return;
        }
        startWindowDrag();
      };

      const onDoubleClick = (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }
        const inTopTitlebarLane = event.clientY <= getTitlebarHeight();
        const inMainTopbarBlankArea = isMainTopbarArea(event.target);
        if (!inTopTitlebarLane && !inMainTopbarBlankArea) {
          return;
        }
        if (shouldIgnoreTarget(event.target)) {
          return;
        }
        clearPendingDragStart();
        void (async () => {
          try {
            const windowHandle = getCurrentWindow();
            const fullscreen = await windowHandle.isFullscreen();
            if (fullscreen) {
              await windowHandle.setFullscreen(false);
              await new Promise((resolve) => window.setTimeout(resolve, 16));
            }
            await windowHandle.toggleMaximize();
          } catch {
            // Ignore in non-Tauri test/runtime cases.
          }
        })();
      };

      const onMouseUp = (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }
        clearPendingDragStart();
      };

      document.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("dblclick", onDoubleClick);
      document.addEventListener("mouseup", onMouseUp);
      return () => {
        clearPendingDragStart();
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("dblclick", onDoubleClick);
        document.removeEventListener("mouseup", onMouseUp);
      };
    }

    const handler = (event: MouseEvent) => {
      if (event.buttons !== 1) {
        return;
      }
      if (event.detail > 1) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest(`[data-tauri-drag-region]:not([data-tauri-drag-region="false"])`) ||
        target.closest('[data-tauri-drag-region="false"]')
      ) {
        return;
      }
      void (async () => {
        try {
          const windowHandle = getCurrentWindow();
          const fullscreen = await windowHandle.isFullscreen();
          if (fullscreen) {
            return;
          }
          await windowHandle.startDragging();
        } catch {
          // Ignore in non-Tauri test/runtime cases.
        }
      })();
    };

    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [_targetId]);
}
