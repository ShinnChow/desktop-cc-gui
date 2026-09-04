import type { EngineType } from "../../../../types";
import { PINNABLE_WORKSPACE_ACTION_IDS } from "../useSidebarWorkspacePinnedActions";

export const NEW_SESSION_ENGINE_ACTION_IDS: Readonly<Record<string, EngineType>> = {
  "new-session-claude": "claude",
  "new-session-codex": "codex",
  "new-session-opencode": "opencode",
  "new-session-gemini": "gemini",
  "new-session-kimi": "kimi",
  "new-session-grok": "grok",
  "new-session-pi": "pi",
  "new-session-omp": "omp",
  "new-session-dsh": "dsh",
  "new-session-qoder-global": "qoder",
  "new-session-qoder-cn": "qoder",
};

export const PINNABLE_WORKSPACE_ACTION_ID_SET = new Set<string>(
  PINNABLE_WORKSPACE_ACTION_IDS,
);

/**
 * 新建菜单「选供应商 = 启用启动」统一入口。
 *
 * 1) L2 记忆：last-selected + 选中态 → 创建会话写入 thread.providerProfileId
 * 2) L1 标记 + Claude 模型映射：activateEngineProviderProfileAndNotify（不盖盘）
 */

export const INLINE_MOVE_FOLDER_TARGET_LIMIT = 12;
