# composer-selector-primitives Specification

## Purpose
TBD - created by archiving change refactor-composer-selector-layer. Update Purpose after archive.
## Requirements
### Requirement: Selector 选项行渲染 MUST 单源于共享原语

Composer selector 族（mode / reasoning / config / model / preset）与 tool-menu 内子菜单的选项行（icon + label + description + check + selected/disabled 态）MUST 由共享原语 `SelectorOptionRow` 渲染，MUST NOT 在业务组件内手写重复的 option row DOM。

#### Scenario: 双 variant 语义一致

- **WHEN** 同一选项行分别以 `variant='dropdown'`（standalone Radix DropdownMenuItem）与 `variant='tool-menu'`（工具菜单 / HUD 子菜单）渲染
- **THEN** 两种 variant MUST 呈现相同的选中态（check 指示）、禁用态（aria-disabled / disabled class）与回调语义（onSelect）
- **AND** 各自的 DOM class 契约（`composer-tool-menu-option*` 系、DropdownMenuItem + `data-selected`）MUST 与引入原语前的手写实现逐一等价

#### Scenario: 新增 selector 复用原语

- **WHEN** 后续新增 Composer selector 或工具菜单子菜单需要渲染选项列表
- **THEN** 实现 MUST 复用 `SelectorOptionRow`，MUST NOT 再手写 option row DOM

#### Scenario: 选项行可访问性由原语统一保证

- **WHEN** 选项行处于 selected 或 disabled 态
- **THEN** 原语 MUST 统一输出对应的 aria / data 属性（如 `data-selected`、`aria-disabled`），业务组件 MUST NOT 自行拼装

### Requirement: 零引用 selector 组件 MUST 清退

Selector 组件在渲染树中零引用（静态与动态 import 均无消费方）时 MUST 删除组件与测试，MUST NOT 保留「仅测试引用」的死代码。

#### Scenario: engine 切换入口归属唯一

- **WHEN** 用户在 Composer 切换 CLI engine
- **THEN** 该行为 MUST 由 ModelSelect 四级 picker 承担，MUST NOT 存在第二套独立的 provider 切换下拉组件

#### Scenario: 快捷动作入口归属唯一

- **WHEN** 用户触发快捷动作（`@` / `@@` / `/` / `$` / `#` / `!`）
- **THEN** 该行为 MUST 由输入区 shortcut chips 承担，MUST NOT 存在独立的快捷动作下拉组件

