import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { engineSendMessageSync } from '../../../../../services/tauri';
import type { EngineType } from '../../../../../types';
import { isEngineExecutionEnabled } from '../../../../../utils/engineExecutionPolicy';
import { getNormalizedAssistantMessageText } from '../../../../../utils/threadItemsAssistantText';
import { useCliEngineVisibility } from '../../../hooks/cliEngineVisibilityStore';
import { resolveDshModelForSend } from '../../../../threads/hooks/threadMessagingHelpers';
import type { ModelInfo, ProviderId } from '../types';
import type { ProviderModelGroup } from '../modelOptions';

const PROMPT_ENHANCER_DEFAULT_TIMEOUT_SECONDS = 60;
const PROMPT_ENHANCER_MIN_TIMEOUT_SECONDS = 5;
const PROMPT_ENHANCER_MAX_TIMEOUT_SECONDS = 300;
const PROMPT_ENHANCER_AUTO_SESSION = {
  sessionPurpose: 'prompt-enhancer',
  visibility: 'hidden',
  ownerFeature: 'composer',
  autoArchive: true,
  createdBy: 'system',
} as const;

export const PROMPT_ENHANCER_ENGINE_OPTIONS: EngineType[] = [
  'claude',
  'codex',
  'grok',
  'kimi',
  'opencode',
  'pi',
  'omp',
  'dsh',
  'qoder',
];

export type PromptEnhancerIntensity = 'light' | 'struct' | 'exec';

export const PROMPT_ENHANCER_INTENSITY_OPTIONS: PromptEnhancerIntensity[] = [
  'light',
  'struct',
  'exec',
];

export const PROMPT_ENHANCER_TIMEOUT_LIMITS = {
  defaultSeconds: PROMPT_ENHANCER_DEFAULT_TIMEOUT_SECONDS,
  minSeconds: PROMPT_ENHANCER_MIN_TIMEOUT_SECONDS,
  maxSeconds: PROMPT_ENHANCER_MAX_TIMEOUT_SECONDS,
} as const;

// ─── 结构化错误 ───

export type PromptEnhancerErrorKind = 'timeout' | 'workspace' | 'empty' | 'engine';

/**
 * 润色链路的结构化错误。kind 驱动 UI 文案与 fallback 重试决策，
 * 决策点不再匹配错误文案子串。
 */
export class PromptEnhancerError extends Error {
  readonly kind: PromptEnhancerErrorKind;
  readonly retryable: boolean;

  constructor(kind: PromptEnhancerErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = 'PromptEnhancerError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : 'unknown error';
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return 'unknown error';
}

/**
 * 引擎侧错误字符串的唯一归类点。规则变更只动这里（含单测），
 * 调用方一律消费 PromptEnhancerError.kind / retryable。
 */
function isRetryableEngineErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    'claude exited with status',
    'claude stream-json startup timed out',
    'claude stream-json ended without a valid stream event',
    'claude response timed out',
    'rate limit',
    'overloaded',
    'network',
    'authentication',
    'auth',
    'model',
  ].some((needle) => normalized.includes(needle));
}

export function classifyPromptEnhancerError(error: unknown): PromptEnhancerError {
  if (error instanceof PromptEnhancerError) {
    return error;
  }
  const message = resolveErrorMessage(error);
  return new PromptEnhancerError('engine', message, isRetryableEngineErrorMessage(message));
}

// ─── 结果缓存 ───

const ENHANCER_CACHE_MAX_ENTRIES = 20;
const enhancerResultCache = new Map<string, string>();

function enhancerCacheKey(options: {
  workspaceId: string;
  text: string;
  engine: EngineType;
  model: string | null;
  locale: string;
  intensity: PromptEnhancerIntensity;
}): string {
  return [
    options.workspaceId.trim(),
    options.locale,
    options.engine,
    options.model ?? '',
    options.intensity,
    options.text,
  ].join('|');
}

function readEnhancerCache(key: string): string | null {
  const cached = enhancerResultCache.get(key);
  if (cached === undefined) {
    return null;
  }
  // LRU touch：命中后移到末尾。
  enhancerResultCache.delete(key);
  enhancerResultCache.set(key, cached);
  return cached;
}

function writeEnhancerCache(key: string, value: string): void {
  enhancerResultCache.delete(key);
  enhancerResultCache.set(key, value);
  while (enhancerResultCache.size > ENHANCER_CACHE_MAX_ENTRIES) {
    const oldest = enhancerResultCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    enhancerResultCache.delete(oldest);
  }
}

/** 测试专用：清空模块级缓存，避免用例间串扰。 */
export function clearPromptEnhancerCacheForTests(): void {
  enhancerResultCache.clear();
}

// ─── 指令构建 ───

type EnhancerLocale = 'zh' | 'en';

export function resolveEnhancerLocale(language: string | undefined): EnhancerLocale {
  // zh / zh-TW 共用一套中文指令（简体措辞对繁体用户同样可读）。
  return language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function isPromptEnhancerEngine(engine: string): engine is EngineType {
  return (PROMPT_ENHANCER_ENGINE_OPTIONS as readonly string[]).includes(engine);
}

export function resolveVisibleEnhancerEngines(
  disabledCliEngineIds: ReadonlySet<string>,
): EngineType[] {
  return PROMPT_ENHANCER_ENGINE_OPTIONS.filter(
    (engine) => isEngineExecutionEnabled(engine) && !disabledCliEngineIds.has(engine),
  );
}

export function normalizeEnhancerEngine(
  currentProvider: string,
  visibleEngines: readonly EngineType[] = PROMPT_ENHANCER_ENGINE_OPTIONS,
): EngineType {
  if (isPromptEnhancerEngine(currentProvider) && visibleEngines.includes(currentProvider)) {
    return currentProvider;
  }
  return visibleEngines[0] ?? 'claude';
}

function intensityInstruction(intensity: PromptEnhancerIntensity, locale: EnhancerLocale): string[] {
  if (locale === 'zh') {
    switch (intensity) {
      case 'struct':
        return [
          '- 强度：结构化。只在能增加约束时才分节。',
          '- 禁止用「目标 / 背景 / 验收标准」把同一句话再写一遍。',
          '- 小节标题必须带进新信息，否则不要分节。',
        ];
      case 'exec':
        return [
          '- 强度：可执行。补上动作顺序和如何验收。',
          '- 不要发明草稿里没有的文件、接口、错误码或产品事实。',
          '- 不要把草稿整段复制后再加空标题。',
        ];
      case 'light':
      default:
        return [
          '- 强度：轻润色。只整理措辞和指代，保持原长度量级。',
          '- 短草稿不要扩写成多段模板。',
          '- 不要新增草稿未提出的任务。',
        ];
    }
  }
  switch (intensity) {
    case 'struct':
      return [
        '- Intensity: structured. Add sections only when they introduce new constraints.',
        '- Do not restate the same sentence under Goal / Context / Acceptance headings.',
        '- A heading is allowed only if it carries information that is not already in the draft.',
      ];
    case 'exec':
      return [
        '- Intensity: executable. Add action order and how to verify success.',
        '- Do not invent files, APIs, error codes, or product facts missing from the draft.',
        '- Do not copy the draft verbatim and wrap it in empty headings.',
      ];
    case 'light':
    default:
      return [
        '- Intensity: light polish. Improve wording and references; keep a similar length.',
        '- Do not expand a short draft into a multi-section template.',
        '- Do not add tasks the draft did not ask for.',
      ];
  }
}

export function buildPromptEnhancerInstruction(
  originalPrompt: string,
  engine: EngineType,
  locale: EnhancerLocale,
  intensity: PromptEnhancerIntensity = 'light',
): string {
  const sharedRules =
    locale === 'zh'
      ? [
          '你是一名提示词改写助手。',
          '把用户的草稿改写为更清晰、更可执行的 AI 助手提示词。',
          '硬性要求：',
          '- 保留原始意图、语言和明确事实。',
          '- 不要回答请求本身。',
          '- 不要复述草稿，也不要把同一句换行再写一遍。',
          '- 只输出一份改写结果。禁止前后重复、禁止拷贝粘贴两遍。',
          '- 只输出改写后的提示词文本，不要解释、不要 markdown 代码块、不要前言。',
        ]
      : [
          'You are a prompt rewriting assistant.',
          'Rewrite the user draft into a clearer, more actionable prompt for an AI assistant.',
          'Hard requirements:',
          '- Preserve the original intent, language, and explicit facts.',
          '- Do not answer the request itself.',
          '- Do not restate the draft, and do not repeat the same sentence on a new line.',
          '- Output exactly one rewrite. Never duplicate the result back-to-back.',
          '- Output only the rewritten prompt text with no explanation, no markdown fence, and no preamble.',
        ];

  const engineRules =
    engine === 'claude'
      ? locale === 'zh'
        ? ['- 保持简洁、面向执行；不要为了凑结构而变长。']
        : ['- Keep the rewrite concise and execution-oriented; do not pad it for structure.']
      : [];

  const draftLabel = locale === 'zh' ? '用户草稿：' : 'User draft:';
  return [...sharedRules, ...intensityInstruction(intensity, locale), ...engineRules, '', draftLabel, originalPrompt].join('\n');
}

function isPromptEnhancerProviderId(engine: EngineType): engine is ProviderId {
  return isPromptEnhancerEngine(engine);
}

function resolveEnhancerModelOptions(
  modelGroups: ProviderModelGroup[],
  engine: EngineType,
): ModelInfo[] {
  if (!isPromptEnhancerProviderId(engine)) {
    return [];
  }
  return modelGroups.find((group) => group.providerId === engine)?.models ?? [];
}

function findEnhancerModel(
  modelGroups: ProviderModelGroup[],
  engine: EngineType,
  modelId: string,
): ModelInfo | undefined {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) {
    return undefined;
  }
  const modelOptions = resolveEnhancerModelOptions(modelGroups, engine);
  return (
    modelOptions.find((entry) => entry.id === trimmedModelId) ??
    modelOptions.find((entry) => (entry.model ?? '').trim() === trimmedModelId)
  );
}

function resolveDefaultEnhancerModelId(
  modelGroups: ProviderModelGroup[],
  engine: EngineType,
  currentModelId: string,
): string {
  const modelOptions = resolveEnhancerModelOptions(modelGroups, engine);
  if (modelOptions.length === 0) {
    return '';
  }
  const matched = findEnhancerModel(modelGroups, engine, currentModelId);
  if (matched?.id) {
    return matched.id;
  }
  return modelOptions[0]?.id ?? '';
}

/**
 * DSH 只接受 `{provider}/{model}` catalog id。`.model` 是 runtime 短名
 *（例如 `grok-4.6`），发给 DSH 会直接失败。其它引擎仍用 runtime / id。
 */
export function resolveEnhancerModelForSend(
  modelGroups: ProviderModelGroup[],
  engine: EngineType,
  modelId: string,
): string | null {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId || trimmedModelId === engine) {
    return null;
  }
  const matched = findEnhancerModel(modelGroups, engine, trimmedModelId);
  const catalogId = matched?.id?.trim() || trimmedModelId;
  const runtime = matched?.model?.trim() || '';

  if (engine === 'dsh') {
    return resolveDshModelForSend({
      catalogId,
      runtimeModel: runtime || trimmedModelId,
    });
  }

  if ((engine === 'pi' || engine === 'opencode' || engine === 'omp') && catalogId.includes('/')) {
    return catalogId;
  }

  return (runtime || catalogId).trim() || null;
}

function normalizeEnhancerTimeoutSeconds(timeoutSeconds: number): number {
  if (!Number.isFinite(timeoutSeconds)) {
    return PROMPT_ENHANCER_DEFAULT_TIMEOUT_SECONDS;
  }
  return Math.min(
    PROMPT_ENHANCER_MAX_TIMEOUT_SECONDS,
    Math.max(PROMPT_ENHANCER_MIN_TIMEOUT_SECONDS, Math.round(timeoutSeconds)),
  );
}

function compactEnhancerText(value: string): string {
  return value.replace(/\s+/g, '');
}

function collapseExactRepeatedBlocks(value: string): string {
  const compact = compactEnhancerText(value);
  if (compact.length < 12) {
    return value;
  }
  for (const repeatCount of [3, 2]) {
    if (compact.length % repeatCount !== 0) {
      continue;
    }
    const chunkLength = compact.length / repeatCount;
    const chunk = compact.slice(0, chunkLength);
    if (chunk.length >= 6 && chunk.repeat(repeatCount) === compact) {
      const midpoint = Math.floor(value.length / repeatCount);
      const firstHalf = value.slice(0, midpoint).trim();
      if (firstHalf.length >= 6) {
        return firstHalf;
      }
    }
  }
  return value;
}

function collapseConsecutiveDuplicateChunks(value: string, splitter: RegExp, joiner: string): string {
  const chunks = value.split(splitter).map((entry) => entry.trim()).filter(Boolean);
  if (chunks.length < 2) {
    return value;
  }
  const collapsed: string[] = [];
  for (const chunk of chunks) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && compactEnhancerText(previous) === compactEnhancerText(chunk)) {
      continue;
    }
    collapsed.push(chunk);
  }
  return collapsed.join(joiner);
}

function collapseConsecutiveDuplicateParagraphs(value: string): string {
  return collapseConsecutiveDuplicateChunks(value, /\n{2,}/, '\n\n');
}

function collapseConsecutiveDuplicateLines(value: string): string {
  return collapseConsecutiveDuplicateChunks(value, /\n/, '\n');
}

export function normalizeEnhancedPromptResponse(text: unknown): string {
  if (typeof text !== 'string') {
    return '';
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = getNormalizedAssistantMessageText(trimmed).trim();
  if (!normalized) {
    return '';
  }
  return collapseConsecutiveDuplicateLines(
    collapseConsecutiveDuplicateParagraphs(collapseExactRepeatedBlocks(normalized)),
  ).trim();
}

function buildIsolatedSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `prompt-enhancer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function withTimeout<T>(
  request: Promise<T>,
  timeoutMs: number,
  timeoutSeconds: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutRequest = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(
        new PromptEnhancerError(
          'timeout',
          `prompt enhancement timed out after ${timeoutSeconds}s`,
          true,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeoutRequest]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function requestEnhancedPrompt(options: {
  workspaceId: string;
  prompt: string;
  engine: EngineType;
  model: string | null;
  sessionId: string;
  timeoutSeconds: number;
}): Promise<string> {
  const timeoutSeconds = normalizeEnhancerTimeoutSeconds(options.timeoutSeconds);
  const response = await withTimeout(
    engineSendMessageSync(options.workspaceId, {
      text: options.prompt,
      engine: options.engine,
      model: options.model,
      accessMode: 'read-only',
      continueSession: false,
      sessionId: options.sessionId,
      autoSession: PROMPT_ENHANCER_AUTO_SESSION,
    }),
    timeoutSeconds * 1000,
    timeoutSeconds,
  );
  const rewritten = normalizeEnhancedPromptResponse(response.text);
  if (!rewritten) {
    throw new PromptEnhancerError('empty', 'engine returned an empty enhancement', true);
  }
  return rewritten;
}

interface UsePromptEnhancerOptions {
  workspaceId?: string | null;
  editableRef: React.RefObject<HTMLDivElement | null>;
  getTextContent: () => string;
  currentProvider: string;
  selectedModel: string;
  modelGroups: ProviderModelGroup[];
  targetModelGroups?: ProviderModelGroup[];
  setHasContent: (hasContent: boolean) => void;
  handleInput: () => void;
  stageNextCommitOptions?: (options: {
    source: 'programmatic';
    forceNewTransaction?: boolean;
    inputType?: string;
    timestamp?: number;
  }) => void;
}

interface UsePromptEnhancerReturn {
  isEnhancing: boolean;
  enhancingEngine: EngineType;
  selectedEnhancerEngine: EngineType;
  selectedEnhancerModel: string;
  selectedEnhancerIntensity: PromptEnhancerIntensity;
  enhancerModelOptions: ModelInfo[];
  enhancerModelGroups: ProviderModelGroup[];
  visibleEnhancerEngines: EngineType[];
  enhancerTimeoutSeconds: number;
  timeoutLimits: typeof PROMPT_ENHANCER_TIMEOUT_LIMITS;
  showEnhancerDialog: boolean;
  originalPrompt: string;
  enhancedPrompt: string;
  canUseEnhancedPrompt: boolean;
  handleEnhancePrompt: () => void;
  handleEnhancerEngineChange: (engine: EngineType) => void;
  handleEnhancerModelChange: (modelId: string) => void;
  handleEnhancerProviderModelChange: (providerId: ProviderId, modelId: string) => void;
  handleEnhancerIntensityChange: (intensity: PromptEnhancerIntensity) => void;
  handleEnhancerTimeoutChange: (timeoutSeconds: number) => void;
  handleOriginalPromptChange: (prompt: string) => void;
  handleRunPromptEnhancement: () => void;
  handleUseEnhancedPrompt: () => void;
  handleKeepOriginalPrompt: () => void;
  handleCloseEnhancerDialog: () => void;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** 失败展示文案：kind → i18n key；engine kind 附原始诊断。 */
function resolveEnhancerFailureCopy(
  t: TranslateFn,
  primary: PromptEnhancerError,
  timeoutSeconds: number,
  fallback?: PromptEnhancerError,
): string {
  const copyFor = (error: PromptEnhancerError): string => {
    switch (error.kind) {
      case 'timeout':
        return t('promptEnhancer.failedTimeout', {
          seconds: timeoutSeconds,
          defaultValue: 'Prompt enhancement timed out after {{seconds}}s',
        });
      case 'workspace':
        return t('promptEnhancer.failedWorkspace', {
          defaultValue: 'Workspace is not ready for prompt enhancement',
        });
      case 'empty':
        return t('promptEnhancer.failedEmpty', {
          defaultValue: 'The engine returned an empty enhancement',
        });
      case 'engine':
      default:
        return `${t('promptEnhancer.failedGeneric', { defaultValue: 'Prompt enhancement failed' })}: ${error.message}`;
    }
  };
  const primaryCopy = copyFor(primary);
  if (!fallback) {
    return primaryCopy;
  }
  return `${primaryCopy} · ${copyFor(fallback)}`;
}

export function usePromptEnhancer({
  workspaceId,
  editableRef,
  getTextContent,
  currentProvider,
  selectedModel,
  modelGroups,
  targetModelGroups,
  setHasContent,
  handleInput,
  stageNextCommitOptions,
}: UsePromptEnhancerOptions): UsePromptEnhancerReturn {
  const { t, i18n } = useTranslation();
  // t / i18n 引用在未初始化 i18n 的环境（如测试）中可能每次渲染都变；
  // 经 ref 读取，避免 callback 链式失稳。
  const tRef = useRef(t);
  tRef.current = t;
  // 部分测试只 mock t 而不提供 i18n 对象，读取语言时防御缺省。
  const languageRef = useRef(i18n?.language as string | undefined);
  languageRef.current = i18n?.language as string | undefined;
  const disabledCliEngineIds = useCliEngineVisibility();
  const visibleEnhancerEngines = useMemo(
    () => resolveVisibleEnhancerEngines(disabledCliEngineIds),
    [disabledCliEngineIds],
  );
  const enhancerModelGroups = useMemo(() => {
    const byId = new Map<ProviderId, ProviderModelGroup>();
    const mergeGroup = (group: ProviderModelGroup) => {
      const existing = byId.get(group.providerId);
      if (!existing) {
        byId.set(group.providerId, group);
        return;
      }
      const seen = new Set(existing.models.map((model) => model.id));
      const models = [...existing.models];
      for (const model of group.models) {
        if (!seen.has(model.id)) {
          seen.add(model.id);
          models.push(model);
        }
      }
      byId.set(group.providerId, {
        ...existing,
        providerLabel: existing.providerLabel || group.providerLabel,
        models,
        enabled: existing.enabled || group.enabled,
      });
    };
    modelGroups.forEach(mergeGroup);
    (targetModelGroups ?? []).forEach(mergeGroup);
    return visibleEnhancerEngines.map((engine) => {
      const existing = byId.get(engine as ProviderId);
      if (existing) {
        return existing;
      }
      return {
        providerId: engine as ProviderId,
        providerLabel: engine,
        models: [],
        enabled: true,
      };
    });
  }, [modelGroups, targetModelGroups, visibleEnhancerEngines]);

  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancingEngine, setEnhancingEngine] = useState<EngineType>('claude');
  const [selectedEnhancerEngine, setSelectedEnhancerEngine] = useState<EngineType>(
    normalizeEnhancerEngine(currentProvider, visibleEnhancerEngines),
  );
  const [selectedEnhancerModel, setSelectedEnhancerModel] = useState('');
  const [selectedEnhancerIntensity, setSelectedEnhancerIntensity] =
    useState<PromptEnhancerIntensity>('light');
  const [enhancerTimeoutSeconds, setEnhancerTimeoutSeconds] = useState(
    PROMPT_ENHANCER_DEFAULT_TIMEOUT_SECONDS,
  );
  const [showEnhancerDialog, setShowEnhancerDialog] = useState(false);
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [enhancedPrompt, setEnhancedPrompt] = useState('');
  const [canUseEnhancedPrompt, setCanUseEnhancedPrompt] = useState(false);
  const activeRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      activeRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    activeRequestIdRef.current += 1;
    setShowEnhancerDialog(false);
    setIsEnhancing(false);
    setOriginalPrompt('');
    setEnhancedPrompt('');
    setCanUseEnhancedPrompt(false);
  }, [workspaceId]);

  useEffect(() => {
    if (!showEnhancerDialog) {
      return;
    }
    const resolved = resolveDefaultEnhancerModelId(
      enhancerModelGroups,
      selectedEnhancerEngine,
      selectedEnhancerModel || selectedModel,
    );
    if (!resolved || resolved === selectedEnhancerModel) {
      return;
    }
    setSelectedEnhancerModel(resolved);
  }, [
    enhancerModelGroups,
    selectedEnhancerEngine,
    selectedEnhancerModel,
    selectedModel,
    showEnhancerDialog,
  ]);

  const closeEnhancerDialog = useCallback(() => {
    activeRequestIdRef.current += 1;
    setShowEnhancerDialog(false);
    setIsEnhancing(false);
    setCanUseEnhancedPrompt(false);
  }, []);

  const handleEnhancePrompt = useCallback(() => {
    const content = getTextContent().trim();
    if (!content) {
      return;
    }

    activeRequestIdRef.current += 1;
    const defaultEngine = normalizeEnhancerEngine(currentProvider, visibleEnhancerEngines);
    setSelectedEnhancerEngine(defaultEngine);
    setSelectedEnhancerModel(resolveDefaultEnhancerModelId(enhancerModelGroups, defaultEngine, selectedModel));
    setOriginalPrompt(content);
    setEnhancedPrompt('');
    setCanUseEnhancedPrompt(false);
    setShowEnhancerDialog(true);
    setIsEnhancing(false);
  }, [currentProvider, enhancerModelGroups, getTextContent, selectedModel, visibleEnhancerEngines]);

  const handleEnhancerEngineChange = useCallback((engine: EngineType) => {
    if (!visibleEnhancerEngines.includes(engine)) {
      return;
    }
    setSelectedEnhancerEngine(engine);
    setSelectedEnhancerModel(resolveDefaultEnhancerModelId(enhancerModelGroups, engine, ''));
    setCanUseEnhancedPrompt(false);
    setEnhancedPrompt('');
  }, [enhancerModelGroups, visibleEnhancerEngines]);

  const handleEnhancerModelChange = useCallback((modelId: string) => {
    setSelectedEnhancerModel(modelId);
    setCanUseEnhancedPrompt(false);
    setEnhancedPrompt('');
  }, []);

  const handleEnhancerProviderModelChange = useCallback((providerId: ProviderId, modelId: string) => {
    if (!visibleEnhancerEngines.includes(providerId)) {
      return;
    }
    setSelectedEnhancerEngine(providerId);
    setSelectedEnhancerModel(
      findEnhancerModel(enhancerModelGroups, providerId, modelId)?.id ?? modelId,
    );
    setCanUseEnhancedPrompt(false);
    setEnhancedPrompt('');
  }, [enhancerModelGroups, visibleEnhancerEngines]);

  const handleEnhancerIntensityChange = useCallback((intensity: PromptEnhancerIntensity) => {
    setSelectedEnhancerIntensity(intensity);
    setCanUseEnhancedPrompt(false);
    setEnhancedPrompt('');
  }, []);

  const handleOriginalPromptChange = useCallback((prompt: string) => {
    setOriginalPrompt(prompt);
    setCanUseEnhancedPrompt(false);
    setEnhancedPrompt('');
  }, []);

  const handleEnhancerTimeoutChange = useCallback((timeoutSeconds: number) => {
    setEnhancerTimeoutSeconds(normalizeEnhancerTimeoutSeconds(timeoutSeconds));
  }, []);

  const handleRunPromptEnhancement = useCallback(() => {
    const content = originalPrompt.trim();
    if (!content || isEnhancing || visibleEnhancerEngines.length === 0) {
      return;
    }
    if (!visibleEnhancerEngines.includes(selectedEnhancerEngine)) {
      return;
    }

    if (!workspaceId || workspaceId.trim().length === 0) {
      setEnhancedPrompt(
        resolveEnhancerFailureCopy(
          tRef.current,
          new PromptEnhancerError('workspace', 'workspace is not ready', false),
          enhancerTimeoutSeconds,
        ),
      );
      setCanUseEnhancedPrompt(false);
      setIsEnhancing(false);
      return;
    }

    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    const engine = selectedEnhancerEngine;
    const timeoutSeconds = normalizeEnhancerTimeoutSeconds(enhancerTimeoutSeconds);
    const locale = resolveEnhancerLocale(languageRef.current);
    const intensity = selectedEnhancerIntensity;
    const prompt = buildPromptEnhancerInstruction(content, engine, locale, intensity);
    const fallbackPrompt =
      engine === 'claude' && visibleEnhancerEngines.includes('codex')
        ? buildPromptEnhancerInstruction(content, 'codex', locale, intensity)
        : null;
    const requestModel = resolveEnhancerModelForSend(enhancerModelGroups, engine, selectedEnhancerModel);
    if (engine === 'dsh' && requestModel === null) {
      setEnhancedPrompt(
        tRef.current('promptEnhancer.failedDshCatalogId', {
          model: selectedEnhancerModel || 'empty',
          defaultValue:
            'DSH needs a provider/model catalog id. Select a DSH catalog row instead of a bare runtime name like {{model}}.',
        }),
      );
      setCanUseEnhancedPrompt(false);
      setIsEnhancing(false);
      return;
    }
    const cacheKey = enhancerCacheKey({
      workspaceId,
      text: content,
      engine,
      model: requestModel,
      locale,
      intensity,
    });

    setEnhancingEngine(engine);
    setEnhancerTimeoutSeconds(timeoutSeconds);
    setEnhancedPrompt('');
    setCanUseEnhancedPrompt(false);
    setShowEnhancerDialog(true);

    // 缓存命中：秒回，零 IPC。
    const cached = readEnhancerCache(cacheKey);
    if (cached !== null) {
      setEnhancedPrompt(cached);
      setCanUseEnhancedPrompt(true);
      setIsEnhancing(false);
      return;
    }

    setIsEnhancing(true);

    void (async () => {
      try {
        const rewrittenPrompt = await requestEnhancedPrompt({
          workspaceId,
          prompt,
          engine,
          model: requestModel,
          sessionId: buildIsolatedSessionId(),
          timeoutSeconds,
        });
        if (activeRequestIdRef.current !== requestId) {
          return;
        }
        writeEnhancerCache(cacheKey, rewrittenPrompt);
        setEnhancedPrompt(rewrittenPrompt);
        setCanUseEnhancedPrompt(true);
      } catch (error: unknown) {
        if (activeRequestIdRef.current !== requestId) {
          return;
        }
        const classified = classifyPromptEnhancerError(error);
        if (engine === 'claude' && classified.retryable && fallbackPrompt) {
          try {
            setEnhancingEngine('codex');
            const fallbackRewrittenPrompt = await requestEnhancedPrompt({
              workspaceId,
              prompt: fallbackPrompt,
              engine: 'codex',
              model: null,
              sessionId: buildIsolatedSessionId(),
              timeoutSeconds,
            });
            if (activeRequestIdRef.current !== requestId) {
              return;
            }
            writeEnhancerCache(
              enhancerCacheKey({
                workspaceId,
                text: content,
                engine: 'codex',
                model: null,
                locale,
                intensity,
              }),
              fallbackRewrittenPrompt,
            );
            setEnhancedPrompt(fallbackRewrittenPrompt);
            setCanUseEnhancedPrompt(true);
            return;
          } catch (fallbackError: unknown) {
            if (activeRequestIdRef.current !== requestId) {
              return;
            }
            setEnhancedPrompt(
              resolveEnhancerFailureCopy(
                tRef.current,
                classified,
                timeoutSeconds,
                classifyPromptEnhancerError(fallbackError),
              ),
            );
            setCanUseEnhancedPrompt(false);
            return;
          }
        }
        setEnhancedPrompt(
          resolveEnhancerFailureCopy(tRef.current, classified, timeoutSeconds),
        );
        setCanUseEnhancedPrompt(false);
      } finally {
        if (activeRequestIdRef.current === requestId) {
          setIsEnhancing(false);
        }
      }
    })();
  }, [
    enhancerTimeoutSeconds,
    isEnhancing,
    enhancerModelGroups,
    originalPrompt,
    selectedEnhancerEngine,
    selectedEnhancerIntensity,
    selectedEnhancerModel,
    visibleEnhancerEngines,
    workspaceId,
  ]);

  const handleUseEnhancedPrompt = useCallback(() => {
    if (canUseEnhancedPrompt && enhancedPrompt && editableRef.current) {
      editableRef.current.innerText = enhancedPrompt;
      setHasContent(true);
      stageNextCommitOptions?.({
        source: 'programmatic',
        forceNewTransaction: true,
        inputType: 'prompt:enhancer',
      });
      handleInput();
    }
    closeEnhancerDialog();
  }, [
    canUseEnhancedPrompt,
    closeEnhancerDialog,
    editableRef,
    enhancedPrompt,
    handleInput,
    setHasContent,
    stageNextCommitOptions,
  ]);

  return {
    isEnhancing,
    enhancingEngine,
    selectedEnhancerEngine,
    selectedEnhancerModel,
    selectedEnhancerIntensity,
    enhancerModelOptions: resolveEnhancerModelOptions(enhancerModelGroups, selectedEnhancerEngine),
    enhancerModelGroups,
    visibleEnhancerEngines,
    enhancerTimeoutSeconds,
    timeoutLimits: PROMPT_ENHANCER_TIMEOUT_LIMITS,
    showEnhancerDialog,
    originalPrompt,
    enhancedPrompt,
    canUseEnhancedPrompt,
    handleEnhancePrompt,
    handleEnhancerEngineChange,
    handleEnhancerModelChange,
    handleEnhancerProviderModelChange,
    handleEnhancerIntensityChange,
    handleEnhancerTimeoutChange,
    handleOriginalPromptChange,
    handleRunPromptEnhancement,
    handleUseEnhancedPrompt,
    handleKeepOriginalPrompt: closeEnhancerDialog,
    handleCloseEnhancerDialog: closeEnhancerDialog,
  };
}
