import { invoke } from "@tauri-apps/api/core";
import type { BridgePayloadBudgetMetadata } from "../../types";
import { traceStartupCommand, type StartupWorkspaceScope } from "../../features/startup-orchestration/utils/startupTrace";
import { isUnknownMethodError } from "./runtimeMode";

function workspaceScope(workspaceId: string): StartupWorkspaceScope {
  return { workspaceId };
}

function traceStartupInvoke<T>(
  commandLabel: string,
  scope: StartupWorkspaceScope,
  run: () => Promise<T>,
) {
  return traceStartupCommand(commandLabel, scope, run);
}

export type WorkspaceFilesResponse = {
  files: string[];
  directories: string[];
  gitignored_files: string[];
  gitignored_directories: string[];
  scan_state?: WorkspaceFileScanState;
  limit_hit?: boolean;
  directory_entries?: WorkspaceDirectoryEntry[];
  listingBudget?: WorkspaceFileListingBudgetMetadata | null;
  sourceVersion?: string | null;
  payloadBudget?: BridgePayloadBudgetMetadata | null;
};

export type WorkspaceFileScanState = "complete" | "partial";

export type WorkspaceFileListingCacheState =
  | "hit"
  | "miss"
  | "invalidated"
  | "unsupported";

export type WorkspaceFileListingBudgetMetadata = {
  depth?: number | null;
  maxEntries: number;
  returnedEntries: number;
  payloadBytes: number;
  sourceVersion: string;
  scanState: WorkspaceFileScanState;
  limitHit: boolean;
  cacheState: WorkspaceFileListingCacheState;
  requestedPath?: string | null;
  partial: boolean;
  pageCursor?: string | null;
};

export type WorkspaceDirectoryChildState =
  | "unknown"
  | "loaded"
  | "empty"
  | "partial";

export type WorkspaceDirectorySpecialKind = "dependency" | "build_artifact";

export type WorkspaceDirectoryEntry = {
  path: string;
  child_state: WorkspaceDirectoryChildState;
  special_kind?: WorkspaceDirectorySpecialKind | null;
  has_more?: boolean;
};

export type WorkspaceTextSearchMatch = {
  line: number;
  column: number;
  end_column: number;
  preview: string;
};

export type WorkspaceTextSearchFileResult = {
  path: string;
  match_count: number;
  matches: WorkspaceTextSearchMatch[];
};

export type WorkspaceTextSearchResponse = {
  files: WorkspaceTextSearchFileResult[];
  file_count: number;
  match_count: number;
  limit_hit: boolean;
};

export type ExternalSpecFileResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
};

export type DetachedExternalChangeMonitorStatus = {
  mode: "watcher" | "polling";
  fallbackReason?: string | null;
};

export type EngineTaskOutputArtifactTailResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
  byteLength: number;
};

export async function getWorkspaceFiles(
  workspaceId: string,
  options: { forceRefresh?: boolean } = {},
) {
  return traceStartupInvoke("list_workspace_files", workspaceScope(workspaceId), () =>
    invoke<WorkspaceFilesResponse>("list_workspace_files", {
      workspaceId,
      forceRefresh: options.forceRefresh ?? false,
    }),
  );
}

export async function getWorkspaceDirectoryChildren(
  workspaceId: string,
  path: string,
  options: { forceRefresh?: boolean } = {},
) {
  return invoke<WorkspaceFilesResponse>("list_workspace_directory_children", {
    workspaceId,
    path,
    forceRefresh: options.forceRefresh ?? false,
  });
}



export async function searchWorkspaceText(
  workspaceId: string,
  options: {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    isRegex: boolean;
    includePattern?: string | null;
    excludePattern?: string | null;
  },
) {
  return invoke<WorkspaceTextSearchResponse>("search_workspace_text", {
    workspaceId,
    query: options.query,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    isRegex: options.isRegex,
    includePattern: options.includePattern ?? null,
    excludePattern: options.excludePattern ?? null,
  });
}

export async function listExternalSpecTree(workspaceId: string, specRoot: string) {
  return invoke<WorkspaceFilesResponse>("list_external_spec_tree", {
    workspaceId,
    specRoot,
  });
}

export async function readWorkspaceFile(workspaceId: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_workspace_file", {
    workspaceId,
    path,
  });
}

/** 2.3 按需日志 tail：读文件末尾 ≤8 KiB（byte budget 对齐 tool-output），首字节不返回。 */
export async function readWorkspaceFileTail(
  workspaceId: string,
  path: string,
): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_workspace_file_tail", {
    workspaceId,
    path,
  });
}

export async function readWorkspaceFilePreview(workspaceId: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_workspace_file_preview", {
    workspaceId,
    path,
  });
}

export async function readExternalSpecFile(workspaceId: string, specRoot: string, path: string): Promise<ExternalSpecFileResponse> {
  return invoke<ExternalSpecFileResponse>("read_external_spec_file", {
    workspaceId,
    specRoot,
    path,
  });
}

export async function readExternalAbsoluteFile(workspaceId: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_external_absolute_file", {
    workspaceId,
    path,
  });
}

export async function readEngineTaskOutputArtifact(input: {
  workspaceId: string;
  path: string;
}): Promise<EngineTaskOutputArtifactTailResponse> {
  return invoke<EngineTaskOutputArtifactTailResponse>("engine_task_output_read_artifact", {
    workspaceId: input.workspaceId,
    path: input.path,
  });
}

export type FilePreviewHandle = {
  absolutePath: string;
  byteLength: number;
  extension: string | null;
};

export async function resolveFilePreviewHandle(
  workspaceId: string,
  options: {
    domain: "workspace" | "external-spec" | "external-absolute";
    path: string;
    specRoot?: string | null;
  },
): Promise<FilePreviewHandle> {
  return invoke<FilePreviewHandle>("resolve_file_preview_handle", {
    workspaceId,
    domain: options.domain,
    path: options.path,
    specRoot: options.specRoot ?? null,
  });
}

export async function readLocalImageDataUrl(workspaceId: string, path: string): Promise<string | null> {
  try {
    const result = await invoke<string>("read_local_image_data_url", {
      workspaceId,
      path,
    });
    return typeof result === "string" && result.startsWith("data:image/") ? result : null;
  } catch (error) {
    if (isUnknownMethodError(error, "read_local_image_data_url")) {
      return null;
    }
    return null;
  }
}

export async function writeWorkspaceFile(workspaceId: string, path: string, content: string): Promise<void> {
  return invoke("write_workspace_file", { workspaceId, path, content });
}

export async function readProjectCanvasFile(workspaceId: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("project_canvas_read_file", {
    workspaceId,
    path,
  });
}

export async function writeProjectCanvasFile(workspaceId: string, path: string, content: string): Promise<void> {
  return invoke("project_canvas_write_file", { workspaceId, path, content });
}

export async function trashProjectCanvasFile(workspaceId: string, path: string): Promise<void> {
  return invoke("project_canvas_trash_file", { workspaceId, path });
}

export async function compactProjectCanvasFiles(
  workspaceId: string,
): Promise<{ deletedDocuments: number; deletedTempFiles: number }> {
  return invoke<{ deletedDocuments: number; deletedTempFiles: number }>("project_canvas_compact_files", {
    workspaceId,
  });
}

export type ExportRewindFilesParams = {
  workspaceId: string;
  engine: "claude" | "codex" | "gemini";
  sessionId: string;
  targetMessageId: string;
  conversationLabel: string;
  files: Array<{
    path: string;
    status?: "A" | "D" | "R" | "M";
  }>;
};

export type ExportRewindFilesResult = {
  outputPath: string;
  filesPath: string;
  manifestPath: string;
  exportId: string;
  fileCount: number;
};

export async function exportRewindFiles(params: ExportRewindFilesParams): Promise<ExportRewindFilesResult> {
  return invoke<ExportRewindFilesResult>("export_rewind_files", params);
}

export async function createWorkspaceDirectory(workspaceId: string, path: string): Promise<void> {
  return invoke("create_workspace_directory", { workspaceId, path });
}

export async function writeExternalSpecFile(workspaceId: string, specRoot: string, path: string, content: string): Promise<void> {
  return invoke("write_external_spec_file", {
    workspaceId,
    specRoot,
    path,
    content,
  });
}

export async function writeExternalAbsoluteFile(workspaceId: string, path: string, content: string): Promise<void> {
  return invoke("write_external_absolute_file", { workspaceId, path, content });
}

export async function trashWorkspaceItem(workspaceId: string, path: string): Promise<void> {
  return invoke("trash_workspace_item", { workspaceId, path });
}

export type WorkspaceFileItemKind = "file" | "folder";

export type WorkspaceFileOperationResult = {
  path: string;
  kind: WorkspaceFileItemKind;
};



export async function duplicateWorkspaceItem(workspaceId: string, path: string): Promise<WorkspaceFileOperationResult> {
  return invoke<WorkspaceFileOperationResult>("duplicate_workspace_item", { workspaceId, path });
}

export async function pasteWorkspaceItem(
  workspaceId: string,
  sourcePath: string,
  targetDirectory: string,
): Promise<WorkspaceFileOperationResult> {
  return invoke<WorkspaceFileOperationResult>("paste_workspace_item", {
    workspaceId,
    sourcePath,
    targetDirectory,
  });
}

export async function renameWorkspaceItem(
  workspaceId: string,
  path: string,
  newName: string,
): Promise<WorkspaceFileOperationResult> {
  return invoke<WorkspaceFileOperationResult>("rename_workspace_item", {
    workspaceId,
    path,
    newName,
  });
}



export async function configureDetachedExternalChangeMonitor(
  workspaceId: string,
  workspacePath: string,
  activeFilePath: string,
  watcherEnabled: boolean,
): Promise<DetachedExternalChangeMonitorStatus> {
  return invoke<DetachedExternalChangeMonitorStatus>("configure_detached_external_change_monitor", {
    workspaceId,
    workspacePath,
    activeFilePath,
    watcherEnabled,
  });
}

export async function clearDetachedExternalChangeMonitor(workspaceId: string): Promise<void> {
  return invoke("clear_detached_external_change_monitor", { workspaceId });
}

export type WorkspaceCommandResult = {
  command: string[];
  exitCode: number;
  success: boolean;
  stdout: string;
  stderr: string;
};

export async function runWorkspaceCommand(workspaceId: string, command: string[], timeoutMs?: number | null): Promise<WorkspaceCommandResult> {
  return invoke<WorkspaceCommandResult>("run_workspace_command", {
    workspaceId,
    command,
    timeoutMs: timeoutMs ?? null,
  });
}

export async function runSpecCommand(
  workspaceId: string,
  command: string[],
  options?: {
    customSpecRoot?: string | null;
    timeoutMs?: number | null;
  },
): Promise<WorkspaceCommandResult> {
  return invoke<WorkspaceCommandResult>("run_spec_command", {
    workspaceId,
    command,
    customSpecRoot: options?.customSpecRoot ?? null,
    timeoutMs: options?.timeoutMs ?? null,
  });
}
