# Delta: conversation-realtime-cpu-stability

## ADDED Requirements

### Requirement: Thread Item Cache Eviction MUST Protect Recent Switches

线程条目缓存驱逐 SHALL 在既有 activity LRU 与 protected（active / in-flight / pinned）之上叠加「近期切换保护集」：10 分钟内被切换过的会话 MUST NOT 进入 evictable 候选；保护集 MUST 有硬上限（`THREAD_ITEM_CACHE_RECENT_PROTECT_MAX = 8`），超限时在保护集内部按 activity LRU 淘汰，MUST NOT 无界增长。驱逐的 ref 清理时序协议（`cleanupThreadScopedRefs` 先于 `dispatch({ type: "evictThreadItems" })` 等）MUST 保持不变——本条只改变候选选择，不改清理协议。

#### Scenario: 来回点击不触发整轮驱逐

- **WHEN** 用户在 2 分钟内来回切换超过 cacheMax(12) 个会话后点回 10 分钟内看过的会话
- **THEN** 该会话 MUST NOT 因本轮切换被驱逐
- **AND** 重进不重付全额 history load

#### Scenario: 保护集有界

- **WHEN** 近期切换集合大小超过 `THREAD_ITEM_CACHE_RECENT_PROTECT_MAX`
- **THEN** 保护集内部按 activity LRU 淘汰超额条目
- **AND** 缓存驻留上界不超过 cacheMax + `THREAD_ITEM_CACHE_RECENT_PROTECT_MAX`
