# codex-composer-startup-selection-stability Delta

## MODIFIED Requirements

### Requirement: Codex composer selection MUST stay stable across startup and thread switches

Codex 会话的 Composer 模型选择在启动 hydrate 与线程切换窗口内 MUST 保持稳定：目标线程已有账本时 MUST 显示账本值；账本未命中且 catalog 未就绪时 MUST NOT 将其他会话遗留的全局选择固化进目标线程账本。稳定性机制由「决策核心 writes 产物 + epoch 校验」承担，MUST NOT 依赖切换窗口内从当前 effective 值回推的 repair 写入。

#### Scenario: 切换窗口不污染目标线程账本

- **WHEN** 用户从 Codex 会话 A 快速切换到 Codex 会话 B，A 的 catalog 收敛写入晚于切换到达
- **THEN** B 的持久账本 MUST 保持 B 原值
- **AND** 显示层 MUST NOT 在 B 账本未命中且 catalog 未就绪时回落到 A 遗留的全局选择

#### Scenario: catalog 就绪后收敛仍生效

- **WHEN** 会话 B 账本未命中且 catalog 就绪
- **THEN** 收敛写入 MUST 经 epoch 校验后正常应用（当前线程未变时）
