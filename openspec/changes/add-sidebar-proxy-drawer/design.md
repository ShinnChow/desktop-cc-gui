# Design: add-sidebar-proxy-drawer

## Approach

将代理编辑 UI 提取为受控的 `SystemProxyDrawer`，在 `Sidebar` 内维护仅 UI 的 open state。它从已有 app settings 保存链路接收当前代理值和保存 callback，因此 toggle 仍立即持久化，地址编辑仍须显式保存。

## Decisions

- 采用 right-side drawer (`role="dialog"`, `aria-modal="false"`)，不用 `Dialog`/modal：主界面不会被遮挡或禁用。
- `RailSymbol` 是 lucide 的代理/梯子语义图标；菜单文案复用现有网络代理 i18n key。
- 默认地址只作为未配置时的 draft 值；不会在用户仅打开 drawer 时写入 settings。
- 成功、验证失败和保存失败沿用 `useSystemProxySettings` 的既有状态语义；组件从设置页迁出后仍单一实现，避免两个入口漂移。

## TDD plan

1. 在 `Sidebar.test.tsx` 先断言菜单项、drawer、默认地址、toggle/保存调用与关闭交互。
2. 运行该定向用例，确认新增用例先失败。
3. 实现最小 UI、props 接线和样式，运行测试转绿。

## Risks and rollback

- AppShell props 变更可能破坏 layout-node contract；以类型检查和 `check:app-shell:governance` 覆盖。
- 若 drawer 影响紧凑侧栏布局，删除入口/渲染分支即可回到既有设置页，持久化数据不变。
