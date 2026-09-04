import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * T2.1 POC：RuntimeThread 热路径 Context。
 *
 * - 高 churn 会话字段经 Provider 下发，减少「根解构 → 多层 props 透传」
 * - value shallow 稳定：字段未变时保持同一引用
 * - 窄 hook：`useRuntimeThreadCanInterrupt` 等让消费者可脱离散装 props
 *
 * POC 边界：AppShell 仍计算 projection（根仍会因 threads 更新而重跑）；
 * 全量「根零订阅热状态」需后续把 host 下沉到 Provider 子树（T2.x）。
 */

export type RuntimeThreadProviderValue = {
  activeItems: unknown;
  activePlan: unknown;
  activeRateLimits: unknown;
  activeTokenUsage: unknown;
  activeTurnId: unknown;
  canInterrupt: boolean;
  isProcessing: boolean;
  isReviewing: boolean;
  timelinePlan: unknown;
  interruptTurn: unknown;
  runtimeThreadBoundary: unknown;
};

const RuntimeThreadContext = createContext<RuntimeThreadProviderValue | null>(
  null,
);

export function areRuntimeThreadValuesShallowEqual(
  left: RuntimeThreadProviderValue,
  right: RuntimeThreadProviderValue,
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  const keys = Object.keys(left) as Array<keyof RuntimeThreadProviderValue>;
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  return keys.every((key) => Object.is(left[key], right[key]));
}

export function RuntimeThreadProvider(props: {
  value: RuntimeThreadProviderValue;
  children: ReactNode;
}) {
  const previousRef = useRef(props.value);
  const stableValue = areRuntimeThreadValuesShallowEqual(
    previousRef.current,
    props.value,
  )
    ? previousRef.current
    : props.value;

  useEffect(() => {
    previousRef.current = stableValue;
  }, [stableValue]);

  return (
    <RuntimeThreadContext.Provider value={stableValue}>
      {props.children}
    </RuntimeThreadContext.Provider>
  );
}



/** Provider 外返回 null（单测 / 非 shell 边界兼容）。 */
export function useOptionalRuntimeThreadContext(): RuntimeThreadProviderValue | null {
  return useContext(RuntimeThreadContext);
}

export function useRuntimeThreadCanInterrupt(): boolean {
  const fromContext = useOptionalRuntimeThreadContext();
  if (fromContext) {
    return fromContext.canInterrupt;
  }
  throw new Error(
    "useRuntimeThreadCanInterrupt must be used within RuntimeThreadProvider",
  );
}

/**
 * 解析 canInterrupt：优先 Context（T2.1），否则 fallback 到 prop（单测兼容）。
 */
export function resolveRuntimeThreadCanInterrupt(input: {
  propCanInterrupt: boolean;
  contextValue: RuntimeThreadProviderValue | null;
}): boolean {
  return input.contextValue?.canInterrupt ?? input.propCanInterrupt;
}

export function useMemoizedRuntimeThreadProviderValue(input: {
  activeItems: unknown;
  activePlan: unknown;
  activeRateLimits: unknown;
  activeTokenUsage: unknown;
  activeTurnId: unknown;
  canInterrupt: boolean;
  isProcessing: boolean;
  isReviewing: boolean;
  timelinePlan: unknown;
  interruptTurn: unknown;
  runtimeThreadBoundary: unknown;
}): RuntimeThreadProviderValue {
  return useMemo(
    () => ({
      activeItems: input.activeItems,
      activePlan: input.activePlan,
      activeRateLimits: input.activeRateLimits,
      activeTokenUsage: input.activeTokenUsage,
      activeTurnId: input.activeTurnId,
      canInterrupt: input.canInterrupt,
      isProcessing: input.isProcessing,
      isReviewing: input.isReviewing,
      timelinePlan: input.timelinePlan,
      interruptTurn: input.interruptTurn,
      runtimeThreadBoundary: input.runtimeThreadBoundary,
    }),
    [
      input.activeItems,
      input.activePlan,
      input.activeRateLimits,
      input.activeTokenUsage,
      input.activeTurnId,
      input.canInterrupt,
      input.isProcessing,
      input.isReviewing,
      input.timelinePlan,
      input.interruptTurn,
      input.runtimeThreadBoundary,
    ],
  );
}
