import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REASONING_LEVELS, type ReasoningEffort } from '../types';
import { SelectorOptionRow } from './SelectorOptionRow';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';

interface ReasoningSelectProps {
  value: ReasoningEffort | null;
  onChange: (effort: ReasoningEffort | null) => void;
  options?: ReasoningEffort[];
  showDefaultOption?: boolean;
  defaultLabel?: string;
  disabled?: boolean;
  /**
   * When true, render as a DropdownMenuSub for the vertical tool menu
   * instead of a standalone button + popover.
   */
  inline?: boolean;
}

/**
 * ReasoningSelect - runtime reasoning effort selector.
 * Controls the depth of reasoning for engines that expose an effort option.
 */
export const ReasoningSelect = memo(({
  value,
  onChange,
  options,
  showDefaultOption = false,
  defaultLabel,
  disabled,
  inline = false,
}: ReasoningSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const visibleLevels = REASONING_LEVELS.filter((level) => {
    if (options === undefined) {
      // PI-only `minimal` must not leak into unspecified menus.
      return level.id !== 'minimal';
    }
    return options.includes(level.id);
  });
  const fallbackLevel = visibleLevels[0] ?? REASONING_LEVELS[0] ?? {
    id: 'medium' as ReasoningEffort,
    label: 'Medium',
    icon: 'codicon-circle-filled',
    description: 'Balanced thinking',
  };

  const currentLevel = value
    ? REASONING_LEVELS.find(l => l.id === value) ?? fallbackLevel
    : null;
  const resolvedDefaultLabel =
    defaultLabel ?? t('reasoning.default', { defaultValue: 'Default' });

  /**
   * Get translated text for reasoning level
   */
  const getReasoningText = (levelId: ReasoningEffort, field: 'label' | 'description') => {
    const key = `reasoning.${levelId}.${field}`;
    const fallback = REASONING_LEVELS.find(l => l.id === levelId)?.[field] || levelId;
    return t(key, { defaultValue: fallback });
  };
  const triggerLabel = currentLevel ? getReasoningText(currentLevel.id, 'label') : resolvedDefaultLabel;
  const triggerIcon = currentLevel?.icon ?? 'codicon-lightbulb';

  /**
   * Select reasoning level
   */
  const handleSelect = useCallback((effort: ReasoningEffort | null) => {
    onChange(effort);
    setIsOpen(false);
  }, [onChange]);

  if (inline) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
          <span className={`codicon ${triggerIcon} composer-tool-menu-item-icon`} aria-hidden="true" />
          <span className="composer-tool-menu-item-body">
            <span className="composer-tool-menu-item-label">
              {t('reasoning.title', { defaultValue: '推理深度' })}
            </span>
            <span className="composer-tool-menu-item-value">{triggerLabel}</span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="composer-tool-menu-sub-content">
          {showDefaultOption && (
            <SelectorOptionRow
              variant="tool-menu"
              icon={
                <span
                  className="codicon codicon-circle-outline composer-tool-menu-option-icon"
                  aria-hidden="true"
                />
              }
              label={resolvedDefaultLabel}
              description={t('reasoning.defaultDescription', {
                defaultValue: 'Use the engine default reasoning behavior',
              })}
              selected={value === null}
              title={t('reasoning.defaultDescription', {
                defaultValue: 'Use the engine default reasoning behavior',
              })}
              onSelect={() => handleSelect(null)}
            />
          )}
          {visibleLevels.map((level) => (
            <SelectorOptionRow
              key={level.id}
              variant="tool-menu"
              icon={
                <span
                  className={`codicon ${level.icon} composer-tool-menu-option-icon`}
                  aria-hidden="true"
                />
              }
              label={getReasoningText(level.id, 'label')}
              description={getReasoningText(level.id, 'description')}
              selected={level.id === value}
              title={getReasoningText(level.id, 'description')}
              onSelect={() => handleSelect(level.id)}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <div className="selector-reasoning-wrap" style={{ position: 'relative', display: 'inline-block' }}>
      <DropdownMenu
        open={isOpen}
        onOpenChange={(next) => {
          if (disabled) return;
          setIsOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            className="selector-button selector-reasoning-button"
            disabled={disabled}
            aria-label={triggerLabel}
            title={t('reasoning.title', { defaultValue: 'Select reasoning depth' })}
          >
            <span className={`codicon ${triggerIcon}`} />
            <span className="selector-button-text">{triggerLabel}</span>
            <span
              className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`}
              style={{ fontSize: '10px', marginLeft: '2px' }}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-64">
          {showDefaultOption && (
            <SelectorOptionRow
              variant="dropdown"
              dataAttrs={{ 'data-reasoning-id': 'default' }}
              icon={
                <span
                  className="codicon codicon-circle-outline mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              }
              label={resolvedDefaultLabel}
              description={t('reasoning.defaultDescription', {
                defaultValue: 'Use the engine default reasoning behavior',
              })}
              selected={value === null}
              title={t('reasoning.defaultDescription', {
                defaultValue: 'Use the engine default reasoning behavior',
              })}
              onSelect={() => handleSelect(null)}
            />
          )}
          {visibleLevels.map((level) => (
            <SelectorOptionRow
              key={level.id}
              variant="dropdown"
              dataAttrs={{ 'data-reasoning-id': level.id }}
              icon={
                <span
                  className={`codicon ${level.icon} mt-0.5 shrink-0`}
                  aria-hidden="true"
                />
              }
              label={getReasoningText(level.id, 'label')}
              description={getReasoningText(level.id, 'description')}
              selected={level.id === value}
              title={getReasoningText(level.id, 'description')}
              onSelect={() => handleSelect(level.id)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
