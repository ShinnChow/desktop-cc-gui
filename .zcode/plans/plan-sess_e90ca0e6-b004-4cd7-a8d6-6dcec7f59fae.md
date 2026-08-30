# 恢复「新建会话」贴点小弹窗（去抽屉化，保留全部隐藏 BUG 修复）

## 背景与结论

`af9fd2fa6` 把项目行「+」的贴点小弹窗改成了整高抽屉（与防卡死修复同捆提交）。用户与外部反馈：抽屉盖住整个侧栏、内容从顶部开始，项目在侧栏下方、鼠标得向上跑。目标：**恢复旧交互**（贴点小弹窗 + 单组「新建会话」+ Shared CLI 首行二级菜单），但不 git revert——`af9fd2fa6` 前后的逻辑层修复全部保留。

已核实的关键事实（降低恢复成本）：
- hook 的 `resolveWorkspaceMenuPosition`（`useSidebarMenus.ts:2068`，328×420 估算 + 12px 视口钳制）与 `workspaceMenuState.x/y` 在 HEAD 完整保留，抽屉只是没消费它们 → **hook 打开链路几乎不用动**
- 旧弹窗 CSS `.sidebar-workspace-menu`（≤332px 宽 / `min(68vh,460px)` 高 / 透明 backdrop）仍在 `sidebar.css:1025-1065`（文件夹小弹窗共用）→ **弹窗样式零新增**
- 创建流（`runCreateSessionFlow`）在弹窗→抽屉之间零改动（交接文档实证）→ 交互层回退不触碰创建链路

## 改动清单

### 1. `src/features/app/hooks/useSidebarMenus.ts` — 单组化（约 ±40 行）

`buildSessionMenuGroups`（L2013-2046）双组收敛回旧版单组：

- 返回 `[{ id: "new-session", label: t("sidebar.sessionActionsGroup"), actions }]`，无 hint/helpTip/collapsible（与旧版一致）
- `sharedEngineActions`（L1659-1710，**整体保留**：per-engine meta、Qoder Global/CN 直入行、`providerProfileId` 透传、可见性过滤）整体挂为 `new-session-shared` 首行的 `children`
- 该首行恢复旧版定义：`iconKind: "new-shared"`、`submenuOnly: true`、`unavailable: !onAddSharedAgent`、`onSelect: noop`
- 小增强：shared 子行把 `selectedChildLabel` 映射到 `badgeLabel`，让「记住的供应商」在 flyout 里仍可见（子行渲染器显示 badgeLabel；旧版无此信息，纯增量）
- 保留不动：`handleCreatedSession`（targetFolderId 归夹）、fire-and-forget `requestEngineDetection({source:"menu-open"})`、`resolveWorkspaceMenuPosition` 调用

### 2. `src/features/app/components/SidebarWorkspaceMenuOverlay.tsx` — 抽屉壳 → 贴点弹窗壳（约 ±80 行，body 不动）

删：`isSwappedSidebarLayout` / `isWindowsDesktopHost` / `measureSidebarFitWidth` 三个 helper、drawer header + X 按钮、`sidebar-workspace-drawer-body` 包装、全部 drawer 类名与 `--sidebar-drawer-fit-width` 注入、`X` icon import。

恢复：根节点 `className="sidebar-workspace-menu"` + `style={{ left: menu.x, top: menu.y }}`；backdrop 换回透明 `.sidebar-workspace-menu-backdrop`。aria-label 保留工作区名（`新建会话 · <ws>`）。

body 全部保留：分组渲染（含折叠持久化 hook `useSidebarWorkspaceMenuSectionCollapse`）、`refreshing` busy 态（b9f15f4e0 修复）、`disabled={unavailable && !children.length}` 门控（70f06cc85 修复）、`selectedChildLabel`、pin checkbox、per-row refresh、二级 flyout 定位（左右自适应 + 视口钳制）、ArrowRight 键盘路径、portal 到 body。`SUBMENU_MAX_HEIGHT` 保持 640。

### 3. `src/styles/sidebar.css` — 删抽屉块（约 -150 行，纯删除）

删 `.sidebar-workspace-drawer*` 全套（L1067-1219：backdrop / 抽屉壳 / is-swapped / is-windows / header / title / close / body / 组间距覆盖 / 3 组 keyframes / reduced-motion 分支）及该块的引导注释。`.sidebar-workspace-menu` 弹窗样式（L1025-1065）不动。只删这一个连续块，**不做全文件重排**（Format Discipline Gate）。

### 4. i18n — 零改动

`nativeCliGroupLabel` / `sharedCliHint` 等 key 变为未引用但保留，10 个语言文件不动（避免 parity 风险与噪音 diff）。

### 5. 测试更新（约 ±120 行）

- `SidebarWorkspaceMenuOverlay.test.tsx`：
  - 删「drawer header + close button」「swapped drawer 从右侧滑出」两用例；新增贴点定位用例（`.sidebar-workspace-menu` + `style.left/top === menu.x/y`）
  - 「Shared CLI flat rows in own group」改写：submenuOnly 父行 → flyout 子行点击触发 `onAction(child)`
  - 其余全部保留（折叠持久化、busy reload、flyout 左/右定位、ArrowRight、portal、unavailable 父行仍可开子菜单）
- `Sidebar.test.tsx`：
  - L1411 backdrop 选择器 `.sidebar-workspace-drawer-backdrop` → `.sidebar-workspace-menu-backdrop`
  - L1364-1432 折叠持久化用例：改折叠 `workspace-actions` 组（单组不再 collapsible）
  - L3493-3501：shared 分组行点击 → 改为点 Shared CLI 父行展开 flyout 再点 Claude Code 子行
- `useSidebarMenus.test.tsx`：约 5 处 `groups.find(id==="new-session-shared")?.actions` → `groups.find(id==="new-session")?.actions.find(id==="new-session-shared")?.children`（L634-663、L2703-2759、L2929-2944）；断言语义不变（id 列表、selectedChildLabel 同源、qoder-cn `providerProfileId` 透传）；删双组 hint/helpTip 断言（L637-639）

### 6. OpenSpec 轻量 change（仓库 gate 要求）

新建 `openspec/changes/restore-sidebar-anchored-session-menu/`（proposal.md + tasks.md，中英结合体例），登记进 `openspec/changes/README.md` 索引。proposal 写明「不可回退清单」。不命中基石文档「更新触发器」（纯前端呈现层），无需 ADR 回写。

### 7. 验证

- `npx vitest run` 目标五文件（Overlay / useSidebarMenus / Sidebar / Sidebar.session-folders / Sidebar.styles）
- `npm run typecheck`
- `git diff --stat` 自查格式化噪音
- 手工验收（`npm run tauri dev`）：项目行「+」与右键弹出贴点小弹窗、文件夹「+」、worktree「+」、Escape/backdrop 关闭、Shared CLI 悬停 flyout、Qoder Global/CN 直点创建

## 明确不动（防丢隐藏 BUG 修复）

`useEngineController.ts`（15s 切换守卫 + per-engine 检测）、`engineDetectionCoordinator.ts`（单飞 + 失败态）、`loadingProgressActions.ts`（45s 上限）、`resolveSharedSessionCreateInitialTarget.ts`、Rust 侧全部（client_storage / pi_history / writers / menu）、`WorkspaceCard` / `WorktreeCard` / `WorkspaceSessionFolderTree` 入口按钮、`Sidebar.tsx` 本体（渲染调用与 props 完全不变）。

预估 diff：hook ~40 行、overlay ~80 行、css ~150 行删除、测试 ~120 行、openspec 新增 2 文件。