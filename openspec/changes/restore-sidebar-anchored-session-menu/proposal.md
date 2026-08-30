## Why

`af9fd2fa6` 把项目行「+」的贴点小弹窗（anchored popover）改成了整高抽屉（`sidebar-workspace-drawer`，覆盖整个侧栏列、内容从顶部开始）。产品所有者与外部用户反馈：抽屉盖住侧栏、「项目在下面、还得移到上面开会话」，鼠标行程与注意力都被拉长。本 change 恢复旧交互，但**不做 git revert**——`af9fd2fa6` 同捆的防卡死修复（见「不可回退清单」）必须全部保留。

关键事实（降低恢复成本，均已核实）：

- hook 层 `resolveWorkspaceMenuPosition`（`useSidebarMenus.ts`，328×420 估算 + 12px 视口钳制）与 `workspaceMenuState.x/y` 在 HEAD 完整保留，抽屉只是没消费；
- 旧弹窗 CSS `.sidebar-workspace-menu`（≤332px 宽 / `min(68vh, 460px)` 高 / 透明 backdrop）仍在 `sidebar.css`，文件夹小弹窗（`WorkspaceSessionFolderTree`）一直在共用；
- 创建流 `runCreateSessionFlow` 在弹窗→抽屉之间零改动（`docs/analysis/2026-08-29-new-session-drawer-freeze-incident-handoff.md` 实证），交互层回退不触碰创建链路。

## What Changes

**1. `useSidebarMenus.ts` — 单组化 `buildSessionMenuGroups`**

- Shared CLI / Native CLI 双组收敛回旧版单组 `{ id: "new-session", label: t("sidebar.sessionActionsGroup"), actions }`（无 `hint` / `helpTip` / `collapsible`）。
- `sharedEngineActions`（含 Qoder Global/CN 直入行、per-engine meta、`providerProfileId` 透传）整体挂为 `new-session-shared` 首行的 `children`；该行恢复旧版定义（`iconKind: "new-shared"`、`submenuOnly: true`、`unavailable: !onAddSharedAgent`、no-op `onSelect`）。
- 增量：shared 子行把 `selectedChildLabel` 映射到 `badgeLabel`，让「记住的供应商」在 flyout 里仍可见（旧版无此信息，纯增量）。

**2. `SidebarWorkspaceMenuOverlay.tsx` — 抽屉壳改回贴点弹窗壳（body 不动）**

- 删 `isSwappedSidebarLayout` / `isWindowsDesktopHost` / `measureSidebarFitWidth`、drawer header + X 按钮、`sidebar-workspace-drawer-body` 包装与 `--sidebar-drawer-fit-width` 注入。
- 恢复根节点 `.sidebar-workspace-menu` + `style={{ left: menu.x, top: menu.y }}`，backdrop 换回透明 `.sidebar-workspace-menu-backdrop`；aria-label 保留工作区名（`新建会话 · <workspace>`）。
- body 全部保留：分组渲染（含折叠持久化 `useSidebarWorkspaceMenuSectionCollapse`）、`refreshing` busy 态、`disabled={unavailable && !children.length}` 门控、`selectedChildLabel`、pin checkbox、per-row refresh、二级 flyout 定位（左右自适应 + 视口钳制）、ArrowRight 键盘路径、portal。

**3. `sidebar.css` — 删除 `.sidebar-workspace-drawer*` 全套**（backdrop / 抽屉壳 / is-swapped / is-windows / header / title / close / body / 组间距覆盖 / 3 组 keyframes / reduced-motion 分支）。`.sidebar-workspace-menu` 弹窗样式不动。

**4. i18n 零改动**：`sidebar.nativeCliGroupLabel` / `sharedCliHint` 等 key 变为未引用但保留，10 个语言文件不动。

## 不可回退清单（`af9fd2fa6` 及之后的逻辑层修复，本次全部保留）

| 修复 | 位置 | 与 UI 形态的关系 |
| --- | --- | --- |
| Qoder Global/CN 直入行（替代二级发行版弹层） | `useSidebarMenus.ts` | 保留在 Shared CLI 子菜单 |
| Shared 创建 `providerProfileId` 透传 + resolver 优先级 | `resolveSharedSessionCreateInitialTarget.ts` | 逻辑层，不动 |
| 引擎切换 15s 守卫 + per-engine 检测 | `useEngineController.ts` | 逻辑层，不动 |
| 检测单飞 + 25s 守卫 + failed 态 | `engineDetectionCoordinator.ts` / `appServer.ts` | 逻辑层，不动 |
| 创建 loading 弹窗 45s 上限 | `loadingProgressActions.ts` | 逻辑层，不动 |
| reload busy 态（`refreshing` / `sessionIndexOnly`） | `useSidebarMenus.ts` / `useThreadActions.ts` | 模型层，弹窗继续渲染 |
| vendor 删除后「新建菜单记忆」回退 | `lastProviderProfileMemory.ts` | 逻辑层，不动 |
| unavailable 父行仍可开子菜单（children 门控） | overlay 渲染层 | 弹窗继续实现 |
| Rust 侧全部（client_storage / pi_history / writers / menu） | `src-tauri/**` | 不动 |

## 验收标准

- 项目行「+」与右键在点击坐标处弹出 ≤332px 小弹窗（非整高抽屉、非暗色遮罩）；文件夹「+」、worktree「+」同构。
- 弹窗内单组「新建会话」：Shared CLI 首行悬停/点击展开 flyout（引擎直点创建，Qoder Global/CN 直入）；各 Native 引擎行悬停展开供应商 flyout。
- 弹窗靠近视口右缘时 flyout 自动翻转到左侧；Escape / 透明 backdrop 点击关闭；折叠持久化继续生效。
- 目标 Vitest（`SidebarWorkspaceMenuOverlay` / `useSidebarMenus` / `Sidebar` / `Sidebar.session-folders` / `Sidebar.styles`）除登记存量基线外全绿；`npm run typecheck` 通过。

## Impact

- Frontend：`src/features/app/hooks/useSidebarMenus.ts`、`src/features/app/components/SidebarWorkspaceMenuOverlay.tsx`、`src/styles/sidebar.css`、三个测试文件 + `Sidebar.test-utils.tsx`。
- `Sidebar.tsx` 本体零改动（渲染调用与 props 不变）；Rust 零改动；i18n 零改动。
- 回滚：本 change 自身可整体 revert，无数据/契约影响。
