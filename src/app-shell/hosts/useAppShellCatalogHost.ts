import { useCallback } from "react";
import type { AppMode } from "../../types";
import { useModels } from "../../features/models/hooks/useModels";
import { useCollaborationModes } from "../../features/collaboration/hooks/useCollaborationModes";
import { useSkills } from "../../features/skills/hooks/useSkills";
import { useCustomCommands } from "../../features/commands/hooks/useCustomCommands";
import { useCustomPrompts } from "../../features/prompts/hooks/useCustomPrompts";
import { useWorkspaceFiles } from "../../features/workspaces/hooks/useWorkspaceFiles";
import { useEngineController } from "../../features/engine/hooks/useEngineController";
import { useComposerEditorState } from "../../features/composer/hooks/useComposerEditorState";
import { useComposerEditorSettings } from "../domains/composerEditorSettings";
import { useComposerSelectionResolver } from "../domains/composerSelectionResolver";
import { resolveWorkspaceFilesLoadFlags } from "../domains/workspaceFilesGating";
import { useThreadScopedCollaborationMode } from "../domains/useThreadScopedCollaborationMode";
import { useAppShellAccessModeSection } from "../sections/useAppShellAccessModeSection";
import { useHostFields, usePublishHostSlice } from "./appShellHostBus";

const RETIRED_OPENCODE_AGENTS = Object.freeze([]);
const resolveRetiredOpenCodeSelection = () => null;

const SESSION_FIELDS = [
  "activeWorkspace",
  "addDebugEntry",
  "appSettings",
  "appSettingsLoading",
  "closeSettings",
  "isCompact",
  "persistClaudeCollaborationMode",
  "persistComposerEnginePref",
  "rightPanelCollapsed",
  "setAppMode",
  "activeEngineRef",
] as const;

const GIT_FIELDS = ["filePanelMode"] as const;

/** 刀 3：models / engine / files / prompts / collab catalog Host。 */
export function useAppShellCatalogHost() {
  const session = useHostFields("session", SESSION_FIELDS);
  // D4-Live：runtime slice 已发布 activeThreadId（与 GitSurfaceHost 同源）。
  const runtimeFields = useHostFields("runtime", ["activeThreadId"] as const);
  const activeThreadIdForUserLock = (runtimeFields.activeThreadId as string | null | undefined) ?? null;
  const git = useHostFields("git", GIT_FIELDS);
  const activeWorkspace = session.activeWorkspace as any;
  const addDebugEntry = session.addDebugEntry as any;
  const appSettings = session.appSettings as any;
  const appSettingsLoading = session.appSettingsLoading as any;
  const closeSettings = session.closeSettings as any;
  const isCompact = session.isCompact as boolean;
  const persistClaudeCollaborationMode = session.persistClaudeCollaborationMode as any;
  const persistComposerEnginePref = session.persistComposerEnginePref as any;
  const rightPanelCollapsed = session.rightPanelCollapsed as boolean;
  const setAppMode = session.setAppMode as any;
  const activeEngineRef = session.activeEngineRef as { current: unknown };
  const filePanelMode = (git.filePanelMode ?? "files") as any;

  const {
    models,
    modelsReady,
    selectedModelId,
    setSelectedModelId,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
    globalSelectionReady,
  } = useModels({
    activeWorkspace,
    activeThreadId: activeThreadIdForUserLock,
    onDebug: addDebugEntry,
    preferredModelId: appSettings.lastComposerModelId,
    preferredEffort: appSettings.lastComposerReasoningEffort,
    preferredSelectionReady: !appSettingsLoading,
  });

  const {
    collaborationModes,
    collaborationModesEnabled,
    selectedCollaborationMode,
    selectedCollaborationModeId,
    setSelectedCollaborationModeId,
  } = useCollaborationModes({
    activeWorkspace,
    // P1-3: no active workspace → skip collaboration catalog host work entirely.
    enabled: Boolean(activeWorkspace?.id),
    onDebug: addDebugEntry,
  });
  const {
    collaborationUiModeByThread,
    setCollaborationUiModeByThread,
    collaborationRuntimeModeByThread,
    setCollaborationRuntimeModeByThread,
    activeThreadIdForModeRef,
    lastCodexModeSyncThreadRef,
    codexComposerModeRef,
    applySelectedCollaborationMode,
    setCodexCollaborationMode,
    resolveCollaborationRuntimeMode,
    resolveCollaborationUiMode,
    handleCollaborationModeResolved,
  } = useThreadScopedCollaborationMode({
    setSelectedCollaborationModeId,
    onExplicitCollaborationModeChange: persistClaudeCollaborationMode,
  });

  const { skills } = useSkills({
    activeWorkspace,
    customSkillDirectories: appSettings.customSkillDirectories,
    onDebug: addDebugEntry,
  });
  const {
    activeEngine,
    availableEngines,
    installedEngines,
    setActiveEngine,
    engineModelsAsOptions,
    engineModelCatalogsAsOptions,
    engineStatuses,
    refreshEngineModels,
    refreshEngines,
  } = useEngineController({
    activeWorkspace,
    onDebug: addDebugEntry,
  });
  activeEngineRef.current = activeEngine;
  const {
    accessMode,
    claudeAccessModeRef,
    handleSetAccessMode,
  } = useAppShellAccessModeSection({
    activeEngine,
    appSettingsLoading,
    defaultAccessMode: appSettings.defaultAccessMode,
    persistComposerEnginePref,
  });
  const handleAppModeChange = useCallback(
    (mode: AppMode) => {
      setAppMode(mode);
      closeSettings();
    },
    [closeSettings],
  );
  const {
    prompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    movePrompt,
    getWorkspacePromptsDir,
    getGlobalPromptsDir,
  } = useCustomPrompts({ activeWorkspace, onDebug: addDebugEntry });
  const { commands } = useCustomCommands({
    onDebug: addDebugEntry,
    activeEngine,
    workspaceId: activeWorkspace?.id ?? null,
  });

  const {
    initialLoadEnabled: workspaceFilesInitialLoadEnabled,
    pollingEnabled: workspaceFilesPollingEnabled,
  } = resolveWorkspaceFilesLoadFlags({
    activeWorkspaceId: activeWorkspace?.id,
    isCompact,
    rightPanelCollapsed,
    filePanelMode,
  });
  const {
    files,
    directories,
    directoryMetadata,
    sourceVersion: fileTreeSourceVersion,
    gitignoredFiles,
    gitignoredDirectories,
    isLoading: isFilesLoading,
    loadError: fileTreeLoadError,
    refreshFiles,
  } = useWorkspaceFiles({
    activeWorkspace,
    onDebug: addDebugEntry,
    initialLoadEnabled: workspaceFilesInitialLoadEnabled,
    pollingEnabled: workspaceFilesPollingEnabled,
  });
  const { textareaHeight, onTextareaHeightChange } = useComposerEditorState();

  const composerEditorSettings = useComposerEditorSettings(appSettings);
  const { composerSelectionResolverRef, resolveComposerSelection } =
    useComposerSelectionResolver();

  const catalog = {
    models,
    modelsReady,
    selectedModelId,
    setSelectedModelId,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
    globalSelectionReady,
    collaborationModes,
    collaborationModesEnabled,
    selectedCollaborationMode,
    selectedCollaborationModeId,
    setSelectedCollaborationModeId,
    collaborationUiModeByThread,
    setCollaborationUiModeByThread,
    collaborationRuntimeModeByThread,
    setCollaborationRuntimeModeByThread,
    activeThreadIdForModeRef,
    lastCodexModeSyncThreadRef,
    codexComposerModeRef,
    applySelectedCollaborationMode,
    setCodexCollaborationMode,
    resolveCollaborationRuntimeMode,
    resolveCollaborationUiMode,
    handleCollaborationModeResolved,
    skills,
    activeEngine,
    availableEngines,
    installedEngines,
    setActiveEngine,
    engineModelsAsOptions,
    engineModelCatalogsAsOptions,
    engineStatuses,
    refreshEngineModels,
    refreshEngines,
    accessMode,
    claudeAccessModeRef,
    handleSetAccessMode,
    openCodeAgents: RETIRED_OPENCODE_AGENTS,
    resolveOpenCodeAgentForThread: resolveRetiredOpenCodeSelection,
    resolveOpenCodeVariantForThread: resolveRetiredOpenCodeSelection,
    handleAppModeChange,
    commands,
    prompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    movePrompt,
    getWorkspacePromptsDir,
    getGlobalPromptsDir,
    files,
    directories,
    directoryMetadata,
    fileTreeSourceVersion,
    gitignoredFiles,
    gitignoredDirectories,
    isFilesLoading,
    fileTreeLoadError,
    refreshFiles,
    textareaHeight,
    onTextareaHeightChange,
    composerEditorSettings,
    composerSelectionResolverRef,
    resolveComposerSelection,
  };
  usePublishHostSlice("catalog", catalog);
  return catalog;
}
