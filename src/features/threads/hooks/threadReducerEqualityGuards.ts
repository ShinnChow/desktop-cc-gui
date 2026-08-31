import type { ConversationItem, ThreadSummary } from "../../../types";
import { areEquivalentAssistantMessageTexts } from "../assembly/conversationNormalization";
import {
  isAssistantMessageItem,
  isUserMessageItem,
} from "./threadReducerCoreHelpers";
import { mergeCompletedAgentText } from "./threadReducerTextMerge";
import type { ThreadActivityStatus } from "./threadReducerTypes";

export function shallowRecordEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

export function conversationItemsShallowEqual(
  left: ConversationItem,
  right: ConversationItem,
) {
  if (left.kind === "message" && right.kind === "message") {
    const {
      presentationMetadata: _leftPresentationMetadata,
      ...leftSourceFields
    } = left;
    const {
      presentationMetadata: _rightPresentationMetadata,
      ...rightSourceFields
    } = right;
    return shallowRecordEqual(leftSourceFields, rightSourceFields);
  }
  return shallowRecordEqual(
    left as unknown as Record<string, unknown>,
    right as unknown as Record<string, unknown>,
  );
}

export function threadActivityStatusEqual(
  left: ThreadActivityStatus | undefined,
  right: ThreadActivityStatus,
) {
  if (!left) {
    return false;
  }
  return shallowRecordEqual(
    left as unknown as Record<string, unknown>,
    right as unknown as Record<string, unknown>,
  );
}

export function stringArrayEqual(left: string[] | undefined, right: string[] | undefined) {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function autoSessionEqual(
  left: ThreadSummary["autoSession"],
  right: ThreadSummary["autoSession"],
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return (left ?? null) === (right ?? null);
  }
  return (
    left.sessionPurpose === right.sessionPurpose &&
    left.visibility === right.visibility &&
    left.ownerFeature === right.ownerFeature &&
    (left.autoArchive ?? null) === (right.autoArchive ?? null) &&
    left.createdBy === right.createdBy
  );
}

export function threadSummaryEqual(left: ThreadSummary, right: ThreadSummary) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.updatedAt === right.updatedAt &&
    (left.createdAt ?? null) === (right.createdAt ?? null) &&
    (left.archivedAt ?? null) === (right.archivedAt ?? null) &&
    (left.threadKind ?? null) === (right.threadKind ?? null) &&
    (left.sizeBytes ?? null) === (right.sizeBytes ?? null) &&
    (left.physicalPath ?? null) === (right.physicalPath ?? null) &&
    (left.engineSource ?? null) === (right.engineSource ?? null) &&
    (left.selectedEngine ?? null) === (right.selectedEngine ?? null) &&
    (left.source ?? null) === (right.source ?? null) &&
    (left.provider ?? null) === (right.provider ?? null) &&
    (left.sourceLabel ?? null) === (right.sourceLabel ?? null) &&
    (left.providerProfileId ?? null) === (right.providerProfileId ?? null) &&
    (left.providerProfileSource ?? null) ===
      (right.providerProfileSource ?? null) &&
    (left.providerProfileName ?? null) === (right.providerProfileName ?? null) &&
    (left.providerAvailability ?? null) ===
      (right.providerAvailability ?? null) &&
    (left.partialSource ?? null) === (right.partialSource ?? null) &&
    (left.isDegraded ?? false) === (right.isDegraded ?? false) &&
    (left.degradedReason ?? null) === (right.degradedReason ?? null) &&
    (left.folderId ?? null) === (right.folderId ?? null) &&
    autoSessionEqual(left.autoSession ?? null, right.autoSession ?? null) &&
    stringArrayEqual(left.nativeThreadIds, right.nativeThreadIds) &&
    (left.parentThreadId ?? null) === (right.parentThreadId ?? null)
  );
}

export function threadSummaryListEqual(left: ThreadSummary[], right: ThreadSummary[]) {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((thread, index) => {
    const rightThread = right[index];
    return rightThread ? threadSummaryEqual(thread, rightThread) : false;
  });
}

export function findEquivalentAssistantSnapshotIndex(
  list: ConversationItem[],
  incomingText: string,
) {
  if (!incomingText.trim()) {
    return -1;
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (isUserMessageItem(item)) {
      return -1;
    }
    if (!isAssistantMessageItem(item)) {
      continue;
    }
    if (
      areEquivalentAssistantMessageTexts(
        item.text,
        incomingText,
        mergeCompletedAgentText,
      )
    ) {
      return index;
    }
  }
  return -1;
}

