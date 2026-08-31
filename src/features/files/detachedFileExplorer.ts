import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { writeClientStoreValue, getClientStoreSync } from "../../services/clientStorage";
import { reapplyLastDockIconPreference } from "../theme/utils/dockIcon";
import { isMacPlatform } from "../../utils/platform";

export const DETACHED_FILE_EXPLORER_WINDOW_LABEL = "file-explorer";
export const DETACHED_FILE_EXPLORER_WINDOW_LABEL_PREFIX = "file-explorer-";
export const DETACHED_FILE_EXPLORER_SESSION_EVENT = "detached-file-explorer:session";
export const DETACHED_FILE_EXPLORER_SESSION_STORAGE_KEY = "detachedFileExplorerSession";
const DETACHED_FILE_EXPLORER_CREATE_TIMEOUT_MS = 4_000;

export type DetachedFileExplorerSession = {
  windowLabel?: string | null;
  workspaceId: string;
  workspacePath: string;
  workspaceName: string;
  gitRoot?: string | null;
  initialFilePath?: string | null;
  defaultSidebarCollapsed?: boolean;
  updatedAt: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDetachedFileExplorerSession(
  value: unknown,
): DetachedFileExplorerSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const workspaceId = normalizeString(candidate.workspaceId);
  const workspacePath = normalizeString(candidate.workspacePath);
  const workspaceName = normalizeString(candidate.workspaceName);
  const windowLabel = normalizeString(candidate.windowLabel);
  const gitRoot = normalizeString(candidate.gitRoot);
  const initialFilePath = normalizeString(candidate.initialFilePath);
  const defaultSidebarCollapsed = candidate.defaultSidebarCollapsed === true;
  const updatedAt =
    typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : Date.now();
  if (!workspaceId || !workspacePath || !workspaceName) {
    return null;
  }
  return {
    windowLabel: windowLabel || null,
    workspaceId,
    workspacePath,
    workspaceName,
    gitRoot: gitRoot || null,
    initialFilePath: initialFilePath || null,
    defaultSidebarCollapsed,
    updatedAt,
  };
}

export function buildDetachedFileExplorerSession(input: {
  windowLabel?: string | null;
  workspaceId: string;
  workspacePath: string;
  workspaceName: string;
  gitRoot?: string | null;
  initialFilePath?: string | null;
  defaultSidebarCollapsed?: boolean;
}): DetachedFileExplorerSession {
  return {
    windowLabel: input.windowLabel?.trim() || null,
    workspaceId: input.workspaceId.trim(),
    workspacePath: input.workspacePath.trim(),
    workspaceName: input.workspaceName.trim(),
    gitRoot: input.gitRoot?.trim() || null,
    initialFilePath: input.initialFilePath?.trim() || null,
    defaultSidebarCollapsed: input.defaultSidebarCollapsed === true,
    updatedAt: Date.now(),
  };
}

function buildDetachedFileExplorerSessionStorageKey(windowLabel?: string | null): string {
  const normalizedWindowLabel = windowLabel?.trim() || DETACHED_FILE_EXPLORER_WINDOW_LABEL;
  if (normalizedWindowLabel === DETACHED_FILE_EXPLORER_WINDOW_LABEL) {
    return DETACHED_FILE_EXPLORER_SESSION_STORAGE_KEY;
  }
  return `${DETACHED_FILE_EXPLORER_SESSION_STORAGE_KEY}:${normalizedWindowLabel}`;
}

export function isDetachedFileExplorerWindowLabel(windowLabel: string | null | undefined): boolean {
  const normalizedWindowLabel = windowLabel?.trim() ?? "";
  return (
    normalizedWindowLabel === DETACHED_FILE_EXPLORER_WINDOW_LABEL ||
    normalizedWindowLabel.startsWith(DETACHED_FILE_EXPLORER_WINDOW_LABEL_PREFIX)
  );
}

function createDetachedFileExplorerInstanceLabel(): string {
  const timestamp = Date.now().toString(36);
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `${DETACHED_FILE_EXPLORER_WINDOW_LABEL_PREFIX}${timestamp}-${randomToken}`;
}

export function readDetachedFileExplorerSessionSnapshot(
  windowLabel?: string | null,
): DetachedFileExplorerSession | null {
  return normalizeDetachedFileExplorerSession(
    getClientStoreSync("app", buildDetachedFileExplorerSessionStorageKey(windowLabel)),
  );
}

export function writeDetachedFileExplorerSessionSnapshot(
  session: DetachedFileExplorerSession,
  windowLabel?: string | null,
): void {
  writeClientStoreValue(
    "app",
    buildDetachedFileExplorerSessionStorageKey(windowLabel ?? session.windowLabel),
    session,
    { immediate: true },
  );
}

export function buildDetachedFileExplorerWindowTitle(
  session: Pick<DetachedFileExplorerSession, "workspaceName">,
): string {
  return `${session.workspaceName} · File Explorer`;
}

function normalizeWindowErrorMessage(payload: unknown): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return JSON.stringify(payload ?? "unknown error");
}



async function createDetachedFileExplorerWindow(
  windowLabel: string,
  session: DetachedFileExplorerSession,
): Promise<"created"> {
  const sessionForWindow = {
    ...session,
    windowLabel,
  };
  writeDetachedFileExplorerSessionSnapshot(sessionForWindow, windowLabel);
  const rootUrl = new URL("/", window.location.href).toString();
  const detachedWindow = new WebviewWindow(windowLabel, {
    url: rootUrl,
    title: buildDetachedFileExplorerWindowTitle(sessionForWindow),
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    center: true,
    resizable: true,
    focus: true,
    ...(isMacPlatform()
      ? {
          titleBarStyle: "overlay",
          hiddenTitle: true,
          transparent: false,
        }
      : {}),
  });
  return await new Promise<"created">((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = globalThis.setTimeout(() => {
      settle(() => {
        reject(new Error("Timed out while opening detached file explorer"));
      });
    }, DETACHED_FILE_EXPLORER_CREATE_TIMEOUT_MS);

    detachedWindow.once("tauri://error", (event) => {
      const message = normalizeWindowErrorMessage(event.payload);
      console.error("[detached-file-explorer] create window failed", message);
      settle(() => {
        reject(new Error(message));
      });
    });
    detachedWindow.once("tauri://created", () => {
      void (async () => {
        await emitTo(
          windowLabel,
          DETACHED_FILE_EXPLORER_SESSION_EVENT,
          sessionForWindow,
        ).catch(() => {});
        await detachedWindow.setFocus().catch(() => {});
        // Win/Linux: per-window taskbar icon — stamp the new surface with the
        // current preference (no-op-ish on macOS beyond window chrome).
        void reapplyLastDockIconPreference().catch((error) => {
          console.error(
            "[detached-file-explorer] failed to reapply dock icon",
            error,
          );
        });
        settle(() => {
          resolve("created");
        });
      })();
    });
  });
}

export async function openOrFocusDetachedFileExplorer(
  session: DetachedFileExplorerSession,
): Promise<"created" | "focused"> {
  const sessionForWindow = {
    ...session,
    windowLabel: DETACHED_FILE_EXPLORER_WINDOW_LABEL,
  };
  const existing = await WebviewWindow.getByLabel(DETACHED_FILE_EXPLORER_WINDOW_LABEL);
  if (existing) {
    writeDetachedFileExplorerSessionSnapshot(
      sessionForWindow,
      DETACHED_FILE_EXPLORER_WINDOW_LABEL,
    );
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    await existing.setTitle(buildDetachedFileExplorerWindowTitle(sessionForWindow)).catch(() => {});
    await emitTo(
      DETACHED_FILE_EXPLORER_WINDOW_LABEL,
      DETACHED_FILE_EXPLORER_SESSION_EVENT,
      sessionForWindow,
    ).catch(() => {});
    return "focused";
  }

  return createDetachedFileExplorerWindow(DETACHED_FILE_EXPLORER_WINDOW_LABEL, sessionForWindow);
}

export async function openNewDetachedFileExplorerWindow(
  session: DetachedFileExplorerSession,
): Promise<"created"> {
  const windowLabel = createDetachedFileExplorerInstanceLabel();
  return createDetachedFileExplorerWindow(windowLabel, {
    ...session,
    windowLabel,
  });
}
