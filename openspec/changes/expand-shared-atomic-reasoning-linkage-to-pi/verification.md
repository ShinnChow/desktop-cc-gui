# Verification: expand-shared-atomic-reasoning-linkage-to-pi

## 验证范围

- **行为正确性**：Shared Session / create-session Atomic 选 PI 模型时，UI 出现 ReasoningSelect、options 与 catalog allowlist 一致、send 边界 reconcile 不丢 effort。
- **Native 0 回归**：native PI composer 对话框、native send 链路行为完全不变。
- **后端契约**：`shared_session_v2_dispatch_turn` → `engine_send_message` → `pi.rs::try_send_message_rpc` / `send_message_print_json` 的 effort 透传已就位（沿用 `add-pi-thinking-level-selector` 既有 contract），本 change 不引入新后端契约。
- **Capability 一致性**：`openspec/specs/shared-execution-target/spec.md` 三条 Atomic Reasoning requirement 在 delta 落地后覆盖 PI 场景。
- **ADR 校准**：`docs/research/mossx-multi-cli-provider-session-foundation-design.md` 最近校准段与「Atomic 模型↔思考强度联动」校准行刷新。

## 验证方法

### 1. 自动化测试

| 测试集 | 命令 | 期望 |
| --- | --- | --- |
| `atomicModelReasoning` | `npx vitest run src/features/models/atomicModelReasoning.test.ts` | 全绿（含新增 PI cases） |
| `Composer.shared-target-pi`（新增） | `npx vitest run src/features/composer/components/Composer.*.test.tsx` | 全绿 |
| `ModelSelect.buildProviderExecutionTarget`（新增） | `npx vitest run src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx` | 全绿 |
| `useThreadMessaging.shared-pi-send` | `npx vitest run src/features/threads/hooks/useThreadMessaging.test.tsx` | 全绿（含新增 PI send boundary cases） |
| Rust lib | `cd src-tauri && cargo test --lib` | 与 HEAD baseline 既有 18 failed 项相同，不引入新 failure（既有失败在 `claude_history` / `dsh` / `gemini` / `runtime` / `session_management` 等无关模块） |
| Lint | `npm run check` | 全绿 |

### 2. Native PI 0 回归（人工 smoke）

走 native PI 流程（不挂 Shared target）：

1. 启动应用，选择 PI 引擎，连接 PI provider profile。
2. 打开一个 PI 会话。
3. 验证 ReasoningSelect 显示 options（应等于 `providerModelCatalogs["pi"]` 中选中模型行的 `supportedReasoningEfforts`）。
4. 选择 `high` → 发送消息。
5. 检查后端日志：
   - 走 RPC 路径：`[pi/rpc] set_thinking_level(high)` 被调用（resident 已缓存 `available_thinking_levels`）。
   - 走 fallback 路径：argv 含 `--thinking high`。
6. 选不支持档位的 PI 模型）→ ReasoningSelect 隐藏；发消息不带 `--thinking` / `set_thinking_level`。

预期：与 `expand-shared-atomic-reasoning-linkage-to-pi` 应用前行为一致。

### 3. Shared PI smoke（人工 smoke）

创建 Shared Session 选 PI 模型：

1. 创建 Shared Session → provider profile → engine PI → model（catalog 中有 supportedReasoningEfforts）。
2. 验证 ReasoningSelect 显示 options（应等于 catalog 行）。
3. 选择 `high` → 发送消息。
4. 检查链路日志：
   - 前端：`sendSharedSessionTurnRouted` 走 V2 → `shared_session_v2_dispatch_turn`（target.reasoningEffort = "high"）。
   - Rust：`shared_session_v2_dispatch_turn` 内调 `engine_send_message(..., owner.target.reasoning_effort = "high", ...)`。
   - 后端：`pi.rs::try_send_message_rpc` 走 `set_thinking_level("high")`，或 fallback 加 `--thinking high` argv。
5. 跨引擎切换：Shared Session 中切到 Codex 模型（不同 engine）→ 切回 PI 模型 → 验证 seed default effort（不继承 Codex 的旧 effort）。
6. hydrate 测试：刷新 Shared Session → `selectedSharedTarget.reasoning.effort = null` → composer 显示 PI 模型 `defaultReasoningEffort`；send boundary reconcile 后 effort 等于 default。

### 4. Capability 验证

- `openspec validate --change expand-shared-atomic-reasoning-linkage-to-pi`：通过。
- `openspec status --change expand-shared-atomic-reasoning-linkage-to-pi`：ready-for-archive。
- 同步到主 spec：`openspec/changes/expand-shared-atomic-reasoning-linkage-to-pi/specs/shared-execution-target/spec.md` 的 ADDED scenarios 在 archive 时合并进 `openspec/specs/shared-execution-target/spec.md`。

### 5. ADR 校准验证

- `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 最近校准段含 `2026-08-25 · Atomic 思考强度联动扩到 PI（expand-shared-atomic-reasoning-linkage-to-pi）`，事实源指向代码路径：
  - `src/features/models/atomicModelReasoning.ts`（新增 `enrichModelReasoningForEngine` + PI 分支）
  - `src/features/composer/components/Composer.tsx`（atomicModelReasoningRef + shared target hydrate effect）
  - `openspec/changes/expand-shared-atomic-reasoning-linkage-to-pi`
- 「Atomic 模型↔思考强度联动」校准行引用本 change id。

## 已知限制与豁免

- **PI RPC 与 catalog allowlist 潜在漂移**：RPC `available_thinking_levels()` 缓存可能与 catalog 不同（RPC handshake 失败 / 老 pi）。send 端以 resident 胜出（log warn 静默丢档），UI 不变。这是 native PI 既有行为，shared 复刻后继承。**不阻塞本 change 收口**。
- **`buildProviderExecutionTarget` 与 send boundary 双层 reconcile 冗余**：picker 切换时 seed 一次，send 边界再 reconcile 一次。冗余但行为一致。**已知 design tradeoff**，design §决策 §8 已记录。
- **DSH / Qoder / Kimi / Grok / OpenCode 引擎不在本 change 范围**：native DSH ReasoningSelect 已接通（ButtonArea 条件已就位），但 Shared 路径同样未接；Qoder ACP `session/set_config_option reasoning_effort` 缺乏用户实证。**out of scope**，由后续 change 各自评估。**不阻塞本 change 收口**。

## 2026-08-27 L1 收口审计（checkbox 与实现对账）

落地 commit `d0706f545` 后 tasks.md 39 项全未勾（进度事实缺失）。本日逐项按 HEAD 代码证据补勾：

- **31/39 直接证据落地**（§1-§3 全部功能 task、§4 大部分测试、§5 文档/ADR、§6 部分、§7 三项）；关键 file:line 对账见 tasks.md 行内注记。
- **补齐 2 个缺失测试**：`enrichModelReasoningForEngine` 非 PI 直返 passthrough（atomicModelReasoning.test.ts，28/28 绿）；`useThreadMessaging` PI send 边界 2 例（钉死落地契约：边界 model ref 无 capability metadata 时 PI 走 capability-neutral 直通——high 原样保留、ultra 不发明不清；「非法档位收敛 default」由带 metadata 的 Composer 层完成）。§1 验证表第 4 行「含新增 PI send boundary cases」自本日起为真。
- **口径修正 2 项**：`npm run check` 脚本在仓库从未存在，以 `tsc --noEmit` + eslint 等价执行（2026-08-27 复核 typecheck 0 error）；`useThreadMessaging.test.tsx` 存量 4 failed（非 PI 用例，落地 commit 已做 stash-baseline 对照），本 change 相关用例全绿。
- **复跑结果（2026-08-27）**：atomicModelReasoning 28/28；Composer.* 9 套件 100/100；ModelSelect 79/79；useThreadMessaging 116 passed / 4 存量 failed（与本 change 无关）。
- **未勾剩余**：§6 两条手测 smoke（Native PI 0 回归 / Shared PI smoke）与 §7 收口 chore——保留为 active gate，完成后即可 archive。

## 收口门槛

- [x] 自动化测试 §1 全部通过【2026-08-27 复跑，见上节口径注记】
- [ ] Native PI 0 回归 smoke §2 通过（手动）
- [ ] Shared PI smoke §3 通过（手动）
- [x] Capability 验证 §4 通过
- [x] ADR 校准验证 §5 通过
- [x] 已知限制 §豁免 已在 proposal / design 中标注
- [ ] proposal 8 条 Acceptance 全部覆盖（详见 proposal.md 「Acceptance」）【依赖两条手测 smoke】

