# Tasks: fix-git-preview-modal-diff-fallback

## 1. RED：失败测试先行

- [x] 1.1 新增 `src/features/git/components/GitDiffPanel.previewFallback.test.tsx`：
  - 批量 `diffEntries` 缺失被点文件时，弹窗 MUST 调用 `get_git_file_full_diff` 并用取回 patch 渲染 surface；status 统计为 0 时头部 stats MUST 从 patch 推导（+2/-0）
  - entry 存在但 diff 为空、兜底取回为空字符串 → 展示 `git.diffNoTextChanges`，MUST NOT 展示 `git.diffUnavailable`、MUST NOT 停在 loading
  - 兜底取回 reject → 回落既有 `git.diffUnavailable` 语义（含 console.error）
  - 批量列表已有内容 → MUST NOT 调用 `get_git_file_full_diff`（Mac 安全守护）
- [x] 1.2 运行目标测试确认全红（2 红 2 绿：新行为红、既有语义绿）

## 2. GREEN：实现

- [x] 2.1 `GitDiffPanel.tsx`：`PreviewFileState` 增 `fallbackDiffEntry` / `fallbackResolvedEmpty`；`previewDiffEntry` 优先取兜底 entry
- [x] 2.2 `GitDiffPanel.tsx`：`resolvePreviewRepositoryRoot` + `loadPreviewFallbackDiff`（requestId + 目标身份双重过期丢弃；空→resolvedEmpty、失败→回落）
- [x] 2.3 单仓 `handleOpenFilePreview`：entry 缺失或 diff 为空时置 loading 并触发兜底；多仓 `handleOpenRepositoryFilePreview`：scoped 结果缺失/空内容时同链路兜底
- [x] 2.4 弹窗 body 三态占位：surface（有内容/图片）→ loading → `git.diffNoTextChanges` → `git.diffUnavailable`
- [x] 2.5 头部 stats：status 统计全 0 且 entry 有内容时以 `countDiffStats` 推导
- [x] 2.6 `src/i18n/locales/*/git.ts` ×10 新增 `diffNoTextChanges`（插在 `diffUnavailable` 之后，各 1 行）

## 3. 回归与验证

- [x] 3.1 `npx vitest run src/features/git/`：263 通过；8 个失败经 stash 对照确认为存量（worktree 在途 pi/qoder engine registry 改动与多仓测试漂移所致，与本 change 基线一致）
- [x] 3.2 `tsc --noEmit` 对本次涉及文件零错误
- [x] 3.3 eslint 对 `GitDiffPanel.tsx` / 新测试 / locale 样本零告警；`git diff --stat` 确认无格式化噪音（locale 各 1 行、GitDiffPanel.tsx 121+/11-）

## 4. 收口

- [x] 4.1 真机验收（用户执行）：Windows 更改面板点开 untracked 真实变更文件应显示 diff 与真实 `+N/-N`；点开 CRLF 幻影 M 文件应显示「没有文本差异（可能仅为换行符差异）。」；Mac 回归点开任意文件行为与修复前一致（2026-08-29 用户真机验收通过）
- [ ] 4.2 真机验收通过后归档本 change（不命中基石文档更新触发器，无需 ADR 校准回写）
