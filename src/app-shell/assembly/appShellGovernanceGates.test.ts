import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS,
  listAppShellDomainContextNames,
} from "../domains/appShellDomainContexts";
import {
  APP_SHELL_DOMAIN_KEY_DEFAULT_SOFT,
  APP_SHELL_DOMAIN_KEY_HARD_BUDGETS,
  APP_SHELL_DOMAIN_KEY_TARGET_HARD,
  evaluateAppShellDomainOwnershipGate,
  listDomainOwnershipHardFailures,
  listDomainOwnershipSoftFailures,
} from "../domains/appShellDomainOwnershipGate";

/**
 * T5：AppShell 治理门禁（预算 / composition / useState / soft 报告）
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const appShellEntryPath = join(currentDir, "AppShell.tsx");
const appShellReexportPath = join(currentDir, "..", "..", "app-shell.tsx");
const compositionPath = join(currentDir, "useAppShellRootComposition.ts");
const sessionHostPath = join(currentDir, "..", "hosts", "useAppShellSessionHost.ts");
const catalogHostPath = join(currentDir, "..", "hosts", "useAppShellCatalogHost.ts");
const gitHostPath = join(currentDir, "..", "hosts", "useAppShellGitSurfaceHost.ts");
const runtimeHostPath = join(
  currentDir,
  "..",
  "hosts",
  "useAppShellRuntimeThreadHost.ts",
);
const composerHostPath = join(currentDir, "..", "hosts", "useAppShellComposerHost.ts");
const flowsHostPath = join(
  currentDir,
  "..",
  "hosts",
  "useAppShellWorkspaceFlowsHost.ts",
);
const assemblyHostPath = join(currentDir, "..", "hosts", "useAppShellAssemblyHost.ts");
const assemblyPath = join(
  currentDir,
  "..",
  "domains",
  "useAppShellDomainAssembly.ts",
);

const COMPOSITION_SOFT_LINES = 600;
const COMPOSITION_HARD_LINES = 800;
/** 三刀后根 facade 不再持有业务 hooks；Host 模块各自硬顶 800。 */
const ROOT_COMPOSITION_HARD_LINES = 80;
const HOST_HARD_LINES = 800;

function lineCount(path: string): number {
  return readFileSync(path, "utf8").split("\n").length;
}

function listUseStateCalls(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (/\buseState\s*[<(]/.test(line)) {
      hits.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe("appShellGovernanceGates (T5)", () => {
  it("T5.1: every domain has a hard budget and stays within freeze hard", () => {
    for (const domain of listAppShellDomainContextNames()) {
      expect(APP_SHELL_DOMAIN_KEY_HARD_BUDGETS[domain]).toBeTypeOf("number");
      const count = APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS[domain].length;
      expect(
        count,
        `${domain} keys ${count} exceeds hard ${APP_SHELL_DOMAIN_KEY_HARD_BUDGETS[domain]}`,
      ).toBeLessThanOrEqual(APP_SHELL_DOMAIN_KEY_HARD_BUDGETS[domain]);
    }
    expect(APP_SHELL_DOMAIN_KEY_TARGET_HARD).toBe(60);
    expect(APP_SHELL_DOMAIN_KEY_DEFAULT_SOFT).toBe(80);
  });

  it("T5.1: soft budget 80 records remaining debt domains without hard-fail", () => {
    const report = evaluateAppShellDomainOwnershipGate(
      readFileSync(assemblyPath, "utf8"),
    );
    const soft = listDomainOwnershipSoftFailures(report);
    // S4 PR-F 后遗留：仅 gitSurface 仍 > 80（105，hard 咬实测冻结）；
    // composer / layout / settings 均已压到 ≤60 达标，退出 soft 债务名单
    expect(soft.some((line) => line.includes("composerContext"))).toBe(false);
    expect(soft.some((line) => line.includes("gitSurfaceContext"))).toBe(true);
    expect(soft.some((line) => line.includes("settingsContext"))).toBe(false);
    expect(soft.some((line) => line.includes("layoutContext"))).toBe(false);
    expect(listDomainOwnershipHardFailures(report)).toEqual([]);
  });

  it("T5.1: composerContext 达标终态目标且 hard 咬实测（S4 PR-C：141 → 39；S4 PR-F：41）", () => {
    const count = APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.composerContext.length;
    expect(count).toBeLessThanOrEqual(APP_SHELL_DOMAIN_KEY_TARGET_HARD);
    // S4 PR-F：hard 从 TARGET 60 收紧到实测 41，新增 key 必须先出后进
    expect(APP_SHELL_DOMAIN_KEY_HARD_BUDGETS.composerContext).toBe(41);
    expect(count).toBeLessThanOrEqual(
      APP_SHELL_DOMAIN_KEY_HARD_BUDGETS.composerContext,
    );
  });

  it("T5.1: settings/layout 达标终态目标且 hard 咬实测（S4 PR-E：36/48；remove-kanban layout 48→35；F5：settings 36→32，threads 全量 map 4 keys 迁入 threadDataContext）", () => {
    const measuredFreeze = {
      settingsContext: 32,
      layoutContext: 35,
    } as const;
    for (const domain of ["settingsContext", "layoutContext"] as const) {
      const count = APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS[domain].length;
      expect(count).toBeLessThanOrEqual(APP_SHELL_DOMAIN_KEY_TARGET_HARD);
      expect(APP_SHELL_DOMAIN_KEY_HARD_BUDGETS[domain]).toBe(
        measuredFreeze[domain],
      );
      expect(count).toBeLessThanOrEqual(
        APP_SHELL_DOMAIN_KEY_HARD_BUDGETS[domain],
      );
    }
  });

  it("T5.2: AppShell composition entry within soft/hard line budgets", () => {
    const entryLines = lineCount(appShellEntryPath);
    const reexportLines = lineCount(appShellReexportPath);
    expect(entryLines).toBeLessThanOrEqual(COMPOSITION_SOFT_LINES);
    expect(entryLines).toBeLessThanOrEqual(COMPOSITION_HARD_LINES);
    expect(reexportLines).toBeLessThanOrEqual(20);
    expect(lineCount(compositionPath)).toBeLessThanOrEqual(
      ROOT_COMPOSITION_HARD_LINES,
    );
    for (const path of [
      sessionHostPath,
      catalogHostPath,
      gitHostPath,
      runtimeHostPath,
      composerHostPath,
      flowsHostPath,
      assemblyHostPath,
    ]) {
      expect(
        lineCount(path),
        `${path} exceeds host hard ${HOST_HARD_LINES}`,
      ).toBeLessThanOrEqual(HOST_HARD_LINES);
    }
  });

  it("T5.3: forbids business useState in AppShell entry files", () => {
    for (const path of [appShellEntryPath, appShellReexportPath]) {
      const hits = listUseStateCalls(readFileSync(path, "utf8"));
      expect(hits, `${path}\n${hits.join("\n")}`).toEqual([]);
    }
  });
});
