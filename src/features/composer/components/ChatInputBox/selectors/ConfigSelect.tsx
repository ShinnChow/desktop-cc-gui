import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { AgentIcon } from '../../../../../components/AgentIcon';
import { SelectorOptionRow } from './SelectorOptionRow';
import { agentProvider, CREATE_NEW_AGENT_ID, EMPTY_STATE_ID, type AgentItem } from '../providers/agentProvider';
import type { CodexSpeedMode, ProviderId, SelectedAgent } from '../types';

interface ConfigSelectProps {
  currentProvider: string;
  onProviderChange?: (providerId: string) => void;
  providerAvailability?: Partial<Record<ProviderId, boolean>>;
  providerVersions?: Partial<Record<ProviderId, string | null>>;
  alwaysThinkingEnabled?: boolean;
  onToggleThinking?: (enabled: boolean) => void;
  streamingEnabled?: boolean;
  onStreamingEnabledChange?: (enabled: boolean) => void;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  codexSpeedMode?: CodexSpeedMode;
  onCodexSpeedModeChange?: (mode: Exclude<CodexSpeedMode, 'unknown'>) => void;
  onCodexReviewQuickStart?: () => void;
  onForkQuickStart?: () => void;
  selectedAgent?: SelectedAgent | null;
  onAgentSelect?: (agent: SelectedAgent) => void;
  onOpenAgentSettings?: () => void;
  /**
   * When true, render config entries as DropdownMenu items/subs (a Fragment
   * flattened into the parent vertical tool menu) instead of a standalone
   * button + popover.
   */
  inline?: boolean;
}

/**
 * ConfigSelect - Combined Configuration Selector
 * Contains CLI Tool Selection and Thinking Switch
 */
export const ConfigSelect = ({
  currentProvider: providerId,
  alwaysThinkingEnabled,
  onToggleThinking,
  streamingEnabled,
  onStreamingEnabledChange,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  codexSpeedMode = 'unknown',
  onCodexSpeedModeChange,
  onCodexReviewQuickStart,
  onForkQuickStart,
  selectedAgent,
  onAgentSelect,
  onOpenAgentSettings,
  inline = false,
}: ConfigSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'none' | 'agent' | 'speed'>('none');
  const [agentItems, setAgentItems] = useState<AgentItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const agentAbortControllerRef = useRef<AbortController | null>(null);

  const isCodexProvider = providerId === 'codex';
  const isClaudeProvider = providerId === 'claude';
  const supportsReviewQuickAction = isCodexProvider || isClaudeProvider;
  const supportsForkQuickAction = isCodexProvider || isClaudeProvider;
  const isPlanModeEnabled = (selectedCollaborationModeId ?? 'code') === 'plan';

  const handlePlanModeToggle = useCallback(
    (enabled: boolean) => {
      if (!onSelectCollaborationMode) {
        return;
      }
      onSelectCollaborationMode(enabled ? 'plan' : 'code');
    },
    [onSelectCollaborationMode],
  );

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
    if (!isOpen) {
      setActiveSubmenu('none');
    }
  }, [isOpen]);

  const loadAgents = useCallback(async () => {
    if (agentAbortControllerRef.current) {
      agentAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    agentAbortControllerRef.current = controller;

    setAgentsLoading(true);
    try {
      const list = await agentProvider('', controller.signal);
      if (controller.signal.aborted) return;
      setAgentItems(
        list.filter((agent) => agent.itemKind !== "sectionHeader"),
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setAgentItems([{
        id: EMPTY_STATE_ID,
        name: t('settings.agent.loadFailed'),
        prompt: '',
      }, {
        id: CREATE_NEW_AGENT_ID,
        name: t('settings.agent.createAgent'),
        prompt: '',
      }]);
    } finally {
      if (!controller.signal.aborted) {
        setAgentsLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveSubmenu('none');
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (activeSubmenu !== 'agent') return;
    loadAgents();
  }, [activeSubmenu, loadAgents]);

  useEffect(() => {
    return () => {
      if (agentAbortControllerRef.current) {
        agentAbortControllerRef.current.abort();
      }
    };
  }, []);

  const renderAgentSubmenu = () => (
    <div
      className="selector-dropdown"
      style={{
        position: 'absolute',
        left: '100%',
        bottom: 0,
        marginLeft: '-30px',
        zIndex: 10001,
        minWidth: '320px',
        maxWidth: '360px',
        maxHeight: '360px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
      onMouseEnter={(e) => {
        e.stopPropagation();
        setActiveSubmenu('agent');
      }}
    >
      {agentsLoading ? (
        <div className="selector-option" style={{ cursor: 'default' }}>
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <span>{t('chat.loadingDropdown')}</span>
        </div>
      ) : (
        agentItems.map((agent) => {
          const isInfo = agent.id === EMPTY_STATE_ID;
          const isCreate = agent.id === CREATE_NEW_AGENT_ID;
          const isSelected = !!selectedAgent && selectedAgent.id === agent.id;

          return (
            <div
              key={agent.id}
              className={`selector-option ${isSelected ? 'selected' : ''} ${isInfo ? 'disabled' : ''}`}
              style={{
                alignItems: 'flex-start',
                cursor: isInfo ? 'default' : 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (isInfo) return;

                if (isCreate) {
                  setIsOpen(false);
                  setActiveSubmenu('none');
                  onOpenAgentSettings?.();
                  return;
                }

                onAgentSelect?.({
                  id: agent.id,
                  name: agent.name,
                  prompt: agent.prompt,
                  icon: agent.icon,
                  source: agent.source,
                  divisionId: agent.divisionId,
                  divisionLabel: agent.divisionLabel,
                  sourceRevision: agent.sourceRevision,
                  promptHash: agent.promptHash,
                });
                setIsOpen(false);
                setActiveSubmenu('none');
              }}
            >
              {isCreate ? (
                <span className="codicon codicon-add" />
              ) : isInfo ? (
                <span className="codicon codicon-info" />
              ) : (
                <AgentIcon
                  icon={agent.icon}
                  seed={agent.id || agent.name}
                  fallback="codicon-robot"
                  className="selector-option-agent-icon"
                  size={16}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</span>
                {agent.prompt ? (
                  <span className="model-description" style={{ fontStyle: 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {agent.prompt.length > 60 ? agent.prompt.substring(0, 60) + '...' : agent.prompt}
                  </span>
                ) : isCreate ? (
                  <span className="model-description" style={{ fontStyle: 'normal' }}>{t('settings.agent.createAgentHint')}</span>
                ) : null}
              </div>
              {isSelected && <span className="codicon codicon-check check-mark" />}
            </div>
          );
        })
      )}
    </div>
  );

  const handleCodexSpeedSelect = useCallback((mode: Exclude<CodexSpeedMode, 'unknown'>) => {
    onCodexSpeedModeChange?.(mode);
    setIsOpen(false);
    setActiveSubmenu('none');
  }, [onCodexSpeedModeChange]);

  const handleCodexReviewQuickStart = useCallback(() => {
    onCodexReviewQuickStart?.();
    setIsOpen(false);
    setActiveSubmenu('none');
  }, [onCodexReviewQuickStart]);

  const handleForkQuickStart = useCallback(() => {
    onForkQuickStart?.();
    setIsOpen(false);
    setActiveSubmenu('none');
  }, [onForkQuickStart]);

  const renderSpeedSubmenu = () => (
    <div
      className="selector-dropdown"
      style={{
        position: 'absolute',
        left: '100%',
        bottom: 0,
        marginLeft: '-30px',
        zIndex: 10001,
        minWidth: '180px',
      }}
      onMouseEnter={(e) => {
        e.stopPropagation();
        setActiveSubmenu('speed');
      }}
    >
      <div
        className="selector-option selector-option-speed-standard"
        onClick={(e) => {
          e.stopPropagation();
          handleCodexSpeedSelect('standard');
        }}
      >
        <span>{t('composer.speedStandard')}</span>
        {codexSpeedMode === 'standard' && <span className="codicon codicon-check check-mark" />}
      </div>
      <div
        className="selector-option selector-option-speed-fast"
        onClick={(e) => {
          e.stopPropagation();
          handleCodexSpeedSelect('fast');
        }}
      >
        <span>{t('composer.speedFast')}</span>
        {codexSpeedMode === 'fast' && <span className="codicon codicon-check check-mark" />}
      </div>
    </div>
  );

  if (inline) {
    return (
      <>
        {/* Agent submenu */}
        <DropdownMenuSub
          onOpenChange={(open) => {
            if (open) {
              void loadAgents();
            }
          }}
        >
          <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
            <AgentIcon
              icon={selectedAgent?.icon}
              seed={selectedAgent?.id || selectedAgent?.name}
              fallback="codicon-robot"
              className="composer-tool-menu-item-icon"
              size={16}
            />
            <span className="composer-tool-menu-item-body">
              <span className="composer-tool-menu-item-label">{t('settings.agent.title')}</span>
              {selectedAgent?.name ? (
                <span className="composer-tool-menu-item-value">{selectedAgent.name}</span>
              ) : null}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="composer-tool-menu-sub-content">
            {agentsLoading ? (
              <div className="composer-tool-menu-option is-disabled">
                <span className="codicon codicon-loading codicon-modifier-spin composer-tool-menu-option-icon" aria-hidden="true" />
                <span className="composer-tool-menu-option-body">
                  <span className="composer-tool-menu-option-label">{t('chat.loadingDropdown')}</span>
                </span>
              </div>
            ) : (
              agentItems.map((agent) => {
                const isInfo = agent.id === EMPTY_STATE_ID;
                const isCreate = agent.id === CREATE_NEW_AGENT_ID;
                const isSelected = !!selectedAgent && selectedAgent.id === agent.id;
                const description = agent.prompt
                  ? agent.prompt.length > 60
                    ? `${agent.prompt.substring(0, 60)}...`
                    : agent.prompt
                  : isCreate
                    ? t('settings.agent.createAgentHint')
                    : null;
                return (
                  <SelectorOptionRow
                    key={agent.id}
                    variant="tool-menu"
                    host="menu-item"
                    selected={isSelected}
                    disabled={isInfo}
                    icon={
                      isCreate ? (
                        <span className="codicon codicon-add composer-tool-menu-option-icon" aria-hidden="true" />
                      ) : isInfo ? (
                        <span className="codicon codicon-info composer-tool-menu-option-icon" aria-hidden="true" />
                      ) : (
                        <AgentIcon
                          icon={agent.icon}
                          seed={agent.id || agent.name}
                          fallback="codicon-robot"
                          className="composer-tool-menu-option-icon"
                          size={16}
                        />
                      )
                    }
                    label={agent.name}
                    description={description}
                    onSelect={() => {
                      if (isCreate) {
                        onOpenAgentSettings?.();
                        return;
                      }
                    onAgentSelect?.({
                      id: agent.id,
                      name: agent.name,
                      prompt: agent.prompt,
                      icon: agent.icon,
                      source: agent.source,
                      divisionId: agent.divisionId,
                      divisionLabel: agent.divisionLabel,
                      sourceRevision: agent.sourceRevision,
                      promptHash: agent.promptHash,
                    });
                    }}
                  />
                );
              })
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {!isCodexProvider && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="composer-tool-menu-toggle"
              onSelect={(event) => {
                event.preventDefault();
                onStreamingEnabledChange?.(!streamingEnabled);
              }}
            >
              <span className="codicon codicon-sync composer-tool-menu-item-icon" aria-hidden="true" />
              <span className="composer-tool-menu-toggle-label">{t('settings.basic.streaming.label')}</span>
              <Switch
                className="composer-tool-menu-toggle-switch"
                checked={streamingEnabled ?? true}
                onCheckedChange={(checked) => onStreamingEnabledChange?.(checked)}
                onClick={(event) => event.stopPropagation()}
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="composer-tool-menu-toggle"
              onSelect={(event) => {
                event.preventDefault();
                onToggleThinking?.(!alwaysThinkingEnabled);
              }}
            >
              <span className="codicon codicon-lightbulb composer-tool-menu-item-icon" aria-hidden="true" />
              <span className="composer-tool-menu-toggle-label">{t('common.thinking')}</span>
              <Switch
                className="composer-tool-menu-toggle-switch"
                checked={alwaysThinkingEnabled ?? false}
                onCheckedChange={(checked) => onToggleThinking?.(checked)}
                onClick={(event) => event.stopPropagation()}
              />
            </DropdownMenuItem>
          </>
        )}

        {isCodexProvider && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="composer-tool-menu-toggle"
              onSelect={(event) => {
                event.preventDefault();
                handlePlanModeToggle(!isPlanModeEnabled);
              }}
            >
              <span className="codicon codicon-git-branch composer-tool-menu-item-icon" aria-hidden="true" />
              <span className="composer-tool-menu-toggle-label">{t('composer.planModeToggle')}</span>
              <Switch
                className="composer-tool-menu-toggle-switch"
                checked={isPlanModeEnabled}
                disabled={!onSelectCollaborationMode}
                onCheckedChange={(checked) => handlePlanModeToggle(checked)}
                onClick={(event) => event.stopPropagation()}
              />
            </DropdownMenuItem>
          </>
        )}

        {isCodexProvider && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
                <span className="codicon codicon-zap composer-tool-menu-item-icon" aria-hidden="true" />
                <span className="composer-tool-menu-item-body">
                  <span className="composer-tool-menu-item-label">{t('composer.speed')}</span>
                  <span className="composer-tool-menu-item-value">
                    {codexSpeedMode === 'fast'
                      ? t('composer.speedFast')
                      : t('composer.speedStandard')}
                  </span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="composer-tool-menu-sub-content">
                <SelectorOptionRow
                  variant="tool-menu"
                  host="menu-item"
                  label={t('composer.speedStandard')}
                  selected={codexSpeedMode === 'standard'}
                  onSelect={() => handleCodexSpeedSelect('standard')}
                />
                <SelectorOptionRow
                  variant="tool-menu"
                  host="menu-item"
                  label={t('composer.speedFast')}
                  selected={codexSpeedMode === 'fast'}
                  onSelect={() => handleCodexSpeedSelect('fast')}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {supportsReviewQuickAction && (
          <>
            <DropdownMenuSeparator />
            {supportsForkQuickAction && (
              <DropdownMenuItem
                className="composer-tool-menu-action"
                onSelect={() => handleForkQuickStart()}
              >
                <span className="codicon codicon-git-branch-create composer-tool-menu-item-icon" aria-hidden="true" />
                <span className="composer-tool-menu-action-label">{t('composer.forkQuickAction')}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="composer-tool-menu-action"
              onSelect={() => handleCodexReviewQuickStart()}
            >
              <span className="codicon codicon-search composer-tool-menu-item-icon" aria-hidden="true" />
              <span className="composer-tool-menu-action-label">{t('composer.reviewQuickAction')}</span>
            </DropdownMenuItem>
          </>
        )}
      </>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        className="selector-button config-button"
        onClick={handleToggle}
        title={t('settings.configure', 'Configure')}
      >
        <span className="codicon codicon-settings" />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '4px',
            zIndex: 10000,
            minWidth: '200px'
          }}
        >
          {/* Agent Item (Disabled) */}
          <div
            className="selector-option"
            onMouseEnter={() => setActiveSubmenu('agent')}
            onMouseLeave={() => setActiveSubmenu('none')}
            style={{ position: 'relative' }}
          >
            <AgentIcon
              icon={selectedAgent?.icon}
              seed={selectedAgent?.id || selectedAgent?.name}
              fallback="codicon-robot"
              className="selector-option-agent-icon"
              size={16}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span>{t('settings.agent.title')}</span>
              {selectedAgent?.name ? (
                <span className="model-description" style={{ fontStyle: 'normal' }}>
                  {selectedAgent.name}
                </span>
              ) : null}
            </div>
            <div 
              style={{ 
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                alignSelf: 'stretch',
                paddingLeft: '12px',
                cursor: 'pointer'
              }}
            >
              <span className="codicon codicon-chevron-right" style={{ fontSize: '12px' }} />
            </div>

            {activeSubmenu === 'agent' && renderAgentSubmenu()}
          </div>

          {!isCodexProvider && (
            <>
              {/* Divider */}
              <div style={{ height: 1, background: 'var(--dropdown-border)', margin: '4px 0', opacity: 0.5 }} />

              {/* Streaming Switch Item */}
              <div
                className="selector-option selector-option-streaming-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onStreamingEnabledChange?.(!streamingEnabled);
                }}
                onMouseEnter={() => setActiveSubmenu('none')}
                style={{ justifyContent: 'space-between', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="codicon codicon-sync" />
                  <span>{t('settings.basic.streaming.label')}</span>
                </div>
                <Switch
                  checked={streamingEnabled ?? true}
                  onCheckedChange={(checked) => onStreamingEnabledChange?.(checked)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: 'var(--dropdown-border)', margin: '4px 0', opacity: 0.5 }} />

              {/* Thinking Switch Item */}
              <div
                className="selector-option selector-option-thinking-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleThinking?.(!alwaysThinkingEnabled);
                }}
                onMouseEnter={() => setActiveSubmenu('none')}
                style={{ justifyContent: 'space-between', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="codicon codicon-lightbulb" />
                  <span>{t('common.thinking')}</span>
                </div>
                <Switch
                  checked={alwaysThinkingEnabled ?? false}
                  onCheckedChange={(checked) => onToggleThinking?.(checked)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </>
          )}

          {isCodexProvider && (
            <>
              <div style={{ height: 1, background: 'var(--dropdown-border)', margin: '4px 0', opacity: 0.5 }} />
              <div
                className="selector-option selector-option-plan-mode"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlanModeToggle(!isPlanModeEnabled);
                }}
                onMouseEnter={() => setActiveSubmenu('none')}
                style={{ justifyContent: 'space-between', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="codicon codicon-git-branch" />
                  <span>{t('composer.planModeToggle')}</span>
                </div>
                <Switch
                  checked={isPlanModeEnabled}
                  disabled={!onSelectCollaborationMode}
                  onCheckedChange={(checked) => handlePlanModeToggle(checked)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </>
          )}

          {isCodexProvider && (
            <>
              <div style={{ height: 1, background: 'var(--dropdown-border)', margin: '4px 0', opacity: 0.5 }} />
              <div
                className="selector-option selector-option-speed"
                onMouseEnter={() => setActiveSubmenu('speed')}
                onMouseLeave={() => setActiveSubmenu('none')}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveSubmenu('speed');
                }}
                style={{ position: 'relative' }}
              >
                <span className="codicon codicon-zap" />
                <span>{t('composer.speed')}</span>
                <div
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    alignSelf: 'stretch',
                    paddingLeft: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <span className="codicon codicon-chevron-right" style={{ fontSize: '12px' }} />
                </div>
                {activeSubmenu === 'speed' && renderSpeedSubmenu()}
              </div>
            </>
          )}

          {supportsReviewQuickAction && (
            <>
              <div style={{ height: 1, background: 'var(--dropdown-border)', margin: '4px 0', opacity: 0.5 }} />
              {supportsForkQuickAction && (
                <div
                  className="selector-option selector-option-fork-quick"
                  onMouseEnter={() => setActiveSubmenu('none')}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleForkQuickStart();
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="codicon codicon-git-branch-create" />
                  <span>{t('composer.forkQuickAction')}</span>
                </div>
              )}
              <div
                className="selector-option selector-option-review-quick"
                onMouseEnter={() => setActiveSubmenu('none')}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCodexReviewQuickStart();
                }}
                style={{ cursor: 'pointer' }}
              >
                <span className="codicon codicon-search" />
                <span>{t('composer.reviewQuickAction')}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
