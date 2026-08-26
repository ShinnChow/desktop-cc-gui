# Fix: PI registry 元数据对齐 RPC 长驻真实传输

## Why

PI 的运行时主路径自 `enhance-pi-native-rpc-session`（2026-08-23）起就是
`pi --mode rpc` 长驻 resident（steer / abort / set_model / fork / tree / compact），
print-json 只是降级路径。但 engine registry 三侧（`engineIds.json` SSOT、
Rust `EngineProtocolFamily`/`EngineExecutionModel`、daemon 共享模块）仍把 pi 标为
`stream-json-cli` / `one-shot`——与 codex（`app-server-json-rpc`/`persistent`）、
dsh（`dsh-host-rpc`/`persistent`）的真实命名失真。

危害：治理脚本与心智模型误导（「pi 是 spawn-per-turn 的 stream-json 引擎」），
onboarding guide §0 A2/A6 的 registry 元数据口径与 capability matrix
（pi `rpc.server = supported`）互相矛盾。

## What Changes

- 新增 `EngineProtocolFamily::PiRpc`（kebab-case 序列化 `pi-rpc`）；pi 的
  `protocol_family` 由 `StreamJsonCli` 改为 `PiRpc`，`execution_model` 由
  `OneShot` 改为 `Persistent`。
- `engineIds.json` pi 行同步（`pi-rpc` / `persistent`）；FE
  `EngineProtocolFamily` union 扩 `"pi-rpc"`。
- FE `.protocolFamily` / `.executionModel` 当前**零下游消费**（纯元数据，
  grep 全仓仅 engineRegistry 自身），改动无行为风险；realtime adapter 路由
  按 engine id，不经 family。
- 降级路径语义注记：print-json fallback 是 RPC 不可用时的降级，不改变
  registry 登记的主传输模型（与 codex 登记persistent 同理）。

## Impact

- 跨层 contract：engineIds.json SSOT + TS union + Rust enum + daemon（`#[path]`
  共享）+ 治理脚本 `check-engine-adapter-registry.mjs`（只断言 id 序与字段
  非空，值不受影响）。
- 命中基石 ADR「更新触发器」之 engine registry：校准行回写
  `docs/research/mossx-multi-cli-provider-session-foundation-design.md`。
