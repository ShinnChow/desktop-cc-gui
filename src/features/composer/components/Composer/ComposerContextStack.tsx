import { useTranslation } from "react-i18next";
import type {
  ComposerProps,
  ManualMemorySelection,
  NoteCardSelection,
} from "./types";
import type { CodeAnnotationSelection } from "../../../code-annotations/types";
import { formatCodeAnnotationLineRange } from "../../../code-annotations/utils/codeAnnotations";
import {
  resolveManualMemoryChipDetail,
  resolveManualMemoryChipTitle,
  resolveNoteCardChipDetail,
  resolveNoteCardChipTitle,
} from "../../utils/contextSelectionChips";
import { ReviewInlinePrompt } from "../ReviewInlinePrompt";

export interface ComposerContextStackProps {
  selectedManualMemories: ManualMemorySelection[];
  carryOverManualMemoryIds: string[];
  retainedManualMemoryIds: string[];
  onRemoveManualMemory: (memoryId: string) => void;
  selectedNoteCards: NoteCardSelection[];
  carryOverNoteCardIds: string[];
  retainedNoteCardIds: string[];
  onRemoveNoteCard: (noteCardId: string) => void;
  selectedCodeAnnotations: CodeAnnotationSelection[];
  onRemoveCodeAnnotation: (annotationId: string) => void;
  shouldRenderReviewInlinePrompt: boolean;
  reviewPrompt: ComposerProps["reviewPrompt"];
  onReviewPromptClose: ComposerProps["onReviewPromptClose"];
  onReviewPromptShowPreset: ComposerProps["onReviewPromptShowPreset"];
  onReviewPromptChoosePreset: ComposerProps["onReviewPromptChoosePreset"];
  highlightedPresetIndex: ComposerProps["highlightedPresetIndex"];
  onReviewPromptHighlightPreset: ComposerProps["onReviewPromptHighlightPreset"];
  highlightedBranchIndex: ComposerProps["highlightedBranchIndex"];
  onReviewPromptHighlightBranch: ComposerProps["onReviewPromptHighlightBranch"];
  highlightedCommitIndex: ComposerProps["highlightedCommitIndex"];
  onReviewPromptHighlightCommit: ComposerProps["onReviewPromptHighlightCommit"];
  onReviewPromptSelectBranch: ComposerProps["onReviewPromptSelectBranch"];
  onReviewPromptSelectBranchAtIndex: ComposerProps["onReviewPromptSelectBranchAtIndex"];
  onReviewPromptConfirmBranch: ComposerProps["onReviewPromptConfirmBranch"];
  onReviewPromptSelectCommit: ComposerProps["onReviewPromptSelectCommit"];
  onReviewPromptSelectCommitAtIndex: ComposerProps["onReviewPromptSelectCommitAtIndex"];
  onReviewPromptConfirmCommit: ComposerProps["onReviewPromptConfirmCommit"];
  onReviewPromptUpdateCustomInstructions: ComposerProps["onReviewPromptUpdateCustomInstructions"];
  onReviewPromptConfirmCustom: ComposerProps["onReviewPromptConfirmCustom"];
  onReviewPromptKeyDown: ComposerProps["onReviewPromptKeyDown"];
}

export function ComposerContextStack({
  selectedManualMemories,
  carryOverManualMemoryIds,
  retainedManualMemoryIds,
  onRemoveManualMemory: handleRemoveManualMemory,
  selectedNoteCards,
  carryOverNoteCardIds,
  retainedNoteCardIds,
  onRemoveNoteCard: handleRemoveNoteCard,
  selectedCodeAnnotations,
  onRemoveCodeAnnotation: handleRemoveCodeAnnotation,
  shouldRenderReviewInlinePrompt,
  reviewPrompt,
  onReviewPromptClose: _onReviewPromptClose,
  onReviewPromptShowPreset: _onReviewPromptShowPreset,
  onReviewPromptChoosePreset: _onReviewPromptChoosePreset,
  highlightedPresetIndex: _highlightedPresetIndex,
  onReviewPromptHighlightPreset: _onReviewPromptHighlightPreset,
  highlightedBranchIndex: _highlightedBranchIndex,
  onReviewPromptHighlightBranch: _onReviewPromptHighlightBranch,
  highlightedCommitIndex: _highlightedCommitIndex,
  onReviewPromptHighlightCommit: _onReviewPromptHighlightCommit,
  onReviewPromptSelectBranch: _onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex: _onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch: _onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit: _onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex: _onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit: _onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions: _onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom: _onReviewPromptConfirmCustom,
  onReviewPromptKeyDown: _onReviewPromptKeyDown,
}: ComposerContextStackProps) {
  const { t } = useTranslation();
  const manualMemorySelectionHintCopy =
    carryOverManualMemoryIds.length > 0
      ? t("composer.contextLedgerCarryOverReasonWillCarry")
      : retainedManualMemoryIds.length > 0
        ? t("composer.contextLedgerCarryOverReasonInherited")
        : t("composer.manualMemorySelectionHint");
  const noteCardSelectionHintCopy =
    carryOverNoteCardIds.length > 0
      ? t("composer.contextLedgerCarryOverReasonWillCarry")
      : retainedNoteCardIds.length > 0
        ? t("composer.contextLedgerCarryOverReasonInherited")
        : t("composer.noteCardSelectionHint");
  return (
  <div className="composer-context-stack">
    {selectedManualMemories.length > 0 && (
      <div className="composer-memory-strip">
        <div className="composer-memory-strip-head">
          <span className="composer-memory-strip-label">
            {t("composer.manualMemorySelection", {
              count: selectedManualMemories.length,
            })}
          </span>
          <span className="composer-memory-strip-hint">
            {manualMemorySelectionHintCopy}
          </span>
        </div>
        <div className="composer-memory-chip-list">
          {selectedManualMemories.map((memory, memoryIndex) => {
            const chipTitle = `[M${memoryIndex + 1}] ${resolveManualMemoryChipTitle(memory)}`;
            const chipDetail =
              resolveManualMemoryChipDetail(memory);
            return (
              <article
                key={`manual-memory-${memory.id}`}
                className="composer-memory-chip"
              >
                <button
                  type="button"
                  className="composer-memory-chip-remove"
                  onClick={() =>
                    handleRemoveManualMemory(memory.id)
                  }
                  title={t("composer.manualMemoryRemove", {
                    title: memory.title,
                  })}
                  aria-label={t("composer.manualMemoryRemove", {
                    title: memory.title,
                  })}
                >
                  ×
                </button>
                <div className="composer-memory-chip-main">
                  <span className="composer-memory-chip-title">
                    {chipTitle}
                  </span>
                  {chipDetail && (
                    <span className="composer-memory-chip-summary">
                      {chipDetail}
                    </span>
                  )}
                  <span className="composer-memory-chip-meta">
                    {carryOverManualMemoryIds.includes(
                      memory.id,
                    ) ? (
                      <span className="composer-memory-chip-state composer-memory-chip-state--carry">
                        {t(
                          "composer.contextLedgerCarryOverReasonWillCarry",
                        )}
                      </span>
                    ) : retainedManualMemoryIds.includes(
                        memory.id,
                      ) ? (
                      <span className="composer-memory-chip-state composer-memory-chip-state--retained">
                        {t(
                          "composer.contextLedgerCarryOverReasonInherited",
                        )}
                      </span>
                    ) : null}
                    <span>{memory.kind}</span>
                    <span>{memory.importance}</span>
                    <span>
                      {new Date(
                        memory.updatedAt,
                      ).toLocaleDateString(undefined, {
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </span>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    )}

    {selectedNoteCards.length > 0 && (
      <div className="composer-memory-strip">
        <div className="composer-memory-strip-head">
          <span className="composer-memory-strip-label">
            {t("composer.noteCardSelection", {
              count: selectedNoteCards.length,
            })}
          </span>
          <span className="composer-memory-strip-hint">
            {noteCardSelectionHintCopy}
          </span>
        </div>
        <div className="composer-memory-chip-list">
          {selectedNoteCards.map((noteCard) => {
            const chipTitle = resolveNoteCardChipTitle(noteCard);
            const chipDetail = resolveNoteCardChipDetail(noteCard);
            return (
              <article
                key={`note-card-${noteCard.id}`}
                className="composer-memory-chip"
              >
                <button
                  type="button"
                  className="composer-memory-chip-remove"
                  onClick={() => handleRemoveNoteCard(noteCard.id)}
                  title={t("composer.noteCardRemove", {
                    title: noteCard.title,
                  })}
                  aria-label={t("composer.noteCardRemove", {
                    title: noteCard.title,
                  })}
                >
                  ×
                </button>
                <div className="composer-memory-chip-main">
                  <span className="composer-memory-chip-title">
                    {chipTitle}
                  </span>
                  {chipDetail && (
                    <span className="composer-memory-chip-summary">
                      {chipDetail}
                    </span>
                  )}
                  <span className="composer-memory-chip-meta">
                    {carryOverNoteCardIds.includes(noteCard.id) ? (
                      <span className="composer-memory-chip-state composer-memory-chip-state--carry">
                        {t(
                          "composer.contextLedgerCarryOverReasonWillCarry",
                        )}
                      </span>
                    ) : retainedNoteCardIds.includes(
                        noteCard.id,
                      ) ? (
                      <span className="composer-memory-chip-state composer-memory-chip-state--retained">
                        {t(
                          "composer.contextLedgerCarryOverReasonInherited",
                        )}
                      </span>
                    ) : null}
                    {noteCard.archived ? (
                      <span>
                        {t("composer.noteCardArchivedBadge")}
                      </span>
                    ) : null}
                    <span>
                      {new Date(
                        noteCard.updatedAt,
                      ).toLocaleDateString(undefined, {
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </span>
                    {noteCard.imageCount > 0 ? (
                      <span>
                        {t("noteCards.imageCount", {
                          count: noteCard.imageCount,
                        })}
                      </span>
                    ) : null}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    )}

    {selectedCodeAnnotations.length > 0 && (
      <div className="composer-memory-strip composer-code-annotation-strip">
        <div className="composer-memory-strip-head">
          <span className="composer-memory-strip-label">
            {t("composer.codeAnnotationSelection", {
              count: selectedCodeAnnotations.length,
            })}
          </span>
          <span className="composer-memory-strip-hint">
            {t("composer.codeAnnotationSelectionHint", {
              count: selectedCodeAnnotations.length,
            })}
          </span>
        </div>
        <div className="composer-memory-chip-list composer-code-annotation-list">
          {selectedCodeAnnotations.map((annotation) => {
            const lineLabel = formatCodeAnnotationLineRange(
              annotation.lineRange,
            );
            const fileName =
              annotation.path
                .split(/[\\/]/)
                .filter(Boolean)
                .pop() ?? annotation.path;
            return (
              <article
                key={annotation.id}
                className="composer-memory-chip composer-code-annotation-chip"
              >
                <button
                  type="button"
                  className="composer-memory-chip-remove"
                  onClick={() =>
                    handleRemoveCodeAnnotation(annotation.id)
                  }
                  title={t("composer.codeAnnotationRemove", {
                    path: annotation.path,
                  })}
                  aria-label={t("composer.codeAnnotationRemove", {
                    path: annotation.path,
                  })}
                >
                  ×
                </button>
                <div className="composer-memory-chip-main">
                  <span className="composer-memory-chip-title">
                    {fileName} · {lineLabel}
                  </span>
                  <span className="composer-memory-chip-summary">
                    {annotation.body}
                  </span>
                  <span className="composer-memory-chip-meta">
                    <span>{annotation.path}</span>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    )}

    {shouldRenderReviewInlinePrompt && reviewPrompt && (
      <div
        className="composer-suggestions popover-surface review-inline-suggestions"
        role="listbox"
        style={{
          position: "relative",
          left: "auto",
          right: "auto",
          top: "auto",
          bottom: "auto",
          width: "min(540px, 100%)",
          maxWidth: "min(540px, 100%)",
          marginBottom: "4px",
        }}
      >
        <ReviewInlinePrompt
          reviewPrompt={reviewPrompt}
          onClose={_onReviewPromptClose!}
          onShowPreset={_onReviewPromptShowPreset!}
          onChoosePreset={_onReviewPromptChoosePreset!}
          highlightedPresetIndex={_highlightedPresetIndex!}
          onHighlightPreset={_onReviewPromptHighlightPreset!}
          highlightedBranchIndex={_highlightedBranchIndex!}
          onHighlightBranch={_onReviewPromptHighlightBranch!}
          highlightedCommitIndex={_highlightedCommitIndex!}
          onHighlightCommit={_onReviewPromptHighlightCommit!}
          onSelectBranch={_onReviewPromptSelectBranch!}
          onSelectBranchAtIndex={
            _onReviewPromptSelectBranchAtIndex!
          }
          onConfirmBranch={_onReviewPromptConfirmBranch!}
          onSelectCommit={_onReviewPromptSelectCommit!}
          onSelectCommitAtIndex={
            _onReviewPromptSelectCommitAtIndex!
          }
          onConfirmCommit={_onReviewPromptConfirmCommit!}
          onUpdateCustomInstructions={
            _onReviewPromptUpdateCustomInstructions!
          }
          onConfirmCustom={_onReviewPromptConfirmCustom!}
          onKeyDown={_onReviewPromptKeyDown}
        />
      </div>
    )}
  </div>
  );
}
