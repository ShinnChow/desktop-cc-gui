import {
  getClaudeProviders,
  getCodexProviders,
  getEngineModels,
  getGrokProviders,
  getKimiProviders,
  getOpenCodeProviders,
} from "../../../services/tauri";
import type { EngineModelInfo } from "../../../types";
import { syncClaudeModelMappingForProfile } from "../../vendors/activateEngineProviderProfile";
import {
  LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
  QODER_CN_PROVIDER_PROFILE_ID,
  QODER_CN_PROVIDER_PROFILE_NAME,
  QODER_GLOBAL_PROVIDER_PROFILE_ID,
  QODER_GLOBAL_PROVIDER_PROFILE_NAME,
} from "../../threads/constants/codexProviderProfiles";
import type { SharedSessionSupportedEngine } from "../utils/sharedSessionEngines";

import {
  readLastProviderProfileId,
  type LastProviderEngine,
} from "../../vendors/lastProviderProfileMemory";

import {
  buildSharedSessionInitialTarget,
  isSharedCreateLocalProvider,
  localProviderSentinelId,
  type SharedCreateProviderProfile,
} from "./initialTarget";
import type { ExecutionTarget } from "./types";

// 与原生创建「选供应商 = 启动」同源的引擎集合（pi/qoder 无供应商记忆）。
const REMEMBERED_PROVIDER_ENGINES: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "kimi",
  "grok",
  "opencode",
]);

/**
 * Qoder 无供应商记忆：侧栏 Global/CN 双入口把发行版 id 显式带进来，
 * 命中固定 distribution 列表时提到首位，交给 resolveFirstSharedCreateProvider。
 */
function prioritizePreferredQoderDistribution(
  engine: SharedSessionSupportedEngine,
  preferredProviderId: string | null | undefined,
  providers: ProviderListEntry[],
): ProviderListEntry[] {
  const preferredId = preferredProviderId?.trim();
  if (!preferredId || engine !== "qoder") {
    return providers;
  }
  const index = providers.findIndex((entry) => entry.id === preferredId);
  if (index <= 0) {
    return providers;
  }
  const next = providers.slice();
  const [match] = next.splice(index, 1);
  return [match, ...next];
}

/**
 * Shared 创建默认跟随用户记住的供应商：把 last-selected 提到有序列表首位，
 * 交给 resolveFirstSharedCreateProvider 沿用既有的 local 归一逻辑。
 * 记忆 id 不在列表（陈旧 / provider 已删）时保持原顺序 = 第一个。
 */
function prioritizeRememberedProvider(
  engine: SharedSessionSupportedEngine,
  providers: ProviderListEntry[],
): ProviderListEntry[] {
  if (!REMEMBERED_PROVIDER_ENGINES.has(engine)) {
    return providers;
  }
  const rememberedId = readLastProviderProfileId(
    engine as LastProviderEngine,
  )?.trim();
  if (!rememberedId) {
    return providers;
  }
  const index = providers.findIndex((entry) => entry.id === rememberedId);
  if (index <= 0) {
    return providers;
  }
  const next = providers.slice();
  const [match] = next.splice(index, 1);
  return [match, ...next];
}

type ProviderListEntry = {
  id: string;
  name: string;
  isLocalProvider?: boolean | null;
};

/**
 * 加载某 CLI 有序 Provider 列表（与 Atomic picker / vendor_get_* 顺序一致）。
 * 列表为空时回落本地 sentinel，保证创建路径可 fail-closed 到 catalog 而非无 profile。
 */
export async function loadOrderedSharedCreateProviders(
  engine: SharedSessionSupportedEngine,
): Promise<ProviderListEntry[]> {
  let raw: ProviderListEntry[] = [];
  switch (engine) {
    case "claude":
      raw = (await getClaudeProviders()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        isLocalProvider: entry.isLocalProvider,
      }));
      break;
    case "codex":
      raw = (await getCodexProviders()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        // Codex 列表无 isLocalProvider 字段；本地靠 __disk__ sentinel 判定。
        isLocalProvider: undefined,
      }));
      break;
    case "kimi":
      raw = (await getKimiProviders()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        isLocalProvider: entry.isLocalProvider,
      }));
      break;
    case "grok":
      raw = (await getGrokProviders()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        isLocalProvider: entry.isLocalProvider,
      }));
      break;
    case "opencode":
      raw = (await getOpenCodeProviders()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        isLocalProvider: entry.isLocalProvider,
      }));
      break;
    case "pi":
      // PI 无多 Provider store：不拉 vendor 列表，落到本地 sentinel。
      break;
    case "qoder":
      // Qoder 没有 provider CRUD。两个 distribution 仍复用 scoped catalog，
      // 但必须带显式 profile，不能伪装成 local disk provider。
      return [
        {
          id: QODER_GLOBAL_PROVIDER_PROFILE_ID,
          name: QODER_GLOBAL_PROVIDER_PROFILE_NAME,
          isLocalProvider: false,
        },
        {
          id: QODER_CN_PROVIDER_PROFILE_ID,
          name: QODER_CN_PROVIDER_PROFILE_NAME,
          isLocalProvider: false,
        },
      ];
  }

  const normalized = raw
    .map((entry) => ({
      id: entry.id.trim(),
      name: entry.name.trim() || entry.id.trim(),
      isLocalProvider: Boolean(entry.isLocalProvider),
    }))
    .filter((entry) => entry.id.length > 0);

  if (normalized.length === 0) {
    const localId = localProviderSentinelId(engine);
    return [
      {
        id: localId,
        name: LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
        isLocalProvider: true,
      },
    ];
  }

  return normalized;
}

export function resolveFirstSharedCreateProvider(
  engine: SharedSessionSupportedEngine,
  providers: ProviderListEntry[],
  localProviderName: string,
): SharedCreateProviderProfile {
  const first = providers[0];
  if (!first?.id.trim()) {
    // Qoder 的固定 distribution 不可退化为 generic local sentinel；否则后续
    // buildSharedSessionInitialTarget 会把 Global binding 归一为 null。
    if (engine === "qoder") {
      return {
        id: QODER_GLOBAL_PROVIDER_PROFILE_ID,
        name: QODER_GLOBAL_PROVIDER_PROFILE_NAME,
        source: "managed",
      };
    }
    const localId = localProviderSentinelId(engine);
    return {
      id: localId,
      name: localProviderName.trim() || LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
      source: "disk",
    };
  }

  const id = first.id.trim();
  const isLocal =
    Boolean(first.isLocalProvider) || isSharedCreateLocalProvider(engine, id);
  return {
    id,
    name: isLocal
      ? localProviderName.trim() ||
        first.name.trim() ||
        LOCAL_PROVIDER_PROFILE_DISPLAY_NAME
      : first.name.trim() || id,
    source: isLocal ? "disk" : "managed",
  };
}

/**
 * 按 profile 权威加载模型：
 * - 本地：sentinel id + forceRefresh（重读 settings，禁止 engine status 过期 cache）
 * - managed：providerProfileId（backend provider-scoped）
 */
export async function loadAuthoritativeModelsForCreateProvider(
  engine: SharedSessionSupportedEngine,
  provider: SharedCreateProviderProfile,
): Promise<EngineModelInfo[]> {
  const isLocal = provider.source === "disk";
  return getEngineModels(engine, {
    providerProfileId: provider.id,
    ...(isLocal ? { forceRefresh: true } : {}),
  });
}

/**
 * Shared CLI 创建入口：第一 Provider + 权威 catalog → 完整 initialTarget。
 *
 * **仅用于新建会话**。打开既有 Shared Session 不得调用本函数 reseed。
 */
export async function resolveSharedSessionCreateInitialTarget(input: {
  engine: SharedSessionSupportedEngine;
  localProviderName: string;
  unavailableModelMessage: string;
  /** Qoder Global/CN 双入口显式指定的发行版；缺省维持 Global 默认。 */
  preferredProviderId?: string | null;
}): Promise<ExecutionTarget> {
  const providers = prioritizePreferredQoderDistribution(
    input.engine,
    input.preferredProviderId,
    prioritizeRememberedProvider(
      input.engine,
      await loadOrderedSharedCreateProviders(input.engine),
    ),
  );
  const provider = resolveFirstSharedCreateProvider(
    input.engine,
    providers,
    input.localProviderName,
  );

  if (input.engine === "claude") {
    try {
      await syncClaudeModelMappingForProfile(provider.id);
    } catch {
      // mapping 失败不阻断创建（与 Atomic 渠道切换一致）
    }
  }

  const models = await loadAuthoritativeModelsForCreateProvider(
    input.engine,
    provider,
  );

  return buildSharedSessionInitialTarget({
    engine: input.engine,
    models,
    provider,
    unavailableModelMessage: input.unavailableModelMessage,
  });
}
