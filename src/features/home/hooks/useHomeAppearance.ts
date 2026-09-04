import { useEffect, useState } from "react";
import {
  getClientStoreSync,
  subscribeClientStoreHydrated,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import {
  HOME_APPEARANCE_KEY,
  sanitizeHomeAppearance,
  type HomeAppearance,
} from "../utils/homeAppearance";

function readAppearance() {
  return sanitizeHomeAppearance(getClientStoreSync("app", HOME_APPEARANCE_KEY));
}

// Feature-local, low-frequency updates: Settings and Home can stay mounted together.
const listeners = new Set<() => void>();

export function useHomeAppearance() {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    const refresh = () => setAppearance(readAppearance());
    listeners.add(refresh);
    const unsubscribe = subscribeClientStoreHydrated((store) => {
      if (store === "app") refresh();
    });
    refresh();
    return () => { listeners.delete(refresh); unsubscribe(); };
  }, []);

  function saveAppearance(value: HomeAppearance) {
    const next = sanitizeHomeAppearance(value);
    writeClientStoreValue("app", HOME_APPEARANCE_KEY, next, { immediate: true });
    listeners.forEach((refresh) => refresh());
  }

  return { appearance, saveAppearance };
}
