import * as ts from "typescript";
import {
  APP_SHELL_DOMAIN_CONTEXT_NAMES,
  APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS,
  findOverlappingAppShellDomainKeys,
  type AppShellDomainContextName,
} from "./appShellDomainContexts";

/**
 * T1.8 + T5.1：Domain key ownership / budget gate。
 *
 * - hard：无主 key、stale owner、跨域重叠、assembly 缺域、key 数超过 hard budget
 * - soft：超过 soft 80 的「仍待压」域（只记录，不 hard fail）
 * - 终态目标 hard 60（TARGET）；当前对超限域采用 **freeze hard**（禁止继续膨胀）
 */

/** 终态目标：每 domain keys ≤ 60（T5.1 路线图） */
export const APP_SHELL_DOMAIN_KEY_TARGET_HARD = 60;

/** 统一 soft 上限（T5.1）：超过即 soft violation */
export const APP_SHELL_DOMAIN_KEY_DEFAULT_SOFT = 80;

/**
 * Hard budgets（S4 PR-F：全部咬在实测值，任何新增 key 必须先改本表）：
 * - 已达标域（≤60）：hard = 实测 keys 数（零余量，先出后进）
 * - 仍超 soft 的遗留域：hard = 实测 keys 数冻结（禁止继续加 key）
 * 后续压到 60 时再下调 hard。
 */
export const APP_SHELL_DOMAIN_KEY_HARD_BUDGETS: Record<
  AppShellDomainContextName,
  number
> = {
  /** S4 PR-F：实测 51 咬死（PR-D/E 归位涌入后冻结） */
  runtimeThreadContext: 51,
  /** S4 PR-F：实测 14 咬死 */
  sessionIdentityContext: 14,
  /** S4 PR-F：实测 73 咬死（贴 soft 80，先出后进） */
  workspaceCatalogContext: 73,
  /** S4 PR-F：108 → 删 3 个无 bag 读者 keys（gitPullRequestDiffs/setDiffSource/setGitPanelMode 经 searchAndComposerInput 直传）后实测 105 咬死（仍超 soft 的唯一债务域） */
  gitSurfaceContext: 105,
  /** S4 PR-F：实测 33 咬死 */
  modeRoutingContext: 32,
  /** S4 PR-F：实测 11 咬死 */
  accountSurfaceContext: 11,
  /** S4 PR-F：实测 79 咬死；qoder doctor 入账后 79（贴顶，新增必须先出后进） */
  workspaceNavigationContext: 79,
  /** S4 PR-C：141 → 39 达标；S4 PR-F：实测 41 咬死（≤60 目标内零余量） */
  composerContext: 41,
  /** S4 PR-E：95 → 48 达标；S4 PR-F：实测 48 咬死 */
  layoutContext: 35,
  /** S4 PR-F：实测 69 咬死 */
  fileEditorContext: 66,
  /** S4 PR-E：124 → 36 达标；S4 PR-F：实测 36 咬死；F5（fix-session-switch-jank-red-lines）：threads 全量 map 4 keys 迁出 → 32 */
  settingsContext: 32,
  /** F5：threads 全量 map 独立域，实测 4 咬死（写权唯一 runtime thread host） */
  threadDataContext: 4,
  /** S4 PR-F：实测 1 咬死 */
  runtimeContext: 1,
  /** S4 PR-F：实测 22 咬死 */
  modelSelectionContext: 22,
  /** S4 PR-F：实测 15 咬死 */
  collaborationModeContext: 15,
};

/** Soft：所有域默认 80；未列入 map 的也按 DEFAULT_SOFT 计 */
export const APP_SHELL_DOMAIN_KEY_SOFT_BUDGETS: Partial<
  Record<AppShellDomainContextName, number>
> = Object.fromEntries(
  APP_SHELL_DOMAIN_CONTEXT_NAMES.map((name) => [
    name,
    APP_SHELL_DOMAIN_KEY_DEFAULT_SOFT,
  ]),
) as Partial<Record<AppShellDomainContextName, number>>;

export type DomainKeyDrift = {
  missingOwnerKeys: string[];
  staleOwnerKeys: string[];
};

export type DomainOwnershipGateReport = {
  explicitKeysByDomain: Record<string, string[]>;
  overlappingOwnedKeys: string[];
  unownedExplicitKeysByDomain: Record<string, string[]>;
  staleOwnedKeysByDomain: Record<string, string[]>;
  missingDomainsInAssembly: string[];
  hardBudgetViolations: Array<{
    domain: AppShellDomainContextName;
    count: number;
    budget: number;
  }>;
  softBudgetViolations: Array<{
    domain: AppShellDomainContextName;
    count: number;
    budget: number;
  }>;
};

export function compareDomainContextKeysWithOwnedKeys(
  explicitContextKeys: Iterable<string>,
  ownedContextKeys: Iterable<string>,
): DomainKeyDrift {
  const explicitKeySet = new Set(explicitContextKeys);
  const ownedKeySet = new Set(ownedContextKeys);
  return {
    missingOwnerKeys: [...explicitKeySet]
      .filter((key) => !ownedKeySet.has(key))
      .sort(),
    staleOwnerKeys: [...ownedKeySet]
      .filter((key) => !explicitKeySet.has(key))
      .sort(),
  };
}

export function findDuplicateRawContextKeys(
  explicitKeysByDomain: Record<string, string[]>,
): string[] {
  const duplicateKeys: string[] = [];
  const firstOwnerByKey = new Map<string, string>();

  for (const [domainName, explicitKeys] of Object.entries(
    explicitKeysByDomain,
  )) {
    const keysInDomain = new Set<string>();
    for (const key of explicitKeys) {
      if (keysInDomain.has(key)) {
        duplicateKeys.push(`${domainName}.${key}`);
        continue;
      }
      keysInDomain.add(key);

      const firstOwner = firstOwnerByKey.get(key);
      if (firstOwner && firstOwner !== domainName) {
        duplicateKeys.push(`${firstOwner}/${domainName}.${key}`);
        continue;
      }
      firstOwnerByKey.set(key, domainName);
    }
  }

  return duplicateKeys.sort();
}

function getPropertyNameText(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function collectObjectLiteralPropertyNames(
  objectLiteral: ts.ObjectLiteralExpression,
): string[] {
  const keys: string[] = [];
  for (const property of objectLiteral.properties) {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      continue;
    }
    const key = getPropertyNameText(property.name);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * builder 入参里仅作装配的 wrapper，不是 domain owned keys。
 * （runtimeThread 的 sessionHot；S4 PR-F 已删 legacyDefaults / runtimeActions 冗余 bag）
 */
const BUILDER_INPUT_WRAPPER_KEYS = new Set([
  "sessionHot",
]);

/**
 * 从 assembly 中 defineAppShellDomainContexts({...}) 提取各域显式 keys。
 *
 * - object literal 域：属性名
 * - build*DomainContextSlice 域：
 *   - 顶层「非 object literal 值」的属性名（真实 domain fields）
 *   - 一层嵌套 object（如 sessionHot）内的属性名
 *   - 忽略 wrapper 字段名本身（sessionHot）
 */
export function extractExplicitAppShellDomainContextKeysByDomain(
  assemblySource: string,
  fileName = "useAppShellDomainAssembly.ts",
): Record<string, string[]> {
  const sourceFile = ts.createSourceFile(
    fileName,
    assemblySource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const explicitKeysByDomain: Record<string, string[]> = {};

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "defineAppShellDomainContexts"
    ) {
      const contextsArgument = node.arguments[0];
      if (!contextsArgument || !ts.isObjectLiteralExpression(contextsArgument)) {
        return;
      }

      for (const domainProperty of contextsArgument.properties) {
        if (!ts.isPropertyAssignment(domainProperty)) {
          continue;
        }
        const domainName = getPropertyNameText(domainProperty.name);
        if (!domainName) {
          continue;
        }
        const domainValue = domainProperty.initializer;

        if (
          ts.isCallExpression(domainValue) &&
          /build\w+DomainContextSlice$/.test(
            domainValue.expression.getText(sourceFile),
          )
        ) {
          const arg = domainValue.arguments[0];
          if (!arg || !ts.isObjectLiteralExpression(arg)) {
            continue;
          }
          const keys: string[] = [];
          for (const property of arg.properties) {
            if (!ts.isPropertyAssignment(property)) {
              continue;
            }
            const key = getPropertyNameText(property.name);
            if (!key) {
              continue;
            }
            if (ts.isObjectLiteralExpression(property.initializer)) {
              // nested bag（sessionHot）：只收内层 field，忽略 wrapper 名
              keys.push(
                ...collectObjectLiteralPropertyNames(property.initializer),
              );
              continue;
            }
            if (BUILDER_INPUT_WRAPPER_KEYS.has(key)) {
              continue;
            }
            keys.push(key);
          }
          explicitKeysByDomain[domainName] = keys;
          continue;
        }

        if (!ts.isObjectLiteralExpression(domainValue)) {
          continue;
        }
        explicitKeysByDomain[domainName] =
          collectObjectLiteralPropertyNames(domainValue);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return explicitKeysByDomain;
}

export function evaluateAppShellDomainOwnershipGate(
  assemblySource: string,
): DomainOwnershipGateReport {
  const explicitKeysByDomain =
    extractExplicitAppShellDomainContextKeysByDomain(assemblySource);

  const unownedExplicitKeysByDomain: Record<string, string[]> = {};
  const staleOwnedKeysByDomain: Record<string, string[]> = {};
  const hardBudgetViolations: DomainOwnershipGateReport["hardBudgetViolations"] =
    [];
  const softBudgetViolations: DomainOwnershipGateReport["softBudgetViolations"] =
    [];

  const missingDomainsInAssembly = APP_SHELL_DOMAIN_CONTEXT_NAMES.filter(
    (domainName) => !(domainName in explicitKeysByDomain),
  );

  for (const domainName of APP_SHELL_DOMAIN_CONTEXT_NAMES) {
    const owned = APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS[domainName];
    const explicit = explicitKeysByDomain[domainName] ?? [];
    const drift = compareDomainContextKeysWithOwnedKeys(explicit, owned);
    if (drift.missingOwnerKeys.length > 0) {
      unownedExplicitKeysByDomain[domainName] = drift.missingOwnerKeys;
    }
    if (drift.staleOwnerKeys.length > 0) {
      staleOwnedKeysByDomain[domainName] = drift.staleOwnerKeys;
    }

    const count = owned.length;
    const hardBudget =
      APP_SHELL_DOMAIN_KEY_HARD_BUDGETS[domainName] ??
      APP_SHELL_DOMAIN_KEY_DEFAULT_SOFT;
    if (count > hardBudget) {
      hardBudgetViolations.push({
        domain: domainName,
        count,
        budget: hardBudget,
      });
    }
    const softBudget =
      APP_SHELL_DOMAIN_KEY_SOFT_BUDGETS[domainName] ??
      APP_SHELL_DOMAIN_KEY_DEFAULT_SOFT;
    if (count > softBudget) {
      softBudgetViolations.push({
        domain: domainName,
        count,
        budget: softBudget,
      });
    }
  }

  return {
    explicitKeysByDomain,
    overlappingOwnedKeys: findOverlappingAppShellDomainKeys(),
    unownedExplicitKeysByDomain,
    staleOwnedKeysByDomain,
    missingDomainsInAssembly: [...missingDomainsInAssembly],
    hardBudgetViolations,
    softBudgetViolations,
  };
}

/** hard gate failures（应导致 test/CI fail） */
export function listDomainOwnershipHardFailures(
  report: DomainOwnershipGateReport,
): string[] {
  const failures: string[] = [];

  if (report.overlappingOwnedKeys.length > 0) {
    failures.push(
      `overlapping OWNED_KEYS: ${report.overlappingOwnedKeys.join(", ")}`,
    );
  }
  if (report.missingDomainsInAssembly.length > 0) {
    failures.push(
      `assembly missing domains: ${report.missingDomainsInAssembly.join(", ")}`,
    );
  }
  for (const [domain, keys] of Object.entries(
    report.unownedExplicitKeysByDomain,
  )) {
    if (keys.length > 0) {
      failures.push(
        `[${domain}] unowned explicit keys (must add to APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS): ${keys.join(", ")}`,
      );
    }
  }
  for (const [domain, keys] of Object.entries(report.staleOwnedKeysByDomain)) {
    if (keys.length > 0) {
      failures.push(
        `[${domain}] stale OWNED_KEYS (not present in assembly bag/builder): ${keys.join(", ")}`,
      );
    }
  }
  for (const violation of report.hardBudgetViolations) {
    failures.push(
      `[${violation.domain}] hard key budget exceeded: ${violation.count} > ${violation.budget}`,
    );
  }

  return failures;
}

/** soft failures（T1.8 记录；默认不阻断） */
export function listDomainOwnershipSoftFailures(
  report: DomainOwnershipGateReport,
): string[] {
  return report.softBudgetViolations.map(
    (violation) =>
      `[${violation.domain}] soft key budget exceeded: ${violation.count} > ${violation.budget}`,
  );
}
