import type { CliInstallEngine } from "../../types";
import type { FirstRunIdeId } from "./types";

export const FIRST_RUN_IDE_META: Record<
  FirstRunIdeId,
  { titleKey: string; hintKey: string; openAppId: string | null }
> = {
  vscode: {
    titleKey: "onboarding.ide.vscode.title",
    hintKey: "onboarding.ide.vscode.hint",
    openAppId: "vscode",
  },
  cursor: {
    titleKey: "onboarding.ide.cursor.title",
    hintKey: "onboarding.ide.cursor.hint",
    openAppId: "cursor",
  },
  idea: {
    titleKey: "onboarding.ide.idea.title",
    hintKey: "onboarding.ide.idea.hint",
    openAppId: "idea",
  },
  zed: {
    titleKey: "onboarding.ide.zed.title",
    hintKey: "onboarding.ide.zed.hint",
    openAppId: "zed",
  },
  sublime: {
    titleKey: "onboarding.ide.sublime.title",
    hintKey: "onboarding.ide.sublime.hint",
    openAppId: "sublime",
  },
  none: {
    titleKey: "onboarding.ide.none.title",
    hintKey: "onboarding.ide.none.hint",
    openAppId: null,
  },
};

export const FIRST_RUN_ENGINE_META: Record<
  CliInstallEngine,
  { titleKey: string; hintKey: string }
> = {
  claude: {
    titleKey: "onboarding.engine.claude.title",
    hintKey: "onboarding.engine.claude.hint",
  },
  codex: {
    titleKey: "onboarding.engine.codex.title",
    hintKey: "onboarding.engine.codex.hint",
  },
  grok: {
    titleKey: "onboarding.engine.grok.title",
    hintKey: "onboarding.engine.grok.hint",
  },
  kimi: {
    titleKey: "onboarding.engine.kimi.title",
    hintKey: "onboarding.engine.kimi.hint",
  },
  opencode: {
    titleKey: "onboarding.engine.opencode.title",
    hintKey: "onboarding.engine.opencode.hint",
  },
  dsh: {
    titleKey: "onboarding.engine.dsh.title",
    hintKey: "onboarding.engine.dsh.hint",
  },
  pi: {
    titleKey: "onboarding.engine.pi.title",
    hintKey: "onboarding.engine.pi.hint",
  },
  omp: {
    titleKey: "onboarding.engine.omp.title",
    hintKey: "onboarding.engine.omp.hint",
  },
  qoder: {
    titleKey: "onboarding.engine.qoder.title",
    hintKey: "onboarding.engine.qoder.hint",
  },
};
