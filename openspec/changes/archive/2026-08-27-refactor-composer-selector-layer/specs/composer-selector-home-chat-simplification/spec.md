# composer-selector-home-chat-simplification Delta

## MODIFIED Requirements

### Requirement: Composer selectors MUST use stable shared selection primitives

Composer mode/model/reasoning selectors SHALL 在需要 searchable 或 modal selection 时使用 shared command/dialog primitives；选项行（icon + label + description + 选中/禁用态）SHALL 单源渲染于 `SelectorOptionRow` 共享原语（契约见 `composer-selector-primitives`）。

#### Scenario: 打开 selector

- **WHEN** 打开 selector
- **THEN** 当用户打开 mode/model/reasoning selector 时，selector 必须提供稳定 keyboard 和 pointer interaction，并更新下一轮使用的 composer state。

#### Scenario: 选项行渲染单源

- **WHEN** mode / reasoning / config selector 或工具菜单子菜单渲染选项列表
- **THEN** 选项行 DOM MUST 由 `SelectorOptionRow` 产出，交互与视觉与原手写实现等价。

#### Scenario: ModelSelect 纯函数与 UI 分层

- **WHEN** 跨 feature 消费方（models hooks / app-shell domains / 协作模板 picker）需要 ModelSelect 的纯函数（target 构建、profile 解析、显示解析等）
- **THEN** 这些纯函数 MUST 从 `model-select` 子模块导入，MUST NOT 挂在 UI 组件文件上。
