import type { ConversationItem, EngineType } from "../../../types";
import { resolveCodingPlanQuotaVendorId } from "./codingPlanQuotaVendor";

export type SessionQuotaTarget = {
  /** `${engine}::${providerProfileId ?? "local"}` */
  key: string;
  engine: EngineType;
  providerProfileId: string | null;
  /** 展示用：本地配置 / Minimax-m3 / kimi */
  providerLabel: string;
  model: string | null;
};

export type SessionQuotaTargetFallback = {
  engine: EngineType | null;
  providerProfileId?: string | null;
  providerLabel?: string | null;
  model?: string | null;
};

export type CollectSessionQuotaTargetsOptions = {
  /**
   * Shared Session：扫 conversation history 的 executionTargetSnapshot。
   * Native Session：必须 false，仅用当前 binding（fallback），避免历史供应商额度串台。
   * 默认 true 仅兼容旧调用；生产路径应显式传入。
   */
  includeHistory?: boolean;
};

export function buildSessionQuotaTargetKey(
  engine: EngineType | string,
  providerProfileId?: string | null,
): string {
  const profile = providerProfileId?.trim() || "local";
  return `${String(engine).trim().toLowerCase()}::${profile}`;
}

function isEngineType(value: unknown): value is EngineType {
  return (
    value === "codex" ||
    value === "claude" ||
    value === "gemini" ||
    value === "grok" ||
    value === "kimi" ||
    value === "opencode" ||
    value === "pi" ||
    value === "omp" ||
    value === "dsh"
  );
}

/**
 * 收集会话额度查询目标。
 *
 * - Shared（includeHistory=true）：从 items 的 executionTargetSnapshot 去重 + fallback
 * - Native（includeHistory=false）：只返回 fallback 一条，禁止历史供应商串台
 */
export function collectSessionQuotaTargets(
  items: readonly ConversationItem[],
  fallback: SessionQuotaTargetFallback,
  options: CollectSessionQuotaTargetsOptions = {},
): SessionQuotaTarget[] {
  const includeHistory = options.includeHistory !== false;
  const ordered = new Map<string, SessionQuotaTarget>();

  if (includeHistory) {
    for (const item of items) {
      if (item.kind !== "message") {
        continue;
      }
      const snap = item.executionTargetSnapshot;
      const engine =
        (snap?.engine && isEngineType(snap.engine) ? snap.engine : null) ??
        (item.engineSource && isEngineType(item.engineSource)
          ? item.engineSource
          : null);
      if (!engine) {
        continue;
      }
      const model =
        typeof snap?.model === "string" && snap.model.trim().length > 0
          ? snap.model.trim()
          : null;
      const providerProfileId = resolveCodingPlanQuotaVendorId({
        engine,
        providerProfileId:
          typeof snap?.providerProfileId === "string" &&
          snap.providerProfileId.trim().length > 0
            ? snap.providerProfileId.trim()
            : null,
        selectedModel: model,
      });
      const key = buildSessionQuotaTargetKey(engine, providerProfileId);
      if (ordered.has(key)) {
        continue;
      }
      const providerLabel =
        (typeof snap?.providerProfileNameSnapshot === "string" &&
        snap.providerProfileNameSnapshot.trim().length > 0
          ? snap.providerProfileNameSnapshot.trim()
          : null) ?? engine;
      ordered.set(key, {
        key,
        engine,
        providerProfileId,
        providerLabel,
        model,
      });
    }
  }

  if (fallback.engine && isEngineType(fallback.engine)) {
    const model =
      typeof fallback.model === "string" && fallback.model.trim().length > 0
        ? fallback.model.trim()
        : null;
    const providerProfileId = resolveCodingPlanQuotaVendorId({
      engine: fallback.engine,
      providerProfileId:
        typeof fallback.providerProfileId === "string" &&
        fallback.providerProfileId.trim().length > 0
          ? fallback.providerProfileId.trim()
          : null,
      selectedModel: model,
    });
    const key = buildSessionQuotaTargetKey(fallback.engine, providerProfileId);
    if (!ordered.has(key)) {
      ordered.set(key, {
        key,
        engine: fallback.engine,
        providerProfileId,
        providerLabel:
          (typeof fallback.providerLabel === "string" &&
          fallback.providerLabel.trim().length > 0
            ? fallback.providerLabel.trim()
            : null) ?? fallback.engine,
        model,
      });
    }
  }

  return Array.from(ordered.values());
}

export function formatSessionQuotaTargetTitle(target: SessionQuotaTarget): string {
  const engineLabel =
    target.engine === "claude"
      ? "Claude"
      : target.engine === "codex"
        ? "Codex"
        : target.engine === "kimi"
          ? "Kimi"
          : target.engine === "grok"
            ? "Grok"
            : target.engine === "opencode"
              ? "OpenCode"
              : target.engine === "gemini"
                ? "Gemini"
                : target.engine === "dsh"
                  ? "DSH"
                  : target.engine === "pi"
                    ? "PI"
                    : target.engine === "omp"
                    ? "OMP"
                    : target.engine === "qoder"
                      ? "Qoder"
                      : target.engine;
  if (
    target.providerLabel &&
    target.providerLabel !== target.engine &&
    target.providerLabel.toLowerCase() !== engineLabel.toLowerCase()
  ) {
    return `${engineLabel} · ${target.providerLabel}`;
  }
  return engineLabel;
}
