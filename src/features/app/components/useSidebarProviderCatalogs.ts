import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { pushErrorToast } from "../../../services/toasts";
import {
  getClaudeProviders,
  getCodexProviders,
  getGrokProviders,
  getKimiProviders,
  getOpenCodeProviders,
} from "../../../services/tauri";
import type { EngineProviderProfileOption } from "../../threads/constants/codexProviderProfiles";
import { PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";

export function useSidebarProviderCatalogs() {
  const { t } = useTranslation();
  const [claudeProviderProfiles, setClaudeProviderProfiles] = useState<
    EngineProviderProfileOption[]
  >([]);
  const [codexProviderProfiles, setCodexProviderProfiles] = useState<
    EngineProviderProfileOption[]
  >([]);
  const [kimiProviderProfiles, setKimiProviderProfiles] = useState<
    EngineProviderProfileOption[]
  >([]);
  const [grokProviderProfiles, setGrokProviderProfiles] = useState<
    EngineProviderProfileOption[]
  >([]);
  const [openCodeProviderProfiles, setOpenCodeProviderProfiles] = useState<
    EngineProviderProfileOption[]
  >([]);
  const providerCatalogLoadErrorTitlesRef = useRef({
    claude: t("sidebar.providerCatalogLoadFailed", {
      engine: t("workspace.engineClaudeCode"),
    }),
    codex: t("sidebar.providerCatalogLoadFailed", {
      engine: t("workspace.engineCodex"),
    }),
    kimi: t("sidebar.providerCatalogLoadFailed", {
      engine: t("workspace.engineKimi"),
    }),
    grok: t("sidebar.providerCatalogLoadFailed", {
      engine: t("workspace.engineGrok"),
    }),
    opencode: t("sidebar.providerCatalogLoadFailed", {
      engine: t("workspace.engineOpenCode"),
    }),
  });

  useEffect(() => {
    let cancelled = false;
    const loadProfiles = async (
      engine: "claude" | "codex" | "kimi" | "grok" | "opencode",
      load: () => Promise<Array<{ id: string; name: string }>>,
      setProfiles: Dispatch<SetStateAction<EngineProviderProfileOption[]>>,
    ) => {
      try {
        const providers = await load();
        if (cancelled) {
          return;
        }
        const nextProfiles = providers
          .filter((provider) => provider.id.trim().length > 0)
          .map((provider) => ({
            id: provider.id.trim(),
            name: provider.name.trim() || provider.id.trim(),
            source: "managed" as const,
          }));
        setProfiles((currentProfiles) => {
          if (
            currentProfiles.length === nextProfiles.length &&
            currentProfiles.every((currentProfile, index) => {
              const nextProfile = nextProfiles[index];
              return (
                currentProfile.id === nextProfile?.id &&
                currentProfile.name === nextProfile.name &&
                currentProfile.source === nextProfile.source
              );
            })
          ) {
            return currentProfiles;
          }
          return nextProfiles;
        });
      } catch (error: unknown) {
        if (!cancelled) {
          pushErrorToast({
            title: providerCatalogLoadErrorTitlesRef.current[engine],
            message: error instanceof Error ? error.message : String(error),
            durationMs: 5000,
          });
        }
      }
    };
    const reloadAllProfiles = () => {
      void loadProfiles(
        "claude",
        getClaudeProviders,
        setClaudeProviderProfiles,
      );
      void loadProfiles("codex", getCodexProviders, setCodexProviderProfiles);
      void loadProfiles("kimi", getKimiProviders, setKimiProviderProfiles);
      void loadProfiles("grok", getGrokProviders, setGrokProviderProfiles);
      void loadProfiles(
        "opencode",
        getOpenCodeProviders,
        setOpenCodeProviderProfiles,
      );
    };
    reloadAllProfiles();
    window.addEventListener(
      PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
      reloadAllProfiles,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
        reloadAllProfiles,
      );
    };
  }, []);

  return {
    claudeProviderProfiles,
    codexProviderProfiles,
    kimiProviderProfiles,
    grokProviderProfiles,
    openCodeProviderProfiles,
  };
}
