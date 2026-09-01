import { CollapsibleReveal } from "../../../../components/common/CollapsibleReveal";
import { copyTextToClipboard } from "../../../../utils/clipboard";
import { Markdown } from "../Markdown";
import type {
  ExitPlanCardContent,
  ExitPlanExecutionMode,
} from "./genericToolPresentation";

export type ExitPlanToolCopy = {
  ariaLabel: string;
  title: string;
  modeLabel: string;
  planSummary: string;
  executionHandoff: string;
  executionHandoffDescription: string;
  executionModeLabel: string;
  executionModeDescription: string;
  executeDefaultAction: string;
  executeFullAccessAction: string;
  planFile: string;
  rawOutput: string;
  copy: string;
  copied: string;
};

type ExitPlanToolContentProps = {
  itemId: string;
  content: ExitPlanCardContent;
  copy: ExitPlanToolCopy;
  workspaceId?: string | null;
  isExpanded: boolean;
  copiedPlanMarkdown: boolean;
  onToggle: () => void;
  onCopiedPlanMarkdownChange: (copied: boolean) => void;
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  selectedExecutionMode?: ExitPlanExecutionMode | null;
  onExecute?: (itemId: string, mode: ExitPlanExecutionMode) => Promise<void> | void;
  shouldShowRawOutput: boolean;
};

export function ExitPlanToolContent({
  itemId,
  content,
  copy,
  workspaceId,
  isExpanded,
  copiedPlanMarkdown,
  onToggle,
  onCopiedPlanMarkdownChange,
  activeEngine,
  selectedExecutionMode = null,
  onExecute,
  shouldShowRawOutput,
}: ExitPlanToolContentProps) {
  const executionLocked = selectedExecutionMode !== null;

  return (
    <section className="tool-exit-plan-card" aria-label={copy.ariaLabel}>
      <div className={`tool-exit-plan-card-header${isExpanded ? " is-expanded" : ""}`}>
        <button
          type="button"
          className="tool-exit-plan-card-toggle"
          onClick={onToggle}
          aria-expanded={isExpanded}
        >
          <div className="tool-exit-plan-card-title-wrap">
            <span className="codicon codicon-notebook tool-exit-plan-card-icon" aria-hidden />
            <div className="tool-exit-plan-card-title-copy">
              <span className="tool-exit-plan-card-title">{copy.title}</span>
              <span className="tool-exit-plan-card-subtitle">{copy.modeLabel}</span>
            </div>
          </div>
          <span
            className={`codicon ${isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"} tool-exit-plan-card-chevron`}
            aria-hidden
          />
        </button>
        <div className="tool-exit-plan-card-header-actions">
          {content.planMarkdown ? (
            <button
              type="button"
              className={`tool-exit-plan-card-copy-button${copiedPlanMarkdown ? " is-copied" : ""}`}
              title={copiedPlanMarkdown ? copy.copied : copy.copy}
              aria-label={copiedPlanMarkdown ? copy.copied : copy.copy}
              onClick={(event) => {
                event.stopPropagation();
                void copyTextToClipboard(content.planMarkdown).then((copied) => {
                  if (!copied) {
                    return;
                  }
                  onCopiedPlanMarkdownChange(true);
                  window.setTimeout(() => onCopiedPlanMarkdownChange(false), 1800);
                });
              }}
            >
              <span
                className={`codicon ${copiedPlanMarkdown ? "codicon-check" : "codicon-copy"} tool-exit-plan-card-copy-icon`}
                aria-hidden
              />
              <span className="tool-exit-plan-card-copy-label">
                {copiedPlanMarkdown ? copy.copied : copy.copy}
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <CollapsibleReveal open={isExpanded}>
        <div className="tool-exit-plan-card-body">
          {content.planMarkdown ? (
            <section className="tool-exit-plan-card-section">
              <div className="tool-exit-plan-card-section-label">{copy.planSummary}</div>
              <div className="tool-exit-plan-card-markdown">
                <Markdown value={content.planMarkdown} workspaceId={workspaceId} preserveFormatting />
              </div>
            </section>
          ) : null}

          <section className="tool-exit-plan-card-section">
            <div className="tool-exit-plan-card-section-label">{copy.executionHandoff}</div>
            <p className="tool-exit-plan-card-handoff-copy">{copy.executionHandoffDescription}</p>
          </section>

          {activeEngine === "claude" && onExecute ? (
            <section className="tool-exit-plan-card-section tool-exit-plan-card-execution-section">
              <div className="tool-exit-plan-card-section-label">{copy.executionModeLabel}</div>
              <p className="tool-exit-plan-card-handoff-copy">{copy.executionModeDescription}</p>
              <div className="tool-exit-plan-card-actions">
                <button
                  type="button"
                  className={`tool-exit-plan-card-action is-default${selectedExecutionMode === "default" ? " is-selected" : ""}`}
                  disabled={executionLocked}
                  onClick={() => {
                    if (!executionLocked) void onExecute(itemId, "default");
                  }}
                >
                  <span className="codicon codicon-shield tool-exit-plan-card-action-icon" aria-hidden />
                  <span>
                    {selectedExecutionMode === "default"
                      ? `${copy.executeDefaultAction} · 已选`
                      : copy.executeDefaultAction}
                  </span>
                </button>
                <button
                  type="button"
                  className={`tool-exit-plan-card-action is-primary${selectedExecutionMode === "full-access" ? " is-selected" : ""}`}
                  disabled={executionLocked}
                  onClick={() => {
                    if (!executionLocked) void onExecute(itemId, "full-access");
                  }}
                >
                  <span className="codicon codicon-rocket tool-exit-plan-card-action-icon" aria-hidden />
                  <span>
                    {selectedExecutionMode === "full-access"
                      ? `${copy.executeFullAccessAction} · 已选`
                      : copy.executeFullAccessAction}
                  </span>
                </button>
              </div>
            </section>
          ) : null}

          {content.planFilePath ? (
            <section className="tool-exit-plan-card-section">
              <div className="tool-exit-plan-card-section-label">{copy.planFile}</div>
              <code className="tool-exit-plan-card-path" title={content.planFilePath}>
                {content.planFilePath}
              </code>
            </section>
          ) : null}

          {shouldShowRawOutput ? (
            <section className="tool-exit-plan-card-section">
              <div className="tool-exit-plan-card-section-label">{copy.rawOutput}</div>
              <div className="tool-exit-plan-card-markdown">
                <Markdown value={content.rawText} workspaceId={workspaceId} />
              </div>
            </section>
          ) : null}
        </div>
      </CollapsibleReveal>
    </section>
  );
}
