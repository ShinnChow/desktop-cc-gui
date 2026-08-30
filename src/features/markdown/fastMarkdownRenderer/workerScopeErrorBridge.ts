// F6（fix-session-load-bridge-freeze / Phase C）：作用域错误回传桥。
// 必须是 worker 入口的第一个 import：若重依赖 chunk 在求值期抛错（本轮实测
// chunk-GNJJE6OE.js:64:23），入口模块的监听器尚未注册就会错过 stack。
// 本模块零依赖，注册后立即生效，把完整 message/stack/位置回传主线程。
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("error", (event) => {
  const errorEvent = event as ErrorEvent;
  const error = errorEvent.error;
  scope.postMessage({
    type: "fast-markdown-worker-scope-error",
    detail: {
      message: errorEvent.message || "worker scope error",
      errorName: error instanceof Error && error.name ? error.name : "Error",
      filename: errorEvent.filename || null,
      lineno: errorEvent.lineno ?? null,
      colno: errorEvent.colno ?? null,
      stack: error instanceof Error ? (error.stack ?? null) : null,
    },
  });
});

scope.addEventListener("unhandledrejection", (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  const error = reason instanceof Error ? reason : null;
  scope.postMessage({
    type: "fast-markdown-worker-scope-error",
    detail: {
      message: error ? error.message : String(reason ?? "unhandled rejection"),
      errorName: error ? error.name : "Error",
      filename: null,
      lineno: null,
      colno: null,
      stack: error ? (error.stack ?? null) : null,
    },
  });
});
