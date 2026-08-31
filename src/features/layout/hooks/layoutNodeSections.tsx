import type { MouseEvent, ReactNode } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { PanelTabs, type PanelToolbarTabId } from "../components/PanelTabs";
import { TerminalDock } from "../../terminal/components/TerminalDock";
import { TerminalPanel } from "../../terminal/components/TerminalPanel";
import { DebugPanel } from "../../debug/components/DebugPanel";
import type { TerminalSessionState } from "../../terminal/hooks/useTerminalSession";
import type { TerminalTab } from "../../terminal/hooks/useTerminalTabs";
import type { DebugEntry } from "../../../types";
import type { CenterMode } from "../../app/hooks/useGitPanelController";

export type BuildDesktopTopbarLeftNodeInput = {
  centerMode: CenterMode;
  backLabel: string;
  mainHeaderNode: ReactNode;
  contextMenuNode: ReactNode;
  onExitDiff: () => void;
};

export function buildDesktopTopbarLeftNode({
  centerMode,
  backLabel,
  mainHeaderNode,
  contextMenuNode,
  onExitDiff,
}: BuildDesktopTopbarLeftNodeInput): ReactNode {
  return (
    <>
      {centerMode === "diff" && (
        <button
          className="icon-button back-button"
          onClick={onExitDiff}
          aria-label={backLabel}
        >
          <ArrowLeft aria-hidden />
        </button>
      )}
      {mainHeaderNode}
      {contextMenuNode}
    </>
  );
}

export type BuildRightPanelToolbarNodeInput = {
  active: PanelToolbarTabId;
  showToolbar: boolean;
  hasVisibleControl: boolean;
  activityLive: boolean;
  radarLive: boolean;
  visibleTabs: Partial<Record<PanelToolbarTabId, boolean>>;
  gitModeControlsTargetRef?: (node: HTMLDivElement | null) => void;
  onSelect: (tabId: PanelToolbarTabId) => void;
};

export function buildRightPanelToolbarNode({
  active,
  showToolbar,
  hasVisibleControl,
  activityLive,
  radarLive,
  visibleTabs,
  gitModeControlsTargetRef,
  onSelect,
}: BuildRightPanelToolbarNodeInput): ReactNode {
  if (!showToolbar || !hasVisibleControl) {
    return null;
  }

  return (
    <div
      className={`right-panel-toolbar${active === "git" ? " has-git-mode-slot" : ""}`}
      data-tauri-drag-region
    >
      {active === "git" ? (
        <div
          className="right-panel-git-mode-slot"
          ref={gitModeControlsTargetRef}
          data-tauri-drag-region="false"
        />
      ) : null}
      <PanelTabs
        active={active}
        onSelect={onSelect}
        liveStates={{
          activity: activityLive,
          radar: radarLive,
        }}
        visibleTabs={visibleTabs}
      />
    </div>
  );
}

export type BuildTerminalDockNodeInput = {
  terminalState: TerminalSessionState | null;
  terminalOpen: boolean;
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  onToggleTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onResizeTerminal: (event: MouseEvent<Element>) => void;
  onInsertComposerText: (text: string) => void;
};

export function buildTerminalDockNode({
  terminalState,
  terminalOpen,
  terminalTabs,
  activeTerminalId,
  onToggleTerminal,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onResizeTerminal,
  onInsertComposerText,
}: BuildTerminalDockNodeInput): ReactNode {
  const terminalPanelNode = terminalState ? (
    <TerminalPanel
      containerRef={terminalState.containerRef}
      status={terminalState.status}
      message={terminalState.message}
      getSelection={terminalState.getSelection}
      findNext={terminalState.findNext}
      findPrevious={terminalState.findPrevious}
      onInsertText={onInsertComposerText}
    />
  ) : null;

  return (
    <TerminalDock
      isOpen={terminalOpen}
      terminals={terminalTabs}
      activeTerminalId={activeTerminalId}
      onToggleOpen={onToggleTerminal}
      onSelectTerminal={onSelectTerminal}
      onNewTerminal={onNewTerminal}
      onCloseTerminal={onCloseTerminal}
      onResizeStart={onResizeTerminal}
      terminalNode={terminalPanelNode}
    />
  );
}

export type BuildDebugPanelNodesInput = {
  debugEntries: DebugEntry[];
  debugOpen: boolean;
  onClearDebug: () => void;
  onCopyDebug: () => void;
  onResizeDebug: (event: MouseEvent<Element>) => void;
};

export function buildDebugPanelNodes({
  debugEntries,
  debugOpen,
  onClearDebug,
  onCopyDebug,
  onResizeDebug,
}: BuildDebugPanelNodesInput): {
  debugPanelNode: ReactNode;
  debugPanelFullNode: ReactNode;
} {
  return {
    debugPanelNode: (
      <DebugPanel
        entries={debugEntries}
        isOpen={debugOpen}
        onClear={onClearDebug}
        onCopy={onCopyDebug}
        onResizeStart={onResizeDebug}
      />
    ),
    debugPanelFullNode: (
      <DebugPanel
        entries={debugEntries}
        isOpen
        onClear={onClearDebug}
        onCopy={onCopyDebug}
        variant="full"
      />
    ),
  };
}

export type BuildCompactEmptyNodeInput = {
  title: string;
  description: string;
  buttonLabel: string;
  onGoProjects: () => void;
};

export function buildCompactEmptyNode({
  title,
  description,
  buttonLabel,
  onGoProjects,
}: BuildCompactEmptyNodeInput): ReactNode {
  return (
    <div className="compact-empty">
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="ghost" onClick={onGoProjects}>
        {buttonLabel}
      </button>
    </div>
  );
}

export type BuildCompactGitBackNodeInput = {
  backLabel: string;
  diffLabel: string;
  onBackFromDiff: () => void;
};

export function buildCompactGitBackNode({
  backLabel,
  diffLabel,
  onBackFromDiff,
}: BuildCompactGitBackNodeInput): ReactNode {
  return (
    <div className="compact-git-back">
      <button onClick={onBackFromDiff}>&#8249; {backLabel}</button>
      <span className="workspace-title">{diffLabel}</span>
    </div>
  );
}
