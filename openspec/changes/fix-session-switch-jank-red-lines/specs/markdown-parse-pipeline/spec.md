# Delta: markdown-parse-pipeline

## ADDED Requirements

### Requirement: Worker Error Event MUST Be Health-Probed Before Dispose

worker `error` 事件（引擎级未捕获异常或加载失败信号）MUST NOT 直接触发 dispose：主线程 SHALL 先向 worker 发送一个固定小输入的健康探活请求（短超时，独立于正常请求生命周期）。探活成功 MUST 保留 worker 继续服务（记录 `worker-error-kept-alive` 诊断），探活失败或超时才按既有语义 dispose（terminate + 拒绝在途请求 + 连续崩溃退避）。探活路径 MUST NOT 影响正常请求的 resolve/reject 生命周期。

#### Scenario: 未捕获异常后 worker 仍存活则不重建

- **WHEN** worker 发生 error 事件且探活请求在超时内返回正确结果
- **THEN** worker 不被 terminate，后续编译请求继续由该 worker 服务
- **AND** 诊断记录 `worker-error-kept-alive` 与错误指纹

#### Scenario: worker 真死时按既有退避重建

- **WHEN** error 事件后探活请求超时或失败
- **THEN** worker 被 dispose，在途请求被拒绝并走主线程 fallback
- **AND** 连续崩溃计数与指数退避语义不变

## MODIFIED Requirements

### Requirement: Markdown Worker Requests MUST Have Bounded Lifecycle Diagnostics

worker 请求生命周期 SHALL 有界且可诊断：请求 SHALL 携带超时；崩溃诊断（`fast-markdown-worker/failed`）SHALL 携带 `reasonCode`、`errorClass`、崩溃指纹 `messageHash`（错误文本短 hash）与 `messageLength`，并 SHALL 增补 `errorName`（`TypeError` / `RangeError` / 加载失败等错误类别名），使同类崩溃可按类别归因；完整错误文本 SHALL 仅进 console 不落盘。

#### Scenario: 崩溃诊断携带 errorName

- **WHEN** worker error 事件触发诊断落盘
- **THEN** payload MUST 包含 `errorName`（取自 `event.error.name`，缺失时为 `"Error"`）
- **AND** 同类错误可通过 `errorName + messageHash + messageLength` 组合指纹跨会话比对
