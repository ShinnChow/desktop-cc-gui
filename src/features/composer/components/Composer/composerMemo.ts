import type { ComposerProps } from "./types";

/** ActiveCanvas 下灌的热字段：轻量/空闲时忽略，避免历史 hydrate 打爆 Composer 重渲 */
const COMPOSER_CANVAS_ONLY_PROPS = new Set<keyof ComposerProps>([
  "items",
  "threadItemsByThread",
  "threadStatusById",
  "threadParentById",
  "contextUsage",
  "accountRateLimits",
  "userInputRequests",
  "isContextCompacting",
  "codexCompactionLifecycleState",
  "codexCompactionSource",
  "codexCompactionCompletedAt",
  "lastTokenUsageUpdatedAt",
]);

export function areComposerPropsEqual(
  previous: ComposerProps,
  next: ComposerProps,
): boolean {
  // 非流式：忽略 canvas 大对象。冷启 list/history hydrate 会高频换 items 引用，
  // 若每帧重渲 ComposerLight/Impl，与点击叠在一起会假死（973 之后 dc97 加重了 status/items 下灌）。
  const eitherProcessing =
    Boolean(previous.isProcessing) || Boolean(next.isProcessing);
  if (!eitherProcessing) {
    return areComposerPropsShallowEqual(
      previous,
      next,
      COMPOSER_CANVAS_ONLY_PROPS,
    );
  }
  const shouldUseInteractionLaneComparator =
    Boolean(previous.isProcessing) && Boolean(next.isProcessing);
  if (!shouldUseInteractionLaneComparator) {
    return areComposerPropsShallowEqual(previous, next, null);
  }
  if ((previous.items?.length ?? 0) === 0 && (next.items?.length ?? 0) > 0) {
    return false;
  }
  return areComposerPropsShallowEqual(
    previous,
    next,
    COMPOSER_CANVAS_ONLY_PROPS,
  );
}

function areComposerPropsShallowEqual(
  previous: ComposerProps,
  next: ComposerProps,
  ignoredProps: ReadonlySet<keyof ComposerProps> | null,
): boolean {
  const previousKeys = Object.keys(previous) as Array<keyof ComposerProps>;
  const nextKeys = Object.keys(next) as Array<keyof ComposerProps>;
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return false;
    }
    if (ignoredProps?.has(key)) {
      continue;
    }
    if (!Object.is(previous[key], next[key])) {
      return false;
    }
  }
  return true;
}
