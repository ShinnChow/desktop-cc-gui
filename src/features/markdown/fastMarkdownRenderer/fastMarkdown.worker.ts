/// <reference lib="webworker" />

import { compileFastMarkdownToUnsafeArtifact } from "./compileCore";
import type {
  CompileFastMarkdownArgs,
  FastMarkdownUnsafeArtifact,
  FastMarkdownWorkerRequestMeta,
} from "./types";

type FastMarkdownWorkerCompileRequest = {
  type: "compile-fast-markdown";
  requestId: string;
  requestMeta: FastMarkdownWorkerRequestMeta;
  args: CompileFastMarkdownArgs;
};

type FastMarkdownWorkerCompileSuccess = {
  type: "fast-markdown-result";
  requestId: string;
  result: FastMarkdownUnsafeArtifact;
};

type FastMarkdownWorkerCompileError = {
  type: "fast-markdown-error";
  requestId: string;
  error: {
    name: string;
    message: string;
  };
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

// F6（fix-session-load-bridge-freeze / Phase C）：作用域错误回传。
// worker 内部未捕获异常同时触发主线程 Worker error 事件（探活/退避在那边处理），
// 但完整 message + stack 只有作用域内拿得到。回传结构化 detail，主线程指纹落盘
// （全文进 console），下一轮日志直接定位真凶模块与函数。
workerScope.addEventListener(
  "error",
  (event) => {
    const errorEvent = event as ErrorEvent;
    const error = errorEvent.error;
    workerScope.postMessage({
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
  },
);

workerScope.addEventListener("unhandledrejection", (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  const error = reason instanceof Error ? reason : null;
  workerScope.postMessage({
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

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isCompileRequest(message)) {
    return;
  }

  void compileFastMarkdownToUnsafeArtifact(message.args)
    .then((result) => {
      workerScope.postMessage({
        type: "fast-markdown-result",
        requestId: message.requestId,
        result,
      } satisfies FastMarkdownWorkerCompileSuccess);
    })
    .catch((error: unknown) => {
      const normalized = normalizeWorkerError(error);
      workerScope.postMessage({
        type: "fast-markdown-error",
        requestId: message.requestId,
        error: normalized,
      } satisfies FastMarkdownWorkerCompileError);
    });
});

function isCompileRequest(value: unknown): value is FastMarkdownWorkerCompileRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === "compile-fast-markdown" &&
    typeof value.requestId === "string" &&
    isWorkerRequestMeta(value.requestMeta, value.requestId) &&
    isRecord(value.args)
  );
}

function isWorkerRequestMeta(
  value: unknown,
  requestId: string,
): value is FastMarkdownWorkerRequestMeta {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.requestId === requestId &&
    typeof value.documentKey === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.optionsHash === "string" &&
    value.schemaVersion === "fast-markdown-worker-v1" &&
    typeof value.createdAtMs === "number"
  );
}

function normalizeWorkerError(error: unknown): FastMarkdownWorkerCompileError["error"] {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Fast Markdown worker compile failed",
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
