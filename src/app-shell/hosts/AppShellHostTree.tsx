import { memo } from "react";
import { AppShellZoneProviders } from "../domains/appShellZoneProviders";
import { AppShellView } from "../assembly/appShellView";
import type { AppShellSearchAndComposerSectionInput } from "../sections/useAppShellSearchAndComposerSection";
import { AppShellHostBusProvider } from "./appShellHostBus";
import { useAppShellSessionHost } from "./useAppShellSessionHost";
import { useAppShellCatalogHost } from "./useAppShellCatalogHost";
import { useAppShellGitSurfaceHost } from "./useAppShellGitSurfaceHost";
import { useAppShellRuntimeThreadHost } from "./useAppShellRuntimeThreadHost";
import { useAppShellComposerHost } from "./useAppShellComposerHost";
import { useAppShellWorkspaceFlowsHost } from "./useAppShellWorkspaceFlowsHost";
import { useAppShellAssemblyHost } from "./useAppShellAssemblyHost";

const AppShellAssembledView = memo(function AppShellAssembledView() {
  const {
    runtimeThreadProviderValue,
    composerProviderValue,
    layoutChromeProviderValue,
    appShellDomainContexts,
    searchAndComposerInput,
  } = useAppShellAssemblyHost();
  return (
    <AppShellZoneProviders
      runtimeThread={runtimeThreadProviderValue}
      composer={composerProviderValue}
      layoutChrome={layoutChromeProviderValue}
    >
      <AppShellView
        appShellDomainContexts={appShellDomainContexts}
        searchAndComposerInput={
          searchAndComposerInput as AppShellSearchAndComposerSectionInput
        }
      />
    </AppShellZoneProviders>
  );
});

const WorkspaceFlowsHost = memo(function WorkspaceFlowsHost() {
  useAppShellWorkspaceFlowsHost();
  return <AppShellAssembledView />;
});

const ComposerHost = memo(function ComposerHost() {
  useAppShellComposerHost();
  return <WorkspaceFlowsHost />;
});

const RuntimeThreadHost = memo(function RuntimeThreadHost() {
  useAppShellRuntimeThreadHost();
  return <ComposerHost />;
});

const CatalogHost = memo(function CatalogHost() {
  useAppShellCatalogHost();
  return <RuntimeThreadHost />;
});

const GitSurfaceHost = memo(function GitSurfaceHost() {
  useAppShellGitSurfaceHost();
  return <CatalogHost />;
});

const SessionHost = memo(function SessionHost() {
  useAppShellSessionHost();
  return <GitSurfaceHost />;
});

/**
 * 刀 1：嵌套 memo Host。每个 Host 自己跑 hook 图；
 * 子树只通过 bus 字段订阅，父 Host 的热状态不会重跑子 Host 的 hooks。
 */
export function AppShellHostTree() {
  return (
    <AppShellHostBusProvider>
      <SessionHost />
    </AppShellHostBusProvider>
  );
}
