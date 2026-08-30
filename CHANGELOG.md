# Changelog

---

### **2026年8月30日（v0.9.4）**

中文：

这一版升到 **0.9.4**，主线是 **PI 响应提速、引擎检测重做、后台任务全程有迹可循，外加一轮切会话卡顿与跨引擎污染的集中收口**。PI 首条消息的等待明显缩短：会话激活时自动预热常驻进程（冷启约 2.5s 移出发送关键路径）、新会话首条短消息自动降思考档（省约 11s 静默）、静默期出现「等待首段文本」专属文案与 12 秒安抚提示，等待不再像卡死。引擎检测流水线整体重构：检测结果带 TTL 缓存与 last-good 落盘、逐引擎推送让菜单逐项亮起不再全量等待、检测失败有明确失败态与 25 秒守卫（根除永久「检测中」）、登录态两段式返回不再被 spawn 探测阻塞；环境解析每进程至多一次，检测开销大幅下降。后台任务第一次全程可见：会话行新增第四态呼吸灯与终态未读徽标，切走会话后终态仍全路径回写时间线卡片，卡片直读权威快照可自愈。切会话做了一轮系统提速：会话历史加载改内存索引 + raw-string 通道消除对象图过桥冻结、元数据合批、写盘旁路，切会话计时证据落盘可查。同时收口了一批跨引擎污染问题：切会话清模型锁、draft carry 引擎门禁、Home 点选引擎盲区封死，不同引擎的会话不再互相串台。

✨ Features

- **PI 首包提速三件套**：会话激活时自动预热常驻进程，冷启动约 2.5 秒移出发送关键路径；新会话首条短消息思考档自动降为 low，省去约 11 秒思考静默且不覆盖你手动设的档位；PI 静默期显示「等待首段文本」专属文案，超过 12 秒给出安抚提示，等待过程不再像卡死
- **引擎检测流水线重做**：检测结果带 TTL 缓存、per-engine 强制刷新与 last-good 落盘（SWR）；逐引擎推送检测结果，引擎菜单逐项亮起，不再全量等待；检测失败有明确失败态、25 秒守卫与跨模块单飞保护，永久「检测中」被根除；登录态两段式返回，detect 不再等 spawn 探测，异步补推 requires-login；模型下拉与新会话菜单可用性同源，状态翻转统一失效
- **后台任务会话行第四态**：会话行右侧 meta 区新增后台任务呼吸灯与终态未读徽标，并行双会话、重启终止等场景的计数与收口语义全部明确；改名会话时任务计数与任务表随迁，不再挂旧 id
- **native 会话 turn-target 显示条**：native 会话幕布接入 turn-target 显示条与运行回执，回合归属一目了然
- **可点控件悬停提示补全快捷键**：按钮悬停 tooltip 现在展示对应快捷键

🔧 Improvements

- 版本号统一升到 `0.9.4`，打包元数据同步对齐
- **切会话系统提速**：会话历史加载改内存索引 + raw-string 通道，消除加载固定成本与对象图过桥冻结；会话 hydrate 元数据合批，切会话写盘旁路（sidebarSnapshot 签名跳过、radar 去 immediate、肥 key 治理）；threads 全量 map 收窄进 threadDataContext 并落可执行 gate
- **引擎检测开销大降**：环境解析进程级缓存（npm prefix / login shell 每进程至多 1 次）；detect 与模型目录解耦、启用范围过滤、per-engine 隔离
- **诊断取证增强**：崩溃取证结构化（errorName / 文本指纹 / 组件帧安全命名落盘）；worst-K 掉帧持久环、切会话分段计时（loadMs / assembleMs）与 hotspot 周期汇总；markdown worker error 先探活再处决
- **PI 对齐 0.84.3**：auth catalog 对齐 pi 0.84.3 并补录 moonshotai 双区 provider；capability_state 五键委托 spec-generated，消灭双源口径漂移；PI registry 元数据对齐 RPC 长驻真实传输（pi-rpc/persistent）
- **Composer selector 层重构**：删除零引用的 ProviderSelect / ShortcutActionsSelect 死代码，抽取 SelectorOptionRow 选项行原语替换六处手写渲染，ModelSelect 纯函数与 channel picker 拆分
- **PI 幕布静默丢失链封死**：PI 会话幕布三类静默丢失链全部封堵，load 失败可重试、可观测

🐛 Fixes

- **压缩留痕劫持回合终态**：压缩留痕改产 context-event，不再劫持回合终态锚点；compaction_end 映射透传 reason / token 元数据不伪造 manual；codex 原生 compacted 不再被误补 fallback
- **后台任务卡片永停「运行中」**：post-settle 终态更新绕过回合终态守卫、卡片改直读 store 权威快照自愈翻终态、registry watcher 上收 app 级枚举，切走会话后终态仍全路径回写
- **跨引擎模型串台**：切线程清理用户模型锁杜绝残留压制选择收敛；draft carry 增加引擎门禁与 catalog 成员资格闸，封死 Home 点选引擎盲区污染；pi catalog default 改读 settings 真默认，无账本会话切入不再误绑 anthropic 模型
- **claude-fork 会话删除复活**：删除的会话不再因持久快照回灌而复活
- **会话列表扫描卡死**：codex 列表扫描加内层 32 秒截止，超时后线程真正停止读盘；focus-refresh 与 first-paint 冷启动不再伪造引擎超时与全表误标 degraded；full-catalog 自动重扫连续超时改指数退避
- **Claude 会话标题误剔**：会话索引标题先还原 slash-command prompt 再截断，信封前缀超长不再整条误剔，正文引用 command 标签片段不再被误提取
- **PI 思考 / 工具行粘连等待文案**：思考 / 工具行渲染即清「等待首段文本」，流已到标签不再粘连
- **PI list-models 降级自愈**：降级思考目录在打开模型菜单时自动重探恢复
- **引擎切换后思考档 / 模型缺失**：引擎切换后显式加载目标引擎目录；解耦引擎响应式目录表 + 后台预热补全非激活态目录消费漏点；authState 到达引发的 INVALIDATED 风暴收敛为 installed 翻转独占
- **P0 模型错乱回退**：撤销解耦引擎轻量分支的静态快照回填，根因修复

English：

This release moves to **0.9.4**, headlined by **a faster PI first response, a rebuilt engine-detection pipeline, end-to-end background-task visibility, and a sweep of session-switch jank and cross-engine contamination fixes**. PI's wait for the first token is much shorter: sessions prewarm the resident process on activation (about 2.5s of cold-start cost leaves the send path), the first short message of a new session automatically drops to low thinking effort (saving ~11s of silence without overriding your manual setting), and a dedicated "waiting for first text" message with a 12-second reassurance hint makes the wait no longer feel frozen. Engine detection is rebuilt wholesale: TTL-cached results with last-good persistence, per-engine push so menu entries light up one by one instead of waiting for everything, explicit failure states with a 25s guard (permanent "detecting" is gone), and two-phase login status that no longer blocks on spawn probes. Background tasks are visible end-to-end: a fourth-state breathing light and terminal unread badge on session rows, final-state writeback across every path after switching away, and cards that read the authoritative store snapshot to self-heal. Session switching got a systematic speed-up — in-memory history indexing plus a raw-string channel eliminating object-graph bridge freezes, batched metadata, and a disk-write bypass, with switch timing evidence persisted for inspection. A batch of cross-engine contamination issues is also closed: model locks cleared on thread switch, draft-carry engine gates, and the Home-entry blind spot sealed, so sessions from different engines no longer bleed into each other.

✨ Features

- **PI first-packet speed-up trio**: sessions prewarm the resident process on activation, moving ~2.5s of cold-start cost off the send path; the first short message of a new session auto-drops thinking effort to low, saving ~11s of silent thinking without overriding your chosen level; a dedicated "waiting for first text" message appears during PI's silent window with a reassurance hint after 12 seconds
- **Engine detection pipeline rebuilt**: detection results carry TTL caching, per-engine force refresh, and last-good persistence (SWR); results push per engine so menu entries reveal one by one instead of blocking on the full sweep; explicit failure states, a 25-second guard, and cross-module single-flight protection eliminate the permanent "detecting" state; login status returns in two phases — detect no longer waits on spawn probes and pushes requires-login asynchronously; the model dropdown and new-session menu now share one availability source with unified invalidation
- **Fourth-state background-task indicator on session rows**: the session row's right-side meta area gains a breathing light for running background tasks and an unread badge on terminal states, with settled semantics for parallel sessions and restarts; renaming a session migrates task counts and the task table instead of leaking the old id
- **Turn-target display bar for native sessions**: native session canvases show the turn-target bar and run receipts
- **Shortcut hints in hover tooltips**: button tooltips now display their keyboard shortcuts

🔧 Improvements

- Bump the app version to `0.9.4`, aligning bundle metadata
- **Systematic session-switch speed-up**: history loading switches to an in-memory index plus a raw-string channel, eliminating fixed load costs and object-graph bridge freezes; hydrate metadata batching; disk-write bypass on switch (sidebar snapshot signature skip, radar de-immediated, fat-key governance); the threads map narrows into threadDataContext behind an executable gate
- **Cheaper engine detection**: process-level environment caches (npm prefix / login shell at most once per process); detect decoupled from model catalogs with enable-scope filtering and per-engine isolation
- **Diagnostics forensics**: structured crash forensics (errorName / text fingerprints / safely-named component frames on disk); a persistent worst-K frame-drop ring, segmented session-switch timing (loadMs / assembleMs), and periodic hotspot summaries; markdown worker errors probe before reaping
- **PI aligned to 0.84.3**: auth catalog aligned with pi 0.84.3 plus the moonshotai dual-region provider; capability_state's five keys delegate to spec-generated data, ending dual-source drift; PI registry metadata reflects the real persistent RPC transport (pi-rpc/persistent)
- **Composer selector-layer refactor**: dead ProviderSelect / ShortcutActionsSelect code deleted, a SelectorOptionRow primitive replaces six hand-written option rows, and ModelSelect splits pure functions from the channel picker
- **PI curtain silent-loss chains sealed**: all three silent-loss paths for PI session curtains are closed, with retryable, observable load failures

🐛 Fixes

- **Compaction marker hijacking turn finality**: the compaction marker now emits a context-event instead of hijacking the turn's final anchor; compaction_end passes through reason / token metadata instead of forging "manual"; codex-native compacted events no longer get a spurious fallback
- **Background-task cards stuck on "running"**: post-settle final-state updates bypass the turn-finality guard, cards read the authoritative store snapshot to self-heal, and the registry watcher enumerates running sessions at app level — final states write back on every path even after switching away
- **Cross-engine model bleed**: user model locks clear on thread switch; draft carry gains an engine gate and a catalog-membership gate, sealing the Home-entry blind spot; pi's catalog default reads the true settings default, so sessions without an account no longer mis-bind an anthropic model
- **claude-fork sessions resurrecting after deletion**: deleted sessions no longer resurrect via persisted snapshot replay
- **Session-list scan stalls**: codex list scanning gets an inner 32-second deadline so threads truly stop reading disk after timeout; focus-refresh and first-paint no longer forge engine timeouts or mark everything degraded; full-catalog auto-rescan backs off exponentially on consecutive timeouts
- **Claude session titles wrongly dropped**: index titles restore the slash-command prompt before truncation, so overlong envelope prefixes no longer drop the whole entry and quoted command-tag fragments are no longer mis-extracted
- **Waiting copy sticking to thinking/tool rows**: the "waiting for first text" message clears as soon as thinking or tool rows render
- **PI list-models degradation self-heals**: degraded thinking catalogs re-probe automatically when the model menu opens
- **Missing thinking levels / models after engine switch**: switching engines explicitly loads the target engine's catalog; decoupled engines get a reactive catalog table plus background prewarm; the INVALIDATED storm triggered by authState arrival is narrowed to installed-transitions only
- **P0 model mix-up reverted**: the static-snapshot backfill on decoupled-engine light branches is reverted, fixing the root cause

### **2026年8月25日（v0.9.3）**

中文：

这一版升到 **0.9.3**，主线是 **PI 引擎更快更能干、删会话终于删得干净，外加一轮全界面提速和一批顽固问题的集中收口**。PI 会话改成长驻连接，不再每句话都重启一次进程，响应明显更快；一次带来四个新能力——从任意消息**分叉**新分支、用**会话树**纵览整条分支结构、把多个会话**融合**成一个、上下文太长时一键**压缩**瘦身；后台任务也首次全程可见，运行中有实时任务卡和状态入口，结束后原地折叠、随时翻看日志。PI 启动失败会自动回退旧模式，其他 8 个引擎完全不受影响。删除与归档彻底重做：确认删除的会话立刻从侧栏消失、后台真正清理文件，「删了过几分钟又冒回来」的幽灵会话被根除；归档即时生效、不再整表重载；快捷键里那个叫「归档」的按钮也终于真的在归档了。界面侧，幕布新增**极简模式**、置顶拆成**全局 / 项目内**双作用域、模型菜单支持**搜索**、PI 可按模型选**思考强度**、供应商认证支持**自定义供应商**；设置页、搜索、模型菜单首开、会话列表等热路径做了一轮系统提速。稳定性上集中收口了 Windows 上对话结束消息消失、后端不可用时「响应中」永久卡死、中转断流回合永挂、PI 长任务被误杀、Linux 通知音崩溃等一批反馈集中的问题。

✨ Features

- **PI 常驻连接，响应更快**：PI 会话改用长驻连接，不再每条消息都重启一次进程，从发送到开始响应的等待明显缩短；PI 启动失败会自动回退旧模式，其他 8 个引擎零影响
- **PI 四大新能力：分叉 / 会话树 / 融合 / 压缩**：从任意一条消息**分叉**出新分支探索不同方案；用**会话树**纵览整条分支结构，分支关系一目了然；把多个会话**融合**成一个、延续全部上下文；上下文太长时一键**压缩**瘦身，不必重开会话从头聊
- **分叉与压缩体验顺手**：分叉弹窗做了全语言本地化，遇到不能分叉的会话会说明原因并给出下一步建议；压缩入口并入上下文指示圆圈、弹窗就地展开，成功后原地反馈；会话树隐藏了冗余头部栏、精修底部状态栏
- **PI 后台任务全程可见**：PI 在后台跑的任务（后台命令、委派任务、融合）第一次有了完整体验——运行中显示实时任务卡，输入框上方出现「后台任务」状态 pill，点开就能看到运行中 / 已结束列表和退出码，还能就地查看日志末尾；任务结束后原地折叠成一行，随时重新展开；重开会话时历史任务不丢，尚未完结的任务会自动收敛到最终状态，不再无感知
- **删会话真的删了**：确认删除的会话立刻从侧栏消失，文件清理由后台接续完成；个别删不掉的残留会自动重试，不会再「删掉又冒回来」；批量删除一次完成、实时显示进度，失败的项目可以单独回滚恢复；右键菜单新增「在会话管理中批量删除…」直达入口；rewind / 分叉产生的附带会话同样走新链路清理
- **归档即时生效**：归档 / 取消归档秒级完成，侧栏立刻摘行，不再整个列表重新加载；之前名叫「归档」的快捷键实际在删会话，这次改成真正的归档
- **侧栏默认显示的会话数可调**：全局默认 5 个，可以在设置里调 1~20；每个工作区还能单独设置覆盖全局值，已保存的设置不会被改写
- **幕布极简模式**：设置里开启后，按回合整段折叠思考 / 工具过程，幕布只留正文；流式中的回合同样整段折叠，展开时内部仍按阶段逐段呈现；随时可以切回常规模式
- **置顶双作用域**：侧栏置顶拆成「全局置顶」与「项目内置顶」两个互斥作用域，恢复总折叠行；已置顶会话的图钉常亮，区段头与工作区对齐
- **模型菜单可搜索、同名可辨**：模型选择子菜单支持输入即筛，模型再多也一搜即得；同一供应商配置多个上游出现同名模型时，条目保留中段路径加以区分，不再拿错
- **PI 按模型选思考强度**：PI 接入按模型的思考强度档位选择，并打通发送闸门确保选择真正生效；Shared / Atomic 上的思考档位联动也同步扩展到 PI
- **自定义供应商**：供应商认证新增自定义供应商区块，可以在应用内直接读写 `models.json`，接入自己的中转或私有部署
- **自动续跑上限放宽**：供应商断线 / 报错后的自动续跑上限从 10 次提高到 999 次，更多失败状态码纳入自动续跑判定，挂机跑长任务更不容易被打断

🔧 Improvements

- 版本号统一升到 `0.9.3`，前端包信息与打包元数据同步对齐
- **设置页打开更快**：6 个重的设置分区改为按需加载，打开设置明显提速
- **大结果搜索更流畅**：工作区搜索对大结果集接入虚拟化，几千条命中也能顺滑滚动
- **界面重渲染收紧**：五个占资源的面板收紧刷新范围，一个面板里的状态变化不再拖动整个布局
- **运行时日志提速降噪**：本地错误 / 性能日志链路的卡顿点收口，后台记录不再拖慢前台
- **模型菜单首开提速**：PI / Kimi / Grok 的模型列表改为缓存优先，首次打开下拉不再同步等待底层引擎探测（此前最长可达数十秒）；手动刷新仍走完整探测
- **会话列表更稳更快**：列表查询不再被后台全引擎扫描阻塞（此前偶发数秒停顿）；加载全程显示分阶段进度，不再闪现「暂无会话」的假空态；切回最近会话时行更早出现
- **超大终端输出不再拖慢界面**：终端工具输出设置上限，再大的输出也不会拖垮页面
- **PI 压缩更稳**：压缩有 500 秒时间余量和运行中防重入保护，成功后原地反馈，不再中途失败
- **在应用外建的 PI 会话也能找到**：首次打开后后台补做磁盘扫描，应用外创建的 PI 会话会陆续出现在列表里
- **PI 会话丢失更容易诊断**：新增全链路埋点，会话从列表消失时更容易定位问题
- **PI 输出口径校准**：工具输出统计口径对齐、思考内容计数夹紧、技能目录补齐，用量展示更可信
- **工作区别名弹窗重写**：打开更快、样式更顺手
- **多语言补齐**：会话树加载失败重试、极简展示、顶部会话页签等文案补齐全部支持语言

🐛 Fixes

- **PI 长会话打不开会话树**：超长会话绘制分支树时的崩溃已修复
- **PI 分叉后主线消失**：分叉静默失败导致主会话被隐藏、分叉条目挤占侧栏、分支泄漏成顶层会话、树连线断开等一系列显示问题已修复
- **PI 中文路径会话打不开**：附件路径包含中文时的崩溃已修复，相关会话不再永远进不去
- **PI 标题与历史回放泄漏原始标记**：侧栏标题与历史消息不再显示 `<file name="...">` 这类原始包装
- **PI 切换模型不生效**：会话里换了模型、发送时却仍用旧模型的问题已修复
- **PI 长任务被误杀**：回合结算改为看门狗对账，长时间运行的任务不再被当成失败中途打断
- **PI 多会话并行卡死**：多个 PI 会话并行不再互相卡死；连接故障被熔断后会冷却自恢复，不用重启应用
- **PI 后端不可用时发送卡住**：PI 不可用期间发送改为立即失败并给出可操作的提示，不再一直挂着
- **PI 历史附图丢失**：历史中的用户附图会被还原；带图提问刷新后，用户气泡不再接到助手回复的尾部
- **三方供应商 Codex 模型三类事实修正**：绑定三方供应商的 Codex 会话，此前思考强度选择器不可用、模型列表混入中转并不提供的官方模型、上下文窗口一律按 200K 算出误导性百分比；现在思考强度恢复可用（低 / 中 / 高 / 超高，默认中），列表只显示该供应商真实提供的模型，窗口未上报时如实显示「未上报」
- **macOS 图形界面启动时三方供应商不可用**：从 Dock / 启动台打开应用时，Codex 供应商配置依赖的环境变量解析失败导致供应商失效的问题已修复
- **对话结束那一刻消息消失**（Windows / Claude 反馈集中）：对话过程中内容一直可见、回合结束消息却消失且刷新不回来的问题已修复——历史加载的翻页游标、大文件边界丢行、回合后全量替换三处叠加缺陷一次修清
- **后端不可用时「响应中」永久卡死**：后端重启等窗口内产生的孤儿回合由看门狗自动结算为可重试状态，不再永远转圈
- **中转断流回合永挂**：Claude 回合中途流静默时由看门狗接管结算，不再永远卡在「生成中」
- **Shared 续跑死循环**：已完成回合被进程退出码误判为失败、进而无限续跑的死循环已修复
- **回合结尾丢字**：AI 回复最后一段偶尔丢失的问题已修复
- **新会话刷不出来**：侧栏「重新加载」现在强制重扫索引，在应用外新建的会话立刻出现
- **侧栏第一段会话列表空白**：残留的共享会话空目录不再拖垮可见性计算
- **关闭最后一个页签后停在空白**：现在会自动清空选择并回到工作区首页
- **Qoder 登录凭证优先级**：已保存的凭证不再被系统环境变量覆盖，登录恢复正常
- **Windows 数字错位**：「改动文件」计数的前缀符号与首位数字重叠的问题已修复
- **Windows 文件链接打不开**：补齐 Windows 文件链接解析规则，Markdown 里的文件链接能正常在资源管理器打开
- **网络盘项目加载失败**：网络驱动器 / 映射盘上的项目，Files 面板现在能正常打开
- **Linux 通知音崩溃**：Linux 上播放通知音导致的崩溃已修复
- **模型菜单空目录**：打开模型菜单时自动恢复只剩兜底条目的引擎目录

English:

This release moves the app to **0.9.3**, with **a faster and far more capable PI engine, deletes that finally delete for good, and a broad speed-up plus a sweep of long-standing issues**. PI sessions now keep a long-lived connection instead of relaunching a process for every message, and PI gains four new powers in one go: **fork** a branch from any message, browse the whole branch structure in a **session tree**, **fuse** multiple sessions into one, and one-click **compact** an over-long context; background tasks are visible end-to-end for the first time, with live task cards and a status pill while running and a folded summary you can reopen anytime. If PI fails to start it falls back to the old mode automatically, with zero impact on the other 8 engines. Delete and archive were rebuilt from the ground up: confirming a delete removes the row instantly and files are cleaned up in the background, the "deleted sessions that resurrect minutes later" ghost problem is gone, archiving takes effect immediately without a full-list reload, and the shortcut that used to silently delete things when it said "archive" now actually archives. On the interface side, the canvas gains a **minimal mode**, pins split into **global / in-project** scopes, the model menu is **searchable**, PI gets per-model **thinking effort**, and vendor auth accepts **custom providers** backed by `models.json`; Settings, search, the first open of the model menu, and the session list were systematically sped up. Stability work closed out a batch of widely-reported issues: messages vanishing the moment a reply finished on Windows, turns stuck on "responding" forever during backend restarts, turns hung forever on relay stalls, PI long tasks killed mid-run, and the Linux notification-sound crash.

✨ Features

- **PI keeps a persistent connection, faster responses**: PI sessions use a long-lived connection and no longer relaunch a process for every message, so the wait before a response starts is noticeably shorter; if PI can't start it falls back to the old mode automatically, with zero impact on the other 8 engines
- **Four new PI powers: fork / session tree / fusion / compaction**: **fork** a new branch from any message to explore alternatives; see the whole branch structure at a glance in a **session tree**; **fuse** multiple sessions into one that carries all the context; one-click **compact** an over-long context instead of starting the conversation over
- **Forking and compaction feel right**: the fork dialog is fully localized and explains why a session can't be forked plus what to do next; the compaction entry lives in the context indicator with an anchored popover and in-place success feedback; the session tree drops its redundant header bar and polishes the bottom status bar
- **PI background tasks, visible end-to-end**: PI tasks that run in the background (background commands, delegated tasks, fusion) get a full experience for the first time — live task cards while running, a "background tasks" status pill above the input that opens the running / finished list with exit codes and a log-tail viewer; finished tasks fold into a single row you can reopen anytime; history survives reopening a session, and unfinished tasks settle to their final state automatically instead of passing silently
- **Deletion that actually deletes**: the row vanishes from the sidebar the moment you confirm while files are cleaned up in the background; leftovers retry automatically instead of resurrecting; batch delete finishes in one shot with live progress, and failed items can be rolled back individually; the context menu gains a "Delete in Session Management…" entry; sessions left behind by rewind / fork are cleaned up through the same new pipeline
- **Instant archiving**: archive / unarchive completes in seconds, the row leaves the sidebar immediately, and the list no longer reloads; the shortcut that used to silently delete things under the name "archive" now truly archives
- **Adjustable sidebar session count**: 5 sessions by default, adjustable 1–20 in settings; each workspace can still override the global value, and existing settings are never rewritten
- **Minimal canvas mode**: once enabled in settings, each turn's thinking / tool process folds into one block and the canvas keeps only the body; live turns fold the same way, expanding reveals the per-phase breakdown, and you can switch back any time
- **Dual pin scopes**: sidebar pins split into mutually-exclusive "global" and "in-project" scopes with the fold-all row restored; pinned sessions keep a lit pin, and section headers align with workspaces
- **Searchable, disambiguated model menu**: the model picker submenu filters as you type, so even a long model list is one search away; when one provider has multiple upstreams exposing same-named models, entries keep a path segment to tell them apart
- **Per-model thinking effort on PI**: PI gains per-model thinking-effort selection wired through the send gate so the choice actually takes effect; Shared / Atomic effort linking extends to PI as well
- **Custom provider configs**: vendor auth gains a custom-provider section that reads and writes `models.json` in-app, so you can plug in your own relay or private deployment
- **Higher auto-retry cap**: automatic continue after vendor failures goes from 10 attempts to 999, more failure codes qualify for auto-continue, and long unattended runs are far less likely to be interrupted

🔧 Improvements

- Bump the app version to `0.9.3`, aligning frontend package metadata and bundle configuration
- **Settings opens faster**: six heavy settings sections load on demand
- **Smoother large search results**: workspace search virtualizes big result sets, so thousands of hits scroll smoothly
- **Tighter interface re-renders**: five resource-heavy panels narrow their refresh scope, so a state change in one panel no longer drags the whole layout along
- **Quieter, faster runtime logging**: stalls in the local error / performance logging path are closed out, so background logging no longer slows the foreground
- **Faster first open of the model menu**: PI / Kimi / Grok model lists are cache-first, so the first open of the dropdown no longer waits synchronously on underlying engine probing (which could take tens of seconds); manual refresh still runs the full probe
- **A steadier, faster session list**: list queries are no longer blocked by full-engine background scans (which could stall for seconds); loading shows staged progress instead of flashing a fake "no sessions" state; rows appear sooner when switching back to a recent session
- **Huge terminal output no longer slows the UI**: terminal tool output is capped so large outputs can't bog the page down
- **More reliable PI compaction**: a generous 500-second time budget, re-entry protection while a compaction is running, and in-place success feedback — no more mid-compaction failures
- **External PI sessions come back**: after the first open, a background disk scan picks up PI sessions created outside the app so they show up in the list
- **Diagnosable PI session loss**: end-to-end instrumentation makes it much easier to pinpoint why a session went missing from the list
- **PI output accounting calibrated**: tool-output accounting aligned, thinking length clamped, and the skill catalog completed, so usage numbers are more trustworthy
- **Workspace alias dialog rewritten**: opens faster with a cleaner look
- **Localization gaps filled**: session-tree retry, minimal display, top session tabs, and other copy now exist in every supported language

🐛 Fixes

- **Long PI sessions couldn't open the session tree**: fixed the crash when rendering branch trees for very long sessions
- **Main line vanished after a PI fork**: fixed the cluster of fork display issues — silent fork failures hiding the main session, fork entries crowding the sidebar, branches leaking as top-level sessions, and broken connector lines in the tree
- **PI sessions with Chinese paths wouldn't open**: fixed the crash on attachments with Chinese paths that locked those sessions out forever
- **Raw tags leaking into PI titles and history**: sidebar titles and replayed history no longer show raw wrappers like `<file name="...">`
- **PI model switch not taking effect**: fixed sending with the old model after switching models in a session
- **PI long tasks killed mid-run**: turn settlement now reconciles via watchdog, so long-running tasks are no longer reaped as failures
- **Parallel PI sessions restored**: concurrent PI sessions no longer stall each other; after a connection fault trips the breaker it cools down and recovers on its own, without restarting the app
- **Sends hanging while PI is unavailable**: sending during a PI outage now fails fast with an actionable message instead of hanging
- **PI history images restored**: user attachments are recovered from history; after a refresh, an image question's user bubble no longer glues onto the assistant's reply
- **Third-party Codex provider model facts corrected**: on Codex sessions bound to a third-party provider, the thinking-effort selector used to be unavailable, the model list mixed in official models the relay doesn't actually serve, and the context window was always computed as 200K, producing misleading percentages; the effort selector now works (low / medium / high / extra-high, default medium), the list shows only the models that provider actually offers, and an unreported window honestly shows "not reported"
- **Third-party providers broken when launched from the macOS GUI**: fixed the failure to resolve environment variables required by Codex provider configs when the app is opened from Dock / Launchpad
- **Messages vanishing the moment a reply finished** (concentrated on Windows / Claude): content stayed visible during the conversation, then disappeared when the turn ended and never came back after refresh — three stacked defects in history pagination, large-file boundary parsing, and post-turn replacement were fixed in one pass
- **Turns stuck on "responding" forever during backend restarts**: orphaned turns created in a backend-unavailable window are now settled by a watchdog into a retryable state instead of spinning forever
- **Turns hung forever on relay stalls**: a mid-turn silence watchdog settles the turn when a Claude stream goes quiet
- **Shared auto-continue death loop**: a finished turn misjudged as failed by its exit code no longer triggers endless continuation
- **Text lost at the end of replies**: fixed the last chunk of an AI reply occasionally going missing
- **New sessions not appearing**: sidebar "Reload" now forces an index rescan, so sessions created outside the app show up at once
- **First sidebar section rendering empty**: leftover empty shared-session directories no longer break visibility computation
- **Blank screen after closing the last tab**: the selection now clears and lands on the workspace home
- **Qoder credential priority**: saved credentials are no longer overridden by system environment variables, fixing sign-in
- **Misaligned digits on Windows**: fixed the "files changed" counter's prefix sign overlapping the first digit
- **Windows file links wouldn't open**: Windows file-link parsing rules completed, so Markdown file links open in Explorer as expected
- **Files panel failing on network drives**: projects on network / mapped drives now open normally in the Files panel
- **Linux notification-sound crash**: fixed the crash caused by playing the notification sound on Linux
- **Empty model menus**: opening the model menu now restores catalogs for engines that only had fallback entries


---

### **2026年8月22日（v0.9.2）**

中文：

这一版将应用升到 **0.9.2**，主线是「Qoder 成为第九个一等引擎、工作台壁纸可逛市场、Shared 供应商失败自动续跑」：Qoder CLI 经第四条协议族 acp-stdio 接入，Global 与 CN 双分发、profile 限定会话身份贯穿 index / catalog / Shared，并进入 Shared Session 执行目标；自定义壁纸升级为本地图库 + Wallhaven 在线市场，支持视频与播放 / 模糊 / 压暗效果；Shared 号池在 401 / 403 / 429 / 超时 / 过载后按结果论同一家自动续跑，幕布气泡标注次数与时间。DSH 侧按供应商分组模型菜单、接通官方套餐额度与 DeepSeek 思考强度；另收口协作模板选择器卡死、Shared 下崽隐藏、暗色主题石墨化与设置卡片毛玻璃。

✨ Features

- **Qoder CLI 第九个 Native 引擎**：新增第四条协议族 acp-stdio——每轮 spawn `qodercli --acp`，initialize → session/new 或 session/resume → 可选 set_model / set_config_option → set_mode bypassPermissions 后发 session/prompt，JSON-RPC 响应为 typed terminal；thread 身份 `qoder:<sessionId>` / `qoder-pending-<uuid>`，pending 晋升合并不伪造 id；覆盖对话发送 / 流式 / 中断、ACP session/list|load|delete 历史、create-session 模型选择、Settings doctor 与自定义路径、侧栏新建入口与 10 语言文案；PAT 存 `~/.ccgui/qoder-auth.json` 注入 `QODER_PERSONAL_ACCESS_TOKEN`，不写 `~/.qoder`；模型目录走 ACP availableModels（runtime-only，不进静态 fallback roster）；detect 只认 qodercli，拒绝 IDE launcher 与 CN 版
- **Qoder Global / CN 双分发 + profile 限定身份**：双分发接入；session index 行迁移为 profile-qualified identity 并贯穿写入链路；catalog 与 provider binding 全面携带 Qoder 分发归属；前端发送 / 恢复 / 历史链路适配 canonical 身份；Windows 补官方安装目录检测；本地优先读取会话历史；收齐 ACP 回放尾包以免历史截断
- **Qoder 进入 Shared Session 执行目标**：Shared 链路按 profile-qualified identity 认主与隐藏，写路径 `assertSharedSessionWriteEngine` 拒绝把 qoder 静默改写成 claude 落盘
- **工作台壁纸图库 + Wallhaven 市场**：自定义壁纸从单个本地路径升级为 managed library + 在线 SFW 市场；导入复制进 `~/.ccgui/wallpapers/<uuid>.<ext>`（png / jpg / webp / gif / bmp / mp4），软删除隐藏、按 sourcePath 去重，删除只动 managed 目录内文件；新增 wallpaperBlur / wallpaperDarken / playbackRate / flip / objectFit / paused / rotation 效果；选中丢失时回退首个可见项再到 legacy customImagePath，不改写 mode
- **Shared 供应商失败自动续跑**：号池 403 / 429 / 超时 / 过载落账后按结果论再开一轮续跑指令，不改发送九态、不换供应商；401 无效 Key 纳入号池重试；405 / 424 / 429 / 502 错误码纳入自动续跑；Claude 静默进程退出同样纳入；自动续跑标记收进气泡并标注次数与时间，协作旁提供按会话×CLI 的内存设置
- **Shared 回合徽章 runtime 回执**：回合徽章展示 runtime 回执信息
- **DSH 模型菜单按供应商分组**：官方供应商模型选择走 host catalog；按供应商补齐官方套餐额度查询；为 DeepSeek 模型接入思考强度选择
- **响应中条实时显示本轮 token**
- **Browser Dock 面板关闭按钮**：内嵌浏览器面板可直接关闭
- **增强提示词弹窗重做**：并修复 DSH catalog 发送

🔧 Improvements

- 将应用版本号提升到 `0.9.2`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），为 patch 发版对齐 SemVer 与打包元数据
- **暗色主题石墨化**：dark surfaces 重铸为无彩色石墨；提升 dark secondary ink 可读性；隔离 wallpaper picker 表面；invert-fill primary 标签在浅色主题保持可读
- **设置卡片毛玻璃**：所有设置卡片在工作台壁纸之上统一 frost；frost 默认 0px 让壁纸保持清晰
- **PI 模型菜单按供应商分组展示**
- **Session HUD 图标 tooltip 不再被裁切**：overflow 保持 visible
- **DSH 自动模式接 danger-full-access**：并折叠审批调试字段
- **DSH 超长会话流式合并**：token 级流式 delta 合并，超长会话不再逐 token 打根
- **Daemon ModelInfo 补 reasoning 字段**
- **rustfmt 闸门钉死**：避免整仓重排

🐛 Fixes

- **协作模板选择器卡在加载中**
- **Shared 下崽会话隐藏**：按 Target 认主并隐藏 Shared 子会话；保留 Codex Shared 协议行以免侧栏漏崽；收住 Codex native 子代理侧栏升顶
- **Shared 上下文投影与重试分类修复**
- **共享待确认队列卡死**
- **Qoder Native runtime 契约收口**
- **DSH 修复群**：适配 v1 credentials refs 修复额度查询；补齐 `commands/execute` 必填 images 字段；暴露 plugin tree 内层启动失败原因；切回 DSH 会话时还原引擎与模型绑定；接通对话框已编辑文件变更列表
- **Git unstaged discard 从 index 恢复**：不再误用 HEAD
- **OpenCode 隔离 Bun 临时原生产物**
- **删除供应商时回退新建菜单记忆**
- **空幕布不再漏出 leftover Exploring**
- **Composer 队列删除 fallback 与 onRemove 签名对齐**；首页 create-session 跳过空 DSH branch row
- **消化存量测试欠账**：codex 目录漂移 + app-shell bridge 白名单

English:

This release moves the app to **0.9.2**. The headline is Qoder as the ninth first-class engine, a browsable wallpaper market, and Shared auto-continue on vendor failure: Qoder CLI lands via a fourth protocol family (acp-stdio) with Global / CN dual distribution and a profile-qualified session identity carried through index / catalog / Shared, plus a Shared Session execution target; custom wallpaper upgrades to a managed local library plus the Wallhaven online market with video and playback / blur / darken effects; the Shared key pool auto-continues with the same vendor after 401 / 403 / 429 / timeout / overload, with retry count and time annotated in the bubble. On the DSH side, the model menu groups by vendor, official plan quota lands, and DeepSeek models gain reasoning effort. Also closed: the collab template picker stuck on loading, Shared spawn hiding, an achromatic-graphite dark theme, and frosted settings cards.

✨ Features

- **Qoder CLI as the 9th Native engine**: a fourth protocol family, acp-stdio — each turn spawns `qodercli --acp`, runs initialize → session/new or session/resume → optional set_model / set_config_option → set_mode bypassPermissions, then session/prompt, with typed-terminal JSON-RPC responses; thread identity is `qoder:<sessionId>` / `qoder-pending-<uuid>` with pending promotion and no forged ids; covers send / streaming / interrupt, ACP session/list|load|delete history, create-session model selection, Settings doctor and custom paths, the sidebar entry, and 10-locale copy; the PAT lives in `~/.ccgui/qoder-auth.json` injected as `QODER_PERSONAL_ACCESS_TOKEN` without writing `~/.qoder`; the model catalog comes from ACP availableModels (runtime-only, no static fallback roster); detect accepts only qodercli, rejecting the IDE launcher and the CN build
- **Qoder Global / CN dual distribution + profile-qualified identity**: dual distribution onboarded; session-index rows migrate to a profile-qualified identity carried through the write path; catalog and provider binding carry the Qoder distribution attribution; frontend send / resume / history adapt to the canonical identity; Windows official install-dir detection; local-first history reads; ACP replay tail packets fully collected so history is not truncated
- **Qoder as a Shared Session execution target**: the Shared chain owns and hides by profile-qualified identity, and `assertSharedSessionWriteEngine` refuses to silently rewrite qoder as claude on disk
- **Wallpaper library + Wallhaven market**: custom wallpaper upgrades from a single local path to a managed library plus an online SFW market; imports copy into `~/.ccgui/wallpapers/<uuid>.<ext>` (png / jpg / webp / gif / bmp / mp4) with soft-delete hiding, sourcePath dedupe, and deletes scoped to the managed directory; new wallpaperBlur / wallpaperDarken / playbackRate / flip / objectFit / paused / rotation effects; a missing selection falls back to the first visible item then the legacy customImagePath without rewriting mode
- **Shared auto-continue on vendor failure**: after 403 / 429 / timeout / overload is recorded, a continuation instruction runs by outcome — the send nine-state is unchanged and the vendor is not switched; 401 invalid keys join key-pool retry; 405 / 424 / 429 / 502 join auto-continue; silent Claude process exits count too; the auto-continue marker folds into the bubble with retry count and time, with a per-session×CLI in-memory setting beside collaboration
- **Runtime receipt on Shared turn badges**
- **DSH model menu grouped by vendor**: official-vendor model selection goes through the host catalog; official plan quota per vendor; reasoning-effort selection for DeepSeek models
- **Live per-turn token count in the responding bar**
- **Close control for the embedded Browser Dock panel**
- **Prompt Enhancer dialog rework**, plus the DSH catalog send fix

🔧 Improvements

- Bump the app version to `0.9.2` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship aligns SemVer and packaging metadata
- **Achromatic-graphite dark theme**: dark surfaces recast to neutral graphite; lifted dark secondary ink; isolated wallpaper-picker surfaces; invert-fill primary labels stay readable on light themes
- **Frosted settings cards**: all settings cards frost over the workspace wallpaper; frost defaults to 0px so wallpapers stay sharp
- **PI model menu grouped by vendor**
- **Session HUD icon tooltips no longer clipped**: overflow stays visible
- **DSH auto mode wired to danger-full-access**, with approval debug fields folded
- **DSH long-session streaming merge**: token-level delta merging so long sessions no longer hit the root per token
- **Daemon ModelInfo gains the reasoning field**
- **rustfmt gate pinned** to avoid whole-tree reformatting

🐛 Fixes

- **Collab template picker stuck on loading**
- **Shared spawn hiding**: own and hide Shared child sessions by Target; keep Codex Shared protocol rows so the sidebar doesn't leak spawns; stop Codex native subagents from promoting to the sidebar top level
- **Shared context projection and retry classification fixes**
- **Shared pending-confirmation queue deadlock**
- **Qoder Native runtime contract closeout**
- **DSH fix cluster**: adapt to v1 credentials refs to repair quota queries; supply the required images field on `commands/execute`; surface inner plugin-tree startup failure reasons; restore engine and model binding when switching back to a DSH session; wire the edited-files change list into the dialog
- **Git unstaged discard restores from the index**, not HEAD
- **OpenCode isolates Bun temp native artifacts**
- **New-session menu memory falls back when a vendor is deleted**
- **Blank canvas no longer leaks leftover Exploring**
- **Composer queue-delete fallback and widened onRemove signature aligned**; home create-session skips the empty DSH branch row
- **Test debt paydown**: codex directory drift + app-shell bridge whitelist

---

### **2026年8月19日（v0.9.1）**

中文：

这一版将应用升到 **0.9.1**，主线是「大会话打开只画最新一页、侧栏 Session Index 真冷路径不蒸发、Windows 流体背景与 DSH Preset」：切会话改 Spine 幕布并带阶段进度；DSH 等大会话默认只装最新一页，上翻 / All 再按页取更早；侧栏首屏零扫盘、按页展开、按创建时间排序，并恢复后台扫盘把漏掉的新会话补回来。外观解禁 Windows 流体背景，五档动势含中国龙游走；空白 DSH 会话可选 Agent Preset，任务条 / 占用环 / 额度与问答卡接通。另收口 Shared 历史卡在 58%、幕布用户气泡连堆、空 Session 下崽、同名模型误开新会话、点选模型假切换、managed Codex 重启丢失，以及置顶按日折叠、会话 Tab 开关与推送目标记忆。

✨ Features

- **会话历史 Spine 幕布 + 阶段进度**：切会话从 spinner+进度条换成 13 Spine（Native 爬光、Shared 四段真相位、DSH 布尔幕布）；大会话打开显示准备 / 快照 / 解析 / 组装百分比，DSH 按页报号，方便定位 6000+ 会话卡在 host 翻页还是 hydrate
- **流体背景五档动势 + Windows 解禁**：工作台增加 drift / taiji / storm / tornado / chase 与 ash 配色，游走为中国龙形制（角 / 鬃 / 须 / 爪 / 尾鳍）；设置外观重新展示页面背景与五档动势。Mac 走 full 60fps、上限 2 条游走；Windows 走 lite（半分辨率 / 12fps / 延迟编译），WebView2 按动势拆 program、attach 后再打孔，禁止套用 Mac 路径
- **DSH Agent Preset 选择器**：空白 DSH 会话可在工具条选 standard / code / minimal / cordis，首发经 `session.create({ agentPreset })` 传到 host；开聊后锁定，resume 展示 session.list header
- **DSH / PI 供应商额度**：额度 IPC 只带选中 vendor；只读解析 `$DSH_HOME` / `~/.pi/agent` 得到 base+key，发送路径 sentinel 不变
- **侧栏置顶按日历日折叠**：去掉「已固定」段头，`yyyy-mm-dd` 作为最外层并与工作区对齐；默认只展开最新日，折叠状态写入 clientStorage
- **外观设置会话 Tab 开关**：可手动隐藏或显示顶部会话 Tab，不把 `topSessionTabs` 纳入 essential chrome
- **Git 推送记住最近三次目标**：推送对话框记住 workspace 最近 3 个 remote / branch / Gerrit 组合，打开时回填上次目标

🔧 Improvements

- 将应用版本号提升到 `0.9.1`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），为 patch 发版对齐 SemVer 与打包元数据
- **大会话首屏只装最新一页**：DSH 打开默认只拉 1 页 host history，幕布在 tail hydrate 后卸下；更早内容走统一 older-page；hydrate 改线性 working-set，芯片按 500 翻页并提供 All，上翻不再自动翻页、prepend 不再吸底
- **Session Index 真冷路径**：first-paint / focus-refresh / 软再同步只读 SQLite，不再探 DSH / PI 盘；路径钥匙收 Windows 长路径与盘符大小写；超时只标 partial，不再用空数组盖账本
- **侧栏按页递增展开**：首次露出 12 条，「更多」按 12 / 24 / 36 / 48 提高可见上限，去掉独立「加载更早的」
- **DSH 任务条与上下文占用**：单独接 host todos / contextPressure / contextBreakdown，任务 pill 与占用环跟 Web 同源；billed tokenUsage 不得冲掉占用或清空后的 todos
- **搜索与雷达默认留在更多**：右侧工具列表始终露出入口，默认不钉顶栏，由用户自行勾选
- **上下文注入卡改单行折叠条**：默认只露 completed pill 和标题，点开再看 goal 正文
- **左侧消息锚点贴边**：rail 左移到 12px，默认短线 14→9px；窄幕布不再隐藏锚点

🐛 Fixes

- **切项目恢复上次会话**：非当前工作区行走 `onSelectWorkspace` 并恢复 last thread，不再误入 workspace home
- **未加载会话切回先拉幕布**：select 帧显示 history-loading，避免 emptyThread 闪烁
- **Claude 磁盘尾窗翻页**：芯片读磁盘 `hasMore`，pending 耗尽后按 cursor 加载更早一页
- **Shared 历史 V0 先画**：V0 snapshot 就绪即 hydrate 并卸投影幕布，projection 继续后台跑，不再整页卡在 58%
- **幕布用户气泡连堆与迟到历史错序**：首屏超预算在 turn 边界回退；unmatched incoming 按邻居相对插入；空 assistant 壳按后接 user / liveTurn 保留
- **幕布 Fork 走 Composer 链路**：与 `/fork` 共用 `forkThreadForWorkspace`，去掉会造出无法 resume 空会话的旧恢复卡
- **侧栏按创建时间排序**：`updatedAt` 继续更新但不驱动排序；refresh 不再把旧行顶上去
- **恢复后台扫盘 + last-good floor**：Index 非空不再盖掉更新的 last-good；3s 强制首拍，磁盘 mtime 对照账本
- **侧栏标签、绑回与列表不蒸发**：全局开关、八引擎供应商标签、send 用会话 binding；切会话禁止拉 catalog；短页 union 不盖长列表；first-paint 空结果保持加载中，不先闪暂无会话
- **managed Codex 会话重启不丢**：多 root 候选按 root 公平收集，主 home 文件再多也不饿死 provider home
- **Shared 协议续跑与 Codex 下崽隐藏**：Index 不再用 history.jsonl「继续」盖掉 MOSSX 协议包；protocol hide 收录文件 UUID，子代理不升根；uuid / `codex:uuid` / `rollout-*-{uuid}` 互认，盘符路径不当 engine 前缀
- **幽灵 Index 会话只 tombstone 客户端行**：归属解析失败且磁盘未删时只摘侧栏，避免误伤其他 engine
- **立即隐藏占位引擎会话草稿**：空占位标题草稿立刻从左侧列表消失；自定义标题、真实首条和 pending draft 仍可见
- **点选模型写 send 账本**：Native overlay 只做反馈，resolver 同步写入并 pin runtime；假切换回滚；send 有 resolver 时不再回落全局 model
- **native 续聊不因同名模型开新会话**：本 catalog 优先匹配，续聊默认锁当前 thread，只有显式切换引擎组才开新会话
- **拦截空 Claude / Codex Session 下崽**：扫盘不再导入空 Session / MOSSX 控制面 / helper；过夜空 native 会话与本地 pending 草稿从首页清掉
- **DSH 历史游标不被内存余量覆盖**：点 All 后仍能按页加载更早的 host 历史
- **DSH 续聊不把 ccgui 模型送给 host**：已有 session 省略模型，send fail-closed；picker skip 按 thread 归属而不是 drifted activeEngine
- **DSH 问答走现有问答卡**：RequestUserInputMessage 按 Host 整批合约提交；全跳过 / 关闭走 cancelled，压掉 Plan mode 与原始 JSON 工具墙
- **Windows 一键安装 DSH 不再并发解压失败**：统一 `--maxsockets=1`，清理残留全局目录，extract-race 失败后重试一次，timeout 提到 420s
- **TodoWrite 不再误收成 fileChange**：live `TodoWrite` / `todo_write` 不因名字含 write 进文件变更
- **Grok leftover Exploring 不再串到新 tab**：incoming 对不上时不再把 explore / 未完成 command 插到 optimistic 前面
- **长对话尾巴重复用户气泡**：hydrate 后可见文案相同的 optimistic 尾巴不再重复绘制
- **Grok 图片错误脱敏并拦截超限粘贴**：失败气泡只报 mime + 估算大小，不再拼整段 data URL；Grok 2MB / DSH 5MB 粘贴超限在发送前拦截
- **Pi logo 跟随主题色**：静态 img 改为 currentColor 内联字形，深色主题不再纯黑不可见
- **工作区雷达样式懒加载**：活动面板 kill-switch 后雷达自行拉 feature loader，右栏不再退化成裸文本
- **WebView2 禁止 F5 刷新主窗口**：主窗口不再被 F5 整页刷新

English:

This release moves the app to **0.9.1**. The headline is open-large-session by the latest page only, a Session Index cold path that does not evaporate, Windows fluid wallpaper, and DSH Agent Presets: session switches use a Spine curtain with stage progress; DSH and other large threads hydrate the newest page first, then page older history on scroll-up / All; the sidebar first-paints from SQLite with no disk probe, expands by page, sorts by created time, and restores background scan so missed new sessions come back. Appearance unbans Windows fluid wallpaper with five motion presets including a Chinese-dragon chase; blank DSH sessions pick an Agent Preset, and the task pill / occupancy ring / quota / Q&A card light up. The rest closes Shared history stuck at 58%, stacked user bubbles, empty-session spawn, same-name model opening a new chat, fake model switches, managed Codex disappearing on restart, plus calendar-day pin folding, a session-tab toggle, and remembered push targets.

✨ Features

- **History Spine curtain + stage progress**: session switch replaces spinner+bar with 13 Spines (Native light crawl, Shared four real phases, DSH boolean curtain); large opens show prepare / snapshot / parse / assemble %; DSH emits page numbers so a 6000+ thread can be told apart as host paging vs hydrate
- **Five fluid-motion presets + Windows unban**: the workbench adds drift / taiji / storm / tornado / chase and an ash palette; chase is a Chinese dragon (horns / mane / whiskers / claws / tail fins); Appearance shows wallpaper and the five motions again. Mac keeps the full 60fps path with at most two chases; Windows stays lite (half-res / 12fps / deferred compile), WebView2 splits programs per motion and punches the hole only after attach — never the Mac path
- **DSH Agent Preset picker**: a blank DSH session can pick standard / code / minimal / cordis in the toolbar; the first send goes through `session.create({ agentPreset })`; after chat starts it locks, and resume shows the session.list header
- **DSH / PI vendor quota**: quota IPC carries only the selected vendor; read-only parse of `$DSH_HOME` / `~/.pi/agent` yields base+key; the send-path sentinel is unchanged
- **Pinned sidebar folds by calendar day**: drop the “Pinned” section header; `yyyy-mm-dd` is the outer group and aligns with workspaces; only the newest day expands by default; fold state lives in clientStorage
- **Appearance toggle for session tabs**: hide or show the top session tabs by hand; `topSessionTabs` is not essential chrome
- **Remember the last three Git push targets**: the push dialog stores the workspace’s last 3 remote / branch / Gerrit combos and prefills the previous target

🔧 Improvements

- Bump the app version to `0.9.1` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship aligns SemVer and packaging metadata
- **Large sessions load the newest page first**: DSH open fetches 1 page of host history and drops the curtain after tail hydrate; older content uses the shared older-page contract; hydrate is a linear working-set; the chip pages by 500 and offers All; scroll-up no longer auto-pages, and prepend no longer snaps to the bottom
- **True Session Index cold path**: first-paint / focus-refresh / soft resync read SQLite only and do not probe DSH / PI disks; path keys normalize Windows long-path prefixes and drive-letter case; timeouts mark partial instead of covering the ledger with an empty array
- **Sidebar expands by page**: first reveal is 12 rows; “More” raises the visible cap 12 / 24 / 36 / 48; the standalone “Load older” control is gone
- **DSH task bar and context occupancy**: DSH wires host todos / contextPressure / contextBreakdown so the task pill and occupancy ring match Web; billed tokenUsage must not clobber occupancy or wipe settled todos
- **Search and Radar stay in More by default**: the right-side tool list always exposes both entries; they are not pinned to the title bar unless the user checks them
- **Context-injection card becomes a one-line fold**: default shows the completed pill and title; expand to read the goal body
- **Left message anchors hug the canvas**: rail moves to 12px, default dash 14→9px; narrow canvases no longer hide the rail

🐛 Fixes

- **Switching projects restores the last session**: a non-current workspace row runs `onSelectWorkspace` and restores the last thread instead of dumping into workspace home
- **Unloaded sessions raise the curtain on switch-back**: the select frame shows history-loading so emptyThread does not flash
- **Claude disk-tail paging**: the chip reads disk `hasMore` and loads the next older page by cursor after pending is exhausted
- **Shared history paints V0 first**: a ready V0 snapshot hydrates and drops the projection curtain immediately; projection keeps running in the background so the page no longer sticks at 58%
- **Stacked user bubbles and late-history mis-order**: over-budget first paint falls back on turn boundaries; unmatched incoming inserts relative to neighbors; empty assistant shells stay only when followed by user / liveTurn
- **Canvas Fork uses the Composer path**: shares `forkThreadForWorkspace` with `/fork` and drops the old recovery card that created unresumable empty Claude sessions
- **Sidebar sorts by created time**: `updatedAt` still updates but does not drive order; refresh no longer boosts old rows
- **Background scan restored + last-good as floor**: a non-empty Index no longer covers a newer last-good; force a 3s first beat and compare disk mtime to the ledger
- **Sidebar tags, binding, and lists that do not evaporate**: global switch, eight-engine vendor tags, send uses the session binding; session switch must not fetch catalog; a short-page union does not cover a long list; first-paint empty stays loading instead of flashing “no sessions”
- **Managed Codex sessions survive restart**: per-root fair candidate collection so a busy primary home no longer starves provider-home roots
- **Shared protocol-continue and Codex pups stay hidden**: Index no longer lets history.jsonl “continue” cover a MOSSX protocol pack; protocol hide records file UUIDs and child agents do not promote to root; uuid / `codex:uuid` / `rollout-*-{uuid}` are aliases, and drive-letter paths are not engine prefixes
- **Ghost Index rows only tombstone the client line**: when ownership resolve fails and disk is still there, drop the sidebar row only so other engines are not hurt
- **Placeholder engine drafts hide immediately**: empty placeholder-title drafts leave the left list at once; custom titles, a real first message, and pending drafts stay
- **Picker writes the send ledger**: Native overlay is feedback only; the resolver writes and pins the runtime; fake switches roll back; send with a resolver no longer falls back to the global model
- **Native resume no longer opens a new chat on a same-name model**: this catalog matches first; resume stays on the current thread unless the user explicitly switches engine group
- **Empty Claude / Codex Sessions stay out of the list**: scan no longer imports empty Sessions / MOSSX control-plane / helpers; overnight empty native sessions and local pending drafts leave Home
- **DSH history cursor is not overwritten by memory remainder**: All still pages older host history
- **DSH resume does not send the ccgui model to host**: an existing session omits the model and send fails closed; picker skip follows thread ownership, not a drifted activeEngine
- **DSH questions reuse the existing Q&A card**: RequestUserInputMessage submits answers under the Host batch contract; skip-all / close is cancelled; Plan mode and the raw JSON tool wall stay down
- **Windows one-click DSH install no longer races extract**: `--maxsockets=1` everywhere, leftover global dirs are cleaned, extract-race retries once, timeout moves to 420s
- **TodoWrite is no longer classified as fileChange**: live `TodoWrite` / `todo_write` do not become a file-change card just because the name contains write
- **Grok leftover Exploring no longer leaks into a new tab**: when incoming does not match, do not insert explore / unfinished commands ahead of optimistic rows
- **Duplicate user bubbles at the long-thread tail**: after hydrate, optimistic tails with the same visible text are not drawn twice
- **Grok image errors are redacted and oversize paste is blocked**: failure bubbles report mime + estimated size, not a full data URL; Grok 2MB / DSH 5MB paste oversize is intercepted before send
- **Pi logo follows the theme color**: static img becomes a currentColor inline glyph so dark theme is no longer pure black
- **Workspace Radar styles lazy-load again**: after the activity-panel kill-switch, Radar loads its own feature CSS so the right rail is not bare text
- **WebView2 F5 no longer reloads the main window**

---

### **2026年8月17日（v0.9.0）**

中文：

这一版将产品线升到 **0.9.0**，主线是「DeepSeek Harness 与 PI 成为一等引擎、新用户能走完首次设置、工作台可换背景」（#1099 / #1100）：composer 可选 DSH / PI，DSH 会话进侧栏、可续聊并跟随 Goal hop；设置页用连接优先面板对接本机 `dsh web`；全新安装走欢迎 → IDE → CLI 装验；外观可关 / 流体 / 自定义封面。另把 Browser Dock 嵌进中心分屏，首页改时间分组卡片，并收口长对话按段折叠、后台任务通知、切会话卡顿与 Windows 拉起 DSH。

✨ Features

- **DeepSeek Harness 一等引擎（#1099）**：第 7 个 Native Engine；自动探测 / adopt / spawn 本机 `dsh web`；composer 选 `{ provider, model }`，侧栏可列 / 续 / fork，live mux 与审批桥接通；第一期不进 Shared
- **DSH Goal 续跳与连接面板**：Goal `active` 时不提早 idle，跟随 host 下一 hop；`source.kind=goal` 显示「上下文注入」折叠卡；设置页区分未装 / 未运行 / 已连接，可显式启动或关闭本机 host，Windows 补扫 Hermes / Scoop / mise / fnm
- **DSH 自定义路由附图 + 会话速度条**：可写 `llm-pi-ai` 路由附图时自动声明 `[text, image]`，不必手改 `settings.yaml`；composer 展示首 token 平均、tok/s、缓存命中%；弱标题用首条真实提问升级
- **PI CLI 内置引擎**：探测 / 安装 / doctor / 认证（含 OAuth 终端）；`pi:` 历史与 realtime 独立；首页与 Shared 可选 PI；协作白名单含 PI；附图走 `@file`
- **首次设置向导**：欢迎 → IDE（含 IntelliJ IDEA）→ CLI 装验；至少一引擎通过才算 ready，可 skip 后由首页 banner / 设置页重跑拉回；legacy 用户不强制重跑
- **工作台页面背景**：设置外观三选一（关闭 / 流体 / 自定义图片），默认关闭；侧栏与主栏统一毛玻璃；Windows 跳过 WebGL 流体
- **Browser Dock 中心分屏 + 首页时间卡片**：顶栏开关把 Dock 嵌进幕布旁；HTML 链可一键进内置浏览器；首页按本周 / 近月 / 更早分组
- **Git 变更行「在访达 / 资源管理器中显示」**：单仓 / 多仓、扁平 / 树形均可跳到磁盘；已删文件打开父目录

🔧 Improvements

- 将应用版本号提升到 `0.9.0`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），为 minor 发版对齐 SemVer 与打包元数据
- **会话历史窗口加大**：DOM 默认窗口 150 → 800，首屏尾窗 16 → 300，长会话不再一打开就缩成「更早历史」chip
- **Session Index 后台导入 + keyset 翻页**：90s 有界 sync 外部 CLI；首页 20 条 keyset，「加载更早」走 Index 游标；Claude 磁盘尾窗默认 80
- **过程相位按段连续折叠**：每段正文只收紧挨着的思考 / 工具，长回合不再整轮并进终稿一堵墙；折叠 chip 去掉多余「已处理」前缀
- **思考排版更紧**：思考块间距压到 0.4em，跨空行编号列表保持同一 `<ol>`；助手正文节奏不变
- **提交信息 helper 会话从列表隐藏**：按已知 generate-commit 前缀过滤，普通讨论提交信息的对话仍可见
- **live 尾部过程窗口**：无正文收尾的长工具 / 思考串超过 5 张卡时只留末尾 3 张
- **分平台响应中 spinner**：Mac / Linux 用 SVG dash，Windows 用字符帧，避开 reduce-motion 空心环死圈
- **工具输出字节预算**：`commandExecution` / `fileChange` 进 store 前 head+tail 截断
- **AskUserQuestion 更稳**：CLI MCP 超时加 30s、过期可识别、墙上时钟倒计时、闸门结算前 drain live 尾

🐛 Fixes

- **Windows 拉起 `dsh web`**：走 `node.exe + lib/bin.js`，spawn 前修空的 sharp constructor；Mac 保持 shebang；设置页回传 spawn stderr
- **DSH 无名 bash 不再当成 Agent**：缺 name 时按参数判 `commandExecution`；完成项不再用 `Call-|fc` 当标题；普通 shell 不进 subagent 计数
- **后台任务通知折叠**：Claude wakeup `<task-notification>` 不再进用户蓝气泡；Background / SubAgent / 真用户三分流；wakeup 不当 shadow 边界，避免再追加一份已落盘正文
- **切会话 identity 先亮**：同步只改 workspace+thread；未开聊跳过 resume，空 surface 不拉幕布；Shared 解锁先让出一帧
- **侧栏删除真删干净**：右键删除与设置页走同一后端链路；session index tombstone 防复活；PI 按全局 session id 兜底
- **壁纸叠层与终端透底**：毛玻璃只挂 wallpaper 层，侧栏菜单 portal 到 `document.body`；开背景时终端透明，不再盖住「+」与新建会话菜单
- **Claude 后台 Agent 空闲上限**：子代理迟迟不回时预结果等待可放弃，不再永远卡在 generating
- **批量终端卡完成后自动折**：直播收尾即收起组；历史回放默认折叠
- **Windows 打开方式探测不再弹黑窗**：图标 / `where` 探测走 `CREATE_NO_WINDOW`

English:

This release moves the product line to **0.9.0**. The headline is DeepSeek Harness and PI as first-class engines, a first-run setup that actually finishes, and a workbench you can wallpaper (#1099 / #1100): pick DSH or PI in the composer; DSH sessions land in the sidebar, resume, and follow Goal hops; Settings uses a connection-first panel against local `dsh web`; a fresh install walks Welcome → IDE → CLI verify; Appearance can turn wallpaper off, use the fluid backdrop, or a custom image. Browser Dock embeds in the center split, Home becomes time-grouped cards, and the rest closes long-turn process walls, background-task leak bubbles, session-switch jank, and Windows DSH spawn.

✨ Features

- **DeepSeek Harness as a first-class engine (#1099)**: 7th Native Engine; detect / adopt / spawn one local `dsh web`; composer picks `{ provider, model }`; sidebar list / resume / fork with live mux and the approval bridge; not in Shared for this ship
- **DSH Goal continuation + connection panel**: while Goal is `active`, do not idle early — stay bound for the next host hop; `source.kind=goal` renders a “Context injection” fold card; Settings distinguishes not-installed / not-running / connected, with explicit start/stop and Windows scans of Hermes / Scoop / mise / fnm
- **DSH custom-route images + session speed line**: on writable `llm-pi-ai` routes, auto-declare `[text, image]` so users never hand-edit `settings.yaml`; composer shows TTFT average, tok/s, and cache-hit %; weak sidebar titles upgrade from the first real user prompt
- **PI CLI as a built-in engine**: detect / install / doctor / auth (OAuth in the terminal); dedicated `pi:` history and realtime; Home and Shared can pick PI; collab whitelist includes PI; images go through `@file`
- **First-run setup wizard**: Welcome → IDE (including IntelliJ IDEA) → CLI verify; ready requires one passing engine; skip leaves a Home banner and a Settings re-run; legacy users are not forced through it
- **Workbench wallpaper**: Appearance is a three-way (off / fluid / custom image), off by default; sidebar and main share one frost veil; Windows skips the WebGL fluid shader
- **Embedded Browser Dock + time-grouped Home**: titlebar toggle docks the browser beside the canvas; HTML links open in the built-in browser; Home groups This week / Recent month / Older
- **Reveal in Finder / Explorer on git diff rows**: flat and tree, single-repo and multi-repo; deleted files open the parent folder

🔧 Improvements

- Bump the app version to `0.9.0` across frontend package metadata, the lockfile, and Tauri bundle configuration so this minor ship aligns SemVer and packaging metadata
- **Larger in-session history window**: DOM default 150 → 800, first-paint tail 16 → 300, so long threads no longer collapse into an older-history chip on open
- **Session Index background import + keyset paging**: 90s bounded sync of external CLIs; Home page is a 20-row keyset; “Load older” follows the Index cursor; Claude disk tail defaults to 80
- **Contiguous process-phase collapse**: each assistant body only folds the process run immediately above it; long turns no longer become one end-of-turn wall; the chip drops the extra “Processed” prefix
- **Tighter thinking typography**: 0.4em sibling gap inside thinking blocks; numbered lists stay one `<ol>` across blank lines; assistant body rhythm is unchanged
- **Hide commit-message helper sessions**: filter known generate-commit prefixes; ordinary chats that merely discuss commit messages stay visible
- **Live trailing process window**: a no-body tool/reasoning run longer than 5 cards keeps the last 3
- **Per-platform in-response spinner**: SVG dash on Mac / Linux, glyph frames on Windows, so reduce-motion never freezes on a hollow ring
- **Tool-output byte budget**: head+tail truncate `commandExecution` / `fileChange` before they enter the store
- **AskUserQuestion hardening**: +30s CLI MCP margin, recognizable expired routing, wall-clock countdown, drain the live tail before the gate settles

🐛 Fixes

- **Windows `dsh web` spawn**: CreateProcess-safe `node.exe + lib/bin.js`, repair an empty sharp constructor before spawn; Mac keeps the shebang; Settings surfaces spawn stderr
- **Nameless DSH bash is not an Agent**: infer `commandExecution` from args when name is missing; completed items no longer take `Call-|fc` as the title; ordinary shells stay out of the subagent tally
- **Fold background task notifications**: Claude wakeup `<task-notification>` no longer becomes a user bubble; Background / SubAgent / real user split three ways; wakeup is not a shadow-recovery turn boundary, so a settled assistant is not appended twice
- **Session-switch identity first**: sync only workspace+thread; skip resume on never-started; empty surfaces do not raise a history curtain; Shared unlock yields one paint frame
- **Sidebar delete actually deletes**: context-menu delete shares the Settings backend path; session-index tombstones prevent resurrection; PI falls back to the global session id
- **Wallpaper stacking and terminal frost**: frost lives only on the wallpaper layer; sidebar menus portal to `document.body`; the terminal goes transparent when wallpaper is on so “+” and New session stay clickable
- **Claude background-agent idle cap**: if a child never sends a task notification, the pre-result wait can abandon instead of generating forever
- **Auto-fold completed terminal groups**: live groups collapse when the last card finishes; history replay starts folded
- **Windows Open With probe no longer flashes a console**: icon extract and `where` use `CREATE_NO_WINDOW`

---

### **2026年8月15日（v0.8.9）**

中文：

这一版将应用升到 **0.8.9**，主线是「流式不卡、长会话不钝、Windows 冷启可点」（#1092）：思考与工具输出不再逐条打根，长思考 / 刷工具时页面保持跟手；流式 Markdown 改为增量排版，单帧成本不再随正文变长；长会话只保留最近一段 DOM，上翻可分页展开；AppShell 分域瘦身，打字、贴图、回合切换不再扇出整棵壳；Windows 安装或升级后前几秒点版本记录 / 权限 / 任意控件不再整窗假死约一分钟。另下线听写与看板 / 任务中心，并收口 Grok 思考碎片、隐藏窗口背压、会话列表预览扫描与搜索自动扫仓。

✨ Features

- **思考 / 工具输出走 live 通道**：`reasoningContent` / `reasoningSummary` / `toolOutput` 按行订阅，不再逐条 `dispatch` 进根；首条建壳、后续 48ms 节流发布、回合结束一次写回；长思考回合根更新从两百多次降到个位数
- **流式增量 Markdown**：全文切块后只重排尾部最多 2 块，已冻结块不再整篇 re-parse / Prism 同步高亮；全引擎统一走增量 full，折叠兜底阈值放宽到 24k
- **会话内历史分页窗口**：数据层 items 全量保留，DOM 默认只留最近 150 条；进行中的回合不裁、不在底部时冻结窗口；上翻复用折叠 chip 分页展开并保持 scrollTop

🔧 Improvements

- **AppShell 分域瘦身 + Host 订阅收窄**：composer / settings / layout 三巨域从 141 / 147 / 103 收到 41 / 36 / 48；删除 legacy flatten；Assembly 只订自己读的字段，流式热字段不再灌回根
- **冷启错峰与让渡**：gate-ready 后 pointerdown 仍软取消在途列表水合；catalog 落账遇待输入让出一拍；idle 预热 Markdown；非关键 store / deferred i18n 延后；Composer 切断 1110 张彩图 SVG
- **搜索不再自动全仓库扫描**：打开搜索按需读关系快照，过期 backup 当缓存回收
- **会话列表预览降载**：Claude / Gemini 历史摘要只读文件头，不再整读会话 JSON
- **隐藏窗口降载**：窗口不可见时背压改 100ms timeout 排水，并跳过本轮 git status 轮询
- **消息图片异步解码**：`LocalImage` 默认 `decoding="async"`，大图不再堵主线程
- **下线听写与看板 / 任务中心**：去掉 dictation 原生链路与设置页；删除 Kanban / Task Center 功能面，Home 发送抽到 ComposerSend；本地用户数据与项目图标保留

🐛 Fixes

- **Windows 冷启动点击假死**：版本记录自动弹出改为 startup-gate-ready + 交互空闲后再开；关闭弹窗会作废在途加载，避免关完再被晚到的 catalog 打回来
- **Composer 冷启不升 full**：`ComposerGate` 必须等 startup-gate-ready，且 Light 最短停留；早期点击只推迟升级，不再挂 `ComposerImpl`
- **Light 输入区不再泄漏模型选择**：没有 `onExecutionTargetChange` 时不传可点 picker，也不走 atomic catalog
- **identity 缩放不再空写样式**：`applyUiScale` 在 100% 路径 verify-before-write，避免冷启无 residual 仍清 html/body inline style
- **Grok 思考首 token 碎片**：工具切换前先 drain live 尾段；首 token / 词中 / 续标点碎片行内拼接，不再拆成一串孤立段落
- **Windows 主线程栈溢出**：仅 Windows 将主线程栈 reserve 提到 8MB，避免 Tauri 深 async 链 `STATUS_STACK_OVERFLOW`
- **Git diff 行观察重复**：删除 `GitDiffViewer` 逐行 `ResizeObserver`，交给 virtual-core 共享观察

English:

This release moves the app to **0.8.9**. The headline is smoother streaming, bounded long histories, and a clickable Windows cold start (#1092): reasoning and tool output no longer dispatch into the root on every chunk, so long thoughts and tool spam stay followable; streaming Markdown becomes incremental so per-frame cost no longer grows with the whole body; long sessions keep a recent DOM window and expand upward by page; AppShell domains slim down so typing, paste, and turn changes no longer fan out the whole shell; in the first seconds after a Windows install or upgrade, tapping release notes, permission / mode select, or any visible chrome no longer stalls the window for about a minute. Dictation and Kanban / Task Center leave the product surface. Grok first-token salad, hidden-window backpressure, session-preview full-file reads, and search auto-scans close the rest.

✨ Features

- **Live channel for reasoning / tool output**: `reasoningContent` / `reasoningSummary` / `toolOutput` subscribe per row instead of per-chunk root `dispatch`; first delta still shells the item, later deltas publish on a 48ms cadence, settle drains once; long-reasoning turns drop root updates from 200+ to single digits
- **Incremental streaming Markdown**: split the accumulated body and re-layout at most the last 2 blocks; frozen blocks skip full re-parse / sync Prism; every engine uses incremental full mode; lightweight fold fallback moves to 24k
- **In-session history window**: reducer items stay complete; the DOM defaults to the latest 150; in-flight turns are not split and the window freezes when the user is not at the bottom; scroll-up reuses the collapse chip to page in older rows without jumping `scrollTop`

🔧 Improvements

- **AppShell domain slim-down + Host field subscribe**: composer / settings / layout shrink from 141 / 147 / 103 keys to 41 / 36 / 48; delete legacy flatten; Assembly subscribes only to fields it reads so streaming-hot values stay off the root
- **Cold-start stagger and yield**: after gate-ready, pointerdown still soft-cancels in-flight list hydration; catalog commits yield one tick when input is pending; idle-prewarm Markdown; defer non-critical stores / i18n; Composer drops the 1110-image color SVG set
- **Search no longer auto-scans the repo**: open-search reads the relation snapshot on demand; stale backups are cache, not a sync sweep
- **Cheaper session-list previews**: Claude / Gemini history summaries peek file headers instead of reading whole session JSON
- **Hidden-window load cut**: when the window is hidden, drain backpressure on a 100ms timeout and skip that git-status refresh
- **Async image decode**: `LocalImage` defaults to `decoding="async"` so large message images leave the main thread
- **Retire dictation and Kanban / Task Center**: remove the native dictation path and its settings page; drop the Kanban / Task Center surface and lift Home send into ComposerSend; keep local user data and project icons

🐛 Fixes

- **Windows cold-start click freeze**: auto-open release notes only after startup-gate-ready plus an interactive quiet slice; closing the overlay invalidates in-flight loads so a late catalog resolve cannot reopen it
- **Composer stays light on cold start**: `ComposerGate` requires startup-gate-ready and a Light floor; early clicks delay the upgrade instead of mounting `ComposerImpl`
- **Light composer no longer leaks ModelSelect**: do not pass a clickable picker or the atomic catalog unless `onExecutionTargetChange` is actually wired
- **Identity UI scale no longer writes empty styles**: `applyUiScale` verify-before-write on the 100% path so cold start does not clear html/body inline styles with no residual
- **Grok first-token reasoning salad**: drain the live reasoning/tool tail before a tool-cut segment increment; join first-token, mid-word, and continuation-punctuation fragments inline instead of one paragraph per shell
- **Windows main-thread stack overflow**: raise the Windows-only main-thread stack reserve to 8MB so deep Tauri async chains no longer hit `STATUS_STACK_OVERFLOW`
- **Duplicate Git diff row observers**: drop per-row `ResizeObserver` in `GitDiffViewer` and keep the shared virtual-core observer

---

### **2026年8月12日（v0.8.8）**

中文：

这一版将应用升到 **0.8.8**，主线是「侧栏 Session Index 冷路径、冷启再削重、界面缩放永久 100%、跨目录可授权」：对话列表冷启与日常刷新改为本地 SQLite Session Index，不再默认全量多引擎 catalog 扫描；版本说明拆索引 + 分版本 chunk，并延后自动弹窗与 first-paint 错峰；新用户路径打断 mermaid 静态依赖、CSS/统计分级延后；界面缩放永久锁定 100% 消除 WebView 假死路径；Claude Read/Bash 越界时内联目录授权卡（写入 L1，下次 `--add-dir`）；另收口 Shared 历史非阻塞、Markdown 表行计数白屏、AskUserQuestion 幽灵卡、macOS 通知、Grok 标题污染、并行会话模型 residual 与「用…打开」等。

✨ Features

- **侧栏 Session Index 冷路径**：冷启 / 日常刷新从本地 SQLite Session Index 取 list 级行（Claude / Codex / Kimi + 有界 Gemini/Grok/OpenCode writer）；first-paint 合并 index 水合后，有多引擎种子则不再自动 post-first-paint full-catalog；会话管理 / load-older / 强制刷新仍走完整 catalog；OpenSpec：`rewrite-sidebar-session-index`
- **会话目录授权（DirectoryGrant）**：Read/Bash 因 allowed working directories 越界时合成内联授权卡（#1062 方案 A）；批准写入 session L1，下次 Claude CLI 启动注入 `--add-dir`；拒绝保持 fail-closed
- **「用…打开」跨平台配置与当前文件打开**：预设探测 / Browse、可点击健康态重检、系统图标与深浅色主题；顶栏应用打开当前文件，访达仍开工作区；修复底栏下拉不可点
- **省略号 Tooltip 门控 + 运行时通知坞可收起**：`FloatingTooltipButton` 仅在目标水平截断时弹出；侧栏会话名短标题不再无意义气泡；`GlobalRuntimeNoticeDock` 支持点外 / Escape 收起（含 portal 面板）
- **首页 Composer 几何对齐**：去掉 HomeChat 对输入区 padding / min-height / 字号的覆盖，与会话 Composer 共用 `ChatInputBox` 尺寸（含响应式断点）

🔧 Improvements

- 将应用版本号提升到 `0.8.8`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐
- **版本说明分片 + 冷启降本**：`CHANGELOG` 生成轻量 index + 分版本 JSON；冷路径只加载 index + 当前版本正文；codegen 接入 dev/build 与 tauri frontend bootstrap
- **版本说明自动弹窗延后与 lastSeen 时机**：版本 bump 后延迟 2s 再 auto-open，错开 first-paint / AppShell hydrate；内容加载成功即写 `releaseNotesLastSeenVersion`，避免中途卡死导致每次启动重弹
- **新用户冷启路径**：打断 bootstrap 对 mermaid 的静态依赖；收敛 mapDeps / preload / catalog prewarm；非关键面板 CSS 分级延后（保留 subagent-ui 聊天列布局）；百度统计 defer；Tooltip 共用 ambient Provider；回退分时 i18n 为整包加载，避免 settings/files raw key
- **会话 catalog 缓存与 idle 收敛**：OpenCode / Claude session list IPC 加 TTL + in-flight 缓存；focus soft recovery 在 catalog 仍新鲜时跳过再 fan-out；删除会话时使 OpenCode 缓存失效；quiet idle 全量 catalog 在 active first-paint 之后调度
- **Codex ThreadPreview 分区早停**：按 YYYY/MM/DD 分区 recent-first 收集候选并带 early-stop 预算，避免为小分页先全树 collect 再 sort

🐛 Fixes

- **界面缩放永久锁定 100%**：设置 / 快捷键 / 命令面板不再可调 uiScale；`clamp` / `sanitize` / `apply` 恒为 identity；历史 `settings.json` 非 1 值忽略并回写 1；清除 startup-guard residual，从产品侧关掉 WKWebView / WebView2 假死路径
- **Markdown 表行计数栈溢出白屏（#1066）**：`countMarkdownTableRows` 加 WeakSet 断环 + 深度上限 64；仅 heavy-defer kill-switch 开启时遍历；产品路径零树遍历，避免多代理场景 `RangeError: Maximum call stack size exceeded`
- **Shared 历史 V0 先画 + 软超时 projection**：snapshot 就绪即卸 curtain 可对话；projection 默认 12s 软超时后后台 merge；迟到结果与 live 画布 items 合并而非整表覆盖
- **AskUserQuestion 结算幽灵卡 + 请求输入 UI**：跳过/提交后 MCP 继续且同 identity 不再重弹；sole-waiter 恢复与历史防 rehydrate；幕布扁平折叠 / 分段 Tab 定稿
- **macOS 系统通知**：桌面端改 `UNUserNotificationCenter`；非 `.app` 裸二进制跳过 UN API 避免 debug 崩溃；Windows 仍走 plugin
- **Grok 历史 / 侧栏标题污染**：过滤 `<user_info>` / `<rules>` 等 bootstrap 信封；优先真实 `<user_query>` 作 first prompt 与会话名；弱标题可被真用户文案升级
- **Native 并行会话跨供应商模型 residual**：历史二次发送时，catalog 就绪则 repair 错误 freeform 产品模型名；空 catalog 仍放行 freeform 避免冷启回归
- **Shared 会话隐藏完成邮件入口**：Shared V2 不传 / hard-guard `onToggleCompletionEmail`，避免假能力静默失败
- **Kanban Windows 顶栏**：为窗口控件预留右侧间距；锁定 44px 高度并对齐 titlebar-toggle-offset，避免与 —/▢/✕ 重叠或偏中线
- **Revert debug identity（#1078）**：撤回 PR #1072 调试身份相关改动，恢复干净生产路径

English:

This release moves the app to **0.8.8**. The headline is a Session Index cold path for the sidebar, another cold-start cost cut, permanently locked 100% UI scale, and session directory grants: conversation list cold start and ordinary refresh load list rows from a local SQLite Session Index instead of exhaustive multi-engine catalog projection; release notes become an index plus per-version chunks with deferred auto-open off first paint; new-user paths drop static mermaid, defer non-critical CSS/analytics, and load i18n as a whole package again; interface scale is product-locked at 100% to close WebView freeze paths; Claude Read/Bash out-of-cwd prompts can grant directories into session L1 (`--add-dir` next launch); Shared history non-blocking paint, Markdown table row-count stack overflow, AskUserQuestion ghost cards, macOS notifications, Grok title pollution, parallel-session model residual, and Open With polish round out the ship.

✨ Features

- **Sidebar Session Index cold path**: cold start and ordinary refresh read list-level rows from a local SQLite Session Index (Claude / Codex / Kimi + bounded Gemini/Grok/OpenCode writers); after first-paint index hydration seeds multi-engine rows, automatic post-first-paint full-catalog stops; Session Management / load-older / force refresh still use full catalog; OpenSpec: `rewrite-sidebar-session-index`
- **Session directory grant (DirectoryGrant)**: when Read/Bash hit allowed-working-directories bounds, synthesize an inline grant card (#1062 plan A); approvals persist in session L1 and inject `--add-dir` on the next Claude CLI start; deny stays fail-closed
- **Cross-platform Open With + open current file**: preset probe / Browse, clickable health recheck, system icons and light/dark themes; titlebar apps open the current file while Finder still opens the workspace; fix unclickable bottom-bar dropdown
- **Ellipsis tooltip gate + dismissible runtime notice dock**: `FloatingTooltipButton` only opens when the target is horizontally truncated; short fully-visible thread titles no longer flash tooltips; `GlobalRuntimeNoticeDock` minimizes on outside click / Escape (including portaled panels)
- **Home Composer geometry alignment**: drop HomeChat overrides for input padding / min-height / font size so home inherits shared `ChatInputBox` geometry (including responsive breakpoints)

🔧 Improvements

- Bump the app version to `0.8.8` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata
- **Release-notes sharding + cold-start cost cut**: generate a light index plus per-version JSON so cold path loads index + current version only; wire codegen into dev/build and tauri frontend bootstrap
- **Deferred release-notes auto-open and earlier lastSeen**: delay auto-open 2s after a version bump to clear first-paint / AppShell hydrate; write `releaseNotesLastSeenVersion` as soon as content loads successfully so a freeze mid-modal no longer re-triggers every launch
- **New-user cold-start path**: break static mermaid from bootstrap; tighten mapDeps / preload / catalog prewarm; defer non-critical panel CSS (keep subagent-ui chat-column layout); defer analytics; share ambient Tooltip provider; restore whole-pack i18n load to avoid settings/files raw keys
- **Session catalog cache and idle convergence**: TTL + in-flight cache for OpenCode / Claude session list IPC; focus soft recovery skips re-fan-out while the catalog is still fresh; invalidate OpenCode cache on session delete; schedule quiet idle full-catalog after active first-paint
- **Codex ThreadPreview partition early-stop**: collect candidates recent-first by YYYY/MM/DD partitions with an early-stop budget instead of full-tree collect-then-sort for a small page

🐛 Fixes

- **UI scale permanently locked to 100%**: settings / shortcuts / command palette no longer change uiScale; clamp / sanitize / apply always identity; legacy non-1 `settings.json` values ignored and rewritten to 1; clear startup-guard residual and retire the WKWebView / WebView2 freeze path at product level
- **Markdown table row-count stack overflow white screen (#1066)**: bound `countMarkdownTableRows` with WeakSet cycle breaks + depth cap 64; traverse only when heavy-defer kill-switch is on; product path zero tree walks so multi-agent `RangeError: Maximum call stack size exceeded` no longer takes ErrorBoundary
- **Shared history V0-first paint + soft-timeout projection**: drop the curtain when the V0 snapshot is ready; projection soft-times out at 12s then merges in the background; late results merge into live canvas items instead of replacing the whole table
- **AskUserQuestion settlement ghost cards + request-input UI**: after skip/submit, MCP continues and the same identity does not re-prompt; sole-waiter restore and history anti-rehydrate; finalize flat collapse / segmented Tab canvas chrome
- **macOS system notifications**: desktop path uses `UNUserNotificationCenter`; skip UN APIs for non-`.app` bare binaries so debug launches do not crash; Windows still uses the plugin path
- **Grok history / sidebar title pollution**: filter bootstrap envelopes such as `<user_info>` / `<rules>`; prefer real `<user_query>` for first prompt and thread names; weak titles can upgrade to real user copy
- **Native parallel-session cross-provider model residual**: on resend from history, repair wrong freeform product model names when catalog is ready; empty catalog still allows freeform to avoid cold-start regressions
- **Hide completion-email entry on Shared sessions**: Shared V2 does not pass / hard-guards `onToggleCompletionEmail` so a fake capability cannot fail silently
- **Kanban Windows top bar**: reserve right inset for window chrome; lock 44px height and align titlebar-toggle-offset so PanelRight does not collide or mis-center with —/▢/✕
- **Revert debug identity (#1078)**: revert PR #1072 debug-identity changes and restore a clean production path

---

### **2026年8月11日（v0.8.7）**

中文：

这一版将应用升到 **0.8.7**，主线是「发送前可挑记忆、Shared 下崽侧栏不串台、Cmd+R 冷启可点」：Native / Shared / Collab 统一接入发送前记忆挑选闸门（pick / always），always 预勾可改且 8s 读秒可取消；Phase-2/3 补齐 hybrid 检索、习惯持久化与本地语义模型；Shared 子代理按 parent-id 改挂并在侧栏隐藏下崽；同时收口冷启猛点假死（`ComposerGate` 轻量输入区 + 模型位 loading）与队列 auto-drain 启动门对齐。Mac 验收不卡死（约 98% 收口）。

✨ Features

- **发送前记忆挑选闸门（Phase-1）**：Native / Shared / Collab 统一 `pick` / `always` 闸门与 memory-pick 注入；always 可改预勾条数并记忆，8s 读秒可取消；详情 Dialog portal + Markdown；底栏 icon 文案、固定行高；侧栏标题剥离 `project-memory-pack`；幕布与 Composer 模式同步
- **Hybrid 检索与可感注入转接（Phase-2）**：统一 Pick / Scout 检索核（lexical + 可选 semantic/hybrid）；`emptyReason` 走主幕时间线 status 可感；telemetry 白名单禁正文；Pack Instruction 钉死 Primary task 与 UNTRUSTED 参考语义；闸门 / 空结果 UI 中性色与列表高度收口（采集 ABCD 路径零改动）
- **项目记忆习惯与本地语义（Phase-3）**：session 策略 localStorage 持久化；Composer dismiss 恢复为 pick；设置「项目记忆」规则说明 + 语义模型按需下载到用户主目录 `.ccgui/models/embedding/`（展示本机绝对路径，跨平台）；embed-index 旁路异步索引；用户可关语义强制词面；hybrid 最低门槛与词面满分抬升；匹配最短 1s 冻结
- **Composer 冷启轻量门控（ComposerGate / ComposerLight）**：冷启先挂 Adapter 轻量层，工具栏结构与最终态一致；模型选择位始终占位（「加载中」→ 真模型名同位置替换）；停手后再挂完整 `ComposerImpl`（状态条等重能力）
- **模型位 / Readiness 静态占位**：轻量路径经 `sendReadiness` 渲染 Readiness 模型位，**不**在冷启开 atomic catalog（避免假死复现）；未解析模型时转圈 + 文案，就绪后替换

🔧 Improvements

- 将应用版本号提升到 `0.8.7`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐
- **队列 drain 非对抗调度**：无 queue/inflight 时 drain signal 稳定 `empty`；有队列才跟 status；放行与 `startup-gate-ready` / force-enter 对齐，gate 后短静默再开 auto-drain；用户 `handleSend` / `queueMessage` 始终可用
- **冷启 list / restore quiet 副线**：first-paint 与 restore 错峰、点击 soft-cancel 进行中 list；home 无 active 时 stamp `home-input-ready`；uiScale healthy 确认 rAF 延后
- **Composer 空闲 memo**：非流式忽略 ActiveCanvas 热 props，减轻 history hydrate 重渲
- 联调证据与收口文档：`docs/analysis/cold-start-composer-freeze-closeout-2026-08-11.md`、二分 checklist 与截图包

🐛 Fixes

- **Shared 子代理 parent 改挂**：隐藏 native owner 后，按引擎无关 lookup（raw / `engine:` 变体）将子代理 parent 改挂到 shared 会话，避免仅 exact 匹配漏挂并升为顶层根；统一 list / Grok / Kimi / live 改挂路径，不扩大 hide、不删子代理行
- **侧栏隐藏 Shared 下崽**：在 `useThreadRows` 按 parent-id 精准剔除 Shared-owned 子代理（含 raw / `engine:` 与 `shared:` parent）；threads store 保留行供幕布 / Strip / `childSubagentThreads`，不改幕布展示规则
- **记忆挑选匹配态与 always 读秒**：匹配品牌改用项目 logo 并轻微呼吸动画，最短展示 1s 避免闪断；仅闸门以 always 进入 awaiting 时武装 8s 读秒，任意交互打断后本轮不重启；顶栏单行 ellipsis，策略菜单虚线框
- **Cmd+R / 冷启猛点整窗假死**：根因完整 `Composer.tsx` 立即挂载与点击撞主线程；轻量层不卡，完整层停手后再挂（Mac 验收通过）
- **假死回归（队列 auto-drain）**：默认开 S1 drain 并下灌 `threadStatusById` / `activeItems` 时冷启猛点窗复现假死；改为启动门后放行 + 近点击跳过 settlement/auto-drain，保留防重发与 cap=1
- **输入区 UX**：模型位与「全自动」间无大空洞（readiness 不 `1fr` 撑空）；轻量层使用 `footer.composer` 与完整态同宽（`max-width: 750px`），避免先全宽再缩

English:

This release moves the app to **0.8.7**. The headline is a pre-send memory pick gate, Shared subagents that stay out of the sidebar tree, and cold starts that stay clickable under Cmd+R thrash: Native / Shared / Collab share a pick / always gate before send (always countdown cancellable, preview counts remembered); Phase-2/3 unifies hybrid retrieval, habit persistence, and local semantic models; Shared children reparent by parent-id and are filtered from the sidebar; cold-start click freeze is closed with `ComposerGate` (light shell + model-slot loading) and queue auto-drain aligned to `startup-gate`. Mac verification: no hard freeze (~98% closeout).

✨ Features

- **Pre-send memory pick gate (Phase-1)**: unified `pick` / `always` gate and memory-pick injection across Native / Shared / Collab; always remembers editable pre-check counts with an 8s cancellable countdown; portal Dialog + Markdown details; icon+label footer, fixed row height; strip `project-memory-pack` from sidebar titles; canvas and Composer modes stay in sync
- **Hybrid retrieval and explainable injection (Phase-2)**: shared Pick / Scout kernel (lexical + optional semantic/hybrid); `emptyReason` surfaces on the main timeline status lane; telemetry whitelist excludes body text; pack instructions pin Primary task and UNTRUSTED reference semantics; neutral empty-state chrome and list height polish (capture ABCD paths unchanged)
- **Project memory habits and local semantics (Phase-3)**: persist session policy in localStorage; Composer dismiss restore to pick; Settings “Project Memory” rules + on-demand semantic model download under user-home `.ccgui/models/embedding/` (absolute path per machine); async embed-index side path; optional force-lexical toggle; hybrid min thresholds and full-lexical score floor; match UI min 1s frozen
- **Composer cold-start light gate (`ComposerGate` / `ComposerLight`)**: mount Adapter-light first with final toolbar structure; model slot always reserved (“loading” → real model name in place); promote to full `ComposerImpl` after the user stops interacting (status strip and heavy hooks)
- **Model slot / Readiness static placeholder**: light path uses `sendReadiness` so Readiness shows the model slot without enabling the atomic catalog on cold start; spinner + copy while unresolved, then replace

🔧 Improvements

- Bump the app version to `0.8.7` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata
- **Non-adversarial queue drain scheduling**: stable `empty` drain signal with no queue/inflight; status only for threads with work; release after `startup-gate-ready` / force-enter plus a short quiet; `handleSend` / `queueMessage` always available
- **Cold-start list / restore quiet side path**: staggered first-paint and restore, soft-cancel in-flight list on click; stamp `home-input-ready` when no active workspace; defer uiScale healthy localStorage write via rAF
- **Composer idle memo**: ignore ActiveCanvas hot props when not processing to cut history-hydrate re-renders
- Investigation notes and evidence: `docs/analysis/cold-start-composer-freeze-closeout-2026-08-11.md`, bisect checklist, screenshot pack

🐛 Fixes

- **Shared subagent parent reattach**: after native owners are hidden, engine-agnostic lookup (raw / `engine:` variants) reparents children onto the shared session so exact-only matches no longer promote them to top-level roots; list / Grok / Kimi / live reparent paths share the fix without widening hide or deleting child rows
- **Hide Shared children in the sidebar**: `useThreadRows` drops Shared-owned subagents by parent-id (raw / `engine:` and `shared:` parents); the threads store keeps rows for canvas / Strip / `childSubagentThreads` without changing canvas display rules
- **Memory-pick match chrome and always countdown**: match state uses the project logo with a light pulse and a 1s minimum display; the 8s always countdown arms only when the gate enters awaiting as always, and any interaction cancels restart for that turn; top bar single-line ellipsis and dashed strategy menu chrome
- **Cmd+R / cold-start full-window freeze**: root cause was mounting full `Composer.tsx` immediately under early clicks; light path stays clickable, full path mounts after quiet (Mac verified)
- **Freeze regression from queue auto-drain**: default S1 drain plus composition-hot `threadStatusById` / `activeItems` re-froze cold-start thrash; release drain after startup-gate and skip settlement/auto-drain under recent input; keep anti-resend gates and cap=1
- **Composer chrome UX**: no large gap between model loading and mode pills (readiness no longer grows with `1fr`); light shell uses `footer.composer` max-width 750px so the box does not go full-width then shrink

---

### **2026年8月10日（v0.8.6）**

中文：

这一版将应用升到 **0.8.6**，主线是「中转额度可看、Windows 冷启可点、协作首段有主幕上下文」：Session Control HUD 接入 Sub2API / New API 中转额度与 Grok 本地用量；冷启 CSS 写入按 macOS WKWebView / Windows WebView2 分轨，修 Windows 点击假死且不回归 mac 首点死锁；协作首段把主幕已有对话 digest 注入模型侧，右栏可解释、主幕卡标题不泄漏；侧栏同组项目长按重排；`!` 提示词列表 soft-failure 与 Grok/Kimi/Shared 记忆整轮写入一并压实。

✨ Features

- **中转站额度查询与 HUD 展示**：未知中转 base+key 先探 `GET /v1/usage`，失败回退 `/api/user/self`；Grok local 读 `~/.grok/config.toml`；Session Control HUD 展示余额与用量摘要（供应商 `{origin} {source}`、金额两位小数），失败友好中文文案
- **协作首段注入主幕对话上下文**：主幕已有对话时，触发协作将 digest 置顶写入首段 `model text`（后续段仍只吃可见任务 + 上游产出）；主幕协作卡标题优先 `userVisibleText`，右栏「注入上下文」首段增加「主幕对话上下文」分区
- **侧栏同组项目长按重排**：长按折叠/文件夹控件武装拖拽（约 380ms），组内调整 `sortOrder` 并持久化；无独立拖柄列，列表内就地重排

🔧 Improvements

- 将应用版本号提升到 `0.8.6`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐

🐛 Fixes

- **Windows 冷启点击假死 / macOS 首点死锁分轨**：冷启 `applyUiScale` 按平台分支——Windows WebView2 首帧零冗余 CSS 写入（避免 Blink style recalc 堵 hit-test），macOS WKWebView 恢复预热写入（避免 CSSOM 懒初始化首点死锁）；blank-screen watchdog 冷启窗延迟；StartupGateOverlay 减少 `color-mix` 负担
- **`!` 自定义提示词列表 soft-failure 永久空态**：启动编排 timeout/stale 不再把空数组 stamp 为权威拉取；空态 on-demand revalidate，并发 refresh 共享 in-flight
- **Grok / Kimi / Shared 项目记忆整轮写入**：Native Gemini 系 TurnCompleted 始终走 text-lane，驱动完整 `conversation_turn` 融合；Shared V2/V1 补 `captureTurnInput`，terminal 投影后仍触发完成融合

English:

This release moves the app to **0.8.6**. The headline is visible relay quota, Windows cold starts that stay clickable, and collab first stages that inherit main-canvas dialogue: Session Control HUD adds Sub2API / New API relay balance plus local Grok usage; cold-start CSS writes split by macOS WKWebView vs Windows WebView2 so Windows no longer freezes on click without regressing mac first-click lockups; collab injects a main-canvas dialogue digest into the first stage (explainable in the Inspector, clean titles on the main card); long-press reorder for projects in a sidebar group; `!` custom-prompt soft-failure and Grok/Kimi/Shared memory turn capture round out the patch.

✨ Features

- **Relay quota probe and HUD display**: unknown relay base+key probes `GET /v1/usage` first, falls back to `/api/user/self`; Grok local reads `~/.grok/config.toml`; Session Control HUD shows balance and usage summary (provider as `{origin} {source}`, two-decimal amounts) with friendly Chinese failure copy
- **Main-canvas dialogue into collab first stage**: when the main canvas already has turns, starting collab prepends a capped digest to the first-stage model text (later stages still take visible task + upstream only); collab card titles prefer `userVisibleText`; Inspector inject-context gains a first-stage “main-canvas dialogue” section
- **Long-press reorder for projects in a group**: long-press the collapse/folder control (~380ms) arms drag; reorder within the same group and persist `sortOrder`; no separate handle column, in-list reorder only

🔧 Improvements

- Bump the app version to `0.8.6` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata

🐛 Fixes

- **Windows cold-start click freeze / macOS first-click deadlock, platform-split**: `applyUiScale` branches by platform—Windows WebView2 keeps residual-only clears on the first frame (no Blink style-recalc hit-test stall), macOS WKWebView restores warm-up writes (no CSSOM lazy-init first-click deadlock); blank-screen watchdog delays force-layout in the cold window; StartupGateOverlay reduces `color-mix` cost
- **`!` custom-prompt list soft-failure permanent empty**: startup orchestration timeout/stale no longer stamps an empty array as authoritative; empty state revalidates on demand with shared in-flight refresh
- **Grok / Kimi / Shared project-memory full-turn capture**: Native Gemini-family TurnCompleted always emits text-lane item/completed so `onAgentMessageCompleted` fuses full `conversation_turn`s; Shared V2/V1 capture turn input and still fuse after terminal projection

---

### **2026年8月9日（v0.8.5）**

中文：

这一版将应用升到 **0.8.5**，主线是「供应商设置可日常管、对话贴底更稳、切项目不再卡」：CLI 设置拆成引擎设置 / 供应商通道，官方配置可应用内编辑（懒加载 CodeMirror）；消息画布去掉虚拟列表、重写贴底跟随；工作区切换热路径不再做全量会话投影扫描；启动全屏遮罩默认关闭（可本机测试恢复）；侧栏内联改名与归档即时消失、工具行统一 kind 标签与文件图标；纯图发送与 Git 行默认进 DIFF 一并压实。

✨ Features

- **供应商设置分层与官方/三方切换**：各 CLI 页拆为「引擎设置」与「供应商通道」；官方/本地统一 `VendorOfficialConfigCard`（使用 / 停用 / 授权）；Grok/Kimi/OpenCode 本地官方迁出三方表；启用徽章改为 `VendorProviderActiveSwitch`（关当前通道可 `__disabled__` 回退全局官方配置，不改写 `~/.codex` / `~/.grok` 等文件）
- **官方配置应用内编辑（Kimi / Grok / OpenCode + Claude / Codex 对齐）**：读/写各自全局 config（TOML/JSON/JSONC），校验 + 原子写 + Unix `0o600`；可「打开所在文件夹」；对话框统一多面板 chrome
- **官方配置 CodeMirror 编辑器**：懒加载 Syntax 高亮 / 行号 / 折叠；JSON 解析 lint；跟随主题；不进入设置页首屏关键路径
- **侧栏会话内联改名与文件夹操作收敛**：去掉全局 `RenameThreadPrompt` 弹窗，行内 Enter/blur 确认、Escape 取消；文件夹次要操作收入 portaled ⋯ 菜单（重命名 / 新建文件夹 / 删除）；新建会话仍留在行上
- **工具行统一 kind 标签 + 文件类型图标**：`ToolMarkerShell` 增加 kind 槽（单色动作图标 → 短 kind → 内容）；Read / 批量读 / Edit 展示 `ToolFileTypeIcon`；kind、匹配数、搜索字段、批量标题、bash 回退、截断 diff 等完成多语言
- **纯图 / 仅附件发送链路**：Grok 等多模态引擎注入的 image-only 占位文案不落用户气泡；空正文但有图/附件的用户消息保留；按图片身份去重避免连发纯图被折叠；乐观气泡先于 await 绘制，避免空会话占位闪一下；Read 读到图片文件时展开 `ImageView` 预览
- **Git Diff 行默认打开可编辑 DIFF**：文件行点击进 DIFF 审阅；行内动作改为「打开文件」；刷新时保留分区/文件夹折叠

🔧 Improvements

- 将应用版本号提升到 `0.8.5`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐
- **消息贴底跟随重写并移除虚拟化**：以紧凑 `useMessagesCanvasFollow` 取代旧 scroll authority / 收敛环 / echo 指纹；时间线静态全量 DOM 渲染；发送 / 开历史 / settle 走 force-pin；手动回底支持平滑滚动（`resumeFollowAndSmoothPin`）
- **启动遮罩默认隐藏**：主窗冷启不再挂全屏 `StartupGateOverlay`；「其他设置」底部提供本机测试开关（默认关、下次启动生效）；后台 first-paint / gate-ready 契约不变
- **CLI 自定义路径与自定义模型文案**：路径行标题带引擎名；空路径显示「当前使用：系统 PATH」；安装状态冷载用 checking/session cache，避免误报「未安装」；unified-exec 分段控件在外部状态就绪前不点亮
- **用户气泡复制操作**：短气泡用遮罩叠复制按钮，不再预留右侧 padding
- **应用图标全平台补边距**：桌面 / Windows tile / Android / iOS 启动图标统一留白，避免系统圆角裁切品牌标

🐛 Fixes

- **切换工作区主线程卡死**：AppShell 导航所需 owner topology 改为本地 `workspaces` 推导，切换热路径不再调用 `get_workspace_session_projection_summary`（9999 全源扫描）；list 在 stale/cancel 后协作式早退，禁止迟到 setThreads；Settings/会话管理显式统计查询不变
- **Markdown/工具增高误取消贴底**：仅在 `scrollTop` 上移且高度未缩小时视为用户离开底部；高度增长 + scrollTop 不动保持跟随；pin 后双 rAF 宽限，抑制 reflow 滚动回声；ResizeObserver 与 live-text stick 合并到每帧最多 pin 一次
- **归档成功后侧栏不消失**：优先精确 `sessionId` 匹配（后端归一化 id 时单结果回退），`deletedThreadIds` 传入加载守卫，行即时移除，避免等全量 catalog 重扫与 continuity 竞态
- **Read 目录检测**：`list_dir` / target directory / 尾斜杠路径正确显示文件夹图标与 List 标签
- **供应商设置首屏状态**：provider 列表先 loading；CLI 版本冷载不误标未安装

English:

This release moves the app to **0.8.5**. The headline is vendor settings you can actually manage day to day, a calmer stick-to-bottom conversation canvas, and workspace switches that no longer freeze the UI: CLI settings split into engine vs provider channels with in-app official config editors (lazy CodeMirror); the message canvas drops virtualization and rewrites follow; workspace-switch hot paths no longer run exhaustive session projection scans; the startup full-screen gate is off by default (opt-in for local repro); sidebar inline rename + instant archive, unified tool kind labels/file icons; image-only sends and Git row → DIFF by default round out the ship.

✨ Features

- **Vendor settings hierarchy and official/third-party switching**: each CLI tab splits into Engine settings vs Provider channels; official/local rows use `VendorOfficialConfigCard` (Use / Stop using / Authorize); Grok/Kimi/OpenCode local official rows leave the third-party table; enable badges become `VendorProviderActiveSwitch` (turning off the active channel can clear managed `current` via `__disabled__` and fall back to global official config without rewriting `~/.codex` / `~/.grok`, etc.)
- **In-app official config editors (Kimi / Grok / OpenCode + Claude / Codex aligned)**: read/write each engine’s global config (TOML/JSON/JSONC) with validation, atomic write, and Unix `0o600`; open containing folder; shared multi-pane dialog chrome
- **Lazy CodeMirror for official configs**: syntax highlight / line numbers / folding; JSON parse lint; theme-aware; kept off the settings shell critical path
- **Inline thread rename and denser folder actions**: remove global `RenameThreadPrompt`; in-row Enter/blur confirm, Escape cancel; folder secondary actions move into a portaled ⋯ menu (rename / new folder / delete); new-session stays on the row
- **Unified tool markers with kind labels + file-type icons**: `ToolMarkerShell` kind slot (mono action icon → short kind → content); Read / batch-read / Edit show `ToolFileTypeIcon`; kind labels, match counts, search fields, batch titles, bash fallbacks, truncated-diff copy fully i18n’d
- **Image-only / attachment-only send path**: strip synthetic Grok (and similar) image-only fallback text from history and canvas; keep empty-text user messages that still have images/attachments; dedupe by image identity so sequential pure-image turns are not collapsed; paint optimistic user bubbles before awaits so the empty-thread placeholder does not flash; Read(image) expands to a real `ImageView` preview
- **Git Diff rows open editable DIFF by default**: row click reviews the diff; the row action becomes “Open file”; section/folder collapse survives git watch refreshes

🔧 Improvements

- Bump the app version to `0.8.5` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata
- **Stick-to-bottom rewrite + end virtualization**: compact `useMessagesCanvasFollow` replaces the old scroll-authority / convergence / echo-fingerprint stack; timeline renders a static full DOM; send / history-open / settle use force-pin; manual back-to-bottom supports smooth scroll (`resumeFollowAndSmoothPin`)
- **Startup gate overlay off by default**: main window no longer mounts full-screen `StartupGateOverlay` on cold start; Other settings gains a local test switch (default off, next launch); background first-paint / gate-ready contracts unchanged
- **CLI custom path and custom models copy**: path row titles include the engine name; empty path reads “Currently using: system PATH”; install status cold load uses checking/session cache to avoid false “not installed”; unified-exec segmented control stays inactive until external status is ready
- **User bubble copy actions**: short bubbles overlay copy controls with a scrim instead of reserved right padding
- **Padded app icons across platforms**: desktop / Windows tiles / Android / iOS launchers share consistent padding so OS masks no longer clip the mark

🐛 Fixes

- **Workspace-switch main-thread stall**: AppShell navigation owner topology is derived locally from `workspaces`—the switch hot path no longer calls `get_workspace_session_projection_summary` (9999 full-source scan); list paths abandon cooperatively after stale/cancel and never apply late `setThreads`; explicit Settings/session-management projection queries stay
- **False unfollow on Markdown/tool height growth**: leave-bottom only when `scrollTop` moves up and height did not shrink; height growth with stable `scrollTop` keeps follow armed; two-rAF grace after pin blocks reflow scroll echoes; ResizeObserver and live-text stick coalesce to at most one pin per frame
- **Archived rows stick in the sidebar**: prefer exact `sessionId` match (single-result fallback when the backend normalizes ids) and pass `deletedThreadIds` into the load guard so the row drops immediately instead of racing a full catalog rescan + continuity merge
- **Read directory detection**: `list_dir` / target directory / trailing-slash paths render folder icons and List labels correctly
- **Vendor settings first paint**: provider lists start in loading; CLI version cold load no longer flashes “not installed”

---

### **2026年8月8日（v0.8.4）**

中文：

这一版将应用升到 **0.8.4**，主线是「冷启动编排闭环、协作可解释、Composer 会话控制一体化」：冷启按 first-paint 契约限流重活、遮罩恢复自动关闭，可交互时间从 ~22s 收到 ~4.4s；协作链路补齐注入上下文 Header、上游摘要/全文喂料与批准补充说明；Composer 升级为 Session Control HUD（多供应商实时用量）+ 改文件 pill 对齐 git 统计；自定义模型可按供应商绑定写入 Claude/Codex；本地 HTML 直开内置浏览器。

✨ Features

- **自定义模型按供应商绑定**：模型管理弹窗前置供应商选择（本地配置 + 三方列表）；选三方双写 provider-owned customModels 与引擎 catalog，Claude/Codex 同一套 UX 与写盘语义；双写失败可见、per-engine 串行队列防并发丢模型
- **本地 HTML 内置浏览器打开**：HTML/HTM 文件统一走内置 Browser Agent（`file://`），覆盖内容区右键、文件树与 Git Changes 三入口；错误统一映射可读 i18n 文案，禁止原始英文技术串进 UI
- **Session Control HUD 与实时用量**：Composer 工具菜单改为双栏 HUD（宽度锚定输入框），复用会话概览同源额度链路；覆盖 Codex 官方 rate limit、Claude/Codex 绑定 DeepSeek/MiniMax/智谱 HTTP、Kimi CLI OAuth refresh；无公开额度 API 的供应商给出明确提示
- **协作上游喂料策略**：模板每环节可配 `upstreamFeedMode: summary | full`（首段默认 full，后续默认 summary）；Inspector 头展示吃全文/吃摘要徽章；修复 stageBindings 投影回放丢 mode 导致后续段永远缺省 summary
- **协作节点注入上下文 Header**：右侧 Inspector 新增可折叠注入区（折叠态一行摘要，展开态迷你流水线 + 内容清单/上下文溯源切换），分区展示用户任务/批准补充/上游/本环节指令；只读 projection，不伪造完整 worker prompt
- **批准补充说明**：「批准，后续自动执行」与打回对称，可附 note 写入 `SquadPlanApprovedFact` 并注入后续 stage prompt；统一操作条布局（主操作靠左、停止类靠右）；补齐 10 语言 multiAgent 文案
- **文件/选区发为输入引用**：FileView「发送到输入」（右键 + Alt+Shift+A）与文件树插入统一产出紧凑 `@path` / `@path#L…` chip（替代粘贴大段围栏代码块），外部写入后自动升格为 file chip
- **Shared Run Status Strip 数据源合成**：已编辑与子代理 pills 改为主时间线 ∪ agent-canvas ∪ 子会话合成，补 session side-effect ledger 与侧栏 child 保留

🔧 Improvements

- 将应用版本号提升到 `0.8.4`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐
- **冷启 first-paint 编排闭环**：冷启 ensure 默认 first-paint、禁止首进 full-catalog；gate-ready 仅认 first-paint-complete / home input-ready / force-enter；full-catalog 超时/降级后 60s 禁自动重扫；OpenCode 子源 3s 预算；遮罩恢复自动关闭（late ready + ≥8s 或 20s 顶强制进入）；诊断 dump 固定 firstPaintPresent/gateReadyReason 并支持一键复制；同机实测可交互 ~4.4s（基线假 ready ~22s）
- **改文件 pill 对齐 git**：行数统计叠加 `git status` 与工具产出，回合中实时更新；同路径多次改写取最新不累加；Revert 后签名级隐藏跨重挂载生效；新增 `@number-flow/react` 滚动数字动画
- **子代理观察面收敛**：主幕布退役 S10 小队卡片，子代理主表面统一为 Run Status Strip + 右侧 Inspector；subagent 工具行降级为普通 Generic 行保留审计痕迹
- **协作入口下移**：从发送按钮前移到输入框下方 branch-row 右侧，与上下文指示器对调
- **run-status 展开悬浮化**：tasks / subagents / plan / edits 详情面板改为绝对定位浮层，展开不再撑高 Strip 挤压消息列表；chat-input 圆角统一 12px
- **贴底滚动接管重写**：仅在真底部（≤1px）重新跟随，滚轮/键盘/拖拽意图才释放跟随，内容增长不再误判为用户离开；ResizeObserver 替代长定时复查；回合时长标签改紧凑 h/m/s

🐛 Fixes

- **切换工作区过期扫描放弃**：取消 soft-ignore 后不再继续 titles/shared/分页/多引擎 fan-out 与后台 gemini/kimi/grok 刷新，杜绝陈旧列表回写
- **误报错误 toast 抑制**：斜杠指令列表 soft-cancel（stale/cancelled）不再弹「命令列表不可用」；Shared 发送目标切走会话或 meta ENOENT 时静默，真失败仍提示
- **子代理 Strip 与详情链路**：Strip 可见性与 todo/plan/edit 铁律解耦（仅子代理也能挂载）；宽识别对齐 S10 `isSubagentTool` 口径并全引擎 seed；有可解析 sessionThreadId 时优先开幕布；子会话仅 user 时从父线补 assistant；过滤 tool JSON 信封
- **Shared Claude catalog 串台**：创建走有序 Provider 首项 + profile 权威 catalog（local forceRefresh / managed scoped），打开历史不再 reseed 过期 mapping；文案与图标同源，catalog runtime 优先于陈旧 localStorage；k3 短 id 映射 kimi 图标；空 catalog fail-closed
- **协作运行时左侧会话状态指示补齐**
- **注入上下文展开态保底高度**：短文案不再被侧栏 flex 布局挤扁，保留 max 上限与内滚动
- **Windows 侧栏补齐 Quick Switcher 与隐藏对话入口**（Ctrl+E；macOS 仍走 titlebar 不重复入口）
- **打包修复**：钉死 `@tauri-apps/plugin-dialog` 2.6.0 对齐 Cargo crate；清理阻塞 mac 打包的 TypeScript 类型错误

English:

This release moves the app to **0.8.4**. The headline is a closed-loop cold-start orchestration, explainable collaboration, and a consolidated Composer session-control surface: cold starts now follow a first-paint contract with throttled heavy work and an auto-dismissing gate (interactive at ~4.4s vs a fake-ready ~22s baseline); the collab chain gains an injection-context header, per-stage summary/full upstream feeding, and approval notes; Composer becomes a Session Control HUD with multi-provider live quota plus a git-aligned edited-files pill; custom models bind per provider into Claude/Codex; local HTML opens in the built-in browser.

✨ Features

- **Provider-bound custom models**: the model manager dialog now picks a provider first (local config + third-party list); third-party selection dual-writes provider-owned customModels and the engine catalog with one shared UX for Claude/Codex; dual-write failures surface and per-engine serial queues prevent concurrent loss
- **Open local HTML in the built-in browser**: HTML/HTM files route to the internal Browser Agent (`file://`) across the content context menu, file tree, and Git Changes entries; errors map to readable i18n copy instead of raw technical strings
- **Session Control HUD with live quota**: the Composer tool menu becomes a two-column HUD anchored to the input width, reusing the session-overview quota pipeline; covers Codex official rate limits, Claude/Codex bound to DeepSeek/MiniMax/Zhipu HTTP, and Kimi CLI OAuth refresh; providers without a public quota API get an explicit notice
- **Collab upstream feed strategy**: templates configure `upstreamFeedMode: summary | full` per stage (first stage defaults to full, later stages to summary); the Inspector header shows full/summary badges; fixes stageBindings replay dropping the mode so later stages always fell back to summary
- **Collab node injection-context header**: the right Inspector gains a collapsible injection section (one-line summary collapsed; mini pipeline plus content-list/context-source toggle expanded) with partitions for user task / approval note / upstream / stage instructions; read-only projection, no fabricated worker prompt
- **Approval with notes**: “approve and continue” is now symmetric with reject—an optional note is written into `SquadPlanApprovedFact` and injected into later stage prompts; unified action-bar layout (primary actions left, stop actions right); full multiAgent copy for all 10 locales
- **File/selection-to-input references**: FileView “Send to input” (context menu + Alt+Shift+A) and file-tree inserts emit compact `@path` / `@path#L…` chips instead of pasting large fenced code blocks; external writes are promoted to file chips automatically
- **Shared Run Status Strip synthesis**: edited-files and subagent pills now merge the main timeline ∪ agent-canvas ∪ child sessions, with a session side-effect ledger and sidebar child retention

🔧 Improvements

- Bump the app version to `0.8.4` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata
- **Cold-start first-paint orchestration closed loop**: cold-start ensure defaults to first-paint and never enters full-catalog first; gate-ready only accepts first-paint-complete / home input-ready / force-enter; 60s auto-rescan cooldown after full-catalog timeout/degradation; 3s budget for the OpenCode sub-source; the gate overlay auto-dismisses again (late ready + ≥8s, or force-enter at the 20s ceiling); diagnostic dumps pin firstPaintPresent/gateReadyReason with one-click copy; measured interactive at ~4.4s vs a fake-ready ~22s baseline on the same machine
- **Git-aligned edit pill**: line counts overlay `git status` with tool-derived paths and update mid-turn; repeated edits to one path keep the latest stats instead of summing; revert hides rows by signature across remounts; adds `@number-flow/react` odometer animation
- **Subagent surface consolidation**: the main canvas retires the S10 squad cards; the Strip plus right Inspector are now the single subagent surface; subagent tool rows degrade to plain Generic rows to keep audit trails
- **Collab entry relocation**: moved from beside the send button to the trailing side of the branch-row below the input, swapped with the context indicator
- **Floating run-status panels**: tasks / subagents / plan / edits detail panels use absolute overlay positioning so expanding them no longer grows the strip or squeezes the message list; chat-input border-radius unified to 12px
- **Stick-to-bottom rewrite**: follow re-arms only at the true bottom (≤1px) and releases only on wheel/key/drag intent; content growth no longer reads as the user leaving; ResizeObserver replaces long timer rechecks; turn-duration labels switch to compact h/m/s

🐛 Fixes

- **Abandon stale scans after workspace switch**: after soft-ignore, no more titles/shared/pagination/multi-engine fan-out or background gemini/kimi/grok refreshes, so stale lists never write back
- **Suppress false error toasts**: slash-command list soft-cancels (stale/cancelled) no longer raise “command list unavailable”; Shared send targets stay silent on thread switch or meta ENOENT while real failures still toast
- **Subagent Strip and detail chain**: Strip visibility decouples from the todo/plan/edit rule (subagent-only activity mounts it); wide recognition aligns with the S10 `isSubagentTool` contract and seeds all engines; a resolvable sessionThreadId opens the canvas ahead of launch acks; child sessions with only user messages backfill assistant output from the parent; tool JSON envelopes are filtered out
- **Shared Claude catalog cross-talk**: creation uses the first ordered provider plus the profile-authoritative catalog (local forceRefresh / managed scoped), history opens no longer reseed stale mappings; label and icon resolve from the same source with catalog runtime ahead of stale localStorage; k3 short ids map to the Kimi icon; empty catalogs fail closed
- **Collab runtime sidebar status indicator restored**
- **Injection-context minimum height**: short content no longer gets crushed by the sidebar flex layout, keeping the max cap and inner scrolling
- **Windows sidebar gains Quick Switcher and hidden-conversations entry** (Ctrl+E; macOS keeps the titlebar path without duplication)
- **Packaging fixes**: pin `@tauri-apps/plugin-dialog` to 2.6.0 to match the Cargo crate; clear the TypeScript type errors that blocked macOS packaging

---

### **2026年8月7日（v0.8.3）**

中文：

这一版将应用升到 **0.8.3**，主线是「Shared 多 CLI 协作可日常用、冷启动不再假死、运行态与恢复出口更清晰」：Shared Session 内按模板串行驱动 plan / implement / review 等多引擎节点；桌面全平台启动门控挡住 hydrate 窗口期误点；Composer 用常驻 run-status 条替代旧状态坞；卡住会话有可完成恢复出口；终端与「在资源管理器中显示」等日常路径一并压实。

✨ Features

- **Shared 多 CLI 协作编排（阶段交付）**：在 Shared Session 内按模板串行驱动多 CLI 节点（每段可独立 CLI·供应商绑定）；主幕 sticky 编排卡 + 历史轮折叠卡，右栏节点 Inspector 直播/精读；Composer「协作 · 模板」入口，支持内置/自定义模板与页内模板管理；协作中锁定普通发送，强制停止后可恢复对话
- **协作 Context Fan-in**：图 / skill / 记忆 / 便签进入首段（stages[0]），后续段仅文字接力；修复协作 drive 静默丢图；skill 注入 SKILL.md 正文；智能体 persona 叠入 worker prompt；首段可纯图
- **节点恢复**：强制停止解锁、整轮重试、单节点重试（`shared_agent_retry_stage`）；livePhase 与归档正文择优；完成态主幕仅短汇总
- **Composer Run Status 条**：输入框上方常驻 pills（todos / 子代理 / plan / 本轮改文件），可展开详情；默认隐藏旧 status-panel 坞开关；引擎共用同一条路径
- **改文件面板可确认还原**：`TurnFilesChangedCard` 支持单文件 / 全部 Revert，经 ConfirmDialog 后走 git restore；成功后乐观隐藏，全清则卸载卡片

🔧 Improvements

- 将应用版本号提升到 `0.8.3`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐
- **启动门控（全桌面 Tauri）**：冷启动 full-catalog hydrate 期间显示全局遮罩，避免点击侧栏/按钮必现假死；自动关闭：`startup-gate-ready`（或 home 仅 input-ready）且至少展示 8s，20s 绝对天花板；约 10s 出现「直接进入」强关；强关/天花板走 force-enter + 取消排队重扫，不 stamp gate-ready
- **uiScale 冷启动延后**：始终先 apply(1)；任意 `uiScale ≠ 1` 延后到 gate-ready、force-enter+2s 或 12s 天花板；**不改写** `settings.json`
- 列表 first-paint 轻量出屏、full-catalog 后置；orchestrator 收紧并发并 cancel 旧扫
- Shared 恢复条改为单行折叠：自动处理 + 跳过本轮 + 详情 + 高级；确认改用应用内 ConfirmDialog（禁止 `window.confirm`）；错误 toast 按动作分流
- 终端滚动条对齐全局细条：默认隐藏 thumb，hover/focus 再显现，暗色终端不再常亮一条亮轨

🐛 Fixes

- **冷启动点击假死（Win/Mac 同路径）**：hydrate 占满主线程/IPC 时误点必卡；门控 + force-enter 与 hydrate fallback 认 `stale`/`cancelled`，避免强关后仍 publish/重扫
- **协作 worker 侧栏泄漏**：隐藏 MOSSX 控制面 / collab worker 下崽（含截断半截 `MOSSX_*`、SUMMARY、管线碎片、改名 Agent N 等）；不单凭 Agent N 误杀用户真会话；realtime hide registry 与 catalog 双闸
- **右栏 Inspector 串台**：LIVE/settle 按 run+stage+attempt 隔离；空 LIVE 不顶出上一节点；徽章补齐 reasoningEffort
- 设置菜单与 pin 上的运行时通知恢复 error 图标（idle 勾 / has-error 告警），与 dock 气泡态一致
- 终端 `refreshTerminal` 不再抢键盘焦点，输入中主题/外观同步不会把焦点拽走
- 终端同 commit 宿主切换（聊天 ↔ 扩展）时正确 dispose + reattach，避免空白白屏
- 「在资源管理器/访达中显示」改走原生 `reveal_in_file_manager`（Win Explorer `/select`、macOS `open -R` 等），修复 plugin-opener 在 Windows 上静默失败；Windows 路径强制反斜杠
- 回合结束后消息列表 stick-to-bottom：清理过期 boundary intent，并观察 scroller 高度收缩（如 status strip 出现）时重新钉底

English:

This release moves the app to **0.8.3**. The headline is multi-CLI collaboration you can actually use daily in Shared sessions, cold starts that stay click-safe, and clearer run-time / recovery surfaces: Shared Session drives plan / implement / review nodes serially from templates; a desktop-wide startup gate blocks mis-clicks during hydrate; Composer shows a persistent run-status strip instead of the old status dock; stuck sessions get a finishable recovery exit; terminal and “Reveal in …” paths get hardened along the way.

✨ Features

- **Shared multi-CLI collaboration (phase delivery)**: serially drive multi-CLI stages in a Shared Session (per-stage CLI/provider bindings); sticky orchestration card + foldable history on the main canvas, live/read Inspector on the right; Composer “Collaboration · template” entry with built-in/custom templates and in-page template management; lock ordinary send while collaborating, unlock after force-stop
- **Context Fan-in**: images / skills / memory / notes inject only into stages[0]; later stages relay user-visible text; fix silent image drop on collab drive; inject SKILL.md body; stack persona into worker prompts; pure-image first stage allowed
- **Node recovery**: force-stop unlock, whole-run retry, single-node retry (`shared_agent_retry_stage`); livePhase merge + prefer longer archived body; main canvas keeps short final summaries only
- **Composer Run Status strip**: persistent pills above the input (todos / subagents / plan / session file edits) with expandable detail; legacy status-panel toggle hidden by default; engines share one strip path
- **Confirmable file revert in edited-files panel**: per-file and “Revert all” via ConfirmDialog into existing git restore hooks; optimistic hide on success; card unmounts after full clear

🔧 Improvements

- Bump the app version to `0.8.3` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata
- **Startup gate (all desktop Tauri)**: global overlay during cold-start full-catalog hydrate so sidebar/button clicks do not freeze the UI; auto-dismiss on `startup-gate-ready` (or home input-ready only) after ≥8s shown, 20s hard ceiling; “Enter now” force-enter ~10s; force/ceiling cancel queued rescan without stamping gate-ready
- **Deferred uiScale**: always apply `1` first; any non-identity scale waits until gate-ready, force-enter+2s, or a 12s ceiling; **never rewrites** `settings.json`
- Lighter first-paint list fetch with deferred full-catalog; orchestrator tighter concurrency and cancel of stale scans
- Shared recovery bar collapses to one row: auto-handle + skip turn + details + advanced; in-app ConfirmDialog only (no `window.confirm`); error toasts split by action
- Terminal scrollbar matches global thin hover-reveal tokens so dark terminals no longer show a permanent bright track

🐛 Fixes

- **Cold-start click freezes (Windows and macOS)**: mis-clicks during hydrate no longer hard-lock; gate + force-enter treat hydrate fallback as `stale`/`cancelled` so force-enter does not republish or reschedule
- **Collab worker sidebar leaks**: hide MOSSX control-plane / collab worker spawns (truncated `MOSSX_*`, SUMMARY titles, pipeline fragments, renamed Agent N, etc.); never delete real user threads on Agent N alone; realtime hide registry + catalog dual gates
- **Inspector cross-talk**: LIVE/settle isolated by run+stage+attempt; empty LIVE does not surface prior node; badges include reasoningEffort
- Restored runtime-notice error icons on settings menu item and pin (idle check vs has-error alert), aligned with the dock bubble
- `refreshTerminal` no longer steals keyboard focus during theme/appearance sync
- Terminal host swap in one React commit (chat ↔ extensions) correctly disposes and reattaches instead of a blank panel
- “Reveal in Explorer/Finder” goes through native `reveal_in_file_manager` (Explorer `/select`, macOS `open -R`, …), fixing silent Windows failures from plugin-opener; Windows paths force backslashes
- Stick-to-bottom after turn settle: clear expired boundary intent and re-pin when the scroller height shrinks (e.g. status strip appears) without a scroll event

---

### **2026年8月6日（v0.8.2）**

中文：

这一版将应用升到 **0.8.2**，主线是「界面缩放全平台不再假死、坏缩放可自救」：macOS / Linux 与 Windows 一样不再对 WebView 使用 `uiScale ≠ 1` 的 native zoom；统一走 CSS `transform: scale()`，并加上启动 guard——上次缩放把渲染打挂时，下次启动临时回退 100%，**不改写**用户已保存的偏好，避免进不了设置页的锁死循环。

🔧 Improvements

- 将应用版本号提升到 `0.8.2`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），与本补丁发版元数据对齐

🐛 Fixes

- 修复全平台 native WebView zoom 假死（Windows WebView2 已证实；macOS WKWebView `setPageZoom` 在 2026-08-06 现场同样复现）：所有平台的 `uiScale` 仅通过 CSS `transform: scale()` + body `100/scale%` 布局补偿应用；native `setZoom` 每会话只钉死为 `1` 一次以清除旧构建残留，**禁止**再调用 `≠ 1`
- 新增 `uiScaleStartupGuard`：应用 `uiScale ≠ 1` 时写入 pending 标记，约 8s + rAF 证明绘制链路健康后清除；若标记残留，下一会话仅临时强制 100% 并弹出运行时提示，**从不改写** `settings.json` 里的用户缩放偏好，用户可自行改回或留在安全值

English:

This release moves the app to **0.8.2**. The headline is interface scaling that no longer freezes the renderer on any platform, with self-recovery when a bad scale bricks a session: macOS / Linux join Windows in never applying `uiScale ≠ 1` via native WebView zoom; everything uses CSS `transform: scale()`, plus a startup guard that temporarily falls back to 100% on the next launch when the previous scale hung the paint pipeline—**without rewriting** the user's saved preference, so Settings remains reachable.

🔧 Improvements

- Bump the app version to `0.8.2` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship matches SemVer and packaging metadata

🐛 Fixes

- Fixed native WebView zoom freezes on all platforms (WebView2 already confirmed on Windows; macOS WKWebView `setPageZoom` reproduced in the field on 2026-08-06): apply `uiScale` everywhere through CSS `transform: scale()` plus body `100/scale%` layout compensation; pin native `setZoom` to `1` once per session to clear residual zoom from older builds, and **never** call native zoom at a non-identity factor
- Added `uiScaleStartupGuard`: write a pending mark when applying `uiScale ≠ 1`, clear it after ~8s + rAF proves the paint pipeline is alive; a leftover mark forces temporary 100% for the next session only and shows a runtime notice, **without rewriting** the stored user scale so a lockout loop is breakable without hand-editing settings

---

### **2026年8月5日（v0.8.1）**

中文：

这一版将应用升到 **0.8.1**，主线是「Windows 缩放铺满、关窗可确认、单行代码可复制」：Windows 在 CSS 缩放后不再留黑边，主窗点 X 先二次确认再退出，消息 / Spec Hub 里单行围栏代码块也有复制按钮。

✨ Features

- Windows 主窗关闭二次确认：点右上角 X 弹出应用内 AlertDialog（非系统对话框），确认后才关闭；连点不叠层，关闭失败可观测；不改动 macOS hide-on-close、菜单退出与 Alt+F4
- 单行围栏代码块复制：消息与 Spec Hub 中单行 fenced code 与多行块对齐，始终显示复制按钮（纯文本 / 带围栏两种），无语言头、无行号，布局用右上角定位与右侧内边距避免压住代码

🔧 Improvements

- 将应用版本号提升到 `0.8.1`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），为 patch 发版对齐 SemVer 与打包元数据

🐛 Fixes

- 修复 Windows `uiScale ≠ 1` 时 CSS `zoom` 无法铺满视口留下黑边：改为 body `transform: scale()` + `100/scale%` 尺寸补偿填满 WebView2 视口；当时 macOS / Linux 仍走 native `setZoom` 并清理残留 CSS（全平台统一 CSS 缩放见 v0.8.2）

English:

This release moves the app to **0.8.1**. The headline is Windows scaling that fills the viewport, a confirm step before closing the main window, and copy controls on single-line code fences: Windows no longer leaves black bars after CSS scale, the main-window X asks once in-app before quit, and one-liner fenced blocks in chat / Spec Hub gain the same copy control as multi-line blocks.

✨ Features

- Windows main-window close confirmation: clicking the top-right X opens an in-app AlertDialog (not a system sheet) and only closes after confirm; rapid clicks do not stack dialogs; close failures are observable; macOS hide-on-close, menu Quit, and Alt+F4 are unchanged
- Single-line fenced code copy: message and Spec Hub one-liner fences match multi-line blocks with an always-visible copy control (plain value and fenced value); no language header or line numbers; top-right action positioning and right padding keep code from sitting under the button

🔧 Improvements

- Bump the app version to `0.8.1` across frontend package metadata, the lockfile, and Tauri bundle configuration so this patch ship aligns SemVer and packaging metadata

🐛 Fixes

- Fixed Windows black bars when `uiScale ≠ 1`: CSS `zoom` could not fill the WebView2 viewport, so scaling moved to body `transform: scale()` plus `100/scale%` size compensation; macOS / Linux still used native `setZoom` and cleared residual CSS at that point (full-platform CSS-only scale lands in v0.8.2)

---

### **2026年8月5日（v0.8.0）**

中文：

这一版将产品线升到 **0.8.0**，主线是「侧栏列表真就绪、Windows 冷启动可交互、额度与输入反馈补齐」：侧栏 hydration / 冷启动竞态与永久「加载中…」一并收口，Windows 在 `uiScale ≠ 1` 时不再因 WebView2 假死，DeepSeek 余额进会话概览，`$` skill 选中后 ContextBar 重新有 chip，并继续压 Messages 空集合 thrash 导致的 React #185。

🔧 Improvements

- 将应用版本号提升到 `0.8.0`（`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json`），为 minor 发版对齐 SemVer 与打包元数据
- 会话列表首屏拉取收紧为 5 条（对齐默认可见根预算），「加载更早」与恢复路径仍用更大分页（50/100），冷启动更轻、历史仍可按需拉
- 检查更新 `check()` 增加 15s 超时：更新源不可达时不再永久停在「正在检查更新…」，超时按失败收敛为 idle

🐛 Fixes

- 修复侧栏会话列表 hydration 完成后仍卡在「加载中…」：`hydratedThreadListWorkspaceIds` 改为发布新的 Set 身份（禁止原地 mutate 共享 Set），使 `memo(Sidebar)` 在完成 / 超时后能重渲染；AppShell 域上下文透传 state 快照；`listThreadTitles` / `listSharedSessions` 拉取加超时，避免超时后列表路径长期半完成
- 修复冷启动侧栏 hydration 竞态：`activeWorkspaceId` 早于 `workspacesById` 就绪时不再永久跳过列表加载；有缓存时先展示快照；未连接工作区显示空态而非永久转圈
- 修复 Windows 冷启动在 `uiScale ≠ 1`（常见 0.8）时 WebView2 渲染假死：Windows 改走 CSS `zoom`，native `setZoom` 仅钉死为 1 一次；macOS / Linux 仍用 native `setZoom(uiScale)`；并强制顶栏工具 / 右侧工具栏默认可见，一次性迁移展开历史默认折叠的右侧面板
- 对接 DeepSeek 官方余额查询：Codex / Claude 绑定 `api.deepseek.com` 时不再报「base_url not a known coding-plan host」；会话概览以货币余额卡片展示（多币种 / 总额 / 赠送 / 充值），成功时不回落 Codex rateLimits；Native / Shared 共用同一 command
- 恢复 `$` skill / commons 选中后的 ContextBar chips：选中后可见可 × 移除，仅 skill 时外层 toolbar 也会显示，避免「选了却看不到」
- 继续收敛 React #185：layout 写入 `activeCanvasSnapshot` 前稳定空列表与成员引用，避免 `?? []` / `filter` 新数组击穿顶层 shallowEqual；Messages / finalizing / note-capture 做 pre-dispatch 等价值短路

English:

This release moves the product line to **0.8.0**. The headline is a sidebar list that truly becomes ready, Windows cold starts that stay interactive, and quota / input feedback that no longer go missing: hydration races and permanent "Loading…" are closed, Windows no longer freezes when `uiScale ≠ 1`, DeepSeek balance lands in Session Overview, `$` skill selection shows ContextBar chips again, and Messages empty-collection thrash behind React #185 is tightened further.

🔧 Improvements

- Bump the app version to `0.8.0` across frontend package metadata, the lockfile, and Tauri bundle configuration so this minor ship aligns SemVer and packaging metadata
- Shrink first-paint thread list / session catalog fetches to 5 items (aligned with the default visible root budget); "Load older" and recovery keep larger pages (50/100) so cold start is cheaper while history still loads on demand
- Wrap the updater plugin `check()` in a 15s timeout so an unreachable update server no longer leaves the toast stuck on "Checking for updates…"; timeout is treated as failure and non-interactive flows return to idle

🐛 Fixes

- Fixed the sidebar thread list stuck on "Loading…" after hydration: `hydratedThreadListWorkspaceIds` now publishes a new Set identity instead of mutating a shared Set in place, so `memo(Sidebar)` re-renders on complete / timeout; AppShell domain contexts pass the state snapshot; `listThreadTitles` / `listSharedSessions` fetches are wrapped with a timeout so a hang no longer leaves partial hydration unresolved
- Fixed the cold-start sidebar hydration race: auto-hydrate no longer permanently skips list load when `activeWorkspaceId` resolves before `workspacesById`; cached / snapshot threads show immediately; disconnected workspaces get an empty state instead of a forever spinner
- Fixed Windows cold-start freezes when `uiScale ≠ 1` (often 0.8): Windows applies CSS `zoom` and pins native `setZoom` to 1 once; macOS / Linux keep native `setZoom(uiScale)`; essential top-tool and right-toolbar chrome stay visible by default, with a one-shot migration that expands a historically collapsed right panel
- Wired DeepSeek official balance queries: binding Codex / Claude to `api.deepseek.com` no longer fails with "base_url not a known coding-plan host"; Session Overview shows a currency balance card (multi-currency / total / granted / topped-up) and does not fall back to Codex rateLimits on success; Native and Shared share the same command
- Restored ContextBar chips for `$` skill / commons selection so picks stay visible and removable; the outer toolbar also shows when only skill chips are present
- More React #185 hardening: stabilize empty lists and member references before writing `activeCanvasSnapshot` so `?? []` / `filter` no longer break top-level shallowequal; Messages / finalizing / note-capture short-circuit equivalent pre-dispatch writes

---

### **2026年8月4日（v0.7.16）**

中文：

这一版的主菜是「Git 历史看得清、设置钉上手、会话归属与 Shared / 子代理更稳」：Git Graph 仍在底部 half-dock（可拖高），内部接上多泳道提交图并加宽提交列，侧栏设置可 pin、工作区可右键改分组，应用图标可换肤并全平台品牌刷新，Git 变更支持批量 unstage / 丢弃，Claude 后台 Shell 不再被 5 秒宽限误杀；空工作区不再串入外项目历史，首页引擎 / 模型选择可持久恢复，Shared 续接 / 附图 / 思考档位与子代理卡状态一并压实。

✨ Features

- Git Graph 工作台更密：底部 half-dock 历史面板保留可拖拽调高；面板内三列默认比例改为 4:11:5，提交列表更宽、信息更好读
- 多泳道提交图：按拓扑分配 lane，合并 / 旁支 / 穿越边可见；提供 Spine（仅 first-parent）与 Denoise（隐藏默认 trellis session-record 并改写 parent 保持连续）开关；作者头像、upstream-aware 的 ahead/behind tooltip、变更文件 flat/tree 与主 Git Diff 面板同步
- 侧栏设置 pin：锁屏 / Spec Hub / 项目记忆 / Git 历史 / 运行时通知可在设置菜单项旁勾选 pin，在齿轮旁生成一键图标按钮；最多 2 个并持久化到 clientStorage，未知 id 自动过滤，超限后禁用继续 pin 并给出中英提示
- 工作区项目分组：侧栏工作区右键菜单新增「更改项目分组」，可直接分配到已有分组或取消分组，无需进入设置 → 项目管理（仅主工作区；worktree 继承父分组）
- 应用图标换肤：外观设置新增 Dock / 任务栏图标选择，默认 logo 与 orbit-routing 系列方案可切换；macOS 更新 Dock，Windows / Linux 更新各窗口图标，并联动 About 页与锁屏 logo；带 PNG 校验、快速切换竞态保护与次级窗口重应用
- Git 批量写操作：变更面板支持一键 unstage 全部、unstage 选中路径、批量丢弃多个未暂存文件，一次后端调用替代逐个 IPC 循环；rename / copy 对在 restore / clean 前展开路径，与单文件语义对齐；多仓库视图、worktree 历史与远程 daemon 转发同步接入，单文件操作保留为回退
- 品牌图标全面刷新：桌面（含 Windows Store 方块 logo）、Web、iOS AppIcon、Android launcher 全套换为新品牌图，安装包与各 UI 表面视觉统一

🔧 Improvements

- 文件树右键菜单补齐 Lucide 图标（git / 新建 / 复制 / LSP / 删除等），删除项走 danger 样式并加分隔，扫读更快
- 右键菜单贴系统习惯：优先在光标右下展开；空间不足时整块翻到上方或左侧（对齐 Finder / VS Code），再 clamp 进视口，首帧即按估算位置落点
- Git History 筛选与选择器：项目 / 分支切换改用 Command + Popover；分支筛选前置，图开关与清除联动；密集状态 chip 的 tooltip 近乎即时
- 子代理身份更干净：小队卡与 inspector 不再套贡献者人格头像，统一 i18n「子代理」标签，并行实例仅用序号区分
- 子代理完成表面统一为 S10 小队卡：旧 Claude Agent session 卡退役，终态 / result / output-file 迁入小队卡与 inspector；合成 spawn 进 process-phase 折叠，避免 chip 外侧回钉
- diff 行内密集按钮的 tooltip 换成 FloatingTooltipButton（body portal + flip），不再被 overflow 裁切，并保留高对比 CSS 回退
- Shared 队列已发送等待 ACK 时显示「已发送，确认中（防重复）」，不再误读为仍在排队；防双发出队逻辑不变
- 文档治理：OpenSpec 三波归档 64 个已落地提案并同步 main specs；新增文档生命周期规范、新 CLI 接入 A~H 全量注册点核对矩阵、Native vs Shared CLI 产品口径说明文档

🐛 Fixes

- 修复 Claude 后台 Shell / PowerShell 任务被 5 秒宽限误杀（issue #983）：stream 携带结构化 backgroundTaskId 时进入 WaitBgTasks 等待任务终态，期间禁止 grace tree-kill；任务清空后重新武装完整 5s 宽限（禁止 remaining=0 秒杀），Unix killpg / Windows taskkill 不再误杀合法后台任务与 MCP / Stop-hook 管道
- 修复空 / 新建工作区串入外项目会话历史：OpenCode 改用 JSON 列表并按 `directory` 归属过滤；Claude 以 transcript `cwd` 为权威并失效旧缓存（scanner v5），收紧 CJK 编码路径前缀匹配；Gemini / Grok / Kimi 改为一向 ownership（会话路径须为工作区或其子路径），去掉反向 home 匹配，避免 Desktop 中文空文件夹继承 `$HOME` 下无关历史
- 修复首页创建会话时 Grok / Kimi / OpenCode 等 Atomic 引擎闭合选择器长期停在「选择模型」：为全部 Atomic 引擎播种默认 ExecutionTarget（catalog 优先，空 catalog 时用 selectedModelId 合成），Shared 会话不自动 seed，避免跨会话污染
- 修复首页 CLI 选择器与全局引擎不同步、重启后回落 Claude：home picker 变更会 publish 全局 engine；外部 restore / 回首页时丢弃 sticky creation target；首屏从 clientStorage 恢复上次引擎，避免先闪 Claude 再纠正
- 收敛 Native 与 Shared 的 assistant 重复渲染：单气泡内 early-body 回显折叠；跨 itemId 的等价 complete / history upsert 统一收敛，短开场不误粘、文末短复述不误删
- 修复子代理状态长期「运行中」、inspector 打开后不刷新：旁路加载的子会话 transcript 经 probe store 补洞并 re-enrich 小队卡 / StatusPanel，终态直推已打开抽屉
- 修复 Shared 用户附图双气泡与刷新丢图：TurnRequested 写入 image_refs，投影与 dataSource 透传 images，optimistic / history 合并保图
- 修复 Shared 上下文续接 integrity：binding 增加 nativeContextTrust；503 / 失联后 needs-history 强制 rematerialize，避免只发短指令丢原任务
- 阻断 Shared 初始化与 Atomic 模型思考档位污染：create-session / 跨引擎切换按目标 CLI capability 播种与收敛 options / effort，不再借用全局 Native Codex 档位；send 边界二次 reconcile
- 阻断 Composer rewind reset 更新环，避免回退重置在 extract / shell 写回之间打转
- 修复 Git Graph 在作者 / 搜索 / 日期过滤下出现无节点幻影泳道：稀疏列表压缩缺失 parent；作者筛选激活时隐藏冗余作者 chip
- 修复 Create PR 弹层内 base / compare 等下拉被 backdrop 挡住：Popover z-index 抬到 80，高于 PR 遮罩
- 手动刷新 Git 状态时清除过期的 commit / push / sync 错误横幅，可恢复故障后不必整应用重载
- 继续收敛 React #185 白屏：Composer extract effect 切断 selectedInlineFileReferences 自订阅、target 等价时跳过壳写；canvas store 快照门闩与 selector 缓存、useModels 跨 epoch storm 熔断、session reload 稳定回调
- 修复 Shared 侧栏异步刷新复用 stale hide set 导致原生会话泄漏：Grok / Kimi / Gemini 刷新改用 fresh hide set 重建，merge 与 final 闸门剔除已泄漏的 Shared-owned 行，hide set 拉取失败时取并集不放宽
- 闭环 Shared 恢复出口：补齐 Probe / Stop / 停止并重建 / 放弃本轮；force-stop 先读 settled 再 remove，修复 abandon 竞态；融合禁用原因可解释
- Shared 模型选择以 ExecutionTarget 快照为展示权威，闭合态不再依赖 catalog 命中或全局 selectedModelId，Native 保留全局回落契约
- Codex collab 子代理实时 wait 阶段用子会话树兜底幕布小队与 Status Agents，补齐 live receiver 字段抽取与 synthetic / 真实 spawn 去重，live 与 history 呈现对齐
- 相邻思考块不再被幕布外隐藏的 shell 工具切成多张思考卡片：resolveVisibleMessageItems 先过滤隐藏进程工具再合并，live 与完成后展开的时间线逻辑一致；可见文件工具仍会正确打断思考段
- 修复 dockIcon 与 activeCanvasStore 测试在 strict 下被推断为 never 导致的 tsc 构建失败（曾阻断 mac-arm64 打包）
- 修复多工具回合 settle 后助手结论文本偶发跑到工具卡前面的问题：reducer 在 `resetAgentSegment` 后通过 `findAssistantMessageIndexForLiveSettlement`（append/complete 双模式）解析正确 segment，禁止终稿并回工具前气泡；同时补上 late tool 插入与重排逻辑确保工具与结论的相对位置在 settle 后与 history 一致，不再依赖「重开会话」恢复正确顺序

English:

The headline of this release is a readable Git history, pinned settings, and steadier workspace ownership plus Shared / subagent surfaces: Git Graph stays a bottom half-dock (resizable height) with a multi-lane commit graph and a wider commit column, sidebar actions pin next to the gear and workspaces can be regrouped from the context menu, the app icon is switchable with a full brand refresh, the changes panel gains bulk unstage / discard, Claude background shell tasks survive the 5-second grace; empty workspaces no longer inherit foreign session history, the home engine / model picker restores across restarts, and Shared resume / attachments / reasoning plus subagent card status get hardened.

✨ Features

- Denser Git Graph workbench: the history panel remains a bottom half-dock with a drag resize handle; the in-panel three-column default ratio becomes 4:11:5 so the commit list is wider and messages stay readable
- Multi-lane commit graph: topology-aware lanes with merge / side-branch / pass-through edges; Spine (first-parent only) and Denoise (hide default trellis session-record commits and rewrite parents so the graph stays continuous); author avatars, upstream-aware ahead/behind tooltips, and changed-files flat/tree mode shared with the main Git Diff panel
- Pinned sidebar settings: lock screen, Spec Hub, project memory, git history, and runtime notice can be pinned from the settings menu to one-click icon buttons beside the gear; max 2, persisted in client storage, unknown ids filtered, further pins disabled with accessible en/zh tooltip copy
- Workspace project groups: the workspace actions menu gains "Change project group" so a main workspace can be assigned to an existing group or ungrouped without opening Settings → Project Management (worktrees inherit the parent group)
- App icon skinning: appearance settings now offer a Dock / taskbar icon picker — default logo or the orbit-routing set; macOS updates the Dock, Windows / Linux update per-window icons, with the About page and lock screen logo in sync; PNG validation, rapid-switch race protection, and secondary-window reapply included
- Bulk Git write operations: unstage all, unstage selected paths, and discard multiple unstaged paths in one backend call instead of per-path IPC loops; rename/copy pairs are expanded before restore/clean to match single-file semantics; multi-repo views, worktree history, and remote daemon forwarding wired in, with single-file actions kept as fallback
- Full brand icon refresh: desktop (including Windows Store square logos), web, iOS AppIcon, and Android launcher sets all updated to the new artwork for consistent installs and UI surfaces

🔧 Improvements

- File-tree context menus gain Lucide icons (git, new file, copy, LSP, delete, etc.) with a danger style and separator on delete for faster scanning
- Context menus follow OS habit: prefer open below-right of the cursor; when space is tight, flip wholesale above or left (Finder / VS Code style), then clamp into the viewport, with an estimated first-paint position
- Git History filters and pickers: project / branch switchers move to Command + Popover; branch filter leads, graph toggles clear together; dense status-chip tooltips are near-instant
- Cleaner subagent identity: squad cards and the inspector no longer reuse contributor personas — a fixed i18n "Subagent" label plus index labels for parallel instances
- Unified subagent completion surface on S10 squad cards: legacy Claude Agent session cards retire; terminal / result / output-file move into the squad card and inspector; synthetic spawns join process-phase collapse so they no longer re-pin outside the chip
- Dense diff-row action tooltips switch to FloatingTooltipButton (body portal + flip) so they are no longer clipped by overflow, with a high-contrast CSS fallback
- Shared queue shows "sent, awaiting ACK (duplicate-safe)" while waiting for acknowledgement instead of looking still queued; dequeue logic unchanged
- Documentation governance: three OpenSpec archive waves moved 64 shipped proposals into the archive with main specs synced; new doc-lifecycle rules, an A–H full registration-point checklist for onboarding new CLIs, and a Native vs Shared CLI product explainer

🐛 Fixes

- Fixed Claude background Shell / PowerShell tasks being killed by the 5-second grace (issue #983): when the stream carries a structured backgroundTaskId the reader enters WaitBgTasks and waits for task terminal states with grace tree-kill disabled; once tasks drain, the full 5s grace re-arms (no remaining=0 instant kill), so Unix killpg / Windows taskkill no longer kill legitimate background tasks or MCP / Stop-hook pipelines
- Fixed empty / newly created workspaces inheriting foreign session history: OpenCode lists sessions as JSON and filters by `directory` ownership; Claude treats transcript `cwd` as authoritative and invalidates old caches (scanner v5), with tighter CJK encoded-path prefix matching; Gemini / Grok / Kimi use one-way ownership (session path must be the workspace or a child) and drop reverse home matching so Chinese Desktop empty folders no longer inherit unrelated `$HOME` history
- Fixed the home create-session closed picker stuck on "select model" for Atomic engines such as Grok / Kimi / OpenCode: seed a default ExecutionTarget for every Atomic engine (catalog preferred; synthesize from selectedModelId when the catalog is empty); Shared sessions never auto-seed to avoid cross-session contamination
- Fixed the home CLI picker drifting from the global engine and falling back to Claude after restart: choosing an engine on the home picker publishes the global selection; external restore / return-to-home drops the sticky creation target; first paint restores the last engine from client storage so Claude no longer flashes first
- Converged Native and Shared assistant duplicate rendering: fold early-body echo inside a single bubble; converge equivalent complete / history upserts across item ids without gluing short openers or dropping short trailing restatements
- Fixed subagent rows stuck on "running" and inspectors that never refreshed after open: bypass-loaded child transcripts feed a probe store that re-enriches squad cards / StatusPanel and pushes terminal status into the open drawer
- Fixed Shared user attachment double-bubbles and images lost on reload: TurnRequested writes image_refs, projection and dataSource pass images through, and optimistic / history merge keeps attachments
- Fixed Shared context-resume integrity: bindings gain nativeContextTrust; after 503 / disconnect, needs-history forces rematerialize so a short follow-up no longer drops the original task
- Blocked Shared init and Atomic-model reasoning pollution: create-session and cross-engine switches seed / converge options and effort from the target CLI capability instead of borrowing global Native Codex settings; send-time reconcile as a second gate
- Blocked the Composer rewind-reset update loop so rewind no longer thrash between extract and shell write-back
- Fixed phantom Git Graph lanes under author / search / date filters by compacting missing parents on sparse lists; hide the redundant author chip when an author filter is already active
- Fixed Create PR base / compare pickers blocked by the modal backdrop by raising Popover z-index above the PR overlay
- Manual Git status refresh clears stale commit / push / sync error banners so recoverable failures no longer require a full app reload
- More React #185 white-screen hardening: the Composer extract effect no longer self-subscribes to selectedInlineFileReferences and skips shell writes on equivalent targets; canvas store snapshot latch and selector caching, a useModels cross-epoch storm breaker, and stable session-reload callbacks
- Fixed the Shared sidebar reusing a stale hide set on async refresh and leaking native sessions: Grok / Kimi / Gemini refreshes rebuild with a fresh hide set, merge and final gates strip already-leaked Shared-owned rows, and hide-set fetch failures union instead of widening
- Closed the Shared recovery exits: Probe / Stop / stop-and-rebuild / abandon-turn completed; force-stop reads settled before remove, fixing the abandon race; fusion-disabled reasons are now explainable
- Shared model selection now uses the ExecutionTarget snapshot as display authority — the closed state no longer depends on catalog hits or the global selectedModelId, while Native keeps its global fallback contract
- Codex collab subagents fall back to the child session tree during live wait phases for canvas squads and Status Agents, with live receiver field extraction and synthetic/real spawn dedupe, aligning live and history rendering
- Adjacent thinking blocks are no longer split into multiple thinking cards by canvas-hidden shell tools: resolveVisibleMessageItems filters hidden process tools before merging, keeping live and post-complete expanded timelines consistent; visible file tools still correctly interrupt reasoning runs
- Fixed dockIcon and activeCanvasStore tests being inferred as never under strict mode, which broke tsc builds (and had blocked mac-arm64 packaging)
- Fixed assistant conclusion text occasionally appearing before tool cards after multi-tool turns settle: the reducer now uses `findAssistantMessageIndexForLiveSettlement` (append/complete dual mode) to resolve the correct post-tool segment after `resetAgentSegment`, preventing conclusion text from merging into the pre-tool bubble; late-tool insertion and rebalancing keep the tool-conclusion relative order consistent with history after settlement, removing the need to reopen conversations as a workaround

---

### **2026年8月3日（v0.7.15）**

中文：

这一版的主菜是「子代理看得见、会话概览清楚、跨引擎更稳」：幕布上的小队有了独立卡片与详情抽屉，结果区换成会话概览并接上套餐额度，Shared / 续接与冷启动白屏也一并压实。

✨ Features

- 子代理幕布升级：Agent / Task 从扁条变成带人格的小队卡片，可点开幕布内 inspector 抽屉看子会话全文，不再挤进全局右侧 Tab
- 跨引擎子代理对齐：Codex Collab、Grok spawn、Kimi Swarm 与 Shared 投影也能识别为子代理；会话树补齐父子层级，交付正文与启动回执分开
- 会话概览进结果区：默认展示会话静态信息与运行态；官方 runtime 与 Coding Plan 可查 Codex / Kimi / MiniMax / 智谱额度，Shared 会话支持多供应商额度列表
- Shared 会话可管了：会话管理支持扫描、预览与删除 Shared 会话，列表带 Shared 徽章与引擎筛选
- AI 提交消息更可控：提交框改为结构化 composer，先选引擎与语言再点「按此配置生成」；支持「沿用上次配置」一键再生成，并修好 Grok 等 managed 引擎接入
- 供应商新增 Atlas Cloud Codex 预设
- 侧栏工作区分组：整行单击即可折叠，不再依赖双击或小三角

🔧 Improvements

- 过程时间线更干净：纯 shell 默认收起，文件读写类命令保留在过程折叠里；单步 / 孤儿思考也会并进 chip，展开动画更顺
- 结果 Tab 默认只留会话概览，治理证据改为开发者开关 opt-in
- 下线「会话活动」面板与 Solo 模式，减少常驻入口与派生开销（雷达与底部活动面板不受影响）
- 弹层与续接反馈更清晰；会话菜单会尊重已禁用的 CLI 引擎
- 侧栏会话状态指示更克制；隐藏的自动 helper 不再混入侧栏合并

🐛 Fixes

- 多处收敛 React #185 冷启动 / 折叠动画 / file-ref 引用环导致的白屏
- 修复 Linux 启动空白页，同时保留百度统计；收紧访客 Cookie 提交时序
- 修复 Claude managed 渠道模型与进程环境串台；空白幕布可恢复，并去掉多余 skill chips
- Shared / 跨引擎续接：切渠道立即写执行目标；取消 Provider 续接会还原来源供应商与模型；成功后默认选中目标 catalog 模型
- 以 `shared:` id 硬闸，避免模型选择误入 Native 续接；稳定 Shared 列表图标与 merge 保护
- Codex 续接 inject 过滤 control 角色，避免三方 API 反序列化失败；补齐 apply_patch / 文件修改历史投影
- 兼容 WKWebView：去掉 lookbehind 正则，并持久化 turn 完成元数据
- 终端 host 重挂后 xterm 能重新附着；过程折叠展开后 bash 组不再空壳
- Native 会话额度只查当前供应商，避免误打其它账号

English:

The headline of this release is visible subagents, a clearer session overview, and steadier cross-engine work: squad cards open an in-canvas inspector, the results area becomes a session overview with plan quotas, and Shared / continuation / cold-start white screens get hardened.

✨ Features

- Subagent canvas upgrade: Agent / Task steps become persona squad cards with an in-canvas inspector drawer for the child transcript — no more stuffing into the global right tab
- Cross-engine subagent parity: Codex Collab, Grok spawn, Kimi Swarm, and Shared projections resolve as subagents; the session tree gets parent–child hierarchy, and delivery text is separated from launch receipts
- Session overview in the results area: static session info plus runtime state by default; official runtime / Coding Plan quotas for Codex, Kimi, MiniMax, and Zhipu; multi-vendor quota lists on Shared sessions
- Shared sessions are manageable: session management can scan, preview, and delete Shared sessions, with badges and engine filters
- Safer AI commit messages: a structured composer — pick engine and language, then “Generate with this config”; “Use last configuration” for one-click regenerate; managed engines such as Grok wired correctly
- New vendor preset: Atlas Cloud Codex
- Sidebar workspace groups: single-click the full header row to collapse (no more double-click-only)

🔧 Improvements

- Quieter process timelines: pure shell stays folded by default while file read/write commands remain in the phase; single-step / orphan reasoning joins the chip, with smoother expand animation
- Results tab defaults to session overview only; governance evidence is an opt-in developer switch
- Retired the Session Activity panel and Solo mode to cut permanent chrome and derivation cost (radar and bottom activity panels are unchanged)
- Clearer popovers and continuation feedback; session menus respect disabled CLI engines
- Quieter sidebar status indicators; hidden automatic helpers no longer merge into the sidebar

🐛 Fixes

- Multiple React #185 cold-start / collapse-animation / file-ref cycle white-screen fixes
- Fixed Linux blank startup while keeping Baidu analytics; tightened visitor cookie submit timing
- Fixed Claude managed-channel model vs process-env cross-talk; blank curtains recover, and stray skill chips are dropped
- Shared / cross-engine continuation: write execution target immediately on channel switch; canceling Provider continuation restores the source vendor/model; success selects the target catalog model by default
- Hard-gate on `shared:` ids so model picks no longer fall into Native resume; stable Shared list icons and merge protection
- Codex continuation inject filters `control` roles to avoid third-party API deserialize failures; apply_patch / file-edit history projection filled in
- WKWebView compatibility: remove lookbehind regex and persist turn-final metadata
- xterm reattaches after terminal host remount; bash groups no longer render empty after expanding a collapsed phase
- Native session quotas query only the current vendor

---

### **2026年8月1日（v0.7.14）**

中文：

这一版的主菜是「设置焕新、过程更清、思考可调」：偏好设置整体重排更易扫读，多引擎对话幕布统一过程投影并默认折叠已完成步骤，Grok / 自定义模型也接上了思考强度。

✨ Features

- 设置页焕新：偏好区改为更密的行式布局，界面缩放与代码字号改为预设选择；打开应用编辑进对话框；快捷键与供应商 CLI 在移动端支持主从导航
- 对话过程更安静：已完成的推理 / 工具 / 探索步骤按因果阶段自动折叠成可展开摘要，进行中的步骤保持展开，正文更突出
- 多引擎幕布对齐：统一轻量下线策略，Grok / Kimi / OpenCode 接齐过程投影（含 Grok 实时工具桥），读 / 写 / 搜呈现更接近 Claude
- Grok 思考强度：支持 low / medium / high，从选模贯通到 headless 参数
- 供应商空模型更友好：渠道无 catalog 时回退默认模型并给出引导；自定义 Codex 模型可设思考强度默认档
- 应用图标更新：刷新桌面端图标资源

🔧 Improvements

- 会话管理与设置区块布局简化；移除本地 usage 看板等冗余表面
- 提示词库与设置页选择器外壳统一，排版更整齐
- 收敛幕布滚动所有权与权威回底通道，快流下吸底更稳
- 开发体验：支持隔离启动多个 Tauri 开发实例（端口可配）

🐛 Fixes

- 修复冷启动 React #185：effort 双写导致的死循环，并保留 freeform / catalog 外模型名选择
- 修复 Claude 切换供应商后模型列表不刷新；Native 会话供应商与模型切换不再互相盖盘
- 对齐 Grok / Kimi / OpenCode Hidden Binding 隐藏逻辑；修复切换后的实时投影
- 允许跨供应商续接在运行中取消，并忽略晚到的创建结果
- 禁用当前引擎时自动迁移首页 / 新建会话默认引擎，进行中会话不中断
- 修正 Codex 思考强度映射
- 修复浏览器预览启动崩溃，以及未进设置页时 vendor 弹窗样式裸奔
- 修复工具行稳定与底部跟随抖动；相邻 reasoning 块合并；折叠阶段 hard-unmount 避免幽灵行
- 修复用户气泡复制按钮遮挡正文
- 当前页「添加模型」弹窗补齐 settings 样式加载

English:

The headline of this release is a fresher Settings, quieter process timelines, and tunable reasoning: preferences are easier to scan, multi-engine canvases collapse finished work by default, and Grok / custom models pick up reasoning effort.

✨ Features

- Settings redesign: denser preference rows, preset selects for UI scale and code font size, open-app editing in a dialog, and master–detail mobile flows for shortcuts and vendor CLI
- Quieter process output: completed reasoning / tool / explore steps auto-collapse into expandable causal phase summaries; in-progress work stays open so answers stay front and center
- Unified multi-engine canvas: lightweight summary walls step aside; Grok / Kimi / OpenCode get aligned process projection (including a Grok live tool bridge) with read / write / search presentation closer to Claude
- Grok reasoning effort: low / medium / high from the model picker through headless flags
- Friendlier empty vendor catalogs: fall back to configured defaults with guidance; custom Codex models expose default reasoning-effort tiers
- Refreshed application icon set

🔧 Improvements

- Simpler session-management and settings section layouts; remove the local usage dashboard and other redundant surfaces
- Unified prompt-library and settings select chrome for cleaner typography
- Converged canvas scroll ownership and authoritative “scroll to bottom” so fast streams stick to the end more reliably
- Dev ergonomics: isolated multi-instance Tauri development launches with configurable ports

🐛 Fixes

- Fixed React #185 cold-start effort double-write loops while keeping freeform / out-of-catalog model names
- Fixed Claude model-list refresh after vendor switch; Native session vendor/model switches no longer overwrite each other
- Aligned Grok / Kimi / OpenCode hidden-binding behavior and fixed live projection after switches
- Allow canceling cross-provider continuation while running and ignore late create results
- Auto-migrate home / new-session defaults when the active engine is disabled, without disrupting in-flight threads
- Corrected Codex reasoning-effort mapping
- Fixed browser-preview startup crashes and bare vendor dialogs opened outside Settings
- Stabilized tool rows and bottom-follow jank; merge adjacent reasoning blocks; hard-unmount collapsed phases to avoid ghost rows
- Stopped the user-bubble copy control from covering message text
- Ensured the in-page “add model” dialog loads settings styles

---

### **2026年7月31日（v0.7.13）**

中文：

这一版的主菜是「回复更透明、设置更干净」：助手回复底下能看到用时与 token，设置侧栏瘦身，选模与 CLI 路径也更顺手。

✨ Features

- 回复底栏更完整：助手消息完成后，在操作行旁展示完成时间、本轮耗时，以及输入/输出 token（有数据才显示）
- 选模统一体验：Native 会话也走 Atomic 双栏选模，不再分两套路
- 自定义 CLI 路径集中管理：各引擎路径配置收到统一对话框与供应商设置面板，改路径更省事
- 设置侧栏收口：精选 Skills 迁入「其他」设置；独立的 Skills / 权限侧栏入口去掉，旧深链仍会落到可用位置
- 桌面运行时提示进设置菜单：从侧栏齿轮二级入口查看，不再在顶栏/角标里抢注意力
- 版本记录可直接升级：打开版本记录时会检查更新，有新版本时在标题旁出角标，一点就能开始更新
- Grok 会话时间更准：侧栏优先用 chat_history 修改时间，避免 bulk summary 把时间刷成「刚刚」

🐛 Fixes

- 修复流式正文在消息 id 切换时丢尾巴的问题
- 修复取消附件选择后再次弹出文件框
- 修复 AI 生成 commit message 时遇 Codex 运行时断开（如 Broken pipe）只会裸报系统错误：可恢复则自动重试，否则给出可重试的本地化提示
- 过滤 Grok 历史里的 runtime context 信封，不再污染对话
- OpenCode CLI 不可用时按空目录处理，避免冒出内部命令失败提示
- 增强 ErrorBoundary：错误分类、报告复制与多语言文案更完整
- 去掉 header 折叠雷达角标，并微调 composer / 主题相关样式

English:

The headline of this release is clearer replies and a leaner Settings: assistant turns show timing and tokens, the sidebar is quieter, and model / CLI path setup is easier.

✨ Features

- Richer message footer: when an assistant turn finishes, the action row shows completion time, elapsed duration, and input/output tokens when available
- One model picker path: Native sessions reuse the Atomic dual-pane picker instead of a separate flow
- Centralized custom CLI paths: engine path settings live in a shared dialog and vendor settings panel
- Settings sidebar cleanup: curated Skills move into Other settings; standalone Skills / Permissions entries are gone, while legacy deep links still land somewhere useful
- Desktop runtime notices live under the Settings menu: less noise in the chrome, same info when you need it
- Upgrade from release notes: opening the modal checks for updates and shows a compact badge when a new version is available
- More accurate Grok session times: the sidebar prefers chat_history mtime so bulk summaries don't rewrite everything to “just now”

🐛 Fixes

- Fixed live assistant text dropping its tail when the item id switches mid-stream
- Fixed canceling an attachment pick reopening the file dialog
- Fixed AI commit-message generation surfacing raw OS errors (e.g. Broken pipe) on Codex runtime disconnects — recover when possible, otherwise show a localized retryable message
- Filtered Grok history runtime-context envelopes so they no longer clutter the transcript
- Treat an unavailable OpenCode CLI as an empty directory instead of showing internal command failures
- Stronger ErrorBoundary: better error classification, report copy, and localized copy
- Removed the collapsed-header radar badge and polished related composer / theme styles

---

### **2026年7月30日（v0.7.12）**

中文：

这一版的主菜是「跨 CLI 续接」：对话不再被单个引擎锁死，聊了一半可以换家接着聊。

✨ Features

- 对话可以跨 CLI 续接了：Claude 里聊了一半的会话，能交给 Kimi、Grok 或 OpenCode 接着聊；续接卡片会捎上来源会话的最后一轮，上下文不断片
- 原生续接更靠谱：用原供应商继续旧会话时，历史消息会完整「搬家」；实在搬不全的，会明确列出降级了哪些内容，不再悄悄丢
- 新建会话一个入口：三种 CLI 的创建、校验、选择一次到位，不用再猜哪个能用
- 侧栏更清爽：同一条续接链上的会话自动归拢成一组；续接信息围挡、工作区操作菜单默认折叠，不再满屏按钮
- 底层打地基：重建了会话数据的存储与投递底座，为后续更多跨 CLI 能力铺路（本期无感知，但很重要）

🐛 Fixes

- 修复 Grok / OpenCode 切换模型不生效的问题
- 修复跨 CLI 切换后「历史恢复」和「原生续接」串线，消息不再张冠李戴
- 修复会话结束后偶发「复活」（状态回跳）的问题
- 修复 Codex 供应商续接走不完全程的问题
- 供应商与模型选择更稳定，选中状态不再飘

English:

The headline of this release is cross-CLI continuation: a conversation is no longer locked to one engine — hand it off mid-way and keep going.

✨ Features

- Continue conversations across CLIs: take a chat started in Claude and let Kimi, Grok, or OpenCode pick it up; the continuation card carries the source session's last turn so context isn't lost
- More trustworthy native continuation: resuming an old session with its original vendor now migrates the full history, and anything that couldn't come along is listed explicitly instead of being silently dropped
- One entry point for new sessions: creation, validation, and selection for all three CLIs in a single flow — no more guessing which one works
- A tidier sidebar: sessions on the same continuation chain are grouped automatically, and the continuation banner and workspace action menu are collapsed by default
- Foundation work: rebuilt the session storage and delivery base to pave the way for more cross-CLI capabilities (invisible today, but important)

🐛 Fixes

- Fixed model switching not taking effect for Grok / OpenCode
- Fixed cross-talk between "history restore" and "native resume" after switching CLIs — messages no longer get mixed up
- Fixed finished sessions occasionally "coming back to life"
- Fixed Codex vendor continuation failing to complete
- Vendor and model selection is more stable, with no more drifting selections

---

### **2026年7月28日（v0.7.11）**

中文：

✨ Features

- 新引擎上岗：Grok 现在可以直接在 App 里开聊了
- OpenCode 引擎回归，可用的运行时又多一个

🔧 Improvements

- 危险操作确认弹窗的按钮在窄窗口下会自动换行，不再挤成一团
- 设置页诊断标签不再加粗，页面更清爽

🐛 Fixes

- 手动重命名过的会话标题能正常显示了（含 Grok 会话）
- 浅色主题下，下拉框等系统原生控件不再冒出深色「补丁」
- 关闭的终端会被安全清理，不再留下「僵尸终端」
- 字体渲染在各桌面平台上表现更一致

English:

✨ Features

- A new engine joins: you can now chat with Grok directly in the app
- The OpenCode engine is back, adding one more runtime to choose from

🔧 Improvements

- Buttons in danger-confirmation dialogs now wrap on narrow windows instead of cramming together
- Diagnostic labels in Settings are no longer bold, making the page cleaner

🐛 Fixes

- Manually renamed session titles now display correctly (including Grok sessions)
- Under light themes, native controls like dropdowns no longer show up as dark patches
- Closed terminals are cleaned up safely — no more zombie sessions
- Font rendering is more consistent across desktop platforms

---

### **2026年7月27日（v0.7.10）**

中文：

✨ Features

- 升级应用版本号到 `0.7.10`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(composer)`: 沉淀技能调用契约与对话命令，润色器接入本地化缓存，curated skills 变更改为事件化刷新，技能链路响应更及时
- `feat(git)`: AI commit message 支持一键按上次配置生成，无需重复选择引擎与参数
- `feat(git)`: 重设计提交区域为右侧操作列，差异面板推送入口收敛为工具栏角标按钮
- `feat(terminal)`: 终端新增搜索与安全链接能力，输出内容可检索、链接可安全打开
- `feat(annotation)`: 稳定代码标注锚点，文件标注锚点组装复用统一逻辑，定位不再漂移
- `feat(tokentracker)`: Token 用量支持中文数字格式展示
- `feat(engine)`: 建立统一运行时事件总线，统一消息投递与会话注册，奠定引擎接入重构基础
- `feat(threads)`: 收敛会话供应商绑定；sidebar 支持会话级供应商选择，Claude / Kimi 支持会话级供应商运行环境隔离
- `feat(vendors)`: 支持从 CC Switch 导入供应商配置
- `feat(curated-skills)`: 设置侧 Skills 更名为内置精选并补充行为说明

🔧 Improvements

- `refactor(markdown)`: 收敛文件预览渲染边界并遵循渲染器大文件基线，清理旧渲染器路径
- `refactor(git)`: 拆分文件与差异高频入口；worktree 面板收敛共享 AI commit 配置事实源，消除多处重复定义
- `refactor(git-history)`: 恢复核心面板类型保护，摘除 `GitHistoryPanelPickers` 的 `@ts-nocheck`
- `refactor(files)`: 合并 fileViewPanel 重复纯函数并治理兜底轮询，降低空闲开销
- `refactor(composer)`: 统一输入历史存储、事件化命令目录刷新，裁剪补全死路径与 ComposerInput 残留
- `refactor(engine)`: 统一能力契约与会话身份，建立适配器协议注册表，收薄引擎控制器门面并收紧 CLI 兼容治理边界
- `refactor(models)`: 收敛模型供应商目录
- `refactor(claude)`: 建立供应商会话隔离基础

🐛 Fixes

- `fix(composer)`: 修复提交生成与命令执行的并发边界，避免并发操作互相干扰
- `fix(navigation)`: 缓存消息索引并移除随机分支名，导航跳转更稳定
- `fix(files)`: 修复文件读取失败导致的加载卡死
- `fix(opencode)`: 停止启动期会话探测，避免无谓开销
- `fix(engine)`: 加固会话供应商运行边界，隔离供应商模型目录与会话配置
- `fix(sidebar)`: 阻止供应商选择静默回退
- `fix(styles)`: 修复 diff.css 中丢失的 `.commit-message-generate-menu` 选择器
- `fix(codex)`: 优化供应商协议错误提示
- `fix(error)`: 统一错误提示并禁用原生 Alert
- `fix(vendors)`: 修复 CLI 版本状态与头部重叠

English:

✨ Features

- Bump the app version to `0.7.10` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(composer)`: formalize the skill-invocation contract and conversation commands, add localized caching for the prompt polisher, and switch curated-skill updates to event-driven refresh
- `feat(git)`: allow AI commit messages to be regenerated with one click using the last-used configuration, without reselecting the engine and options
- `feat(git)`: redesign the commit area as a right-side action column and collapse the diff-panel push entry into a toolbar badge button
- `feat(terminal)`: add search and safe-link handling to the terminal so output is searchable and links open securely
- `feat(annotation)`: stabilize code annotation anchors by reusing a unified anchor-assembly path, eliminating position drift
- `feat(tokentracker)`: support Chinese numeral formatting for token usage displays
- `feat(engine)`: establish a unified runtime event bus and unify message delivery with session registration, laying the groundwork for the engine-integration refactor
- `feat(threads)`: converge session vendor binding; the sidebar now supports per-session vendor selection, and Claude / Kimi support isolated per-session vendor runtime environments
- `feat(vendors)`: support importing vendor configurations from CC Switch
- `feat(curated-skills)`: rename the settings-side Skills entry to built-in curated skills and add behavior documentation

🔧 Improvements

- `refactor(markdown)`: consolidate file-preview rendering boundaries under the large-file renderer baseline and remove the legacy renderer path
- `refactor(git)`: split high-frequency file and diff entry points; converge the worktree panel on a single shared source of truth for AI commit configuration
- `refactor(git-history)`: restore type safety in the core panel and remove `@ts-nocheck` from `GitHistoryPanelPickers`
- `refactor(files)`: merge duplicated pure functions in fileViewPanel and rein in fallback polling to reduce idle overhead
- `refactor(composer)`: unify input-history storage, make the command catalog refresh event-driven, and prune dead completion paths and ComposerInput remnants
- `refactor(engine)`: unify the capability contract and session identity, establish an adapter protocol registry, slim down the engine controller facade, and tighten the CLI compatibility governance boundary
- `refactor(models)`: converge the model vendor catalog
- `refactor(claude)`: lay the foundation for vendor session isolation

🐛 Fixes

- `fix(composer)`: fix the concurrency boundary between commit generation and command execution so concurrent actions no longer interfere
- `fix(navigation)`: cache the message index and remove random branch names, making navigation jumps stable
- `fix(files)`: fix the loading deadlock caused by file-read failures
- `fix(opencode)`: stop session probing at startup to avoid unnecessary overhead
- `fix(engine)`: harden the session vendor runtime boundary and isolate vendor model catalogs from session configuration
- `fix(sidebar)`: prevent silent fallback of the vendor selection
- `fix(styles)`: restore the missing `.commit-message-generate-menu` selector in diff.css
- `fix(codex)`: improve vendor protocol error messages
- `fix(error)`: unify error prompts and disable native Alert dialogs
- `fix(vendors)`: fix the CLI version status overlapping the header

---

### **2026年7月25日（v0.7.9）**

中文：

✨ Features

- 升级应用版本号到 `0.7.9`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(extensions)`: 新增 Skills Hub 与 MCP inventory 视图，集中管理技能与 MCP 服务清单
- `feat(session-activity)`: 接线语义 diff AI review 按需生产者，会话活动支持按需触发 AI 审查

🔧 Improvements

- `perf(client)`: 降低 worktree / kanban / output / dock 常驻轮询开销；录音电平事件降频至 100ms 并跳过相同值
- `perf(skills)`: 大技能列表保持响应，避免加载卡顿
- `refactor`: 清理波次收敛——删除响应式布局死分支、JCEF bridge no-op 桩、app-shell 死链、notice dock streaming 死分支与 orchestration 残留死字段
- `refactor(settings)`: 摘除 SettingsView 的 `@ts-nocheck`，恢复类型检查保护
- 优化文件 tab 当前打开标识

🐛 Fixes

- `fix(settings)`: 损坏的设置文件先隔离备份再回退默认值，加载成功后提示恢复结果并补齐错误日志与 i18n 文案
- `fix(workspaces)`: 损坏的 workspaces.json 同样先隔离备份再回退，前端挂载后提示工作区损坏恢复
- `fix(engine-task-output)`: 修复引擎二元假设并透传真实引擎归因，任务输出不再误判来源
- `fix(vendors)`: 收敛 `isValidModelId` 为 composer 单一实现，消除多处分歧校验
- `fix(cleanup)`: 收口清理波次遗留链路

English:

✨ Features

- Bump the app version to `0.7.9` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(extensions)`: add a Skills Hub and an MCP inventory view to centrally manage skills and MCP server listings
- `feat(session-activity)`: wire an on-demand semantic-diff AI review producer so session activity can trigger AI review when needed

🔧 Improvements

- `perf(client)`: reduce standing polling overhead across worktree, kanban, output, and dock surfaces; throttle dictation level events to 100ms and skip unchanged values
- `perf(skills)`: keep large skill lists responsive without load-time stalls
- `refactor`: cleanup-wave convergence — remove dead responsive-layout branches, the JCEF bridge no-op stub, dead app-shell links, dead notice-dock streaming branches, and leftover orchestration fields
- `refactor(settings)`: remove `@ts-nocheck` from SettingsView and restore type-check protection
- refine the currently-open indicator on file tabs

🐛 Fixes

- `fix(settings)`: quarantine and back up a corrupted settings file before falling back to defaults, surface the recovery after a successful load, and add error logging plus i18n copy
- `fix(workspaces)`: apply the same quarantine-then-fallback flow to a corrupted workspaces.json and notify about workspace recovery after the frontend mounts
- `fix(engine-task-output)`: fix the binary engine assumption and propagate true engine attribution so task output is no longer misattributed
- `fix(vendors)`: converge `isValidModelId` on the single composer implementation, eliminating divergent validation
- `fix(cleanup)`: close out leftover paths from the cleanup wave

---

### **2026年7月24日（v0.7.8）**

中文：

✨ Features

- 升级应用版本号到 `0.7.8`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(extensions)`: 扩展管理独立隔离，形成自包含的 extensions 模块边界
- `feat`: 接入 tokenpacker CLI，扩展 Token 处理能力
- `feat(session-activity)`: 增强最近活动面板与快速切换器交互
- `feat(theme)`: 增加主题感知代码与差异配色，代码块与 diff 随主题自动适配

🔧 Improvements

- `refactor(orchestration)`: 移除编排中心本体、装配与派发接线，open-task-run 事件总线迁移至 tasks 模块，精简应用骨架
- `refactor(client)`: 清理未使用的客户端模块

🐛 Fixes

- `fix(quick-switcher)`: 修复文件激活时主区路由错误
- `fix(styles)`: 修复扩展页签 sticky 布局间隙

English:

✨ Features

- Bump the app version to `0.7.8` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(extensions)`: isolate extension management into a self-contained module boundary
- `feat`: connect to the tokenpacker CLI to extend token-processing capabilities
- `feat(session-activity)`: enhance recent-activity panel and quick-switcher interactions
- `feat(theme)`: add theme-aware code and diff colors so code blocks and diffs adapt to the active theme

🔧 Improvements

- `refactor(orchestration)`: remove the orchestration center along with its assembly and dispatch wiring, migrate the open-task-run event bus to the tasks module, and slim down the app shell
- `refactor(client)`: remove unused client modules

🐛 Fixes

- `fix(quick-switcher)`: fix incorrect main-area routing when activating a file
- `fix(styles)`: fix the sticky layout gap on extension tabs

---

### **2026年7月23日（v0.7.7）**

中文：

✨ Features

- 升级应用版本号到 `0.7.7`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(composer)`: 完善提示词增强入口，将增强操作收敛到 Composer 主操作区，并统一按钮状态、提示文案与主题样式
- `feat(files)`: 文件编辑器新增 workspace-scoped 语义导航历史，支持 Back / Forward 快捷返回跳转前后的文件、光标与滚动视口
- `feat(lsp)`: 为 Python / Pyright 与 Go / gopls 接入 definition、references、implementation 语义导航；语言服务保持用户独立安装，缺失时显示安装指引并安全降级
- `feat(git)`: Git changed-file 分区与多仓库摘要新增 additions / deletions 统计，提交前即可快速判断每组改动规模
- `feat(git-history)`: File History 支持调整 commit rail 与 previous/source 栏宽度，拖拽采用平滑帧更新并保留长行横向滚动；Git 中间区域 split preview 复用同一 aligned CodeMirror renderer，同时保留双栏/单栏与全文/区域 controls
- `feat(vendors)`: Vendor Settings 增加 Grok CLI 文档入口与 unsupported 状态占位，不误导为已完成集成

🔧 Improvements

- `fix(app)`: workspace Home 复用共享 Composer，pinned threads 复用统一 ThreadList 行为；session title 会过滤 AGENTS、environment 与 SessionStart bootstrap 内容，避免内部上下文成为会话标题
- `fix(ui)`: Git Update / Commit / Push 收敛为 branch header 快捷操作，recent branches 默认展开；文件树支持单击打开或折叠，Markdown 增加明确的编辑/预览切换
- `fix(ui)`: 统一 workspace project dropdown、Home、message anchors 与 Market 导航的布局、token、图标和文案；窄对话容器会自动隐藏 anchor rail，长会话折叠态限制 marker 数量

🐛 Fixes

- `fix(composer)`: 修复 `#` 智能体补全菜单包含 section header 或 separator 时的选择索引错位；鼠标点击以及 Enter / Tab 键确认现在都会选中界面高亮的真实智能体，不再误选相邻项
- `fix(code-intel)`: 稳定 LSP request timeout、cancellation、session eviction 与 provider failure 生命周期，避免软超时误杀可复用会话或影响其他 workspace / language server
- `fix(files)`: 修复文件编辑器快捷键映射与 context menu shortcut 展示，保持 macOS / Windows / Linux 的平台语义一致
- `fix(theme)`: 修复深色主题下侧栏折叠按钮的背景与边界色，避免控件融入背景或出现错误亮色
- `fix(quick-switcher)`: 修复冷启动 hydration 中等价 workspace 引用反复读取 storage 并发布状态的问题，避免触发 React maximum update depth
- `fix(git)`: 修复多仓库 changed-file 的 inline preview、Discard 与刷新操作丢失 repository identity 的问题，确保同名相对路径始终作用于正确仓库
- `fix(git)`: 手动刷新现在统一更新 status、diff、log 与 repository summaries；文件树会保留用户对自动展开 gitignored 路径的手动折叠选择

English:

✨ Features

- Bump the app version to `0.7.7` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(composer)`: complete the prompt-enhancer entry point by consolidating the action in the Composer primary controls and aligning button state, guidance, and theme styling
- `feat(files)`: add workspace-scoped semantic navigation history to the file editor, with Back / Forward restoring the target file, cursor, and scroll viewport
- `feat(lsp)`: add definition, references, and implementation navigation for Python / Pyright and Go / gopls; language servers remain user-installed, with installation guidance and safe fallback when unavailable
- `feat(git)`: show addition and deletion totals in Git changed-file sections and multi-repository summaries so the size of each change group is visible before commit
- `feat(git-history)`: make the File History commit rail and previous/source columns resizable with frame-coalesced dragging and per-pane horizontal scrolling; reuse the same aligned CodeMirror renderer for center-area split previews while retaining split/unified and full/focused controls
- `feat(vendors)`: add a Grok CLI documentation entry and explicit unsupported placeholder to Vendor Settings without implying a completed integration

🔧 Improvements

- `fix(app)`: reuse the shared Composer on workspace Home and unified ThreadList behavior for pinned threads; filter AGENTS, environment, and SessionStart bootstrap content out of generated session titles
- `fix(ui)`: expose Git Update, Commit, and Push as branch-header quick actions, expand recent branches by default, support single-click file opening and folder toggling, and add an explicit Markdown edit/preview switch
- `fix(ui)`: align the workspace project dropdown, Home, message anchors, and Market navigation across layout, tokens, icons, and copy; hide the anchor rail in narrow conversation containers and cap collapsed markers for long sessions

🐛 Fixes

- `fix(composer)`: fix selection index drift in the `#` agent completion menu when section headers or separators are present; mouse selection and Enter / Tab confirmation now choose the actual highlighted agent instead of an adjacent item
- `fix(code-intel)`: stabilize LSP request timeout, cancellation, session eviction, and provider-failure lifecycles so soft timeouts do not kill reusable sessions or affect unrelated workspaces and language servers
- `fix(files)`: correct file-editor shortcut mappings and context-menu shortcut labels while preserving native semantics across macOS, Windows, and Linux
- `fix(theme)`: correct the collapsed-sidebar control background and border colors in dark themes so the control remains visible without an incorrect light accent
- `fix(quick-switcher)`: stop equivalent workspace references during cold-start hydration from repeatedly reading storage and publishing state, preventing React maximum-update-depth failures
- `fix(git)`: preserve repository identity for multi-repository changed-file inline previews, Discard actions, and refreshes so identical relative paths always target the correct repository
- `fix(git)`: make manual refresh update status, diffs, logs, and repository summaries together, and preserve manual collapse choices for folders auto-expanded to reveal gitignored paths

---

### **2026年7月22日（v0.7.6）**

中文：

✨ Features

- 升级应用版本号到 `0.7.6`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(curated-skills)`: 内置 Caveman 精选技能，补齐资源注册、设置入口、provider 支持状态与 Desktop / remote daemon 持久化链路，可直接启用简洁技术沟通模式
- `feat(git)`: 为多仓库工作区增加全局 branch 操作，并统一单仓与多仓 Git History branch tree；各 repository 保持独立 branch catalog、状态与操作 scope
- `feat(files)`: 文件编辑器新增行列跳转，统一文件图标，并支持从已打开文件反向定位到文件树；文件标签与文件树右键菜单整合 Open、Reveal、Copy、Git、History 等常用操作
- `feat(git-history)`: File History 支持多页签，可同时保留多个文件的历史上下文并在页签间切换
- `feat(quick-switcher)`: 新增最近活动快速切换面板，支持文件、会话与操作的缩写模糊匹配、优先级排序和跨平台快捷键导航
- `feat(workbench)`: 完善全局搜索与代码导航，新增 LSP definition、reference、implementation 跳转及 Rust 支持；语言服务不可用时提供明确的安装指引与降级路径
- `feat(mermaid)`: Mermaid 全屏预览支持将图表保存为 PNG，并接入 native file save 流程

🔧 Improvements

- `refactor(messages)`: 重组消息展示架构，将 row、timeline、orchestration、Markdown、tool presentation 与共享 domain helpers 拆分到明确边界，同时保持 streaming、virtualization 与公共输入 contract 不变
- `style(composer)`: 压缩多仓库 Git 操作菜单的信息密度，并统一 pinned session 与 workspace row 的视觉对齐

🐛 Fixes

- `fix(messages)`: 修复消息行 context 与延迟图片 hydration 的 stale state，使用 workspace / thread / message scope 和 generation guard 阻止旧异步结果覆盖当前内容，并正确释放 object URL
- `fix(status-panel)`: 正确区分 Kimi 提交信息引擎，避免状态面板将其投影为其他 provider
- `fix(git)`: 稳定跨平台 branch tree 排序并恢复历史分支树的细节交互，避免多仓切换后 branch 信息或操作入口缺失
- `fix(settings)`: 修复快捷键持久化，并补齐常用功能模块的快捷键配置
- `fix(files)`: Git 行标记改为按需加载并增加异步竞态保护，避免快速切换文件时旧请求污染当前编辑器
- `fix(threads)`: 从 live notification、subagent activity 与 catalog payload 统一 Codex subagent identity 和 parent relationship，使子智能体首次出现时即归入正确父会话，避免短暂显示为重复顶层会话
- `fix(quick-switcher)`: 最近文件数据过滤非文件活动记录，避免会话或操作事件混入文件列表

English:

✨ Features

- Bump the app version to `0.7.6` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(curated-skills)`: bundle the Caveman curated skill with resource registration, settings entry points, provider support state, and Desktop / remote-daemon persistence, making concise technical communication available out of the box
- `feat(git)`: add global branch operations for multi-repository workspaces and unify the Git History branch tree across single- and multi-repository modes, while keeping each repository's branch catalog, state, and action scope isolated
- `feat(files)`: add line-and-column navigation to the file editor, unify file icons, and reveal open files in the file tree; consolidate common Open, Reveal, Copy, Git, and History actions across file-tab and file-tree context menus
- `feat(git-history)`: add tabs to File History so multiple files can retain independent history context and remain open for quick switching
- `feat(quick-switcher)`: add a recent-activity quick switcher with abbreviation-aware fuzzy matching, prioritized files, sessions, and actions, plus cross-platform keyboard navigation
- `feat(workbench)`: expand global search and code navigation with LSP definition, reference, and implementation jumps plus Rust support; provide explicit installation guidance and fallback behavior when a language server is unavailable
- `feat(mermaid)`: allow fullscreen Mermaid diagrams to be saved as PNG files through the native file-save flow

🔧 Improvements

- `refactor(messages)`: reorganize message presentation into explicit row, timeline, orchestration, Markdown, tool-presentation, and shared-domain boundaries while preserving streaming, virtualization, and public-input contracts
- `style(composer)`: tighten the multi-repository Git action menu and align pinned session rows visually with workspace rows

🐛 Fixes

- `fix(messages)`: prevent stale message-row context and deferred image hydration from overwriting current content by scoping results to workspace, thread, message, and generation identity, while releasing owned object URLs correctly
- `fix(status-panel)`: distinguish the Kimi commit-message engine correctly instead of projecting it as another provider in the status panel
- `fix(git)`: stabilize cross-platform branch-tree ordering and restore detailed Git History branch interactions so branch information and actions remain available after repository switches
- `fix(settings)`: persist keyboard shortcuts correctly and add shortcut configuration for commonly used modules
- `fix(files)`: load Git line markers on demand with asynchronous race guards so stale requests cannot contaminate the currently open editor
- `fix(threads)`: unify Codex subagent identity and parent relationships from live notifications, subagent activity, and catalog payloads, placing child agents under the correct parent on first render instead of briefly duplicating them at the top level
- `fix(quick-switcher)`: filter non-file activity out of recent files so session and action events do not leak into the file list

---

### **2026年7月20日（v0.7.5）**

中文：

✨ Features

- 升级应用版本号到 `0.7.5`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(files)`: 文件编辑器新增按需 Git Blame —— 默认关闭且零额外 IPC，启用后在 CodeMirror gutter 按可见行展示日期与作者，当前行可查看 commit SHA、完整时间和摘要；编辑后标记为 stale、保存后受控刷新，并支持 Desktop / Web Service 与多仓库 scope
- `feat(git-history)`: 新增独立 File History 工作台，可从文件树或 Git Diff 文件菜单打开目标文件的提交历史；左侧按 rename chain 分页展示相关 commits，右侧复用现有 Diff viewer 查看单次文件变化，并对 repository、path、分页与异步响应做隔离
- `feat(search)`: 全局搜索新增 API endpoint provider，复用 Project Map contract cache 与受限扫描，支持按 path、HTTP method、handler、operation、description、framework、protocol、module 或 source file 检索 HTTP / RPC / GraphQL / ABI endpoint，并可直接跳转到源码位置
- `feat(git-history)`: 提交列表新增文本/Hash、Branch、User 与 Date preset 组合筛选，输入采用 `300ms` debounce，筛选状态可持久化；分页、snapshot retry 与 remote daemon 均复用同一 canonical payload，避免 stale request 覆盖最新结果
- `feat(git)`: 统一单仓与多仓 changed-file 右键菜单，按 staged / unstaged 状态提供 Unstage、Stage、Discard 与 File History；所有 action 保留 `workspaceId + repositoryRoot + path` identity，并复用现有确认、刷新与 Diff/File History surface
- `feat(git)`: 统一 Git history 导航入口，将 Git Diff mode menu 与 Sidebar 中重复或含混的入口收敛为高亮的 `Git Graph` action，同时保留既有 history panel、callback 与隐藏 `log` mode 的兼容性
- `feat(vendors)`: Vendor Settings 导航新增 Feishu CLI 与官方文档入口，并明确保持 unsupported 状态，不启用配置能力或暗示完整集成
- `feat(agents)`: 新增内置可插拔智能体目录，将 agent catalog、provider 支持状态、入口文案与 Rust 侧配置对齐，为后续扩展保留统一 registry
- `feat(engine)`: 打通 Kimi CLI 端到端集成，覆盖 engine catalog、会话创建、prompt transport、interrupt、history / diagnostics 与 UI 入口，并与既有 provider lifecycle 保持一致
- `feat(notes)`: 增加来源感知便签采集链路与对话幕布底部捕获入口，可从对话上下文捕获内容并带着 source metadata 进入 Notes 工作台，保留来源跳转、collection 归属与后续引用能力
- `feat(git)`: Git 提交工作流新增 PR 标题与正文 AI 生成，基于当前 diff / branch context 生成可编辑草稿，并沿用既有确认与错误反馈路径
- `feat(cli)`: Vendor Settings header 新增 Claude、Codex、Kimi 的 CLI lifecycle 控制，支持本地版本探测、npm registry allowlist 查询、installed / outdated / unavailable 状态展示，以及 install、update、refresh 操作；Claude 安装和更新改走官方 native installer 与 `claude update`

🔧 Improvements

- `feat(git-history)`: 将 Git History 收敛为 Branch、Commit、Details 三栏主布局，移除重复的 overview 区域并按 `3:4:3` 分配默认宽度；作者 timeline 使用基于 email/name 的稳定主题色，跨刷新、分页与搜索保持一致
- `feat(git-history)`: 变更文件树复用 shared diff-tree compact folders 规则，压缩无分叉的单子目录链，同时保留 branch boundary、canonical path、Windows separator、展开状态与键盘交互
- `feat(git)`: 收紧多仓库 Git Diff 工作区的信息密度并补齐 repository-scoped modal preview；快速切换同名路径时丢弃 stale response，full-context loader、编辑路径和 preview source 始终绑定同一 repository
- `feat(git)`: 将 Git Diff mode selector 移至文件工作台顶部工具栏，通过 portal 复用原有 menu、viewport positioning 与 mode state，减少内容区重复 header 并保持窄窗口可用
- `fix(git-history)`: Git Pull、Fetch、Sync 等确认界面新增 intent、effect、non-effect 与高亮 command preview；Pull 可组合 `--rebase`、`--no-commit`、`--no-verify`，说明与最终 payload 会随选择同步更新
- `feat(ui)`: Git commit composer 支持置顶或置底偏好，并在 Behavior preferences 与 commit-message engine menu 中暴露；同轮改进 Markdown 文件链接解析、native file opener 路由，以及大量 child-session pill 的溢出展示
- `feat(messages)`: 推理状态展示统一 live / completed thinking 文案，Reasoning header 增加 Brain icon，并将 message markdown 样式覆盖到 reasoning blocks，保证 inline code、code block、syntax highlight、Mermaid、LaTeX 和链接控件一致
- `feat(models)`: 移除已退役的 Codex 内置模型选项与多语言文案，保留 `gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4` 等当前可用目录，并保持 custom model workflow 不变
- `style(git-history)`: 压缩 Git History 顶部工具栏间距并强化 pane boundary，在不牺牲可读性的前提下提升内容密度与视觉层级

🐛 Fixes

- `fix(git)`: 修复多仓库文件打开、Git Blame、Diff preview、Discard 与 File History 链路中的 repository identity 丢失；workspace-root、nested repository、相同 relative path 与 longest-prefix owner 均使用正确 scope，避免串仓或错误禁用
- `fix(git)`: 恢复多仓库 unstaged 文件回退入口与状态刷新，修复 repository switch chrome、分组折叠和刷新入口回归；回退继续经过确认弹窗，成功后只刷新目标 repository 的状态
- `fix(search)`: 全局文件搜索不再把 progressive file tree 的 shallow / empty 结果当成完整索引；当前与全局 scope 会按 active-first、bounded concurrency 补齐 full snapshot，并区分 partial、complete、error 状态，失败可重试且 stale hydration 不覆盖新 workspace
- `fix(renderer)`: 为 react-scan 初始化与运行异常增加熔断恢复，诊断工具崩溃时主动卸载并清理残留状态，避免影响应用正常渲染
- `fix(git)`: 统一 renamed / deleted 文件在 Desktop、remote daemon、单仓与多仓链路中的 source/destination identity；文件激活、Diff stats、Stage、Unstage 与 Discard 复用同一 alias resolution，避免打开错误路径或操作失效
- `fix(codex)`: Codex usage 不再硬编码 `5h limit` 与 `Weekly limit`，而是根据服务端 `windowDurationMins` 动态显示分钟、小时、天或周级窗口，并为缺失或非法 metadata 提供稳定 fallback
- `fix(markdown)`: 修复 Fast Markdown Worker 因 DOM dependency 崩溃的问题，将 DOM-free compile 与 main-thread sanitization 明确分层；stale、timeout 或 unavailable request 不再触发过期 fallback，避免错误预览与主线程放大
- `fix(messages)`: 稳定 streaming Timeline 与 history reopen：等价 parent/overlay 更新不再放大重渲染，pending thread 跳过 history loader，失败或 degraded empty 会保留 last-good transcript，并用 generation guard 阻止旧请求覆盖新会话
- `fix(runtime)`: Codex runtime health probe 不再触发 `model/list` refresh；重复 `stderr` 会按脱敏 signature 聚合、限频并保留高价值 diagnostics，减少 catalog refresh 与日志风暴对客户端的干扰
- `fix(gemini)`: 在 frontend、Desktop 与 remote daemon 执行边界 hard-disable Gemini，并覆盖 prompt transport、interrupt、workspace removal、shutdown 与 drop 的 owned process kill/reap；历史与 diagnostics 仍可读取，但残留入口不会启动或跨 Provider 转发新任务
- `fix(kimi)`: 收敛 Kimi 会话 identity、sidebar projection、history restore 与 provider UI 状态，避免会话跨 provider 混淆或重复投影
- `fix(kanban)`: Kanban 初始化与 Codex 模型目录使用同一 supported catalog，修复模型列表竞态和 stale model assertion
- `fix(git)`: 大范围 PR 变更操作增加确认门禁，并修复多仓长列表虚拟滚动断层，避免批量操作误触和列表滚动空洞
- `fix(markdown)`: 修复 Mermaid 大图全屏预览的布局与交互异常，保持图表预览在弹层中的可读尺寸和关闭路径
- `fix(ui)`: 改善 macOS shell controls 与图片预览层级，避免 shell 控件被遮挡或图片预览浮层压错上下文
- `fix(composer)`: 统一 Codex context usage 指示器外观，并收紧发送按钮尺寸，减少 composer footer 的视觉跳动
- `fix(app)`: 修复冷启动更新循环与过期模型断言，启动阶段不再因 stale catalog / settings 状态触发重复渲染或错误 fallback

English:

✨ Features

- Bump the app version to `0.7.5` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(files)`: add opt-in Git Blame to the file editor with zero extra IPC while disabled; when enabled, render date and author annotations for visible CodeMirror lines and expose the commit SHA, full timestamp, and summary for the active line, with stale-on-edit, controlled refresh after save, Desktop / Web Service parity, and multi-repository scoping
- `feat(git-history)`: add a dedicated File History workbench reachable from the file tree and Git Diff file menus; page through commits that touched the file across its rename chain on the left, reuse the existing Diff viewer for each selected revision on the right, and isolate repository, path, pagination, and asynchronous response identity
- `feat(search)`: add an API endpoint provider to global search by reusing the Project Map contract cache and bounded scan lifecycle; search HTTP, RPC, GraphQL, and ABI endpoints by path, HTTP method, handler, operation, description, framework, protocol, module, or source file, then navigate directly to the source location
- `feat(git-history)`: add composable text/Hash, Branch, User, and Date preset filters to the commit list with `300ms` input debouncing and persisted state; pagination, snapshot retry, and the remote daemon reuse one canonical payload so stale requests cannot replace newer results
- `feat(git)`: unify changed-file context menus across single- and multi-repository modes, exposing Unstage, Stage, Discard, and File History according to staged state; every action preserves `workspaceId + repositoryRoot + path` identity and reuses the existing confirmation, refresh, Diff, and File History surfaces
- `feat(git)`: unify Git history navigation by consolidating duplicate or ambiguous entries in the Git Diff mode menu and Sidebar into one highlighted `Git Graph` action, while retaining the existing history panel, callback, and hidden `log` mode compatibility
- `feat(vendors)`: add Feishu CLI and its official documentation to Vendor Settings navigation while keeping it explicitly unsupported, without enabling configuration or implying full integration
- `feat(agents)`: add a builtin pluggable agent catalog that aligns provider support status, entry copy, and Rust-side configuration behind one registry for future extension
- `feat(engine)`: complete end-to-end Kimi CLI integration across the engine catalog, session creation, prompt transport, interrupt handling, history / diagnostics, and UI entry points while matching the existing provider lifecycle
- `feat(notes)`: add source-aware note capture and a bottom-of-canvas capture entry from conversation context into the Notes workbench, preserving source metadata, source navigation, collection ownership, and later Composer references
- `feat(git)`: add AI generation for PR titles and bodies from the current diff and branch context, producing editable drafts through the existing confirmation and error-feedback paths
- `feat(cli)`: add CLI lifecycle controls to Vendor Settings headers for Claude, Codex, and Kimi, including local version probing, allowlisted npm registry checks, installed / outdated / unavailable state, and install, update, and refresh actions; Claude install and update now use the official native installer and `claude update`

🔧 Improvements

- `feat(git-history)`: focus Git History on a three-column Branch, Commit, and Details layout, remove the duplicate overview region, and assign default widths at `3:4:3`; author timelines now use stable theme-aware colors derived from email or name and remain consistent across refreshes, pagination, and searches
- `feat(git-history)`: reuse the shared diff-tree compact-folders rules for changed files, collapsing unbranched single-child directory chains while preserving branch boundaries, canonical paths, Windows separators, expansion state, and keyboard behavior
- `feat(git)`: tighten the information density of the multi-repository Git Diff workspace and complete repository-scoped modal previews; stale responses are discarded when rapidly switching identical relative paths, while the full-context loader, edit path, and preview source remain bound to the same repository
- `feat(git)`: move the Git Diff mode selector into the file workbench toolbar, reusing the existing menu, viewport positioning, and mode state through a portal to remove the duplicate content header while remaining usable in narrow layouts
- `fix(git-history)`: add intent, effect, non-effect, and highlighted command previews to Git Pull, Fetch, Sync, and related confirmation surfaces; Pull can combine `--rebase`, `--no-commit`, and `--no-verify`, with explanations and the final payload updating together
- `feat(ui)`: persist whether the Git commit composer appears above or below changed files, expose the control through Behavior preferences and the commit-message engine menu, and improve Markdown file-link parsing, native file opening, and overflow handling for large child-session pill sets
- `feat(messages)`: standardize live and completed reasoning labels, add a Brain icon to the reasoning header, and extend message markdown styling to reasoning blocks so inline code, code blocks, syntax highlighting, Mermaid, LaTeX, links, and related controls stay consistent
- `feat(models)`: remove retired builtin Codex model options and translations, keep the available catalog focused on `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.4`, and leave custom model handling unchanged
- `style(git-history)`: reduce Git History toolbar spacing and strengthen pane boundaries, improving information density and visual hierarchy without sacrificing readability

🐛 Fixes

- `fix(git)`: preserve repository identity across multi-repository file opening, Git Blame, Diff preview, Discard, and File History flows; workspace-root repositories, nested repositories, identical relative paths, and longest-prefix ownership now resolve to the correct scope instead of crossing repositories or being incorrectly disabled
- `fix(git)`: restore the discard action and status refresh for unstaged files in multi-repository workspaces, and fix regressions in repository-switch chrome, group collapsing, and refresh entry points; discard still requires confirmation and refreshes only the target repository after success
- `fix(search)`: stop treating shallow or empty progressive file-tree results as a complete global file index; current and global scopes now hydrate full snapshots with active-first bounded concurrency, distinguish partial, complete, and error states, allow retries, and prevent stale hydration from overwriting a new workspace
- `fix(renderer)`: add circuit-breaker recovery around react-scan initialization and runtime failures, unloading the diagnostic tool and clearing residual state when it crashes so application rendering remains unaffected
- `fix(git)`: unify source/destination identity for renamed and deleted files across Desktop, the remote daemon, and single- or multi-repository flows; file activation, Diff stats, Stage, Unstage, and Discard now share the same alias resolution to avoid opening the wrong path or losing actions
- `fix(codex)`: derive Codex usage labels from the server-provided `windowDurationMins` instead of hard-coding `5h limit` and `Weekly limit`, formatting minute-, hour-, day-, or week-scale windows with a stable fallback for missing or invalid metadata
- `fix(markdown)`: fix Fast Markdown Worker crashes caused by DOM dependencies by separating DOM-free compilation from main-thread sanitization; stale, timed-out, or unavailable requests no longer trigger obsolete fallbacks that could show incorrect previews or amplify main-thread work
- `fix(messages)`: stabilize streaming Timeline updates and history reopening: equivalent parent/overlay writes no longer amplify rerenders, pending threads bypass the history loader, failed or degraded empty results preserve the last-good transcript, and generation guards prevent older requests from overwriting newer sessions
- `fix(runtime)`: stop Codex runtime health probes from triggering `model/list` refreshes, and aggregate repeated `stderr` by redacted signature with rate limits and reserved high-value diagnostics to reduce catalog-refresh and logging storms
- `fix(gemini)`: hard-disable Gemini at frontend, Desktop, and remote-daemon execution boundaries, covering prompt transport and owned-process kill/reap on interrupt, workspace removal, shutdown, and drop; history and diagnostics remain readable, but residual entry points cannot launch or cross-route new work to another Provider
- `fix(kimi)`: converge Kimi session identity, sidebar projection, history restoration, and provider UI state so sessions do not cross provider boundaries or appear twice
- `fix(kanban)`: align Kanban initialization with the shared Codex model catalog, fixing model-list races and stale model assertions
- `fix(git)`: add confirmation guardrails for large PR mutations and fix virtualized gaps in long multi-repository changed-file lists, reducing accidental bulk operations and blank scrolling regions
- `fix(markdown)`: fix large Mermaid diagram fullscreen preview layout and interactions so diagrams keep a readable modal size and reliable close path
- `fix(ui)`: improve macOS shell controls and image preview layering so shell controls are not hidden and image modals stay in the correct stacking context
- `fix(composer)`: align the Codex context-usage indicator styling and tighten send-button sizing to reduce composer footer visual jumps
- `fix(app)`: fix cold-start update loops and stale model assertions so startup no longer repeatedly rerenders or falls back because of stale catalog/settings state

---

### **2026年7月16日（v0.7.4）**

中文：

✨ Features

- 升级应用版本号到 `0.7.4`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(git)`: 将 Composer branch badge 升级为多仓库 Git command center，自动发现 workspace root 与 bounded nested repositories，按仓库展示 branch、upstream、ahead/behind 与 working-tree 摘要；单仓保持直接操作，多仓先选择 repository，再执行 Update、Commit、Push、Create Branch 与 Checkout
- `feat(git)`: 文件树为 root / nested repository 增加 repository-scoped Git submenu 与多仓文件状态投影，支持 Commit、Add、Ignore、Diff、Compare、History、Rollback、Push、Pull、Fetch；所有 write action 显式携带 repository root，并保持 Desktop / remote daemon 与跨平台路径一致
- `feat(git)`: Git 提交面板新增自适应多仓库工作区，同时展示所有 dirty repositories 并按仓库隔离 changed files、stage selection 与 mutation；一次提交可按稳定顺序为多个仓库分别创建 commit / push，支持 partial success、逐仓反馈和失败项保留
- `feat(git-history)`: 多仓库 workspace 的 Git History 保留原 workspace/worktree 层级，并新增独立 repository picker；切换历史目标不会修改主窗口 active workspace，也不会把 child repository 注册成虚构 workspace
- `feat(settings)`: 重构 CLI 配置中心，提供可搜索的 Claude Code / Codex catalog、支持状态、文档入口、official / third-party provider 分区和共享 table 管理；支持编辑 Claude `settings.json`、Codex `config.toml` 与 `auth.json`，并保留 provider 切换、排序、自定义模型和 local provider 工作流

🔧 Improvements

- `perf(app)`: repository discovery 移至 blocking worker 并跳过常见生成目录；Git polling 保留等价 state、避免 background refresh 闪回 loading，并通过 memoized component/callback 与复用 status 结果降低大 workspace 的主线程阻塞和 root render
- `refactor(threads)`: 将高频 streaming latency 的内部诊断 state 与 `useSyncExternalStore` 对外 snapshot 分离，只有可观察类别或 mitigation 变化时才发布新引用，避免 measurement-only delta 触发同步重渲染与 React tearing 检查
- `style(ui)`: 统一 tooltip 延迟与滚轮 dismiss 行为，收敛 sidebar、topbar、footer、file tab 与 settings 的间距、层级和主题色；OpenAI / Codex icon 与 token 视觉改用 theme-aware `currentColor`
- `fix(models)`: 兼容 string/object、camelCase/snake_case 的 reasoning effort metadata，并在 thread 未设置 effort 时回退到 shared Codex selection；reasoning blocks 统一分段、合并与 tool-call boundary 展示

🐛 Fixes

- `fix(codex)`: 新建 `codex-pending-*` 磁盘会话不再被误判为 history restore，首次发送前直接显示可用的空白会话；真正未加载的历史会话仍由专用 loading lifecycle 控制
- `fix(git)`: 稳定多仓库 branch menu 的 repository 切换、折叠 section、搜索展开、submenu positioning 与 loading feedback，并修复显式 repository update 被全局 selection 提前拦截的问题
- `fix(git)`: 修复多仓文件树只消费 active Git root 状态的问题；所有 repository 的 file / ancestor folder decoration 现在在单次 aggregate scan 中合并，partial failure 仅降级对应仓库，dirty repository folder 与普通 changed folder 保持不同视觉语义
- `fix(settings)`: Codex `auth.json` secret 默认遮罩且遮罩态只读，仅写入实际变更的配置文件，拒绝用空 draft 覆盖 credentials，并在 partial write failure 时保留编辑器与逐文件错误，便于安全重试
- `fix(messages)`: 修复 Codex live reasoning prefix 丢失、structured / streaming fragment 段落粘连，以及 Windows drive-letter、UNC、Unicode 与带行号 file link 被错误拼接 workspace path 的问题
- `fix(app)`: 修复 repository status count、daemon push repository-root forwarding、单仓 change/push control 丢失及 nested dialog Escape 传播，降低大仓扫描或配置编辑导致 UI 卡顿与误操作的风险

English:

✨ Features

- Bump the app version to `0.7.4` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(git)`: evolve the Composer branch badge into a multi-repository Git command center that discovers the workspace root and bounded nested repositories, showing branch, upstream, ahead/behind, and working-tree summaries per repository; single-repository workspaces remain direct, while multi-repository workspaces select a target before Update, Commit, Push, Create Branch, or Checkout
- `feat(git)`: add repository-scoped Git submenus and multi-repository file-status projection to root and nested repository rows in the file tree, with Commit, Add, Ignore, Diff, Compare, History, Rollback, Push, Pull, and Fetch; every write action carries an explicit repository root with Desktop / remote daemon and cross-platform path parity
- `feat(git)`: add an adaptive multi-repository Git commit workspace that displays every dirty repository while isolating changed files, stage selection, and mutations by repository; one submission can create and push independent commits in stable order, with partial success, per-repository feedback, and failed selections preserved
- `feat(git-history)`: retain the existing workspace/worktree hierarchy in multi-repository Git History and add a separate repository picker; changing the history target no longer modifies the main window's active workspace or registers child repositories as synthetic workspaces
- `feat(settings)`: redesign the CLI configuration center with a searchable Claude Code / Codex catalog, support status, documentation links, official / third-party provider sections, and shared table management; edit Claude `settings.json`, Codex `config.toml`, and `auth.json` while retaining provider switching, ordering, custom models, and local-provider workflows

🔧 Improvements

- `perf(app)`: move repository discovery onto blocking workers and skip common generated directories; preserve equivalent Git polling state, avoid background refreshes flashing back to loading, and reduce main-thread stalls and root renders in large workspaces through memoized components/callbacks and reused status results
- `refactor(threads)`: separate high-frequency streaming-latency diagnostics from the `useSyncExternalStore` snapshot exposed to React, publishing a new reference only when an observable category or mitigation changes so measurement-only deltas cannot trigger synchronous rerenders or tearing checks
- `style(ui)`: unify tooltip delays and wheel-dismiss behavior, tighten spacing, hierarchy, and theme colors across the sidebar, topbar, footer, file tabs, and settings, and render OpenAI / Codex icons and token visuals with theme-aware `currentColor`
- `fix(models)`: accept reasoning-effort metadata in string/object and camelCase/snake_case forms, fall back to the shared Codex selection when a thread has no effort override, and align reasoning block paragraph merging and tool-call boundaries

🐛 Fixes

- `fix(codex)`: stop treating new `codex-pending-*` disk sessions as history restoration, presenting a usable empty conversation before the first send while retaining the dedicated loading lifecycle for genuinely unloaded history
- `fix(git)`: stabilize repository switching, collapsible sections, search expansion, submenu positioning, and loading feedback in the multi-repository branch menu, and allow explicit repository updates without being blocked by missing global selection
- `fix(git)`: fix the file tree consuming status from only the active Git root; file and ancestor-folder decorations from every repository are now merged in one aggregate scan, partial failures degrade only the affected repository, and dirty repository folders retain semantics distinct from ordinary changed folders
- `fix(settings)`: mask Codex `auth.json` secrets by default and keep the masked editor read-only, write only configuration files that actually changed, refuse to replace credentials with an empty draft, and preserve the editor with per-file errors after partial write failures for safe retry
- `fix(messages)`: preserve Codex live reasoning prefixes, keep structured and streaming fragments in readable paragraphs, and correctly resolve Windows drive-letter, UNC, Unicode, and line-qualified file links without incorrectly prefixing the workspace path
- `fix(app)`: correct repository status counts, daemon push repository-root forwarding, missing single-repository change/push controls, and nested-dialog Escape propagation, reducing UI stalls and unsafe interactions during large repository scans or configuration editing

---

### **2026年7月15日（v0.7.3）**

中文：

✨ Features

- 升级应用版本号到 `0.7.3`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(i18n)`: 语言支持扩展到 10 种，并在设置页提供语言下拉入口，语言解析、切换与持久化流程同步覆盖新语言
- `feat(sidebar)`: 侧栏线程列表 hydration 前显示加载占位，避免工作区会话恢复期间出现空白区域
- `feat(ui)`: 对齐 Codex 消息渲染与 workspace navigation，收敛 Codex 输出展示、侧栏 workspace 卡片和相关导航行为
- `feat(file-markdown)`: README 风格 Markdown 改为单次完整渲染，保留 raw HTML 对齐容器、图片尺寸和引用式图片；本地图片增加 remount cache，批注编辑器改为不挤压正文的浮层，并统一使用主题色令牌
- `feat(messages)`: 回合文件变更汇总中的文件可直接打开现有 Git Diff modal，并默认以最大化模式查看对应 staged / unstaged 差异

🔧 Improvements

- `refactor(i18n)`: 将中英文大体积 part locale 拆分为 per-namespace locale folder，降低翻译文件维护与局部更新成本
- `refactor(git)`: 统一主 Git 面板、Git History worktree 与 commit details 的 changed-file renderer 和弹窗预览链路，收敛文件树、键盘激活与 editable / read-only Diff 入口，避免同类界面继续分叉
- `build(i18n)`: 新增本地化构建、抽取、分块检查与 merge workflow，为多语言扩展提供可重复的脚本链路

🐛 Fixes

- `fix(terminal)`: 终端选中文本发送到 Composer 时不再重复插入内容，并补充外部输入回显回归覆盖
- `fix(markdown)`: 保留 Markdown / LaTeX 公式容器边界并避免重复包裹，兼容紧凑多行公式写法
- `fix(settings)`: 语言选择器改用 native select，移除 Radix portaled popup 几何计算链，修复 WebView UI Scale 大于 100% 时出现页面级空白浮层的问题
- `fix(app)`: 原生文件拖拽离开应用窗口时正确结束 drag lifecycle，避免 Composer / workspace overlay 残留；未完成首次 hydration 的展开 workspace 始终显示加载占位，不再短暂空白或展示过期会话
- `fix(session)`: Codex 子代理会话按 canonical parent-child relationship 投影到侧栏树，并按 child UUID 去重，避免子代理显示为顶层会话或重复占用列表与 usage 统计
- `fix(messages)`: 恢复新增文件在消息幕布中的原地 inline Diff，将 `*** Add File` patch 转换为可预览的新增行，避免空白预览或首次点击跳转到其他页面
- `fix(threads)`: Fork 后保留正确的 provider、父线程与 sidebar projection，并修复 Claude 幕布在会话切换、恢复和 rewind 后的生命周期残留
- `fix(codex)`: 已结束的 Codex turn 不再被迟到的 progress / item event 重新标记为加载中，避免会话完成后恢复 spinner 或 processing 状态
- `fix(diff)`: 修复大文件 Diff 在大量插入或删除后左右内容逐步错位的问题，按连续差异块导航，并以运行时行高和斜线 gap 保持双栏像素级对齐、区分真实空行与补位区域
- `fix(files)`: 编辑并保存 Windows CRLF 或 legacy CR 文件时保留原始换行格式，避免 CodeMirror 的 LF normalization 造成整文件伪 Diff 或保存后持续显示 dirty

English:

✨ Features

- Bump the app version to `0.7.3` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(i18n)`: expand language support to 10 languages and add a language dropdown in settings, with language resolution, switching, and persistence updated for the expanded set
- `feat(sidebar)`: show a loading placeholder before thread-list hydration so restored workspaces no longer present a blank sidebar area
- `feat(ui)`: align Codex message rendering and workspace navigation, tightening Codex output presentation, workspace cards, and related sidebar navigation behavior
- `feat(file-markdown)`: render README-style Markdown in one complete pass to preserve raw HTML alignment wrappers, image dimensions, and reference images; cache resolved local images across remounts, move annotation editing into a non-disruptive popover, and align its styling with theme tokens
- `feat(messages)`: open files from turn-level change summaries in the existing Git Diff modal, maximized by default and resolved against the current staged / unstaged model

🔧 Improvements

- `refactor(i18n)`: split large English and Chinese part locale files into per-namespace locale folders to make translation maintenance and localized updates more targeted
- `refactor(git)`: unify the changed-file renderer and preview-modal flow across the main Git panel, Git History worktree, and commit details, consolidating file trees, keyboard activation, and editable / read-only Diff entry points so equivalent surfaces no longer drift apart
- `build(i18n)`: add repeatable localization scripts for build, extraction, chunk checks, and merge workflows

🐛 Fixes

- `fix(terminal)`: prevent duplicated text when sending a terminal selection to the Composer, with regression coverage for external input echo behavior
- `fix(markdown)`: preserve Markdown / LaTeX math container boundaries and avoid duplicate wrapping, including compact multi-line formula layouts
- `fix(settings)`: move the language selector to a native select and remove the Radix portaled-popup geometry path, fixing the page-sized blank popup at WebView UI Scale values above 100%
- `fix(app)`: settle the native drag lifecycle when files leave the application window so Composer and workspace overlays cannot remain stuck; keep a loading placeholder visible for expanded workspaces until their initial hydration completes instead of briefly showing a blank or stale session list
- `fix(session)`: project Codex subagent sessions into the sidebar using canonical parent-child relationships and deduplicate by child UUID, preventing subagents from appearing as top-level sessions or being counted twice in lists and usage totals
- `fix(messages)`: restore in-place inline Diffs for newly added files by translating `*** Add File` patches into previewable added lines, avoiding blank previews and first-click navigation away from the conversation
- `fix(threads)`: preserve the correct provider, parent thread, and sidebar projection after Fork, and clear stale Claude conversation-curtain lifecycle state across session switches, recovery, and rewind
- `fix(codex)`: keep settled Codex turns terminal when late progress or item events arrive, preventing completed conversations from returning to spinner or processing states
- `fix(diff)`: fix progressive left/right misalignment after large insertions or deletions, navigate by contiguous difference blocks, and use runtime line heights with hatched gaps to preserve pixel-level alignment while distinguishing real blank lines from alignment placeholders
- `fix(files)`: preserve the original line endings when editing and saving Windows CRLF or legacy CR files, preventing CodeMirror LF normalization from creating whole-file false Diffs or leaving documents perpetually dirty

---

### **2026年7月13日（v0.7.2）**

中文：

✨ Features

- 升级应用版本号到 `0.7.2`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(search)`: 全局搜索结果按文件、看板、会话、消息、历史、技能与命令分组展示，文件结果以文件名作为主标题并保留完整路径；跨分组的键盘选择、排序与打开行为保持不变
- `feat(web)`: 打通 Web 前端资源下载安装闭环 —— Release 额外生成一份跨平台版本化 ZIP 与 SHA-256，设置页支持状态检测、下载安装、同版本修复、本地包安装与重新检测；backend 在原子替换前完成 checksum、ZIP path、manifest、版本和入口校验，资源未就绪时阻止本地 Web Service 启动且不破坏已有可用版本

🐛 Fixes

- `fix(ui)`: 从结构上消除 Tooltip 首次启动更新回环 —— `TooltipIconButton` 改用 native button 与 Floating UI portal，退出 Radix `PopperAnchor / SlotClone` 组合，修复 `Maximum update depth exceeded` 导致 AppShell 被 ErrorBoundary 替换的问题
- `fix(sidebar)`: 会话行正常态不再批量挂载 Radix Tooltip / Popover provider 与 anchor，删除确认仅在交互时按需挂载；修复首次安装启动、批量恢复会话时的 React #185，同时保留 tooltip、置顶、删除与键盘交互
- `fix(ui)`: 将 `@radix-ui/react-presence` 固定到兼容 React 19 的 `1.1.6`，修复首次启动 React 渲染崩溃

English:

✨ Features

- Bump the app version to `0.7.2` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(search)`: group global search results into files, kanban items, threads, messages, history, skills, and commands; use the basename as each file result's primary title while preserving its full path, ranking, cross-group keyboard navigation, and open behavior
- `feat(web)`: complete the Web frontend assets installation flow — publish one cross-platform versioned ZIP plus SHA-256 with each Release, add status checks, download/install, same-version repair, local-package install, and recheck actions to settings, and validate checksums, ZIP paths, manifests, versions, and entrypoints before atomic activation; local Web Service startup stays blocked until assets are ready without damaging an existing valid installation

🐛 Fixes

- `fix(ui)`: structurally remove the startup Tooltip update loop by moving `TooltipIconButton` to a native button with a Floating UI portal and out of the Radix `PopperAnchor / SlotClone` composition, preventing `Maximum update depth exceeded` from replacing AppShell with the ErrorBoundary
- `fix(sidebar)`: stop mounting Radix Tooltip / Popover providers and anchors for every idle thread row, and mount delete confirmation only on demand; this fixes React #185 during first-run bulk session hydration while preserving tooltip, pin, delete, and keyboard behavior
- `fix(ui)`: pin `@radix-ui/react-presence` to the React 19-compatible `1.1.6` release to fix the first-launch React render crash

---

### **2026年7月12日（v0.7.1）**

中文：

✨ Features

- 升级应用版本号到 `0.7.1`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(note-cards)`: 将便签从右侧窄面板迁移到中央 `1:2` 分栏工作台，宽屏采用可搜索的 Master-Detail 列表与编辑器、窄屏自动回退上下布局；支持分隔线拖动、键盘调整、双击复位和比例持久化
- `feat(note-cards)`: 加固便签编辑工作流 —— 增加 dirty draft 保护与保存状态反馈，切换便签、collection 或新建前不再静默覆盖草稿；支持归档撤销、永久删除确认，并可将当前便签显式引用到 Composer
- `feat(messages)`: 对话时间线新增回合级文件变更汇总卡，聚合每轮编辑文件数、增删行与失败状态，历史回合显示 inline card、最新回合显示 session cumulative card，并支持长列表展开

🔧 Improvements

- `perf(ui)`: 降低 idle chrome 的样式重算与渲染成本 —— 将 scrollbar 样式从全局 `*` 收窄到明确的 scroll container，非活动 workspace diff 直接卸载，文件树虚拟化阈值从 250 降至 30，并为 Prism highlight、DiffBlock、GitDiffViewer 与侧栏更新增加缓存或稳定引用
- `feat(ui)`: 前端产品入口收敛到 Claude 与 Codex，移除 MCP 设置与 AI commit message 菜单中的 Gemini / OpenCode 入口
- `style(ui)`: Runtime Pool 与加载弹窗统一使用 shadcn semantic tokens；侧栏会话行仅在 hover / focus 时为 pin toggle 预留空间，静止态更紧凑
- `docs(openspec)`: 校准并归档便签工作台、idle render performance 等已完成变更

🐛 Fixes

- `fix(terminal)`: 终端面板跟随应用亮暗主题并限制在主内容列，不再遮挡右侧文件面板；移除重复分隔线并修复暗色模式下的亮色 scrollbar gutter
- `fix(messages)`: 新回合等待回复时，将上一回合的文件变更卡固定在原回合边界，避免累计卡漂移到新用户消息之后
- `fix(ui)`: 修复 Tooltip trigger 更新回环导致的会话区域空白，并补充重复 rerender 回归测试

English:

✨ Features

- Bump the app version to `0.7.1` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(note-cards)`: move notes from the narrow right panel into a central `1:2` split workbench with a searchable Master-Detail list/editor on wide screens and a stacked fallback on narrow screens; support pointer and keyboard resizing, double-click reset, and persisted split ratios
- `feat(note-cards)`: harden the note editing workflow with dirty-draft protection and explicit save states so switching notes, collections, or creation cannot silently overwrite work; add archive undo, permanent-delete confirmation, and an explicit action to reference the active note in the Composer
- `feat(messages)`: add turn-level file-change summary cards to the conversation timeline, aggregating edited files, added/deleted lines, and failures; historical turns use inline cards, the latest turn uses a session-cumulative card, and long file lists can expand

🔧 Improvements

- `perf(ui)`: reduce idle chrome style recalculation and rendering cost by scoping scrollbar rules to explicit scroll containers, unmounting inactive workspace diffs, lowering the file-tree virtualization threshold from 250 to 30, and adding caching or stable references around Prism highlighting, DiffBlock, GitDiffViewer, and sidebar updates
- `feat(ui)`: narrow frontend product entry points to Claude and Codex by removing Gemini / OpenCode from MCP settings and AI commit-message menus
- `style(ui)`: align Runtime Pool and the loading dialog with shadcn semantic tokens, and reserve sidebar pin-toggle space only on hover or focus for denser idle rows
- `docs(openspec)`: align and archive completed changes for the note workbench, idle render performance, and related work

🐛 Fixes

- `fix(terminal)`: make the terminal follow the app theme and stay within the main content column so it no longer covers the right file panel; remove duplicate dividers and the bright scrollbar gutter in dark mode
- `fix(messages)`: pin the previous turn's file-change card to its own boundary while a new turn is pending instead of letting the cumulative card drift below the new user message
- `fix(ui)`: fix the Tooltip trigger update loop that could blank the conversation area, with repeated-rerender regression coverage

---

### **2026年7月10日（v0.7.0）**

中文：

✨ Features

- 升级应用版本号到 `0.7.0`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(claude)`: AskUserQuestion 走出 Plan 模式 —— 通过进程内 MCP 桥在 default / acceptEdits 模式下重新暴露 AskUserQuestion 工具，agent 可以在回合中途弹出结构化单选问题卡片，无需 kill/resume 循环；提问卡片锚定到自身请求（askuserquestion-<request_id>）固定在输入框上方，不再随长回合流式滚出视野；线程有待回答提问时暂缓 Composer 发送队列；MCP 服务器以每进程随机 bearer token 鉴权，拒绝本机其他进程伪造弹窗
- `feat(settings)`: 设置页新增 MCP 服务器面板 —— 展示 Claude 启动时上报的运行时 MCP 服务器（按工作区快照），内置 ccgui 服务器带徽标，无服务器时显示空态
- `feat(git)`: 支持可编辑双栏差异预览（IDEA 风格的工作区 diff 编辑体验）
- `feat(git)`: AI 提交信息生成新增「使用上次配置」快捷项 —— 记住上次的引擎/语言组合（localStorage 持久化），一键直接重新生成，从三次点击降到一次；顶栏会话 tab 按引擎染色下划线（Codex / Gemini / Claude 各自品牌色）
- `feat(threads)`: 改进会话标题与线程行展示 —— 斜杠命令记录先解包 `<command-args>` 再取标题，不再泄漏 `<command-m` 之类的原始标记；默认标题上限从 10 字符提到 50、会话预览从 45 提到 60；子代理线程行改用本地化「Subagent」文字标签；线程行悬停 tooltip 展示完整名称
- `feat(menu)`: 原生菜单栏按已保存的界面语言本地化 —— Rust 侧新增 MenuLabels 按语言构造菜单文案（含终端 / 开发者工具项），Linux 启动时即以目标语言构建菜单，切换语言下次启动生效

🔧 Improvements

- `perf(messages)`: 四项定点优化削减流式卡顿 —— 流式 tick 间缓存 exit-plan 去重与消息操作目标计算不再逐 token 全量重扫、同一 flush tick 内被覆盖的 item/updated 快照按 (workspace, thread, item) 合并只留最新、流式动画全部改为合成器友好实现（shimmer / spinner / agent 图标去掉逐帧重绘）、Bash 输出按绝对行号 key 让滑动截断窗口复用 DOM
- `perf(composer)`: @-mention 自动补全 memo 化，修复输入时逐键卡顿
- `build`: 缩减包体积 —— 前端资源去重（不再二进制内嵌 + dist 双份打包，改为按版本导出到应用数据目录供 daemon web 服务使用）、release profile 开启 strip + fat LTO + opt-level "s"、Windows 安装器 WebView2 从离线运行时改为 embedBootstrapper 按需下载
- `docs(openspec)`: 补齐 AskUserQuestion MCP 桥、Linux 原生菜单本地化、流式渲染性能、/compact 时长上限移除、MCP 服务器面板等变更提案

🐛 Fixes

- `fix(compact)`: 移除手动 `/compact` 的 120 秒总时长硬上限 —— 大上下文压缩本就需要数分钟，之前会在进行中被强杀；真正的挂起保护仍由 90 秒首事件看门狗承担
- `fix(history)`: 恢复 Claude 会话时保留带参数的斜杠命令用户提问 —— `<command-args>` 有实际内容的用户记录不再被当作内部记录隐藏（前后端分类器同步修正），无参数的控制命令（/resume、/clear）仍保持过滤
- `fix(messages)`: 修复 exit-plan 去重在 identity 级重算时失效 —— 选区冻结触发的引用级重算不再把已去重的尾项写回结果，杜绝「执行计划就绪」卡片复活重复
- `fix(dev)`: 修复本地开发前置检查
- `fix(composer)`: 修复 WebView 图片粘贴
- `fix(menu)`: 对齐中文原生菜单「切换右侧边栏」文案与 i18n 源

English:

✨ Features

- Bump the app version to `0.7.0` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(claude)`: AskUserQuestion beyond plan mode — re-expose AskUserQuestion as an in-process MCP tool in default/acceptEdits modes so agents can ask structured, one-tap questions mid-turn without a kill/resume cycle; the ask card anchors to its own request (askuserquestion-<request_id>) and stays pinned above the composer instead of scrolling away with a long streaming turn; the composer send queue holds while a thread has a pending ask; the MCP server authenticates with a per-process random bearer token so no other local process can forge a native-looking dialog
- `feat(settings)`: add an MCP servers panel to settings — show the runtime MCP servers Claude reports at init (per-workspace snapshot), badge the built-in ccgui server, and render an empty state when none are reported
- `feat(git)`: support an editable two-pane diff preview (IDEA-style editable workspace diff)
- `feat(git)`: add a "use last configuration" quick option to AI commit message generation — remember the last engine/language pair (persisted in localStorage) and regenerate with one click instead of three; topbar session tabs get engine-branded active underlines (Codex / Gemini / Claude)
- `feat(threads)`: improve session titles and thread row display — unwrap `<command-args>` from slash-command records before deriving titles so raw markup like `<command-m` no longer leaks; raise the default title limit from 10 to 50 chars and session previews from 45 to 60; replace the engine badge with a localized "Subagent" text tag on subagent rows; wrap thread rows in a tooltip showing the full name
- `feat(menu)`: localize the native menu bar in the saved UI language — a Rust-side MenuLabels struct builds every menu item (including terminal/devtools) per language, Linux builds the menu in-language up front, and a live language switch applies on the next launch

🔧 Improvements

- `perf(messages)`: reduce streaming lag with four targeted fixes — cache exit-plan dedupe and message-action-target computation across streaming ticks instead of rescanning the full history per token, coalesce superseded item/updated snapshots per (workspace, thread, item) within a flush tick, replace per-frame streaming animations with compositor-friendly equivalents (shimmer / spinner glow / agent icon), and key Bash output lines by absolute index so the sliding truncation window reuses DOM
- `perf(composer)`: memoize the @-mention autocomplete to fix the per-keystroke stall
- `build`: cut bundle size via web asset dedup and release profile tuning — stop shipping the frontend twice (export embedded assets once per version to app data for the daemon web service instead of bundling a dist/ copy), enable strip + fat LTO + opt-level "s" in the release profile, and switch the Windows installer's WebView2 mode from offlineInstaller to embedBootstrapper
- `docs(openspec)`: backfill change proposals for the AskUserQuestion MCP bridge, Linux native menu localization, streaming render performance, the /compact wall-clock cap removal, and the MCP servers panel

🐛 Fixes

- `fix(compact)`: remove the fixed 120s wall-clock cap on manual `/compact` — compacting a large context legitimately takes minutes and was killed mid-progress; true hang protection remains with the 90s first-event watchdog
- `fix(history)`: keep slash-command user prompts with args visible when restoring Claude sessions — user records whose `<command-args>` carry real content are no longer classified as hidden internal records (Rust and frontend classifiers fixed in lockstep), while argument-less control commands (/resume, /clear) stay filtered
- `fix(messages)`: keep exit-plan dedupe intact across identity-level recompute — a selection-freeze-driven reference-level recompute no longer writes the deduped tail entry back onto the result, so the duplicate "Execution Plan Ready" card can't resurrect
- `fix(dev)`: fix the local development pre-flight checks
- `fix(composer)`: fix image pasting in the WebView
- `fix(menu)`: sync the Chinese native menu "Toggle Right Sidebar" label with the i18n source

---

### **2026年7月9日（v0.6.9）**

中文：

✨ Features

- 升级应用版本号到 `0.6.9`，同步前端包配置与 Tauri 打包配置
- `feat(threads)`: Codex 会话乐观创建 —— 点击新建后会话立即出现在侧栏（先创建 `codex-pending-*` 占位线程并在后台预热 thread/start），首条消息发送时无缝换绑到真实线程 id；全新线程在启动确认阶段直接软就绪，跳过约 5.8s 的重试等待，新建会话从数秒白等降至即时可用
- `feat(codex)`: 侧栏工作区菜单记住上次选择的 Codex provider —— 子菜单里选 provider 只记录偏好（localStorage 持久化）不再立即建会话，主入口一键用记住的 provider 创建；子菜单项带选中勾选标记与 `menuitemradio` 无障碍语义，并支持 ArrowRight 键盘展开
- `feat(codex)`: 添加 5.6 系列模型

🔧 Improvements

- `refactor(app-shell)`: 继续拆解 AppShell 根组件，将 git 工作区操作、worktree chrome、OpenCode 线程绑定、回合结束 git 状态刷新、协作模式同步、Claude 模型刷新、工作区路径接入等七块内联逻辑抽为 `app-shell-parts` 下带独立单测的 hooks；顺带修复全新线程会在持久化引擎偏好加载完成前被提前种子化默认模型的问题
- `docs(openspec)`: 归档实时对话渲染提案

🐛 Fixes

- `fix(codex)`: 加固 pending 线程换绑与删除的竞态 —— 排队消息迁移改为仅在 finalize 记录的别名确认后执行，避免手动切换到无关 Codex 线程时队列被误路由；finalize 每一步检查删除标志，删除中的线程不再被复活、也不再产生孤儿后端线程；发送路径统一使用 finalize 解析后的线程 id
- `fix(threads)`: 修复直播文字与工具块的渲染割裂 —— 分段递增前先将直播正文尾段回灌 reducer 防止段落文本丢失，工具启动时清空已积累的 agent 文本，回合完成只落地最后一段
- `fix(messages)`: 修复发送消息触发虚拟化开启时行高全按估算布局、新气泡与上一条长回复重叠的问题（虚拟化翻转瞬间立即实测行高）
- `fix(messages)`: 通用工具块 marker 改为仅保留右侧内边距，图标与相邻文件行 / Explore 行在同一垂直基线对齐
- `fix(git)`: 修复子仓库文件打开路径
- `fix(git)`: 对齐 Hub 文件列表选择 UI

English:

✨ Features

- Bump the app version to `0.6.9` across frontend package metadata and Tauri bundle configuration
- `feat(threads)`: optimistic Codex session creation — new sessions appear in the sidebar instantly (a `codex-pending-*` placeholder thread is created and thread/start is prewarmed in the background), then seamlessly rebind to the real thread id on the first send; brand-new threads soft-ready immediately during start confirmation, skipping the ~5.8s retry ladder
- `feat(codex)`: remember the last picked Codex provider in the sidebar workspace menu — picking a provider in the submenu now only records the choice (persisted in localStorage) instead of creating a session, and the main Codex entry creates sessions with the remembered provider; submenu items carry a selected check mark with `menuitemradio` semantics, and the flyout opens with ArrowRight for keyboard access
- `feat(codex)`: add the 5.6 model series

🔧 Improvements

- `refactor(app-shell)`: continue the AppShell decomposition by extracting seven inline logic blocks — git workspace ops, worktree chrome, OpenCode thread binding, turn-settle git status refresh, collaboration mode sync, Claude model refresh, and workspace paths intake — into individually tested hooks under `app-shell-parts`; also fix brand-new pending threads being seeded with the engine default model before persisted engine preferences finished loading
- `docs(openspec)`: archive the live conversation rendering proposal

🐛 Fixes

- `fix(codex)`: harden pending-thread rebind and delete races — queued-message migration now requires the alias recorded by the finalize flow, so manually switching to an unrelated Codex thread no longer misroutes the queue; every finalize step checks the deleted flag so a delete racing a finalize neither resurrects the thread nor mints an orphan backend thread; the send path always re-enters with the finalize-resolved thread id
- `fix(threads)`: fix live text / tool block rendering splits — drain the live assistant text tail into the reducer before incrementing the agent segment so segment text is not lost, clear accumulated agent text on tool start, and land only the last segment on turn completion
- `fix(messages)`: fix rows being laid out at estimated heights when sending a message flips virtualization on, which made the new bubble overlap the previous long reply (measure rows immediately on the flip)
- `fix(messages)`: switch the generic tool block marker to right-only padding so its leading icon sits on the same vertical baseline as adjacent file rows and Explore rows
- `fix(git)`: fix file-open paths for sub-repositories
- `fix(git)`: align the Hub file list selection UI

---

### **2026年7月8日（v0.6.8）**

中文：

✨ Features

- 升级应用版本号到 `0.6.8`，同步前端包配置与 Tauri 打包配置
- `feat(files)`: 新增工作区文件对比工具 —— 文件树多选（2–4 个文件）右键发起对比，新增顶部功能区入口可打开临时左右文本对比面板；独立 fileCompare 中心模式复用现有 CodeMirror 编辑，支持行级差异、高亮、差异导航、轻量同步滚动与缺失行 gap 对齐
- `feat(messages)`: 消息幕布锚点栏下方新增「直达底部」按钮，一键回到最新消息并恢复实时跟随
- `feat(browser-agent)`: Browser Dock 新增网页元素选择器 —— 进入选择模式后连续点选一个或多个可见元素，将结构化元素证据（URL / 标题 / 文本 / 角色 / 位置 / 隐私元数据）注入当前 Composer 提问；同时调大默认窗口尺寸，避免常见网页首屏被压扁变形

🔧 Improvements

- `perf(dialogue)`: 流式正文改走 `liveAssistantTextChannel` 外部化通道，去除根链高频 setState 与 orchestration / taskRun store 的秒级轮询双胞胎（改为写入即广播），debug 日志在面板关闭时缓冲，显著降低对话过程的主线程开销
- `perf(streaming)`: 修复对话流式输出卡顿并优化渲染路径 —— 节流诊断落盘、关闭 DEV 默认 trace、流式 lightweight markdown 与 delta flush 降频，并补充虚拟化与 hotspot 观测
- `fix(storage)`: 降低客户端存储写入与诊断空转开销 —— store patch 改为进程内缓存 + compact JSON，启动后清理存量大数据，高频 diagnostics / shadow transcript 改为过滤截断节流，Kanban 图片改为 best-effort 落盘后只保存文件路径

🐛 Fixes

- `fix(editor)`: 按工作区恢复文件标签并修正最大化布局 —— 文件最大化时隐藏外层 composer 占满内容区，文件标签状态改为 workspace-scoped，切换工作区时保留各自打开的文件与 active tab
- `fix(messages)`: 修复流式滚动更新回环
- `fix(messages)`: 手动上滑后恢复焦点跟随并重新滚到底部

English:

✨ Features

- Bump the app version to `0.6.8` across frontend package metadata and Tauri bundle configuration
- `feat(files)`: add a workspace file compare tool — multi-select 2–4 files in the file tree to start a comparison via the context menu, and open an ad-hoc left/right text compare panel from a new top entry; a dedicated fileCompare center mode reuses the existing CodeMirror editor with line-level diffs, highlighting, diff navigation, lightweight synced scrolling, and missing-line gap alignment
- `feat(messages)`: add a “jump to bottom” button below the message curtain anchor rail to return to the latest message and re-arm live auto-follow
- `feat(browser-agent)`: add a page element selector to the Browser Dock — enter selection mode to click one or more visible elements and inject structured element evidence (URL / title / text / role / bounds / privacy metadata) into the active Composer, and enlarge the default window size so common pages are no longer visually compressed

🔧 Improvements

- `perf(dialogue)`: externalize streaming body text onto the `liveAssistantTextChannel`, drop high-frequency root setState and the per-second polling twins in the orchestration / taskRun stores (broadcast on write instead), and buffer debug logs while the panel is closed, significantly lowering main-thread cost during conversations
- `perf(streaming)`: fix conversation streaming jank and optimize the render path — throttle diagnostics persistence, disable the default DEV trace, lower lightweight-markdown and delta-flush frequency, and add virtualization/hotspot instrumentation
- `fix(storage)`: reduce client store write and idle diagnostics cost — move store patches to an in-process cache with compact JSON, clean up accumulated large data on startup, filter/truncate/throttle high-frequency diagnostics and shadow transcript writes, and persist Kanban images to disk best-effort while storing only the file path

🐛 Fixes

- `fix(editor)`: restore file tabs per workspace and fix the maximize layout — hide the outer composer when a file is maximized so it fills the content area, make file-tab state workspace-scoped, and keep each workspace’s open files and active tab when switching
- `fix(messages)`: fix the streaming scroll update loop
- `fix(messages)`: re-arm focus follow and scroll back to bottom after a manual scroll up

---

### **2026年7月6日（v0.6.7）**

中文：

✨ Features

- 升级应用版本号到 `0.6.7`，同步前端包配置、lockfile 与 Tauri 打包配置
- `feat(files)`: 文件树根标题栏新增创建文件、创建文件夹与刷新操作，并显示当前 workspace root 标签，让根目录操作不再藏在上下文菜单里
- `feat(diff)`: Git Diff 模式菜单恢复仓库切换入口，同时保留紧凑工具栏布局

🔧 Improvements

- `refactor(diff)`: Git 变更列表拆成可折叠的 staged / unstaged 分区，使用更轻的数量徽标、警示色修改标记与紧凑文件行，减少 diff 面板噪音
- `refactor(app-shell)`: 将权限、Composer 偏好、desktop chrome、编辑器布局、搜索面板与 agent radar 编排拆入 `app-shell-parts`，降低主壳层大文件债务
- `refactor(tauri)`: 将 `src/services/tauri.ts` 收敛为 facade，并按 commit message、email、file picker、menu、messaging、settings、skills、window、workspace config 等领域拆分 wrapper
- `refactor(types)`: 将全局 `src/types.ts` 拆成 workspace、conversation、settings、runtime、git、engine 等领域类型文件，同时保持原 import path 兼容
- `refactor(markdown)`: 抽出 Markdown 文本 normalizer 与 code/pre 解析 helper，并补充纯函数回归测试
- `refactor(thread-items)`: 拆出用户消息、时间元数据、生成图片与计划条目 helper，降低 thread item 构造逻辑的维护成本
- `refactor(i18n)`: 拆分 model、permission mode、runtime notice、approval、task output 等文案命名空间，减小 locale part 文件体积
- `chore(large-files)`: 新增 800 行以上新文件棘轮 baseline，阻止后续新增大文件绕过 large-file gate
- `docs(openspec)`: 补齐并归档近期 UI、消息、设置、性能、构建与运行时稳定性变更提案

🐛 Fixes

- `fix(desktop)`: 长回复完成恢复完整历史后保持聊天窗口定位在末尾，并让 Windows 标题栏拖拽在首次有效移动时立即触发
- `fix(codex)`: 启动 / 后台检测改为仅解析 Codex CLI 元数据路径，避免打开应用时执行失效或被系统拦截的 CLI 并弹出 macOS 安全提示

English:

✨ Features

- Bump the app version to `0.6.7` across frontend package metadata, the lockfile, and Tauri bundle configuration
- `feat(files)`: add create-file, create-folder, and refresh actions to the File Tree root header, with the active workspace root label visible
- `feat(diff)`: restore Git repository switching through the Git Diff mode menu while keeping the compact toolbar layout

🔧 Improvements

- `refactor(diff)`: split Git changes into collapsible staged / unstaged sections with quieter count badges, warning-colored modified markers, and compact file rows
- `refactor(app-shell)`: move access mode, Composer preference persistence, desktop chrome, editor layout, search palette, and agent radar orchestration into `app-shell-parts`
- `refactor(tauri)`: turn `src/services/tauri.ts` into a facade and split wrappers by domain, including commit messages, email, file pickers, menu, messaging, settings, skills, window, and workspace config
- `refactor(types)`: split the global `src/types.ts` bucket into workspace, conversation, settings, runtime, git, engine, and other domain files while preserving the public import path
- `refactor(markdown)`: extract Markdown text normalizers and code/pre parsing helpers with focused pure-function regression tests
- `refactor(thread-items)`: extract user-message, timing, generated-image, and plan-item helpers to lower the maintenance cost of thread item construction
- `refactor(i18n)`: split model, permission-mode, runtime-notice, approval, and task-output copy into dedicated locale namespaces
- `chore(large-files)`: add a new-file ratchet baseline for files over 800 lines so future large files cannot bypass the large-file gate
- `docs(openspec)`: fill in and archive recent change proposals for UI, messages, settings, performance, build, and runtime-stability work

🐛 Fixes

- `fix(desktop)`: keep the chat view pinned to the bottom after long replies restore full history, and trigger Windows titlebar dragging on the first valid movement
- `fix(codex)`: switch startup/background Codex detection to metadata-only path resolution so opening the app does not execute stale or blocked CLI binaries and trigger macOS security prompts

---

### **2026年7月5日（v0.6.6）**

中文：

✨ Features

- 升级应用版本号到 `0.6.6`，同步前端包配置与 Tauri 打包配置
- `feat(sidebar)`: 一级导航新增「插件」入口（Puzzle 图标、默认置灰），点击弹出「即将开放」提示

🔧 Improvements

- `refactor(diff)`: 重构 Git 差异面板工具栏 —— 平铺 / 树形切换与历史入口收敛进模式下拉菜单，工具组改为常驻显示，不再依赖 hover 浮现
- `refactor(diff)`: 提交区默认展开，文件 / 文件夹改用彩色文件树图标；diff.css 全面迁移到 shadcn 令牌并新增圆角阶梯
- `refactor(thinking)`: 思考可见性写死常开，忽略下游上报，避免设置读取时机把它翻回关闭
- `refactor(ui)`: 收敛对话与设置侧细节 —— 思考块移除标题图标、正文降噪，会话雷达历史默认折叠，侧栏标题 / 线程标题统一字重字号与颜色令牌

🐛 Fixes

- `fix(engine)`: 收到 result 后给 stderr 抽干加 2s 超时上限，避免逃逸进程组的后代（MCP server / Stop hook）持有继承的 stderr 写端导致回合卡在「生成中」
- `fix(settings)`: 修复 Radix ScrollArea 宽内容导致设置整页右移，长文本改为内部滚动
- `fix(diff)`: 消息内联 diff 去除 hunk 头（@@…@@）与自带边框，消除与外层 marker 叠成的双层边框噪音

English:

✨ Features

- Bump the app version to `0.6.6` across frontend package metadata and Tauri bundle configuration
- `feat(sidebar)`: add a “Plugins” entry to the primary navigation (Puzzle icon, disabled by default) that opens a “coming soon” notice on click

🔧 Improvements

- `refactor(diff)`: rework the Git diff panel toolbar — fold the flat/tree toggle and history entry into a mode dropdown, and keep the tool group always visible instead of hover-revealed
- `refactor(diff)`: expand the commit area by default, switch files/folders to colored file-tree icons, and migrate diff.css fully to shadcn tokens with a new radius scale
- `refactor(thinking)`: hardwire thinking visibility to always-on and ignore downstream reports so settings-read timing can’t flip it back off
- `refactor(ui)`: tighten conversation and settings details — strip the thinking-block title glyph and soften its body, collapse the session radar history by default, and unify sidebar/thread title weight, size, and color tokens

🐛 Fixes

- `fix(engine)`: cap the post-result stderr drain at 2s so descendants that escape the process group (MCP server / Stop hook) holding an inherited stderr write end can’t stall the turn in “generating”
- `fix(settings)`: fix the whole settings page shifting right on wide Radix ScrollArea content by scrolling long text internally instead
- `fix(diff)`: drop the hunk header (@@…@@) and self border from the inline message diff to remove the double border stacked with the outer marker

---

### **2026年7月4日（v0.6.5）**

中文：

✨ Features

- 升级应用版本号到 `0.6.5`，同步前端包配置与 Tauri 打包配置
- `feat(settings)`: 优化快捷键录入交互，并统一供应商面板配色
- `feat(sidebar)`: 侧栏底部新增可点击的版本号标签

🔧 Improvements

- `refactor(app-shell)`: 从主顶栏移除分支切换与 worktree 重命名 UI
- `refactor`: 重设计设置面板，并稳定空闲轮询渲染
- `perf(conversation)`: 压制长对话流式渲染的 O(L²) 与全历史开销
- `perf(markdown)`: 轻量流式 / 纯代码块跳过 heavy-islands 的每 token 重扫
- `refactor(ui)`: 精修搜索面板、设置导航与侧栏视觉细节
- `refactor(release-notes)`: 重构版本记录弹窗头部与导航按钮样式
- `refactor(search)`: 移除搜索面板右侧的项目图标
- `refactor(diff)`: 收敛面板强调蓝到主题令牌，并压平多余内阴影

🐛 Fixes

- `fix(claude)`: 收到 result 后按宽限期结算回合，并强杀残留进程组
- `fix`: 加固实时回合生命周期，并精修设置样式
- `fix(panel-tabs)`: 面板不再因 live 状态强制外显，仅按激活 / 勾选常驻
- `fix(toolbar)`: 顶栏图标放不下时，按优先级裁进「更多」菜单

English:

✨ Features

- Bump the app version to `0.6.5` across frontend package metadata and Tauri bundle configuration
- `feat(settings)`: refine the shortcut-recording interaction and unify provider panel colors
- `feat(sidebar)`: add a clickable version tag at the bottom of the sidebar

🔧 Improvements

- `refactor(app-shell)`: remove the branch switcher and worktree rename UI from the MainHeader
- `refactor`: redesign the settings panel and stabilize idle polling renders
- `perf(conversation)`: suppress O(L²) and full-history overhead in long-conversation streaming rendering
- `perf(markdown)`: skip the per-token heavy-islands re-scan for lightweight streaming / pure code blocks
- `refactor(ui)`: refine the search panel, settings navigation, and sidebar visuals
- `refactor(release-notes)`: rework the release-notes modal header and navigation button styles
- `refactor(search)`: remove the project icon on the right of the search panel
- `refactor(diff)`: converge the panel accent blue to theme tokens and flatten redundant inner shadows

🐛 Fixes

- `fix(claude)`: settle the turn after receiving result within a grace period and force-kill leftover process groups
- `fix`: harden the realtime turn lifecycle and refine settings styling
- `fix(panel-tabs)`: stop panels from force-showing on live state; keep them resident only when active/checked
- `fix(toolbar)`: move overflowing toolbar icons into the “More” menu by priority

---

### **2026年7月3日（v0.6.4）**

中文：

✨ Features

- 升级应用版本号到 `0.6.4`，同步前端包配置与 Tauri 打包配置
- 重做文件树面板，并新增可固定的右侧面板标签页
- 点击即可在灯箱中打开延迟加载的 Claude 图片
- 支持将「打开应用」类操作固定到工具栏
- 合并同段思考片段，并优化阅读体验
- 新增锚点导航栏，用于在用户消息间快速跳转

🐛 Fixes

- 计划面板默认折叠，并在切换线程时保持折叠
- 修复 `contain: strict` 导致滚动视口塌陷为 0px 的问题

English:

✨ Features

- Bump the app version to `0.6.4` across frontend package metadata and Tauri bundle configuration
- rework file tree panel and add pinnable right-panel tabs
- open deferred Claude images in the lightbox on click
- let users pin open-app actions to the toolbar
- merge same-segment thinking runs and refine reading UX
- add anchor rail for jumping between user messages

🐛 Fixes

- keep the plan panel collapsed by default and on thread switch
- stop `contain: strict` from collapsing scroll viewports to 0px

---

### **2026年7月3日（v0.6.3）**

中文：

✨ Features

- 升级应用版本号到 `0.6.3`，同步前端包配置与 Tauri 打包配置
- `feat(models)`: 新增内置 Claude 模型目录，并支持覆盖优先级
- `feat`: 以 ai-elements 风格重做上下文用量指示器
- `feat(composer)`: 按引擎持久化 Composer 偏好设置
- `feat(skills)`: 新增 vercel-optimize 与 writing-guidelines 两个 agent 技能

🔧 Improvements

- `perf`: 暂停后台轮询，消除 idle 空闲渲染风暴
- `perf`: 消除 O(L²) 流式合并开销，并保持重型依赖懒加载
- `perf`: app-shell 根渲染时不再牵动重型子树重渲染
- `perf`: 将 Composer 状态移出 app-shell 根，收敛渲染风暴

🐛 Fixes

- `fix(timeline)`: 改为重测已挂载行而非清空虚拟化尺寸缓存，减少时间线跳动

English:

✨ Features

- Bump the app version to `0.6.3` across frontend package metadata and Tauri bundle configuration
- `feat(models)`: add a builtin Claude model catalog with override precedence
- `feat`: rework the context-usage indicator with an ai-elements style
- `feat(composer)`: persist per-engine composer preferences
- `feat(skills)`: add the vercel-optimize and writing-guidelines agent skills

🔧 Improvements

- `perf`: pause background polling to cut idle render storms
- `perf`: eliminate O(L²) streaming-merge overhead and keep heavy vendors lazy
- `perf`: stop heavy subtrees from re-rendering on every app-shell root render
- `perf`: move composer state out of the app-shell root to tame render storms

🐛 Fixes

- `fix(timeline)`: remeasure mounted rows instead of wiping the virtualizer size cache to reduce timeline jumpiness

---

### **2026年7月1日（v0.6.2）**

中文：

✨ Features

- 升级应用版本号到 `0.6.2`，同步前端包配置与 Tauri 打包配置
- `feat(ui)`: 迁移到 shadcn 默认 zinc 主题并统一组件库到 Radix，消息、Composer 与设置面板整体换肤
- `feat(composer)`: 新增分支徽章，并打磨输入框与消息时间线观感
- `feat(perf)`: 接入 react-scan 渲染诊断面板并支持设置页开关，按运行时闸门启用 web-vitals
- `feat(messages)`: 为 Claude 启用轻量流式渲染，并接入掉帧归因
- `feat(threads)`: 子代理树默认折叠并重排线程列表
- `feat(menu)`: 新增“切换开发者工具”菜单项

🔧 Improvements

- `refactor(messages)`: 工具块整体迁移到 shadcn Marker 折叠外壳，turn boundary 改用 Marker 分隔条，尺寸对齐官方规格
- `refactor(messages)`: 抽取代码块语言徽标与复制按钮为共享组件，文件变更统一渲染为每文件紧凑行
- `refactor(composer)`: 将权限模式与推理深度上提到主行，工具表面统一收纳进“+”下拉菜单，重构 composer 选择器并移除首页虚拟化
- `refactor(typography)`: UI 字体改用 SF Pro、Markdown 引入 Geist，统一字号与文档观感
- `refactor(ui)`: 提取 ClaudeContextCard 并精简 composer / messages 外壳
- `refactor(messages)`: 将消息锚点栏重做为可折叠大纲
- `refactor(claude)`: 移除 `/context` 命令用量探测
- `refactor(i18n)`: 拆分 browserAgent 语言包到 zh.part8

🐛 Fixes

- `fix(build)`: 将 DMG 卷名改为 `ccgui`，修复 macOS 26 打包 EPERM 报错
- `fix(markdown)`: 补齐 HTML 序列化依赖声明
- `fix(messages)`: 优化 Mermaid 卡片操作按钮
- `ci`: 停止在 Pull Request 上运行工作流

English:

✨ Features

- Bump the app version to `0.6.2` across frontend package metadata and Tauri bundle configuration
- `feat(ui)`: migrate to the shadcn default zinc theme and unify the component library on Radix, re-skinning messages, the composer, and settings panels
- `feat(composer)`: add a branch badge and polish the input box and message timeline
- `feat(perf)`: add a react-scan render-diagnostics panel with a settings toggle, and gate web-vitals behind a runtime switch
- `feat(messages)`: enable lightweight streaming rendering for Claude with frame-drop attribution
- `feat(threads)`: collapse subagent trees by default and reorder the thread list
- `feat(menu)`: add a “Toggle Developer Tools” menu item

🔧 Improvements

- `refactor(messages)`: migrate tool blocks to the shadcn Marker collapsible shell, switch turn boundaries to a Marker divider, and align sizing with the official spec
- `refactor(messages)`: extract the code-block language badge and copy button into shared components, and render file changes as compact per-file rows
- `refactor(composer)`: surface permission mode and reasoning depth in the primary row, consolidate tool surfaces into a “+” dropdown menu, and rework the composer selector while removing home-page virtualization
- `refactor(typography)`: switch the UI font to SF Pro, introduce Geist for Markdown, and unify font sizes and document feel
- `refactor(ui)`: extract ClaudeContextCard and slim down composer / messages chrome
- `refactor(messages)`: rework the message anchor rail into a collapsible outline
- `refactor(claude)`: remove the `/context` command usage probe
- `refactor(i18n)`: split the browserAgent locale into zh.part8

🐛 Fixes

- `fix(build)`: rename the DMG volume to `ccgui` to fix EPERM packaging failures on macOS 26
- `fix(markdown)`: add the missing HTML serialization dependency declaration
- `fix(messages)`: refine the Mermaid card action buttons
- `ci`: stop running workflows on pull requests

---

### **2026年6月28日（v0.6.1）**

中文：

✨ Features

- 升级应用版本号到 `0.6.1`，同步前端包配置与 Tauri 打包配置

🔧 Improvements

- `feat(windows)`: 修复 Windows 平台 Claude / Codex 内置技能的 argv 传输边界，消除注入链路历史污染，让内置技能注入与命令包装在 Windows 下更稳定
- `refactor(codex)`: 将 `resolve_default_codex_home` 收敛到 home 子模块，理清 Codex home 解析路径
- `fix(codex)`: 收敛磁盘会话失效提示，减少无谓的失效告警

🐛 Fixes

- `fix(claude)`: 修复 Windows 下 stream-json 空 prompt 占位问题，避免空提示导致的流式启动异常
- `fix(stream)`: 修复 Windows 对话流式输出回归
- `fix(codex)`: 修复 Windows 内置技能启动回退
- `fix(messages)`: 修复流式渲染更新深度崩溃
- `fix(messages)`: 隔离幕布渲染场景作用域，避免跨场景渲染串扰
- `fix(threads)`: 保留会话目录分页游标，避免翻页后游标丢失

English:

✨ Features

- Bump the app version to `0.6.1` across frontend package metadata and Tauri bundle configuration

🔧 Improvements

- `feat(windows)`: fix the argv transport boundary for Claude / Codex curated skills on Windows, removing injection-chain history pollution so curated-skill injection and command wrapping stay reliable on Windows
- `refactor(codex)`: move `resolve_default_codex_home` into the home submodule to clarify Codex home resolution
- `fix(codex)`: converge disk-session invalidation notices to reduce noisy staleness warnings

🐛 Fixes

- `fix(claude)`: fix the stream-json empty-prompt placeholder on Windows so empty prompts no longer break streaming startup
- `fix(stream)`: fix a Windows conversation streaming-output regression
- `fix(codex)`: fix Windows curated-skill startup fallback
- `fix(messages)`: fix a streaming-render update-depth crash
- `fix(messages)`: scope canvas rendering per scenario to avoid cross-scenario render bleed
- `fix(threads)`: preserve the session-directory pagination cursor so it is no longer lost after paging

---

### **2026年6月27日（v0.6.0）**

中文：

✨ Features

- 升级应用版本号到 `0.6.0`，同步前端包配置、lockfile 与 Tauri 打包配置

🔧 Improvements

- `fix(messages)`: 稳定长对话 streaming 时间线滚动，保留已水合的 heavy row，并减少虚拟列表与底部跟随滚动之间的拉扯
- `fix(messages)`: 文件链接右键菜单改为浮到页面顶层渲染，避免被消息容器或 composer 遮挡
- `fix(messages)`: 优化用户气泡复制入口，避免复制按钮干扰消息阅读节奏
- `fix(skills)`: 修复打包内置技能加载链路，确保精选技能资源能随应用正确分发
- `refactor(vendors)`: 移除 Gemini CLI 供应商配置入口，供应商管理聚焦 Claude Code 与 Codex
- `docs(trellis)`: 记录内置技能加载修复会话，补齐本轮修复的工作记录

🐛 Fixes

- `fix(markdown)`: 移除全局行内代码复制入口，修复版本记录等 Markdown 阅读面出现大量复制按钮的 UI 回归
- `fix(git)`: 非 Git 工作区不再触发 Git Diff 扫描和内部命令失败提示，并将 Git Diff 状态检测统一为 15 秒
- `fix(git)`: 修复右侧 Git Diff 统计与消息侧统计不一致的问题，并让过万 diff 数字保持可见
- 修复 `0.6` 非 SemVer 版本号导致 Tauri 打包失败的问题，统一使用 `0.6.0`

English:

✨ Features

- Bump the app version to `0.6.0` across frontend package metadata, lockfile, and Tauri bundle configuration

🔧 Improvements

- `fix(messages)`: stabilize long-conversation streaming timeline scrolling by retaining hydrated heavy rows and reducing virtualizer/bottom-follow scroll contention
- `fix(messages)`: render file-link context menus at the page top layer so they are not clipped by message containers or the composer
- `fix(messages)`: refine the user-bubble copy entry so copy controls no longer distract from message reading
- `fix(skills)`: fix packaged curated-skill loading so bundled skill resources ship and load correctly
- `refactor(vendors)`: remove the Gemini CLI provider configuration entry so provider management focuses on Claude Code and Codex
- `docs(trellis)`: record the curated-skill loading fix session for traceability

🐛 Fixes

- `fix(markdown)`: remove the global inline-code copy affordance that polluted Markdown reading surfaces such as Release Notes with excessive copy buttons
- `fix(git)`: stop Git Diff scans and internal command failure notices for non-Git workspaces, and standardize Git Diff status polling at 15 seconds
- `fix(git)`: fix mismatched right-panel Git Diff stats versus message-side stats, and keep very large diff counts visible
- Fix Tauri packaging failures caused by the non-SemVer `0.6` version string by standardizing on `0.6.0`

---

### **2026年6月26日（v0.5.13）**

中文：

✨ Features

- `feat(realtime)`: 阶段性收口工具调用卡顿治理
- `feat(curated-skills)`: 完成精选技能收口
- `feat(layout)`: 外置 active canvas selector 状态
- `feat(messages)`: 去除对话幕布重复复制入口
- `feat(default1-3)`: 完成对应能力交付
- 效果: 设置里的内置 `Lazy senior dev` 默认开启，同时保留用户手动关闭语义

🔧 Improvements

- `refactor(composer)`: 提取 `useCallback` 块解析逻辑为可复用函数
- `refactor(messages)`: 删除用户气泡吸顶条
- `perf(canvas)`: 隔离实时幕布与交互控制区
- `perf(canvas)`: 闭环实时幕布交互隔离
- `perf(shell)`: 隔离实时幕布与壳层计算
- `docs(openspec)` 与 `chore(openspec)`: 归档若干已验证提案（fast-markdown、codex-provider、opencode gemini cli、Codex disk、fix-history-canvas-lightweight-spacing）

🐛 Fixes

- `fix(settings)`: 补充性能诊断说明文案
- `fix(codex)`: 恢复命令写文件变更回放
- `fix(codex)`: 稳定 provider 首发会话初始化
- `fix(perf)`: 修复实时渲染调度续排卡顿
- `fix(markdown)`: 恢复 fast 预览标注入口
- `fix(composer)`: 修复输入框打字低优先级卡顿
- `fix(files)`: 修复 bounded fast outline 异步折叠
- `fix(messages)`: 修复文件变更幕布误判
- `fix(frontend)`: 避免会话选择迁移重复写入
- `fix(curated-skills)`: 消除测试估算函数死代码告警
- `fix`: 避免将包含点的代码片段误判为文件路径
- `fix(codex)`: 补齐 daemon 启动确认与诊断清理
- `fix(runtime)`: 屏蔽废弃 CLI 入口并放宽确认窗口
- `fix(runtime)`: 降级临时重连提示
- `fix(project-map)`: 修复冷启动空态循环
- `fix(perf)`: 稳定实时对话渲染与 Codex 创建
- `fix(messages)`: 修复历史时间线重测与浮层对比度
- `fix(messages)`: 收敛历史幕布 lightweight 间距与展开布局
- `fix(codex)`: 稳定首轮线程启动恢复边界
- `Fix uat`
- `处理测试`
- `止血拆分`

English:

✨ Features

- `feat(realtime)`: phase-in containment for tool-call jank
- `feat(curated-skills)`: close curated-skills workstream
- `feat(layout)`: externalize active canvas selector state
- `feat(messages)`: remove duplicate copy entry in the canvas timeline
- `feat(default1-3)`: deliver corresponding capabilities
- Set built-in `Lazy senior dev` enabled by default in settings while preserving manual opt-out semantics

🔧 Improvements

- `refactor(composer)`: extract reusable `useCallback` block-parsing helper
- `refactor(messages)`: remove sticky top bubble in message bubbles
- `perf(canvas)`: isolate realtime canvas from interaction control area
- `perf(canvas)`: close loop for real-time canvas interaction isolation
- `perf(shell)`: isolate real-time canvas from shell-level calculations
- `docs/chore(openspec)`: archive several validated OpenSpec proposals (fast-markdown, codex-provider, opencode gemini cli, Codex disk, fix-history-canvas-lightweight-spacing)

🐛 Fixes

- `fix(settings)`: add performance-diagnostic wording
- `fix(codex)`: restore command-file-change replay
- `fix(codex)`: stabilize provider first-session initialization
- `fix(perf)`: fix realtime rendering schedule backpressure
- `fix(markdown)`: restore fast preview annotation entry
- `fix(composer)`: fix low-priority typing jank in editor input
- `fix(files)`: fix async collapse behavior of bounded fast outline
- `fix(messages)`: fix file-change timeline canvas misclassification
- `fix(frontend)`: avoid duplicate writes during session-selection migration
- `fix(curated-skills)`: remove dead-code warning in test estimation helper
- `fix`: avoid treating code snippets with dots as file paths
- `fix(codex)`: complete daemon startup confirmation and diagnostic cleanup
- `fix(runtime)`: hide deprecated CLI entry and relax confirmation window
- `fix(runtime)`: downgrade temporary reconnect notice
- `fix(project-map)`: fix cold-start empty state loop
- `fix(perf)`: stabilize real-time conversation rendering and Codex creation
- `fix(messages)`: fix historical timeline retest and popover contrast
- `fix(messages)`: converge history-canvas lightweight spacing and expansion layout
- `fix(codex)`: stabilize first-thread startup recovery boundary
- `Fix uat`
- `Handle test cleanup`
- `Hot-fix split`

---

### **2026年6月22日（v0.5.12）**

中文：

✨ Features

- 新增 Mermaid 图表全屏查看能力，支持消息与文件中的 Mermaid 图表在独立查看器中展开
- 新增图片全屏与消息目录（message outline）能力，优化 Markdown 图片与消息章节的检视体验
- 升级应用版本号到 `0.5.12`，同步前端包配置与 Tauri 配置

🔧 Improvements

- 收口 Markdown 渲染性能优化提案，补齐 file preview 与消息 markdown 流式渲染性能边界
- 归档 Mermaid 全屏与图片全屏相关 OpenSpec 变更提案，收束提案与实现交付边界
- 优化 release CI Rust 编译缓存，降低发布流水线构建成本
- 提取 MermaidBlock 全屏按钮等待逻辑为通用辅助函数，降低重复并提升复用性
- 收紧 runtime 重连恢复提示展示范围，弱化恢复提示样式，减少瞬态误导干扰
- 稳定文件面板测试与品牌检查口径，减少 CI 不稳定波动
- 拆分消息流式测试并清理品牌残留，提升流式消息测试稳定性
- 修复 Kanban 与 Threads 国际化/元素查找稳定性，提升相关测试可靠性

🐛 Fixes

- 修复 Codex 会话中 `conversation not found` 时未触发恢复问题
- 修复供应商模型目录与 Codex 刷新断联，提升模型选择与刷新链路稳定性
- 修复 Composer 与 Codex 恢复绑定细节，降低并行恢复场景中的会话状态漂移
- 移除首页最近会话入口，避免首页会话入口行为与主页动线不一致

English:

✨ Features

- Add Mermaid chart fullscreen viewing so Mermaid diagrams in messages and files can be opened in a dedicated fullscreen viewer
- Add image fullscreen and message outline support to improve inspection of markdown images and section navigation
- Bump app version to `0.5.12` across frontend package metadata and Tauri configuration

🔧 Improvements

- Close the markdown rendering performance proposal to document and align file preview and message markdown streaming performance boundaries
- Archive OpenSpec change proposals for Mermaid and image fullscreen features to tighten proposal-to-delivery traceability
- Optimize release CI Rust cache to reduce pipeline build overhead
- Extract the MermaidBlock fullscreen button await logic into shared helpers to improve reuse and reduce duplication
- Tighten runtime reconnect prompt conditions, soften recoverable-runtime hint visuals, and reduce transient interruption noise
- Stabilize file-panel test and brand-check behavior to lower CI flakiness
- Split streaming-message tests and clean up branding residue to improve streaming test determinism
- Fix Kanban/Threads internationalization and UI element lookup stability to improve test reliability

🐛 Fixes

- Fix session recovery when `conversation not found` occurs in Codex flows
- Fix provider model-catalog and Codex refresh disconnection to improve model selection refresh reliability
- Fix provider recovery binding details in Composer/Codex to reduce session drift in recovery flows
- Remove the Home recent-conversations entry to align home entry behavior with current navigation flow

---

### **2026年6月18日（v0.5.11）**

中文：

✨ Features

- 新增 v0.5.11 性能证据门禁，覆盖 cold start、Composer、long list、realtime、runtime evidence 与历史基线归档，让发布前性能状态具备可审计的证据闭环
- 新增 renderer 诊断导出与 turn trace 校准链路，将 renderer 指标、realtime runtime evidence 和 turn trace summary 接入统一性能证据报告
- 新增 Codex 首响应与首包延迟证据细分，覆盖 turn start ack、首个流式增量、ack 后首包、首文本等待、assistant item 首响应与首文本前运行阶段，帮助定位流式输出慢点
- 新增 v0.5.11 消息恢复与性能证据收口，串联消息恢复、流式渲染、runtime evidence 与恢复 cookbook，降低长会话恢复和性能排查成本
- 新增 Claude 供应商拖拽排序，支持固定本地配置与当前启用项、拖动调整其他供应商顺序并持久化
- 新增 Claude 供应商模型拉取能力，可从当前 API URL 与 API Key 拉取兼容端点模型列表，并作为 Haiku/Sonnet/Opus 映射输入建议

🔧 Improvements

- 升级应用版本号到 `0.5.11`，同步前端包配置与 Tauri 配置
- 收口 v0.5.10 性能闭环文档，补齐 runtime evidence gates、验证记录与 OpenSpec 任务状态
- 锁定 `turn completed` 写出 trace summary 的测试覆盖，减少 realtime trace 回归时的证据缺口
- 优化消息流渲染与流式路由实测口径，降低流式输出可见延迟，并校准 turn trace 诊断与首响应证据判定
- 拆分 Tauri Git、工作区文件服务与文件树视图状态，收敛大文件与重测试治理噪音，提升文件相关模块的维护边界
- 补充恢复 cookbook，并归档 v0.5.11 已验证 OpenSpec 提案，让性能证据、恢复链路和发布门禁具备更完整的审计记录
- 提升文档树节点查询与文件列表刷新参数断言的测试稳定性，减少 UI 与 Tauri 边界测试误报
- 校准 Claude 供应商默认 settings 模板，将模型层级、thinking、onboarding、语言与 TUI 等字段写入正确配置层级，降低新供应商配置成本
- 提取 Git 行标记重置逻辑并清理未使用依赖，降低 Git 视图状态维护复杂度

🐛 Fixes

- 修复消息流式结束窗口问题，并升级 React 运行时，减少消息结束阶段的状态漂移
- 修复 Claude thinking 状态上报不稳的问题，让 AppShell 对运行态思考状态的展示更可靠
- 修复 Codex 默认配置首轮恢复与冷启动首发问题，降低首次启动或默认 provider 场景下的响应丢失风险
- 修复文件树刷新失效与 hook 依赖告警，恢复文件树刷新链路并清理无效依赖噪音
- 修复性能归档门禁与评论权限失败处理，避免 CI gate 因归档评论权限或门禁边界阻塞发布验证
- 修复侧栏提示入口与弹层层级问题，避免 runtime notice 被遮挡或入口不可达
- 修复 Codex 并行会话生命周期隔离问题，降低并行 session 在启动、恢复和释放过程中的状态串扰
- 修复 Claude 供应商默认配置中的不安全环境变量默认值，避免新建供应商时自动写入会造成回归的 Claude Code env
- 修复独立文件窗口与文件树首屏滚动容器样式问题，让文件内容和目录树在首次打开时保持稳定滚动
- 修复线程门禁失败与大文件债务收口问题，减少发布前治理检查的误报与阻塞

English:

✨ Features

- Add the v0.5.11 performance evidence gates across cold start, Composer, long lists, realtime, runtime evidence, and historical baseline archiving so release performance has an auditable evidence loop
- Add renderer diagnostics export and turn-trace calibration, connecting renderer metrics, realtime runtime evidence, and turn trace summaries into the unified performance evidence report
- Add finer-grained Codex first-response and first-packet latency evidence across turn-start ack, first streaming delta, post-ack first packet, first-text wait, assistant-item first response, and pre-first-text runtime phases to make slow streaming paths easier to locate
- Add the v0.5.11 message recovery and performance-evidence closure, tying message recovery, streaming rendering, runtime evidence, and the recovery cookbook into one auditable release path
- Add drag-to-reorder for Claude providers, keeping local settings and the active provider pinned while persisting the order of other providers
- Add Claude provider model fetching from the current API URL and API key, surfacing compatible endpoint models as suggestions for Haiku/Sonnet/Opus mappings

🔧 Improvements

- Bump app version to `0.5.11` across frontend package metadata and Tauri configuration
- Close the v0.5.10 performance loop documentation with updated runtime evidence gates, verification records, and OpenSpec task status
- Lock test coverage for writing `turn completed` trace summaries to reduce evidence gaps during realtime trace regressions
- Improve message-stream rendering and measured streaming-route diagnostics, reducing visible streaming latency while calibrating turn-trace diagnostics and first-response evidence checks
- Split Tauri Git services, workspace file services, and file-tree view state while reducing large-file and heavy-test governance noise, making file-related module boundaries easier to maintain
- Add the recovery cookbook and archive verified v0.5.11 OpenSpec proposals so performance evidence, recovery flows, and release gates have a stronger audit trail
- Improve documentation-tree queries and file-list refresh parameter assertions in tests to reduce false positives across UI and Tauri boundaries
- Calibrate the default Claude provider settings template so model tiers, thinking, onboarding, language, and TUI fields are written to the correct settings layer
- Extract Git line-marker reset logic and remove unused dependencies to reduce Git view state-maintenance complexity

🐛 Fixes

- Fix the message streaming completion window and upgrade the React runtime to reduce state drift when streamed messages finish
- Fix unstable Claude thinking-state reporting so AppShell displays runtime thinking state more reliably
- Fix Codex default-configuration first-turn recovery and cold-start first dispatch, reducing response-loss risk during first launch or default-provider flows
- Fix file-tree refresh failures and hook dependency warnings, restoring the refresh path and cleaning up invalid dependency noise
- Fix performance archive gates and comment-permission failure handling so CI gates do not block release validation on archive-comment permissions or gate boundaries
- Fix the sidebar runtime-notice entrypoint and popover layering so notices remain reachable and visible
- Fix Codex parallel-session lifecycle isolation, reducing state cross-talk while parallel sessions launch, recover, and release resources
- Fix unsafe environment-variable defaults in the Claude provider template so new providers no longer auto-write Claude Code env values that caused regressions
- Fix standalone file-window and file-tree first-screen scroll-container styling so file content and directory trees scroll reliably on first open
- Fix thread gate failures and large-file debt closure issues, reducing false positives and release-gate friction

---

### **2026年6月16日（v0.5.10）**

中文：

🔧 Improvements

- 升级应用版本号到 `0.5.10`，同步前端包配置与 Tauri 配置
- 补齐近期测试稳定性批次，覆盖 Composer rewind 确认、慢 git 标记编辑器挂载、聊天流渲染隔离、WebService token 生成、router lazy act 边界、Suspense host-task teardown 与 flush 等场景，降低测试串扰与误报
- 补齐近期 OpenSpec 稳定性提案优化与归档，覆盖聊天流渲染隔离、AppShell 运行态稳定性、长运行客户端运行时、稳定性归档文档等条目

🐛 Fixes

- 修复 Composer 文件引用深层路径搜索异常，恢复深层目录文件在 Composer 输入中的可被检索与引用能力
- 修复文件树首屏滚动容器布局问题，让首屏目录树展示与滚动行为回到稳定状态
- 修复父组件测试中 Markdown 懒加载隔离问题，降低消息组件 Markdown 懒加载在父级测试上下文中的串扰与不稳定
- 修复顶栏菜单按钮收敛问题，恢复关键导航入口稳定状态
- 修复 Apple event 完整诊断码保留问题，避免 threads 链路在跨进程事件中丢失诊断信息
- 修复长运行客户端运行时稳定性问题，减少长会话、并行对话与高频事件下的 runtime 状态、事件订阅与前台残留漂移
- 修复 AppShell 运行态上下文隔离稳定性问题，让 layoutContext、fileEditorContext、settingsContext 以及新增的 runtimeContext、modelSelectionContext、collaborationModeContext 在跨模块访问时保持清晰边界
- 修复供应商排序时间稳定性问题，让供应商列表的展示顺序在多次刷新与会话切换后保持一致
- 修复 runtime 重连恢复卡片状态问题，避免 messages 在重连或会话恢复后丢失或错乱展示
- 修复 reasoning 测试 JSX 类型引用问题，让消息组件在测试上下文中恢复稳定渲染
- 修复 AppShell runtime contract 治理脚本边界处理问题，避免新增 context 名称与 ctx 形参被误判为违规

English:

🔧 Improvements

- Bump app version to `0.5.10` across frontend package metadata and Tauri configuration
- Add a recent test-stability batch covering Composer rewind confirmation, slow git marker editor mount, chat-stream render isolation, WebService token generation, router lazy act boundaries, and Suspense host-task teardown and flush to reduce cross-talk and false positives
- Optimize and archive recent OpenSpec stability proposals covering chat-stream render isolation, AppShell runtime stability, long-running client runtime, and stability archiving documentation

🐛 Fixes

- Fix Composer deep-path file reference search so files inside deeply nested directories can be searched and referenced again from the Composer input
- Fix file-tree first-paint scroll container layout to restore stable initial render and scrolling of the directory tree
- Fix Markdown lazy-loading isolation in parent component tests to reduce cross-talk and flakiness between message components and Markdown lazy boundaries
- Fix top-bar menu button convergence so key navigation entrypoints stay stable
- Fix Apple event full diagnostic code retention so the threads path no longer drops diagnostic information across process events
- Fix long-running client runtime stability to reduce runtime-state, event-subscription, and foreground-residue drift during long sessions, parallel conversations, and high-frequency events
- Fix AppShell runtime context isolation stability so `layoutContext`, `fileEditorContext`, `settingsContext`, and the newly introduced `runtimeContext`, `modelSelectionContext`, and `collaborationModeContext` keep clear boundaries across module access
- Fix vendor ordering time stability so the vendor list order remains consistent across refreshes and session switches
- Fix the runtime reconnect recovery card state so messages no longer lose or mis-render state after reconnect or session recovery
- Fix reasoning test JSX type references so message components render reliably inside the test context
- Fix the AppShell runtime contract governance script boundary handling so newly added context names and `ctx` parameters are no longer misclassified as violations

中文：

🔧 Improvements

- 升级应用版本号到 `0.5.10`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复 Composer 文件引用深层路径搜索异常，恢复深层目录文件在 Composer 输入中的可被检索与引用能力
- 修复文件树首屏滚动容器布局问题，让首屏目录树展示与滚动行为回到稳定状态
- 修复父组件测试中 Markdown 懒加载隔离问题，降低消息组件 Markdown 懒加载在父级测试上下文中的串扰与不稳定

English:

🔧 Improvements

- Bump app version to `0.5.10` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix Composer deep-path file reference search so files inside deeply nested directories can be searched and referenced again from the Composer input
- Fix file-tree first-paint scroll container layout to restore stable initial render and scrolling of the directory tree
- Fix Markdown lazy-loading isolation in parent component tests to reduce cross-talk and flakiness between message components and Markdown lazy boundaries

---

### **2026年6月14日（v0.5.9）**

中文：

✨ Features

- 新增 v0.5.9 发布级性能优化批次，覆盖 bundle budget、启动编排、CSS 分片加载、Markdown runtime 懒加载、文件预览依赖懒加载、搜索索引与 bounded hydration 等关键路径
- 新增运行时性能证据门禁与基线归档能力，补齐 cold start、Composer、long list、realtime 和 runtime evidence 的历史记录与聚合报告
- 新增 realtime trace correlation gate，让 Claude 事件通道、运行时事件和前端状态变化具备可追踪的关联证据
- 新增 Git 手动刷新状态入口，支持用户在 Git 面板中主动刷新状态，降低状态滞后带来的误判
- 新增 Windows 离线 WebView2 安装器能力，提升 Windows 离线或受限网络环境下的安装成功率
- 升级应用版本号到 `0.5.9`，同步前端包配置、Tauri 配置与发布说明入口

🔧 Improvements

- 优化客户端启动与 bundle chunking 策略，拆分 lazy views、feature style loaders 和 app shell lazy boundaries，降低首屏加载与无关功能预加载压力
- 优化文件编辑输入延迟与文件打开渲染调度，补齐 typing diagnostics、外部变更同步测试和文件打开缓存刷新链路
- 优化 Markdown progressive reveal 与 Full Markdown Runtime 加载边界，减少大型 Markdown、数学公式、代码块和文件链接渲染时的阻塞
- 优化 realtime 输入、事件批处理、行级订阅和文件 I/O 隔离，降低长会话、高频事件和并行对话下的 UI 抖动
- 优化搜索索引失效、bounded hydration 和告警门禁，避免搜索结果因缓存状态、索引漂移或超量 hydration 出现不稳定
- 优化 App Shell runtime contract、跨平台换行断言、品牌检查和治理脚本边界，减少 CI gate 噪音与误报
- 优化 OpenSpec 与 Trellis 性能提案收口，归档 P0/P1 性能变更并补齐发布级性能路线图、验证记录和执行顺序
- 优化测试覆盖，补齐 bundle chunking、runtime evidence report、file typing latency、lazy Markdown runtime、message reconnect、message fork 文件保护和 i18n 回归测试

🐛 Fixes

- 修复并行对话运行时残留 P0 问题，减少多会话并行执行后 runtime 状态、事件订阅和前台残留漂移
- 修复 Claude realtime 事件通道兼容问题，稳定事件解析、重连测试和跨通道运行时状态同步
- 修复文件打开缓存内容未刷新的问题，避免外部变更或重新打开文件时展示旧内容
- 修复文件编辑交互卡顿隔离问题，降低输入、保存、外部同步和预览依赖加载互相阻塞的风险
- 修复 Git 差异弹窗预览缺失问题，恢复 diff panel 的预览入口和相关状态展示
- 修复侧栏顶栏折叠按钮与 Project Map 任务抽屉入口回归，恢复关键导航入口可达性
- 修复 Markdown progressive reveal 边界扫描问题，避免长文档渐进展示时漏扫或重复处理边界内容
- 修复 CI 噪音、跨平台换行断言、品牌检查回归和治理门禁边界处理问题，提升发布前验证稳定性

English:

✨ Features

- Add the v0.5.9 release-grade performance batch across bundle budgets, startup orchestration, CSS chunk loading, lazy Markdown runtime loading, lazy file-preview dependencies, search indexing, and bounded hydration
- Add runtime performance evidence gates and baseline archiving for cold start, Composer, long lists, realtime flows, and runtime evidence aggregation
- Add the realtime trace correlation gate so Claude event channels, runtime events, and frontend state changes can be traced with correlated evidence
- Add a manual Git status refresh action so users can refresh repository state directly from the Git panel and reduce stale-state confusion
- Add the Windows offline WebView2 installer path to improve installation success in offline or restricted-network Windows environments
- Bump app version to `0.5.9` across frontend package metadata, Tauri configuration, and release-note entrypoints

🔧 Improvements

- Improve client startup and bundle chunking by splitting lazy views, feature style loaders, and app-shell lazy boundaries to reduce first-screen and unrelated feature-loading pressure
- Improve file-editor typing latency and file-open rendering scheduling with typing diagnostics, external-sync tests, and refreshed file-open cache behavior
- Improve Markdown progressive reveal and Full Markdown Runtime loading boundaries to reduce blocking during large Markdown, math, code block, and file-link rendering
- Improve realtime input, event batching, row-level subscriptions, and file I/O isolation to reduce UI jitter in long conversations, high-frequency events, and parallel sessions
- Improve search-index invalidation, bounded hydration, and alert gates so search results remain stable when cache state, index drift, or hydration limits shift
- Improve App Shell runtime contracts, cross-platform newline assertions, branding checks, and governance-script boundaries to reduce CI gate noise and false positives
- Improve OpenSpec and Trellis performance closure by archiving P0/P1 performance changes and adding the release performance roadmap, verification records, and execution ordering
- Improve test coverage for bundle chunking, runtime evidence reports, file typing latency, lazy Markdown runtime, message reconnect, message-fork file protection, and i18n regressions

🐛 Fixes

- Fix P0 parallel-conversation runtime residue, reducing runtime-state, event-subscription, and foreground-residue drift after parallel session execution
- Fix Claude realtime event-channel compatibility, stabilizing event parsing, reconnect coverage, and cross-channel runtime state synchronization
- Fix stale file-open cache content so external changes and reopened files no longer display outdated content
- Fix file-editor interaction jank isolation so typing, saving, external sync, and preview dependency loading are less likely to block each other
- Fix the Git diff modal preview path, restoring diff preview entrypoints and related state display
- Fix regressions in the sidebar top-bar collapse button and Project Map task drawer entrypoint, restoring key navigation access
- Fix Markdown progressive reveal boundary scanning so long-document progressive display does not miss or repeatedly process boundary content
- Fix CI noise, cross-platform newline assertions, branding-check regressions, and governance gate boundary handling to make release validation more stable

---

### **2026年6月10日（v0.5.8）**

中文：

✨ Features

- 新增 Codex provider 作用域运行时与会话绑定能力，支持按 provider profile 启动、恢复、扫描和归属会话，让多 provider 的 session catalog 与 runtime 状态可以独立管理
- 新增 Sidebar Codex provider 选择、展示和供应商标签开关，支持在会话列表、Composer 和恢复路径中持续显示当前 provider 上下文
- 新增 Session Activity 轮次产物语义 diff 与证据审查能力，支持更深入地比较代码变化、归纳意图变化并沉淀到工作区活动视图
- 新增自定义主题配色与客户端字号覆盖设置，扩展主题预设、全局 UI scaling 和文件树视觉一致性配置范围
- 新增 Composer 提示词增强的手动模型配置能力，让 prompt enhancer 可以按用户选择的模型执行
- 新增客户端运行态 P0 收口与任务运行详情视图，让 workflow runtime、Task Center run surface 和消息/首页运行态状态进入统一模型

🔧 Improvements

- 优化 Project Map 文件关系与 API Contract 视图，打磨阅读路径、关系定位、Java 关系精度、API endpoint 分组、证据面板和关系工作区拆分
- 优化客户端模块边界，拆分 app shell、messages、Project Map、file tree、file view、layout、sidebar 和 session runtime 等大文件，降低后续维护和大文件门禁压力
- 优化 Codex provider home 会话恢复链路，补齐 provider-scoped session launch、sidebar state parity、workspace catalog projection 和契约文档
- 优化消息渲染与运行态控制器结构，拆分 message view model、timeline、inline prompts、anchor rail、reasoning render 和 session lifecycle controller
- 优化 Sidebar 与工作区菜单结构，拆分 settings menu、search box、folder move picker、workspace overlay 和 provider label 工具函数
- 优化 OpenSpec 与 Trellis 收口流程，归档已验证提案批次并补齐 provider 面板、语义 diff、runtime model 和 app-shell runtime boundaries 的设计记录
- 优化测试覆盖，补齐 Project Map 候选确认、Codex provider label、主题字号变量、语义 diff summary、会话管理拆分、thread reducer 和运行态控制器测试
- 升级应用版本号到 `0.5.8`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复 Codex 磁盘会话 stale thread 重试与 provider home 目录扫描恢复问题，降低历史会话恢复失败和归属丢失风险
- 修复 Sidebar 兼容 Codex 会话归属恢复错误，并稳定子会话移动状态收敛，避免侧栏会话归类和移动状态漂移
- 修复 Composer 当前 Codex provider 标签展示问题，让用户在输入与恢复上下文中能识别实际 provider
- 修复用户输入提交与取消语义混淆，避免 pending input 被错误结算或误判为提交
- 修复大文件拆分后的前端启动崩溃、旧品牌兼容入口拦截和 Read Path 门禁错误
- 修复实时对话幕布渲染、追加上下文气泡列宽和 Project Memory Panel 测试稳定性问题，降低消息区视觉漂移与测试误报
- 修复 Markdown 预览标注、异步菜单、MCP 切换和 Project Map 批量确认候选测试中的时序不稳问题

English:

✨ Features

- Add provider-scoped Codex runtime and session binding so provider profiles can launch, recover, scan, and own sessions independently across the session catalog and runtime state
- Add Sidebar Codex provider selection, provider display, and vendor-label controls so session lists, Composer, and recovery flows keep the active provider context visible
- Add Session Activity semantic diff review for turn artifacts, enabling deeper code-change comparison, intent-change summaries, and auditable workspace activity evidence
- Add custom theme palette and client font-size override settings, expanding theme presets, global UI scaling, and file-tree visual consistency controls
- Add manual model configuration for Composer prompt enhancement so the prompt enhancer can run with the user-selected model
- Add the client runtime P0 closure and task run detail surface, aligning workflow runtime, Task Center run surfaces, and home/message runtime state under one model

🔧 Improvements

- Improve Project Map file-relationship and API Contract views by polishing read paths, relationship positioning, Java relationship precision, endpoint grouping, evidence panels, and workspace decomposition
- Improve client module boundaries by splitting large app shell, messages, Project Map, file tree, file view, layout, sidebar, and session runtime surfaces to reduce maintenance and large-file gate pressure
- Improve Codex provider-home session recovery with provider-scoped session launch, sidebar state parity, workspace catalog projection, and contract documentation
- Improve message rendering and runtime controller structure by separating the message view model, timeline, inline prompts, anchor rail, reasoning renderer, and session lifecycle controller
- Improve Sidebar and workspace menu structure with extracted settings menu, search box, folder move picker, workspace overlay, and provider-label utilities
- Improve OpenSpec and Trellis closure by archiving verified proposal batches and adding design records for provider panels, semantic diff review, the runtime model, and app-shell runtime boundaries
- Improve test coverage for Project Map candidate confirmation, Codex provider labels, theme typography variables, semantic diff summaries, session-management splits, thread reducers, and runtime controllers
- Bump app version to `0.5.8` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix Codex disk-session stale-thread retry and provider-home directory scan recovery, reducing historical session recovery failures and ownership loss
- Fix Sidebar compatibility with Codex session ownership recovery and stabilize child-session move-state convergence to avoid session classification and move-state drift
- Fix Composer's current Codex provider label display so users can identify the active provider in input and recovery contexts
- Fix user-input submit versus cancel semantics so pending input is not settled incorrectly or misclassified as submitted
- Fix frontend startup crashes after large-file splits, legacy branding compatibility entry blocking, and Read Path gate errors
- Fix realtime conversation canvas rendering, appended context-bubble column width, and Project Memory Panel test stability to reduce message-area visual drift and false test failures
- Fix timing instability in Markdown preview annotations, async menus, MCP switching, and Project Map batch candidate confirmation tests

---

### **2026年6月7日（v0.5.7）**

中文：

✨ Features

- 新增 Project Map 文件关系扫描看板与关系图谱工作台，支持关系扫描、关系聚焦、文件导航、候选治理和图谱化浏览，让项目结构理解从节点清单升级为可审计的关系视图
- 新增 Project Map API Contract View，支持接口契约发现、API 关系投影和契约视图展示，让前后端接口、调用关系和结构证据可以进入统一图谱上下文
- 新增 Intent Canvas 与 Project Canvas 代码关系导入链路，支持从文件关系图生成画布节点、审计卡片和 Semantic Context Packet，让上下文整理可以沉淀为可复用的任务画布
- 新增 Markdown Fast Preview 渲染链路和大文件专用读取路径，通过快速解析、worker 渲染、outline 提取和安全清洗提升大文档预览体验

🔧 Improvements

- 优化 Project Map 文件关系图谱交互，收紧 UNKNOWN 关系节点聚焦、视图收起语义、滚轮缩放、关系扫描和文件导航完整性边界
- 优化 Markdown 预览渲染架构，补齐 fast renderer 的缓存、profile 解析、heavy blocks、heading id、source line 标记和 worker ready 边界
- 优化客户端渲染稳定性防线，降低高压场景下 renderer 状态漂移、重复渲染和 selected session hooks 冗余更新带来的交互风险
- 优化大文件治理与归档流程，拆分历史大文件硬债，更新 large-file baseline，并归档已完成的 Project Map、Intent Canvas、renderer stability 等 OpenSpec 变更
- 优化文件预览测试覆盖，补齐 Markdown / PDF / document preview 目录按钮、预览读取服务 mock 和大文档行数期望
- 升级应用版本号到 `0.5.7`，同步前端包配置、Tauri 配置与 Rust Cargo 配置

🐛 Fixes

- 修复 Project Map 文件关系扫描、聚焦视图、UNKNOWN 关系节点、文件导航完整性和视图收起语义问题，减少图谱浏览中的断链、误聚焦和交互漂移
- 修复 Intent Canvas 代码关系导入与 Excalidraw 选择状态稳定性问题，避免导入画布后选择态异常或关系节点投影不稳
- 修复客户端 renderer 高压场景稳定性问题，并减少 selected session hooks 的重复 re-render，降低会话切换和长时间运行时的 UI 抖动
- 修复跨引擎清理导致的对话残留问题，避免清理一个 engine 时影响其他 engine 的会话状态
- 修复 OpenCode 默认关闭引擎仍参与会话扫描的问题，避免默认禁用的 engine 触发无意义 CLI 扫描
- 修复品牌检查中旧品牌兼容路径被误拦截的问题，保留必要兼容例外并降低 CI 门禁误报
- 修复 CI 门禁测试与大文件基线问题，确保治理规则、预览测试和发布检查可以稳定收口

English:

✨ Features

- Add the Project Map file-relationship scan dashboard and relationship graph workbench with scanning, focus, file navigation, candidate governance, and graph-first browsing for auditable structure discovery
- Add the Project Map API Contract View with contract discovery, API relationship projection, and contract visualization so frontend/backend interfaces and evidence can share one graph context
- Add Intent Canvas and Project Canvas code-relationship import flows with canvas nodes, audit cards, and Semantic Context Packets so organized context can become reusable task canvases
- Add the Markdown Fast Preview rendering path and dedicated large-file reader with fast parsing, worker rendering, outline extraction, and sanitization for large-document previews

🔧 Improvements

- Improve Project Map relationship-graph interactions by tightening UNKNOWN relation focus, collapsed-view semantics, wheel zoom behavior, relation scanning, and file-navigation completeness
- Improve the Markdown preview architecture with fast-renderer cache handling, profile resolution, heavy-block detection, heading IDs, source-line markers, and worker-ready boundaries
- Improve client renderer stability under pressure, reducing state drift, redundant renders, and selected-session hook churn during heavy runtime scenarios
- Improve large-file governance and archive flow by splitting historical large-file debt, updating the baseline, and archiving completed Project Map, Intent Canvas, and renderer-stability OpenSpec changes
- Improve file-preview test coverage for Markdown / PDF / document outline buttons, preview read-service mocks, and large-document line-count expectations
- Bump app version to `0.5.7` across frontend package metadata, Tauri configuration, and Rust Cargo configuration

🐛 Fixes

- Fix Project Map relationship scanning, focus view, UNKNOWN relation nodes, file-navigation completeness, and collapsed-view semantics to reduce broken graph jumps and interaction drift
- Fix Intent Canvas code-relationship import and Excalidraw selection-state stability so imported canvas relationships remain stable after projection
- Fix client renderer stability under pressure and reduce redundant selected-session hook re-renders during session switching and long-running UI flows
- Fix cross-engine cleanup leaving conversation residue or affecting state that belongs to another engine
- Fix OpenCode session scanning when the engine is disabled by default, avoiding meaningless CLI scans
- Fix branding checks incorrectly blocking legacy compatibility paths while preserving necessary compatibility exceptions
- Fix CI gate tests and large-file baselines so governance rules, preview tests, and release checks can close reliably

---

### **2026年6月5日（v0.5.6）**

中文：

✨ Features

- 新增 Project Map 查询关联工作台，支持统一查询、近期活动、Advisor Hints、关联解释、快速过滤和本地历史，让结构图保持主舞台的同时可以折叠查看证据与活动上下文
- 新增 Project Map 图上高亮、节点聚焦和证据反查体验，用户可以从查询结果、活动记录或证据 chip 快速回到对应结构节点，减少在图谱、详情和证据面板之间来回定位的成本
- 新增工作区会话拉取模式切换，支持在默认相关会话模式与当前工作区模式之间选择，让会话列表可以按更窄范围拉取和分页
- 新增会话归因模式设置项，在 Session Management 中提供单选切换、当前生效模式提示和保存失败反馈，让会话范围配置更清晰可控

🔧 Improvements

- 优化运行时交互性能，收紧会话列表、工作区目录、Composer 适配层和状态面板的数据流，降低长列表、恢复和多会话场景下的卡顿
- 优化长列表虚拟化与会话恢复路径，减少线程列表、消息时间线和工作区 session catalog 在大量数据下的重复渲染与阻塞式计算
- 优化 Composer 双视图适配和状态面板数据聚合，让输入区、会话活动和运行时状态在高频更新时保持更稳定的交互响应
- 优化 Project Map 路径、行号、结果数量和证据 chip 的边界处理，避免异常路径、极值输入和同名异目录证据造成错误匹配或折叠
- 优化工作区会话目录投影和分页加载链路，确保当前工作区模式作为独立配置生效，同时不改变默认相关会话模式的既有行为
- 优化会话归因配置的持久化与坏值回退，避免异常 settings 数据导致界面闪回、读取失败或模式状态漂移
- 补齐 v0.5.6 性能基线与运行时证据门禁记录，让交互性能变化具备可追踪的发布证据
- 升级应用版本号到 `0.5.6`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复 WebView2 下消息时间线图片造成的内存压力问题，通过消息媒体块与时间线虚拟化边界降低大量图片场景的内存占用和滚动风险
- 修复 rich content 图片消息在长会话中触发过高内存占用的问题，避免大量图片、媒体块和虚拟列表组合时放大 WebView2 渲染压力
- 修复 Claude 启动时提示词进入命令行参数的问题，改为通过更安全的消息内容链路传递，降低 shell escaping 异常和敏感提示词暴露风险
- 修复 Claude realtime stream 可见性相关的提示词解析边界，避免参数拼接方式影响流式消息内容识别和后续恢复

English:

✨ Features

- Add a Project Map query and association workbench with unified search, recent activity, Advisor Hints, association explanations, quick filters, and local history while keeping the structure graph as the main workspace
- Add Project Map graph highlighting, node focus, and evidence backtracking so users can jump from search results, activity records, or evidence chips back to the matching structure node
- Add a workspace session attribution mode setting so session lists can switch between the default related-session scope and a narrower current-workspace scope
- Add Session Management controls for attribution mode selection, active-mode hints, and save-failure feedback so session scope configuration is easier to understand and recover

🔧 Improvements

- Improve runtime interaction performance by tightening data flow across the thread list, workspace catalog, Composer adapter, and status panel, reducing jank in long-list, recovery, and multi-session scenarios
- Improve long-list virtualization and session recovery paths to reduce repeated rendering and blocking computation across thread lists, message timelines, and workspace session catalogs
- Improve Composer dual-view adaptation and status-panel aggregation so input, session activity, and runtime status remain responsive during high-frequency updates
- Improve Project Map boundary handling for paths, line numbers, result limits, and evidence chips so unsupported paths, extreme inputs, and same-name files in different folders are not matched or folded incorrectly
- Improve workspace session catalog projection and pagination so current-workspace mode works as an independent setting without changing the default related-session behavior
- Improve session attribution persistence and invalid-value fallback to avoid UI flicker, settings read failures, or mode drift from malformed configuration
- Add v0.5.6 performance baselines and runtime evidence-gate records so interaction-performance changes remain traceable for release review
- Bump app version to `0.5.6` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix WebView2 message-timeline image memory pressure by tightening media-block and timeline virtualization boundaries for image-heavy conversations
- Fix rich-content image messages causing excessive memory pressure in long conversations, especially when many images, media blocks, and virtualized rows are rendered together
- Fix Claude launch prompts leaking into command-line arguments by routing prompt content through a safer message-content path, reducing shell-escaping failures and sensitive prompt exposure risk
- Fix Claude realtime-stream prompt parsing boundaries so argument construction no longer interferes with streaming message-content recognition and recovery

---

### **2026年6月3日（v0.5.5）**

中文：

✨ Features

- 新增文件树复制、粘贴与重命名能力，让工作区文件管理可以在应用内完成更多常用操作
- 新增 Browser Agent 上下文关联与证据桥接链路，将浏览器 dock、页面上下文和任务中心证据串联到同一条可审计路径
- 新增 Agent Task 任务编排中心运行队列，支持浏览器代理与后续自动化任务进入统一队列管理
- 重塑 Project Map 图谱优先知识地图体验，让知识地图以图谱浏览、证据核对和候选整理作为主要交互入口

🔧 Improvements

- 优化 Browser Dock Phase 3 OpenSpec 提案文档与中文可读性，明确浏览器上下文、证据桥接和任务编排的后续边界
- 优化大文件治理基线，清理历史硬债并收紧构建产物、运行态文件和仓库治理噪音的边界
- 优化 Project Map 面板批量测试隔离和视图交互门禁，降低图谱整理体验在测试与运行时的状态漂移
- 优化 Browser Dock 设置入口，接入可见性开关，让用户可以控制内嵌浏览器 dock 的显示状态
- 升级应用版本号到 `0.5.5`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复文件树删除后残留节点未清理的问题，避免已删除文件或目录继续停留在树视图中
- 修复文件树 ignored 文件夹置灰展示问题，让忽略状态在文件浏览中更准确可见
- 修复多 WebView 外部拖拽断链和主 WebView 拖拽转发问题，恢复 Composer 与文件入口的拖拽交互
- 修复 Browser Agent 上下文附件类型契约问题，并收窄浏览器自动打开触发条件，减少误触发和附件解析失败
- 修复 Runtime Phase2b 前台残留清理、stale cleanup 结束事件和被动读取拉起 Codex 进程的问题，降低后台运行态副作用
- 修复 release DMG 布局回退包发布风险，并回滚 DMG 创建脚本到 v0.5.4 的稳定路径
- 修复 Project Map 视图交互与门禁噪音问题，降低图谱优先体验中的误报和交互不稳
- 修复打包构建阻断与治理边界问题，确保发布构建链路可以继续收口

English:

✨ Features

- Add file-tree copy, paste, and rename actions so more workspace file-management flows can be completed inside the app
- Add Browser Agent context linking and evidence bridging so browser dock state, page context, and Task Center evidence share an auditable path
- Add the Agent Task orchestration queue for managing Browser Agent work and future automation tasks through a unified queue
- Rework Project Map into a graph-first knowledge-map experience centered on graph browsing, evidence review, and candidate organization

🔧 Improvements

- Improve the Browser Dock Phase 3 OpenSpec proposal and Chinese readability, clarifying follow-up boundaries for browser context, evidence bridging, and task orchestration
- Improve large-file governance baselines by cleaning up historical debt and tightening boundaries for build artifacts, runtime files, and repository-governance noise
- Improve Project Map bulk test isolation and view-interaction gates to reduce state drift across graph organization tests and runtime behavior
- Improve Browser Dock settings by wiring a visibility toggle so users can control whether the embedded browser dock is shown
- Bump app version to `0.5.5` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix stale file-tree nodes remaining after delete operations so removed files or directories no longer stay visible
- Fix ignored-folder dimming in the file tree so ignore state is represented more accurately while browsing files
- Fix external drag-and-drop across multiple WebViews and restore main WebView drag forwarding for Composer and file entrypoints
- Fix the Browser Agent context-attachment type contract and narrow automatic browser-open triggers to reduce false starts and attachment parsing failures
- Fix Runtime Phase2b foreground residue cleanup, stale-cleanup completion events, and passive reads starting Codex processes to reduce runtime side effects
- Fix release risk from regressed DMG layout packages and roll the DMG creation script back to the stable v0.5.4 path
- Fix Project Map view interactions and gate noise to reduce false positives and unstable behavior in the graph-first experience
- Fix packaging build blockers and governance boundaries so the release build path can close cleanly

---

### **2026年5月29日（v0.5.4）**

中文：

✨ Features

- 新增 Codex 结构化启动配置预览能力，在 Settings 中集中展示启动命令、sandbox、approval、model、reasoning effort 和环境覆盖信息
- 新增 Codex doctor / launch profile 后端查询链路，让前端配置面板可以读取实际启动配置而不是依赖静态展示
- 新增关闭当前会话快捷键，支持通过全局 shortcut 快速关闭当前 workspace session tab
- 新增 Codex goal 命令面板入口，支持从 Composer 命令流直接创建和管理 goal
- 新增用户输入请求的收起与跳过交互，支持 pending 问题在消息区更清晰地折叠、结算和恢复
- 新增核心错误日志持久化与三证结算 diagnostics，支持干跑判断、状态查询和前后端对账
- 新增知识地图待整理发现的 AI 整理候选能力，支持对候选节点进行结构化归并、过滤和复核
- 新增消息尾部操作图标，将复制、Fork 等助手回复操作收敛到更清晰的消息级入口
- 新增内嵌 Browser Agent MVP，支持应用内浏览器 dock、平台能力探测、浏览器上下文附件和任务中心联动
- 新增浏览器上下文结构化采集能力，支持页面摘要、DOM/代码候选、只读采集脚本、上下文预览和 Composer 附件注入
- 新增原生窗口透明度设置，让自定义外观可以控制 desktop window 的透明呈现

🔧 Improvements

- 优化 Project Map 稳定性，收紧数据集补全、生成 worker、交互布局、节点证据和任务抽屉的状态边界
- 优化 Project Map 结构化模型输出解析，将通用 normalization 能力抽离为共享服务，降低模型返回形态漂移导致的整理失败
- 优化 Markdown 预览渲染与交互状态，增强文件刷新、GitHub 风格 Markdown、公式和图表预览的测试覆盖
- 优化 Runtime Pool 与 Codex Settings 文案、i18n 和测试覆盖，让启动配置、运行池状态和环境诊断更容易核对
- 优化启动诊断与环境恢复链路，清理 optional visual effects、engine doctor 和 session history stale repair 相关噪声
- 优化 diagnostics watchdog 记录范围，保留 Codex 无进展生命周期和三证对账早期信号，同时减少无关日志持久化
- 优化 Composer 文件引用入口，即使文件树尚未打开也能使用 workspace 文件索引完成 `@` 引用
- 优化 Composer 输入区高度与折叠入口，让首页与会话区的输入体验更紧凑、可恢复
- 优化消息恢复卡片与 Fork 入口展示，将 stale recovery 场景下的继续执行路径和分叉入口区分得更明确
- 优化 Git diff 规范化展示模型，统一 renamed / deleted / untracked 等文件状态在 diff 面板中的分组与路径呈现
- 优化线程事件处理结构，拆分 terminal event helper 与事件类型，降低会话恢复和运行时事件链路的维护成本
- 优化文件 tab 独立窗口图标主题色，让 detached file explorer 在不同主题下保持更一致的视觉反馈
- 优化工作区文件树首屏加载，改用 root-first directory children 路径，减少启动和切换工作区时的递归扫描压力
- 优化远程工作区 Git / GitHub 操作转发矩阵，降低 remote backend 模式误走本地 Git 的风险
- 优化工作区会话文件夹相关操作，补齐远程后端转发并收敛阻塞式文件扫描边界
- 补齐三证结算状态查询的 OpenSpec 设计记录与二阶段启动条件，增强 diagnostics 能力的交付可追踪性
- 补齐三证对账采证日志，让 diagnostics 能记录 settlement evidence collection 过程，便于复盘 timeout、missing evidence 和状态漂移
- 升级应用版本号到 `0.5.4`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复核心错误日志缺少本地持久化的问题，让 renderer/runtime 异常可以被后续 diagnostics 查询复盘
- 修复三证结算状态缺少干跑与查询对账入口的问题，降低状态漂移时难以定位的风险
- 修复用户输入请求跳过后未正确结算的问题，避免已跳过问题继续停留在 pending 状态
- 修复用户输入卡片收起、跳过和恢复链路中的展示漂移，让历史消息与实时请求保持一致
- 修复 Composer 未开文件树时文件引用失效的问题，降低空索引或未初始化文件树导致的引用失败
- 修复命令补全打开时快捷发送失效的问题，避免 Composer command menu 抢占发送快捷键
- 修复 Web Service 添加工作区时路径输入未正确接入的问题，让 Web 模式也能通过输入路径添加 workspace
- 修复本地运行产物大文件进入治理扫描的问题，将 Tauri target / Whisper build artifact 纳入噪声排除边界
- 修复知识地图生成与布局链路中的边界状态问题，降低节点重复、任务状态漂移和图谱定位不稳的概率
- 修复首页 Composer 纯文本输入后发送按钮仍不可用的问题，并保持首页主按钮在浅色主题下的经典蓝样式
- 修复 Web Service 误选空壳前端资源导致 `/app` 白屏的问题，启动时会继续探测后续有效 dist 候选
- 修复工作区文件树首屏缓存、fallback 与 unmount 后异步回写边界，避免迟到响应污染当前 workspace 状态
- 修复文件树 fallback 根层快照边界，避免 fallback 数据覆盖当前 root-first 文件树状态
- 修复三证状态查询超时后未正确收口的问题，避免 diagnostics settlement 在无响应时长期悬挂
- 修复助手回复复制入口重复或位置漂移的问题，让消息操作入口在 timeline 与 rows 渲染路径中保持一致
- 修复自动会话可见性、归类和失败路径元数据链路，避免自动创建的 session 在 Sidebar、文件夹计数和恢复流程中不可见或归类错误
- 修复 daemon helper read 运行时守卫缺失的问题，降低远程 daemon 状态读取异常导致的运行时崩溃风险
- 修复文件 tab 独立窗口拖拽与多实例边界，避免 detached file explorer 多窗口会话互相覆盖或拖拽状态串线
- 修复 Codex 线程列表和引擎切换错误的降级处理，避免异常响应直接打断 engine controller 状态恢复
- 修复 Project Map 模型结构化输出解析不稳的问题，提升节点整理、候选生成和增量图谱更新对异常模型输出的容错

English:

✨ Features

- Add a structured Codex launch-profile preview in Settings for command, sandbox, approval, model, reasoning effort, and environment overrides
- Add Codex doctor / launch-profile backend query support so the configuration panel can read effective launch facts instead of showing static metadata
- Add a close-current-session shortcut for quickly closing the active workspace session tab
- Add a Codex goal command-palette entry so goals can be created and managed from the Composer command flow
- Add collapse and skip interactions for user-input requests so pending questions can be settled, folded, and restored more clearly in the message timeline
- Add persisted core error logs and three-evidence settlement diagnostics with dry-run checks, status queries, and frontend/backend reconciliation
- Add AI organization candidates for Project Map discovered items, with structured merging, filtering, and review of candidate nodes
- Add message-tail action icons so copy, fork, and related assistant-response actions are consolidated into clearer per-message entrypoints
- Add the embedded Browser Agent MVP with an in-app browser dock, platform capability checks, browser-context attachments, and Task Center integration
- Add structured browser-context capture with page summaries, DOM/code candidates, read-only capture scripts, context previews, and Composer attachment injection
- Add native window transparency settings so custom appearance presets can control desktop window translucency

🔧 Improvements

- Improve Project Map stability by tightening dataset completion, generation worker, interactive layout, node evidence, and task drawer state boundaries
- Improve Project Map structured model-output parsing by extracting shared normalization support and reducing failures from drifting model response shapes
- Improve Markdown preview rendering and interaction state with stronger coverage for refresh behavior, GitHub-style Markdown, math, and diagram previews
- Improve Runtime Pool and Codex Settings copy, i18n, and test coverage so launch configuration, runtime status, and environment diagnostics are easier to verify
- Improve startup diagnostics and environment recovery by reducing noise around optional visual effects, engine doctor, and stale session-history repair
- Improve diagnostics watchdog persistence so Codex no-progress lifecycle and early three-evidence reconciliation signals are retained without unrelated log noise
- Improve Composer file references so `@` suggestions can use the workspace file index even before the file tree has been opened
- Improve Composer input height and collapsed entrypoints so home and conversation inputs stay compact and recoverable
- Improve reconnect cards and fork entrypoints so stale-recovery continuation paths and fork actions are easier to distinguish
- Improve the canonical Git diff display model so renamed, deleted, untracked, and related file states render consistently in diff grouping and paths
- Improve thread event handling structure by splitting terminal-event helpers and event types, reducing maintenance risk in session recovery and runtime-event flows
- Improve detached file explorer icon theme colors so file-tab popout windows provide more consistent visual feedback across themes
- Improve workspace file-tree first paint with a root-first directory-children path to reduce recursive scan pressure during startup and workspace switches
- Improve remote-workspace Git / GitHub forwarding coverage so remote backend mode does not fall back to local Git execution
- Improve workspace session-folder operations by forwarding remote backend commands and narrowing blocking filesystem scan boundaries
- Add OpenSpec design notes and phase-two entry conditions for three-evidence settlement status queries to improve diagnostics traceability
- Add three-evidence reconciliation evidence-collection logs so diagnostics can reconstruct timeout, missing-evidence, and state-drift cases
- Bump app version to `0.5.4` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix missing local persistence for core error logs so renderer/runtime failures can be reviewed through diagnostics later
- Fix missing dry-run and query reconciliation entrypoints for three-evidence settlement status, reducing drift that is hard to diagnose
- Fix skipped user-input requests not settling correctly, preventing skipped questions from remaining pending
- Fix display drift in user-input card collapse, skip, and restoration flows so history and realtime requests stay aligned
- Fix Composer file references failing when the file tree has not been opened, reducing failures from empty or uninitialized file indexes
- Fix quick-send behavior while the command completion menu is open so the Composer command menu no longer swallows send shortcuts
- Fix Web Service add-workspace path input wiring so web mode can add workspaces from an entered path
- Fix local runtime artifact noise in large-file governance scans by excluding Tauri target / Whisper build artifacts
- Fix Project Map generation and layout boundary states to reduce duplicate nodes, task-state drift, and unstable graph positioning
- Fix homepage Composer plain-text input not enabling the send button, while preserving canonical blue primary styling in light themes
- Fix Web Service choosing an empty shell frontend asset root and showing a blank `/app`; startup now continues to later valid dist candidates
- Fix workspace file-tree first-paint cache, fallback, and post-unmount async boundaries so late responses cannot pollute the active workspace state
- Fix file-tree fallback root snapshot boundaries so fallback data cannot overwrite the active root-first file-tree state
- Fix three-evidence status-query timeout finalization so diagnostics settlement cannot hang indefinitely on missing responses
- Fix duplicated or drifting assistant-response copy entrypoints so message actions stay aligned across timeline and row render paths
- Fix automatic session visibility, classification, and failure-path metadata so auto-created sessions remain visible in Sidebar, folder counts, and recovery flows
- Fix missing runtime guards around daemon helper reads, reducing crashes from abnormal remote daemon state reads
- Fix detached file-tab drag and multi-instance boundaries so detached file explorer windows no longer overwrite each other or leak drag state
- Fix degraded handling for Codex thread-list and engine-switch errors so abnormal responses do not break engine-controller recovery
- Fix Project Map structured-output parsing resilience for node organization, candidate generation, and incremental graph updates

---

### **2026年5月27日（v0.5.3）**

中文：

✨ Features

- 新增项目知识地图基础能力，支持从工作区结构、文件证据和项目上下文生成可浏览的知识图谱
- 新增知识地图增量生成与交互图谱能力，支持全局合并、节点级补充、证据链追踪和手动裁剪
- 新增知识地图自动补充队列，将候选节点、证据文件和生成任务串成可审计的补全流程
- 新增记忆画布工具折叠态，保留核心生成入口的同时降低知识地图面板的视觉占用

🔧 Improvements

- 优化知识地图生成提示词、结构化输出修复和兼容性边界，降低模型输出异常导致的生成失败
- 优化知识地图节点选择、视口定位、头部折叠工具栏、证据 chip 和 inspector 交互，让图谱浏览与证据核对更稳定
- 优化项目地图规范证据，将 Project Knowledge Map 的基础契约、增量生成、候选复核、自动补充和画布控制同步到 OpenSpec 主规范
- 拆分会话目录与线程恢复逻辑，降低 `useThreadActions` 和 session catalog 链路的维护复杂度
- 合并 Composer 上下文来源展开/收起入口，减少 readiness 区域和 context ledger 入口之间的交互漂移
- 升级应用版本号到 `0.5.3`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复会话文件夹删除状态同步、空文件夹树删除和删除文件夹后会话归属提升问题
- 修复 Claude 长流式渲染恢复问题，降低长输出场景下消息区空白或恢复不完整的概率
- 修复 Codex 后台响应解析与流式空白恢复诊断问题，让异常响应和空白流式状态更容易被识别
- 修复知识地图生成链路、入口显隐控制和节点选择视口稳定性问题
- 修复 Sidebar 会话移动反馈与子菜单定位问题，提升会话文件夹操作的可预期性
- 稳定会话文件夹菜单、移动、Settings 删除会话、Codex 配置面板和 renderer diagnostics 相关测试

English:

✨ Features

- Add the Project Knowledge Map foundation for generating a browsable knowledge graph from workspace structure, file evidence, and project context
- Add incremental Project Map generation and interactive graph support with global merges, node-scoped enrichment, evidence tracing, and manual pruning
- Add an auto-ingestion queue for Project Map candidate nodes, evidence files, and auditable generation tasks
- Add collapsed canvas-tool controls for the memory canvas so core generation actions remain available with less panel noise

🔧 Improvements

- Improve Project Map prompts, structured-output repair, and compatibility boundaries to reduce generation failures from malformed model output
- Improve Project Map node selection, viewport positioning, collapsed header tools, evidence chips, and inspector interactions for steadier graph review
- Sync Project Knowledge Map contracts into OpenSpec main specs, including base behavior, incremental generation, candidate review, auto ingestion, and canvas controls
- Split session catalog and thread-resume logic to reduce maintenance pressure in `useThreadActions` and session catalog flows
- Merge Composer context-source expand/collapse controls so readiness and context-ledger entrypoints no longer drift
- Bump app version to `0.5.3` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix session-folder delete synchronization, empty folder-tree deletion, and session ownership promotion after folder deletion
- Fix Claude long-stream rendering recovery to reduce blank or incomplete message restoration in long-output sessions
- Fix Codex background response parsing and blank streaming recovery diagnostics so abnormal responses are easier to identify
- Fix Project Map generation flow, entry visibility controls, and node-selection viewport stability
- Fix Sidebar session-move feedback and submenu positioning for more predictable session-folder operations
- Stabilize tests for session folder menus, folder moves, Settings session deletion, Codex settings panels, and renderer diagnostics

---

### **2026年5月24日（v0.5.2）**

中文：

✨ Features

- 统一 Claude 工作区会话目录读取链路，将 Sidebar、Workspace Home 和 Settings 的 session membership 收敛到共享 catalog projection，降低会话列表被吞或漂移的概率
- 增加运行态证据门禁与稳定性校准链路，按 measured / proxy / unsupported / manual-only 分类性能与稳定性证据，强化 release 前验证闭环
- 新增 Git diff tree 共享构建逻辑，统一 Git Diff 与 Git History/HUB worktree 的目录压缩、文件选择和路径展示规则

🔧 Improvements

- 收紧会话目录事实边界，明确 source completeness、archive evidence、related sessions、pagination cursor 与 metadata overlay 的职责边界
- 收紧 active Sidebar 会话水合策略，使用完整 catalog 作为事实源，避免 first-page 快照或手动刷新覆盖完整会话列表
- 强化 finalized native session isolation，阻止已落盘的 Claude / Gemini / OpenCode session 被 realtime update 或持久 alias 误改绑
- 收紧 Claude 控制面过滤，避免普通对话里提到 `codex app-server` 时被错误当作控制面文本过滤
- 改进 Windows Claude 流式诊断，将 command、tool、file、terminal 等 non-text runtime progress 作为可见进展，降低首包等待误判
- 调整底部状态面板折叠语义，折叠态保留 dock tab bar 与展开入口，并将 OpenCode 纳入 baseline dock 支持
- 移除 Composer 工具栏里重复的 status panel toggle 入口，让底部 dock 由自身控件负责展开和折叠
- 统一 Git 文件树复选框位置、目录行职责、compact folder 展示、字体 token、状态色和 overlay close button 样式，降低 Git surfaces 之间的视觉漂移
- 补齐 session-management、stale recovery 与 runtime evidence gate 的 OpenSpec 收尾、验证记录和平台证据限定说明
- 升级应用版本号到 `0.5.2`，同步前端包与 Tauri 配置版本

🐛 Fixes

- 修复 Claude 第二轮或后续会话 reopen 后出现空白、无法切回原 session 的回归
- 修复 catalog `partialSource` 被误当作 load-older cursor 的问题，避免 Sidebar 重复请求第一页或显示错误的“加载更早”入口
- 修复会话恢复与目录全量水合中的状态漂移，避免 degraded source、scan cap 或 stale refresh 清空健康 engine 的会话快照
- 修复底部状态面板折叠时 tab bar 被卸载的问题，避免 `用户对话 / 结果` 入口消失
- 修复 Git worktree / diff 文件树复选框与字体样式不一致的问题，避免选择入口抢占文件阅读路径
- 修复运行态证据报告在 missing / malformed source 场景下静默漏报的问题，改为显式 unsupported / degraded evidence
- 修复 Messages timeline virtualizer unmount 时遗留 scroll-end fallback timer 的稳定性问题
- 修复性能脚本临时目录前缀问题，避免运行时生成路径污染

English:

✨ Features

- Unify the Claude workspace-session catalog read-chain so Sidebar, Workspace Home, and Settings converge on a shared catalog projection for session membership
- Add runtime evidence gates and stability calibration with measured / proxy / unsupported / manual-only evidence classification before release closure
- Add shared Git diff-tree construction so Git Diff and Git History/HUB worktree views use the same compact folder, file-selection, and path-display rules

🔧 Improvements

- Tighten session-directory truth boundaries across source completeness, archive evidence, related sessions, pagination cursors, and metadata overlay
- Tighten active Sidebar hydration so the full catalog becomes the fact source instead of being overwritten by first-page snapshots or manual refreshes
- Strengthen finalized native session isolation so persisted Claude / Gemini / OpenCode sessions are not rebound by realtime updates or stale aliases
- Tighten Claude control-plane filtering so ordinary messages mentioning `codex app-server` remain visible conversation content
- Improve Windows Claude stream diagnostics by treating command, tool, file, and terminal events as non-text runtime progress
- Refine bottom status dock collapse semantics so collapsed state keeps the tab bar and expand entrypoint, with OpenCode included in baseline dock support
- Remove the duplicate status-panel toggle from the Composer toolbar so the bottom dock owns its own expand/collapse controls
- Standardize Git file-tree checkbox placement, folder-row responsibilities, compact folder rendering, typography tokens, status colors, and overlay close-button styling
- Complete OpenSpec closeout and validation records for session management, stale recovery, and runtime evidence gates, including explicit platform-evidence qualifiers
- Bump app version to `0.5.2` and align frontend/package metadata with Tauri configuration

🐛 Fixes

- Fix Claude second-or-later session reopen regressions where the original session could restore as a blank, non-switchable thread
- Fix catalog `partialSource` being treated as a load-older cursor, preventing repeated first-page requests and misleading load-older affordances
- Fix session recovery and full-directory hydration drift so degraded sources, scan caps, or stale refreshes do not clear healthy engine snapshots
- Fix bottom status dock collapse unmounting the tab bar and hiding the `User conversation / Result` entrypoints
- Fix Git worktree / diff file-tree checkbox and typography inconsistency so selection controls no longer interrupt file scanning
- Fix runtime evidence reports silently dropping missing or malformed sources; they now emit explicit unsupported / degraded evidence
- Fix Messages timeline virtualizer teardown stability by clearing pending scroll-end fallback timers on unmount
- Fix temporary-path-prefix regressions in performance scripts

---

### **2026年5月22日（v0.5.1）**

中文：

✨ Features

- 新增邮件驱动会话闭环，支持从 completion email 直接回复并续接原 workspace、thread、session 和 turn，形成可审计的远程继续执行路径
- 新增可回复 completion email 协议，邮件标题包含 engine、session 和 workspace，正文收敛为本轮请求、修复信息、下一步建议与可校验 Moss context
- 新增邮箱收信监听与邮件会话管理页，支持查看 Moss 邮件事件、待确认/异常回复、清理已处理记录并跳转回对应会话
- 新增 Composer 记忆引用持续模式，支持单次引用和一直开启引用，降低连续多轮使用 Project Memory 时的重复操作成本
- 新增 Composer 控制面视觉契约，将模型选择、工具 dock、上下文 chip、发送按钮和 active 工具状态收敛到更稳定的布局体系

🔧 Improvements

- 优化邮件回复解析与 inbound intake，支持自然语言回复、`ACTION` 指令、引用正文剥离、去重、过期校验和只读邮箱游标
- 优化邮件会话列表管理，按 Moss session 聚合展示事件时间线，避免普通无关邮件进入客户端存储或 UI
- 优化模型选择器，按 Claude Code、Codex、Gemini provider 分组展示，并将模型入口上移到 readiness target
- 优化 Composer 底部工具区，统一 icon-only hit area、选中态叠加 check、主题色继承和小号方形发送按钮
- 优化 selected skill、command 和 agent context chips 展示位置，将上下文 chip 上移到输入区上方，避免底部工具栏语义混杂
- 优化 StatusPanel dock、Terminal dock 和运行中 stop button 视觉一致性，降低底部栏高度并保留折叠入口
- 升级应用版本号到 `0.5.1`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复邮箱授权码输入框默认明文展示问题，改为脱敏展示并提供显式显示/隐藏切换
- 修复邮件续接正文提取与轮询下限问题，避免后续 completion email 复用上一轮正文或因过低轮询间隔造成不稳定
- 修复 Codex 空草稿首次发送遇到 stale thread 时的恢复路径，只允许 disposable first-turn draft 自动 fresh-create 并 replay 一次
- 修复 durable Codex 会话在 `thread not found` 或 malformed thread id 场景下被静默替换的风险，保留保守 stale recovery 行为
- 稳定 WebService daemon 启动测试，降低设置页服务启停回归测试中的异步抖动
- 补齐邮件闭环、记忆引用模式、Composer 控制面、dock 视觉和 Codex stale draft 边界的 focused 测试与 OpenSpec 验证记录

English:

✨ Features

- Add an email-driven session continuation loop so replies to completion emails can resume the original workspace, thread, session, and turn through an auditable remote-control path
- Add an actionable completion-email protocol with engine, session, and workspace in the subject plus compact request, fix summary, next steps, and verifiable Moss context in the body
- Add inbound mailbox listening and mail-session management surfaces for Moss event timelines, pending/rejected replies, processed-record cleanup, and jump-back actions
- Add persistent Composer memory-reference mode with single-use and always-on options for lower-friction Project Memory use across multiple turns
- Add a stabilized Composer control-surface contract covering model selection, tool dock layout, context chips, send controls, and active tool states

🔧 Improvements

- Improve mail reply parsing and inbound intake with natural-language replies, `ACTION` commands, quoted-body stripping, dedupe, expiry checks, and read-only mailbox cursors
- Improve mail-session list management by grouping Moss events by session while keeping unrelated ordinary mail out of client storage and UI
- Improve the model selector with Claude Code, Codex, and Gemini provider groups, moving the model entrypoint into the readiness target
- Refine the Composer bottom toolbar with unified icon-only hit areas, check overlays for selected tools, theme-inherited colors, and a compact square send button
- Move selected skill, command, and agent context chips above the editor so the bottom toolbar no longer mixes context chips with tool controls
- Align StatusPanel dock, Terminal dock, and streaming stop-button visuals with lower bottom bars and preserved collapsed entrypoints
- Bump the app version to `0.5.1` across frontend package metadata and Tauri configuration

🐛 Fixes

- Mask mailbox app-password inputs by default and add explicit show/hide controls
- Fix mail continuation body extraction and polling floors so follow-up completion emails do not reuse previous-turn summaries or run with unstable low polling intervals
- Fix Codex empty-draft first sends when stale thread bindings appear, allowing only disposable first-turn drafts to fresh-create and replay once
- Preserve conservative stale recovery for durable Codex sessions instead of silently replacing them on `thread not found` or malformed thread-id failures
- Stabilize the WebService daemon start test to reduce async flakiness in Settings service start/stop regressions
- Add focused coverage and OpenSpec validation records for the email loop, memory-reference modes, Composer control surface, dock visuals, and Codex stale-draft boundaries

---

### **2026年5月20日（v0.5）**

中文：

✨ Features

- 新增 Markdown 文件预览公式与图表渲染能力，支持更完整的技术文档查看体验
- 新增残留工具调用 XML 的交互式卡片渲染，让异常或未完整解析的工具调用也能在消息区被识别和核对
- 新增治理证据只读桥接、capability 感知查询入口和 policy 判决审计面板，让运行时治理状态更可追踪
- 新增跨工作区成本预算收口能力，支持按引擎、项目和 token 维度沉淀成本投影
- 新增项目会话管理幕布，集中管理工作区会话、文件夹状态和会话归属边界
- 新增 runtime performance baseline 采集层与 producer scripts，为后续性能回归提供可复用基线

🔧 Improvements

- 优化运行时性能基线、bundle 拆分、面板懒加载与事件监听策略，降低首屏和长会话压力
- 将 GitDiffPanel、FileViewPanel 和 KaTeX 资源改为按需加载，减少初始 bundle 与 Markdown 预览成本
- 统一 lucide-react 子路径导入、scroll passive 监听和全局 keydown dispatcher，降低重复事件处理开销
- 优化消息滚动节流与渲染条件表达，减少长消息流和复杂 Markdown 场景下的无效重渲染
- 拆分线程、文件、Git history、i18n、Claude tests 与 harness 等大模块边界，提升维护性与测试聚焦度
- 拆出线程动作加载、历史回退、实时历史对齐、事件诊断和用户提问历史归一化职责，让线程链路更清晰
- 收口 harness 治理 release-grade 闭环，并同步近期 OpenSpec 规范、验证记录和生产评审文档
- 优化会话切换体验，同工作区切换时保留编辑器分栏与上下文连续性

🐛 Fixes

- 修复 Claude 与多引擎会话列表超时兜底，降低侧栏加载失败时的断裂感
- 修复 Markdown 预览刷新、代码区图片标签误转换和文件变更监控相关问题
- 修复 Git 变更文件单击打开编辑器、设置页会话窗超时与文件夹统计边界问题
- 修复长会话尾部生成状态，避免完成阶段残留生成态影响后续交互判断
- 修复 Claude subagent 泛化 Agent 标题过滤与会话侧栏展示投影问题，减少历史列表误判
- 修复用户提问卡片交互归一化问题，让 request user input 和历史恢复展示更一致
- 修复 Claude 上下文查询过频问题，降低运行时轮询和侧栏刷新压力
- 稳定运行时恢复、Markdown 数学渲染、会话文件夹、线程启动和乐观渲染相关测试

English:

✨ Features

- Add Markdown file-preview support for math formulas and diagrams for richer technical-document rendering
- Render leftover tool-call XML as interactive cards so malformed or partially parsed tool calls remain visible and reviewable
- Add a read-only governance-evidence bridge, capability-aware queries, and a policy-decision audit panel so runtime governance is easier to trace
- Add cross-workspace cost-budget closure with engine, project, and token-level cost projections
- Add a project-session management curtain for centralized workspace-session, folder-state, and ownership-boundary management
- Add a runtime performance-baseline collection layer and producer scripts for reusable regression baselines

🔧 Improvements

- Improve runtime performance baselines, bundle chunking, panel lazy loading, and event-listener strategy to reduce first-screen and long-session pressure
- Lazy-load GitDiffPanel, FileViewPanel, and KaTeX assets to reduce initial bundle and Markdown preview cost
- Unify lucide-react subpath imports, passive scroll listeners, and the global keydown dispatcher to reduce duplicated event overhead
- Improve message scroll throttling and conditional rendering to reduce unnecessary rerenders in long streams and complex Markdown surfaces
- Split large thread, file, Git history, i18n, Claude test, and harness modules to improve maintainability and test focus
- Extract thread action loading, history fallbacks, realtime history reconciliation, event diagnostics, and user-question history normalization into clearer boundaries
- Close the harness governance release-grade loop and sync recent OpenSpec contracts, validation records, and production-review docs
- Improve session switching so editor split state and context are preserved within the same workspace

🐛 Fixes

- Fix Claude and multi-engine session-list timeout fallbacks to reduce sidebar breakage during slow loads
- Fix Markdown preview refresh, code-block image-tag conversion, and file-change watcher issues
- Fix single-click editor opening from Git changed files plus Settings session-window timeout and folder-count boundaries
- Fix long-session tail generation state so completed turns no longer leave stale generating indicators behind
- Fix Claude subagent generic Agent-title filtering and sidebar display projection to reduce history-list misclassification
- Normalize user-question card interactions so request-user-input and history-restored displays behave consistently
- Reduce Claude context-query frequency to lower runtime polling and sidebar refresh pressure
- Stabilize tests around runtime recovery, Markdown math rendering, session folders, thread startup, and optimistic rendering

---

### **2026年5月15日（v0.4.18）**

中文：

✨ Features

- 新增项目记忆语义召回骨架，支持本地记忆索引、检索包清洗和上下文注入，为长期项目会话提供更稳定的记忆材料
- 新增完整对话轮次记忆能力，将多消息 turn 以更完整的语义单元沉淀到项目记忆，减少片段化召回导致的上下文缺口
- 新增大项目文件树渐进式加载能力，降低大型工作区首次展开和目录浏览时的阻塞感

🔧 Improvements

- 优化项目记忆引用展示与详情弹窗，统一引用入口、召回结果和详情内容的呈现方式，让记忆证据更容易核对
- 优化记忆工作台弹窗体验，收敛长期记忆入口展示边界，减少侧栏干扰并提升记忆管理的聚焦度
- 加固 Codex 静默会话存活判定与验证记录，降低后台会话无输出时被误判为失联的概率
- 稳定核心运行时与实时契约，收敛 runtime、streaming 和 realtime 事件边界，减少长会话状态漂移
- 增强 Claude 流式首包延迟诊断与 stream-json 存活检测，让慢启动、无首包和异常退出更容易定位
- 同步、归档并清理近期 OpenSpec 发布文档，补齐 Phase 1 收口、AppImage Wayland 修复和成熟流式输出重构的验证记录
- 升级应用版本号到 `0.4.18`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复记忆引用召回完整性问题，避免项目记忆引用缺失或详情无法完整追溯
- 修复 Claude 会话创建、侧栏连续性和列表窗口稳定性问题，降低会话恢复与列表刷新时的断裂感
- 修复 Claude pending 会话收敛问题，避免 pending 状态残留影响后续续聊或恢复入口
- 修复 prompt enhancer 增强结果重复问题，并增强 Claude 失败诊断与兜底，降低增强链路失败时的黑盒感
- 修复长期记忆入口误展示问题，避免未成熟入口暴露在主侧栏流程中

English:

✨ Features

- Add a project-memory semantic-recall foundation with local memory indexing, retrieval-pack cleanup, and context injection for more stable long-lived project context
- Add full conversation-turn memory so multi-message turns are stored as more complete semantic units instead of fragmented recall snippets
- Add progressive loading for large project file trees to reduce blocking during first expansion and directory browsing

🔧 Improvements

- Improve project-memory reference display and detail dialogs by unifying reference entrypoints, recall results, and detail content for easier evidence review
- Refine the memory-workbench dialog and long-term memory entry visibility so memory management stays focused without sidebar noise
- Harden Codex silent-session liveness detection and validation records so quiet background sessions are less likely to be treated as disconnected
- Stabilize core runtime and realtime contracts by tightening runtime, streaming, and realtime event boundaries for long-session state consistency
- Improve Claude first-token latency diagnostics and stream-json liveness checks so slow starts, missing first packets, and abnormal exits are easier to debug
- Sync, archive, and clean up recent OpenSpec release documents, including Phase 1 closure, AppImage Wayland validation, and mature streaming-output refactor records
- Bump the app version to `0.4.18` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix project-memory reference recall completeness so referenced memories and their details remain traceable
- Fix Claude session creation, sidebar continuity, and list-window stability to reduce breaks during recovery and list refreshes
- Fix Claude pending-session convergence so stale pending state no longer destabilizes follow-up or resume entrypoints
- Fix duplicate prompt-enhancer results and improve Claude failure diagnostics and fallback behavior
- Hide the long-term memory entry from the main sidebar flow until the surface is ready

---

### **2026年5月13日（v0.4.17）**

中文：

✨ Features

- 新增 Claude TUI resume 操作，在普通会话、pinned 会话、工作区会话和文件夹树入口中提供恢复到 Claude TUI 的路径，降低从历史会话继续原生 Claude 工作流的操作成本
- 新增 composer 发送就绪与队列提示栏，显式展示当前输入是否可发送、队列是否合并以及后台运行状态，减少排队发送和状态判断的不确定性
- 新增 CLI 一键安装实时日志与边界保护，在设置页提供安装过程可视反馈、事件流更新和更明确的前置检查，降低安装失败时的黑盒感

🔧 Improvements

- 迁移动态业务菜单到 renderer 侧上下文菜单，收敛 macOS native menu 的同步调用边界，并新增菜单使用检查脚本，降低菜单打开时主线程假死风险
- 稳定 Codex 会话生命周期恢复链路，补齐 runtime 会话恢复命令、诊断信息和测试覆盖，让异常退出后的会话状态更容易恢复与定位
- 优化运行中会话后台调度，引入 runtime session scheduling、后台活跃度投影与诊断标记，降低 realtime 会话在高并发或长时运行下的 CPU 压力
- 收敛会话事实与恢复状态模型，补齐 conversation fact contract、history normalization 和全局 runtime notice，减少历史恢复、运行态重连和 UI 展示之间的状态漂移
- 优化 Claude 历史大图片载荷处理，将大图片内容延迟加载并接入独立命令链路，降低历史列表和消息渲染时的内存与首屏压力
- 收紧 composer 局部布局，缩小输入区提交按钮并压缩消息队列高度，同时将队列内容重新居中，提升高频发送场景下的空间利用率
- 调整工作区卡片眼睛按钮位置与可见性反馈，让工作区显示控制入口更贴近卡片语义区域，并减少侧栏局部布局干扰
- 同步并归档 Codex runtime、Claude context usage 与 Claude TUI resume 相关 OpenSpec 规范，保持行为契约、实现和验证记录一致
- 回写 CLI installer、runtime 后台调度与 realtime turn 清算相关 OpenSpec 文档，保持近期行为变更与规范记录对齐

🐛 Fixes

- 修复 Codex `SessionStart` hook 阻塞后的兜底恢复问题，避免 app server wrapper 启动失败后会话无法继续创建或恢复
- 修复 macOS native 菜单死锁风险，避免动态业务菜单在 native menu 回调中触发阻塞式前端调用
- 修复模型选择同步循环，避免 app shell 与模型选择状态互相回写导致重复更新
- 修复 realtime turn 完成清算竞态，避免 turn 在完成阶段因事件收口顺序不稳定而出现生命周期状态漂移
- 修复终态 turn 迟到事件污染线程的问题，对已完成、失败或取消的 turn 建立终态 fence，避免延迟事件把线程重新拉回运行态
- 修复 pending alias 解析短路兼容问题，避免 realtime 事件映射在别名路径下提前返回并漏掉有效状态更新
- 修复 queue-fusion 后续 realtime continuation 被误判为中断线程的问题，确保队列融合不会写入 interrupted guard 状态
- 修复消息发送回调依赖缺失问题，降低长会话发送、续写和实时事件接续时使用旧闭包的风险
- 修复 Codex 计划模式状态显示问题，让 mode selector、composer 状态面板和计划模式展示保持一致
- 优化 Git diff 与 Git history 顶部操作栏悬停隐藏行为，避免鼠标移动时操作入口过早消失
- 修复代码块跨行选区锚点问题，避免从代码块内拖选到普通文本时选区起点或复制范围漂移
- 修复本地图片预览加载问题，让文件预览面板可以正确解析并展示本地图片资源，同时补齐加载失败提示
- 修复 Linux AppImage 在 Arch Linux / Wayland / Mesa 环境下因 bundled `libwayland-*` 冲突导致的启动失败，发布流程会在签名前剔除冲突库并重新打包
- 修复 Markdown 预览中文件行标注闪烁问题，让标注按钮在预览区展开和 hover 时更稳定
- 修复队列融合状态文案 key 泄露，并优化中文提示表达，避免用户看到未翻译的 i18n key
- 修复 Claude pending 会话续聊竞态，避免 pending 状态被误判导致续聊或 resume 入口行为不稳定
- 补齐输入请求卡片交互锚点和菜单测试，降低交互入口缺失或测试覆盖漂移的风险
- 稳定邮件启用保存测试，降低设置页邮件开关回归测试中的异步状态抖动
- 稳定 Web 服务启动按钮测试，降低设置页 Web Service 启停入口回归测试中的异步状态抖动

English:

✨ Features

- Add Claude TUI resume actions across ordinary sessions, pinned sessions, workspace sessions, and folder-tree entries so historical Claude sessions can continue in the native TUI more directly
- Add composer send-readiness and queue-status hints, making send availability, queue merging, and background runtime state visible before submission
- Add realtime logging and stronger guardrails to the one-click CLI installer so installation progress, event streaming, and prerequisite failures are easier to understand from Settings

🔧 Improvements

- Move dynamic business menus to renderer-side context menus and add a native-menu usage checker, reducing macOS main-thread freeze risk from synchronous native menu callbacks
- Stabilize Codex session lifecycle recovery with runtime recovery commands, diagnostics, and stronger test coverage so interrupted sessions are easier to restore and debug
- Optimize background scheduling for running sessions with runtime scheduling, background-activity projection, and diagnostics flags to reduce CPU pressure in long-lived realtime flows
- Consolidate conversation facts and recovery state with explicit contracts, history normalization, and global runtime notices to reduce drift between history recovery, runtime reconnects, and UI state
- Improve Claude large-image history handling by lazy-loading heavy payloads through a dedicated command path, reducing memory and first-render pressure in history and message views
- Tighten composer layout density by shrinking the submit button, compressing queue height, and re-centering queue content for high-frequency send workflows
- Adjust the workspace-card visibility button position and feedback so the show/hide control stays closer to the card context with less sidebar layout noise
- Sync and archive OpenSpec coverage for Codex runtime recovery, Claude context usage, and Claude TUI resume so behavior contracts, implementation, and verification records stay aligned
- Write back the recent OpenSpec docs for the CLI installer, runtime background scheduling, and realtime turn settlement so spec records stay aligned with the implementation

🐛 Fixes

- Fix Codex `SessionStart` hook fallback recovery so app-server wrapper startup failures no longer leave sessions unable to create or resume
- Fix macOS native menu deadlock risk by avoiding blocking frontend calls from native menu callbacks
- Fix a model-selection synchronization loop between the app shell and selected model state
- Fix a realtime turn-completion settlement race so lifecycle state no longer drifts when completion events arrive in unstable closeout order
- Fix late terminal-turn events polluting threads by adding a terminal fence for completed, failed, or cancelled turns so delayed events cannot move them back into running state
- Fix pending-alias parsing short-circuit compatibility so realtime event mapping does not return early and skip valid state updates on alias-based paths
- Fix queue-fusion realtime continuations being treated as interrupted threads by keeping queue-fusion out of interrupted guard state
- Fix missing message-send callback dependencies, reducing stale-closure risk during long-session sends, continuations, and realtime event handoff
- Fix Codex plan-mode state display so the mode selector, composer status panel, and visible plan-mode state stay aligned
- Refine hover hiding for Git diff and Git history top action bars so action entrypoints do not disappear too early while moving the pointer
- Fix cross-line selection anchors for code blocks so selections dragging from code into normal text keep the expected start point and copied range
- Fix local image preview loading so the file preview panel can resolve and display local image assets correctly, with clearer failure copy
- Fix Linux AppImage startup failures on Arch Linux / Wayland / Mesa by pruning conflicting bundled `libwayland-*` libraries before signing the final release artifact
- Fix Markdown preview file-line annotation flicker during expansion and hover interactions
- Fix queue-merge status i18n key leakage and refine the Chinese copy shown to users
- Fix a Claude pending-session continuation race that could make resume or follow-up behavior unstable
- Add missing interaction anchors and menu tests for input-request cards to reduce entrypoint and coverage drift
- Stabilize the email-enable save test to reduce asynchronous state flakiness in settings regressions
- Stabilize the Web Service start-button test to reduce asynchronous state flakiness around the settings start/stop entrypoint

---

### **2026年5月11日（v0.4.16）**

中文：

✨ Features

- 新增侧栏会话归档菜单，在普通会话、pinned 会话和工作区会话树中提供归档入口，减少长列表整理历史会话的操作成本
- 新增 Claude reasoning effort 配置，让 Claude 会话可以直接在输入区选择推理强度，并与模型选择、共享会话输入链路保持一致
- 新增 Claude 原生 fork session 支持，打通从历史会话直接分叉新分支的能力，减少客户端自行维护上下文映射的复杂度
- 新增 Claude 上下文用量展示与子代理历史能力，支持在运行态获取真实 context usage，并把 Claude 子代理 transcript 与父子关系纳入统一历史解析链路
- 新增 Claude 子代理树展示，在侧栏、线程列表和会话活动面板中提供稳定的父子层级视图，便于跟踪主会话与子代理分支
- 重构 composer 输入工具栏并新增工具弹出面板，将模型、推理与上下文摘要等高频操作收敛到主工具行，同时把低频配置入口折叠到弹出层，提升输入区的信息密度与操作聚焦度
- 新增客户端启动编排能力，为首屏加载、运行时恢复和后台初始化任务建立统一编排与运行时提示链路，让工作区启动过程更可观测、更可降级
- 新增失效输入请求卡片关闭能力，支持用户主动收起已经超时或不再可操作的 RequestUserInput 卡片，减少消息区残留噪音

🔧 Improvements

- 联动 Codex 计划模式入口，让模式选择与工具栏入口状态保持一致，减少计划模式切换时的理解成本
- 精简状态面板对话标签与时间线头部视觉，去掉冗余排序胶囊并压缩顶部留白，让对话时间线阅读节奏更紧凑
- 移除文件标注按钮的位移动画，仅保留透明度反馈，减少局部视觉抖动并降低非必要的动效干扰
- 升级应用版本号到 `0.4.16`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复 Codex 计划模式入口联动问题，避免相关模式切换与展示状态不一致
- 修复非 Git 仓库工作区仍触发自动 Git 状态轮询的问题，避免普通目录下重复探测仓库状态并产生无意义噪音
- 修复文件行标注交互闪烁问题，减少 hover 与展开切换时的视觉抖动
- 修复工具项历史恢复时的运行时类型边界问题，避免异常字段导致状态面板、子代理导航或相关消息区渲染崩溃

English:

✨ Features

- Add sidebar archive actions for ordinary, pinned, and workspace-session tree entries so long-running session lists are easier to clean up
- Add Claude reasoning-effort controls so Claude sessions can choose reasoning intensity directly from the composer and stay aligned with model selection and shared-session input flows
- Add native Claude fork-session support, allowing new branches to be created directly from historical sessions with less client-side context remapping
- Add Claude context-usage reporting and subagent history support so real runtime context consumption and parent-child transcript relationships can be tracked through a unified history pipeline
- Add visible Claude subagent trees across the sidebar, thread list, and session-activity panel for clearer parent-child session navigation
- Rework the composer input toolbar with a new tool popover, keeping high-frequency actions like model selection, reasoning, and context summaries on the main row while moving lower-frequency controls into a secondary panel
- Add client startup orchestration with unified runtime notices for first-screen loading, recovery, and background initialization tasks so workspace startup becomes more observable and easier to degrade safely
- Add dismiss support for stale RequestUserInput cards so expired or no-longer-actionable prompts can be closed from the message surface

🔧 Improvements

- Align the Codex plan-mode entrypoints so mode selection and toolbar entry state behave consistently
- Refine the status-panel conversation tabs and timeline header by removing redundant ordering pills and tightening the top spacing for a denser reading rhythm
- Remove the translate animation from the file-annotation button and keep opacity-only feedback to reduce local motion noise
- Bump the app version to `0.4.16` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix Codex plan-mode entry synchronization so related mode toggles and visible entry states no longer drift apart
- Fix automatic Git status polling in non-repository workspaces so ordinary folders no longer trigger unnecessary repository probes
- Fix flicker in file-line annotation interactions, especially during hover and expansion transitions
- Fix runtime type-safety edges during tool-item history restoration so malformed fields no longer break status panels, subagent navigation, or related message rendering

---

### **2026年5月8日（v0.4.15）**

中文：

✨ Features

- 完善项目会话文件夹管理能力，补齐文件夹内会话归属、移动、删除和历史投影边界，让长期项目的多引擎会话组织更稳定
- 新增 checkpoint 提交确认交互，将结果面板中的提交动作收口到明确确认流程，降低误提交和状态理解成本
- 新增侧栏根会话显示数量配置，支持按工作区控制根层级会话可见数量，减少长列表下的侧栏噪音
- 新增在会话文件夹中新建会话能力，让新会话可以直接落入目标文件夹，减少创建后再移动的操作成本
- 新增 Claude 动态模型发现与配置刷新能力，让模型选择器可以跟随本地配置变化更新可选模型
- 新增 Web Service 访问令牌持久化能力，降低重启后重复配置访问凭据的成本
- 新增文件行标注上下文能力，支持把具体文件行作为会话上下文材料接入，提升代码定位与讨论精度

🔧 Improvements

- 压缩 Git diff 弹窗头部布局，让审查区、可编辑 diff 面板和会话活动面板在小空间下保留更多有效内容区域
- 加固会话历史归属与 folder assignment 兼容边界，减少 Codex、Claude Code、Gemini 历史在项目目录和文件夹视图之间的漂移
- 归一化 checkpoint 提交信息生成入口，让结果面板、提交确认和后续提交文案使用一致的数据来源
- 同步并归档 Claude 思考可见性、控制面会话污染、跨引擎 transcript 隔离和文件树瞬态空态相关 OpenSpec 规范
- 归档已完成 OpenSpec 变更并同步会话文件夹、checkpoint 面板和前端资源定位相关规范，保持行为契约与实现一致
- 升级应用版本号到 `0.4.15`，同步前端包配置与 Tauri 配置

🐛 Fixes

- 修复 Linux AppImage 中前端资源定位异常的问题，避免 web service runtime 在打包环境下找不到前端静态资源
- 修复会话文件夹管理中部分历史归属和删除清理边界，降低 folder tree 与 session catalog 状态不一致的概率
- 修复子文件夹会话归属异常，避免嵌套文件夹中的会话回流到错误层级或根列表
- 修复 Claude 历史会话引擎解析问题，降低历史会话恢复后引擎类型识别错误的概率
- 修复邮件设置加载竞态，避免设置页初始化时出现旧值覆盖或配置状态闪烁
- 修复 Codex 控制面与 Claude 历史之间的运行态污染问题，减少跨引擎历史和控制状态互相串扰
- 修正品牌门禁与本地来源兼容问题，降低 CI 与本地检查在来源识别上的误报概率
- 修复 Claude 思考开关前后端行为不一致的问题，让 thinking visibility 控制在 UI 与后端执行之间保持一致
- 修复项目切换和首次打开工作区时文件树可能短暂显示空态的问题，减少加载过程中的误导性空白
- 修复 Claude 历史控制面消息混入对话记录的问题，并格式化本地事件展示，降低历史回放噪音
- 修复 Claude synthetic transcript 污染问题，避免合成转录内容进入不该进入的引擎上下文通道

English:

✨ Features

- Improve project session folder management with stronger folder assignment, movement, deletion, and history projection behavior for long-lived multi-engine projects
- Add a checkpoint commit confirmation flow so commit actions from the result panel go through an explicit confirmation step
- Add configurable root-session visibility counts in the sidebar so each workspace can reduce root-level session noise
- Add support for creating new sessions directly inside a session folder, avoiding the extra move step after creation
- Add Claude dynamic model discovery and configuration refresh so the model selector can follow local configuration changes
- Add persistent Web Service access tokens to reduce repeated credential setup after restarts
- Add file-line annotation context so specific source lines can be attached to conversations for more precise code discussion

🔧 Improvements

- Compress Git diff dialog headers so review surfaces, editable diff panels, and session activity panels keep more usable content space in constrained layouts
- Harden session-history attribution and folder-assignment compatibility so Codex, Claude Code, and Gemini histories drift less between project and folder views
- Normalize checkpoint commit message generation so result panels, confirmation dialogs, and commit copy use a shared source
- Sync and archive OpenSpec coverage for Claude thinking visibility, control-plane session contamination, cross-engine transcript isolation, and transient file-tree empty states
- Archive completed OpenSpec changes and sync the specs for session folders, checkpoint panels, and frontend resource resolution
- Bump the app version to `0.4.15` across frontend package metadata and Tauri configuration

🐛 Fixes

- Fix frontend asset resolution for Linux AppImage builds so the web service runtime can locate packaged static resources correctly
- Fix session folder cleanup and history attribution edges that could leave the folder tree and session catalog out of sync
- Fix nested-folder session attribution so sessions inside subfolders no longer drift back to the wrong level or root list
- Fix Claude historical session engine parsing to reduce incorrect engine identification during history recovery
- Fix a mail-settings loading race that could cause stale values or flickering configuration state during initialization
- Fix runtime contamination between the Codex control plane and Claude history, reducing cross-engine state leakage
- Fix brand gate and local-source compatibility so CI and local checks produce fewer source-detection false positives
- Fix mismatched Claude thinking-toggle behavior so thinking visibility stays aligned between the UI and backend execution
- Fix transient file-tree empty states during project switching and initial workspace loading
- Fix Claude history control-plane messages leaking into conversation history, and format local event display for quieter replay
- Fix Claude synthetic transcript contamination so generated transcript content stays out of unrelated engine context channels

---

### **2026年5月7日（v0.4.14）**

中文：

✨ Features

- 新增项目会话文件夹能力，支持在左侧工作区会话列表中创建、重命名、删除和嵌套组织文件夹，让长期项目中的 Codex、Claude Code、Gemini 会话更容易按主题归类
- 新增会话移动到文件夹的非拖拽路径，在普通会话和 pinned 会话右键菜单中提供 Move to folder 操作，并支持一键移回项目根目录
- 新增三引擎项目历史归属能力，将 Codex、Claude Code 与 Gemini 本地历史接入统一 session catalog，支持按 cwd、git root、worktree family 等证据归属到项目
- 新增 workspace session folder 的 Tauri 前端桥接契约，补齐 list/create/rename/move/delete/assign 命令 wrapper 与跨层类型定义

🔧 Improvements

- 优化项目会话目录初始加载策略，首屏只加载首批 catalog page，并保留 Load older 续页能力，降低大历史项目打开侧栏时的初始压力
- 强化 folder projection 边界处理，对孤儿 parent、自引用和循环 parent 做降级保护，避免异常 metadata 导致递归渲染或菜单目标漂移
- 对齐 session folder assignment 与 archive/delete/unarchive 状态，删除会话时同步清理 folder assignment，归档状态在全局、项目和 folder 视图之间保持一致
- 拆分 daemon session folder bridge，降低 `daemon_state.rs` 大文件继续膨胀风险，并减少 large-file governance 近阈值告警
- 同步 OpenSpec 任务状态与 Trellis 会话记录，保持项目会话文件夹实现、验证和规范留痕一致

🐛 Fixes

- 修复普通会话和 pinned 会话右键菜单缺少文件夹移动目标的问题，避免只能在 folder tree 内移动会话
- 修复 Codex raw session id 与 `codex:` 前缀 session id 的 folder assignment 兼容问题，避免不同入口写入的分组关系互相丢失
- 修复大历史项目初始刷新可能持续翻页直到耗尽的问题，降低首屏加载卡顿和后台 IO 放大的风险
- 修复批量测试命令在 shell 不可用时缺少登录 shell 回退的问题，提高本地与 CI 测试命令在不同环境下的稳定性
- 修复右侧底部结果面板上拽高度上限与 Git history 顶部留白问题，让布局调整后的可视区域更符合预期

English:

✨ Features

- Add project session folders for organizing Codex, Claude Code, and Gemini sessions inside the left workspace session list with nested folders
- Add a non-drag move path for sessions, exposing Move to folder actions from ordinary and pinned session context menus, including moving back to the project root
- Add unified project-history attribution across Codex, Claude Code, and Gemini local history using cwd, git-root, and worktree-family evidence
- Add Tauri frontend bridge contracts for workspace session folders, including list/create/rename/move/delete/assign wrappers and shared cross-layer types

🔧 Improvements

- Optimize initial project session catalog loading so the first refresh fetches only the first page while preserving Load older pagination for large histories
- Harden folder projection against orphan parents, self-parenting, and parent cycles so corrupted metadata cannot trigger recursive rendering or drifted menu targets
- Align folder assignment state with archive/delete/unarchive mutations so global, project, and folder views share a consistent session state model
- Split the daemon session-folder bridge out of `daemon_state.rs`, reducing large-file growth pressure and lowering near-threshold governance noise
- Sync OpenSpec task state and Trellis session records so implementation, validation, and delivery traceability stay aligned

🐛 Fixes

- Fix missing folder move targets in ordinary and pinned session context menus, making menu-based moves available outside the folder tree
- Fix Codex raw session id versus `codex:`-prefixed session id compatibility for folder assignments so grouping does not disappear across surfaces
- Fix initial refresh behavior that could page through an entire large catalog before rendering the first batch
- Fix batched test command shell fallback handling, improving command stability across local and CI environments
- Fix the lower result panel drag height ceiling and Git history top spacing so adjusted layouts keep the expected visible area

---

### **2026年5月3日（v0.4.13）**

中文：

✨ Features

- 新增低性能兼容模式与诊断导出能力，在设置页提供面向性能敏感场景的兼容开关与诊断信息导出入口，便于在低性能机器上更稳定地使用并快速反馈问题
- 新增 Context Ledger 分阶段治理与来源联动能力，补齐账本归因、来源追踪与幕布区域显隐管理，让上下文来源在会话中更可见、更易管理
- 新增 Task Center 基础能力并接入任务运行生命周期，打通运行态投影、恢复收口与状态承接，让任务运行过程可以被持续追踪
- 新增用户对话时间线样式，将状态面板改造成更聚焦的对话时间线视图，提升会话进展的可读性
- 完善 Claude 与 Gemini 通用幕布组装，并优化实时对话客户端性能，降低长会话和多事件流场景下的卡顿感

🔧 Improvements

- 重构设置页一级入口与父级 Tab 导航，收口原本分散的设置入口，降低查找不同配置项时的跳转成本
- 降低核心模块复杂度并同步归档相关 OpenSpec 提案，减少热点模块继续膨胀的风险，为后续功能迭代留出更稳定的演进空间
- 补齐 Context Ledger 与 Task Center 一阶段提案与执行准备，明确两项后续能力的实施顺序、阶段边界与行为契约
- 归档性能诊断与超时调整等已完成变更，并恢复 `useThreads` 集成测试覆盖，提升规范留痕与回归验证稳定性
- 收敛第一阶段架构硬化边界，减少核心链路复杂度继续扩散的风险，为后续演进保留更清晰的模块分层
- 优化状态面板时间线头部结构与零态展示规则，让会话时间线在有内容和空状态之间都保持一致的视觉节奏

🐛 Fixes

- 修复 Windows 外部文件监控噪声问题，减少文件系统监控在 Windows 环境下的误报和无效提示
- 修复 Codex 压缩状态文案回写问题，让压缩状态在幕布与相关 UI 中保持一致
- 修复 Codex 压缩历史消息丢失与幕布复用异常，避免压缩后历史上下文缺失或错误复用旧幕布内容
- 修复大文件检查脚本参数解析问题，降低 CI 与本地门禁在大文件治理场景下的误判概率
- 修复 Context Ledger 卡片布局压缩与详情渲染异常，减少上下文来源卡片在幕布中的排版错位
- 修复邮件设置卡片背景合并问题，避免设置页局部卡片在视觉上出现不一致
- 修复 Task Center 运行恢复与状态收敛问题，降低任务从运行态回放或恢复时的状态漂移
- 改善 Codex 实时幕布与长幕布流式渲染收敛，减少长线程消息持续生成时的抖动和结构漂移
- 修复右侧面板拖拽提交时机，降低布局调整过程中误触发或交互节奏不稳定的问题
- 修复同版本更新误报问题，避免当前版本与远端版本一致时仍提示可更新
- 修复 Codex 加密推理占位卡片残留问题，减少对话区出现无实际内容的占位块
- 修复状态面板对话标签导航与流式消息细节表现，提升 dock 时间线在切换和长文输出场景下的可读性
- 修复会话删除回退恢复与停滞超时边界问题，降低已删除或异常停滞会话再次回流到界面的概率

English:

✨ Features

- Add a low-performance compatibility mode and diagnostic export entry in Settings, making it easier to stabilize the app on slower machines and share actionable troubleshooting information
- Add phased Context Ledger governance and source-linking so attribution, source tracing, and curtain-area visibility controls are easier to follow during conversations
- Add foundational Task Center capabilities with runtime lifecycle integration, including run-state projection, recovery handoff, and status continuity
- Add a user-conversation timeline presentation in the status panel so session progress is easier to scan
- Improve shared curtain assembly for Claude and Gemini while also optimizing realtime conversation performance for longer, event-heavy sessions

🔧 Improvements

- Rework top-level Settings entry points and parent-tab navigation so related configuration surfaces are easier to find without unnecessary jumps
- Reduce core-module complexity and archive the related OpenSpec proposals, lowering hotspot growth risk and leaving a cleaner base for follow-up iteration
- Fill in the phase-one proposals and execution prep for Context Ledger and Task Center, clarifying rollout order, stage boundaries, and behavior contracts for the next wave of work
- Archive completed diagnostics and timeout-adjustment changes while restoring `useThreads` integration-test coverage, improving delivery traceability and regression confidence
- Tighten first-phase architecture hardening boundaries so core runtime paths stay easier to evolve without spreading complexity
- Refine timeline header structure and empty-state display rules in the status panel so the conversation timeline keeps a steadier visual rhythm

🐛 Fixes

- Fix noisy Windows external file-monitor behavior so filesystem watching surfaces fewer false alarms and less redundant noise
- Fix Codex compaction status copy write-back so compression state stays consistent across the curtain and related UI surfaces
- Fix missing Codex compaction history messages and incorrect curtain reuse, preventing compressed conversations from losing context or reusing stale curtain content
- Fix large-file check argument parsing so CI and local gates are less likely to misfire during large-file governance checks
- Fix compressed Context Ledger card layout and detail rendering issues so context-source cards stay more stable in the curtain
- Fix merged email-settings card background issues to keep settings-page cards visually consistent
- Fix Task Center run recovery and state convergence so restored or replayed task runs are less likely to drift
- Improve Codex realtime and long-curtain streaming convergence, reducing jitter and structural drift during long-running message streams
- Fix right-panel drag commit timing so layout adjustments feel more predictable and less error-prone
- Fix false same-version update prompts so the app no longer reports an available update when the current and remote versions already match
- Fix lingering Codex encrypted-reasoning placeholder cards so empty placeholder blocks are less likely to appear in the conversation view
- Fix status-panel conversation-tab navigation and streaming-detail presentation, improving readability in dock timeline switching and long-form output cases
- Fix deleted-session rollback recovery and stalled-timeout edges so removed or abnormally stalled sessions are less likely to reappear in the UI

---

### **2026年4月30日（v0.4.11）**

中文：

✨ Features

- 新增 Git 历史分支更新能力，支持在不 checkout 当前分支的前提下直接更新本地分支，降低查看历史或维护分支时的切换打断
- 新增 Git 面板文件预览操作，将文件查看入口显式暴露在 Git 面板中，减少从 diff 到文件内容确认的跳转成本
- 新增 Spec Hub 独立阅读窗体与需求池优化，让规范阅读、归档变更查看和需求整理可以在独立窗口中持续进行
- 新增工作区便签池与上下文引用能力，支持把 workspace note card 作为会话上下文材料引用，并在实时与历史幕布中保持关联
- 新增内置终端 Shell 路径配置，支持按本机环境指定 terminal shell，并在设置页补充示例说明
- 新增侧栏隐藏已退出会话能力，让长时间使用后的会话列表可以过滤 exited session，降低侧栏噪音

🔧 Improvements

- 同步分支更新提案的 OpenSpec 主规范与任务完成状态，保持 Git 历史交互、行为规范与实际实现对齐
- 归档已完成提案并补充 Trellis 会话记录，收口这批分支更新与修复交付的规范留痕
- 统一 Git 提交作用域与历史提交区展示语义，降低提交区在大面板场景下的卡顿与状态漂移风险
- 优化 Spec Hub 需求池与独立窗体阅读体验，归档相关 OpenSpec 变更并保持规范状态与实现对齐
- 重构 composer 线程级模型选择链路，补齐启动恢复、线程选择自愈与历史兼容边界，让不同 thread 的模型选择更稳定
- 收紧 doctor、large-file 与 heavy-test-noise 门禁，清理 branding 遗留和调试日志噪音，减少非业务输出干扰严格检查
- 补强合并 PR 边界处理与冲突回归哨兵，降低多 PR 合并后功能点被覆盖回退的风险

🐛 Fixes

- 修复 Git 历史分支更新时无上游提示与边界处理不准确的问题，避免无 tracking 信息场景下给出误导反馈
- 修复 Codex 压缩文案生命周期边界问题，避免压缩提示在错误阶段持续暴露或结算不一致
- 修复缺失会话删除的静默成功语义，让已不存在 session 的删除请求不会误报失败或阻塞后续状态更新
- 修复 Git 提交区大面板卡死问题，并同步提交区相关规范，降低大 diff 场景下的 UI 停顿
- 修复便签引用预览与跨端附件处理问题，避免 note card 附件、引用预览和不同平台路径展示不一致
- 修复便签引用在实时幕布与历史回放中重复展示的问题，避免同一 note context 在消息区被重复渲染
- 修复便签池空态卡片布局异常，让无便签状态下的卡片结构与视觉留白保持稳定
- 修复 PR#480 相关 composer 启动恢复、线程作用域持久化和线程模型作用域回归问题，避免模型选择串到错误 thread
- 修复自定义斜杠命令残留到后续发送的问题，并在发送前提前清理 composer 自定义命令状态
- 修复 Claude 配置刷新后仍使用旧模型标签的问题，让刷新配置后的 composer 展示与实际配置保持一致
- 修复 AskUserQuestion 超时残留结算问题，避免超时后 UI 或线程状态继续保留过期提问
- 修复 Claude 插件缓存技能与软链技能目录发现问题，让插件技能和 symlink skills 可以被正确扫描
- 修复完成事件邮件触发归一化问题，降低 completion email 在不同完成事件来源下漏发或重复触发的概率
- 修复侧栏已退出会话显示切换与运行子会话父级上下文保留问题，让侧栏过滤与子会话归属同时保持正确
- 修复 Codex 记忆摘要重复与历史截图丢失问题，降低历史恢复后摘要和截图材料不一致的概率
- 修复 app shell 模型解析调试日志造成的测试噪音误报，减少回归输出里的无效干扰
- 修复 Spec Hub 独立窗体产物区仍显示“最大化产物”入口的问题，使独立窗体 UI 保持更聚焦

English:

✨ Features

- Add Git history branch updating without requiring a checkout, so local branches can be refreshed directly from the history workflow without interrupting the current branch
- Add explicit file preview actions in the Git panel, reducing the number of jumps needed to inspect file content from a diff workflow
- Add a detached Spec Hub reading window and backlog improvements so archived changes, specs, and requirement pools can stay open independently
- Add a workspace note-card pool with context references, allowing note cards to be attached as conversation context across live and historical views
- Add configurable built-in terminal shell paths, including settings-page examples for local shell environments
- Add a sidebar option to hide exited sessions, reducing noise in long-lived session lists

🔧 Improvements

- Sync the branch-update proposal back into OpenSpec and mark its task flow complete so Git history behavior, specs, and implementation stay aligned
- Archive the completed proposal and add Trellis session records so the branch-update delivery trail is fully captured
- Normalize Git commit scope and history commit-area semantics to reduce panel stalls and state drift in large commit surfaces
- Improve the Spec Hub requirement pool and detached reading experience while archiving the related OpenSpec changes for traceability
- Rework composer thread-scoped model selection, startup recovery, thread-selection self-healing, and history compatibility boundaries
- Tighten doctor, large-file, and heavy-test-noise gates by removing branding leftovers and debug-log noise from strict validation paths
- Strengthen merge-boundary handling and regression sentinels so capability paths are less likely to be lost during multi-PR merges

🐛 Fixes

- Fix missing-upstream prompts and edge handling in Git history branch updates so branches without tracking information no longer surface misleading feedback
- Fix Codex compaction copy lifecycle boundaries so compression notices do not linger or settle in the wrong stage
- Fix silent-success semantics for deleting missing sessions so already-removed sessions do not surface false failures
- Fix freezes in the Git commit panel under large-panel scenarios and sync the related commit-area specification
- Fix note-card reference previews and cross-platform attachment handling so previews, attachments, and paths stay consistent
- Fix duplicate note-card references in live and historical message surfaces
- Fix note-card pool empty-state card layout so empty views keep stable spacing and structure
- Fix PR#480-related composer startup recovery, thread-scope persistence, and thread-model scoping regressions
- Fix custom slash-command residue leaking into later sends by clearing composer command state earlier
- Fix Claude config refresh still showing stale model labels after configuration reloads
- Fix AskUserQuestion timeout residue so expired prompts no longer leave stale UI or thread state behind
- Fix discovery for cached Claude plugin skills and symlinked skill directories
- Fix completion-email trigger normalization to reduce missed or duplicate completion notifications across event sources
- Fix sidebar exited-session toggling and parent-context retention for running child sessions
- Fix duplicate Codex memory summaries and missing historical screenshots during history recovery
- Fix app-shell model parsing debug logs causing false test-noise reports
- Fix the detached Spec Hub artifact panel still showing the "Maximize Artifacts" action, keeping the detached window UI focused

---

### **2026年4月29日（v0.4.10）**

中文：

✨ Features

- 新增邮件发送设置与测试发送能力，在设置页补齐邮箱配置、发送校验、后端邮件发送 command 与 OpenSpec 行为契约，让通知链路具备可配置的发送端
- 新增客户端界面显示控制，支持按配置隐藏或显示侧栏、状态面板、文件视图、Git 面板、composer 等主要 UI 区域，并补齐布局恢复与 shortcut 边界
- 新增工作区别名能力，支持在侧边栏展示更友好的 workspace alias，并提供别名编辑入口与持久化映射
- 新增可配置应用快捷键扩展，覆盖 archive、new agent、search、interrupt、mode switch、panel、UI scale 等主操作，让桌面快捷键配置更完整
- 新增模型选择器配置刷新入口，让 Codex model selector 可以主动刷新当前模型配置，减少配置变更后 UI 与 runtime 状态不同步
- 新增自定义主题配色切换与预设合并能力，支持在设置中管理主题色，并避免非自定义主题误套用用户预设
- 新增对话完成邮件提醒与 Codex 自动压缩交互，串联前端入口、runtime contract 与邮件提醒行为规范，让长会话完成通知和压缩提示更可控
- 新增运行时提示悬浮球显隐管理能力，将浮层显示纳入客户端界面显示控制，减少不需要提示时的界面干扰

🔧 Improvements

- 收口 Windows Codex app-server wrapper 启动参数拼装，把 doctor / probe 与真实 app-server 启动统一到共享 launch options，降低不同启动路径的参数漂移
- 为 Windows `.cmd` / `.bat` wrapper 增加一次兼容 retry，primary 启动失败时跳过内部 spec priority hint 重新启动，同时保留用户 `codexArgs`
- 强化 Codex 会话保活恢复，补齐 conversation liveness、stale thread binding recovery、stalled recovery contract 与 runtime stability 的 OpenSpec 说明
- 稳定 Codex 历史加载与侧栏缓存，过滤后台辅助会话，收敛 cross-source history 与可见会话列表的展示边界
- 拆分 spec root 消息测试并格式化后端测试代码，降低线程消息与 Rust backend 回归维护成本
- 同步 OpenSpec 变更，覆盖模型选择器配置操作、邮件发送设置、工作区别名、客户端 UI 显示控制、快捷键扩展与 Windows wrapper 启动规范
- 同步邮件提醒与自动压缩 OpenSpec 契约，明确完成通知、自动压缩提示与前后端 runtime 交互边界
- 归档运行时提示悬浮球显隐任务，并补充 Trellis 会话记录，保持功能交付、任务状态与项目规范同步
- 收敛 CI 大文件、测试噪音与 Sentry workflow 权限边界，升级 Actions 版本并降低门禁抖动对正常回归的干扰

🐛 Fixes

- 修复 Windows 11 下通过 npm `.cmd` wrapper 启动 Codex app-server 时，`cmd.exe /c` 与内部 quoted config 组合导致初始化前退出的问题
- 修复 Windows wrapper fallback 成功后仍可能把 primary 的早期 runtime / ended / stderr 事件暴露到前端的问题，避免 UI 误判为启动失败
- 修复 Codex 停滞会话隔离与历史展示边界，减少 stalled recovery 期间旧线程、后台辅助会话与当前历史视图混入的问题
- 修复 Codex 后台辅助会话污染历史列表的问题，让用户可见历史只展示真实可恢复的会话
- 修复方向键快捷键别名归一化问题，让快捷键配置中的方向键输入与展示保持一致
- 修复 Nix 前端依赖导入链路，改用 `importNpmLock` 并恢复固定前端依赖 hash，降低 flake 构建因依赖闭包变化失败的概率
- 修复 Linux IME 输入兼容边界，降低中文等组合输入在 composer 中被提前提交或状态错位的概率
- 修复 Codex 默认流式与思考开关在不应展示场景下暴露的问题，避免用户误触不可用或不适用的运行时选项
- 修复对话 `modeBlocked` 与 resume-pending 结算边界，减少恢复流程中输入状态、阻塞状态和会话结算不同步的问题
- 修复对话完成邮件正文内容过宽的问题，让邮件提醒聚焦最终完成信息而不是泄漏过多中间上下文
- 修复历史恢复幕布渲染回归，避免恢复历史会话时幕布状态丢失或显示异常
- 修复 Sentry 回归抖动与 workflow 默认权限问题，降低 CI 因权限或外部噪音导致的非业务失败

English:

✨ Features

- Add email sender settings and a test-send flow, including settings UI, validation, backend mail commands, and OpenSpec behavior coverage
- Add client UI visibility controls for hiding or showing major surfaces such as the sidebar, status panel, file view, Git panel, and composer
- Add workspace sidebar aliases so workspaces can be shown with friendlier names and edited from the sidebar
- Expand configurable application shortcuts across archive, new agent, search, interrupt, mode switching, panels, and UI scaling
- Add a model-selector config refresh action so Codex model settings can be refreshed without drifting from runtime state
- Add custom theme color switching and preset merging, including settings-side theme color management while preventing non-custom themes from inheriting user presets
- Add conversation-completion email reminders and Codex auto-compression interactions across the frontend entry points, runtime contracts, and reminder behavior specs
- Add runtime prompt floating-ball visibility management as part of client UI visibility controls, reducing unnecessary overlay noise

🔧 Improvements

- Consolidate Windows Codex app-server wrapper launch options so doctor, probe, and real app-server startup share the same argument semantics
- Add a Windows `.cmd` / `.bat` wrapper retry path that skips the internal spec priority hint after primary launch failure while preserving user `codexArgs`
- Strengthen Codex conversation liveness, stale-thread binding recovery, stalled recovery, and runtime-stability specifications
- Stabilize Codex history loading and sidebar cache by filtering background helper sessions from visible history
- Split spec-root message tests and format backend test code to keep thread-message and Rust backend coverage easier to maintain
- Sync OpenSpec changes for model-selector config actions, email sender settings, workspace aliases, client UI visibility controls, shortcut expansion, and Windows wrapper launch behavior
- Sync the email-reminder and auto-compression OpenSpec contracts, clarifying completion notifications, compression prompts, and frontend-backend runtime boundaries
- Archive the runtime prompt floating-ball visibility task and add Trellis session records so delivery state, task state, and project workflow metadata stay aligned
- Tighten CI large-file, test-noise, and Sentry workflow permission boundaries, upgrading Actions versions and reducing gate flake during normal regression runs

🐛 Fixes

- Fix Windows 11 Codex app-server startup failures caused by npm `.cmd` wrappers, `cmd.exe /c`, and quoted internal config arguments
- Fix false frontend startup failures after a successful Windows wrapper fallback by dropping primary-path early runtime / ended / stderr events
- Fix Codex stalled-session isolation and history display boundaries so old threads, helper sessions, and current history views do not bleed together
- Fix background Codex helper sessions appearing in user-visible history lists
- Fix direction-key shortcut alias normalization so shortcut input and display stay aligned
- Fix Nix frontend dependency import and pinned hash handling by moving to `importNpmLock` and restoring the fixed frontend dependency hash
- Fix Linux IME compatibility edges so composed input in the composer is less likely to submit early or drift from input state
- Fix Codex default streaming and reasoning toggles being exposed in contexts where those runtime options should stay hidden
- Fix conversation `modeBlocked` and resume-pending settlement boundaries so recovery, input state, and session settlement remain aligned
- Fix conversation-completion email body scope so reminders focus on final completion details instead of carrying excessive intermediate context
- Fix a history-restore curtain rendering regression that could lose or misrender curtain state while reopening historical sessions
- Fix Sentry regression flake and workflow default permissions, reducing CI failures caused by permission setup or non-business noise

---

### **2026年4月27日（v0.4.9）**

中文：

✨ Features

- 新增 Git 按文件范围提交能力，支持在 diff 面板内按文件选择本次 commit 范围，并在批量操作后恢复选择状态，让多文件改动可以更精确地拆分提交
- 新增 Codex 历史会话加载态，在打开历史线程、恢复侧栏缓存和承接空白历史页时展示明确的 loading 与空态过渡，减少“点击后无反馈”的误判
- 新增 Codex 生成图片展示与占位链路，支持从实时事件和历史回放中识别生成图片 artifact，并把占位消息、最终图片和所属 turn 稳定关联起来
- 重构 Codex 模型目录与选择策略，补齐模型 catalog、selector、engine controller 与输入区 ButtonArea 的联动，让模型展示、默认选择和 passthrough 边界更一致
- 完善应用更新检查意图与并发保护，区分主动检查和后台检查，避免重复触发、状态覆盖与失败 fallback 不清晰的问题
- 统一会话失败 runtime 告警上报，把发送失败、turn 异常和 runtime 断链统一送入全局 runtime notice，减少失败状态只停留在局部链路里的断点
- 增强 Computer Use 授权连续性与跨平台 broker 边界，补齐未签名宿主、helper bridge、availability surface 与 status card 的可见诊断链路

🔧 Improvements

- 收口 Claude 会话连续性、并发实时隔离与审批线程作用域，让 approval toast、thread approval、历史加载和侧栏状态更严格绑定当前 thread
- 统一 Codex 对话幕布归一化与 assembler 链路，拆分 conversation assembly / normalization / realtime-history parity 逻辑，降低实时消息与历史回放的结构漂移
- 优化 Codex 排队跟进气泡，修复 queued handoff 与历史回放重叠边界，并补齐 queued send、memory race 与 reducer 回归覆盖
- 稳定 Codex 会话侧栏连续性，补齐 cross-source history、session radar feed、pending thread list 和手动恢复入口之间的状态一致性
- 补强线程恢复与降级侧栏归档回放，新增手动恢复 helper 与布局节点恢复测试，让 degraded thread 可以从侧栏更可靠地承接回主会话
- 抽取 app shell 计划应用与面板锁定逻辑，将 legacy context defaults、plan apply handlers 和 panel lock state 从主 shell 中拆出，降低 app-shell 热点复杂度
- 拆分 Git diff 面板提交范围、文件分区、include/exclude 与 section action 组件，减少 `GitDiffPanel` 大文件压力，并让 selective commit UI 更容易维护
- 优化消息区视觉一致性，统一 Explored 工具块与文件变更卡片样式，并收窄历史吸顶折叠把手，降低长会话里的视觉噪音
- 加固生成图片 artifact 路径解析、placeholder matching 与 optimistic reconciliation，让图片生成在实时事件、历史加载和 reducer 合并阶段保持同一语义
- 同步补充 OpenSpec / Trellis 规范与验证记录，覆盖 Git selective commit、Computer Use authorization、Claude thread continuity、Codex session parity、conversation curtain 与 updater fallback 等变更
- 扩展 engine 与模型边界测试，补齐 Claude passthrough model、Codex model selector、useModels、engine controller 和 ButtonArea 的回归用例
- 补齐评审发现的跨层边界治理，包括 Git section action 文案、生成图片路径处理、大文件拆分边界与 Computer Use authorization 判定细节
- 深化 P0 / P1 大文件拆分治理，把 `cc_gui_daemon` 的 workspace / file access、Gemini event parsing、Codex model selection / run metadata、local usage、thread reducer helpers、Git history branch compare handlers、Settings dictation section 与多组样式分片拆出独立模块，并同步 CI large-file gate，减少热点文件继续膨胀的风险
- 补齐 Computer Use bridge-runtime-critical 治理边界，将 `src-tauri/src/computer_use/` 纳入 P0 大文件阈值，并把插件 descriptor、activation contract 与可用性契约测试拆到独立测试模块，降低 Computer Use 主模块的回归半径
- 增强 Runtime Pool 设置页首屏恢复路径，采用 snapshot-first bootstrap、workspace inventory fallback、eligible workspace 去重与 bounded fallback refresh，让设置页能更稳定承接空 snapshot、断开 workspace 与首次恢复中的中间态
- 补强 Claude Windows 流式链路的 runtime diagnostics，把流式 forwarder、进程诊断、阻塞判定与 Runtime Pool console 状态写入 OpenSpec，使 Windows 下“有输出但 UI 延迟”的问题更容易定位
- 加固 Codex 运行时生命周期恢复链路，收敛 runtime session create / shutdown / restore 之间的状态交接，让失效会话、历史恢复和手动恢复入口共享更明确的恢复语义
- 补强 vendor 运行时回归验证，等待 `unified_exec` 成功提示实际渲染后再断言，降低异步启动提示造成的测试抖动
- 追加归档并回写 v0.4.9 后续验证提案，覆盖 Linux Nix flake packaging、Windows Runtime Pool initial load、Claude long-thread render amplification、Claude Windows streaming latency 与 P0/P1 large-file modularization governance，确保行为规范与实际实现继续对齐

🐛 Fixes

- 修复 Codex 历史会话打开后可能出现空白页的问题，并补齐历史消息加载、sidebar cache 与 layout nodes 的过渡状态
- 修复 Codex 排队用户气泡与历史回放内容重叠的问题，避免 queued follow-up 在恢复或回放时遮挡已有消息
- 修复 Computer Use 未签名宿主被错误判定为已授权连续的问题，并收紧不同平台下 broker、host contract 与 status card 的边界提示
- 修复 Claude 会话恢复、审批事件与并发实时消息可能串到错误线程的问题，降低多会话并行时的审批误归属和历史状态漂移
- 修复 Codex 生成图片在占位、最终 artifact、历史加载和实时事件之间可能断链的问题，避免图片缺失、重复或挂到错误 turn
- 修复 Codex realtime 消息归一化与输入响应边界，减少幕布内容重复、增量文本合并错位和用户输入状态未及时承接的问题
- 修复图片生成占位链路的实时事件边界，覆盖 optimistic user reconciliation、turn events、thread messaging 与 placeholder matching 的异常路径
- 修复 Codex 会话侧栏状态与历史来源不一致的问题，让 thread list pending、session radar 和 manual action helpers 对同一会话给出一致结果
- 修复线程恢复与 degraded sidebar archive replay 的承接问题，避免侧栏归档回放后无法回到可操作会话
- 修复 Windows UNC 图片路径解析问题，确保 `\\server\share` 等路径可以被正确识别为可展示的本地图片 artifact
- 修复 updater 检查失败或重复点击后状态残留的问题，确保手动检查、自动检查和 fallback 提示不会相互覆盖
- 修复 Git selective commit 边界审查问题，补齐 section action i18n 与测试，避免文件范围提交时按钮文案或选择状态不一致
- 修复消息吸顶折叠把手过宽与工具块卡片样式不一致的问题，让 Explored、file change 和 sticky history 区域在长会话中更协调
- 修复 Linux Nix flake 打包链路，补齐前端 npm 依赖闭包 hash 与 packaging OpenSpec 任务状态，避免 Nix 构建在依赖闭包变化后因 hash 不匹配失败
- 修复 Runtime Pool 设置页首屏恢复时误显示空态的问题：初始 snapshot 非空时直接展示，初始为空但存在可连接 workspace 时触发一次受控 bootstrap，并在短窗口内 bounded refresh，避免“正在恢复”被错误渲染成“没有 runtime”
- 修复 Claude Windows 流式转发阻塞，拆出 `claude_forwarder` 并补充 runtime process diagnostics、阻塞检测与回归测试，降低 Windows 下实时输出已经到达 backend 但前端迟迟不可见的概率
- 修复 Claude 长线程实时渲染成本放大的问题，通过 live window 收敛、assistant fast path metadata 合并与 reducer 回归覆盖，减少长线程中每个增量事件触发的大范围重算和 UI 卡顿
- 修复 Codex 多轮 Explored 串行展示问题，过滤相邻用户 turn 之间已完成的旧 Explored 卡片，避免多轮思考时上一轮 explored 状态继续挤占当前实时窗口
- 修复 Codex 当前协作工具历史 schema 兼容问题，支持 `wait_agent`、`target` 与 `targets` 字段，避免历史回放时 send_input / wait_agent 的 agent 目标丢失或被误归类为普通工具
- 修复 v0.4.9 边界审查遗留问题，补齐 Codex history loader 的 send_input target / wait_agent targets 回归测试，并收紧 Computer Use 插件契约测试与大文件治理阈值
- 修复失效会话手动恢复分流问题，让恢复动作能按当前 thread / runtime 状态进入正确路径，避免可恢复会话被误导向错误入口
- 修复 Codex runtime 生命周期恢复边界，降低 session 创建失败、shutdown 竞态或历史恢复期间出现 runtime 状态悬空的概率
- 修复 vendor 测试中 `unified_exec` 成功提示断言过早的问题，避免 UI 文案尚未渲染完成时产生偶发失败

English:

✨ Features

- Add file-scoped Git commits so the diff panel can include or exclude files for a specific commit, while restoring selection state after batch operations for cleaner multi-file commit splitting
- Add a Codex history-session loading state so opening history threads, restoring sidebar cache, and recovering blank history pages now show explicit loading and empty-state transitions instead of appearing unresponsive
- Add Codex generated-image rendering and placeholder linkage, allowing realtime events and history replay to identify image artifacts and keep placeholders, final images, and turns connected
- Rework the Codex model catalog and selection strategy across the model catalog, selector, engine controller, and input ButtonArea so model display, defaults, and passthrough behavior stay aligned
- Improve updater check intent and concurrency protection by separating manual checks from background checks and preventing duplicate triggers, state overwrites, and unclear fallback states
- Unify runtime notice reporting for failed sessions so send failures, turn errors, and runtime disconnects flow into the global runtime notice surface instead of stopping inside local paths
- Strengthen Computer Use authorization continuity and cross-platform broker boundaries with clearer diagnostics for unsigned hosts, helper bridge status, availability surface, and the status card

🔧 Improvements

- Tighten Claude session continuity, concurrent realtime isolation, and approval thread scoping so approval toasts, thread approvals, history loading, and sidebar state bind to the active thread more strictly
- Unify Codex conversation-curtain normalization and assembler flow by splitting conversation assembly, normalization, and realtime-history parity logic to reduce drift between live messages and history replay
- Improve Codex queued follow-up bubbles by fixing queued handoff overlap with history replay and adding regression coverage for queued send, memory races, and reducer behavior
- Stabilize Codex sidebar continuity by aligning cross-source history, session radar feed, pending thread lists, and manual recovery actions around the same session state
- Strengthen thread recovery and degraded sidebar archive replay with a manual recovery helper and layout-node recovery coverage so degraded threads can return to the main conversation more reliably
- Extract app-shell plan-apply and panel-lock logic into focused modules, moving legacy context defaults, plan apply handlers, and panel lock state out of the main shell hotspot
- Split Git diff commit-scope, file-section, include/exclude, and section-action components to reduce `GitDiffPanel` complexity and make the selective-commit UI easier to maintain
- Refine message-area visual consistency by aligning Explored tool blocks with file-change cards and narrowing the history-sticky collapse handle to reduce noise in long conversations
- Harden generated-image artifact path parsing, placeholder matching, and optimistic reconciliation so image generation keeps the same semantics through realtime events, history loading, and reducer merges
- Sync OpenSpec and Trellis records for Git selective commit, Computer Use authorization, Claude thread continuity, Codex session parity, conversation curtain behavior, and updater fallback changes
- Expand engine and model boundary coverage for Claude passthrough models, the Codex model selector, `useModels`, the engine controller, and the input ButtonArea
- Address cross-layer review findings around Git section-action copy, generated-image path handling, large-file extraction boundaries, and Computer Use authorization checks
- Deepen the P0/P1 large-file modularization pass by extracting `cc_gui_daemon` workspace/file access, Gemini event parsing, Codex model selection/run metadata, local usage, thread reducer helpers, Git history branch-compare handlers, the Settings dictation section, and multiple style shards into focused modules, while updating the CI large-file gate to keep hotspots from growing again
- Tighten Computer Use bridge-runtime-critical governance by bringing `src-tauri/src/computer_use/` under the P0 large-file threshold and moving plugin descriptor, activation-contract, and availability-contract coverage into a dedicated test module
- Strengthen the Runtime Pool settings first-load path with snapshot-first bootstrap, workspace-inventory fallback, eligible-workspace de-duplication, and bounded fallback refresh so the settings panel handles empty snapshots, disconnected workspaces, and initial restore transitions more reliably
- Add deeper Claude Windows streaming diagnostics across the forwarder, process-diagnostics layer, blocking detection, and Runtime Pool console specs so “backend output arrived but UI is delayed” cases are easier to trace
- Harden Codex runtime lifecycle recovery across session create, shutdown, and restore handoffs so invalid sessions, history recovery, and manual recovery actions share clearer recovery semantics
- Strengthen vendor runtime regression coverage by waiting for the `unified_exec` success notice to render before asserting, reducing async startup-notice test flake
- Archive and sync the follow-up v0.4.9 verified proposals for Linux Nix flake packaging, Windows Runtime Pool initial load, Claude long-thread render amplification, Claude Windows streaming latency, and P0/P1 large-file modularization governance

🐛 Fixes

- Fix blank Codex history sessions by adding clear loading coverage across history message loading, sidebar cache restoration, and layout-node transitions
- Fix Codex queued user bubbles overlapping history replay content so queued follow-ups no longer cover existing messages during recovery or replay
- Fix unsigned Computer Use hosts being treated as authorization-continuous, while tightening broker, host-contract, and status-card messaging across platforms
- Fix Claude session recovery, approval events, and concurrent realtime messages drifting into the wrong thread, reducing approval misrouting and history-state skew during parallel sessions
- Fix Codex generated images losing their placeholder, final artifact, history-loading, or realtime-event linkage, preventing missing, duplicated, or wrong-turn images
- Fix Codex realtime message normalization and input-response boundaries to reduce duplicated curtain content, misplaced incremental text merges, and delayed user-input handoff
- Fix realtime-event edges in the generated-image placeholder path, covering optimistic user reconciliation, turn events, thread messaging, and placeholder matching failure cases
- Fix Codex sidebar session state mismatches so thread-list pending state, session radar, and manual action helpers report consistent results for the same conversation
- Fix thread recovery and degraded sidebar archive replay handoff so archived sidebar state can return to an actionable conversation
- Fix Windows UNC image path parsing so `\\server\share` style paths are recognized as displayable local image artifacts
- Fix updater state residue after failures or repeated checks so manual checks, automatic checks, and fallback notices no longer overwrite each other incorrectly
- Fix selective Git commit review findings by completing section-action i18n and tests, preventing button copy or selection state drift while committing by file scope
- Fix oversized history-sticky collapse handles and inconsistent tool-block card styling so Explored, file-change, and sticky-history areas feel visually aligned in long conversations
- Fix the Linux Nix flake packaging path, including the frontend npm dependency closure hash and packaging OpenSpec task state, so Nix builds do not fail after dependency-closure changes
- Fix the Runtime Pool settings panel showing an empty state during first-load recovery: non-empty initial snapshots now render immediately, empty snapshots with eligible workspaces trigger one controlled bootstrap, and bounded refresh covers the short restore window
- Fix Claude streaming forwarding stalls on Windows by extracting `claude_forwarder` and adding runtime process diagnostics, blocking detection, and regression coverage, reducing cases where backend output arrives but the frontend remains delayed
- Fix Claude long-thread realtime render amplification with live-window narrowing, assistant fast-path metadata merging, and reducer coverage, reducing broad recomputation and UI stalls on every incremental event
- Fix Codex multi-turn Explored serialization by suppressing completed older Explored cards between adjacent user turns, so previous-turn explored state no longer crowds the current live window
- Fix Codex history compatibility with the current collaboration-tool schema by supporting `wait_agent`, `target`, and `targets`, preventing send_input / wait_agent agent targets from being lost or treated as generic tools during history replay
- Fix remaining v0.4.9 review edges by adding Codex history-loader coverage for send_input target and wait_agent targets, while tightening Computer Use plugin-contract tests and large-file governance thresholds
- Fix invalid-session manual recovery routing so recovery actions follow the current thread and runtime state instead of sending recoverable sessions to the wrong entry point
- Fix Codex runtime lifecycle recovery boundaries, reducing dangling runtime state during session creation failures, shutdown races, or history restore transitions
- Fix an early `unified_exec` success-notice assertion in vendor coverage so tests no longer fail before the UI copy has rendered

---

### **2026年4月23日（v0.4.8）**

中文：

✨ Features

- 新增 baseline-aware 大文件治理策略，按路径域为热点文件匹配差异化阈值、watchlist 与 fail gate，并把历史技术债基线纳入 CI，对“新增超限”和“旧债继续膨胀”分别做明确拦截
- 新增 heavy test noise sentry，为重型 Vitest 回归引入独立噪音门禁，自动识别 repo-owned `act(...)` / stdout / stderr 泄漏，并将环境自带 warning 单独归类，减少 CI 误报
- 推进大文件热点的兼容性拆分治理，围绕 Opencode command、Git branch command、runtime session lifecycle、thread messaging 与 Tauri facade 建立更细粒度模块边界，为后续能力扩展预留更稳的演进基础
- 新增 Codex CLI Computer Use broker 接入与显式 helper bridge 验证通道，把官方 `parent handoff` 只读发现、宿主契约诊断与阻塞态产品化展示补齐到可观测链路里，方便后续桌面自动化能力排障
- 增强 Computer Use 宿主契约与插件缓存链路，补齐 broker 运行入口和可用性探测闭环，让 Computer Use 从 CLI、插件到宿主桥接的状态更容易定位

🔧 Improvements

- 拆分 app shell orchestration、thread action / session runtime、assistant 文本归一化与 thread messaging 工具链，降低消息主链路的大文件复杂度与回归面
- 拆分 settings、composer rewind modal 与 git history branch compare 样式分片，减轻大 CSS 文件维护压力，后续样式调整不再集中挤在单一热点文件
- 收敛 app shell、threads、git history、file tree、layout、worktree prompt、Search、Project Memory、Spec Hub 与 OpenCode 面板等多处 exhaustive-deps 告警，补齐 dependency array 与 cleanup-safe 模式，减少 stale closure 和重复副作用风险
- 稳定 ChatInputBox ButtonArea 与 session radar feed 的 sentinel 刷新路径，收敛 model storage 快照与订阅刷新时机，让输入区、模型配置和会话雷达的状态同步更稳
- 清理 tauri dev、`cc_gui_daemon` 与 Rust test-target 告警面，收口启动、桥接与测试期的无效 warning，提升本地开发与 backend 回归输出可读性
- 刷新 large-file baseline、near-threshold watchlist 与治理 playbook，并同步归档本轮 OpenSpec / Trellis 变更，让治理规则、实现拆分和文档状态保持一致
- 对齐回归门禁和线程测试契约，保证大规模拆分之后，已有线程集成测试和门禁脚本仍能准确覆盖关键链路
- 补强 Codex realtime canvas 消息兜底边界，并拆分 `useAppServerEvents` 路由测试，降低实时事件分发与画布承接链路的回归风险
- 优化对话幕布悬浮问题条的视觉样式与收起交互，让长会话中的上下文提示更紧凑、干扰更低
- 同步归档 Linux AppImage、Computer Use 与 Claude 流式渲染相关 OpenSpec 变更，并回写验证状态，保持行为说明与当前实现一致

🐛 Fixes

- 修复 TaskCreateModal 在打开和提交阶段的 inline completion 清理与依赖处理，避免创建任务弹窗出现超时、焦点延迟或历史建议残留
- 修复 git-history 尾部 cleanup timer 的清理方式，避免 create-PR 进度清理依赖陈旧 ref 快照而留下状态尾巴
- 修复 heavy-test-noise 对环境告警的统计偏差，在外层 npm 输出未被完整捕获时，仍能根据环境变量正确归类 `electron_mirror` 等环境噪音，避免误伤 CI
- 修复多处 repo-owned heavy test 噪音，包括 `AskUserQuestionDialog` 倒计时、SpecHub / Sidebar / Detached File Explorer / GitStatus / Markdown math / runtime notice 等测试边界泄漏，降低回归日志污染
- 修复 threads、app shell 与 git history 热点 hook 的依赖漂移，减少长链路交互中的重复监听、状态错位和无效重渲染
- 修复 Tauri service facade、runtime lifecycle 与 Git branch 命令拆分后的兼容性边界，确保现有调用入口与行为契约在重构后继续可用
- 修复 Linux AppImage 在 Wayland 下的启动兼容守卫，并为 macOS 补充 Apple Events 权限声明，减少跨平台桌面运行时的启动失败与权限误报
- 修复 Computer Use broker 与 Codex CLI 的集成边界：统一走 Codex CLI `exec`、接入插件缓存链路，并跳过非 Git workspace 下不必要的仓库检查
- 修复 Codex realtime 消息兜底与 Claude 流式长文渲染边界，覆盖 Windows 实时输出卡顿、长文汇总误路由、空白幕布、会话漂移与终态重复等问题
- 修复对话幕布 markdown 卡片的兼容性边界，避免结构化 markdown 在幕布视图下出现渲染错位、重复或交互不一致

English:

✨ Features

- Add a baseline-aware large-file governance policy that assigns domain-specific thresholds, watchlists, and fail gates by path, while bringing legacy debt baselines into CI so new oversize files and growing legacy debt are blocked differently and explicitly
- Add a dedicated heavy test noise sentry for heavy Vitest regressions, automatically detecting repo-owned `act(...)`, stdout, and stderr leaks while classifying environment-owned warnings separately to reduce CI false positives
- Advance compatibility-preserving modularization for the largest hotspots by carving out finer-grained boundaries around the Opencode command surface, Git branch commands, runtime session lifecycle, thread messaging, and the Tauri facade
- Add the Codex CLI Computer Use broker path together with an explicit helper-bridge verification flow, surfacing official `parent handoff` discovery, host-contract diagnostics, and productized blocked-state visibility for easier desktop-automation troubleshooting
- Strengthen the Computer Use host-contract and plugin-cache path so broker entry, plugin availability, and host-bridge state can be traced more clearly end to end

🔧 Improvements

- Split app-shell orchestration, thread action/session runtime handling, assistant text normalization, and thread messaging tooling to reduce large-file complexity and shrink the regression surface along the main conversation path
- Split settings, composer rewind-modal, and git-history branch-compare style shards so future styling work is no longer concentrated in a few oversized CSS hotspots
- Remediate exhaustive-deps hotspots across app shell, threads, git history, file tree, layout, worktree prompt, Search, Project Memory, Spec Hub, and OpenCode surfaces by completing dependency arrays and cleanup-safe patterns, reducing stale closures and repeated side effects
- Stabilize the sentinel refresh path for ChatInputBox ButtonArea and the session radar feed so model-storage snapshots, subscriptions, and UI refresh timing stay in sync more reliably
- Clean up warning surfaces across `tauri dev`, `cc_gui_daemon`, and Rust test targets, reducing startup, bridge, and test-phase warning noise and making local/backend regression output easier to read
- Refresh the large-file baseline, near-threshold watchlist, and governance playbook, while archiving the related OpenSpec and Trellis changes so governance rules, extraction work, and documentation remain aligned
- Align regression gates with thread test contracts so the existing thread integration coverage and repo guardrails remain trustworthy after the larger extraction batches
- Tighten Codex realtime-canvas fallback boundaries and split `useAppServerEvents` routing coverage to reduce regression risk across live-event dispatch and canvas handoff flows
- Refine the floating question bar on the conversation canvas with cleaner styling and collapse behavior so long-running sessions keep context visible with less visual noise
- Archive and sync the related OpenSpec changes for Linux AppImage startup, Computer Use, and Claude streaming stability so behavior documentation stays aligned with the shipped implementation

🐛 Fixes

- Fix inline-completion cleanup and effect dependencies in TaskCreateModal during open and submit flows so the create-task modal no longer drifts into timeout-like delays, focus lag, or stale suggestion state
- Fix git-history tail cleanup timer handling so create-PR progress cleanup no longer depends on stale ref snapshots that can leave trailing state behind
- Fix heavy-test-noise environment-warning accounting so `electron_mirror`-style environment noise is still classified correctly even when the outer npm warning output is not fully captured, preventing false CI failures
- Fix multiple repo-owned heavy-test noise sources, including countdown leakage in `AskUserQuestionDialog` and warning leakage around SpecHub, Sidebar, Detached File Explorer, GitStatus, markdown math, and runtime notice coverage
- Fix dependency drift in hotspot hooks across threads, app shell, and git history to reduce repeated listeners, state skew, and unnecessary re-renders in long-running interaction paths
- Fix compatibility edges after splitting the Tauri service facade, runtime lifecycle, and Git branch command modules so existing call sites and behavior contracts continue to work after the refactor
- Fix the Linux AppImage Wayland startup guard and add the missing Apple Events usage declaration for macOS, reducing desktop startup failures and permission mismatches across platforms
- Fix Computer Use broker integration edges with Codex CLI by routing through Codex CLI `exec`, wiring in the plugin-cache path, and skipping unnecessary Git-repository checks for non-Git workspaces
- Fix Codex realtime fallback and Claude long-form streaming stability issues covering Windows output stalls, long-summary misrouting, blank conversation canvases, session drift, and duplicated completed output
- Fix markdown card compatibility on the conversation canvas so structured markdown content no longer drifts into duplicated, misaligned, or inconsistent rendering states

---

### **2026年4月22日（v0.4.7）**

中文：

✨ Features

- 新增全局 runtime notice dock，为 Codex / Claude 会话中的恢复、重试与运行时异常提供统一提示区，减少异常状态分散在局部卡片里的割裂感
- 增强会话创建失败后的恢复承接动作，在建会话、恢复线程或 runtime 异常时补充 toast 级快速重试入口，帮助用户直接续接当前任务
- 收口 queued follow-up fusion 的续跑体验，在检查点恢复、排队发送与融合承接之间补齐状态连续性，让长链路任务在 stalled 后更容易从原位置继续推进

🔧 Improvements

- 拆分消息时间线渲染层并瘦身主消息组件，收敛 `Messages` 组件职责，降低消息区持续叠加功能后的维护复杂度和回归面
- 优化实时吸顶用户问题与历史吸顶标题的对齐关系，统一 live sticky bubble 与历史区域头部的视觉基线，减少长会话中的吸顶错位噪音
- 补强运行时提示框启动链路与状态语义，补充本地状态迁移、输入历史恢复、界面资源加载与 shell 挂载提示，并在首次 runtime `ready` 时回写状态闭环，让客户端启动阶段更可见
- 优化运行时提示框的多引擎与跨平台边界处理，根据实际 engine 展示 runtime 文案，并补齐 Windows 反斜杠路径与空工作区元数据场景下的稳定 fallback
- 优化实时对话中 inline code 的流式渲染与去重作用域，减少 markdown 结构在流式阶段被误拆分、误归并或重复重绘的概率
- 同步归档本轮已完成的 OpenSpec 变更并刷新相关 proposal / spec，使运行时稳定性、融合续跑与消息区行为说明继续与实现保持一致

🐛 Fixes

- 修复展开历史消息后的视口跳动问题，避免查看折叠历史时因列表重算而丢失阅读位置
- 修复会话恢复提示与重试链路中的边界问题，避免恢复失败后 toast 缺失、动作不可达或提示状态与真实 runtime 状态不一致
- 修复 checkpoint fusion stalled continuity 问题，避免融合续跑在卡住或恢复后出现后续消息未承接、状态悬空或任务推进中断
- 修复 Windows 下 Claude 对话幕布闪烁风险，并进一步加固 desktop render-safe mode，降低跨平台渲染空白、闪屏和流式渲染不稳定问题
- 修复消息吸顶与 runtime 恢复重试之间的联动边界，避免实时提示、吸顶气泡与恢复动作同时出现时发生状态错位或视觉重叠
- 修复运行时提示框在头部状态已回到“空闲”时，最小化图标仍显示叹号的语义错位，避免历史 notice 残留导致外部提示状态与当前状态不一致
- 修复 assistant 最终消息在长任务或结构化回答中偶发整段重复输出的问题，收口近似重复段落、单换行拼接的 markdown section 与 completed 阶段的双份渲染

English:

✨ Features

- Add a global runtime notice dock so Codex and Claude conversations expose recovery, retry, and runtime anomalies through one shared surface instead of scattering critical state across local cards
- Strengthen recovery handoff after session-creation failures by surfacing toast-level retry actions for session bootstrap, thread recovery, and runtime failures, making it easier to continue the current task directly
- Tighten queued follow-up fusion continuity across checkpoint recovery, queued sends, and fusion handoff so long-running tasks can resume from stalled states with less drift and fewer broken continuations

🔧 Improvements

- Split the message-timeline rendering layer and slim down the main message component, reducing `Messages` complexity and lowering the regression surface as more message-area capabilities accumulate
- Align live sticky user-question bubbles with the history sticky header so the visual baseline stays consistent during long conversations and sticky elements compete less for attention
- Strengthen the runtime notice dock bootstrap flow and status semantics by adding migration, input-history, interface-resource, and shell-mount notices, while writing back the first runtime `ready` state so startup progress reads as a complete lifecycle
- Improve engine-aware and cross-platform behavior in the runtime notice dock so runtime copy reflects the actual engine, and Windows backslash paths plus empty workspace metadata still resolve to stable labels
- Improve inline-code streaming rendering and de-duplication scope in live conversations so markdown structures are less likely to be split incorrectly, merged too aggressively, or rendered twice mid-stream
- Sync and archive the completed OpenSpec changes from this release, keeping runtime-stability, fusion-continuity, and message-behavior documentation aligned with the implementation

🐛 Fixes

- Fix viewport jumps after expanding conversation history so users can inspect collapsed history without losing their reading position during list recomputation
- Fix boundary issues in session-recovery notices and retry flows so failed recovery attempts still expose reachable toast actions with runtime state that matches what actually happened
- Fix stalled checkpoint fusion continuity so follow-up messages, continuation state, and long-running task progress no longer get stranded after recovery
- Fix Claude conversation-surface flicker on Windows and further harden desktop render-safe mode to reduce blanking, flashing, and unstable streaming presentation across platforms
- Fix coordination gaps between sticky message state and runtime recovery retries so live notices, sticky bubbles, and retry actions no longer drift out of sync or visually overlap
- Fix the runtime notice dock minimized icon staying on an exclamation state after the header had already returned to `Idle`, preventing stale notice history from misrepresenting the current runtime state
- Fix duplicated assistant final messages in long-running or structured responses by collapsing near-duplicate paragraphs, single-newline markdown sections, and repeated completed-stage payloads into one readable result

---

### **2026年4月21日（v0.4.6）**

中文：

✨ Features

- 新增历史幕布按分段吸顶用户问题能力，在长会话中持续固定当前讨论语境，帮助用户更稳定地对照上下文推进多阶段任务
- 增强 Windows 下 Codex runtime 稳定性治理，补齐 stalled user input、runtime idle mismatch 与异常退出后的恢复诊断和自动承接链路
- 重构并简化 Codex `unified_exec` 官方配置入口，收口启动配置来源、覆盖策略与设置页治理，降低多入口配置漂移和理解成本

🔧 Improvements

- 统一全局 loading 进度处理，收敛工作区操作、线程建链与消息发送过程中的进度展示与状态切换
- 统一 runtime 实例保留时长的默认值与上限，减少前后端设置理解偏差与长任务运行时配置歧义
- 拆分消息历史吸顶样式文件并同步归档已验证的 OpenSpec / runtime / unified_exec 规范，提升消息区样式可维护性并保持行为说明与实现一致

🐛 Fixes

- 修复历史吸顶长气泡重叠问题，并固化实时用户问题气泡展示，避免长会话下用户问题定位漂移
- 修复 Explore 卡片在阶段推进后的自动折叠，减少多阶段思考场景中的信息丢失
- 修复完成提示音在同一 turn 内可能重复触发以及事件键碰撞问题，降低实时通知噪音
- 修复 Codex runtime 异常退出、stale thread 绑定恢复与首条消息隐式建会话 loading 缺失等边界问题，提升会话恢复连续性
- 修复 Claude 在 Windows 下的条件编译 import 漂移，并缓解流式输出逐字变慢问题，提升跨平台运行稳定性

English:

✨ Features

- Add segmented sticky user-question pinning in the conversation history so long-running conversations preserve the active context more reliably across multi-stage tasks
- Strengthen Codex runtime stability on Windows with better diagnostics and automatic recovery handoff for stalled user input, runtime-idle mismatches, and unexpected runtime exits
- Rework and simplify the official Codex `unified_exec` configuration entry by consolidating launch-profile sources, override strategy, and Settings governance to reduce multi-entry config drift

🔧 Improvements

- Unify global loading-progress handling so workspace actions, thread bootstrapping, and message sending share more consistent progress visibility and state transitions
- Align the default value and upper bound for runtime instance retention to reduce frontend/backend settings drift and ambiguity in long-running task configuration
- Split history-sticky message styles into a dedicated stylesheet and sync verified OpenSpec, runtime, and `unified_exec` specifications so implementation and behavior docs stay aligned

🐛 Fixes

- Fix overlapping long sticky bubbles in message history and stabilize live user-question pinning so user prompts stay anchored more reliably in long conversations
- Fix Explore cards auto-collapsing after stage transitions, reducing information loss during multi-step reasoning flows
- Fix duplicate completion sounds within the same turn and event-key collisions to reduce noisy real-time notifications
- Fix session continuity gaps across Codex runtime exits, stale-thread rebinding recovery, and missing loading state for implicit first-message conversation creation
- Fix Claude's Windows conditional-import drift and mitigate character-by-character streaming slowdowns to improve cross-platform runtime stability

---

### **2026年4月20日（v0.4.5）**

中文：

✨ Features

- 新增全局会话归档中心，支持跨项目聚合查看历史会话，并收紧 Codex 配置边界，降低多入口配置漂移风险
- 新增会话恢复诊断与降级承接链路，在 runtime 断连、线程失效或恢复失败时提供更明确的状态解释与后续操作入口
- 新增加载进度弹窗，支持工作区打开、添加项目与创建会话等长耗时操作的进度提示、后台运行与多请求可见性管理
- 增强引擎可用性状态透传，区分检测中、可用、需登录与不可用状态，并同步到侧栏、引擎选择器和输入区 provider selector

🔧 Improvements

- 收敛设置页实验区入口，将续写、融合等能力命名与归属统一到更清晰的配置结构
- 优化 Codex 实验配置展示与跨平台配置入口，减少不同系统环境下的入口差异与误导
- 加固 Claude 手动压缩与会话恢复边界，减少 compact、恢复、重发等长链路操作中的状态漂移
- 同步 OpenSpec 中的 runtime 稳定性与 Claude compact 实施进度，让发布说明、任务状态与实际实现保持一致
- 优化侧栏线程列表降级恢复入口，将 thread 级降级提示收口到 workspace/worktree 级快速刷新，并支持主工作区联动刷新其 worktree 线程列表

🐛 Fixes

- 修复会话管理边界处理问题，并补齐全量回归夹具，提升归档、聚合与路由场景的稳定性
- 修复工作树中新建会话入口交互异常，避免用户从侧栏进入新会话时出现状态错位
- 修复工作区文件树刷新不稳定问题，避免目录节点、独立文件窗口与工作区文件状态在刷新后不同步
- 修复 Opencode 子进程终止与超时收敛边界，降低异常退出、超时清理和会话回收中的残留风险
- 修复 Codex 会话自恢复、零活动超时兜底与 runtime 重连场景中的诊断缺口，提升断链后的可恢复性
- 修复会话创建失败时缺少用户可见反馈的问题，确保失败后关闭加载弹窗、记录诊断并展示错误提示
- 修复 OpenCode provider health 探测失败后菜单状态可能卡在 loading 的问题，并补齐 Windows 路径 basename 等边界测试
- 修复侧栏快速刷新按钮在缺少 handler 时仍可见的空操作边界，并补齐 Windows 反斜杠路径下 Worktree 名称拆分展示

English:

✨ Features

- Add a global session archive center for cross-project history aggregation, while tightening Codex configuration boundaries to reduce configuration drift across entry points
- Add session recovery diagnostics and fallback handoff paths so runtime disconnects, stale threads, and failed recovery attempts provide clearer state and next-action guidance
- Add a loading progress dialog for long-running workspace open, add-project, and session-creation operations, with background-running support and multi-request visibility management
- Improve engine availability propagation by distinguishing loading, ready, requires-login, and unavailable states across the sidebar, engine selector, and input provider selector

🔧 Improvements

- Consolidate the Settings experimental area and align naming/ownership for continuation and fusion capabilities into a clearer configuration structure
- Refine Codex experimental settings and cross-platform configuration entry points to reduce platform-specific ambiguity
- Harden Claude manual compact and session-recovery boundaries to reduce state drift across compact, recovery, and resend flows
- Sync OpenSpec progress for runtime stability and Claude compact implementation so release notes, task state, and delivered behavior stay aligned
- Improve sidebar degraded-thread recovery by moving thread-level degraded hints to workspace/worktree quick reload actions, with parent workspace refresh cascading to worktrees

🐛 Fixes

- Fix session-management boundary handling and add full regression fixtures to improve stability across archive, aggregation, and routing scenarios
- Fix the worktree new-session entry interaction so sidebar-launched sessions no longer drift into an incorrect state
- Fix unstable workspace file-tree refreshes so directory nodes, detached file windows, and workspace file state stay synchronized after refresh
- Fix Opencode subprocess termination and timeout convergence to reduce leftover process risk during abnormal exits, timeout cleanup, and session recycling
- Fix diagnostic gaps in Codex session self-recovery, zero-activity timeout fallback, and runtime reconnect scenarios to improve recoverability after disconnects
- Fix missing user-visible feedback when session creation fails, ensuring the loading dialog closes, diagnostics are recorded, and an error message is shown
- Fix OpenCode provider health-check failures leaving menu state stuck on loading, and add boundary coverage for Windows path basename extraction
- Fix sidebar quick-reload buttons appearing without handlers, and correct Worktree name splitting for Windows backslash paths

---

### **2026年4月20日（v0.4.4）**

中文：

✨ Features

- 新增项目范围会话管理能力，支持按项目聚合会话并进行归属路由，让项目内历史会话更容易集中管理

🔧 Improvements

- 收口启动期图标懒加载链路，减少启动阶段不必要的资源开销，提升首屏进入稳定性
- 归档项目会话管理范围修正提案，使行为说明与已落地实现保持一致

🐛 Fixes

- 修复空项目会话重复加载问题，避免无会话项目反复触发无效刷新
- 修复图标懒加载回归，避免启动阶段因资源加载路径变化导致图标展示异常

English:

✨ Features

- Add project-scoped session management with project-level aggregation and attribution routing, making in-project session history easier to manage

🔧 Improvements

- Tighten the startup icon lazy-loading path to reduce unnecessary startup overhead and improve first-screen stability
- Archive the project-session-management scope correction proposal so behavior docs stay aligned with the delivered implementation

🐛 Fixes

- Fix repeated loading for projects with no sessions, preventing empty projects from triggering redundant refresh loops
- Fix an icon lazy-loading regression so startup resource-path changes no longer break icon rendering

---

### **2026年4月18日（v0.4.3）**

中文：

✨ Features

- 新增 Runtime Pool Console 与独立设置面板，可集中查看 Codex runtime 池状态、进程观测信息与预算配置，提升运行时诊断与调优能力
- 重构回溯模式与文件选择策略：将回溯确认改为三种模式单选（回退消息+相关文件、只回退消息、只回退文件），并仅纳入当前用户回合后的真实 mutation 文件
- 为消息区新增 runtime 恢复卡片，支持断链诊断、一键重连，以及恢复后直接重发上一条用户提示词

🔧 Improvements

- 增强 Claude plan mode 到执行态的切换体验：保留首张 handoff 卡、记录按钮状态、支持复制计划 markdown，并优化模式切换后的可感知反馈
- 强化 Claude 默认模式审批桥接与审批卡展示：补齐路径摘要提取、默认隐藏 content/patch/diff 正文，并降低审批噪音
- 优化 runtime 预算面板与恢复提示文案，补齐 Codex-only 预算边界、异常输入归一化和跨平台提示一致性
- 提升工作区恢复、会话继续与项目会话批量删除后的刷新收敛速度，减少长链路操作中的等待与状态漂移

🐛 Fixes

- 修复 runtime orchestrator 启动与注册期间的进程回收竞态，避免会话创建、恢复或连接过程中被误判并提前回收
- 修复会话继续时旧 `threadId` 失效后的恢复失败，并补齐 `thread not found`、`SESSION_NOT_FOUND` 与 stale session 等场景的自动恢复链路
- 修复运行时断连后的重连卡片误判、重发来源错误、重复用户气泡与无效成功提示等问题
- 修复项目会话批量删除后设置页可能长期停留在“正在加载会话”状态的问题
- 修复 Claude 计划模式切换、默认模式审批衔接、迟到线程事件污染与 explore 卡片隐藏边界问题

English:

✨ Features

- Add a Runtime Pool Console and dedicated settings panel to inspect Codex runtime-pool state, process observability, and budget settings for easier diagnosis and tuning
- Refactor rewind mode and file selection strategy into three explicit options (rollback message+related files, message-only, files-only), while limiting file rollback targets to real mutations from the current user turn
- Add a dedicated runtime recovery card in the message area with disconnect diagnosis, one-click reconnect, and resend-last-prompt support after recovery

🔧 Improvements

- Improve the Claude plan-to-execution experience by preserving the first handoff card, keeping button state, supporting plan-markdown copy, and adding clearer post-switch feedback
- Harden the Claude default-mode approval bridge and approval-card presentation with better path summaries and hidden content/patch/diff bodies to reduce noise
- Refine runtime budget controls and recovery messaging with tighter Codex-only boundaries, invalid-input normalization, and more consistent cross-platform prompts
- Improve refresh convergence after workspace restore, conversation resume, and bulk session deletion to reduce waiting time and state drift in long-running flows

🐛 Fixes

- Fix runtime-orchestrator startup and registration races that could misclassify active processes and recycle them too early during session creation, recovery, or connection
- Fix failed conversation resume when an old `threadId` becomes invalid, and complete automatic recovery for cases such as `thread not found`, `SESSION_NOT_FOUND`, and stale sessions
- Fix reconnect-card false positives, incorrect resend-source selection, duplicated user bubbles, and ineffective success notices after runtime disconnects
- Fix the Settings page getting stuck on “loading sessions” after bulk-deleting project sessions
- Fix Claude plan-mode switching, default-mode approval handoff, late thread-event pollution, and explore-card visibility edge cases

---

### **2026年4月16日（v0.4.2）**

中文：

✨ Features

- 渐进开放 Claude Code planning mode 与默认模式，补齐从预览到默认可用的发布链路
- 完成 Claude 默认模式审批桥与对话连续性改造，提升计划执行切换时的上下文连贯性

🐛 Fixes

- 修复共享会话幕布中 assistant 重复输出与 fallback 误判
- 提升 Codex/Claude 数学公式渲染与会话去重兼容性
- 修复旧引擎正则兼容并增强跨平台命令稳定性
- 修复焦点刷新反复触发 opencode 会话探测问题
- 修复 Codex 选择智能体后用户消息双份回归
- 对齐物理回溯截断并修复多轮回退错位
- 补充 Claude 权限拒绝场景的兜底诊断，降低审批失败时的定位成本
- 完善 Claude 渐进式 rollout 的审批链路、计划卡片渲染与模式边界处理

English:

✨ Features

- Gradually open Claude Code planning mode and default mode, completing the rollout path from preview to default availability
- Complete the Claude default-mode approval bridge and conversation continuity refactor to improve context continuity during plan-to-execution transitions

🐛 Fixes

- Fix duplicate assistant outputs and fallback misclassification in shared-session curtain rendering
- Improve Codex/Claude math rendering compatibility and conversation de-duplication behavior
- Fix legacy engine regex compatibility and harden cross-platform command stability
- Fix repeated OpenCode session probing during focus refresh
- Fix duplicated user messages after selecting an agent in Codex
- Align physical rewind truncation and fix offset drift across multi-round rollback
- Add fallback diagnostics for Claude permission-denied scenarios to reduce troubleshooting cost when approvals fail
- Tighten Claude progressive-rollout approval flow, plan-card rendering, and mode-boundary handling

---

### **2026年4月16日（v0.4.1）**

中文：

✨ Features

- 落地共享会话能力并收口至 Claude/Codex 引擎，支持跨引擎会话共享与消息归一化
- 实现侧栏缓存机制并重构 app-shell，提升工作区切换与侧栏加载性能
- 支持回溯场景下删除文件的识别与可选工作区文件恢复，增强回溯操作完整性

🔧 Improvements

- 优化工作区首页进入流程，降低首次进入门槛并提升安全性
- 移除侧栏硬编码颜色，统一使用主题变量，提升多主题一致性

🐛 Fixes

- 修复正文中 LaTeX 与普通文本混排时的渲染异常，提升技术内容阅读体验
- 修复共享会话在兼容性与消息归一化链路中的边界问题
- 修复共享会话流程与工作区首页刷新之间的回归冲突

English:

✨ Features

- Land shared-session capability scoped to Claude/Codex engines with cross-engine session sharing and message normalization
- Implement sidebar caching and refactor app-shell to improve workspace switching and sidebar loading performance
- Support deleted-file detection in rewind scenarios with optional workspace file restoration for stronger rollback completeness

🔧 Improvements

- Make the workspace home entry flow safer and easier to reach, lowering the first-visit barrier
- Remove hardcoded sidebar colors and unify with theme variables for better multi-theme consistency

🐛 Fixes

- Fix LaTeX mixed-content rendering issues in message bodies to improve technical content readability
- Fix shared-session compatibility and message normalization edge cases
- Integrate shared-session flow without regressing workspace-home refresh behavior

---

### **2026年4月14日（v0.4.0）**

中文：

✨ Features

- 完成 Claude / Codex 会话回溯链路统一，新增回溯导出、跨引擎线程交互、工作区恢复与更可靠的回退能力
- 新增顶部会话标签右键菜单与批量关闭能力，提升多会话整理效率
- 完成文件查看与预览链路，支持目录、表格、文档、PDF 等多类型文件预览，并增强配置文件语法高亮
- 为幕布新增 LaTeX 专属渲染与公式兼容增强，改善技术内容阅读体验
- 为右侧状态区新增“最新用户对话”标签，提升长会话定位效率

🔧 Improvements

- 收口主窗口文件渲染契约、主窗口渲染决策链与文件视图状态模块，降低文件模式切换时的状态漂移
- 优化回溯入口视觉反馈，统一为历史语义图标，并在会话进行中禁用危险回溯操作
- 加固启动守护链路并补齐大文件治理预警，降低桌面端复杂启动场景下的维护成本
- 优化 Skills 面板中的 Codex 引擎命名一致性，减少多处展示语义偏差
- 增强搜索面板在技能、命令与清空场景下的稳定性，减少结果残留与误匹配
- 补齐自定义 npm prefix、CLI fallback 与跨平台命令启动的回归测试，增强跨平台可维护性

🐛 Fixes

- 修复 Claude 回溯恢复在 `add / delete / update`、空文件、无行号 hunk、首条消息回退等边界场景下的遗漏与失败问题
- 修复工作区恢复、文件视图导航竞态、本地会话历史扫描与打开工作区链路中的 Win / mac 路径兼容问题
- 修复顶部会话标签右键菜单在标题栏区域失效的问题，并增强窗口重载与白屏兜底诊断恢复能力
- 修复文件预览场景下的 `asset protocol` CSP 连接限制问题，避免本地预览资源加载失败
- 修复融合队列链路、长文本输入与跨平台输入框兼容问题，提升输入与排队发送稳定性
- 修复搜索清空后结果残留以及技能/命令结果不稳定的问题
- 修复 macOS 用户在 `Codex` 已可于本地终端运行时，客户端仍误判未安装、无法选择引擎且无法展示版本的问题
- 修复 `Codex --version` 失败但 CLI 实际可运行时被直接判定为不可用的问题，改为通过 `--help` 进行降级探测
- 修复 Windows 下同步执行 `npm.cmd` / `npm.bat` 时的 wrapper 兼容问题，避免自定义 npm 安装场景下路径探测失效
- 修复更新源仍指向旧桌面发行 feed 的问题，确保升级检查命中当前桌面发布通道

English:

✨ Features

- Unify the Claude / Codex rewind flow with export support, cross-engine thread interaction, workspace restore, and stronger rollback reliability
- Add a context menu and bulk-close actions for topbar session tabs to improve multi-session management
- Complete the file preview pipeline for directories, tabular data, documents, and PDFs, with stronger config-file syntax highlighting
- Add dedicated LaTeX rendering and formula compatibility improvements in the conversation curtain for technical content
- Add a “latest user conversation” label in the status panel to improve orientation in long-running sessions

🔧 Improvements

- Tighten the main-window file rendering contract, render-decision flow, and file-view state modules to reduce drift when switching file modes
- Refine rewind entry visuals by switching to a history-oriented icon and disabling risky rewind actions while a session is still running
- Harden the startup guard path and large-file governance alerts to reduce maintenance overhead in complex desktop bootstrap scenarios
- Normalize Codex naming in the Skills surface to keep engine labels consistent across the UI
- Improve search stability for skills, commands, and clear/reset flows to reduce stale or noisy results
- Add regression coverage for custom npm prefix discovery, CLI fallback behavior, and cross-platform command launching to improve long-term maintainability

🐛 Fixes

- Fix Claude rewind restore failures across `add / delete / update`, empty-file, no-line-number hunk, and first-message rollback edge cases
- Fix Win / mac path-compatibility issues across workspace restore, file-view navigation races, local session-history scanning, and workspace opening
- Fix the topbar session-tab context menu failing inside the titlebar region, and improve white-screen recovery with stronger diagnostics and window reload fallback
- Fix local file-preview loading failures caused by `asset protocol` CSP restrictions
- Fix queue fusion, long-text input, and cross-platform composer compatibility issues to improve send stability
- Fix stale search-clear results and unstable skills/command matches in the unified search flow
- Fix the issue where macOS users could run `Codex` in a local terminal but the client still marked it as unavailable, disabled engine selection, and failed to show its version
- Fix the case where `Codex --version` failures incorrectly marked the CLI as unavailable even though the binary was still runnable, by adding a `--help` fallback probe
- Fix Windows wrapper compatibility for synchronous `npm.cmd` / `npm.bat` execution so custom npm install layouts no longer break prefix discovery
- Fix the updater release feed still pointing to the legacy desktop endpoint so update checks now target the current desktop release channel

---

### **2026年4月11日（v0.3.12）**

中文：

✨ Features

- 品牌升级为 `ccgui` 并支持 legacy 数据迁移，降低现有用户升级切换成本
- 新增幕布宽度配置与左到右视图切换，完善不同布局偏好的使用体验
- 新增对话/看板快捷键与会话大小展示，提升导航与会话管理效率
- 优化 `File changes` 折叠展示与独立展开交互，减少长会话浏览噪音
- 重构 `MCP` 设置页为按引擎查看的只读展示视图，支持统一查看 Claude Code、Codex、Gemini、OpenCode 的配置入口与运行规则
- 完善本地统计能力并增强多引擎兼容性，提升跨引擎使用数据的一致性
- 为 Claude Code 子代理结果新增独立气泡卡片渲染，并支持在幕布中以独立视觉格式展示 agent 完成内容
- 为右下角子代理列表补充按引擎分流的跳转行为：Claude Code 可定位到当前幕布中的 agent 卡片，Codex 可跳转到对应 session

🔧 Improvements

- 降低实时会话更新对输入链路的干扰，提升连续输入稳定性
- 拆分设置页样式模块并通过大文件门禁，降低后续样式迭代耦合
- 优化 `MCP` 设置页总览卡、引擎选择与详情区的联动语义，减少跨区域状态错位
- 补齐 `MCP` 设置中英文文案、图标层次与测试映射，提升展示一致性与可维护性
- 拆分 Claude 事件转换模块并完成大文件治理，收敛引擎层职责边界并降低维护复杂度
- 收口右下角子代理点击链路的导航语义，并保留右侧面板展开状态，减少跨区域定位时的视线中断
- 强化子代理导航目标聚合逻辑，兼容 `taskId` / `task_id` 并优先保留更完整的定位信息

🐛 Fixes

- 修复启动链异常场景下的黑屏问题，增强冷启动兜底能力
- 修复 Web 端切换 Codex 后无法继续对话与历史丢失问题
- 修复跨会话绑定边界问题，并增强 Win/mac 命令包装兼容性
- 修复默认 workspace 去重与路径边界问题，避免配置重复与异常回退
- 修复消息折叠边界、拖拽预览与 Gemini 会话兼容问题
- 修复 swapped 侧栏快捷入口顺序与快捷键显示偏差
- 优化 Windows 内部文件树拖拽视觉反馈，降低拖拽操作歧义
- 修复 `Gemini` 在 `MCP` 设置中配置服务显示缺失、`OpenCode` 工具数误报，以及 Codex 运行时工具名前缀大小写兼容问题
- 修复侧栏折叠布局错位并统一引擎图标切换反馈，避免设置面板状态混淆
- 修复 Claude 会话销毁期间的子进程竞争与残留问题，降低退出阶段资源泄漏风险
- 修复本地扫描不可用时 Codex 线程已知会话丢失与 `cwd` 回填偏差问题
- 修复聊天输入框长文本水平溢出问题，提升长输入场景下的可读性
- 修复 Claude 实时与历史幕布思考正文丢失问题，避免推理内容在流式与回放场景中缺失
- 调整右侧融合状态面板布局并移除背景框，提升主界面信息层级与视觉融合度
- 修复 Claude 子代理完成消息仍与当前幕布内容混排的问题，避免 agent 内容缺少独立渲染格式
- 修复 `task-notification` 在空结果、双重转义和普通 XML 文本场景下的识别边界问题，降低误判与漏渲染风险

English:

✨ Features

- Rebrand the app to `ccgui` and support legacy data migration to reduce upgrade friction for existing users
- Add curtain-width settings and a left-to-right view toggle to better support different layout preferences
- Add conversation/kanban shortcuts and session-size display to improve navigation and session management
- Improve `File changes` collapsing and standalone expand interactions to reduce noise in long conversations
- Rebuild the `MCP` settings page into an engine-scoped read-only view that clearly shows config entry points and runtime rules for Claude Code, Codex, Gemini, and OpenCode
- Improve local usage metrics and strengthen multi-engine compatibility to keep cross-engine usage data consistent
- Add standalone bubble-card rendering for Claude Code subagent results so completed agent output is presented as an independent canvas element
- Add engine-aware jump behavior from the bottom-right subagent list: Claude Code scrolls to the in-canvas agent card, while Codex opens the corresponding session

🔧 Improvements

- Reduce interference from realtime session updates in the composer input flow for steadier typing
- Split settings style modules and pass the large-file guard to reduce styling coupling in future iterations
- Tighten the linkage between the `MCP` overview cards, engine selector, and detail area to prevent cross-section state drift
- Fill in `MCP` i18n copy, icon hierarchy, and test mappings to improve presentation consistency and maintainability
- Split Claude event-conversion modules and complete large-file governance to tighten engine-layer boundaries and reduce maintenance complexity
- Refine the bottom-right subagent click flow to preserve the right-side panel while navigating, reducing context loss during cross-panel inspection
- Harden subagent navigation-target aggregation by supporting both `taskId` and `task_id` and preferring richer anchor metadata

🐛 Fixes

- Fix black-screen scenarios during bootstrap failures by adding a safer startup fallback path
- Fix the inability to continue chatting and the history-loss issue after switching to Codex on Web
- Fix cross-session binding edge cases and improve Win/mac command-wrapper compatibility
- Fix default-workspace de-duplication and path edge cases to avoid duplicate config states and bad fallback behavior
- Fix message-collapse boundaries, drag-preview behavior, and Gemini session compatibility issues
- Fix incorrect quick-entry order and shortcut labels in the swapped sidebar layout
- Refine Windows internal file-tree drag feedback to make drag operations clearer
- Fix missing `Gemini` config-server visibility in `MCP` settings, incorrect `OpenCode` tool counts, and case-sensitive Codex runtime tool-prefix parsing
- Fix sidebar collapsed-layout drift and unify engine-icon switch feedback to reduce settings-state confusion
- Fix subprocess race and residue during Claude session teardown to reduce exit-time resource leaks
- Fix Codex known-session loss and `cwd` backfill drift when local scanning is unavailable
- Fix horizontal overflow in the chat composer for long-input scenarios
- Fix missing Claude reasoning body content in both live and historical curtain views so streamed and replayed thinking stays intact
- Adjust the merged right-side status panel layout and remove its background frame to improve hierarchy and visual integration with the main UI
- Fix mixed rendering where Claude subagent completion messages were still blended into the main curtain instead of using an independent visual format
- Fix `task-notification` parsing boundaries for empty results, double-escaped payloads, and ordinary XML-like prose to reduce false positives and missed rendering

---

### **2026年4月9日（v0.3.11）**

中文：

✨ Features

- 新增用户消息 `@路径` 引用提取与独立引用卡片展示，提升上下文可读性
- 新增 Codex/Claude/Gemini 流式等待与入流特效联动，并增强浅色主题可见性
- 优化显示设置实时预览与本地字体选择流程，降低个性化配置成本
- 优化基础设置中的语言切换视觉反馈，提升设置面板状态可辨识性

🔧 Improvements

- 补齐 Claude 幕布隐藏 run command 卡片的测试用例，收紧消息卡片可见性回归风险
- 压缩左侧工作区项目的纵向占用，提升侧边栏信息密度与浏览效率
- 调整侧边栏分组与项目列表的视觉层级和间距，提升信息扫读效率
- 模块化拆分基础外观设置并收敛气泡样式变量逻辑，提升后续维护稳定性
- 拆分设置页样式大文件，降低样式维护耦合与回归风险

🐛 Fixes

- 修复用户引用卡片视觉层级与紧凑度问题，减少消息区噪音
- 修复用户输入 `@路径` 在相邻文本场景下的解析错误，避免引用提取遗漏
- 修复项目设置中默认 workspace 显示问题，并合并未分组侧边栏条目
- 修复提示词增强快捷键跨平台失效问题，并将超时延长至 60 秒
- 修复跨平台快捷键识别偏差与流式/进程终止边界问题，降低异常中断风险
- 修复 Codex 幕布下运行命令与批量运行命令卡片误显示问题
- 修复 Claude 初始化失败后的残留进程问题，并支持模型下拉滚动
- 修复输入框占位文本换行与长文本溢出显示问题
- 修复 Claude 子进程终止链路在 Windows 的进程树清理与锁竞争问题

English:

✨ Features

- Add extraction of user-message `@path` references and render them as standalone reference cards for better context readability
- Add synchronized streaming wait/arrival effects across Codex, Claude, and Gemini, with improved visibility in light themes
- Improve display-settings live preview and local-font selection flow to reduce customization friction
- Improve visual feedback for language switching in base settings to increase state clarity

🔧 Improvements

- Add coverage for Claude curtain behavior to hide run-command cards, reducing regression risk in message-card visibility
- Reduce vertical space usage in the left workspace project list to improve sidebar information density and scan efficiency
- Refine visual hierarchy and spacing between sidebar groups and project lists to improve scanability
- Modularize base appearance settings and consolidate bubble-style variables to improve maintainability and iteration stability
- Split oversized settings style files to reduce styling coupling and regression risk

🐛 Fixes

- Fix visual hierarchy and density issues in user reference cards to reduce chat-area noise
- Fix parsing failures for user-input `@path` references when adjacent text is present, preventing missed reference extraction
- Fix default workspace visibility in project settings and merge ungrouped sidebar entries
- Fix cross-platform prompt-enhancement shortcut failures and extend the timeout to 60 seconds
- Fix cross-platform shortcut recognition drift and stabilize stream/process-termination boundaries
- Fix unintended visibility of run-command and batch run-command cards in Codex curtain mode
- Fix leftover Claude processes after initialization failures and enable scrolling in the model dropdown
- Fix composer placeholder line wrapping and long-text overflow rendering
- Fix Windows process-tree cleanup and lock contention in Claude subprocess termination flow

---

### **2026年4月7日（v0.3.10）**

中文：

✨ Features

- 输入区快捷动作改为独立图标入口，并新增二级菜单，减少常用操作路径
- 优化提示词选择与设置页交互，提升提示词管理效率
- Git 提交信息支持按语言生成中英文内容，便于跨语种协作
- Git 提交信息新增按引擎生成策略并规范化 AI 输出，提升不同模型下提交文案一致性

🔧 Improvements

- 拆分超大文件并收口模块职责，降低维护成本并改善后续迭代稳定性

🐛 Fixes

- 修复快捷动作无障碍属性与“创建提示词”事件链路，避免交互失效
- 修复 prompt enhancement 在多 workspace 下偶发不生效问题，提升增强链路稳定性
- 修复本地图像预览回退异常，并收紧本地文件读取边界
- 修复 Gemini 截图链路在 Windows 下的路径兼容问题
- 修复 Gemini 超长 prompt 触发命令行长度限制的问题，改为通过 stdin 传输

English:

✨ Features

- Convert composer quick actions into a dedicated icon entry and add a secondary menu to shorten frequent action paths
- Improve prompt selection and settings interactions for smoother prompt management
- Support language-aware Git commit message generation in both Chinese and English for cross-language collaboration
- Add engine-aware Git commit message generation and normalize AI output for more consistent commit text across models

🔧 Improvements

- Split oversized files and tighten module responsibilities to reduce maintenance cost and improve iteration stability

🐛 Fixes

- Fix accessibility attributes and the prompt-creation event chain for composer quick actions to prevent interaction failures
- Fix occasional prompt-enhancement failures across workspaces to improve enhancement reliability
- Fix local image preview fallback issues and tighten local file-read boundaries
- Fix Windows path compatibility in the Gemini screenshot flow
- Fix Gemini long-prompt failures caused by command-line length limits by switching to stdin transport

---

### **2026年4月4日（v0.3.9）**

中文：

✨ Features

- 侧边栏新增悬停图钉交互，并支持固定区一键取消固定，提升会话管理效率
- 优化引擎核心流程，增强多模块协同下的性能与稳定性

🔧 Improvements

- 将 `/review` 命令匹配逻辑升级为命令头严格匹配，并兼容 review-like 自定义命令
- 加固线程路径匹配的 Win/mac 跨平台兼容性，降低路径判定偏差

🐛 Fixes

- 修复 Gemini `sessionId` 提取过严导致的会话续传失败与消息拆会话问题
- 修复固定会话后项目列表残留与刷新延迟问题
- 修复深色主题下最终消息与推理边界不可见问题，并补齐兼容回退
- 修复多会话 stop 误伤及首次 stop 不生效问题
- 修复 Claude 自定义命令列表空响应场景下的重试与回退稳定性
- 修复 Gemini pending 会话上下文无法连续关联问题

English:

✨ Features

- Add hover-to-pin interactions in the sidebar and one-click unpin for the pinned section to improve session management
- Optimize core engine flow to improve multi-module performance and runtime stability

🔧 Improvements

- Tighten `/review` parsing with strict command-head matching while keeping compatibility with review-like custom commands
- Harden cross-platform thread-path matching for Win/mac to reduce path-resolution drift

🐛 Fixes

- Fix overly strict Gemini `sessionId` extraction that caused resume failures and message split sessions
- Fix stale project-list residues and delayed refresh after pinning sessions
- Fix invisible final/reasoning boundaries in dark theme and add compatibility fallback rendering
- Fix multi-session stop collateral impact and first-stop ineffective behavior
- Harden retry and fallback behavior when Claude custom command list responses are empty
- Fix broken continuity for Gemini pending-session context association

---

### **2026年4月1日（v0.3.7）**

中文：

✨ Features

- 新增智能体会话隔离机制，并收口首轮会话链路，减少跨会话上下文串扰
- 完成智能体图标全链路接入（设置、输入区、消息区、线程历史），提升多智能体识别效率
- 增强 Codex 运行时配置热刷新能力，并支持历史会话输出折叠，降低长会话浏览噪音
- 统一 assistant final 边界元数据并优化历史恢复链路，提升历史回放一致性

🔧 Improvements

- 拆分 `Messages` 超大组件与对应测试用例，降低单文件复杂度并提升维护效率
- 系统性收紧 `noUncheckedIndexedAccess` 与线程条目链路类型边界，减少隐式空值与索引越界风险

🐛 Fixes

- 修复消息渲染链路中“注入式智能体提示”泄漏到用户正文的问题，避免内容污染
- 修复代码复制语义混淆：区分纯文本复制与带 fenced code block 的复制路径
- 修复线程历史中已选智能体上下文丢失问题，保证回放后会话身份连续
- 修复外部文件访问边界与终端会话清理链路，降低残留会话与越界访问风险
- 修复智能体图标与名称显示不一致问题
- 修复 worktree push 在失败原因为空值时的兼容性问题

English:

✨ Features

- Introduce agent-session isolation and stabilize first-turn routing to reduce cross-session context bleed
- Complete end-to-end agent icon integration across settings, composer, message rendering, and thread history for faster multi-agent recognition
- Enhance Codex runtime config hot-refresh and add collapsible history output to reduce noise in long sessions
- Unify assistant-final boundary metadata and improve history recovery consistency during replay

🔧 Improvements

- Split oversized `Messages` module and related test suites to lower file complexity and improve maintainability
- Tighten `noUncheckedIndexedAccess` and thread-item type boundaries to reduce implicit-null and index-access risks

🐛 Fixes

- Fix injected agent prompts leaking into user-visible message text
- Fix code-copy behavior by separating plain-text copy from fenced code copy flows
- Fix loss of selected-agent context when restoring thread history
- Tighten external file-access constraints and clean up terminal sessions to reduce residual-session risk
- Fix mismatches between displayed agent icon and agent name
- Fix worktree push flow to handle empty failure reasons safely

---

### **2026年3月30日（v0.3.6）**

English:

✨ Features

- Redesign Skills management into a tree-based global browser that unifies multi-source skill directories, and add in-panel editing/saving with structured preview so users can inspect and update skills without leaving Settings
- Complete missing Web Git RPC coverage in the local daemon and split `daemon_state` into dedicated modules, making Web-mode Git actions more complete while improving daemon lifecycle maintainability
- Harden multi-engine history-chain recovery in Web mode by reorganizing oversized bridge/runtime paths, reducing replay fragility after interruptions and improving cross-engine continuity
- Rework realtime message-canvas controls into clearer control groups/constants and keep focus-follow behavior stable during live updates
- Enhance Session Activity by exposing `search_query` tool-chain details, strengthening history replay recovery, and adding date-group bulk delete for faster cleanup
- Improve repo-awareness across detached file tree, file view, and Session Activity so sub-repo Git state mapping and diff targets resolve against the correct `gitRoot`
- Support Claude custom model passthrough and dynamic model discovery, enabling newly configured models to appear and be selected without manual patching
- Optimize tool-block file-change summaries and Markdown rendering so long command/tool outputs are easier to scan inside conversations
- Convert successful `apply_patch` command-execution items into structured `File changes` cards in thread activity, including inferred file path/kind and richer change detail rendering
- Unify `File changes` and `Batch` icon semantics with theme-aware color refinement for clearer visual scanning
- Refresh the home-chat welcome area with client iconography and adjusted landing styles for stronger first-screen hierarchy

🔧 Improvements

- Align file-tree Git folder status coloring with actual changed-path semantics, including test and style alignment, so folder-level change scanning is more predictable and visually consistent
- Migrate message-flow tests into modular suites and harden realtime control-button compatibility to reduce UI regression risk
- Refactor `threadItems` by extracting exploration summarization and file-change inference into dedicated utility modules, reducing monolith complexity while preserving behavior
- Move the live middle-step collapsed hint closer to the input/working-indicator zone, improving visibility during thinking-state streaming
- Keep failed or non-executed patch command entries as regular `commandExecution` items so only real edits are promoted into file-change cards

🐛 Fixes

- Fix local web-service auto-start failures caused by daemon binary discovery issues by adding a more robust binary-location fallback path in bootstrap logic
- Fix non-default project history fetching getting stuck after a single failed request by correcting error-state reset behavior in the Web loading chain
- Fix packaged-build white screen issues caused by missing/incorrect Web static resource resolution by repairing runtime static path wiring
- Fix duplicated skill chips/tokens when selecting same-name skills from multi-source entries (global/project overlap) by tightening token grouping and de-dup assembly logic
- Reduce noisy "missing file" alerts from detached file-window monitoring to avoid unnecessary disruption
- Fix screenshot-message side effects that could trigger unintended session switching and history-chain breaks in Claude threads
- Fix Claude custom models being reset unexpectedly and refresh the model list when opening a new session so the configured selection remains available
- Fix realtime focus-follow regressions and preserve stable interaction context while streaming updates

中文：

✨ Features

- 将 Skills 管理重构为树形全局浏览器，统一聚合多来源技能目录，并补齐面板内编辑/保存与结构化预览能力，减少在设置与文件系统之间来回切换
- 补齐本地 daemon 在 Web 模式下缺失的 Git RPC 覆盖，并拆分 `daemon_state` 为独立职责模块，在提升 Git 操作完整度的同时改善 daemon 生命周期可维护性
- 通过重组多引擎桥接与运行时链路、拆分超大 Web 模块，加固 Web 模式历史链路恢复能力，降低跨引擎会话回放在中断后的脆弱性
- 重构消息实时幕布控制为更清晰的控制组与常量映射，并保持焦点跟随链路稳定，保证实时更新时交互上下文不漂移
- 增强 Session Activity：补齐 `search_query` 工具链路展示、加固历史回放恢复能力，并支持按日期分组一键批量删除
- 打通 detached/file-tree/file-view/Session Activity 的仓库感知链路，完善子仓库 `gitRoot` 状态映射与 diff 目标定位
- 支持 Claude 自定义模型透传与动态模型发现，让新增模型配置可以直接被会话选择使用
- 优化工具块中的文件变更摘要与 Markdown 渲染体验，提升长输出、多文件场景下的可读性
- 在线程活动中，将成功执行的 `apply_patch` 命令自动转换为结构化 `File changes` 卡片，补齐变更文件路径、变更类型与更丰富的差异展示
- 统一 `File changes` 与 `Batch` 图标语义并优化主题配色映射，提升工具卡视觉辨识度
- 优化首页欢迎区首屏层次：新增客户端图标并调整欢迎样式编排

🔧 Improvements

- 对齐文件树 Git 文件夹状态着色与实际变更路径语义，并同步测试与样式表现，使目录级变更扫描更可预测、视觉反馈更一致
- 将消息链路测试迁移为模块化结构，并加固实时控制按钮兼容性，降低后续 UI 演进时的回归风险
- 重构 `threadItems`：将探索摘要与文件变更推断逻辑拆分为独立工具模块，降低单文件复杂度并保持原有行为一致
- 调整实时中间步骤折叠提示的渲染位置，使其更贴近输入区与工作指示器，提升思考态流式阶段的可见性
- 对失败执行或仅包含 patch 文本但未真正执行 `apply_patch` 的场景，保持原有 `commandExecution` 展示，避免误判为文件变更

🐛 Fixes

- 修复本地 web-service 自动启动时 daemon 二进制定位失败的问题：在 bootstrap 链路增加更稳健的二进制定位兜底路径
- 修复非默认项目历史拉取在单次失败后进入“锁死”状态的问题：纠正 Web 侧失败状态复位逻辑，恢复后续请求可继续执行
- 修复安装包场景下 Web 静态资源解析缺失/错误导致白屏的问题：修正运行时静态资源路径装配链路
- 修复同名 Skill 在多来源（global/project）并存时选择后出现重复 skill chip/token 的问题：收紧 token 分组键与去重组装逻辑
- 修复 detached 文件窗口监控链路“文件缺失”告警噪声过高的问题，减少非必要打断
- 修复截图消息导致 Claude 线程会话误切换与历史链路断裂的问题
- 修复 Claude 自定义模型被意外重置的问题，并在新会话中自动刷新模型列表，保证配置后的模型可持续可见
- 修复实时更新中的焦点跟随回归，保证流式阶段的交互上下文稳定

---

### **2026年3月28日（v0.3.5）**

English:

✨ Features

- Add detached file explorer window for independent file browsing and operations
- Support cross-window drag-and-drop from detached file tree into main chat composer
- Align detached file tree interactions with Git semantics for consistent file operations
- Improve file-view interaction details and external-change awareness signals

🔧 Improvements

- Split Git History panel resize control into a dedicated module to improve maintainability and isolate runtime risks

🐛 Fixes

- Fix Claude model selection regression where 4.6 could fall back to 4.5 unexpectedly
- Fix Claude session resume path and default-model fallback behavior
- Deduplicate Codex agent real-time message snapshots to prevent repeated rendering
- Fix misleading drag cursor affordance on file-tree rows

中文：

✨ Features

- 新增独立文件窗口（detached file explorer），支持脱离主界面进行文件浏览与操作
- 支持 detached 文件树跨窗口拖拽落入主聊天输入框
- 对齐 detached 文件树交互与 Git 语义，统一文件操作体验
- 优化文件视图交互细节并增强外部变更感知提示

🔧 Improvements

- 拆分 Git History 面板尺寸控制为独立模块，提升可维护性并隔离运行时风险

🐛 Fixes

- 修复 Claude 模型选择链路回归：4.6 可能被意外回退到 4.5
- 修复 Claude 会话续传链路与默认模型回退问题
- 去重 Codex agent 实时消息快照，避免正文重复渲染
- 修复文件树行级光标拖拽提示误导问题

---

### **2026年3月25日（v0.3.4）**

English:

✨ Features

- Add Gemini CLI vendor configuration and preflight checks
- Implement Gemini real-time/history session rendering with multi-engine boundary isolation
- Complete Gemini real-time body streaming and unify file-change activity display
- Support Claude real-time thinking canvas segmented rendering
- Unify attachment selection and drag-drop routing with support for non-image inline references
- Enhance Gemini config panel interaction and styling, add model management button icons
- Adjust Gemini default models and add preset model options
- Support Kanban background execution and fix engine model leakage
- Add per-item delete and unread control for Session Activity radar recent-completion entries

🔧 Improvements

- Rebrand codemoss to mossx and localize WeChat QR asset
- Split oversized files to satisfy large-file governance gate and improve maintainability

🐛 Fixes

- Fix Gemini session loss and auto-recovery after stop
- Fix image message session isolation and history image path resolution
- Isolate Gemini image reference handling and history extraction
- Split Claude and Gemini image attachment normalization
- Align Gemini real-time thinking segmentation with tool rendering
- Refine Gemini placeholder thinking slice positioning
- Align Gemini real-time toolCalls rendering with thinking slice display
- Fix Gemini thinking paragraph override and complete reducer module splitting
- Correct Gemini real-time thinking point insertion order and preserve late-arrival fallback
- Fix Claude/Gemini image attachment loss in real-time and history paths
- Fix Gemini real-time/history dialogue thinking position misalignment and unify left-right rendering rules
- Fix Gemini real-time/history rendering semantic drift and improve vendor config availability
- Fix Gemini preflight Windows compatibility and path hints
- Fix Claude thinking toggle state read/write inconsistency under local provider
- Fix Kanban background periodic task incorrectly switching global dialogue engine
- Fix silent session duration refresh and recovery flow regression

中文：

✨ Features

- 新增 Gemini CLI 供应商配置与预检能力
- 复刻 Gemini 实时/历史会话并完善多引擎边界隔离
- 补齐 Gemini 实时正文流并统一文件变更活动展示
- 支持 Claude 实时思考幕布分段渲染
- 统一附件选择与拖拽分流链路，支持非图片内联引用
- 优化 Gemini 配置面板交互与样式，并补齐模型管理按钮图标
- 调整 Gemini 模型默认值并补充预置模型
- 支持看板后台执行并修复引擎模型泄露
- Session Activity 雷达区最近完成项支持单条删除与未读控制

🔧 Improvements

- 品牌重塑：codemoss → mossx，本地化微信二维码资源
- 拆分超限大文件并通过 large-file 治理门禁

🐛 Fixes

- 修复 Gemini 停止后会话丢失与自动恢复问题
- 修复图片消息会话隔离与历史图片路径解析
- 隔离 Gemini 图片引用处理与历史提取
- 分离 Claude 和 Gemini 图片附件规范化
- 对齐 Gemini 实时思考分段与工具渲染
- 精修 Gemini 占位思考切片点位
- 对齐 Gemini 实时 toolCalls 渲染与思考切片展示
- 修复 Gemini 思考段落覆盖并完成 reducer 模块拆分
- 修正 Gemini 实时思考点穿插顺序并保留晚到兜底
- 修复 Claude/Gemini 图片附件在实时与历史链路丢失
- 修复 Gemini 实时与历史对话思考点位错位并统一左右渲染规则
- 修复 Gemini 实时/历史渲染语义偏差并完善供应商配置可用性
- 修复 Gemini 预检的 Win 兼容性与路径提示
- 修复 Claude 思考开关在本地 provider 下状态读取与写入不一致
- 修复看板后台周期任务误切换全局对话引擎
- 修复静默会话时长刷新与恢复链路回归

---

### **2026年3月23日（v0.3.3）**

English:

✨ Features

- Add automatic compact-recovery for overlong Claude prompts and map compact events into session activity for better continuity
- Support per-item delete and unread-state control for Session Activity radar "recent completed" entries

🔧 Improvements

- Split Claude lifecycle, auto-compact retry, and AskUserQuestion/user-input handling into dedicated modules to satisfy large-file governance and improve maintainability

⚡ Performance

- Reduce CPU peak in multi-session realtime chat and improve stability boundaries

🐛 Fixes

- Fix duplicated real-time body rendering in Claude chat streaming path
- Fix multiline resume-input handling for AskUserQuestion on Windows/macOS and add snapshot-only regression coverage
- Harden strict `request_id -> turn_id` routing in AskUserQuestion response flow to reduce cross-session/cross-turn answer leakage risk
- Fix regression in silent-session duration refresh and recovery flow
- Align local command behavior between `/clear` and `/reset`
- Fix race between task-start switch and auto-start during Kanban task creation
- Unify Windows top-left sidebar style and remove project-page whitespace
- Preserve Claude session continuity in long-running chats

中文：

✨ Features

- 新增 Claude 超长 Prompt 自动 compact 恢复能力，并将 compact 事件映射到会话活动链路，提升长会话连续性
- Session Activity 雷达最近完成项支持单条删除与未读控制

🔧 Improvements

- 将 Claude 生命周期、自动 compact 重试、AskUserQuestion/用户输入处理拆分为独立模块，满足 large-file 治理门禁并提升可维护性

⚡ Performance

- 降低多会话实时对话 CPU 峰值，并补齐稳定性边界

🐛 Fixes

- 修复 Claude 聊天流式链路中实时正文重复渲染问题
- 修复 AskUserQuestion 在 Windows/macOS 下多行 resume 输入处理异常，并补齐 snapshot-only 回归覆盖
- 加固 AskUserQuestion 响应链路的 `request_id -> turn_id` 严格路由，降低多会话/多轮场景下答案串线风险
- 修复静默会话时长刷新与恢复链路回归
- 对齐 `/clear` 与 `/reset` 的本地命令行为
- 修复 Kanban 创建任务时“开始开关”与自动启动竞态
- 统一 Windows 侧栏左上区域样式并移除项目页留白
- 修复长会话场景下 Claude session 连续性问题

---

### **2026年3月22日（v0.3.2）**

English:

✨ Features

- Deliver Phase 1 of Kanban scheduling and chained-task governance to improve multi-task flow control
- Optimize serial scheduling rules and introduce a clearer Kanban label taxonomy
- Enhance group-level batch operations and task-creation interactions in Kanban workflows
- Support left-double-click expand/collapse behavior for workspace tree groups
- Improve Session Activity hint bubbles and tabbar presentation details
- Refine workspace project dropdown visuals and complete worktree list rendering
- Integrate OpenApp button into main header and improve project-area hover visibility interactions
- Add desktop topbar session tabs with global recent-session switching/closing workflow
- Add `/context` command and `<image>` tag parsing/rendering in chat for richer context-injection and multimodal flows

🔧 Improvements

- Add `windows-latest` doctor + integration CI gate for stronger cross-platform release confidence
- Harden Windows compatibility checks by making lint/runtime contract `no-undef` verification Windows-safe
- Refine main-header layout composition for session tabs while keeping sidebar topbar compact
- Split oversized Claude/message modules to satisfy large-file governance gate and improve maintainability

🐛 Fixes

- Fix scheduler lock contention and drag-sort anomalies under filtered Kanban views
- Fix batch-complete confirmation bypass and outside-click handling in grouped operations
- Enforce second-step confirmation for batch completion and polish confirm-modal behavior/styles
- Fix Hook dependency warnings and stabilize session-panel memo dependency behavior
- Fix non-Windows title-bar drag behavior and fullscreen boundary handling
- Stabilize cross-platform tab eviction ordering by replacing locale-based tie-break with code-unit comparison
- Expand keyboard activation compatibility for session tabs (`Space`, ` `, `Spacebar`, `Enter`)
- Fix AskUserQuestion rendering inconsistency between live updates and history replay
- Fix AskUserInput multi-select parsing path to remove lint blocking and stabilize tool-event handling
- Fix Windows external image drag-drop in Composer by normalizing high-DPI drop coordinates, routing image paths to attachments, and hardening hook hot-reload stability

中文：

✨ Features

- 完成 Kanban 调度与串联任务治理第一阶段落地，提升多任务流转可控性
- 优化串行调度规则并完善看板标签体系，提升任务组织清晰度
- 增强分组级批量操作与任务创建交互体验
- 工作区树支持左键双击展开/折叠分组
- 优化 Session Activity 提示气泡与标签栏展示细节
- 优化工作区项目下拉外观并补全工作树列表渲染
- 在主标题区融合 OpenApp 按钮并增强项目区域悬停显隐交互
- 新增桌面端顶部会话标签，支持最近会话全局切换与关闭
- 新增 `/context` 命令与 `<image>` 标签解析渲染，增强上下文注入与多模态消息链路

🔧 Improvements

- 新增 `windows-latest` 的 doctor + integration CI 门禁，提升跨平台发布稳定性
- 调整 lint/运行时契约 `no-undef` 校验为 Windows 兼容实现
- 优化主标题区布局编排，兼容顶部会话标签并保持侧栏顶部区域紧凑
- 拆分 Claude/消息相关大文件，满足 large-file 治理门禁并提升可维护性

🐛 Fixes

- 修复过滤视图下调度锁竞争与拖拽排序异常
- 修复分组批量完成流程中的确认放行与菜单外点击兼容问题
- 修复批量完成缺少二次确认的问题并优化确认弹窗样式与行为
- 修复 Hook 依赖告警并稳定会话面板 memo 依赖
- 修复非 Windows 场景标题栏拖拽异常与全屏边界处理
- 修复标签淘汰 tie-break 的 locale 依赖问题，统一为 code-unit 比较确保 Win/mac 一致
- 修复会话标签键盘激活兼容性，补齐 `Space`/空格字符/`Spacebar`/`Enter`
- 修复 AskUserQuestion 在实时更新与历史回放中的渲染不一致
- 修复 AskUserInput multi-select 解析链路，解除 lint 阻塞并稳定工具事件处理
- 修复 Composer 在 Windows 外部图片拖拽场景下无法稳定落入的问题：补齐高 DPI 坐标归一化、图片路径按附件处理，并加固 Hook 热更新稳定性

---

### **2026年3月20日（v0.3.1）**

English:

✨ Features

- Add Session Radar history management in Settings > Other, with batch delete support for completed radar entries
- Persist Session Radar deletion to local client store (`leida`) instead of UI-only removal
- Enhance Session Radar recent-completion cards with click-to-expand behavior while preserving direct session navigation
- Improve recent-completion readability with compact copy and clearer project identity cues
- Support opening absolute paths outside project root from session activity file-change entries
- Add shell-script group rendering and edge-case compatibility in file views
- Add persistent UI zoom slider in Settings with unified range control (80%-260%)
- Improve Session Activity real-time-follow guide overlay and assistant-entry discoverability

🔧 Improvements

- Introduce locked + atomic client-store write path and key-level patch updates to reduce stale overwrite risk across concurrent clients
- Extract Settings "Other" section into a dedicated module and factor Radar persistence merge/event helpers for better maintainability
- Improve Session Radar refresh flow through explicit history-updated event propagation after write/delete actions
- Align sidebar group/project icon axis and unify mode-navigation text color with better Chinese font appearance
- Refine model selector popup width behavior to avoid text overflow

🐛 Fixes

- Fix deleted Session Radar records reappearing after app restart
- Fix multi-client writeback race that could restore previously deleted radar history
- Fix large-file governance regression by replacing line-compression workaround with structural module splitting
- Fix ChatInputBox undo/redo behavior and align shortcuts (`Ctrl+Z`/`Ctrl+Shift+Z`, `Cmd+Z`/`Cmd+Shift+Z`) across platforms
- Remove redundant bottom border on unselected Git view-switch buttons
- Fix branch-switch validation and regression handling under dirty worktree states

中文：

✨ Features

- 在设置页“其他设置”新增 Session Radar 历史管理，支持对已完成雷达记录进行批量删除
- 会话雷达删除改为真实落盘到本地客户端存储（`leida`），不再只是界面层移除
- 优化 Session Radar 最近完成卡片交互：支持点击展开且保留会话跳转能力
- 精简最近完成卡片文案并强化项目标识，提升扫读效率
- 支持从会话活动文件变更中打开项目外绝对路径文件
- 补齐文件视图中 shell 脚本分组渲染并增强边界兼容性
- 设置页新增 UI 缩放滑条并统一缩放范围到 80%-260%
- 优化 Session Activity 实时跟随引导浮层与机器人入口可发现性

🔧 Improvements

- 客户端存储写入链路增加加锁与原子写，并支持按 key 的 patch 更新，降低多客户端并发下旧数据覆盖风险
- 将设置页“其他设置”区块抽离为独立模块，并提取雷达持久化合并/事件辅助函数，提升可维护性
- 删除与写入后通过显式历史更新事件驱动刷新，优化 Session Radar 视图同步链路
- 侧栏分组/项目图标轴线对齐，统一模式导航文案颜色并优化中文字体观感
- 优化模型选择弹窗宽度自适应策略，避免文案溢出

🐛 Fixes

- 修复删除后的 Session Radar 记录在应用重启后回弹的问题
- 修复多客户端并发写回导致已删除雷达历史被恢复的问题
- 修复大文件治理回归，移除“压缩换行”临时方案并改为结构化拆分
- 修复 ChatInputBox 撤销重做行为，并统一跨平台快捷键（`Ctrl+Z`/`Ctrl+Shift+Z`、`Cmd+Z`/`Cmd+Shift+Z`）
- 修复 Git 视图切换中未选中按钮残留底部边线问题
- 修复 dirty worktree 场景下分支切换校验与回归问题

---

### **2026年3月19日（v0.3.0）**

English:

✨ Features

- Add Session Radar panel in workspace to aggregate session status and improve at-a-glance visibility
- Persist Session Radar completion records with stronger cross-workspace recovery
- Add quick engine switching entry via bottom icon controls in composer
- Support project-root-based custom Spec path resolution with automatic `openspec` discovery

🔧 Improvements

- Refine Session Radar read-state icon behavior and selected-state colors under dark theme
- Polish selected icon style for panel tabs with cleaner border-only visual feedback
- Refactor Session Radar persistence helpers to reduce large-file pressure and improve maintainability

🐛 Fixes

- Fix composer input overflow caused by long `MessageQueue` text blocks
- Fix `MessageQueue` queue type reference mismatch in chat input path
- Preserve raw user input format and restrict Spec prompt injection to first-turn only
- Fix dual-display fullscreen drag freeze issue on Windows
- Fix file tree root collapse interaction and drag cursor compatibility
- Fix session badge and `Default` label contrast across light/dark themes
- Fix desktop light-theme selector consistency and color mismatch on macOS
- Fix inconsistent worktree info popover color styling

中文：

✨ Features

- 新增工作区 Session Radar 雷达面板，聚合会话状态并提升全局可观测性
- 持久化 Session Radar 完成记录，增强跨工作区恢复能力
- 在输入框底部 icon 区新增引擎快速切换入口
- 支持以项目根为语义的自定义 Spec 路径，并自动解析 `openspec`

🔧 Improvements

- 优化 Session Radar 已读状态图标表现与深色主题选中色彩
- 调整面板 Tab 图标选中态为更简洁的无背景边框风格
- 抽离 Session Radar 持久化辅助逻辑，降低大文件压力并提升可维护性

🐛 Fixes

- 修复长文本 `MessageQueue` 场景下输入区布局溢出问题
- 修复聊天输入链路中 `MessageQueue` 队列类型引用错误
- 修复用户输入原始格式被破坏，并将 Spec 提示词注入限定为仅首轮
- 修复 Windows 双屏全屏拖拽导致白屏卡死问题
- 修复文件树根目录折叠交互并优化拖拽抓取光标兼容性
- 修复深浅主题下会话徽标与 `Default` 标签对比度问题
- 统一桌面端浅色主题 selector 下拉样式并修复 macOS 色差
- 修复工作树信息弹层配色不一致问题

---

### **2026年3月18日（v0.2.9）**

English:

✨ Features

- Support drag-and-drop file references from file tree and external files directly into chat composer
- Add workspace open-mode routing with new-window creation capability
- Highlight running sessions with project/worktree icon cues in sidebar
- Support double-click maximize/restore for file tabs
- Enhance `$` skill picker and scope display in chat input
- Improve session activity visual system with clearer sub-session grouping and color mapping
- Improve session activity and Spec Hub entry layout with smoother file-tree interaction

⚡ Performance

- Land Deferred + JIT strategy for large-file governance and reduce heavy-path startup pressure
- Complete Bridge cleanup and modularization hardening to improve runtime stability

🐛 Fixes

- Fix Win10 CLI detection false positives causing engine switch failures
- Fix Windows light-theme dropdown readability and workspace path matching compatibility
- Fix occasional style distortion and tag rendering loss after file-tree drag reference
- Fix Codex history sessions becoming invisible after Windows restart
- Fix session activity ordering conflicts for same-second events
- Fix missing child sessions in Codex history and align with real-time activity view
- Fix default startup sidebar collapsed state by restoring expanded behavior
- Fix solo mode right-pane width reset and unify processing agent badge display
- Harden refactor runtime contracts and static import scanning to prevent undefined-reference startup regressions
- Support opening external spec files from session file changes while preserving workspace compatibility

中文：

✨ Features

- 支持将文件树与外部文件直接拖拽引用到对话输入框
- 新增工作区打开模式分流与新建窗口能力
- 侧边栏为运行中会话增加项目/工作树图标高亮提示
- 文件 Tab 支持双击最大化与还原
- 增强输入框 `$` 技能选择器与作用域展示
- 优化会话活动视觉体系，强化子会话分组与配色映射
- 调整会话活动与 Spec Hub 入口布局并优化文件树交互

⚡ Performance

- 落地 Deferred + JIT 大文件治理策略，降低重路径启动压力
- 完成 Bridge 清理与模块化治理收口，提升运行时稳定性

🐛 Fixes

- 修复 Win10 下 CLI 探测误判导致引擎切换失败
- 修复 Windows 浅色下拉可读性与工作区路径匹配兼容性问题
- 修复文件树拖拽引用后偶发样式失真与标签渲染丢失
- 修复 Windows 重启后 Codex 历史会话不可见
- 修复会话活动同秒事件排序冲突
- 修复 Codex 历史子会话丢失并与实时活动展示对齐
- 修复客户端启动默认侧栏未展开的问题
- 修复 solo 模式右侧宽度重置并统一 processing 代理徽章展示
- 加固重构后的运行时契约与静态导入扫描，修复未定义引用导致的启动回归
- 支持会话文件变更中打开 external spec 文件并保持 workspace 兼容

---

### **2026年3月15日（v0.2.8）**

English:

✨ Features

- Add workspace Session Activity panel and complete tool-event pipeline integration
- Recover Codex historical session activity and aggregate reasoning events for playback
- Optimize Session Activity incremental refresh and timeline scanning behavior
- Enhance file preview UX: richer Markdown rendering, improved toolbar/find interactions, and script/log text fallback opening
- Support lazy local rendering for Markdown Mermaid modules
- Optimize right-side file tree density and root alignment
- Improve HUB panel drag-and-snap interaction and increase right-panel width limits
- Refresh model modal visual style

🐛 Fixes

- Improve compatibility with new reasoning events and repair activity rendering chain
- Improve compatibility with Claude streaming events in Session Activity
- Fix activity command summaries and `Read` path compatibility
- Unify command output rendering and fix activity card auto-collapse timing
- Fix Codex history activity turn-binding mismatch
- Fix Claude history file-change playback issues
- Fix engine icon mis-switch on session switch and add timeout error feedback
- Hide redundant Plan shortcut entry in Codex canvas
- Fix codex context tooltip being clipped in sidebar scenarios
- Disable visible console fallback by default on Windows to avoid multiple terminal popups
- Improve message test assertion type safety

中文：

✨ Features

- 新增工作区 Session Activity 会话活动面板并补齐工具事件链路
- 补齐 Codex 历史会话活动恢复与 reasoning 聚合回放能力
- 优化 Session Activity 增量刷新与时间线扫描机制
- 增强文件预览体验：提升 Markdown 渲染、编辑器工具栏与查找交互，并支持脚本/日志文本兜底打开
- 支持 Markdown Mermaid 模块局部懒渲染
- 优化右侧文件树密度与根节点层级对齐
- 优化 HUB 面板拖拽吸附交互并提升右侧面板宽度上限
- 更新模式模型弹窗样式

🐛 Fixes

- 兼容新版 reasoning 事件并修复会话活动渲染链路
- 兼容 Claude 流式事件并修复会话活动展示问题
- 修复会话活动命令摘要与 `Read` 路径兼容性
- 统一命令输出渲染并修复活动卡片自动收起时序
- 修复 Codex 历史活动轮次错挂问题
- 修复 Claude 历史文件改动回放异常
- 修复会话切换时引擎图标误变更并补齐超时错误反馈
- 隐藏 Codex 幕布中冗余 Plan 快捷入口
- 修复侧栏场景下 codex 上下文 tooltip 被遮挡
- 默认关闭 Windows 可见控制台 fallback，避免多终端弹窗
- 改进消息测试断言类型安全

---

### **2026年3月12日（v0.2.7）**

English:

✨ Features

- Add global network proxy settings and proxy status exposure
- Optimize compact summary display in Git Diff and history workspaces
- Improve file viewer Markdown defaults, theme readability, and wide-content no-wrap rendering consistency

🐛 Fixes

- Fix Codex startup compensation, timeout recovery, and plan presentation regressions
- Align summary indicator styles across Diff and Git History views
- Refine diff viewer theme backgrounds for better visual consistency

中文：

✨ Features

- 新增全局网络代理设置与代理状态透出
- 优化 Git Diff 与历史工作区紧凑摘要展示
- 改进文件查看器 Markdown 默认模式、主题可读性与宽内容 no-wrap 渲染一致性

🐛 Fixes

- 修复 Codex 启动补偿、超时恢复与计划展示回归问题
- 统一 Diff 与 Git 历史摘要指示器样式对齐
- 优化 Diff Viewer 主题背景以提升视觉一致性

---

### **2026年3月11日（v0.2.6）**

English:

✨ Features

- Add automatic non-UTF-8 text encoding detection using `chardetng` + `encoding_rs` for files like GB18030 Chinese text, applied to workspace file reads, spec file reads, and general text IO (#186 @zhukunpenglinyutong)
- Redesign workspace worktrees tree layout to IDE Explorer style: section count badges, branch name layered display (prefix/leaf), thread count badges with cursor indicator, stable guide lines, and improved active/hover states (#181 @chenxiangning)
- Sidebar UI enhancements and visual adjustments (#185 @a653928127-ctrl)

🐛 Fixes

- Fix large project freeze on open after dependency install: add workspace scan budgets (30K entries / 1.2s time), Git diff preview multi-dimensional budgets (200 files / 2MB total / 256KB per file / 2.5K lines per file), frontend auto-preload risk-path filtering with churn thresholds, and thread list fetch timeout with local session fallback (#181 @chenxiangning)
- Fix Claude streaming text truncation/misplacement: unify delta event extraction across method aliases, add item snapshot-to-delta conversion, isolate message/reasoning reducer merges by `id + kind`, and add per-engine render source routing (#183 @chenxiangning)
- Fix cross-session thread leaking: tighten pending-to-session resolution anchoring, unify `continue_session` semantics across engine paths, refactor reasoning deduplication to current-turn windowing, and settle plan step status for live and history states (#183 @chenxiangning)
- Fix Claude interrupted turn incorrectly marked as completed and add Codex `parseError` error pass-through (#183 @chenxiangning)
- Fix Auto Mode write authorization stuck: add `ApprovalRequest` event mapping from engine to app server with tool-name-based method inference (#183 @chenxiangning)

中文：

✨ Features

- 新增非 UTF-8 文本编码自动检测：使用 `chardetng` + `encoding_rs` 支持 GB18030 等编码文件的自动解码，应用于工作区文件读取、Spec 文件读取与通用文本 IO (#186 @zhukunpenglinyutong)
- 重设计工作区 Worktrees 树形布局为 IDE Explorer 风格：分组数量徽标、分支名分层显示（前缀/叶子）、线程数量徽标（支持 cursor 时显示 +）、稳定层级导视线、优化激活/悬停态 (#181 @chenxiangning)
- 侧边栏 UI 增强与视觉调整 (#185 @a653928127-ctrl)

🐛 Fixes

- 修复安装依赖后打开超大项目卡死：新增工作区扫描预算（3 万条目 / 1.2 秒时间）、Git diff 预览多维预算（200 文件 / 2MB 总量 / 256KB 单文件 / 2500 行单文件）、前端自动预加载风险路径过滤与 churn 阈值、线程列表拉取超时与本地 session 兜底 (#181 @chenxiangning)
- 修复 Claude 流式正文截断/错位：统一增量事件提取兼容多 method 别名、新增 item 快照转增量、按 `id + kind` 隔离 message/reasoning reducer 合并、新增多引擎渲染数据源路由 (#183 @chenxiangning)
- 修复跨 session 串线：收紧 pending 线程解析锚点、统一 `continue_session` 语义、重构 reasoning 去重为当前轮窗口、新增计划步骤状态在流式与历史恢复中的一致收敛 (#183 @chenxiangning)
- 修复 Claude 中断误标记为完成，补齐 Codex `parseError` 错误透传 (#183 @chenxiangning)
- 修复 Auto Mode 下写入授权卡死：新增 `ApprovalRequest` 引擎事件到 app server 的映射，基于工具名推断授权方法类型 (#183 @chenxiangning)

---

### **2026年3月10日（v0.2.5）**

English:

✨ Features

- Unify file tree visual semantics across Git Diff / History / Worktree panels: add hierarchical guide lines, directory FileIcon support, and `__repo_root__` display logic
- Redesign Diff/History panel interaction: collapsible commit section, external control bar via header portal, sticky header with loading states, and mode-switch icons
- Redesign Pull/Push/Worktree branch selectors: grouped tabs, search filtering, custom dropdown panels with scope buckets, improving multi-branch usability
- Integrate Codex Fast/Review quick actions: Speed sub-menu (Standard/Fast) and Review entry in ConfigSelect, Review Inline Prompt with base-branch and commit search/filter
- Redesign home page with HomeChat as unified entry, auto-ensure default workspace directory, and pin default workspace to sidebar top
- Enhance search block display and link interaction with webSearch data format compatibility

🐛 Fixes

- Fix Codex engine first-session timing causing missing model: add backend model fallback (frontend → workspace config → model/list default)
- Fix Codex first-session thread creation compatibility: support multiple threadId response formats, add optimistic user message to eliminate send delay
- Fix Codex first-send approval dialog not appearing timely: unify approval/request event routing and request_id parsing
- Unify network error handling: add structured first-packet timeout error, network error classification and localized user hints, enhance proxy environment propagation
- Fix /review execution path under Claude engine and enhance thread compatibility fallback (legacy thread id auto-rebind retry)
- Fix Composer false compacting state on first response
- Fix Win/Mac dropdown menu scroll compatibility
- Fix macOS titlebar offset trigger condition and enhance platform detection (add macOS detection, narrow to specific layout combination state)
- Fix workspace title scroll overlap and background color mismatch in sidebar
- Remove unstable proxy environment injection and startup proxy synchronization logic

中文：

✨ Features

- 统一 Git Diff / History / Worktree 文件树视觉语义：新增层级竖向引导线、目录 FileIcon 支持与 `__repo_root__` 根目录显示逻辑
- 重构 Diff/History 面板交互：新增提交区折叠、通过 portal 实现的外置控制栏、sticky header（含加载状态文案）与模式切换图标增强
- 重构 Pull/Push/Worktree 分支选择器：支持分组 Tab、搜索过滤、自定义下拉面板与 scope 分桶展示，提升多分支场景可用性
- 集成 Codex Fast/Review 快捷入口：ConfigSelect 新增 Speed 二级菜单（Standard/Fast）与 Review 入口，Review Inline Prompt 支持基线分支与提交搜索过滤
- 重构首页会话入口：引入 HomeChat 作为统一入口，自动解析并确保默认工作区目录存在，侧边栏默认工作区固定置顶
- 优化搜索块展示与链接交互，兼容 webSearch 数据格式

🐛 Fixes

- 修复 Codex 引擎首会话时序导致 model 缺失：增加后端模型兜底解析（优先前端传入 → workspace config → model/list 默认）
- 修复 Codex 首次会话线程创建兼容性：兼容多种 threadId 返回形态，新增 optimistic user message 消除首次发送延迟
- 修复 Codex 首发审批弹窗未及时出现：兼容 approval/request 事件路由，统一 request_id 解析
- 统一网络异常处理：新增首包超时结构化错误、网络错误分类与本地化提示，增强代理环境透传
- 修复 /review 在 Claude 场景下的执行链路并增强线程兼容兜底（legacy thread id 自动重绑重试）
- 修复 Composer 首次响应时错误触发 compacting 状态
- 修复 Win/Mac 下拉菜单滚动兼容性
- 修复 macOS 标题栏偏移触发条件并增强平台识别（新增 macOS 判断，收敛仅在特定布局组合态下生效）
- 修复工作区标题滚动重叠与背景色差
- 移除不稳定的代理环境注入与启动期代理同步逻辑

---

### **2026年3月6日（v0.2.4）**

English:

✨ Features

- Add Codex context dual-view with automatic compaction flow: backend auto-trigger state machine (92% threshold, 70% target), manual compaction RPC, dual-view usage indicator (input+cached tokens), and full event/error propagation across app layers
- Add file tree root node with recursive lazy loading for special directories: workspace root node with expand/collapse, sticky toolbar, new file/folder actions, and multi-level lazy loading for `node_modules` and similar directories
- Add workspace full-text search with case-sensitive, whole-word, and regex options backed by a new Rust search command
- Add thread delete confirmation popover to prevent accidental deletions
- Add file panel maximize capability and enhance find panel interaction
- Add project session management in settings with project/worktree switching, bulk selection, and delete confirmation
- Restyle file panel action area to icon+text toolbar

⚡ Performance

- Increase workspace file scan limit from 20,000 to 100,000 in both Tauri and daemon paths

🎨 UI Improvements

- Optimize message list rendering with custom memo comparator; freeze displayed items during active text selection to preserve highlights during streaming
- Optimize file changes panel display density and hover background behavior

🐛 Fixes

- Fix `@@` manual memory selector scroll not working in composer
- Fix file changes panel to support click-to-diff and improve display density
- Fix Codex context compaction state and manual compaction interaction consistency: unify context usage calculation (last snapshot), fix compacting state event chain, prevent double-click on manual compaction button
- Fix Codex background helper thread causing session list to disappear after workspace switch
- Fix Codex sessions with `source=vscode` being incorrectly filtered out, causing history loss after restart

中文：

✨ Features

- 新增 Codex 上下文双视图与自动压缩链路：后端自动触发状态机（92% 阈值、70% 目标），手动压缩 RPC，双视图用量指示器（input+cached token），完整事件与错误传播链路
- 新增文件树根节点与特殊目录递归懒加载：工作区根节点支持展开/收起、Sticky 工具栏、新建文件/文件夹操作，`node_modules` 等特殊目录支持多层级逐级懒加载
- 新增工作区全文搜索：支持区分大小写、全词匹配和正则表达式，由新增 Rust 搜索命令支撑
- 新增线程删除二次确认弹窗，防止误操作
- 新增文件面板最大化能力，优化查找面板交互
- 新增设置页项目会话管理：支持按项目/工作树切换、批量选择与二次确认删除
- 文件面板操作区改为图标+文本工具栏样式

⚡ Performance

- 工作区文件扫描上限从 20,000 提升至 100,000（Tauri 和 daemon 路径同步升级）

🎨 UI Improvements

- 消息列表渲染优化：自定义 memo 比较器，用户选中文本时冻结列表渲染，避免流式更新打断文字选取
- 优化会话幕布文件变更面板展示密度与悬停背景表现

🐛 Fixes

- 修复 Composer 中 `@@` 手动记忆选择器上下滚动失效
- 修复会话幕布 File changes 支持点击查看 diff，并优化展示密度
- 修复 Codex 上下文压缩状态与手动压缩交互一致性：统一上下文占用统计口径（last 快照）、补齐压缩状态事件驱动链路、修复手动压缩按钮防连点
- 修复 Codex 后台 helper 线程导致会话侧栏切换后消失
- 修复 Codex `source=vscode` 会话被误过滤，导致重启后历史丢失

---

### **2026年3月5日（v0.2.3）**

English:

✨ Features

- Add runtime log console (Phase 1) with Java toolchain and cross-platform compatibility: backend `runtime_log` module, workspace-level run session state machine, real-time log streaming, `RuntimeConsoleDock`/`RuntimeLogPanel` components, Windows cmd/wrapper support
- Add multi-stack profile detection and launch for runtime console: `runtime_log_detect_profiles` command supporting Java/Node/Python/Go, dynamic preset rendering, enhanced startup scripts with dependency checks
- Support empty directory display in file tree with single-child chain collapse (a/b/c → a.b.c), unified Diff/History entry, and Hub shortcut for Git History toggle
- Improve GitDiffPanel mode switching with custom dropdown menu, open/close state management, and unified visual styling
- Add notification sound selection (default/chime/bell/ding/success) with custom file picker support, redesign Basic settings with card-based layout
- Add usage analytics dashboard with cost estimation, session summaries, daily breakdown, trend analysis, tabbed interface and interactive charts
- Add custom model dialog and plugin model management for vendor providers
- Add `CurrentClaudeConfigCard` and `vendor_get_current_claude_config` command

⚡ Performance

- Optimize git status polling with adaptive active/background/paused modes using chained `setTimeout`
- Skip per-file diff stats when changed files exceed 120 (backend) or 80 (frontend preload)
- Prevent overlapping git status requests via in-flight tracking
- Bound thread list page scanning with configurable caps
- Normalize workspace paths for macOS `/private` prefix variants

🎨 UI Improvements

- Unify terminal and runtime log panel width with full-column grid layout
- Restyle terminal tabs from capsule borders to bottom-line with blue active indicator
- Hide duplicate runtime log toggle in file tree area, restore Git tab in PanelTabs

🐛 Fixes

- Fix file list display issues
- Fix terminal panel close path to avoid state desynchronization
- Fix file tree path separators on Windows to avoid mixed separators
- Fix command preset misidentification on Windows

中文：

✨ Features

- 新增运行日志控制台（第一阶段）：后端 `runtime_log` 模块、工作区级运行会话状态机、实时日志流、`RuntimeConsoleDock`/`RuntimeLogPanel` 组件、Windows cmd 兼容与 Java 启动器探测
- 运行控制台支持多技术栈 profile 探测与启动：`runtime_log_detect_profiles` 命令支持 Java/Node/Python/Go、动态预设渲染、增强启动脚本与依赖检测
- 文件树支持空目录展示与单子目录链折叠显示（a/b/c → a.b.c），统一 Diff/History 入口，新增 Hub 快捷按钮切换 Git History
- 优化 GitDiffPanel 模式切换：自定义下拉菜单、开关状态管理、统一视觉层级与交互样式
- 新增通知提示音选择（默认/风铃/铃声/叮咚/成功）与自定义文件选取，重新设计基本设置为卡片式布局
- 新增使用量分析面板：费用估算、会话摘要、每日用量明细、趋势分析、标签页式界面与交互图表
- 新增自定义模型对话框与供应商插件模型管理
- 新增 `CurrentClaudeConfigCard` 与 `vendor_get_current_claude_config` 命令

⚡ Performance

- Git 状态轮询优化：自适应 active/background/paused 模式，使用链式 `setTimeout` 替代固定 `setInterval`
- 变更文件超过 120 时跳过逐文件 diff 统计（后端），超过 80 时跳过前端 diff 预加载
- 通过 in-flight 标记防止 Git 状态请求重叠
- 线程列表页面扫描增加可配置上限
- 规范化工作区路径以处理 macOS `/private` 前缀变体

🎨 UI Improvements

- 统一终端与运行日志面板宽度（全列网格布局）
- 终端标签页由胶囊边框改为底部蓝色边线样式
- 隐藏文件树中重复的运行日志入口，恢复 PanelTabs 中的 Git 标签

🐛 Fixes

- 修复文件列表显示问题
- 修复终端面板关闭路径导致的状态不同步
- 修复 Windows 上文件树路径分隔符混用问题
- 修复 Windows 上命令预设误判问题

---

### **2026年3月3日（v0.2.2）**

English:

✨ Features

- Enhance message display and add user bubble color customization
- Add `@@` manual memory completion in ChatInputBox with dropdown preview panel, title/summary/tags display, and detached draft support for no-active-thread scenarios
- Add real-time usage entry and plan mode toggle for Codex engine in composer
- Align Codex plan mode protocol with requestUserInput lifecycle

🐛 Fixes

- Fix Codex engine inconsistency after Plan -> Code mode switch within session
- Fix file tree `+` button insertion: use native `@absolutePath` mention format instead of icon+path text
- Fix thread mode sync and stale user input event handling on thread switch
- Address code review issues from PR #153

中文：

✨ Features

- 增强消息显示效果并新增用户气泡颜色自定义
- 在 ChatInputBox 中新增 `@@` 手动记忆补全：下拉预览面板（标题/摘要/标签/重要度/更新时间）、无活跃线程时的草稿支持
- Codex 模式新增实时用量入口与计划模式切换
- 对齐 Codex 计划模式协议与 requestUserInput 生命周期

🐛 Fixes

- 修复 Codex 引擎在会话内 Plan -> Code 切换后的表现不一致问题
- 修复文件树 `+` 按钮插入行为：改为原生 `@absolutePath` mention 形式，避免行级点击干扰
- 修复线程切换时模式同步与过期 user input 事件处理
- 修复 PR #153 代码审查中发现的问题

---

### **2026年3月2日（v0.2.1）**

English:

✨ Features

- Optimize Windows frameless window interaction, layout behavior and message code highlighting
- Refactor settings panel into modular section components for better maintainability

🐛 Fixes

- Correct topbar z-index stacking and sidebar placeholder scope

🔧 Improvements

- Rewrite README with detailed feature overview and development guide

中文：

✨ Features

- 优化 Windows 无边框窗口交互、布局行为与消息代码高亮
- 重构设置面板为模块化 Section 组件，提升可维护性

🐛 Fixes

- 修复顶栏 z-index 层叠与侧栏占位区域范围问题

🔧 Improvements

- 重写 README，补充详细的功能概览和开发指南

---

### **2026年3月2日（v0.2.0）**

English:

✨ Features

- Enable Auto Mode by default and support paste image direct submission in composer
- Add Code Intel definition/reference navigation for file view
- Add new ChatInputBox component system and refactor Composer architecture
- Add Agent management system and AskUserQuestion interactive dialog
- Support horizontal/vertical dual layout switch for editor view with enhanced split-pane drag
- Display added/modified line markers in editor synced with Git status colors
- Split editor and chat panels, refine file tab experience
- Redesign sidebar navigation and improve scrollbar behavior
- Complete chat canvas architecture refactoring with consistency gates
- Add collaboration mode enforcement policy and thread-level state sync
- Raise thread list capacity limit and remove message truncation
- Add workspace welcome page with sidebar entry coordination, complete .agents scanning
- Refine UI layout, improve message rendering performance, and add send shortcut settings
- Complete multi-language rendering coverage for right-side file view

🐛 Fixes

- Fix GitHub Actions build out-of-memory issue
- Fix test environment async residual errors after teardown
- Fix GitHistory branch rename test CI timing flake
- Fix lint regex errors and sync message component changes
- Fix chat file reference interaction and optimize file open and status display
- Add global error boundary, optimize panel drag experience and build config

🔧 Improvements

- Refactor ChatInputBox layout and visual style
- Refactor thinking block component to minimal design with centered message layout
- Remove WorkspaceHome module and improve thread list tooltip
- Change sidebar skills entry to "coming soon" and optimize workspace tree styles

中文：

✨ Features

- 默认启用 Auto Mode 并支持粘贴图片直接提交
- 接入 Code Intel 定义/引用导航能力
- 新增 ChatInputBox 输入框组件系统并重构 Composer 架构
- 新增 Agent 管理系统和 AskUserQuestion 交互对话框
- 编辑视图支持上下/左右双布局切换并增强分栏拖拽
- 编辑器显示新增/修改行标记并同步 Git 状态颜色
- 拆分编辑器与聊天面板，优化文件标签页体验
- 重新设计侧栏导航并改善滚动条行为
- 完成对话幕布架构重构并补齐一致性门禁
- 增加协作模式强制策略与线程级状态同步
- 提升线程列表容量限制并移除消息截断
- 工作区欢迎页与侧栏入口联动优化，补齐 .agents 扫描
- 优化 UI 布局，提升消息渲染性能，新增发送快捷键设置
- 补齐右侧文件视图多语言渲染覆盖

🐛 Fixes

- 修复 GitHub Actions 构建内存溢出问题
- 修复测试环境销毁后的异步残留报错
- 修复 GitHistory 重命名分支测试的 CI 时序抖动
- 修复 lint 正则错误并同步消息组件改动
- 修复聊天文件引用交互并优化文件打开与状态展示
- 添加全局错误边界、优化面板拖拽体验和构建配置

🔧 Improvements

- 重构 ChatInputBox 布局与视觉风格
- 重构思考块组件为极简设计并居中消息布局
- 移除 WorkspaceHome 模块并改进线程列表提示框
- 侧栏技能入口改为敬请期待并优化工作区树形样式

---

### **2026年2月27日（v0.1.9）**

English:

✨ Features

- Complete bottom function area and selector style interaction optimization
- Use official model icons for Claude/Gemini/Codex engines
- Complete Spec Hub entry and gate alignment capability upgrade
- Complete Spec Hub execution feedback orchestration and OpenSpec hardening
- Support project-level Skills/Commands discovery with source-grouped display (S+/M+)
- Support `@@` manual memory association and enhance thread message stability
- Complete memory capability landing with context injection, batch & tag abilities, light theme unification
- Optimize project memory list UI visual effects
- Complete memory Kind auto-classification fix and archive implementation plan
- Finalize note/conversation flow and context-injection planning

🐛 Fixes

- Restore git diff split alignment, independent horizontal scroll, and readability
- Keep verify/archive executable when Spec Hub preflight blocks archive
- Vendor xmlchars to avoid npm registry 403
- Unblock npm 403 and fix Rust compile error
- Resolve post-cherry-pick typecheck issues in memory module

🔧 Improvements

- Rename MossX to in build scripts and CI workflow, then rename back to MossX across codebase
- Stabilize Spec Hub i18n text and language switch validation tests
- Stabilize SettingsView shortcut teardown tests

中文：

✨ Features

- 完成底部功能区与选择器样式交互整体优化
- 引擎图标使用 Claude/Gemini/Codex 官方模型图标
- 完成 Spec Hub 入口与门禁对齐能力升级
- 完成 Spec Hub 执行反馈编排与 OpenSpec 加固
- 支持项目级 Skills/Commands 发现并按来源分组展示 S+/M+
- 支持 `@@` 手动关联记忆并增强线程消息稳定性
- 完成记忆能力落地：上下文注入、批量与标签能力、浅色样式统一
- 优化项目记忆列表 UI 视觉效果
- 完成 Kind 自动分类修复并归档实施计划
- 完成笔记/对话流程与上下文注入规划

🐛 Fixes

- 修复 Git Diff 分栏对齐、独立水平滚动和可读性
- 修复 Spec Hub 预检阻止归档时验证/归档仍可执行
- 内置 xmlchars 依赖以避免 npm registry 403 错误
- 修复 npm 403 和 Rust 编译错误
- 修复记忆模块 cherry-pick 后的类型检查问题

🔧 Improvements

- 统一品牌名称：在构建脚本和 CI 中重命名为 MossX
- 完善 Spec Hub 文案国际化与语言切换校验测试
- 稳定 SettingsView 快捷键销毁测试

---

### **2026年2月22日（v0.1.8）**

English:

✨ Features

- Enhance Create PR preview and popup interaction experience
- Implement full Create PR workflow with branch deletion recovery mechanism, refactor PR popup compare interaction and visual
- Implement worktree publish recovery and git command stability improvements
- Complete pull/sync/fetch/refresh two-step confirmation with parameterized execution
- Optimize history panel and diff preview interaction
- Enhance push popup preview and reset flow in commit history
- Add explicit baseline selection for worktree and enhance branch context menu
- Unify Git history panel interaction with workspace validation and error prompts
- Complete log panel refactoring with branch creation interaction
- Unify sidebar icon style and fix settings page switch and PR flow layout

🐛 Fixes

- Fix branch rename button unresponsive and unify top action button active state
- Fix worktree publish failure recovery and enhance Git command stability
- Remove misleading diff action by removing unused open-file button
- Restore branch context menu and remove always-visible checkout button from list
- Dock change-anchor controls as modal footer bar
- Unify Git panel log tab label to "Git"
- Fix session hard delete and improve kanban popup and trigger state interaction
- Clean up codexLeadMarkers regex invalid escapes

🔧 Improvements

- Reduce noise and consolidate Hook dependency warnings (no behavior change)

中文：

✨ Features

- 增强创建 PR 预览与弹窗交互体验
- 落地 Create PR 全流程与分支删除恢复机制，重构 PR 弹窗 compare 交互与视觉
- 落地工作树发布失败恢复与 Git 命令稳定性提升
- 完成 pull/sync/fetch/refresh 二段确认与参数化执行
- 优化历史面板与差异预览交互
- 提交历史增强 Push 弹窗预览与 Reset 流程
- 工作树显式基线选择与分支右键菜单能力完善
- 统一 Git 历史面板交互并补齐工作区校验与错误提示
- 完成日志面板重构与分支创建交互
- 统一侧栏图标风格并修复设置页切换与 PR 流程布局

🐛 Fixes

- 修复分支重命名按钮无响应并统一顶部操作按钮激活态
- 修复工作树发布失败可恢复并增强 Git 命令稳定性
- 移除误导性 diff 操作按钮（未使用的打开文件按钮）
- 恢复分支右键菜单并移除列表常驻 checkout 按钮
- 将变更锚点控件停靠为模态框底栏
- 统一 Git 面板日志页签文案为 Git
- 修复会话硬删除并完善看板弹窗与触发态交互
- 清理 codexLeadMarkers 正则无效转义

🔧 Improvements

- 去噪优化并收敛 Hook 依赖告警（无行为变更）

---

### **2026年2月18日（v0.1.7）**

English:

✨ Features

- Complete workspace sidebar visual coordination makeover (t1-4)
- Implement optimize-codex-chat-canvas proposal core capabilities
- Unify management UI to reduce clutter and improve scalability
- Lay groundwork for consistent settings UX and theming
- Enhance tree-based single-file diff with full-text anchor navigation
- Alert on session completion when app is unfocused
- Add task editing and macOS compatibility improvements for kanban
- Complete OpenCode panel capabilities with session recovery and test coverage
- Complete OpenCode phase 2 capabilities with stability fixes and chat experience optimization
- Support engine dropdown and icon style optimization for new sessions on workspace home
- Complete file multi-tab and input area visibility experience optimization
- Add lock screen overlay and session completion reminder

🐛 Fixes

- Fix session lifecycle: converge delete semantics and align OpenCode entry with canvas consistency
- Unblock settings and composer regressions
- Stabilize reasoning stream event handling for Codex
- Prevent stale async state from leaking memory across sessions
- Ensure consistent active styling across themes for vendors
- Prevent stale Claude IDs from reusing wrong engine thread
- Reduce workflow friction from noisy streams and title failures
- Fix kanban link display and session batch delete confirmation flow
- Fix OpenCode heartbeat prompt, engine detection and panel interaction
- Use dynamic discovery for OpenSSL library references in build
- Stabilize sidebar thread layout to reduce clipping/jitter

🔧 Improvements

- Drop dim mode to simplify theme support and UX
- Reduce hidden UI state to keep context always visible
- Simplify completion alerts to avoid split notification UX

中文：

✨ Features

- 完成 t1-4 工作区侧栏视觉协调改造
- 落地 optimize-codex-chat-canvas 提案核心能力
- 统一管理 UI，减少界面杂乱并提升可扩展性
- 为一致的设置 UX 和主题系统奠定基础
- 树形单文件差异与全文锚点导航增强
- 应用失焦时会话完成弹出提醒
- 看板新增任务编辑与 macOS 兼容性改进
- 完善 OpenCode 面板能力并补齐会话恢复与测试覆盖
- 完成 OpenCode 二期能力与稳定性修复并优化聊天体验
- 新建会话支持引擎下拉与图标样式优化
- 完成文件多标签与输入区可见性体验优化
- 新增锁屏遮罩与会话完成提醒

🐛 Fixes

- 修复会话生命周期：收敛删除语义并打通 OpenCode 入口与幕布一致性
- 修复设置和 Composer 回退问题
- 稳定 Codex 推理流事件处理
- 防止过期异步状态跨会话内存泄漏
- 确保各主题下供应商激活样式一致
- 防止过期 Claude ID 复用错误引擎线程
- 减少嘈杂流和标题失败造成的工作流阻力
- 修复看板关联显示与会话批量删除确认流程
- 修复 OpenCode 心跳提示、引擎检测与面板交互
- 构建时使用动态发现 OpenSSL 库引用
- 稳定侧栏线程布局以减少裁剪/抖动

🔧 Improvements

- 移除 Dim 模式以简化主题支持和 UX
- 减少隐藏 UI 状态以保持上下文始终可见
- 简化完成提醒以避免分裂通知 UX

---

### **2026年2月11日（v0.1.6）**

English:

✨ Features

- Add unified search panel with category filtering
- Optimize kanban strip density and ordering in composer

🐛 Fixes

- Stabilize kanban links across workspace ID changes
- Stabilize context menus with portal and compact layout in composer

中文：

✨ Features

- 新增统一搜索面板与分区筛选
- 优化 Composer 中看板条目密度和排序

🐛 Fixes

- 修复工作区 ID 变更时看板链接稳定性
- 使用 Portal 和紧凑布局稳定右键菜单

---

### **2026年2月10日（v0.1.5）**

English:

✨ Features

- Remove Sentry telemetry, add About page and kanban git panel

中文：

✨ Features

- 移除 Sentry 遥测，新增关于页面和看板 Git 面板

---

### **2026年2月10日（v0.1.4）**

English:

✨ Features

- Reduce context switching with in-app long-term memory view
- Improve UX with thread tooltips, task draft persistence, and interrupt handling
- Support multi-source skill discovery with priority merge

🐛 Fixes

- Prevent memory navigation hijacks and reduce setup confusion
- Improve DMG detach reliability in create-dmg script

中文：

✨ Features

- 新增应用内长期记忆视图，减少上下文切换
- 改进线程工具提示、任务草稿持久化和中断处理
- 支持多来源 Skill 发现与优先级合并

🐛 Fixes

- 防止记忆导航劫持并减少设置困惑
- 提升 create-dmg 脚本中 DMG 弹出可靠性

---

### **2026年2月9日（v0.1.2）**

English:

✨ Features

- Prefer local discovery for faster offline skill listing
- Keep CLI settings and model names in sync for Claude
- Support Claude inherit and composer click-outside close
- Let users switch AI providers and reliably stop sessions

🐛 Fixes

- Update Haiku model and add Opus 1M variant

🔧 Improvements

- Upgrade release runner to ubuntu-24.04 for newer tooling

中文：

✨ Features

- 优先本地发现以加速离线 Skill 列表
- 保持 Claude CLI 设置与模型名称同步
- 支持 Claude 继承与 Composer 点击外部关闭
- 支持用户切换 AI 供应商并可靠停止会话

🐛 Fixes

- 更新 Haiku 模型并添加 Opus 1M 变体

🔧 Improvements

- 升级发布 Runner 到 ubuntu-24.04 以使用更新的工具链

---

### **2026年2月9日（v0.1.1）**

English:

✨ Features

- Merge skill commons panel and kanban context mode in composer

🐛 Fixes

- Add retry logic for DMG detach in CI environment

中文：

✨ Features

- 合并 Composer 中的 Skill 公共面板与看板上下文模式

🐛 Fixes

- CI 环境中 DMG 弹出添加重试逻辑

---

### **2026年2月9日（v0.1.0）**

English:

✨ Features

- Reduce typing friction and improve task progress cues
- Improve kanban task discussions with richer markdown

🐛 Fixes

- Prevent macOS DMG builds failing on Finder scripting in CI

中文：

✨ Features

- 减少输入摩擦并改善任务进度提示
- 改进看板任务讨论，支持更丰富的 Markdown

🐛 Fixes

- 修复 CI 中 macOS DMG 构建因 Finder 脚本失败的问题

---

### **2026年2月8日（v0.0.9）**

English:

✨ Features

- Reduce file-management friction and i18n drift in workspaces
- Redesign workspace landing with guided starts and conversation entry
- Polish worktree/session sections and collapse interactions in sidebar
- Improve kanban linking UX and routed send behavior

🐛 Fixes

- Reduce confusing UI states when tooling context is missing
- Reduce install friction and UI jank across core workflows

中文：

✨ Features

- 减少工作区文件管理摩擦和国际化偏差
- 重新设计工作区着陆页，引导启动和对话入口
- 优化侧栏工作树/会话区域和折叠交互
- 改进看板链接 UX 和路由发送行为

🐛 Fixes

- 减少工具上下文缺失时的困惑 UI 状态
- 减少核心流程中的安装摩擦和 UI 卡顿

---

### **2026年2月7日（v0.0.8）**

English:

✨ Features

- Improve readability with diagrams, git hints and opaque UI

中文：

✨ Features

- 通过图表、Git 提示和不透明 UI 改善可读性

---

### **2026年2月7日（v0.0.7）**

English:

✨ Features

- Reduce context switching with in-app editing and panelized kanban
- Reduce context-switch errors and improve task triage in kanban
- Stabilize UX with file-backed state and richer kanban flows
- Add kanban mode to manage AI tasks without chat clutter

中文：

✨ Features

- 通过应用内编辑和面板化看板减少上下文切换
- 减少看板上下文切换错误并改进任务分类
- 通过文件持久化状态和更丰富的看板流程稳定 UX
- 新增看板模式，无需聊天即可管理 AI 任务

---

### **2026年2月7日（v0.0.6）**

English:

✨ Features

- Make agent activity easier to scan in chat messages
- Enable archive for Claude Code CLI threads with local data deletion

🐛 Fixes

- Reduce homepage whitespace to improve first-screen clarity
- Keep recent conversations visible for Claude threads
- Extract tool action description for inline summary display

🔧 Improvements

- Remove tool-group headers and improve tool summary labels
- Switch tool rendering from block cards to inline style

中文：

✨ Features

- 使聊天消息中的 Agent 活动更易浏览
- 支持 Claude Code CLI 线程归档与本地数据删除

🐛 Fixes

- 减少首页空白以改善首屏清晰度
- 保持 Claude 线程的最近对话可见
- 提取工具操作描述用于内联摘要显示

🔧 Improvements

- 移除工具组头部并改进工具摘要标签
- 将工具渲染从卡片块切换为内联样式

---

### **2026年2月7日（v0.0.5）**

English:

✨ Features

- Surface task status near composer to reduce context switching
- Enable localized dictation and empty state text
- Support localized UX and per-turn engine isolation
- Persist auto-generated thread titles for reuse
- Surface more thread and Claude history by default
- Support new agent workflow across models and UI

🐛 Fixes

- Prevent dropped tool events and reduce UI friction across locales
- Refresh pinned thread list on pin state changes
- Prevent stale tool states and unify CLI-missing errors
- Avoid auto-rename conflicts during parallel Claude runs
- Streamline thread UX and tool status consistency

中文：

✨ Features

- 在 Composer 附近展示任务状态以减少上下文切换
- 支持本地化语音输入和空状态文案
- 支持本地化 UX 和每轮引擎隔离
- 持久化自动生成的线程标题以供复用
- 默认展示更多线程和 Claude 历史记录
- 支持跨模型和 UI 的新 Agent 工作流

🐛 Fixes

- 防止工具事件丢失并减少跨语言环境的 UI 摩擦
- Pin 状态变更时刷新置顶线程列表
- 防止工具状态过期并统一 CLI 缺失错误
- 避免并行 Claude 运行时的自动重命名冲突
- 精简线程 UX 和工具状态一致性

---

### **2026年2月6日（v0.0.4）**

English:

✨ Features

- Optimize UI spacing and thread display threshold
- Change workspace delete dialog wording to "remove" for i18n

中文：

✨ Features

- 优化 UI 间距和线程显示阈值
- 国际化：将工作区删除对话框措辞改为"移除"

---

### **2026年2月5日（v0.0.3）**

English:

✨ Features

- Implement menu localization with i18n support
- Expose Claude command library for slash command usage

🐛 Fixes

- Align Windows release artifacts with Tauri 2 outputs

🔧 Improvements

- Improve Windows CMake detection and refactor Claude engine

中文：

✨ Features

- 实现菜单国际化支持
- 开放 Claude 命令库用于斜杠命令

🐛 Fixes

- 对齐 Windows 发布产物与 Tauri 2 输出

🔧 Improvements

- 改进 Windows CMake 检测并重构 Claude 引擎

---

### **2026年2月5日（v0.0.2）**

English:

✨ Features

- Improve tool-call UX and harden signing key handling
- Prioritize desktop UX and restore auto-updates

中文：

✨ Features

- 改进工具调用 UX 并加固签名密钥处理
- 优先桌面 UX 并恢复自动更新

---

### **2026年2月4日（v0.0.1）**

English:

✨ Features

- Initial release of MossX desktop application
- Tauri 2 + React 19 + TypeScript architecture
- Claude Code CLI integration with session management

中文：

✨ Features

- MossX 桌面应用初始发布
- Tauri 2 + React 19 + TypeScript 架构
- Claude Code CLI 集成与会话管理
