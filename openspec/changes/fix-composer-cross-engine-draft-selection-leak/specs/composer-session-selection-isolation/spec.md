## ADDED Requirements

### Requirement: Draft Selection Carry MUST NOT Cross Engines

当离开一条会话产生的 composer draft selection 被应用到下一条 `-pending-*` 会话时，系统 MUST 校验来源线程与目标线程的引擎一致性；双方引擎均可解析且不相等时 MUST 拒绝应用，目标会话回落自身引擎的选择播种（引擎偏好 / catalog 默认）。

#### Scenario: Claude draft must not seed a Codex pending session

- **WHEN** 用户在 `claude:*` 会话选定某模型后回到无活动线程状态，产生 draft selection
- **AND** 下一条激活的线程是 `codex-pending-*`
- **THEN** 系统 MUST NOT 把该 draft 写入 Codex 线程的选择账本
- **AND** 该 Codex pending 会话 MUST 使用 Codex 自身的选择来源（全局选择 / 引擎偏好 / catalog 默认）

#### Scenario: same-engine draft carry keeps working

- **WHEN** draft selection 的来源线程与目标 pending 线程解析为同一引擎
- **THEN** 系统 MUST 维持既有放行行为，draft 写入目标 pending 账本并生效

#### Scenario: unknown-source or unknown-engine drafts keep legacy behavior

- **WHEN** draft 产自无线程状态（Home 点选），或来源 / 目标任一线程 id 无法解析出引擎（如 Shared、无前缀本地 id）
- **THEN** 系统 MUST 保持既有放行语义，不因本门禁拒绝应用
