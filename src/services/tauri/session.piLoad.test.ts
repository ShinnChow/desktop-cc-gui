// F1（fix-session-load-bridge-freeze）：load_pi_session raw-string 通道。
// 载荷以单一 JSON string 过桥（前端一次 parse，O(len)），同时兼容
// remote/legacy 的对象图形态（直接透传）。
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { loadPiSession } from "./session";

describe("loadPiSession raw-string 通道", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("JSON 字符串载荷解析为对象", async () => {
    vi.mocked(invoke).mockResolvedValue(
      JSON.stringify({
        messages: [{ id: "m1", role: "user", text: "hello" }],
        usage: { inputTokens: 1 },
      }),
    );

    const parsed = await loadPiSession("/tmp/proj", "session-1");
    expect(invoke).toHaveBeenCalledWith("load_pi_session", {
      workspacePath: "/tmp/proj",
      sessionId: "session-1",
    });
    expect(parsed).toEqual({
      messages: [{ id: "m1", role: "user", text: "hello" }],
      usage: { inputTokens: 1 },
    });
  });

  it("null 载荷透传为 null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await loadPiSession("/tmp/proj", "session-1")).toBeNull();
  });

  it("对象图载荷（remote/legacy）直接透传", async () => {
    const legacy = { messages: [{ id: "m2" }] };
    vi.mocked(invoke).mockResolvedValue(legacy);
    expect(await loadPiSession("/tmp/proj", "session-1")).toBe(legacy);
  });

  it("非法 JSON 字符串抛错（走既有恢复路径）", async () => {
    vi.mocked(invoke).mockResolvedValue("{not-json");
    await expect(loadPiSession("/tmp/proj", "session-1")).rejects.toThrow();
  });
});
