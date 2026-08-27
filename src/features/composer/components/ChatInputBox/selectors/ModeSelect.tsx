import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_MODES, type PermissionMode } from '../types';
import xuanzhonIcon from '../../../../../assets/xuanzhong.svg';
import { SelectorOptionRow } from './SelectorOptionRow';
import {
  MODE_SELECT_FLASH_DURATION_MS,
  MODE_SELECT_FLASH_EVENT,
} from './modeSelectFlash';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';

interface ModeSelectProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  provider?: string;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  /**
   * When true, render as a DropdownMenuSub for the vertical tool menu
   * instead of a standalone button + popover.
   */
  inline?: boolean;
}

type ModeSelectFlashStyle = CSSProperties & {
  '--mode-trigger-flash-name'?: string;
  '--mode-chevron-flash-name'?: string;
};

/**
 * ModeSelect - Mode selector component
 * Supports switching between default, agent, plan, and auto modes
 */
export const ModeSelect = memo(({
  value,
  onChange,
  provider,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  inline = false,
}: ModeSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isChevronFlashing, setIsChevronFlashing] = useState(false);
  const [flashCycle, setFlashCycle] = useState(0);
  const flashTimerRef = useRef<number | null>(null);
  const fallbackMode = AVAILABLE_MODES[0] ?? {
    id: 'default' as PermissionMode,
    label: 'Default Mode',
    icon: 'codicon-comment-discussion',
    tooltip: 'Standard permission behavior',
    description: 'Requires manual confirmation for each operation',
  };

  const modeOptions = useMemo(() => {
    if (provider === 'codex') {
      return AVAILABLE_MODES.filter(
        (mode) => mode.id === 'plan' || mode.id === 'bypassPermissions',
      ).map((mode) => ({ ...mode, disabled: false }));
    }
    if (provider === 'gemini') {
      return AVAILABLE_MODES.map((mode) => ({ ...mode, disabled: false }));
    }
    if (provider === 'claude') {
      return AVAILABLE_MODES.map((mode) => {
        if (
          mode.id === 'default' ||
          mode.id === 'plan' ||
          mode.id === 'bypassPermissions'
        ) {
          return { ...mode, disabled: false };
        }
        return { ...mode, disabled: true };
      });
    }
    if (provider === 'dsh') {
      return AVAILABLE_MODES.map((mode) => ({
        ...mode,
        disabled: mode.id !== 'default' && mode.id !== 'bypassPermissions',
      }));
    }
    if (provider === 'qoder') {
      // Headless ACP always uses bypassPermissions; hide selectable access modes.
      return AVAILABLE_MODES.map((mode) => ({
        ...mode,
        disabled: true,
      }));
    }
    // Keep non-Claude providers (including kimi) on the existing restricted path.
    return AVAILABLE_MODES.map((mode) => {
      if (mode.id !== 'bypassPermissions') {
        return { ...mode, disabled: true };
      }
      return mode;
    });
  }, [provider]);

  const selectedModeId =
    provider === 'codex'
      ? selectedCollaborationModeId === 'plan'
        ? 'plan'
        : 'bypassPermissions'
      : value;
  const currentMode = modeOptions.find(m => m.id === selectedModeId) ?? modeOptions[0] ?? fallbackMode;

  // Helper function to get translated mode text
  const getModeText = (modeId: PermissionMode, field: 'label' | 'tooltip' | 'description') => {
    if (provider === 'codex') {
      const codexKey = `codexModes.${modeId}.${field}`;
      const fallbackKey = `modes.${modeId}.${field}`;
      return t(codexKey, { defaultValue: t(fallbackKey) });
    }
    if (provider === 'claude') {
      const claudeKey = `claudeModes.${modeId}.${field}`;
      const fallbackKey = `modes.${modeId}.${field}`;
      return t(claudeKey, { defaultValue: t(fallbackKey) });
    }
    if (provider === 'dsh') {
      const dshKey = `dshModes.${modeId}.${field}`;
      const fallbackKey = `modes.${modeId}.${field}`;
      return t(dshKey, { defaultValue: t(fallbackKey) });
    }

    return t(`modes.${modeId}.${field}`);
  };

  /**
   * Select mode
   */
  const handleSelect = useCallback((mode: PermissionMode, disabled?: boolean) => {
    if (disabled) return; // Disabled options cannot be selected
    if (provider === 'codex') {
      if (mode === 'plan') {
        onSelectCollaborationMode?.('plan');
      } else if (mode === 'bypassPermissions') {
        onSelectCollaborationMode?.('code');
        onChange(mode);
      }
      setIsOpen(false);
      return;
    }
    onChange(mode);
    setIsOpen(false);
  }, [onChange, onSelectCollaborationMode, provider]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const clearFlashTimer = () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };

    const handleFlashEvent = () => {
      clearFlashTimer();
      setIsChevronFlashing(true);
      setFlashCycle((previous) => previous + 1);
      flashTimerRef.current = window.setTimeout(() => {
        setIsChevronFlashing(false);
        flashTimerRef.current = null;
      }, MODE_SELECT_FLASH_DURATION_MS);
    };

    window.addEventListener(MODE_SELECT_FLASH_EVENT, handleFlashEvent);
    return () => {
      clearFlashTimer();
      window.removeEventListener(MODE_SELECT_FLASH_EVENT, handleFlashEvent);
    };
  }, []);

  const flashingButtonStyle = useMemo<ModeSelectFlashStyle | undefined>(() => {
    if (!isChevronFlashing) {
      return undefined;
    }
    return {
      '--mode-trigger-flash-name':
        flashCycle % 2 === 0
          ? 'selector-mode-trigger-flash-a'
          : 'selector-mode-trigger-flash-b',
    };
  }, [flashCycle, isChevronFlashing]);

  const flashingChevronStyle = useMemo<ModeSelectFlashStyle | undefined>(() => {
    if (!isChevronFlashing) {
      return { fontSize: '10px', marginLeft: '2px' };
    }
    return {
      fontSize: '10px',
      marginLeft: '2px',
      '--mode-chevron-flash-name':
        flashCycle % 2 === 0
          ? 'selector-mode-chevron-flash-a'
          : 'selector-mode-chevron-flash-b',
    };
  }, [flashCycle, isChevronFlashing]);

  if (inline) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
          <span
            className={`codicon ${currentMode.icon} composer-tool-menu-item-icon`}
            aria-hidden="true"
          />
          <span className="composer-tool-menu-item-body">
            <span className="composer-tool-menu-item-label">
              {t('chat.permissionModeEntry', { defaultValue: '权限模式' })}
            </span>
            <span className="composer-tool-menu-item-value">
              {getModeText(currentMode.id, 'label')}
            </span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="composer-tool-menu-sub-content">
          {modeOptions.map((mode) => (
            <SelectorOptionRow
              key={mode.id}
              variant="tool-menu"
              dataAttrs={{ 'data-mode-id': mode.id }}
              icon={
                <span
                  className={`codicon ${mode.icon} composer-tool-menu-option-icon`}
                  aria-hidden="true"
                />
              }
              label={getModeText(mode.id, 'label')}
              description={getModeText(mode.id, 'description')}
              selected={mode.id === selectedModeId}
              disabled={mode.disabled}
              title={getModeText(mode.id, 'tooltip')}
              checkIndicator={
                <img
                  src={xuanzhonIcon}
                  className="composer-tool-menu-option-check"
                  aria-hidden
                />
              }
              onSelect={() => handleSelect(mode.id, mode.disabled)}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={`selector-button selector-button-mode-trigger${isChevronFlashing ? ' is-flashing' : ''}`}
          style={flashingButtonStyle}
          title={getModeText(currentMode.id, 'tooltip') || `${t('chat.currentMode', { mode: getModeText(currentMode.id, 'label') })}`}
        >
          <span
            className={`codicon ${currentMode.icon} selector-button-mode-icon`}
            aria-hidden="true"
          />
          <span className="selector-button-text">{getModeText(currentMode.id, 'label')}</span>
          <span
            className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'} selector-button-mode-chevron${isChevronFlashing ? ' is-flashing' : ''}`}
            style={flashingChevronStyle}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-72">
        {modeOptions.map((mode) => (
          <SelectorOptionRow
            key={mode.id}
            variant="dropdown"
            dataAttrs={{ 'data-mode-id': mode.id }}
            icon={
              <span
                className={`codicon ${mode.icon} mt-0.5 shrink-0`}
                aria-hidden="true"
              />
            }
            label={getModeText(mode.id, 'label')}
            description={getModeText(mode.id, 'description')}
            selected={mode.id === selectedModeId}
            disabled={mode.disabled}
            title={getModeText(mode.id, 'tooltip')}
            onSelect={() => handleSelect(mode.id, mode.disabled)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
