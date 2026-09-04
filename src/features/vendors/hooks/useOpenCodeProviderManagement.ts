import type { OpenCodeCurrentConfig, OpenCodeProviderConfig } from "../types";
import {
  getOpenCodeProviders,
  getCurrentOpenCodeConfig,
  addOpenCodeProvider,
  updateOpenCodeProvider,
  deleteOpenCodeProvider,
  switchOpenCodeProvider,
} from "../../../services/tauri";
import { useVendorProviderManagement, type VendorProviderManagementAdapter } from "./useVendorProviderManagement";

/** List load options. `silent` skips list-level loading UI (switch / external events). */






const OPENCODE_ADAPTER: VendorProviderManagementAdapter<
  OpenCodeProviderConfig,
  OpenCodeCurrentConfig
> = {
  engine: "opencode",
  displayName: "OpenCode",
  getProviders: getOpenCodeProviders,
  getCurrentConfig: getCurrentOpenCodeConfig,
  addProvider: addOpenCodeProvider,
  updateProvider: updateOpenCodeProvider,
  deleteProvider: async (id) => {
    await deleteOpenCodeProvider(id);
    return null;
  },
  switchProvider: switchOpenCodeProvider,
  // 保持现状：OpenCode 保存后不广播 provider catalog 变更。
  notifyCatalogOnSave: false,
};

export function useOpenCodeProviderManagement() {
  const management = useVendorProviderManagement(OPENCODE_ADAPTER);

  return {
    openCodeProviders: management.providers,
    openCodeLoading: management.loading,
    openCodeProviderError: management.providerError,
    openCodeProviderDialog: management.providerDialog,
    deleteOpenCodeConfirm: management.deleteConfirm,
    currentOpenCodeConfig: management.currentConfig,
    loadOpenCodeProviders: management.loadProviders,
    handleAddOpenCodeProvider: management.handleAddProvider,
    handleEditOpenCodeProvider: management.handleEditProvider,
    handleCloseOpenCodeProviderDialog: management.handleCloseProviderDialog,
    handleSaveOpenCodeProvider: management.handleSaveProvider,
    handleSwitchOpenCodeProvider: management.handleSwitchProvider,
    handleDeleteOpenCodeProvider: management.handleDeleteProvider,
    confirmDeleteOpenCodeProvider: management.confirmDeleteProvider,
    cancelDeleteOpenCodeProvider: management.cancelDeleteProvider,
  };
}


