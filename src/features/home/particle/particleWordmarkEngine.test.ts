// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParticleWordmarkEngine, type ParticleWordmarkOptions } from "./particleWordmarkEngine";

const options: ParticleWordmarkOptions = {
  monochrome: false, color: "#6c31e3", zoom: 1, spacing: 1, dotSize: 0.6,
  repulsionRadius: 100, repulsionStrength: 1.8,
  logoSelector: ".logo", titleSelector: "h1", contentSelector: ".hero",
};

describe("particle rendering safety", () => {
  let root: HTMLDivElement;
  let engine: ParticleWordmarkEngine;
  let context: Record<string, unknown>;
  beforeEach(() => {
    root = document.createElement("div");
    root.innerHTML = '<div class="hero"><h1>我的工作台</h1></div>';
    document.body.append(root);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 40));
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(0, 0, 20, 30) });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("devicePixelRatio", 2.5);
    context = {
      scale: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(),
      measureText: () => ({ actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5 }),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context as unknown as CanvasRenderingContext2D);
    engine = new ParticleWordmarkEngine(root, options);
  });
  afterEach(() => { engine.destroy(); root.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("draws a complete finite grid at fractional DPR and preserves heading semantics", async () => {
    expect(await engine.build()).toBe(true);
    const canvas = root.querySelector("canvas")!;
    expect(canvas.width).toBe(410);
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector("h1")!.style.opacity).toBe("0");
    expect(root.querySelector("h1")!.style.visibility).toBe("");
    expect(context.fillStyle).toBe("rgb(255, 255, 255)");
    const calls = vi.mocked(context.fillRect as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(100);
    expect(calls.length).toBeLessThanOrEqual(15000);
    expect(calls.flat().every(Number.isFinite)).toBe(true);
    engine.destroy();
    expect(root.querySelector("canvas")).toBeNull();
    expect(root.querySelector("h1")!.style.opacity).toBe("");
  });

  it("keeps the original heading visible if the overlay context is unavailable", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(context as unknown as CanvasRenderingContext2D).mockReturnValueOnce(null);
    expect(await engine.build()).toBe(false);
    expect(root.querySelector("canvas")).toBeNull();
    expect(root.querySelector("h1")!.style.opacity).toBe("");
  });

  it("repels particles near the pointer, returns them home and stops scheduling idle frames", async () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    await engine.build();
    const draw = vi.mocked(context.fillRect as ReturnType<typeof vi.fn>);
    const home = draw.mock.calls.map(([x, y]) => [x as number, y as number]);
    const runFrames = (count: number) => {
      for (let i = 0; i < count && frame; i++) {
        const callback = frame;
        frame = null;
        draw.mockClear();
        callback(i * 16);
      }
    };
    root.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 20 }));
    runFrames(40);
    expect(draw.mock.calls.some(([x, y], i) => Math.hypot(x - home[i][0], y - home[i][1]) > 1)).toBe(true);
    root.dispatchEvent(new MouseEvent("mouseleave"));
    runFrames(250);
    expect(draw.mock.calls.every(([x, y], i) => Math.hypot(x - home[i][0], y - home[i][1]) < 0.2)).toBe(true);
    expect(frame).toBeNull();
  });

  it("restores DOM when a theme resample has no readable pixels", async () => {
    await engine.build();
    context.getImageData = (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
    await engine.refresh();
    expect(root.querySelector("canvas")).toBeNull();
    expect(root.querySelector("h1")!.style.opacity).toBe("");
  });
});
