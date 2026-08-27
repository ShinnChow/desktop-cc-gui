import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  getClientStoreSync,
  isClientStoreReady,
  subscribeClientStoreHydrated,
  writeClientStoreValue,
} from "../../services/clientStorage";
import type { DebugEntry } from "../../types";
import {
  extractClaudeForkParentThreadId,
  getThreadComposerSelectionStorageKey,
  normalizeComposerSessionSelection,
  normalizeComposerSessionSelectionForThread,
  shouldMigrateComposerSelectionBetweenThreadIds,
  subscribeDshComposerSelectionSeeded,
  type ComposerSessionSelection,
} from "./selectedComposerSession";
import { resolveThreadSelectionOnSwitch } from "./composer-selection/resolveThreadSelectionOnSwitch";
import { resolveThreadEngine } from "./selectedComposerSession";
import { getComposerEnginePrefForEngine } from "../../features/composer/hooks/composerEnginePrefsStore";

function selectionsEqual(
  left: ComposerSessionSelection | null,
  right: ComposerSessionSelection | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.modelId === right.modelId && left.effort === right.effort;
}

function readStoredThreadComposerSelectionEntryBySessionKey(
  sessionKey: string,
): { exists: boolean; value: ComposerSessionSelection | null } {
  const raw = getClientStoreSync<unknown>("composer", sessionKey);
  if (raw === undefined) {
    return {
      exists: false,
      value: null,
    };
  }
  return {
    exists: true,
    value: normalizeComposerSessionSelection(raw),
  };
}

type UseSelectedComposerSessionOptions = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  resolveCanonicalThreadId: (threadId: string) => string;
  engineDefaultSelectionReady?: boolean;
  /**
   * Supplies the durable per-engine "last used" selection so a brand-new
   * conversation opens with the model/effort the user last chose for that engine.
   * Return null to keep the engine catalog default (e.g. codex, which persists
   * its global selection through a separate path).
   */
  resolveEngineDefaultComposerSelection?: (
    threadId: string,
  ) => ComposerSessionSelection | null;
  onDebug?: (entry: DebugEntry) => void;
};

type UseSelectedComposerSessionResult = {
  selectedComposerSelection: ComposerSessionSelection | null;
  selectedComposerSelectionRef: MutableRefObject<ComposerSessionSelection | null>;
  handleSelectComposerSelection: (selection: ComposerSessionSelection | null) => void;
  persistComposerSelectionForThread: (
    workspaceId: string | null,
    threadId: string | null,
    selection: ComposerSessionSelection | null,
  ) => void;
  reloadSelectedComposerSelection: () => void;
  resolveComposerSelectionForThread: (
    workspaceId: string | null,
    threadId: string | null,
  ) => ComposerSessionSelection | null;
};

export function useSelectedComposerSession({
  activeThreadId,
  activeWorkspaceId,
  resolveCanonicalThreadId,
  engineDefaultSelectionReady = true,
  resolveEngineDefaultComposerSelection,
}: UseSelectedComposerSessionOptions): UseSelectedComposerSessionResult {
  const [selectedComposerSelectionBySessionKey, setSelectedComposerSelectionBySessionKey] =
    useState<Record<string, ComposerSessionSelection | null>>({});
  const selectedComposerSelectionBySessionKeyRef = useRef<
    Record<string, ComposerSessionSelection | null>
  >({});
  const [draftComposerSelection, setDraftComposerSelection] =
    useState<ComposerSessionSelection | null>(null);
  // composer-session-selection-isolation：carry 时记下来源线程 id，
  // apply 点据此拒绝把 draft 落进异引擎 pending。同步 ref，不进 state。
  const draftComposerSelectionSourceThreadIdRef = useRef<string | null>(null);
  const [selectedComposerSelection, setSelectedComposerSelection] =
    useState<ComposerSessionSelection | null>(null);
  const selectedComposerSelectionRef = useRef<ComposerSessionSelection | null>(null);
  const draftComposerSelectionWorkspaceIdRef = useRef<string | null>(null);
  const shouldApplyDraftToNextThreadRef = useRef(false);
  // 父层常传入非稳定 resolveEngineDefault；经 ref 读，禁止拖进 reload deps（#185）
  const resolveEngineDefaultComposerSelectionRef = useRef(
    resolveEngineDefaultComposerSelection,
  );
  resolveEngineDefaultComposerSelectionRef.current =
    resolveEngineDefaultComposerSelection;

  const resolveSelectedComposerSessionKey = useCallback(
    (workspaceId: string | null, threadId: string | null): string | null => {
      if (!threadId) {
        return null;
      }
      return getThreadComposerSelectionStorageKey(workspaceId, threadId);
    },
    [],
  );

  const cacheSelectionForSessionKey = useCallback(
    (sessionKey: string, selection: ComposerSessionSelection | null) => {
      const currentCache = selectedComposerSelectionBySessionKeyRef.current;
      if (selectionsEqual(currentCache[sessionKey] ?? null, selection)) {
        return;
      }
      selectedComposerSelectionBySessionKeyRef.current = {
        ...currentCache,
        [sessionKey]: selection,
      };
      setSelectedComposerSelectionBySessionKey((currentState) => {
        if (selectionsEqual(currentState[sessionKey] ?? null, selection)) {
          return currentState;
        }
        return {
          ...currentState,
          [sessionKey]: selection,
        };
      });
    },
    [],
  );

  const writeSelectionForSessionKey = useCallback(
    (sessionKey: string, selection: ComposerSessionSelection | null) => {
      cacheSelectionForSessionKey(sessionKey, selection);
      if (!isClientStoreReady("composer")) {
        return;
      }
      const stored = readStoredThreadComposerSelectionEntryBySessionKey(sessionKey);
      if (stored.exists && selectionsEqual(stored.value, selection)) {
        return;
      }
      writeClientStoreValue("composer", sessionKey, selection);
    },
    [cacheSelectionForSessionKey],
  );

  const persistComposerSelectionForThread = useCallback(
    (
      workspaceId: string | null,
      threadId: string | null,
      selection: ComposerSessionSelection | null,
    ) => {
      if (!threadId) {
        return;
      }
      const sessionKey = resolveSelectedComposerSessionKey(workspaceId, threadId);
      if (!sessionKey) {
        return;
      }
      const normalized = normalizeComposerSessionSelectionForThread(threadId, selection);
      writeSelectionForSessionKey(sessionKey, normalized);
      const activeSessionKey = resolveSelectedComposerSessionKey(
        activeWorkspaceId,
        activeThreadId,
      );
      if (sessionKey !== activeSessionKey) {
        return;
      }
      const currentSelection = selectedComposerSelectionRef.current;
      if (selectionsEqual(currentSelection, normalized)) {
        return;
      }
      selectedComposerSelectionRef.current = normalized;
      setSelectedComposerSelection((currentState) =>
        selectionsEqual(currentState, normalized) ? currentState : normalized
      );
    },
    [
      activeThreadId,
      activeWorkspaceId,
      resolveSelectedComposerSessionKey,
      writeSelectionForSessionKey,
    ],
  );

  const handleSelectComposerSelection = useCallback(
    (selection: ComposerSessionSelection | null) => {
      const normalized = normalizeComposerSessionSelection(selection);
      selectedComposerSelectionRef.current = normalized;
      setSelectedComposerSelection((current) =>
        selectionsEqual(current, normalized) ? current : normalized,
      );
      if (!activeThreadId) {
        setDraftComposerSelection((current) =>
          selectionsEqual(current, normalized) ? current : normalized,
        );
        draftComposerSelectionWorkspaceIdRef.current = activeWorkspaceId ?? null;
        // 无线程来源（Home 点选）：引擎身份未知，门禁按放行语义处理。
        draftComposerSelectionSourceThreadIdRef.current = null;
        shouldApplyDraftToNextThreadRef.current = Boolean(normalized);
        return;
      }
      shouldApplyDraftToNextThreadRef.current = false;
      draftComposerSelectionSourceThreadIdRef.current = null;
      persistComposerSelectionForThread(activeWorkspaceId, activeThreadId, normalized);
    },
    [activeThreadId, activeWorkspaceId, persistComposerSelectionForThread],
  );

  const resolveComposerSelectionForThread = useCallback(
    (workspaceId: string | null, threadId: string | null): ComposerSessionSelection | null => {
      const sessionKey = resolveSelectedComposerSessionKey(workspaceId, threadId);
      if (!sessionKey) {
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(selectedComposerSelectionBySessionKey, sessionKey)) {
        return normalizeComposerSessionSelectionForThread(
          threadId,
          selectedComposerSelectionBySessionKey[sessionKey] ?? null,
        );
      }
      return normalizeComposerSessionSelectionForThread(
        threadId,
        readStoredThreadComposerSelectionEntryBySessionKey(sessionKey).value,
      );
    },
    [resolveSelectedComposerSessionKey, selectedComposerSelectionBySessionKey],
  );

  const commitSelectedComposerSelection = useCallback(
    (next: ComposerSessionSelection | null) => {
      selectedComposerSelectionRef.current = next;
      setSelectedComposerSelection((current) =>
        selectionsEqual(current, next) ? current : next,
      );
    },
    [],
  );

  const reloadSelectedComposerSelection = useCallback(() => {
    // Phase 1 决策核心化：取值规则单源于 resolveThreadSelectionOnSwitch，
    // hook 只负责组装输入（读 store/cache/pref）与应用 writes（落盘 + cache 同步）。
    const activeSessionKey = activeThreadId
      ? resolveSelectedComposerSessionKey(activeWorkspaceId, activeThreadId)
      : null;
    const storedEntry =
      activeSessionKey && activeThreadId
        ? readStoredThreadComposerSelectionEntryBySessionKey(activeSessionKey)
        : null;
    const selectionCache = selectedComposerSelectionBySessionKeyRef.current;
    const hasCacheEntry = Boolean(
      activeSessionKey &&
        Object.prototype.hasOwnProperty.call(selectionCache, activeSessionKey),
    );
    const cachedSelection = hasCacheEntry
      ? selectionCache[activeSessionKey] ?? null
      : null;
    // fork parent 读取仅在有需要时进行（stored/cache 均未命中）
    let forkParentThreadId: string | null = null;
    let forkParentStoredSelection: ComposerSessionSelection | null = null;
    if (!storedEntry?.exists && !hasCacheEntry && activeThreadId) {
      forkParentThreadId = extractClaudeForkParentThreadId(activeThreadId);
      if (forkParentThreadId) {
        const parentSessionKey = resolveSelectedComposerSessionKey(
          activeWorkspaceId,
          forkParentThreadId,
        );
        forkParentStoredSelection = parentSessionKey
          ? readStoredThreadComposerSelectionEntryBySessionKey(parentSessionKey)
              .value
          : null;
      }
    }

    // L4 回填取数与原 fillPendingComposerSelectionEffortFromEnginePref 同源：
    // 直接读 composerEnginePrefsStore（不经注入 resolver），codex 置 null。
    const threadEngine = activeThreadId
      ? resolveThreadEngine(activeThreadId)
      : null;
    const enginePrefEffort =
      threadEngine && threadEngine !== "codex"
        ? getComposerEnginePrefForEngine(threadEngine).effort
        : null;

    const decision = resolveThreadSelectionOnSwitch({
      workspaceId: activeWorkspaceId ?? null,
      threadId: activeThreadId,
      storedSelection: storedEntry ?? { exists: false, value: null },
      cachedSelection,
      hasCacheEntry,
      forkParentThreadId,
      forkParentStoredSelection,
      draft: draftComposerSelection
        ? {
            value: draftComposerSelection,
            workspaceId: draftComposerSelectionWorkspaceIdRef.current,
            sourceThreadId: draftComposerSelectionSourceThreadIdRef.current,
            applyToNextThread: shouldApplyDraftToNextThreadRef.current,
          }
        : null,
      engineDefaultSelection:
        (activeThreadId
          ? resolveEngineDefaultComposerSelectionRef.current?.(activeThreadId)
          : null) ?? null,
      engineDefaultSelectionReady: engineDefaultSelectionReady,
      enginePrefEffort,
    });

    for (const write of decision.writes) {
      if (write.kind === "clear-draft-apply-flag") {
        shouldApplyDraftToNextThreadRef.current = false;
        continue;
      }
      writeSelectionForSessionKey(write.sessionKey, write.value);
    }
    // L1/L2 的 store→cache 同步（幂等；writeSelectionForSessionKey 已含 L3 的同步）
    if (activeSessionKey) {
      cacheSelectionForSessionKey(activeSessionKey, decision.display);
    }
    commitSelectedComposerSelection(decision.display);
  }, [
    activeThreadId,
    activeWorkspaceId,
    commitSelectedComposerSelection,
    draftComposerSelection,
    engineDefaultSelectionReady,
    cacheSelectionForSessionKey,
    resolveSelectedComposerSessionKey,
    writeSelectionForSessionKey,
  ]);

  const previousThreadIdForDraftCarryRef = useRef<string | null>(activeThreadId ?? null);
  useEffect(() => {
    const previousThreadId = previousThreadIdForDraftCarryRef.current;
    if (previousThreadId && !activeThreadId) {
      const latestSelection = selectedComposerSelectionRef.current;
      setDraftComposerSelection(latestSelection ?? null);
      draftComposerSelectionWorkspaceIdRef.current = activeWorkspaceId ?? null;
      // 记录草稿来源线程，apply 点用它做引擎一致性判定。
      draftComposerSelectionSourceThreadIdRef.current = previousThreadId;
      shouldApplyDraftToNextThreadRef.current = Boolean(latestSelection);
    }
    previousThreadIdForDraftCarryRef.current = activeThreadId ?? null;
  }, [activeThreadId, activeWorkspaceId]);

  const previousThreadIdRef = useRef<string | null>(null);
  const previousThreadWorkspaceIdRef = useRef<string | null>(null);
  const lastComposerSelectionMigrationRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const previousWorkspaceId = previousThreadWorkspaceIdRef.current;
    const previousSelectedComposerSessionKey = resolveSelectedComposerSessionKey(
      previousWorkspaceId,
      previousThreadId,
    );
    const activeSelectedComposerSessionKey = resolveSelectedComposerSessionKey(
      activeWorkspaceId,
      activeThreadId,
    );
    const selectionCache = selectedComposerSelectionBySessionKeyRef.current;
    const previousSelectedComposerFromMemory =
      previousSelectedComposerSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectionCache,
        previousSelectedComposerSessionKey,
      )
        ? selectionCache[previousSelectedComposerSessionKey] ?? null
        : null;
    const activeSelectedComposerFromMemory =
      activeSelectedComposerSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectionCache,
        activeSelectedComposerSessionKey,
      )
        ? selectionCache[activeSelectedComposerSessionKey] ?? null
        : null;
    const previousSelectedComposerFromStore = previousSelectedComposerSessionKey
      ? readStoredThreadComposerSelectionEntryBySessionKey(previousSelectedComposerSessionKey)
          .value
      : null;
    const activeSelectedComposerFromStore = activeSelectedComposerSessionKey
      ? readStoredThreadComposerSelectionEntryBySessionKey(activeSelectedComposerSessionKey).value
      : null;
    const previousSelectedComposerValue = normalizeComposerSessionSelectionForThread(
      previousThreadId,
      previousSelectedComposerFromMemory ?? previousSelectedComposerFromStore,
    );
    const activeSelectedComposerValue = normalizeComposerSessionSelectionForThread(
      activeThreadId,
      activeSelectedComposerFromMemory ?? activeSelectedComposerFromStore,
    );
    const shouldMigrateComposerSelection =
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId,
        activeThreadId,
        previousSessionKey: previousSelectedComposerSessionKey,
        activeSessionKey: activeSelectedComposerSessionKey,
        hasSourceSelection: Boolean(previousSelectedComposerValue),
        hasTargetSelection: Boolean(activeSelectedComposerValue),
        resolveCanonicalThreadId,
      });
    if (
      shouldMigrateComposerSelection &&
      previousSelectedComposerSessionKey &&
      activeSelectedComposerSessionKey
    ) {
      const migrationKey = [
        previousWorkspaceId ?? "",
        previousThreadId ?? "",
        activeWorkspaceId ?? "",
        activeThreadId ?? "",
        previousSelectedComposerSessionKey,
        activeSelectedComposerSessionKey,
      ].join("\u0000");
      if (lastComposerSelectionMigrationRef.current !== migrationKey) {
        lastComposerSelectionMigrationRef.current = migrationKey;
        const migratedSelection = normalizeComposerSessionSelectionForThread(
          activeThreadId,
          previousSelectedComposerValue,
        );
        writeSelectionForSessionKey(activeSelectedComposerSessionKey, migratedSelection);
      }
    }
    previousThreadIdRef.current = activeThreadId ?? null;
    previousThreadWorkspaceIdRef.current = activeWorkspaceId ?? null;
  }, [
    activeThreadId,
    activeWorkspaceId,
    resolveCanonicalThreadId,
    resolveSelectedComposerSessionKey,
    writeSelectionForSessionKey,
  ]);

  useLayoutEffect(() => {
    reloadSelectedComposerSelection();
  }, [reloadSelectedComposerSelection]);

  useEffect(() => {
    if (isClientStoreReady("composer")) {
      reloadSelectedComposerSelection();
      return;
    }
    return subscribeClientStoreHydrated((store) => {
      if (store === "composer") {
        reloadSelectedComposerSelection();
      }
    });
  }, [reloadSelectedComposerSelection]);

  useEffect(() => {
    return subscribeDshComposerSelectionSeeded(() => {
      reloadSelectedComposerSelection();
    });
  }, [reloadSelectedComposerSelection]);

  return {
    selectedComposerSelection,
    selectedComposerSelectionRef,
    handleSelectComposerSelection,
    persistComposerSelectionForThread,
    reloadSelectedComposerSelection,
    resolveComposerSelectionForThread,
  };
}
