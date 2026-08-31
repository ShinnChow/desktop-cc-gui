import { DEFAULT_OPEN_APP_TARGETS } from "../../app/constants";
import type { AppSettings } from "../../../types";
import { FIRST_RUN_IDE_CHOICES, type FirstRunIdeId } from "../types";
import { persistFirstRunSetupProfile } from "./setupPersistence";
import { preferredIdeToOpenAppId } from "./setupProfile";
import { readFirstRunSetupProfile } from "./setupGate";

export const EDITOR_HABIT_CHOICES: readonly FirstRunIdeId[] = [
  ...FIRST_RUN_IDE_CHOICES,
];

export function applyEditorHabitToAppSettings(
  settings: AppSettings,
  ide: FirstRunIdeId,
): AppSettings {
  const openAppId = preferredIdeToOpenAppId(ide);
  if (!openAppId) {
    return settings;
  }
  const existingTargets = settings.openAppTargets ?? [];
  const hasTarget = existingTargets.some((target) => target.id === openAppId);
  const preset = DEFAULT_OPEN_APP_TARGETS.find((target) => target.id === openAppId);
  const openAppTargets =
    hasTarget || !preset ? existingTargets : [...existingTargets, preset];
  if (settings.selectedOpenAppId === openAppId && hasTarget) {
    return settings;
  }
  return {
    ...settings,
    openAppTargets,
    selectedOpenAppId: openAppId,
  };
}

export function persistEditorHabit(ide: FirstRunIdeId): FirstRunIdeId {
  persistFirstRunSetupProfile({
    ...readFirstRunSetupProfile(),
    preferredIde: ide,
  });
  return ide;
}
