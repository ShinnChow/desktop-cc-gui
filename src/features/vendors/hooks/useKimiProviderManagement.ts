import type { KimiCurrentConfig, KimiProviderConfig } from "../types";
import {
  getKimiProviders,
  getCurrentKimiConfig,
  addKimiProvider,
  updateKimiProvider,
  deleteKimiProvider,
  switchKimiProvider,
} from "../../../services/tauri";
import { useVendorProviderManagement, type VendorProviderManagementAdapter } from "./useVendorProviderManagement";

/** List load options. `silent` skips list-level loading UI (switch / external events). */






const KIMI_ADAPTER: VendorProviderManagementAdapter<
  KimiProviderConfig,
  KimiCurrentConfig
> = {
  engine: "kimi",
  displayName: "Kimi",
  getProviders: getKimiProviders,
  getCurrentConfig: getCurrentKimiConfig,
  addProvider: addKimiProvider,
  updateProvider: updateKimiProvider,
  deleteProvider: async (id) => {
    const result = await deleteKimiProvider(id);
    return result.status === "partial-warning"
      ? {
          warning:
            result.warning ?? "Kimi provider deleted with residual config.",
        }
      : null;
  },
  switchProvider: switchKimiProvider,
  notifyCatalogOnSave: true,
};

export function useKimiProviderManagement() {
  const management = useVendorProviderManagement(KIMI_ADAPTER);

  return {
    kimiProviders: management.providers,
    kimiLoading: management.loading,
    kimiProviderError: management.providerError,
    kimiProviderDialog: management.providerDialog,
    deleteKimiConfirm: management.deleteConfirm,
    currentKimiConfig: management.currentConfig,
    loadKimiProviders: management.loadProviders,
    handleAddKimiProvider: management.handleAddProvider,
    handleEditKimiProvider: management.handleEditProvider,
    handleCloseKimiProviderDialog: management.handleCloseProviderDialog,
    handleSaveKimiProvider: management.handleSaveProvider,
    handleSwitchKimiProvider: management.handleSwitchProvider,
    handleDeleteKimiProvider: management.handleDeleteProvider,
    confirmDeleteKimiProvider: management.confirmDeleteProvider,
    cancelDeleteKimiProvider: management.cancelDeleteProvider,
  };
}


