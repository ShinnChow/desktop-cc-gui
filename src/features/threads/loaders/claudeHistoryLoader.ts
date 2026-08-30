import type {
  ClaudeDeferredImage,
  ClaudeDeferredImageLocator,
  ConversationItem,
  RequestUserInputRequest,
  ThreadTokenUsage,
} from "../../../types";
import i18n from "../../../i18n";
import {
  extractClaudeApprovalResumeEntries,
  stripClaudeApprovalResumeArtifacts,
} from "../../../utils/threadItems";
import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import {
  areEquivalentReasoningTexts,
  compactComparableConversationText,
} from "../assembly/conversationNormalization";
import {
  buildClaudeControlEventItem,
  classifyClaudeControlPlaneMessage,
  classifyClaudeLocalControlMessage,
  extractTurnIdFromRawMessage,
  getClaudeHistoryMessageRole,
} from "./claudeControlPlaneClassifier";
import {
  asBooleanFlag,
  asFiniteNonNegativeNumber,
  asRecord,
  buildUnifiedDiff,
  getFirstStringFieldFromRecords,
  parseHistoryTimestampMs,
  parseJsonRecordFromText,
} from "./claudeHistoryPrimitives";
import { findLiveAssistantShadowTranscriptForRestore } from "../utils/liveAssistantShadowTranscript";
import { noteThreadRecoverySourceObserved } from "../utils/streamLatencyDiagnostics";
import { isCliInjectedAgentTaskNotificationText } from "../../engine-task-output/contracts/agentTaskNotification";
import type { HistoryLoadingProgressListener } from "../utils/historyLoadingProgress";
import { runNativeHistoryFetchAndParse } from "../utils/runNativeHistoryOpenStages";
import { asString } from "./historyLoaderUtils";

type ClaudeHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadClaudeSession: (
    workspacePath: string,
    sessionId: string,
    options?: { limit?: number | null; before?: string | null },
  ) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

export const CLAUDE_UI_HISTORY_WINDOW = 80;

type MessageItemWithTurn = Extract<ConversationItem, { kind: "message" }> & {
  role: "assistant";
  turnId?: string | null;
};

type AskUserQuestionOption = {
  label: string;
  description: string;
};

type AskUserQuestionTemplate = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  multiSelect: boolean;
  options?: AskUserQuestionOption[];
};

type AskUserQuestionAnswer = {
  selectedOptions: string[];
  note: string;
};

type AskUserQuestionAnswerParseResult = {
  rawSelectionText: string;
  answers: AskUserQuestionAnswer[];
  answersByQuestionId: Record<string, AskUserQuestionAnswer>;
};

const ASK_USER_QUESTION_DISMISSED_TEXT_REGEX =
  /^The user dismissed the question without selecting an option\.?$/i;
const ASK_USER_QUESTION_SKIPPED_TEXT_REGEX =
  /^The user skipped this AskUserQuestion without selecting an option\.\s*Do not ask the same question again;\s*continue the original task using the available context and reasonable assumptions\.?$/i;
const ASK_USER_QUESTION_PARTIAL_SKIP_TEXT_REGEX =
  /^The user answered the AskUserQuestion[:：]\s*([\s\S]*?)[。.]?\s*The user skipped \d+ remaining question\(s\) without selecting an option\.\s*Do not ask the skipped question\(s\) again;\s*continue the original task using the available context and reasonable assumptions\.?$/i;
const ASK_USER_QUESTION_RESULT_BASE64_REGEX =
  /\bAskUserQuestionResultBase64:([A-Za-z0-9+/=]+)/;

type RequestUserInputSubmittedPayload = {
  schema: "requestUserInputSubmitted/v1";
  submittedAt: number;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: AskUserQuestionOption[];
    selectedOptions: string[];
    note: string;
  }>;
};


function isReasoningSnapshotDuplicate(previous: string, incoming: string) {
  return areEquivalentReasoningTexts(previous, incoming);
}

function preferLongerReasoningText(previous: string, incoming: string) {
  const previousCompactLength =
    compactComparableConversationText(previous).length;
  const incomingCompactLength =
    compactComparableConversationText(incoming).length;
  return incomingCompactLength >= previousCompactLength ? incoming : previous;
}

function getClaudeToolName(message: Record<string, unknown>) {
  return asString(
    message.tool_name ?? message.toolName ?? message.title ?? "Tool",
  );
}

function getClaudeToolInputText(message: Record<string, unknown>) {
  const toolInput = getClaudeToolInputRecord(message);
  if (toolInput && Object.keys(toolInput).length > 0) {
    return JSON.stringify(toolInput);
  }
  return "";
}

function getClaudeToolOutputText(message: Record<string, unknown>) {
  const toolOutput = getClaudeToolOutputRecord(message);
  return asString(
    toolOutput?.output ??
      toolOutput?.stdout ??
      toolOutput?.stderr ??
      message.text ??
      "",
  );
}

function extractImageList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = asString(entry).trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    images.push(normalized);
  }
  return images;
}

function extractDeferredClaudeImages(
  value: unknown,
  workspacePath?: string | null,
): ClaudeDeferredImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ClaudeDeferredImage[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const locatorRecord = asRecord(record?.locator);
    if (!record || !locatorRecord) {
      continue;
    }
    const sessionId = asString(locatorRecord.sessionId).trim();
    const mediaType = asString(
      record.mediaType ?? locatorRecord.mediaType,
    ).trim();
    const lineIndex = Number(locatorRecord.lineIndex);
    const blockIndex = Number(locatorRecord.blockIndex);
    if (
      !sessionId ||
      !mediaType.startsWith("image/") ||
      !Number.isFinite(lineIndex) ||
      !Number.isFinite(blockIndex) ||
      lineIndex < 0 ||
      blockIndex < 0
    ) {
      continue;
    }
    const locator: ClaudeDeferredImageLocator = {
      sessionId,
      lineIndex: Math.trunc(lineIndex),
      blockIndex: Math.trunc(blockIndex),
      mediaType,
      messageId: asString(locatorRecord.messageId).trim() || null,
    };
    images.push({
      locator,
      mediaType,
      estimatedByteSize: Math.max(0, Number(record.estimatedByteSize) || 0),
      reason: asString(record.reason).trim() || "large-inline-image",
      workspacePath: workspacePath ?? null,
    });
  }
  return images;
}

function parseToolRecordCandidate(
  value: unknown,
): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (direct) {
    return direct;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function getClaudeSourceToolId(message: Record<string, unknown>) {
  const directCandidates = [
    message.source_tool_id,
    message.sourceToolId,
    message.source_tool_call_id,
    message.sourceToolCallId,
    message.tool_use_id,
    message.toolUseId,
    message.call_id,
    message.callId,
    message.parent_tool_id,
    message.parentToolId,
    message.parent_id,
    message.parentId,
  ];
  for (const candidate of directCandidates) {
    const resolved = asString(candidate).trim();
    if (resolved) {
      return resolved;
    }
  }

  const nestedSources = [
    message.tool_output,
    message.output,
    message.result,
    message.meta,
    message.metadata,
  ];
  for (const source of nestedSources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    const record = source as Record<string, unknown>;
    const nestedCandidates = [
      record.source_tool_id,
      record.sourceToolId,
      record.source_tool_call_id,
      record.sourceToolCallId,
      record.tool_use_id,
      record.toolUseId,
      record.call_id,
      record.callId,
      record.parent_tool_id,
      record.parentToolId,
      record.parent_id,
      record.parentId,
    ];
    for (const candidate of nestedCandidates) {
      const resolved = asString(candidate).trim();
      if (resolved) {
        return resolved;
      }
    }
  }

  const toolId = asString(message.id ?? "").trim();
  if (!toolId) {
    return "";
  }

  const suffixes = ["-result", ":result", "_result", ".result", "/result"];
  for (const suffix of suffixes) {
    if (toolId.endsWith(suffix) && toolId.length > suffix.length) {
      return toolId.slice(0, -suffix.length);
    }
  }
  return "";
}

function getClaudeToolInputRecord(message: Record<string, unknown>) {
  const candidates = [
    message.toolInput,
    message.tool_input,
    message.input,
    message.arguments,
    message.params,
    asRecord(message.meta)?.input,
    asRecord(message.metadata)?.input,
  ];
  for (const candidate of candidates) {
    const record = parseToolRecordCandidate(candidate);
    if (record && Object.keys(record).length > 0) {
      return record;
    }
  }
  return null;
}

function getClaudeToolOutputRecord(message: Record<string, unknown>) {
  const candidates = [
    message.toolOutput,
    message.tool_output,
    message.output,
    message.result,
    asRecord(message.meta)?.output,
    asRecord(message.metadata)?.output,
  ];
  for (const candidate of candidates) {
    const record = parseToolRecordCandidate(candidate);
    if (record && Object.keys(record).length > 0) {
      return record;
    }
  }
  return null;
}

function parseAskUserQuestionTemplates(
  toolInput: Record<string, unknown> | null,
): AskUserQuestionTemplate[] {
  if (!toolInput) {
    return [];
  }
  const hasSingleQuestionShape =
    "question" in toolInput ||
    "prompt" in toolInput ||
    "header" in toolInput ||
    "title" in toolInput ||
    "options" in toolInput;
  const rawQuestions = Array.isArray(toolInput.questions)
    ? toolInput.questions
    : hasSingleQuestionShape
      ? [toolInput]
      : [];
  const templates: AskUserQuestionTemplate[] = [];
  rawQuestions.forEach((entry, index) => {
    const question = asRecord(entry);
    if (!question) {
      return;
    }
    const id = asString(question.id ?? `q-${index}`).trim() || `q-${index}`;
    const header = asString(question.header ?? question.title ?? "").trim();
    const questionText = asString(
      question.question ?? question.prompt ?? "",
    ).trim();
    const isOther =
      question.isOther === undefined && question.is_other === undefined
        ? true
        : Boolean(question.isOther ?? question.is_other);
    const multiSelect = Boolean(question.multiSelect ?? question.multi_select);
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions
      .map((rawOption) => {
        const option = asRecord(rawOption);
        if (!option) {
          return null;
        }
        const label = asString(option.label ?? "").trim();
        const description = asString(option.description ?? "").trim();
        if (!label && !description) {
          return null;
        }
        return { label, description };
      })
      .filter((option): option is AskUserQuestionOption => option !== null);
    if (!questionText && options.length === 0) {
      return;
    }
    templates.push({
      id,
      header,
      question: questionText,
      isOther,
      multiSelect,
      options: options.length > 0 ? options : undefined,
    });
  });
  return templates;
}

function parseAskUserAnswerParts(raw: string): AskUserQuestionAnswer {
  const segments = raw
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const selectedOptions: string[] = [];
  let note = "";
  for (const segment of segments) {
    if (/^user_note\s*:/i.test(segment)) {
      const parsedNote = segment.replace(/^user_note\s*:/i, "").trim();
      if (parsedNote) {
        note = parsedNote;
      }
      continue;
    }
    selectedOptions.push(segment);
  }
  return { selectedOptions, note };
}

function decodeBase64JsonRecord(
  base64Value: string,
): Record<string, unknown> | null {
  try {
    const binary = globalThis.atob(base64Value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const jsonText = new TextDecoder().decode(bytes);
    return parseJsonRecordFromText(jsonText);
  } catch {
    return null;
  }
}

function parseStructuredAnswerResult(
  text: string,
  templates: AskUserQuestionTemplate[],
): AskUserQuestionAnswerParseResult | null {
  const markerMatch = text.match(ASK_USER_QUESTION_RESULT_BASE64_REGEX);
  if (!markerMatch) {
    return null;
  }
  const payload = decodeBase64JsonRecord(asString(markerMatch[1]));
  const answersRecord = asRecord(payload?.answers);
  if (!answersRecord) {
    return null;
  }
  const templateIds = new Set(templates.map((template) => template.id));
  const answersByQuestionId: Record<string, AskUserQuestionAnswer> = {};
  const displayParts: string[] = [];
  Object.entries(answersRecord).forEach(([questionId, rawAnswers]) => {
    if (!templateIds.has(questionId) || !Array.isArray(rawAnswers)) {
      return;
    }
    const answerValues = rawAnswers
      .map((value) => asString(value).trim())
      .filter(Boolean);
    if (answerValues.length === 0) {
      return;
    }
    const answerText = answerValues.join(", ");
    answersByQuestionId[questionId] = parseAskUserAnswerParts(answerText);
    displayParts.push(answerText);
  });
  if (Object.keys(answersByQuestionId).length === 0) {
    return null;
  }
  return {
    rawSelectionText: displayParts.join("; "),
    answers: [],
    answersByQuestionId,
  };
}

function parseAskUserAnswerSegments(
  rawSelectionText: string,
  templates: AskUserQuestionTemplate[],
) {
  const templateIds = new Set(templates.map((template) => template.id));
  const baseSegments = rawSelectionText
    .split(/[;；]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const answersByQuestionId: Record<string, AskUserQuestionAnswer> = {};
  const positionalAnswerSegments: string[] = [];
  for (const segment of baseSegments) {
    const keyedMatch = segment.match(/^([A-Za-z0-9_.:-]+)\s*=\s*([\s\S]*)$/);
    if (keyedMatch) {
      const questionId = asString(keyedMatch[1]).trim();
      const answerText = asString(keyedMatch[2]).trim();
      if (templateIds.has(questionId)) {
        answersByQuestionId[questionId] = parseAskUserAnswerParts(answerText);
        continue;
      }
    }
    positionalAnswerSegments.push(segment);
  }
  return {
    answersByQuestionId,
    positionalAnswerSegments,
    displaySelectionText: baseSegments
      .map((segment) => {
        const keyedMatch = segment.match(
          /^([A-Za-z0-9_.:-]+)\s*=\s*([\s\S]*)$/,
        );
        if (!keyedMatch) {
          return segment;
        }
        const questionId = asString(keyedMatch[1]).trim();
        return templateIds.has(questionId)
          ? asString(keyedMatch[2]).trim()
          : segment;
      })
      .filter(Boolean)
      .join("; "),
  };
}

function parseAskUserQuestionAnswerText(
  text: string,
  templates: AskUserQuestionTemplate[],
): AskUserQuestionAnswerParseResult | null {
  const trimmed = text.trim();
  const questionCount = templates.length;
  if (!trimmed) {
    return null;
  }

  if (
    ASK_USER_QUESTION_DISMISSED_TEXT_REGEX.test(trimmed) ||
    ASK_USER_QUESTION_SKIPPED_TEXT_REGEX.test(trimmed)
  ) {
    return {
      rawSelectionText: "",
      answers: Array.from({ length: Math.max(questionCount, 1) }, () => ({
        selectedOptions: [],
        note: "",
      })),
      answersByQuestionId: {},
    };
  }

  const structuredResult = parseStructuredAnswerResult(trimmed, templates);
  if (structuredResult) {
    return structuredResult;
  }

  const answeredMatch =
    trimmed.match(ASK_USER_QUESTION_PARTIAL_SKIP_TEXT_REGEX) ??
    trimmed.match(
      /^The user answered the AskUserQuestion:\s*([\s\S]*?)(?:[。.]?\s*Please continue based on this selection\.?)$/i,
    );
  if (!answeredMatch) {
    return null;
  }
  const rawSelectionText = (answeredMatch[1] ?? "").trim();
  if (!rawSelectionText) {
    return null;
  }

  const {
    answersByQuestionId,
    positionalAnswerSegments,
    displaySelectionText,
  } = parseAskUserAnswerSegments(rawSelectionText, templates);
  if (
    positionalAnswerSegments.length === 0 &&
    Object.keys(answersByQuestionId).length === 0
  ) {
    return null;
  }
  if (Object.keys(answersByQuestionId).length > 0) {
    return {
      rawSelectionText: displaySelectionText,
      answers: [],
      answersByQuestionId,
    };
  }
  if (questionCount <= 1) {
    return {
      rawSelectionText,
      answers: [parseAskUserAnswerParts(rawSelectionText)],
      answersByQuestionId,
    };
  }

  const normalizedSegments = [...positionalAnswerSegments];
  if (normalizedSegments.length > questionCount) {
    const remaining = normalizedSegments
      .splice(questionCount - 1)
      .join("; ")
      .trim();
    normalizedSegments.push(remaining);
  }
  while (normalizedSegments.length < questionCount) {
    normalizedSegments.push("");
  }

  return {
    rawSelectionText,
    answers: normalizedSegments.map((segment) =>
      parseAskUserAnswerParts(segment),
    ),
    answersByQuestionId,
  };
}

function buildRequestUserInputSubmittedPayload(
  templates: AskUserQuestionTemplate[],
  parseResult: AskUserQuestionAnswerParseResult,
): RequestUserInputSubmittedPayload {
  return {
    schema: "requestUserInputSubmitted/v1",
    submittedAt: Date.now(),
    questions: templates.map((template, index) => ({
      id: template.id || `q-${index}`,
      header: template.header,
      question: template.question,
      options: template.options,
      selectedOptions:
        parseResult.answersByQuestionId[template.id]?.selectedOptions ??
        parseResult.answers[index]?.selectedOptions ??
        [],
      note:
        parseResult.answersByQuestionId[template.id]?.note ??
        parseResult.answers[index]?.note ??
        "",
    })),
  };
}

function normalizeClaudeToolName(toolName: string) {
  return toolName.trim().toLowerCase();
}

/** Native AskUserQuestion or MCP bridge (`mcp__ccgui__AskUserQuestion`). */
function isClaudeAskUserQuestionToolName(toolName: string) {
  const normalized = normalizeClaudeToolName(toolName);
  if (!normalized) {
    return false;
  }
  if (
    normalized === "askuserquestion" ||
    normalized === "ask_user_question"
  ) {
    return true;
  }
  return (
    normalized.includes("askuserquestion") ||
    normalized.includes("ask_user_question")
  );
}

/**
 * MCP bridge asks cannot be answered after history reopen: live request_id is a
 * hash of a synthetic tool_id, while transcript tool ids are CLI tool_use ids.
 * Only rehydrate interactive cards for native AskUserQuestion.
 */
function isNativeClaudeAskUserQuestionToolName(toolName: string) {
  const normalized = normalizeClaudeToolName(toolName);
  return (
    normalized === "askuserquestion" || normalized === "ask_user_question"
  );
}

const CLAUDE_FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "filepath",
  "path",
  "target_file",
  "targetFile",
  "filename",
  "file",
  "notebook_path",
  "notebookPath",
];

function inferClaudeFileChange(
  toolName: string,
  message: Record<string, unknown>,
): {
  toolType: string;
  changes: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>;
} | null {
  const normalizedToolName = normalizeClaudeToolName(toolName);
  const isWriteLike =
    normalizedToolName === "write" || normalizedToolName === "write_file";
  const isEditLike =
    normalizedToolName === "edit" || normalizedToolName === "edit_file";
  const isDeleteLike =
    normalizedToolName === "delete" ||
    normalizedToolName === "delete_file" ||
    normalizedToolName === "remove" ||
    normalizedToolName === "remove_file" ||
    normalizedToolName === "unlink";
  if (!isWriteLike && !isEditLike && !isDeleteLike) {
    return null;
  }

  const toolInput = getClaudeToolInputRecord(message);
  const toolOutput = getClaudeToolOutputRecord(message);
  const filePath = getFirstStringFieldFromRecords(
    [toolOutput, toolInput],
    CLAUDE_FILE_PATH_KEYS,
  );
  if (!filePath) {
    return null;
  }

  if (isWriteLike) {
    const content = asString(toolOutput?.content ?? toolInput?.content ?? "");
    const diff = content ? buildUnifiedDiff("", content) : "";
    return {
      toolType: "fileChange",
      changes: [{ path: filePath, kind: "add", diff }],
    };
  }

  if (isDeleteLike) {
    const oldText = asString(
      toolOutput?.oldString ??
        toolOutput?.old_string ??
        toolOutput?.originalFile ??
        toolOutput?.content ??
        toolInput?.old_string ??
        "",
    );
    const diff = oldText ? buildUnifiedDiff(oldText, "") : "";
    return {
      toolType: "fileChange",
      changes: [{ path: filePath, kind: "delete", diff }],
    };
  }

  const oldText = asString(
    toolOutput?.oldString ??
      toolOutput?.originalFile ??
      toolInput?.old_string ??
      "",
  );
  const newText = asString(
    toolOutput?.newString ?? toolInput?.new_string ?? "",
  );
  const diff = oldText || newText ? buildUnifiedDiff(oldText, newText) : "";
  return {
    toolType: "fileChange",
    changes: [{ path: filePath, kind: "modified", diff }],
  };
}

function findLatestPendingToolIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const entry = items[index];
    if (entry?.kind !== "tool") {
      continue;
    }
    if (entry.status === "completed" || entry.status === "failed") {
      continue;
    }
    return index;
  }
  return -1;
}

function mergeReasoningSnapshot(
  items: ConversationItem[],
  id: string,
  text: string,
) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }
  const byIdIndex = items.findIndex(
    (item) => item.kind === "reasoning" && item.id === id,
  );
  if (byIdIndex >= 0) {
    const existing = items[byIdIndex];
    if (existing?.kind === "reasoning") {
      const nextText = preferLongerReasoningText(
        existing.content,
        normalizedText,
      );
      items[byIdIndex] = {
        ...existing,
        summary: nextText.slice(0, 100),
        content: nextText,
      };
    }
    return;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate?.kind === "message" && candidate.role === "user") {
      break;
    }
    if (candidate?.kind !== "reasoning") {
      continue;
    }
    if (!isReasoningSnapshotDuplicate(candidate.content, normalizedText)) {
      continue;
    }
    const nextText = preferLongerReasoningText(
      candidate.content,
      normalizedText,
    );
    items[index] = {
      ...candidate,
      summary: nextText.slice(0, 100),
      content: nextText,
    };
    return;
  }
  items.push({
    id,
    kind: "reasoning",
    summary: normalizedText.slice(0, 100),
    content: normalizedText,
  });
}

function extractClaudeAssistantFinalFlag(
  message: Record<string, unknown>,
): boolean | undefined {
  const metadata =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    message.isFinal,
    message.is_final,
    message.final,
    message.isFinalMessage,
    message.is_final_message,
  ];
  if (metadata) {
    candidates.push(
      metadata.isFinal,
      metadata.is_final,
      metadata.final,
      metadata.isFinalMessage,
      metadata.is_final_message,
    );
  }
  for (const candidate of candidates) {
    const parsed = asBooleanFlag(candidate);
    if (typeof parsed === "boolean") {
      return parsed;
    }
  }
  return undefined;
}

function markClaudeAssistantFinalMessages(items: ConversationItem[]) {
  let lastAssistantIndexInTurn = -1;
  let hasExplicitFinalAssistantInTurn = false;
  const finalizeCurrentTurn = () => {
    if (hasExplicitFinalAssistantInTurn || lastAssistantIndexInTurn < 0) {
      return;
    }
    const lastAssistant = items[lastAssistantIndexInTurn];
    if (
      !lastAssistant ||
      lastAssistant.kind !== "message" ||
      lastAssistant.role !== "assistant"
    ) {
      return;
    }
    if (lastAssistant.isFinal === true) {
      return;
    }
    items[lastAssistantIndexInTurn] = {
      ...lastAssistant,
      isFinal: true,
    };
  };

  items.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      finalizeCurrentTurn();
      lastAssistantIndexInTurn = -1;
      hasExplicitFinalAssistantInTurn = false;
      return;
    }
    if (item.kind === "message" && item.role === "assistant") {
      if (item.isFinal === true) {
        hasExplicitFinalAssistantInTurn = true;
      }
      lastAssistantIndexInTurn = index;
    }
  });

  finalizeCurrentTurn();
}

function hydrateClaudeAssistantFinalTiming(
  items: ConversationItem[],
  messageTimestampById: Map<string, number>,
) {
  let turnStartedAtMs: number | undefined;
  items.forEach((item, index) => {
    if (item.kind !== "message") {
      return;
    }
    if (item.role === "user") {
      turnStartedAtMs = messageTimestampById.get(item.id);
      return;
    }
    if (item.isFinal !== true) {
      return;
    }
    const completedAtMs = messageTimestampById.get(item.id);
    const durationMs =
      typeof completedAtMs === "number" && typeof turnStartedAtMs === "number"
        ? Math.max(0, completedAtMs - turnStartedAtMs)
        : undefined;
    if (typeof completedAtMs !== "number" && typeof durationMs !== "number") {
      return;
    }
    items[index] = {
      ...item,
      ...(typeof completedAtMs === "number"
        ? { finalCompletedAt: completedAtMs }
        : {}),
      ...(typeof durationMs === "number"
        ? { finalDurationMs: durationMs }
        : {}),
    };
  });
}

function inferSyntheticApprovalChangeKind(summary: string) {
  const normalized = summary.trim().toLowerCase();
  if (normalized.includes("deleted ") || normalized.includes("removed ")) {
    return "delete" as const;
  }
  if (
    normalized.includes("created ") ||
    normalized.includes("added ") ||
    normalized.includes("wrote ")
  ) {
    return "add" as const;
  }
  return "modified" as const;
}

function parseSyntheticApprovalResumeItems(
  text: string,
  itemIdPrefix: string,
): ConversationItem[] {
  const structuredEntries = extractClaudeApprovalResumeEntries(text);
  if (structuredEntries.length > 0) {
    return structuredEntries.map((entry, index) => ({
      id: `${itemIdPrefix}-approval-${index + 1}`,
      kind: "tool",
      toolType: "fileChange",
      title: "Approved file change",
      detail: entry.summary,
      status:
        entry.status === "failed"
          ? "failed"
          : entry.status === "pending"
            ? "pending"
            : "completed",
      output: entry.summary,
      changes: entry.path
        ? [
            {
              path: entry.path,
              kind:
                entry.kind === "add" ||
                entry.kind === "modified" ||
                entry.kind === "delete"
                  ? entry.kind
                  : "modified",
            },
          ]
        : undefined,
    }));
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("Completed approved operations:")) {
    return [];
  }
  const summaryLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  if (summaryLines.length === 0) {
    return [];
  }
  return summaryLines.map((line, index) => {
    const summary = line.slice(2).trim();
    const pathMatch = summary.match(
      /(?:wrote|created|updated|modified|deleted|removed|renamed)\s+(.+)$/i,
    );
    const filePath = (pathMatch?.[1] ?? "").trim();
    return {
      id: `${itemIdPrefix}-approval-${index + 1}`,
      kind: "tool",
      toolType: "fileChange",
      title: "Approved file change",
      detail: summary,
      status: "completed",
      output: summary,
      changes: filePath
        ? [{ path: filePath, kind: inferSyntheticApprovalChangeKind(summary) }]
        : undefined,
    } satisfies Extract<ConversationItem, { kind: "tool" }>;
  });
}

function shouldSkipSyntheticApprovalResumePrompt(
  role: "user" | "assistant",
  text: string,
) {
  if (role !== "user") {
    return false;
  }
  if (extractClaudeApprovalResumeEntries(text).length > 0) {
    return true;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (
    /Please continue from the current workspace state and finish the original task\.\s*$/i.test(
      trimmed,
    ) &&
    (trimmed.startsWith("Completed approved operations:") ||
      /^Approved and (?:wrote|updated|created|deleted|removed)\b/i.test(
        trimmed,
      ))
  ) {
    return true;
  }
  return false;
}

export function parseClaudeHistoryMessages(
  messagesData: unknown,
  workspacePath?: string | null,
): ConversationItem[] {
  const items: ConversationItem[] = [];
  const messageTimestampById = new Map<string, number>();
  const toolIndexById = new Map<string, number>();
  const pendingAskToolIds: string[] = [];
  const askTemplatesByToolId = new Map<string, AskUserQuestionTemplate[]>();

  const appendSubmittedAskUserInput = (
    toolId: string,
    parseResult: AskUserQuestionAnswerParseResult,
  ) => {
    const templates = askTemplatesByToolId.get(toolId) ?? [];
    if (templates.length === 0) {
      return;
    }
    const detail = JSON.stringify(
      buildRequestUserInputSubmittedPayload(templates, parseResult),
    );
    const submittedItemId = `request-user-input-submitted-${toolId}`;
    if (items.some((item) => item.id === submittedItemId)) {
      return;
    }
    items.push({
      id: submittedItemId,
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      title: i18n.t("approval.inputRequested"),
      detail,
      status: "completed",
      output: parseResult.rawSelectionText,
    });
  };

  const markAskToolCompleted = (toolId: string, output?: string) => {
    const index = toolIndexById.get(toolId);
    if (index === undefined) {
      return;
    }
    const existing = items[index];
    if (!existing || existing.kind !== "tool") {
      return;
    }
    items[index] = {
      ...existing,
      status: "completed",
      output: output || existing.output,
    };
  };

  const removePendingAskTool = (toolId: string) => {
    if (!toolId) {
      return;
    }
    const index = pendingAskToolIds.findIndex(
      (candidate) => candidate === toolId,
    );
    if (index >= 0) {
      pendingAskToolIds.splice(index, 1);
    }
  };

  const peekPendingAskTool = () => {
    while (pendingAskToolIds.length > 0) {
      const toolId = pendingAskToolIds[0] ?? "";
      if (!toolId || !askTemplatesByToolId.has(toolId)) {
        pendingAskToolIds.shift();
        continue;
      }
      return toolId;
    }
    return "";
  };

  const messages = Array.isArray(messagesData) ? messagesData : [];
  let suppressPollutedAssistantUntilNextUser = false;
  for (const rawMessage of messages) {
    const message = asRecord(rawMessage);
    if (!message) {
      continue;
    }
    const controlPlaneClassification =
      classifyClaudeControlPlaneMessage(message);
    if (controlPlaneClassification === "stream-json-stdin-payload") {
      suppressPollutedAssistantUntilNextUser = true;
      continue;
    }
    if (controlPlaneClassification) {
      continue;
    }
    const localControlClassification =
      classifyClaudeLocalControlMessage(message);
    if (localControlClassification.kind === "hidden") {
      continue;
    }
    if (localControlClassification.kind === "displayable") {
      items.push(
        buildClaudeControlEventItem(
          message,
          localControlClassification,
          items.length + 1,
        ),
      );
      continue;
    }
    const kind = asString(message.kind ?? "");
    if (kind === "message") {
      const role =
        getClaudeHistoryMessageRole(message) === "user" ? "user" : "assistant";
      if (suppressPollutedAssistantUntilNextUser && role === "assistant") {
        continue;
      }
      if (suppressPollutedAssistantUntilNextUser && role === "user") {
        suppressPollutedAssistantUntilNextUser = false;
      }
      const text = asString(message.text ?? "");
      if (shouldSkipSyntheticApprovalResumePrompt(role, text)) {
        continue;
      }
      const images = extractImageList(message.images);
      const deferredImages = extractDeferredClaudeImages(
        message.deferredImages,
        workspacePath,
      );
      const itemId = asString(
        message.id ?? `claude-message-${items.length + 1}`,
      );
      const timestampMs = parseHistoryTimestampMs(message.timestamp);
      const messageTurnId = extractTurnIdFromRawMessage(message);
      if (role === "user") {
        const pendingAskToolId = peekPendingAskTool();
        if (pendingAskToolId) {
          const templates = askTemplatesByToolId.get(pendingAskToolId) ?? [];
          const parsedAnswer = parseAskUserQuestionAnswerText(text, templates);
          if (parsedAnswer) {
            pendingAskToolIds.shift();
            markAskToolCompleted(
              pendingAskToolId,
              parsedAnswer.rawSelectionText,
            );
            appendSubmittedAskUserInput(pendingAskToolId, parsedAnswer);
            continue;
          }
        }
      }
      const assistantFinalFlag =
        role === "assistant"
          ? extractClaudeAssistantFinalFlag(message)
          : undefined;
      if (role === "assistant") {
        const syntheticApprovalItems = parseSyntheticApprovalResumeItems(
          text,
          itemId,
        );
        if (syntheticApprovalItems.length > 0) {
          items.push(...syntheticApprovalItems);
          continue;
        }
      }
      const normalizedMessageText =
        role === "assistant" ? stripClaudeApprovalResumeArtifacts(text) : text;
      if (
        !normalizedMessageText &&
        images.length === 0 &&
        deferredImages.length === 0
      ) {
        continue;
      }
      if (typeof timestampMs === "number") {
        messageTimestampById.set(itemId, timestampMs);
      }
      items.push({
        id: itemId,
        kind: "message",
        role,
        text: normalizedMessageText,
        ...(messageTurnId ? { turnId: messageTurnId } : {}),
        images: images.length > 0 ? images : undefined,
        deferredImages: deferredImages.length > 0 ? deferredImages : undefined,
        ...(typeof assistantFinalFlag === "boolean"
          ? { isFinal: assistantFinalFlag }
          : {}),
      });
      continue;
    }
    if (kind === "reasoning") {
      const text = asString(message.text ?? "");
      mergeReasoningSnapshot(
        items,
        asString(message.id ?? `claude-reasoning-${items.length + 1}`),
        text,
      );
      continue;
    }
    if (kind !== "tool") {
      continue;
    }

    const toolId = asString(message.id ?? "");
    const toolType = asString(
      message.toolType ?? message.tool_name ?? "unknown",
    );
    const isToolResult = toolType === "result" || toolType === "error";
    const status = toolType === "error" ? "failed" : "completed";
    if (isToolResult) {
      const sourceToolId = getClaudeSourceToolId(message);
      const sourceIndex = sourceToolId
        ? toolIndexById.get(sourceToolId)
        : toolId
          ? toolIndexById.get(toolId)
          : undefined;
      const outputText = getClaudeToolOutputText(message);
      if (sourceIndex !== undefined) {
        const existing = items[sourceIndex];
        if (existing?.kind === "tool") {
          items[sourceIndex] = {
            ...existing,
            status,
            output: outputText || existing.output,
          };
          if (
            isClaudeAskUserQuestionToolName(existing.toolType) ||
            isClaudeAskUserQuestionToolName(existing.title ?? "")
          ) {
            removePendingAskTool(existing.id);
            const templates = askTemplatesByToolId.get(existing.id) ?? [];
            const parsedAnswer = parseAskUserQuestionAnswerText(
              outputText,
              templates,
            );
            if (parsedAnswer) {
              appendSubmittedAskUserInput(existing.id, parsedAnswer);
            }
          }
        }
        continue;
      }
      const pendingToolIndex = findLatestPendingToolIndex(items);
      if (pendingToolIndex >= 0) {
        const existing = items[pendingToolIndex];
        if (existing?.kind === "tool") {
          items[pendingToolIndex] = {
            ...existing,
            status,
            output: outputText || existing.output,
          };
          continue;
        }
      }
      const fallbackId =
        sourceToolId || toolId || `claude-tool-${items.length + 1}`;
      items.push({
        id: fallbackId,
        kind: "tool",
        toolType,
        title: getClaudeToolName(message),
        detail: "",
        status,
        output: outputText,
      });
      continue;
    }

    const toolName = getClaudeToolName(message);
    const isAskUserQuestion =
      isClaudeAskUserQuestionToolName(toolName) ||
      isClaudeAskUserQuestionToolName(toolType);
    const resolvedToolId = toolId || `claude-tool-${items.length + 1}`;
    const parsedFileChange = inferClaudeFileChange(toolName, message);
    items.push({
      id: resolvedToolId,
      kind: "tool",
      toolType: parsedFileChange?.toolType ?? toolType,
      title: toolName,
      detail: getClaudeToolInputText(message) || asString(message.text ?? ""),
      status: "started",
      changes: parsedFileChange?.changes,
    });
    if (resolvedToolId) {
      toolIndexById.set(resolvedToolId, items.length - 1);
    }
    if (isAskUserQuestion) {
      pendingAskToolIds.push(resolvedToolId);
      askTemplatesByToolId.set(
        resolvedToolId,
        parseAskUserQuestionTemplates(getClaudeToolInputRecord(message)),
      );
    }
  }

  for (const pendingToolId of pendingAskToolIds) {
    const index = toolIndexById.get(pendingToolId);
    if (index === undefined) {
      continue;
    }
    const existing = items[index];
    if (!existing || existing.kind !== "tool") {
      continue;
    }
    if (existing.status === "completed" || existing.status === "failed") {
      continue;
    }
    // Incomplete Ask tools left at the tail after a hang/skip without tool_result
    // must not stay interactive. Mark failed so extractPendingUserInputQueue drops them.
    // (Native mid-turn asks that truly need answer are only live via realtime events.)
    const isTrailingIncomplete = index >= items.length - 1;
    items[index] = {
      ...existing,
      status: isTrailingIncomplete ? "failed" : "completed",
    };
  }

  markClaudeAssistantFinalMessages(items);
  hydrateClaudeAssistantFinalTiming(items, messageTimestampById);

  return items;
}

function extractPendingUserInputQueueFromClaudeItems(
  items: ConversationItem[],
  workspaceId: string,
  threadId: string,
): RequestUserInputRequest[] {
  const queue: RequestUserInputRequest[] = [];
  const seen = new Set<string>();
  // Durable evidence that the user already settled an ask in this thread history.
  const hasSubmittedAudit = items.some(
    (item) =>
      item.kind === "tool" && item.toolType === "requestUserInputSubmitted",
  );
  if (hasSubmittedAudit) {
    // Prefer not to rehydrate any interactive card once a submit/skip audit exists.
    // Live incomplete asks still arrive via realtime events, not history reopen.
    return queue;
  }

  for (const item of items) {
    if (item.kind !== "tool") {
      continue;
    }
    if (!isClaudeAskUserQuestionToolName(item.toolType ?? "")) {
      // Title may still carry mcp__ccgui__AskUserQuestion when toolType was normalized.
      if (!isClaudeAskUserQuestionToolName(item.title ?? "")) {
        continue;
      }
    }
    if (item.status === "completed" || item.status === "failed") {
      continue;
    }
    // MCP bridge asks cannot be answered after reopen (request_id identity mismatch).
    // Only native AskUserQuestion may rehydrate into the interactive queue.
    const toolLabel = `${item.toolType ?? ""} ${item.title ?? ""}`;
    if (
      !isNativeClaudeAskUserQuestionToolName(item.toolType ?? "") &&
      !isNativeClaudeAskUserQuestionToolName(item.title ?? "") &&
      (toolLabel.toLowerCase().includes("mcp") ||
        toolLabel.toLowerCase().includes("ccgui"))
    ) {
      continue;
    }
    const templates = parseAskUserQuestionTemplates(
      parseToolRecordCandidate(item.detail),
    );
    if (templates.length === 0) {
      continue;
    }
    const requestId = item.id.trim() || `claude-ask-${queue.length + 1}`;
    const dedupeKey = `${workspaceId}:${requestId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    queue.push({
      workspace_id: workspaceId,
      request_id: requestId,
      params: {
        thread_id: threadId,
        turn_id: "",
        item_id: item.id.trim() || `request-${requestId}`,
        questions: templates.map((template, index) => ({
          id: template.id || `q-${index}`,
          header: template.header,
          question: template.question,
          isOther: template.isOther,
          isSecret: false,
          ...(template.multiSelect ? { multiSelect: true } : {}),
          options: template.options,
        })),
      },
    });
  }

  return queue;
}

function isShadowRecoveryTurnBoundaryUser(item: ConversationItem) {
  return (
    item.kind === "message" &&
    item.role === "user" &&
    !isCliInjectedAgentTaskNotificationText(item.text)
  );
}

function isEquivalentShadowAssistantText(existingText: string, shadowText: string) {
  const normalizedExisting = existingText.trim();
  const normalizedShadow = shadowText.trim();
  if (!normalizedExisting || !normalizedShadow) {
    return false;
  }
  return (
    normalizedShadow === normalizedExisting ||
    normalizedShadow.startsWith(normalizedExisting) ||
    normalizedExisting.startsWith(normalizedShadow)
  );
}

function findExistingAssistantEquivalentToShadow(
  items: ConversationItem[],
  shadowText: string,
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "message" || item.role !== "assistant") {
      continue;
    }
    if (isEquivalentShadowAssistantText(item.text, shadowText)) {
      return { index, item };
    }
  }
  return null;
}

function findLastAssistantAfterLastUser(items: ConversationItem[]) {
  let lastUserIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item && isShadowRecoveryTurnBoundaryUser(item)) {
      lastUserIndex = index;
    }
  }
  if (lastUserIndex < 0) {
    return null;
  }
  for (let index = items.length - 1; index > lastUserIndex; index -= 1) {
    const item = items[index];
    if (item?.kind === "message" && item.role === "assistant") {
      return { index, item };
    }
  }
  return null;
}

function isLikelySameTurnForRecovery(
  item: MessageItemWithTurn,
  expectedTurnId: string | null,
  shadowTurnId: string | null,
) {
  if (!expectedTurnId || !item.turnId || !shadowTurnId) {
    return true;
  }
  return item.turnId === expectedTurnId && item.turnId === shadowTurnId;
}

function buildRecoveredAssistantFromShadow(shadow: {
  id: string;
  text: string;
  turnId: string | null;
  itemId: string;
}) {
  return {
    id: `claude-shadow-recovered-${shadow.itemId}`,
    kind: "message" as const,
    role: "assistant" as const,
    text: shadow.text,
    ...(shadow.turnId ? { turnId: shadow.turnId } : {}),
    isFinal: false,
    recoveredFromLiveShadow: true,
    recoveryStatus: "interrupted" as const,
    recoverySourceId: shadow.id,
    engineSource: "claude" as const,
  };
}

function appendRecoveredAssistantUnlessDuplicate({
  items,
  shadow,
  expectedTurnId,
  hasExplicitFinalAfterLastUser,
}: {
  items: ConversationItem[];
  shadow: {
    id: string;
    text: string;
    turnId: string | null;
    itemId: string;
  };
  expectedTurnId: string | null;
  hasExplicitFinalAfterLastUser: boolean;
}) {
  const equivalent = findExistingAssistantEquivalentToShadow(items, shadow.text);
  if (!equivalent) {
    return [...items, buildRecoveredAssistantFromShadow(shadow)];
  }

  const latest = equivalent.item as MessageItemWithTurn;
  const normalizedLatestText = latest.text.trim();
  if (latest.isFinal === true && hasExplicitFinalAfterLastUser) {
    return items;
  }
  const sameTurn = isLikelySameTurnForRecovery(
    latest,
    expectedTurnId,
    shadow.turnId,
  );
  const normalizedShadowText = shadow.text.trim();
  if (
    sameTurn &&
    normalizedShadowText.startsWith(normalizedLatestText) &&
    normalizedShadowText.length > normalizedLatestText.length
  ) {
    const merged = items.slice();
    merged[equivalent.index] = {
      ...latest,
      text: shadow.text,
      isFinal: false,
      recoveredFromLiveShadow: true,
      recoveryStatus: "interrupted" as const,
      recoverySourceId: shadow.id,
      engineSource: "claude" as const,
      ...(shadow.turnId ? { turnId: shadow.turnId } : {}),
    };
    return merged;
  }
  return items;
}

function recoverClaudeAssistantFromShadowIfNeeded({
  items,
  shadow,
  expectedTurnId,
  hasExplicitFinalAfterLastUser,
}: {
  items: ConversationItem[];
  shadow: {
    id: string;
    text: string;
    turnId: string | null;
    itemId: string;
  };
  expectedTurnId: string | null;
  hasExplicitFinalAfterLastUser: boolean;
}) {
  const normalizedShadowText = shadow.text.trim();
  if (normalizedShadowText.length === 0) {
    return items;
  }

  const trailingAssistant = findLastAssistantAfterLastUser(items);
  if (!trailingAssistant) {
    return appendRecoveredAssistantUnlessDuplicate({
      items,
      shadow,
      expectedTurnId,
      hasExplicitFinalAfterLastUser,
    });
  }

  const latest = trailingAssistant.item as MessageItemWithTurn;
  const normalizedLatestText = latest.text.trim();
  if (!normalizedLatestText) {
    return appendRecoveredAssistantUnlessDuplicate({
      items,
      shadow,
      expectedTurnId,
      hasExplicitFinalAfterLastUser,
    });
  }

  const sameTurn = isLikelySameTurnForRecovery(
    latest,
    expectedTurnId,
    shadow.turnId,
  );

  if (latest.isFinal === true && hasExplicitFinalAfterLastUser) {
    return items;
  }

  const isPrefixMatch = normalizedShadowText.startsWith(normalizedLatestText);

  if (sameTurn && isPrefixMatch) {
    if (normalizedShadowText.length > normalizedLatestText.length) {
      const merged = items.slice();
      merged[trailingAssistant.index] = {
        ...latest,
        text: shadow.text,
        isFinal: false,
        recoveredFromLiveShadow: true,
        recoveryStatus: "interrupted" as const,
        recoverySourceId: shadow.id,
        engineSource: "claude" as const,
        ...(shadow.turnId ? { turnId: shadow.turnId } : {}),
      };
      return merged;
    }
    return items;
  }

  return items;
}

function deriveLatestTurnIdFromItems(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const turnId = asString((item as { turnId?: string | null }).turnId).trim();
    if (turnId) {
      return turnId;
    }
  }
  return null;
}

function deriveLatestTurnIdFromRawMessages(messagesData: unknown) {
  const messages = Array.isArray(messagesData) ? messagesData : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const turnId = extractTurnIdFromRawMessage(message);
    if (turnId) {
      return turnId;
    }
  }
  return null;
}

function resolveExpectedShadowTurnId(
  items: ConversationItem[],
  messagesData: unknown,
): string | null {
  const rawTurnId = deriveLatestTurnIdFromRawMessages(messagesData);
  if (rawTurnId) {
    return rawTurnId;
  }
  return deriveLatestTurnIdFromItems(items);
}

function hasExplicitFinalAssistantAfterLastUser(messagesData: unknown) {
  const messages = Array.isArray(messagesData) ? messagesData : [];
  let lastUserIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const kind = asString(message.kind ?? "");
    if (kind !== "message") {
      continue;
    }
    const role = asString(message.role ?? "") === "user" ? "user" : "assistant";
    if (
      role === "user" &&
      !isCliInjectedAgentTaskNotificationText(asString(message.text ?? ""))
    ) {
      lastUserIndex = index;
    }
  }
  if (lastUserIndex < 0) {
    return false;
  }

  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const kind = asString(message.kind ?? "");
    if (kind !== "message") {
      continue;
    }
    const role = asString(message.role ?? "") === "user" ? "user" : "assistant";
    if (role !== "assistant") {
      continue;
    }
    if (extractClaudeAssistantFinalFlag(message) === true) {
      return true;
    }
  }
  return false;
}

export function recoverClaudeInterruptedAssistantFromShadow({
  items,
  workspaceId,
  threadId,
  sessionId,
  expectedTurnId,
  hasExplicitFinalAfterLastUser,
}: {
  items: ConversationItem[];
  workspaceId: string;
  threadId: string;
  sessionId: string;
  expectedTurnId?: string | null;
  hasExplicitFinalAfterLastUser?: boolean;
}) {
  const resolvedExpectedTurnId = expectedTurnId?.trim() || null;
  const lookupTurnId =
    resolvedExpectedTurnId || deriveLatestTurnIdFromItems(items);
  const unsettledShadow = findLiveAssistantShadowTranscriptForRestore({
    workspaceId,
    threadId,
    sessionId,
    requireUnsettled: true,
    expectedTurnId: lookupTurnId,
  });

  const shadow =
    unsettledShadow ??
    findLiveAssistantShadowTranscriptForRestore({
      workspaceId,
      threadId,
      sessionId,
      requireUnsettled: false,
      ...(lookupTurnId ? { expectedTurnId: lookupTurnId } : {}),
    });

  if (!shadow) {
    return items;
  }

  const recoveredItems = recoverClaudeAssistantFromShadowIfNeeded({
    items,
    shadow: {
      id: shadow.id,
      text: shadow.text,
      turnId: shadow.turnId,
      itemId: shadow.itemId,
    },
    expectedTurnId: lookupTurnId,
    hasExplicitFinalAfterLastUser: hasExplicitFinalAfterLastUser === true,
  });
  const recoveredAssistant = recoveredItems.find(
    (item): item is Extract<ConversationItem, { kind: "message" }> =>
      item.kind === "message" &&
      item.role === "assistant" &&
      item.recoveredFromLiveShadow === true &&
      item.recoverySourceId === shadow.id,
  );
  if (recoveredAssistant) {
    noteThreadRecoverySourceObserved(threadId, {
      source: "live-shadow",
      sourceId: shadow.id,
      itemId: recoveredAssistant.id,
      textLength: recoveredAssistant.text.length,
    });
  }
  return recoveredItems;
}

function normalizeShadowRecoverySessionId(
  threadId: string,
  sessionId?: string | null,
) {
  const candidate = sessionId?.trim();
  if (candidate) {
    return candidate;
  }
  const threadPrefix = threadId.startsWith("claude:")
    ? threadId.slice("claude:".length)
    : threadId;
  return threadPrefix.trim();
}

export function parseClaudeHistoryMessagesWithShadowRecovery({
  messagesData,
  workspaceId,
  threadId,
  sessionId,
  workspacePath,
}: {
  messagesData: unknown;
  workspaceId: string;
  threadId: string;
  sessionId?: string | null;
  workspacePath?: string | null;
}): ConversationItem[] {
  const parsedItems = parseClaudeHistoryMessages(messagesData, workspacePath);
  return recoverClaudeInterruptedAssistantFromShadow({
    items: parsedItems,
    workspaceId,
    threadId,
    sessionId: normalizeShadowRecoverySessionId(threadId, sessionId),
    expectedTurnId: resolveExpectedShadowTurnId(parsedItems, messagesData),
    hasExplicitFinalAfterLastUser:
      hasExplicitFinalAssistantAfterLastUser(messagesData),
  });
}

export function extractClaudeHistoryTokenUsage(
  result: unknown,
): ThreadTokenUsage | null {
  const usage = asRecord(asRecord(result)?.usage);
  if (!usage) {
    return null;
  }
  const inputTokens = asFiniteNonNegativeNumber(usage.inputTokens);
  const outputTokens = asFiniteNonNegativeNumber(usage.outputTokens);
  if (inputTokens <= 0 && outputTokens <= 0) {
    return null;
  }
  const cachedInputTokens =
    asFiniteNonNegativeNumber(usage.cacheCreationInputTokens) +
    asFiniteNonNegativeNumber(usage.cacheReadInputTokens);
  const breakdown = {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningOutputTokens: 0,
  };
  return {
    total: breakdown,
    last: breakdown,
    modelContextWindow: null,
    contextUsageSource: "claude_history",
    contextUsageFreshness: "estimated",
  };
}

export function createClaudeHistoryLoader({
  workspaceId,
  workspacePath,
  loadClaudeSession,
  onProgress,
}: ClaudeHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "claude",
    async load(threadId: string) {
      const sessionId = threadId.startsWith("claude:")
        ? threadId.slice("claude:".length)
        : threadId;
      if (!workspacePath) {
        return normalizeHistorySnapshot({
          engine: "claude",
          workspaceId,
          threadId,
          meta: {
            workspaceId,
            threadId,
            engine: "claude",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        });
      }
      const staged = await runNativeHistoryFetchAndParse({
        report: (progress) => {
          onProgress?.(progress);
        },
        shouldContinue: () => true,
        load: () =>
          loadClaudeSession(workspacePath, sessionId, {
            limit: CLAUDE_UI_HISTORY_WINDOW,
          }),
        extractMessages: (payload) =>
          (payload as { messages?: unknown } | null)?.messages ?? payload,
        parse: (messagesData) =>
          parseClaudeHistoryMessagesWithShadowRecovery({
            messagesData,
            workspacePath,
            workspaceId,
            threadId,
            sessionId,
          }),
      });
      const result = staged?.result ?? null;
      const parsedItems = staged?.items ?? [];
      const record = (result ?? {}) as {
        messages?: unknown;
        hasMore?: boolean;
        nextCursor?: string | null;
      };
      const userInputQueue = extractPendingUserInputQueueFromClaudeItems(
        parsedItems,
        workspaceId,
        threadId,
      );
      return normalizeHistorySnapshot({
        engine: "claude",
        workspaceId,
        threadId,
        items: parsedItems,
        plan: null,
        userInputQueue,
        tokenUsage: extractClaudeHistoryTokenUsage(result),
        meta: {
          workspaceId,
          threadId,
          engine: "claude",
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
          historyHasMore: record.hasMore === true,
          historyNextCursor: record.nextCursor ?? null,
        },
      });
    },
  };
}
