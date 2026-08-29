import type { LoadingProgressDialogConfig } from "../hooks/useLoadingProgressDialogState";

/** 侧栏创建路径弹窗的统一上限：超时后弹窗必关，卡死降级为可见错误。 */
export const CREATE_SESSION_LOADING_TIMEOUT_MS = 45_000;

export type LoadingProgressController = {
  showLoadingProgressDialog: (config: LoadingProgressDialogConfig) => string;
  hideLoadingProgressDialog: (requestId: string) => void;
};

type LoadingActionOutcome<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown };

export async function runWithLoadingProgress<T>(
  controller: LoadingProgressController,
  config: LoadingProgressDialogConfig,
  action: () => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const requestId = controller.showLoadingProgressDialog(config);
  let actionOutcome: LoadingActionOutcome<T>;

  const timeoutMs = options?.timeoutMs;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  // 弹窗必须可关闭（Native WebView Gate：出错用户能否自救）：侧栏创建路径
  // 的 await 没有统一上限，超时兜底把「永久卡死」降级为可见错误。
  const timeoutPromise: Promise<never> | null =
    timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `create-session loading timeout after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        })
      : null;

  try {
    actionOutcome = {
      status: "fulfilled",
      value: await (timeoutPromise
        ? Promise.race([action(), timeoutPromise])
        : action()),
    };
  } catch (error) {
    actionOutcome = { status: "rejected", error };
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }

  try {
    controller.hideLoadingProgressDialog(requestId);
  } catch (cleanupError) {
    if (actionOutcome.status === "fulfilled") {
      throw cleanupError;
    }
    console.error(
      "Failed to hide loading progress dialog after action failure",
      cleanupError,
    );
  }

  if (actionOutcome.status === "rejected") {
    throw actionOutcome.error;
  }

  return actionOutcome.value;
}
