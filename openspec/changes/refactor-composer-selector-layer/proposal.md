# refactor-composer-selector-layer

## Why

Composer 输入区的下拉选择器族（`src/features/composer/components/ChatInputBox/selectors/`）经过多轮演进后积累了四类结构债，现状为：

1. **死代码 ~460 行**：`ProviderSelect.tsx`（226 行）与 `ShortcutActionsSelect.tsx`（231 行）在渲染树中零引用（engine 切换已被 ModelSelect 四级 picker 吸收；快捷动作入口已由 ChatInputBox 的 shortcut chips 承担），仅各自测试文件在引用。`ProviderSelect` 还携带一套手写 mousedown click-outside + 私有 toast（`setTimeout(1500)` 自制）的实现范式，与仓库 Radix DropdownMenu 主线相悖，留着会持续误导后续接入。
2. **选项行渲染重复 6+ 处**：`icon + label + description + check + selected/disabled 态` 的 option row 在 ReasoningSelect / ModeSelect / ConfigSelect 的 inline（tool-menu）分支、各自 standalone（Radix DropdownMenuItem）分支、以及 ButtonArea.tsx L486-536 手写的 memory-reference 子菜单中各写一遍。每个 selector 同时维护两套完整渲染分支（inline div 与 Radix），内容几乎一致。
3. **ModelSelect.tsx 2027 行单体**：~590 行纯函数（`buildProviderExecutionTarget` / `resolveAtomicSelectedModelDisplay` / `normalizeExecutionProviderProfileId` 等）+ 主组件（1400 行）+ channel/provider profile picker 子菜单混在一个文件。其中纯函数部分被 `useModels.ts` / `app-shell/domains` / `multi-agent` 等跨 feature 引用，import 路径挂在 UI 组件文件上。
4. **四级级联语义双轨**：`shared-session/target/targetPicker.ts`（Wave 4 B.1.3 纯逻辑，catalog 注入式）与 ModelSelect 内部 picker/channel 选择逻辑各持一份「换 CLI 重置 provider/model/reasoning」级联规则，形状不同但语义重叠，存在后续演进时漏改一边的风险。

本 change 以 TDD 方式统一收敛上述四项，**不改任何用户可见行为**。

## What Changes

按四个 Phase 交付（详见 tasks.md），每 Phase 独立可提交、可回退：

- **Phase 1 · 删除死代码**：删除 `ProviderSelect.tsx` / `ShortcutActionsSelect.tsx` 及其测试文件，清理 `selectors/index.ts` barrel 导出。对应 capability 行为（engine 切换、快捷动作入口）已由其他实现承担，spec 无需 delta，仅在 proposal 记录映射。
- **Phase 2 · 抽取 `SelectorOptionRow` 公共原语**：新组件接受 `icon / label / description / selected / disabled / onSelect + variant: 'dropdown' | 'tool-menu'`，先写组件测试（红）再实现（绿），再逐处替换 ReasoningSelect / ModeSelect / ConfigSelect / ButtonArea memory-reference 子菜单中的手写 option row。CSS class 契约保持不变（`composer-tool-menu-option*` / `DropdownMenuItem` data-selected 语义），测试锚点（class / testid / aria）不动。
- **Phase 3 · ModelSelect 拆文件**：纯函数族迁移至 `selectors/model-select/` 子模块（目标结构见 design §2），import 方全量改路径；channel/provider profile picker 子菜单拆为独立子组件文件。83 个既有 ModelSelect 测试保持全绿，行为零变化。
- **Phase 4 · 级联语义收敛（有限）**：对 `targetPicker.ts` 与 ModelSelect 内部级联逻辑做差异审计（design §4 裁决表），仅当形状允许时让 ModelSelect 内部逻辑改调 targetPicker 纯函数；任何「应同而不同」的分叉逐条裁决留档，不允许静默取其一。若审计结论为合并成本 > 收益，则以裁决表 + design 记录收口，不强行合并。

## 目标与边界

- **目标**：selector 族选项行渲染单源化；ModelSelect 从 2027 行拆至主文件 ≤800 行量级；死代码清零；级联语义分叉显性化并裁决。
- **边界**：不改任何用户可见行为（交互、视觉、i18n key、事件顺序）；不动 `Composer.tsx` 的 native / shared / create-session 三态 handler 编排（该分叉已正确隔离在 props 接口层）；不动 `shared-session/target/targetStore` 状态机与持久化；不动 `PromptEnhancerDialog` / `StageTargetPicker` 对 ModelSelect 的消费接口（仅 import 路径可能变化）。
- **验收基线**：每 Phase 提交前后，既有 vitest 全绿（selectors 族 + ButtonArea + composer 合同批次），typecheck 零 error，`check:app-shell:governance` 通过（Phase 3 涉及 app-shell/domains import 路径）；行为快照锚点（class / testid / aria-label / i18n key）逐一对照无漂移。

## TDD 口径

- **纯重构 Phase（1/3）**：既有测试即安全网。删除前先证明「该组件零渲染引用」；拆文件前先跑全量测试建立基线，迁移过程中测试恒绿；对覆盖不足的纯函数（如 `pickerRowsForGroup`）先补特征测试再迁移。
- **新组件 Phase（2）**：`SelectorOptionRow` 先写完整组件测试（两种 variant × selected/disabled/icon 有无矩阵，红），再实现，再逐处替换（每替换一处即跑该 selector 测试，绿）。
- **审计 Phase（4）**：差异审计产出为裁决表 + 对每一处「改为调用 targetPicker 纯函数」的等价性测试（改前后同一输入同一输出）。

## 非目标

- 不改 ModelSelect 的四级 picker 交互设计（channel 子菜单、分组搜索、自定义模型管理流程保持现状）。
- 不统一 native / shared / create-session 的 handler 编排（Composer.tsx 现有隔离正确，动它是另一个维度的重构）。
- 不迁移 `Dropdown/`（输入框 @ 补全组件，与 selector 族无关）。
- 不处理 `ConfigSelect` 的内聚拆分（755 行，属工具菜单聚合层，另案）。
- 不做视觉/CSS 层重构（class 名不变是本 change 的红线，样式治理另案）。

## Capabilities

### New Capabilities

- `composer-selector-primitives`: selector 选项行 / 触发器共享原语合同——所有 selector 与 tool-menu 子菜单的 option row 渲染单源于 `SelectorOptionRow`；variant 语义（dropdown / tool-menu）与可访问性属性（aria / data-selected）由原语统一保证。

### Modified Capabilities

- `composer-selector-home-chat-simplification`: MODIFIED——「stable shared selection primitives」requirement 从原则性表述收敛为具体原语引用（option row 单源、双 variant）；补充死代码清退后 engine 切换 / 快捷动作入口的行为归属说明。

### Unaffected（行为归属映射，非 delta）

- `composer-shortcut-actions-menu`：快捷动作入口由 ChatInputBox shortcut chips 实现，删除 ShortcutActionsSelect 不影响该 spec 满足度。
- `composer-tool-menu-primary-controls` / `composer-session-control-hud`：option row class 契约不变，Phase 2 替换后 HUD 视觉与宽度锚定不受影响。

## Impact

| 层 | 影响面 |
| ---- | -------- |
| Frontend | `selectors/` 目录：删 2 组件 + 2 测试；新增 `SelectorOptionRow` + 测试；新增 `selectors/model-select/` 子模块；ReasoningSelect / ModeSelect / ConfigSelect / ButtonArea 内部渲染改用原语。跨 feature import 路径变更：`useModels.ts`、`app-shell/domains/*`、`multi-agent/StageTargetPicker`、`features/models/atomicModelReasoning` 引用的纯函数导出点。 |
| Backend | 无 |
| Specs | 新增 `composer-selector-primitives`；MODIFIED `composer-selector-home-chat-simplification` |
| Gate | PlanFirst（本 change 即 plan 载体）；Format Discipline Gate（多处存量 prettier-dirty 文件，仅保证本 change hunk 局部格式干净，禁全文件重排）；不命中 Engine Onboarding / ADR 校准回写 / AppShell Structure Gate 的触发器（不动 shell 状态与 domain key） |
| 风险 | ① 测试锚点漂移：ModelSelect.test 3677 行锚定大量 class / testid，替换 option row 时若误改 DOM 结构会大面积红——缓解：Phase 2 仅替换等价 DOM，锚点清单先行；② 并行会话冲突：selectors 目录当前干净（bump-version-0.9.4 分支），但 ModelSelect.tsx 历史上高频改动，每 Phase 小步提交降低冲突半径；③ 纯函数迁移 import 断链——缓解：typecheck 全量把关 |
