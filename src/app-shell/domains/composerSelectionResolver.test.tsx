// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useComposerSelectionResolver } from "./composerSelectionResolver";

describe("useComposerSelectionResolver", () => {
  it("initializes the snapshot with all-null fields", () => {
    const { result } = renderHook(() => useComposerSelectionResolver());
    expect(result.current.resolveComposerSelection()).toEqual({
      id: null,
      model: null,
      source: null,
      providerProfileId: null,
      effort: null,
      collaborationMode: null,
      threadId: null,
      revision: 0,
    });
  });

  it("resolver reads the live ref (writer path stays ref-based)", () => {
    const { result } = renderHook(() => useComposerSelectionResolver());

    result.current.composerSelectionResolverRef.current = {
      id: "gpt-5",
      model: "gpt-5",
      source: "managed",
      providerProfileId: null,
      effort: null,
      collaborationMode: { mode: "plan" },
      threadId: "pi:session-a",
      revision: 1,
    };
    expect(result.current.resolveComposerSelection()).toEqual({
      id: "gpt-5",
      model: "gpt-5",
      source: "managed",
      providerProfileId: null,
      effort: null,
      collaborationMode: { mode: "plan" },
      threadId: "pi:session-a",
      revision: 1,
    });
    expect(result.current.resolveComposerSelection("pi:session-b")).toBeNull();
  });

  it("keeps ref and resolver identity stable across rerenders", () => {
    const { result, rerender } = renderHook(() =>
      useComposerSelectionResolver(),
    );
    const refBefore = result.current.composerSelectionResolverRef;
    const resolverBefore = result.current.resolveComposerSelection;

    rerender();

    expect(result.current.composerSelectionResolverRef).toBe(refBefore);
    expect(result.current.resolveComposerSelection).toBe(resolverBefore);
  });
});
