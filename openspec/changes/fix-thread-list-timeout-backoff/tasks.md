# Tasks: fix-thread-list-timeout-backoff

## 1. 红测试（先写失败用例）

- [x] 1.1 `fullCatalogAutoRetry.test.ts` 新增：同一 workspace 连续 `noteFullCatalogAutoRetryTimeout` 冷却按 60s→120s→240s 递增（snapshot remainingMs 区间断言）。
- [x] 1.2 封顶用例：连续 6 次 timeout 后冷却封顶 ~15min，不再增长。
- [x] 1.3 `noteFullCatalogAutoRetrySuccess` 重置 streak：连续 timeout 后 success，再次 timeout 冷却回到 ~60s。
- [x] 1.4 `clearFullCatalogAutoRetryCooldown`（force refresh 路径）同时重置 streak。
- [x] 1.5 兼容性：`markFullCatalogAutoRetryCooldown` 显式 `cooldownMs` / 非 timeout 原因不走退避，时长语义不变。

## 2. 实现

- [x] 2.1 `fullCatalogAutoRetry.ts`：新增 `FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS = 900_000`、per-workspace timeout streak、`noteFullCatalogAutoRetryTimeout` / `noteFullCatalogAutoRetrySuccess`；`clearFullCatalogAutoRetryCooldown` 连带重置 streak；snapshot 行附 `streak=N`。
- [x] 2.2 `useWorkspaceThreadListHydration.ts` settle 接线：timeout 分支 `markFullCatalogAutoRetryCooldown(ws, "timeout")` → `noteFullCatalogAutoRetryTimeout(ws)`；成功 settle 分支（`markFullCatalogFresh` 旁）补 `noteFullCatalogAutoRetrySuccess(ws)`。

## 3. 验证与收口

- [x] 3.1 红 → 绿：`fullCatalogAutoRetry.test.ts` 8/8 全绿（新增 6 用例先红：6 failed → 绿）；`useWorkspaceThreadListHydration` 24/24、startup-orchestration 目录 31/31 全绿。
- [x] 3.2 `npm run typecheck`：本 change 文件 0 error（全树 2 个 error 均在并行会话在途新文件 `sidebarSnapshot.removeQueued.test.ts`，与本 change 无关）；改动文件 prettier --check 通过（仅本 change hunk）。
- [x] 3.3 `openspec validate fix-thread-list-timeout-backoff --strict --no-interactive` 通过；`openspec/changes/README.md` 索引更新（只 stage 本 change 行，在途会话同文件改动不入本次提交）。
- [ ] 3.4 真机复验（发版前，可随 0.9.4 一起）：制造/模拟连续 list timeout 后，诊断 dump `fullCatalogAutoRetryBlocked` 显示 streak 递增、churn 频率降至 ≤4 次/小时/workspace。
