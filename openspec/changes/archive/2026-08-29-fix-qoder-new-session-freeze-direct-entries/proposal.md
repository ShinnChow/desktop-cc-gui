# fix-qoder-new-session-freeze-direct-entries

## Why

2026-08-29 用户实测：工作区「新建会话」抽屉点 Qoder 仍会整窗卡死。事故链有三段：

1. **switch_engine IPC 无内建超时**：后端 CLI spawn 卡住时，绑定它的创建流（loading 弹窗）被永久挂死。Chrome 在等待前已乐观切换，前端却在同步 `await` 一个可能不返回的 IPC（已在 `useEngineController` 落有限等待护栏）。
2. **发行版二级弹层残留**：护栏落地后「Qoder CLI → 选择 Qoder 发行版」二级弹层仍与供应商（Claude/Codex 等）弹层共用同一套 menu 态调度，互抢展开态时新建会话路径再次卡死。用户拍板换思路：**Qoder 不放列表展开层，在 CLI 列表层直接拆成 Qoder Global / Qoder CN 两个入口**，点击即建会话；其余引擎的供应商弹层与所有其他链路一律不动。
3. **client store IO 卡主线程（macOS sample 现行实锤的共同根因）**：抽屉化后创建链路连发 client store patch（threads / composer / app / diagnostics / leida），而 `client_store_read/write/patch` 是同步 Tauri 命令、跑在主线程，每次全量 parse + serialize 整份 store——`composer.json` 已达 3MB，单次 patch 秒级，连发即整窗 beachball。引擎无关，任意 CLI 点创建都撞（已把三个命令改 async + `spawn_blocking` 移出主线程）。

## What Changes

- **F1 抽屉 Shared/Native 分组 + 折叠持久化**：「新建会话」抽屉拆 `Shared CLI`（引擎可切换）/ `Native CLI`（引擎固定）两个可折叠分组，与「工作区操作」共用 `sidebarWorkspaceMenuCollapsedSections` 本地持久化折叠态；缺省全部展开（取代旧「工作区操作默认折叠、每次打开重置」语义）。
- **F2 switch_engine 有限等待护栏**：创建流内引擎切换不再无限 `await`——15s 上限保乐观态返回；检测缺失/未安装时不 await 全量检测，改 per-engine 后台刷新 + 乐观路径；迟到 switch 结果由 generation 守卫后台合并，不回滚。
- **F3 Qoder 双直入口**：Shared 与 Native 两组的 Qoder 从「1 行父项 + 发行版 flyout」改为平铺 `Qoder Global` / `Qoder CN` 两行；点击即带显式 profile（`__qoder_global__` / `__qoder_cn__`）建会话。Global 行反映 engine status（不可用置灰）；CN 行不被单一 Global 状态阻断。CLI 配置管理停用 gate 不变（两个入口同映射 `qoder`，一起隐藏）。
- **F4 Shared 创建显式发行版**：`resolveSharedSessionCreateInitialTarget` 新增可选 `preferredProviderId`，Qoder 命中固定 distribution 列表时优先选中；未传或 id 失效维持 Global 默认。经 `onAddSharedAgent` → `handleStartSharedConversation` 透传，仅 Qoder 消费。
- **F5 client store IO 移出主线程**：`client_store_read/write/patch` 改 async + `tokio::task::spawn_blocking`（payload 解析一并下移）；`menu.rs` 启动期语言探测改走新增 `client_store_read_sync`。前端按 store 的 `writeChainByStore` 写序 + Rust 侧文件锁/进程内 cache 保证合并正确性。
- **F6 AppShell no-op render stabilization**：当 domain slice 内容未变化时复用整个 `AppShellDomainContexts` 外层 bag，并以 `memo(AppShellView)` 阻断无效整壳重建；不使用会让事件 handler 滞后的 deferred snapshot。该项用于收口抽屉打开/关闭期间的渲染风暴放大效应。

## 收口校准（2026-08-29）

真机短时复测与 renderer diagnostics 曾未再出现 `debug.shell-render-storm`、`debug.freeze-storm` 或 `perf.main-thread-stall`，但 release 复测发现定位探针本身会放大 `Object.freeze`/GC 压力。现已移除 `Object.freeze` monkey-patch 以及 render/effect/菜单点击路径的 immediate 探针，仅保留低频创建异常日志与 stall watchdog。创建会话链路完成，`events.backpressure` `droppedCount=0`。长历史 PI 会话仍可能产生单次较长 React commit，此项属于独立的 history render budget 后续工作，不阻塞本 change 收口。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `qoder-dual-distribution`: New Session 菜单从「单父项 + Global/CN 子项」改为两组各两个**直入口**（无二级弹层）；Vendor Settings 单页双页签语义不变。新增「创建流引擎切换有限等待」要求（乐观切换 + 有界等待 + 迟到结果不回滚）。
- `shared-session-engine-selection`: Shared 创建面描述对齐分组抽屉（每组一行；Qoder 呈现两个显式发行版入口），新增「显式发行版入口钉死 shared 创建 provider」场景；第一 Provider + 权威 catalog 的既有语义不变。
- `sidebar-workspace-menu-group-collapse`: 折叠语义从「工作区操作默认折叠、临时展开」改为「三个分组用户可控、本地持久化、缺省展开」。

## 非目标

- 不动 Claude / Codex / Kimi / Grok / OpenCode 的供应商二级弹层（`keepMenuOpen` 记忆语义不变）。
- 不动 Vendor Settings 的 Qoder 单页双页签与「独立配置」语义。
- 不引入第三个 Qoder distribution、不引入 Qoder 供应商记忆（`pi/qoder 无供应商记忆` 维持）。
- 不改 engine visibility / CLI 配置管理启停 gate 的过滤语义（新入口 id 同映射 `qoder`）。

## 风险

- **R1（低）双入口信息密度**：两组各多一行；抽屉本身已按 Shared/Native 分节 + 可折叠，密度可接受。
- **R2（低）CN 可用性误判**：engineOptions 只汇报单一（Global）Qoder status；CN 行沿用「永不阻断」语义，误判面是「CN 实际未装却可点」→ 创建失败走既有错误回报，不静默。
- **R3（中）乐观切换迟到结果**：15s 超时后迟到的 switch 成功/失败由 generation 守卫合并，禁止回滚用户可见态（与迟到成功互不打架）；回归由 `useEngineController.test.tsx` 锁定。

## ADR 校准回写

不命中基石文档「更新触发器」：engine registry、Shared 支持集合、provider binding 契约、canonical fact schema、context compiler、terminal/ACK contract、recovery exit / abandon 均未变更（Qoder Global/CN 双 distribution 早已在 `enable-qoder-shared-target` 边界内，本次只是入口形态与创建参数显式化）。
