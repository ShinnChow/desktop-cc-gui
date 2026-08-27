# verification · fix-pi-capability-hygiene

> 2026-08-27 收口补充（L1 归档批次）。12/12 task 已完成，本文件补齐 evidence / waiver 事实。

## Evidence

- **G1 capability 诚实性**：`openspec/specs/engine-capability-matrix/fixtures/matrix.json` pi 行 `streaming.tool-output: unsupported`；TS/Rust 生成物两侧一致（`src/features/engine/engineCapabilityMatrix.generated.ts` / `src-tauri/src/engine/capability_matrix.rs`），`npm run check:engine-capability-matrix` gate 把关。
- **G1 死控件**：PI composer 不再渲染规划模式开关（`collaboration.mode: unsupported` 口径）；权限控件同理。
- **G3 thinking 档位**：`pick_thinking_level` + resident `get_available_thinking_levels` 白名单，单测锚定（`src-tauri/src/engine/pi.rs` tests）。
- **G2 技能目录**：`src-tauri/src/skills.rs` 扫 `~/.pi/agent/skills` 与项目 `.pi/skills`，合入既有 merge 优先级。

## Waiver（delta 处置）

- 本 change 的 `engine-capability-matrix` delta（MODIFIED「PI MUST NOT claim live tool-output streaming」）在主 spec 已重构为 fixture 生成物治理后**不再有可合并的正文 target**——per-engine cell 的权威事实源是 `fixtures/matrix.json`（pi 行已体现 unsupported）。archive 采用 `--skip-specs`（先例：`2026-08-24-add-dsh-engine` / `2026-08-24-enhance-pi-native-rpc-session` 的同类处置）；delta 文件随档保留作历史意图记录。
- ADR 校准回写 Gate：本 change 不命中基石文档「更新触发器」（engine registry / Shared 支持集合 / provider binding / canonical fact schema / context compiler / terminal-ACK / recovery exit），无需新增校准行。
