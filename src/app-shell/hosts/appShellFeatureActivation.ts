import type { AppMode } from "../../types";
import { resolveAppModeSurfaceFlags } from "../domains/appModeSurfaceFlags";

/**
 * 刀 2：按表面决定冷/中频能力是否允许发请求。
 * Host 仍会 mount（React hooks 不能条件调用），但 enabled=false 时跳过 IO。
 */


export function resolveAppShellFeatureActivation(input: {
  appMode: AppMode;
  isSearchPaletteOpen: boolean;
}) {
  const surface = resolveAppModeSurfaceFlags(input.appMode);
  return {
    ...surface,
    isGitRemoteEnabled: surface.isGitSurfaceMode,
    isMultiRepositoryStatusEnabled: surface.isGitSurfaceMode,
    isSearchQueryEnabled: input.isSearchPaletteOpen,
  };
}
