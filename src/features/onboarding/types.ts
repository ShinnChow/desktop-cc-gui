import type { CliInstallEngine, EngineType } from "../../types";

export const FIRST_RUN_SETUP_VERSION = 1;
export const FIRST_RUN_SETUP_STORE = "app" as const;
export const FIRST_RUN_SETUP_KEY = "setupProfile";

export type FirstRunSetupStep =
  | "welcome"
  | "ide"
  | "cli"
  | "done";

export type FirstRunSetupLevel = "unset" | "partial" | "ready";

export type FirstRunIdeId =
  | "vscode"
  | "cursor"
  | "idea"
  | "zed"
  | "sublime"
  | "none";

export const FIRST_RUN_SETUP_STEPS: readonly FirstRunSetupStep[] = [
  "welcome",
  "ide",
  "cli",
  "done",
];

export const FIRST_RUN_IDE_CHOICES: readonly FirstRunIdeId[] = [
  "vscode",
  "cursor",
  "idea",
  "none",
];

/** All persisted IDE ids, including retired choices kept for existing profiles. */
export const FIRST_RUN_IDES: readonly FirstRunIdeId[] = [
  ...FIRST_RUN_IDE_CHOICES,
  "zed",
  "sublime",
];

export const FIRST_RUN_PRIMARY_ENGINES: readonly CliInstallEngine[] = [
  "claude",
  "codex",
  "dsh",
  "kimi",
  "opencode",
];

export const FIRST_RUN_MORE_ENGINES: readonly CliInstallEngine[] = [
  "grok",
  "pi",
  "omp",
  "qoder",
];

export type FirstRunSetupProfile = {
  version: typeof FIRST_RUN_SETUP_VERSION;
  level: FirstRunSetupLevel;
  step: FirstRunSetupStep;
  preferredIde: FirstRunIdeId | null;
  primaryEngine: EngineType | null;
  validatedEngines: EngineType[];
  skippedSteps: FirstRunSetupStep[];
  legacyExempted: boolean;
  completedAt: string | null;
  dismissedAt: string | null;
};

export const EMPTY_FIRST_RUN_SETUP_PROFILE: FirstRunSetupProfile = {
  version: FIRST_RUN_SETUP_VERSION,
  level: "unset",
  step: "welcome",
  preferredIde: null,
  primaryEngine: null,
  validatedEngines: [],
  skippedSteps: [],
  legacyExempted: false,
  completedAt: null,
  dismissedAt: null,
};
