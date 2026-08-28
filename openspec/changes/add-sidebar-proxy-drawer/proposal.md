# Proposal: add-sidebar-proxy-drawer

## Why

网络代理目前埋在「设置 → 基础行为」的深层区域，用户无法从侧栏设置菜单快速发现和调整。需要在截图所示的设置菜单中提供直接入口，同时避免再打开一层 modal。

## What Changes

- 在侧栏设置菜单新增带 `RailSymbol`（梯子）icon 的「网络代理」项。
- 点击该项关闭菜单并从侧栏右侧展开非 modal drawer；drawer 提供启用开关、代理地址编辑和保存。
- 新装/尚未配置代理地址时，输入框默认显示 `http://127.0.0.1:7890`。
- 复用现有 settings persistence 与启用/禁用即时应用语义；从原「基础行为」区域移除重复的代理配置卡。

## Impact

- Affected UI: `SidebarSettingsMenu`, `Sidebar`, proxy settings surface and sidebar styles.
- Affected state path: AppShell layout-node props will expose the existing app-settings save path to the sidebar drawer; no backend settings schema change.
- Affected spec: `workspace-sidebar-settings`.
