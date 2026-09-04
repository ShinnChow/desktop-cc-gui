import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { reorderTabPathsAtTarget } from "../utils/fileTabOrder";
import type { FileViewPanelProps } from "../components/FileViewPanelContract";

export function useFileTabDrag({
  canReorderTabs,
  onReorderTabs,
  visibleTabs,
}: {
  canReorderTabs: boolean;
  onReorderTabs: FileViewPanelProps["onReorderTabs"];
  visibleTabs: string[];
}) {
  const [draggingTabPath, setDraggingTabPath] = useState<string | null>(null);
  const [dragOverTabPath, setDragOverTabPath] = useState<string | null>(null);

  // Tab reordering uses pointer events rather than native HTML5 drag-and-drop:
  // the macOS Tauri webview (WKWebView) does not reliably start an HTML5 drag
  // that originates on the inner <button>, so a pointer-driven gesture is used.
  const tabDragOriginRef = useRef<{
    tabPath: string;
    pointerId: number;
    startX: number;
    moved: boolean;
  } | null>(null);
  const suppressTabClickRef = useRef(false);

  const resolveTabPathAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const tab = element?.closest<HTMLElement>(".fvp-tab");
      return tab?.dataset.tabPath ?? null;
    },
    [],
  );

  const endTabDrag = useCallback(() => {
    tabDragOriginRef.current = null;
    setDraggingTabPath(null);
    setDragOverTabPath(null);
  }, []);

  const handleTabPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, tabPath: string) => {
      suppressTabClickRef.current = false;
      if (!canReorderTabs || event.button !== 0) {
        return;
      }
      // Let the close/detach buttons own their own gestures.
      if (
        (event.target as HTMLElement).closest(".fvp-tab-close, .fvp-tab-detach")
      ) {
        return;
      }
      tabDragOriginRef.current = {
        tabPath,
        pointerId: event.pointerId,
        startX: event.clientX,
        moved: false,
      };
    },
    [canReorderTabs],
  );

  const handleTabPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = tabDragOriginRef.current;
      if (!origin || event.pointerId !== origin.pointerId) {
        return;
      }
      if (!origin.moved) {
        if (Math.abs(event.clientX - origin.startX) < 4) {
          return;
        }
        origin.moved = true;
        setDraggingTabPath(origin.tabPath);
        try {
          event.currentTarget.setPointerCapture(origin.pointerId);
        } catch {
          // Pointer capture is best-effort.
        }
      }
      const overPath = resolveTabPathAtPoint(event.clientX, event.clientY);
      setDragOverTabPath((current) =>
        current === overPath ? current : overPath,
      );
    },
    [resolveTabPathAtPoint],
  );

  const handleTabPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = tabDragOriginRef.current;
      if (!origin || event.pointerId !== origin.pointerId) {
        return;
      }
      if (origin.moved) {
        // Swallow the click that the browser fires after the drag gesture so a
        // reorder never doubles as a tab activation.
        suppressTabClickRef.current = true;
        const source = origin.tabPath;
        const targetPath = resolveTabPathAtPoint(event.clientX, event.clientY);
        if (targetPath && targetPath !== source) {
          const nextOrder = reorderTabPathsAtTarget(
            visibleTabs,
            source,
            targetPath,
          );
          if (nextOrder.some((path, index) => path !== visibleTabs[index])) {
            onReorderTabs?.(nextOrder);
          }
        }
      }
      endTabDrag();
    },
    [endTabDrag, onReorderTabs, resolveTabPathAtPoint, visibleTabs],
  );

  return {
    draggingTabPath,
    dragOverTabPath,
    suppressTabClickRef,
    endTabDrag,
    handleTabPointerDown,
    handleTabPointerMove,
    handleTabPointerUp,
  };
}
