import { useEffect, useRef } from "react";
import type { useEngineController } from "../../features/engine/hooks/useEngineController";
import type { DebugEntry, EngineType } from "../../types";

type EngineControllerSection = ReturnType<typeof useEngineController>;

type ProviderModelCatalogSyncParams = {
  activeEngine: EngineType;
  activeThreadEngineSource: EngineType | null | undefined;
  activeThreadId: string | null | undefined;
  activeWorkspaceId: string | null | undefined;
  providerProfileId: string | null | undefined;
  addDebugEntry: (entry: DebugEntry) => void;
  refreshEngineModels: EngineControllerSection["refreshEngineModels"];
};

const PROVIDER_SCOPED_ENGINES = new Set<EngineType>([
  "claude",
  "codex",
  "grok",
  "kimi",
  "opencode",
  "pi",
  "omp",
  "dsh",
  "gemini",
  "qoder",
]);

/**
 * 切会话不得拉 model catalog。
 *
 * 今天之前大量会话没有 providerProfileId，catalog key 停在 `__global__`，点击是空转。
 * 标签补齐后每个会话都有 binding，再 refreshEngineModels 会变成
 * get_engine_models IPC（on-demand，最多 8s），点一下侧栏就卡死。
 * 发送仍以 thread.providerProfileId 为准；catalog 只在打开模型选择器时再拉。
 */
export function useProviderModelCatalogSync({
  activeEngine,
  activeThreadEngineSource,
  activeThreadId,
  activeWorkspaceId,
  providerProfileId,
  addDebugEntry,
}: ProviderModelCatalogSyncParams) {
  const activeCatalogKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const normalizedThreadId = activeThreadId?.trim();
    const normalizedProviderProfileId = providerProfileId?.trim() || null;
    const catalogEngine =
      activeThreadEngineSource ??
      (normalizedProviderProfileId ? null : activeEngine);
    if (
      !normalizedThreadId ||
      !catalogEngine ||
      !PROVIDER_SCOPED_ENGINES.has(catalogEngine)
    ) {
      return;
    }
    const catalogKey = `${activeWorkspaceId ?? "unknown"}:${catalogEngine}:${
      normalizedProviderProfileId ?? "__global__"
    }`;
    if (activeCatalogKeyRef.current === catalogKey) {
      return;
    }
    activeCatalogKeyRef.current = catalogKey;
    addDebugEntry({
      id: `${Date.now()}-provider-model-catalog-sync`,
      timestamp: Date.now(),
      source: "client",
      label: "engine/models sync skipped on thread select",
      payload: {
        workspaceId: activeWorkspaceId,
        threadId: normalizedThreadId,
        engine: catalogEngine,
        providerProfileId: normalizedProviderProfileId,
      },
    });
  }, [
    activeEngine,
    activeThreadEngineSource,
    activeThreadId,
    activeWorkspaceId,
    addDebugEntry,
    providerProfileId,
  ]);
}
