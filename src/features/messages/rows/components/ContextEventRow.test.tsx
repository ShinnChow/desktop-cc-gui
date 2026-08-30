// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../../types";
import { ContextEventRow } from "./ContextEventRow";

function compacted(
  overrides: Partial<Extract<ConversationItem, { kind: "context-event" }>> = {},
): Extract<ConversationItem, { kind: "context-event" }> {
  return {
    id: "context-compacted-turn-1",
    kind: "context-event",
    eventType: "compacted",
    reason: "threshold",
    tokensBefore: 236_505,
    estimatedTokensAfter: 41_200,
    turnId: "turn-1",
    timestampMs: 1_000,
    ...overrides,
  };
}

describe("ContextEventRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders auto-compaction copy with token delta for threshold reason", () => {
    const { container } = render(<ContextEventRow item={compacted()} />);
    const row = container.querySelector(".context-event-row");
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain("已自动压缩上下文");
    expect(row?.textContent).toContain("236.5K");
    expect(row?.textContent).toContain("41.2K");
  });

  it("renders manual copy for manual reason", () => {
    const { container } = render(
      <ContextEventRow item={compacted({ reason: "manual" })} />,
    );
    expect(container.querySelector(".context-event-row")?.textContent).toContain(
      "已手动压缩上下文",
    );
  });

  it("omits the token segment when token counts are absent", () => {
    const { container } = render(
      <ContextEventRow
        item={compacted({ tokensBefore: null, estimatedTokensAfter: null })}
      />,
    );
    const row = container.querySelector(".context-event-row");
    expect(row?.textContent).toContain("已自动压缩上下文");
    expect(row?.textContent).not.toContain("tokens");
  });

  it("uses neutral copy when reason is unknown (null)", () => {
    const { container } = render(
      <ContextEventRow item={compacted({ reason: null })} />,
    );
    expect(container.querySelector(".context-event-row")?.textContent).toContain(
      "上下文已压缩",
    );
  });
});
