import type { ConversationItem } from "../../../../types";
import {
  buildMessagePresentationMetadata,
  getPresentationContext,
} from "../../../../conversation-presentation/normalizeConversationPresentation";

import { isEquivalentUserObservation } from "../../../threads/assembly/conversationNormalization";

export type NoteCardContextAttachment = {
  fileName: string;
  absolutePath: string;
};

export type NoteCardContextNote = {
  title: string;
  archived: boolean;
  bodyMarkdown: string;
  attachments: NoteCardContextAttachment[];
};

export type NoteCardContextSummary = {
  notes: NoteCardContextNote[];
  imagePaths: string[];
};




const OPTIMISTIC_USER_MESSAGE_PREFIX = "optimistic-user-";
const QUEUED_HANDOFF_MESSAGE_PREFIX = "queued-handoff-";

function isPendingUserBubbleId(id: string) {
  return (
    id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX)
    || id.startsWith(QUEUED_HANDOFF_MESSAGE_PREFIX)
  );
}



function normalizeSummaryKeySegment(value: string) {
  return value.trim().replace(/\r\n/g, "\n").replace(/\s+/g, " ");
}







function getNoteCardContextSummary(item: Extract<ConversationItem, { kind: "message" }>) {
  const context = getPresentationContext(
    buildMessagePresentationMetadata(item),
    "note-card",
  );
  if (!context) {
    return null;
  }
  return {
    notes: context.notes,
    imagePaths: context.imagePaths,
  } satisfies NoteCardContextSummary;
}

export function buildNoteCardContextSummaryKey(summary: NoteCardContextSummary | null) {
  if (!summary || summary.notes.length === 0) {
    return null;
  }
  return summary.notes
    .map((note) =>
      [
        normalizeSummaryKeySegment(note.title),
        note.archived ? "1" : "0",
        normalizeSummaryKeySegment(note.bodyMarkdown),
        note.attachments
          .map((attachment) =>
            `${normalizeSummaryKeySegment(attachment.fileName)}|${normalizeSummaryKeySegment(
              attachment.absolutePath,
            )}`,
          )
          .join("||"),
      ].join("::"),
    )
    .join("###");
}







export function buildSuppressedUserNoteCardContextMessageIdSet(items: ConversationItem[]) {
  const suppressedMessageIds = new Set<string>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "user") {
      continue;
    }
    const userSummaryKey = buildNoteCardContextSummaryKey(
      getNoteCardContextSummary(item),
    );
    if (!userSummaryKey) {
      continue;
    }

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previousItem = items[previousIndex];
      if (!previousItem || previousItem.kind !== "message") {
        continue;
      }
      if (previousItem.role === "user") {
        if (
          isPendingUserBubbleId(previousItem.id)
          && isEquivalentUserObservation(previousItem, item)
        ) {
          continue;
        }
        break;
      }
      const assistantSummaryKey = buildNoteCardContextSummaryKey(
        getNoteCardContextSummary(previousItem),
      );
      if (assistantSummaryKey && assistantSummaryKey === userSummaryKey) {
        suppressedMessageIds.add(item.id);
        break;
      }
    }
  }

  return suppressedMessageIds;
}
