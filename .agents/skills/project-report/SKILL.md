---
name: project-report
description: 项目报表：大文件分布、模块代码量、大文件治理状态（gate/retained/baseline 新鲜度）一屏总览。只读。触发场景：用户说「项目报表」「项目整体情况」「大文件分布」「project report」。后续将扩展性能、测试健康、依赖等维度。
---

# Project Report

执行清单见 `.claude/commands/project-report.md`（single source of truth）。

要点：全部只读命令；§1 总览指标卡 → §2 治理状态（gate/retained/strictReduction/baseline 新鲜度）→ §3 大文件按组分布 → §4 模块代码量 Top 15 → §5 预留扩展段（性能/测试/依赖，未接入输出占位）。分段独立，单段失败标 N/A 不阻塞其余。
