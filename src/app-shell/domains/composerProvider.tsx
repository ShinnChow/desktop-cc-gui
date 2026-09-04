import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { type RuntimeThreadProviderValue } from "./runtimeThreadProvider";

/**
 * T2.2：Composer 子树 mid-churn Context。
 * 订阅 composer 发送/草稿相关 + 窄 runtime 信号（canInterrupt）。
 */

export type ComposerProviderValue = {
  handleSend: unknown;
  handleDraftChange: unknown;
  getActiveDraft: unknown;
  queueMessage: unknown;
  clearActiveImages: unknown;
  activeImages: unknown;
  composerInsert: unknown;
  setComposerInsert: unknown;
  prefillDraft: unknown;
  setPrefillDraft: unknown;
  interruptTurn: unknown;
  /** 可由 RuntimeThread 覆盖 */
  canInterrupt: boolean;
};

const ComposerContext = createContext<ComposerProviderValue | null>(null);

function areComposerValuesShallowEqual(
  left: ComposerProviderValue,
  right: ComposerProviderValue,
): boolean {
  if (Object.is(left, right)) return true;
  const keys = Object.keys(left) as Array<keyof ComposerProviderValue>;
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

export function ComposerProvider(props: {
  value: ComposerProviderValue;
  children: ReactNode;
}) {
  const previousRef = useRef(props.value);
  const stableValue = areComposerValuesShallowEqual(
    previousRef.current,
    props.value,
  )
    ? previousRef.current
    : props.value;
  useEffect(() => {
    previousRef.current = stableValue;
  }, [stableValue]);
  return (
    <ComposerContext.Provider value={stableValue}>
      {props.children}
    </ComposerContext.Provider>
  );
}



export function useOptionalComposerContext(): ComposerProviderValue | null {
  return useContext(ComposerContext);
}

/**
 * Composer 侧 canInterrupt：RuntimeThread > ComposerProvider > prop fallback。
 */
export function resolveComposerCanInterrupt(input: {
  propCanInterrupt: boolean;
  composerValue: ComposerProviderValue | null;
  runtimeThreadValue: RuntimeThreadProviderValue | null;
}): boolean {
  if (input.runtimeThreadValue) {
    return input.runtimeThreadValue.canInterrupt;
  }
  if (input.composerValue) {
    return input.composerValue.canInterrupt;
  }
  return input.propCanInterrupt;
}



export function useMemoizedComposerProviderValue(
  input: ComposerProviderValue,
): ComposerProviderValue {
  return useMemo(
    () => ({
      handleSend: input.handleSend,
      handleDraftChange: input.handleDraftChange,
      getActiveDraft: input.getActiveDraft,
      queueMessage: input.queueMessage,
      clearActiveImages: input.clearActiveImages,
      activeImages: input.activeImages,
      composerInsert: input.composerInsert,
      setComposerInsert: input.setComposerInsert,
      prefillDraft: input.prefillDraft,
      setPrefillDraft: input.setPrefillDraft,
      interruptTurn: input.interruptTurn,
      canInterrupt: input.canInterrupt,
    }),
    [
      input.handleSend,
      input.handleDraftChange,
      input.getActiveDraft,
      input.queueMessage,
      input.clearActiveImages,
      input.activeImages,
      input.composerInsert,
      input.setComposerInsert,
      input.prefillDraft,
      input.setPrefillDraft,
      input.interruptTurn,
      input.canInterrupt,
    ],
  );
}
