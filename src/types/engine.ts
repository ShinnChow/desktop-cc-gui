// ==================== Engine Types ====================

/**
 * Supported AI coding CLI engine types
 */
export type EngineType = "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";

/**
 * Feature capabilities for each engine
 */
export type EngineFeatures = {
  streaming: boolean;
  imageInput: boolean;
  reasoningEffort?: boolean;
  collaborationMode?: boolean;
  sessionResume?: boolean;
  toolsControl?: boolean;
  mcp?: boolean;
  /** @deprecated 兼容旧缓存与测试 fixture；runtime DTO 使用 reasoningEffort。 */
  reasoning?: boolean;
  /** @deprecated 兼容旧缓存与测试 fixture；runtime DTO 使用 toolsControl。 */
  toolUse?: boolean;
  /** @deprecated 兼容旧缓存与测试 fixture；runtime DTO 使用 sessionResume。 */
  sessionContinuation?: boolean;
};

/**
 * Model information for an engine
 */
export type EngineModelInfo = {
  id: string;
  model?: string;
  displayName: string;
  description: string;
  source?: string;
  provider?: string | null;
  protocol?: string | null;
  provenance?: string | null;
  observedAt?: number | null;
  lastVerifiedAt?: string | null;
  lifecycle?: string | null;
  providerProfileId?: string | null;
  /**
   * Adapter-owned reasoning effort ids exposed by the engine host catalog
   * (e.g. DSH llm.models reasoning.efforts: off/low/high/max).
   */
  supportedReasoningEfforts?: string[];
  /** Model default reasoning effort, when the host declares one. */
  defaultReasoningEffort?: string | null;
  isDefault: boolean;
};

/**
 * Engine installation and availability status
 */
export type EngineStatus = {
  engineType: EngineType;
  installed: boolean;
  version: string | null;
  binPath: string | null;
  features: EngineFeatures;
  models: EngineModelInfo[];
  error: string | null;
  /** 登录态（B6 二段式：phase 1 多为 unknown，phase 2 事件补推）。 */
  authState?: "unknown" | "authenticated" | "requires_login";
};

/**
 * Engine configuration options
 */
export type EngineConfig = {
  binPath: string | null;
  homeDir: string | null;
  customArgs: string | null;
};

/**
 * Parameters for sending a message to an engine
 */
export type EngineSendMessageParams = {
  text: string;
  model: string | null;
  images: string[] | null;
  continueSession: boolean;
  sessionId: string | null;
  forkSessionId?: string | null;
  accessMode: string | null;
  agent?: string | null;
  variant?: string | null;
  dshAgentPreset?: string | null;
};

/**
 * Unified engine event types for streaming
 */
export type EngineEvent =
  | {
      type: "sessionStarted";
      workspaceId: string;
      sessionId: string;
      engine: EngineType;
    }
  | {
      type: "turnStarted";
      workspaceId: string;
      turnId: string;
    }
  | {
      type: "textDelta";
      workspaceId: string;
      text: string;
    }
  | {
      type: "reasoningDelta";
      workspaceId: string;
      text: string;
    }
  | {
      type: "toolStarted";
      workspaceId: string;
      toolId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "toolCompleted";
      workspaceId: string;
      toolId: string;
      output: unknown;
      error: string | null;
    }
  | {
      type: "backgroundTaskStarted";
      workspaceId: string;
      toolId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "backgroundTaskUpdated";
      workspaceId: string;
      toolId: string | null;
      task: unknown;
      source: string;
    }
  | {
      type: "approvalRequest";
      workspaceId: string;
      requestId: unknown;
      toolName: string;
      input: unknown;
      message: string | null;
    }
  | {
      type: "turnCompleted";
      workspaceId: string;
      result: unknown;
    }
  | {
      type: "turnError";
      workspaceId: string;
      error: string;
      code: string | null;
    }
  | {
      type: "sessionEnded";
      workspaceId: string;
      sessionId: string;
    }
  | {
      type: "usageUpdate";
      workspaceId: string;
      inputTokens: number | null;
      outputTokens: number | null;
      cachedTokens: number | null;
    }
  | {
      type: "raw";
      workspaceId: string;
      engine: EngineType;
      data: unknown;
    };
