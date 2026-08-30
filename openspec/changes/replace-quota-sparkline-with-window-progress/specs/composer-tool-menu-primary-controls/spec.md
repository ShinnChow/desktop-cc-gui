# composer-tool-menu-primary-controls Specification Delta

## ADDED Requirements

### Requirement: Session Control HUD MUST render each returned quota window as actual progress

当 `SessionControlQuotaPane` 接收到 primary 与 secondary quota windows 时，HUD MUST 使用每个 window 的 `displayPercent` 展示连续 progress bar 和百分比；不得用固定比例的 decorative sparkline 冒充 secondary window 用量。

#### Scenario: 5 小时与 7 天额度同时可用

- **WHEN** `quota.windows` 包含 `five_hour` 与 `seven_day`（或等价 secondary window）
- **THEN** HUD MUST 为两个窗口各渲染一个 `role="progressbar"`
- **AND** 每个 progress bar 的 `aria-valuenow` 与填充宽度 MUST 等于该 window 的 `displayPercent`
- **AND** secondary window MUST 显示该百分比和既有的 weekly reset 文案
- **AND** HUD MUST NOT 渲染 decorative sparkline

#### Scenario: 只有一个额度窗口

- **WHEN** `quota.windows` 只包含 primary window
- **THEN** HUD MUST 只渲染 primary progress bar
- **AND** MUST NOT 渲染 secondary progress bar 或 decorative sparkline
