/// <reference lib="webworker" />

// 必须最先 import：注册作用域错误监听（先于所有重依赖求值）
import "./workerScopeErrorBridge";
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
