# Proposal: replace quota sparkline with window progress

## Why

Session Control HUD 在同时取得 5 小时与 7 天额度窗口时，底部展示的是由固定比例生成的 decorative sparkline，而不是第二个窗口的真实用量。它会让用户误以为 7 天额度的实际消耗曲线已被展示。

## What Changes

- 移除 decorative quota sparkline。
- 复用既有 `SessionOverviewQuotaWindowView.displayPercent`，为 secondary window 渲染真实连续进度条及百分比。
- 保持既有 refresh、reset 文案、额度数据查询与 view-model contract 不变。

## Impact

- Affected capability: `composer-tool-menu-primary-controls`
- Affected UI: `SessionControlQuotaPane`
- No backend, Tauri command, polling, or persisted-state changes.
