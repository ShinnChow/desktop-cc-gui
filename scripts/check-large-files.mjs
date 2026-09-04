#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".rs",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
  ".java",
  ".kt",
  ".go",
  ".py",
  ".yml",
  ".yaml",
]);

const EXCLUDED_DIRS = new Set([
  ".git",
  ".artifacts",
  ".omx",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "out",
  ".next",
  ".turbo",
]);

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    threshold: 3000,
    mode: "report",
    markdownOutput: null,
    baselineOutput: null,
    jsonOutput: null,
    baselineFile: null,
    newFileBaselineFile: null,
    policyFile: null,
    root: process.cwd(),
    scope: "fail",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--threshold") {
      const value = Number(readOptionValue(argv, index, "--threshold"));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --threshold value: ${argv[index + 1] ?? "<missing>"}`);
      }
      config.threshold = value;
      index += 1;
      continue;
    }
    if (token === "--mode") {
      const value = readOptionValue(argv, index, "--mode");
      if (!["report", "warn", "fail"].includes(value)) {
        throw new Error(`Invalid --mode value: ${value ?? "<missing>"}`);
      }
      config.mode = value;
      index += 1;
      continue;
    }
    if (token === "--markdown-output") {
      config.markdownOutput = readOptionValue(argv, index, "--markdown-output");
      index += 1;
      continue;
    }
    if (token === "--baseline-output") {
      config.baselineOutput = readOptionValue(argv, index, "--baseline-output");
      index += 1;
      continue;
    }
    if (token === "--json-output") {
      config.jsonOutput = readOptionValue(argv, index, "--json-output");
      index += 1;
      continue;
    }
    if (token === "--baseline-file") {
      config.baselineFile = readOptionValue(argv, index, "--baseline-file");
      index += 1;
      continue;
    }
    if (token === "--new-file-baseline-file") {
      config.newFileBaselineFile = readOptionValue(argv, index, "--new-file-baseline-file");
      index += 1;
      continue;
    }
    if (token === "--policy-file") {
      config.policyFile = readOptionValue(argv, index, "--policy-file");
      index += 1;
      continue;
    }
    if (token === "--root") {
      const root = readOptionValue(argv, index, "--root");
      config.root = path.resolve(root);
      index += 1;
      continue;
    }
    if (token === "--scope") {
      const value = readOptionValue(argv, index, "--scope");
      if (!["warn", "fail", "new-file"].includes(value)) {
        throw new Error(`Invalid --scope value: ${value ?? "<missing>"}`);
      }
      config.scope = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return config;
}

function toRepoPath(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

async function walkDirectory(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await walkDirectory(fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function detectType(relativePath, extension) {
  if (relativePath.startsWith("src/i18n/locales/")) {
    return "i18n";
  }
  if (relativePath.startsWith("src/styles/")) {
    return "css";
  }
  switch (extension) {
    case ".ts":
    case ".tsx":
      return "ts/tsx";
    case ".js":
    case ".jsx":
      return "js/jsx";
    case ".rs":
      return "rust";
    case ".css":
    case ".scss":
      return "css";
    default:
      return extension.slice(1);
  }
}

function detectLegacyPriority(relativePath) {
  const p0Prefixes = [
    "src-tauri/src/backend/",
    "src-tauri/src/engine/",
    "src-tauri/src/git/",
    "src/features/git-history/",
    "src/features/spec/",
    "src/features/settings/",
  ];

  const p0Explicit = new Set(["src/App.tsx"]);
  if (p0Explicit.has(relativePath) || p0Prefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return "P0";
  }
  if (relativePath.startsWith("src/styles/")) {
    return "P1";
  }
  if (relativePath.startsWith("src/i18n/locales/")) {
    return "P2";
  }
  return "P1";
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  let newLineCount = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      newLineCount += 1;
    }
  }
  return newLineCount + (content.endsWith("\n") ? 0 : 1);
}

function matchesPolicy(relativePath, policy) {
  const normalizedRelativePath = toRepoPath(relativePath);
  const match = policy.match ?? {};
  if (
    Array.isArray(match.exactPaths) &&
    match.exactPaths.some((exactPath) => toRepoPath(exactPath) === normalizedRelativePath)
  ) {
    return true;
  }
  if (
    Array.isArray(match.prefixes) &&
    match.prefixes.some((prefix) => normalizedRelativePath.startsWith(toRepoPath(prefix)))
  ) {
    return true;
  }
  if (
    Array.isArray(match.suffixes) &&
    match.suffixes.some((suffix) => normalizedRelativePath.endsWith(toRepoPath(suffix)))
  ) {
    return true;
  }
  return false;
}

export async function loadPolicyConfig(root, policyFile) {
  if (!policyFile) {
    return null;
  }
  const policyPath = path.resolve(root, policyFile);
  const raw = await fs.readFile(policyPath, "utf8");
  const parsed = JSON.parse(raw);
  validatePolicyConfig(parsed, policyFile);
  return parsed;
}

function validatePolicyConfig(policyConfig, policyFile) {
  if (!policyConfig || typeof policyConfig !== "object") {
    throw new Error(`Invalid large-file policy config: ${policyFile}`);
  }
  if (!Array.isArray(policyConfig.policies) || !policyConfig.defaultPolicy) {
    throw new Error(`Invalid large-file policy config: ${policyFile}`);
  }
  if (policyConfig.newFileFailThreshold != null) {
    const newFileFailThreshold = Number(policyConfig.newFileFailThreshold);
    if (!Number.isFinite(newFileFailThreshold) || newFileFailThreshold < 0) {
      throw new Error(`Invalid newFileFailThreshold in large-file policy config: ${policyFile}`);
    }
  }
  validateGrowthAllowance(policyConfig.growthAllowanceLines, `${policyFile}.growthAllowanceLines`);

  for (const [index, policy] of policyConfig.policies.entries()) {
    validatePolicy(policy, `${policyFile}.policies[${index}]`, { requireMatch: true });
  }
  validatePolicy(policyConfig.defaultPolicy, `${policyFile}.defaultPolicy`, { requireMatch: false });
}

function validatePolicy(policy, label, { requireMatch }) {
  if (!policy || typeof policy !== "object") {
    throw new Error(`Invalid large-file policy entry: ${label}`);
  }
  if (typeof policy.id !== "string" || policy.id.trim().length === 0) {
    throw new Error(`Invalid large-file policy id: ${label}`);
  }
  if (typeof policy.priority !== "string" || policy.priority.trim().length === 0) {
    throw new Error(`Invalid large-file policy priority: ${label}`);
  }

  const warnThreshold = Number(policy.warnThreshold);
  const failThreshold = Number(policy.failThreshold);
  if (!Number.isFinite(warnThreshold) || warnThreshold < 0) {
    throw new Error(`Invalid warnThreshold in large-file policy: ${label}`);
  }
  if (!Number.isFinite(failThreshold) || failThreshold < 0) {
    throw new Error(`Invalid failThreshold in large-file policy: ${label}`);
  }
  if (warnThreshold > failThreshold) {
    throw new Error(`Invalid threshold order in large-file policy: ${label}`);
  }
  validateGrowthAllowance(policy.growthAllowanceLines, `${label}.growthAllowanceLines`);
  if (policy.strictReduction != null && typeof policy.strictReduction !== "boolean") {
    throw new Error(`Invalid strictReduction in large-file policy: ${label}`);
  }

  if (requireMatch) {
    validatePolicyMatch(policy.match, label);
  }
}

function validateGrowthAllowance(value, label) {
  if (value == null) {
    return;
  }
  const allowance = Number(value);
  if (!Number.isFinite(allowance) || allowance < 0) {
    throw new Error(`Invalid growthAllowanceLines in large-file policy: ${label}`);
  }
}

function validatePolicyMatch(match, label) {
  if (!match || typeof match !== "object") {
    throw new Error(`Invalid large-file policy match: ${label}`);
  }

  const matcherKeys = ["exactPaths", "prefixes", "suffixes"];
  const hasMatcher = matcherKeys.some((key) => validateOptionalPathMatcher(match[key], `${label}.match.${key}`));
  if (!hasMatcher) {
    throw new Error(`Invalid large-file policy match: ${label}`);
  }
}

function validateOptionalPathMatcher(value, label) {
  if (value == null) {
    return false;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid large-file policy path matcher: ${label}`);
  }
  for (const item of value) {
    if (typeof item !== "string" || toRepoPath(item).trim().length === 0) {
      throw new Error(`Invalid large-file policy path matcher: ${label}`);
    }
  }
  return value.length > 0;
}

async function loadBaseline(root, baselineFile) {
  if (!baselineFile) {
    return null;
  }
  const baselinePath = path.resolve(root, baselineFile);
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
      throw new Error(`Invalid large-file baseline config: ${baselineFile}`);
    }
    for (const entry of parsed.entries) {
      const hasValidPath = entry && typeof entry.path === "string" && entry.path.length > 0;
      const hasValidLineCount =
        entry && typeof entry.lines === "number" && Number.isFinite(entry.lines) && entry.lines >= 0;
      if (!hasValidPath || !hasValidLineCount) {
        throw new Error(`Invalid large-file baseline entry in ${baselineFile}`);
      }
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Baseline file not found: ${baselineFile}. Run the baseline generation command before using baseline-aware checks.`,
      );
    }
    throw error;
  }
}

export function resolvePolicy(relativePath, policyConfig) {
  if (!policyConfig) {
    return null;
  }
  for (const policy of policyConfig.policies) {
    if (matchesPolicy(relativePath, policy)) {
      return policy;
    }
  }
  return policyConfig.defaultPolicy;
}

function buildBaselineMap(baseline) {
  if (!baseline) {
    return null;
  }
  const baselineMap = new Map();
  for (const entry of baseline.entries) {
    const normalizedPath = toRepoPath(entry.path);
    if (normalizedPath.length === 0) {
      throw new Error("Invalid large-file baseline entry path after normalization");
    }
    if (baselineMap.has(normalizedPath)) {
      throw new Error(`Duplicate large-file baseline entry after path normalization: ${normalizedPath}`);
    }
    baselineMap.set(normalizedPath, entry);
  }
  return baselineMap;
}

export function determineHardDebtStatus(lineCount, baselineEntry, hasBaseline, growthAllowanceLines = 0) {
  if (!hasBaseline) {
    return "captured";
  }
  if (!baselineEntry) {
    return "new";
  }
  if (lineCount > baselineEntry.lines + growthAllowanceLines) {
    return "regressed";
  }
  if (lineCount > baselineEntry.lines) {
    return "within-allowance";
  }
  if (lineCount === baselineEntry.lines) {
    return "retained";
  }
  return "reduced";
}

export function resolveGrowthAllowance(policy, policyConfig) {
  const raw = policy?.growthAllowanceLines ?? policyConfig?.growthAllowanceLines;
  return raw == null ? 0 : Number(raw);
}

function resolveNewFileFailThreshold(policyConfig) {
  if (policyConfig?.newFileFailThreshold == null) {
    return null;
  }
  const newFileFailThreshold = Number(policyConfig.newFileFailThreshold);
  if (!Number.isFinite(newFileFailThreshold)) {
    return null;
  }
  return newFileFailThreshold;
}

function classifyLegacyFile(relativePath, extension, lineCount, threshold) {
  if (lineCount <= threshold) {
    return null;
  }
  return {
    path: relativePath,
    lines: lineCount,
    type: detectType(relativePath, extension),
    priority: detectLegacyPriority(relativePath),
    policyId: "legacy-threshold",
    warnThreshold: threshold,
    failThreshold: threshold,
    severity: "fail",
    status: "oversized",
    baselineLines: null,
    delta: null,
    growthAllowanceLines: null,
  };
}

function classifyPolicyFile(
  relativePath,
  extension,
  lineCount,
  policyConfig,
  scope,
  baselineMap,
  newFileBaselineMap,
) {
  const policy = resolvePolicy(relativePath, policyConfig);
  if (!policy) {
    return null;
  }

  const warnThreshold = Number(policy.warnThreshold);
  const failThreshold = Number(policy.failThreshold);
  if (!Number.isFinite(warnThreshold) || !Number.isFinite(failThreshold)) {
    throw new Error(`Invalid thresholds in policy ${policy.id}`);
  }

  const growthAllowanceLines = resolveGrowthAllowance(policy, policyConfig);
  const newFileFailThreshold = resolveNewFileFailThreshold(policyConfig);
  if (scope === "new-file") {
    if (newFileFailThreshold == null) {
      throw new Error("Policy config must define newFileFailThreshold for --scope new-file");
    }
    if (lineCount <= newFileFailThreshold) {
      return null;
    }

    const baselineEntry = newFileBaselineMap?.get(relativePath) ?? null;
    const status = determineHardDebtStatus(lineCount, baselineEntry, newFileBaselineMap != null, growthAllowanceLines);
    const baselineLines = baselineEntry?.lines ?? null;
    const delta = baselineLines == null ? null : lineCount - baselineLines;

    return {
      path: relativePath,
      lines: lineCount,
      type: detectType(relativePath, extension),
      priority: policy.priority ?? "P1",
      policyId: policy.id,
      warnThreshold,
      failThreshold: newFileFailThreshold,
      severity: "fail",
      status,
      baselineLines,
      delta,
      growthAllowanceLines,
      thresholdSource: "new-file-ratchet",
      strictReduction: policy.strictReduction === true,
    };
  }

  if (scope === "warn" && lineCount <= warnThreshold) {
    return null;
  }

  const baselineEntry = baselineMap?.get(relativePath) ?? null;
  const isPolicyHardDebt = lineCount > failThreshold;
  const isRatchetScoped =
    scope === "fail" &&
    newFileBaselineMap != null &&
    newFileFailThreshold != null &&
    lineCount > newFileFailThreshold;
  const ratchetBaselineEntry = isRatchetScoped ? newFileBaselineMap.get(relativePath) ?? null : null;
  const isNewFileRatchetDebt = isRatchetScoped && ratchetBaselineEntry == null;
  const isNewFileRatchetRegression =
    !isPolicyHardDebt &&
    ratchetBaselineEntry != null &&
    lineCount > ratchetBaselineEntry.lines + growthAllowanceLines;

  if (scope === "fail" && !isPolicyHardDebt && !isNewFileRatchetDebt && !isNewFileRatchetRegression) {
    return null;
  }

  const isHardDebt = isPolicyHardDebt || isNewFileRatchetDebt || isNewFileRatchetRegression;
  const status = isPolicyHardDebt
    ? determineHardDebtStatus(lineCount, baselineEntry, baselineMap != null, growthAllowanceLines)
    : isNewFileRatchetDebt
      ? "new"
      : isNewFileRatchetRegression
        ? "regressed"
    : "watch";
  const baselineLines = isPolicyHardDebt
    ? baselineEntry?.lines ?? null
    : isNewFileRatchetRegression
      ? ratchetBaselineEntry.lines
      : null;
  const delta = baselineLines == null ? null : lineCount - baselineLines;
  const usesRatchetThreshold = !isPolicyHardDebt && (isNewFileRatchetDebt || isNewFileRatchetRegression);
  const effectiveFailThreshold = usesRatchetThreshold ? newFileFailThreshold : failThreshold;

  return {
    path: relativePath,
    lines: lineCount,
    type: detectType(relativePath, extension),
    priority: policy.priority ?? "P1",
    policyId: policy.id,
    warnThreshold,
    failThreshold: effectiveFailThreshold,
    severity: isHardDebt ? "fail" : "warn",
    status,
    baselineLines,
    delta,
    growthAllowanceLines,
    thresholdSource: usesRatchetThreshold ? "new-file-ratchet" : "policy",
    strictReduction: policy.strictReduction === true,
  };
}

export async function scanLargeFiles(options) {
  const policyConfig = await loadPolicyConfig(options.root, options.policyFile);
  const baseline = await loadBaseline(options.root, options.baselineFile);
  const newFileBaseline = await loadBaseline(options.root, options.newFileBaselineFile);
  if (policyConfig && newFileBaseline && resolveNewFileFailThreshold(policyConfig) == null) {
    throw new Error("Policy config must define newFileFailThreshold when --new-file-baseline-file is used");
  }
  const baselineMap = buildBaselineMap(baseline);
  const newFileBaselineMap = buildBaselineMap(newFileBaseline);

  const allFiles = await walkDirectory(options.root);
  const sourceFiles = allFiles.filter((absolutePath) => TEXT_EXTENSIONS.has(path.extname(absolutePath)));
  const results = [];

  for (const absolutePath of sourceFiles) {
    const content = await fs.readFile(absolutePath, "utf8");
    const lineCount = countLines(content);
    const relativePath = toRepoPath(path.relative(options.root, absolutePath));
    const extension = path.extname(relativePath);
    const item = policyConfig
      ? classifyPolicyFile(
          relativePath,
          extension,
          lineCount,
          policyConfig,
          options.scope,
          baselineMap,
          newFileBaselineMap,
        )
      : classifyLegacyFile(relativePath, extension, lineCount, options.threshold);
    if (item) {
      results.push(item);
    }
  }

  results.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

  return {
    root: options.root,
    scope: policyConfig ? options.scope : "legacy-threshold",
    threshold: policyConfig ? null : options.threshold,
    policyVersion: policyConfig?.version ?? null,
    results,
    baselineLoaded: baseline != null,
    newFileBaselineLoaded: newFileBaseline != null,
  };
}

function formatDelta(delta) {
  if (delta == null) {
    return "n/a";
  }
  if (delta > 0) {
    return `+${delta}`;
  }
  return String(delta);
}

function formatConsoleMessage(item) {
  const parts = [
    `${item.path} (${item.lines} lines`,
    item.type,
    item.policyId,
    item.priority,
  ];

  if (item.warnThreshold != null) {
    parts.push(`warn>${item.warnThreshold}`);
  }
  if (item.failThreshold != null) {
    parts.push(`fail>${item.failThreshold}`);
  }
  if (item.severity) {
    parts.push(`severity=${item.severity}`);
  }
  if (item.thresholdSource) {
    parts.push(`threshold=${item.thresholdSource}`);
  }
  if (item.status) {
    parts.push(`status=${item.status}`);
  }
  if (item.baselineLines != null) {
    parts.push(`baseline=${item.baselineLines}`);
    parts.push(`delta=${formatDelta(item.delta)}`);
    if (item.growthAllowanceLines != null) {
      parts.push(`allowance=${item.growthAllowanceLines}`);
    }
  }

  return `${parts.join(", ")})`;
}

function buildMarkdownReport(scan, generatedAt) {
  const title = scan.scope === "warn"
    ? "Large File Near-Threshold Watchlist"
    : scan.scope === "fail"
      ? "Large File Hard-Debt Baseline"
      : scan.scope === "new-file"
        ? "Large File New-File Ratchet Baseline"
      : "Large File Baseline";

  const lines = [
    "---",
    "type: generated",
    "status: generated",
    "---",
    "",
    `# ${title}`,
    "",
    "> **Lifecycle**: Generated snapshot. This report reflects repository state only at the generation time below; rerun the current scanner before making governance decisions.",
    "> **Fact boundary**: This Markdown is a human-readable projection, not an accepted baseline source or proof that the current tree passes the gate. Machine-readable baseline JSON and current CLI output remain authoritative.",
    "",
  ];
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push(`- Scope: ${scan.scope}`);
  if (scan.policyVersion) {
    lines.push(`- Policy version: ${scan.policyVersion}`);
  }
  if (scan.threshold != null) {
    lines.push(`- Threshold: > ${scan.threshold} lines`);
  }
  lines.push(`- Count: ${scan.results.length}`);
  lines.push("");
  lines.push("| File | Lines | Type | Policy | Priority | Warn | Fail | Severity | Status | Baseline | Delta |");
  lines.push("|---|---:|---|---|---|---:|---:|---|---|---:|---:|");
  for (const item of scan.results) {
    lines.push(
      `| \`${item.path}\` | ${item.lines} | ${item.type} | ${item.policyId} | ${item.priority} | ${item.warnThreshold ?? ""} | ${item.failThreshold ?? ""} | ${item.severity ?? ""} | ${item.status ?? ""} | ${item.baselineLines ?? ""} | ${item.delta ?? ""} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildBaselineJson(scan, generatedAt) {
  return JSON.stringify(
    {
      generatedAt,
      scope: scan.scope,
      policyVersion: scan.policyVersion,
      entries: scan.results.map((item) => ({
        path: item.path,
        lines: item.lines,
        type: item.type,
        policyId: item.policyId,
        priority: item.priority,
        warnThreshold: item.warnThreshold,
        failThreshold: item.failThreshold,
        thresholdSource: item.thresholdSource,
      })),
    },
    null,
    2,
  ) + "\n";
}

function buildStructuredReportJson(scan, generatedAt) {
  const blockingItems = scan.results.filter(isBlockingLargeFileFinding);
  const status = blockingItems.length > 0 ? "fail" : scan.results.length > 0 ? "warn" : "pass";
  return JSON.stringify(
    {
      schemaVersion: 1,
      gate: "large-files",
      generatedAt,
      status,
      scope: scan.scope,
      policyVersion: scan.policyVersion,
      baselineLoaded: scan.baselineLoaded,
      newFileBaselineLoaded: scan.newFileBaselineLoaded,
      findingCount: scan.results.length,
      blockingCount: blockingItems.length,
      results: scan.results,
    },
    null,
    2,
  ) + "\n";
}

async function writeOptionalOutput(root, outputPath, content) {
  const absolutePath = path.resolve(root, outputPath);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Output path must stay inside repository root: ${outputPath}`);
  }
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

function printSummary(scan, mode) {
  const scopeLabel = scan.threshold != null
    ? `threshold>${scan.threshold}`
    : `scope=${scan.scope}, policy=${scan.policyVersion ?? "unknown"}`;
  console.log(`Large file check: ${scopeLabel}, found=${scan.results.length}`);
  for (const item of scan.results) {
    const message = formatConsoleMessage(item);
    if (mode === "warn") {
      console.log(`::warning file=${item.path}::${message}`);
    } else {
      console.log(`- ${message}`);
    }
  }
}

function printRemediation(scan, mode) {
  if (mode !== "fail") {
    return;
  }
  const blockingItems = scan.results.filter(isBlockingLargeFileFinding);
  if (blockingItems.length === 0) {
    return;
  }
  console.log("");
  console.log("Remediation: split blocking files in the same PR or reduce them back to the recorded baseline before merge.");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const scan = await scanLargeFiles(options);
  printSummary(scan, options.mode);
  printRemediation(scan, options.mode);

  if (options.markdownOutput) {
    const generatedAt = new Date().toISOString();
    const markdown = buildMarkdownReport(scan, generatedAt);
    const markdownPath = await writeOptionalOutput(options.root, options.markdownOutput, markdown);
    console.log(`Markdown report written: ${toRepoPath(path.relative(options.root, markdownPath))}`);
  }

  if (options.baselineOutput) {
    const generatedAt = new Date().toISOString();
    const baselineJson = buildBaselineJson(scan, generatedAt);
    const baselinePath = await writeOptionalOutput(options.root, options.baselineOutput, baselineJson);
    console.log(`Baseline JSON written: ${toRepoPath(path.relative(options.root, baselinePath))}`);
  }

  if (options.jsonOutput) {
    const generatedAt = new Date().toISOString();
    const reportJson = buildStructuredReportJson(scan, generatedAt);
    const reportPath = await writeOptionalOutput(options.root, options.jsonOutput, reportJson);
    console.log(`Structured JSON report written: ${toRepoPath(path.relative(options.root, reportPath))}`);
  }

  const blockingItems = scan.results.filter(isBlockingLargeFileFinding);
  if (options.mode === "fail" && blockingItems.length > 0) {
    process.exitCode = 1;
  }
}

export function isBlockingLargeFileFinding(item) {
  if (item.status === "new" || item.status === "regressed" || item.status === "oversized") {
    return true;
  }
  if (item.status === "retained" && item.strictReduction === true) {
    return true;
  }
  return item.status === "captured" && item.severity === "fail";
}

const isDirectExecution =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`large-file-check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
