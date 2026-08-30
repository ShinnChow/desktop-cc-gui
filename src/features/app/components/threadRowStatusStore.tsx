import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ThreadStatusMap = Record<
  string,
  {
    isProcessing: boolean;
    hasUnread: boolean;
    isReviewing: boolean;
    /** 后台任务运行中计数；旧形状/缺失视为 0。 */
    backgroundTaskRunningCount?: number;
  }
>;

export type ThreadRowStatus = ThreadStatusMap[string];

type ThreadRowStatusStore = {
  getSnapshot: (threadId: string) => ThreadRowStatus | undefined;
  setStatusMap: (nextStatusById: ThreadStatusMap) => void;
  subscribe: (threadId: string, listener: () => void) => () => void;
};

const ThreadRowStatusStoreContext =
  createContext<ThreadRowStatusStore | null>(null);

function areThreadRowStatusesEqual(
  left: ThreadRowStatus | undefined,
  right: ThreadRowStatus | undefined,
) {
  return (
    left?.isProcessing === right?.isProcessing &&
    left?.hasUnread === right?.hasUnread &&
    left?.isReviewing === right?.isReviewing &&
    left?.backgroundTaskRunningCount === right?.backgroundTaskRunningCount
  );
}

function createThreadRowStatusStore(
  initialStatusById: ThreadStatusMap,
): ThreadRowStatusStore {
  let statusById = initialStatusById;
  const listenersByThreadId = new Map<string, Set<() => void>>();

  return {
    getSnapshot(threadId) {
      return statusById[threadId];
    },
    setStatusMap(nextStatusById) {
      if (Object.is(statusById, nextStatusById)) {
        return;
      }
      const previousStatusById = statusById;
      statusById = nextStatusById;
      const changedThreadIds = new Set([
        ...Object.keys(previousStatusById),
        ...Object.keys(nextStatusById),
      ]);

      changedThreadIds.forEach((threadId) => {
        if (
          areThreadRowStatusesEqual(
            previousStatusById[threadId],
            nextStatusById[threadId],
          )
        ) {
          return;
        }
        listenersByThreadId.get(threadId)?.forEach((listener) => listener());
      });
    },
    subscribe(threadId, listener) {
      const listeners =
        listenersByThreadId.get(threadId) ?? new Set<() => void>();
      listeners.add(listener);
      listenersByThreadId.set(threadId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByThreadId.delete(threadId);
        }
      };
    },
  };
}

export function ThreadRowStatusProvider({
  children,
  threadStatusById,
}: {
  children: ReactNode;
  threadStatusById: ThreadStatusMap;
}) {
  const threadRowStatusStoreRef = useRef<ThreadRowStatusStore | null>(null);
  if (threadRowStatusStoreRef.current === null) {
    threadRowStatusStoreRef.current =
      createThreadRowStatusStore(threadStatusById);
  }
  const threadRowStatusStore = threadRowStatusStoreRef.current;

  useLayoutEffect(() => {
    threadRowStatusStore.setStatusMap(threadStatusById);
  }, [threadRowStatusStore, threadStatusById]);

  return (
    <ThreadRowStatusStoreContext.Provider value={threadRowStatusStore}>
      {children}
    </ThreadRowStatusStoreContext.Provider>
  );
}

export function useThreadRowStatus(
  threadId: string,
): ThreadRowStatus | undefined {
  const store = useContext(ThreadRowStatusStoreContext);
  if (!store) {
    throw new Error(
      "useThreadRowStatus must be used within ThreadRowStatusProvider",
    );
  }

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(threadId, listener),
    [store, threadId],
  );
  const getSnapshot = useCallback(
    () => store.getSnapshot(threadId),
    [store, threadId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
