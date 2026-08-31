import type { GrokCurrentConfig, GrokProviderConfig } from "../types";
import {
  getGrokProviders,
  getCurrentGrokConfig,
  addGrokProvider,
  updateGrokProvider,
  deleteGrokProvider,
  switchGrokProvider,
} from "../../../services/tauri";
import { useVendorProviderManagement, type VendorProviderManagementAdapter } from "./useVendorProviderManagement";

/** List load options. `silent` skips list-level loading UI (switch / external events). */






const GROK_ADAPTER: VendorProviderManagementAdapter<
  GrokProviderConfig,
  GrokCurrentConfig
> = {
  engine: "grok",
  displayName: "Grok",
  getProviders: getGrokProviders,
  getCurrentConfig: getCurrentGrokConfig,
  addProvider: addGrokProvider,
  updateProvider: updateGrokProvider,
  deleteProvider: async (id) => {
    const result = await deleteGrokProvider(id);
    return result.status === "partial-warning"
      ? {
          warning:
            result.warning ?? "Grok provider deleted with residual config.",
        }
      : null;
  },
  switchProvider: switchGrokProvider,
  notifyCatalogOnSave: true,
};

export function useGrokProviderManagement() {
  const management = useVendorProviderManagement(GROK_ADAPTER);

  return {
    grokProviders: management.providers,
    grokLoading: management.loading,
    grokProviderError: management.providerError,
    grokProviderDialog: management.providerDialog,
    deleteGrokConfirm: management.deleteConfirm,
    currentGrokConfig: management.currentConfig,
    loadGrokProviders: management.loadProviders,
    handleAddGrokProvider: management.handleAddProvider,
    handleEditGrokProvider: management.handleEditProvider,
    handleCloseGrokProviderDialog: management.handleCloseProviderDialog,
    handleSaveGrokProvider: management.handleSaveProvider,
    handleSwitchGrokProvider: management.handleSwitchProvider,
    handleDeleteGrokProvider: management.handleDeleteProvider,
    confirmDeleteGrokProvider: management.confirmDeleteProvider,
    cancelDeleteGrokProvider: management.cancelDeleteProvider,
  };
}


