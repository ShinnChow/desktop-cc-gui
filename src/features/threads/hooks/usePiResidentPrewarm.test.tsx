// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PI_PREWARM_DELAY_MS,
  resolvePrewarmPiSessionId,
  usePiResidentPrewarm,
} from "./usePiResidentPrewarm";

vi.mock("../../../services/tauri/appServer", () => ({
  enginePrewarm: vi.fn().mockResolvedValue(true),
}));

import { enginePrewarm } from "../../../services/tauri/appServer";

const enginePrewarmMock = vi.mocked(enginePrewarm);

describe("resolvePrewarmPiSessionId", () => {
  it("extracts the session id from a resumed pi thread", () => {
    expect(resolvePrewarmPiSessionId("pi:abc-123")).toBe("abc-123");
  });

  it("returns null for pending, non-pi, and empty threads", () => {
    expect(resolvePrewarmPiSessionId("pi-pending-abc")).toBeNull();
    expect(resolvePrewarmPiSessionId("claude:abc")).toBeNull();
    expect(resolvePrewarmPiSessionId("pi:")).toBeNull();
    expect(resolvePrewarmPiSessionId(null)).toBeNull();
  });
});

describe("usePiResidentPrewarm", () => {
  beforeEach(() => {
    enginePrewarmMock.mockClear();
    enginePrewarmMock.mockResolvedValue(true);
  });

  it("fires one delayed prewarm per resumed pi thread and dedupes rerenders", async () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        (props: { workspaceId: string | null; threadId: string | null }) =>
          usePiResidentPrewarm(props),
        {
          initialProps: {
            workspaceId: "ws-1",
            threadId: "pi:s-1",
          },
        },
      );

      act(() => {
        vi.advanceTimersByTime(PI_PREWARM_DELAY_MS - 1);
      });
      expect(enginePrewarmMock).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(enginePrewarmMock).toHaveBeenCalledTimes(1);
      expect(enginePrewarmMock).toHaveBeenCalledWith("ws-1", {
        engine: "pi",
        sessionId: "s-1",
      });

      rerender({ workspaceId: "ws-1", threadId: "pi:s-1" });
      await act(async () => {
        vi.advanceTimersByTime(PI_PREWARM_DELAY_MS * 2);
      });
      expect(enginePrewarmMock).toHaveBeenCalledTimes(1);
      expect(result.current).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips pending and non-pi threads", async () => {
    vi.useFakeTimers();
    try {
      const hookProps: {
        workspaceId: string | null;
        threadId: string | null;
      } = { workspaceId: "ws-1", threadId: "pi-pending-abc" };
      const { rerender } = renderHook((props: typeof hookProps) =>
        usePiResidentPrewarm(props),
      {
        initialProps: hookProps,
      });
      rerender({ workspaceId: "ws-1", threadId: "claude:abc" });
      rerender({ workspaceId: "ws-1", threadId: null });

      await act(async () => {
        vi.advanceTimersByTime(PI_PREWARM_DELAY_MS * 2);
      });
      expect(enginePrewarmMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire when unmounted before the delay elapses", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() =>
        usePiResidentPrewarm({ workspaceId: "ws-1", threadId: "pi:s-1" }),
      );
      unmount();
      await act(async () => {
        vi.advanceTimersByTime(PI_PREWARM_DELAY_MS * 2);
      });
      expect(enginePrewarmMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
