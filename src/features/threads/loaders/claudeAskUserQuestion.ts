import { asRecord, parseJsonRecordFromText } from "./claudeHistoryPrimitives";
import { asString } from "./historyLoaderUtils";

export type AskUserQuestionOption = {
  label: string;
  description: string;
};

export type AskUserQuestionTemplate = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  multiSelect: boolean;
  options?: AskUserQuestionOption[];
};

export type AskUserQuestionAnswer = {
  selectedOptions: string[];
  note: string;
};

export type AskUserQuestionAnswerParseResult = {
  rawSelectionText: string;
  answers: AskUserQuestionAnswer[];
  answersByQuestionId: Record<string, AskUserQuestionAnswer>;
};

export const ASK_USER_QUESTION_DISMISSED_TEXT_REGEX =
  /^The user dismissed the question without selecting an option\.?$/i;
export const ASK_USER_QUESTION_SKIPPED_TEXT_REGEX =
  /^The user skipped this AskUserQuestion without selecting an option\.\s*Do not ask the same question again;\s*continue the original task using the available context and reasonable assumptions\.?$/i;
export const ASK_USER_QUESTION_PARTIAL_SKIP_TEXT_REGEX =
  /^The user answered the AskUserQuestion[:：]\s*([\s\S]*?)[。.]?\s*The user skipped \d+ remaining question\(s\) without selecting an option\.\s*Do not ask the skipped question\(s\) again;\s*continue the original task using the available context and reasonable assumptions\.?$/i;
export const ASK_USER_QUESTION_RESULT_BASE64_REGEX =
  /\bAskUserQuestionResultBase64:([A-Za-z0-9+/=]+)/;

export type RequestUserInputSubmittedPayload = {
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

export function parseAskUserQuestionTemplates(
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

export function parseAskUserAnswerParts(raw: string): AskUserQuestionAnswer {
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

export function decodeBase64JsonRecord(
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

export function parseStructuredAnswerResult(
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

export function parseAskUserAnswerSegments(
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

export function parseAskUserQuestionAnswerText(
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

export function buildRequestUserInputSubmittedPayload(
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

export function normalizeClaudeToolName(toolName: string) {
  return toolName.trim().toLowerCase();
}

/** Native AskUserQuestion or MCP bridge (`mcp__ccgui__AskUserQuestion`). */
export function isClaudeAskUserQuestionToolName(toolName: string) {
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
export function isNativeClaudeAskUserQuestionToolName(toolName: string) {
  const normalized = normalizeClaudeToolName(toolName);
  return (
    normalized === "askuserquestion" || normalized === "ask_user_question"
  );
}
