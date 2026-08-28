import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import {
  APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS,
  defineAppShellDomainContexts,
  findOverlappingAppShellDomainKeys,
  listAppShellDomainContextNames,
  reuseStableAppShellDomainContexts,
  APP_SHELL_CONSUMER_DOMAIN_SELECTION,
  type AppShellDomainContextName,
  type AppShellDomainContexts,
} from "./appShellDomainContexts";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readSourceFile(relativePath: string): string {
  return readFileSync(join(currentDir, relativePath), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

function createDomainContexts(): AppShellDomainContexts {
  return {
    runtimeThreadContext: { activeThreadId: "thread-1" },
    sessionIdentityContext: {},
    workspaceCatalogContext: {},
    gitSurfaceContext: {},
    modeRoutingContext: {},
    accountSurfaceContext: {},
    workspaceNavigationContext: { activeWorkspaceId: "workspace-1" },
    composerContext: { activeDraft: "hello" },
    layoutContext: { centerMode: "chat" },
    fileEditorContext: { activeEditorFilePath: "src/app-shell.tsx" },
    settingsContext: { appSettings: { theme: "system" } },
    threadDataContext: { threadsByWorkspace: {} },
    runtimeContext: { runtimeRunState: { runtimeConsoleVisible: false } },
    modelSelectionContext: { effectiveSelectedModelId: "model-1" },
    collaborationModeContext: { selectedCollaborationModeId: "code" },
  };
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

function extractExplicitAppShellDomainContextKeysByDomain(
  assemblySource: string,
): Record<string, string[]> {
  // T1.1 起 production bag 在 useAppShellDomainAssembly.assembleAppShellDomainContexts
  const sourceFile = ts.createSourceFile(
    "useAppShellDomainAssembly.ts",
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
      expect(
        contextsArgument && ts.isObjectLiteralExpression(contextsArgument),
      ).toBe(true);

      for (const domainProperty of (
        contextsArgument as ts.ObjectLiteralExpression
      ).properties) {
        if (!ts.isPropertyAssignment(domainProperty)) {
          continue;
        }
        const domainName = getPropertyNameText(domainProperty.name);
        if (!domainName) {
          continue;
        }
        const domainValue = domainProperty.initializer;
        // S4 PR-F：干净域可用 build*DomainContextSlice(...)；其输出 keys 以 OWNED_KEYS 为准。
        if (
          ts.isCallExpression(domainValue) &&
          /build\w+DomainContextSlice$/.test(
            domainValue.expression.getText(sourceFile),
          )
        ) {
          explicitKeysByDomain[domainName] = [
            ...APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS[
              domainName as AppShellDomainContextName
            ],
          ];
          continue;
        }
        if (!ts.isObjectLiteralExpression(domainValue)) {
          continue;
        }
        explicitKeysByDomain[domainName] = [];
        for (const contextProperty of domainValue.properties) {
          if (
            !ts.isPropertyAssignment(contextProperty) &&
            !ts.isShorthandPropertyAssignment(contextProperty)
          ) {
            continue;
          }
          const key = getPropertyNameText(contextProperty.name);
          if (key) {
            explicitKeysByDomain[domainName].push(key);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return explicitKeysByDomain;
}

function compareDomainContextKeysWithOwnedKeys(
  explicitContextKeys: Iterable<string>,
  ownedContextKeys: Iterable<string>,
) {
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

function findDuplicateRawContextKeys(
  explicitKeysByDomain: Record<string, string[]>,
) {
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

describe("appShellDomainContexts", () => {
  it("defines the fifteen app shell domain contexts in migration order", () => {
    expect(listAppShellDomainContextNames()).toEqual([
      "runtimeThreadContext",
      "sessionIdentityContext",
      "workspaceCatalogContext",
      "gitSurfaceContext",
      "modeRoutingContext",
      "accountSurfaceContext",
      "workspaceNavigationContext",
      "composerContext",
      "layoutContext",
      "fileEditorContext",
      "settingsContext",
      "threadDataContext",
      "runtimeContext",
      "modelSelectionContext",
      "collaborationModeContext",
    ]);
  });

  it("keeps representative domain input ownership disjoint", () => {
    expect(findOverlappingAppShellDomainKeys()).toEqual([]);
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.runtimeThreadContext).toContain(
      "runtimeThreadBoundary",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.runtimeThreadContext).toContain(
      "isProcessing",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.runtimeThreadContext).toContain(
      "activeItems",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("isProcessing");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("activeItems");
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.sessionIdentityContext).toContain(
      "activeWorkspaceId",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.sessionIdentityContext).toContain(
      "activeThreadId",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("activeWorkspaceId");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("activeThreadId");
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceCatalogContext).toContain(
      "addWorkspace",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceCatalogContext).toContain(
      "connectWorkspace",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("addWorkspace");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("connectWorkspace");
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.gitSurfaceContext).toContain(
      "activeDiffs",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.gitSurfaceContext).toContain(
      "gitStatus",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("activeDiffs");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("gitStatus");
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.modeRoutingContext).toContain(
      "appMode",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.modeRoutingContext).toContain(
      "centerMode",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("appMode");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("centerMode");
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.accountSurfaceContext).toContain(
      "activeAccount",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.accountSurfaceContext).toContain(
      "approvals",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("activeAccount");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).not.toContain("approvals");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext.length,
    ).toBeLessThanOrEqual(80);
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.settingsContext).toContain(
      "sidebarCollapsed",
    );
    // F5：threads 全量 map 迁入 threadDataContext，settingsContext 不再持有。
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.threadDataContext).toContain(
      "threadItemsByThread",
    );
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.settingsContext,
    ).not.toContain("threadItemsByThread");
    expect(
      APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.workspaceNavigationContext,
    ).toContain(
      "activeEditorFilePath",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.runtimeContext).toEqual([
      "runtimeRunState",
    ]);
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.modelSelectionContext).toContain(
      "effectiveSelectedModelId",
    );
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.collaborationModeContext).toContain(
      "selectedCollaborationModeId",
    );
  });

  it("covers every explicit app-shell domain context key in the ownership map", () => {
    const assemblySource = readSourceFile("useAppShellDomainAssembly.ts");
    const explicitKeysByDomain =
      extractExplicitAppShellDomainContextKeysByDomain(assemblySource);
    const missingOwnerKeysByDomain: Record<string, string[]> = {};
    const staleOwnerKeysByDomain: Record<string, string[]> = {};

    expect(findDuplicateRawContextKeys(explicitKeysByDomain)).toEqual([]);

    for (const domainName of listAppShellDomainContextNames()) {
      const { missingOwnerKeys, staleOwnerKeys } =
        compareDomainContextKeysWithOwnedKeys(
          explicitKeysByDomain[domainName] ?? [],
          APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS[domainName],
        );
      if (missingOwnerKeys.length > 0) {
        missingOwnerKeysByDomain[domainName] = missingOwnerKeys;
      }
      if (staleOwnerKeys.length > 0) {
        staleOwnerKeysByDomain[domainName] = staleOwnerKeys;
      }
    }

    expect(missingOwnerKeysByDomain).toEqual({});
    expect(staleOwnerKeysByDomain).toEqual({});
  });

  it("reports drift when a raw app-shell key has no owner", () => {
    const comparison = compareDomainContextKeysWithOwnedKeys(
      ["activeWorkspaceId", "newUnownedRuntimeKey"],
      ["activeWorkspaceId"],
    );

    expect(comparison.missingOwnerKeys).toEqual(["newUnownedRuntimeKey"]);
    expect(comparison.staleOwnerKeys).toEqual([]);
  });

  it("reports drift when a raw app-shell key appears in multiple domains", () => {
    expect(
      findDuplicateRawContextKeys({
        workspaceNavigationContext: ["activeWorkspaceId", "sharedKey"],
        collaborationModeContext: ["selectedCollaborationModeId", "sharedKey"],
      }),
    ).toEqual(["workspaceNavigationContext/collaborationModeContext.sharedKey"]);
  });

  it("preserves domain object references instead of cloning them", () => {
    const contexts = createDomainContexts();
    const definedContexts = defineAppShellDomainContexts(contexts);

    expect(definedContexts.runtimeThreadContext).toBe(
      contexts.runtimeThreadContext,
    );
    expect(definedContexts.workspaceNavigationContext).toBe(
      contexts.workspaceNavigationContext,
    );
    expect(definedContexts.composerContext).toBe(contexts.composerContext);
    expect(definedContexts.layoutContext).toBe(contexts.layoutContext);
    expect(definedContexts.fileEditorContext).toBe(contexts.fileEditorContext);
    expect(definedContexts.settingsContext).toBe(contexts.settingsContext);
    expect(definedContexts.runtimeContext).toBe(contexts.runtimeContext);
    expect(definedContexts.modelSelectionContext).toBe(
      contexts.modelSelectionContext,
    );
    expect(definedContexts.collaborationModeContext).toBe(
      contexts.collaborationModeContext,
    );
  });

  it("reuses all domain references when shallow values are stable", () => {
    const appSettings = { theme: "system" };
    const threadData = { threadsByWorkspace: {} };
    const runtimeRunState = { runtimeConsoleVisible: false };
    const modelSelection = { effectiveSelectedModelId: "model-1" };
    const collaborationMode = { selectedCollaborationModeId: "code" };
    const previousContexts: AppShellDomainContexts = {
      runtimeThreadContext: { activeThreadId: "thread-1" },
      sessionIdentityContext: {},
      workspaceCatalogContext: {},
      gitSurfaceContext: {},
      modeRoutingContext: {},
      accountSurfaceContext: {},
      workspaceNavigationContext: { activeWorkspaceId: "workspace-1" },
      composerContext: { activeDraft: "hello" },
      layoutContext: { centerMode: "chat" },
      fileEditorContext: { activeEditorFilePath: "src/app-shell.tsx" },
      settingsContext: { appSettings },
      threadDataContext: threadData,
      runtimeContext: { runtimeRunState },
      modelSelectionContext: modelSelection,
      collaborationModeContext: collaborationMode,
    };
    const nextContexts: AppShellDomainContexts = {
      runtimeThreadContext: { activeThreadId: "thread-1" },
      sessionIdentityContext: {},
      workspaceCatalogContext: {},
      gitSurfaceContext: {},
      modeRoutingContext: {},
      accountSurfaceContext: {},
      workspaceNavigationContext: { activeWorkspaceId: "workspace-1" },
      composerContext: { activeDraft: "hello" },
      layoutContext: { centerMode: "chat" },
      fileEditorContext: { activeEditorFilePath: "src/app-shell.tsx" },
      settingsContext: { appSettings },
      threadDataContext: threadData,
      runtimeContext: { runtimeRunState },
      modelSelectionContext: modelSelection,
      collaborationModeContext: collaborationMode,
    };

    const stableContexts = reuseStableAppShellDomainContexts(
      previousContexts,
      nextContexts,
    );

    for (const domainName of listAppShellDomainContextNames()) {
      expect(stableContexts[domainName]).toBe(previousContexts[domainName]);
    }
  });

  it("replaces only the changed domain reference", () => {
    const previousContexts = createDomainContexts();
    const nextContexts: AppShellDomainContexts = {
      ...previousContexts,
      composerContext: { activeDraft: "updated" },
    };

    const stableContexts = reuseStableAppShellDomainContexts(
      previousContexts,
      nextContexts,
    );

    expect(stableContexts.runtimeThreadContext).toBe(
      previousContexts.runtimeThreadContext,
    );
    expect(stableContexts.workspaceNavigationContext).toBe(
      previousContexts.workspaceNavigationContext,
    );
    expect(stableContexts.composerContext).toBe(nextContexts.composerContext);
    expect(stableContexts.layoutContext).toBe(previousContexts.layoutContext);
    expect(stableContexts.fileEditorContext).toBe(
      previousContexts.fileEditorContext,
    );
    expect(stableContexts.settingsContext).toBe(
      previousContexts.settingsContext,
    );
    expect(stableContexts.runtimeContext).toBe(previousContexts.runtimeContext);
    expect(stableContexts.modelSelectionContext).toBe(
      previousContexts.modelSelectionContext,
    );
    expect(stableContexts.collaborationModeContext).toBe(
      previousContexts.collaborationModeContext,
    );
  });

  it("keeps runtime updates isolated from file editor context", () => {
    const previousContexts = createDomainContexts();
    const nextContexts: AppShellDomainContexts = {
      ...previousContexts,
      runtimeContext: {
        runtimeRunState: { runtimeConsoleVisible: true },
      },
    };

    const stableContexts = reuseStableAppShellDomainContexts(
      previousContexts,
      nextContexts,
    );

    expect(stableContexts.fileEditorContext).toBe(
      previousContexts.fileEditorContext,
    );
    expect(stableContexts.runtimeContext).toBe(nextContexts.runtimeContext);
  });

  it("keeps file editor updates isolated from runtime context", () => {
    const previousContexts = createDomainContexts();
    const nextContexts: AppShellDomainContexts = {
      ...previousContexts,
      fileEditorContext: { activeEditorFilePath: "src/next.tsx" },
    };

    const stableContexts = reuseStableAppShellDomainContexts(
      previousContexts,
      nextContexts,
    );

    expect(stableContexts.runtimeContext).toBe(previousContexts.runtimeContext);
    expect(stableContexts.fileEditorContext).toBe(nextContexts.fileEditorContext);
  });

  it("keeps model selection updates isolated from settings context", () => {
    const previousContexts = createDomainContexts();
    const nextContexts: AppShellDomainContexts = {
      ...previousContexts,
      modelSelectionContext: { effectiveSelectedModelId: "model-2" },
    };

    const stableContexts = reuseStableAppShellDomainContexts(
      previousContexts,
      nextContexts,
    );

    expect(stableContexts.settingsContext).toBe(previousContexts.settingsContext);
    expect(stableContexts.modelSelectionContext).toBe(
      nextContexts.modelSelectionContext,
    );
  });

  it("keeps collaboration mode updates isolated from settings context", () => {
    const previousContexts = createDomainContexts();
    const nextContexts: AppShellDomainContexts = {
      ...previousContexts,
      collaborationModeContext: { selectedCollaborationModeId: "plan" },
    };

    const stableContexts = reuseStableAppShellDomainContexts(
      previousContexts,
      nextContexts,
    );

    expect(stableContexts.settingsContext).toBe(previousContexts.settingsContext);
    expect(stableContexts.collaborationModeContext).toBe(
      nextContexts.collaborationModeContext,
    );
  });

  it("keeps runtimeRunState owned only by runtimeContext", () => {
    expect(findOverlappingAppShellDomainKeys()).toEqual([]);
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.runtimeContext).toEqual([
      "runtimeRunState",
    ]);
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.fileEditorContext).not.toContain(
      "runtimeRunState",
    );
  });

  it("wires app-shell production context through the domain objects", () => {
    const appShellSource = readSourceFile("../../app-shell.tsx");
    const compositionSource = readSourceFile("../hosts/useAppShellAssemblyHost.ts");
    const assemblySource = readSourceFile("useAppShellDomainAssembly.ts");
    const renderAppShellSource = readSourceFile("../render/renderAppShell.tsx");
    const searchAndComposerSource = readSourceFile(
      "../sections/useAppShellSearchAndComposerSection.ts",
    );
    const sectionsSource = readSourceFile(
      "../sections/core/useAppShellSections.ts",
    );
    const layoutNodesSource = readSourceFile(
      "../sections/layoutNodes/useAppShellLayoutNodesSection.tsx",
    );

    expect(appShellSource).not.toContain("const appShellContext = {");
    expect(appShellSource).not.toContain("const appShellContext =");
    // T1.1/T2.6：assembly 在 composition host；bag 字面量在 useAppShellDomainAssembly
    expect(compositionSource).toContain("useAppShellDomainAssembly({");
    expect(appShellSource).not.toContain("defineAppShellDomainContexts(");
    expect(compositionSource).not.toContain("defineAppShellDomainContexts(");
    expect(assemblySource).toContain("defineAppShellDomainContexts(");
    for (const domainName of listAppShellDomainContextNames()) {
      // 对象字面量，或 S4 PR-F 干净域 builder 调用（在 assembly 模块内）
      const hasObjectLiteral = assemblySource.includes(`${domainName}: {`);
      const hasBuilderSlice = new RegExp(
        `${domainName}:\\s*build\\w+DomainContextSlice\\(`,
      ).test(assemblySource);
      expect(hasObjectLiteral || hasBuilderSlice).toBe(true);
    }
    expect(assemblySource).toContain("reuseStableAppShellDomainContexts(");
    expect(assemblySource).toContain(
      "previousRef.current = stable;",
    );
    for (const source of [
      renderAppShellSource,
      searchAndComposerSource,
      sectionsSource,
      layoutNodesSource,
    ]) {
      expect(source).not.toContain("as unknown as");
      expect(source).not.toMatch(
        /flattenAppShellDomainContexts\(\s*(ctx|input)\.appShellDomainContexts\s*\)/,
      );
    }
    // T4.2：生产路径使用 selectAppShellDomainBag / merge（非 Legacy 命名）
    expect(renderAppShellSource).toContain("selectAppShellDomainBag");
    expect(renderAppShellSource).toContain("mergeAppShellDomainBag");
    expect(renderAppShellSource).not.toContain(
      "adaptAppShellLegacyFlatContext",
    );
    expect(renderAppShellSource).not.toContain(
      "flattenSelectedAppShellDomainContextsMemoized(",
    );
    expect(sectionsSource).toContain("selectAppShellDomainBag");
    expect(sectionsSource).not.toContain(
      "flattenSelectedAppShellDomainContextsMemoized(",
    );
    expect(layoutNodesSource).toContain("selectAppShellDomainBag");
    expect(layoutNodesSource).not.toContain(
      "flattenSelectedAppShellDomainContextsMemoized(",
    );
    expect(searchAndComposerSource).toContain(
      "COMPOSER_SEARCH_BOUNDARY_FIELD_GROUPS",
    );
    expect(searchAndComposerSource).not.toContain(
      "adaptAppShellLegacyFlatContext<ComposerSearchShellBoundary>",
    );
    expect(sectionsSource).not.toContain("adaptAppShellLegacyFlatContext");
    // T2.6：render / sections 在 AppShellView；assembly 在 composition
    const viewSource = readSourceFile("../assembly/appShellView.tsx");
    expect(viewSource).toContain("renderAppShell({");
    expect(viewSource).toContain("appShellDomainContexts:");
    expect(viewSource).toContain("useAppShellSearchAndComposerSection(");
    expect(viewSource).toContain("useAppShellSections({");
    expect(viewSource).toContain("useAppShellLayoutNodesSection({");
    expect(appShellSource).not.toContain(
      "renderAppShell({\n    ...appShellContext",
    );
    expect(compositionSource).toContain("searchAndComposerInput");
    expect(compositionSource).not.toMatch(
      /useAppShellSearchAndComposerSection\(\{\s*workspaceNavigationContext:/,
    );
    expect(appShellSource).not.toContain(
      "useAppShellSearchAndComposerSection(appShellContext)",
    );
    expect(appShellSource).not.toContain(
      "useAppShellSections({\n    ...appShellContext",
    );
    expect(appShellSource).not.toContain(
      "useAppShellLayoutNodesSection({\n    ...appShellContext",
    );
  });

  it("keeps layoutNodes as the last domain bag merge extra in renderAppShell (T4.2)", () => {
    const renderAppShellSource = readSourceFile("../render/renderAppShell.tsx");

    const mergeStart = renderAppShellSource.indexOf(
      "mergeAppShellDomainBag<RenderAppShellFlattenedContext>(",
    );
    expect(mergeStart).toBeGreaterThanOrEqual(0);
    const mergeEnd = renderAppShellSource.indexOf(");", mergeStart);
    expect(mergeEnd).toBeGreaterThan(mergeStart);
    const mergeBody = renderAppShellSource.slice(mergeStart, mergeEnd);

    const domainBagIndex = mergeBody.indexOf("domainBag,");
    const searchComposerIndex = mergeBody.indexOf(
      "ctx.searchAndComposerSection",
    );
    const sectionsIndex = mergeBody.indexOf("ctx.sections");
    const layoutNodesIndex = mergeBody.indexOf("ctx.layoutNodes");

    expect(domainBagIndex).toBeGreaterThanOrEqual(0);
    expect(searchComposerIndex).toBeGreaterThan(domainBagIndex);
    expect(sectionsIndex).toBeGreaterThan(searchComposerIndex);
    expect(layoutNodesIndex).toBeGreaterThan(sectionsIndex);
  });
});

describe("APP_SHELL_CONSUMER_DOMAIN_SELECTION", () => {
  it("keeps sections/render smaller than layoutNodes (no full-domain flatten)", () => {
    // F5 后全集 14；真实 flatten 已拆成 canvas/chrome/git zone。
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodes).toHaveLength(14);
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesCanvas).toEqual([
      "runtimeThreadContext",
      "sessionIdentityContext",
      "composerContext",
      "modelSelectionContext",
      "collaborationModeContext",
      "threadDataContext",
    ]);
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesChrome).not.toContain(
      "runtimeThreadContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesGit).toEqual([
      "gitSurfaceContext",
      "fileEditorContext",
    ]);
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections.length).toBeLessThan(15);
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render.length).toBeLessThan(15);
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "sessionIdentityContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "workspaceCatalogContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "gitSurfaceContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "modeRoutingContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "accountSurfaceContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).toContain(
      "sessionIdentityContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).toContain(
      "modeRoutingContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).toContain(
      "accountSurfaceContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).toContain(
      "workspaceCatalogContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).toContain(
      "gitSurfaceContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).not.toContain(
      "modelSelectionContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).not.toContain(
      "collaborationModeContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).not.toContain(
      "runtimeThreadContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).not.toContain(
      "modelSelectionContext",
    );
    // S4 PR-C：render 不再读 composerContext（输入态只扇出 sections/layoutNodes）；
    // layoutNodes 直读 runtimeContext，不经 bag flatten
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).not.toContain(
      "composerContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodes).not.toContain(
      "runtimeContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodes).toContain(
      "composerContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "composerContext",
    );
  });
});

