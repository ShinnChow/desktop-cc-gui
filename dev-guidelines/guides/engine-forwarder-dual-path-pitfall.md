# 引擎转发器双路径陷阱（dev app 进程 vs 安装版 daemon）

> 沉淀自 2026-08-30 pi 实时幕布丢尾事故：修复在 `daemon_state.rs` 里迭代了三轮、
> 测试全绿，dev 客户端却三轮复现全程无变化——因为 dev 引擎跑在 app 进程内，
> 事件转发走的是 `engine/commands.rs` 里的另一份老拷贝。叠加孤儿 daemon 占端口
> 被无身份校验的 bootstrap 收编，运行时加载的代码比仓库落后数天。

## 一、机制实锤：引擎事件转发器存在两份（pi 为例）

| 运行形态 | 引擎宿主进程 | pi resident 父进程 | 事件转发器代码位置 |
|---|---|---|---|
| dev（`npm run tauri dev`） | `target/debug/cc-gui`（app 进程内） | **cc-gui** | `src-tauri/src/engine/commands.rs` 对应引擎 arm |
| 安装版 | `cc_gui_daemon`（常驻子进程） | cc_gui_daemon | `src-tauri/src/bin/cc_gui_daemon/daemon_state.rs` |

关键事实（全部经 `ps`/`lsof` 实证）：

1. **dev 模式没有 daemon**。pi resident（`pi --mode rpc`）由 app 直接 spawn，
   `ps -o ppid,command -p <pi_pid>` 的 PPID 指向 `target/debug/cc-gui`。
2. daemon 是常驻进程，**跨 app 退出/升级存活**（PPID=1 被 launchd 收养）。
3. `daemon_bootstrap` 的「端口可达即收编」无身份校验：孤儿 daemon（如
   `/tmp/daemon-test-data` 的测试残留）占住 4732/4733 端口时，客户端会连上
   **数天前的旧代码**，且 `resolve_or_build_daemon_binary` 见二进制已存在就
   不再重建。
4. 两份转发器互不共享模块（claude 例外：`engine/claude_forwarder.rs` 被
   commands.rs `#[path]` 共用，但 daemon_state 内另有内联 claude 逻辑）。
   2026-08-30 前 pi 的两份拷贝已漂移数个 feature。

## 二、事故时间线（为什么「改了三轮都没变化」）

1. 8/27：`/tmp/daemon-test-data` 测试残留 daemon 占住 4733，一直活着。
2. 8/29–8/30：pi 外部 turn 实时投影修复全部落在 `daemon_state.rs`；单测全绿。
3. dev 客户端启动后收编 4733 孤儿 → 修复永不执行 → 用户三轮复现全部复现旧 bug。
4. 8/30 07:15 又暴露第二层：即使换成 app 内转发器，它也是老拷贝
   （硬过滤 `turn_id != primary` + `is_terminal 即 break`），尾部照样被吞。

## 三、硬红线（Gate）

1. **改引擎事件链（pump / 转发器 / 门控 / 结算 / break 条件）前，先确认目标
   进程拓扑**：dev = app 进程；安装版 = daemon。改完一份必须问自己：
   「另一份拷贝在哪，同步了吗？」
2. **纯判定函数一律下沉 `engine/<engine>.rs` 共享**（如 pi 的
   `is_pi_external_wakeup_allowed` / `is_pi_agent_settled_marker` /
   `is_pi_foreground_native_turn` / `is_pi_background_notification_event`），
   禁止在 bin 层（daemon_state / commands）复制实现。
3. **验证修复前必须核对运行中进程的血统**：
   - `ps aux | grep cc_gui_daemon` —— daemon 进程是否存在、来自哪个二进制；
   - `ps -o pid,ppid,lstart,command -p <resident_pid>` —— 引擎 resident 的
     父进程是 app 还是 daemon；
   - `lsof -iTCP:4732 -sTCP:LISTEN`（4733 同理）—— 端口被谁占着。
   禁止只看仓库代码下「应该修好了」的结论。
4. **bootstrap 收编 daemon 前必须校验构建一致性**（已实现）：
   `ensure_listening_daemon_matches_build` 校验监听进程二进制路径与本 app
   的 `resolve_daemon_binary` 一致，且二进制 mtime 不晚于进程启动时间；
   不一致（升级替换了二进制、dev/安装版混跑、孤儿残留）→ 终止旧进程并
   spawn 当前构建。无法识别时保守收编（兼容远端/未知部署）。

## 四、遗留风险（已知未清）

- claude 转发器双拷贝（daemon_state 内联 vs `engine/claude_forwarder.rs`）
  未统一，同样存在「改一处漏一处」风险；后续按 pi 模式下沉共享。
- daemon 身份校验当前基于「路径 + 二进制 mtime vs 进程启动时间」；更稳的
  方案是 daemon 暴露协议级 build id 握手，避免 mtime 不可靠的文件系统场景。
- dev 下 `tauri dev` 不会主动重建 `target/debug/cc_gui_daemon`
  （`resolve_or_build_daemon_binary` 见文件存在即跳过构建）；改 daemon 代码后
  需手动 `cargo build --bin cc_gui_daemon` 或删除旧二进制再启动。
