// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineStatus, WorkspaceInfo } from "../../../types";
import { getConfigModel, getEngineModels, getModelList } from "../../../services/tauri";
import { useProjectMapGenerationOptions } from "./useProjectMapGenerationOptions";

const detectEnginesMock = vi.fn();
vi.mock("../../engine/hooks/engineDetectionCoordinator", () => ({
  requestEngineDetection: (
    options: { source: string; force?: boolean; engines?: string[] },
  ) => detectEnginesMock(options),
}));
vi.mock("../../../services/tauri", () => ({
  getConfigModel: vi.fn(),
  getEngineModels: vi.fn(),
  getModelList: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "springboot-demo",
  path: "/repo/springboot-demo",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const engineStatuses: EngineStatus[] = [
  {
    engineType: "codex",
    installed: true,
    version: "1.0.0",
    binPath: "/bin/codex",
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
    engineType: "claude",
    installed: true,
    version: "1.0.0",
    binPath: "/bin/claude",
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
    installed: false,
    version: null,
    binPath: null,
    features: {
      streaming: false,
      reasoning: false,
      toolUse: false,
      imageInput: false,
      sessionContinuation: false,
    },
    models: [],
    error: "missing",
  },
  {
    engineType: "opencode",
    installed: false,
    version: null,
    binPath: null,
    features: {
      streaming: false,
      reasoning: false,
      toolUse: false,
      imageInput: false,
      sessionContinuation: false,
    },
    models: [],
    error: "missing",
  },
];

describe("useProjectMapGenerationOptions", () => {
  beforeEach(() => {
    detectEnginesMock.mockResolvedValue(engineStatuses);
    vi.mocked(getEngineModels).mockReset();
    vi.mocked(getModelList).mockReset();
    vi.mocked(getConfigModel).mockReset();
  });

  it("loads Codex models from the workspace model catalog and config model", async () => {
    vi.mocked(getEngineModels).mockResolvedValueOnce([]);
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    const { result } = renderHook(() =>
      useProjectMapGenerationOptions({
        workspace,
        selectedEngine: "codex",
      }),
    );

    await waitFor(() => expect(result.current.modelsLoading).toBe(false));

    expect(getModelList).toHaveBeenCalledWith("workspace-1");
    expect(result.current.models.map((model) => model.model)).toContain("gpt-5.5");
    expect(result.current.models.map((model) => model.model)).toContain("gpt-5.4");
    expect(result.current.engines.map((engine) => engine.id)).toEqual([
      "codex",
      "claude",
      "grok",
      "kimi",
      "opencode",
    ]);
    expect(result.current.installedEngines.map((engine) => engine.id)).toEqual(["codex", "claude"]);
  });

  it("normalizes a legacy Gemini selection before loading executable models", async () => {
    vi.mocked(getEngineModels).mockResolvedValueOnce([]);
    vi.mocked(getModelList).mockResolvedValueOnce({ result: { data: [] } });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useProjectMapGenerationOptions({
        workspace,
        selectedEngine: "gemini",
      }),
    );

    await waitFor(() => expect(result.current.modelsLoading).toBe(false));

    expect(getEngineModels).toHaveBeenCalledWith("codex");
    expect(getEngineModels).not.toHaveBeenCalledWith("gemini");
    expect(result.current.engines.some((engine) => engine.id === "gemini")).toBe(false);
  });

  it("uses the current Codex catalog default when runtime catalogs are empty", async () => {
    vi.mocked(getEngineModels).mockRejectedValueOnce(new Error("engine model RPC unavailable"));
    vi.mocked(getModelList).mockResolvedValueOnce({ result: { data: [] } });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useProjectMapGenerationOptions({
        workspace,
        selectedEngine: "codex",
      }),
    );

    await waitFor(() => expect(result.current.modelsLoading).toBe(false));

    expect(result.current.modelsError).toBeNull();
    expect(result.current.models).not.toHaveLength(0);
    expect(result.current.models[0]?.isDefault).toBe(true);
  });

  it("reloads model options when the selected engine changes", async () => {
    vi.mocked(getEngineModels)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "claude-sonnet-4-5",
          model: "claude-sonnet-4-5",
          displayName: "Claude Sonnet 4.5",
          description: "",
          source: "engine",
          isDefault: true,
        },
      ]);
    vi.mocked(getModelList).mockResolvedValueOnce({ result: { data: [] } });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);

    const { result, rerender } = renderHook(
      ({ selectedEngine }: { selectedEngine: "codex" | "claude" }) =>
        useProjectMapGenerationOptions({
          workspace,
          selectedEngine,
        }),
      { initialProps: { selectedEngine: "codex" } },
    );

    await waitFor(() => expect(result.current.modelsLoading).toBe(false));

    rerender({ selectedEngine: "claude" });

    await waitFor(() =>
      expect(result.current.models.some((model) => model.model === "claude-sonnet-4-5")).toBe(true),
    );

    expect(getEngineModels).toHaveBeenLastCalledWith("claude");
  });
});
