import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { pushErrorToast } from "../../../services/toasts";
import { loadSubagentStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import type { EngineType } from "../../../types";
import {
  selectTemplate,
  useSelectedTemplate,
  useTemplateCatalogSnapshot,
} from "../templates/templateStore";
import {
  displayTemplateName,
  templateApprovalCount,
  templateFlowLabel,
  type CollaborationTemplate,
} from "../templates/types";
import { isCompleteAgentTargetForUi } from "../templates/targetCompleteness";
import { TemplateManagerModal } from "./TemplateManagerModal";

type ComposerToggleProps = {
  engine: EngineType | null | undefined;
  armed: boolean;
  disabled: boolean;
  hasActiveRun: boolean;
  onToggle: () => void;
  onArm?: () => void;
};

const SUPPORTED: EngineType[] = [
  "codex",
  "claude",
  "kimi",
  "grok",
  "opencode",
  "pi",
  "qoder",
];

export function isMultiAgentTargetSupported(
  engine: EngineType | null | undefined,
): boolean {
  return Boolean(engine && SUPPORTED.includes(engine));
}

function templateHasIncompleteTarget(template: CollaborationTemplate): boolean {
  return template.stages.some((s) => !isCompleteAgentTargetForUi(s.target));
}

export function MultiAgentComposerToggle({
  engine,
  armed,
  disabled,
  hasActiveRun,
  onToggle,
  onArm,
}: ComposerToggleProps) {
  const { t } = useTranslation();
  const stylesReady = useFeatureStylesReady(loadSubagentStyles);
  const targetSupported = isMultiAgentTargetSupported(engine);
  const unavailable = !targetSupported;
  const selected = useSelectedTemplate();
  const catalog = useTemplateCatalogSnapshot();
  const [popOpen, setPopOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popPos, setPopPos] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);

  // Portal 弹层定位：避免被 composer overflow:hidden 裁切
  useLayoutEffect(() => {
    if (!popOpen || !btnRef.current) {
      setPopPos(null);
      return;
    }
    const place = () => {
      const rect = btnRef.current!.getBoundingClientRect();
      // 列表副行简化后仍需略宽，避免环节链被过度截断
      const width = Math.min(
        Math.max(rect.width, 320),
        Math.min(440, window.innerWidth - 16),
      );
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setPopPos({
        left,
        bottom: window.innerHeight - rect.top + 8,
        width,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [popOpen]);

  useEffect(() => {
    if (!popOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (target instanceof Element && target.closest(".ma-tpl-overlay")) {
        return;
      }
      if (
        rootRef.current?.contains(target) ||
        popRef.current?.contains(target)
      ) {
        return;
      }
      setPopOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [popOpen]);

  // 弹层打开时若历史选中是未配齐，静默回退到第一个配齐模板
  useEffect(() => {
    if (!popOpen || hasActiveRun) return;
    if (!templateHasIncompleteTarget(selected)) return;
    const complete = catalog.templates.find(
      (item) => !templateHasIncompleteTarget(item),
    );
    if (complete && complete.id !== selected.id) {
      selectTemplate(complete.id);
    }
  }, [popOpen, hasActiveRun, selected, catalog.templates]);

  const selectedDisplayName = displayTemplateName(selected);

  // 运行中优先显示「进行中」，避免发送后 disarm 造成「未开启」误导
  const pillLabel = hasActiveRun
    ? t("multiAgent.entry.pillRunning", { name: selectedDisplayName })
    : armed
      ? t("multiAgent.entry.pill", { name: selectedDisplayName })
      : t("multiAgent.entry.pillOff");

  /** 回退到第一个已配齐模板（若当前是未配齐误选中） */
  const fallbackToCompleteTemplate = () => {
    if (!templateHasIncompleteTarget(selected)) return;
    const complete = catalog.templates.find(
      (item) => !templateHasIncompleteTarget(item),
    );
    if (complete && complete.id !== selected.id) {
      selectTemplate(complete.id);
    }
  };

  const notifyIncompletePick = (templateName: string) => {
    pushErrorToast({
      variant: "info",
      title: t("multiAgent.entry.incompletePickTitle"),
      message: t("multiAgent.entry.incompletePickHint", {
        name: templateName,
      }),
    });
  };

  // 选模板只切换选中态，不关弹层、不自动 arm；必须点「启用协作」才生效
  // 未配齐：提示 + 拒绝选中，并清掉未配齐的「当前」选中
  const pick = (id: string) => {
    if (hasActiveRun) return;
    const template = catalog.templates.find((item) => item.id === id);
    if (!template) return;
    if (templateHasIncompleteTarget(template)) {
      notifyIncompletePick(displayTemplateName(template));
      fallbackToCompleteTemplate();
      return;
    }
    selectTemplate(id);
  };

  const openManage = () => {
    setPopOpen(false);
    setModalOpen(true);
  };

  const popover =
    popOpen && popPos && stylesReady
      ? createPortal(
          <div
            ref={popRef}
            className="ma-collab-pop ma-collab-pop--portal"
            role="listbox"
            style={{
              position: "fixed",
              left: popPos.left,
              bottom: popPos.bottom,
              width: popPos.width,
              zIndex: 80,
            }}
          >
            <div className="ma-cp-head">
              <span>
                {hasActiveRun
                  ? t("multiAgent.entry.activeRun")
                  : t("multiAgent.entry.pickTemplate")}
              </span>
              <button
                type="button"
                className="ma-cp-manage"
                onClick={openManage}
              >
                {t("multiAgent.entry.manage")}
              </button>
            </div>
            {catalog.templates.map((item) => {
              const incomplete = templateHasIncompleteTarget(item);
              // 未配齐不算「当前」选中，避免歧义
              const isOn = !incomplete && item.id === selected.id;
              const approval = templateApprovalCount(item);
              return (
                <button
                  type="button"
                  key={item.id}
                  role="option"
                  aria-selected={isOn}
                  className={`ma-cp-item${isOn ? " is-on" : ""}${incomplete ? " is-incomplete" : ""}${hasActiveRun ? " is-locked" : ""}`}
                  disabled={hasActiveRun}
                  onClick={() => pick(item.id)}
                >
                  <div className="ma-cp-nm">
                    <span className="ma-cp-name">
                      {displayTemplateName(item)}
                    </span>
                    <span
                      className={`ma-cp-tag${item.builtin ? "" : " is-mine"}`}
                    >
                      {item.builtin
                        ? t("multiAgent.template.builtinTag")
                        : t("multiAgent.template.mineTag")}
                    </span>
                    {isOn ? (
                      <span className="ma-cp-cur">
                        {t("multiAgent.entry.current")}
                      </span>
                    ) : null}
                  </div>
                  <div className="ma-cp-row">
                    <div className="ma-cp-sub" title={templateFlowLabel(item)}>
                      {templateFlowLabel(item)}
                    </div>
                    <div className="ma-cp-meta">
                      {approval > 0 ? (
                        <span className="ma-cp-chip">
                          {t("multiAgent.template.approvalCount", {
                            count: approval,
                          })}
                        </span>
                      ) : null}
                      {incomplete ? (
                        <span className="ma-cp-chip is-warn">
                          {t("multiAgent.entry.incompleteStages")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
            <button type="button" className="ma-cp-new" onClick={openManage}>
              {t("multiAgent.entry.newTemplate")}
            </button>
            {armed && !hasActiveRun ? (
              <button
                type="button"
                className="ma-cp-disarm"
                onClick={() => {
                  setPopOpen(false);
                  onToggle();
                }}
              >
                {t("multiAgent.entry.disarm")}
              </button>
            ) : null}
            {!armed && !hasActiveRun ? (
              <button
                type="button"
                className="ma-cp-arm"
                onClick={() => {
                  if (templateHasIncompleteTarget(selected)) {
                    notifyIncompletePick(displayTemplateName(selected));
                    fallbackToCompleteTemplate();
                    return;
                  }
                  onArm?.();
                  if (!onArm) onToggle();
                  setPopOpen(false);
                }}
              >
                {t("multiAgent.entry.arm")}
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="ma-collab-wrap" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`ma-collab-pill${armed ? " is-armed" : ""}${popOpen ? " is-open" : ""}${hasActiveRun ? " is-busy" : ""}`}
        aria-pressed={armed}
        aria-expanded={popOpen}
        aria-haspopup="listbox"
        aria-label={
          unavailable
            ? t("multiAgent.errors.targetUnavailable")
            : t("multiAgent.entry.aria")
        }
        title={
          hasActiveRun
            ? t("multiAgent.entry.activeRun")
            : unavailable
              ? t("multiAgent.errors.targetUnavailable")
              : t("multiAgent.entry.tooltip")
        }
        disabled={disabled || unavailable}
        onClick={() => {
          if (unavailable) return;
          setPopOpen((open) => !open);
        }}
      >
        <span>{pillLabel}</span>
      </button>

      {popover}

      <TemplateManagerModal
        open={modalOpen && stylesReady}
        initialTemplateId={selected.id}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}


