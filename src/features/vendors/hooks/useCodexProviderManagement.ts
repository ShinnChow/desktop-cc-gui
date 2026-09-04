import { useState, useCallback, useEffect } from "react";
import {
  STORAGE_KEYS,
  validateCodexCustomModels,
  type CodexProviderConfig,
  type CodexCustomModel,
} from "../types";
import {
  getCodexProviders,
  addCodexProvider,
  updateCodexProvider,
  deleteCodexProvider,
  switchCodexProvider,
  reorderCodexProviders,
} from "../../../services/tauri";
import { applyOptimisticActiveProvider } from "../applyOptimisticActiveProvider";
import { VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT } from "../vendorActiveProviderEvents";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { forgetDeletedLastProviderProfile } from "../lastProviderProfileMemory";

/** List load options. `silent` skips list-level loading UI (switch / external events). */
export type CodexProviderLoadOptions = {
  silent?: boolean;
};

export interface CodexProviderDialogState {
  isOpen: boolean;
  provider: CodexProviderConfig | null;
}

export interface DeleteCodexConfirmState {
  isOpen: boolean;
  provider: CodexProviderConfig | null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return fallback;
}

function readStoredCodexCustomModels(): CodexCustomModel[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEYS.CODEX_CUSTOM_MODELS);
  if (!rawValue) {
    return [];
  }
  try {
    return validateCodexCustomModels(JSON.parse(rawValue));
  } catch {
    return [];
  }
}

function normalizeProviderCustomModels(
  providers: CodexProviderConfig[],
): CodexCustomModel[] {
  const mergedModels: CodexCustomModel[] = [];
  const seenIds = new Set<string>();

  for (const provider of providers) {
    const providerModels = validateCodexCustomModels(provider.customModels ?? []);
    for (const providerModel of providerModels) {
      const id = providerModel.id.trim();
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      const label = providerModel.label?.trim() || id;
      const description = providerModel.description?.trim();
      const providerProfileId = provider.id.trim();
      mergedModels.push({
        id,
        label,
        description:
          description && description.length > 0 ? description : undefined,
        providerProfileId:
          providerProfileId.length > 0 ? providerProfileId : undefined,
      });
    }
  }

  return mergedModels;
}

function indexProviderModelOrigins(
  providers: CodexProviderConfig[],
): Map<string, string> {
  const originsByModelId = new Map<string, string>();
  const ambiguousModelIds = new Set<string>();

  for (const provider of providers) {
    const providerProfileId = provider.id.trim();
    if (!providerProfileId) {
      continue;
    }
    const providerModels = validateCodexCustomModels(provider.customModels ?? []);
    for (const providerModel of providerModels) {
      const id = providerModel.id.trim();
      if (!id) {
        continue;
      }
      const existingProviderProfileId = originsByModelId.get(id);
      if (
        existingProviderProfileId &&
        existingProviderProfileId !== providerProfileId
      ) {
        ambiguousModelIds.add(id);
        originsByModelId.delete(id);
        continue;
      }
      if (!ambiguousModelIds.has(id)) {
        originsByModelId.set(id, providerProfileId);
      }
    }
  }

  return originsByModelId;
}

export function mergeCodexProviderCustomModelsIntoStore(
  providers: CodexProviderConfig[],
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  const providerModels = normalizeProviderCustomModels(providers);
  if (providerModels.length === 0) {
    return;
  }

  const storedModels = readStoredCodexCustomModels();
  const providerOriginByModelId = indexProviderModelOrigins(providers);
  const enrichedStoredModels = storedModels.map((model) => {
    if (model.providerProfileId?.trim()) {
      return model;
    }
    const providerProfileId = providerOriginByModelId.get(model.id.trim());
    return providerProfileId ? { ...model, providerProfileId } : model;
  });
  const storedIds = new Set(storedModels.map((model) => model.id.trim()));
  const missingProviderModels = providerModels.filter(
    (model) => !storedIds.has(model.id.trim()),
  );

  const didEnrichStoredModels = enrichedStoredModels.some(
    (model, index) =>
      model.providerProfileId !== storedModels[index]?.providerProfileId,
  );
  if (missingProviderModels.length === 0 && !didEnrichStoredModels) {
    return;
  }

  const nextModels = [...enrichedStoredModels, ...missingProviderModels];
  try {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify(nextModels),
    );
    window.dispatchEvent(
      new CustomEvent("localStorageChange", {
        detail: { key: STORAGE_KEYS.CODEX_CUSTOM_MODELS },
      }),
    );
  } catch {
    // localStorage can be unavailable in restricted WebViews; provider save still succeeds.
  }
}

export function useCodexProviderManagement() {
  const [codexProviders, setCodexProviders] = useState<CodexProviderConfig[]>(
    [],
  );
  // Start true so first paint shows a loading placeholder instead of an empty list.
  const [codexLoading, setCodexLoading] = useState(true);
  const [codexProviderError, setCodexProviderError] = useState<string | null>(null);

  const [codexProviderDialog, setCodexProviderDialog] =
    useState<CodexProviderDialogState>({
      isOpen: false,
      provider: null,
    });

  const [deleteCodexConfirm, setDeleteCodexConfirm] =
    useState<DeleteCodexConfirmState>({
      isOpen: false,
      provider: null,
    });

  const loadCodexProviders = useCallback(
    async (options?: CodexProviderLoadOptions) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        setCodexLoading(true);
      }
      try {
        const list = await getCodexProviders();
        setCodexProviders(list);
        mergeCodexProviderCustomModelsIntoStore(list);
        setCodexProviderError(null);
      } catch (error) {
        setCodexProviderError(
          getErrorMessage(error, "Failed to load Codex providers."),
        );
      } finally {
        if (!silent) {
          setCodexLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadCodexProviders();
  }, [loadCodexProviders]);

  useEffect(() => {
    const onActiveProviderChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: string }>).detail;
      if (detail?.engine && detail.engine !== "codex") {
        return;
      }
      void loadCodexProviders({ silent: true });
    };
    window.addEventListener(
      VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT,
      onActiveProviderChanged,
    );
    return () => {
      window.removeEventListener(
        VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT,
        onActiveProviderChanged,
      );
    };
  }, [loadCodexProviders]);

  const handleAddCodexProvider = useCallback(() => {
    setCodexProviderDialog({ isOpen: true, provider: null });
  }, []);

  const handleEditCodexProvider = useCallback(
    (provider: CodexProviderConfig) => {
      setCodexProviderDialog({ isOpen: true, provider });
    },
    [],
  );

  const handleCloseCodexProviderDialog = useCallback(() => {
    setCodexProviderDialog({ isOpen: false, provider: null });
  }, []);

  const handleSaveCodexProvider = useCallback(
    async (providerData: CodexProviderConfig) => {
      const isAdding = !codexProviderDialog.provider;

      try {
        if (isAdding) {
          await addCodexProvider(providerData);
        } else {
          await updateCodexProvider(providerData.id, providerData);
        }

        setCodexProviderDialog({ isOpen: false, provider: null });
        setCodexProviderError(null);
        await loadCodexProviders();
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setCodexProviderError(
          getErrorMessage(error, "Failed to save Codex provider."),
        );
      }
    },
    [codexProviderDialog.provider, loadCodexProviders],
  );

  const handleSwitchCodexProvider = useCallback(
    async (id: string) => {
      const previous = codexProviders;
      setCodexProviders(applyOptimisticActiveProvider(previous, id));
      try {
        await switchCodexProvider(id);
        // Keep optimistic list: avoid loading-flag toggle + full object churn flicker.
        setCodexProviderError(null);
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setCodexProviders(previous);
        setCodexProviderError(
          getErrorMessage(error, "Failed to switch Codex provider."),
        );
      }
    },
    [codexProviders],
  );

  const handleReorderCodexProviders = useCallback(
    async (orderedIds: string[]) => {
      const providerById = new Map(
        codexProviders.map((provider) => [provider.id, provider]),
      );
      const orderedProviders = orderedIds
        .map((id) => providerById.get(id))
        .filter((provider): provider is CodexProviderConfig =>
          Boolean(provider),
        );

      setCodexProviders(orderedProviders);

      try {
        await reorderCodexProviders(orderedIds);
        // 与 Claude 侧一致:重排只写 sortOrder,乐观顺序即持久顺序,
        // 成功后不重新拉取,避免引用整体替换造成闪烁。
        setCodexProviderError(null);
        return { ok: true } as const;
      } catch (error) {
        // 持久化失败:从后端重新加载以回滚乐观顺序。
        await loadCodexProviders();
        const message = getErrorMessage(
          error,
          "Failed to reorder Codex providers.",
        );
        setCodexProviderError(message);
        return { ok: false, error: message } as const;
      }
    },
    [codexProviders, loadCodexProviders],
  );

  const handleDeleteCodexProvider = useCallback(
    (provider: CodexProviderConfig) => {
      setDeleteCodexConfirm({ isOpen: true, provider });
    },
    [],
  );

  const confirmDeleteCodexProvider = useCallback(async () => {
    const provider = deleteCodexConfirm.provider;
    if (!provider) return;

    try {
      await deleteCodexProvider(provider.id);
      forgetDeletedLastProviderProfile("codex", provider.id);
      setCodexProviderError(null);
      await loadCodexProviders();
      notifyProviderTargetCatalogChanged();
    } catch (error) {
      setCodexProviderError(
        getErrorMessage(error, "Failed to delete Codex provider."),
      );
    }
    setDeleteCodexConfirm({ isOpen: false, provider: null });
  }, [deleteCodexConfirm.provider, loadCodexProviders]);

  const cancelDeleteCodexProvider = useCallback(() => {
    setDeleteCodexConfirm({ isOpen: false, provider: null });
  }, []);

  return {
    codexProviders,
    codexLoading,
    codexProviderError,
    codexProviderDialog,
    deleteCodexConfirm,
    loadCodexProviders,
    handleAddCodexProvider,
    handleEditCodexProvider,
    handleCloseCodexProviderDialog,
    handleSaveCodexProvider,
    handleSwitchCodexProvider,
    handleReorderCodexProviders,
    handleDeleteCodexProvider,
    confirmDeleteCodexProvider,
    cancelDeleteCodexProvider,
  };
}


