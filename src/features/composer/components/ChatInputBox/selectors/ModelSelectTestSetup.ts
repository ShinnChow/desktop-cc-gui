import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProviderTargetGroup } from "../hooks/useProviderTargetCatalogOwners";

export const atomicExecutionTarget: ExecutionTarget = {
  engine: "claude",
  providerProfileId: null,
  modelCatalogEntryId: "claude-opus-4-8",
  model: "claude-opus-4-8",
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "disk",
};

export function buildAtomicGroups(): ProviderTargetGroup[] {
  return [
    {
      providerId: "claude" as const,
      providerLabel: "Claude Code",
      enabled: true,
      profiles: [
        {
          id: "__local_settings_json__",
          label: "本地配置",
          source: "disk" as const,
          loading: false,
          error: null,
          models: [
            { id: "claude-opus-4-8", label: "Opus 4.8" },
            { id: "claude-sonnet-5", label: "Sonnet 5" },
          ],
        },
        {
          id: "k3",
          label: "k3",
          source: "managed" as const,
          loading: false,
          error: null,
          models: [{ id: "kimi-k3", label: "Kimi K3" }],
        },
      ],
    },
    {
      providerId: "codex" as const,
      providerLabel: "Codex CLI",
      enabled: true,
      profiles: [
        {
          id: "__disk__",
          label: "Local disk",
          source: "disk" as const,
          loading: false,
          error: null,
          models: [{ id: "gpt-5.7", label: "GPT-5.7" }],
        },
      ],
    },
  ];
}
