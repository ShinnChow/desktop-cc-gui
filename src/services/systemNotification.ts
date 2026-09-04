import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  onAction,
  sendNotification as sendPluginNotification,
} from "@tauri-apps/plugin-notification";

type NotificationActionHandler = (extra: Record<string, unknown>) => void;

export type SystemNotificationPermissionState = {
  status: string;
  canSend: boolean;
};

let actionListenerRegistered = false;
let actionListenerInitAttempted = false;
let actionHandler: NotificationActionHandler | null = null;
let lastPermissionState: SystemNotificationPermissionState | null = null;

function registerActionListener() {
  if (actionListenerRegistered || actionListenerInitAttempted || !isTauri()) {
    return;
  }
  actionListenerInitAttempted = true;
  void onAction(async (notification) => {
    try {
      const window = getCurrentWindow();
      await window.show();
      await window.setFocus();
    } catch (_error) {
      // Best-effort only: notification click should continue even if window focus fails.
    }
    if (actionHandler && notification.extra) {
      actionHandler(notification.extra);
    }
  })
    .then(() => {
      actionListenerRegistered = true;
    })
    .catch(() => undefined);
}

export function setNotificationActionHandler(
  handler: NotificationActionHandler | null,
) {
  actionHandler = handler;
}





/**
 * Request OS notification authorization when needed.
 * On macOS this uses UNUserNotificationCenter so the app appears in
 * System Settings → Notifications under the real bundle id.
 */
export async function requestSystemNotificationPermission(): Promise<SystemNotificationPermissionState> {
  if (!isTauri()) {
    lastPermissionState = { status: "unsupported", canSend: false };
    return lastPermissionState;
  }
  try {
    const state = await invoke<SystemNotificationPermissionState>(
      "system_notification_request_permission",
    );
    lastPermissionState = state;
    return state;
  } catch (error) {
    console.warn("[systemNotification] request_permission failed", error);
    lastPermissionState = {
      status: "error",
      canSend: false,
    };
    return lastPermissionState;
  }
}

export async function sendSystemNotification(options: {
  title: string;
  body: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  if (!isTauri()) {
    return;
  }
  registerActionListener();
  try {
    await invoke("system_notification_send", {
      title: options.title,
      body: options.body,
    });
    return;
  } catch (primaryError) {
    console.warn(
      "[systemNotification] native send failed, trying plugin fallback",
      primaryError,
    );
  }

  // Fallback for environments where the new command is not yet available
  // (e.g. mixed web-assets / old binary). Plugin path is known-broken on
  // recent macOS but still useful on Windows.
  try {
    sendPluginNotification({
      title: options.title,
      body: options.body,
      extra: options.extra,
    });
  } catch (fallbackError) {
    console.warn("[systemNotification] plugin fallback failed", fallbackError);
  }
}

// Reset module state on HMR to prevent stale listeners
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    actionListenerRegistered = false;
    actionListenerInitAttempted = false;
    actionHandler = null;
    lastPermissionState = null;
  });
}
