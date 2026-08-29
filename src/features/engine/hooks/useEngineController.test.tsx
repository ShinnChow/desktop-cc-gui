// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEngineController } from "./useEngineController";
import {
  detectEngines,
  getActiveEngine,
  getEngineModels,
  isWebServiceRuntime,
  runCodexDoctor,
  switchEngine,
} from "../../../services/tauri";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type { DebugEntry, EngineStatus } from "../../../types";
import { STORAGE_KEYS as MODEL_STORAGE_KEYS } from "../../models/constants";
import { STORAGE_KEYS as PROVIDER_STORAGE_KEYS } from "../../composer/types/provider";
import { startupOrchestrator } from "../../startup-orchestration/utils/startupOrchestrator";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock("../../../services/tauri", () => ({
  detectEngines: vi.fn(),
  getActiveEngine: vi.fn(),
  getEngineModels: vi.fn(),
  isWebServiceRuntime: vi.fn(),
  runCodexDoctor: vi.fn(),
  switchEngine: vi.fn(),
}));
vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));
const engineStatusEventListeners = new Set<
  (event: {
    detectRunId: number;
    status: EngineStatus;
  }) => void
>();
const requestEngineDetectionMock = vi.fn();
vi.mock("./engineDetectionCoordinator", () => ({
  requestEngineDetection: (options: unknown) =>
    requestEngineDetectionMock(options),
}));
vi.mock("../../../services/tauri/appServer", () => ({
  subscribeEngineStatusEvents: vi.fn(
    (
      listener: (event: { detectRunId: number; status: EngineStatus }) => void,
    ) => {
      engineStatusEventListeners.add(listener);
      return () => {
        engineStatusEventListeners.delete(listener);
      };
    },
  ),
}));

function emitEngineStatusEvent(event: {
  detectRunId: number;
  status: EngineStatus;
}): void {
  engineStatusEventListeners.forEach((listener) => listener(event));
}

const detectEnginesMock = vi.mocked(detectEngines);
const getActiveEngineMock = vi.mocked(getActiveEngine);
const getEngineModelsMock = vi.mocked(getEngineModels);
const isWebServiceRuntimeMock = vi.mocked(isWebServiceRuntime);
const runCodexDoctorMock = vi.mocked(runCodexDoctor);
const switchEngineMock = vi.mocked(switchEngine);
const getClientStoreSyncMock = vi.mocked(getClientStoreSync);
const writeClientStoreValueMock = vi.mocked(writeClientStoreValue);

function createEngineStatus(
  engineType: EngineStatus["engineType"],
  installed: boolean,
  models: EngineStatus["models"] = [],
): EngineStatus {
  return {
    engineType,
    installed,
    version: installed ? "1.0.0" : null,
    binPath: null,
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    },
    models,
    error: installed ? null : "not installed",
  };
}

describe("useEngineController", () => {
  beforeEach(() => {
  engineStatusEventListeners.clear();
  requestEngineDetectionMock.mockImplementation(
    (options: { force?: boolean } | undefined) => {
      void options;
      return detectEnginesMock();
    },
  );    vi.clearAllMocks();
    window.localStorage.clear();
    isWebServiceRuntimeMock.mockReturnValue(false);
    switchEngineMock.mockResolvedValue(undefined);
    runCodexDoctorMock.mockResolvedValue({
      ok: false,
      codexBin: null,
      version: null,
      appServerOk: false,
      details: "not found",
      path: null,
      nodeOk: true,
      nodeVersion: "v20.0.0",
      nodeDetails: null,
    });
    getClientStoreSyncMock.mockReturnValue(undefined);
    writeClientStoreValueMock.mockReset();
  });

  it("preserves default flag when custom claude model overrides same id", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
      {
        id: "claude-haiku-4-5",
        displayName: "Haiku 4.5",
        description: "",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "claude-sonnet-4-6",
          label: "Custom Sonnet Alias",
          description: "custom",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const sonnet = result.current.engineModelsAsOptions.find(
      (model) => model.id === "claude-sonnet-4-6",
    );
    expect(sonnet).toBeDefined();
    expect(sonnet?.displayName).toBe("Custom Sonnet Alias");
    expect(sonnet?.isDefault).toBe(true);
  });

  it("passes custom Claude model values through the runtime model field", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([{ id: "Cxn[1m]", label: "Cxn[1m]", description: "custom 1m" }]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const customModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "Cxn[1m]",
    );
    expect(customModel).toBeDefined();
    expect(customModel?.displayName).toBe("Cxn[1m]");
    expect(customModel?.model).toBe("Cxn[1m]");
    expect(customModel?.source).toBe("custom");
  });

  it("preserves Claude runtime model and source metadata from backend catalog", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-option",
        model: "sonnet",
        displayName: "Sonnet",
        description: "Discovered",
        source: "cli-discovered",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    const sonnet = result.current.engineModelsAsOptions.find(
      (model) => model.id === "claude-sonnet-option",
    );
    expect(sonnet?.model).toBe("sonnet");
    expect(sonnet?.source).toBe("cli-discovered");
  });

  it("does not apply stale local Claude model mapping to backend dynamic models", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "settings-main",
        model: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-sonnet",
        model: "kimi-for-coding",
        displayName: "kimi-for-coding",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      MODEL_STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({
        main: "MiniMax-M2.7",
        sonnet: "MiniMax-M2.7",
        opus: "MiniMax-M2.7",
        haiku: "MiniMax-M2.7",
      }),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const modelNames = result.current.engineModelsAsOptions.map(
      (model) => model.model,
    );
    const displayNames = result.current.engineModelsAsOptions.map(
      (model) => model.displayName,
    );
    expect(modelNames).toContain("deepseek-v4-pro");
    expect(modelNames).toContain("kimi-for-coding");
    expect(displayNames).toContain("deepseek-v4-pro");
    expect(displayNames).toContain("kimi-for-coding");
    expect(modelNames).not.toContain("MiniMax-M2.7");
    expect(displayNames).not.toContain("MiniMax-M2.7");
  });

  it("normalizes legacy Claude model payload source to unknown", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "legacy-claude-model",
        displayName: "Legacy",
        description: "legacy",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    const legacy = result.current.engineModelsAsOptions.find(
      (model) => model.id === "legacy-claude-model",
    );
    expect(legacy?.model).toBe("legacy-claude-model");
    expect(legacy?.source).toBe("unknown");
  });

  it("loads legacy claude custom model entries even when label is missing", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "GLM-5.1",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const legacyModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "GLM-5.1",
    );
    expect(legacyModel).toBeDefined();
    expect(legacyModel?.displayName).toBe("GLM-5.1");
  });

  it("keeps user-entered claude custom model ids while filtering only malformed entries", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        { id: "GLM-5.1", label: "GLM", description: "ok" },
        { id: "GLM-5.1", label: "GLM duplicated", description: "dup" },
        { id: "provider/model:202603[beta]" },
        { id: "Haiku 4.5", label: "Haiku 4.5" },
        { id: "bad model with spaces", label: "Bad" },
        { id: "\u6a21\u578b 666", label: "\u6a21\u578b 666" },
        { id: "   ", label: "Blank" },
        null,
        { foo: "bar" },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const glmModels = result.current.engineModelsAsOptions.filter(
      (model) => model.id === "GLM-5.1",
    );
    expect(glmModels).toHaveLength(1);
    expect(glmModels[0]?.displayName).toBe("GLM");

    const bracketModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "provider/model:202603[beta]",
    );
    expect(bracketModel).toBeDefined();
    expect(bracketModel?.displayName).toBe("provider/model:202603[beta]");

    const spacedModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "Haiku 4.5",
    );
    expect(spacedModel).toBeDefined();
    expect(spacedModel?.model).toBe("Haiku 4.5");
    expect(spacedModel?.displayName).toBe("Haiku 4.5");

    const arbitrarySpacedModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "bad model with spaces",
    );
    expect(arbitrarySpacedModel).toBeDefined();
    expect(arbitrarySpacedModel?.model).toBe("bad model with spaces");
    expect(arbitrarySpacedModel?.displayName).toBe("Bad");

    const unicodeModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "\u6a21\u578b 666",
    );
    expect(unicodeModel).toBeDefined();
    expect(unicodeModel?.model).toBe("\u6a21\u578b 666");

    const blankModel = result.current.engineModelsAsOptions.find(
      (model) => model.displayName === "Blank",
    );
    expect(blankModel).toBeUndefined();
  });

  it("marks every engine as loading before detection finishes", () => {
    detectEnginesMock.mockImplementation(
      () => new Promise<EngineStatus[]>((_resolve) => undefined),
    );
    getActiveEngineMock.mockImplementation(
      () => new Promise<"claude">((_resolve) => undefined),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    expect(result.current.availableEngines.map((engine) => engine.type)).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
      "pi",
      "dsh",
      "qoder",
    ]);
    expect(
      result.current.availableEngines.every(
        (engine) => engine.availabilityState === "loading",
      ),
    ).toBe(true);
  });

  it("keeps the facade snapshot stable across unrelated parent renders", () => {
    detectEnginesMock.mockImplementation(
      () => new Promise<EngineStatus[]>((_resolve) => undefined),
    );
    getActiveEngineMock.mockImplementation(
      () => new Promise<"claude">((_resolve) => undefined),
    );

    const { result, rerender } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    const firstSnapshot = result.current;
    rerender();

    expect(result.current).toBe(firstSnapshot);
  });

  it("shows detected OpenCode in production engine surfaces", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "codex",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: {
          id: "ws-1",
          name: "mossx",
          path: "/tmp/mossx",
          connected: true,
          kind: "main",
          settings: {
            sidebarCollapsed: false,
            worktreeSetupScript: null,
          },
        },
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const opencodeEngine = result.current.availableEngines.find(
      (engine) => engine.type === "opencode",
    );
    expect(opencodeEngine).toBeDefined();
    expect(opencodeEngine?.installed).toBe(true);
    expect(opencodeEngine?.availabilityState).toBe("ready");
    expect(
      result.current.availableEngines.some((engine) => engine.type === "gemini"),
    ).toBe(false);
  });

  it("hides disabled Gemini engine from available engine surfaces", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("opencode");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.availableEngines.map((engine) => engine.type)).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
      "pi",
      "dsh",
      "qoder",
    ]);
    expect(result.current.activeEngine).toBe("opencode");
  });

  it("initializes activeEngine from persisted selection before detect settles", async () => {
    getClientStoreSyncMock.mockReturnValue("grok");
    const detectDeferred = createDeferred<EngineStatus[]>();
    const activeEngineDeferred = createDeferred<"claude">();
    detectEnginesMock.mockReturnValueOnce(detectDeferred.promise);
    getActiveEngineMock.mockReturnValueOnce(activeEngineDeferred.promise);
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    // 首屏必须已经是上次选择，不能先渲染 claude 再异步跳回
    expect(result.current.activeEngine).toBe("grok");

    detectDeferred.resolve([
      createEngineStatus("claude", true),
      createEngineStatus("grok", true),
    ]);
    activeEngineDeferred.resolve("claude");

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.activeEngine).toBe("grok");
    expect(switchEngineMock).toHaveBeenCalledWith("grok");
  });

  it("ignores a legacy persisted Gemini execution selection", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue("gemini");

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.activeEngine).toBe("claude");
    expect(result.current.availableEngines.some((engine) => engine.type === "gemini")).toBe(false);
    expect(switchEngineMock).not.toHaveBeenCalledWith("gemini");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("gemini");
  });

  it("switches a legacy active Gemini runtime back to a supported engine", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("gemini", true),
    ]);
    getActiveEngineMock.mockResolvedValue("gemini");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.activeEngine).toBe("claude");
    expect(switchEngineMock).toHaveBeenCalledWith("claude");
    expect(switchEngineMock).not.toHaveBeenCalledWith("gemini");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("gemini");
  });

  it("rejects direct Gemini switch and model refresh requests", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true),
      createEngineStatus("gemini", true),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    switchEngineMock.mockClear();
    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.setActiveEngine("gemini");
      await result.current.refreshEngineModels("gemini", {
        forceRefresh: true,
      });
    });

    expect(result.current.activeEngine).toBe("claude");
    expect(switchEngineMock).not.toHaveBeenCalled();
    expect(getEngineModelsMock).not.toHaveBeenCalled();
  });

  it("refreshEngineModels reloads only the requested engine catalog", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: {
          id: "ws-1",
          name: "mossx",
          path: "/tmp/mossx",
          connected: true,
          kind: "main",
          settings: {
            sidebarCollapsed: false,
            worktreeSetupScript: null,
          },
        },
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");

    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.refreshEngineModels("claude");
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
  });

  it("does not refresh opencode when claude models are manually refreshed", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.refreshEngineModels("claude");
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");
  });

  it("passes force refresh when manually reloading the requested engine catalog", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [
          {
            id: "claude-sonnet-4-6",
            displayName: "Sonnet 4.6",
            description: "cached",
            isDefault: true,
          },
        ],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "cached",
        isDefault: true,
      },
    ]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "glm-5.1",
        displayName: "GLM-5.1",
        description: "Configured in ~/.claude/settings.json",
        isDefault: true,
      },
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", { forceRefresh: true });
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude", {
      forceRefresh: true,
    });
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
    expect(result.current.engineModelsAsOptions[0]?.id).toBe("glm-5.1");
  });

  it("loads and retains provider-scoped model origin metadata", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-opus-4-8",
        displayName: "Opus 4.8",
        description: "public",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, claudeModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(claudeModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "settings-main",
        model: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        source: "settings-override",
        providerProfileId: "provider-a",
        isDefault: true,
      },
      ...claudeModels,
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });

    expect(getEngineModelsMock).toHaveBeenCalledWith("claude", {
      providerProfileId: "provider-a",
    });
    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({
        id: "settings-main",
        model: "provider-a-model",
        providerProfileId: "provider-a",
      }),
    );
  });

  it("does not publish a stale provider catalog after the active scope changes", async () => {
    const publicModels: EngineStatus["models"] = [
      {
        id: "claude-opus-4-8",
        displayName: "Opus 4.8",
        description: "public",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, publicModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(publicModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const providerARequest = createDeferred<EngineStatus["models"]>();
    getEngineModelsMock.mockReset();
    getEngineModelsMock
      .mockImplementationOnce(() => providerARequest.promise)
      .mockResolvedValueOnce([
        {
          id: "provider-b-model",
          displayName: "Provider B",
          description: "provider",
          providerProfileId: "provider-b",
          isDefault: true,
        },
        ...publicModels,
      ]);

    let providerAPromise: Promise<unknown> = Promise.resolve();
    let providerBPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      providerAPromise = result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
      providerBPromise = result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-b",
      });
    });

    providerARequest.resolve([
      {
        id: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        providerProfileId: "provider-a",
        isDefault: true,
      },
      ...publicModels,
    ]);
    await act(async () => {
      await Promise.all([providerAPromise, providerBPromise]);
    });

    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({
        id: "provider-b-model",
        providerProfileId: "provider-b",
      }),
    );
    expect(
      result.current.engineModelsAsOptions.some(
        (model) => model.providerProfileId === "provider-a",
      ),
    ).toBe(false);
  });

  it("hides the previous scope while a provider catalog is loading", async () => {
    const publicModels: EngineStatus["models"] = [
      {
        id: "gpt-5.5",
        displayName: "gpt-5.5",
        description: "global",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, publicModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(publicModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.engineModelsAsOptions[0]?.id).toBe("gpt-5.5");

    const deepSeekRequest = createDeferred<EngineStatus["models"]>();
    getEngineModelsMock.mockReset();
    getEngineModelsMock.mockImplementationOnce(() => deepSeekRequest.promise);

    let refreshPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      refreshPromise = result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-deepseek",
      });
    });

    expect(result.current.engineModelsAsOptions).toEqual([]);

    deepSeekRequest.resolve([
      {
        id: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "provider",
        providerProfileId: "provider-deepseek",
        isDefault: true,
      },
    ]);
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.engineModelsAsOptions).toEqual([
      expect.objectContaining({
        id: "deepseek-v4-pro",
        providerProfileId: "provider-deepseek",
        isDefault: true,
      }),
    ]);
    expect(
      result.current.engineModelsAsOptions.some(
        (model) => model.id === "gpt-5.5",
      ),
    ).toBe(false);
  });

  it("retains the same provider last-good catalog when refresh fails", async () => {
    const publicModels: EngineStatus["models"] = [
      {
        id: "claude-opus-4-8",
        displayName: "Opus 4.8",
        description: "public",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, publicModels),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce(publicModels);
    const onDebug = vi.fn();

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null, onDebug }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        providerProfileId: "provider-a",
        isDefault: true,
      },
      ...publicModels,
    ]);
    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });

    getEngineModelsMock.mockRejectedValueOnce(
      new Error("provider-a config is unreadable"),
    );
    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        forceRefresh: true,
        providerProfileId: "provider-a",
      });
    });

    expect(result.current.engineModelsAsOptions[0]).toEqual(
      expect.objectContaining({
        id: "provider-a-model",
        providerProfileId: "provider-a",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "engine/models load error",
        payload: expect.objectContaining({
          engine: "claude",
          providerProfileId: "provider-a",
          error: "provider-a config is unreadable",
        }),
      }),
    );
  });

  it("preserves model state identity when a refresh is semantically unchanged", async () => {
    const models: EngineStatus["models"] = [
      {
        id: "provider-a-model",
        displayName: "Provider A",
        description: "provider",
        providerProfileId: "provider-a",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("claude", true, models),
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(models);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });
    const firstCatalog = result.current.engineModels;

    await act(async () => {
      await result.current.refreshEngineModels("claude", {
        providerProfileId: "provider-a",
      });
    });

    expect(result.current.engineModels).toBe(firstCatalog);
  });

  it("preserves the default flag when a custom Claude model shadows the default runtime model", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "settings-main",
        model: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-reasoning",
        model: "deepseek-chat",
        displayName: "deepseek-chat",
        description: "Configured in ~/.claude/settings.json",
        source: "settings-override",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        { id: "deepseek-chat", label: "DeepSeek Chat" },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const customDefault = result.current.engineModelsAsOptions.find(
      (model) => model.id === "deepseek-v4-pro",
    );
    const customNonDefault = result.current.engineModelsAsOptions.find(
      (model) => model.id === "deepseek-chat",
    );

    expect(customDefault?.isDefault).toBe(true);
    expect(customNonDefault?.isDefault).toBe(false);
  });

  it("replaces stale Claude models after source switch force refresh", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [
          {
            id: "settings-main",
            model: "MiniMax-M1[1m]",
            displayName: "MiniMax-M1[1m]",
            description: "old source",
            source: "settings-override",
            isDefault: true,
          },
          {
            id: "settings-reasoning",
            model: "MiniMax-M2.7",
            displayName: "MiniMax-M2.7",
            description: "old source",
            source: "settings-override",
            isDefault: false,
          },
        ],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "settings-main",
        model: "MiniMax-M1[1m]",
        displayName: "MiniMax-M1[1m]",
        description: "old source",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-reasoning",
        model: "MiniMax-M2.7",
        displayName: "MiniMax-M2.7",
        description: "old source",
        source: "settings-override",
        isDefault: false,
      },
    ]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "settings-main",
        model: "deepseek-v4-pro",
        displayName: "deepseek-v4-pro",
        description: "new source",
        source: "settings-override",
        isDefault: true,
      },
      {
        id: "settings-reasoning",
        model: "deepseek-chat",
        displayName: "deepseek-chat",
        description: "new source",
        source: "settings-override",
        isDefault: false,
      },
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", { forceRefresh: true });
    });

    const modelNames = result.current.engineModelsAsOptions.map(
      (model) => model.model ?? model.id,
    );
    expect(modelNames).toContain("deepseek-v4-pro");
    expect(modelNames).toContain("deepseek-chat");
    expect(modelNames).not.toContain("MiniMax-M1[1m]");
    expect(modelNames).not.toContain("MiniMax-M2.7");
  });

  it("refreshes active engine models on workspace switch without probing unrelated engines", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ workspace }) => useEngineController({ activeWorkspace: workspace }),
      {
        initialProps: {
          workspace: {
            id: "ws-1",
            name: "mossx",
            path: "/tmp/mossx",
            connected: true,
            kind: "main" as const,
            settings: {
              sidebarCollapsed: false,
              worktreeSetupScript: null,
            },
          },
        },
      },
    );

    await waitFor(() => expect(getEngineModelsMock).toHaveBeenCalledWith("claude"));
    getEngineModelsMock.mockClear();

    rerender({
      workspace: {
        id: "ws-2",
        name: "mossx-2",
        path: "/tmp/mossx-2",
        connected: true,
        kind: "main" as const,
        settings: {
          sidebarCollapsed: false,
          worktreeSetupScript: null,
        },
      },
    });

    await waitFor(() => expect(getEngineModelsMock).toHaveBeenCalledWith("claude"));
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
  });

  it("reuses the in-flight engine detection when refresh is clicked during initial load", async () => {
    const detectDeferred = createDeferred<EngineStatus[]>();
    const activeEngineDeferred = createDeferred<"claude">();

    detectEnginesMock.mockReturnValueOnce(detectDeferred.promise);
    getActiveEngineMock.mockReturnValueOnce(activeEngineDeferred.promise);
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    expect(result.current.isDetecting).toBe(true);
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);

    let refreshSettled = false;
    let refreshResult:
      | Awaited<ReturnType<typeof result.current.refreshEngines>>
      | undefined;
    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshEngines().then((value) => {
        refreshResult = value;
        refreshSettled = true;
      });
    });

    await Promise.resolve();
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(refreshSettled).toBe(false);

    detectDeferred.resolve([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [],
        error: null,
      },
    ]);
    activeEngineDeferred.resolve("claude");

    await act(async () => {
      await refreshPromise;
    });
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(refreshSettled).toBe(true);
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(refreshResult?.availableEngines.find((engine) => engine.type === "claude")?.installed).toBe(true);
  });

  it("switches optimistically and refreshes stale status in background", async () => {
    const codexModels: EngineStatus["models"] = [
      {
        id: "gpt-5",
        displayName: "GPT-5",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", false),
      ])
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", true, codexModels),
      ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(codexModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.setActiveEngine("codex");
    });

    // 新契约：点击路径不 await 检测（后台 per-engine 刷新），switch 乐观执行。
    expect(switchEngineMock).toHaveBeenCalledWith("codex");
    expect(result.current.activeEngine).toBe("codex");
    await act(async () => {});
    expect(detectEnginesMock).toHaveBeenCalledTimes(2);
  });

  it("optimistically switches activeEngine before switchEngine settles", async () => {
    const dshModels: EngineStatus["models"] = [
      {
        id: "gork-zhu/grok-4.6",
        displayName: "gork-zhu / grok-4.6",
        description: "",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("codex", true, [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "",
          isDefault: true,
        },
      ]),
      createEngineStatus("dsh", true, dshModels),
    ]);
    getActiveEngineMock.mockResolvedValue("codex");
    getEngineModelsMock.mockResolvedValue(dshModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await act(async () => {
      await result.current.setActiveEngine("codex");
    });
    expect(result.current.activeEngine).toBe("codex");
    const catalogCallsBeforeDshSwitch = getEngineModelsMock.mock.calls.length;

    const switchDeferred = createDeferred<void>();
    switchEngineMock.mockReturnValueOnce(switchDeferred.promise);
    let switchPromise!: Promise<void>;
    act(() => {
      switchPromise = result.current.setActiveEngine("dsh");
    });
    await waitFor(() => expect(result.current.activeEngine).toBe("dsh"));
    expect(result.current.engineModels.map((model) => model.id)).toEqual([
      "gork-zhu/grok-4.6",
    ]);
    expect(getEngineModelsMock.mock.calls.length).toBe(
      catalogCallsBeforeDshSwitch,
    );

    switchDeferred.resolve();
    await act(async () => {
      await switchPromise;
    });
    expect(result.current.activeEngine).toBe("dsh");
    expect(getEngineModelsMock.mock.calls.length).toBe(
      catalogCallsBeforeDshSwitch,
    );
  });

  it("rolls back optimistic engine chrome when switchEngine fails", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("codex", true),
      createEngineStatus("dsh", true),
    ]);
    getActiveEngineMock.mockResolvedValue("codex");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await act(async () => {
      await result.current.setActiveEngine("codex");
    });
    expect(result.current.activeEngine).toBe("codex");

    switchEngineMock.mockReset();
    switchEngineMock.mockImplementation(() =>
      Promise.reject(new Error("switch failed")),
    );
    await act(async () => {
      await result.current.setActiveEngine("dsh");
    });
    expect(result.current.activeEngine).toBe("codex");
    switchEngineMock.mockReset();
    switchEngineMock.mockResolvedValue(undefined);
  });

  it("does not let a stale switchEngine failure roll back a later DSH switch", async () => {
    const dshModels: EngineStatus["models"] = [
      {
        id: "gork-zhu/grok-4.6",
        displayName: "gork-zhu / grok-4.6",
        description: "",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("codex", true),
      createEngineStatus("claude", true),
      createEngineStatus("dsh", true, dshModels),
    ]);
    getActiveEngineMock.mockResolvedValue("codex");
    getEngineModelsMock.mockResolvedValue(dshModels);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await act(async () => {
      await result.current.setActiveEngine("codex");
    });

    const claudeDeferred = createDeferred<void>();
    switchEngineMock.mockReset();
    switchEngineMock.mockReturnValueOnce(claudeDeferred.promise);
    switchEngineMock.mockResolvedValueOnce(undefined);

    let claudePromise!: Promise<void>;
    act(() => {
      claudePromise = result.current.setActiveEngine("claude");
    });
    await waitFor(() => expect(result.current.activeEngine).toBe("claude"));

    await act(async () => {
      await result.current.setActiveEngine("dsh");
    });
    expect(result.current.activeEngine).toBe("dsh");

    claudeDeferred.reject(new Error("stale claude switch failed"));
    await act(async () => {
      await claudePromise;
    });
    expect(result.current.activeEngine).toBe("dsh");
    expect(result.current.engineModels.map((model) => model.id)).toEqual([
      "gork-zhu/grok-4.6",
    ]);
    switchEngineMock.mockReset();
    switchEngineMock.mockResolvedValue(undefined);
  });

  it("adds Codex doctor evidence when refreshed status is still unavailable", async () => {
    const debugEntries: Array<{ label: string; payload: unknown }> = [];
    const onDebug = (entry: DebugEntry) => {
      debugEntries.push({ label: entry.label, payload: entry.payload });
    };
    detectEnginesMock
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", false),
      ])
      .mockResolvedValueOnce([
        createEngineStatus("claude", true),
        createEngineStatus("codex", false),
      ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    runCodexDoctorMock.mockResolvedValue({
      ok: true,
      codexBin: null,
      version: "codex-cli 0.135.0",
      appServerOk: true,
      details: null,
      path: "/opt/homebrew/bin:/usr/bin",
      pathEnvUsed: "/opt/homebrew/bin:/usr/bin",
      nodeOk: true,
      nodeVersion: "v20.0.0",
      nodeDetails: null,
      resolvedBinaryPath: "/opt/homebrew/bin/codex",
      environmentDiagnosis: {
        category: "gui-path-drift",
        message: "Codex is visible from fallback paths but not GUI PATH.",
        resolvedBinaryPath: "/opt/homebrew/bin/codex",
        missedByGuiPath: true,
      },
    });

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug,
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.setActiveEngine("codex");
    });

    // doctor 证据后台收集，不阻塞乐观切换。
    expect(switchEngineMock).toHaveBeenCalledWith("codex");
    expect(result.current.activeEngine).toBe("codex");
    await act(async () => {});
    expect(runCodexDoctorMock).toHaveBeenCalledWith(null, null);
    const switchError = debugEntries.find(
      (entry) => entry.label === "engine/switch codex doctor evidence",
    );
    expect(switchError?.payload).toMatchObject({
      message: "Engine codex is not installed",
      doctorOk: true,
      resolvedBinaryPath: "/opt/homebrew/bin/codex",
      environmentDiagnosis: {
        category: "gui-path-drift",
        missedByGuiPath: true,
      },
    });
  });

  it("uses an on-demand orchestrator timeout that covers the backend probe chain", async () => {
    detectEnginesMock.mockResolvedValue([createEngineStatus("pi", true, [])]);
    getActiveEngineMock.mockResolvedValue("pi");
    getEngineModelsMock.mockResolvedValue([]);

    const runSpy = vi.spyOn(startupOrchestrator, "run");
    try {
      const { result } = renderHook(() =>
        useEngineController({ activeWorkspace: null }),
      );
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      // B-fix：pi 是解耦目录引擎，detect 后的默认加载升级为 on-demand 22s
      // （覆盖后端 RPC+list-models 最坏链；旧 idle-prewarm 8s 冷启动必超时，
      // providerModelCatalogs[pi] 为空导致思考档联动滞后/缺失）。
      const prewarmCall = runSpy.mock.calls
        .map(([descriptor]) => descriptor)
        .find((descriptor) =>
          String(descriptor.id).startsWith("engine-models:pi:"),
        );
      expect(prewarmCall?.timeoutMs).toBe(22_000);

      runSpy.mockClear();
      await act(async () => {
        await result.current.refreshEngineModels("pi", { forceRefresh: true });
      });
      const onDemandCall = runSpy.mock.calls
        .map(([descriptor]) => descriptor)
        .find((descriptor) =>
          String(descriptor.id).startsWith("engine-models:pi:"),
        );
      expect(onDemandCall?.timeoutMs).toBe(22_000);
    } finally {
      runSpy.mockRestore();
    }
  });});

// ==================== B4 逐引擎事件 ====================

describe("useEngineController per-engine status events", () => {
  it("merges per-engine events into engineStatuses (progressive reveal)", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("kimi", false),
      createEngineStatus("grok", false),
    ]);
    getActiveEngineMock.mockResolvedValue("kimi");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug: () => {},
      }),
    );

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });
    expect(
      result.current.engineStatuses.find((status) => status.engineType === "kimi")
        ?.installed,
    ).toBe(false);

    act(() => {
      emitEngineStatusEvent({
        detectRunId: 1,
        status: createEngineStatus("kimi", true, []),
      });
    });

    await waitFor(() => {
      expect(
        result.current.engineStatuses.find((status) => status.engineType === "kimi")
          ?.installed,
      ).toBe(true);
    });
    // 其他引擎不受影响（逐项 merge，非整体替换）
    expect(
      result.current.engineStatuses.find((status) => status.engineType === "grok")
        ?.installed,
    ).toBe(false);
  });

  it("drops late events from older detection runs", async () => {
    detectEnginesMock.mockResolvedValue([createEngineStatus("kimi", false)]);
    getActiveEngineMock.mockResolvedValue("kimi");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug: () => {},
      }),
    );

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    act(() => {
      emitEngineStatusEvent({
        detectRunId: 5,
        status: createEngineStatus("kimi", true, []),
      });
    });
    await waitFor(() => {
      expect(
        result.current.engineStatuses.find((status) => status.engineType === "kimi")
          ?.installed,
      ).toBe(true);
    });

    // 旧 run 的迟到事件 MUST 被丢弃（detectRunId 单调守卫）
    act(() => {
      emitEngineStatusEvent({
        detectRunId: 3,
        status: createEngineStatus("kimi", false, []),
      });
    });
    expect(
      result.current.engineStatuses.find((status) => status.engineType === "kimi")
        ?.installed,
    ).toBe(true);
  });
});

describe("useEngineController status flip invalidation (P0 修正)", () => {
  it("authState arrival does NOT invalidate catalogs (only installed flips do)", async () => {
    const invalidated = vi.fn();
    window.addEventListener(
      "ccgui:provider-target-catalog-invalidated",
      invalidated,
    );
    // 初始：已安装 + auth Unknown（phase1 形态）
    detectEnginesMock.mockResolvedValue([
      { ...createEngineStatus("qoder", true, []), authState: "unknown" },
    ]);
    getActiveEngineMock.mockResolvedValue("qoder");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug: () => {},
      }),
    );
    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });
    invalidated.mockClear();

    // phase2 正常到达：installed 不变 + authState Unknown→Authenticated
    act(() => {
      emitEngineStatusEvent({
        detectRunId: 2,
        status: {
          ...createEngineStatus("qoder", true, []),
          authState: "authenticated",
        },
      });
    });
    await waitFor(() => {
      expect(
        result.current.engineStatuses.find((status) => status.engineType === "qoder")
          ?.authState,
      ).toBe("authenticated");
    });
    expect(invalidated).not.toHaveBeenCalled();

    // installed 翻转（真状态变化）→ 恰好一次失效
    act(() => {
      emitEngineStatusEvent({
        detectRunId: 3,
        status: createEngineStatus("qoder", false, []),
      });
    });
    await waitFor(() => {
      expect(invalidated).toHaveBeenCalledTimes(1);
    });
    window.removeEventListener(
      "ccgui:provider-target-catalog-invalidated",
      invalidated,
    );
  });
});

describe("useEngineController post-switch catalog load (P0)", () => {
  it("loads target engine catalog after switching to a detached engine", async () => {
    const runSpy = vi.spyOn(startupOrchestrator, "run");
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("pi", true, []),
      createEngineStatus("kimi", true, []),
    ]);
    getActiveEngineMock.mockResolvedValue("kimi");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);
    switchEngineMock.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );
    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });
    runSpy.mockClear();

    await act(async () => {
      await result.current.setActiveEngine("pi");
    });

    // 切换后 MUST 触发 pi 目录加载（解耦引擎 on-demand 22s 预算）
    const piCall = runSpy.mock.calls
      .map(([descriptor]) => descriptor)
      .find((descriptor) =>
        String(descriptor.id).startsWith("engine-models:pi:"),
      );
    expect(piCall).toBeDefined();
    expect(piCall?.timeoutMs).toBe(22_000);
    expect(getEngineModelsMock).toHaveBeenCalledWith("pi");
  });
});

describe("useEngineController detect failure state", () => {
  it("marks failed on detect rejection and never stays loading forever", async () => {
    detectEnginesMock.mockRejectedValue(new Error("ipc down"));
    getActiveEngineMock.mockResolvedValue("kimi");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug: () => {},
      }),
    );

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });
    expect(result.current.detectFailed).toBe(true);
    expect(
      result.current.availableEngines.every(
        (engine) => engine.availabilityState === "failed",
      ),
    ).toBe(true);
  });

  it("routes detection through the coordinator (shared single-flight)", async () => {
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("kimi", true, []),
    ]);
    getActiveEngineMock.mockResolvedValue("kimi");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);

    renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug: () => {},
      }),
    );

    await waitFor(() => {
      expect(requestEngineDetectionMock).toHaveBeenCalled();
    });
    expect(requestEngineDetectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "controller" }),
    );
  });

  it("clears stale pi models and force-reloads catalog on pi auth change", async () => {
    // 初载：PI 目录带「已删 provider」的旧模型（凭证删除前探测的残留）
    const stalePiModels: EngineStatus["models"] = [
      { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", description: "", isDefault: true },
    ];
    detectEnginesMock.mockResolvedValue([
      createEngineStatus("kimi", true, []),
      createEngineStatus("pi", true, stalePiModels),
    ]);
    getActiveEngineMock.mockResolvedValue("kimi");
    isWebServiceRuntimeMock.mockReturnValue(false);
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue(null);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: null,
        onDebug: () => {},
      }),
    );
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(
        result.current.engineStatuses.find((status) => status.engineType === "pi")
          ?.models.length,
      ).toBeGreaterThan(0),
    );
    const callsBeforeDispatch = getEngineModelsMock.mock.calls.length;

    // 删除/保存凭证成功后组件广播本事件：FE 必须清 stale models 并 force 重载
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ccgui:pi-auth-catalog-changed"));
    });

    await waitFor(() => {
      expect(
        result.current.engineStatuses.find((status) => status.engineType === "pi")
          ?.models,
      ).toHaveLength(0);
    });
    // 状态条目本身保留（installed/version 不动，等价轻量检测态）
    expect(
      result.current.engineStatuses.find((status) => status.engineType === "pi")
        ?.installed,
    ).toBe(true);
    // force 重载发生（get_engine_models 带 forceRefresh，空目录也被采信）
    const piForceCall = getEngineModelsMock.mock.calls
      .slice(callsBeforeDispatch)
      .find(([engine, options]) => engine === "pi" && options?.forceRefresh);
    expect(piForceCall).toBeDefined();
  });
});
