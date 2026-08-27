// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { getConfigModel, getModelList } from "../../../services/tauri";
import { STORAGE_KEYS } from "../../composer/types/provider";
import {
  planComposerModelSelection,
  resolveModelEffort,
  useModels,
} from "./useModels";
import type { ModelOption } from "../../../types";

vi.mock("../../../services/tauri", () => ({
  getModelList: vi.fn(),
  getConfigModel: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "ccgui",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const workspaceTwo: WorkspaceInfo = {
  id: "workspace-2",
  name: "ccgui-2",
  path: "/tmp/codex-2",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useModels · D4-Live：用户模型锁不跨线程存活", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(async () => {
    cleanup();
    await Promise.resolve();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("切线程后旧线程的用户锁模型不再压制默认收敛（claude 线程点选 → 切 pi 线程）", async () => {
    vi.mocked(getModelList).mockResolvedValue({
      ok: true,
      result: {
        data: [
          {
            id: "kimi-coding/k3",
            model: "kimi-coding/k3",
            displayName: "K3",
            provider: null,
            protocol: null,
            provenance: null,
            observedAt: null,
            lastVerifiedAt: null,
            lifecycle: null,
            providerProfileId: null,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
          {
            id: "anthropic/claude-fable-5",
            model: "anthropic/claude-fable-5",
            displayName: "Claude Fable 5",
            provider: null,
            protocol: null,
            provenance: null,
            observedAt: null,
            lastVerifiedAt: null,
            lifecycle: null,
            providerProfileId: null,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const initialProps = { activeThreadId: "claude:thread-a" as string | null };
    const { result, rerender } = renderHook(
      ({ activeThreadId }) => useModels({ activeWorkspace: workspace, activeThreadId }),
      { initialProps },
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(0));

    // 用户在 claude 线程显式点选 claude 模型（用户锁 = true）
    await act(async () => {
      result.current.setSelectedModelId("anthropic/claude-fable-5");
    });
    await waitFor(() =>
      expect(result.current.selectedModelId).toBe("anthropic/claude-fable-5"),
    );

    // 切到 pi 线程：锁应被清理，selection 收敛回默认（kimi-coding/k3）
    await act(async () => {
      rerender({ activeThreadId: "pi:thread-b" });
    });
    await waitFor(() =>
      expect(result.current.selectedModelId).toBe("kimi-coding/k3"),
    );
  });
});

describe("useModels", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    await Promise.resolve();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("adds the config model when it is missing from model/list", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            provider: "provider-from-runtime",
            protocol: "custom-responses",
            provenance: "runtime:model/list",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModel?.model).toBe("custom-model"));

    expect(getConfigModel).toHaveBeenCalledWith("workspace-1");
    expect(result.current.models[0]).toMatchObject({
      id: "custom-model",
      model: "custom-model",
    });
    expect(result.current.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "remote-1",
          provider: "provider-from-runtime",
          protocol: "custom-responses",
          provenance: "runtime:model/list",
        }),
      ]),
    );
    expect(result.current.selectedModel?.model).toBe("custom-model");
    expect(result.current.reasoningSupported).toBe(false);
  });

  it("prefers the provider entry when the config model matches by slug", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "provider-id",
            model: "custom-model",
            displayName: "Provider Custom",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("provider-id"));

    expect(result.current.models[0]?.id).toBe("provider-id");
    expect(result.current.models.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(result.current.selectedModel?.id).toBe("provider-id");
    expect(result.current.reasoningSupported).toBe(true);
  });

  it("hydrates built-in Codex reasoning options when runtime metadata is empty", async () => {
    // 使用当前 generated catalog 内的模型 id，验证 runtime 空 metadata 会与 built-in 合并
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("gpt-5.5"));

    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(result.current.reasoningOptions).not.toContain("max");
    expect(result.current.selectedEffort).toBe("medium");
  });

  it("uses model-specific reasoning fallbacks when runtime hydration is degraded", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      data: [],
      degraded: true,
      runtimeAvailable: false,
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.6-sol");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("gpt-5.6-sol"));
    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(result.current.selectedEffort).toBe("low");

    act(() => result.current.setSelectedModelId("gpt-5.6-terra"));
    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);

    act(() => result.current.setSelectedModelId("gpt-5.6-luna"));
    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    act(() => result.current.setSelectedModelId("gpt-5.5"));
    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("replaces the startup fallback after runtime reasoning metadata arrives", async () => {
    const modelListRequest = createDeferred<{
      result: {
        data: Array<Record<string, unknown>>;
      };
    }>();
    vi.mocked(getModelList).mockReturnValueOnce(modelListRequest.promise);
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.6-sol");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("gpt-5.6-sol"));
    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);

    modelListRequest.resolve({
      result: {
        data: [
          {
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6-Sol",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
              { reasoningEffort: "xhigh", description: "Extra High" },
              { reasoningEffort: "max", description: "Max" },
              { reasoningEffort: "ultra", description: "Ultra" },
            ],
            defaultReasoningEffort: "low",
            isDefault: true,
          },
        ],
      },
    });

    await waitFor(() =>
      expect(result.current.reasoningOptions).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ]),
    );
    expect(result.current.selectedEffort).toBe("low");
  });

  it("keeps model-specific runtime reasoning metadata ahead of the common fallback", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6-Sol",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "max", description: "Max" },
              { reasoningEffort: "ultra", description: "Ultra" },
            ],
            defaultReasoningEffort: "low",
            isDefault: true,
          },
          {
            id: "gpt-5.6-terra",
            model: "gpt-5.6-terra",
            displayName: "GPT-5.6-Terra",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
              { reasoningEffort: "ultra", description: "Ultra" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
          {
            id: "gpt-5.6-luna",
            model: "gpt-5.6-luna",
            displayName: "GPT-5.6-Luna",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.6-sol");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() =>
      expect(result.current.reasoningOptions).toEqual(["low", "max", "ultra"]),
    );
    expect(result.current.models.slice(0, 3).map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(result.current.selectedModelId).toBe("gpt-5.6-sol");
    expect(result.current.selectedEffort).toBe("low");

    act(() => result.current.setSelectedModelId("gpt-5.6-terra"));

    await waitFor(() => expect(result.current.selectedModelId).toBe("gpt-5.6-terra"));
    expect(result.current.reasoningOptions).toEqual(["low", "medium", "high", "ultra"]);

    act(() => result.current.setSelectedModelId("gpt-5.6-luna"));

    await waitFor(() => expect(result.current.selectedModelId).toBe("gpt-5.6-luna"));
    expect(result.current.reasoningOptions).toEqual(["medium", "high"]);
  });

  it("normalizes runtime reasoning metadata when supported efforts are strings", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6-Sol",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
            defaultReasoningEffort: "high",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.6-sol");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.6-sol");
      expect(result.current.reasoningOptions).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(result.current.selectedEffort).toBe("high");
    });
  });

  it("keeps the selected reasoning effort when switching models", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.some((model) => model.id === "custom-model")).toBe(true));

    act(() => {
      result.current.setSelectedEffort("high");
      result.current.setSelectedModelId("custom-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("custom-model");
      expect(result.current.selectedEffort).toBe("high");
    });
  });

  it("keeps a user-selected custom Codex model in the selectable model set", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([{ id: "demo-model", label: "Demo" }]),
    );
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() =>
      expect(result.current.models.some((model) => model.id === "demo-model")).toBe(true),
    );

    act(() => {
      result.current.setSelectedModelId("demo-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("demo-model");
      expect(result.current.selectedModel?.displayName).toBe("Demo");
    });
  });

  it("waits for persisted composer settings before choosing the Codex default model", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([{ id: "demo-model", label: "Demo" }]),
    );
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    type HookProps = {
      preferredModelId: string | null;
      preferredSelectionReady: boolean;
    };
    const initialProps: HookProps = {
      preferredModelId: null,
      preferredSelectionReady: false,
    };

    const { result, rerender } = renderHook(
      ({ preferredModelId, preferredSelectionReady }: HookProps) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId,
          preferredSelectionReady,
        }),
      {
        initialProps,
      },
    );

    await waitFor(() =>
      expect(result.current.models.some((model) => model.id === "gpt-5.5")).toBe(true),
    );

    expect(result.current.selectedModelId).toBeNull();

    rerender({
      preferredModelId: "demo-model",
      preferredSelectionReady: true,
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("demo-model");
      expect(result.current.selectedModel?.displayName).toBe("Demo");
    });
  });

  it("ignores stale model responses after switching workspaces", async () => {
    const workspaceOneModels = createDeferred<Awaited<ReturnType<typeof getModelList>>>();
    const workspaceOneConfig = createDeferred<string | null>();

    vi.mocked(getModelList).mockImplementation((workspaceId: string) => {
      if (workspaceId === workspace.id) {
        return workspaceOneModels.promise;
      }
      return Promise.resolve({
        result: {
          data: [
            {
              id: "workspace-2-model",
              model: "workspace-2-model",
              displayName: "Workspace 2 Model",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
              isDefault: true,
            },
          ],
        },
      });
    });
    vi.mocked(getConfigModel).mockImplementation((workspaceId: string) => {
      if (workspaceId === workspace.id) {
        return workspaceOneConfig.promise;
      }
      return Promise.resolve("workspace-2-model");
    });

    const { result, rerender } = renderHook(
      ({ activeWorkspace }: { activeWorkspace: WorkspaceInfo }) =>
        useModels({ activeWorkspace }),
      {
        initialProps: {
          activeWorkspace: workspace,
        },
      },
    );

    await waitFor(() => {
      expect(getModelList).toHaveBeenCalledWith("workspace-1");
    });

    rerender({ activeWorkspace: workspaceTwo });

    await waitFor(() => {
      expect(result.current.selectedModel?.model).toBe("workspace-2-model");
    });

    await act(async () => {
      workspaceOneConfig.resolve("workspace-1-model");
      workspaceOneModels.resolve({
        result: {
          data: [
            {
              id: "workspace-1-model",
              model: "workspace-1-model",
              displayName: "Workspace 1 Model",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
              isDefault: true,
            },
          ],
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.selectedModel?.model).toBe("workspace-2-model");
    });
  });

  it("clears the previous workspace selection while the next workspace catalog is still loading", async () => {
    const workspaceOneModels = createDeferred<Awaited<ReturnType<typeof getModelList>>>();
    const workspaceOneConfig = createDeferred<string | null>();
    const workspaceTwoModels = createDeferred<Awaited<ReturnType<typeof getModelList>>>();
    const workspaceTwoConfig = createDeferred<string | null>();

    vi.mocked(getModelList).mockImplementation((workspaceId: string) => {
      if (workspaceId === workspace.id) {
        return workspaceOneModels.promise;
      }
      return workspaceTwoModels.promise;
    });
    vi.mocked(getConfigModel).mockImplementation((workspaceId: string) => {
      if (workspaceId === workspace.id) {
        return workspaceOneConfig.promise;
      }
      return workspaceTwoConfig.promise;
    });

    const { result, rerender } = renderHook(
      ({ activeWorkspace }: { activeWorkspace: WorkspaceInfo }) =>
        useModels({ activeWorkspace }),
      {
        initialProps: {
          activeWorkspace: workspace,
        },
      },
    );

    await act(async () => {
      workspaceOneConfig.resolve("workspace-1-model");
      workspaceOneModels.resolve({
        result: {
          data: [
            {
              id: "workspace-1-model",
              model: "workspace-1-model",
              displayName: "Workspace 1 Model",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
              isDefault: true,
            },
          ],
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.selectedModel?.model).toBe("workspace-1-model");
      expect(result.current.modelsReady).toBe(true);
    });

    rerender({ activeWorkspace: workspaceTwo });

    expect(result.current.selectedModelId).not.toBe("workspace-1-model");
    expect(result.current.selectedModel?.model).not.toBe("workspace-1-model");
    expect(result.current.modelsReady).toBe(false);
    expect(result.current.globalSelectionReady).toBe(false);
  });

  it("does not repeat active workspace refresh when model/list returns an empty catalog", async () => {
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        preferredSelectionReady: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.modelsReady).toBe(true);
    });

    expect(getModelList).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getModelList).toHaveBeenCalledTimes(1);
    expect(result.current.models.length).toBeGreaterThan(0);
  });

  it("keeps the initial catalog request through StrictMode effect replay", async () => {
    vi.mocked(getModelList).mockResolvedValue({
      result: { data: [] },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);
    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>{children}</StrictMode>
    );

    const { result } = renderHook(
      () =>
        useModels({
          activeWorkspace: workspace,
          preferredSelectionReady: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.modelsReady).toBe(true);
    });

    expect(getModelList).toHaveBeenCalledTimes(1);
    expect(getConfigModel).toHaveBeenCalledTimes(1);
  });

  it("does not repeat active workspace refresh when model/list fails without config fallback", async () => {
    vi.mocked(getModelList).mockRejectedValue(new Error("model/list failed"));
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        preferredSelectionReady: true,
      }),
    );

    await waitFor(() => {
      expect(getModelList).toHaveBeenCalledWith("workspace-1");
    });

    await waitFor(() => {
      expect(result.current.modelsReady).toBe(false);
      expect(result.current.globalSelectionReady).toBe(false);
    });

    expect(getModelList).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getModelList).toHaveBeenCalledTimes(1);
  });

  it("preserves the last-good runtime catalog when a refresh fails", async () => {
    vi.mocked(getModelList)
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              id: "runtime-model",
              model: "runtime-model",
              displayName: "Runtime Model",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
              isDefault: true,
            },
          ],
        },
      })
      .mockRejectedValueOnce(new Error("model/list failed"));
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );
    await waitFor(() =>
      expect(result.current.selectedModelId).toBe("runtime-model"),
    );

    await act(async () => {
      await result.current.refreshModels();
    });

    expect(result.current.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime-model",
          displayName: "Runtime Model",
          source: "cache:stale",
        }),
      ]),
    );
    expect(result.current.selectedModelId).toBe("runtime-model");
  });

  it("does not mark the global selection as ready when the workspace catalog request fails", async () => {
    vi.mocked(getModelList).mockRejectedValueOnce(new Error("model/list failed"));
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        preferredSelectionReady: true,
      }),
    );

    await waitFor(() => {
      expect(getModelList).toHaveBeenCalledWith("workspace-1");
    });

    await waitFor(() => {
      expect(result.current.globalSelectionReady).toBe(false);
      expect(result.current.modelsReady).toBe(false);
    });
  });

  it("converges effort when runtime metadata is empty but defaultReasoningEffort is set", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "runtime-only-model",
            model: "runtime-only-model",
            displayName: "Runtime Only",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        preferredModelId: null,
        preferredEffort: null,
        preferredSelectionReady: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("runtime-only-model");
      expect(result.current.selectedEffort).toBe("medium");
    });

    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });

    expect(result.current.selectedEffort).toBe("medium");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("converges on cold start when preferred model is missing and preferred effort is null", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        // 模拟跨引擎残留（如 Kimi k3）写入 lastComposerModelId 的冷启动形态
        preferredModelId: "k3",
        preferredEffort: null,
        preferredSelectionReady: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBeTruthy();
      expect(result.current.selectedEffort).toBe("medium");
    });

    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });

    expect(result.current.selectedEffort).toBe("medium");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("keeps an explicit preferred effort when supported reasoning list is empty", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "runtime-only-model",
            model: "runtime-only-model",
            displayName: "Runtime Only",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        preferredModelId: "runtime-only-model",
        preferredEffort: "high",
        preferredSelectionReady: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("runtime-only-model");
      expect(result.current.selectedEffort).toBe("high");
    });
  });

  it("keeps a user-selected effort when catalog preferred effort changes", async () => {
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "" },
              { reasoningEffort: "medium", description: "" },
              { reasoningEffort: "high", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result, rerender } = renderHook(
      ({ preferredEffort }: { preferredEffort: string | null }) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId: "gpt-5.5",
          preferredEffort,
          preferredSelectionReady: true,
        }),
      { initialProps: { preferredEffort: "medium" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
    });

    act(() => {
      result.current.setSelectedEffort("high");
    });
    expect(result.current.selectedEffort).toBe("high");

    rerender({ preferredEffort: "low" });

    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    });

    expect(result.current.selectedEffort).toBe("high");
  });

  it("does not exceed max update depth when preferred props thrash after converge", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "" },
              { reasoningEffort: "medium", description: "" },
              { reasoningEffort: "high", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result, rerender } = renderHook(
      ({
        preferredModelId,
        preferredEffort,
      }: {
        preferredModelId: string | null;
        preferredEffort: string | null;
      }) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId,
          preferredEffort,
          preferredSelectionReady: true,
        }),
      {
        initialProps: {
          preferredModelId: "gpt-5.5" as string | null,
          preferredEffort: "medium" as string | null,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
      expect(result.current.selectedEffort).toBe("medium");
    });

    // 模拟 persist 回写 preferred 与 selection 同值 / 轻微抖动
    for (let i = 0; i < 20; i += 1) {
      rerender({
        preferredModelId: "gpt-5.5",
        preferredEffort: i % 2 === 0 ? "medium" : "medium",
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(result.current.selectedModelId).toBe("gpt-5.5");
    expect(result.current.selectedEffort).toBe("medium");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("keeps freeform setSelectedModelId under thrashing preferred catalog ids", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result, rerender } = renderHook(
      ({ preferredModelId }: { preferredModelId: string | null }) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId,
          preferredEffort: null,
          preferredSelectionReady: true,
        }),
      { initialProps: { preferredModelId: "gpt-5.5" as string | null } },
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
    });

    act(() => {
      result.current.setSelectedModelId("user-freeform-model");
    });
    expect(result.current.selectedModelId).toBe("user-freeform-model");

    for (let i = 0; i < 15; i += 1) {
      rerender({ preferredModelId: i % 2 === 0 ? "gpt-5.5" : "k3" });
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(result.current.selectedModelId).toBe("user-freeform-model");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("converges on cold start when parent passes a new onDebug identity every render", async () => {
    // 生产 AppShell 的 addDebugEntry 可能非稳定；若进 layout deps 会每帧 apply → #185
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "" },
              { reasoningEffort: "high", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    let preferredModelId: string | null = "k3";
    let preferredEffort: string | null = null;
    let preferredSelectionReady = false;
    let renderCount = 0;

    const { result, rerender } = renderHook(() => {
      renderCount += 1;
      // 故意每帧新函数：模拟 AppShell 非稳定 onDebug
      const onDebug = () => {};
      return useModels({
        activeWorkspace: workspace,
        onDebug,
        preferredModelId,
        preferredEffort,
        preferredSelectionReady,
      });
    });

    // 模拟 settings 晚到 + preferred 脏值 + persist 回写
    preferredSelectionReady = true;
    rerender();

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
      expect(result.current.selectedEffort).toBe("medium");
    });

    preferredModelId = "gpt-5.5";
    preferredEffort = "medium";
    for (let i = 0; i < 30; i += 1) {
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(result.current.selectedModelId).toBe("gpt-5.5");
    expect(result.current.selectedEffort).toBe("medium");
    expect(renderCount).toBeLessThan(80);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("normalizes blank preferred identities so layout deps do not thrash", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result, rerender } = renderHook(
      ({
        preferredModelId,
        preferredEffort,
      }: {
        preferredModelId: string | null;
        preferredEffort: string | null;
      }) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId,
          preferredEffort,
          preferredSelectionReady: true,
        }),
      {
        initialProps: {
          preferredModelId: null as string | null,
          preferredEffort: null as string | null,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
    });

    for (let i = 0; i < 20; i += 1) {
      rerender({
        preferredModelId: i % 2 === 0 ? null : "",
        preferredEffort: i % 2 === 0 ? null : "   ",
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(result.current.selectedModelId).toBe("gpt-5.5");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("resolveModelEffort / planComposerModelSelection", () => {
  const emptySupportedModel: ModelOption = {
    id: "runtime-only",
    model: "runtime-only",
    displayName: "Runtime Only",
    description: "",
    source: "runtime",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: true,
  };

  const listedModel: ModelOption = {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "gpt-5.5",
    description: "",
    source: "catalog",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "medium", description: "" },
      { reasoningEffort: "high", description: "" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: true,
  };

  it("falls back to model default when preferred effort is null and supported list is empty", () => {
    expect(
      resolveModelEffort(emptySupportedModel, {
        preferCurrent: false,
        currentEffort: null,
        preferredEffort: null,
      }),
    ).toBe("medium");
  });

  it("prefers explicit preferred effort over model default when supported list is empty", () => {
    expect(
      resolveModelEffort(emptySupportedModel, {
        preferCurrent: false,
        currentEffort: null,
        preferredEffort: "high",
      }),
    ).toBe("high");
  });

  it("keeps current effort when preferCurrent is set", () => {
    expect(
      resolveModelEffort(listedModel, {
        preferCurrent: true,
        currentEffort: "high",
        preferredEffort: "low",
      }),
    ).toBe("high");
  });

  it("plans a stable selection that does not oscillate on repeated calls", () => {
    const input = {
      models: [emptySupportedModel],
      configModel: null,
      preferredModelId: "k3",
      preferredEffort: null as string | null,
      preferredSelectionReady: true,
      selectedModelId: null as string | null,
      selectedEffort: null as string | null,
      hasUserSelectedModel: false,
      hasUserSelectedEffort: false,
    };

    const first = planComposerModelSelection(input);
    expect(first).toEqual({
      nextModelId: "runtime-only",
      nextEffort: "medium",
      clearUserSelectedModel: false,
    });

    // 已收敛：再次规划必须返回 null，禁止等价 commit 叠满 update depth
    const second = planComposerModelSelection({
      ...input,
      selectedModelId: first?.nextModelId ?? null,
      selectedEffort: first?.nextEffort ?? null,
    });
    expect(second).toBeNull();

    const third = planComposerModelSelection({
      ...input,
      selectedModelId: first?.nextModelId ?? null,
      selectedEffort: first?.nextEffort ?? null,
    });
    expect(third).toBeNull();
  });

  it("returns null when selection already matches even if catalog-external dirty id was cleared", () => {
    // 脏 id 已纠正到 default 后：不得因 clear 语义反复产出非 null plan
    const plan = planComposerModelSelection({
      models: [listedModel],
      configModel: null,
      preferredModelId: "k3",
      preferredEffort: null,
      preferredSelectionReady: true,
      selectedModelId: "gpt-5.5",
      selectedEffort: "medium",
      hasUserSelectedModel: false,
      hasUserSelectedEffort: false,
    });
    expect(plan).toBeNull();
  });

  it("keeps freeform user selection out of catalog instead of clearing to default", () => {
    const plan = planComposerModelSelection({
      models: [listedModel],
      configModel: null,
      preferredModelId: "gpt-5.5",
      preferredEffort: "medium",
      preferredSelectionReady: true,
      selectedModelId: "my-freeform-model",
      selectedEffort: "high",
      hasUserSelectedModel: true,
      hasUserSelectedEffort: true,
    });
    // 用户锁 freeform：不得被 layout 清回 catalog default
    expect(plan).toBeNull();
  });

  it("does not oscillate when preferred effort flips after freeform lock", () => {
    const base = {
      models: [listedModel],
      configModel: null,
      preferredModelId: "gpt-5.5",
      preferredSelectionReady: true,
      selectedModelId: "gpt-5.5",
      selectedEffort: "high",
      hasUserSelectedModel: true,
      hasUserSelectedEffort: true,
    };
    const a = planComposerModelSelection({
      ...base,
      preferredEffort: "low",
    });
    const b = planComposerModelSelection({
      ...base,
      preferredEffort: "medium",
    });
    const c = planComposerModelSelection({
      ...base,
      preferredEffort: "low",
    });
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(c).toBeNull();
  });

  it("treats model-field selected id as already converged when next uses catalog id", () => {
    const dualIdentity: ModelOption = {
      ...listedModel,
      id: "catalog-id-gpt-5.5",
      model: "gpt-5.5",
    };
    const first = planComposerModelSelection({
      models: [dualIdentity],
      configModel: null,
      preferredModelId: null,
      preferredEffort: null,
      preferredSelectionReady: true,
      selectedModelId: "gpt-5.5",
      selectedEffort: "medium",
      hasUserSelectedModel: false,
      hasUserSelectedEffort: false,
    });
    // selected 用 model 字段命中；next 用 id — 应判已收敛，禁止反复 commit
    expect(first).toBeNull();
  });
});

  it("exposes mainstream default reasoning efforts for user-managed custom Codex models", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "my-custom-model",
          label: "My Custom Model",
          description: "user managed",
        },
      ]),
    );
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: { data: [] },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() =>
      expect(
        result.current.models.some((model) => model.id === "my-custom-model"),
      ).toBe(true),
    );

    act(() => result.current.setSelectedModelId("my-custom-model"));

    expect(result.current.selectedModel?.source).toBe("custom");
    expect(result.current.reasoningOptions).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(result.current.selectedEffort).toBe("medium");
  });
