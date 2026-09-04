import i18n from "../../../i18n";
import type { ConversationItem } from "../../../types";
import { asString } from "./historyLoaderUtils";
import {
  asRecord,
  booleanField,
  parseJsonRecordFromText,
  recordContainsKey,
  recordContainsString,
  stripAnsiEscapeSequences,
  unwrapTaggedText,
} from "./claudeHistoryPrimitives";

export type ClaudeLocalControlEventType =
  "resumeFailed" | "modelChanged" | "interrupted" | "localCommandOutput";

export type ClaudeLocalControlClassification =
  | { kind: "normal" }
  | {
      kind: "hidden";
      reason:
        | "control-plane"
        | "synthetic-runtime"
        | "internal-record"
        | "quarantine";
    }
  | {
      kind: "displayable";
      eventType: ClaudeLocalControlEventType;
      detail: string;
    };

export type ClaudeControlPlaneClassification =
  "control-plane" | "stream-json-stdin-payload" | null;

export const CLAUDE_CONTROL_EVENT_TOOL_TYPE = "claudeControlEvent";

export function isCcguiClientInfo(value: unknown) {
  const record = asRecord(value);
  const clientInfo = asRecord(record?.clientInfo);
  if (!clientInfo) {
    return false;
  }
  return ["name", "title"].some(
    (key) => asString(clientInfo[key]).toLowerCase() === "ccgui",
  );
}

export function hasExperimentalApiCapability(value: unknown) {
  const record = asRecord(value);
  const capabilities = asRecord(record?.capabilities);
  return capabilities?.experimentalApi === true;
}

export function isCodexAppServerControlPlaneText(text: string) {
  const trimmed = text.trim();
  if (trimmed === "app-server" || trimmed.includes("developer_instructions=")) {
    return true;
  }

  const [command, subcommand] = trimmed.split(/\s+/);
  return isCodexCommandToken(command) && subcommand === "app-server";
}

export function isCodexCommandToken(token: string | undefined) {
  if (!token) {
    return false;
  }
  const command = token
    .replace(/^['"]|['"]$/g, "")
    .split(/[\\/]/)
    .pop();
  return (
    command === "codex" ||
    command === "codex.exe" ||
    command === "codex.cmd" ||
    command === "codex.bat"
  );
}

export function isClaudeStreamJsonStdinPayloadText(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  const payload = parseJsonRecordFromText(trimmed);
  if (!payload || asString(payload.type) !== "user") {
    return false;
  }
  const message = asRecord(payload.message);
  if (!message || asString(message.role) !== "user") {
    return false;
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    const blockType = asString(asRecord(block)?.type);
    return (
      blockType === "text" ||
      blockType === "image" ||
      blockType === "image_url" ||
      blockType === "input_text" ||
      blockType === "input_image"
    );
  });
}

export function extractTextFromClaudeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  for (const block of content) {
    const record = asRecord(block);
    if (asString(record?.type) !== "text") {
      continue;
    }
    const text = asString(record?.text).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export function getClaudeHistoryMessageRole(
  message: Record<string, unknown>,
): "user" | "assistant" | "" {
  const nestedMessage = asRecord(message.message);
  const role = asString(message.role ?? nestedMessage?.role);
  return role === "user" || role === "assistant" ? role : "";
}

export function classifyClaudeControlPlaneMessage(
  message: Record<string, unknown>,
): ClaudeControlPlaneClassification {
  const nestedMessage = asRecord(message.message);
  const text =
    asString(message.text ?? "") ||
    extractTextFromClaudeContent(nestedMessage?.content);
  if (isClaudeStreamJsonStdinPayloadText(text)) {
    return "stream-json-stdin-payload";
  }

  const method = asString(message.method);
  if (method === "initialize") {
    return "control-plane";
  }

  const params = message.params ?? message.payload;
  if (isCcguiClientInfo(params) && hasExperimentalApiCapability(params)) {
    return "control-plane";
  }

  if (
    recordContainsKey(message, "developer_instructions") ||
    recordContainsString(message, "developer_instructions=")
  ) {
    return "control-plane";
  }

  return isCodexAppServerControlPlaneText(text) ? "control-plane" : null;
}

export function sanitizeClaudeLocalControlText(text: string) {
  let cleaned = text.trim();
  for (const tag of [
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-stderr",
    "local-command-caveat",
  ]) {
    const unwrapped = unwrapTaggedText(cleaned, tag);
    if (unwrapped !== null) {
      cleaned = unwrapped;
      break;
    }
  }
  return stripAnsiEscapeSequences(cleaned).trim();
}

export const COMMAND_ARGS_CONTENT_REGEX = /<command-args>([\s\S]*?)<\/command-args>/i;

export function hasNonEmptyCommandArgs(text: string) {
  return Boolean(COMMAND_ARGS_CONTENT_REGEX.exec(text)?.[1]?.trim());
}

export function extractTurnIdFromRawMessage(rawMessage: Record<string, unknown>) {
  const turn = asRecord(rawMessage.turn);
  return asString(
    rawMessage.turnId ??
      rawMessage.turn_id ??
      turn?.id ??
      turn?.turnId ??
      turn?.turn_id ??
      "",
  ).trim();
}

export function isSyntheticContinuationSummaryText(text: string) {
  const trimmed = text.trim();
  return (
    trimmed.startsWith(
      "This session is being continued from a previous conversation that ran out of context.",
    ) &&
    trimmed.includes("Summary:") &&
    trimmed.includes("Primary Request and Intent")
  );
}

export function hasSyntheticContinuationTypeMarker(
  record: Record<string, unknown> | null,
) {
  const marker = asString(
    record?.type ?? record?.subtype ?? record?.event ?? record?.kind,
  ).trim();
  return [
    "summary",
    "synthetic_summary",
    "synthetic-runtime",
    "synthetic_runtime",
    "continuation_summary",
    "compaction_summary",
    "resume_summary",
  ].includes(marker);
}

export function hasSyntheticContinuationProvenance(
  message: Record<string, unknown>,
  nestedMessage: Record<string, unknown> | null,
) {
  return (
    booleanField(message, "isMeta") ||
    booleanField(nestedMessage, "isMeta") ||
    booleanField(message, "isSynthetic") ||
    booleanField(nestedMessage, "isSynthetic") ||
    booleanField(message, "isVisibleInTranscriptOnly") ||
    booleanField(nestedMessage, "isVisibleInTranscriptOnly") ||
    booleanField(message, "isCompactSummary") ||
    booleanField(nestedMessage, "isCompactSummary") ||
    asString(message.model ?? nestedMessage?.model) === "<synthetic>" ||
    hasSyntheticContinuationTypeMarker(message) ||
    hasSyntheticContinuationTypeMarker(nestedMessage)
  );
}

export function getNestedString(record: Record<string, unknown>, key: string) {
  return asString(
    record[key] ??
      asRecord(record.tool_input)?.[key] ??
      asRecord(record.toolInput)?.[key],
  );
}

export function getClaudeControlEventTitle(eventType: ClaudeLocalControlEventType) {
  switch (eventType) {
    case "resumeFailed":
      return i18n.t("tools.claudeControlResumeFailed");
    case "modelChanged":
      return i18n.t("tools.claudeControlModelChanged");
    case "interrupted":
      return i18n.t("tools.claudeControlInterrupted");
    case "localCommandOutput":
      return i18n.t("tools.claudeControlLocalOutput");
  }
}

export function classifyClaudeLocalControlMessage(
  message: Record<string, unknown>,
): ClaudeLocalControlClassification {
  const explicitToolType = asString(message.toolType ?? message.tool_type);
  if (explicitToolType === CLAUDE_CONTROL_EVENT_TOOL_TYPE) {
    const rawEventType = getNestedString(message, "eventType");
    const eventType: ClaudeLocalControlEventType =
      rawEventType === "resumeFailed" ||
      rawEventType === "modelChanged" ||
      rawEventType === "interrupted" ||
      rawEventType === "localCommandOutput"
        ? rawEventType
        : "localCommandOutput";
    const detail =
      sanitizeClaudeLocalControlText(
        asString(
          message.text ??
            asRecord(message.tool_output)?.detail ??
            asRecord(message.toolOutput)?.detail ??
            "",
        ),
      ) || getClaudeControlEventTitle(eventType);
    return { kind: "displayable", eventType, detail };
  }

  const nestedMessage = asRecord(message.message);
  if (
    (message.type === "system" && message.subtype === "local_command") ||
    (nestedMessage?.type === "system" &&
      nestedMessage.subtype === "local_command")
  ) {
    return { kind: "hidden", reason: "internal-record" };
  }

  const rowType = asString(
    message.type ??
      message.subtype ??
      message.event ??
      nestedMessage?.type ??
      nestedMessage?.subtype ??
      nestedMessage?.event,
  );
  if (
    [
      "permission-mode",
      "file-history-snapshot",
      "last-prompt",
      "queue-operation",
      "attachment",
      "mcp_instructions_delta",
      "skill_listing",
      "stop_hook_summary",
      "turn_duration",
      "local_command",
    ].includes(rowType)
  ) {
    return { kind: "hidden", reason: "internal-record" };
  }

  const text =
    asString(message.text ?? "") ||
    extractTextFromClaudeContent(nestedMessage?.content);
  const role =
    asString(message.role ?? nestedMessage?.role) === "user"
      ? "user"
      : "assistant";
  const sanitized = sanitizeClaudeLocalControlText(text);
  if (
    role === "assistant" &&
    asString(message.model ?? "") === "<synthetic>" &&
    sanitized === "No response requested."
  ) {
    return { kind: "hidden", reason: "synthetic-runtime" };
  }
  if (
    role === "user" &&
    isSyntheticContinuationSummaryText(text) &&
    hasSyntheticContinuationProvenance(message, nestedMessage)
  ) {
    return { kind: "hidden", reason: "synthetic-runtime" };
  }
  if (text.trim() === "[Request interrupted by user]") {
    return { kind: "displayable", eventType: "interrupted", detail: sanitized };
  }
  if (
    text.trim().startsWith("<command-name>") ||
    text.trim().startsWith("<command-message>") ||
    text.trim().startsWith("<command-args>") ||
    text.trim().startsWith("<local-command-caveat>")
  ) {
    // 带非空 <command-args> 的斜杠命令记录是用户的真实提问(如 GUI 技能命令
    // /aimax:code-review),必须走普通消息路径,由展示层的
    // extractCommandMessageDisplayText 还原为纯文本;无参数的控制命令
    // (/resume、/clear 等)才是内部噪声,维持隐藏。
    if (role === "user" && hasNonEmptyCommandArgs(text)) {
      return { kind: "normal" };
    }
    return { kind: "hidden", reason: "internal-record" };
  }
  if (
    sanitized.includes(
      "Caveat: The messages below were generated by the user while running local commands",
    ) ||
    sanitized.includes("Warmup")
  ) {
    return { kind: "hidden", reason: "internal-record" };
  }
  if (
    text.trim().startsWith("<local-command-stdout>") ||
    text.trim().startsWith("<local-command-stderr>")
  ) {
    const lower = sanitized.toLowerCase();
    if (lower.includes("session ") && lower.includes(" was not found")) {
      return {
        kind: "displayable",
        eventType: "resumeFailed",
        detail: sanitized,
      };
    }
    if (lower.startsWith("set model to ") || lower.includes(" set model to ")) {
      return {
        kind: "displayable",
        eventType: "modelChanged",
        detail: sanitized,
      };
    }
    if (sanitized.length <= 240) {
      return {
        kind: "displayable",
        eventType: "localCommandOutput",
        detail: sanitized,
      };
    }
    return { kind: "hidden", reason: "internal-record" };
  }
  return { kind: "normal" };
}

export function buildClaudeControlEventItem(
  message: Record<string, unknown>,
  classification: Extract<
    ClaudeLocalControlClassification,
    { kind: "displayable" }
  >,
  fallbackIndex: number,
): Extract<ConversationItem, { kind: "tool" }> {
  const itemId = asString(
    message.id ?? `claude-control-event-${fallbackIndex}`,
  );
  return {
    id: itemId || `claude-control-event-${fallbackIndex}`,
    kind: "tool",
    toolType: CLAUDE_CONTROL_EVENT_TOOL_TYPE,
    title: getClaudeControlEventTitle(classification.eventType),
    detail: JSON.stringify({
      eventType: classification.eventType,
      source: "claude-history",
      detail: classification.detail,
    }),
    status:
      classification.eventType === "resumeFailed" ? "failed" : "completed",
    output: classification.detail,
  };
}

