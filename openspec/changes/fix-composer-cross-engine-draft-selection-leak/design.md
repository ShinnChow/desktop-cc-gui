# Design: fix-composer-cross-engine-draft-selection-leak

## 数据流现状（为什么门禁加在 apply 点）

```text
会话 A（claude:*，选中 grok4.6）
  → activeThreadId: claude:x → null          # 回 Home / 切到无活动线程的 workspace / 删除等
  → carry effect（useSelectedComposerSession.ts :380-389）
      setDraftComposerSelection({modelId:'grok-4.6', effort})   # 来源此刻还在 ref 里
      shouldApplyDraftToNextThreadRef.current = true
  → 新建 Codex 会话
  → activeThreadId: codex-pending-y
  → reloadSelectedComposerSelection（layout effect）
      → shouldApplyDraftComposerSelectionToThread   # 只看 -pending-，放行 ← 泄露点
      → writeSelectionForSessionKey(codex ledger = grok-4.6)   # 污染落盘
```

门禁必须加在 **apply 判定点**：这是 draft 进入任何线程账本的唯一闸口；carry 端只需把「来源是谁」补记下来。

## 关键决策

1. **来源引擎用线程 id 推导，不新增选择结构**。
   `resolveThreadEngine(previousThreadId)` 已覆盖全部 native 引擎前缀（claude/codex/grok/kimi/opencode/dsh/pi/qoder/gemini）。draft 本体 `{modelId, effort}` 结构不变 —— 不迁移 localStorage 存量、不改 store schema。
2. **未知引擎一律放行**。
   - Home 点选产生的 draft 无来源线程（source=null）→ 放行（proposal 方案 B 的风险场景接受保留，见非目标）；
   - Shared / 无前缀 id（`resolveThreadEngine` 返回 null）→ 放行，避免误伤 fork 之外的本地 id 形态。
   判定语义：仅当 **双方引擎都解析成功且不相等** 时拒绝。与迁移路径 `hasEngineMismatch` 的判定同构（那边同样要求两侧非 null）。
3. **拒绝 ≠ 清 flag**。
   被拒绝的 draft 保持未消费状态（`shouldApplyDraftToNextThreadRef` 不清）——与现状一致性优先：同引擎的下一条 pending 仍能拿到草稿。副作用窗口（见非目标遗留边角）本次不扩大也不修复。
4. **ref 只增两处写点**。
   - carry effect 命中时：`draftSourceThreadIdRef.current = previousThreadId`；
   - `handleSelectComposerSelection` 两分支（无线程写新草稿 / 有线程清 flag）：置 null（来源身份失效）。
   读写全部同步 ref，不进 React state，不引发重渲染。

## 备选否决记录

- 在 `getEffectiveSelectedModelId` 的 allowUnknown 分支做跨引擎 catalog 精确命中检测：catalog 加载时序不稳定，且会把合法 freeform 名误判；否决。
- 发送侧引擎前缀黑名单：codex managed provider 合法携带 grok/claude 系模型名（三方 relay），误杀面不可控；否决（纵深防御另议）。

## 测试策略

- 纯函数矩阵驱动：来源×目标 = {claude→codex ✗, claude→claude ✓, null→codex ✓, 无前缀→pending ✓}。
- hook 流程：先激活 claude 线程写选择 → 切 null 触发 carry → 激活 codex pending 断言 ledger 未被写入且选择为 null；镜像用例断言同引擎仍写入。
