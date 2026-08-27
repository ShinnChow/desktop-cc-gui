# Tasks: fix-pi-print-json-fallback-session-isolation

## 1. `pi.rs` print-json 互斥按 session 隔离

- [x] `ActivePiChildProcess` 增加 `session_id: Option<String>` 字段（带注释：None = 新会话独占新 JSONL；busy 互斥按它过滤）；`new(child, session_id)` 签名更新。
- [x] `send_message_print_json` 注册处改为 `ActivePiChildProcess::new(child, params.session_id.clone())`。
- [x] 新增纯函数 `print_json_fallback_busy(active_sessions: impl Iterator<Item = Option<&str>>, session_id: Option<&str>) -> bool`：None 恒 false；否则任一活跃进程 session 相同即忙。
- [x] `send_message` busy 检查：锁内调纯函数 → drop guard → `session_id` 为 Some 才查 `rpc_has_active_run_for`；`if print_json_busy || rpc_busy` 才报 busy。更新注释（互斥粒度 = 同一 session）。

## 2. `pi.rs` fallback 释放覆盖 scratch 槽

- [x] 新增 `async fn drop_resident_by_key(&self, key: &str)`（原 `drop_resident` 主体迁入，日志改 `key={key}`）。
- [x] `drop_resident(session_id)` 改为委托 `drop_resident_by_key(&format!("session:{session_id}"))`（pub 签名不变，`manager.rs` 调用面不动）。
- [x] `send_message` fallback 分支：`let resident_key = pi_resident_map_key(params.session_id.as_deref(), turn_id); self.drop_resident_by_key(&resident_key).await;`（替换 `if let Some(session_id) ...`）。

## 3. `pi.rs` 禁用闩只拦新 spawn

- [x] `ensure_resident`：删除函数开头的 `rpc_disabled` 早退；在 write-guard 复用/清死之后、`bind_session_id` 之前插入同一检查（带注释：已存活 resident 必须继续复用）。

## 4. 测试（`pi.rs` mod tests）

- [x] `print_json_fallback_busy_only_blocks_same_session`：None 恒放行（含已有 None 进程）；同 session 互斥；跨 session 放行；仅 None 进程时历史会话放行。
- [x] `fallback_drop_key_matches_rpc_scratch_key`：`pi_resident_map_key(None, turn)` = `scratch:{turn}`、`pi_resident_map_key(Some("pi:x"), turn)` = `scratch:{turn}`、`pi_resident_map_key(Some("abc-123"), turn)` = `session:abc-123`（钉死 F4 与 `try_send_message_rpc` 同源契约）。

## 5. OpenSpec 与验证

- [x] `openspec/changes/fix-pi-print-json-fallback-session-isolation/specs/pi-rpc-session-runtime/spec.md`：MODIFIED delta 落盘（见 spec delta 文件）。
- [x] `cargo test engine::pi` 全绿（与 HEAD baseline 对照不引入新 failure）。
- [x] `openspec validate fix-pi-print-json-fallback-session-isolation` 通过。
- [ ] 人工目视验收（可选，隔离开发者客户端）：历史会话切模型 → 另一并行 PI 继续 RPC；print-json 在跑时新建 PI 第一句正常。

## 6. L5 降级天花板诚实化（2026-08-27 扩展）

- [x] 核查降级错误文案：`pi.rs` fallback busy 错误已诚实（"rpc unavailable, print-json fallback cannot steer; the message stays queued"——说明降级 + 不可插话 + 消息留队列）；send gate 双证据返回结构化 `pi_engine_unavailable`（`fix-orphan-turn-during-backend-unavailability` F2，3 测）。
- [x] 核查 RPC-only 命令降级：树面板 last-good + 错误态 + 重试入口（`fix-pi-rpc-latch-cooldown-tree-error-state` 已落地）；RPC-only 命令不回退 print-json（`commands.rs` 注释钉死）。
- [x] spec delta 追加 ADDED requirement「print-json 降级天花板 MUST 诚实表达」：降级期无 steer（pi `--print` 协议层没有 steering 通道，明确不做）、双证据 gate、RPC-only last-good 三场景规范化。
- [x] `openspec validate fix-pi-print-json-fallback-session-isolation` 复验通过。
