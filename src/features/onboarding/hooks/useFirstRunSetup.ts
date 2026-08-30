import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CliInstallEngine, EngineStatus, EngineType } from "../../../types";
import {
  isClientStoreReady,
  subscribeClientStoreHydrated,
  whenClientStoreReady,
} from "../../../services/clientStorage";
import {
  getAppSettings,
  getCliInstallPlan,
  runCliInstaller,
  updateAppSettings,
} from "../../../services/tauri";
import { requestEngineDetection } from "../../engine/hooks/engineDetectionCoordinator";
import { persistEngineSelection } from "../../engine/hooks/engineControllerSelection";
import { resolveCliInstallStrategy } from "../../settings/hooks/useCliInstallLifecycle";
import type { FirstRunEngineCardState } from "../components/FirstRunCliStep";
import {
  EMPTY_FIRST_RUN_SETUP_PROFILE,
  type FirstRunIdeId,
  type FirstRunSetupProfile,
  type FirstRunSetupStep,
} from "../types";
import { applyEditorHabitToAppSettings } from "../utils/editorHabit";
import { resolveFirstRunDetectCardError } from "../utils/engineCardError";
import {
  collectFirstRunLegacySignals,
  readFirstRunSetupProfile,
  shouldShowFirstRunSetup,
} from "../utils/setupGate";
import {
  FIRST_RUN_SETUP_REOPEN_EVENT,
  type FirstRunSetupReopenDetail,
} from "../utils/setupEvents";
import { persistFirstRunSetupProfile } from "../utils/setupPersistence";
import {
  isFirstRunEngineInstalled,
  resolveFirstRunPrimaryEngine,
  resolveFirstRunSelectedEngineAfterDetect,
} from "../utils/resolvePrimaryEngine";
import {
  completeFirstRunSetup,
  markCliSkipped,
  markCliValidated,
  markLegacyExempted,
  reopenFirstRunSetup,
} from "../utils/setupProfile";

function toCardError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const text = String(error ?? "").trim();
  return text || fallback;
}

async function persistPreferredIde(ide: FirstRunIdeId | null): Promise<void> {
  if (!ide) {
    return;
  }
  const settings = await getAppSettings();
  const nextSettings = applyEditorHabitToAppSettings(settings, ide);
  if (nextSettings === settings) {
    return;
  }
  await updateAppSettings(nextSettings);
}

export function useFirstRunSetup() {
  const { t } = useTranslation();
  const [storeReady, setStoreReady] = useState(() => isClientStoreReady("app"));
  const [profile, setProfile] = useState<FirstRunSetupProfile>(() =>
    storeReady ? readFirstRunSetupProfile() : EMPTY_FIRST_RUN_SETUP_PROFILE,
  );
  const [legacyChecked, setLegacyChecked] = useState(false);
  const [pendingOverlay, setPendingOverlay] = useState(false);
  const [visible, setVisible] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<CliInstallEngine | null>(
    () => {
      if (!storeReady) {
        return null;
      }
      const primary = readFirstRunSetupProfile().primaryEngine;
      return primary && primary !== "gemini"
        ? (primary as CliInstallEngine)
        : null;
    },
  );
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [cardStateByEngine, setCardStateByEngine] = useState<
    Partial<Record<CliInstallEngine, FirstRunEngineCardState>>
  >({});
  const selectedEngineRef = useRef(selectedEngine);
  selectedEngineRef.current = selectedEngine;

  const writeProfile = useCallback((next: FirstRunSetupProfile) => {
    const persisted = persistFirstRunSetupProfile(next);
    setProfile(persisted);
    return persisted;
  }, []);

  useEffect(() => {
    if (isClientStoreReady("app")) {
      setStoreReady(true);
      return;
    }
    return subscribeClientStoreHydrated((store) => {
      if (store === "app") {
        setStoreReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!storeReady || legacyChecked) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const current = readFirstRunSetupProfile();
      setProfile(current);
      if (current.dismissedAt || current.legacyExempted) {
        setVisible(false);
        setLegacyChecked(true);
        return;
      }
      if (current.level === "unset") {
        const earlySignals = collectFirstRunLegacySignals();
        if (earlySignals.hasSeenReleaseNotes) {
          writeProfile(markLegacyExempted());
          setVisible(false);
          setLegacyChecked(true);
          return;
        }
        setPendingOverlay(true);
      }
      const waitForStore = (store: "threads" | "composer") => {
        if (isClientStoreReady(store)) {
          return Promise.resolve();
        }
        return Promise.race([
          whenClientStoreReady(store),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1_500);
          }),
        ]);
      };
      await Promise.all([waitForStore("threads"), waitForStore("composer")]);
      if (cancelled) {
        return;
      }
      const latest = readFirstRunSetupProfile();
      const signals = collectFirstRunLegacySignals();
      if (latest.level === "unset" && !latest.dismissedAt && !shouldShowFirstRunSetup(latest, signals)) {
        writeProfile(markLegacyExempted());
        setVisible(false);
      } else {
        setProfile(latest);
        setVisible(shouldShowFirstRunSetup(latest, signals));
      }
      setPendingOverlay(false);
      setLegacyChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [legacyChecked, storeReady, writeProfile]);

  const patchCard = useCallback(
    (engine: CliInstallEngine, patch: Partial<FirstRunEngineCardState>) => {
      setCardStateByEngine((current) => ({
        ...current,
        [engine]: {
          installed: current[engine]?.installed ?? false,
          validated: current[engine]?.validated ?? false,
          version: current[engine]?.version ?? null,
          busy: current[engine]?.busy ?? false,
          error: current[engine]?.error ?? null,
          ...patch,
        },
      }));
    },
    [],
  );

  const refreshEngines = useCallback(async () => {
    setDetecting(true);
    try {
      const statuses = await requestEngineDetection({ source: "onboarding", force: true });
      setEngineStatuses(statuses);
      setCardStateByEngine((current) => {
        const next = { ...current };
        for (const status of statuses) {
          if (status.engineType === "gemini") {
            continue;
          }
          const engine = status.engineType as CliInstallEngine;
          next[engine] = {
            installed: status.installed,
            validated: status.installed || current[engine]?.validated === true,
            version: status.version,
            busy: false,
            error: resolveFirstRunDetectCardError(status.installed, status.error),
          };
        }
        return next;
      });
      const current = readFirstRunSetupProfile();
      const installedEngines = statuses
        .filter((status) => status.installed && status.engineType !== "gemini")
        .map((status) => status.engineType);
      if (installedEngines.length === 0) {
        return;
      }
      const nextSelected = resolveFirstRunSelectedEngineAfterDetect({
        selectedEngine: selectedEngineRef.current,
        primaryEngine: current.primaryEngine,
        installedEngines,
      });
      if (nextSelected && nextSelected !== selectedEngineRef.current) {
        selectedEngineRef.current = nextSelected;
        setSelectedEngine(nextSelected);
      }
      let next = current;
      for (const engine of installedEngines) {
        next = markCliValidated(next, engine);
      }
      if (
        nextSelected &&
        installedEngines.some((engine) => engine === nextSelected)
      ) {
        next = markCliValidated(next, nextSelected, { asPrimary: true });
      }
      writeProfile(next);
    } catch (error) {
      setCardStateByEngine((current) => ({
        ...current,
        claude: {
          installed: current.claude?.installed ?? false,
          validated: current.claude?.validated ?? false,
          version: current.claude?.version ?? null,
          busy: false,
          error: toCardError(error, t("onboarding.cli.detectFailed")),
        },
      }));
    } finally {
      setDetecting(false);
    }
  }, [t, writeProfile]);

  useEffect(() => {
    if (!visible || profile.step !== "cli") {
      return;
    }
    void refreshEngines();
  }, [profile.step, refreshEngines, visible]);

  const handleSelectEngine = useCallback(
    (engine: CliInstallEngine) => {
      selectedEngineRef.current = engine;
      setSelectedEngine(engine);
      if (
        isFirstRunEngineInstalled(engine, engineStatuses, cardStateByEngine)
      ) {
        writeProfile(
          markCliValidated(readFirstRunSetupProfile(), engine, { asPrimary: true }),
        );
        persistEngineSelection(engine);
      }
    },
    [cardStateByEngine, engineStatuses, writeProfile],
  );

  const handleStepChange = useCallback((step: FirstRunSetupStep) => {
    const current = readFirstRunSetupProfile();
    const primaryEngine = resolveFirstRunPrimaryEngine({
      selectedEngine,
      profile: current,
      engineStatuses,
      cardStateByEngine,
    });
    writeProfile({
      ...(primaryEngine
        ? markCliValidated(current, primaryEngine, { asPrimary: true })
        : current),
      step,
    });
    if (primaryEngine) {
      persistEngineSelection(primaryEngine);
    }
  }, [cardStateByEngine, engineStatuses, selectedEngine, writeProfile]);

  const handleIdeChange = useCallback((ide: FirstRunIdeId) => {
    writeProfile({ ...readFirstRunSetupProfile(), preferredIde: ide });
    void persistPreferredIde(ide).catch(() => {
      // Settings write is best-effort during setup; the profile still keeps the habit.
    });
  }, [writeProfile]);

  const handleInstall = useCallback(async (engine: CliInstallEngine) => {
    patchCard(engine, { busy: true, error: null });
    try {
      const plan = await getCliInstallPlan(
        engine,
        "installLatest",
        resolveCliInstallStrategy(engine, "installLatest"),
      );
      if (!plan.canRun) {
        patchCard(engine, {
          busy: false,
          error: plan.blockers[0] ?? t("onboarding.cli.installBlocked"),
        });
        return;
      }
      const result = await runCliInstaller(
        engine,
        "installLatest",
        plan.strategy,
      );
      const installed = result.ok || Boolean(result.doctorResult?.ok);
      patchCard(engine, {
        busy: false,
        installed,
        validated: installed,
        error: installed
          ? null
          : result.stderrSummary ?? result.details ?? t("onboarding.cli.installFailed"),
      });
      if (installed) {
        selectedEngineRef.current = engine;
        setSelectedEngine(engine);
        writeProfile(
          markCliValidated(readFirstRunSetupProfile(), engine, { asPrimary: true }),
        );
        persistEngineSelection(engine);
        void refreshEngines();
      }
    } catch (error) {
      patchCard(engine, {
        busy: false,
        error: toCardError(error, t("onboarding.cli.installFailed")),
      });
    }
  }, [patchCard, refreshEngines, t, writeProfile]);

  const handleContinueFromWelcome = useCallback(() => {
    handleStepChange("ide");
  }, [handleStepChange]);

  const handleSkipCli = useCallback(() => {
    const next = completeFirstRunSetup(markCliSkipped(readFirstRunSetupProfile()), {
      skippedCli: true,
    });
    writeProfile(next);
    setVisible(false);
  }, [writeProfile]);

  const handleEnterApp = useCallback(() => {
    const current = readFirstRunSetupProfile();
    const installedEngine = resolveFirstRunPrimaryEngine({
      selectedEngine,
      profile: current,
      engineStatuses,
      cardStateByEngine,
    });
    const ready = installedEngine
      ? markCliValidated(current, installedEngine as EngineType, {
          asPrimary: true,
        })
      : current;
    const next = completeFirstRunSetup(ready, {
      skippedCli: !installedEngine,
    });
    writeProfile(next);
    if (next.primaryEngine) {
      persistEngineSelection(next.primaryEngine);
    }
    void persistPreferredIde(next.preferredIde);
    setVisible(false);
  }, [cardStateByEngine, engineStatuses, selectedEngine, writeProfile]);

  useEffect(() => {
    const onReopen = (event: Event) => {
      const detail = (event as CustomEvent<FirstRunSetupReopenDetail>).detail;
      const base = reopenFirstRunSetup(readFirstRunSetupProfile());
      const next = writeProfile({
        ...base,
        step: detail?.step === "cli" ? "cli" : "welcome",
      });
      setProfile(next);
      setVisible(true);
    };
    window.addEventListener(FIRST_RUN_SETUP_REOPEN_EVENT, onReopen);
    return () => {
      window.removeEventListener(FIRST_RUN_SETUP_REOPEN_EVENT, onReopen);
    };
  }, [writeProfile]);

  const hasValidatedCli = profile.validatedEngines.length > 0;

  return {
    ready: storeReady && legacyChecked,
    pendingOverlay,
    visible,
    profile,
    selectedEngine,
    setSelectedEngine: handleSelectEngine,
    engineStatuses,
    cardStateByEngine,
    detecting,
    hasValidatedCli,
    handleStepChange,
    handleIdeChange,
    handleInstall,
    handleContinueFromWelcome,
    handleSkipCli,
    handleEnterApp,
  };
}
