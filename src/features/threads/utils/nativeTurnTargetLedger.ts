import type { EngineType } from "../../../types/engine";
import type {
  ExecutionTargetSnapshot,
  RuntimeModelReceipt,
} from "../../../types";
import { freezeTurnSnapshot } from "../../shared-session/target/types";
import { getRuntimeReceipt } from "./runtimeModelReceipt";

/**
 * 发送边界快照解析：优先 Composer 冻结值；缺失时按 messaging 层 resolved
 * engine/provider/model/effort 兜底合成（badge 经 resolveSnapshotProviderLabel
 * 回落 profile id / 本地 sentinel 语义，可解释）。
 */
export function resolveNativeSendExecutionTarget(input: {
  frozen?: ExecutionTargetSnapshot | null;
  engine: string | null | undefined;
  providerProfileId?: string | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  effort?: string | null;
}): ExecutionTargetSnapshot | null {
  if (input.frozen) {
    return input.frozen;
  }
  const engine = input.engine?.trim();
  if (!engine) {
    return null;
  }
  return freezeTurnSnapshot({
    engine: engine as EngineType,
    providerProfileId: input.providerProfileId ?? null,
    modelCatalogEntryId: input.modelCatalogEntryId ?? null,
    model: input.model ?? null,
    reasoning:
      input.effort && input.effort.trim() ? { effort: input.effort.trim() } : null,
  });
}

/**
 * Native Turn Target Ledger。
 *
 * 与 Shared 的 `targetStore.activeTurnTarget` 对应：native 发送边界固化本轮
 * `TurnExecutionSnapshot`，realtime 入列咽喉（首 delta 建壳 / handleItemUpdate /
 * normalized 直达路由）读取后盖到 assistant message 上。latest-wins：下一次发送
 * 必然刷新，不做 turn 终态清理（与 renameRuntimeReceipt 无清理行为一致）。
 *
 * 形态沿用 `runtimeModelReceipt.ts` 的 per-thread 模块 Map 惯例。
 */

const targets = new Map<string, ExecutionTargetSnapshot>();

function keyOf(workspaceId: string, threadId: string): string {
  return `${workspaceId}\u0000${threadId}`;
}

/**
 * Native 会话作用域守卫（单一事实源）：shared canonical / 协作画布 /
 * shared-pending 别名路由各有自己的 attribution 通道，不入本账本与历史侧车。
 */
export function isNativeTurnTargetLedgerScope(threadId: string): boolean {
  const id = threadId.trim();
  return (
    id.length > 0 &&
    !id.startsWith("shared:") &&
    !id.startsWith("agent-canvas:") &&
    !id.includes("-pending-shared-")
  );
}

export function recordNativeTurnTarget(
  workspaceId: string,
  threadId: string,
  snapshot: ExecutionTargetSnapshot | null | undefined,
): void {
  if (!workspaceId || !threadId || !snapshot) {
    return;
  }
  if (!isNativeTurnTargetLedgerScope(threadId)) {
    return;
  }
  targets.set(keyOf(workspaceId, threadId), snapshot);
}

export function getNativeTurnTarget(
  workspaceId: string,
  threadId: string,
): ExecutionTargetSnapshot | null {
  if (!workspaceId || !threadId) {
    return null;
  }
  return targets.get(keyOf(workspaceId, threadId)) ?? null;
}

/** pending → 正式 thread id 迁移；move-if-absent，不覆盖目标已有值。 */
export function renameNativeTurnTarget(
  workspaceId: string,
  oldThreadId: string,
  newThreadId: string,
): void {
  if (!workspaceId || !oldThreadId || !newThreadId || oldThreadId === newThreadId) {
    return;
  }
  const source = targets.get(keyOf(workspaceId, oldThreadId));
  if (!source) {
    return;
  }
  targets.delete(keyOf(workspaceId, oldThreadId));
  const targetKey = keyOf(workspaceId, newThreadId);
  if (!targets.has(targetKey)) {
    targets.set(targetKey, source);
  }
}

export function resetNativeTurnTargetsForTests(): void {
  targets.clear();
}

/**
 * 入列咽喉一次取齐的 ingest 元数据：本轮 turn-target 快照 + 当前 runtime
 * model 回执（发送时已记 send.request；引擎后续 raw/turn-completed 会按 rank
 * 升级 store，再由 patchAssistantRuntimeReceipt 反 patch）。
 * pi 等引擎事件流里没有 model，Ⓡ 尾巴完全靠这份 send.request 记账。
 */
export function getNativeTurnIngestMeta(
  workspaceId: string,
  threadId: string,
): {
  executionTargetSnapshot?: ExecutionTargetSnapshot;
  runtimeReceipt?: RuntimeModelReceipt;
} | undefined {
  const executionTargetSnapshot = getNativeTurnTarget(workspaceId, threadId);
  const runtimeReceipt = getRuntimeReceipt(workspaceId, threadId);
  if (!executionTargetSnapshot && !runtimeReceipt) {
    return undefined;
  }
  return {
    ...(executionTargetSnapshot ? { executionTargetSnapshot } : {}),
    ...(runtimeReceipt ? { runtimeReceipt } : {}),
  };
}

/** 历史（重开/重载后）侧车补挂入口；key 约定见 turnTargetBadgeStorage。 */
export function nativeTurnTargetStorageKeyOf(
  workspaceId: string,
): string {
  return workspaceId;
}
