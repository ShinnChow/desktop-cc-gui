import { memo, type ReactNode } from 'react';
import CheckIcon from 'lucide-react/dist/esm/icons/check';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/**
 * SelectorOptionRow —— Composer selector 族共享选项行原语。
 *
 * 统一两种既有渲染形态（DOM/class 契约与原手写实现逐一等价，改动即回归）：
 * - variant="dropdown"：standalone 菜单行（Radix DropdownMenuItem + tailwind
 *   行布局 + data-selected + lucide CheckIcon）。onSelect 默认 preventDefault
 *   保持菜单打开（Reasoning/Mode/Dsh standalone 现状：受控开关手动关闭）。
 * - variant="tool-menu"：工具菜单行（composer-tool-menu-option* class 系）。
 *   host="button"：inline 子菜单里的原生 button（Reasoning/Mode inline）；
 *   host="menu-item"：HUD 内 DropdownMenuItem（ConfigSelect inline /
 *   ButtonArea memory-reference 子菜单），onSelect 不 preventDefault。
 *
 * 红线：见 openspec change refactor-composer-selector-layer design §3——
 * 产出的 DOM 结构与 class 必须与替换前的手写实现等价，测试锚点不动。
 */
export type SelectorOptionRowProps = {
  variant: 'dropdown' | 'tool-menu';
  /** tool-menu 宿主元素：'button'（inline 子菜单）/ 'menu-item'（HUD 子菜单）。默认 'button'。 */
  host?: 'button' | 'menu-item';
  /** 图标节点（含 class 的 span/组件），由调用方按各自形态构造后传入 */
  icon?: ReactNode;
  label: ReactNode;
  /** 缺省时不渲染 description span（与 ConfigSelect inline / ButtonArea 现状一致） */
  description?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** tooltip（title 属性） */
  title?: string;
  onSelect: () => void;
  /**
   * dropdown variant 是否 preventDefault 保持菜单打开。
   * 默认 true（Reasoning/Mode/Dsh standalone 均为受控开关 + 手动关闭）。
   */
  keepMenuOpen?: boolean;
  /** 覆盖选中指示器（默认：dropdown=lucide CheckIcon；tool-menu=codicon-check span） */
  checkIndicator?: ReactNode;
  /** 未选中时展示的尾随内容（如 preset id 徽标） */
  trailing?: ReactNode;
  /** 透传 data-* 属性（data-mode-id / data-reasoning-id / data-preset-id …） */
  dataAttrs?: Record<string, string | undefined>;
};

function defaultCheckIndicator(variant: SelectorOptionRowProps['variant']): ReactNode {
  if (variant === 'dropdown') {
    return <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />;
  }
  return (
    <span className="codicon codicon-check composer-tool-menu-option-check" aria-hidden="true" />
  );
}

const toolMenuClass = (selected: boolean, disabled: boolean) =>
  `composer-tool-menu-option${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`;

function ToolMenuBody({ label, description }: { label: ReactNode; description?: ReactNode }) {
  return (
    <span className="composer-tool-menu-option-body">
      <span className="composer-tool-menu-option-label">{label}</span>
      {description != null && (
        <span className="composer-tool-menu-option-description">{description}</span>
      )}
    </span>
  );
}

export const SelectorOptionRow = memo(function SelectorOptionRow({
  variant,
  host = 'button',
  icon,
  label,
  description,
  selected = false,
  disabled = false,
  title,
  onSelect,
  keepMenuOpen = true,
  checkIndicator,
  trailing,
  dataAttrs,
}: SelectorOptionRowProps) {
  const indicator = selected ? (checkIndicator ?? defaultCheckIndicator(variant)) : trailing;

  if (variant === 'dropdown') {
    return (
      <DropdownMenuItem
        {...dataAttrs}
        data-selected={selected ? 'true' : undefined}
        disabled={disabled}
        title={title}
        className="items-start gap-2"
        onSelect={(event) => {
          if (keepMenuOpen) {
            event.preventDefault();
          }
          if (!disabled) {
            onSelect();
          }
        }}
      >
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{label}</span>
          {description != null && (
            <span className="text-xs text-muted-foreground whitespace-normal">
              {description}
            </span>
          )}
        </div>
        {indicator}
      </DropdownMenuItem>
    );
  }

  if (host === 'menu-item') {
    return (
      <DropdownMenuItem
        {...dataAttrs}
        className={toolMenuClass(selected, disabled)}
        disabled={disabled}
        title={title}
        onSelect={() => {
          if (!disabled) {
            onSelect();
          }
        }}
      >
        {icon}
        <ToolMenuBody label={label} description={description} />
        {indicator}
      </DropdownMenuItem>
    );
  }

  return (
    <button
      type="button"
      {...dataAttrs}
      className={toolMenuClass(selected, disabled)}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) {
          onSelect();
        }
      }}
    >
      {icon}
      <ToolMenuBody label={label} description={description} />
      {indicator}
    </button>
  );
});
