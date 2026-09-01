import type { ConversationEngine, RealtimeAdapter } from "../contracts/conversationCurtainContracts";
import { claudeRealtimeAdapter } from "./claudeRealtimeAdapter";
import { codexRealtimeAdapter } from "./codexRealtimeAdapter";
import { geminiRealtimeAdapter } from "./geminiRealtimeAdapter";
import { grokRealtimeAdapter } from "./grokRealtimeAdapter";
import { kimiRealtimeAdapter } from "./kimiRealtimeAdapter";
import { dshRealtimeAdapter } from "./dshRealtimeAdapter";
import { opencodeRealtimeAdapter } from "./opencodeRealtimeAdapter";
import { ompRealtimeAdapter } from "./ompRealtimeAdapter";
import { piRealtimeAdapter } from "./piRealtimeAdapter";
import { qoderRealtimeAdapter } from "./qoderRealtimeAdapter";
import { inferEngineFromThreadId } from "./sharedRealtimeAdapter";

const ADAPTERS: Record<ConversationEngine, RealtimeAdapter> = {
  codex: codexRealtimeAdapter,
  claude: claudeRealtimeAdapter,
  gemini: geminiRealtimeAdapter,
  grok: grokRealtimeAdapter,
  kimi: kimiRealtimeAdapter,
  dsh: dshRealtimeAdapter,
  opencode: opencodeRealtimeAdapter,
  pi: piRealtimeAdapter,
  omp: ompRealtimeAdapter,
  qoder: qoderRealtimeAdapter,
};

export function getRealtimeAdapterByEngine(engine: ConversationEngine): RealtimeAdapter {
  return ADAPTERS[engine];
}

export function inferRealtimeAdapterEngine(threadId: string): ConversationEngine {
  return inferEngineFromThreadId(threadId);
}
