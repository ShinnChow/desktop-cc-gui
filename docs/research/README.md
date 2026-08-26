---
type: index
status: active
---

<!-- DOC-LIFECYCLE: active-index -->
# Research 文档索引

> [!IMPORTANT]
> **Lifecycle: Active section index.** Research 包含 current architecture reference、draft RFC、external pinned snapshot、generated evidence 与 historical spike。研究结论不是产品行为事实源；current contract 以 OpenSpec 与代码为准。

## Current guides and architecture references

- [Desktop development fast-start runbook](./desktop-dev-fast-start-runbook.md) — Current runbook；`scripts/dev-local.sh`、`npm run tauri:dev`、port `1420` 已按 `0.7.16` 校准。
- [Multi-CLI provider/session foundation design](./mossx-multi-cli-provider-session-foundation-design.md) — Active architectural reference；implementation status 以 main specs 为准。
- [New CLI onboarding guide](./mossx-new-cli-onboarding-guide.md) — Current onboarding guide。
- [DSH engine onboarding execution](./mossx-dsh-engine-onboarding-execution.md) — Draft execution plan：把 DeepSeek Harness 接成第 7 个 Native Engine（不内嵌 Web UI）。实现前先开 OpenSpec change；不是 current contract。
- [DSH capability spike](./mossx-dsh-capability-spike.md) — Phase S 实测（`dsh 0.1.0-rc.6` Host RPC / WS mux）；Adapter contract 证据，不是产品 spec。
- [Qoder capability spike](./mossx-qoder-capability-spike.md) — Phase S 实测（`qodercli 1.1.27` ACP over stdio）；Adapter contract 证据，不是产品 spec。
- [Qoder engine deferred record](./mossx-qoder-engine-deferred.md) — L1 接入后置项（Shared / L3 / 黄金 turn / elicitation）；不是漏接清单。
- [PI CLI adaptation deep research](./mossx-pi-cli-adaptation-deep-research-2026-08-27.md) — 现状研究报告（pi@0.84.3 × mossx 0.9.3）：强点 / 遗留 / 未释放能力差集与 gap v3 处置对照；不是实施计划。

## Historical exploratory research

- [Plugin market and CLI foundation design](./mossx-plugin-market-and-cli-foundation-design.md) — Historical exploratory RFC；当前代码不存在通用 plugin marketplace runtime。

## Project Memory history

- [Project Memory feature overview](./00-project-memory-feature-overview.md) — Historical foundation overview with current-delta note。
- [Project Memory design](./01-project-memory-design.md) — Superseded design。
- [Project Memory architecture](./03-project-memory-architecture.md) — Superseded Phase 1 snapshot。
- [Project Memory consumption research](./04-project-memory-consumption-research.md) — Superseded by explicit Memory Reference/default `off` contracts。

## Project Memory · Pick Gate（current work）

> 行为与 UI 实现指导以 OpenSpec change 为准，不把 historical research 当 current contract。

- OpenSpec change: [`../../openspec/changes/add-memory-pick-gate/`](../../openspec/changes/add-memory-pick-gate/)  
  - `proposal.md` — 范围 / 验收 / 拍板决策  
  - `design.md` — 状态机 / 模式 / 注入  
  - **`ux.md`** — **UI/UX 定稿（实现视觉交互必读）**  
- 可交互金样: [`../prototypes/memory-pick-gate-ui-variants.html`](../prototypes/memory-pick-gate-ui-variants.html)（C 样式 only）

## External pinned research

- [MemOS architecture analysis](./02-memos-architecture-analysis.md)
- [Obsidian plugin distribution developer experience](./obsidian-plugin-distribution-dev-experience.md)
- [Obsidian plugin marketplace governance](./obsidian-plugin-marketplace-governance.md)
- [Obsidian plugin runtime architecture](./obsidian-plugin-runtime-architecture.md)
- [Obsidian security/trust model](./obsidian-security-trust-model-analysis.md)
- [Pi architecture/plugin marketplace analysis](./pi-architecture-plugin-marketplace-analysis.md)
- [Pi chat orchestration research](./pi-chat-orchestration-research.md)

External research 只描述文档记录日期或 pinned commit 的 upstream 状态。用于 current claim 前必须重新核验 upstream primary source。

## Generated realtime evidence

- [Baseline report](./realtime-cpu/baseline-report.md) — Generated evidence；不得手工修改 measurement。
- [Acceptance report](./realtime-cpu/acceptance-report.md) — Generated evidence。
- [`raw-report.json`](./realtime-cpu/raw-report.json) — Machine-readable generated evidence。
- [Rollout/rollback SOP](./realtime-cpu/rollout-rollback-sop.md) — Current runbook，范围为文中四个 legacy flags；current registry 已扩展为九项。

Producer：`npm run perf:realtime:report`。当前脚本固定写入 `docs/research/realtime-cpu`。

## Historical reproducible spikes

- [S1 Codex thread/inject_items](./spikes/2026-07-27-s1-codex-thread-inject-items.md) — Codex CLI 0.144.6 pinned evidence。
- [S2 Claude replay user messages](./spikes/2026-07-27-s2-claude-replay-user-messages.md) — Claude Code 2.1.218 pinned evidence。
- [S3 Kimi ACP](./spikes/2026-07-27-s3-kimi-acp.md) — Kimi CLI 0.27.0 pinned evidence。
- [S1 Codex harness evidence index](./spikes/harness/s1-codex-inject-items/evidence/README.md) — `thread/inject_items` schema snapshot 与 evidence 入口。
- [S2 Claude replay harness evidence index](./spikes/harness/s2-claude-replay-ack/evidence/README.md) — replay acknowledgement probe evidence 入口。
- [S3 Kimi ACP harness](./spikes/harness/s3-kimi-acp/README.md) — 可复现实验命令与 probe 入口。
- [S3 Kimi ACP harness evidence index](./spikes/harness/s3-kimi-acp/evidence/README.md) — ACP probe evidence 入口。
- [Qoder ACP harness](./spikes/harness/qoder-acp/README.md) — 可复现实验命令与 probe 入口（qodercli 1.1.27）。
- [Qoder ACP harness evidence index](./spikes/harness/qoder-acp/evidence/README.md) — ACP probe evidence 入口。
