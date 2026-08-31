---
name: release-quality-audit
description: 发版前代码质量审查。大文件治理三道闸门（gate/near-threshold/strictReduction retained）+ tsc/cargo 全量 + 测试零新增失败对比 + Format Discipline 提交卫生 + 高风险域 pitfall 红线。只审查只报告不修复。触发场景：用户说「发版前审查」「release quality audit」「质量门禁」或准备发版/打 tag 前。
---

# Release Quality Audit

执行清单见 `.claude/commands/release-quality-audit.md`（single source of truth，避免双层内容漂移）。

要点速记：
1. 工作区卫生：无杂散（0 字节文件 / cc_gui_daemon/main.rs / vite.config.js/.d.ts）。
2. `check:large-files:gate` exit 0；strictReduction 三组（settings-view-sections / bridge-runtime-critical / feature-hotpath）出现 retained = 阻塞。
3. 删 tsbuildinfo 后 `npx tsc --noEmit` 零 error；`cargo check --all-targets` 零 error。
4. 测试只要求零新增失败，存量失败名单以 docs/2026-08-31-large-file-split-wave6-plan.md §0/§8 为准，勿顺手修。
5. `git diff --stat` 排查格式化噪音（Format Discipline Gate）。
6. 命中引擎双转发器 / app-shell / git-history / 冷启动路径时过对应 pitfall 红线。

输出按 `.claude/commands/release-quality-audit.md` 末尾的报告模板。
