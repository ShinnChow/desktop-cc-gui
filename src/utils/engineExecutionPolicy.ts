import type { EngineType } from "../types";

export type ExecutableEngineType = Exclude<EngineType, "gemini">;

export const GEMINI_EXECUTION_DISABLED_MESSAGE =
  "Selected CLI engine is disabled by product policy";

export function isEngineExecutionEnabled(
  engine: unknown,
): engine is ExecutableEngineType {
  return (
    engine === "codex" ||
    engine === "claude" ||
    engine === "grok" ||
    engine === "kimi" ||
    engine === "opencode" ||
    engine === "pi" ||
    engine === "omp" ||
    engine === "dsh" ||
    engine === "qoder"
  );
}

export function assertEngineExecutionEnabled(
  engine: unknown,
): asserts engine is ExecutableEngineType {
  if (!isEngineExecutionEnabled(engine)) {
    throw new Error(GEMINI_EXECUTION_DISABLED_MESSAGE);
  }
}

export function normalizeEngineForExecution(
  engine: unknown,
  fallback: ExecutableEngineType = "codex",
): ExecutableEngineType {
  return isEngineExecutionEnabled(engine) ? engine : fallback;
}
