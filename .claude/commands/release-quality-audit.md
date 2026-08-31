---
description: 发版前代码质量审查——大文件治理 + 类型/测试基线 + 提交卫生，防止质量回退
---

# 发版前代码质量审查（release-quality-audit）

来源：大文件拆分 Wave 1–6（docs/2026-08-30-large-file-split-master-plan.md、wave5/wave6 计划 §7/§8 教训沉淀）。目标：发版前 10 分钟内确认治理闸门全绿、无静默回退。**只审查、只报告，不做任何修复**（修复走单独 PR）。

按以下顺序逐项执行，每项给出 ✅/❌ + 一行证据；任何 ❌ 必须在报告中给出文件级明细。

## 1. 工作区卫生

- `git status --short`：确认无意外未跟踪/未提交文件；wave 计划文档未跟踪属正常，其余杂散要列出。
- 杂散文件检查：`ls src-tauri/src/bin/cc_gui_daemon/main.rs 2>&1`（应为不存在，Wave 5 波 3 事故位）；`find src src-tauri/src -size 0 \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' \)` 应为空；`ls vite.config.js vite.config.d.ts 2>&1` 应为不存在（tsc -b 误产物，教训⑭）。

## 2. 大文件治理闸门（核心，三道全绿才算过）

- `npm run check:large-files:gate`：exit 必须 0。
- `npm run check:large-files:near-threshold`：逐项读 watchlist：
  - **strictReduction 组（settings-view-sections / bridge-runtime-critical / feature-hotpath）出现任何 retained = 直接 ❌**（这三组已启用 retained 阻塞，出现即说明有人在 PR 外绕行或 baseline 被误重生成）。
  - 其余组 retained 数量与 `delta`：delta>0 说明存量在涨，列出文件与涨幅。
- 对比 `git log --oneline -5 -- docs/architecture/large-file-baseline.json scripts/check-large-files.policy.json`：baseline/policy 最近若被改动，改动必须挂在拆分 PR 里且有 PR 描述登记治理豁免；孤立的 baseline 重生成提交 = ❌（疑似用重生成掩盖增长）。

## 3. 类型与构建

- `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete && npx tsc --noEmit`：零 error（必删 tsbuildinfo 重跑，增量缓存会掩盖错误，纪律①）。
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`：0 error（既有 warning 噪音可忽略，新增 warning 涉及本次发版改动文件的列出）。

## 4. 测试基线对比（不追求全绿，追求零新增）

- 已知存量失败清单以 docs/2026-08-31-large-file-split-wave6-plan.md §0 与 §8 各波记录为准（useThreadMessaging 系、GitHistoryWorktreePanel 8、claude_history 9、compaction/routing 4、Messages.live-follow 系 10 等，勿当新失败报）。
- 跑本次发版触及目录的测试：`npx vitest run <涉及目录>`；Rust 侧 `cargo test --manifest-path src-tauri/Cargo.toml <涉及模块>`。
- 判定：失败名单与存量清单逐字对比，**零新增 = ✅**；任何新失败 = ❌ 阻塞发版。

## 5. 提交卫生（Format Discipline Gate）

- `git diff --stat main...HEAD`（或以本次发版起点为基）：逐文件看改动行数，行数远超业务逻辑的（尤其 >500 行的 tsx/rs）= 疑似混入全文件格式化噪音，列出待人工核对。
- 确认无 `git commit` 之外的改写历史操作混入分支（rebase/amend 痕迹）。

## 6. 高风险域专项（命中才查）

- 发版改动触及引擎事件链（engine/forwarder/daemon）：核对 `dev-guidelines/guides/engine-forwarder-dual-path-pitfall.md`，dev（app 进程内）与 daemon（cc_gui_daemon）两份转发器判定函数必须单实现。
- 触及 app-shell：`npm run check:app-shell:governance` 须绿。
- 触及 git-history：`check:git-history:runtime-contract` + `check:git-history:static-imports` 须绿。
- 触及启动/冷启动路径：对照 windows-cold-start-click-freeze 与 session-switch-catalog-fetch 两篇 pitfall 的硬红线逐条过。

## 输出格式

```
## 发版质量审查报告（<分支> @ <HEAD 短哈希>）
| 项 | 结果 | 证据 |
| 工作区卫生 | ✅/❌ | ... |
| 大文件 gate | ... | retained=N，delta=0 |
| strictReduction 三组 | ... | 无 retained / 违规文件 |
| tsc / cargo | ... | |
| 测试零新增 | ... | 跑了哪些目录，失败名单对比 |
| 提交卫生 | ... | |
| 高风险域 | ... / N/A | |
结论：可发版 / 阻塞（原因清单）
```
