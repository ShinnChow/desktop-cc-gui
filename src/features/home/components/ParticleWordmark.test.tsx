// @vitest-environment jsdom
import { useRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParticleWordmark } from "./ParticleWordmark";
import { DEFAULT_HOME_APPEARANCE } from "../utils/homeAppearance";

const { instances } = vi.hoisted(() => ({ instances: [] as Array<{ build: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> }> }));
vi.mock("../particle/particleWordmarkEngine", () => ({
  ParticleWordmarkEngine: class {
    build = vi.fn().mockResolvedValue(true);
    destroy = vi.fn();
    refresh = vi.fn().mockResolvedValue(undefined);
    constructor() { instances.push(this); }
  },
}));

function Harness({ content = "Claude:标题", enabled = true, respectReducedMotion = true }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}><h1>标题</h1><ParticleWordmark containerRef={ref}
    appearance={{ ...DEFAULT_HOME_APPEARANCE, particles: enabled, respectReducedMotion }}
    contentKey={content} /></div>;
}

describe("ParticleWordmark lifecycle", () => {
  let reduced: boolean;
  let motion: EventTarget;
  beforeEach(() => {
    instances.length = 0;
    reduced = false;
    motion = new EventTarget();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return query.includes("reduced-motion") && reduced; },
      addEventListener: motion.addEventListener.bind(motion),
      removeEventListener: motion.removeEventListener.bind(motion),
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("rebuilds on model/title changes and cleans up on disable/unmount", async () => {
    const view = render(<Harness />);
    await waitFor(() => expect(instances).toHaveLength(1));
    view.rerender(<Harness content="Codex:另一个标题" />);
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(instances[0].destroy).toHaveBeenCalled();
    view.rerender(<Harness enabled={false} />);
    expect(instances[1].destroy).toHaveBeenCalled();
    view.unmount();
  });

  it("honors live reduced-motion changes and refreshes on theme change", async () => {
    reduced = true;
    const view = render(<Harness />);
    await act(async () => {});
    expect(instances).toHaveLength(0);
    await act(async () => { reduced = false; motion.dispatchEvent(new Event("change")); });
    await waitFor(() => expect(instances).toHaveLength(1));
    await act(async () => { document.documentElement.setAttribute("data-theme", "light"); });
    expect(instances[0].refresh).toHaveBeenCalled();
    await act(async () => { reduced = true; motion.dispatchEvent(new Event("change")); });
    expect(instances[0].destroy).toHaveBeenCalled();
    view.unmount();
    document.documentElement.removeAttribute("data-theme");
  });

  it("does not create a canvas after unmount while fonts are loading", async () => {
    let ready!: () => void;
    Object.defineProperty(document, "fonts", { configurable: true,
      value: { ready: new Promise<void>((resolve) => { ready = resolve; }) } });
    const view = render(<Harness />);
    view.unmount();
    await act(async () => { ready(); });
    expect(instances).toHaveLength(0);
    Reflect.deleteProperty(document, "fonts");
  });

  it("plays explicit On even when WebView2 reports reduced motion", async () => {
    reduced = true;
    const view = render(<Harness respectReducedMotion={false} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0].build).toHaveBeenCalled();
    view.rerender(<Harness respectReducedMotion />);
    expect(instances[0].destroy).toHaveBeenCalled();
    await act(async () => {});
    expect(instances).toHaveLength(1);
    view.unmount();
  });
});
