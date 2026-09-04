
import type { AppMode } from "../../types";

/**
 * S4 PR-E：按 appMode 的 feature flags（纯派生，无 UI）。
 * 视图层仍由 showExtensions 等条件 JSX 控制；
 * 本 selector 给 Git 等数据路径统一「是否在表面模式」判定。
 */
export function resolveAppModeSurfaceFlags(appMode: AppMode) {
  const showGitHistory = appMode === "gitHistory";
  const showExtensions = appMode === "extensions";
  const isChatSurface = appMode === "chat";
  /** chat / gitHistory 才需要右栏 Git active 轮询与 preload */
  const isGitSurfaceMode = appMode === "chat" || appMode === "gitHistory";
  return {
    appMode,
    showGitHistory,
    showExtensions,
    isChatSurface,
    isGitSurfaceMode,
  };
}


