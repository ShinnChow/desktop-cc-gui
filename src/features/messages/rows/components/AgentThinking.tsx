import { useEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { formatDurationMs } from "../../utils/messagesRenderUtils";

/**
 * Agent Thinking — ported from BoardUI (`npx boardui@latest add agent-thinking`,
 * https://www.boardui.com/components/agent-thinking).
 *
 * Four curated variants:
 * - `wave`     dot grid with a diagonal wavefront gliding top-left → bottom-right
 * - `spin`     dot grid with a bright head orbiting the grid clockwise
 * - `stars`    sparkles twinkling in and out with a stagger
 * - `infinity` a comet trail sweeping a figure-eight
 *
 * Every variant pairs the indicator with a shimmering label and an elapsed
 * timer. Repo adaptations:
 * - tone colors map to repo text tokens (--text-faint/-muted/-stronger/-accent)
 * - the timer anchors to `startedAt` (turn start) instead of mount, ticks once
 *   per second via ref-direct textContent writes (same pattern as the former
 *   WorkingClock) so no per-second setState re-renders the indicator
 * - dots animation skips under prefers-reduced-motion; jsdom without
 *   matchMedia falls back to the static seed frame
 */

export type AgentThinkingVariant = "wave" | "spin" | "stars" | "infinity";
export type AgentThinkingTone = "subtle" | "default" | "primary" | "accent";

export interface AgentThinkingProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  variant?: AgentThinkingVariant;
  /** Status label, e.g. "Thinking" or "Searching the docs". */
  label?: string;
  /** Tone of the indicator + label. Defaults per variant (`stars` is subtle). */
  tone?: AgentThinkingTone;
  /** Animated highlight traveling across the label. */
  shimmer?: boolean;
  /** Elapsed time rendered after the label. */
  showTimer?: boolean;
  /** Turn start timestamp (ms). Defaults to component mount time. */
  startedAt?: number | null;
  className?: string;
  /** Extra classes for the label span (test/style hooks). */
  labelClassName?: string;
  /** Extra classes for the timer span (test/style hooks). */
  timerClassName?: string;
}

const TONE_COLORS: Record<AgentThinkingTone, string> = {
  subtle: "var(--text-faint)",
  default: "var(--text-muted)",
  primary: "var(--text-stronger)",
  accent: "var(--text-accent)",
};

const VARIANT_TONE: Record<AgentThinkingVariant, AgentThinkingTone> = {
  wave: "default",
  spin: "default",
  stars: "subtle",
  infinity: "default",
};

/* ------------------------------------------------------------------- dots */

const DOTS_GRID = 3;
const DOTS_SIZE = 4;
const DOTS_GAP = 2;
const DOTS_TICK_MS = 80;
const DOTS_FADE_MS = 220;
const DOTS_TRAIL = 0.3;
const DOTS_MIN_OPACITY = 0.12;
const DOTS_PHASE_STEP = 1 / 8;

// Static first frame: the resting state under prefers-reduced-motion and in
// environments without matchMedia (jsdom).
const DOTS_SEED = [0.55, 0.3, 0.15, 0.85, 0.55, 0.3, 1, 0.85, 0.55];

/**
 * How far along the pattern's travel direction each cell sits, in [0, 1).
 * The wave scalar is compressed below 1 so the phase wrap reads as the front
 * leaving the grid and re-entering; the spin angle is naturally cyclic.
 */
function dotScalar(variant: "wave" | "spin", col: number, row: number) {
  const m = DOTS_GRID - 1;
  if (variant === "wave") {
    return ((col + row) / (2 * m)) * (DOTS_GRID / (DOTS_GRID + 1));
  }
  const center = m / 2;
  return (Math.atan2(row - center, col - center) / (2 * Math.PI) + 1) % 1;
}

function dotOpacities(variant: "wave" | "spin", phase: number) {
  return Array.from({ length: DOTS_GRID * DOTS_GRID }, (_, i) => {
    const s = dotScalar(variant, i % DOTS_GRID, Math.floor(i / DOTS_GRID));
    // Comet: bright head at the phase front, tail fading behind it.
    const behind = (phase - s + 1) % 1;
    const lit = Math.max(0, 1 - behind / DOTS_TRAIL) ** 1.5;
    return DOTS_MIN_OPACITY + (1 - DOTS_MIN_OPACITY) * lit;
  });
}

function DotsIndicator({ variant }: { variant: "wave" | "spin" }) {
  const [opacities, setOpacities] = useState<number[]>(DOTS_SEED);

  useEffect(() => {
    if (
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }
    let phase = 0;
    const id = window.setInterval(() => {
      phase = (phase + DOTS_PHASE_STEP) % 1;
      setOpacities(dotOpacities(variant, phase));
    }, DOTS_TICK_MS);
    return () => window.clearInterval(id);
  }, [variant]);

  return (
    <span
      aria-hidden
      className="agent-thinking-dots"
      style={{
        gridTemplateColumns: `repeat(${DOTS_GRID}, ${DOTS_SIZE}px)`,
        gap: DOTS_GAP,
      }}
    >
      {opacities.map((opacity, i) => (
        <span
          key={i}
          className="agent-thinking-dot"
          style={{
            width: DOTS_SIZE,
            height: DOTS_SIZE,
            opacity,
            transition: `opacity ${DOTS_FADE_MS}ms ease`,
          }}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ stars */

const STAR_PERIOD_S = 1.4;
const STAR_SIZE = 14;
const STAR_COUNT = 5;
const STAR_LAYOUT = [
  { x: 50, y: 46, scale: 1 },
  { x: 18, y: 22, scale: 0.55 },
  { x: 82, y: 26, scale: 0.45 },
  { x: 78, y: 76, scale: 0.55 },
  { x: 22, y: 78, scale: 0.4 },
];
const STAR_PATH =
  "M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z";

function StarsIndicator() {
  const box = STAR_SIZE * 1.5;
  return (
    <span
      aria-hidden
      className="agent-thinking-stars"
      style={{ width: box, height: box }}
    >
      {STAR_LAYOUT.slice(0, STAR_COUNT).map((star, i) => {
        const size = STAR_SIZE * star.scale;
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="agent-thinking-star"
            style={{
              width: size,
              height: size,
              left: `${star.x}%`,
              top: `${star.y}%`,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              animationDuration: `${STAR_PERIOD_S}s`,
              animationDelay: `${(i * STAR_PERIOD_S * 0.7) / STAR_COUNT}s`,
            }}
          >
            <path d={STAR_PATH} fill="currentColor" />
          </svg>
        );
      })}
    </span>
  );
}

/* --------------------------------------------------------------- infinity */

const INFINITY_WIDTH = 32;
const INFINITY_TRAIL = 11;
const INFINITY_STROKE = 2.75;
const INFINITY_DURATION_S = 1.2;
const INFINITY_PATH =
  "M28 14C33 5 47 5 47 14C47 23 33 23 28 14C23 5 9 5 9 14C9 23 23 23 28 14Z";

function InfinityIndicator() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 56 28"
      className="agent-thinking-infinity"
      // The figure-eight spans x 9-47 of the 56-wide viewBox, so the svg box
      // carries ~4px of dead space per side at this width; pull it back in so
      // the label sits at the loader's real gap.
      style={{
        width: INFINITY_WIDTH,
        height: INFINITY_WIDTH / 2,
        margin: "0 -4px",
      }}
    >
      <path
        d={INFINITY_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={INFINITY_STROKE}
        opacity={0.15}
      />
      <path
        d={INFINITY_PATH}
        pathLength={100}
        fill="none"
        stroke="currentColor"
        strokeWidth={INFINITY_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${INFINITY_TRAIL} ${100 - INFINITY_TRAIL}`}
        className="agent-thinking-comet"
        style={{ animationDuration: `${INFINITY_DURATION_S}s` }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ timer */

/**
 * 每秒计时器走 ref 直写 textContent（与既有 WorkingClock 同模式），
 * 避免秒级 setState 让整个指示器每秒重渲染。
 */
function ElapsedTimer({
  startedAt,
  className,
}: {
  startedAt: number | null;
  className?: string;
}) {
  const clockRef = useRef<HTMLSpanElement>(null);
  const mountTimeRef = useRef<number | null>(null);
  if (mountTimeRef.current === null) {
    mountTimeRef.current = Date.now();
  }
  const anchor = startedAt ?? mountTimeRef.current;

  useEffect(() => {
    const clockNode = clockRef.current;
    if (!clockNode) {
      return undefined;
    }
    const update = () => {
      clockNode.textContent = formatDurationMs(Date.now() - anchor);
    };
    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [anchor]);

  return (
    <span ref={clockRef} className={cn("agent-thinking-timer", className)}>
      {formatDurationMs(Math.max(0, Date.now() - anchor))}
    </span>
  );
}

/* ----------------------------------------------------------------- loader */

export function AgentThinking({
  variant = "wave",
  label = "Thinking",
  tone,
  shimmer = true,
  showTimer = true,
  startedAt = null,
  className,
  labelClassName,
  timerClassName,
  ...rest
}: AgentThinkingProps) {
  const color = TONE_COLORS[tone ?? VARIANT_TONE[variant]];

  return (
    <div
      role="status"
      className={cn("agent-thinking", className)}
      style={{ color, "--agent-thinking-tone": color } as CSSProperties}
      {...rest}
    >
      {(variant === "wave" || variant === "spin") && (
        <DotsIndicator variant={variant} />
      )}
      {variant === "stars" && <StarsIndicator />}
      {variant === "infinity" && <InfinityIndicator />}
      <span
        aria-label={label}
        className={cn(
          "agent-thinking-label",
          shimmer && "is-shimmer",
          labelClassName,
        )}
      >
        {label}
      </span>
      {showTimer && (
        <ElapsedTimer startedAt={startedAt} className={timerClassName} />
      )}
    </div>
  );
}
