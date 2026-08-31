import type { GitFileDiff, GitFileStatus } from "../../../types";

export type CanonicalGitChangeSection = "staged" | "unstaged";

export type CanonicalGitChangeSource = {
  fromStatus: boolean;
  fromDiff: boolean;
  statusInferred: boolean;
};



export type CanonicalGitChanges = {
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  viewerDiffs: GitFileDiff[];
};

type BuildCanonicalGitChangesInput = {
  files: GitFileStatus[];
  stagedFiles?: GitFileStatus[];
  unstagedFiles?: GitFileStatus[];
  diffs: GitFileDiff[];
};

const KNOWN_STATUSES = new Set(["A", "M", "D", "R", "T"]);

export function normalizeGitChangePath(path: string | null | undefined): string {
  const normalized = (path ?? "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  return normalized.split("/").filter(Boolean).join("/");
}

export function getGitChangeListRowKey(
  section: CanonicalGitChangeSection,
  path: string,
): string {
  return `${section}:${normalizeGitChangePath(path)}`;
}

export function getGitChangeViewerKey(path: string): string {
  return normalizeGitChangePath(path);
}

export function getGitChangeActionKey(
  section: CanonicalGitChangeSection,
  path: string,
  operation: string,
): string {
  return `${section}:${normalizeGitChangePath(path)}:${operation}`;
}

function normalizeStatus(status: string | null | undefined): string | null {
  const normalized = status?.trim().slice(0, 1).toUpperCase() ?? "";
  if (!normalized) {
    return null;
  }
  return KNOWN_STATUSES.has(normalized) ? normalized : normalized;
}

function splitDiffLines(diff: string): string[] {
  return diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function inferGitDiffStatus(diff: GitFileDiff): string {
  const explicitStatus = normalizeStatus(diff.status);
  if (explicitStatus) {
    return explicitStatus;
  }

  const lines = splitDiffLines(diff.diff ?? "");
  const hasRenameFrom = lines.some((line) => line.startsWith("rename from "));
  const hasRenameTo = lines.some((line) => line.startsWith("rename to "));
  if (hasRenameFrom && hasRenameTo) {
    return "R";
  }
  if (
    lines.some(
      (line) => line.startsWith("new file mode") || line === "--- /dev/null",
    )
  ) {
    return "A";
  }
  if (
    lines.some(
      (line) => line.startsWith("deleted file mode") || line === "+++ /dev/null",
    )
  ) {
    return "D";
  }
  return "M";
}

export function countDiffStats(diffText: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of splitDiffLines(diffText)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function canCreateFallbackFromDiff(diff: GitFileDiff): boolean {
  const normalizedPath = normalizeGitChangePath(diff.path);
  if (!normalizedPath) {
    return false;
  }
  if (typeof diff.diff !== "string") {
    return false;
  }
  if (diff.diff.trim().length > 0) {
    return true;
  }
  return Boolean(
    diff.status ||
      diff.isImage ||
      diff.oldImageData ||
      diff.newImageData ||
      diff.oldImageMime ||
      diff.newImageMime,
  );
}

function copyStatusFile(file: GitFileStatus): GitFileStatus | null {
  const normalizedPath = normalizeGitChangePath(file.path);
  if (!normalizedPath) {
    return null;
  }
  return {
    ...file,
    ...(typeof file.oldPath === "string"
      ? { oldPath: normalizeGitChangePath(file.oldPath) || undefined }
      : {}),
    status: normalizeStatus(file.status) ?? file.status,
  };
}

function mergeStatusFileWithDiffStats(
  file: GitFileStatus,
  diffByPath: Map<string, GitFileDiff>,
  eligibleDiffStatPaths?: Set<string>,
): GitFileStatus {
  const normalizedPath = normalizeGitChangePath(file.path);
  if (eligibleDiffStatPaths && !eligibleDiffStatPaths.has(normalizedPath)) {
    return file;
  }
  const diff = diffByPath.get(normalizedPath);
  if (!diff || file.additions + file.deletions > 0) {
    return file;
  }
  const stats = countDiffStats(diff.diff);
  if (stats.additions + stats.deletions === 0) {
    return file;
  }
  return {
    ...file,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

function createFallbackStatusFile(diff: GitFileDiff): GitFileStatus | null {
  if (!canCreateFallbackFromDiff(diff)) {
    return null;
  }
  const path = normalizeGitChangePath(diff.path);
  if (!path) {
    return null;
  }
  const stats = countDiffStats(diff.diff);
  return {
    path,
    status: inferGitDiffStatus(diff),
    additions: stats.additions,
    deletions: stats.deletions,
    isDiffOnlyFallback: true,
    mutationDisabled: true,
  };
}

function createViewerDiff(
  file: GitFileStatus,
  diffByPath: Map<string, GitFileDiff>,
): GitFileDiff {
  const normalizedPath = normalizeGitChangePath(file.path);
  const diff = diffByPath.get(normalizedPath);
  return {
    path: file.path,
    status: file.status,
    diff: diff?.diff ?? "",
    isBinary: diff?.isBinary,
    isImage: diff?.isImage,
    isDiffOnlyFallback: file.isDiffOnlyFallback,
    oldImageData: diff?.oldImageData,
    newImageData: diff?.newImageData,
    oldImageMime: diff?.oldImageMime,
    newImageMime: diff?.newImageMime,
  };
}

function dedupeStatusFiles(files: GitFileStatus[]): GitFileStatus[] {
  const result: GitFileStatus[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const copied = copyStatusFile(file);
    if (!copied) {
      continue;
    }
    const key = normalizeGitChangePath(copied.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(copied);
  }
  return result;
}

function enrichStatusFilesWithDiffStats(
  files: GitFileStatus[],
  diffByPath: Map<string, GitFileDiff>,
  eligibleDiffStatPaths?: Set<string>,
): GitFileStatus[] {
  return files.map((file) =>
    mergeStatusFileWithDiffStats(file, diffByPath, eligibleDiffStatPaths),
  );
}

export function buildCanonicalGitChanges({
  files,
  stagedFiles = [],
  unstagedFiles = [],
  diffs,
}: BuildCanonicalGitChangesInput): CanonicalGitChanges {
  const normalizedStatusPaths = new Set<string>();
  const diffByPath = new Map<string, GitFileDiff>();

  for (const diff of diffs) {
    const normalizedPath = normalizeGitChangePath(diff.path);
    if (normalizedPath && !diffByPath.has(normalizedPath)) {
      diffByPath.set(normalizedPath, diff);
    }
  }

  const canonicalFiles = enrichStatusFilesWithDiffStats(
    dedupeStatusFiles(files),
    diffByPath,
  );
  const rawCanonicalStagedFiles = dedupeStatusFiles(stagedFiles);
  const rawCanonicalUnstagedFiles = dedupeStatusFiles(unstagedFiles);
  const sectionPathCounts = new Map<string, number>();
  for (const file of [...rawCanonicalStagedFiles, ...rawCanonicalUnstagedFiles]) {
    const normalizedPath = normalizeGitChangePath(file.path);
    if (!normalizedPath) {
      continue;
    }
    sectionPathCounts.set(
      normalizedPath,
      (sectionPathCounts.get(normalizedPath) ?? 0) + 1,
    );
  }
  const sectionDiffStatPaths = new Set(
    Array.from(sectionPathCounts.entries())
      .filter(([, count]) => count === 1)
      .map(([path]) => path),
  );
  const canonicalStagedFiles = enrichStatusFilesWithDiffStats(
    rawCanonicalStagedFiles,
    diffByPath,
    sectionDiffStatPaths,
  );
  const canonicalUnstagedFiles = enrichStatusFilesWithDiffStats(
    rawCanonicalUnstagedFiles,
    diffByPath,
    sectionDiffStatPaths,
  );
  const aggregateFilesByPath = new Map<string, GitFileStatus>();

  for (const file of [
    ...canonicalFiles,
    ...canonicalStagedFiles,
    ...canonicalUnstagedFiles,
  ]) {
    const normalizedPath = normalizeGitChangePath(file.path);
    if (normalizedPath && !aggregateFilesByPath.has(normalizedPath)) {
      aggregateFilesByPath.set(normalizedPath, file);
    }
  }

  for (const file of [
    ...canonicalFiles,
    ...canonicalStagedFiles,
    ...canonicalUnstagedFiles,
  ]) {
    normalizedStatusPaths.add(normalizeGitChangePath(file.path));
    if (normalizeStatus(file.status) === "R") {
      const normalizedOldPath = normalizeGitChangePath(file.oldPath);
      if (normalizedOldPath) {
        normalizedStatusPaths.add(normalizedOldPath);
      }
    }
  }

  const fallbackFiles: GitFileStatus[] = [];
  for (const diff of diffs) {
    const normalizedPath = normalizeGitChangePath(diff.path);
    if (!normalizedPath || normalizedStatusPaths.has(normalizedPath)) {
      continue;
    }
    const fallbackFile = createFallbackStatusFile(diff);
    if (!fallbackFile) {
      continue;
    }
    fallbackFiles.push(fallbackFile);
    normalizedStatusPaths.add(normalizedPath);
  }

  const filesWithFallback = [
    ...Array.from(aggregateFilesByPath.values()),
    ...fallbackFiles,
  ];
  const unstagedFilesWithFallback = [
    ...canonicalUnstagedFiles,
    ...fallbackFiles,
  ];
  const viewerDiffs = filesWithFallback.map((file) =>
    createViewerDiff(file, diffByPath),
  );

  return {
    files: filesWithFallback,
    stagedFiles: canonicalStagedFiles,
    unstagedFiles: unstagedFilesWithFallback,
    viewerDiffs,
  };
}
