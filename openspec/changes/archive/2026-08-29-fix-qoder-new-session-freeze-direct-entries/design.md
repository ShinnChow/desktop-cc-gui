# fix-qoder-new-session-freeze-direct-entries design

## 1. 决策：放弃发行版弹层，改双直入口

原方案（`qoder-dual-distribution` 主 spec）：New Session 菜单一个 `Qoder CLI` 父项 + Global/CN 子项 flyout。事故复盘出两个独立卡死源：

- `switch_engine` IPC 无超时（F2 护栏已修）；
- Qoder 子项点击「创建」与供应商子项点击「记忆选择」（`keepMenuOpen: true`）共用 overlay 的 submenu/菜单态调度，Qoder 子项创建后菜单关闭路径与供应商弹层的保持展开路径互相踩踏，重建 groups 的 signature effect（`useSidebarMenus` 内 JSON.stringify 对账）再次接管时形成挂死窗口。

两个修法候选：

| 候选 | 结论 |
| --- | --- |
| 给 Qoder 子项单独改 overlay 调度 | 拒绝：动共用弹层机制 = 碰全部引擎的供应商弹层，违反「别的都不变」约束 |
| CLI 列表层直接拆 Global/CN 两行（用户拍板） | 采纳：Qoder 路径上不再存在任何弹层；共用机制零改动 |

行可用性语义保持原判：`engineOptions` 只汇报单一（Global）Qoder status —— Global 行用 `resolveEngineActionMeta(workspace, "qoder")`，CN 行永不阻断（原 `resolveQoderParentActionMeta` 改名 `resolveQoderCnActionMeta`）。

## 2. Shared 创建的显式发行版（F4）

`resolveSharedSessionCreateInitialTarget` 对 Qoder 返回固定 `[Global, CN]` 列表且不参与「记住的供应商」优先级（`REMEMBERED_PROVIDER_ENGINES` 刻意不含 qoder）。双入口需要把用户点的那一行带进来：

- 入参加可选 `preferredProviderId`，`prioritizePreferredQoderDistribution` 只对 `qoder` 生效、只在命中固定列表时置顶（不认识的 id 静默回落 Global 默认，fail-safe）；
- 不走 `writeLastProviderProfileId("qoder", ...)`：避免为省一个参数引入跨组件隐式记忆，且不改变「qoder 无供应商记忆」的既有边界；
- 透传链 `onAddSharedAgent(workspace, engine, options?) → handleStartSharedConversation → resolve`，三处签名均为可选参数追加，其余引擎零感知。

Native 路径无需新参数：`runAddAgent("qoder", creationProviderSelection(profile))` 早已支持显式 profile。

## 3. switch_engine 有限等待（F2）

`ENGINE_SWITCH_WAIT_TIMEOUT_MS = 15s`。要点：

- 创建流模态内的任何 `await` 挂住 = 弹窗永不关闭 = 整窗「卡死」，因此超时后**保乐观态返回**，不抛错、不回滚；
- 检测缺失/未安装分支不再 `await requestEngineDetection({ force: true })` 全量探测（spawn CLI 无时限），改 `void` fire-and-forget 的 per-engine 刷新；
- 迟到结果由既有 generation 守卫在后台合并——禁止与「迟到成功」互相打架（不回滚已乐观生效的选择）。

## 3.5 client store IO 移出主线程（F5，sample 现行实锤的共同根因）

用户复测「任意 CLI 创建都卡、愈发必现」后，对仍带残热的 dev 进程 `sample` 采样：主线程 2023/2023 样本全部落在

```
Tauri IPC(URL scheme) → invoke_handler → client_store_patch
  → patch_store_at_path → with_client_store_lock → serde_json 全量 parse/serialize
```

`composer.json` 3MB / `app.json` 1.5MB，同步命令在主线程做全量 JSON 序列化，单次秒级、连发即整窗 beachball。引擎无关——创建链路的 patch 批次（threads/composer/app/diagnostics/leida）谁先到谁撞。抽屉放大触发频率（打开即检测事件流 + 折叠持久化 + 行点击状态事件），于是「自从抽屉后任何 CLI 都卡」。

修法：三个 store 命令改 `async` + `tokio::task::spawn_blocking`，payload 解析一并下移；新增 `client_store_read_sync` 仅供启动期菜单语言探测一次性调用。正确性边界：

- 同 store 写序由前端既有 `writeChainByStore` promise 链保证（Rust 侧并发化不引入同 key 乱序）；
- 跨 store 并发安全：文件锁 + 进程内 cache mutex 已覆盖 read-modify-merge；
- daemon / app-server 无 client store 路径（桌面进程内独有），无平行修复面。

## 4. 折叠持久化（F1）

`useSidebarWorkspaceMenuSectionCollapse`：存「已折叠分组 id」集合（client store `app` / `sidebarWorkspaceMenuCollapsedSections`），缺省空集合 = 全部展开；`toggle` 先写存储再 `setState`（updater 保持纯函数，防 StrictMode 重放双翻转）。overlay 初始化 = 持久集合 ∩ 本菜单可折叠分组。

## 5. 测试与验收口径

- `useSidebarMenus.test.tsx`：双入口平铺断言（无 children / 无 `submenuOnly`）、CN 点击带 `__qoder_cn__`、Global status 不可用时 Global 行置灰 CN 行可点、shared CN 行透传 `providerProfileId`、三组 action id 顺序；
- `resolveSharedSessionCreateInitialTarget.test.ts`：显式 CN 选中、未知 id 回落 Global、缺省维持 Global；
- 碰撞测试：全量 vitest 与 HEAD 基线失败集合对照（预存失败不属本 change 管辖，不修不扩大）。

## 6. 收口校准：AppShell identity boundary

诊断确认抽屉关闭路径本身会将 `workspaceMenuState` 置空并在下一次 React commit 卸载 overlay；“关闭后仍像未卸载”是 render storm 延迟 commit 的表象。为避免以 stale event handler 换取短时流畅度，最终实现不采用 `useDeferredValue` 包裹 domain/input bag，而是在 `reuseStableAppShellDomainContexts` 中同时复用 domain slice 与外层 bag identity，并以 `memo(AppShellView)` 作为重建边界。该校准保持交互 handler 即时，同时抑制无变化快照的整壳重建。
