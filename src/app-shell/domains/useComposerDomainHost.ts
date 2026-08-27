import type { DebugEntry } from "../../types";
import type { RefObject } from "react";
import { useSelectedComposerSession } from "./useSelectedComposerSession";
import { useAppShellComposerModelSection } from "./useAppShellComposerModelSection";
import { useSelectedAgentSession } from "./useSelectedAgentSession";
import { useProviderModelCatalogSync } from "./useProviderModelCatalogSync";
import { useModelConfigRefresh } from "./useModelConfigRefresh";
import { usePlanApplyHandlers } from "../sections/usePlanApplyHandlers";
import { useAutoMigrateDisabledActiveEngine } from "./useAutoMigrateDisabledActiveEngine";
import { resolveEngineDefaultComposerSelection } from "./selectedComposerSession";
import type { ComposerSelectionSnapshot } from "./composerSelectionResolver";

/**
 * S4 PR-C：Composer 域 host（无 UI）。
 *
 * 收敛输入路径相关的 session selection / model / agent / plan-apply，
 * 让 AppShell 根只装配 host 输出，不再直接堆一串 composer hooks。
 *
 * 不负责：threads runtime、layout、Git/Kanban 视图。
 */
export function useComposerDomainHost(input: {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  activeThreadEngine: string | null | undefined;
  activeThreadEngineSource: string | null | undefined;
  activeThreadProviderProfileId: string | null;
  resolveCanonicalThreadId: (threadId: string) => string;
  appSettingsLoading: boolean;
  addDebugEntry: (entry: DebugEntry) => void;
  activeEngine: any;
  installedEngines: any;
  setActiveEngine: any;
  appSettings: any;
  accessMode: any;
  applySelectedCollaborationMode: any;
  collaborationModes: any;
  composerInputRef: any;
  composerSelectionResolverRef: RefObject<ComposerSelectionSnapshot>;
  engineModelCatalogsAsOptions: any;
  engineModelsAsOptions: any;
  globalSelectionReady: any;
  handleSetAccessMode: any;
  models: any;
  modelsReady: any;
  persistComposerEnginePref: any;
  queueSaveSettings: any;
  selectedCollaborationMode: any;
  selectedCollaborationModeId: any;
  selectedEffort: any;
  selectedModelId: any;
  setAppSettings: any;
  setSelectedEffort: any;
  setSelectedModelId: any;
  refreshEngineModels: any;
  refreshModels: any;
  handleUserInputSubmit: any;
  interruptTurn: any;
  resolveCollaborationRuntimeMode: any;
  resolveCollaborationUiMode: any;
  sendUserMessage: any;
  settingsOpen: boolean;
}) {
  const {
    selectedComposerSelection,
    selectedComposerSelectionThreadId,
    handleSelectComposerSelection,
    persistComposerSelectionForThread,
    resolveComposerSelectionForThread,
  } = useSelectedComposerSession({
    activeThreadId: input.activeThreadId,
    activeWorkspaceId: input.activeWorkspaceId,
    resolveCanonicalThreadId: input.resolveCanonicalThreadId,
    engineDefaultSelectionReady: !input.appSettingsLoading,
    resolveEngineDefaultComposerSelection,
    onDebug: input.addDebugEntry as any,
  });

  useAutoMigrateDisabledActiveEngine({
    activeEngine: input.activeEngine,
    activeThreadEngine: input.activeThreadEngine as any,
    activeThreadId: input.activeThreadId,
    appSettingsLoading: input.appSettingsLoading,
    disabledCliEngineIds: input.appSettings.disabledCliEngines,
    installedEngines: input.installedEngines,
    setActiveEngine: input.setActiveEngine,
  });

  const composerModel = useAppShellComposerModelSection({
    accessMode: input.accessMode,
    activeEngine: input.activeEngine,
    activeThreadId: input.activeThreadId,
    activeProviderProfileId: input.activeThreadProviderProfileId,
    activeWorkspaceId: input.activeWorkspaceId,
    appSettings: input.appSettings,
    appSettingsLoading: input.appSettingsLoading,
    applySelectedCollaborationMode: input.applySelectedCollaborationMode,
    collaborationModes: input.collaborationModes,
    composerInputRef: input.composerInputRef,
    composerSelectionResolverRef: input.composerSelectionResolverRef,
    engineModelCatalogsAsOptions: input.engineModelCatalogsAsOptions,
    engineModelsAsOptions: input.engineModelsAsOptions,
    globalSelectionReady: input.globalSelectionReady,
    handleSelectComposerSelection,
    handleSetAccessMode: input.handleSetAccessMode,
    models: input.models,
    modelsReady: input.modelsReady,
    persistComposerEnginePref: input.persistComposerEnginePref,
    persistComposerSelectionForThread,
    queueSaveSettings: input.queueSaveSettings,
    selectedCollaborationMode: input.selectedCollaborationMode,
    selectedCollaborationModeId: input.selectedCollaborationModeId,
    selectedComposerSelection,
    selectedComposerSelectionThreadId,
    selectedEffort: input.selectedEffort,
    selectedModelId: input.selectedModelId,
    setAppSettings: input.setAppSettings,
    setSelectedEffort: input.setSelectedEffort,
    setSelectedModelId: input.setSelectedModelId,
  });

  const agentSession = useSelectedAgentSession({
    activeThreadId: input.activeThreadId,
    activeWorkspaceId: input.activeWorkspaceId,
    resolveCanonicalThreadId: input.resolveCanonicalThreadId,
    onDebug: input.addDebugEntry as any,
  });

  useProviderModelCatalogSync({
    activeEngine: input.activeEngine,
    activeThreadEngineSource: input.activeThreadEngineSource as any,
    activeThreadId: input.activeThreadId,
    activeWorkspaceId: input.activeWorkspaceId,
    providerProfileId: input.activeThreadProviderProfileId,
    addDebugEntry: input.addDebugEntry as any,
    refreshEngineModels: input.refreshEngineModels,
  });

  const modelConfig = useModelConfigRefresh({
    activeEngine: input.activeEngine,
    activeProviderProfileId: input.activeThreadProviderProfileId,
    addDebugEntry: input.addDebugEntry as any,
    refreshEngineModels: input.refreshEngineModels,
    refreshModels: input.refreshModels,
  });

  const planApply = usePlanApplyHandlers({
    activeEngine: input.activeEngine,
    applySelectedCollaborationMode: input.applySelectedCollaborationMode,
    handleSetAccessMode: input.handleSetAccessMode,
    handleUserInputSubmit: input.handleUserInputSubmit,
    interruptTurn: input.interruptTurn,
    resolveCollaborationRuntimeMode: input.resolveCollaborationRuntimeMode,
    resolveCollaborationUiMode: input.resolveCollaborationUiMode,
    resolvedEffort: composerModel.resolvedEffort,
    resolvedModel: composerModel.resolvedModel,
    selectedCollaborationModeId: input.selectedCollaborationModeId,
    sendUserMessage: input.sendUserMessage,
  });

  return {
    selectedComposerSelection,
    handleSelectComposerSelection,
    persistComposerSelectionForThread,
    resolveComposerSelectionForThread,
    ...composerModel,
    selectedAgent: agentSession.selectedAgent,
    selectedAgentRef: agentSession.selectedAgentRef,
    handleSelectAgent: agentSession.handleSelectAgent,
    reloadSelectedAgent: agentSession.reloadSelectedAgent,
    reloadAgentCatalog: agentSession.reloadAgentCatalog,
    handleRefreshModelConfig: modelConfig.handleRefreshModelConfig,
    isModelConfigRefreshing: modelConfig.isModelConfigRefreshing,
    handleUserInputSubmitWithPlanApply:
      planApply.handleUserInputSubmitWithPlanApply,
    handleExitPlanModeExecute: planApply.handleExitPlanModeExecute,
  };
}

export type ComposerDomainHost = ReturnType<typeof useComposerDomainHost>;
