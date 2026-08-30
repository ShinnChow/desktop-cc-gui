import { describe, expect, it } from "vitest";
import { parsePiHistoryMessages } from "./piHistoryParser";

describe("parsePiHistoryMessages", () => {
  it("returns empty items for non-array payloads", () => {
    expect(parsePiHistoryMessages(null)).toEqual([]);
    expect(parsePiHistoryMessages({ messages: [] })).toEqual([]);
    expect(parsePiHistoryMessages(undefined)).toEqual([]);
  });

  it("keeps user image paths on history rows", () => {
    const items = parsePiHistoryMessages([
      {
        id: "pi-user-shot",
        kind: "message",
        role: "user",
        text: "这是啥",
        images: ["data:image/png;base64,AAAA"],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "pi-user-shot",
        kind: "message",
        role: "user",
        text: "这是啥",
        images: ["data:image/png;base64,AAAA"],
      }),
    );
  });

  it("maps user and assistant messages to conversation items", () => {
    const items = parsePiHistoryMessages([
      { id: "pi-user-1", kind: "message", role: "user", text: "hello" },
      { id: "pi-agent-1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "pi-user-1", kind: "message", role: "user", text: "hello" }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({ id: "pi-agent-1", kind: "message", role: "assistant", text: "hi" }),
    );
  });

  it("maps tool entries to command execution items", () => {
    const items = parsePiHistoryMessages([
      {
        id: "pi-tool-1",
        kind: "tool",
        toolType: "bash",
        toolInput: { command: "ls" },
        toolOutput: "ok",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "pi-tool-1", kind: "tool", output: "ok" }),
    );
  });

  it("never pushes null items for entries that fail conversion", () => {
    const items = parsePiHistoryMessages([
      { id: "pi-thinking-1", kind: "thinking", text: "" },
      { id: "pi-agent-1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items.every((item) => item !== null && typeof item.id === "string")).toBe(
      true,
    );
  });

  it("generates fallback ids for entries without id", () => {
    const items = parsePiHistoryMessages([
      { kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(1);
    expect(typeof items[0]?.id).toBe("string");
  });

  it("merges background task call/result/notification into one folded card at the call position", () => {
    // 1.5 历史回放：call + result(receipt snapshot) + 终态通知 → 单张折叠卡，
    // 锚定 call 位置；通知不成行（D1）。
    const items = parsePiHistoryMessages([
      { id: "m1", kind: "message", role: "user", text: "run a bg task" },
      {
        id: "tool_bg1",
        kind: "backgroundTask",
        role: "assistant",
        toolType: "bg_run",
        toolInput: { name: "spike-task", command: "sleep 3" },
      },
      {
        id: "tool_bg1-result",
        kind: "backgroundTask",
        role: "tool",
        toolType: "bg_run",
        toolOutput: {
          id: "b2e2f48ad",
          name: "spike-task",
          status: "running",
          outputPath: ".pi/tasks/session-1-1/b2e2f48ad.output",
        },
      },
      { id: "m4", kind: "message", role: "assistant", text: "已启动，等它跑完" },
      {
        id: "m5",
        kind: "backgroundTaskNotification",
        role: "assistant",
        toolOutput: {
          id: "b2e2f48ad",
          status: "completed",
          exitCode: 0,
          completionText: "Hello world 5s",
        },
      },
    ]);

    expect(items).toHaveLength(3); // user + 单张任务卡 + assistant（通知不成行）
    const card = items[1];
    expect(card).toEqual(
      expect.objectContaining({
        id: "tool_bg1",
        kind: "tool",
        toolType: "backgroundTask",
        title: "bg_run",
      }),
    );
    const task = JSON.parse(
      (card as { output?: string }).output ?? "{}",
    ) as Record<string, unknown>;
    expect(task.id).toBe("b2e2f48ad");
    expect(task.status).toBe("completed"); // 通知终态覆盖 receipt running
    expect(task.exitCode).toBe(0);
    expect(task.outputPath).toBe(".pi/tasks/session-1-1/b2e2f48ad.output"); // receipt 字段保留
    expect(task.completionText).toBe("Hello world 5s");
    expect(items[2]).toEqual(
      expect.objectContaining({ id: "m4", kind: "message", role: "assistant" }),
    );
  });


  it("falls back to the notification position when call/result are outside the window", () => {
    const items = parsePiHistoryMessages([
      {
        id: "m-notify",
        kind: "backgroundTaskNotification",
        role: "assistant",
        toolOutput: { id: "task-x", status: "failed", exitCode: 137 },
      },
    ]);

    expect(items).toHaveLength(1); // 兜底任务卡（通知不成行）
    const card = items[0] as { id: string; toolType: string; output: string };
    expect(card.id).toBe("backgroundTask-task-x");
    expect(card.toolType).toBe("backgroundTask");
    expect(JSON.parse(card.output)).toEqual(
      expect.objectContaining({ id: "task-x", status: "failed", exitCode: 137 }),
    );
  });

  it("drops orphan background task calls without receipt or notification", () => {
    // 孤儿 call（会话在启动瞬间崩溃）：不回放，避免历史死卡永远转圈。
    const items = parsePiHistoryMessages([
      {
        id: "tool_bg_orphan",
        kind: "backgroundTask",
        role: "assistant",
        toolType: "bg_run",
        toolInput: { name: "dead-task", command: "sleep 1000" },
      },
      { id: "m1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "m1", kind: "message", text: "hi" }),
    );
  });
});
