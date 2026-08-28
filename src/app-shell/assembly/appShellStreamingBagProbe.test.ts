import { describe, expect, it } from "vitest";
import {
  APP_SHELL_CONSUMER_DOMAIN_SELECTION,
  type AppShellDomainContexts,
} from "../domains/appShellDomainContexts";
import {
  createDomainFlattenCache,
  selectAppShellDomainBag,
} from "../domains/selectAppShellDomainBag";

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

describe("appShellStreamingBagProbe", () => {
  it("keeps chrome and git bags stable when only runtimeThread churns", () => {
    const canvasCache = createDomainFlattenCache();
    const chromeCache = createDomainFlattenCache();
    const gitCache = createDomainFlattenCache();
    const base = createContexts();
    const firstChrome = selectAppShellDomainBag(
      base,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesChrome,
      chromeCache,
    );
    const firstGit = selectAppShellDomainBag(
      base,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesGit,
      gitCache,
    );
    const firstCanvas = selectAppShellDomainBag(
      base,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesCanvas,
      canvasCache,
    );

    const streamed = createContexts({
      runtimeThreadContext: {
        isProcessing: true,
        canInterrupt: true,
        activeItems: [{ id: "msg-1" }],
      },
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
      runtimeContext: base.runtimeContext,
      modelSelectionContext: base.modelSelectionContext,
      collaborationModeContext: base.collaborationModeContext,
    });

    const nextChrome = selectAppShellDomainBag(
      streamed,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesChrome,
      chromeCache,
    );
    const nextGit = selectAppShellDomainBag(
      streamed,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesGit,
      gitCache,
    );
    const nextCanvas = selectAppShellDomainBag(
      streamed,
      APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesCanvas,
      canvasCache,
    );

    expect(nextChrome).toBe(firstChrome);
    expect(nextGit).toBe(firstGit);
    expect(nextCanvas).not.toBe(firstCanvas);
    expect(nextCanvas.isProcessing).toBe(true);
    expect(nextChrome).not.toHaveProperty("isProcessing");
    expect(nextGit).not.toHaveProperty("isProcessing");
  });

  it("keeps the union of zone bags equivalent to the legacy layoutNodes set", () => {
    const union = new Set([
      ...APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesCanvas,
      ...APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesChrome,
      ...APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesGit,
    ]);
    expect([...union].sort()).toEqual(
      [...APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodes].sort(),
    );
  });
});
