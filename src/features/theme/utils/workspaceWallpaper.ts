import type {
  WorkspaceWallpaperFluidMotion,
  WorkspaceWallpaperFluidPreset,
  WorkspaceWallpaperLibraryItem,
  WorkspaceWallpaperLibraryKind,
  WorkspaceWallpaperMode,
  WorkspaceWallpaperObjectFit,
  WorkspaceWallpaperSettings,
} from "../../../types";
import {
  DEFAULT_WORKSPACE_FLUID_MOTION,
  DEFAULT_WORKSPACE_FLUID_PRESET,
  isWorkspaceFluidMotionId,
  isWorkspaceFluidPresetId,
} from "../../onboarding/utils/fluidTones";

export const WORKSPACE_WALLPAPER_MODES = ["none", "fluid", "custom"] as const;

export const DEFAULT_WORKSPACE_WALLPAPER_VEIL_OPACITY = 0;



export const DEFAULT_WORKSPACE_WALLPAPER_BLUR = 0;
export const MIN_WORKSPACE_WALLPAPER_BLUR = 0;
export const MAX_WORKSPACE_WALLPAPER_BLUR = 40;

export const DEFAULT_WORKSPACE_WALLPAPER_DARKEN = 0;
export const MIN_WORKSPACE_WALLPAPER_DARKEN = 0;
export const MAX_WORKSPACE_WALLPAPER_DARKEN = 80;

export const DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE = 1;
export const WORKSPACE_WALLPAPER_PLAYBACK_RATES = [
  0.5, 0.75, 1, 1.25, 1.5, 2,
] as const;

export const WORKSPACE_WALLPAPER_OBJECT_FITS = [
  "cover",
  "contain",
  "center",
  "fill",
] as const;

export const DEFAULT_WORKSPACE_WALLPAPER_OBJECT_FIT: WorkspaceWallpaperObjectFit =
  "cover";

export const WORKSPACE_WALLPAPER_ROTATION_INTERVALS = [5, 15, 30, 60] as const;
export const DEFAULT_WORKSPACE_WALLPAPER_ROTATION_INTERVAL = 30;

/** Workspace fluid is slower than first-run (`SITE_FLUID_PARAMS.speed = 14`). */
export const WORKSPACE_FLUID_SPEED = 9;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
]);
const VIDEO_EXTENSIONS = new Set(["mp4"]);

export const WORKSPACE_WALLPAPER_IMAGE_EXTENSIONS = [...IMAGE_EXTENSIONS];
export const WORKSPACE_WALLPAPER_VIDEO_EXTENSIONS = [...VIDEO_EXTENSIONS];
export const WORKSPACE_WALLPAPER_MEDIA_EXTENSIONS = [
  ...WORKSPACE_WALLPAPER_IMAGE_EXTENSIONS,
  ...WORKSPACE_WALLPAPER_VIDEO_EXTENSIONS,
];

export const DEFAULT_WORKSPACE_WALLPAPER: WorkspaceWallpaperSettings = {
  mode: "none",
  customImagePath: null,
  fluidPreset: DEFAULT_WORKSPACE_FLUID_PRESET,
  fluidMotion: DEFAULT_WORKSPACE_FLUID_MOTION,
  veilOpacity: DEFAULT_WORKSPACE_WALLPAPER_VEIL_OPACITY,
  library: [],
  selectedLibraryId: null,
  wallpaperBlur: DEFAULT_WORKSPACE_WALLPAPER_BLUR,
  wallpaperDarken: DEFAULT_WORKSPACE_WALLPAPER_DARKEN,
  playbackRate: DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE,
  flip: false,
  objectFit: DEFAULT_WORKSPACE_WALLPAPER_OBJECT_FIT,
  paused: false,
  rotationEnabled: false,
  rotationIntervalMinutes: DEFAULT_WORKSPACE_WALLPAPER_ROTATION_INTERVAL,
};

export function sanitizeWorkspaceWallpaperVeilOpacity(
  _value: number | null | undefined,
): number {
  // Frost overlay is off. Persisted radii (old default 12, leftovers
  // like 6) must not keep frosting the wallpaper until a slider exists.
  return DEFAULT_WORKSPACE_WALLPAPER_VEIL_OPACITY;
}

export function sanitizeWorkspaceWallpaperBlur(
  value: number | null | undefined,
): number {
  return clampInt(
    value,
    MIN_WORKSPACE_WALLPAPER_BLUR,
    MAX_WORKSPACE_WALLPAPER_BLUR,
    DEFAULT_WORKSPACE_WALLPAPER_BLUR,
  );
}

export function sanitizeWorkspaceWallpaperDarken(
  value: number | null | undefined,
): number {
  return clampInt(
    value,
    MIN_WORKSPACE_WALLPAPER_DARKEN,
    MAX_WORKSPACE_WALLPAPER_DARKEN,
    DEFAULT_WORKSPACE_WALLPAPER_DARKEN,
  );
}

export function isWorkspaceWallpaperMode(
  value: unknown,
): value is WorkspaceWallpaperMode {
  return (
    typeof value === "string" &&
    (WORKSPACE_WALLPAPER_MODES as readonly string[]).includes(value)
  );
}

export function isWorkspaceWallpaperObjectFit(
  value: unknown,
): value is WorkspaceWallpaperObjectFit {
  return (
    typeof value === "string" &&
    (WORKSPACE_WALLPAPER_OBJECT_FITS as readonly string[]).includes(value)
  );
}

export function fileExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

export function wallpaperFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function isSafeLocalPath(value: string): boolean {
  return Boolean(value) && !value.includes("\0") && !value.includes("://");
}

export function sanitizeCustomWallpaperPath(
  value: string | null | undefined,
): string | null {
  const trimmed = trimPath(value);
  if (!trimmed) {
    return null;
  }
  if (!IMAGE_EXTENSIONS.has(fileExtension(trimmed))) {
    return null;
  }
  return trimmed;
}

export function sanitizeWallpaperMediaPath(
  value: string | null | undefined,
): string | null {
  const trimmed = trimPath(value);
  if (!trimmed) {
    return null;
  }
  const extension = fileExtension(trimmed);
  if (
    !IMAGE_EXTENSIONS.has(extension) &&
    !VIDEO_EXTENSIONS.has(extension)
  ) {
    return null;
  }
  return trimmed;
}

export function wallpaperKindFromPath(
  path: string,
): WorkspaceWallpaperLibraryKind | null {
  const extension = fileExtension(path);
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  return null;
}

export function sanitizeWorkspaceWallpaperLibraryItem(
  value: WorkspaceWallpaperLibraryItem | null | undefined,
): WorkspaceWallpaperLibraryItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const path = sanitizeWallpaperMediaPath(value.path);
  if (!id || !path) {
    return null;
  }
  const kindFromPath = wallpaperKindFromPath(path);
  if (!kindFromPath) {
    return null;
  }
  const kind: WorkspaceWallpaperLibraryKind =
    value.kind === "video" || value.kind === "image"
      ? value.kind
      : kindFromPath;
  if (kind !== kindFromPath) {
    return null;
  }
  const sourcePath =
    sanitizeWallpaperMarketSourcePath(value.sourcePath ?? null) ??
    sanitizeWallpaperMediaPath(value.sourcePath ?? null);
  return {
    id,
    kind,
    path,
    sourcePath,
    hidden: value.hidden === true,
  };
}

export function sanitizeWallpaperMarketSourcePath(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return null;
    }
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    if (host !== "wallhaven.cc") {
      return null;
    }
    const match = url.pathname.match(/^\/w\/([A-Za-z0-9]+)$/);
    if (!match) {
      return null;
    }
    return `https://wallhaven.cc/w/${match[1]}`;
  } catch {
    return null;
  }
}

export function sanitizeWorkspaceWallpaperLibrary(
  value: WorkspaceWallpaperLibraryItem[] | null | undefined,
): WorkspaceWallpaperLibraryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: WorkspaceWallpaperLibraryItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = sanitizeWorkspaceWallpaperLibraryItem(raw);
    if (!item || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export function visibleWallpaperLibraryItems(
  library: WorkspaceWallpaperLibraryItem[],
): WorkspaceWallpaperLibraryItem[] {
  return library.filter((item) => item.hidden !== true);
}

export function sanitizeWorkspaceWallpaperPlaybackRate(
  value: number | null | undefined,
): number {
  if (
    typeof value === "number" &&
    WORKSPACE_WALLPAPER_PLAYBACK_RATES.includes(
      value as (typeof WORKSPACE_WALLPAPER_PLAYBACK_RATES)[number],
    )
  ) {
    return value;
  }
  return DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE;
}

export function sanitizeWorkspaceWallpaperRotationInterval(
  value: number | null | undefined,
): number {
  if (
    typeof value === "number" &&
    WORKSPACE_WALLPAPER_ROTATION_INTERVALS.includes(
      value as (typeof WORKSPACE_WALLPAPER_ROTATION_INTERVALS)[number],
    )
  ) {
    return value;
  }
  return DEFAULT_WORKSPACE_WALLPAPER_ROTATION_INTERVAL;
}

export function sanitizeWorkspaceWallpaper(
  value: WorkspaceWallpaperSettings | null | undefined,
): WorkspaceWallpaperSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_WORKSPACE_WALLPAPER };
  }
  const customImagePath = sanitizeCustomWallpaperPath(value.customImagePath);
  const fluidPreset: WorkspaceWallpaperFluidPreset = isWorkspaceFluidPresetId(
    value.fluidPreset,
  )
    ? value.fluidPreset
    : DEFAULT_WORKSPACE_FLUID_PRESET;
  const fluidMotion: WorkspaceWallpaperFluidMotion = isWorkspaceFluidMotionId(
    value.fluidMotion,
  )
    ? value.fluidMotion
    : DEFAULT_WORKSPACE_FLUID_MOTION;
  const veilOpacity = sanitizeWorkspaceWallpaperVeilOpacity(value.veilOpacity);
  const library = sanitizeWorkspaceWallpaperLibrary(value.library);
  const selectedLibraryId = resolveSelectedLibraryId(
    library,
    value.selectedLibraryId,
  );
  const objectFit: WorkspaceWallpaperObjectFit = isWorkspaceWallpaperObjectFit(
    value.objectFit,
  )
    ? value.objectFit
    : DEFAULT_WORKSPACE_WALLPAPER_OBJECT_FIT;
  const next: WorkspaceWallpaperSettings = {
    mode: "none",
    customImagePath,
    fluidPreset,
    fluidMotion,
    veilOpacity,
    library,
    selectedLibraryId,
    wallpaperBlur: sanitizeWorkspaceWallpaperBlur(value.wallpaperBlur),
    wallpaperDarken: sanitizeWorkspaceWallpaperDarken(value.wallpaperDarken),
    playbackRate: sanitizeWorkspaceWallpaperPlaybackRate(value.playbackRate),
    flip: value.flip === true,
    objectFit,
    paused: value.paused === true,
    rotationEnabled: value.rotationEnabled === true,
    rotationIntervalMinutes: sanitizeWorkspaceWallpaperRotationInterval(
      value.rotationIntervalMinutes,
    ),
  };
  if (value.mode === "custom" || value.mode === "none" || value.mode === "fluid") {
    next.mode = value.mode;
    return next;
  }
  return { ...DEFAULT_WORKSPACE_WALLPAPER };
}

export function resolveSelectedLibraryId(
  library: WorkspaceWallpaperLibraryItem[],
  selectedLibraryId: string | null | undefined,
): string | null {
  const visible = visibleWallpaperLibraryItems(library);
  if (visible.length === 0) {
    return null;
  }
  if (
    typeof selectedLibraryId === "string" &&
    visible.some((item) => item.id === selectedLibraryId)
  ) {
    return selectedLibraryId;
  }
  return visible[0]?.id ?? null;
}

export function resolveWorkspaceWallpaperLibraryItem(
  wallpaper: WorkspaceWallpaperSettings,
): WorkspaceWallpaperLibraryItem | null {
  const library = sanitizeWorkspaceWallpaperLibrary(wallpaper.library);
  const selectedId = resolveSelectedLibraryId(
    library,
    wallpaper.selectedLibraryId,
  );
  if (!selectedId) {
    return null;
  }
  return library.find((item) => item.id === selectedId) ?? null;
}

export type ResolvedWorkspaceWallpaperMedia = {
  kind: WorkspaceWallpaperLibraryKind;
  path: string;
  libraryId: string | null;
};

export function resolveWorkspaceWallpaperMedia(
  wallpaper: WorkspaceWallpaperSettings,
): ResolvedWorkspaceWallpaperMedia | null {
  const selected = resolveWorkspaceWallpaperLibraryItem(wallpaper);
  if (selected) {
    return {
      kind: selected.kind,
      path: selected.path,
      libraryId: selected.id,
    };
  }
  if (wallpaper.customImagePath) {
    return {
      kind: "image",
      path: wallpaper.customImagePath,
      libraryId: null,
    };
  }
  return null;
}

export function resolveWorkspaceWallpaperMode(
  wallpaper: WorkspaceWallpaperSettings,
): WorkspaceWallpaperMode {
  if (wallpaper.mode === "custom" && !resolveWorkspaceWallpaperMedia(wallpaper)) {
    return "fluid";
  }
  return wallpaper.mode;
}

export function findDuplicateWallpaperLibraryItem(
  library: WorkspaceWallpaperLibraryItem[],
  sourcePath: string,
): WorkspaceWallpaperLibraryItem | undefined {
  const normalized = normalizePathKey(sourcePath);
  if (!normalized) {
    return undefined;
  }
  return library.find(
    (item) => normalizePathKey(item.sourcePath ?? item.path) === normalized,
  );
}

export function workspaceWallpaperSnapshotKey(
  wallpaper: WorkspaceWallpaperSettings,
): string {
  return JSON.stringify({
    mode: wallpaper.mode,
    customImagePath: wallpaper.customImagePath,
    fluidPreset: wallpaper.fluidPreset,
    fluidMotion: wallpaper.fluidMotion,
    veilOpacity: wallpaper.veilOpacity,
    selectedLibraryId: wallpaper.selectedLibraryId ?? null,
    wallpaperBlur: wallpaper.wallpaperBlur,
    wallpaperDarken: wallpaper.wallpaperDarken,
    playbackRate: wallpaper.playbackRate,
    flip: wallpaper.flip === true,
    objectFit: wallpaper.objectFit,
    paused: wallpaper.paused === true,
    rotationEnabled: wallpaper.rotationEnabled === true,
    rotationIntervalMinutes: wallpaper.rotationIntervalMinutes,
    library: (wallpaper.library ?? []).map((item) => ({
      id: item.id,
      kind: item.kind,
      path: item.path,
      sourcePath: item.sourcePath ?? null,
      hidden: item.hidden === true,
    })),
  });
}

function clampInt(
  value: number | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function trimPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !isSafeLocalPath(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizePathKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\\/g, "/").toLowerCase();
}
