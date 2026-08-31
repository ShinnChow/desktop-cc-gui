// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isAtomicEmptyModelSelection,
  resolveAtomicSelectedModelDisplay,
} from "./model-select/display";
import { ModelSelect } from "./ModelSelect";
import { STORAGE_KEYS } from "../../../types/provider";
import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProviderTargetGroup } from "../hooks/useProviderTargetCatalogOwners";

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

describe("ModelSelect", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders the readiness trigger with provider and selected model chrome", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();

    render(
      <ModelSelect
        value="demo"
        currentProvider="codex"
        providerLabel="Codex"
        triggerVariant="readiness"
        onChange={onChange}
        models={[{ id: "demo", label: "demo" }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "chat.currentModel:demo" });

    expect(trigger.className).toContain("composer-readiness-target-button");
    // Provider is shown as an engine icon, the selected model as text.
    expect(within(trigger).getByTestId("codex-icon")).toBeTruthy();
    expect(trigger.textContent).toContain("demo");

    await user.click(trigger);
    const option = await screen.findByRole("menuitem", { name: /demo/ });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("demo");
  });

  it("renders grouped providers first and opens provider models on hover", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const onProviderModelChange = vi.fn();

    render(
      <ModelSelect
        value="gpt-5.4"
        currentProvider="codex"
        providerLabel="Codex"
        triggerVariant="readiness"
        onChange={onChange}
        onProviderModelChange={onProviderModelChange}
        models={[{ id: "gpt-5.4", label: "GPT-5.4" }]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [{ id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "hidden" }],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4", description: "hidden" }],
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:GPT-5.4" }),
    );

    // The first level is provider/CLI only; models stay in the hover submenu.
    const claudeProviderItem = await screen.findByRole("menuitem", { name: /Claude Code/ });
    expect(screen.getByRole("menuitem", { name: /Codex/ })).toBeTruthy();
    // Trigger still shows the selected model text; model rows are not yet in the menu.
    expect(screen.queryByRole("menuitem", { name: /Sonnet 4\.6/ })).toBeNull();

    await user.hover(claudeProviderItem);
    const sonnetItem = await screen.findByRole("menuitem", {
      name: /Sonnet 4\.6|models\.claude\.sonnet46/,
    });
    expect(sonnetItem).toBeTruthy();
    // Grouped items now show the tier description subtitle (jetbrains parity).
    expect(sonnetItem.textContent).toMatch(
      /models\.claude\.sonnet46\.description|hidden/,
    );

    fireEvent.click(sonnetItem);

    expect(onProviderModelChange).toHaveBeenCalledWith("claude", "claude-sonnet-4-6");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses runtime model ids for mapped model brand icons", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ opus: "kimi-k3" }),
    );

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[
          {
            id: "claude-opus-4-8",
            model: "kimi-k3",
            label: "Opus 4.8",
          },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              {
                id: "claude-opus-4-8",
                model: "kimi-k3",
                label: "Opus 4.8",
              },
            ],
          },
        ]}
      />,
    );

    // Mapped label becomes kimi-k3 (not the original Opus 4.8 tier name).
    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:kimi-k3",
    });
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(within(trigger).queryByTestId("claude-icon")).toBeNull();

    await user.click(trigger);
    const claudeProviderItem = await screen.findByRole("menuitem", {
      name: /Claude Code/,
    });
    expect(within(claudeProviderItem).getByTestId("claude-icon")).toBeTruthy();

    await user.hover(claudeProviderItem);
    const opusItem = await screen.findByRole("menuitem", { name: /kimi-k3/ });
    expect(opusItem.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    // Subtitle explains the tier while the primary label shows the mapped model.
    expect(opusItem.textContent).toMatch(/Opus 4\.8|models\.claude\.opus48/);
  });

  it("uses the Kimi brand tile for provider row, model rows, and trigger", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="k3"
        currentProvider="kimi"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "k3", label: "K3" }]}
        modelGroups={[
          {
            providerId: "kimi",
            providerLabel: "Kimi CLI",
            enabled: true,
            models: [
              { id: "k3", label: "K3" },
              { id: "k3-256k", label: "K3-256k" },
            ],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:K3",
    });
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(within(trigger).queryByTestId("kimi-icon")).toBeNull();

    await user.click(trigger);
    const kimiProviderItem = await screen.findByRole("menuitem", {
      name: /Kimi CLI/,
    });
    expect(kimiProviderItem.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(within(kimiProviderItem).queryByTestId("kimi-icon")).toBeNull();

    await user.hover(kimiProviderItem);
    const k3Item = await screen.findByRole("menuitem", { name: /^K3$/ });
    const k3256Item = await screen.findByRole("menuitem", { name: /K3-256k/ });
    expect(k3Item.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(k3256Item.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
  });

  it("uses the Codex EngineIcon for provider row, native gpt models, and trigger", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "gpt-5.6-sol", label: "gpt-5.6-sol" }]}
        modelGroups={[
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            models: [
              { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
              { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
            ],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:gpt-5.6-sol",
    });
    // Native Codex models must not flip to the lobehub openai brand SVG —
    // the provider glyph (EngineIcon) is the single source of truth.
    expect(within(trigger).getByTestId("codex-icon")).toBeTruthy();
    expect(trigger.querySelector("img")).toBeNull();

    await user.click(trigger);
    const codexProviderItem = await screen.findByRole("menuitem", {
      name: /Codex CLI/,
    });
    expect(within(codexProviderItem).getByTestId("codex-icon")).toBeTruthy();
    expect(codexProviderItem.querySelector("img")).toBeNull();

    await user.hover(codexProviderItem);
    const solItem = await screen.findByRole("menuitem", {
      name: /gpt-5\.6-sol/,
    });
    const terraItem = await screen.findByRole("menuitem", {
      name: /gpt-5\.6-terra/,
    });
    expect(within(solItem).getByTestId("codex-icon")).toBeTruthy();
    expect(solItem.querySelector("img")).toBeNull();
    expect(within(terraItem).getByTestId("codex-icon")).toBeTruthy();
    expect(terraItem.querySelector("img")).toBeNull();
  });

  it("uses the Grok EngineIcon for provider row, model rows, and trigger", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="grok-4.5"
        currentProvider="grok"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "grok-4.5", label: "Grok 4.5" }]}
        modelGroups={[
          {
            providerId: "grok",
            providerLabel: "Grok CLI",
            enabled: true,
            models: [{ id: "grok-4.5", label: "Grok 4.5" }],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:Grok 4.5",
    });
    expect(within(trigger).getByTestId("grok-icon")).toBeTruthy();
    expect(trigger.querySelector("img")).toBeNull();

    await user.click(trigger);
    const grokProviderItem = await screen.findByRole("menuitem", {
      name: /Grok CLI/,
    });
    expect(within(grokProviderItem).getByTestId("grok-icon")).toBeTruthy();

    await user.hover(grokProviderItem);
    const modelItem = await screen.findByRole("menuitem", { name: /Grok 4\.5/ });
    expect(within(modelItem).getByTestId("grok-icon")).toBeTruthy();
    expect(modelItem.querySelector("img")).toBeNull();
  });

  it("shows mapped labels and tier descriptions for every Claude family slot", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({
        fable: "kimi-k3",
        opus: "kimi-k3",
        sonnet: "kimi-k3",
        haiku: "kimi-k3",
      }),
    );

    render(
      <ModelSelect
        value="claude-fable-5"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[
          { id: "claude-fable-5", model: "kimi-k3", label: "Fable 5" },
          { id: "claude-opus-4-8", model: "kimi-k3", label: "Opus 4.8" },
          { id: "claude-sonnet-5", model: "kimi-k3", label: "Sonnet 5" },
          {
            id: "claude-haiku-4-5-20251001",
            model: "kimi-k3",
            label: "Haiku 4.5",
          },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-fable-5", model: "kimi-k3", label: "Fable 5" },
              { id: "claude-opus-4-8", model: "kimi-k3", label: "Opus 4.8" },
              { id: "claude-sonnet-5", model: "kimi-k3", label: "Sonnet 5" },
              {
                id: "claude-haiku-4-5-20251001",
                model: "kimi-k3",
                label: "Haiku 4.5",
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.currentModel:kimi-k3" }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:kimi-k3" }),
    );
    await user.hover(
      await screen.findByRole("menuitem", { name: /Claude Code/ }),
    );

    const fableItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.fable5\.description|kimi-k3[\s\S]*Fable 5/,
    });
    const opusItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.opus48\.description|kimi-k3[\s\S]*Opus 4\.8/,
    });
    const sonnetItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.sonnet5\.description|kimi-k3[\s\S]*Sonnet 5/,
    });
    const haikuItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.haiku45\.description|kimi-k3[\s\S]*Haiku/,
    });

    for (const item of [fableItem, opusItem, sonnetItem, haikuItem]) {
      expect(item.textContent).toContain("kimi-k3");
      expect(item.querySelector("img")?.getAttribute("src")).toBe(
        "/icons/kimi.svg",
      );
    }
  });

  it("does not display the first model when no model value is selected", () => {
    render(
      <ModelSelect
        value=""
        currentProvider="codex"
        onChange={vi.fn()}
        models={[
          {
            id: "gpt-5.5",
            label: "gpt-5.5",
          },
        ]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("models.loading");
    expect(buttonText).not.toContain("gpt-5.5");
  });

  it("renders independent add model and refresh config footer actions", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="gpt-5.5"
        currentProvider="codex"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onRefreshConfig={onRefreshConfig}
        models={[{ id: "gpt-5.5", label: "gpt-5.5" }]}
      />,
    );

    await user.click(screen.getAllByRole("button")[0]);
    await user.click(await screen.findByRole("menuitem", { name: "models.refreshConfig" }));

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    expect(onAddModel).not.toHaveBeenCalled();

    // Refresh keeps the menu open; the add action is still reachable.
    await user.click(screen.getByRole("menuitem", { name: "models.addModel" }));

    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledWith("codex");
    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
  });

  it("moves config actions into the current provider submenu when providers are grouped", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onRefreshConfig={onRefreshConfig}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-sonnet-5", label: "Sonnet 5" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-opus-4-8", label: "Opus 4.8" },
              { id: "claude-sonnet-5", label: "Sonnet 5" },
            ],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Claude Code/ }));

    expect(screen.queryByRole("menuitem", { name: "models.refreshConfig" })).toBeNull();

    const refreshButton = await screen.findByRole("button", { name: "models.refreshConfig" });
    expect(refreshButton.textContent).toBe("");

    const opusItem = await screen.findByRole("menuitem", { name: /Opus 4.8/ });
    const sonnetItem = screen.getByRole("menuitem", { name: /Sonnet 5/ });
    const addItem = screen.getByRole("menuitem", { name: "models.addModel" });
    const submenuContent = opusItem.closest("[data-slot='dropdown-menu-sub-content']");

    expect(submenuContent).toBeTruthy();
    const items = Array.from(
      submenuContent!.querySelectorAll("[role='menuitem']"),
    );
    expect(items.indexOf(addItem)).toBeGreaterThan(items.indexOf(opusItem));
    expect(items.indexOf(addItem)).toBeGreaterThan(items.indexOf(sonnetItem));

    fireEvent.click(addItem);
    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledWith("claude");

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Claude Code/ }));
    fireEvent.click(await screen.findByRole("button", { name: "models.refreshConfig" }));

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledTimes(1);
  });

  it("filters submenu models by search query", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={onChange}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-sonnet-5", label: "Sonnet 5" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-opus-4-8", label: "Opus 4.8" },
              { id: "claude-sonnet-5", label: "Sonnet 5" },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Claude Code/ }));

    const searchInput = await screen.findByPlaceholderText(
      "models.searchModelsPlaceholder",
    );
    expect(
      await screen.findByRole("menuitem", { name: /Opus 4.8/ }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Sonnet 5/ })).toBeTruthy();

    // 点击搜索框区域不得关闭菜单 / 子菜单（真实 pointer 事件在 jsdom 零布局下
    // 会误关子菜单，这里用 fireEvent 模拟按下 + 点击验证选择器保持打开）。
    fireEvent.pointerDown(searchInput);
    fireEvent.mouseDown(searchInput);
    fireEvent.click(searchInput);
    expect(screen.getByRole("menuitem", { name: /Claude Code/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Opus 4.8/ })).toBeTruthy();

    // jsdom 无布局，Radix 子菜单 grace-area 计算会把真实 pointer 移入输入框
    // 误判为离开而关闭子菜单（真实浏览器无此问题），这里用 fireEvent 模拟输入。
    fireEvent.change(searchInput, { target: { value: "sonnet" } });

    expect(screen.queryByRole("menuitem", { name: /Opus 4.8/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Sonnet 5/ })).toBeTruthy();

    // Escape：有 query 时先清空并留在菜单，不关闭选择器。
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect((searchInput as HTMLInputElement).value).toBe("");
    expect(
      await screen.findByRole("menuitem", { name: /Opus 4.8/ }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Sonnet 5/ })).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "zzz-no-match" } });

    expect(screen.queryByRole("menuitem", { name: /Opus 4.8/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Sonnet 5/ })).toBeNull();
    expect(screen.getByText("models.noMatchingModels")).toBeTruthy();

    // 只有选中具体模型才关闭选择器。
    fireEvent.change(searchInput, { target: { value: "sonnet" } });
    fireEvent.click(screen.getByRole("menuitem", { name: /Sonnet 5/ }));
    expect(onChange).toHaveBeenCalledWith("claude-sonnet-5");
    expect(screen.queryByRole("menuitem", { name: /Sonnet 5/ })).toBeNull();
  });

  it("shows add model in every provider submenu, not only the current engine", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "gpt-5.4", label: "GPT-5.4" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [{ id: "claude-opus-4-8", label: "Opus 4.8" }],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Codex/ }));

    const addItem = await screen.findByRole("menuitem", { name: "models.addModel" });
    fireEvent.click(addItem);

    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledWith("codex");
  });

  it("renders a root footer action that opens CLI settings", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpenCliSettings = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onOpenCliSettings={onOpenCliSettings}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-sonnet-5", label: "Sonnet 5" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-opus-4-8", label: "Opus 4.8" },
              { id: "claude-sonnet-5", label: "Sonnet 5" },
            ],
          },
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));

    const cliSettingsItem = await screen.findByRole("menuitem", {
      name: "models.openCliSettings",
    });
    expect(cliSettingsItem).toBeTruthy();

    fireEvent.click(cliSettingsItem);
    expect(onOpenCliSettings).toHaveBeenCalledTimes(1);
  });

  it("prefers active localStorage mapping over parent-provided tier labels", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ sonnet: "kimi-k3" }),
    );

    render(
      <ModelSelect
        value="claude-sonnet-4-6"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("kimi-k3");
    expect(buttonText).not.toContain("Sonnet 4.6");
  });

  it("does not rewrite non-Claude engine labels with Claude main mapping", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ main: "deepseek-v4-pro" }),
    );

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[
          { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
          { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
          { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
          { id: "gpt-5.5", label: "gpt-5.5" },
        ]}
        modelGroups={[
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            models: [
              {
                id: "gpt-5.6-sol",
                label: "gpt-5.6-sol",
                description: "Latest frontier agentic coding model.",
              },
              {
                id: "gpt-5.6-terra",
                label: "gpt-5.6-terra",
                description: "Balanced agentic coding model for everyday work.",
              },
              {
                id: "gpt-5.6-luna",
                label: "gpt-5.6-luna",
                description: "Fast and affordable agentic coding model.",
              },
              {
                id: "gpt-5.5",
                label: "gpt-5.5",
                description:
                  "Frontier model for complex coding, research, and real-world work.",
              },
            ],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:gpt-5.6-sol",
    });
    expect(trigger.textContent).not.toContain("deepseek-v4-pro");

    await user.click(trigger);
    await user.hover(
      await screen.findByRole("menuitem", { name: /Codex CLI/ }),
    );

    for (const modelId of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ]) {
      const item = await screen.findByRole("menuitem", {
        name: new RegExp(modelId),
      });
      expect(item.textContent).toContain(modelId);
      expect(item.textContent).not.toContain("deepseek-v4-pro");
    }
  });

  it("does not synthesize a missing Claude selected value as a fallback option", () => {
    render(
      <ModelSelect
        value="sonnet"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[]}
      />,
    );

    expect(screen.queryByText("sonnet")).toBeNull();
    expect(screen.getByRole("button").textContent ?? "").toContain("models.loading");
  });

  it("resolveAtomicSelectedModelDisplay uses executionTarget snapshot when catalog is empty", () => {
    const target: ExecutionTarget = {
      engine: "grok",
      providerProfileId: null,
      modelCatalogEntryId: "grok",
      model: "grok",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };

    const display = resolveAtomicSelectedModelDisplay(target, "grok", []);
    expect(display?.id).toBe("grok");
    expect(display?.model).toBe("grok");
  });

  it("resolveAtomicSelectedModelDisplay supports native-like target with catalog entry only", () => {
    // Native nativeSessionTarget 常见：catalog 未命中时 model runtime 仍可能为空，
    // 但 modelCatalogEntryId 已由 selectedModelId / nativeAtomicSelection 写入。
    const nativeLike: ExecutionTarget = {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.5",
      model: null,
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };
    const display = resolveAtomicSelectedModelDisplay(
      nativeLike,
      "gpt-5.5",
      [],
    );
    expect(display?.id).toBe("gpt-5.5");
    expect(display?.label).toBe("gpt-5.5");
  });

  it("resolveAtomicSelectedModelDisplay prefers catalog row when loaded", () => {
    const target: ExecutionTarget = {
      engine: "claude",
      providerProfileId: "kimi-k3",
      modelCatalogEntryId: "claude-sonnet-4-6",
      model: "kimi-k2.5",
      reasoning: null,
      providerProfileNameSnapshot: "kimi-k3",
      providerProfileSource: "managed",
    };
    const display = resolveAtomicSelectedModelDisplay(target, "claude-sonnet-4-6", [
      {
        id: "claude-sonnet-4-6",
        model: "kimi-k2.5",
        label: "Kimi friendly",
        providerProfileId: "kimi-k3",
      },
    ]);
    expect(display?.label).toBe("Kimi friendly");
    expect(display?.model).toBe("kimi-k2.5");
  });

  it("resolveAtomicSelectedModelDisplay returns null without model identity", () => {
    expect(
      resolveAtomicSelectedModelDisplay(
        {
          engine: "grok",
          providerProfileId: null,
          modelCatalogEntryId: null,
          model: null,
          reasoning: null,
          providerProfileNameSnapshot: "本地配置",
          providerProfileSource: "disk",
        },
        "",
        [],
      ),
    ).toBeNull();
  });

  it("shows shared grok executionTarget on closed trigger when catalog and parent models miss", () => {
    const executionTarget: ExecutionTarget = {
      engine: "grok",
      providerProfileId: null,
      modelCatalogEntryId: "grok",
      model: "grok",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "grok",
        providerLabel: "Grok CLI",
        enabled: true,
        profiles: [
          {
            id: "__local_config_toml__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [],
            loading: true,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: false,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="grok"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[
          { id: "claude-sonnet-4-6", label: "Sonnet" },
          { id: "claude-opus-4-6", label: "Opus" },
        ]}
        targetGroups={targetGroups}
        executionTarget={executionTarget}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";
    expect(buttonText).toContain("grok");
    expect(buttonText).not.toContain("models.selectModel");
    expect(buttonText).not.toContain("Sonnet");
  });

  it("keeps unselected closed trigger when atomic mode has no executionTarget model", () => {
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "grok",
        providerLabel: "Grok CLI",
        enabled: true,
        profiles: [
          {
            id: "__local_config_toml__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [],
            loading: false,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: false,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value=""
        currentProvider="grok"
        onChange={vi.fn()}
        models={[{ id: "global-other", label: "Other" }]}
        targetGroups={targetGroups}
        executionTarget={null}
      />,
    );

    expect(screen.getByRole("button").textContent ?? "").toContain(
      "models.loading",
    );
  });

  it("treats engine-only atomic target as empty selection, not loading", () => {
    expect(
      isAtomicEmptyModelSelection(
        {
          engine: "claude",
          providerProfileId: null,
          modelCatalogEntryId: null,
          model: null,
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: null,
          providerProfileSource: null,
        },
        "",
      ),
    ).toBe(true);
    expect(
      isAtomicEmptyModelSelection(
        {
          engine: "claude",
          providerProfileId: null,
          modelCatalogEntryId: "claude-sonnet-4-6",
          model: "claude-sonnet-4-6",
          reasoning: null,
          providerProfileNameSnapshot: "本地配置",
          providerProfileSource: "disk",
        },
        "",
      ),
    ).toBe(false);
  });

  it("keeps engine-only atomic target clickable instead of infinite loading", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "claude",
        providerLabel: "Claude Code",
        enabled: true,
        profiles: [
          {
            id: "__local_settings_json__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }],
            loading: false,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: false,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value=""
        currentProvider="claude"
        onChange={vi.fn()}
        targetGroups={targetGroups}
        executionTarget={{
          engine: "claude",
          providerProfileId: null,
          modelCatalogEntryId: null,
          model: null,
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: null,
          providerProfileSource: null,
        }}
        onExecutionTargetChange={onExecutionTargetChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "models.selectModel" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.getAttribute("data-model-loading")).toBeNull();
    expect(trigger.textContent ?? "").toContain("Claude Code");
    expect(trigger.textContent ?? "").not.toContain("models.loading");

    await user.click(trigger);
    expect(
      await screen.findByRole("menuitem", { name: /Claude Code/ }),
    ).toBeTruthy();
  });

  it("shows native codex selection from executionTarget when atomic catalog is still empty", () => {
    const executionTarget: ExecutionTarget = {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.5",
      model: null,
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "codex",
        providerLabel: "Codex CLI",
        enabled: true,
        profiles: [
          {
            id: "__disk__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [],
            loading: true,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: true,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="gpt-5.5"
        currentProvider="codex"
        onChange={vi.fn()}
        models={[]}
        targetGroups={targetGroups}
        executionTarget={executionTarget}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";
    expect(buttonText).toContain("gpt-5.5");
    expect(buttonText).not.toContain("models.selectModel");
  });

  it("renders settings-sourced Claude runtime models without legacy family relabeling", () => {
    render(
      <ModelSelect
        value="settings-opus"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[
          {
            id: "settings-opus",
            label: "MiniMax-M4[1m]",
            description: "Custom Opus model configured by ANTHROPIC_DEFAULT_OPUS_MODEL",
          },
        ]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("MiniMax-M4[1m]");
    expect(buttonText).not.toContain("Opus 4.6");
  });

  it("disables refresh config action while refreshing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ModelSelect
        value="claude-sonnet-4-6"
        currentProvider="claude"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onRefreshConfig={vi.fn()}
        isRefreshingConfig
        models={[{ id: "claude-sonnet-4-6", label: "Sonnet" }]}
      />,
    );

    await user.click(screen.getAllByRole("button")[0]);

    const refreshItem = await screen.findByRole("menuitem", {
      name: "models.refreshingConfig",
    });
    expect(refreshItem.getAttribute("data-disabled")).not.toBeNull();
  });

  it("keeps the dropdown usable when refresh config fails", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ModelSelect
        value="gemini-2.5-flash"
        currentProvider="gemini"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onRefreshConfig={vi.fn().mockRejectedValue(new Error("settings.json invalid"))}
        models={[{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }]}
      />,
    );

    await user.click(screen.getAllByRole("button")[0]);
    await user.click(await screen.findByRole("menuitem", { name: "models.refreshConfig" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("settings.json invalid");
    });

    expect(screen.getAllByText("Gemini 2.5 Flash").length).toBeGreaterThan(0);
  });
});
