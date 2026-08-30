import { describe, expect, it } from "vitest";
import {
  APP_SHELL_CONSUMER_DOMAIN_SELECTION,
  type AppShellDomainContexts,
} from "./appShellDomainContexts";
import {
  bindAppShellDomainBag,
  createDomainFlattenCache,
  mergeAppShellDomainBag,
  selectAppShellDomainBag,
} from "./selectAppShellDomainBag";

function createContexts(
  overrides: Partial<AppShellDomainContexts> = {},
): AppShellDomainContexts {
  return {
    runtimeThreadContext: { isProcessing: false, canInterrupt: false },
    sessionIdentityContext: { activeWorkspaceId: "ws-1", activeThreadId: "t-1" },
    workspaceCatalogContext: { addWorkspace: () => {} },
    gitSurfaceContext: { gitStatus: null },
    modeRoutingContext: { appMode: "chat" },
    accountSurfaceContext: { activeAccount: null },
    workspaceNavigationContext: { agent: null },
    composerContext: { handleSend: () => {} },
    layoutContext: { sidebarCollapsed: false },
    fileEditorContext: { activeEditorFilePath: null },
    settingsContext: { settingsOpen: false },
    threadDataContext: { threadsByWorkspace: {} },
    runtimeContext: { runtimeRunState: { phase: "idle" } },
    modelSelectionContext: { selectedModelId: "m1" },
    collaborationModeContext: { selectedCollaborationModeId: null },
    ...overrides,
  };
}

describe("selectAppShellDomainBag (T4)", () => {
  it("reuses bag identity when selected domains are unchanged (T4.4)", () => {
    const cache = createDomainFlattenCache();
    const base = createContexts();
    const first = selectAppShellDomainBag(
      base,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections,
      cache,
    );
    // unselected domain change (runtimeThread not in sections)
    const next = createContexts({
      runtimeThreadContext: { isProcessing: true, canInterrupt: true },
      sessionIdentityContext: base.sessionIdentityContext,
      workspaceCatalogContext: base.workspaceCatalogContext,
      gitSurfaceContext: base.gitSurfaceContext,
      modeRoutingContext: base.modeRoutingContext,
      accountSurfaceContext: base.accountSurfaceContext,
      workspaceNavigationContext: base.workspaceNavigationContext,
      composerContext: base.composerContext,
      layoutContext: base.layoutContext,
      fileEditorContext: base.fileEditorContext,
      settingsContext: base.settingsContext,
      threadDataContext: base.threadDataContext,
      runtimeContext: base.runtimeContext,
      modelSelectionContext: base.modelSelectionContext,
      collaborationModeContext: base.collaborationModeContext,
    });
    const second = selectAppShellDomainBag(
      next,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections,
      cache,
    );
    expect(second).toBe(first);
    expect(second).not.toHaveProperty("isProcessing");
  });

  it("rebuilds when a selected domain identity changes", () => {
    const cache = createDomainFlattenCache();
    const base = createContexts();
    const first = selectAppShellDomainBag(
      base,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections,
      cache,
    );
    const next = {
      ...base,
      sessionIdentityContext: {
        activeWorkspaceId: "ws-2",
        activeThreadId: "t-2",
      },
    };
    const second = selectAppShellDomainBag(
      next,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections,
      cache,
    );
    expect(second).not.toBe(first);
    expect(second.activeWorkspaceId).toBe("ws-2");
  });

  it("binds and merges bags for consumer boundaries", () => {
    const bag = selectAppShellDomainBag(
      createContexts(),
      ["sessionIdentityContext"] as const,
      createDomainFlattenCache(),
    );
    const bound = bindAppShellDomainBag<{ activeWorkspaceId: string }>(bag);
    expect(bound.activeWorkspaceId).toBe("ws-1");
    const merged = mergeAppShellDomainBag<{
      activeWorkspaceId: string;
      extra: number;
    }>(bag, { extra: 1 });
    expect(merged.extra).toBe(1);
  });
});

describe("selectAppShellDomainBag identity cache (S4 PR-F：memoized flatten 引擎收敛本模块)", () => {
  it("reuses flattened bag when ad-hoc domain subset identities are unchanged", () => {
    const cache = createDomainFlattenCache();
    const base = createContexts({
      runtimeThreadContext: { isProcessing: true, activeTurnId: "t1" },
    });
    const first = selectAppShellDomainBag(
      base,
      ["runtimeThreadContext", "composerContext"],
      cache,
    );
    const second = selectAppShellDomainBag(
      base,
      ["runtimeThreadContext", "composerContext"],
      cache,
    );
    expect(second).toBe(first);
    expect(first.isProcessing).toBe(true);
    expect(first).not.toHaveProperty("settingsOpen");
  });

  it("rebuilds ad-hoc subset bag when a domain identity changes", () => {
    const cache = createDomainFlattenCache();
    const base = createContexts();
    const first = selectAppShellDomainBag(
      base,
      ["runtimeThreadContext", "composerContext"],
      cache,
    );
    const next = createContexts({
      runtimeThreadContext: { isProcessing: true },
    });
    const second = selectAppShellDomainBag(
      next,
      ["runtimeThreadContext", "composerContext"],
      cache,
    );
    expect(second).not.toBe(first);
    expect(second.isProcessing).toBe(true);
  });
});
