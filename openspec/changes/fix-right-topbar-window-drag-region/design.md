# Design: fix-right-topbar-window-drag-region

## Decision

直接修复现有 `.right-panel-toolbar` ownership：container 使用
`data-tauri-drag-region` / `-webkit-app-region: drag`，interactive descendants 使用
`data-tauri-drag-region="false"`。不增加 overlay，因为 overlay 会引入 pointer hit-test 与跨平台层级风险。

## Verification

- Vitest 验证 toolbar container 是 drag region，Git mode slot 是 no-drag。
- macOS 与 Windows 人工验证 drag/click matrix。
