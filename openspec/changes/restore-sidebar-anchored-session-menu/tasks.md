## 1. Implementation

- [x] 1.1 `useSidebarMenus.ts`：`buildSessionMenuGroups` 双组收敛回单组；`sharedEngineActions` 挂为 `new-session-shared` 首行 `children`（`submenuOnly` + `iconKind: "new-shared"` + `unavailable: !onAddSharedAgent`）；shared 子行 `selectedChildLabel` → `badgeLabel` 透出
- [x] 1.2 `SidebarWorkspaceMenuOverlay.tsx`：删 drawer 壳（三个 helper / header / X 按钮 / body 包装 / fit-width 注入 / `X` import）；根节点恢复 `.sidebar-workspace-menu` + `left/top` 贴点定位；backdrop 换回透明 `.sidebar-workspace-menu-backdrop`；body（折叠持久化 / busy / 门控 / flyout / ArrowRight / portal）不动
- [x] 1.3 `sidebar.css`：删 `.sidebar-workspace-drawer*` 全套（~150 行）；`.sidebar-workspace-menu` 弹窗样式不动

## 2. Tests

- [x] 2.1 `SidebarWorkspaceMenuOverlay.test.tsx`：删「drawer header close」「swapped drawer」两用例；新增贴点定位 + backdrop 关闭用例；「Shared flat rows」改写为 submenuOnly 父行 → flyout 子行触发
- [x] 2.2 `Sidebar.test.tsx`：backdrop 选择器改回 `.sidebar-workspace-menu-backdrop`；折叠持久化用例改折叠 `workspace-actions` 组；文件夹「+」建 shared 会话用例改为父行 → flyout 子行点击（子行名含 badgeLabel 用正则匹配）；`Sidebar.test-utils.tsx` 补 `sidebar.newSharedSession` 翻译
- [x] 2.3 `useSidebarMenus.test.tsx`：5 处 shared 断言从「独立分组 actions」改为「单组内 `new-session-shared` 父行 children」；补充全引擎下单组 id 序断言；「全停用无 shared 分组」断言改为单组 id 列表

## 3. Validation

- [x] 3.1 `SidebarWorkspaceMenuOverlay.test.tsx` 13/13 + `useSidebarMenus.test.tsx` 55/55 绿
- [x] 3.2 `Sidebar.test.tsx` 66/67（1 失败 = 存量基线「Sidebar refresh 1」，stash 干净 HEAD 复核同样失败）；`Sidebar.styles.test.ts` 绿；`Sidebar.session-folders.test.tsx` 3 失败 = 存量基线（交接文档已登记）
- [x] 3.3 `npm run typecheck` 通过
- [ ] 3.4 手工验收（`npm run tauri dev`）：项目行「+」/右键/文件夹「+」/worktree「+」弹贴点小弹窗；Shared CLI flyout；视口右缘翻转；Escape/backdrop 关闭
