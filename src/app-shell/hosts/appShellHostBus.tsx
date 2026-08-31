import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * 刀 1：Host 之间只通过 bus 交换切片。
 * 兄弟 Host 各自跑 hooks；未订阅的 Host 不会因对方 setState 重渲染。
 */
export type AppShellHostSliceName =
  | "session"
  | "catalog"
  | "git"
  | "cold"
  | "runtime"
  | "composer"
  | "flows";

export type AppShellHostSnapshot = {
  session?: Record<string, unknown>;
  catalog?: Record<string, unknown>;
  git?: Record<string, unknown>;
  cold?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  composer?: Record<string, unknown>;
  flows?: Record<string, unknown>;
};

type Listener = () => void;

const UNSET = Symbol("app-shell-host-unset");

export type AppShellHostBus = {
  getSnapshot: () => AppShellHostSnapshot;
  get: <K extends AppShellHostSliceName>(
    key: K,
  ) => AppShellHostSnapshot[K];
  publish: <K extends AppShellHostSliceName>(
    key: K,
    value: NonNullable<AppShellHostSnapshot[K]>,
    options?: { notify?: boolean },
  ) => void;
  subscribe: (key: AppShellHostSliceName | '*', listener: Listener) => () => void;
  subscribeFields: (
    key: AppShellHostSliceName,
    fields: readonly string[],
    listener: Listener,
  ) => () => void;
};

export function createAppShellHostBus(): AppShellHostBus {
  let snapshot: AppShellHostSnapshot = {};
  const keyed = new Map<string, Set<Listener>>();
  const fielded = new Map<string, Set<Listener>>();
  const all = new Set<Listener>();
  const pendingNotify = new Map<string, readonly string[] | null>();

  const notify = (key: string, changedFields: readonly string[] | null) => {
    keyed.get(key)?.forEach((listener) => listener());
    if (changedFields) {
      for (const field of changedFields) {
        fielded.get(`${key}.${field}`)?.forEach((listener) => listener());
      }
    } else {
      for (const [fieldKey, listeners] of fielded) {
        if (fieldKey.startsWith(`${key}.`)) {
          listeners.forEach((listener) => listener());
        }
      }
    }
    all.forEach((listener) => listener());
  };

  const listChangedFields = (
    previous: Record<string, unknown> | undefined,
    next: Record<string, unknown>,
  ): string[] | null => {
    if (!previous) {
      return null;
    }
    const fields = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const changed: string[] = [];
    for (const field of fields) {
      if (!Object.is(previous[field], next[field])) {
        changed.push(field);
      }
    }
    return changed;
  };

  return {
    getSnapshot: () => snapshot,
    get: (key) => snapshot[key],
    publish: (key, value, options) => {
      const shouldNotify = options?.notify !== false;
      const flushPending = () => {
        if (!pendingNotify.has(key)) {
          return;
        }
        const pending = pendingNotify.get(key) ?? null;
        pendingNotify.delete(key);
        // 克隆 snapshot，让 useSyncExternalStore 一定看到新身份。
        snapshot = { ...snapshot };
        notify(key, pending);
      };

      if (Object.is(snapshot[key], value)) {
        // render 期静默写入后，layout 会带着同一引用再 publish 一次。
        if (shouldNotify) {
          flushPending();
        }
        return;
      }
      const changedFields = listChangedFields(snapshot[key], value);
      if (changedFields && changedFields.length === 0) {
        // 新对象但字段相同：仍换引用，保留已有 pending，避免 Strict Mode 双渲染吞通知。
        snapshot = { ...snapshot, [key]: value };
        if (shouldNotify) {
          flushPending();
        }
        return;
      }
      snapshot = { ...snapshot, [key]: value };
      if (!shouldNotify) {
        pendingNotify.set(key, changedFields);
        return;
      }
      pendingNotify.delete(key);
      notify(key, changedFields);
    },
    subscribe: (key, listener) => {
      if (key === '*') {
        all.add(listener);
        return () => {
          all.delete(listener);
        };
      }
      let bucket = keyed.get(key);
      if (!bucket) {
        bucket = new Set();
        keyed.set(key, bucket);
      }
      bucket.add(listener);
      return () => {
        bucket?.delete(listener);
      };
    },
    subscribeFields: (key, fields, listener) => {
      const unsubs = fields.map((field) => {
        const fieldKey = `${key}.${field}`;
        let bucket = fielded.get(fieldKey);
        if (!bucket) {
          bucket = new Set();
          fielded.set(fieldKey, bucket);
        }
        bucket.add(listener);
        return () => {
          bucket?.delete(listener);
        };
      });
      return () => {
        unsubs.forEach((unsubscribe) => unsubscribe());
      };
    },
  };
}

const AppShellHostBusContext = createContext<AppShellHostBus | null>(null);

export function AppShellHostBusProvider(props: { children: ReactNode }) {
  const busRef = useRef<AppShellHostBus | null>(null);
  if (!busRef.current) {
    busRef.current = createAppShellHostBus();
  }
  return (
    <AppShellHostBusContext.Provider value={busRef.current}>
      {props.children}
    </AppShellHostBusContext.Provider>
  );
}

export function useAppShellHostBus(): AppShellHostBus {
  const bus = useContext(AppShellHostBusContext);
  if (!bus) {
    throw new Error("useAppShellHostBus must be used within AppShellHostBusProvider");
  }
  return bus;
}

export function usePublishHostSlice<K extends AppShellHostSliceName>(
  key: K,
  value: NonNullable<AppShellHostSnapshot[K]>,
): void {
  const bus = useAppShellHostBus();
  // 同一次 render 里的后代 / 后兄弟先读到快照；通知推迟到 layout，避免 render 期更新别人。
  bus.publish(key, value, { notify: false });
  useLayoutEffect(() => {
    bus.publish(key, value);
  }, [bus, key, value]);
}

/**
 * useHostFields 的容错变体：AppShellHostBusProvider 之外（独立测试挂载、
 * 非 app-shell 宿主的渲染树）返回全 undefined 字段而非抛错——消费方按
 * 「数据未就绪」降级，不得阻断渲染（B7 联动投影使用）。
 */
export function useHostFieldsSafe<
  K extends AppShellHostSliceName,
  F extends readonly string[],
>(key: K, fields: F): Record<F[number], unknown> {
  const bus = useContext(AppShellHostBusContext);
  if (!bus) {
    const empty = {} as Record<string, unknown>;
    const stable = useRef(empty);
    return stable.current as Record<F[number], unknown>;
  }
  return useHostFields(key, fields);
}

export function useHostFields<
  K extends AppShellHostSliceName,
  F extends readonly string[],
>(key: K, fields: F): Record<F[number], unknown> {
  const bus = useAppShellHostBus();
  const selectedRef = useRef<Record<string, unknown> | typeof UNSET>(UNSET);
  return useSyncExternalStore(
    (onStoreChange) => bus.subscribeFields(key, fields, onStoreChange),
    () => {
      const slice = (bus.get(key) ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const field of fields) {
        next[field] = slice[field];
      }
      const previous = selectedRef.current;
      if (previous !== UNSET) {
        const same = fields.every((field) => Object.is(previous[field], next[field]));
        if (same) {
          return previous;
        }
      }
      selectedRef.current = next;
      return next;
    },
  ) as Record<F[number], unknown>;
}

export function useHostSnapshot(): AppShellHostSnapshot {
  const bus = useAppShellHostBus();
  return useSyncExternalStore(
    (onStoreChange) => bus.subscribe('*', onStoreChange),
    bus.getSnapshot,
  );
}
