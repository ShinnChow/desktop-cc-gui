# Proposal: fix-composer-cross-engine-draft-selection-leak

> OpenSpec change id: `fix-composer-cross-engine-draft-selection-leak`
> 现场：ccgui 0.9.x Windows 测试用户（2026-08-27 反馈，多版本复现，0.8x 起）
> 正交：`fix-model-picker-send-authority`（picker 提交写 resolver / send 权威 / 续接 rollback——不重叠，已 implemented 待手测）；`restore-dsh-session-composer-model`（DSH 模型还原，代码已入库，只共用文件不同函数）
> 本 change **不** 碰侧栏扫盘 / catalog IPC / 后端 Rust。

---

## Why

用户新建 Codex 会话时 composer 默认选中上一个 Claude 会话的模型（如 grok4.6、自定义 opus5），首条消息即以该外部模型名发往 Codex，触发 404 `Model 'claude-opus-5' is not supported by any configured account in this group`；即使界面切到 gpt5.6，首发仍可能带旧模型。

泄露源头是 **composer 会话选择账本的 draft carry 无引擎门禁**：

1. 用户离开一条会话回 Home（`activeThreadId` 从非空变 null）时，当前选择被存入 `draftComposerSelection`（`useSelectedComposerSession.ts` carry effect）。
2. 下一条任意引擎的 `-pending-*` 新会话激活时，`shouldApplyDraftComposerSelectionToThread`（`selectedComposerSession.ts`）只检查「目标是 pending 线程」，**不校验来源/目标引擎一致**，draft 被写进新线程 ledger（`selectedModelByThread.<ws>:<threadId>`）。
3. Codex 对线程 ledger id 恒开 `allowUnknownActiveThreadModel`（保自定义模型名的设计），外部模型 id 原样成为选中值与 `resolvedModel`，一路进发送链。

对照证据：线程间迁移路径 `shouldMigrateComposerSelectionBetweenThreadIds` 明确有 `hasEngineMismatch` 阻断，唯独 draft 路径漏了同层防护。单测固化了无门禁现状（跨 pending 直接放行）。

## What Changes

- **draft carry 引擎门禁**：carry 时记录来源线程 id；应用到目标 pending 线程前校验来源/目标 `resolveThreadEngine` 一致。双方引擎已知且不一致 → 拒绝应用（目标线程回落自身引擎默认播种）。任一侧引擎未知（Home 点选 draft、Shared、无前缀 id）→ 维持既有放行语义，零回归。
- 单测：纯函数门禁矩阵 + hook 流程测试（claude 草稿 × codex pending 拒绝 / claude pending 放行）。

**非 BREAKING**。仅收窄一条从未被承诺过的行为（跨引擎 draft 继承），正常单引擎与 Home 创建流不受影响。

## 目标与边界

- **目标**：切断「上一条会话的模型选择跨引擎写进新会话账本」这一泄露源头；新建会话默认模型必须来自本引擎账本/偏好/catalog 默认。
- **边界**：改动收敛在 `selectedComposerSession.ts` + `useSelectedComposerSession.ts` 及其测试；不动 picker、resolver、send 边界、后端。

## 非目标

- **切换不生效的竞态与 send 权威**由在途 `fix-model-picker-send-authority` 承接（其验收 #2/#3/#4 与本现场症状直接对应，await hand-test 4.3），本 change 不碰同一批接线，避免双改冲突。
- 不扩发送侧 per-engine foreign-model 黑名单（codex managed provider 可能合法携带他厂模型名，字符串启发式误伤面大；泄露源堵住后此为纵深防御议题，另立 change）。
- 不清洗历史已污染的 ledger 条目（本地 localStorage 存量；修复后新会话不再产生，旧失败会话建议删除重建）。
- 不修「离开会话但无选择时应清 shouldApplyDraftToNextThreadRef」的前置遗留边角（本次门禁下该 flag 只在同引擎场景生效，风险敞口显著缩小，单独跟进）。
- 不 git commit（交用户审批）。

## Capabilities

### New Capabilities

- `composer-session-selection-isolation`: composer 会话选择（含 draft carry）不得把一个 CLI 引擎的选择写进另一个引擎会话的选择账本。

### Modified Capabilities

<!-- 无既有 capability 描述 draft ledger 语义（grep specs/ 无 draftComposerSelection/selectedModelByThread 命中），走新增。 -->

## Impact

- Frontend:
  - `src/app-shell/domains/selectedComposerSession.ts`（`shouldApplyDraftComposerSelectionToThread` 增加 draft 来源引擎判定）
  - `src/app-shell/domains/useSelectedComposerSession.ts`(carry effect 记录来源线程 ref + 应用点透传)
- Tests:
  - `src/app-shell/domains/selectedComposerSession.test.ts`（门禁矩阵）
  - `src/app-shell/sections/selectedComposerSession.flow.test.ts`（hook 级拒绝/放行流程）
- Backend: 无。
- Docs: 本 change。

## 方案取舍

| 选项 | 描述 | 取舍 |
|---|---|---|
| **A. apply 时按来源引擎门禁（采用）** | carry effect 已持有 previousThreadId，`resolveThreadEngine` 可靠解析 claude/codex/grok 等 | 泄露源头一处收口；未知引擎放行保证零回归 |
| B. Home 点选也记引擎并全面禁跨界 | 需给 `handleSelectComposerSelection` 加 engine 参数并改多处调用方 | 触碰 `fix-model-picker-send-authority` 同域文件与签名，冲突面大；Home 场景本身有创建面板引擎一致性保护，收益低 |
| C. 发送侧字符串黑名单拦截外引擎模型名 | codex/grok/gemini 等前缀表 | managed provider 合法携带他厂模型名会被误杀，且治标 |

## 验收标准

1. 在 Claude 会话选定 grok4.6 → 回 Home → 右键新建 Codex 会话：composer 默认选中 Codex 自身默认/引擎偏好，**不是** grok4.6。
2. 同引擎场景回归不变：grok 会话草稿 → 新 grok-pending 会话仍继承选择与 effort。
3. Home 点选 draft（无来源线程）落到下一条 pending 的既有行为保持不变。
4. DSH host seed / fork 继承 / pending→canonical 迁移路径行为不变（既有测试全绿）。
5. 相关 vitest 绿；typecheck / `check:app-shell:governance` 绿。
