import { useMemo } from "react";
import type {
  ConversationItem,
  EngineType,
  ThreadTokenUsage,
} from "../../../../../types";
import type {
  ClaudeContextUsageViewModel,
  CodexCompactionSource,
} from "../../ChatInputBox/types";
import { isSharedSessionThreadId } from "../../../../shared-session/utils/sharedSessionIdentity";
import { estimateClaudeContextWindow } from "../../../../models/claudeContextWindow";
import { resolveDualContextUsageModel } from "../../../../context-ledger/utils/contextLedgerProjection";
import {
  finiteNonNegative,
  finitePositive,
  resolveClaudeWindowUsedTokens,
} from "../utils";

export interface UseContextUsageProjectionOptions {
  contextUsage: ThreadTokenUsage | null;
  selectedEngine: EngineType | undefined;
  activeThreadId: string | null;
  items: ConversationItem[];
  selectedModelId: string | null;
  isContextCompacting: boolean;
  codexCompactionLifecycleState: "idle" | "compacting" | "completed";
  codexCompactionSource: CodexCompactionSource | null;
  codexCompactionCompletedAt: number | null;
  lastTokenUsageUpdatedAt: number | null;
}

export function useContextUsageProjection({
  contextUsage,
  selectedEngine,
  activeThreadId,
  items,
  selectedModelId,
  isContextCompacting,
  codexCompactionLifecycleState,
  codexCompactionSource,
  codexCompactionCompletedAt,
  lastTokenUsageUpdatedAt,
}: UseContextUsageProjectionOptions) {
  const claudeContextUsage = useMemo<ClaudeContextUsageViewModel | null>(() => {
    if (!contextUsage || (selectedEngine !== "claude" && selectedEngine !== "dsh")) {
      return null;
    }
    const usedTokens =
      selectedEngine === "dsh"
        ? finiteNonNegative(contextUsage.contextUsedTokens)
        : resolveClaudeWindowUsedTokens(contextUsage);
    const latestRuntimeReceipt = isSharedSessionThreadId(activeThreadId)
      ? [...items]
          .reverse()
          .find(
            (
              item,
            ): item is Extract<ConversationItem, { kind: "message" }> & {
              role: "assistant";
              runtimeReceipt: NonNullable<
                Extract<ConversationItem, { kind: "message" }>["runtimeReceipt"]
              >;
            } =>
              item.kind === "message" &&
              item.role === "assistant" &&
              Boolean(item.runtimeReceipt),
          )?.runtimeReceipt
      : undefined;
    // CLI 没上报窗口总量时按模型估算兜底，让占用百分比可以计算。
    // 该 turn 已有 runtime receipt 时，优先用 live 窗口或 receipt.model，避免 picker 别名把 1M 网关估成 200K。
    const contextWindow =
      finitePositive(contextUsage.modelContextWindow) ??
      finitePositive(latestRuntimeReceipt?.contextWindowTokens) ??
      (selectedEngine === "claude" && usedTokens !== null
        ? estimateClaudeContextWindow(
            latestRuntimeReceipt?.model ?? selectedModelId,
          )
        : null);
    const totalTokens = finiteNonNegative(contextUsage.total.totalTokens);
    const inputTokens = finiteNonNegative(contextUsage.total.inputTokens);
    const cachedInputTokens = finiteNonNegative(
      contextUsage.total.cachedInputTokens,
    );
    const outputTokens = finiteNonNegative(contextUsage.total.outputTokens);
    const explicitUsedPercent = finiteNonNegative(
      contextUsage.contextUsedPercent,
    );
    const usedPercent =
      explicitUsedPercent ??
      (usedTokens !== null && contextWindow !== null
        ? (usedTokens / contextWindow) * 100
        : null);
    const explicitRemainingPercent = finiteNonNegative(
      contextUsage.contextRemainingPercent,
    );
    const remainingPercent =
      explicitRemainingPercent ??
      (usedPercent !== null ? Math.max(100 - usedPercent, 0) : null);

    return {
      usedTokens,
      contextWindow,
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      usedPercent,
      remainingPercent,
      freshness: contextUsage.contextUsageFreshness ?? "estimated",
      source: contextUsage.contextUsageSource ?? null,
      hasUsage:
        usedTokens !== null || usedPercent !== null || (totalTokens ?? 0) > 0,
      categoryUsages: contextUsage.contextCategoryUsages ?? null,
      toolUsages: contextUsage.contextToolUsages ?? null,
      toolUsagesTruncated: contextUsage.contextToolUsagesTruncated ?? null,
    };
  }, [activeThreadId, contextUsage, items, selectedEngine, selectedModelId]);

  const legacyContextUsage = useMemo(() => {
    if (!contextUsage) {
      return null;
    }
    if (selectedEngine === "claude" || selectedEngine === "dsh") {
      const usedTokens =
        selectedEngine === "dsh"
          ? finiteNonNegative(contextUsage.contextUsedTokens)
          : resolveClaudeWindowUsedTokens(contextUsage);
      const latestRuntimeReceipt = isSharedSessionThreadId(activeThreadId)
        ? [...items]
            .reverse()
            .find(
              (
                item,
              ): item is Extract<ConversationItem, { kind: "message" }> & {
                role: "assistant";
                runtimeReceipt: NonNullable<
                  Extract<ConversationItem, { kind: "message" }>["runtimeReceipt"]
                >;
              } =>
                item.kind === "message" &&
                item.role === "assistant" &&
                Boolean(item.runtimeReceipt),
            )?.runtimeReceipt
        : undefined;
      const contextWindow =
        finitePositive(contextUsage.modelContextWindow) ??
        finitePositive(latestRuntimeReceipt?.contextWindowTokens) ??
        (selectedEngine === "claude"
          ? estimateClaudeContextWindow(
              latestRuntimeReceipt?.model ?? selectedModelId,
            )
          : null);
      return usedTokens !== null && contextWindow !== null
        ? { used: usedTokens, total: contextWindow }
        : null;
    }
    return {
      used: contextUsage.total.totalTokens,
      total: contextUsage.modelContextWindow ?? 0,
    };
  }, [activeThreadId, contextUsage, items, selectedEngine, selectedModelId]);

  const dualContextUsage = useMemo(
    () =>
      resolveDualContextUsageModel(
        contextUsage,
        isContextCompacting,
        codexCompactionLifecycleState,
        codexCompactionSource,
        codexCompactionCompletedAt,
        lastTokenUsageUpdatedAt,
      ),
    [
      contextUsage,
      isContextCompacting,
      codexCompactionLifecycleState,
      codexCompactionSource,
      codexCompactionCompletedAt,
      lastTokenUsageUpdatedAt,
    ],
  );
  return { claudeContextUsage, legacyContextUsage, dualContextUsage };
}
