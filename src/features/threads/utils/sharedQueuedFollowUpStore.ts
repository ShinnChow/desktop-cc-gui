import type {
  MessageSendOptions,
  QueuedMessage,
  SharedQueuedExecutionTarget,
} from "../../../types";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { appendVolatileRendererDiagnostic } from "../../../services/rendererDiagnostics";
import {
  isResolvedExecutionTarget,
  normalizePersistedExecutionTarget,
} from "../../shared-session/target/types";

const STORE_NAME = "composer";
const STORE_KEY = "sharedQueuedFollowUps.v1";
// F2a（fix-session-switch-jank-red-lines）：单条排队消息持久化的图片 base64 预算。
// 实测存量 envelope 曾被两张历史截图（1.76MB + 688KB）堆到 2.45MB，每次写盘全量 stringify。
// 只约束落盘形态：运行时内存队列与本轮发送不受影响。
export const MAX_PERSISTED_QUEUE_IMAGE_BYTES = 512 * 1024;

function queueKey(workspaceId: string, threadId: string): string {
  return JSON.stringify([workspaceId, threadId]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneFrozenTarget(value: unknown): SharedQueuedExecutionTarget | null {
  const normalized = normalizePersistedExecutionTarget(value);
  if (!isResolvedExecutionTarget(normalized)) {
    return null;
  }
  return {
    engine: normalized.engine,
    providerProfileId: normalized.providerProfileId?.trim() || null,
    modelCatalogEntryId: normalized.modelCatalogEntryId,
    model: normalized.model,
    reasoning: normalized.reasoning
      ? { effort: normalized.reasoning.effort }
      : null,
    providerProfileNameSnapshot: normalized.providerProfileNameSnapshot,
    providerProfileSource: normalized.providerProfileSource,
  };
}

function normalizeSendOptions(value: unknown): MessageSendOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    const cloned = structuredClone(value) as Record<string, unknown>;
    // frozen Target 由 queue envelope 单独校验，不能从 options 旁路恢复。
    delete cloned.sharedExecutionTarget;
    return cloned as MessageSendOptions;
  } catch {
    return undefined;
  }
}

function normalizeOwnerId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeQueuedMessage(value: unknown): QueuedMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const text = typeof value.text === "string" ? value.text : "";
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : 0;
  const sharedExecutionTarget = cloneFrozenTarget(value.sharedExecutionTarget);
  if (!id || !text.trim() || createdAt <= 0 || !sharedExecutionTarget) {
    return null;
  }
  const images = Array.isArray(value.images)
    ? value.images.filter(
        (image): image is string =>
          typeof image === "string" && image.trim().length > 0,
      )
    : [];
  const sharedPredecessorAttemptId =
    typeof value.sharedPredecessorAttemptId === "string"
      ? value.sharedPredecessorAttemptId.trim() || null
      : null;
  return {
    id,
    text,
    createdAt,
    images: images.length > 0 ? images : undefined,
    sendOptions: normalizeSendOptions(value.sendOptions),
    sharedExecutionTarget,
    sharedPredecessorAttemptId,
    ownerWorkspaceId: normalizeOwnerId(value.ownerWorkspaceId),
    ownerThreadId: normalizeOwnerId(value.ownerThreadId),
    sharedDispatchState:
      value.sharedDispatchState === "pending-ack" ? "pending-ack" : undefined,
  };
}

function readEnvelope(): Record<string, unknown> {
  const stored = getClientStoreSync<unknown>(STORE_NAME, STORE_KEY);
  return isRecord(stored) ? stored : {};
}

export function readSharedQueuedFollowUps(
  workspaceId: string,
  threadId: string,
): QueuedMessage[] {
  const storedQueue = readEnvelope()[queueKey(workspaceId, threadId)];
  if (!Array.isArray(storedQueue)) {
    return [];
  }
  return storedQueue
    .map(normalizeQueuedMessage)
    .filter((item): item is QueuedMessage => item !== null);
}

export function writeSharedQueuedFollowUps(
  workspaceId: string,
  threadId: string,
  queue: QueuedMessage[],
): void {
  const key = queueKey(workspaceId, threadId);
  const envelope = pruneStaleQueues({ ...readEnvelope() });
  const persistedQueue = queue.map((item) => ({
    ...item,
    images: sanitizeQueueImagesForPersistence(item.images),
  }));
  if (persistedQueue.length === 0) {
    delete envelope[key];
  } else {
    envelope[key] = persistedQueue;
  }
  writeClientStoreValue(STORE_NAME, STORE_KEY, envelope);
}

// workspace / thread 已不存在的队列在任意写入时惰性清除（对齐 recentCompleted 的
// 惰性收敛策略，无启动 migration）。snapshot 缺失或线程列表未水化时保守跳过。
function pruneStaleQueues(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot = getClientStoreSync<unknown>("threads", "sidebarSnapshot");
  if (!isRecord(snapshot) || !Array.isArray(snapshot.workspaces)) {
    return envelope;
  }
  const workspaceIds = new Set<string>();
  for (const workspace of snapshot.workspaces) {
    if (isRecord(workspace) && typeof workspace.id === "string") {
      workspaceIds.add(workspace.id);
    }
  }
  if (workspaceIds.size === 0) {
    return envelope;
  }
  const threadsByWorkspace = isRecord(snapshot.threadsByWorkspace)
    ? snapshot.threadsByWorkspace
    : {};
  const next = { ...envelope };
  for (const key of Object.keys(next)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      continue;
    }
    const [envelopeWorkspaceId, envelopeThreadId] = parsed;
    if (
      typeof envelopeWorkspaceId !== "string" ||
      typeof envelopeThreadId !== "string"
    ) {
      continue;
    }
    if (!workspaceIds.has(envelopeWorkspaceId)) {
      delete next[key];
      continue;
    }
    const threads = threadsByWorkspace[envelopeWorkspaceId];
    // 线程列表为空可能是未水化而非真空：仅在有非空列表证据时按 thread 粒度 prune。
    if (Array.isArray(threads) && threads.length > 0) {
      const threadExists = threads.some(
        (thread) => isRecord(thread) && thread.id === envelopeThreadId,
      );
      if (!threadExists) {
        delete next[key];
      }
    }
  }
  return next;
}

function sanitizeQueueImagesForPersistence(
  images: string[] | undefined,
): string[] | undefined {
  if (!images || images.length === 0) {
    return images;
  }
  const kept: string[] = [];
  let totalBytes = 0;
  let stripped = 0;
  for (const image of images) {
    if (totalBytes + image.length > MAX_PERSISTED_QUEUE_IMAGE_BYTES) {
      stripped += 1;
      continue;
    }
    kept.push(image);
    totalBytes += image.length;
  }
  if (stripped > 0) {
    appendVolatileRendererDiagnostic("composer/queue-image-stripped", {
      stripped,
      kept: kept.length,
    });
  }
  return kept;
}
