/**
 * 用户管理自定义模型的默认 reasoning 档位。
 *
 * 自定义模型（「自定义模型」管理器写入 localStorage，source: custom）没有
 * runtime capability 来源；为让 reasoning selector 可用、effort 不丢失，
 * 统一暴露主流默认档。CLI runtime 发现的 unknown model 不在此列，保持
 * capability-neutral（见 codex-model-catalog-coverage spec）。
 */

export const CUSTOM_MODEL_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export const CUSTOM_MODEL_DEFAULT_REASONING_EFFORT = 'medium';

export const CUSTOM_MODEL_SUPPORTED_REASONING_OPTIONS: Array<{
  reasoningEffort: string;
  description: string;
}> = [
  {
    reasoningEffort: 'low',
    description: 'Fast responses with lighter reasoning',
  },
  {
    reasoningEffort: 'medium',
    description: 'Balanced thinking for everyday tasks',
  },
  {
    reasoningEffort: 'high',
    description: 'Deeper reasoning for complex tasks',
  },
  {
    reasoningEffort: 'xhigh',
    description: 'Extra high reasoning depth',
  },
];

export type CustomModelSource = string | null | undefined;

/**
 * 用户管理的 Codex 模型来源集合：
 * - `custom`：「自定义模型」管理器写入 localStorage 的本地配置模型；
 * - `provider-custom` / `provider-config`：provider-scoped catalog 中该供应商
 *   拥有的自定义模型 / 配置默认模型（custom-model-provider-binding 双写或
 *   config.toml 解析产出）。
 *
 * 三者同属用户显式配置，缺少 runtime metadata 时共享公共默认档；CLI runtime
 * 发现的 unknown model（`runtime` 等来源）不在其列，保持 capability-neutral
 * （fix-codex-third-party-provider-model-catalog）。
 */
const USER_MANAGED_CUSTOM_MODEL_SOURCES: ReadonlySet<string> = new Set([
  'custom',
  'provider-custom',
  'provider-config',
]);

export function isUserManagedCustomModelSource(
  source: CustomModelSource,
): boolean {
  const trimmed = typeof source === 'string' ? source.trim() : '';
  return trimmed.length > 0 && USER_MANAGED_CUSTOM_MODEL_SOURCES.has(trimmed);
}

/**
 * 仅对用户管理的自定义 Codex 模型返回默认档；其他 engine / source 返回 null，
 * 避免为 unknown runtime model 伪造 capability。
 */

