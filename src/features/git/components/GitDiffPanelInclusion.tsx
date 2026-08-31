import Check from "lucide-react/dist/esm/icons/check";
import Minus from "lucide-react/dist/esm/icons/minus";
import {
  FloatingTooltipButton,
  type FloatingTooltipSide,
} from "@/components/ui/floating-tooltip-button";
import { normalizeGitPath } from "../utils/commitScope";

export type InclusionState = "all" | "none" | "partial";

export const normalizeDiffPath = normalizeGitPath;





export function getFileInclusionState(
  path: string,
  includedPaths: Set<string>,
  excludedPaths: Set<string>,
  partialPaths: Set<string> = new Set(),
): InclusionState {
  const normalizedPath = normalizeDiffPath(path);
  if (partialPaths.has(normalizedPath)) {
    return "partial";
  }
  const isIncluded = includedPaths.has(normalizedPath);
  const isExcluded = excludedPaths.has(normalizedPath);
  if (isIncluded && isExcluded) {
    return "partial";
  }
  return isIncluded ? "all" : "none";
}

export async function runSequentialPathAction(
  paths: string[],
  action?: (path: string) => Promise<void> | void,
) {
  if (!action) {
    return;
  }
  for (const path of paths) {
    await action(path);
  }
}

type InclusionToggleProps = {
  state: InclusionState;
  label: string;
  onToggle: () => void;
  className?: string;
  disabled?: boolean;
  stopPropagation?: boolean;
  /** Prefer bottom for section headers so tips stay inside the list. */
  tooltipSide?: FloatingTooltipSide;
};

export function InclusionToggle({
  state,
  label,
  onToggle,
  className,
  disabled = false,
  stopPropagation = false,
  tooltipSide = "bottom",
}: InclusionToggleProps) {
  return (
    <FloatingTooltipButton
      type="button"
      role="checkbox"
      aria-checked={state === "partial" ? "mixed" : state === "all"}
      aria-label={label}
      tooltipLabel={label}
      tooltipSide={tooltipSide}
      tooltipAlign="end"
      tooltipDelay={180}
      className={`git-commit-scope-toggle is-${state}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
        onToggle();
      }}
    >
      {state === "all" ? <Check size={12} aria-hidden /> : null}
      {state === "partial" ? <Minus size={12} aria-hidden /> : null}
    </FloatingTooltipButton>
  );
}
