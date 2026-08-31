import { invoke } from "@tauri-apps/api/core";
import {
  ALL_CLIENT_STORES,
  CRITICAL_CLIENT_STORES,
  DEFERRED_CLIENT_STORES,
  normalizeClientStoreSnapshot,
  serializeClientStoreSnapshot,
  type ClientStoreName,
} from "./clientStorageSchema";
import { recordHotspotSample } from "./perfBaseline/hotspotTracker";



const cache: Partial<Record<ClientStoreName, Record<string, unknown>>> = {};
const hydratedStores = new Set<ClientStoreName>();
const inFlightReads = new Map<ClientStoreName, Promise<void>>();
const hydratedListeners = new Set<(store: ClientStoreName) => void>();

let preloaded = false;

const WRITE_DEBOUNCE_MS = 300;
const pendingTimers: Partial<Record<ClientStoreName, ReturnType<typeof setTimeout>>> = {};
const dirtyKeys: Partial<Record<ClientStoreName, Set<string>>> = {};
const pendingFullReplace: Partial<Record<ClientStoreName, boolean>> = {};
const writeChainByStore: Partial<Record<ClientStoreName, Promise<void>>> = {};

function notifyStoreHydrated(store: ClientStoreName): void {
  for (const listener of hydratedListeners) {
    listener(store);
  }
}

function markStoreHydrated(store: ClientStoreName): void {
  if (hydratedStores.has(store)) {
    return;
  }
  hydratedStores.add(store);
  notifyStoreHydrated(store);
}

function refreshPreloadedFlag(): void {
  preloaded = ALL_CLIENT_STORES.every((store) => hydratedStores.has(store));
}

function mergeHydratedStoreData(
  store: ClientStoreName,
  diskData: Record<string, unknown>,
): Record<string, unknown> {
  if (pendingFullReplace[store] === true) {
    return cache[store] ?? {};
  }
  const memory = cache[store];
  if (!memory) {
    return diskData;
  }
  const dirty = dirtyKeys[store];
  if (!dirty || dirty.size === 0) {
    return diskData;
  }
  const merged: Record<string, unknown> = { ...diskData };
  for (const key of dirty) {
    merged[key] = memory[key];
  }
  return merged;
}

async function readClientStoreSnapshot(
  store: ClientStoreName,
): Promise<{ data: Record<string, unknown>; recoveryReason: boolean }> {
  try {
    const raw = await invoke<unknown>("client_store_read", { store });
    const normalized = normalizeClientStoreSnapshot(raw);
    return {
      data: normalized.data,
      recoveryReason: Boolean(normalized.recoveryReason),
    };
  } catch {
    return {
      data: {},
      recoveryReason: false,
    };
  }
}

async function hydrateClientStores(
  stores: readonly ClientStoreName[],
): Promise<void> {
  const pending = stores.filter((store) => !hydratedStores.has(store));
  if (pending.length === 0) {
    refreshPreloadedFlag();
    return;
  }
  await Promise.all(
    pending.map((store) => {
      const inFlight = inFlightReads.get(store);
      if (inFlight) {
        return inFlight;
      }
      const next = (async () => {
        const snapshot = await readClientStoreSnapshot(store);
        const shouldPreserveMemoryReplace = pendingFullReplace[store] === true;
        cache[store] = mergeHydratedStoreData(store, snapshot.data);
        markStoreHydrated(store);
        if (snapshot.recoveryReason && !shouldPreserveMemoryReplace) {
          queueMicrotask(() => {
            writeClientStoreData(store, cache[store] ?? {}, { immediate: true });
          });
        }
      })().finally(() => {
        inFlightReads.delete(store);
      });
      inFlightReads.set(store, next);
      return next;
    }),
  );
  refreshPreloadedFlag();
}

export async function preloadCriticalClientStores(): Promise<void> {
  await hydrateClientStores(CRITICAL_CLIENT_STORES);
}

export async function preloadDeferredClientStores(): Promise<void> {
  await hydrateClientStores(DEFERRED_CLIENT_STORES);
}

export async function preloadClientStores(): Promise<void> {
  if (preloaded) {
    return;
  }
  await hydrateClientStores(ALL_CLIENT_STORES);
}

export function isPreloaded(): boolean {
  return preloaded;
}

export function isClientStoreReady(store: ClientStoreName): boolean {
  return hydratedStores.has(store);
}

export function whenClientStoreReady(store: ClientStoreName): Promise<void> {
  if (hydratedStores.has(store)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsubscribe = subscribeClientStoreHydrated((readyStore) => {
      if (readyStore !== store) {
        return;
      }
      unsubscribe();
      resolve();
    });
  });
}

export function subscribeClientStoreHydrated(
  listener: (store: ClientStoreName) => void,
): () => void {
  hydratedListeners.add(listener);
  return () => {
    hydratedListeners.delete(listener);
  };
}

export function resetClientStorageForTests(): void {
  preloaded = false;
  hydratedStores.clear();
  inFlightReads.clear();
  hydratedListeners.clear();
  for (const store of ALL_CLIENT_STORES) {
    delete cache[store];
    if (pendingTimers[store] != null) {
      clearTimeout(pendingTimers[store]);
      delete pendingTimers[store];
    }
    delete dirtyKeys[store];
    delete pendingFullReplace[store];
    delete writeChainByStore[store];
  }
}

export function getClientStoreSync<T = unknown>(
  store: ClientStoreName,
  key: string,
): T | undefined {
  const storeData = cache[store];
  if (!storeData) {
    return undefined;
  }
  return storeData[key] as T | undefined;
}

export function getClientStoreFullSync<T = Record<string, unknown>>(
  store: ClientStoreName,
): T | undefined {
  return cache[store] as T | undefined;
}

export function writeClientStoreValue(
  store: ClientStoreName,
  key: string,
  value: unknown,
  options?: { immediate?: boolean },
): void {
  if (!cache[store]) {
    cache[store] = {};
  }
  cache[store]![key] = value;
  if (!dirtyKeys[store]) {
    dirtyKeys[store] = new Set();
  }
  dirtyKeys[store]!.add(key);
  if (options?.immediate) {
    flushStoreWrite(store);
    return;
  }
  scheduleDiskWrite(store);
}

export function writeClientStoreData(
  store: ClientStoreName,
  data: Record<string, unknown>,
  options?: { immediate?: boolean },
): void {
  cache[store] = data;
  pendingFullReplace[store] = true;
  dirtyKeys[store] = new Set(Object.keys(data));
  if (options?.immediate) {
    flushStoreWrite(store);
    return;
  }
  scheduleDiskWrite(store);
}

function scheduleDiskWrite(store: ClientStoreName): void {
  if (pendingTimers[store] != null) {
    clearTimeout(pendingTimers[store]);
  }
  pendingTimers[store] = setTimeout(() => {
    delete pendingTimers[store];
    flushStoreWrite(store);
  }, WRITE_DEBOUNCE_MS);
}

function flushStoreWrite(store: ClientStoreName): void {
  if (pendingTimers[store] != null) {
    clearTimeout(pendingTimers[store]);
    delete pendingTimers[store];
  }

  const shouldFullReplace = pendingFullReplace[store] === true;
  pendingFullReplace[store] = false;
  const dirtySnapshot = new Set(dirtyKeys[store] ?? []);
  if (dirtyKeys[store]) {
    for (const key of dirtySnapshot) {
      dirtyKeys[store]!.delete(key);
    }
  }
  const cacheSnapshot = cache[store] ?? {};
  const valueSnapshot: Record<string, unknown> = {};
  for (const key of dirtySnapshot) {
    valueSnapshot[key] = cacheSnapshot[key];
  }
  const fullDataSnapshot = shouldFullReplace ? { ...cacheSnapshot } : null;

  const nextWrite = async () => {
    // 只统计同步部分(序列化 + IPC marshaling),这才是占用主线程、可能造成掉帧的开销;
    // await 之后的等待发生在 Rust 侧,不阻塞渲染。
    const syncStartedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let pendingInvoke: Promise<unknown>;
    // 载荷必须以单一 pre-stringified JSON string 过桥：WKWebView 桥按对象数同步
    // 转换嵌套对象图（实测 274KB patch 同步段 3338ms），字符串成本 O(len)。
    if (shouldFullReplace && fullDataSnapshot) {
      pendingInvoke = invoke("client_store_write", {
        store,
        payloadJson: JSON.stringify(
          serializeClientStoreSnapshot(fullDataSnapshot),
        ),
      });
    } else {
      pendingInvoke = invoke("client_store_patch", {
        store,
        payloadJson: JSON.stringify(serializeClientStoreSnapshot(valueSnapshot)),
      });
    }
    recordHotspotSample(
      "client-store-write",
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        syncStartedAt,
      `${store}:${shouldFullReplace ? "full" : [...dirtySnapshot].slice(0, 3).join(",")}`,
    );
    await pendingInvoke;
  };

  writeChainByStore[store] = (writeChainByStore[store] ?? Promise.resolve())
    .then(nextWrite)
    .catch((error) => {
      if (!dirtyKeys[store]) {
        dirtyKeys[store] = new Set();
      }
      for (const key of dirtySnapshot) {
        dirtyKeys[store]!.add(key);
      }
      if (shouldFullReplace) {
        pendingFullReplace[store] = true;
      }
      scheduleDiskWrite(store);
      if (typeof console !== "undefined") {
        console.error(`Failed to write client store "${store}":`, error);
      }
    });
}
