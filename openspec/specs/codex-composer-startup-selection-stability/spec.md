# codex-composer-startup-selection-stability Specification

## Purpose

Defines the codex-composer-startup-selection-stability behavior contract, covering Codex Thread-Scoped Composer Selection MUST Wait For A Ready Workspace Catalog.
## Requirements
### Requirement: Codex Thread-Scoped Composer Selection MUST Wait For A Ready Workspace Catalog

当 Codex composer 使用线程作用域时，系统 MUST 仅在当前 workspace 的模型 catalog 已经可判定后，才校验或修复线程级 model / reasoning effort。

#### Scenario: startup thread selection is not repaired against a stale built-in catalog
- **WHEN** 应用冷启动进入一条已有 Codex 线程
- **AND** 线程级 composer selection 已经持久化了合法的 model / effort
- **AND** workspace 模型 catalog 仍在恢复过程中
- **THEN** 系统 MUST NOT 基于落后一帧的 built-in catalog 把该线程选择修回默认模型
- **AND** 线程级选择 MUST 等到 workspace catalog ready 后再做有效性判定

### Requirement: Invalid Codex Thread Selection MUST Converge To A Valid Effective Selection

当线程级 Codex composer selection 已失效、模型已不存在或 reasoning effort 不再被当前模型支持时，系统 MUST 将其收敛到有效的 model / effort，而不是把坏值继续透传到 UI 或发送链。

#### Scenario: invalid stored thread model is repaired to a valid effective model
- **WHEN** 某条 Codex 线程恢复出的 `modelId` 已不存在于当前 workspace 可选模型列表
- **THEN** 系统 MUST 回退到当前有效的全局 Codex model 或默认 Codex model
- **AND** 后续线程级持久化 MUST 写回该有效 model

#### Scenario: invalid stored effort falls back to a valid effort for the effective model
- **WHEN** 某条 Codex 线程恢复出的 `effort` 不在当前有效 model 支持的 reasoning options 中
- **THEN** 系统 MUST 回退到该 model 的默认或首个有效 effort
- **AND** 发送链 MUST 使用收敛后的有效 effort，而不是原始坏值

### Requirement: Pending-To-Canonical Codex Thread Migration MUST Preserve Thread Selection Stability

当 Codex 线程 id 从 `codex-pending-*` finalize 为 `codex:*` 时，系统 MUST 保持该线程的 composer selection 稳定，不得在迁移期被全局默认值或启动 fallback 重新覆盖。

#### Scenario: pending thread finalize keeps the same effective selection
- **WHEN** 当前活动线程从 `codex-pending-*` finalize 到 canonical `codex:*`
- **AND** 该线程已有线程级 composer selection
- **THEN** finalize 后的线程 MUST 继续解析到同一组有效 model / effort
- **AND** 系统 MUST NOT 因 scope 变化重新回退到全局默认 model / effort

### Requirement: Global Composer Defaults MUST Persist Only Effective Values

当无活动线程时，系统 MUST 仅将校验后的有效 Codex model / effort 持久化为全局 composer 默认值，不得在冷启动首帧把坏值、空值或暂时未恢复的 state 写回 settings。

#### Scenario: cold start without an active thread does not clear global defaults
- **WHEN** 应用冷启动且当前没有活动线程
- **AND** app settings 中上次保存的 global composer model / effort 已失效或为空
- **AND** workspace 模型 catalog 仍处于恢复阶段
- **THEN** 系统 MUST 等到全局选择 ready 后才持久化
- **AND** 持久化结果 MUST 是当前有效的 Codex model / effort，而不是 `null` 或坏值

### Requirement: AppShell Startup Regression Coverage MUST Exercise Real Selection Recovery Paths

系统 MUST 提供 AppShell 级启动回归测试，覆盖线程选择恢复、无活动线程默认值恢复、无效线程选择自愈以及 `pending -> canonical` 迁移，而不只依赖局部纯函数测试。

#### Scenario: startup regression tests cover thread restore and finalize migration
- **WHEN** 开发者为 Codex composer 线程作用域调整启动恢复逻辑
- **THEN** 回归测试 MUST 至少覆盖已有线程选择恢复、无活动线程默认值恢复、无效线程选择自愈和 `pending -> canonical` finalize 四类路径
- **AND** 这些测试 MUST 在 AppShell 级挂载链路中验证，不得仅停留在 isolated helper 测试

### Requirement: Codex Startup Selection Repair MUST Be Idempotent

当 Codex composer startup selection repair 在 AppShell 首屏恢复期间运行时，系统 MUST 在逻辑值未变化时复用 previous state reference，并且不得因等价 selection、等价 catalog 或等价 reasoning effort 反复触发 React state updates。**此外，账本尚未同步到当前线程（切换窗口）时，repair MUST NOT 把 stale 账本值写进目标线程持久账本。**

#### Scenario: equivalent repair result does not enqueue a new state reference

- **WHEN** 应用冷启动进入已有 Codex 线程
- **AND** persisted thread selection 的 effective `modelId` 与 `effort` 已经等价于本轮 repair 结果
- **THEN** selection repair updater MUST return the previous state reference
- **AND** AppShell startup MUST NOT throw React `Maximum update depth exceeded`

#### Scenario: catalog recovery does not repeatedly rewrite equivalent selection

- **WHEN** workspace model catalog 从恢复中变为 ready
- **AND** 当前 thread-scoped selection 在恢复前后解析到同一 effective model / effort
- **THEN** 系统 MUST NOT repeatedly persist equivalent selection values
- **AND** 后续 render MUST converge without entering an update loop

#### Scenario: invalid selection still converges exactly once

- **WHEN** persisted thread selection 引用了当前 catalog 中不存在的 model 或不支持的 effort
- **THEN** 系统 MUST 将 selection 修复为有效 model / effort
- **AND** 修复完成后相同输入的下一轮 repair MUST reuse the previous state reference

#### Scenario: repair does not write during the thread-switch window

- **WHEN** 用户从 Codex 会话 A 快速切换到 Codex 会话 B
- **AND** 账本归属标志尚未同步到 B（selectedComposerSelection 仍是 A 的值）
- **THEN** repair MUST NOT 把 A 的 effective selection 写进 B 的持久账本
- **AND** 账本归属标志与 activeThreadId 一致后，repair MUST 恢复正常的幂等收敛语义

### Requirement: Composer Startup Selection Recovery MUST Have An Acyclic Update Trigger

AppShell composer selection recovery MUST NOT subscribe to a React cache state that the same recovery effect writes. Internal cache hydration MAY notify resolver consumers, but that notification MUST NOT re-trigger the same reload solely because its own cache write changed reference identity.

#### Scenario: persisted selection hydration converges without self-trigger
- **WHEN** startup reload hydrates a persisted thread selection into the in-memory cache
- **THEN** the cache MAY publish one logical state change
- **AND** that cache write MUST NOT by itself invoke another reload cycle

#### Scenario: equivalent cache value is a no-op
- **WHEN** startup recovery resolves a selection logically equal to the current cache entry
- **THEN** the system MUST reuse the previous cache state reference
- **AND** the system MUST NOT rewrite the persisted value

### Requirement: Readiness And Pending Finalization MUST Preserve Continuous Selection

When engine defaults become ready while a pending thread is being finalized, selection seed, migration and reload MUST converge in a deterministic order. The canonical thread MUST inherit the pending selection before its active selection is published.

#### Scenario: readiness and finalize occur in the same startup window
- **WHEN** `engineDefaultSelectionReady` changes from false to true for an active pending thread
- **AND** that pending identity finalizes to a matching canonical thread before startup settles
- **THEN** the canonical thread MUST resolve to the seeded pending selection
- **AND** the published active selection MUST NOT transiently become `null`
- **AND** AppShell MUST NOT throw React `Maximum update depth exceeded`

#### Scenario: StrictMode replays startup effects
- **WHEN** React StrictMode replays selection recovery effects during cold startup
- **THEN** selection storage writes MUST remain idempotent
- **AND** the hook MUST converge within a bounded number of renders

### Requirement: Production Render Diagnostics MUST Use Public Mutation APIs

The production render diagnostics controller MUST use React Scan's public configuration API for enable/disable mutations and MUST NOT directly assign non-public instrumentation signals during App bootstrap.

#### Scenario: persisted diagnostics flag enables React Scan
- **WHEN** startup diagnostics are enabled by the persisted application flag
- **THEN** the controller MUST enable instrumentation through `scan({ enabled: true })`
- **AND** the controller MUST NOT assign `ReactScanInternals.instrumentation.isPaused.value`

