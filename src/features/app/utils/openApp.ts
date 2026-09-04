import type { AppSettings, OpenAppTarget } from "../../../types";


import { openWorkspaceIn, revealInFileManager } from "../../../services/tauri";
import {
  isAbsoluteFsPath,
  joinWorkspaceAbsolutePath,
} from "../../../utils/workspacePaths";

/**
 * Resolve which path to hand to an open-with target.
 * - file manager (finder): always workspace / folder context
 * - app / command: prefer the currently open file when available
 */
export function resolveOpenAppPath(
  target: Pick<OpenAppTarget, "kind">,
  options: {
    workspacePath: string;
    activeFilePath?: string | null;
  },
): string {
  const workspacePath = options.workspacePath.trim();
  if (target.kind === "finder") {
    return workspacePath;
  }
  const active = options.activeFilePath?.trim() ?? "";
  if (!active) {
    return workspacePath;
  }
  if (isAbsoluteFsPath(active)) {
    return active;
  }
  if (!workspacePath) {
    return active;
  }
  return joinWorkspaceAbsolutePath(workspacePath, active);
}

export async function openPathInTarget(
  path: string,
  target: OpenAppTarget,
): Promise<void> {
  if (target.kind === "finder") {
    await revealInFileManager(path);
    return;
  }
  if (target.kind === "command") {
    if (!target.command) {
      return;
    }
    await openWorkspaceIn(path, {
      command: target.command,
      args: target.args,
    });
    return;
  }
  const appName = target.appName || target.label;
  if (!appName) {
    return;
  }
  await openWorkspaceIn(path, { appName, args: target.args });
}

export function normalizeOpenAppTargets(targets: OpenAppTarget[]): OpenAppTarget[] {
  return targets
    .map((target) => ({
      ...target,
      label: target.label.trim(),
      appName: (target.appName?.trim() ?? "") || null,
      command: (target.command?.trim() ?? "") || null,
      args: Array.isArray(target.args) ? target.args.map((arg) => arg.trim()) : [],
    }))
    .filter((target) => target.label && target.id);
}

export function getOpenAppTargets(settings: AppSettings): OpenAppTarget[] {
  return normalizeOpenAppTargets(settings.openAppTargets ?? []);
}


