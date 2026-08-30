# Design: add-native-turn-target-badge

## 语义对齐（复用清单）

| 能力 | 现成实现 | 本 change 用法 |
| --- | --- | --- |
| 快照类型/固化 | `TurnExecutionSnapshot` / `freezeTurnSnapshot`（`src/features/shared-session/target/types.ts`） | Composer 边界冻结 + 兜底合成 |
| Badge 渲染 | `MessageRow` `message-turn-target-badge` + `resolveTurnBadge` | 零改动 |
| 可见性 dedupe | `buildTurnTargetBadgeVisibleItemIds`（Policy B per user turn） | 零改动 |
| 回执合并 | `rememberRuntimeReceipt` / `mergeRuntimeReceipt`（source rank: send.request < turn.completed < init < assistant.message.model） | native send.request 记账 + 放宽采集门 |
| 合并语义 | reducer `...nextBase` spread / assembler `mergeAssistantSnapshot` existing-first | 只需保证首桶有值 |

## 关键决策

### D1 为什么新建小账本而不是写进 `shared-session/target/targetStore`

`targetStore` 的文档语义是「每个 Shared Thread 一份」，且耦合 persist generation /
selectedNextTarget hydrate。native 写入会污染所有权（本仓 ownership 文化）。
仿 `runtimeModelReceipt.ts` 的 per-thread 模块 Map（同为前端会话级状态、同样有 alias
rename 迁移先例）是既定惯例，约 40 行。

### D2 记账点选在 `sendMessageToThread` 而非 Composer

- 该函数是所有 native 发送的唯一漏斗：composer 直发、queue-fusion drain、
  `/fork`、prompt panel、recovery resend 全部汇入；
- pending threadId 别名递归（claude-pending / codex-pending → 正式 id）在函数头部完成，
  记账天然落在**最终 thread id**上；Composer 拿不到这个 id。
- Composer 仅负责把「用户当次看到的完整 target」冻结进 options；
  messaging 层负责 `options 缺失 → 按 resolved engine/model/effort 兜底合成`
  （此时 providerProfileNameSnapshot 缺失，badge 经 `resolveSnapshotProviderLabel`
  回落 profile id / 本地 sentinel 语义，可解释）。

### D3 盖快照只覆盖「建壳首桶」+「缺者补」

快照不变量与 shared 一致：**一旦 item 已带 snapshot，后续任何 incoming 一律不覆盖**
（reducer `existing.executionTargetSnapshot ?? action.executionTargetSnapshot`；
assembler existing-first）。因此流中换档位/换模型不会改写进行中的 bubble。

三条入列咽喉的分工：

1. `applyRealtimeDeltaOperation(agentDelta)` —— claude/gemini/grok/kimi/pi/dsh/qoder
   流式的建壳必经点（A4 外部化下仅首 delta 进 reducer）。
2. `handleItemUpdate` —— 非 delta 形态的 agentMessage snapshot / tail-drain，
   以及转成 ConversationItem 的 assistant message upsert。
3. `tryRouteNormalizedRealtimeEvent` —— codex-native 走 normalized 直达
   （assembler `applyNormalizedRealtimeEvent`）；注入点复用 shared 同一块代码
   （条件从 `shouldInjectThreadId || isSharedOwnerProjection` 扩为再含 native 有账本值）。

### D4 receipt 门从「shared 白名单」改为「排除式」

原来 `!threadId.startsWith("shared:") return;`。改为排除
`shared:` / `agent-canvas:` / `-pending-shared-` 后放行其余——sidecar/raw 方法里
`turn/completed`、init、assistant model 对 native 与 shared 是同一族事件形状，
rank 合并逻辑原样生效。`patchAssistantRuntimeReceipt` 原有守卫
（只 patch 已带 snapshot/receipt 的 item）继续兜底防误标。

### D5 历史持久化（第二轮迭代补齐）

初版把「不做历史持久化」列为非目标；真机验收后用户明确要求历史不丢 badge，
改为落地——**完全复用仓库既有的 turnFinalMeta 冷加载补挂模式**：

- 新增 `turnTargetBadgeStorage.ts`：threads client store 下 per-thread ring
  （500 threads × 200 轮），发送边界 `appendTurnTargetBadge` 追加，
  同一秒内的 resend burst 以 latest-wins 收敛到尾项。
- 历史加载在 reducer `setThreadItems` 里 `mergeTurnTargetBadgesIntoItems`
  补挂（与既有 `mergeTurnFinalMetaIntoItems` 串联）：按 user 消息切分轮次、
  **entries 与轮次都从尾部对齐**——远古合成 user 行导致序号漂移时只有更老的
  轮次拿不到 badge，近期轮次恒定正确。已有值的 item 一律不覆盖。
- Ⓡ 回执尾巴同理补齐：pi/kimi/grok/qoder/dsh/opencode 的事件流不含 model
  （仅 claude 有 runtime_model raw sidecar），光放宽采集门它们永远出不了尾巴；
  在入列咽喉处随快照一并注入 `getRuntimeReceipt()` 的 send.request 记账
  （shared 投影原本就是这么做的），回执来源行如实显示「发送时记下的请求名」。

### D6 显式仍不做

- 不给 turn 终态清理内存账本：latest-wins（下一次发送必然刷新）不变。
- 窗口式 prepend 加载的更老分页暂不补挂侧车（与 finalMeta 行为一致）；
  主恢复路径是原子 setThreadItems。

## 性能与红线核对

- 首 delta 每 turn 多一次 `Map.get`：O(1)，不在根链 setState 路径。
- 不触碰 `liveAssistantTextChannel` / `liveItemDeltaChannel` 外部化契约。
- 无新增 IPC、无 catalog fetch（Session Switch Catalog Fetch Gate 无关）。
- 不改 `src/app-shell/**`（AppShell Structure Gate 无关）。
