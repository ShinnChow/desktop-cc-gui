# Design: real secondary quota window progress

## Decision

`SessionControlQuotaPane` 已通过 `quota.windows` 接收按窗口排序的真实数据：第一个 window 为 primary，第两个为 secondary。将 secondary window 的 `displayPercent` 用作进度条 width 与 `aria-valuenow`，并沿用当前的 `usedLabel`（在 remaining mode 下自动切换为 remaining）。

## UI layout

1. 保留 primary window 的 label、百分比、reset 及连续 progress bar。
2. secondary window 显示 label、百分比、reset 及连续 progress bar。
3. 删除固定 scale 计算及仅作装饰的 sparkline DOM/CSS。

## Accessibility

每个真实额度条使用 `role="progressbar"`，并提供窗口 label、0/100 范围与当前百分比。装饰性 `aria-hidden` 图表不再存在。

## Risks and mitigation

- `quota.windows` 只有一个元素时，不渲染 secondary block，保持当前 single-window layout。
- 不调整数据读取、refresh 或 reset timestamp 格式化，避免改变额度语义。
