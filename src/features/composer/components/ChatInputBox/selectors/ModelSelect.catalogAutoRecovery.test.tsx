// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelSelect } from "./ModelSelect";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.model
        ? `${key}:${params.model}`
        : params?.message
          ? `${key}:${params.message}`
          : key,
  }),
}));

vi.mock("../../../../engine/components/EngineIcon", () => ({
  EngineIcon: ({ engine }: { engine: string }) => (
    <span data-testid={`${engine}-icon`} />
  ),
}));

vi.mock("../../../../vendors/providerBrandIcon", () => ({
  providerBrandIconNeedsDarkTile: () => false,
  PROVIDER_BRAND_ICON_SRC: {
    claude: "/icons/claude.svg",
    openai: "/icons/openai.svg",
    kimi: "/icons/kimi.svg",
    opencode: "/icons/opencode.svg",
    deepseek: "/icons/deepseek.svg",
  },
  resolveProviderBrandIcon: ({ modelId }: { modelId?: string | null }) => {
    if (modelId === "kimi-k3" || modelId?.includes("kimi")) {
      return "/icons/kimi.svg";
    }
    if (modelId?.startsWith("gpt-") || modelId?.includes("openai")) {
      return "/icons/openai.svg";
    }
    if (modelId?.includes("claude")) {
      return "/icons/claude.svg";
    }
    return null;
  },
}));

describe("fallback-only legacy catalog auto recovery", () => {
  const piFallbackGroup = {
    providerId: "pi" as const,
    providerLabel: "PI CLI",
    enabled: true,
    models: [
      {
        id: "auto",
        label: "auto",
        description: "Use PI CLI default model",
        source: "fallback",
      },
    ],
  };

  it("auto-triggers one refresh when the opened group is fallback-only", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="auto"
        currentProvider="pi"
        providerLabel="PI CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={piFallbackGroup.models}
        modelGroups={[piFallbackGroup]}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:auto" }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
  });

  it("does not auto-refresh when the group already has live models", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();
    const liveModels = [
      {
        id: "ark/deepseek-v4-flash",
        label: "deepseek-v4-flash",
        source: "detected",
        provider: "ark",
      },
    ];

    render(
      <ModelSelect
        value="ark/deepseek-v4-flash"
        currentProvider="pi"
        providerLabel="PI CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={liveModels}
        modelGroups={[{ ...piFallbackGroup, models: liveModels }]}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "chat.currentModel:ark / deepseek-v4-flash",
      }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).not.toHaveBeenCalled();
  });

  it("does not double-fire while a refresh is already in flight", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="auto"
        currentProvider="pi"
        providerLabel="PI CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={piFallbackGroup.models}
        modelGroups={[piFallbackGroup]}
        onRefreshConfig={onRefreshConfig}
        isRefreshingConfig
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:auto" }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).not.toHaveBeenCalled();
  });
});

describe("capability-degraded pi catalog auto recovery", () => {
  const buildPiListModelsRow = (id: string) => ({
    id,
    label: id,
    source: "detected",
    provenance: "cli:pi-list-models",
  });

  it("auto-triggers one refresh when the opened pi group came from --list-models", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();
    const degradedModels = [
      buildPiListModelsRow("ark/deepseek-v4-pro-0813"),
      buildPiListModelsRow("ark/kimi-k3"),
    ];

    render(
      <ModelSelect
        value="ark/deepseek-v4-pro-0813"
        currentProvider="pi"
        providerLabel="PI CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={degradedModels}
        modelGroups={[
          {
            providerId: "pi" as const,
            providerLabel: "PI CLI",
            enabled: true,
            models: degradedModels,
          },
        ]}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "chat.currentModel:ark / deepseek-v4-pro-0813",
      }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
  });

  it("does not auto-refresh when the pi group came from the rpc snapshot", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();
    // models.json 无 thinkingLevelMap 的合法五档投影同样是 RPC 快照来源，
    // 不允许对这类用户每次打开菜单都重探。
    const rpcModels = [
      {
        id: "my-relay/grok-4.6",
        label: "grok-4.6",
        source: "detected",
        provenance: "cli:pi-available-models",
      },
    ];

    render(
      <ModelSelect
        value="my-relay/grok-4.6"
        currentProvider="pi"
        providerLabel="PI CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={rpcModels}
        modelGroups={[
          {
            providerId: "pi" as const,
            providerLabel: "PI CLI",
            enabled: true,
            models: rpcModels,
          },
        ]}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "chat.currentModel:my-relay / grok-4.6",
      }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).not.toHaveBeenCalled();
  });

  it("does not auto-refresh when provenance is mixed or missing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();
    const mixedModels = [
      buildPiListModelsRow("ark/deepseek-v4-pro-0813"),
      { id: "custom/model-x", label: "model-x", source: "detected" },
    ];

    render(
      <ModelSelect
        value="ark/deepseek-v4-pro-0813"
        currentProvider="pi"
        providerLabel="PI CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={mixedModels}
        modelGroups={[
          {
            providerId: "pi" as const,
            providerLabel: "PI CLI",
            enabled: true,
            models: mixedModels,
          },
        ]}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "chat.currentModel:ark / deepseek-v4-pro-0813",
      }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).not.toHaveBeenCalled();
  });

  it("does not auto-refresh for non-pi engines with detected provenance rows", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRefreshConfig = vi.fn();
    const kimiModels = [
      buildPiListModelsRow("kimi-coding/k3"),
    ];

    render(
      <ModelSelect
        value="kimi-coding/k3"
        currentProvider="kimi"
        providerLabel="Kimi CLI"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={kimiModels}
        modelGroups={[
          {
            providerId: "kimi" as const,
            providerLabel: "Kimi CLI",
            enabled: true,
            models: kimiModels,
          },
        ]}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:kimi-coding/k3" }),
    );
    await screen.findByRole("menu");

    expect(onRefreshConfig).not.toHaveBeenCalled();
  });
});
