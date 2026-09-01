import { useEffect, type RefObject } from "react";
import { ParticleWordmarkEngine } from "../particle/particleWordmarkEngine";
import type { HomeAppearance } from "../utils/homeAppearance";

type ParticleWordmarkProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  appearance: HomeAppearance;
  contentKey: string;
};

/** Owns animation lifetime; the real heading remains the accessible source. */
export function ParticleWordmark({ containerRef, appearance, contentKey }: ParticleWordmarkProps) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !appearance.particles) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    let engine: ParticleWordmarkEngine | null = null;
    let disposed = false;
    let generation = 0;

    async function rebuild() {
      const token = ++generation;
      engine?.destroy();
      engine = null;
      if (appearance.respectReducedMotion && motion?.matches) return;
      // Leave DOM visible until fonts/images and the first canvas frame are ready.
      try {
        await document.fonts?.ready;
        if (disposed || generation !== token || !root) return;
        const next = new ParticleWordmarkEngine(root, {
          monochrome: appearance.colorMode === "custom",
          color: appearance.color,
          zoom: 1,
          spacing: appearance.spacing,
          dotSize: 0.6,
          repulsionRadius: 100,
          repulsionStrength: 1.8,
          logoSelector: ".home-chat-engine-mark",
          titleSelector: ".home-chat-title",
          contentSelector: ".home-chat-hero",
        });
        engine = next;
        if (!await next.build()) next.destroy();
      } catch (error) {
        if (generation === token) engine?.destroy();
        console.warn("[ccgui] Particle wordmark unavailable; keeping the original heading.", error);
      }
    }

    void rebuild();
    const onMotion = () => { void rebuild(); };
    const onTheme = () => { void engine?.refresh(); };
    motion?.addEventListener("change", onMotion);
    scheme?.addEventListener("change", onTheme);
    const observer = new MutationObserver(onTheme);
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ["class", "style", "data-theme"],
    });
    return () => {
      disposed = true;
      generation++;
      observer.disconnect();
      motion?.removeEventListener("change", onMotion);
      scheme?.removeEventListener("change", onTheme);
      engine?.destroy();
    };
  }, [containerRef, appearance, contentKey]);

  return null;
}
