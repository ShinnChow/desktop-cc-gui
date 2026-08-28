# editable-workspace-diff-review-surface Delta

## ADDED Requirements

### Requirement: Preview Modal MUST Recover Missing Diff Per-File

系统 MUST 为 git 更改面板的预览弹窗提供单文件 diff 兜底：当批量 diff 列表（`get_git_diffs`）中目标文件缺失或 diff 内容为空时，弹窗 MUST 经单文件命令（`get_git_file_full_diff`，多仓场景携带 scoped `repositoryRoot`）重新取回该文件 patch，MUST NOT 在未尝试兜底前直接展示不可用占位。

#### Scenario: bulk list missing the clicked file recovers via per-file diff

- **WHEN** 用户点开某文件的预览弹窗而批量 diff 列表不含该文件（列表截断、加载失败或时序落后）
- **THEN** 系统 MUST 展示加载态并调用 `get_git_file_full_diff` 取回单文件 patch
- **AND** 取回内容非空时弹窗 MUST 渲染该 diff，且在 status 统计为 0 时 MUST 以 patch 行数推导头部 `+N/-N`

#### Scenario: stale fallback cannot mutate a newer preview session

- **WHEN** 兜底请求在途期间用户关闭弹窗或打开另一文件
- **THEN** 过期响应 MUST 被丢弃，MUST NOT 复活已关闭弹窗或污染新目标

#### Scenario: healthy bulk list must not trigger the fallback

- **WHEN** 批量 diff 列表已含目标文件且 diff 内容非空
- **THEN** 系统 MUST 直接渲染且 MUST NOT 调用单文件兜底命令

### Requirement: Empty Textual Diff MUST NOT Read As Failure

当兜底取回确认文件存在但无文本级差异（例如 Windows `core.autocrlf` 行尾幻影修改：status 报 M 而内容过滤后与索引一致）时，系统 MUST 展示明确的「没有文本差异」文案，MUST NOT 复用「差异不可用」失败文案，也 MUST NOT 停留在加载态。

#### Scenario: line-ending-only modification shows no-text-changes

- **WHEN** 用户点开一个 status 为 M 但 diff 内容与单文件兜底结果均为空的文件
- **THEN** 弹窗 MUST 展示 `git.diffNoTextChanges` 文案
- **AND** MUST NOT 展示 `git.diffUnavailable`

#### Scenario: fallback failure keeps the existing unavailable semantics

- **WHEN** 单文件兜底命令调用失败（reject/throw）
- **THEN** 弹窗 MUST 展示既有 `git.diffUnavailable` 占位
- **AND** 批量列表后续刷新到该文件内容时弹窗 MUST 恢复正常渲染（自愈语义保留）
