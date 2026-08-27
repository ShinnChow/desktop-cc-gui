# refactor-composer-selector-layer · tasks

> 全程 TDD：每个实现任务前先有对应红/绿测试或既有测试基线约束。每 Phase 一个独立提交，可单独回退。

## Phase 0 · 基线与 Gate 前置

- [ ] 0.1 `git status` 确认 `src/features/composer/components/ChatInputBox/selectors/`、`ButtonArea.tsx`、`features/multi-agent/` 工作区干净；不干净即停手协调
- [ ] 0.2 跑基线：`npx vitest run src/features/composer/components/ChatInputBox/selectors/ src/features/composer/components/ChatInputBox/ButtonArea.test.tsx` 记录通过/失败清单（存量失败逐条记录，作为零新增红对照）
- [ ] 0.3 `npx tsc --noEmit`（或项目 typecheck script）记录基线 error 数
- [ ] 0.4 记录锚点清单：grep 提取 selectors 族渲染输出中的 class / testid / aria 键集合，存 `design.md` 附录或本 tasks 备注，供 Phase 2/3 后对照

## Phase 1 · 删除死代码（零行为变化）

- [ ] 1.1 【证明】grep 全仓确认 `ProviderSelect` / `ShortcutActionsSelect` 渲染引用为零（静态 import + 动态 `import(`），把输出贴进 PR 描述
- [ ] 1.2 删 `ProviderSelect.tsx` / `ProviderSelect.test.tsx` / `ShortcutActionsSelect.tsx` / `ShortcutActionsSelect.test.tsx`
- [ ] 1.3 清理 `selectors/index.ts` barrel 两行导出
- [ ] 1.4 【验证】typecheck 零新增 error；selectors 族 + ButtonArea 测试与 0.2 基线逐条一致；`grep -r "ProviderSelect\|ShortcutActionsSelect" src/` 仅剩无害文档注释（如有）
- [ ] 1.5 提交（单提交）：`refactor(composer): 删除零引用的 ProviderSelect 与 ShortcutActionsSelect 死代码`

## Phase 2 · SelectorOptionRow 原语（先红后绿，逐处替换）

- [ ] 2.1 【红】写 `SelectorOptionRow.test.tsx`：variant × selected/disabled × icon/description 有无矩阵，断言 DOM 结构与 class 与 design §3 契约逐一等价（`composer-tool-menu-option*` 全系、`DropdownMenuItem` + `data-selected` + CheckIcon 出现条件、onClick/aria-disabled 语义）
- [ ] 2.2 【绿】实现 `SelectorOptionRow.tsx`（variant='dropdown' 走 DropdownMenuItem；variant='tool-menu' 按 `as` 语义区分 div 与 DropdownMenuItem 两种宿主）
- [ ] 2.3 替换 ReasoningSelect inline + standalone 分支（design §3 清单 #1 #2）→ 跑 ReasoningSelect.test + 锚点对照
- [ ] 2.4 替换 ModeSelect 两分支（#3 #4）→ 跑 ModeSelect.test
- [ ] 2.5 替换 ConfigSelect inline 分支 option 行（#5）→ 跑 ConfigSelect.test
- [ ] 2.6 替换 ButtonArea memory-reference 子菜单（#6）→ 跑 ButtonArea.test
- [ ] 2.7 评估 DshAgentPresetSelect（#7 前置）：option 行形状匹配则替换并跑测试；不匹配则在本 tasks 记录原因跳过
- [ ] 2.8 【验证】0.2 基线全量复跑零新增红；typecheck 零新增；锚点清单对照无漂移；prettier 仅检查本 change 触及文件（存量 dirty 文件只保证自己 hunk 干净）
- [ ] 2.9 提交：`refactor(composer): 抽取 SelectorOptionRow 选项行原语并替换六处手写渲染`

## Phase 3 · ModelSelect 拆文件（行为零变化，测试恒绿）

- [ ] 3.1 【补测】对覆盖不足的纯函数补特征测试（`pickerRowsForGroup` / `resolveRuntimeModel` / `isSelectedExecutionModel` 至少各一用例；既有覆盖足够的跳过并在 PR 记录）
- [ ] 3.2 建 `selectors/model-select/` 子模块：按 design §2 切分 `executionTarget` / `providerProfile` / `display` / `icon` / `pickerGroups` / `atomicSelection` 纯函数文件（代码平移不改逻辑，允许 import 归组微调）
- [ ] 3.3 拆 `ChannelPickerSubMenu.tsx`（channel / provider profile 子菜单 JSX + 其 handler 内聚迁出；props 注入，不从父组件读 store）
- [ ] 3.4 ModelSelect.tsx 主文件改 import 并删除已迁出代码；`ModelSelect` 组件本体与既有导出面（组件 + 纯函数 re-export 位置变更）按 design §2 「直接改」口径处理
- [ ] 3.5 全量改跨 feature import：`useModels.ts` / `app-shell/domains`（3 处）/ `StageTargetPicker.tsx` / `atomicModelReasoning.ts` / `resolveComposerAtomicSelectedModelId.ts`
- [ ] 3.6 ModelSelect.test.tsx 仅改 import 路径，用例体不动；83 用例全绿
- [ ] 3.7 【验证】typecheck 零 error；0.2 基线 + ModelSelect.test 全量复跑逐条一致；`npm run check:app-shell:governance` 通过；主文件行数对照 design §2 目标记录实际值
- [ ] 3.8 提交：`refactor(composer): 拆分 ModelSelect 纯函数与 channel picker 到 model-select 子模块`

## Phase 4 · 级联语义收敛（审计驱动，允许「仅裁决不合并」收口）

- [ ] 4.1 【审计】按 design §4 四维度对照 `targetPicker.ts` 与 ModelSelect 内部级联逻辑，回填 design §5 裁决表（含代码行级证据）
- [ ] 4.2 【红】对每个「改调 targetPicker 纯函数」的收敛点先写等价性测试：同一输入（engine/profile/model/reasoning + catalog fixture）改前后同一输出
- [ ] 4.3 【绿】执行形状允许的收敛；形状不允许的按裁决表留档跳过
- [ ] 4.4 【验证】基线复跑零新增红；若结论为「不合并」，在 design §5 写明成本/收益依据后视为完成
- [ ] 4.5 提交：`refactor(composer): 收敛 ModelSelect 与 targetPicker 级联语义分叉`（或 `docs(composer): 记录级联语义双轨裁决` ）

## 收口

- [ ] 5.1 `openspec validate refactor-composer-selector-layer --strict` 通过
- [ ] 5.2 全量回归：selectors 族 + ButtonArea + composer 合同批次 + app-shell governance，与 Phase 0 基线对照零新增红
- [ ] 5.3 手测矩阵（真机）：普通 native 会话 / Shared 会话 / New Home 双栏 picker 各开一次 ModelSelect（分组 + channel 子菜单 + 搜索）、ReasoningSelect、ModeSelect、工具菜单 memory-reference 子菜单，确认交互与视觉无变化
- [ ] 5.4 更新 `openspec/changes/README.md` 索引行；sync specs（`composer-selector-primitives` 新增 + `composer-selector-home-chat-simplification` 修改）
- [ ] 5.5 archive
