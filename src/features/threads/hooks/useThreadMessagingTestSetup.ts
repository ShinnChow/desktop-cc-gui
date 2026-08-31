import { beforeEach, vi } from "vitest";
import { resetThreadMessagingTestMocks } from "./useThreadMessaging.test-utils";
import { resetSharedSessionAttemptReattachmentsForTests } from "../../shared-session/runtime/reattachSharedSessionAttempt";
import { resetSharedSendStateStoreForTests } from "../../shared-session/runtime/sharedSendStateStore";
import { resetSharedTargetStoreForTests } from "../../shared-session/target/targetStore";

// 该文件把 getClientStoreSync 桩成恒 undefined，真实侧车迁移读不到缓存；
// 只替换 rename 为 spy 断言接线（迁移逻辑由 turnTargetBadgeStorage.test 覆盖）。
vi.mock("../utils/turnTargetBadgeStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/turnTargetBadgeStorage")>()),
  renameTurnTargetBadgeThread: vi.fn(),
}));

export function registerThreadMessagingTestHooks() {
  beforeEach(() => {
    resetThreadMessagingTestMocks();
    resetSharedTargetStoreForTests();
    resetSharedSendStateStoreForTests();
    resetSharedSessionAttemptReattachmentsForTests();
    window.localStorage.removeItem("mossx.sharedV2Send");
  });
}
