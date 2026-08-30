import { useTranslation } from "react-i18next";
import type { ConversationItem } from "../../../../types";
import { formatTokenCount } from "../../utils/messagesRenderUtils";

type ContextEventItem = Extract<ConversationItem, { kind: "context-event" }>;

/**
 * 引擎侧上下文事件留痕（如压缩完成）的独立系统行。
 *
 * 不是模型说的话：绝不渲染为 assistant 气泡，也不参与极简折叠 /
 * finality 锚点（ConversationItem 的既有谓词按 kind 天然排除）。
 * 默认模式与极简模式同形态：居中弱化分隔行。
 */
export function ContextEventRow({ item }: { item: ContextEventItem }) {
  const { t } = useTranslation();
  const labelKey =
    item.reason === "manual"
      ? "threads.contextCompactedManual"
      : item.reason === "threshold" || item.reason === "overflow"
        ? "threads.contextCompactedAuto"
        : "threads.contextCompactedNeutral";
  const label = t(labelKey);
  const resolvedLabel = label === labelKey ? "上下文已压缩" : label;
  const hasTokenDelta =
    item.tokensBefore != null &&
    item.estimatedTokensAfter != null &&
    item.tokensBefore > 0;
  return (
    <div
      className="context-event-row"
      data-context-event-type={item.eventType}
      data-compaction-reason={item.reason ?? undefined}
    >
      <span className="context-event-rule" aria-hidden />
      <span className="context-event-label">
        {resolvedLabel}
        {hasTokenDelta && item.tokensBefore != null && item.estimatedTokensAfter != null ? (
          <em className="context-event-tokens">
            {" "}
            · {formatTokenCount(item.tokensBefore)} →{" "}
            {formatTokenCount(item.estimatedTokensAfter)} tokens
          </em>
        ) : null}
      </span>
      <span className="context-event-rule" aria-hidden />
    </div>
  );
}
