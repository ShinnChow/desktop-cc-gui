// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelSelect } from "./ModelSelect";
import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProviderTargetGroup } from "../hooks/useProviderTargetCatalogOwners";
import { atomicExecutionTarget, buildAtomicGroups } from "./ModelSelectTestSetup";

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

describe("ModelSelect empty channel models and custom reasoning defaults", () => {
  function openPickerSubmenu(name: RegExp) {
    const trigger = screen.getByRole("menuitem", { name });
    fireEvent.click(trigger);
    return trigger;
  }

  function openVendorHeadings(): string[] {
    const openMenu = document.querySelector(
      '[data-slot="dropdown-menu-sub-content"][data-state="open"]',
    );
    if (!openMenu) {
      return [];
    }
    return [...openMenu.querySelectorAll("[data-vendor-group]")].map(
      (node) => node.textContent ?? "",
    );
  }

  function buildGroupsWithEmptyCodex(): ProviderTargetGroup[] {
    const groups = buildAtomicGroups();
    groups[1].profiles[0].models = [];
    return groups;
  }

  it("shows two-line guidance and keeps the add-model entry when a channel has no models", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildGroupsWithEmptyCodex()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Codex CLI/);

    const emptyRow = document.querySelector(
      "[data-empty-channel-models='codex']",
    );
    expect(emptyRow).toBeTruthy();
    expect(emptyRow?.textContent).toContain("models.emptyChannelModelsTitle");
    expect(emptyRow?.textContent).toContain("models.emptyChannelModelsHint");
    expect(emptyRow?.getAttribute("aria-disabled")).toBe("true");

    // 「添加模型」入口仍在底栏，引导文案指向它。
    const footer = document.querySelector(
      "[data-submenu-footer='codex']",
    ) as HTMLElement;
    expect(footer).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "models.addModel" })).toBeTruthy();
  });

  it("renders DSH with the whale icon and hides add-model plus channel switcher", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      {
        providerId: "dsh",
        providerLabel: "DeepSeek Harness",
        enabled: true,
        profiles: [
          {
            id: "__dsh_host_catalog__",
            label: "本地配置",
            source: "disk",
            loading: false,
            error: null,
            models: [
              {
                id: "deepseek-official/deepseek-v4-pro",
                model: "deepseek-v4-pro",
                label: "DeepSeek / DeepSeek-V4-Pro",
                provider: "deepseek-official",
              },
            ],
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onOpenCliSettings={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /DeepSeek Harness/ });
    openPickerSubmenu(/DeepSeek Harness/);

    const dshTrigger = document.querySelector("[data-provider-id='dsh']");
    expect(dshTrigger).toBeTruthy();
    expect(dshTrigger?.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/deepseek.svg",
    );
    expect(document.querySelector("[data-submenu-footer='dsh']")).toBeNull();
    expect(document.querySelector("[data-channel-select='dsh']")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "models.addModel" }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /deepseek-v4-pro/ }),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-dsh-vendor-group='deepseek-official']")
        ?.textContent,
    ).toBe("DeepSeek");
  });

  it("groups DSH host catalog models by vendor like the official picker", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      {
        providerId: "dsh",
        providerLabel: "DeepSeek Harness",
        enabled: true,
        profiles: [
          {
            id: "__dsh_host_catalog__",
            label: "本地配置",
            source: "disk",
            loading: false,
            error: null,
            models: [
              {
                id: "deepseek-official/deepseek-v4-flash",
                model: "deepseek-v4-flash",
                label: "DeepSeek / DeepSeek-V4-Flash",
                provider: "deepseek-official",
              },
              {
                id: "gork-zhu/grok-4.6",
                model: "grok-4.6",
                label: "gork-zhu / Grok 4.6",
                provider: "gork-zhu",
              },
              {
                id: "kimi-coding/k3",
                model: "k3",
                label: "kimi-coding / Kimi K3",
                provider: "kimi-coding",
              },
              {
                id: "minimax-cn/MiniMax-M2.7",
                model: "MiniMax-M2.7",
                label: "minimax-cn / MiniMax-M2.7",
                provider: "minimax-cn",
              },
              {
                id: "mmm3/MiniMax-M3",
                model: "MiniMax-M3",
                label: "mmm3 / MiniMax-M3",
                provider: "mmm3",
              },
            ],
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /DeepSeek Harness/ });
    openPickerSubmenu(/DeepSeek Harness/);

    expect(
      [...document.querySelectorAll("[data-dsh-vendor-group]")].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "DeepSeek",
      "gork-zhu",
      "kimi-coding",
      "minimax-cn",
      "mmm3",
    ]);
    expect(
      screen.getByRole("menuitem", { name: /deepseek-v4-flash/ }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /grok-4.6/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /k3/ })).toBeTruthy();
  });

  it("emits a complete DSH host catalog target when picking grok-4.6 / Grok 4.5", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      {
        providerId: "dsh",
        providerLabel: "DeepSeek Harness",
        enabled: true,
        profiles: [
          {
            id: "__dsh_host_catalog__",
            label: "本地配置",
            source: "disk",
            loading: false,
            error: null,
            models: [
              {
                id: "grok-4.6/Grok 4.5",
                model: "Grok 4.5",
                label: "grok-4.6 / Grok 4.5",
              },
              {
                id: "grok-4.6/Grok 4.6",
                model: "Grok 4.6",
                label: "grok-4.6 / Grok 4.6",
              },
            ],
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /DeepSeek Harness/ });
    openPickerSubmenu(/DeepSeek Harness/);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /^Grok 4\.5$/ }),
    );

    expect(onExecutionTargetChange).toHaveBeenCalledWith({
      engine: "dsh",
      providerProfileId: null,
      modelCatalogEntryId: "grok-4.6/Grok 4.5",
      model: "Grok 4.5",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    });
  });

  it("uses the Grok EngineIcon for DSH grok-4.6 catalog rows, not the DeepSeek whale", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      {
        providerId: "dsh",
        providerLabel: "DeepSeek Harness",
        enabled: true,
        profiles: [
          {
            id: "__dsh_host_catalog__",
            label: "本地配置",
            source: "disk",
            loading: false,
            error: null,
            models: [
              {
                id: "deepseek/DeepSeek-V4-Flash",
                model: "DeepSeek-V4-Flash",
                label: "DeepSeek / DeepSeek-V4-Flash",
              },
              {
                id: "vision-http/ovh/Qwen2.5-VL-72B-Instruct",
                model: "ovh/Qwen2.5-VL-72B-Instruct",
                label: "Vision HTTP / ovh/Qwen2.5-VL-72B-Instruct",
              },
              {
                id: "grok-4.6/Grok 4.5",
                model: "Grok 4.5",
                label: "grok-4.6 / Grok 4.5",
              },
              {
                id: "grok-4.6/Grok 4.6",
                model: "Grok 4.6",
                label: "grok-4.6 / Grok 4.6",
              },
            ],
          },
        ],
      },
    ];
    const dshGrokTarget: ExecutionTarget = {
      engine: "dsh",
      providerProfileId: null,
      modelCatalogEntryId: "grok-4.6/Grok 4.6",
      model: "Grok 4.6",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    };

    render(
      <ModelSelect
        value="Grok 4.6"
        currentProvider="dsh"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={dshGrokTarget}
        targetGroups={groups}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:grok-4.6 / Grok 4.6",
    });
    expect(within(trigger).getByTestId("grok-icon")).toBeTruthy();
    expect(trigger.querySelector("img")).toBeNull();

    await user.click(trigger);
    await screen.findByRole("menuitem", { name: /DeepSeek Harness/ });
    openPickerSubmenu(/DeepSeek Harness/);

    const dshTrigger = document.querySelector("[data-provider-id='dsh']");
    expect(dshTrigger?.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/deepseek.svg",
    );

    const deepseekItem = await screen.findByRole("menuitem", {
      name: /^DeepSeek-V4-Flash$/,
    });
    expect(deepseekItem.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/deepseek.svg",
    );
    expect(within(deepseekItem).queryByTestId("grok-icon")).toBeNull();
    expect(deepseekItem.textContent).not.toContain("DeepSeek /");

    const qwenItem = await screen.findByRole("menuitem", {
      name: /^Qwen2\.5-VL-72B-Instruct$/,
    });
    expect(qwenItem.textContent).not.toContain("Vision HTTP");
    expect(qwenItem.textContent).not.toContain("ovh/");

    const grok45Item = await screen.findByRole("menuitem", {
      name: /^Grok 4\.5$/,
    });
    const grok46Item = await screen.findByRole("menuitem", {
      name: /^Grok 4\.6$/,
    });
    expect(within(grok45Item).getByTestId("grok-icon")).toBeTruthy();
    expect(grok45Item.querySelector("img")).toBeNull();
    expect(within(grok46Item).getByTestId("grok-icon")).toBeTruthy();
    expect(grok46Item.querySelector("img")).toBeNull();
  });

  it("opens CLI settings from the DSH empty catalog hint", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpenCliSettings = vi.fn();
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      {
        providerId: "dsh",
        providerLabel: "DeepSeek Harness",
        enabled: true,
        profiles: [
          {
            id: "__dsh_host_catalog__",
            label: "本地配置",
            source: "disk",
            loading: false,
            error: null,
            models: [],
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onOpenCliSettings={onOpenCliSettings}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /DeepSeek Harness/ });
    openPickerSubmenu(/DeepSeek Harness/);

    const emptyRow = document.querySelector(
      "[data-empty-channel-models='dsh']",
    );
    expect(emptyRow).toBeTruthy();
    expect(emptyRow?.textContent).toContain("models.emptyDshHostHint");
    expect(emptyRow?.textContent).not.toContain(
      "models.emptyChannelModelsHint",
    );
    expect(emptyRow?.getAttribute("aria-disabled")).not.toBe("true");
    expect(document.querySelector("[data-submenu-footer='dsh']")).toBeNull();

    fireEvent.click(emptyRow as Element);
    expect(onOpenCliSettings).toHaveBeenCalledTimes(1);
  });

  it("seeds default medium reasoning when a custom Codex model is picked", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const groups = buildAtomicGroups();
    groups[1].profiles[0].models = [
      {
        id: "my-custom-model",
        label: "My Custom Model",
        source: "custom",
      },
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Codex CLI/ });
    openPickerSubmenu(/Codex CLI/);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /My Custom Model/ }),
    );

    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        providerProfileId: null,
        modelCatalogEntryId: "my-custom-model",
        model: "my-custom-model",
        providerProfileNameSnapshot: "Local disk",
        reasoning: { effort: "medium" },
      }),
    );
  });

  it("keeps the user-selected effort when switching to a custom Codex model", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const groups = buildAtomicGroups();
    groups[1].profiles[0].models = [
      {
        id: "my-custom-model",
        label: "My Custom Model",
        source: "custom",
      },
    ];

    render(
      <ModelSelect
        value="my-custom-model"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={{
          engine: "codex",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.7",
          model: "gpt-5.7",
          providerProfileNameSnapshot: "Local disk",
          providerProfileSource: "disk",
          reasoning: { effort: "high" },
        }}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:My Custom Model" }),
    );
    await screen.findByRole("menuitem", { name: /Codex CLI/ });
    openPickerSubmenu(/Codex CLI/);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /My Custom Model/ }),
    );

    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        providerProfileId: null,
        reasoning: { effort: "high" },
      }),
    );
  });

  function piListModels(): Array<{
    id: string;
    label: string;
    provider: string;
    description?: string;
  }> {
    return [
      {
        id: "deepseek/deepseek-v4-flash",
        label: "deepseek/deepseek-v4-flash",
        provider: "deepseek",
        description: "ctx 1M · thinking",
      },
      {
        id: "deepseek/deepseek-v4-pro",
        label: "deepseek/deepseek-v4-pro",
        provider: "deepseek",
        description: "ctx 1M · thinking",
      },
      {
        id: "kimi-coding/k3",
        label: "kimi-coding/k3",
        provider: "kimi-coding",
        description: "ctx 1.0M · thinking · vision",
      },
      {
        id: "kimi-coding/k3-256k",
        label: "kimi-coding/k3-256k",
        provider: "kimi-coding",
        description: "ctx 262.1K · thinking · vision",
      },
      {
        id: "minimax-cn/MiniMax-M2.7",
        label: "minimax-cn/MiniMax-M2.7",
        provider: "minimax-cn",
        description: "ctx 204.8K · thinking",
      },
      {
        id: "auto",
        label: "PI Auto",
        provider: "pi",
        description: "Use PI CLI default model",
      },
    ];
  }

  function buildPiTargetGroup(): ProviderTargetGroup {
    return {
      providerId: "pi",
      providerLabel: "PI CLI",
      enabled: true,
      profiles: [
        {
          id: "__local_pi__",
          label: "本地配置",
          source: "disk",
          loading: false,
          error: null,
          models: piListModels(),
        },
        {
          id: "pi-alt",
          label: "备用渠道",
          source: "managed",
          loading: false,
          error: null,
          models: [
            {
              id: "openai/gpt-5",
              label: "openai/gpt-5",
              provider: "openai",
            },
          ],
        },
      ],
    };
  }

  function buildDshTargetGroup(): ProviderTargetGroup {
    return {
      providerId: "dsh",
      providerLabel: "DeepSeek Harness",
      enabled: true,
      profiles: [
        {
          id: "__dsh_host_catalog__",
          label: "本地配置",
          source: "disk",
          loading: false,
          error: null,
          models: [
            {
              id: "deepseek-official/deepseek-v4-flash",
              model: "deepseek-v4-flash",
              label: "DeepSeek / DeepSeek-V4-Flash",
              provider: "deepseek-official",
            },
            {
              id: "kimi-coding/k3",
              model: "k3",
              label: "kimi-coding / Kimi K3",
              provider: "kimi-coding",
            },
          ],
        },
      ],
    };
  }

  it("groups PI list-models by provider and keeps the full catalog id on pick", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      buildPiTargetGroup(),
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /PI CLI/ });
    openPickerSubmenu(/PI CLI/);

    expect(
      [...document.querySelectorAll("[data-vendor-group]")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["deepseek", "kimi-coding", "minimax-cn", "pi"]);
    const flashRow = document.querySelector(
      '[data-model-id="deepseek/deepseek-v4-flash"]',
    );
    const k3Row = document.querySelector('[data-model-id="kimi-coding/k3"]');
    expect(flashRow?.textContent).toContain("deepseek-v4-flash");
    expect(flashRow?.textContent).not.toContain("deepseek/deepseek-v4-flash");
    expect(k3Row?.textContent).toContain("k3");
    expect(k3Row?.textContent).not.toContain("kimi-coding/k3");
    expect(document.querySelector("[data-submenu-footer='pi']")).toBeTruthy();
    expect(document.querySelector("[data-channel-select='pi']")).toBeTruthy();

    fireEvent.click(k3Row as Element);

    expect(onExecutionTargetChange).toHaveBeenCalledWith({
      engine: "pi",
      providerProfileId: null,
      modelCatalogEntryId: "kimi-coding/k3",
      model: "kimi-coding/k3",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    });
  });

  it("disambiguates PI custom-provider rows that share the same last segment", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const piGroup: ProviderTargetGroup = {
      providerId: "pi",
      providerLabel: "PI CLI",
      enabled: true,
      profiles: [
        {
          id: "__local_pi__",
          label: "本地配置",
          source: "disk",
          loading: false,
          error: null,
          models: [
            {
              id: "cpa/cline/deepseek-v4-flash-0731",
              label: "cline/deepseek-v4-flash-0731",
              provider: "cpa",
              description: "ctx 200K · thinking",
            },
            {
              id: "cpa/fb2api/deepseek-v4-flash-0731",
              label: "fb2api/deepseek-v4-flash-0731",
              provider: "cpa",
              description: "ctx 200K · thinking",
            },
            {
              id: "cpa/deepseek-v4-pro-0813",
              label: "deepseek-v4-pro-0813",
              provider: "cpa",
              description: "ctx 200K · thinking",
            },
          ],
        },
      ],
    };
    const groups: ProviderTargetGroup[] = [...buildAtomicGroups(), piGroup];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /PI CLI/ });
    openPickerSubmenu(/PI CLI/);

    const clineRow = document.querySelector(
      '[data-model-id="cpa/cline/deepseek-v4-flash-0731"]',
    );
    const fb2apiRow = document.querySelector(
      '[data-model-id="cpa/fb2api/deepseek-v4-flash-0731"]',
    );
    const proRow = document.querySelector(
      '[data-model-id="cpa/deepseek-v4-pro-0813"]',
    );
    expect(clineRow?.textContent).toContain("cline/deepseek-v4-flash-0731");
    expect(fb2apiRow?.textContent).toContain("fb2api/deepseek-v4-flash-0731");
    // 无冲突的行保持 last-segment 简洁展示
    expect(proRow?.textContent).toContain("deepseek-v4-pro-0813");
    expect(proRow?.textContent).not.toContain("cpa/deepseek-v4-pro-0813");
  });

  it("keeps the PI closed trigger prefixed so it cannot collide with DSH last-segment names", async () => {
    const piTarget: ExecutionTarget = {
      engine: "pi",
      providerProfileId: null,
      modelCatalogEntryId: "kimi-coding/k3",
      model: "kimi-coding/k3",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    };

    render(
      <ModelSelect
        value="kimi-coding/k3"
        currentProvider="pi"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={piTarget}
        targetGroups={[...buildAtomicGroups(), buildPiTargetGroup()]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "chat.currentModel:kimi-coding / k3",
      }),
    ).toBeTruthy();
  });

  it("does not steal Claude, Codex, or DSH grouping when PI catalog is present", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups: ProviderTargetGroup[] = [
      ...buildAtomicGroups(),
      buildPiTargetGroup(),
      buildDshTargetGroup(),
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    expect(screen.getByRole("menuitem", { name: /Opus 4\.8/ })).toBeTruthy();
    expect(document.querySelector("[data-submenu-footer='claude']")).toBeTruthy();
    expect(openVendorHeadings()).toEqual([]);

    openPickerSubmenu(/Codex CLI/);
    expect(screen.getByRole("menuitem", { name: /GPT-5\.7/ })).toBeTruthy();
    expect(document.querySelector("[data-submenu-footer='codex']")).toBeTruthy();

    openPickerSubmenu(/DeepSeek Harness/);
    expect(openVendorHeadings()).toEqual(["DeepSeek", "kimi-coding"]);
    expect(document.querySelector("[data-submenu-footer='dsh']")).toBeNull();
    const dshFlash = document.querySelector(
      '[data-model-id="deepseek-official/deepseek-v4-flash"]',
    );
    expect(dshFlash?.textContent).toContain("deepseek-v4-flash");
    expect(dshFlash?.textContent).not.toContain("DeepSeek /");

    openPickerSubmenu(/PI CLI/);
    expect(openVendorHeadings()).toEqual([
      "deepseek",
      "kimi-coding",
      "minimax-cn",
      "pi",
    ]);
    const piK3 = document.querySelector('[data-model-id="kimi-coding/k3"]');
    expect(piK3?.textContent).toContain("k3");
    expect(piK3?.textContent).not.toContain("kimi-coding/k3");
    expect(document.querySelector("[data-submenu-footer='pi']")).toBeTruthy();
  });

  it("groups native PI modelGroups the same way as atomic target groups", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onProviderModelChange = vi.fn();

    render(
      <ModelSelect
        value="kimi-coding/k3"
        currentProvider="pi"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onProviderModelChange={onProviderModelChange}
        models={piListModels()}
        modelGroups={[
          {
            providerId: "pi",
            providerLabel: "PI CLI",
            enabled: true,
            models: piListModels(),
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "chat.currentModel:kimi-coding / k3",
      }),
    );
    await screen.findByRole("menuitem", { name: /PI CLI/ });
    openPickerSubmenu(/PI CLI/);

    expect(
      [...document.querySelectorAll("[data-vendor-group]")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["deepseek", "kimi-coding", "minimax-cn", "pi"]);
    fireEvent.click(
      document.querySelector('[data-model-id="kimi-coding/k3-256k"]') as Element,
    );
    expect(onProviderModelChange).toHaveBeenCalledWith("pi", "kimi-coding/k3-256k");
  });
});
