import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import {
  subscribeAppServerEvents,
  subscribeRawAppServerEvents,
} from "../../../services/events";
import { setSharedV2SendOverride } from "../../shared-session/runtime/sharedV2SendFlag";
import { resetSharedTargetStoreForTests } from "../../shared-session/target/targetStore";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/events")>();
  return {
    ...actual,
    subscribeAppServerEvents: vi.fn(),
    subscribeRawAppServerEvents: vi.fn(),
  };
});

vi.mock("../../shared-session/services/sharedSessions", () => ({
  updateSharedSessionNativeBinding: vi.fn(() => Promise.resolve(null)),
}));

export type Handlers = Parameters<typeof useAppServerEvents>[0];
type HookOptions = Parameters<typeof useAppServerEvents>[1];

function TestHarness({
  handlers,
  options,
}: {
  handlers: Handlers;
  options?: HookOptions;
}) {
  useAppServerEvents(handlers, options);
  return null;
}

export let listener: ((event: AppServerEvent) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  listener = null;
  unlisten.mockReset();
  resetSharedTargetStoreForTests();
  setSharedV2SendOverride(null);
  vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
  vi.mocked(subscribeRawAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
});

afterEach(() => {
  setSharedV2SendOverride(null);
  vi.clearAllMocks();
});

export async function mount(handlers: Handlers, options?: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(TestHarness, { handlers, options }));
  });
  return { root };
}
