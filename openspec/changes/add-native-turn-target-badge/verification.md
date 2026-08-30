# Verification: add-native-turn-target-badge

## 第三轮（整体 review + 重构，2026-08-27）

- 死代码清理：删除 `nativeTurnTargetStorageKeyOf`（无消费）。
- 守卫归一：storage 侧 `isNonSharedNativeThreadId` 删除，统一改用 ledger 的
  `isNativeTurnTargetLedgerScope`（单一事实源，注释说明三个排除前缀的归属）。
- reducer 去重：新增 `withMissingTurnBadgeMetadata` 助手，吸收 appendAgentDelta
  合并/建壳与终稿合并/无壳创建四处「缺失才落地、不覆盖既有、无可加保引用」
  的重复逻辑（identity-preserving，fast-path 等价短路不受影响）。
- 回归：reducer 四套件 + storage + ledger 40/40；tokenUsage/dataSource/timeline/
  useThreadItemEvents 120/120；触及范围 tsc 0 错误、eslint 0 问题。
- 工作区注意：另一会话在途的 `useSelectedComposerSession.ts`（composer-selection
  重构）当时有 7 个 tsc 错误，与本 change 无关（本 change 不触 app-shell）。

## 第二轮（Ⓡ 注入 + 历史 sidecar，2026-08-27）

| 套件 | 结果 |
| --- | --- |
| `turnTargetBadgeStorage.test.ts`（新增：ring 追加 / burst 收敛 / shared 拒写 / 尾对齐补挂 / 不合格跳过） | 5/5 passed |
| `useThreadsReducer.native-turn-target.test.ts` 扩至 6 例：新增「重开会话经 setThreadItems 从侧车尾对齐补挂最近轮次」与「sidecar 无记录时不伪造」 | 6/6 passed |
| `nativeTurnTargetLedger.test.ts` + runtimeModelReceipt | 9+7 passed |
| `useAppServerEvents.tokenUsage.test.tsx` | 14/14 passed（含修复采集门误排 `shared:` 后恢复的 shared 用例；native sidecar 用例改为断言捕获） |
| 回归批次：sharedProjection/dataSource、messages/orchestration、timeline、shared-session/target、useThreadItemEvents 主套件 | 317/317 passed |
| `npm run typecheck` 触及范围 / 新文件 eslint | 0 错误 |

关键修复记录：初版排除式门错误地把 `shared:` 一并排除导致 shared receipt 全灭，
被既有测试当场拦截并修正——排除列表仅 `agent-canvas:` 与 `-pending-shared-`。

结论性说明（2026-08-27 真机反馈「native 历史看不到 badge」）：截图会话的轮次
（20:11–20:14）发生在 sidecar 落地之前，ring 无记录；补挂按规范不伪造历史
provenance，故旧轮次无条属预期。新发送从重启后的版本起写入并在重开后恢复，
链路由上述 reducer 集成测试覆盖。

## 第一轮（基础接线）

## 自动化（2026-08-27，branch bump-version-0.9.4）

| 套件 | 结果 |
| --- | --- |
| `nativeTurnTargetLedger.test.ts` | 9/9 passed |
| `useThreadsReducer.native-turn-target.test.ts`（新增：建壳带快照 / 不覆盖既有 / 终稿保留 / 无壳结算补挂） | 4/4 passed |
| `useThreadsReducer.append-agent-delta-fast-path` + `flush-agent-completed-batch` + `useThreadsReducer` 主套件 | 100/101（1 failed 为 HEAD 既有失败「optimistic user bubbles」，基线 worktree 复现一致） |
| `useThreadItemEvents` 三个套件（core / terminalTextCommit / liveTextSegment） | 58/58 passed |
| `turnBadge` + `sharedProjection/dataSource` + threadItems 相关 | 40/40 passed |
| `messageRowEquality` + `messages/orchestration` + `useAppServerEvents.test.tsx` + `runtimeModelReceipt` | 193/193 passed |
| `messages/timeline` + `shared-session/target` | 152/152 passed |
| `npm run typecheck` | 本次触及文件 0 错误（残留错误全部位于他人未完成的 `refactor-composer-selector-layer` 在途文件：ReasoningSelect/ModeSelect/ConfigSelect/ButtonArea/SelectorOptionRow，与会话开始时状态一致） |
| eslint（10 个触及文件） | 0 errors, 4 warnings —— 与 HEAD 基线逐条对照完全相同（行号位移），非本次引入 |

## 边界复核

- `git diff --stat`：8 文件 +139/-20，无格式化噪音；未触碰他人在途文件。
- 未改 `src/app-shell/**`、无 Rust 改动、无新增 IPC/catalog fetch。
- 渲染红线：仅首 delta 每轮多一次 Map.get；live 外部化通道契约未动。
