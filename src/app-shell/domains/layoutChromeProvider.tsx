import { createContext, useEffect, useMemo, useRef, type ReactNode } from "react";

/**
 * T2.3：Layout chrome 低 churn Context。
 * sidebar / panel / mode 等低频布局信号。
 */

export type LayoutChromeProviderValue = {
  appMode: unknown;
  centerMode: unknown;
  activeTab: unknown;
  accessMode: unknown;
  filePanelMode: unknown;
  gitPanelMode: unknown;
  sidebarCollapsed: unknown;
  sidebarWidth: unknown;
  rightPanelCollapsed: unknown;
  rightPanelWidth: unknown;
  isPanelLocked: unknown;
  expandSidebar: unknown;
  collapseSidebar: unknown;
  expandRightPanel: unknown;
  collapseRightPanel: unknown;
  setAppMode: unknown;
  setCenterMode: unknown;
  setActiveTab: unknown;
  setFilePanelMode: unknown;
  setGitPanelMode: unknown;
};

const LayoutChromeContext = createContext<LayoutChromeProviderValue | null>(
  null,
);

function areLayoutChromeValuesShallowEqual(
  left: LayoutChromeProviderValue,
  right: LayoutChromeProviderValue,
): boolean {
  if (Object.is(left, right)) return true;
  const keys = Object.keys(left) as Array<keyof LayoutChromeProviderValue>;
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

export function LayoutChromeProvider(props: {
  value: LayoutChromeProviderValue;
  children: ReactNode;
}) {
  const previousRef = useRef(props.value);
  const stableValue = areLayoutChromeValuesShallowEqual(
    previousRef.current,
    props.value,
  )
    ? previousRef.current
    : props.value;
  useEffect(() => {
    previousRef.current = stableValue;
  }, [stableValue]);
  return (
    <LayoutChromeContext.Provider value={stableValue}>
      {props.children}
    </LayoutChromeContext.Provider>
  );
}





export function useMemoizedLayoutChromeProviderValue(
  input: LayoutChromeProviderValue,
): LayoutChromeProviderValue {
  return useMemo(
    () => ({ ...input }),
    [
      input.appMode,
      input.centerMode,
      input.activeTab,
      input.accessMode,
      input.filePanelMode,
      input.gitPanelMode,
      input.sidebarCollapsed,
      input.sidebarWidth,
      input.rightPanelCollapsed,
      input.rightPanelWidth,
      input.isPanelLocked,
      input.expandSidebar,
      input.collapseSidebar,
      input.expandRightPanel,
      input.collapseRightPanel,
      input.setAppMode,
      input.setCenterMode,
      input.setActiveTab,
      input.setFilePanelMode,
      input.setGitPanelMode,
    ],
  );
}
