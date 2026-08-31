// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelSelect } from "./ModelSelect";
import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProviderTargetGroup } from "../hooks/useProviderTargetCatalogOwners";
import { notifyProviderContinuationUiRollback } from "../../../../threads/services/providerContinuationRequests";
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

describe("ModelSelect atomic target groups", () => {
  // Radix 子菜单在 jsdom 下的 hover 开启依赖真实定时器,容易抖动;
  // 直接 click SubTrigger 是确定性的打开方式。
  // 注意:jsdom 下 Radix modal layer 会给「后打开」的子菜单留下
  // aria-hidden 残留,第二个子菜单的断言用 byText/DOM 查询而非 byRole。
  function openPickerSubmenu(name: RegExp) {
    const trigger = screen.getByRole("menuitem", { name });
    fireEvent.click(trigger);
    return trigger;
  }

  it("opens the active channel models with footer channel switcher and no profile list rows", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    expect(screen.getByRole("menuitem", { name: /Codex CLI/ })).toBeTruthy();
    // Channel options stay out of the model list until the dialog opens.
    expect(screen.queryByText("k3")).toBeNull();

    openPickerSubmenu(/Claude Code/);
    expect(await screen.findByRole("menuitem", { name: /Opus 4.8/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Sonnet 5/ })).toBeTruthy();
    // The inactive channel's models stay hidden.
    expect(screen.queryByText("Kimi K3")).toBeNull();
    // Footer exposes equal-width channel / add-model buttons.
    const claudeChannel = document.querySelector(
      "[data-submenu-footer='claude'] [data-channel-select-trigger='claude'][data-provider-profile-id='__local_settings_json__']",
    );
    expect(claudeChannel).toBeTruthy();
    expect(claudeChannel?.textContent).toContain("本地配置");

    openPickerSubmenu(/Codex CLI/);
    expect(await screen.findByText("GPT-5.7")).toBeTruthy();
    const codexChannel = document.querySelector(
      "[data-submenu-footer='codex'] [data-channel-select-trigger='codex'][data-provider-profile-id='__disk__']",
    );
    expect(codexChannel).toBeTruthy();
  });

  it("places equal channel and add-model buttons on the same footer row", async () => {
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
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    const footer = document.querySelector(
      "[data-submenu-footer='claude']",
    ) as HTMLElement;
    expect(footer).toBeTruthy();
    const channelButton = footer.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    const addButton = within(footer).getByRole("button", {
      name: "models.addModel",
    });
    expect(channelButton).toBeTruthy();
    expect(channelButton.className).toContain("flex-1");
    expect(addButton.className).toContain("flex-1");

    const opusItem = screen.getByRole("menuitem", { name: /Opus 4.8/ });
    // Footer sits after model rows.
    expect(
      opusItem.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(addButton);
    expect(onAddModel).toHaveBeenCalledWith("claude");
  });

  it("emits a complete execution target when picking a model", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Sonnet 5/ }));

    expect(onExecutionTargetChange).toHaveBeenCalledWith({
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-sonnet-5",
      model: "claude-sonnet-5",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    });
    expect(onExecutionTargetChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: /Sonnet 5/ })).toBeNull();
  });

  it("projects the target channel for the current engine and the local default elsewhere", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpenProviderProfile = vi.fn();

    render(
      <ModelSelect
        value="kimi-k3"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        onOpenTargetCatalog={vi.fn()}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={{
          ...atomicExecutionTarget,
          providerProfileId: "k3",
          modelCatalogEntryId: "kimi-k3",
          model: "kimi-k3",
        }}
        targetGroups={buildAtomicGroups()}
      />,
    );

    // Trigger resolves the label from the target channel's catalog.
    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Kimi K3" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    expect(await screen.findByRole("menuitem", { name: /Kimi K3/ })).toBeTruthy();
    expect(screen.queryByText("Opus 4.8")).toBeNull();

    // Menu open prefetches the target channel for Claude and the local default for Codex.
    expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    expect(onOpenProviderProfile).toHaveBeenCalledWith("codex", "__disk__");
  });

  it("marks the target engine and model selected", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    const claudeTrigger = await screen.findByRole("menuitem", { name: /Claude Code/ });
    expect(claudeTrigger.getAttribute("data-selected")).toBe("true");
    expect(
      screen.getByRole("menuitem", { name: /Codex CLI/ }).getAttribute("data-selected"),
    ).toBeNull();

    openPickerSubmenu(/Claude Code/);
    const opusItem = await screen.findByRole("menuitem", { name: /Opus 4.8/ });
    expect(opusItem.getAttribute("data-selected")).toBe("true");
    expect(
      screen.getByRole("menuitem", { name: /Sonnet 5/ }).getAttribute("data-selected"),
    ).toBeNull();
  });

  it("shows loading and error rows for the active channel", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups = buildAtomicGroups();
    groups[0].profiles[0].loading = true;
    groups[1].profiles[0].error = "disk unreadable";

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

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    expect(
      await screen.findByRole("menuitem", { name: /models.refreshingConfig/ }),
    ).toBeTruthy();
    // Last-good models stay interactive while refreshing.
    expect(screen.getByRole("menuitem", { name: /Opus 4.8/ })).toBeTruthy();

    openPickerSubmenu(/Codex CLI/);
    expect((await screen.findByText("disk unreadable")).className).toContain(
      "text-destructive",
    );
  });

  it("reloads each CLI active channel from the submenu header", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onReloadProviderConfig = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        onReloadProviderConfig={onReloadProviderConfig}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(
      await screen.findByRole("button", { name: "models.refreshConfig" }),
    );
    expect(onReloadProviderConfig).toHaveBeenCalledWith(
      "claude",
      "__local_settings_json__",
    );

    openPickerSubmenu(/Codex CLI/);
    const gptItem = await screen.findByText("GPT-5.7");
    const codexSubContent = gptItem.closest(
      "[data-slot='dropdown-menu-sub-content']",
    );
    expect(codexSubContent).toBeTruthy();
    const codexRefresh = codexSubContent!.querySelector(
      "button[aria-label='models.refreshConfig']",
    );
    expect(codexRefresh).toBeTruthy();
    fireEvent.click(codexRefresh!);
    expect(onReloadProviderConfig).toHaveBeenCalledWith("codex", "__disk__");
  });

  it("opens the selected Qoder CN settings card from the CLI settings action", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpenCliSettings = vi.fn();
    const qoderTarget: ExecutionTarget = {
      engine: "qoder",
      providerProfileId: "__qoder_cn__",
      modelCatalogEntryId: "qoder-cn-model",
      model: "qoder-cn-model",
      providerProfileNameSnapshot: "CN",
      providerProfileSource: "managed",
      reasoning: null,
    };
    const qoderGroup: ProviderTargetGroup = {
      providerId: "qoder",
      providerLabel: "Qoder CLI",
      enabled: true,
      profiles: [
        {
          id: "__qoder_global__",
          label: "Global",
          source: "managed",
          loading: false,
          error: null,
          models: [{ id: "qoder-global-model", label: "Qoder Global" }],
        },
        {
          id: "__qoder_cn__",
          label: "CN",
          source: "managed",
          loading: false,
          error: null,
          models: [{ id: "qoder-cn-model", label: "Qoder CN" }],
        },
      ],
    };

    render(
      <ModelSelect
        value="qoder-cn-model"
        currentProvider="qoder"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onOpenCliSettings={onOpenCliSettings}
        onExecutionTargetChange={vi.fn()}
        executionTarget={qoderTarget}
        targetGroups={[...buildAtomicGroups(), qoderGroup]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Qoder CN" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "models.openCliSettings" }),
    );

    expect(onOpenCliSettings).toHaveBeenCalledWith("qoder-cn");
  });

  it("switches the current engine channel immediately via the channel dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    // Shared 路径：ensureModels 返回目标渠道 catalog，切换后必须用新模型而非旧渠道 id
    const onOpenProviderProfile = vi.fn().mockResolvedValue([
      { id: "kimi-k3", model: "kimi-k3", label: "Kimi K3", providerProfileId: "k3" },
    ]);

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    const channelTrigger = document.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    expect(channelTrigger).toBeTruthy();
    fireEvent.click(channelTrigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    const k3Option = await within(dialog).findByRole("button", {
      name: /^k3$/,
    });
    fireEvent.click(k3Option);

    expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    await waitFor(() => {
      expect(onExecutionTargetChange).toHaveBeenCalledWith({
        engine: "claude",
        providerProfileId: "k3",
        modelCatalogEntryId: "kimi-k3",
        model: "kimi-k3",
        providerProfileNameSnapshot: "k3",
        providerProfileSource: "managed",
        reasoning: null,
      });
    });
  });

  it("does not keep previous channel model when shared provider catalog is still empty", async () => {
    const onExecutionTargetChange = vi.fn();
    const onOpenProviderProfile = vi.fn().mockResolvedValue([]);
    const groups = buildAtomicGroups();
    // 模拟 Shared 刚切渠道、catalog 尚未返回
    const k3 = groups[0].profiles.find((p) => p.id === "k3");
    if (k3) {
      k3.models = [];
    }

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(
      document.querySelector(
        "[data-channel-select-trigger='claude']",
      ) as HTMLButtonElement,
    );
    fireEvent.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: /^k3$/,
      }),
    );

    await waitFor(() => {
      expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    });
    // 无新 catalog 时不得把旧 local 的 claude-opus-4-8 写进新渠道 target
    await new Promise((r) => setTimeout(r, 50));
    expect(onExecutionTargetChange).not.toHaveBeenCalled();

    // 失败必须回滚 override：再打开 picker，渠道芯片不得停在 k3
    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      screen.getByRole("button", { name: /chat.currentModel:/ }),
    );
    openPickerSubmenu(/Claude Code/);
    const rolledBackTrigger = document.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    expect(rolledBackTrigger).toBeTruthy();
    expect(rolledBackTrigger.textContent).toContain("本地配置");
    expect(rolledBackTrigger.getAttribute("data-provider-profile-id")).toBe(
      "__local_settings_json__",
    );
  });

  it("rolls back channel override when native continuation is cancelled", async () => {
    let resolveCatalog: ((models: unknown[]) => void) | undefined;
    const onOpenProviderProfile = vi.fn(
      (): Promise<void> =>
        new Promise((resolve) => {
          resolveCatalog = () => resolve();
        }),
    );

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(
      document.querySelector(
        "[data-channel-select-trigger='claude']",
      ) as HTMLButtonElement,
    );
    fireEvent.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: /^k3$/,
      }),
    );

    await waitFor(() => {
      expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    });

    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      screen.getByRole("button", { name: /chat.currentModel:/ }),
    );
    openPickerSubmenu(/Claude Code/);
    await waitFor(() => {
      expect(
        document.querySelector("[data-channel-select-trigger='claude']")
          ?.textContent,
      ).toContain("k3");
    });

    act(() => {
      notifyProviderContinuationUiRollback({
        engine: "claude",
        providerProfileId: "k3",
      });
    });

    await waitFor(() => {
      expect(
        document.querySelector("[data-channel-select-trigger='claude']")
          ?.textContent,
      ).toContain("本地配置");
    });
    resolveCatalog?.([]);
  });

  it("writes execution target immediately when switching another engine channel (codex→claude managed)", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const onOpenProviderProfile = vi.fn().mockResolvedValue([
      {
        id: "claude-fable-5",
        model: "deepseek-v4-pro",
        label: "deepseek-v4-pro",
        providerProfileId: "deepseek",
      },
    ]);
    // 当前 Shared 还在 Codex，用户在 Claude 组切 DeepSeek——必须立刻落盘 target，
    // 不能只 override UI 却仍显示「本地配置」。
    const codexTarget = {
      engine: "codex" as const,
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk" as const,
      reasoning: null,
    };
    const groups = buildAtomicGroups();
    groups[0].profiles.push({
      id: "deepseek",
      label: "DeepSeek",
      source: "managed" as const,
      loading: false,
      error: null,
      models: [
        {
          id: "claude-fable-5",
          model: "deepseek-v4-pro",
          label: "deepseek-v4-pro",
        },
      ],
    });

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={codexTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:gpt-5.6-sol" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    const channelTrigger = document.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    expect(channelTrigger).toBeTruthy();
    fireEvent.click(channelTrigger);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /DeepSeek/ }),
    );

    expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "deepseek");
    await waitFor(() => {
      expect(onExecutionTargetChange).toHaveBeenCalledWith({
        engine: "claude",
        providerProfileId: "deepseek",
        modelCatalogEntryId: "claude-fable-5",
        model: "deepseek-v4-pro",
        providerProfileNameSnapshot: "DeepSeek",
        providerProfileSource: "managed",
        reasoning: null,
      });
    });
  });

  it("writes codex managed channel target when previewing from a claude active target", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const onOpenProviderProfile = vi.fn().mockResolvedValue([
      { id: "gpt-provider-b", model: "gpt-provider-b", label: "GPT Provider B" },
    ]);
    const groups = buildAtomicGroups();
    groups[1].profiles.push({
      id: "provider-b",
      label: "Provider B",
      source: "managed" as const,
      loading: false,
      error: null,
      models: [{ id: "gpt-provider-b", label: "GPT Provider B" }],
    });

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Codex CLI/ });
    openPickerSubmenu(/Codex CLI/);

    const channelTrigger = document.querySelector(
      "[data-channel-select-trigger='codex']",
    ) as HTMLButtonElement;
    expect(channelTrigger).toBeTruthy();
    fireEvent.click(channelTrigger);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Provider B/ }),
    );

    expect(onOpenProviderProfile).toHaveBeenCalledWith("codex", "provider-b");
    await waitFor(() => {
      expect(onExecutionTargetChange).toHaveBeenCalledWith({
        engine: "codex",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "gpt-provider-b",
        model: "gpt-provider-b",
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
        reasoning: null,
      });
    });
  });

  it("disables unavailable engine groups with the disabled reason", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups = buildAtomicGroups();
    const kimiGroup = {
      providerId: "kimi" as const,
      providerLabel: "Kimi CLI",
      enabled: false,
      disabledReason: "可作为来源；目标续接尚未验证",
      profiles: [
        {
          id: "__local_config_toml__",
          label: "本地配置",
          source: "disk" as const,
          loading: false,
          error: null,
          models: [{ id: "kimi-for-coding", label: "Kimi For Coding" }],
        },
      ],
    };

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={[...groups, kimiGroup]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    const kimiTrigger = await screen.findByRole("menuitem", { name: /Kimi CLI/ });
    expect(kimiTrigger.getAttribute("data-disabled")).not.toBeNull();
    expect(kimiTrigger.getAttribute("title")).toBe("可作为来源；目标续接尚未验证");
  });

  it("shows the selected target model instead of the previous engine catalog", () => {
    render(
      <ModelSelect
        value="codex-target-model"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "claude-old-model", label: "Old Claude Model" }]}
        executionTarget={{
          engine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "codex-target-model",
          model: "codex-target-model",
          providerProfileNameSnapshot: "Provider B",
          providerProfileSource: "managed",
        }}
        targetGroups={[
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            profiles: [
              {
                id: "provider-b",
                label: "Provider B",
                source: "managed",
                loading: false,
                error: null,
                models: [
                  {
                    id: "codex-target-model",
                    label: "Provider B Model",
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole("button").textContent).toContain(
      "Provider B Model",
    );
    expect(screen.getByRole("button").textContent).not.toContain(
      "models.selectModel",
    );
  });
});
