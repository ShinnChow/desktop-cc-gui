import { memo } from "react";
import { useAppShellLayoutNodesSection } from "../sections/useAppShellLayoutNodesSection";
import { useAppShellSearchAndComposerSection } from "../sections/useAppShellSearchAndComposerSection";
import type { AppShellSearchAndComposerSectionInput } from "../sections/useAppShellSearchAndComposerSection";
import { useAppShellSections } from "../sections/useAppShellSections";
import { renderAppShell } from "../render/renderAppShell";
import type { AppShellDomainContexts } from "../domains/appShellDomainContexts";

/**
 * T2.1–T2.3：挂在 zone Providers 之下的 shell 视图层。
 * 在此调用 search/sections/layout hooks，使 Context 对 section 可读。
 */
export const AppShellView = memo(function AppShellView(props: {
  appShellDomainContexts: AppShellDomainContexts;
  searchAndComposerInput: AppShellSearchAndComposerSectionInput;
}) {
  const searchAndComposerSection = useAppShellSearchAndComposerSection(
    props.searchAndComposerInput,
  );

  const sections = useAppShellSections({
    appShellDomainContexts: props.appShellDomainContexts,
    searchAndComposerSection,
  });

  const isPullRequestComposer = sections.isPullRequestComposer;

  const layoutNodes = useAppShellLayoutNodesSection({
    appShellDomainContexts: props.appShellDomainContexts,
    searchAndComposerSection,
    sections,
    isPullRequestComposer,
    isPullRequestComposerFromSections: sections.isPullRequestComposer,
  });

  return renderAppShell({
    appShellDomainContexts: props.appShellDomainContexts,
    searchAndComposerSection,
    sections,
    layoutNodes,
    isPullRequestComposer,
    isPullRequestComposerFromSections: sections.isPullRequestComposer,
  });
});
