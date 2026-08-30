## Why

PI 主路径已经能用。剩下四条是诚实性与发现面小修补，不是新功能：capability 把「无 live 工具流」标成 supported；PI composer 仍露出无意义的权限/规划模式控件；thinking 档位写死七档；mossx slash 不扫 PI 技能目录。

## What Changes

- `streaming.tool-output` for PI → `unsupported`（有工具结束态，无 `tool_execution_update` live 流；不为此去接高频事件）
- PI composer 不渲染 `ModeSelect`（权限/规划模式对 PI 无协议）
- RPC `set_model` / handshake 后调用 `get_available_thinking_levels`，非法档位不下发
- `skills.rs` 增扫 `~/.pi/agent/skills` 与项目 `.pi/skills`，合进现有 slash 发现

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `engine-capability-matrix`: PI `streaming.tool-output` 从 `supported` 改为 `unsupported`

## Impact

- 生成矩阵 TS/Rust 与 fixture 必须一致（`npm run check:engine-capability-matrix`）
- 不接 `tool_execution_update`，不新增 UI
- 不改 Composer / ChatInputBoxAdapter（他人工作树）
