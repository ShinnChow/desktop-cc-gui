import type { ThreadSummary } from "../../../types";
import type { ThreadAction } from "./threadReducerTypes";

export type ThreadProviderBindingFields = Pick<
  ThreadSummary,
  | "sourceLabel"
  | "providerProfileId"
  | "providerProfileSource"
  | "providerProfileName"
  | "providerAvailability"
>;

export function normalizeEnsureThreadMetadataValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function parentThreadIdFromEnsureThreadAction(
  action: Extract<ThreadAction, { type: "ensureThread" }>,
) {
  const parentThreadId = normalizeEnsureThreadMetadataValue(action.parentThreadId);
  return parentThreadId && parentThreadId !== action.threadId
    ? parentThreadId
    : undefined;
}

export function providerBindingFromEnsureThreadAction(
  action: Extract<ThreadAction, { type: "ensureThread" }>,
): Partial<ThreadProviderBindingFields> {
  const sourceLabel = normalizeEnsureThreadMetadataValue(action.sourceLabel);
  const providerProfileId = normalizeEnsureThreadMetadataValue(
    action.providerProfileId,
  );
  const providerProfileSource = normalizeEnsureThreadMetadataValue(
    action.providerProfileSource,
  );
  const providerProfileName = normalizeEnsureThreadMetadataValue(
    action.providerProfileName,
  );
  const providerAvailability = normalizeEnsureThreadMetadataValue(
    action.providerAvailability,
  );
  return {
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(providerProfileSource ? { providerProfileSource } : {}),
    ...(providerProfileName ? { providerProfileName } : {}),
    ...(providerAvailability ? { providerAvailability } : {}),
  };
}

export function providerBindingFieldsEqual(
  left: Partial<ThreadProviderBindingFields>,
  right: Partial<ThreadProviderBindingFields>,
) {
  return (
    (left.sourceLabel ?? undefined) === (right.sourceLabel ?? undefined) &&
    (left.providerProfileId ?? undefined) ===
      (right.providerProfileId ?? undefined) &&
    (left.providerProfileSource ?? undefined) ===
      (right.providerProfileSource ?? undefined) &&
    (left.providerProfileName ?? undefined) ===
      (right.providerProfileName ?? undefined) &&
    (left.providerAvailability ?? undefined) ===
      (right.providerAvailability ?? undefined)
  );
}


export function mergeProviderBindingFields<T extends ThreadSummary>(
  incoming: T,
  existing?: ThreadSummary,
): T {
  if (!existing) {
    return incoming;
  }
  return {
    ...incoming,
    sourceLabel: incoming.sourceLabel ?? existing.sourceLabel,
    providerProfileId: incoming.providerProfileId ?? existing.providerProfileId,
    providerProfileSource:
      incoming.providerProfileSource ?? existing.providerProfileSource,
    providerProfileName:
      incoming.providerProfileName ?? existing.providerProfileName,
    providerAvailability:
      incoming.providerAvailability ?? existing.providerAvailability,
  };
}

