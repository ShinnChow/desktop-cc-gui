# Change: fix-git-preview-modal-diff-fallback

## Why

2026-08-29 用户实测反馈（win11）：更改面板点开文件的 diff 弹窗显示「差异不可用。」且 `+0/-0`（截图：`openspec/changes/perf-cold-start-click-storm-convergence/proposal.md`），同一场景在 Mac 不出现。

根因（代码链路 + 本机 libgit2 探针实证）：

1. **弹窗唯一数据源是批量 diff 列表**。`GitDiffPanel` 预览弹窗只在 `diffEntries`（`get_git_diffs` 批量结果）里按路径查找，找不到或内容为空就直接渲染 `git.diffUnavailable`，**没有任何单文件恢复路径**——尽管 `get_git_file_full_diff` 命令本就存在。批量列表被 2MB/200 文件预算截断、加载失败或加载时序落后时，用户点任何受影响文件都必然「差异不可用」，且不随刷新自愈（列表级失败时整批皆不可用）。
2. **Windows 特有的 CRLF 幻影 M 文件类**：`core.autocrlf=true` 的 checkout 上，~116 个仅行尾差异的文件 `git status` 报 M 但 libgit2 diff 内容为空（本机实证：119 status vs 3 个真实内容 diff）。这些文件永久出现在更改列表里、点开必然「差异不可用」；Mac 上无 autocrlf 幻影文件，故「mac 不存在」。
3. **`+0/-0` 头部统计**：`get_git_status` 在 statuses > `GIT_STATUS_DIFF_STATS_FILE_LIMIT`(120) 时跳过 per-file diff stats；Windows 幻影文件把计数顶过阈值后所有文件（含真实变更的 untracked）统计全 0。

## What Changes

- **F1 弹窗单文件兜底**：单仓与多仓预览打开时，若批量列表中该文件缺失或 diff 内容为空，则经 `getGitFileFullDiff`（多仓带 scoped `repositoryRoot`）拉取单文件 patch：内容非空 → 回填弹窗并按 patch 推导头部 `+N/-N`；内容为空 → 展示新文案「没有文本差异（可能仅为换行符差异）」（`git.diffNoTextChanges`）；拉取失败 → 保持既有「差异不可用」语义。请求过期（关闭/换文件）经既有 `scopedPreviewRequestIdRef` + 目标身份比对双重丢弃。
- **F2 空内容语义区分**：弹窗 body 的占位分支按「加载中 / 无文本差异 / 不可用」三态区分；有内容 entry 的渲染路径与自愈（列表后到内容则升级渲染）语义不变。
- **F3 头部统计兜底**：status 统计为 0 且弹窗 diff 内容非空时，用 `countDiffStats` 从 patch 推导 `+N/-N`，消除被 stats-skip 阈值波及文件的 `+0/-0`。
- 平台安全：全部为「批量列表缺内容才触发」的增量兜底；Mac（列表一直有内容）行为不变——由「bulk list 已有内容则不调用兜底」测试守护。Rust 侧不动。

## Capabilities

### Modified Capabilities

- `editable-workspace-diff-review-surface`：
  - ADDED「Preview Modal MUST Recover Missing Diff Per-File」：批量 diff 列表缺失/为空时，预览弹窗 MUST 经单文件 diff 命令兜底，不得直接展示不可用占位。
  - ADDED「Empty Textual Diff MUST NOT Read As Failure」：兜底确认文件无文本级差异（如 autocrlf 行尾幻影修改）时 MUST 展示无文本差异文案，MUST NOT 复用「差异不可用」失败文案。

## Impact

- Affected code：
  - `src/features/git/components/GitDiffPanel.tsx`（F1 兜底加载、F2 三态占位、F3 统计推导）
  - `src/i18n/locales/*/git.ts` ×10（新增 `diffNoTextChanges`）
- 新增测试：`src/features/git/components/GitDiffPanel.previewFallback.test.tsx`（4 例：兜底恢复+统计推导、无文本差异、失败回落既有语义、有内容不触发兜底）
- 行为变更声明：
  1. 批量列表缺失文件的弹窗从「差异不可用」变为真实 diff（恢复类）或「没有文本差异」（幻影类）；失败场景语义不变。
  2. Mac 与一切「列表健康」场景渲染路径不变，仅多一次空内容检查（O(1)）。
- 明确不做：`get_git_status` 幻影 M 文件的列表过滤（保持 git CLI 语义，staging 流依赖完整列表）、Rust `get_git_diffs` 预算参数调整、daemon 侧 `git.rs` 同步改动（前端兜底对两种模式均生效）。
