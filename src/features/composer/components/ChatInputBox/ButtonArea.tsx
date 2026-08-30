import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import DatabaseZap from 'lucide-react/dist/esm/icons/database-zap';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up';
import Square from 'lucide-react/dist/esm/icons/square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import WandSparkles from 'lucide-react/dist/esm/icons/wand-sparkles';
import type {
  AccountRateLimitsInfo,
  ButtonAreaProps,
  MemoryReferenceMode,
  PermissionMode,
  ReasoningEffort,
} from './types';
import { ConfigSelect, DshAgentPresetSelect, ModeSelect, ReasoningSelect } from './selectors';
import { displayDshAgentPreset, type DshAgentPresetId } from './selectors/dshAgentPresets';
import { SessionControlQuotaPane } from './selectors/SessionControlQuotaPane';
import { useCodingPlanQuota } from '../../../status-panel/hooks/useCodingPlanQuota';
import { resolveCodingPlanQuotaVendorId } from '../../../status-panel/utils/codingPlanQuotaVendor';
import { buildSessionOverviewQuota } from '../../../status-panel/utils/sessionOverviewViewModel';
import type { EngineType } from '../../../../types';
import type { RateLimitSnapshot, RateLimitWindow } from '../../../../types/planning';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SelectorOptionRow } from './selectors/SelectorOptionRow';

// Stable no-op callbacks to avoid re-renders when optional handlers are not provided
const NOOP_MODE = (_mode: PermissionMode) => {};
const NOOP_REASONING = (_effort: ReasoningEffort | null) => {};

// Memory reference modes offered inside the vertical tool menu submenu.
// 文案与幕布 MemoryPickGate 策略轨对齐（memoryPick.mode.pick / always）
const MEMORY_REFERENCE_OPTIONS: ReadonlyArray<{
  mode: MemoryReferenceMode;
  labelKey: string;
  fallback: string;
}> = [
  {
    mode: "off",
    labelKey: "composer.memoryReferenceDisable",
    fallback: "整轮关闭记忆注入",
  },
  {
    mode: "pick",
    labelKey: "composer.memoryReferenceEnablePick",
    fallback: "本轮挑选记忆注入",
  },
  {
    mode: "always",
    labelKey: "composer.memoryReferenceEnableAlways",
    fallback: "整轮开启自动top(n)记忆注入",
  },
];

const ENGINE_TYPES: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'gemini',
  'grok',
  'kimi',
  'opencode',
  'dsh',
  'pi',
  'qoder',
]);

function asEngineType(provider: string | undefined): EngineType | null {
  if (!provider || !ENGINE_TYPES.has(provider)) {
    return null;
  }
  return provider as EngineType;
}

/** AccountRateLimitsInfo → RateLimitSnapshot for overview quota merge. */
function accountLimitsToRateLimitSnapshot(
  limits: AccountRateLimitsInfo | null | undefined,
): RateLimitSnapshot | null {
  if (!limits) {
    return null;
  }
  const mapWindow = (
    window: AccountRateLimitsInfo['primary'],
  ): RateLimitWindow | null => {
    if (!window || typeof window.usedPercent !== 'number') {
      return null;
    }
    return {
      usedPercent: window.usedPercent,
      windowDurationMins: window.windowDurationMins ?? null,
      resetsAt: window.resetsAt ?? null,
    };
  };
  return {
    primary: mapWindow(limits.primary),
    secondary: mapWindow(limits.secondary),
    credits: null,
    planType: null,
  };
}

function ToolGridIcon() {
  return <Plus size={18} className="selector-tool-icon" aria-hidden="true" />;
}

/**
 * ButtonArea - Bottom toolbar component
 * Contains the compact tool dock, permission/reasoning controls, and send/stop actions.
 */
export const ButtonArea = ({
  disabled = false,
  hasInputContent = false,
  isLoading = false,
  isEnhancing = false,
  streamActivityPhase = 'idle',
  permissionMode = 'bypassPermissions',
  dshAgentPreset = null,
  dshAgentPresetLocked = false,
  onDshAgentPresetSelect,
  selectedModel = '',
  currentProvider = 'claude',
  currentProviderProfileId = null,
  providerAvailability,
  providerVersions,
  reasoningEffort = null,
  reasoningOptions,
  accountRateLimits,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  codexSpeedMode,
  onCodexSpeedModeChange,
  onCodexReviewQuickStart,
  onForkQuickStart,
  memoryReferenceMode = 'off',
  memoryReferenceDismissed = false,
  onSetMemoryReferenceMode,
  onRestoreMemoryReference,
  onSubmit,
  onStop,
  onModeSelect,
  onProviderSelect,
  onReasoningChange,
  onEnhancePrompt,
  alwaysThinkingEnabled = false,
  onToggleThinking,
  streamingEnabled = true,
  onStreamingEnabledChange,
  sendShortcut = 'enter',
  interruptShortcutLabel,
  selectedAgent,
  onAgentSelect,
  onOpenAgentSettings,
  readinessSurface,
  toolSurface,
  panelToggleSurface,
  curatedSkillSurface,
  squadSurface,
}: ButtonAreaProps) => {
  const { t } = useTranslation();
  const supportsStreamActivityPhaseFx =
    currentProvider === 'codex' ||
    currentProvider === 'claude' ||
    currentProvider === 'gemini';
  const resolvedStopButtonPhase =
    supportsStreamActivityPhaseFx ? streamActivityPhase : 'idle';

  const [isToolDockOpen, setIsToolDockOpen] = useState(false);
  const toolDockId = useId();
  const buttonAreaRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Session Control HUD anchors to the chat-input-box top edge: full dialog
  // width, left edge aligned. Radix anchors to the "+" trigger, so we measure
  // the box width and the trigger's offset → width + negative alignOffset.
  const [menuMetrics, setMenuMetrics] = useState<{
    width: number;
    alignOffset: number;
    sideOffset: number;
  } | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const usageLoadingRef = useRef(false);

  useLayoutEffect(() => {
    if (!isToolDockOpen) {
      return;
    }
    const buttonArea = buttonAreaRef.current;
    const trigger = triggerRef.current;
    if (!buttonArea || !trigger || typeof window === 'undefined') {
      return;
    }
    // Gap between the menu's bottom edge and the input box's top edge.
    const MENU_GAP = 8;
    const inputBox = buttonArea.closest('.chat-input-box') as HTMLElement | null;
    const measure = () => {
      // Prefer full composer shell width so HUD fills the dialog above input.
      const shell = inputBox ?? buttonArea;
      const boxRect = shell.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const width = Math.round(boxRect.width);
      if (width <= 0) {
        return;
      }
      const alignOffset = -Math.round(triggerRect.left - boxRect.left);
      // Lift the menu fully above the input box (not just the "+" trigger), so
      // it never overlaps the text area. sideOffset is measured from the
      // trigger's top edge up to the box's top edge, plus a small gap.
      const anchorTop = inputBox
        ? inputBox.getBoundingClientRect().top
        : boxRect.top;
      const sideOffset = Math.max(8, Math.round(triggerRect.top - anchorTop) + MENU_GAP);
      setMenuMetrics((prev) =>
        prev &&
        prev.width === width &&
        prev.alignOffset === alignOffset &&
        prev.sideOffset === sideOffset
          ? prev
          : { width, alignOffset, sideOffset },
      );
    };
    measure();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(buttonArea);
    if (inputBox) {
      resizeObserver?.observe(inputBox);
    }
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isToolDockOpen]);

  const engineType = asEngineType(currentProvider);
  const quotaVendorId = resolveCodingPlanQuotaVendorId({
    engine: engineType,
    providerProfileId: currentProviderProfileId,
    selectedModel,
  });

  // 复用 Status Panel 概览同源 hook：DeepSeek / MiniMax / Kimi / 智谱等 coding plan + 官方 CLI 路由。
  const {
    snapshot: codingPlanSnapshot,
    loading: codingPlanLoading,
    refresh: refreshCodingPlanQuota,
  } = useCodingPlanQuota({
    engine: engineType,
    providerProfileId: quotaVendorId,
    enabled: isToolDockOpen && engineType != null,
  });

  const sessionQuotaView = useMemo(
    () =>
      buildSessionOverviewQuota(
        engineType,
        accountLimitsToRateLimitSnapshot(accountRateLimits),
        usageShowRemaining,
        codingPlanSnapshot
          ? {
              source: codingPlanSnapshot.source,
              success: codingPlanSnapshot.success,
              error: codingPlanSnapshot.error,
              planLabel: codingPlanSnapshot.planLabel,
              windows: codingPlanSnapshot.windows,
              balance: codingPlanSnapshot.balance ?? null,
              usageSummary: codingPlanSnapshot.usageSummary ?? null,
              siteOrigin: codingPlanSnapshot.siteOrigin ?? null,
            }
          : null,
        codingPlanLoading,
      ),
    [
      accountRateLimits,
      codingPlanLoading,
      codingPlanSnapshot,
      engineType,
      usageShowRemaining,
    ],
  );

  const refreshUsageSnapshot = useCallback(async () => {
    if (usageLoadingRef.current) {
      return;
    }
    usageLoadingRef.current = true;
    setUsageLoading(true);
    try {
      await Promise.all([
        refreshCodingPlanQuota(),
        onRefreshAccountRateLimits
          ? Promise.resolve(onRefreshAccountRateLimits())
          : Promise.resolve(),
      ]);
    } catch {
      // Keep HUD usable if refresh fails.
    } finally {
      usageLoadingRef.current = false;
      setUsageLoading(false);
    }
  }, [onRefreshAccountRateLimits, refreshCodingPlanQuota]);

  // Open HUD → also refresh official Codex account rate limits (coding plan hook self-refreshes on enable).
  useEffect(() => {
    if (!isToolDockOpen) {
      return;
    }
    if (onRefreshAccountRateLimits) {
      void Promise.resolve(onRefreshAccountRateLimits());
    }
  }, [isToolDockOpen, onRefreshAccountRateLimits]);

  const memoryReferenceStateLabel = memoryReferenceDismissed
    ? t("composer.memoryReferenceDismissed", {
        defaultValue: "本会话已关闭参考",
      })
    : memoryReferenceMode === "always"
      ? t("composer.memoryReferenceAlwaysOn")
      : memoryReferenceMode === "pick" || memoryReferenceMode === "single"
        ? t("composer.memoryReferencePickOn", {
            defaultValue: "本轮挑选记忆注入",
          })
        : t("composer.memoryReferenceToggle");

  /**
   * Handle submit button click
   */
  const handleSubmitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSubmit?.();
  }, [onSubmit]);

  /**
   * Handle stop button click
   */
  const handleStopClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStop?.();
  }, [onStop]);

  const handleEnhancePromptClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsToolDockOpen(false);
    onEnhancePrompt?.();
  }, [onEnhancePrompt]);

  /**
   * Handle provider selection
   */
  const handleProviderSelect = useCallback((providerId: string) => {
    onProviderSelect?.(providerId);
  }, [onProviderSelect]);

  const toolDockToggleLabel = t('chat.toolDockToggle', {
    defaultValue: isToolDockOpen ? '收起工具' : '展开工具',
  });

  return (
    <div
      ref={buttonAreaRef}
      className={`button-area${isToolDockOpen ? ' is-tool-dock-open' : ''}`}
      data-provider={currentProvider}
    >
      <div className="button-area-primary-row">
        <div className="button-area-left button-area-left--primary">
          <DropdownMenu open={isToolDockOpen} onOpenChange={setIsToolDockOpen}>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                className="selector-button selector-tool-dock-toggle"
                title={toolDockToggleLabel}
                aria-label={toolDockToggleLabel}
                aria-controls={toolDockId}
              >
                <ToolGridIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              id={toolDockId}
              side="top"
              align="start"
              sideOffset={menuMetrics?.sideOffset ?? 12}
              alignOffset={menuMetrics?.alignOffset ?? 0}
              avoidCollisions={false}
              className="composer-tool-menu composer-session-control-hud overflow-visible overflow-x-visible overflow-y-visible"
              data-testid="composer-session-control-hud"
              aria-label={toolDockToggleLabel}
              style={
                menuMetrics
                  ? {
                      width: menuMetrics.width,
                      // CSS var for nested layout / tests
                      ['--composer-session-hud-width' as string]: `${menuMetrics.width}px`,
                    }
                  : undefined
              }
            >
              {(toolSurface || onEnhancePrompt || panelToggleSurface || curatedSkillSurface) ? (
                <div className="composer-session-hud-footer">
                  <div className="composer-tool-menu-surface-row">
                    {toolSurface ? (
                      <div className="button-area-tool-surface">
                        {toolSurface}
                      </div>
                    ) : null}
                    {onEnhancePrompt ? (
                      <button
                        type="button"
                        className="context-tool-btn context-prompt-enhancer-btn has-tooltip"
                        onClick={handleEnhancePromptClick}
                        disabled={isEnhancing}
                        data-tooltip={t('chat.shortcutActionEnhance')}
                        aria-label={t('chat.shortcutActionEnhance')}
                      >
                        <WandSparkles size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                    {curatedSkillSurface ? (
                      <div className="button-area-curated-surface">
                        {curatedSkillSurface}
                      </div>
                    ) : null}
                    {panelToggleSurface}
                    {selectedAgent?.name ? (
                      <span className="composer-session-hud-agent-pill" title={selectedAgent.name}>
                        {selectedAgent.name}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : selectedAgent?.name ? (
                <div className="composer-session-hud-footer">
                  <div className="composer-tool-menu-surface-row">
                    <span className="composer-session-hud-agent-pill" title={selectedAgent.name}>
                      {selectedAgent.name}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="composer-session-hud-main">
                <div className="composer-session-hud-left">
                  <ConfigSelect
                    inline
                    currentProvider={currentProvider}
                    onProviderChange={
                      onProviderSelect ? handleProviderSelect : undefined
                    }
                    providerAvailability={providerAvailability}
                    providerVersions={providerVersions}
                    alwaysThinkingEnabled={alwaysThinkingEnabled}
                    onToggleThinking={onToggleThinking}
                    streamingEnabled={streamingEnabled}
                    onStreamingEnabledChange={onStreamingEnabledChange}
                    selectedCollaborationModeId={selectedCollaborationModeId}
                    onSelectCollaborationMode={onSelectCollaborationMode}
                    codexSpeedMode={codexSpeedMode}
                    onCodexSpeedModeChange={onCodexSpeedModeChange}
                    onCodexReviewQuickStart={onCodexReviewQuickStart}
                    onForkQuickStart={onForkQuickStart}
                    selectedAgent={selectedAgent}
                    onAgentSelect={onAgentSelect}
                    onOpenAgentSettings={onOpenAgentSettings}
                  />
                  {onSetMemoryReferenceMode ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
                          <span className="composer-tool-menu-item-icon" aria-hidden>
                            <DatabaseZap size={16} />
                          </span>
                          <span className="composer-tool-menu-item-body">
                            <span className="composer-tool-menu-item-label">
                              {t('composer.memoryReferenceToggle')}
                            </span>
                            <span className="composer-tool-menu-item-value">
                              {memoryReferenceStateLabel}
                            </span>
                          </span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="composer-tool-menu-sub-content">
                          {memoryReferenceDismissed && onRestoreMemoryReference ? (
                            <SelectorOptionRow
                              variant="tool-menu"
                              host="menu-item"
                              label={t("composer.memoryReferenceRestore", {
                                defaultValue: "恢复记忆参考",
                              })}
                              onSelect={() => onRestoreMemoryReference()}
                            />
                          ) : null}
                          {MEMORY_REFERENCE_OPTIONS.map((option) => (
                            <SelectorOptionRow
                              key={option.mode}
                              variant="tool-menu"
                              host="menu-item"
                              label={t(option.labelKey, { defaultValue: option.fallback })}
                              selected={
                                !memoryReferenceDismissed &&
                                memoryReferenceMode === option.mode
                              }
                              onSelect={() => onSetMemoryReferenceMode?.(option.mode)}
                            />
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </>
                  ) : null}
                </div>
                <SessionControlQuotaPane
                  quota={sessionQuotaView}
                  usageLoading={usageLoading || codingPlanLoading}
                  onRefresh={() => {
                    void refreshUsageSnapshot();
                  }}
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {readinessSurface ? (
          <div className="button-area-readiness-surface">
            {readinessSurface}
          </div>
        ) : null}

        <div className="button-area-inline-controls">
          {currentProvider !== 'pi' ? (
            <ModeSelect
              value={permissionMode}
              onChange={onModeSelect ?? NOOP_MODE}
              provider={currentProvider}
              selectedCollaborationModeId={selectedCollaborationModeId}
              onSelectCollaborationMode={onSelectCollaborationMode}
            />
          ) : null}
          {currentProvider === 'dsh' &&
          (onDshAgentPresetSelect || dshAgentPresetLocked) ? (
            <DshAgentPresetSelect
              value={displayDshAgentPreset(dshAgentPreset)}
              locked={dshAgentPresetLocked}
              onChange={(preset: DshAgentPresetId) => onDshAgentPresetSelect?.(preset)}
            />
          ) : null}
          {(currentProvider === 'codex' ||
            currentProvider === 'claude' ||
            currentProvider === 'grok' ||
            // dsh / qoder / pi：仅当选中模型在 catalog 声明了 reasoning efforts
            // 时才显示思考强度；切到无档位模型时隐藏。
            (currentProvider === 'dsh' && (reasoningOptions?.length ?? 0) > 0) ||
            (currentProvider === 'qoder' && (reasoningOptions?.length ?? 0) > 0) ||
            (currentProvider === 'pi' && (reasoningOptions?.length ?? 0) > 0)) && (
            <ReasoningSelect
              value={reasoningEffort}
              onChange={onReasoningChange ?? NOOP_REASONING}
              options={reasoningOptions}
              showDefaultOption={
                currentProvider === 'claude' ||
                currentProvider === 'grok' ||
                currentProvider === 'dsh' ||
                currentProvider === 'qoder' ||
                currentProvider === 'pi'
              }
              defaultLabel={
                currentProvider === 'claude'
                  ? t('reasoning.claudeDefault', { defaultValue: 'Default' })
                  : currentProvider === 'grok'
                    ? t('reasoning.grokDefault', { defaultValue: 'Default' })
                    : currentProvider === 'dsh' ||
                        currentProvider === 'qoder' ||
                        currentProvider === 'pi'
                      ? t('reasoning.default', { defaultValue: 'Default' })
                      : undefined
              }
            />
          )}
        </div>

        <div className="button-area-right">
          {squadSurface}
          {isLoading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`submit-button stop-button is-${resolvedStopButtonPhase}`}
              onClick={handleStopClick}
              title={
                interruptShortcutLabel
                  ? `${t('chat.stopGeneration')} (${interruptShortcutLabel})`
                  : t('chat.stopGeneration')
              }
              data-stream-phase={resolvedStopButtonPhase}
            >
              <Square aria-hidden fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="submit-button"
              onClick={handleSubmitClick}
              disabled={disabled || !hasInputContent}
              title={
                sendShortcut === 'cmdEnter'
                  ? t('chat.sendMessageCmdEnter')
                  : t('chat.sendMessageEnter')
              }
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
      </div>

    </div>
  );
};
