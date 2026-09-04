// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryLoadingSurface } from "./HistoryLoadingSurface";

vi.mock("../../../../assets/icon.png", () => ({
  default: "icon.png",
}));

describe("HistoryLoadingSurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Native climbing light without fake phases", () => {
    render(<HistoryLoadingSurface progress={null} />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("data-history-loading-mode")).toBe("native");
    expect(screen.getByText("messages.restoringHistory")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistoryHint")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
    expect(status.querySelector(".messages-history-loading-traveler")).toBeTruthy();
    expect(status.querySelector(".messages-history-loading-nodes")).toBeNull();
    expect(status.querySelector(".messages-history-loading-phases")).toBeNull();
    expect(status.querySelector(".agent-thinking")).toBeNull();
  });

  it("pins Shared spine nodes to the real restore phase", () => {
    render(
      <HistoryLoadingSurface
        progress={{
          phase: "projection",
          percent: 58,
          titleKey: "restoringSharedHistory",
          detailKey: "restoringSharedHistoryProjection",
        }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("data-history-loading-mode")).toBe("shared");
    expect(screen.getByText("messages.restoringSharedHistory")).toBeTruthy();
    expect(
      screen.getByText("messages.restoringSharedHistoryProjection"),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "58",
    );
    expect(screen.getByText(/58%/)).toBeTruthy();
    expect(status.querySelector(".messages-history-loading-traveler")).toBeNull();

    const nodes = status.querySelectorAll(".messages-history-loading-node");
    expect(nodes).toHaveLength(4);
    expect(nodes[0]?.classList.contains("is-done")).toBe(true);
    expect(nodes[1]?.classList.contains("is-done")).toBe(true);
    expect(nodes[2]?.classList.contains("is-current")).toBe(true);
    expect(nodes[3]?.classList.contains("is-done")).toBe(false);
    expect(nodes[3]?.classList.contains("is-current")).toBe(false);
    expect(
      screen.getByText("messages.restoringHistoryPhasePrepare"),
    ).toBeTruthy();
    expect(
      screen.getByText(/messages\.restoringHistoryPhaseProjection · 58%/),
    ).toBeTruthy();
  });

  it("pins Native spine nodes to parse/assemble labels", () => {
    render(
      <HistoryLoadingSurface
        progress={{
          phase: "session",
          percent: 24,
          titleKey: "restoringHistory",
          detailKey: "restoringHistorySessionPage",
          detailParams: { page: 3, maxPages: 40, pageEvents: 200, totalEvents: 600 },
        }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("data-history-loading-mode")).toBe("native");
    expect(screen.getByText("messages.restoringHistory")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistorySessionPage")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "24",
    );
    expect(status.querySelector(".messages-history-loading-traveler")).toBeNull();
    expect(status.querySelector(".messages-history-loading-nodes")).toBeTruthy();
    expect(
      screen.getByText(/messages\.restoringHistoryPhaseSession · 24%/),
    ).toBeTruthy();
    expect(screen.getByText("messages.restoringHistoryPhaseParse")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistoryPhaseHydrate")).toBeTruthy();
  });

  it("marks every Shared spine node done on finalize", () => {
    const { container } = render(
      <HistoryLoadingSurface
        progress={{
          phase: "finalize",
          percent: 100,
          titleKey: "restoringSharedHistory",
          detailKey: "restoringSharedHistoryFinalize",
        }}
      />,
    );

    const nodes = container.querySelectorAll(".messages-history-loading-node");
    expect(nodes).toHaveLength(4);
    expect(
      [...nodes].every((node) => node.classList.contains("is-done")),
    ).toBe(true);
  });
});
