# Tasks: fix-composer-cross-engine-draft-selection-leak

> 唯一代码面：`selectedComposerSession.ts` + `useSelectedComposerSession.ts` + 两份测试。
> 禁止触碰 `fix-model-picker-send-authority` 在途域（resolver / picker / send 边界）与同事未提交目录。
> TDD：先红后绿。

## 1. OpenSpec artifacts

- [x] 1.1 [P0] 创建 proposal / design / tasks / spec delta `composer-session-selection-isolation`
- [x] 1.2 [P1] 在 `openspec/changes/README.md` 登记 active change

## 2. Implementation

- [x] 2.1 [P0] `shouldApplyDraftComposerSelectionToThread` 增加 `draftSourceThreadId` 入参与引擎一致性判定（未知引擎放行）。输入：`selectedComposerSession.ts`。输出：跨引擎 draft 拒绝进入目标 pending 账本。验证：单测矩阵先红后绿。
- [x] 2.2 [P0] carry effect 记录 `draftSourceThreadIdRef`；`handleSelectComposerSelection` 分支同步维护 ref。输入：`useSelectedComposerSession.ts`。输出：apply 点拿到可靠来源线程。验证：flow 测试。
- [x] 2.3 [P1] 单测矩阵：claude→codex ✗ / claude→claude ✓ / null 来源 ✓ / 无前缀 id ✓。验证：`selectedComposerSession.test.ts`。
- [x] 2.4 [P1] 引擎无关性锁：resolveThreadEngine 全部 9 家 native CLI（claude/codex/gemini/grok/kimi/opencode/dsh/pi/qoder）来源×目标两两组合拒绝（9×8）+ 同引擎放行（9）。验证：`selectedComposerSession.test.ts` 参数化循环。

## 3. Verification

- [x] 3.1 [P0] 定向 vitest（selectedComposerSession test + flow）绿；app-shell/domains 全量 + flow 合跑 272/272
- [x] 3.2 [P0] 本 change 四文件 tsc 0 错误 + `npm run check:app-shell:governance` 绿（全仓 typecheck 现被并行在途改动污染：fork 删除复活 / thread-list backoff 域的测试引用未完成导出，与本 change 无关）
- [x] 3.3 [P1] `git diff --stat` 卫生自查：4 文件 +134/-1，无格式化噪音；与并行同事改动面（threads utils / services / startup-orchestration）零重叠
- [ ] 3.4 [P1] 手测验收 proposal 标准第 1/2 条（Claude 会话选模型 → 新建 Codex 不继承；同引擎继承保持）

## 4. Docs

- [ ] 4.1 [P2] verify 后按 archive 流程 sync spec；不命中基石 ADR 更新触发器（engine registry / Shared 集合 / provider binding / fact schema / context compiler / terminal ACK / recovery 均未触及），无需回写校准表
