# Change: fix-right-topbar-window-drag-region

## Why

右侧 panel toolbar 顶部被整体标记为 `no-drag`，导致按钮之间的空白区域无法拖动 desktop window，与左侧和中间 titlebar 行为不一致。

## What Changes

- `.right-panel-toolbar` 成为真实 Tauri drag region。
- `PanelTabs`、Git mode slot 与具体 buttons 保持 `data-tauri-drag-region="false"`，确保交互不被拖拽吞掉。
- 增加结构测试，锁定 draggable container 与 interactive child 的边界。

## Acceptance

- macOS 与 Windows 上右侧 toolbar 空白区域可拖动窗口。
- 文件、Git、刷新、更多等 controls 仍可点击。
- 不新增固定高度 overlay 或临时遮罩。
