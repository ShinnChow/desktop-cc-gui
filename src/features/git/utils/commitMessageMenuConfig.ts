import { BUILTIN_ENGINE_TYPES } from "../../engine/engineRegistry";
import type { CommitMessageEngine } from "../../../services/tauri";
import { isEngineExecutionEnabled } from "../../../utils/engineExecutionPolicy";
import {
  readLastCommitMessageConfig,
  type LastCommitMessageConfig,
} from "../../../utils/commitMessage";

/**
 * GitDiffPanel 与 GitHistoryWorktreePanel 共享的 AI commit message 配置事实源。
 * 两个面板的引擎菜单项、一键生成配置判定必须从这里取, 避免再次平行演化。
 */
export const COMMIT_MESSAGE_MENU_ENGINES = ["codex", "claude"] as const satisfies readonly CommitMessageEngine[];

/**
 * 可见 quick option 的配置来源：persisted engine 必须仍在当前 menu catalog
 * 且允许执行；legacy/retired engine 不得绕过显式选择入口。
 */


export const COMMIT_MESSAGE_PICKER_MENU_SIZE = {
  width: 296,
  height: 352,
} as const;

const EMPTY_DISABLED_COMMIT_MESSAGE_ENGINES: ReadonlySet<string> = new Set();

export type CommitMessageMenuPreferences = {
  engines: LastCommitMessageConfig["engine"][];
  initialLanguage: LastCommitMessageConfig["language"];
  lastConfig: LastCommitMessageConfig | null;
};

export const getVisibleCommitMessageEngines = (
  disabledEngineIds: ReadonlySet<string> = EMPTY_DISABLED_COMMIT_MESSAGE_ENGINES,
): LastCommitMessageConfig["engine"][] =>
  BUILTIN_ENGINE_TYPES.filter(
    (engine): engine is LastCommitMessageConfig["engine"] =>
      engine !== "dsh" &&
      isEngineExecutionEnabled(engine) &&
      !disabledEngineIds.has(engine),
  );

export const readCommitMessageMenuPreferences = (
  disabledEngineIds: ReadonlySet<string> = EMPTY_DISABLED_COMMIT_MESSAGE_ENGINES,
): CommitMessageMenuPreferences => {
  const storedConfig = readLastCommitMessageConfig();
  const engines = getVisibleCommitMessageEngines(disabledEngineIds);

  return {
    engines,
    initialLanguage: storedConfig?.language ?? "zh",
    lastConfig:
      storedConfig && engines.includes(storedConfig.engine)
        ? storedConfig
        : null,
  };
};

/** 生成按钮初始图标：优先上次成功选择的可见引擎，否则 claude。 */
export const readInitialCommitMessageMenuEngine = (
  disabledEngineIds: ReadonlySet<string> = EMPTY_DISABLED_COMMIT_MESSAGE_ENGINES,
): LastCommitMessageConfig["engine"] => {
  const preferences = readCommitMessageMenuPreferences(disabledEngineIds);
  return preferences.lastConfig?.engine ?? preferences.engines[0] ?? "claude";
};
