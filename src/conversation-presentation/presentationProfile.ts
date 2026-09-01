import { resolveConversationAssemblyMigrationGate } from "../features/threads/assembly/conversationMigrationGates";
import type { ConversationEngine } from "../features/threads/contracts/conversationCurtainContracts";

export type PresentationProfile = {
  engine: ConversationEngine;
  preferCommandSummary: boolean;
  codexCanvasMarkdown: boolean;
  showReasoningLiveDot: boolean;
  heartbeatWaitingHint: boolean;
  assistantMarkdownStreamingThrottleMs: number;
  reasoningStreamingThrottleMs: number;
  useCodexStagedMarkdownThrottle: boolean;
};

export function resolvePresentationProfile(
  engine: ConversationEngine,
): PresentationProfile {
  const migrationGate = resolveConversationAssemblyMigrationGate(engine);
  if (migrationGate && !migrationGate.profileEnabled) {
    return {
      engine,
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    };
  }
  if (engine === "codex") {
    return {
      engine,
      preferCommandSummary: true,
      codexCanvasMarkdown: true,
      showReasoningLiveDot: true,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: true,
    };
  }
  if (engine === "opencode") {
    return {
      engine,
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: true,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    };
  }
  // pi 的 RPC prefill 静默窗口可达 20-50s（零事件），开启 12s 安抚提示与
  // heartbeat pulse（pi first-packet diagnosis 2026-08-28）；其余展示面保持默认。
  // omp 与 pi 同协议（pi-rpc resident runtime），共享同一 heartbeat profile。
  if (engine === "pi" || engine === "omp") {
    return {
      engine,
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: true,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    };
  }
  return {
    engine,
    preferCommandSummary: false,
    codexCanvasMarkdown: false,
    showReasoningLiveDot: false,
    heartbeatWaitingHint: false,
    assistantMarkdownStreamingThrottleMs: 80,
    reasoningStreamingThrottleMs: 180,
    useCodexStagedMarkdownThrottle: false,
  };
}
