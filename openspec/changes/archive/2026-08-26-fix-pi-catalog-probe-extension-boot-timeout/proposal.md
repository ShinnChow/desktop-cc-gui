# Fix: PI catalog 探测跳过扩展加载，根除 extension boot 超时导致的 auto-only 降级

## Why

用户实证（2026-08-26 晚）：选中 PI 引擎时模型选择器只剩「auto」、思考强度（reasoning effort）选择器消失；`pi --list-models` 手动执行正常返回 19 个模型且 thinking 全为 yes。

根因链（全部已实测取证）：

1. PI catalog 探测链为 RPC `get_available_models`（budget `DETECTION_TIMEOUT = 10s`）→ 失败回退 `pi --list-models`（同 10s budget）→ 再失败落 generated fallback `[PI Auto (auto)]`（无 `supportedReasoningEfforts`）。
2. 用户 pi 0.84.3 安装了多个扩展（pruner / memory_search(qmd) / pi-lens LSP / background-tasks），每次 spawn 都全量 boot extensions：RPC 响应实测 **10.68s**、`--list-models` 实测 **9.28s**——双双贴爆/超出 10s budget。
3. 两层探测超时后返回 fallback-only catalog：模型菜单只剩 auto；auto 无 reasoning 档位 → `ButtonArea` 的 PI 思考控件条件（`reasoningOptions.length > 0`）不成立 → 思考选择器一并消失。这是「模型选择和思考又没了」的同一根因两种表现。
4. 附带影响：catalog 降级时账本合成选项 `supportedReasoningEfforts: []`，切历史会话 chip 能保住但思考控件仍隐藏。

不是仓库近期提交（cache-first / 防中毒 / 账本合成）改坏——那批修复逻辑自洽；是 pi 侧扩展生态增长把 boot 推过固定 10s 预算，属环境漂移撞上探测层脆弱点。

## What Changes

- `src-tauri/src/engine/status.rs`：
  - `fetch_pi_models_via_rpc`：probe spawn custom args 由 `--no-session` 改为 `--no-session --no-extensions`。catalog 探测只需要模型表，不需要 extensions；实测加 flag 后 RPC 响应 **10.68s → 0.99s**，模型数与 reasoning/thinkingLevelMap 元数据完全一致（19/19）。
  - `get_pi_models` 的 `--list-models` 回退分支：带 `--no-extensions` 执行（实测 9.28s → 1.02s）；失败（非零退出 / 输出空 / 超时）再无 flag 重试一次，兜底不识别该 flag 的旧版 pi；两次都失败才落 generated fallback。
  - 新增 `PI_CATALOG_PROBE_TIMEOUT = 15s`：PI catalog 探测预算（RPC 请求 + `--list-models` 两跳共用）比全局 `DETECTION_TIMEOUT(10s)` 放宽到 15s 兜底；version 探测与其他引擎维持 10s 不变。
- 真实会话 RPC（`pi.rs` 的 per-session spawn）**不动**：用户扩展（pruner 等）在真实会话必须照常生效。
- FE 零改动：新会话默认选型（catalog default = 列表第一个模型）、切会话账本 modelId 精确匹配、思考档位渲染三条链在健康 catalog 下行为已正确，无需变更。

## Fixed Design（固化：PI catalog 探测预算与参数约定）

后续任何改动触碰以下常量/结构，必须同步更新本节与单测锚点
（`pi_catalog_probe_rpc_args_skip_session_and_extension_boot` 钉死 args 与 15s 预算）：

1. **预算分层**：
   - 全局 `DETECTION_TIMEOUT = 10s`：其余引擎探测与 pi version 探测（`pi --version` 实测 <1s，无 extension boot）沿用，不动。
   - `PI_CATALOG_PROBE_TIMEOUT = 15s`：仅圈 PI catalog 探测两跳（RPC `get_available_models` 请求、`--list-models` 执行）。跳过 extension boot 后常态 ~1s，15s 是慢机/冷 FS 缓存的纯余量。
   - FE on-demand 超时（22s）不动。多跳全败的最坏路径（15s×3）会超出 FE 窗口：此时 FE 显示降级 UI，backend 探测继续走完并按 cache-first 语义回写 last-good 缓存，菜单打开时的 fallback-only auto-recover 下一次非 force 读取直接命中缓存自愈——**不在 FE 侧加长等待**，靠缓存自愈收敛。
2. **探测参数**：`PI_CATALOG_PROBE_RPC_ARGS = "--no-session --no-extensions"`。两条探测链（RPC / `--list-models`）都必须跳过 extension boot；真实会话 spawn（`pi.rs`）禁止携带 `--no-extensions`（用户扩展必须在会话内生效）。
3. **回退顺序**：RPC（带 flag）→ `--list-models`（带 flag）→ `--list-models`（裸跑，兜底旧版 pi 不识别 flag）→ generated fallback `[PI Auto]`（source=fallback，防中毒闸门继续生效，不写回缓存）。
4. **元数据契约**：catalog 探测必须保留 `reasoning` + `thinkingLevelMap` 投影（`supported_thinking_levels_for_pi_model`），否则思考强度选择器会静默消失——这是本 change 的原始症状，禁止在探测链上做「只要 id 列表」的简化。

## Impact

- Affected specs: 无 contract 级变更（探测实现细节加固，对外行为 = 修复后的预期行为）。
- 风险：极旧版本 pi 若无 `--no-extensions` flag，由 list-models 无 flag 重试兜底；RPC 层失败本来就回退 list-models。
- 验收：
  1. 扩展齐全的 pi（本机 0.84.3，已实测通过 2026-08-26）冷启动 App 后首次打开 PI 模型菜单 ≤ ~2s 出全量模型（非 auto）。
  2. 选中任一 reasoning 模型（如 deepseek/deepseek-v4-flash）时思考强度选择器出现，档位来自 thinkingLevelMap（off/low/high/max 等）。
  3. 新建 PI 会话默认选中列表第一个模型；切换历史 PI 会话 chip 恢复该会话模型并显示思考控件。
  4. `cargo test` pi 相关用例全绿；真实会话（带扩展）不受影响。
