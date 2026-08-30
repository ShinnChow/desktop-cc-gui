/**
 * pi 思考档按需降档（optimize-pi-first-packet-latency 阶段三 / D4）。
 *
 * kimi k3 默认 high 档在琐碎消息上仍产生 ~11s 思考静默（诊断 doc §三A2）。
 * 仅在「新会话首条 + 用户未触碰档位选择器 + prompt 极短」时，本 turn 以
 * low 档发送；不写回任何持久化偏好。判定面从严：
 * - effort 非空 = 用户显式设档（含显式 high），永不覆盖；
 * - hasSession（恢复会话）= 直接跳过——这是「无 assistant 历史」的保守
 *   代理（子集），恢复会话即使尚无 assistant 消息也不降，宁可不降不可错降；
 * - pi 不支持 low 档时，send 侧 pick_thinking_level 会按 allowlist 跳过，
 *   不会阻塞 prompt。
 */

export const PI_AUTO_DOWNGRADE_MAX_PROMPT_CHARS = 24;

export function resolvePiFirstMessageEffort(input: {
  engine: string | null | undefined;
  effort: string | null | undefined;
  /** true = 恢复会话（已有 pi session id）；false = 新会话首条。 */
  hasSession: boolean;
  promptText: string;
}): string | null {
  const effort = input.effort?.trim() ? input.effort!.trim() : null;
  if (input.engine !== "pi") {
    return effort;
  }
  if (input.hasSession) {
    return effort;
  }
  if (effort != null) {
    return effort;
  }
  if (input.promptText.length > PI_AUTO_DOWNGRADE_MAX_PROMPT_CHARS) {
    return null;
  }
  return "low";
}
