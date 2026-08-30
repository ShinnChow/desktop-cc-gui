# pi-background-task-experience · tasks

## 0. Spike（实施前）

- [x] 0.1 [P0] customType 透出验证：✅ 事件层可见 `message_start/end` + `role:custom` + `customType:'background-task-notification'` + 结构化 details（2026-08-26 实证，结论已回写 design.md §3）。
- [x] 0.2 [P0] 历史重载形态验证：✅ jsonl `custom_message` 条目保留 content + details，折叠态可重建；pi_history.rs 需新增条目映射。
- [x] 0.3 [P1] registry 目录语义确认：✅ 两段皆 resident pid（扩展读不到 RPC 模式 sessionId）；精确匹配 `session-<pid>-<pid>`，失配 glob 兜底。

## 1. P1 · A1 任务卡 + A2 通知消费

- [x] 1.1 [P0] pi.rs 事件转换：bg 工具名单常量表（`bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*`）+ receipt 解析（details 优先/文本兜底）→ canonical `backgroundTask` item（EngineEvent::BackgroundTaskStarted/Updated + AppServerEvent 映射）；解析失败降级普通工具卡；RPC + print-json 双路径；单测（pi 78 + events 36 + bus 3 全过，worktree 隔离验证）。
- [x] 1.2 [P0] `agentTaskNotification.ts`：识别 `<background-task-notification>`（正则边界硬化，延续 0.3.12 口径）+ `tag`/`taskName`/`exitCode` 字段 + `isCliInjectedAgentTaskNotificationText` 覆盖 + `isPiBackgroundTaskNotification` 判别；单测 28/28。
- [x] 1.3 [P0] 前端 `BackgroundTaskCard`：组件+样式+i18n+组件测试 7/7 已完成（运行中活体 elapsed 组件本地 tick、终态原地折叠为 `message-agent-task-fold` 行、chevron 重展开）；渲染管线接线已由 1.4 完成（tail/心跳待 P2 B 数据源）。
- [~] 1.4 [P0] 通知消费接线：`onBackgroundTaskUpdated`（useThreadItemEvents）→ `applyBackgroundTaskUpdate`（会话级状态表合并 receipt/notification）→ 合成 backgroundTask item 走 item/updated 同路 upsert（reducer merge 保留建卡 title/detail）；item/started 幂等登记 `noteBackgroundTaskStarted`。通知不渲染 bubble / 不作 turn 边界用户提问（pi.rs 三臂拦截 + Rust 侧不投影 message/* method）；followUp 正文同 segment 接续（合成 item 不 increment segment）。
- [x] 1.5 [P1] 历史重载：`piHistoryParser.ts` 预扫描合并 backgroundTask call/result + backgroundTaskNotification 三类条目 → 单张折叠卡锚定 call 位置（孤儿 call 不回放防死卡；通知永不成行）；`collectPiHistoryBackgroundTasks` + `hydrateBackgroundTasksFromHistory`（只补缺/幂等）在 loader 与 resume 双入口回灌 backgroundTaskStore，重开会话 pill 仍在，未完结任务由 registry watcher 接管收敛真实终态（hydrate 测试 3 例）。

## 2. P2 · B registry watch 健康信号

- [~] 2.1 [P0] registry watcher：✅ `useBackgroundTaskRegistryWatcher`（前端复用 `read_workspace_file` 读 `.pi/tasks/session-<pid>-<pid>/<taskId>.json`，组件级 interval 3s，运行中有任务才计时，状态变了才 apply；挂载即探一次 capture 事件丢失）把**终态 metadata** 喂 `applyBackgroundTaskUpdate(source:"registry")` —— 闭合 post-settle 缺口（通知被 per-turn forwarder 丢弃后，registry 终态让卡片折叠 / pill 更新）。**实现方式偏离**：设计说「Rust watcher 挂 commands 层 AppHandle 推」；落实为「前端 watcher + 两个轻量 Rust command（`process_is_alive` / `read_workspace_file_tail`）」，避免 daemon AppHandle→webview 事件通道的复杂度与真机风险；D4 行为（读 registry 终态 / pid 降级 / 断链）等价。restricted 到 strip 挂载（正好在有任务时探测）。
- [~] 2.2 [P0] 断链判定：✅ `process_is_alive`（`libc::kill(pid,0)`）+ watcher 内「进程不存活**持续** `staleAfterMs`（默认 30s，避开退出→写 metadata 竞态窗口）且未收到终态 → 标 failed（error=异常退出）」；pid 缺失 / 探测不可用 → 保守降级（D4 pid 失配降级：仅通知/registry 终态驱动）。组件联动：卡片/ pill 按 store 终态自然折叠。
- [~] 2.3 [P1] 输出日志 tail：✅ `read_workspace_file_tail`（Rust，读文件末尾 ≤8 KiB，byte budget 对齐 tool-output）+ `readWorkspaceFileTail` TS helper + pill 面板「查看日志」点击**就地展开 tail `<pre>`**（loading/空/超长截断态）；整文件不推送。

## 3. P3 · A3+C 工具条 pill

- [~] 3.1 [P0] `ComposerRunStatusStrip` 数据源扩展：✅ `useBackgroundTaskPill`（useSyncExternalStore 事件驱动读副本，store 版本号 snapshot，无轮询）→ 「后台任务」pill（live dot / `running/total` 计数 / 全完成态只显 total）；无任务不占位（`hasAny` 参与 strip visible 判定，`anyRunning` 参与 hasLive 折叠态 dot）。数据只在 pi 会话有值，其他引擎自然隐藏。
- [~] 3.2 [P0] pill 就地展开 panel：✅ running 在上 / 终态折叠其下的分组列表（status 徽标 / 名称 / elapsed 活体 tick / exit code / 「查看日志」reveal_in_file_manager；日志 tail 读取归 P2 2.3）。顶栏入口与任务卡「查看日志」聚焦联动未做（待 P2 watcher 后统一收口）。
- [x] 3.3 [P1] Render Perf 自查：✅ 2026-08-27 收口补做完整走查（对照 AGENTS.md Render Perf 五条硬红线 + `docs/perf/render-jank-knife-experiments-2026-07-08.md` 四层根因）：① 高频 setState 不挂根链——`backgroundTaskStore` 模块级事件驱动（version+listeners，`emitChange` 仅 apply 触发），`src/app-shell/**` 对 store/pill 零引用，消费者全部挂在 composer strip / message row 组件级；② 无数组追加型根链 setState——store 为 per-(workspace,thread) map 按 taskId upsert；③ 根链零轮询——pill `useSyncExternalStore` 事件驱动，唯一 interval 是 registry watcher 组件级 3s（运行中才计时、空闲即清、状态变了才 apply，不挂根链）；④⑤ 流式通道不适用——bg 更新是低频离散 item upsert，无高频 delta 流；elapsed 活体为 `useElapsedSeconds` 组件本地 1s tick（`active` 门控 + cleanup + `memo`）。四层根因均未命中，详见 verification.md。

## 4. 文档与校准

- [x] 4.1 [P0] 基石设计 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 校准表：✅ 新增「PI background-task item 契约」行 + 「最近校准」头部注记（ADR 校准回写 Gate）：canonical `BackgroundTaskStarted/Updated{source:receipt|notification|registry}` → AppServer `item/started(type=backgroundTask)` / `item/backgroundTask/updated`，三路状态表 + BackgroundTaskCard + pill + 历史重载，post-settle 缺口归 P2。
- [x] 4.2 [P1] i18n：✅ 后台任务 pill/卡片/panel 文案 en + zh + i18nTestMessages；其余 locale 走既有补全流程（DEFAULT_FALLBACK 回退 zh/en，parity 测试按 bundle 覆盖，bg 新 key 无全语言 gate，与会话内 messages.backgroundTask* 处理一致）。
- [x] 4.3 [P1] OpenSpec validate：✅ `pi-background-task-experience` change 单独校验通过（全仓 602 passed / 7 failed 存量，与本 change 无关）。

## 5. 验证

- [x] 5.1 [P0] focused vitest：✅ 终验全套通过——utils（store/watcher/hydrate）、BackgroundTaskCard、agentTaskNotification 28、run-status 全套（pill/panel/tail）、piHistoryParser 9、liveTextSegment/liveItemDelta、useAppServerEvents 74（receipt/notification 路由）；cargo test --lib 含 pi/events/pi_history/workspaces 单测；rustfmt 7 文件 clean、prettier 新文件 clean、typecheck 0。
- [x] 5.2 [P0] 手测：✅ 用户真机全链路验证通过（运行中活体卡 → pill 计数 → mid-run/post-settle 折叠 → followUp 接续 → 历史重开 pill/卡同步）；识图回归修掉：呼吸灯/面板颜色深浅不适配（写死色 → 主题 token）、pill 与卡状态不同步（registry 漏 reducer，sink 修复）、历史会话 pill 丢失（store hydrate）。
- [x] 5.3 [P1] 设计稿对照：✅ 用户按截图多轮走查（任务卡、pill、面板、日志 tail、终态色），颜色已对齐 `docs/designs/pi-background-tasks` 意图与主题 token。

## 非目标（不在本 change）

- 任务取消能力（二期拍板后单开 change）。
- D 提示词层降 bg_run 倾向（随时可做，不阻塞）。
