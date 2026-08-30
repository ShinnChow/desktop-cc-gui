import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@/types";
import { pushErrorToast } from "@/services/toasts";

type InlineNoticeState = {
  kind: "success" | "error";
  message: string;
} | null;

type TranslateFn = (key: string) => string;

export const DEFAULT_SYSTEM_PROXY_URL = "http://127.0.0.1:7890";

export type SystemProxySettingsPatch = Pick<
  AppSettings,
  "systemProxyEnabled" | "systemProxyUrl"
>;

type UseSystemProxySettingsInput = {
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  onUpdateSystemProxy: (patch: SystemProxySettingsPatch) => Promise<unknown>;
  t: TranslateFn;
};

export function useSystemProxySettings({
  systemProxyEnabled,
  systemProxyUrl,
  onUpdateSystemProxy,
  t,
}: UseSystemProxySettingsInput) {
  const persistedEnabled = systemProxyEnabled ?? false;
  const persistedProxyUrl = systemProxyUrl ?? DEFAULT_SYSTEM_PROXY_URL;
  const [systemProxyEnabledDraft, setSystemProxyEnabledDraft] =
    useState(persistedEnabled);
  const [systemProxyUrlDraft, setSystemProxyUrlDraft] =
    useState(persistedProxyUrl);
  const [systemProxyError, setSystemProxyError] = useState<string | null>(null);
  const [systemProxyNotice, setSystemProxyNotice] =
    useState<InlineNoticeState>(null);
  const [systemProxySaving, setSystemProxySaving] = useState(false);

  useEffect(() => {
    setSystemProxyEnabledDraft(persistedEnabled);
    setSystemProxyUrlDraft(persistedProxyUrl);
    setSystemProxyError(null);
  }, [persistedEnabled, persistedProxyUrl]);

  useEffect(() => {
    if (!systemProxyNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSystemProxyNotice(null);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [systemProxyNotice]);

  const updateSystemProxySettings = useCallback(
    async (
      nextEnabled: boolean,
      nextProxyUrl: string,
      successMessage: string,
      rollbackDraft: {
        enabled: boolean;
        proxyUrl: string;
      },
    ) => {
      const trimmedProxyUrl = nextProxyUrl.trim();
      if (nextEnabled && !trimmedProxyUrl) {
        const message = t("settings.behaviorProxyRequired");
        setSystemProxyEnabledDraft(rollbackDraft.enabled);
        setSystemProxyUrlDraft(rollbackDraft.proxyUrl);
        setSystemProxyError(message);
        setSystemProxyNotice(null);
        return false;
      }

      setSystemProxySaving(true);
      setSystemProxyError(null);
      setSystemProxyNotice(null);
      try {
        await onUpdateSystemProxy({
          systemProxyEnabled: nextEnabled,
          systemProxyUrl: trimmedProxyUrl || null,
        });
        setSystemProxyNotice({
          kind: "success",
          message: successMessage,
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSystemProxyEnabledDraft(rollbackDraft.enabled);
        setSystemProxyUrlDraft(rollbackDraft.proxyUrl);
        setSystemProxyError(message);
        setSystemProxyNotice(null);
        pushErrorToast({
          title: t("common.error"),
          message,
        });
        return false;
      } finally {
        setSystemProxySaving(false);
      }
    },
    [onUpdateSystemProxy, t],
  );

  const handleSaveSystemProxy = useCallback(async () => {
    await updateSystemProxySettings(
      systemProxyEnabledDraft,
      systemProxyUrlDraft,
      t("settings.behaviorProxySaved"),
      {
        enabled: persistedEnabled,
        proxyUrl: persistedProxyUrl,
      },
    );
  }, [
    persistedEnabled,
    persistedProxyUrl,
    systemProxyEnabledDraft,
    systemProxyUrlDraft,
    t,
    updateSystemProxySettings,
  ]);

  const handleToggleSystemProxy = useCallback(
    (checked: boolean) => {
      if (systemProxySaving) {
        return;
      }
      const rollbackDraft = {
        enabled: persistedEnabled,
        proxyUrl: persistedProxyUrl,
      };
      const nextProxyUrl = checked
        ? systemProxyUrlDraft
        : systemProxyUrlDraft.trim() || rollbackDraft.proxyUrl;

      setSystemProxyEnabledDraft(checked);
      setSystemProxyError(null);
      setSystemProxyNotice(null);

      void updateSystemProxySettings(
        checked,
        nextProxyUrl,
        checked
          ? t("settings.behaviorProxyEnabledSuccess")
          : t("settings.behaviorProxyDisabledSuccess"),
        rollbackDraft,
      );
    },
    [
      persistedEnabled,
      persistedProxyUrl,
      systemProxySaving,
      systemProxyUrlDraft,
      t,
      updateSystemProxySettings,
    ],
  );

  const handleSystemProxyUrlChange = useCallback((value: string) => {
    setSystemProxyUrlDraft(value);
    setSystemProxyError(null);
    setSystemProxyNotice(null);
  }, []);

  const systemProxyDirty =
    persistedEnabled !== systemProxyEnabledDraft ||
    persistedProxyUrl !== systemProxyUrlDraft;

  return {
    handleSaveSystemProxy,
    handleSystemProxyUrlChange,
    handleToggleSystemProxy,
    systemProxyDirty,
    systemProxyEnabledDraft,
    systemProxyError,
    systemProxyNotice,
    systemProxySaving,
    systemProxyUrlDraft,
  };
}
