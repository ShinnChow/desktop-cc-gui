# 项目规则入口（mossx）

## 规则优先级

- 当前项目代码实现 > 项目内文档（`AGENTS.md` / `dev-guidelines/**` / `openspec/**`）> 全局 `~/.codex/rules/*` / 全局 `~/.codex/AGENTS.md`
- 文档主体使用中文，technical terms 保留 English
- AI 写 OpenSpec proposal / design / tasks / spec delta 时，必须采用中英文结合：中文用于业务判断、风险、实施顺序和验收口径，English technical terms、文件名、函数名、命令、metric id、chunk 名保持原文

## 文档分层

本仓库将规则与状态分成四层：

1. **Project entry**：`AGENTS.md`
   - 只负责规则优先级、最小读取路径、全局 gate、分层指针
2. **Implementation rules**：`dev-guidelines/**`
   - frontend / backend / guides 的具体实现规范
3. **Behavior specs**：`openspec/**`
   - proposal / design / tasks / main specs / workspace governance
4. **Host adapter / runtime**
   - `.claude/**`、`.codex/**`、`.agents/skills/**`：host 适配与可选 skills
   - `.omx/**` 及其他本地运行态目录：不是长期仓库资产，不作为规范事实源

解释性文档与可入库设计稿统一放 `docs/**`，不写回以上四层细则正文：

- 文档：`docs/guides` / `analysis` / `architecture` / `plans` / `research` / `reports` 等，入口 `docs/README.md`
- 设计稿（HTML 原型、选款页、视觉 mock）：`docs/designs/`
- 禁止把要保留的设计稿放仓库根 `designs/` 或 `.artifacts/`

## 最小读取路径

- 开始任务先读本文件。
- 涉及实现时，再按需读：
  - `dev-guidelines/frontend/index.md`
  - `dev-guidelines/backend/index.md`
  - `dev-guidelines/guides/index.md`
  - 若任务本身在改规则入口或文档边界，再读 `dev-guidelines/guides/project-instruction-layering-guide.md`
- 涉及 UI 原型 / 设计选款时，再读 `docs/designs/`。
- 涉及 behavior/change/workflow 时，再读：
  - `openspec/README.md`
  - `openspec/project.md`
  - 对应 `openspec/changes/<change-id>/**`
- 只有在调试 host hooks / commands / skills 时，才优先深入 `.claude/**` 或 `.codex/**`。

## OpenSpec 交付

- `openspec/**` 是 behavior / proposal / change 的 single source of truth。
- `dev-guidelines/**` 是 code-level rule 与 executable contract 的沉淀位置。
- 涉及行为变更、产品交互、跨层 contract 变更时：
  1. 先创建或选择 OpenSpec change
  2. 再实现（对照 `dev-guidelines/**`）
  3. 实现后同步更新相关 capability spec，并执行 verify / sync / archive 流程

## 实现入口

- frontend / backend / cross-layer 详细规则不要写回 `AGENTS.md`。
- 这类细则统一维护在 `dev-guidelines/**`：
  - frontend: `component-guidelines.md`、`hook-guidelines.md`、`state-management.md`、`quality-guidelines.md`、`type-safety.md`
  - backend: `directory-structure.md`、`error-handling.md`、`logging-guidelines.md`、`database-guidelines.md`、`quality-guidelines.md`
  - cross-layer / reuse / shell / unified-exec: `dev-guidelines/guides/**`

## 全局 Gate

### Git Commit Message

- 默认必须使用中文主体的 Conventional Commits：`type(scope): 中文动宾短句`
- 若仓库脚本或 workflow 与此冲突，先修正规则或配置，再提交

### PlanFirst

- 任何代码、配置、规范落盘前，先给出 `PLAN` 或等价 OpenSpec artifact。
- 若任务已进入 OpenSpec workflow，则以 OpenSpec artifact 作为 plan 载体。

### Engine Onboarding Gate

- 接入新 CLI engine（或恢复/变更既有 engine 的接入面）前，必读 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`（基石设计）与 `docs/research/mossx-new-cli-onboarding-guide.md`（全量接入点核对矩阵）。
- 实施必须按核对矩阵 §0 逐层勾选；⚠ 标记的静默失败点全部人工核对，🔵 按需在 PR 描述写决策记录。
- PR 描述须附矩阵完成度说明、渲染层目视验收结果与受影响 CI gate 运行结果。

### ADR 校准回写 Gate

- OpenSpec change 收口 / archive 前，若变更命中基石文档「更新触发器」（engine registry、Shared 支持集合、provider binding、canonical fact schema、context compiler、terminal/ACK contract、recovery exit / abandon），必须同步刷新 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 的「最近校准」标注与「零、当前实现校准」表。
- 校准行必须带可核对的代码事实源（repo-relative 文件路径或 OpenSpec change id），禁止只写概念。
- 未回写的 change 不得标记收口 / 归档。

### AppShell Structure Gate（P1-5）

- 改 `src/app-shell/**` / domain bag / shell providers 时：
  1. 先读执行计划 `docs/plans/2026-08-11-app-shell-cohesion-optimization.md` 与 Ownership Matrix `docs/plans/app-shell-ownership-matrix.md`
  2. **新 shell 状态必须有 owner domain**（写入 `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS` + 对应 builder/consumer）；禁止无主塞 bag 尾
  3. legacy flatten/adapt API（`flattenAppShellDomainContexts` / `adaptAppShellLegacyFlatContext` / `legacy/legacyFlatten.ts` 门面）已于 S4 PR-F 全量删除，禁止重新引入；生产路径用 `selectAppShellDomainBag` / `mergeAppShellDomainBag`
  4. 本地 / CI 须通过：`npm run check:app-shell:governance`
- Domain key：soft 80 / hard 见 freeze 表（S4 PR-F 起全部咬实测值，新增 key 必须先出后进；终态目标 60）；navigation hard ≤ 79
- Composition：`src/app-shell/assembly/AppShell.tsx` 禁止直接 `useState` 业务状态

### Merge Guardrails

- 高风险文件冲突时，禁止整文件 `--ours` / `--theirs` 覆盖。
- 必须先列 capability matrix，再做 semantic merge，并验证关键 symbol / tests / contract command。

### Format Discipline Gate（格式化铁律）

- **禁止无脑格式化**：任何格式化工具（prettier / rustfmt / cargo fmt / eslint --fix / biome / 任何 linter 的全文件或全仓模式）只允许作用于**你本次改动的文件**，且只允许**局部格式化**（你本次编辑触及的 hunk 区域）。
- 禁止对未改动文件做「顺手 fmt」；禁止以「让整个文件过 check」为由重排全文件——check 暴露的**非本次改动区域**存量违规，只能单独开纯格式提交修复，禁止混入业务提交。
- 多 AI 并行是本仓库常态：你的全文件重排会把别人的在途 hunk 裹进巨型 diff，制造冲突、误提交与 review 噪音（2026-08-25 实证两次：ModelSelect.tsx 被 prettier 全量重排 2680 行裹住在途改动；src-tauri 全仓 clippy+fmt sweep 100 文件）。
- 提交前自查 `git diff --stat`：改动行数远超你的实际编辑 = 混入格式化噪音，必须拆开（拆法：拆 hunk `git apply --cached`，或 `git show HEAD:file` + 脚本重放 + `git update-index --cacheinfo`）。
- 各语言细则：frontend `dev-guidelines/frontend/quality-guidelines.md`（Prettier 红线）、backend Rust Format Gate（见下）。

### Rust Format Gate

- 2026-08-25 起提交树已 rustfmt-clean（纯格式提交 `ddf590b70`，已入 `.git-blame-ignore-revs`）。目标转为**保持 clean**：改过的 `.rs` 提交前必须过 `rustfmt --edition 2021 --check <file>`。
- 全仓 fmt / clippy sweep 按 Format Discipline Gate 视为禁止（除非用户显式拍板，且只能单独开纯格式提交）；禁止把无关区域的 fmt 噪音混进业务提交。
- 细则：`dev-guidelines/backend/quality-guidelines.md`（Rust Format）。配置：`src-tauri/rustfmt.toml`、`.vscode/settings.json`。

### Shell Baseline

- 遇到 `command not found`，先执行：
  - `zsh -lc 'source ~/.zshrc && <command>'`
- 仍失败再排查：
  - `zsh -lc 'source ~/.zshrc && which <command> && echo $PATH'`

### Render Perf Baseline

- 2026-07-08 实验基线曾观察到 AppShell 根渲染单次阻塞主线程 100~350ms；该数值是有日期的历史测量，不是永久 current value。改动对话/流式/后台任务链路前，读 `docs/perf/render-jank-knife-experiments-2026-07-08.md`（四层根因），并以重新测量结果为准。
- 硬红线：① 高频 setState（每事件/日志/轮询级）禁挂根 hook 链；② 数组追加型 setState 禁入根链；③ 根链 store 用事件驱动 + ≥30s 兜底轮询，禁秒级轮询；④ 流式正文走 `liveAssistantTextChannel`（flag `liveTextExternalization` 默认开），禁恢复逐 delta dispatch 进 reducer；⑤ 思考/工具输出走 `liveItemDeltaChannel`（flag `liveDeltaExternalization` 默认开），禁把三类电报重新打根。
- 完整复盘（主因 / 解法 / 防再犯清单 / 回退开关）：`docs/perf/pr-1092-performance-retrospective.md`（PR #1092）。
- 渲染风暴排查用归因面板 + React `memoizedUpdaters` 追踪（复现指南见上述文档 §七）；react-scan 2~3x 放大，测量前关。

### Native WebView API Gate（2026-08-06 uiScale P0 沉淀）

- 调用任何 native / WebView 系统能力（zoom、DPI、窗口、透明度、Tauri command）前，必读 `dev-guidelines/guides/native-webview-api-risk-gate.md` 并过三问：① 有无纯 Web 替代（有则一律用，如 CSS `transform: scale()` 替代 native zoom）；② 出错用户能否自救；③ 验收矩阵是否覆盖平台 × 取值 × 系统 DPI。
- 「启动时生效的持久化设置」若错误值可致起不来 / 进不了设置页，必须配 startup guard（模板 `src/utils/uiScaleStartupGuard.ts`）：危险值留 pending 记录，未证明健康则下次会话临时回退安全值，**禁止改写用户存储**，禁止拿 timeout 当修复。
- 平台结论必须按证据分级（已证实 / 已排除 / 未验证）；「没接到投诉」不算安全证据。

### Engine Forwarder Dual-Path Gate（2026-08-30 pi 实时幕布丢尾沉淀）

- 改引擎事件链（pump / 转发器 / 门控 / 结算 / break 条件）前，必读 `dev-guidelines/guides/engine-forwarder-dual-path-pitfall.md`，并先确认目标进程拓扑：**dev（`npm run tauri dev`）引擎跑在 cc-gui app 进程内**（pi 转发器在 `engine/commands.rs` 对应引擎 arm），**安装版引擎跑在 cc_gui_daemon**（转发器在 `bin/cc_gui_daemon/daemon_state.rs`）。
- 两份转发器拷贝必须同步演进；纯判定函数一律下沉 `engine/<engine>.rs` 共享（如 pi 的 `is_pi_external_wakeup_allowed` 等），禁止在 bin 层复制实现。
- 验证引擎修复前必须核对运行进程血统（`ps -o pid,ppid,lstart,command -p <resident_pid>` 看父进程、`lsof -iTCP:4732/4733 -sTCP:LISTEN` 看端口归属），禁止只看仓库代码下结论；bootstrap 收编 daemon 前校验同 build（二进制路径 + mtime vs 进程启动时间），不一致终止重衍——daemon 常驻跨升级存活，孤儿/旧构建占端口会让新 app 永远拿不到新代码。

### Windows Cold-Start Click Freeze Gate（2026-08-14 版本记录 / 权限选择 P0 沉淀）

- 改 `bootstrapApp` / Release Notes auto-open / ComposerGate / `ChatInputBox` Light 路径 / first-click 调度，或处理「Windows 启动后点按钮卡死」前，必读 `dev-guidelines/guides/windows-cold-start-click-freeze-pitfall.md`。
- 硬红线：① 禁止用固定 timeout 当冷启动修复；② 禁止用第一次 pointerdown/keydown 启动 deferred stores / i18n / updater / Markdown compile / ComposerImpl；③ 禁止假设 StartupGateOverlay 默认在挡用户；④ 禁止 Light 层泄漏可点 ModelSelect / atomic catalog。
- 分析与入口表见 `docs/analysis/windows-cold-start-click-freeze-release-notes-and-composer-2026-08-14.md`。只修用户点到的那一个按钮不算修完。

### Session Switch Catalog Fetch Gate（2026-08-19 切会话拉 catalog 卡死沉淀）

- 改切会话 / `setActiveThreadId` / `commitThreadSelection` / `useProviderModelCatalogSync` / composer `providerProfileId` / `refreshEngineModels` 前，必读 `dev-guidelines/guides/session-switch-catalog-fetch-pitfall.md`。
- 硬红线：① 点击路径禁止 `get_engine_models` / `refreshEngineModels` / `vendor_switch_*`；② `forceRefresh: false` 仍会 IPC，不算便宜；③ 本地 sentinel 禁止当 composer 新 catalog 作用域；④ 绑回独立配置禁止 switch L1。
- 标签补齐会让「空 id 时的 early-return」失效；热路径加预热前必须按「每条会话都有该字段」重演点击。

### WebView Animation Compat Gate（2026-08-19 流体背景 Win 兼容沉淀）

- 改 WebGL / canvas 全屏动效、workspace wallpaper、`backdrop-filter` 盖动态层、或 `prefers-reduced-motion` 停 RAF 前，必读 `dev-guidelines/guides/webview-animation-compat-pitfall.md`。
- 硬红线：① 禁止用平台隐藏当兼容性修复；② 禁止把 Windows / ANGLE 兜底写进 Mac 默认路径；③ 禁止一条 mega-shader 靠 uniform 分支切完全不同的场；④ 禁止 `backdrop-filter` 盖 WebGL 而不做 Win 验收；⑤ 禁止 canvas 未 attach 就打透明孔；⑥ 禁止 RAF 停了还不重画。
- Mac 已正确的 frost / reduced-motion / chase 预编译不得被 Win 现场改掉。验收用 isolated 开发者客户端，禁止 kill 当前会话窗。

## 仓库卫生

- `.omx/**`、`.ccgui/**`、client-local state 等本地 state 属于 runtime artifact 或 local-only state。
- 这类目录和文件不作为规范事实源；若误入库，应按仓库卫生规则清退并加入忽略策略。
