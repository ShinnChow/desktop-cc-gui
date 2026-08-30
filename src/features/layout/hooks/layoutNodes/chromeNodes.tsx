import { lazy, Suspense, type ReactNode } from "react";
import { HomeChat } from "../../../home/components/HomeChat";
import { MainHeader } from "../../../app/components/MainHeader";
import { UpdateToast } from "../../../update/components/UpdateToast";
import { ErrorToasts } from "../../../notifications/components/ErrorToasts";
import { TabBar } from "../../../app/components/TabBar";
import { TabletNav } from "../../../app/components/TabletNav";
import {
  resolveHomeWorkspaceId,
  type getHomeWorkspaceOptions,
} from "../../../home/utils/homeWorkspaceOptions";
import type { EngineType } from "../../../../types";
import type { ComposerBranchControl } from "../../../composer/components/ComposerBranchBadge";
import type { buildWorkspaceHeaderGroups } from "../workspaceHeaderGroups";
import { HeavyPanelFallback } from "./panelNodes";
import type { LayoutNodesFlatOptions } from "../layoutNodesTypes";

const BrowserDock = lazy(() =>
  import("../../../browser-agent/components/BrowserDock").then((m) => ({
    default: m.BrowserDock,
  })),
);

export type BuildHomeNodeInput = {
  options: LayoutNodesFlatOptions;
  homeWorkspaceOptions: ReturnType<typeof getHomeWorkspaceOptions>;
  homeComposerNode: ReactNode;
  homeCreationTargetEngine: EngineType | null;
  composerBranchControl: ComposerBranchControl | null;
};

export function buildHomeNode({
  options,
  homeWorkspaceOptions,
  homeComposerNode,
  homeCreationTargetEngine,
  composerBranchControl,
}: BuildHomeNodeInput): ReactNode {
  return (
    <HomeChat
      workspaces={homeWorkspaceOptions}
      selectedWorkspaceId={resolveHomeWorkspaceId(
        options.activeWorkspace?.id ?? null,
        homeWorkspaceOptions,
      )}
      onSelectWorkspace={options.onSelectHomeWorkspace}
      onAddWorkspace={options.onAddWorkspace}
      composerNode={homeComposerNode}
      selectedEngine={homeCreationTargetEngine ?? options.selectedEngine}
      branchControl={composerBranchControl}
    />
  );
}

export type BuildMainHeaderNodeInput = {
  options: LayoutNodesFlatOptions;
  sessionTabsNode: ReactNode;
  canCopyActiveThread: boolean;
  showTopRunControls: boolean;
  showOpenWorkspaceAppControl: boolean;
  groupedWorkspacesForHeader: ReturnType<typeof buildWorkspaceHeaderGroups>;
};

export function buildMainHeaderNode({
  options,
  sessionTabsNode,
  canCopyActiveThread,
  showTopRunControls,
  showOpenWorkspaceAppControl,
  groupedWorkspacesForHeader,
}: BuildMainHeaderNodeInput): ReactNode {
  return options.activeWorkspace ? (
      <MainHeader
        workspace={options.activeWorkspace}
        parentName={options.activeParentWorkspace?.name ?? null}
        worktreePath={
          options.isWorktreeWorkspace ? options.activeWorkspace.path : null
        }
        activeFilePath={options.activeComposerFilePath}
        openTargets={options.openAppTargets}
        openAppIconById={options.openAppIconById}
        selectedOpenAppId={options.selectedOpenAppId}
        onSelectOpenAppId={options.onSelectOpenAppId}
        sessionTabsNode={sessionTabsNode}
        canCopyThread={canCopyActiveThread}
        onCopyThread={options.onCopyThread}
        onLockPanel={options.onLockPanel}
        launchScript={options.launchScript}
        launchScriptEditorOpen={options.launchScriptEditorOpen}
        launchScriptDraft={options.launchScriptDraft}
        launchScriptSaving={options.launchScriptSaving}
        launchScriptError={options.launchScriptError}
        onRunLaunchScript={options.onRunLaunchScript}
        onOpenLaunchScriptEditor={options.onOpenLaunchScriptEditor}
        onCloseLaunchScriptEditor={options.onCloseLaunchScriptEditor}
        onLaunchScriptDraftChange={options.onLaunchScriptDraftChange}
        onSaveLaunchScript={options.onSaveLaunchScript}
        launchScriptsState={options.launchScriptsState}
        showLaunchScriptControls={showTopRunControls}
        showOpenAppMenu={showOpenWorkspaceAppControl}
        openAppExtraActions={options.mainHeaderActions}
        groupedWorkspaces={groupedWorkspacesForHeader}
        activeWorkspaceId={options.activeWorkspaceId}
        onSelectWorkspace={options.onSelectWorkspace}
        onOpenShortcutsSettings={options.onOpenShortcutsSettings}

      />
  ) : null;
}

export type BuildTabletNavNodeInput = {
  options: LayoutNodesFlatOptions;
};

export function buildTabletNavNode({
  options,
}: BuildTabletNavNodeInput): ReactNode {
  return (
    <TabletNav
      activeTab={options.tabletNavTab}
      onSelect={options.onSelectTab}
    />
  );
}

export type BuildTabBarNodeInput = {
  options: LayoutNodesFlatOptions;
};

export function buildTabBarNode({
  options,
}: BuildTabBarNodeInput): ReactNode {
  return (
    <TabBar activeTab={options.activeTab} onSelect={options.onSelectTab} />
  );
}

export type BuildUpdateToastNodeInput = {
  options: LayoutNodesFlatOptions;
};

export function buildUpdateToastNode({
  options,
}: BuildUpdateToastNodeInput): ReactNode {
  return (
    <UpdateToast
      state={options.updaterState}
      onUpdate={options.onUpdate}
      onDismiss={options.onDismissUpdate}
    />
  );
}

export type BuildErrorToastsNodeInput = {
  options: LayoutNodesFlatOptions;
};

export function buildErrorToastsNode({
  options,
}: BuildErrorToastsNodeInput): ReactNode {
  return (
    <ErrorToasts
      toasts={options.errorToasts}
      onDismiss={options.onDismissErrorToast}
    />
  );
}

export type BuildBrowserDockNodeInput = {
  options: LayoutNodesFlatOptions;
};

export function buildBrowserDockNode({
  options,
}: BuildBrowserDockNodeInput): ReactNode {
  return options.browserDockOpen &&
  options.centerMode === "chat" &&
  options.activeWorkspaceId ? (
    <Suspense fallback={<HeavyPanelFallback />}>
      <BrowserDock
        workspaceId={options.activeWorkspaceId}
        ownerSurface="main-split-browser-dock"
        displayMode="embedded"
        className="browser-agent-center-panel-dock"
        onClosePanel={options.onCloseBrowserDock}
      />
    </Suspense>
  ) : null;
}
