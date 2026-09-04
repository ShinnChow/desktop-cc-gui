---
type: plan
status: standby（churn 触发式，不主动开工）
created: 2026-08-31
---

# churn 触发式拆分计划：useThreads.ts / ChatInputBoxAdapter.tsx

> 承接 `docs/2026-08-31-large-file-split-wave6-plan.md`（Wave 6 已收官，strictReduction 三组全启用）。
> 本计划**不是 campaign**：两个目标文件是全仓仅有的「大 + 高 churn」组合（近 3 月实测：useThreads.ts 2446 行/48 次改动、ChatInputBoxAdapter.tsx 2410 行/45 次改动），merge 冲突成本在真实发生；但行数均低于各自 fail 线（2800），主动拆 ROI 为负。
> **触发条件**：有真实需求 PR 要动这两个文件之一时，同 PR 顺带拆一刀，让拆分成本由真实需求摊销。无触发不开工。

## 0. 前置纪律（全部沿用，不重复全文）

- 主计划 `docs/2026-08-30-large-file-split-master-plan.md` §8 执行卡 + §9 风险登记册。
- Wave 6 计划 §7 十二条（tsc 必删 tsbuildinfo、逐字搬运、失败名单基线对比、禁 stash、新文件 ≤800 等）。
- Wave 6 §8 新教训：⑬ 脚本装配用唯一变量名+独立临时文件；⑭ tsc 验证只用 `npx tsc --noEmit`，禁 `tsc -b`。
- 两个文件都在 feature-hotpath 组（strictReduction 已启用）：**拆完行数必须下降**，retained 会阻塞；新文件 >800 需同 PR 重生成 new-file baseline 并登记豁免。

## 1. 目标文件现状与刀法预案（2026-08-31 勘察）

### 1.1 ChatInputBoxAdapter.tsx（2410 行）—— 低危热身刀

路径：`src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx`。

结构勘察结论：文件头部 ~470 行是**纯函数区**，与主组件 wiring 零耦合，是最便宜的一刀：

| 候选拆出段 | 行区间（勘察时） | 体量 | 目标新文件 |
|---|---|---:|---|
| 18 个 `are*Equal` props 比较器族（`areStringArraysEqual`…`areChatInputBoxAdapterPropsEqual`） | 182–593 | ~410 | `chatInputBoxAdapterComparators.ts` |
| attachment/file-uri/image-input helper 族（`pathsToAttachments`…`attachmentsToImageInputs`） | 735–897 | ~160 | `chatInputBoxAttachments.ts` |
| completion 路径打分族（`normalizePath`…`normalizeSlashCommandName`） | 968–1079 | ~110 | 可并入 helpers 或独立 `chatInputBoxCompletion.ts` |

- 拆完主体预计 ~1900–2000，比较器族若被 memo 消费，**import 后 deps 数组逐字留调用点**（「lint 绿≠memo 生效」前科，主计划 §9）。
- 关联测试：`ChatInputBoxAdapter.test.tsx`、`ButtonArea*.test.tsx`、modelOptions/types 测试等，同目录全量跑。
- ⚠️ 该文件在 Windows 冷启动点击链路周边（AGENTS.md Windows Cold-Start Click Freeze Gate）：拆动不得改变模块顶层副作用与求值顺序；`readStoredStreamingEnabled` 等 module-level 常量只求值一次的语义保留。

### 1.2 useThreads.ts（2446 行）—— 高危主干刀

路径：`src/features/threads/hooks/useThreads.ts`。

结构勘察结论：单 hook 函数体 184–2446（~2260 行一个函数），没有现成纯函数段可切，须走 **handler 族抽出 + 上下文参数对象化**（先例：useThreadMessaging 波 2 三刀、SharedSendContext/NativeResolveContext/PendingSessionCacheContext）。

建议分两刀（可分两个 PR，也可一刀拍板）：

1. **刀 1（较安全）**：文件内不在主 hook 闭包内的纯 helper / 常量 / 类型先清出（`THREAD_ERROR_DUPLICATE_WINDOW_MS` 等常量、`ThreadDeleteResult` 类型及关联纯函数），主体降到 ~2300。
2. **刀 2（主刀）**：通读 hook 体内 handler 族（delete/archive/rename/加载等），把自包含的 handler 闭包抽成 `useThreads<族名>.ts` 的 `create*Handlers(ctx)` 工厂，ctx 参数对象化逐名列举；**高频 setState 禁挂根 hook 链、数组追加型 setState 禁入根链**（AGENTS.md Render Perf Baseline 红线）。

- ⚠️ useThreads 集成测试 3 文件为既有失败（Wave 6 计划 §0 存量名单），拆前记录失败名单、拆后逐字对比。
- ⚠️ 该 hook 被 app-shell 层消费；动前跑一次 `npm run check:app-shell:governance`。

## 2. 执行编排（触发后）

单文件单 PR，沿用已验证模式：

1. **确认触发**：本 PR 的真实需求是什么、动到文件的哪一段——拆分刀口优先选与需求改动同族的段（顺带原则），不为拆分而拆分。
2. 拆前：记录关联测试失败名单（`npx vitest run <目录>`）；确认工作区干净、无 0 字节杂散。
3. 逐字搬运 + re-export/import 调整；deps 数组逐字留调用点。
4. 验证矩阵：删 tsbuildinfo 后 `npx tsc --noEmit` 零 error；关联测试零新增失败；`npm run check:large-files:gate` 绿。
5. 收尾：两道 baseline 同 PR 重生成（strictReduction 组行数必须下降）；PR 描述按主计划 §8 模板（迁移行号对照 + 验证输出 + baseline 变更原因）。
6. 回填本文 §3。

子代理可用（单文件拆分时 1 个就够；禁 git 写、禁共享 CARGO_TARGET_DIR——本计划纯前端，不涉及）。

## 3. 执行记录

（待回填：触发 PR、拆前行数→拆后行数、失败名单对比、教训）
