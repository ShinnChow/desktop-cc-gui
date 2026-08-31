import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, CodexUnifiedExecExternalStatus } from "../../types";

export interface CodexRuntimeReloadResult {
  status: string;
  stage: string;
  restartedSessions: number;
  message?: string | null;
}

export interface SettingsRecoveryNotice {
  backupFileName: string | null;
}



export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function takeSettingsRecoveryNotice(): Promise<SettingsRecoveryNotice | null> {
  return invoke<SettingsRecoveryNotice | null>("take_settings_recovery_notice");
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("update_app_settings", { settings });
}

export type ImportedWorkspaceWallpaper = {
  id: string;
  kind: "image" | "video";
  path: string;
  sourcePath: string;
};

export async function importWorkspaceWallpaper(
  sourcePath: string,
): Promise<ImportedWorkspaceWallpaper> {
  return invoke<ImportedWorkspaceWallpaper>("import_workspace_wallpaper", {
    sourcePath,
  });
}

export async function removeWorkspaceWallpaper(path: string): Promise<void> {
  await invoke<void>("remove_workspace_wallpaper", { path });
}

export async function readWorkspaceWallpaperPreview(
  path: string,
): Promise<string> {
  return invoke<string>("read_workspace_wallpaper_preview", { path });
}

export async function readWorkspaceWallpaperBytes(
  path: string,
): Promise<Uint8Array> {
  const payload = await invoke<ArrayBuffer | number[] | Uint8Array>(
    "read_workspace_wallpaper_bytes",
    { path },
  );
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (Array.isArray(payload)) {
    return Uint8Array.from(payload);
  }
  throw new Error("Wallpaper bytes payload is not binary.");
}

export type WallpaperMarketCategory = "all" | "general" | "anime" | "people";

export type WallpaperMarketItem = {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  sourceUrl: string;
  resolution: string;
  category: string;
};

export type WallpaperMarketSearchResult = {
  page: number;
  lastPage: number;
  items: WallpaperMarketItem[];
};

export async function searchWorkspaceWallpaperMarket(input: {
  query?: string;
  category?: WallpaperMarketCategory;
  page?: number;
}): Promise<WallpaperMarketSearchResult> {
  return invoke<WallpaperMarketSearchResult>(
    "search_workspace_wallpaper_market",
    { query: input },
  );
}

export async function downloadWorkspaceWallpaper(input: {
  url: string;
  sourceUrl: string;
  suggestedName?: string;
}): Promise<ImportedWorkspaceWallpaper> {
  return invoke<ImportedWorkspaceWallpaper>("download_workspace_wallpaper", {
    request: input,
  });
}

export async function getCodexUnifiedExecExternalStatus(): Promise<CodexUnifiedExecExternalStatus> {
  return invoke<CodexUnifiedExecExternalStatus>(
    "get_codex_unified_exec_external_status",
  );
}

export async function restoreCodexUnifiedExecOfficialDefault(): Promise<CodexUnifiedExecExternalStatus> {
  return invoke<CodexUnifiedExecExternalStatus>(
    "restore_codex_unified_exec_official_default",
  );
}

export async function setCodexUnifiedExecOfficialOverride(
  enabled: boolean,
): Promise<CodexUnifiedExecExternalStatus> {
  return invoke<CodexUnifiedExecExternalStatus>(
    "set_codex_unified_exec_official_override",
    { enabled },
  );
}

export async function reloadCodexRuntimeConfig(): Promise<CodexRuntimeReloadResult> {
  return invoke<CodexRuntimeReloadResult>("reload_codex_runtime_config");
}

export type DockIconApplyResult = {
  iconId: string;
  applied: boolean;
  platform: string;
  /** Windows/Linux: number of windows whose chrome icon was updated. */
  windowsUpdated?: number;
  reason?: string | null;
};

export async function setDockIcon(payload: {
  iconId: string;
  /**
   * Prefer `Uint8Array` over `number[]` — catalog icons are ~250KB each and a
   * dense typed array keeps IPC/serialization cost reasonable on all platforms.
   */
  pngBytes?: Uint8Array | number[] | null;
}): Promise<DockIconApplyResult> {
  return invoke<DockIconApplyResult>("set_dock_icon", {
    iconId: payload.iconId,
    pngBytes: payload.pngBytes ?? null,
  });
}
