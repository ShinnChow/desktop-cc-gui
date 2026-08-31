import type { AppServerEvent } from "../../../../types";
import { resolveSharedRuntimeControlOwner } from "../../../shared-session/runtime/sharedSessionBridge";
import type { AppServerEventDispatchContext } from "./types";

export function dispatchCollabFamily(
  ctx: AppServerEventDispatchContext,
  method: string,
  payload: AppServerEvent,
): boolean {
  const { handlers, params, rawThreadId, sharedBridge } = ctx;
  const { workspace_id, message } = payload;
  const requestIdValue = message.id ?? params.requestId ?? params.request_id;
  const requestId =
    typeof requestIdValue === "number" || typeof requestIdValue === "string"
      ? requestIdValue
      : null;
  const hasRequestId = requestId !== null;

  if (
    (method.includes("requestApproval") || method === "approval/request") &&
    hasRequestId
  ) {
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return true;
    }
    handlers.onApprovalRequest?.({
      workspace_id,
      request_id: requestId,
      method,
      params,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
    });
    return true;
  }

  if (method === "collaboration/modeBlocked") {
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return true;
    }
    const requestIdValue = params.requestId ?? params.request_id;
    const requestId =
      typeof requestIdValue === "number" || typeof requestIdValue === "string"
        ? requestIdValue
        : null;
    const reasonCodeValue = params.reasonCode ?? params.reason_code;
    const parsedReasonCode =
      reasonCodeValue === undefined || reasonCodeValue === null
        ? undefined
        : String(reasonCodeValue);
    handlers.onModeBlocked?.({
      workspace_id,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
      params: {
        thread_id: String(params.threadId ?? params.thread_id ?? ""),
        blocked_method: String(
          params.blockedMethod ?? params.blocked_method ?? "",
        ),
        effective_mode: String(
          params.effectiveMode ?? params.effective_mode ?? "",
        ),
        ...(parsedReasonCode ? { reason_code: parsedReasonCode } : {}),
        reason: String(params.reason ?? ""),
        suggestion:
          params.suggestion === undefined || params.suggestion === null
            ? undefined
            : String(params.suggestion),
        request_id: requestId,
      },
    });
    return true;
  }

  if (method === "collaboration/modeResolved") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const selectedUiModeRaw = String(
      params.selectedUiMode ?? params.selected_ui_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const effectiveRuntimeModeRaw = String(
      params.effectiveRuntimeMode ?? params.effective_runtime_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const effectiveUiModeRaw = String(
      params.effectiveUiMode ?? params.effective_ui_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const fallbackReasonRaw = params.fallbackReason ?? params.fallback_reason;
    const selectedUiMode = selectedUiModeRaw === "plan" ? "plan" : "default";
    const effectiveRuntimeMode =
      effectiveRuntimeModeRaw === "plan" ? "plan" : "code";
    const effectiveUiMode = effectiveUiModeRaw === "plan" ? "plan" : "default";
    handlers.onModeResolved?.({
      workspace_id,
      params: {
        thread_id: String(params.threadId ?? params.thread_id ?? ""),
        selected_ui_mode: selectedUiMode,
        effective_runtime_mode: effectiveRuntimeMode,
        effective_ui_mode: effectiveUiMode,
        fallback_reason:
          fallbackReasonRaw === undefined || fallbackReasonRaw === null
            ? null
            : String(fallbackReasonRaw),
      },
    });
    return true;
  }
  return false;
}
