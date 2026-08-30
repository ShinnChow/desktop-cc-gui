## Why

Git Blame（及其附带的 changed-line 背景标注）目前唯一的入口是「右键 → Git actions → Git Blame」，入口太深，用户几乎不会发现。`2026-07-22-fix-file-editor-git-marker-load-race` 确立的 lazy 契约（ordinary open 不拉 blame/diff）本身合理、保留；问题只在入口可发现性。把 Git Blame 做成文件面板底部状态栏的常驻切换按钮，让 lazy 契约有一个可见的触发点。

## 目标与边界

- 在 `fvp-footer` 右侧按钮群最左（编辑/预览 eye 按钮左侧，即用户截图箭头位置）新增 Git Blame 切换按钮。
- 按钮复用现有 lazy 契约：点击才调用 `useFileGitBlame.toggle()`，不引入任何 eager 加载。
- 状态语义与既有右键菜单项完全一致（Enable / Disable / Loading / Stale / Error），`aria-pressed` 表达 enabled，不靠颜色单通道传达状态。
- 非目标：不改变 blame 加载时机、不改变 changed-line markers 的 blame 门控、不改右键菜单与快捷键（Alt+Shift+B）、不新增 i18n key（复用 `files.gitBlame*`）。

## What Changes

- `FileViewPanel` footer 右侧新增 `fvp-git-blame-toggle` 按钮；提取 `gitBlameActionLabel` 供 footer 与右键菜单共用，消除状态文案重复。
- `file-view-panel.css` 增加 `.fvp-git-blame-toggle` 的 active / error 弱状态样式。

## 验收标准

- eligible 文件（edit mode）打开后，footer eye 按钮左侧可见 Git Blame 按钮；点击后 blame gutter 加载，按钮转为 active/pressed。
- loading / stale / error 状态下 tooltip 与 accessible label 同步变化；blame 不可用的文件不渲染按钮。
- 右键菜单项行为不变；普通打开仍不产生 blame/diff IPC。
- 目标 Vitest、typecheck、strict OpenSpec validation 通过。

## Impact

- Frontend：`src/features/files/components/FileViewPanel.tsx`、`src/styles/file-view-panel.css`、`FileViewPanel.git-blame.test.tsx`。
- 性能：零新增 IPC 路径；按钮只是既有 `gitBlame.toggle` 的可见入口。
- 回滚：删除按钮与样式即可，无数据/契约影响。
