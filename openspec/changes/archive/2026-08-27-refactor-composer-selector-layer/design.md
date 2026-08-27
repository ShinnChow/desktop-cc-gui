# refactor-composer-selector-layer · design

> 状态：proposal 阶段。Phase 4 裁决表（§5）在实施时回填。

## 1. 现状组件链路（事实快照，2026-08-27，分支 bump-version-0.9.4，工作区干净）

```text
━━━━━ 状态编排层（native / shared / create-session 三态分叉点）━━━━━
Composer.tsx (4123 行)
│  selectedAtomicTarget 三态取值，汇入同一组 props：
│  ├─ Shared 会话       → shared-session/target/targetStore（target 即 UI）
│  │                      onExecutionTargetChange = handleSharedTargetChange
│  │                      （send 状态机非 idle → sharedTargetPickerLocked → undefined）
│  ├─ create-session    → handleCreationTargetChange（New Home 双栏 picker）
│  └─ Native 会话       → handleNativeAtomicTargetChange
│                         → useModels.planComposerModelSelection 长链 + 本地 sentinel
│  reasoning 同型三态 fork：handleSharedEffortChange / creation / onSelectEffort
│
━━━━━ 渲染层（三态共用，selector 层不感知 shared）━━━━━━━━━━━━━━
ChatInputBox.tsx (2026 行)
│
├─ ComposerReadinessBar ──→ ModelSelect (triggerVariant="readiness")
│                            四级 picker 单组件：engine → providerProfile
│                            → model (+channel 子菜单)；reasoning 外置
│
└─ ButtonArea.tsx (651 行)
   ├─ session-control HUD（工具菜单）
   │   ├─ ConfigSelect (inline 模式)：引擎/流式/协作模式/agent 聚合菜单
   │   └─ ✗ 手写 memory-reference 子菜单 (L486-536，未走 selector 原语)
   └─ inline-controls 行
       ├─ ModeSelect            (非 pi)
       ├─ DshAgentPresetSelect  (仅 dsh)
       └─ ReasoningSelect       (codex/claude/grok 无条件；dsh/qoder/pi
                                 仅当模型 catalog 声明 reasoning efforts)

━━━━━ ModelSelect 的跨 feature 消费场景 ━━━━━━━━━━━━━━━━━━━━━━━━━
├─ PromptEnhancerDialog (menuLayer="overlay", onChange={noop} 只读壳)
└─ multi-agent/StageTargetPicker（协作模板编辑器）
    └─ ModelSelect + ReasoningSelect，catalog 由弹层单例注入

━━━━━ Shared 专属纯逻辑（不经过 composer 渲染层）━━━━━━━━━━━━━━
shared-session/target/targetPicker.ts —— 四级级联纯逻辑
（catalog 注入式：换 CLI 重置 provider/model/reasoning；换 provider
  重置 model/reasoning；换 model 保留 reasoning 仅当仍可用）

━━━━━ 死代码（仅自身测试引用）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗ ProviderSelect.tsx (226 行：手写 click-outside + 私有 toast)
✗ ShortcutActionsSelect.tsx (231 行)
```

### 1.1 关键事实（Phase 实施的约束输入）

- `ProviderSelect` / `ShortcutActionsSelect` 渲染引用为零（静态 + 动态 import 均查证）；`composer-shortcut-actions-menu` spec 的行为由 ChatInputBox shortcut chips（`handleShortcutChipClick`，`@` / `@@` / `/` / `$` / `#` / `!`）满足。
- 三态（native / shared / create-session）分叉已被 `executionTarget` + `onExecutionTargetChange` props 接口隔离在 Composer.tsx handler 层；selector 层与 `StageTargetPicker` 完全不感知 shared——**本 change 不得破坏该隔离**。
- ModelSelect.test.tsx 83 个用例、3677 行，锚定大量 class / testid / aria；ModeSelect 9、ReasoningSelect 7、ConfigSelect 10。
- `Dropdown/` 是输入框 @ 补全组件，与 selector 族无关，不迁移。

## 2. 目标结构

```text
selectors/
  index.ts                      # barrel（删 ProviderSelect / ShortcutActionsSelect 导出）
  SelectorOptionRow.tsx         # ★ Phase 2 新增：共享选项行原语
  SelectorOptionRow.test.tsx
  ModelSelect.tsx               # Phase 3 后主文件 ≤800 行量级（trigger + 编排）
  model-select/                 # ★ Phase 3 新增：纯函数 + 子组件子模块
    executionTarget.ts          #   buildProviderExecutionTarget / isSameProviderExecutionProfile
    providerProfile.ts          #   normalizeExecutionProviderProfileId / resolveActiveProviderProfileId
    display.ts                  #   resolveClaudeCatalogModelLabel / resolveAtomicSelectedModelDisplay
    icon.ts                     #   resolveModelIdForIcon / ModelIcon / renderBrandIcon
    pickerGroups.ts             #   PickerModelGroup / pickerRowsForGroup / PickerProfileOption
    atomicSelection.ts          #   isAtomicEmptyModelSelection / resolveRuntimeModel / isSelectedExecutionModel
    ChannelPickerSubMenu.tsx    #   channel / provider profile picker 子菜单（从主文件拆出）
  ReasoningSelect.tsx           # Phase 2 后：option row 全部走 SelectorOptionRow
  ModeSelect.tsx                # 同上
  ConfigSelect.tsx              # 同上（仅 inline 分支 option row；聚合菜单结构不动）
  DshAgentPresetSelect.tsx      # 视 Phase 2 审计结果决定是否替换（126 行，可低优）
```

子模块切分以「按依赖方向分层」为准：`executionTarget` / `providerProfile` 不依赖 UI；`display` / `icon` / `pickerGroups` 可依赖前者；`ChannelPickerSubMenu` 依赖全部纯模块。切分粒度在 Phase 3 实施时允许微调（±1 文件），但依赖方向不得反向。

跨 feature import 方迁移（Phase 3）：

| 使用方 | 现引用 | 迁移后 |
| -------- | -------- | -------- |
| `features/models/hooks/useModels.ts` | ModelSelect 纯函数 | `selectors/model-select/*` |
| `app-shell/domains/*`（3 处） | 同上 | 同上 |
| `features/multi-agent/StageTargetPicker.tsx` | `ModelSelect`（组件）+ 纯函数 | 组件留原位，纯函数改子模块 |
| `features/models/atomicModelReasoning.ts` | 纯函数 | 子模块 |
| `features/composer/utils/resolveComposerAtomicSelectedModelId.ts` | 纯函数 | 子模块 |

`ModelSelect.tsx` 主文件保留 re-export（`export { buildProviderExecutionTarget } from './model-select/executionTarget'`）一个版本周期还是直接改全量 import 方：**直接改**（本 change 一次改齐，避免双路径长期并存；typecheck 全量把关断链）。

## 3. SelectorOptionRow 契约（Phase 2）

```tsx
type SelectorOptionRowProps = {
  variant: 'dropdown' | 'tool-menu';
  icon?: ReactNode;            // codicon span 或任意图标节点
  label: ReactNode;
  description?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;     // title 提示
  onSelect: () => void;
  // Radix DropdownMenuItem 需要拦截 onSelect 事件语义时由原语内部处理
  dataTestId?: string;
};
```

- `variant='dropdown'`：渲染 `DropdownMenuItem` + `data-selected` + CheckIcon（等价替换 ReasoningSelect / ModeSelect standalone 分支手写）。
- `variant='tool-menu'`：渲染 `div.composer-tool-menu-option`（inline 分支）或 `DropdownMenuItem.composer-tool-menu-option`（HUD 内子菜单，ButtonArea memory-reference 场景）。
- **红线**：两种 variant 产出的 DOM 结构与 class 与现状逐一等价（`composer-tool-menu-option` / `-body` / `-label` / `-icon` / `-check`、`selector-option` 系列不变）；测试锚点不动。

替换清单（Phase 2 逐处验收）：

| # | 位置 | variant |
| --- | ------ | --------- |
| 1 | ReasoningSelect inline 分支 option 行 | tool-menu (div) |
| 2 | ReasoningSelect standalone 分支 DropdownMenuItem | dropdown |
| 3 | ModeSelect inline 分支 | tool-menu (div) |
| 4 | ModeSelect standalone 分支 | dropdown |
| 5 | ConfigSelect inline 分支 option 行 | tool-menu |
| 6 | ButtonArea memory-reference 子菜单 | tool-menu (DropdownMenuItem) |
| 7 | ModelSelect 内 option 行 | **不替换**（Phase 3 拆出后另行评估，避免 Phase 2/3 交叠冲突） |

## 4. Phase 4 · 级联语义收敛口径

`targetPicker.ts`（catalog 注入纯函数）与 ModelSelect 内部 picker 逻辑（`handleChannelSwitch` / `handlePickerSelect` / `buildProviderExecutionTarget` 的级联字段重置规则）对照审计维度：

1. 换 CLI（engine）时 provider / model / reasoning 的重置范围；
2. 换 provider profile 时 model / reasoning 的重置范围（含 channel 内模型组继承）；
3. 换 model 时 reasoning 保留条件（新模型 capability 集合判定）；
4. disabled / 空 catalog 档位的回退行为。

裁决规则：形状可映射 → ModelSelect 内部级联改调 targetPicker 纯函数 + 等价性测试；形状不可映射或语义确有分叉 → 逐条裁决「哪边是产品语义」留档 §5，**不做静默合并**。

## 5. 级联分叉裁决表（2026-08-27 审计回填）

**审计总裁决：不合并（裁决留档收口）**——且审计发现关键事实：`targetPicker.ts` 为**零消费死代码**（全仓 grep：`targetPicker` / `buildTargetPickerOptions` / `applyPickerSelection` / `validatePickerSelection` 除自身测试外零引用；Wave 4 B.1.3 产物 `fe81e9212`，shared-session 目标选择 UI 实际演进为 ModelSelect 直驱）。级联语义的活实现只在 ModelSelect 侧，「双轨收敛」命题不成立。

| # | 审计维度 | targetPicker 行为（已死代码，存档） | ModelSelect 行为（活实现） | 裁决 | 处置 |
| --- | ---------- | ------------------- | ------------------ | ------ | ------ |
| 1 | 换 engine 重置范围 | `applyPickerSelection('engine')` → `{ engine }` skeleton（provider/model/reasoning 全空，等用户逐级选） | 跨引擎 channel 切换 `sameEngine ? executionTarget : null` + `buildProviderExecutionTarget` 产出完整 resolved target（模型 + capability-seeded reasoning） | 有意分叉：skeleton 逐级选 vs 模型菜单直选，交互模型不同 | 保持 ModelSelect 单轨；targetPicker 死代码建议另案清退 |
| 2 | 换 provider profile 重置范围 | `applyPickerSelection('provider')` → `{ engine, providerProfileId }`，model/reasoning 直接置空 | `handleChannelSwitch`：同引擎时 `keptModel` 保留（新渠道 catalog 内找当前 model，找不到回退首项）；reasoning 经 `buildProviderExecutionTarget(inherit=false)` 按 capability 重播种；override 竞态有 rollback | 有意分叉：ModelSelect 的 keptModel 保留是产品语义（Shared 切渠道不断模型） | 同上 |
| 3 | 换 model 时 reasoning 保留 | `{ ...current, model }` 无条件保留，注释声明由 UI 层判定 | `resolveAtomicReasoningEffort({ inherit: sameProfile })`：同 engine+profile 且 previous effort 仍在 supportedReasoningEfforts 内才保留，否则落模型默认档 | 语义一致、机制不同；targetPicker 零消费故无对齐义务 | 同上 |
| 4 | 空档 / disabled 回退 | `validatePickerSelection` 逐级标 invalidLevel | `isAtomicEmptyModelSelection` 合法空选态（模板编辑器）；`rollbackOverride` 竞态回滚；catalog 加载失败回退已有 projection | 有意分叉：校验器 vs 合法态 + 乐观回滚 | 同上 |

**后续动作**：`targetPicker.ts`（4735 B）+ `targetPicker.test.ts`（12 用例）清退建议**另立 change**（本 change 边界声明不动 shared-session/target 域；死代码清退 capability 契约已在 `composer-selector-primitives` spec 覆盖 selector 族，shared-session 域清退需其归属 change 处理）。

## 6. 风险表

| 风险 | 概率 | 影响 | 缓解 |
| ------ | ------ | ------ | ------ |
| Phase 2 替换后测试锚点大面积红（DOM 结构漂移） | 中 | 高 | 原语实现与现状 DOM 逐一等价；每替换一处立即跑该组件测试；锚点差异即视为实现 bug 回滚该处 |
| ModelSelect.test 3677 行在 Phase 3 迁移中断链 | 中 | 中 | 纯函数迁移不改测试文件（仅 import 路径）；typecheck 全量把关 |
| 存量 prettier-dirty 文件（ModeSelect / ReasoningSelect / ButtonArea 等）被顺手全文件重排 | 高 | 高 | Format Discipline Gate：仅本 change hunk 局部格式化；提交前 `git diff --stat` 自查改动行数 |
| 并行会话同期改 selectors（ModelSelect.tsx 高频改动区） | 中 | 中 | 每 Phase 小步独立提交；开工前 `git status` 确认目标目录干净；发现他方在途改动即停手协调 |
| Phase 4 强行合并导致级联行为回归 | 低 | 高 | 裁决表留档 + 等价性测试双保险；允许「不合并，仅裁决留档」收口 |
| 删除死代码后 barrel 导出残留引用 | 低 | 低 | grep + typecheck 双查 |

## 附录 A · 锚点清单（Phase 0.4 基线，2026-08-27）

Phase 2/3 重构后以下锚点集合 MUST 不变（提取自 ReasoningSelect / ModeSelect / ConfigSelect / ButtonArea 现状渲染输出）：

- **composer-tool-menu 全系**：`composer-tool-menu-action(-label)` / `composer-tool-menu-item-(body|icon|label|value)` / `composer-tool-menu-option(-body|-check|-description|-icon|-label)` / `composer-tool-menu-sub-(content|trigger)` / `composer-tool-menu-surface-row` / `composer-tool-menu-toggle(-label|-switch)`
- **selector-button 系**：`selector-button` / `selector-button-mode-(chevron|icon|trigger)` / `selector-button-text`
- **selector-option 系（ConfigSelect standalone）**：`selector-option` / `selector-option-agent-icon` / `selector-option-fork-quick` / `selector-option-plan-mode` / `selector-option-review-quick` / `selector-option-speed(-fast|-standard)` / `selector-option-streaming-toggle` / `selector-option-thinking-toggle`
- **data 锚点**：`data-selected` / `data-reasoning-id` / `data-testid="composer-session-control-hud"`
