import { describe, expect, it } from "vitest";
import {
  APP_SHELL_DOMAIN_CONTEXT_NAMES,
  APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS,
  reuseStableAppShellDomainContexts,
} from "./appShellDomainContexts";
import { assembleAppShellDomainContexts } from "./useAppShellDomainAssembly";

function buildMinimalAssemblySource(): Record<string, unknown> {
  const source: Record<string, unknown> = {
    runtimeThreadBoundary: { kind: "runtime-thread-boundary" },
    runtimeRunState: { phase: "idle" },
    effectiveReasoningOptions: [],
    effectiveSelectedEffort: null,
    handleSelectComposerEffort: () => {},
  };

  for (const domainName of APP_SHELL_DOMAIN_CONTEXT_NAMES) {
    for (const key of APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS[domainName]) {
      if (source[key] === undefined) {
        source[key] = `owned:${domainName}:${key}`;
      }
    }
  }

  // modelSelection rename sources
  source.effectiveModels = ["m1"];
  source.effectiveReasoningSupported = true;
  source.effectiveSelectedModel = "m1";
  source.effectiveSelectedModelId = "m1";
  source.providerModelCatalogs = {};
  source.refreshEngineModels = () => {};
  source.resolvedEffort = null;
  source.resolvedModel = "m1";
  source.setSelectedModelId = () => {};

  // collaboration minimal
  source.applySelectedCollaborationMode = () => {};
  source.collaborationModePayload = null;
  source.collaborationModes = [];
  source.collaborationModesEnabled = false;
  source.collaborationRuntimeModeByThread = {};
  source.collaborationUiModeByThread = {};
  source.handleCollaborationModeResolved = () => {};
  source.resolveCollaborationRuntimeMode = () => null;
  source.resolveCollaborationUiMode = () => null;
  source.selectedCollaborationMode = null;
  source.selectedCollaborationModeId = null;
  source.setCodexCollaborationMode = () => {};
  source.setCollaborationRuntimeModeByThread = () => {};
  source.setCollaborationUiModeByThread = () => {};
  source.setSelectedCollaborationModeId = () => {};

  return source;
}

describe("assembleAppShellDomainContexts", () => {
  it("defines all domains and keeps runtimeThread hot fields out of navigation", () => {
    const contexts = assembleAppShellDomainContexts(buildMinimalAssemblySource());

    expect(Object.keys(contexts).sort()).toEqual(
      [...APP_SHELL_DOMAIN_CONTEXT_NAMES].sort(),
    );
    expect(contexts.runtimeThreadContext.isProcessing).toBe(
      "owned:runtimeThreadContext:isProcessing",
    );
    expect(contexts.runtimeThreadContext.activeItems).toBe(
      "owned:runtimeThreadContext:activeItems",
    );
    expect(contexts.workspaceNavigationContext).not.toHaveProperty(
      "isProcessing",
    );
    expect(contexts.sessionIdentityContext.activeWorkspaceId).toBe(
      "owned:sessionIdentityContext:activeWorkspaceId",
    );
    expect(contexts.workspaceNavigationContext).not.toHaveProperty(
      "activeWorkspaceId",
    );
    expect(contexts.workspaceCatalogContext.addWorkspace).toBe(
      "owned:workspaceCatalogContext:addWorkspace",
    );
    expect(contexts.workspaceNavigationContext).not.toHaveProperty(
      "addWorkspace",
    );
    expect(contexts.gitSurfaceContext.gitStatus).toBe(
      "owned:gitSurfaceContext:gitStatus",
    );
    expect(contexts.workspaceNavigationContext).not.toHaveProperty(
      "gitStatus",
    );
    expect(contexts.modeRoutingContext.appMode).toBe(
      "owned:modeRoutingContext:appMode",
    );
    expect(contexts.workspaceNavigationContext).not.toHaveProperty(
      "appMode",
    );
    expect(contexts.accountSurfaceContext.activeAccount).toBe(
      "owned:accountSurfaceContext:activeAccount",
    );
    expect(contexts.workspaceNavigationContext).not.toHaveProperty(
      "activeAccount",
    );
    expect(
      Object.keys(contexts.workspaceNavigationContext).length,
    ).toBeLessThanOrEqual(80);
    expect(contexts.runtimeContext.runtimeRunState).toEqual({ phase: "idle" });
    expect(contexts.modelSelectionContext.selectedModelId).toBe("m1");
    expect(contexts.modelSelectionContext.reasoningOptions).toEqual([]);
  });

  it("S4 PR-D：turn 级 conversation bags 归 runtimeThreadContext，不进 settings/layout", () => {
    const contexts = assembleAppShellDomainContexts(buildMinimalAssemblySource());

    const movedKeys = [
      "historyLoadingByThreadId",
      "historyLoadingProgressByThreadId",
      "historyRestoredAtMsByThread",
      "threadListCursorByWorkspace",
      "threadListPagingByWorkspace",
      "threadParentById",
    ] as const;
    for (const key of movedKeys) {
      expect(contexts.runtimeThreadContext[key]).toBe(
        `owned:runtimeThreadContext:${key}`,
      );
      expect(contexts.settingsContext).not.toHaveProperty(key);
      expect(contexts.layoutContext).not.toHaveProperty(key);
      expect(contexts.workspaceNavigationContext).not.toHaveProperty(key);
    }

    // 无 bag 读者的 turn 级 bags 已从根 bag 移除
    for (const key of [
      "tokenUsageByThread",
      "rateLimitsByWorkspace",
      "planByThread",
      "lastAgentMessageByThread",
    ]) {
      expect(contexts.settingsContext).not.toHaveProperty(key);
      expect(contexts.layoutContext).not.toHaveProperty(key);
      expect(contexts.runtimeThreadContext).not.toHaveProperty(key);
    }

    // sections/render 仍可读：F5 后 threads 全量 map 迁入 threadDataContext
    for (const key of [
      "threadsByWorkspace",
      "threadStatusById",
      "threadItemsByThread",
      "threadListLoadingByWorkspace",
    ]) {
      expect(contexts.threadDataContext).toHaveProperty(key);
      expect(contexts.settingsContext).not.toHaveProperty(key);
    }
  });

  it("S4 PR-D：turn 级 conversation bags 更新不再打坏 settings/layout 引用", () => {
    const source = buildMinimalAssemblySource();
    const previous = assembleAppShellDomainContexts(source);
    const next = assembleAppShellDomainContexts({
      ...source,
      historyLoadingByThreadId: { "thread-1": true },
      historyLoadingProgressByThreadId: { "thread-1": 0.5 },
      historyRestoredAtMsByThread: { "thread-1": 123 },
      threadListCursorByWorkspace: { "ws-1": "cursor" },
      threadListPagingByWorkspace: { "ws-1": true },
      threadParentById: { "thread-1": "parent" },
    });

    const stable = reuseStableAppShellDomainContexts(previous, next);
    // 迁移后这些 bags 只敲 runtimeThread 域：settings/layout 浅比较通过、引用复用
    expect(stable.settingsContext).toBe(previous.settingsContext);
    expect(stable.layoutContext).toBe(previous.layoutContext);
    expect(stable.workspaceNavigationContext).toBe(
      previous.workspaceNavigationContext,
    );
    // runtimeThread 域确实感知更新
    expect(stable.runtimeThreadContext).toBe(next.runtimeThreadContext);
    expect(stable.runtimeThreadContext.historyLoadingByThreadId).toEqual({
      "thread-1": true,
    });
  });

  it("S4 PR-C：composer 输入面归 composerContext，git/file/mode 等 handlers 归位", () => {
    const contexts = assembleAppShellDomainContexts(buildMinimalAssemblySource());

    // composer 域只保留 composer 输入面（39 keys，≤60 达标）
    const composerKeys = Object.keys(contexts.composerContext);
    expect(composerKeys.length).toBeLessThanOrEqual(60);
    for (const key of [
      "activeImages",
      "activeQueue",
      "composerInsert",
      "prefillDraft",
      "textareaHeight",
      "handleDraftChange",
      "handleSendPrompt",
      "handleFuseQueued",
      "interruptTurn",
      "skills",
    ]) {
      expect(contexts.composerContext[key]).toBe(
        `owned:composerContext:${key}`,
      );
    }

    // 归位后的新 owner
    const rehomed: Array<[string, string]> = [
      ["gitSurfaceContext", "handleCommit"],
      ["gitSurfaceContext", "handleGitPullRequestsChange"],
      ["fileEditorContext", "handleOpenFile"],
      ["fileEditorContext", "handleActivateFileTab"],
      ["modeRoutingContext", "isCompact"],
      ["modeRoutingContext", "hasActivePlan"],
      ["accountSurfaceContext", "handleSwitchAccount"],
      ["workspaceCatalogContext", "groupedWorkspaces"],
      ["workspaceCatalogContext", "handleAddWorkspace"],
      ["workspaceNavigationContext", "handleCopyDebug"],
      ["runtimeThreadContext", "handleRenameThread"],
      ["runtimeThreadContext", "choosePreset"],
      ["modelSelectionContext", "handleSelectModel"],
    ];
    for (const [domain, key] of rehomed) {
      expect(contexts[domain as keyof typeof contexts][key]).toBe(
        `owned:${domain}:${key}`,
      );
      expect(contexts.composerContext).not.toHaveProperty(key);
    }

    // 无 bag 读者的 keys 已从根 bag 删除（任何域都不得再持有）
    for (const key of [
      "handleSend",
      "hasLoaded",
      "hasPlanData",
      "historySearchItems",
      "installedEngines",
      "startFork",
      "startReview",
      "sendUserMessage",
      "queueMessage",
      "clearActiveImages",
      "codexComposerModeRef",
    ]) {
      for (const domainName of APP_SHELL_DOMAIN_CONTEXT_NAMES) {
        expect(contexts[domainName]).not.toHaveProperty(key);
      }
    }
  });

  it("S4 PR-C：输入路径 churn 只敲 composerContext，settings/layout/nav 引用稳定", () => {
    const source = buildMinimalAssemblySource();
    const previous = assembleAppShellDomainContexts(source);
    // 模拟输入路径高频更新：贴图 / 队列变化 / prefill / textarea 高度
    const next = assembleAppShellDomainContexts({
      ...source,
      activeImages: ["img-1.png"],
      activeQueue: [{ id: "q1" }],
      prefillDraft: { id: "p1", text: "draft" },
      textareaHeight: 120,
    });

    const stable = reuseStableAppShellDomainContexts(previous, next);
    // 输入态全部归 composerContext：只有 composer 域换引用
    expect(stable.composerContext).toBe(next.composerContext);
    expect(stable.composerContext.textareaHeight).toBe(120);
    // sections/render 仍订阅的其它域全部保持旧引用（render 已不再订阅 composer）
    expect(stable.settingsContext).toBe(previous.settingsContext);
    expect(stable.layoutContext).toBe(previous.layoutContext);
    expect(stable.workspaceNavigationContext).toBe(
      previous.workspaceNavigationContext,
    );
    expect(stable.gitSurfaceContext).toBe(previous.gitSurfaceContext);
    expect(stable.runtimeThreadContext).toBe(previous.runtimeThreadContext);
  });

  it("S4 PR-E：settings/layout 瘦身达标（≤60），setter 与 state 同域归位", () => {
    const contexts = assembleAppShellDomainContexts(buildMinimalAssemblySource());

    // settings / layout 压到终态目标（非冻结）
    expect(Object.keys(contexts.settingsContext).length).toBeLessThanOrEqual(
      60,
    );
    expect(Object.keys(contexts.layoutContext).length).toBeLessThanOrEqual(60);

    // 归位后的新 owner（抽查各目标域一把）
    const rehomed: Array<[string, string]> = [
      ["modeRoutingContext", "setAppMode"],
      ["modeRoutingContext", "showExtensions"],
      ["sessionIdentityContext", "setActiveThreadId"],
      ["gitSurfaceContext", "queueGitStatusRefresh"],
      ["workspaceCatalogContext", "workspaces"],
      ["workspaceCatalogContext", "worktreePrompt"],
      ["workspaceNavigationContext", "setAppSettings"],
      ["workspaceNavigationContext", "releaseNotesOpen"],
      ["fileEditorContext", "setSearchScope"],
      ["runtimeThreadContext", "pinThread"],
      ["runtimeThreadContext", "userInputRequests"],
      ["composerContext", "prompts"],
      ["accountSurfaceContext", "refreshAccountRateLimits"],
      ["modelSelectionContext", "refreshEngines"],
      ["layoutContext", "setLiveEditPreviewEnabled"],
      ["settingsContext", "openSettings"],
    ];
    for (const [domain, key] of rehomed) {
      expect(contexts[domain as keyof typeof contexts][key]).toBe(
        `owned:${domain}:${key}`,
      );
      if (domain !== "settingsContext") {
        expect(contexts.settingsContext).not.toHaveProperty(key);
      }
    }

    // 无 bag 读者的 keys 已从根 bag 删除（任何域都不得再持有）
    for (const key of [
      "checkoutBranch",
      "createBranch",
      "gitCommitDiffs",
      "gitHistoryPanelHeightRef",
      "movePrompt",
      "navigateToThread",
      "openTerminal",
      "perfSnapshotRef",
      "refreshAccountInfo",
      "refreshGitStatus",
      "refreshWorkspaces",
      "renameThread",
      "renameWorktree",
      "setAccessMode",
      "setDebugOpen",
      "setRightPanelWidth",
      "threadAccessMode",
      "updateThreadParent",
      "updatePrompt",
      "workspaceFilesPollingEnabled",
      "workspaceNameByPath",
      "worktreeSetupScriptState",
    ]) {
      for (const domainName of APP_SHELL_DOMAIN_CONTEXT_NAMES) {
        expect(contexts[domainName]).not.toHaveProperty(key);
      }
    }
  });

  it("S4 PR-F：runtimeThreadContext 不再携带 legacyDefaults / runtimeActions 冗余 keys", () => {
    const contexts = assembleAppShellDomainContexts(buildMinimalAssemblySource());

    // legacy flat context 时代的 93 个 undefined defaults 与 modeRouting 重复的
    // runtimeActions 已删除：runtimeThread bag 只剩 owned keys（+ sessionHot 展开）
    expect(
      Object.keys(contexts.runtimeThreadContext).sort(),
    ).toEqual(
      [...APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.runtimeThreadContext].sort(),
    );
    expect(contexts.runtimeThreadContext).not.toHaveProperty("legacy");
    // handleToggleRuntimeConsole / handleToggleTerminalPanel 仍由 modeRouting 域持有
    expect(contexts.modeRoutingContext).toHaveProperty(
      "handleToggleRuntimeConsole",
    );
    expect(contexts.modeRoutingContext).toHaveProperty(
      "handleToggleTerminalPanel",
    );

    // S4 PR-F：gitSurface 再删 3 个无 bag 读者 keys（search 段经
    // searchAndComposerInput 直传，不经 bag；任何域都不得再持有）
    for (const key of [
      "gitPullRequestDiffs",
      "setDiffSource",
      "setGitPanelMode",
    ]) {
      for (const domainName of APP_SHELL_DOMAIN_CONTEXT_NAMES) {
        expect(contexts[domainName]).not.toHaveProperty(key);
      }
    }
    expect(APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.gitSurfaceContext).toHaveLength(
      105,
    );
  });
});
