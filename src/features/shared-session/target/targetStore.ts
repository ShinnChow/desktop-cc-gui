/**
 * Shared Target Store（Wave 4 / B.1）。
 *
 * 每个 Shared Thread 一份：`selectedNextTarget`（可变，只影响下一次 Send）
 * 与 `activeTurnTarget`（Turn 创建时固化的不可变快照）严格分离。
 * Picker 只能改 `selectedNextTarget`；禁止用它改写进行中/已完成 Turn 的 Badge。
 *
 * 形态沿用 `activeCanvasStore` 的 useSyncExternalStore 模块 store 惯例。
 */

import { useSyncExternalStore } from "react";

import type { ExecutionTarget, TurnExecutionSnapshot } from "./types";

export type SharedTargetState = {
  selectedNextTarget: ExecutionTarget | null;
  activeTurnTarget: TurnExecutionSnapshot | null;
};

const EMPTY_STATE: SharedTargetState = {
  selectedNextTarget: null,
  activeTurnTarget: null,
};

type Listener = () => void;

function storeKeyOf(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

const states = new Map<string, SharedTargetState>();
const activeAttemptIds = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

/**
 * Per-thread persist generation counter（fix-shared-session-target-race-and-merge T4）。
 *
 * 每次 `hydrateSharedTargetState` 写入选定的 target 时递增；
 * `sharedHistoryLoader` 在 hydrate 前记录代次、加载完成后比对，
 * 若代次已在加载期间被更新（存在 in-flight persist）则跳过覆盖。
 */
const persistGenerations = new Map<string, number>();

function persistGenerationKeyOf(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

export function getPersistGeneration(
  workspaceId: string,
  threadId: string,
): number {
  return persistGenerations.get(
    persistGenerationKeyOf(workspaceId, threadId),
  ) ?? 0;
}

function incrementPersistGeneration(
  workspaceId: string,
  threadId: string,
): number {
  const key = persistGenerationKeyOf(workspaceId, threadId);
  const next = (persistGenerations.get(key) ?? 0) + 1;
  persistGenerations.set(key, next);
  return next;
}

/** 清理指定 thread 的代次记录（thread 关闭/删除时调用）。 */


/**
 * In-flight persist 计数：乐观更新后到 persist settle 前 > 0。
 * loader 在 > 0 时跳过覆盖，堵住「代次未再递增但仍在 persist」窗口。
 */
const persistInFlightCounts = new Map<string, number>();

export function beginSharedTargetPersist(
  workspaceId: string,
  threadId: string,
): void {
  const key = persistGenerationKeyOf(workspaceId, threadId);
  persistInFlightCounts.set(key, (persistInFlightCounts.get(key) ?? 0) + 1);
}

export function endSharedTargetPersist(
  workspaceId: string,
  threadId: string,
): void {
  const key = persistGenerationKeyOf(workspaceId, threadId);
  const current = persistInFlightCounts.get(key) ?? 0;
  if (current <= 1) {
    persistInFlightCounts.delete(key);
    return;
  }
  persistInFlightCounts.set(key, current - 1);
}

export function isSharedTargetPersistInFlight(
  workspaceId: string,
  threadId: string,
): boolean {
  return (persistInFlightCounts.get(
    persistGenerationKeyOf(workspaceId, threadId),
  ) ?? 0) > 0;
}

function readState(key: string): SharedTargetState {
  return states.get(key) ?? EMPTY_STATE;
}

/** 选择语义相等：禁止等价 hydrate 换壳 notify 拖垮 Composer（#185 AP-02）。 */
function isSameExecutionTarget(
  left: ExecutionTarget | null,
  right: ExecutionTarget | null,
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.engine === right.engine &&
    (left.providerProfileId ?? null) === (right.providerProfileId ?? null) &&
    (left.modelCatalogEntryId ?? null) === (right.modelCatalogEntryId ?? null) &&
    (left.model ?? null) === (right.model ?? null) &&
    (left.reasoning?.effort ?? null) === (right.reasoning?.effort ?? null) &&
    (left.providerProfileNameSnapshot ?? null) ===
      (right.providerProfileNameSnapshot ?? null) &&
    (left.providerProfileSource ?? null) === (right.providerProfileSource ?? null)
  );
}

function writeState(key: string, next: SharedTargetState): void {
  const prev = readState(key);
  if (Object.is(prev, next)) {
    return;
  }
  // 顶层字段语义全同：不 notify（hydrate 总是 `{...prev}` 新壳）
  if (
    isSameExecutionTarget(prev.selectedNextTarget, next.selectedNextTarget) &&
    Object.is(prev.activeTurnTarget, next.activeTurnTarget)
  ) {
    return;
  }
  states.set(key, next);
  listeners.get(key)?.forEach((listener) => listener());
}

/** Backend/history hydration 的原子入口；null 必须清除旧选择。 */
export function hydrateSharedTargetState(
  workspaceId: string,
  threadId: string,
  target: ExecutionTarget | null,
): void {
  const key = storeKeyOf(workspaceId, threadId);
  const prev = readState(key);
  // 语义相等：跳过写与 generation，避免 persist 回写/loader 重复 hydrate 风暴
  if (isSameExecutionTarget(prev.selectedNextTarget, target)) {
    return;
  }
  writeState(key, { ...prev, selectedNextTarget: target });
  incrementPersistGeneration(workspaceId, threadId);
}

/** 更新下一次发送的目标选择（兼容调用入口）。 */
export function selectNextTarget(
  workspaceId: string,
  threadId: string,
  target: ExecutionTarget,
): void {
  hydrateSharedTargetState(workspaceId, threadId, target);
}

/** Turn 创建时固化 active 快照；此后不可变。 */
export function beginTurn(
  workspaceId: string,
  threadId: string,
  snapshot: TurnExecutionSnapshot,
  attemptId?: string | null,
): void {
  const key = storeKeyOf(workspaceId, threadId);
  const normalizedAttemptId = attemptId?.trim();
  if (normalizedAttemptId) {
    activeAttemptIds.set(key, normalizedAttemptId);
  } else {
    activeAttemptIds.delete(key);
  }
  writeState(key, { ...readState(key), activeTurnTarget: snapshot });
}

/**
 * Runtime owner 未携带快照时的安全 fallback。
 *
 * 只有 durable attempt identity 完全相同才能读取 active snapshot；禁止仅凭
 * Shared thread 或当前 Picker 推断本轮 provenance。
 */
export function getActiveTurnTargetForAttempt(
  workspaceId: string,
  threadId: string,
  attemptId: string,
): TurnExecutionSnapshot | null {
  const key = storeKeyOf(workspaceId, threadId);
  if (activeAttemptIds.get(key) !== attemptId.trim()) {
    return null;
  }
  return readState(key).activeTurnTarget;
}

/**
 * Turn 到达终态后清除 active 快照（历史 Badge 由 turn fact 承担，不读 store）。
 *
 * observer/recovery caller 应传 exact attemptId；迟到的旧 observer 不得清掉新 Turn。
 * 省略 attemptId 只保留给无并发 owner 的 legacy caller。
 */
export function endTurn(
  workspaceId: string,
  threadId: string,
  attemptId?: string | null,
): boolean {
  const key = storeKeyOf(workspaceId, threadId);
  const normalizedAttemptId = attemptId?.trim();
  if (
    normalizedAttemptId &&
    activeAttemptIds.get(key) !== normalizedAttemptId
  ) {
    return false;
  }
  const state = readState(key);
  if (state.activeTurnTarget === null) {
    activeAttemptIds.delete(key);
    return true;
  }
  activeAttemptIds.delete(key);
  writeState(key, { ...state, activeTurnTarget: null });
  return true;
}

export function getSharedTargetState(
  workspaceId: string,
  threadId: string,
): SharedTargetState {
  return readState(storeKeyOf(workspaceId, threadId));
}

function subscribe(
  workspaceId: string,
  threadId: string,
  listener: Listener,
): () => void {
  const key = storeKeyOf(workspaceId, threadId);
  let bucket = listeners.get(key);
  if (!bucket) {
    bucket = new Set();
    listeners.set(key, bucket);
  }
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
  };
}

/** React hook：订阅指定 Shared Thread 的 target 状态。 */
export function useSharedTargetState(
  workspaceId: string,
  threadId: string,
): SharedTargetState {
  return useSyncExternalStore(
    (listener) => subscribe(workspaceId, threadId, listener),
    () => getSharedTargetState(workspaceId, threadId),
    () => EMPTY_STATE,
  );
}

/** 测试专用：清空全部 store 状态。 */
export function resetSharedTargetStoreForTests(): void {
  states.clear();
  activeAttemptIds.clear();
  listeners.clear();
  persistGenerations.clear();
  persistInFlightCounts.clear();
}
