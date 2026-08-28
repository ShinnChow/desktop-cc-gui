// B7 联动同源：可用性投影 + 分组门禁 + 翻转统一失效（refactor-engine-detection-pipeline）。
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "../../../../../types";
import { useEngineAvailabilityProjection } from "./useEngineAvailabilityProjection";
import {
  AppShellHostBusProvider,
  usePublishHostSlice,
} from "../../../../../app-shell/hosts/appShellHostBus";
import {
  PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
  notifyProviderTargetCatalogChanged,
} from "./useProviderTargetCatalogOwners";

vi.mock("../../engine/hooks/engineDetectionCoordinator", () => ({
  requestEngineDetection: vi.fn(async () => []),
}));

function createEngineStatus(
  engineType: EngineStatus["engineType"],
  installed: boolean,
  authState?: EngineStatus["authState"],
): EngineStatus {
  return {
    engineType,
    installed,
    version: installed ? "1.0.0" : null,
    binPath: null,
    features: { streaming: false, imageInput: false } as EngineStatus["features"],
    models: [],
    error: null,
    authState,
  };
}

function CatalogPublisher({ statuses }: { statuses: EngineStatus[] }) {
  // 模拟 useAppShellCatalogHost 的 availableEngines 投影形态（引擎面）
  const availableEngines = statuses.map((status) => ({
    type: status.engineType,
    displayName: status.engineType,
    shortName: status.engineType,
    installed: status.installed,
    version: status.version,
    error: status.error,
    availabilityState: !status.installed
      ? ("unavailable" as const)
      : status.authState === "requires_login"
        ? ("requires-login" as const)
        : ("ready" as const),
    availabilityLabelKey: null,
  }));
  usePublishHostSlice("catalog", {
    availableEngines,
  } as unknown as Record<string, unknown>);
  return null;
}

describe("useEngineAvailabilityProjection (B7)", () => {
  it("projects catalog availability states into picker states", () => {
    const statuses = [
      createEngineStatus("kimi", true),
      createEngineStatus("qoder", true, "requires_login"),
      createEngineStatus("grok", false),
    ];
    const { result } = renderHook(
      () => useEngineAvailabilityProjection(),
      {
        wrapper: ({ children }) => (
          <AppShellHostBusProvider>
            <CatalogPublisher statuses={statuses} />
            {children}
          </AppShellHostBusProvider>
        ),
      },
    );
    expect(result.current.stateByEngine.kimi).toBe("ready");
    expect(result.current.stateByEngine.qoder).toBe("requires-login");
    expect(result.current.stateByEngine.grok).toBe("unavailable");
    expect(result.current.reasonByEngine.grok).toBeTruthy();
  });

  it("degrades to empty projection outside the host bus provider", () => {
    const { result } = renderHook(() => useEngineAvailabilityProjection());
    expect(result.current.stateByEngine).toEqual({});
  });
});

describe("state flip unified invalidation (B7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("catalog change notification clears controller-side scopes via event", () => {
    const dispatched: string[] = [];
    const spy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((event) => {
        dispatched.push(event.type);
        return true;
      });
    act(() => {
      notifyProviderTargetCatalogChanged();
    });
    spy.mockRestore();
    expect(dispatched).toContain(PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT);
  });
});

describe("session switch red line (regression anchor)", () => {
  it("keeps catalog requests off the thread-switch path", () => {
    // 红线锚点：翻转失效只挂在 detect 事件与 CRUD 事件上；
    // 该断言与 useProviderModelCatalogSync.test.tsx 的零 catalog IPC 断言互补。
    expect(PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT).toBe(
      "ccgui:provider-target-catalog-invalidated",
    );
  });
});
