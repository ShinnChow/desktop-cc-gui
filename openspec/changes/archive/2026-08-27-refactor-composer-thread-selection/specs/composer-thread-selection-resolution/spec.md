# composer-thread-selection-resolution Delta

## ADDED Requirements

### Requirement: 切会话选择解析 MUST 单源于决策核心

切换会话时 Composer 模型/档位默认值的取值规则（线程账本 → 内存 cache → fork 继承 / draft carry / engine default → pending effort 回填，及 thread-id 迁移）MUST 收敛于单一纯函数决策核心（`resolveThreadSelectionOnSwitch`），MUST NOT 在多个 hook / effect 中分散重复实现。

#### Scenario: 切到有账本的会话

- **WHEN** 用户切换到一个此前用过模型的会话
- **THEN** 下拉默认 MUST 显示该会话线程账本记录的模型与档位
- **AND** MUST NOT 被其他会话遗留的全局选择或用户锁覆盖

#### Scenario: 切到无账本的新会话（pending）

- **WHEN** 用户切换到一个从未配置选择的新建会话
- **THEN** 默认值 MUST 按决策核心的优先级取 draft carry（过门禁）或该引擎 durable last-used
- **AND** 已定稿（非 pending）会话 MUST NOT 被 engine default 种入

### Requirement: 账本写入 MUST 经统一入口并携带 epoch 防竞态

线程选择账本的全部写入（点选落盘 / draft 应用 / 迁移 / 继承 / 发送后回写 / catalog 收敛）MUST 经单一写入入口；每次会话切换 MUST 分配单调递增 epoch，携带过期 epoch 的写入 MUST 被丢弃并留 debug 记录。

#### Scenario: 快速切换期间旧会话收敛写入不污染新会话

- **WHEN** 会话 A 的异步收敛写入（如 catalog ready 回写）在用户已切换到会话 B 后到达
- **THEN** 该写入 MUST 因 epoch 过期被丢弃
- **AND** 会话 B 的持久账本 MUST 保持不变

#### Scenario: 同线程内合法晚到写入不被误杀

- **WHEN** 写入到达时 active thread 未变化（epoch 一致）
- **THEN** 写入 MUST 正常应用（epoch 防护仅拦「线程已切走」的写入）

### Requirement: draft carry 门禁 MUST 到 engine + providerProfile 粒度

线程→新会话的 draft 选择携带 MUST 同时校验引擎与 provider profile 一致；同引擎不同 profile（如 Codex managed ↔ 三方配置）间 MUST NOT 互相携带。

#### Scenario: 同引擎跨 profile 不携带

- **WHEN** draft 来源为 Codex managed profile，目标新会话绑定三方 profile
- **THEN** draft MUST NOT 应用到目标会话

### Requirement: 用户选择锁生命周期 MUST 与会话切换对齐

useModels 层的用户模型锁 MUST 在会话切换时清理；锁残留 MUST NOT 以「用户显式选择」身份压过目标会话的线程账本。

#### Scenario: 切换后旧锁不压制新会话账本

- **WHEN** 用户在会话 A 显式点选模型后切换到会话 B（B 有自己的账本）
- **THEN** 会话 B 的选择计划 MUST NOT 因 A 的用户锁而保留 A 的模型
