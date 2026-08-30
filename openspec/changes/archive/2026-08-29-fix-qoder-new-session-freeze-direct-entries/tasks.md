# fix-qoder-new-session-freeze-direct-entries tasks

> 纪律：F1/F2 由前一工作段落地，F3/F4 由收口工作段落地；全部完成后跑全量碰撞测试再提交收口。
> 边界：Claude/Codex/Kimi/Grok/OpenCode 供应商弹层与 Vendor Settings 双页签不在本 change 管辖。

## Phase 0 — 提案登记

- [x] 0.1 创建 `openspec/changes/fix-qoder-new-session-freeze-direct-entries/`（proposal / design / tasks / 3 个 spec delta）
- [x] 0.2 `openspec validate fix-qoder-new-session-freeze-direct-entries --strict --no-interactive` 通过
- [x] 0.3 登记 `openspec/changes/README.md` 活动提案索引

## Phase 1 — 抽屉 Shared/Native 分组 + 折叠持久化（F1）

- [x] 1.1 `buildSessionMenuGroups` 拆 `new-session-shared` / `new-session` 两个可折叠分组（hint/helpTip 同源 i18n）
- [x] 1.2 新增 `useSidebarWorkspaceMenuSectionCollapse`：client store 持久化「已折叠分组 id」集合，缺省全展开；toggle 先写存储再 setState
- [x] 1.3 `SidebarWorkspaceMenuOverlay` 三分组（Shared / Native / 工作区操作）接折叠态；`sidebar.css` 分节样式
- [x] 1.4 i18n：10 语言 `sidebar.ts` 分组文案（`nativeCliGroupLabel` / `sharedCliHint` / `sharedCliHelp` / `nativeCliHint` / `nativeCliHelp` / `providerChoiceHelp`）

## Phase 2 — switch_engine 有限等待护栏（F2）

- [x] 2.1 `useEngineController`：创建流内引擎切换 15s 上限（`ENGINE_SWITCH_WAIT_TIMEOUT_MS`），超时保乐观态返回、不抛错
- [x] 2.2 检测缺失/未安装分支去同步 `await`：per-engine 后台强刷 + 乐观切换路径
- [x] 2.3 迟到 switch 结果由 generation 守卫后台合并不回滚；`useEngineController.test.tsx` 回归锁定

## Phase 3 — Qoder 双直入口（F3/F4）

- [x] 3.1 `NEW_SESSION_ENGINE_ACTION_IDS` 换 `new-session-qoder-global` / `new-session-qoder-cn`（同映射 `qoder`，启停 gate 语义不变）
- [x] 3.2 Native 组：删 `submenuOnly` 弹层父项，平铺两行（Global 行用真实 engine status，CN 行 `resolveQoderCnActionMeta` 永不阻断），点击即 `creationProviderSelection` 创建
- [x] 3.3 Shared 组：qoder 移出通用引擎表，`QODER_DISTRIBUTION_PROFILES` 平铺两行，`onAddSharedAgent` 增可选 `options.providerProfileId`
- [x] 3.4 `resolveSharedSessionCreateInitialTarget` 增可选 `preferredProviderId`（仅 qoder、仅命中固定列表置顶，未知 id 回落 Global）；`useAppShellSections` / `layoutNodesTypes` / `Sidebar` 签名透传
- [x] 3.5 测试：双入口平铺 / CN 点击带显式 profile / Global 不可用 CN 可点 / shared CN 透传 / 显式发行版选中与回落
- [x] 3.6 `tsc --noEmit` 0 error；`check:app-shell:governance` 无新增 offender（composer 存量违规另行处理）

## Phase 4 — 碰撞测试与收口

- [x] 4.0 F5 追加：`client_store_read/write/patch` 改 async + `spawn_blocking`（payload 解析下移；`menu.rs` 改 `client_store_read_sync`）；模块测试 8/8、`cargo check`、rustfmt clean
- [x] 4.1 碰撞测试：1298 前端测试文件分片全量跑 + 42 可疑文件隔离复核 + HEAD stash 基线逐文件计数对照——失败集合与 HEAD 完全一致（存量），零新增失败；app-shell startup 9 + feature boundaries 1 + Sidebar 4 均实证 HEAD 可复现
- [x] 4.2 `openspec validate fix-qoder-new-session-freeze-direct-entries --strict` 通过（`validate --all` 另有 7 个其他 change 存量失败，与本 change 无关）
- [x] 4.3 中文 Conventional Commits 分批提交收口（前端功能流 / store IO 根因 / 本 change 提案与最终修复）
- [x] 4.4 后置项已登记（不纳入本 change）：`composer.json` 3MB 瘦身；侧栏创建路径 45s 超时兜底（对齐 composer 发送路径 `useCreateSessionLoading`）；daemon 串行 RPC 循环队头阻塞评估
