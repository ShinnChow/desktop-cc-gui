import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CollapsibleReveal } from "../../../../components/common/CollapsibleReveal";
import { FileIcon } from "../../../../components/FileIcon";

type CollapsibleUserTextBlockProps = {
  content: string;
  parsedContent?: UserTextParseResult;
};

const MAX_COLLAPSED_HEIGHT = 160;

import {
  parseUserTextContent,
  type UserCodeAnnotationSegment,
  type UserTextParseResult,
} from "./parseUserTextContent";

export { parseUserTextContent };
export type {
  UserCodeAnnotationSegment,
};


export const CollapsibleUserTextBlock = memo(function CollapsibleUserTextBlock({
  content,
  parsedContent: parsedContentProp,
}: CollapsibleUserTextBlockProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const parsedContent = useMemo(
    () => parsedContentProp ?? parseUserTextContent(content),
    [content, parsedContentProp],
  );
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [hasMeasuredOverflow, setHasMeasuredOverflow] = useState(false);

  useLayoutEffect(() => {
    setHasMeasuredOverflow((previous) => (previous ? false : previous));
  }, [content]);

  useLayoutEffect(() => {
    if (!contentRef.current) {
      return;
    }

    // 测量内层真实内容高度，避免 collapsed maxHeight / is-measured class
    // 改变外层 scrollHeight 后 isOverflowing 真假翻转 → layout setState 死循环（#185）。
    const checkHeight = () => {
      const root = contentRef.current;
      if (!root) {
        return;
      }
      const measureTarget =
        (root.querySelector(".user-collapsible-text-content") as HTMLElement | null) ??
        root;
      const nextOverflowing = measureTarget.scrollHeight > MAX_COLLAPSED_HEIGHT;
      setIsOverflowing((previous) =>
        previous === nextOverflowing ? previous : nextOverflowing,
      );
      setHasMeasuredOverflow((previous) => (previous ? previous : true));
    };

    checkHeight();
    const observer = new ResizeObserver(checkHeight);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [content]);

  return (
    <div className={`user-collapsible-block ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <div
        className={`user-collapsible-content${hasMeasuredOverflow ? " is-measured" : " is-measuring"}`}
        ref={contentRef}
        style={{
          maxHeight: expanded || !isOverflowing ? "none" : `${MAX_COLLAPSED_HEIGHT}px`,
          overflow: "hidden",
        }}
      >
        <div className="user-collapsible-text-content">
          <span>{parsedContent.plainText}</span>
        </div>
        {parsedContent.references.length > 0 ? (
          <div className="user-reference-card" aria-label="Referenced files and folders">
            <div className="user-reference-card-title">References</div>
            <div className="user-reference-card-list">
              {parsedContent.references.map((reference) => (
                <div
                  key={reference.path}
                  className="user-reference-card-item"
                  title={reference.path}
                >
                  <span className="user-reference-card-icon" aria-hidden>
                    <FileIcon filePath={reference.path} isFolder={reference.isDirectory} />
                  </span>
                  <span className="user-reference-card-meta">
                    <span className="user-reference-card-name">{reference.displayName}</span>
                    {reference.parentPath ? (
                      <span className="user-reference-card-parent">{reference.parentPath}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!expanded && isOverflowing ? <div className="user-collapsible-overlay" /> : null}
      </div>
      {isOverflowing ? (
        <button
          type="button"
          className="user-collapsible-toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? t("messages.collapseInput") : t("messages.expandInput")}
        >
          <span className={`codicon codicon-chevron-down${expanded ? " is-expanded" : ""}`} />
        </button>
      ) : null}
    </div>
  );
});

export const UserCodeAnnotationContextBlock = memo(function UserCodeAnnotationContextBlock({
  annotations,
}: {
  annotations: UserCodeAnnotationSegment[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (annotations.length === 0) {
    return null;
  }

  return (
    <div
      className={`message-code-annotation-context${expanded ? " is-expanded" : " is-collapsed"}`}
      aria-label={t("messages.codeAnnotations")}
    >
      <div className="message-code-annotation-context-head">
        <div className="message-code-annotation-context-title">
          <span className="codicon codicon-comment-discussion" aria-hidden />
          <span>{t("messages.codeAnnotations")}</span>
          <span className="message-code-annotation-context-count">
            {t("messages.codeAnnotationContextCount", { count: annotations.length })}
          </span>
        </div>
        <button
          type="button"
          className="message-code-annotation-context-toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("messages.collapseCodeAnnotations")
              : t("messages.expandCodeAnnotations")
          }
        >
          <span className="message-code-annotation-context-toggle-label">
            {expanded ? t("messages.collapse") : t("messages.expand")}
          </span>
          <span
            className={`codicon codicon-chevron-down message-code-annotation-context-toggle-icon${expanded ? " is-expanded" : ""}`}
            aria-hidden
          />
        </button>
      </div>
      <CollapsibleReveal open={expanded}>
        <div className="message-code-annotation-context-list">
          {annotations.map((annotation, index) => (
            <div
              key={`${annotation.path}-${annotation.lineRange}-${index}`}
              className="message-code-annotation-context-item"
              title={`${annotation.path}#${annotation.lineRange}`}
            >
              <span className="message-code-annotation-context-icon" aria-hidden>
                <FileIcon filePath={annotation.path} isFolder={false} />
              </span>
              <span className="message-code-annotation-context-meta">
                <span className="message-code-annotation-context-reference">
                  <span className="message-code-annotation-context-name">
                    {annotation.displayName}
                  </span>
                  <code>{annotation.lineRange}</code>
                </span>
                {annotation.parentPath ? (
                  <span className="message-code-annotation-context-parent">
                    {annotation.parentPath}
                  </span>
                ) : null}
                <span className="message-code-annotation-context-body">
                  {annotation.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      </CollapsibleReveal>
    </div>
  );
});
