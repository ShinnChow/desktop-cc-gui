## 1. Spec

- [x] 1.1 `specs/file-view-git-blame/spec.md` delta：MODIFIED「File view Git Blame MUST be explicitly activated」，补 footer toggle 三个场景（展示/状态/不可用隐藏）

## 2. Implementation

- [x] 2.1 `FileViewPanel.tsx`：提取 `gitBlameActionLabel`，右键菜单项与 footer 按钮共用；footer 右侧按钮群最左插入 `fvp-git-blame-toggle`
- [x] 2.2 `file-view-panel.css`：`.fvp-git-blame-toggle` 的 `is-active` / `is-error` 样式

## 3. Tests

- [x] 3.1 `FileViewPanel.git-blame.test.tsx`：新增 footer 按钮可点击切换 blame、不可 blame 文件不渲染两个用例

## 4. Validation

- [x] 4.1 目标 Vitest 全绿（`FileViewPanel.git-blame.test.tsx` 16/16；全套 FileViewPanel 152 中 150 过，2 个失败为 HEAD 既有，见下方备注）
- [x] 4.2 `npm run typecheck` 通过（touched scope 无报错；现存 3 个报错位于 Sidebar/SettingsView 测试，非本变更文件）
- [x] 4.3 `openspec validate file-footer-git-blame-toggle --strict` 通过

> 备注：`FileViewPanel.open-in-browser.test.tsx` 2 个用例在 HEAD 临时 worktree 复测同样失败，属既有问题，与本变更无关，未纳入修复范围。
