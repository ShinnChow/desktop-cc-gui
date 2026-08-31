import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CustomCommandOption } from "../../../../../types";
import type {
  ContextSelectionChip,
  MemoryReferenceMode,
} from "../../ChatInputBox/types";
import type { ChatInputBoxHandle } from "../../ChatInputBox/ChatInputBoxAdapter";
import type {
  ComposerProps,
  ManualMemorySelection,
  NoteCardSelection,
} from "../types";
import {
  extractInlineFileReferenceTokens,
  mergeInlineFileReferences,
  type InlineFileReferenceSelection,
} from "../../../utils/composerFileReferences";
import {
  extractInlineSelections,
  mergeUniqueNames,
} from "../../../utils/inlineSelections";
import {
  keepArrayWhenEmpty,
  normalizeCommandChipName,
  OPENCODE_DIRECT_COMMANDS,
  resolveSelectedNamedItems,
  toContextChipCarryOverKey,
} from "../utils";

export interface UseComposerContextSelectionsOptions {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  skills: ComposerProps["skills"];
  commands: CustomCommandOption[];
  selectedEngine: ComposerProps["selectedEngine"];
  onClearCodeAnnotations: ComposerProps["onClearCodeAnnotations"];
  externalNoteCardSelectionRequest:
    ComposerProps["externalNoteCardSelectionRequest"];
  chatInputRef: RefObject<ChatInputBoxHandle | null>;
  text: string;
  setComposerText: (next: string) => void;
}

export function useComposerContextSelections({
  activeThreadId,
  activeWorkspaceId,
  skills,
  commands,
  selectedEngine,
  onClearCodeAnnotations,
  externalNoteCardSelectionRequest,
  chatInputRef,
  text,
  setComposerText,
}: UseComposerContextSelectionsOptions) {
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [selectedCommonsNames, setSelectedCommonsNames] = useState<string[]>(
    [],
  );
  const [selectedManualMemories, setSelectedManualMemories] = useState<
    ManualMemorySelection[]
  >([]);
  const [selectedNoteCards, setSelectedNoteCards] = useState<
    NoteCardSelection[]
  >([]);
  const [memoryReferenceMode, setMemoryReferenceMode] =
    useState<MemoryReferenceMode>("off");
  const [memoryReferenceDismissed, setMemoryReferenceDismissed] =
    useState(false);

  // hydrate session 习惯（localStorage → memoryPickSessionStore）
  useEffect(() => {
    if (!activeWorkspaceId || !activeThreadId) {
      setMemoryReferenceMode("off");
      setMemoryReferenceDismissed(false);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import("../../../../project-memory/memoryPick/memoryPickSessionStore").then(
      ({
        getMemoryPickSessionPolicy,
        subscribeMemoryPickSessionStore,
      }) => {
        if (cancelled) return;
        const syncFromStore = () => {
          const policy = getMemoryPickSessionPolicy(
            activeWorkspaceId,
            activeThreadId,
          );
          setMemoryReferenceMode(policy.composerMode);
          setMemoryReferenceDismissed(policy.dismissed);
        };
        syncFromStore();
        unsubscribe = subscribeMemoryPickSessionStore(syncFromStore);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [activeThreadId, activeWorkspaceId]);
  // 闸门内切到 always/pick 时同步菜单（与幕布策略轨一致）
  useEffect(() => {
    const onMode = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          mode?: MemoryReferenceMode;
          workspaceId?: string;
          threadId?: string;
        }>
      ).detail;
      if (
        detail?.workspaceId &&
        activeWorkspaceId &&
        detail.workspaceId !== activeWorkspaceId
      ) {
        return;
      }
      if (
        detail?.threadId &&
        activeThreadId &&
        detail.threadId !== activeThreadId
      ) {
        return;
      }
      if (
        detail?.mode === "always" ||
        detail?.mode === "pick" ||
        detail?.mode === "off"
      ) {
        setMemoryReferenceMode(detail.mode);
      }
    };
    window.addEventListener("ccgui:memory-pick-composer-mode", onMode);
    return () => {
      window.removeEventListener("ccgui:memory-pick-composer-mode", onMode);
    };
  }, [activeThreadId, activeWorkspaceId]);
  const handleSetMemoryReferenceMode = useCallback(
    (mode: MemoryReferenceMode) => {
      const normalized =
        mode === "single" ? ("pick" as const) : mode === "pick" || mode === "always" || mode === "off"
          ? mode
          : ("off" as const);
      setMemoryReferenceMode(normalized);
      if (activeWorkspaceId && activeThreadId) {
        // 动态 import 避免循环依赖；菜单显式 off 必须写回 session
        void import("../../../../project-memory/memoryPick/memoryPickSessionStore").then(
          ({ forceMemoryPickComposerModeFromMenu }) => {
            forceMemoryPickComposerModeFromMenu(
              activeWorkspaceId,
              activeThreadId,
              normalized,
            );
          },
        );
      }
    },
    [activeThreadId, activeWorkspaceId],
  );
  const handleRestoreMemoryReference = useCallback(() => {
    if (!activeWorkspaceId || !activeThreadId) return;
    void import("../../../../project-memory/memoryPick/memoryPickSessionStore").then(
      ({ restoreMemoryPickFromDismiss }) => {
        restoreMemoryPickFromDismiss(activeWorkspaceId, activeThreadId);
        setMemoryReferenceMode("pick");
        setMemoryReferenceDismissed(false);
      },
    );
  }, [activeThreadId, activeWorkspaceId]);

  const [carryOverManualMemoryIds, setCarryOverManualMemoryIds] = useState<
    string[]
  >([]);
  const [retainedManualMemoryIds, setRetainedManualMemoryIds] = useState<
    string[]
  >([]);
  const [carryOverNoteCardIds, setCarryOverNoteCardIds] = useState<string[]>(
    [],
  );
  const [retainedNoteCardIds, setRetainedNoteCardIds] = useState<string[]>([]);
  const [carryOverContextChipKeys, setCarryOverContextChipKeys] = useState<
    string[]
  >([]);
  const [, setRetainedContextChipKeys] = useState<string[]>([]);
  const [selectedInlineFileReferences, setSelectedInlineFileReferences] =
    useState<InlineFileReferenceSelection[]>([]);

  const onClearCodeAnnotationsRef = useRef(onClearCodeAnnotations);

  const handledNoteCardSelectionRequestIdRef = useRef<number | null>(null);

  const selectedSkills = useMemo(
    () => resolveSelectedNamedItems(selectedSkillNames, skills),
    [selectedSkillNames, skills],
  );
  const selectedCommons = useMemo(
    () => resolveSelectedNamedItems(selectedCommonsNames, commands),
    [commands, selectedCommonsNames],
  );
  const selectedOpenCodeDirectCommand = useMemo(() => {
    if (selectedEngine !== "opencode") {
      return null;
    }
    for (const name of selectedCommonsNames) {
      const normalized = normalizeCommandChipName(name);
      if (OPENCODE_DIRECT_COMMANDS.has(normalized)) {
        return normalized;
      }
    }
    return null;
  }, [selectedCommonsNames, selectedEngine]);

  const contextSelectionChips = useMemo<ContextSelectionChip[]>(
    () => [
      ...selectedSkills.map((skill) => ({
        type: "skill" as const,
        name: skill.name,
        description: skill.description,
        path: skill.path,
        source: skill.source,
      })),
      ...selectedCommons.map((item) => ({
        type: "commons" as const,
        name: item.name,
        description: item.description,
        path: item.path,
        source: item.source,
      })),
    ],
    [selectedCommons, selectedSkills],
  );

  useEffect(() => {
    onClearCodeAnnotationsRef.current = onClearCodeAnnotations;
  }, [onClearCodeAnnotations]);

  const clearComposerContextSelections = useCallback(() => {
    setSelectedSkillNames(keepArrayWhenEmpty);
    setSelectedCommonsNames(keepArrayWhenEmpty);
    setSelectedManualMemories(keepArrayWhenEmpty);
    setSelectedNoteCards(keepArrayWhenEmpty);
    setSelectedInlineFileReferences(keepArrayWhenEmpty);
    onClearCodeAnnotationsRef.current?.();
    setCarryOverManualMemoryIds(keepArrayWhenEmpty);
    setRetainedManualMemoryIds(keepArrayWhenEmpty);
    setCarryOverNoteCardIds(keepArrayWhenEmpty);
    setRetainedNoteCardIds(keepArrayWhenEmpty);
    setCarryOverContextChipKeys(keepArrayWhenEmpty);
    setRetainedContextChipKeys(keepArrayWhenEmpty);
    setMemoryReferenceMode("off");
  }, []);

  useEffect(() => {
    clearComposerContextSelections();
  }, [activeThreadId, activeWorkspaceId, clearComposerContextSelections]);

  const selectedInlineFileReferencesRef = useRef(selectedInlineFileReferences);
  selectedInlineFileReferencesRef.current = selectedInlineFileReferences;
  const skillsRef = useRef(skills);
  skillsRef.current = skills;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    // 只订阅 text：selection / skills / commands 读 ref。
    // 旧 deps 含 selectedInlineFileReferences 时，即便 merge 幂等，
    // 父树 skills 引用抖动 + 同 tick 多 setState 仍可能叠满 #185（0.7.16 / App-DjQ3UnSh）。
    const existingReferenceIds = new Set(
      selectedInlineFileReferencesRef.current
        .filter((entry) => text.includes(entry.label))
        .map((entry) => entry.id),
    );
    const { cleanedText, extracted } = extractInlineFileReferenceTokens(
      text,
      existingReferenceIds,
    );
    if (extracted.length > 0) {
      // mergeInlineFileReferences：无新增保持原引用
      setSelectedInlineFileReferences((prev) =>
        mergeInlineFileReferences(prev, extracted),
      );
    }
    if (cleanedText !== text) {
      setComposerText(cleanedText);
      return;
    }
    const {
      cleanedText: cleanedSelectionText,
      matchedSkillNames,
      matchedCommonsNames,
    } = extractInlineSelections(text, skillsRef.current, commandsRef.current);
    if (matchedSkillNames.length > 0) {
      setSelectedSkillNames((prev) =>
        mergeUniqueNames(prev, matchedSkillNames),
      );
    }
    if (matchedCommonsNames.length > 0) {
      setSelectedCommonsNames((prev) =>
        mergeUniqueNames(prev, matchedCommonsNames),
      );
    }
    if (cleanedSelectionText !== text) {
      setComposerText(cleanedSelectionText);
    }
  }, [setComposerText, text]);

  const handleSelectManualMemory = useCallback(
    (memory: ManualMemorySelection) => {
      setSelectedManualMemories((prev) => {
        if (prev.some((entry) => entry.id === memory.id)) {
          setCarryOverManualMemoryIds((ids) =>
            ids.filter((entryId) => entryId !== memory.id),
          );
          return prev.filter((entry) => entry.id !== memory.id);
        }
        return [...prev, memory];
      });
    },
    [],
  );

  const handleSelectNoteCard = useCallback((noteCard: NoteCardSelection) => {
    setSelectedNoteCards((prev) => {
      if (prev.some((entry) => entry.id === noteCard.id)) {
        setCarryOverNoteCardIds((ids) =>
          ids.filter((entryId) => entryId !== noteCard.id),
        );
        return prev.filter((entry) => entry.id !== noteCard.id);
      }
      return [...prev, noteCard];
    });
  }, []);

  useEffect(() => {
    if (
      !externalNoteCardSelectionRequest ||
      handledNoteCardSelectionRequestIdRef.current ===
        externalNoteCardSelectionRequest.requestId
    ) {
      return;
    }
    handledNoteCardSelectionRequestIdRef.current =
      externalNoteCardSelectionRequest.requestId;
    const requestedNoteCard = externalNoteCardSelectionRequest.noteCard;
    setSelectedNoteCards((previous) =>
      previous.some((entry) => entry.id === requestedNoteCard.id)
        ? previous
        : [...previous, requestedNoteCard],
    );
    chatInputRef.current?.focus();
  }, [externalNoteCardSelectionRequest]);

  const handleSelectSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim();
    if (!normalized) {
      return;
    }
    setSelectedSkillNames((prev) => {
      if (prev.includes(normalized)) {
        setCarryOverContextChipKeys((keys) =>
          keys.filter((entry) => entry !== `skill:${normalized}`),
        );
        return prev.filter((entry) => entry !== normalized);
      }
      return mergeUniqueNames(prev, [normalized]);
    });
  }, []);

  const handleRemoveContextChip = useCallback((chip: ContextSelectionChip) => {
    const carryOverKey = toContextChipCarryOverKey(chip);
    setCarryOverContextChipKeys((prev) =>
      prev.filter((entry) => entry !== carryOverKey),
    );
    setRetainedContextChipKeys((prev) =>
      prev.filter((entry) => entry !== carryOverKey),
    );
    if (chip.type === "skill") {
      setSelectedSkillNames((prev) =>
        prev.filter((name) => name !== chip.name),
      );
      return;
    }
    setSelectedCommonsNames((prev) =>
      prev.filter((name) => name !== chip.name),
    );
  }, []);

  const handleRemoveManualMemory = useCallback((memoryId: string) => {
    setCarryOverManualMemoryIds((prev) =>
      prev.filter((entryId) => entryId !== memoryId),
    );
    setRetainedManualMemoryIds((prev) =>
      prev.filter((entryId) => entryId !== memoryId),
    );
    setSelectedManualMemories((prev) =>
      prev.filter((entry) => entry.id !== memoryId),
    );
  }, []);

  const handleRemoveNoteCard = useCallback((noteCardId: string) => {
    setCarryOverNoteCardIds((prev) =>
      prev.filter((entryId) => entryId !== noteCardId),
    );
    setRetainedNoteCardIds((prev) =>
      prev.filter((entryId) => entryId !== noteCardId),
    );
    setSelectedNoteCards((prev) =>
      prev.filter((entry) => entry.id !== noteCardId),
    );
  }, []);

  const selectedManualMemoryIds = useMemo(
    () => selectedManualMemories.map((entry) => entry.id),
    [selectedManualMemories],
  );
  const selectedNoteCardIds = useMemo(
    () => selectedNoteCards.map((entry) => entry.id),
    [selectedNoteCards],
  );
  return {
    selectedSkillNames,
    selectedCommonsNames,
    selectedManualMemories,
    selectedNoteCards,
    selectedInlineFileReferences,
    selectedSkills,
    selectedCommons,
    selectedOpenCodeDirectCommand,
    contextSelectionChips,
    carryOverManualMemoryIds,
    retainedManualMemoryIds,
    carryOverNoteCardIds,
    retainedNoteCardIds,
    carryOverContextChipKeys,
    setSelectedSkillNames,
    setSelectedCommonsNames,
    setSelectedManualMemories,
    setSelectedNoteCards,
    setSelectedInlineFileReferences,
    setCarryOverManualMemoryIds,
    setRetainedManualMemoryIds,
    setCarryOverNoteCardIds,
    setRetainedNoteCardIds,
    setCarryOverContextChipKeys,
    setRetainedContextChipKeys,
    memoryReferenceMode,
    setMemoryReferenceMode,
    memoryReferenceDismissed,
    handleSetMemoryReferenceMode,
    handleRestoreMemoryReference,
    clearComposerContextSelections,
    handleSelectManualMemory,
    handleSelectNoteCard,
    handleSelectSkill,
    handleRemoveContextChip,
    handleRemoveManualMemory,
    handleRemoveNoteCard,
    selectedManualMemoryIds,
    selectedNoteCardIds,
  };
}
