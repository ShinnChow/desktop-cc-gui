import type { OpenAppTarget } from "../../types";


export const DEFAULT_OPEN_APP_ID = "vscode";
export const DEFAULT_VISIBLE_THREAD_ROOT_COUNT = 5;
export const MIN_VISIBLE_THREAD_ROOT_COUNT = 1;
export const MAX_GLOBAL_VISIBLE_THREAD_ROOT_COUNT = 20;
export const MAX_VISIBLE_THREAD_ROOT_COUNT = 200;
export const THREAD_ROW_TOOLTIP_DELAY_MS = 650;

export function parseVisibleThreadRootCountDraft(
  value: string,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeVisibleThreadRootCount(
  value: number | null | undefined,
  fallback: number = DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(
    MIN_VISIBLE_THREAD_ROOT_COUNT,
    Math.min(MAX_VISIBLE_THREAD_ROOT_COUNT, Math.trunc(value)),
  );
}

export function normalizeGlobalVisibleThreadRootCount(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VISIBLE_THREAD_ROOT_COUNT;
  }

  return Math.max(
    MIN_VISIBLE_THREAD_ROOT_COUNT,
    Math.min(MAX_GLOBAL_VISIBLE_THREAD_ROOT_COUNT, Math.trunc(value)),
  );
}

/** Workspace override if set; otherwise the global default (factory 5). */
export function resolveVisibleThreadRootPageSize(
  workspaceCount: number | null | undefined,
  globalDefault?: number | null,
): number {
  if (typeof workspaceCount === "number" && Number.isFinite(workspaceCount)) {
    return normalizeVisibleThreadRootCount(workspaceCount);
  }
  return normalizeGlobalVisibleThreadRootCount(globalDefault);
}

/** Visible unpinned-root cap for page n: 5, 10, 15, 20… */
export function resolveVisibleThreadRootLimit(
  pageSize: number | null | undefined,
  page: number | null | undefined,
  globalDefault?: number | null,
): number {
  const size = resolveVisibleThreadRootPageSize(pageSize, globalDefault);
  const safePage =
    typeof page === "number" && Number.isFinite(page)
      ? Math.max(1, Math.trunc(page))
      : 1;
  return size * safePage;
}

export type ThreadListPageAdvancePlan = {
  advance: boolean;
  fetch: boolean;
};

/**
 * Sidebar「更多」policy: raise the visible cap from in-memory first.
 * Fetch the next Index/runtime page only after that page is exhausted
 * and a cursor still exists. Ignore clicks while a page request is in flight.
 */
export function planThreadListPageAdvance(input: {
  totalRoots: number;
  currentLimit: number;
  nextCursor: string | null | undefined;
  isPaging: boolean;
}): ThreadListPageAdvancePlan {
  if (input.isPaging) {
    return { advance: false, fetch: false };
  }
  if (input.totalRoots > input.currentLimit) {
    return { advance: true, fetch: false };
  }
  if (input.nextCursor) {
    return { advance: true, fetch: true };
  }
  return { advance: false, fetch: false };
}



export const DEFAULT_OPEN_APP_TARGETS: OpenAppTarget[] = [
  {
    id: "vscode",
    label: "VS Code",
    kind: "app",
    appName: "Visual Studio Code",
    args: [],
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "app",
    appName: "Cursor",
    args: [],
  },
  {
    id: "zed",
    label: "Zed",
    kind: "app",
    appName: "Zed",
    args: [],
  },
  {
    id: "idea",
    label: "IntelliJ IDEA",
    kind: "app",
    appName: "IntelliJ IDEA",
    args: [],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    kind: "app",
    appName: "Ghostty",
    args: [],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    kind: "app",
    appName: "Antigravity",
    args: [],
  },
  {
    id: "finder",
    label: "Finder",
    kind: "finder",
    args: [],
  },
];
