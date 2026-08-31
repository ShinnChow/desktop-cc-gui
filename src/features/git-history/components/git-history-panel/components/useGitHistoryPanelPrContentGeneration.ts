import {
  useCallback,
  useEffect,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import type { WorkspaceInfo } from "../../../../../types";
import type {
  CommitMessageEngine,
  CommitMessageLanguage,
} from "../../../../../services/tauri/commitMessage";
import { generatePullRequestContent } from "../../../../../services/tauri";
import { isEngineExecutionEnabled } from "../../../../../utils/engineExecutionPolicy";
import {
  readLastCommitMessageConfig,
  saveLastCommitMessageConfig,
} from "../../../../../utils/commitMessage";
import {
  clampRendererContextMenuPosition,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../../../components/ui/RendererContextMenu";
import type { CreatePrFormState } from "./GitHistoryPanelTypes";

type PrContentGenerationScope = {
  createPrContentGenerating: boolean;
  createPrContentGenerationTokenRef: MutableRefObject<number>;
  createPrContentStartedAt: number | null;
  createPrContentSuccessAt: number | null;
  createPrDialogOpen: boolean;
  createPrFormFlashAt: number | null;
  createPrPreviewBaseRef: string;
  createPrPreviewHeadRef: string;
  setCreatePrContentElapsedSec: Dispatch<SetStateAction<number>>;
  setCreatePrContentEngine: Dispatch<SetStateAction<CommitMessageEngine>>;
  setCreatePrContentError: Dispatch<SetStateAction<string | null>>;
  setCreatePrContentGenerating: Dispatch<SetStateAction<boolean>>;
  setCreatePrContentSlow: Dispatch<SetStateAction<boolean>>;
  setCreatePrContentStartedAt: Dispatch<SetStateAction<number | null>>;
  setCreatePrContentSuccessAt: Dispatch<SetStateAction<number | null>>;
  setCreatePrForm: Dispatch<SetStateAction<CreatePrFormState>>;
  setCreatePrFormFlashAt: Dispatch<SetStateAction<number | null>>;
  setPrContentMenu: Dispatch<SetStateAction<RendererContextMenuState | null>>;
  t: TFunction<"translation", undefined>;
  workspace: WorkspaceInfo | null;
};

export function useGitHistoryPanelPrContentGeneration(scope: PrContentGenerationScope) {
  const {
    createPrContentGenerating,
    createPrContentGenerationTokenRef,
    createPrContentStartedAt,
    createPrContentSuccessAt,
    createPrDialogOpen,
    createPrFormFlashAt,
    createPrPreviewBaseRef,
    createPrPreviewHeadRef,
    setCreatePrContentElapsedSec,
    setCreatePrContentEngine,
    setCreatePrContentError,
    setCreatePrContentGenerating,
    setCreatePrContentSlow,
    setCreatePrContentStartedAt,
    setCreatePrContentSuccessAt,
    setCreatePrForm,
    setCreatePrFormFlashAt,
    setPrContentMenu,
    t,
    workspace,
  } = scope;

  // ponytail: PR generation 状态机独立成 hook，避免扩大 giant interaction-hook 的 scope。
  useEffect(() => {
    if (!createPrContentStartedAt) {
      setCreatePrContentElapsedSec(0);
      return;
    }
    const tick = () =>
      setCreatePrContentElapsedSec(
        Math.floor((Date.now() - createPrContentStartedAt) / 1000),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [createPrContentStartedAt]);
  useEffect(() => {
    if (createPrFormFlashAt === null) return;
    const timer = window.setTimeout(() => setCreatePrFormFlashAt(null), 1200);
    return () => window.clearTimeout(timer);
  }, [createPrFormFlashAt]);
  useEffect(() => {
    if (createPrContentSuccessAt === null) return;
    const timer = window.setTimeout(
      () => setCreatePrContentSuccessAt(null),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [createPrContentSuccessAt]);
  const triggerPrContentGeneration = useCallback(
    async (engine: CommitMessageEngine, language: CommitMessageLanguage) => {
      if (!workspace || !createPrPreviewBaseRef || !createPrPreviewHeadRef) {
        setCreatePrContentError(
          t("git.historyGeneratePrMissingBaseOrHead", {
            defaultValue:
              "Cannot generate PR content: base or head branch is missing",
          }),
        );
        return;
      }
      if (!isEngineExecutionEnabled(engine)) {
        setCreatePrContentError(
          t("git.historyGeneratePrUnsupportedEngine", {
            defaultValue: "The selected engine is unavailable",
          }),
        );
        return;
      }

      setCreatePrContentEngine(engine);
      setCreatePrContentGenerating(true);
      setCreatePrContentError(null);
      setCreatePrContentSuccessAt(null);
      setCreatePrFormFlashAt(null);
      setCreatePrContentSlow(false);
      setCreatePrContentStartedAt(Date.now());
      const generationToken = ++createPrContentGenerationTokenRef.current;
      saveLastCommitMessageConfig({ engine, language });

      try {
        const result = await generatePullRequestContent(
          workspace.id,
          language,
          engine,
          createPrPreviewBaseRef,
          createPrPreviewHeadRef,
          (event) => {
            if (
              generationToken === createPrContentGenerationTokenRef.current &&
              event.kind === "soft-warn"
            ) {
              setCreatePrContentSlow(true);
            }
          },
        );
        if (generationToken !== createPrContentGenerationTokenRef.current)
          return;

        setCreatePrForm((previous) => ({
          ...previous,
          title: result.title,
          body: result.body,
        }));
        setCreatePrFormFlashAt(Date.now());
        setCreatePrContentSuccessAt(Date.now());
      } catch (error) {
        if (generationToken !== createPrContentGenerationTokenRef.current)
          return;
        const raw = error instanceof Error ? error.message : String(error);
        const localized = /timed out/i.test(raw)
          ? t("git.historyGeneratePrTimeout", {
              defaultValue: "AI generation timed out, please retry",
            })
          : /unsupported_engine|unsupported engine/i.test(raw)
            ? t("git.historyGeneratePrUnsupportedEngine", {
                defaultValue: "The selected engine is unavailable",
              })
            : t("git.historyGeneratePrError", {
                error: raw,
                defaultValue: "PR content generation failed: {{error}}",
              });
        setCreatePrContentError(localized);
      } finally {
        if (generationToken === createPrContentGenerationTokenRef.current) {
          setCreatePrContentGenerating(false);
          setCreatePrContentStartedAt(null);
          setCreatePrContentSlow(false);
        }
      }
    },
    [createPrPreviewBaseRef, createPrPreviewHeadRef, t, workspace],
  );
  useEffect(() => {
    if (createPrDialogOpen) return;
    createPrContentGenerationTokenRef.current += 1;
    setCreatePrContentGenerating(false);
    setCreatePrContentStartedAt(null);
    setCreatePrContentSlow(false);
    setCreatePrContentError(null);
    setCreatePrContentSuccessAt(null);
    setPrContentMenu(null);
  }, [createPrDialogOpen]);
  const openPrContentGenerationMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (createPrContentGenerating) return;

      const triggerRect = event.currentTarget.getBoundingClientRect();
      const menuSize = { width: 260, height: 240 };
      const position = clampRendererContextMenuPosition(
        triggerRect.right - menuSize.width,
        triggerRect.bottom + 8,
        menuSize,
      );
      const lastConfig = readLastCommitMessageConfig();
      const engineItems: Array<{ engine: CommitMessageEngine; label: string }> =
        [
          { engine: "codex", label: t("git.historyGeneratePrMenuCodex") },
          { engine: "claude", label: t("git.historyGeneratePrMenuClaude") },
        ];
      setPrContentMenu({
        ...position,
        label: t("git.historyGeneratePrMenuTitle"),
        items: [
          {
            type: "item",
            id: "pr-content-last-config",
            label: t("git.historyGeneratePrMenuLastConfig"),
            disabled: !lastConfig,
            onSelect: () => {
              if (lastConfig) {
                void triggerPrContentGeneration(
                  lastConfig.engine,
                  lastConfig.language,
                );
              }
            },
          },
          { type: "separator", id: "pr-content-last-config-separator" },
          ...engineItems.map<RendererContextMenuItem>(({ engine, label }) => ({
            type: "submenu",
            id: `pr-content-engine-${engine}`,
            label,
            items: [
              {
                type: "item",
                id: `pr-content-${engine}-lang-zh`,
                label: t("git.historyGeneratePrMenuZh"),
                onSelect: () => triggerPrContentGeneration(engine, "zh"),
              },
              {
                type: "item",
                id: `pr-content-${engine}-lang-en`,
                label: t("git.historyGeneratePrMenuEn"),
                onSelect: () => triggerPrContentGeneration(engine, "en"),
              },
            ],
          })),
        ],
      });
    },
    [createPrContentGenerating, t, triggerPrContentGeneration],
  );

  return {
    openPrContentGenerationMenu,
  };
}
