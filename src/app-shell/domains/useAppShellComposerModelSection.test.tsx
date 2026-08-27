// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../features/collaboration/hooks/useCollaborationModeSelection", () => ({
  useCollaborationModeSelection: () => ({ collaborationModePayload: null }),
}));
vi.mock("../../features/composer/hooks/useComposerMenuActions", () => ({
  useComposerMenuActions: () => {},
}));
vi.mock("../../features/composer/hooks/useComposerShortcuts", () => ({
  useComposerShortcuts: () => {},
}));
vi.mock("../../features/app/hooks/usePersistComposerSettings", () => ({
  usePersistComposerSettings: () => {},
}));

import { useAppShellComposerModelSection } from "./useAppShellComposerModelSection";

function makeModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    model: id,
    displayName: id,
    description: "",
    source: "test",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: false,
    ...overrides,
  };
}

const claudeModels = [
  makeModel("claude-opus-4-8", { isDefault: true }),
  makeModel("claude-sonnet-4-6"),
];
const kimiModels = [
  makeModel("kimi-code/k3", { isDefault: true }),
  makeModel("kimi-code/kimi-for-coding"),
];

function renderSection(overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useAppShellComposerModelSection({
      accessMode: "auto",
      activeEngine: "claude",
      activeThreadId: null,
      activeWorkspaceId: null,
      appSettings: {},
      appSettingsLoading: false,
      applySelectedCollaborationMode: vi.fn(),
      collaborationModes: [],
      composerInputRef: { current: null },
      composerSelectionResolverRef: { current: null },
      engineModelCatalogsAsOptions: { kimi: kimiModels },
      engineModelsAsOptions: claudeModels,
      globalSelectionReady: true,
      handleSelectComposerSelection: vi.fn(),
      handleSetAccessMode: vi.fn(),
      models: [],
      modelsReady: true,
      persistComposerEnginePref: vi.fn(),
      persistComposerSelectionForThread: vi.fn(),
      queueSaveSettings: vi.fn(),
      selectedCollaborationMode: null,
      selectedCollaborationModeId: null,
      selectedComposerSelection: null,
      selectedEffort: null,
      selectedModelId: null,
      setAppSettings: vi.fn(),
      setSelectedEffort: vi.fn(),
      setSelectedModelId: vi.fn(),
      ...overrides,
    }),
  );
}

describe("useAppShellComposerModelSection handleSelectModel", () => {
  it("uses the bound Codex provider catalog instead of the global model list", () => {
    const providerModels = [
      makeModel("provider-a-model", { providerProfileId: "provider-a" }),
      makeModel("gpt-public"),
    ];
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: providerModels,
      models: [makeModel("global-default-model")],
    });

    expect(result.current.effectiveModels.map((model) => model.id)).toEqual([
      "provider-a-model",
      "gpt-public",
    ]);
    expect(
      result.current.effectiveModels.some(
        (model) => model.id === "global-default-model",
      ),
    ).toBe(false);
  });

  it("inherits Codex reasoning metadata without replacing provider-owned facts", () => {
    const supportedReasoningEfforts = [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "high", description: "High" },
    ];
    const providerModel = makeModel("gpt-5.6-sol", {
      model: " GPT-5.6-SOL ",
      displayName: "Provider GPT",
      providerProfileId: "provider-a",
      source: "provider-custom",
      isDefault: true,
    });
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [providerModel],
      models: [
        makeModel("gpt-5.6-sol", {
          supportedReasoningEfforts,
          defaultReasoningEffort: "high",
        }),
      ],
      selectedComposerSelection: {
        modelId: "gpt-5.6-sol",
        effort: "high",
      },
    });

    expect(result.current.effectiveModels[0]).toEqual({
      ...providerModel,
      supportedReasoningEfforts,
      defaultReasoningEffort: "high",
    });
    expect(result.current.effectiveReasoningOptions).toEqual(["low", "high"]);
    expect(result.current.effectiveSelectedEffort).toBe("high");
  });

  it("projects model-specific reasoning metadata into a Native Codex session", () => {
    const supportedReasoningEfforts = [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ].map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    }));
    const composerSelectionResolverRef: { current: unknown } = { current: null };
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-native",
      activeProviderProfileId: null,
      composerSelectionResolverRef,
      models: [
        makeModel("gpt-5.6-sol", {
          supportedReasoningEfforts,
          defaultReasoningEffort: "low",
          isDefault: true,
        }),
      ],
      selectedComposerSelection: {
        modelId: "gpt-5.6-sol",
        effort: "ultra",
      },
    });

    expect(result.current.effectiveReasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(result.current.effectiveSelectedEffort).toBe("ultra");
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      effort: "ultra",
    });
  });

  it("keeps explicit provider reasoning metadata authoritative", () => {
    const providerReasoning = [
      { reasoningEffort: "medium", description: "Provider medium" },
    ];
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [
        makeModel("gpt-5.6-sol", {
          providerProfileId: "provider-a",
          supportedReasoningEfforts: providerReasoning,
          defaultReasoningEffort: "medium",
          isDefault: true,
        }),
      ],
      models: [
        makeModel("gpt-5.6-sol", {
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "Global high" },
          ],
          defaultReasoningEffort: "high",
        }),
      ],
    });

    expect(result.current.effectiveModels[0]?.supportedReasoningEfforts).toBe(
      providerReasoning,
    );
    expect(result.current.effectiveModels[0]?.defaultReasoningEffort).toBe(
      "medium",
    );
  });

  it("does not infer reasoning support for an unknown provider-only Codex model", () => {
    const persistComposerSelectionForThread = vi.fn();
    const providerModel = makeModel("provider-only-model", {
      providerProfileId: "provider-a",
      isDefault: true,
    });
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [providerModel],
      models: [makeModel("gpt-public")],
      persistComposerSelectionForThread,
      selectedComposerSelection: {
        modelId: "provider-only-model",
        effort: "high",
      },
    });

    expect(result.current.effectiveModels[0]).toBe(providerModel);
    expect(result.current.effectiveSelectedModelId).toBe("provider-only-model");
    expect(result.current.effectiveReasoningOptions).toEqual([]);
    expect(result.current.effectiveReasoningSupported).toBe(false);
    expect(result.current.effectiveSelectedEffort).toBeNull();
    expect(persistComposerSelectionForThread).toHaveBeenCalledOnce();
    expect(persistComposerSelectionForThread).toHaveBeenCalledWith(
      null,
      "codex-thread-1",
      {
        modelId: "provider-only-model",
        effort: null,
      },
    );
  });

  it("does not persist Codex repair onto a Claude thread during the switch window", () => {
    const persistComposerSelectionForThread = vi.fn();
    renderSection({
      activeEngine: "codex",
      activeThreadId: "claude:session-1",
      persistComposerSelectionForThread,
      models: [makeModel("gpt-5.5", { isDefault: true })],
      selectedComposerSelection: {
        modelId: "claude-sonnet-4-6",
        effort: null,
      },
    });
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("does not persist Codex repair onto a DSH thread during the switch window", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "dsh:session-1",
      activeWorkspaceId: "workspace-1",
      persistComposerSelectionForThread,
      models: [makeModel("gpt-5.5", { isDefault: true })],
      engineModelsAsOptions: [],
      selectedComposerSelection: {
        modelId: "gork-zhu/grok-4.6",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("gork-zhu/grok-4.6");
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });


  it("D1红/绿裁决：同引擎（codex→codex）切换窗口不得把上一线程模型写进目标线程账本", () => {
    const persistComposerSelectionForThread = vi.fn();
    renderSection({
      activeEngine: "codex",
      activeThreadId: "thread-local-codex-B",
      // 账本同步标志仍指向线程 A：切换窗口（reload 未 commit B 前）
      selectedComposerSelectionThreadId: "thread-local-codex-A",
      persistComposerSelectionForThread,
      // 共享 codex catalog 同时含 A/B 两线程的模型（modelsReady=true）
      models: [
        makeModel("model-from-A"),
        makeModel("model-of-B", { isDefault: true }),
      ],
      // 切换窗口：selectedComposerSelection 仍是线程 A 的账本值（reload 未 commit B 前的渲染帧）
      selectedComposerSelection: {
        modelId: "model-from-A",
        effort: "high",
      },
    });
    // 期望（现状可疑为红）：不产生任何 repair 写入
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("D3红/绿裁决：目标线程账本 miss + 全局残留（上一线程模型）时不得经 repair 固化", () => {
    const persistComposerSelectionForThread = vi.fn();
    renderSection({
      activeEngine: "codex",
      activeThreadId: "thread-local-codex-C",
      persistComposerSelectionForThread,
      models: [makeModel("model-from-A"), makeModel("default-codex", { isDefault: true })],
      // B/C 线程无自身账本：selectedComposerSelection=null（已切到位）
      selectedComposerSelection: null,
      // useModels 全局残留 = 上一线程 A 的模型
      selectedModelId: "model-from-A",
      selectedEffort: "high",
    });
    // 期望：账本为 null 的线程不得被全局残留种入（engine default 才是合法种入路径，
    // 且仅 pending 线程；本线程为已定稿本地 codex 线程）
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("still runs Codex repair on an unprefixed local thread without rewriting unknown ids", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "thread-local-codex",
      persistComposerSelectionForThread,
      models: [makeModel("gpt-5.5", { isDefault: true })],
      selectedComposerSelection: {
        modelId: "custom-codex-spark",
        effort: "high",
      },
    });
    // Codex allowUnknown keeps freeform ids; repair may still persist effort
    // onto the unprefixed thread. The DSH skip must not swallow this path.
    expect(result.current.effectiveSelectedModelId).toBe("custom-codex-spark");
    expect(persistComposerSelectionForThread).toHaveBeenCalledWith(
      null,
      "thread-local-codex",
      {
        modelId: "custom-codex-spark",
        effort: null,
      },
    );
  });

  it("keeps a DSH ledger id when the leftover catalog is another engine", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "dsh",
      activeThreadId: "dsh:session-1",
      persistComposerSelectionForThread,
      engineModelsAsOptions: [makeModel("gpt-5.5", { isDefault: true })],
      selectedComposerSelection: {
        modelId: "gork-zhu/grok-4.6",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("gork-zhu/grok-4.6");
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("keeps a provider-only Codex selection without model repair", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-minimax",
      activeWorkspaceId: "workspace-1",
      activeProviderProfileId: "minimax",
      engineModelsAsOptions: [],
      models: [makeModel("gpt-5.6-sol", { isDefault: true })],
      persistComposerSelectionForThread,
      selectedComposerSelection: {
        modelId: "MiniMax-M3",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("MiniMax-M3");
    expect(result.current.resolvedModel).toBe("MiniMax-M3");
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("keeps Claude provider-bound reasoning options independent of model metadata", () => {
    const { result } = renderSection({
      activeEngine: "claude",
      activeThreadId: "claude-thread-1",
      activeProviderProfileId: "provider-a",
      engineModelsAsOptions: [
        makeModel("claude-provider-model", {
          providerProfileId: "provider-a",
          isDefault: true,
        }),
      ],
      selectedComposerSelection: {
        modelId: "claude-provider-model",
        effort: "xhigh",
      },
    });

    expect(result.current.effectiveReasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(result.current.effectiveReasoningSupported).toBe(true);
    expect(result.current.effectiveSelectedEffort).toBe("xhigh");
  });

  it("keeps an arbitrary Claude provider model while its catalog is unavailable", () => {
    const persistComposerSelectionForThread = vi.fn();
    const { result } = renderSection({
      activeEngine: "claude",
      activeThreadId: "claude-thread-minimax",
      activeWorkspaceId: "workspace-1",
      activeProviderProfileId: "minimax",
      engineModelsAsOptions: [],
      persistComposerSelectionForThread,
      selectedComposerSelection: {
        modelId: "MiniMax-M2.5",
        effort: "high",
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("MiniMax-M2.5");
    expect(result.current.resolvedModel).toBe("MiniMax-M2.5");
    expect(result.current.effectiveSelectedEffort).toBe("high");
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("stores cross-engine picks under the owning engine and persists its pref", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const setSelectedModelId = vi.fn();
    const { result } = renderSection({
      persistComposerEnginePref,
      handleSelectComposerSelection,
      setSelectedModelId,
    });

    act(() => {
      result.current.handleSelectModel("kimi-code/kimi-for-coding");
    });

    expect(result.current.engineSelectedModelIdByType.kimi).toBe(
      "kimi-code/kimi-for-coding",
    );
    // effort:null must not be written — would wipe a remembered high on that engine.
    expect(persistComposerEnginePref).toHaveBeenCalledWith("kimi", {
      modelId: "kimi-code/kimi-for-coding",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "kimi-code/kimi-for-coding",
      effort: null,
    });
    expect(setSelectedModelId).not.toHaveBeenCalled();
  });

  it("keeps a DSH runtime pick on DSH when another CLI catalog uses the same id", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const dshModels = [
      makeModel("ggggg/grok-4.6", { model: "grok-4.6", isDefault: true }),
      makeModel("acme/claude-sonnet-4-6", { model: "claude-sonnet-4-6" }),
    ];
    const { result } = renderSection({
      activeEngine: "dsh",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      engineModelsAsOptions: dshModels,
      engineModelCatalogsAsOptions: {
        grok: [makeModel("grok-4.6", { isDefault: true })],
        claude: claudeModels,
        kimi: kimiModels,
      },
    });

    act(() => {
      result.current.handleSelectModel("grok-4.6");
    });

    expect(result.current.engineSelectedModelIdByType.dsh).toBe("ggggg/grok-4.6");
    expect(result.current.engineSelectedModelIdByType.grok).toBeUndefined();
    expect(persistComposerEnginePref).toHaveBeenCalledWith("dsh", {
      modelId: "ggggg/grok-4.6",
    });

    act(() => {
      result.current.handleSelectModel("claude-sonnet-4-6");
    });

    expect(result.current.engineSelectedModelIdByType.dsh).toBe(
      "acme/claude-sonnet-4-6",
    );
    expect(persistComposerEnginePref).toHaveBeenCalledWith("dsh", {
      modelId: "acme/claude-sonnet-4-6",
    });
    expect(handleSelectComposerSelection).toHaveBeenLastCalledWith({
      modelId: "acme/claude-sonnet-4-6",
      effort: null,
    });
  });

  it("keeps same-engine selection behavior unchanged", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const { result } = renderSection({
      persistComposerEnginePref,
      handleSelectComposerSelection,
    });

    act(() => {
      result.current.handleSelectModel("claude-sonnet-4-6");
    });

    expect(result.current.engineSelectedModelIdByType.claude).toBe(
      "claude-sonnet-4-6",
    );
    expect(persistComposerEnginePref).toHaveBeenCalledWith("claude", {
      modelId: "claude-sonnet-4-6",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "claude-sonnet-4-6",
      effort: null,
    });
  });

  it("does not persist effort:null when selecting a Grok model with no thread effort", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const grokModels = [
      makeModel("grok-4.5", { isDefault: true }),
      makeModel("grok-4"),
    ];
    const { result } = renderSection({
      activeEngine: "grok",
      activeThreadId: "grok-pending-1",
      engineModelsAsOptions: grokModels,
      selectedComposerSelection: { modelId: "grok-4.5", effort: null },
      persistComposerEnginePref,
      handleSelectComposerSelection,
    });

    act(() => {
      result.current.handleSelectModel("grok-4");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("grok", {
      modelId: "grok-4",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "grok-4",
      effort: null,
    });
  });

  it("still persists a concrete effort when model select carries one", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const { result } = renderSection({
      activeEngine: "claude",
      activeThreadId: "claude-pending-1",
      selectedComposerSelection: {
        modelId: "claude-opus-4-8",
        effort: "high",
      },
      persistComposerEnginePref,
      handleSelectComposerSelection,
    });

    act(() => {
      result.current.handleSelectModel("claude-sonnet-4-6");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("claude", {
      modelId: "claude-sonnet-4-6",
      effort: "high",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "claude-sonnet-4-6",
      effort: "high",
    });
  });

  it("accepts freeform model ids not present in engine catalogs", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const setSelectedModelId = vi.fn();
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-local",
      activeProviderProfileId: null,
      persistComposerEnginePref,
      handleSelectComposerSelection,
      setSelectedModelId,
    });

    act(() => {
      result.current.handleSelectModel("gpt-5.3-codex-spark");
    });

    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "gpt-5.3-codex-spark",
      effort: null,
    });
    // Active codex thread keeps global selectedModelId for draft-less path only.
    expect(setSelectedModelId).not.toHaveBeenCalled();
  });

  it("keeps a Native custom Codex model capability-neutral", () => {
    const composerSelectionResolverRef: { current: unknown } = { current: null };
    const { result } = renderSection({
      activeEngine: "codex",
      activeThreadId: "codex-thread-native-custom",
      activeProviderProfileId: null,
      composerSelectionResolverRef,
      models: [makeModel("gpt-5.6-sol", { isDefault: true })],
      selectedComposerSelection: {
        modelId: "gpt-5.3-codex-spark",
        effort: null,
      },
    });

    expect(result.current.effectiveSelectedModelId).toBe("gpt-5.3-codex-spark");
    expect(result.current.effectiveSelectedModel).toBeNull();
    expect(result.current.effectiveReasoningOptions).toEqual([]);
    expect(result.current.effectiveReasoningSupported).toBe(false);
    expect(result.current.effectiveSelectedEffort).toBeNull();
    expect(result.current.resolvedModel).toBe("gpt-5.3-codex-spark");
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "gpt-5.3-codex-spark",
      model: "gpt-5.3-codex-spark",
      effort: null,
    });
  });

  it("writes resolver on the same tick as handleSelectModel", () => {
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "claude-opus-4-8",
        model: "claude-opus-4-8",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "claude",
      activeThreadId: "claude-thread-send",
      composerSelectionResolverRef,
      selectedComposerSelection: {
        modelId: "claude-opus-4-8",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("claude-sonnet-4-6");
      expect(composerSelectionResolverRef.current).toMatchObject({
        id: "claude-sonnet-4-6",
        model: "claude-sonnet-4-6",
      });
    });
  });

  it("keeps a user-clicked residual-shaped runtime instead of same-tick catalog repair", () => {
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "claude-opus-4-8",
        model: "claude-opus-4-8",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result, rerender } = renderHook(
      ({ selectedComposerSelection }) =>
        useAppShellComposerModelSection({
          accessMode: "auto",
          activeEngine: "claude",
          activeThreadId: "claude-thread-freeform",
          activeWorkspaceId: "workspace-1",
          appSettings: {},
          appSettingsLoading: false,
          applySelectedCollaborationMode: vi.fn(),
          collaborationModes: [],
          composerInputRef: { current: null },
          composerSelectionResolverRef,
          engineModelCatalogsAsOptions: { kimi: kimiModels },
          engineModelsAsOptions: claudeModels,
          globalSelectionReady: true,
          handleSelectComposerSelection: vi.fn(),
          handleSetAccessMode: vi.fn(),
          models: [],
          modelsReady: true,
          persistComposerEnginePref: vi.fn(),
          persistComposerSelectionForThread: vi.fn(),
          queueSaveSettings: vi.fn(),
          selectedCollaborationMode: null,
          selectedCollaborationModeId: null,
          selectedComposerSelection,
          selectedEffort: null,
          selectedModelId: null,
          setAppSettings: vi.fn(),
          setSelectedEffort: vi.fn(),
          setSelectedModelId: vi.fn(),
        }),
      {
        initialProps: {
          selectedComposerSelection: {
            modelId: "claude-opus-4-8",
            effort: null,
          },
        },
      },
    );

    act(() => {
      result.current.handleSelectModel("k3");
      expect(composerSelectionResolverRef.current).toMatchObject({
        id: "k3",
        model: "k3",
      });
    });

    rerender({
      selectedComposerSelection: {
        modelId: "k3",
        effort: null,
      },
    });

    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "k3",
      model: "k3",
    });
    expect(result.current.resolvedModel).not.toBe("k3");
  });

  it("does not write a foreign ccgui catalog onto a DSH thread ledger", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const persistComposerSelectionForThread = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "ggggg/grok-4.6",
        model: "grok-4.6",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const dshModels = [
      makeModel("ggggg/grok-4.6", { model: "grok-4.6", isDefault: true }),
    ];
    const { result } = renderSection({
      activeEngine: "dsh",
      activeThreadId: "dsh:session-1",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      persistComposerSelectionForThread,
      composerSelectionResolverRef,
      engineModelsAsOptions: dshModels,
      engineModelCatalogsAsOptions: {
        grok: [makeModel("ccgui/grok-4.5", { isDefault: true })],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "ggggg/grok-4.6",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("ccgui/grok-4.5");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("grok", {
      modelId: "ccgui/grok-4.5",
    });
    expect(result.current.engineSelectedModelIdByType.grok).toBe(
      "ccgui/grok-4.5",
    );
    expect(result.current.engineSelectedModelIdByType.dsh).toBe(
      "ggggg/grok-4.6",
    );
    expect(handleSelectComposerSelection).not.toHaveBeenCalled();
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "ggggg/grok-4.6",
      model: "grok-4.6",
    });
  });

  it("skips the DSH ledger even when activeEngine already drifted to grok", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const persistComposerSelectionForThread = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "ggggg/grok-4.6",
        model: "grok-4.6",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "grok",
      activeThreadId: "dsh:session-1",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      persistComposerSelectionForThread,
      composerSelectionResolverRef,
      engineModelsAsOptions: [
        makeModel("ccgui/grok-4.5", { isDefault: true }),
      ],
      engineModelCatalogsAsOptions: {
        grok: [makeModel("ccgui/grok-4.5", { isDefault: true })],
        dsh: [makeModel("ggggg/grok-4.6", { model: "grok-4.6", isDefault: true })],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "ggggg/grok-4.6",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("ccgui/grok-4.5");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("grok", {
      modelId: "ccgui/grok-4.5",
    });
    expect(handleSelectComposerSelection).not.toHaveBeenCalled();
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
    expect(result.current.engineSelectedModelIdByType.dsh).not.toBe(
      "ccgui/grok-4.5",
    );
  });

  it("still writes a DSH catalog pick onto a DSH thread when activeEngine drifted", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "ggggg/grok-4.6",
        model: "grok-4.6",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "grok",
      activeThreadId: "dsh:session-1",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      composerSelectionResolverRef,
      engineModelsAsOptions: [
        makeModel("ccgui/grok-4.5", { isDefault: true }),
      ],
      engineModelCatalogsAsOptions: {
        grok: [makeModel("ccgui/grok-4.5", { isDefault: true })],
        dsh: [
          makeModel("ggggg/grok-4.6", { model: "grok-4.6", isDefault: true }),
        ],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "ccgui/grok-4.5",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("ggggg/grok-4.6");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("dsh", {
      modelId: "ggggg/grok-4.6",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "ggggg/grok-4.6",
      effort: null,
    });
    expect(result.current.engineSelectedModelIdByType.dsh).toBe(
      "ggggg/grok-4.6",
    );
  });

  it("writes an official DSH kimi catalog onto a DSH thread even when PI owns the same id", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "deepseek-official/deepseek-v4-flash",
        model: "deepseek-v4-flash",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "dsh",
      activeThreadId: "dsh:session-1",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      composerSelectionResolverRef,
      engineModelsAsOptions: [
        makeModel("deepseek-official/deepseek-v4-flash", {
          model: "deepseek-v4-flash",
          isDefault: true,
        }),
        makeModel("kimi-coding/k3", { model: "k3" }),
      ],
      engineModelCatalogsAsOptions: {
        dsh: [
          makeModel("deepseek-official/deepseek-v4-flash", {
            model: "deepseek-v4-flash",
            isDefault: true,
          }),
          makeModel("kimi-coding/k3", { model: "k3" }),
        ],
        pi: [makeModel("kimi-coding/k3", { model: "kimi-coding/k3" })],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("kimi-coding/k3");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("dsh", {
      modelId: "kimi-coding/k3",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "kimi-coding/k3",
      effort: null,
    });
    expect(result.current.engineSelectedModelIdByType.dsh).toBe(
      "kimi-coding/k3",
    );
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "kimi-coding/k3",
      model: "k3",
    });
  });

  it("keeps an official DSH minimax pick on the DSH ledger when host catalog is empty", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "gork-zhu/grok-4.6",
        model: "grok-4.6",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "dsh",
      activeThreadId: "dsh:session-1",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      composerSelectionResolverRef,
      engineModelsAsOptions: [],
      engineModelCatalogsAsOptions: {
        pi: [makeModel("minimax-cn/MiniMax-M2.7")],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "gork-zhu/grok-4.6",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("minimax-cn/MiniMax-M2.7");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("dsh", {
      modelId: "minimax-cn/MiniMax-M2.7",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "minimax-cn/MiniMax-M2.7",
      effort: null,
    });
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "minimax-cn/MiniMax-M2.7",
    });
  });

  it("writes a later official OpenAI host route onto a DSH thread without an allowlist", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "deepseek-official/deepseek-v4-flash",
        model: "deepseek-v4-flash",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "dsh",
      activeThreadId: "dsh:session-1",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      composerSelectionResolverRef,
      engineModelsAsOptions: [
        makeModel("deepseek-official/deepseek-v4-flash", {
          model: "deepseek-v4-flash",
          isDefault: true,
        }),
        makeModel("openai/gpt-5", { model: "gpt-5" }),
      ],
      engineModelCatalogsAsOptions: {
        dsh: [
          makeModel("deepseek-official/deepseek-v4-flash", {
            model: "deepseek-v4-flash",
            isDefault: true,
          }),
          makeModel("openai/gpt-5", { model: "gpt-5" }),
        ],
        pi: [makeModel("openai/gpt-5", { model: "openai/gpt-5" })],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "deepseek-official/deepseek-v4-flash",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("openai/gpt-5");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("dsh", {
      modelId: "openai/gpt-5",
    });
    expect(handleSelectComposerSelection).toHaveBeenCalledWith({
      modelId: "openai/gpt-5",
      effort: null,
    });
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "openai/gpt-5",
      model: "gpt-5",
    });
  });

  it("does not write a foreign ccgui catalog onto a pending DSH thread", () => {
    const persistComposerEnginePref = vi.fn();
    const handleSelectComposerSelection = vi.fn();
    const persistComposerSelectionForThread = vi.fn();
    const composerSelectionResolverRef: { current: unknown } = {
      current: {
        id: "ggggg/grok-4.6",
        model: "grok-4.6",
        source: "test",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      },
    };
    const { result } = renderSection({
      activeEngine: "dsh",
      activeThreadId: "dsh-pending-abc",
      persistComposerEnginePref,
      handleSelectComposerSelection,
      persistComposerSelectionForThread,
      composerSelectionResolverRef,
      engineModelsAsOptions: [
        makeModel("ggggg/grok-4.6", { model: "grok-4.6", isDefault: true }),
      ],
      engineModelCatalogsAsOptions: {
        grok: [makeModel("ccgui/grok-4.5", { isDefault: true })],
        claude: claudeModels,
        kimi: kimiModels,
      },
      selectedComposerSelection: {
        modelId: "ggggg/grok-4.6",
        effort: null,
      },
    });

    act(() => {
      result.current.handleSelectModel("ccgui/grok-4.5");
    });

    expect(persistComposerEnginePref).toHaveBeenCalledWith("grok", {
      modelId: "ccgui/grok-4.5",
    });
    expect(handleSelectComposerSelection).not.toHaveBeenCalled();
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
    expect(composerSelectionResolverRef.current).toMatchObject({
      id: "ggggg/grok-4.6",
      model: "grok-4.6",
    });
  });
});
