/**
 * emptyReason → 幕布时间线可感文案（不堵发送；不再用全局 toast）。
 */
import { MEMORY_PICK_STATUS_PREFIX } from "../utils/memoryMarkers";
import type { MemoryRetrieveEmptyReason } from "./memoryPickTypes";

export type MemoryPickEmptyNoticeCopy = {
  title: string;
  timeout: string;
  no_match: string;
  error: string;
  no_query_terms: string;
};

export const DEFAULT_MEMORY_PICK_EMPTY_NOTICE_COPY: MemoryPickEmptyNoticeCopy = {
  title: "记忆参考",
  timeout: "记忆检索超时，已按原文发送（未注入记忆）",
  no_match: "未找到相关记忆，已按原文发送",
  error: "记忆检索失败，已按原文发送",
  no_query_terms: "当前输入缺少可检索关键词，已按原文发送",
};

/** @deprecated 使用 DEFAULT_MEMORY_PICK_EMPTY_NOTICE_COPY */


/**
 * 将 emptyReason 解析为时间线展示正文；ok 返回 null。
 */
export function resolveMemoryPickEmptyNoticeMessage(
  emptyReason: MemoryRetrieveEmptyReason,
  options?: {
    /** no_query_terms 默认展示；false 则跳过 */
    includeNoQueryTerms?: boolean;
    copy?: Partial<MemoryPickEmptyNoticeCopy>;
  },
): string | null {
  if (emptyReason === "ok") return null;

  const copy = {
    ...DEFAULT_MEMORY_PICK_EMPTY_NOTICE_COPY,
    ...options?.copy,
  };

  if (emptyReason === "no_query_terms") {
    if (options?.includeNoQueryTerms === false) return null;
    return copy.no_query_terms;
  }
  if (emptyReason === "no_match") return copy.no_match;
  if (emptyReason === "timeout") return copy.timeout;
  return copy.error;
}

/**
 * 时间线 status 正文（供 MEMORY_PICK_STATUS_PREFIX 拼接）。
 */
export function buildMemoryPickEmptyTimelinePreview(
  emptyReason: MemoryRetrieveEmptyReason,
  options?: {
    includeNoQueryTerms?: boolean;
    copy?: Partial<MemoryPickEmptyNoticeCopy>;
  },
): { reason: MemoryRetrieveEmptyReason; title: string; message: string } | null {
  const message = resolveMemoryPickEmptyNoticeMessage(emptyReason, options);
  if (!message) return null;
  const copy = {
    ...DEFAULT_MEMORY_PICK_EMPTY_NOTICE_COPY,
    ...options?.copy,
  };
  return { reason: emptyReason, title: copy.title, message };
}

/** 完整时间线 item.text（含前缀） */
export function formatMemoryPickEmptyTimelineItemText(
  emptyReason: MemoryRetrieveEmptyReason,
  options?: {
    includeNoQueryTerms?: boolean;
    copy?: Partial<MemoryPickEmptyNoticeCopy>;
  },
): string | null {
  const preview = buildMemoryPickEmptyTimelinePreview(emptyReason, options);
  if (!preview) return null;
  return [
    MEMORY_PICK_STATUS_PREFIX,
    preview.reason,
    preview.title,
    preview.message,
  ].join("\n");
}

/**
 * @deprecated 全局 toast 已废弃；保留调用方迁移期兼容（直接返回 null，不再弹 toast）。
 */
export function toastMemoryPickEmptyReason(
  emptyReason: MemoryRetrieveEmptyReason,
  options?: {
    toastNoQueryTerms?: boolean;
    copy?: Partial<MemoryPickEmptyNoticeCopy>;
  },
): string | null {
  void emptyReason;
  void options;
  return null;
}
