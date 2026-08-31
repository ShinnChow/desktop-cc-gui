

type RewindSupportedEngine = "claude" | "codex";

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function mapWithConcurrency<T>(
  items: string[],
  concurrency: number,
  worker: (item: string) => Promise<T>,
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: T[] = [];
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      const item = items[currentIndex];
      if (!item) {
        continue;
      }
      const result = await worker(item);
      results.push(result);
    }
  };
  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

export function resolveRewindSupportedEngine(
  threadId: string,
): RewindSupportedEngine | null {
  const normalized = threadId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("claude:")) {
    return "claude";
  }
  if (normalized.startsWith("codex:")) {
    return "codex";
  }
  if (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("codex-pending-") ||
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("grok:") ||
    normalized.startsWith("grok-pending-") ||
    normalized.startsWith("kimi:") ||
    normalized.startsWith("kimi-pending-") ||
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-") ||
    normalized.startsWith("dsh:") ||
    normalized.startsWith("dsh-pending-")
  ) {
    return null;
  }
  if (normalized.includes(":")) {
    return null;
  }
  return "codex";
}
