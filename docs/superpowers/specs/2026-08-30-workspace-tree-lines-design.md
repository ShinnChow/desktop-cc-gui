# Workspace Tree Lines Design

## 背景

工作区侧边栏当前已经按 workspace 展示嵌套的 sessions、folders 与 worktrees，但子项之间缺少明确的层级连接线。用户希望参考树状列表的视觉表达，在现有列表空间内增加线条，让 workspace 与其子项的归属关系更清晰。

## 目标

- 为 workspace 下的子项增加一条连续的 vertical tree spine。
- 为每个直接子项增加短的 horizontal connector，表达其属于当前 workspace。
- 保留现有 selection、hover、collapse、drag reorder、pagination 与 virtualized list 行为。
- 只增加视觉层，不引入新的业务状态、点击行为或 accessibility 节点。

## 方案

采用 CSS + 少量语义 class 的方案（v4：贯穿竖线 + ╰ 圆弧弯钩叠加，2026-08-30 三次视觉校准后修订）：

1. **容器级贯穿竖线**（`.workspace-children::before`）保证竖线连续性——每行各画一段的方案（v3/v3.1）在相邻行高不一致时必然断缝（`-50%` 猜不准上一行中线，实测竖线不连续、用户两次反馈空隙），连续性必须由一条线保证。`top: 0; bottom: 6px; width: 1px`（v4.2 校准，2026-08-30 用户反馈「线再往上延伸 4px」：原 `top: 4px` 起点距 workspace 标题行过远、线头悬空；收到 `0` 后只剩容器自身 2px margin，线头贴近标题行），线位 `left: var(--workspace-tree-rail-x)`。
2. **每行 ╰ 圆弧弯钩叠加在贯穿线上**：伪元素只画「四分之一圆弧 + 水平短线」——`top: calc(50% - 4px); height: 4px; width: 7px` + 单 `border-bottom` + `border-bottom-left-radius: 4px`（底边框的圆角会自然画出完整弧线到竖直方向）。**不画竖线尾巴**（无 `border-left`）：与贯穿线同像素相切衔接、无叠色变深。盒子只覆盖 [中线-4px, 中线]，`calc(50%)` 自适应行高，flex / 虚拟列表统一规则（无上探、无跨行几何假设）。**半径 6px → 4px（v4.2，2026-08-30 用户选择）**：1px 曲线的斜段有抗锯齿摊薄（实测弧段只剩直线 ≈63% 对比度，见 §4），缩小半径让斜段变短、满覆盖像素占比升高，弯头观感更实、更利落；半径 4 < 盒高 6 会留 2px 无墨直段（竖线列内弧墨最低点下探到中线-1.35px），盒高同步收到 4px 保持「盒子 = 弧段外接矩形」。
3. **不占子行横向空间**：`.workspace-children` 保持 `padding-left: 0`，线位 x（`--workspace-tree-rail-x: 10px`）与 `.thread-list` 现成的 10px 左 padding 沟槽对齐，即直接子行的行盒左缘；弯钩盒 `left: 0; width: 7px` 画在行自身 padding 空闲区内。
4. rail 颜色基于 `--text-muted`（`color-mix` 34%，校准史：45% 实测偏重 → 30% 直线段合适、但弯钩弧线段因 1px 曲线抗锯齿摊薄实测只剩直线 ≈63% 对比度（用户截图像素实测：背景 233 / 直线 197 / 弧段 210）→ 34% 折中，弧段观感逼近直线、直线仅略重），`--border-subtle` 基色实测过浅几乎不可见。
5. **subagent 行**：不画弯钩（属于父会话而非 workspace），竖线连续性由贯穿线负责。**session folder 行**（depth-0）画同款弯钩，行盒 x=0 故弯钩 `left: 10px` 对齐线位，内容左 padding 8px→13px 避让；folder children 嵌套层继续用自带 guide（与线位同像素，wrapper `margin-left: 10px`）。**worktree 卡片**：`margin-left: var(--workspace-tree-rail-x)` 挂在线位上，卡片半透明背景隐约透线（≈20% 可见度）即「挂在树上」效果，内部不画线。
6. 「更多 / 收起 / 隐藏摘要」收进 `.thread-list-footer` 包裹层（`ThreadList` 渲染），workspace 作用域内用 `--desktop-sidebar-background` 回退链的侧栏底色遮罩盖住贯穿线——树线只延伸到最后一个标题行的弯钩处。另有一条**上探 19px（v4.2 校准，原 20px，用户拍板）**的窄遮罩带：盖住最后行中线以下的露出段（露出段 = 行高 30 + gap 2 = 17px，19 留 1.5px 余量）。**带宽必须 = 竖线宽 1px（v4.1 校准，2026-08-30 用户截图实证）**：2px 带比竖线宽出一列，恰好压在弯钩弧线 x∈[1,2) 的左上过渡段上（弧线在 x>1 侧实际延伸到 y≈中线-2，「弧线 y ≤ 中线-3 不受伤」的原几何假设与实测不符），弧线被擦出斜向缺口、最后一项视觉上从树上脱开；1px 带只擦竖线自身列，弧线从竖线平滑长出。**探针零咬合上限（v4.2）**：带顶（footer_top − 探针）必须高于弧线在带列（x∈[0,1)）内的最低墨点——R=4 时该点在中线−1.35px（R=6 时在中线−2.7px），即探针 ≤ 露出段 + 1.35 = 18.35px；19px 超限 0.65，理论在弧线 x∈[0.54,1) 段留 ~0.5×0.7px 亚像素豁口、隐没在抗锯齿内（若可见回 18）。行高若调大（>32px）露出段超出探头会残留竖线细点，需重新校准。folder 内嵌 list 的 footer 遮罩带 `left: -8px` 对准嵌套 guide 线位（偏移由 wrapper `padding-left: 8px` 决定、不随线位移动；带宽 1px 与 guide 同像素、无富余列）。
7. 保留现有 selection、hover、collapse、drag reorder、pagination 与 virtualized list 行为；弯钩是行内伪元素、天然画在行背景之上，hover/active 行上弧线保持可见（贯穿竖线被 hover 背景短暂遮住属 VSCode 同款口径）。
8. **横向宽度收紧 pass（2026-08-30，用户反馈「左右空间浪费」）**：层级 cue 全保留，只压边距——`.workspace-list` 左右 padding 2px→0（workspace 药丸边距交给 `.workspace-row` 自身 4px margin，与置顶区 `0 4px` 对齐）；`.thread-list` padding 12/8→10/4；`.thread-row` 行内 pad 10/6→8/5（pin/hover 避让 20→18、folder 内 16→14）；folder children 基础 `margin-left` 12→10；标题↔时间戳 gap（`.thread-name` margin-right + `.thread-meta` margin-left）14→10。净收益（未分组口径）：session 标题可用宽 +17px、选择药丸宽 +10px，左侧标题起点 28px→22px、右侧时间戳尾距 20px→13px。
9. **子级整体缩进 +4px（2026-08-30，用户反馈「缩进不明显」）**：`.workspace-children` `margin: 2px 0 0` → `margin: 2px 0 0 4px`，整个子块（贯穿 rail、╰ 弯钩、folder tree、worktree 卡片、footer 遮罩）随容器刚性右移，内部对齐与右缘位置不变。禁止用 `padding-left` 实现——rail 是容器级 `::before`、弯钩挂在行盒左缘，padding 只移内容会把两者拆散；`padding-left: 0` 契约（树线不占子行空间）保持不变。
10. **弯钩水平段缩短（2026-08-30，用户反馈「钩尖与图标太近」）**：弯钩盒 `width: 10px` → `7px`——钩尖原落在行内 x=10，距图标起点（x=13，`padding-left: 13px`）仅 3px，视觉贴死。缩短后弧半径 6px 不变、只削直段（4px→1px），钩尖↔图标间隙 3px→6px；行 padding、线位、folder 行避让沟槽均不动。（弧半径后续于 v4.2 由 6px → 4px，见 §2。）
11. **弯钩圆角缩小（2026-08-30，v4.2，用户选择「缩小弯钩圆角」）**：`border-bottom-left-radius` 6px → 4px，弯钩盒 `top/height` 同步 `calc(50% - 6px)/6px` → `calc(50% - 4px)/4px`。动机与抗锯齿几何见 §2；与 footer 遮罩带的零咬合联动校准见 §6（探针 20→18px）。

## 非目标

- 不实现 workspace 子项折叠的新交互；继续复用已有 collapse 行为。
- 不新增 SVG overlay、DOM 测量或 runtime layout calculation。
- 不调整 workspace/session 数据结构与排序逻辑。

## 验收

- 展开 workspace 时，竖线贯穿连续（任何行高组合下无断缝），每行 ╰ 圆弧弯钩挂在竖线上，视觉不再生硬。
- 最后一个标题行的弯钩以下、「更多」footer 区域不出现竖线（遮罩收尾）；收尾遮罩与弯钩衔接处无缺口（遮罩带与竖线同像素，不得擦伤弧线）。
- 收起 workspace 时，连接线随 children 一起隐藏，不残留空白线段。
- hover/active/dragging 行的现有交互不被连接线破坏，行上线条仍可见。
- virtualized thread list 滚动与分页不出现错位或额外横向滚动条。
- 子行（session 标题）横向可用宽度与无树线版本一致。
- 相关 component test 与 typecheck 通过。
