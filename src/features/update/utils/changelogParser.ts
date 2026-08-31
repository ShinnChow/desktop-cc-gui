/**
 * CHANGELOG.md parser for release notes.
 * Keep in sync with scripts/lib/changelogParser.mjs (used by generate-release-notes).
 */

// Real CHANGELOG uses ###; older samples / docs used #####. Accept both.
const CHANGELOG_HEADING_CN = /^#{3,5}\s+\*\*(.+?)（\s*(v?[^）]+)\s*）\*\*\s*$/;
const CHANGELOG_HEADING_ASCII = /^#{3,5}\s+\*\*(.+?)\(\s*(v?[^)]+)\s*\)\*\*\s*$/;
const ENGLISH_MARKER = /^English:\s*$/i;
const CHINESE_MARKER = /^中文[:：]\s*$/;
const RULE_LINE = /^-{3,}\s*$/;

export type ReleaseNotesEntry = {
  id: string;
  tagName: string;
  version: string;
  title: string;
  dateLabel: string;
  englishBody: string;
  chineseBody: string;
};

/** Index/catalog row without markdown bodies (cold-start safe). */
export type ReleaseNotesCatalogItem = Omit<
  ReleaseNotesEntry,
  "englishBody" | "chineseBody"
>;

type ParsedHeading = {
  dateLabel: string;
  tagName: string;
  version: string;
};

function normalizeDateLabel(raw: string): string {
  const trimmed = raw.trim();
  const zhMatch = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (zhMatch) {
    const [, year, month, day] = zhMatch;
    return `${year}/${(month ?? "").padStart(2, "0")}/${(day ?? "").padStart(2, "0")}`;
  }
  const isoMatch = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}/${(month ?? "").padStart(2, "0")}/${(day ?? "").padStart(2, "0")}`;
  }
  return trimmed;
}

export function normalizeReleaseVersion(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^v/i, "");
}

function parseHeading(line: string): ParsedHeading | null {
  const trimmed = line.trim();
  const matched =
    trimmed.match(CHANGELOG_HEADING_CN) ?? trimmed.match(CHANGELOG_HEADING_ASCII);
  if (!matched) {
    return null;
  }

  const dateLabel = normalizeDateLabel(matched[1] ?? "");
  const normalizedVersion = normalizeReleaseVersion(matched[2] ?? "");
  if (!normalizedVersion) {
    return null;
  }
  return {
    dateLabel,
    tagName: `v${normalizedVersion}`,
    version: normalizedVersion,
  };
}

function trimBlock(lines: string[]): string {
  const filtered = lines.filter((line) => !RULE_LINE.test(line.trim()));
  let start = 0;
  let end = filtered.length;
  while (start < end && !filtered[start]?.trim()) {
    start += 1;
  }
  while (end > start && !filtered[end - 1]?.trim()) {
    end -= 1;
  }
  return filtered.slice(start, end).join("\n");
}

/** Slice one language block; stop at the other marker when it follows. */
function sliceLanguageBlock(
  lines: string[],
  startIndex: number,
  otherIndex: number,
): string[] {
  if (startIndex < 0) {
    return [];
  }
  const end = otherIndex > startIndex ? otherIndex : lines.length;
  return lines.slice(startIndex + 1, end);
}

function parseLanguageSections(lines: string[]): {
  englishBody: string;
  chineseBody: string;
} {
  const englishIndex = lines.findIndex((line) =>
    ENGLISH_MARKER.test(line.trim()),
  );
  const chineseIndex = lines.findIndex((line) =>
    CHINESE_MARKER.test(line.trim()),
  );

  if (englishIndex < 0 && chineseIndex < 0) {
    const shared = trimBlock(lines);
    return {
      englishBody: shared,
      chineseBody: shared,
    };
  }

  // Support both "English then 中文" and current CHANGELOG "中文 then English".
  const englishLines = sliceLanguageBlock(lines, englishIndex, chineseIndex);
  const chineseLines = sliceLanguageBlock(lines, chineseIndex, englishIndex);

  return {
    englishBody: trimBlock(englishLines),
    chineseBody: trimBlock(chineseLines),
  };
}

export function parseChangelogEntries(markdown: string): ReleaseNotesEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: ReleaseNotesEntry[] = [];

  let currentHeading: ParsedHeading | null = null;
  let currentBlock: string[] = [];

  const flush = () => {
    if (!currentHeading) {
      return;
    }
    const sections = parseLanguageSections(currentBlock);
    entries.push({
      id: currentHeading.version,
      tagName: currentHeading.tagName,
      version: currentHeading.version,
      title: currentHeading.tagName,
      dateLabel: currentHeading.dateLabel,
      englishBody: sections.englishBody,
      chineseBody: sections.chineseBody,
    });
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      flush();
      currentHeading = heading;
      currentBlock = [];
      continue;
    }
    if (!currentHeading) {
      continue;
    }
    currentBlock.push(line);
  }

  flush();
  return entries;
}



export function findReleaseIndex(
  entries: ReadonlyArray<Pick<ReleaseNotesEntry, "version">>,
  preferredVersion: string | null | undefined,
): number {
  if (!entries.length) {
    return 0;
  }
  const normalized = normalizeReleaseVersion(preferredVersion);
  if (!normalized) {
    return 0;
  }
  const index = entries.findIndex((entry) => entry.version === normalized);
  return index >= 0 ? index : 0;
}

/** Safe filename stem for a SemVer-like version (no path separators). */
export function releaseNotesEntryFileStem(version: string): string {
  const normalized = normalizeReleaseVersion(version) ?? version.trim();
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_");
}
