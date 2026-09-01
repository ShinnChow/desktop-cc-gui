import { useThemePreference } from "../../layout/hooks/useThemePreference";
import { useTransparencyPreference } from "../../layout/hooks/useTransparencyPreference";
import { useUiScaleShortcuts } from "../../layout/hooks/useUiScaleShortcuts";
import { useAppSettings } from "../../settings/hooks/useAppSettings";
import { useUserMessageBubbleColor } from "./useUserMessageBubbleColor";

export function useAppSettingsController() {
  const {
    settings: appSettings,
    setSettings: setAppSettings,
    saveSettings,
    doctor,
    claudeDoctor,
    kimiDoctor,
    grokDoctor,
    opencodeDoctor,
    piDoctor,
    ompDoctor,
    qoderDoctor,
    isLoading: appSettingsLoading,
  } = useAppSettings();

  useThemePreference(appSettings);
  useUserMessageBubbleColor(appSettings.userMsgColor);
  const {
    reduceTransparency,
    setReduceTransparency,
    windowTransparencyEnabled,
    setWindowTransparencyEnabled,
    windowOpacity,
    setWindowOpacity,
  } =
    useTransparencyPreference();

  const {
    uiScale,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
    increaseUiScale,
    decreaseUiScale,
    resetUiScale,
  } = useUiScaleShortcuts({
    settings: appSettings,
    setSettings: setAppSettings,
    saveSettings,
  });

  return {
    appSettings,
    setAppSettings,
    saveSettings,
    queueSaveSettings,
    increaseUiScale,
    decreaseUiScale,
    resetUiScale,
    doctor,
    claudeDoctor,
    kimiDoctor,
    grokDoctor,
    opencodeDoctor,
    piDoctor,
    ompDoctor,
    qoderDoctor,
    appSettingsLoading,
    reduceTransparency,
    setReduceTransparency,
    windowTransparencyEnabled,
    setWindowTransparencyEnabled,
    windowOpacity,
    setWindowOpacity,
    uiScale,
    scaleShortcutTitle,
    scaleShortcutText,
  };
}
