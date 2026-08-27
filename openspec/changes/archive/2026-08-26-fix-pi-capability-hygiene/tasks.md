## 1. Capability 口径

- [x] 改 `openspec/specs/engine-capability-matrix/fixtures/matrix.json` 的 `engines.pi["streaming.tool-output"]` 为 `unsupported`
- [x] `node scripts/check-engine-capability-matrix.mjs --write`
- [x] Rust `capability_state` 对 PI 的 `streaming.tool-output` 与 spec 对齐
- [x] 补 TS / Rust 断言

## 2. PI composer 死控件

- [x] `ButtonArea` 在 `currentProvider === 'pi'` 时不渲染 `ModeSelect`
- [x] 补 ButtonArea 测试

## 3. thinking 档位

- [x] `PiRpcClient` handshake / `set_model` 后 `get_available_thinking_levels`
- [x] 发送前按可用档位夹紧，非法档位不下发
- [x] 单测 `pick_thinking_level`

## 4. PI 技能目录

- [x] 扫 `PI_CODING_AGENT_DIR` 或 `~/.pi/agent/skills`
- [x] 扫项目 `.pi/skills`
- [x] 合进现有 merge 优先级；attribution 认 PI 路径
