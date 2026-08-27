# Tasks

## Implementation

- [x] 1. `ChatInputBox/types.ts`：composer `ModelInfo` 增加可选 `provenance?: string | null`
- [x] 2. `ChatInputBoxAdapter.tsx`：`AdapterModelOption` 类型与 `normalizeAdapterModelOptions` 透传 provenance
- [x] 3. `selectors/ModelSelect.tsx`：legacy 菜单打开分支新增 PI capability-degraded 判定，复用 `handleRefreshConfig`
- [x] 4. `selectors/ModelSelect.test.tsx`：+用例（list-models 整组触发 / available-models 不触发 / 混合 provenance 不触发 / 非 PI 引擎不触发）

## Verify

- [x] 5. `npx vitest run ModelSelect.test.tsx ChatInputBoxAdapter.test.tsx ButtonArea.test.tsx` 169/169 通过
- [x] 6. `npm run typecheck` 0 error
- [x] 7. 自查 `git diff --stat` 无格式化噪音、无裹挟在途改动

