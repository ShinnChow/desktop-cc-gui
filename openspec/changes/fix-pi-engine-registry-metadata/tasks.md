# Tasks: fix-pi-engine-registry-metadata

## 1. Rust

- [x] `adapter_registry.rs`：`EngineProtocolFamily` 增 `PiRpc` 变体（kebab-case `pi-rpc`）
- [x] `BuiltinEngineProtocol::family()`：`EngineType::Pi => PiRpc`
- [x] `BuiltinEngineProtocol::execution_model()`：`EngineType::Pi => Persistent`
- [x] 测试：pi family/execution 断言（对齐 codex/dsh 的既有断言风格）

## 2. Frontend

- [x] `engineIds.json` pi 行：`protocolFamily: "pi-rpc"`、`executionModel: "persistent"`
- [x] `engineRegistry.ts` `EngineProtocolFamily` union 扩 `"pi-rpc"`
- [x] `engineRegistry.test.ts` 补 pi 行 ToMatchObject 断言

## 3. 验证

- [x] `cargo test --lib adapter_registry` 全绿
- [x] `npx vitest run src/features/engine/engineRegistry.test.ts` 全绿
- [x] `node scripts/check-engine-adapter-registry.mjs` 通过
- [x] `cargo check --bin cc_gui_daemon`（daemon `#[path]` 共享模块）
- [x] `rustfmt --edition 2021 --check` 改动文件 clean
- [x] ADR 校准行回写基石设计（engine registry 触发器）

## 4. 收口

- [x] `openspec validate fix-pi-engine-registry-metadata --strict` 通过
- [x] changes/README active 表登记
