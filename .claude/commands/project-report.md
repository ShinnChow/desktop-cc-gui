---
description: 项目报表——大文件分布、模块代码量、治理状态一屏总览（可持续扩展新维度）
---

# 项目报表（project-report）

生成当前项目质量与规模的一屏式报表。**只读操作**，不改任何文件。各段独立，某段命令失败不阻塞其余段，在报告中标注 N/A 即可。

## §1 总览指标卡

执行后按下表输出：

```bash
# 源码规模（非测试非css）
find src src-tauri/src -name '*.ts' -o -name '*.tsx' -o -name '*.rs' | grep -v '.test.' | xargs wc -l | tail -1
# 分档统计
find src src-tauri/src \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' \) | grep -v '.test.' | xargs wc -l | awk '$2!="total"{if($1>=2600)a++;else if($1>=2000)b++;else if($1>=1500)c++}END{print ">=2600:",a+0," 2000-2599:",b+0," 1500-1999:",c+0}'
# 测试与 css
find src -name '*.test.*' | xargs wc -l | awk '$1>2000&&$2!="total"' | wc -l
find src/styles -name '*.css' | xargs wc -l | awk '$1>2000&&$2!="total"' | wc -l
```

| 指标 | 当前值 | 参照（2026-08-31 Wave 6 收官） |
|---|---:|---:|
| 源码总行数 | … | — |
| ≥2600（fail 线以上） | … | 0 |
| 2000–2599 | … | 47 |
| 1500–1999 | … | 38 |
| 测试 >2000 | … | 18 |
| CSS >2000 | … | 12 |
| 全仓最大源码 | …（`find … \| sort -rn \| head -3`） | 2562 cc_gui_daemon.rs |

## §2 大文件治理状态

```bash
npm run check:large-files:gate >/dev/null 2>&1; echo "gate exit: $?"
npm run check:large-files:near-threshold 2>&1 | grep -oE 'status=(retained|watch|captured)' | sort | uniq -c
git log -1 --format='%h %ad %s' --date=short -- docs/architecture/large-file-baseline.json
```

输出：
- gate：绿/红
- retained / watch 计数；retained 逐条列出（文件 + 行数 + 组 + delta）
- strictReduction 三组（settings-view-sections / bridge-runtime-critical / feature-hotpath）是否各为 retained=0 —— 非零用 ⚠️ 高亮（说明增长已被或将被 PR 阻塞）
- baseline 最后重生成时间与所属提交（超过 2 周未重生成提示「可能掩盖缓慢增长」）

## §3 大文件分布明细

```bash
npm run check:large-files:near-threshold >/dev/null 2>&1  # 生成/刷新 .artifacts/large-files-near-threshold.json
python3 -c "
import json
from collections import Counter
d=json.load(open('.artifacts/large-files-near-threshold.json'))
rs=d['results']
c=Counter(r['policyId'] for r in rs)
print('按组分布:', dict(c))
for g in c:
    top=sorted((r for r in rs if r['policyId']==g), key=lambda r:-r['lines'])[:5]
    print(f'[{g}]'); [print(f\"  {r['lines']:>5}  {r['status']:<8}  {r['path']}\") for r in top]
"
```

按组聚合输出（styles / test-files / bridge-runtime-critical / feature-hotpath / settings-view-sections / default-source），每组列出 Top 5（行数 + retained/watch 状态 + 路径），其余折叠为计数。

## §4 模块代码量分布

```bash
for d in src/features/*/ src/app-shell src/services src-tauri/src/engine src-tauri/src/backend src-tauri/src/bin; do
  [ -d "$d" ] && echo "$(find "$d" \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' \) | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}') $d"
done | sort -rn | head -15
```

输出 Top 15 模块行数条形（每 2000 行一个 █），并标注各模块内 >2000 行文件数。

## §5 预留扩展段（后续接入，当前输出占位）

- **性能**：待接入。数据源候选：`docs/perf/` 实测文档、render 归因面板快照、bundle 体积（`npm run build` 后 dist 统计）。
- **测试健康**：待接入。候选：测试总数/存量失败数趋势、flaky 名单。
- **依赖健康**：待接入。候选：`npm outdated` 计数、Cargo 依赖数。

接入新维度时在本文追加 §，并在输出模板加对应段——保持「只读、分段独立失败隔离」两条不变。

## 输出模板

```
# 项目报表（<分支> @ <短哈希>，<日期>）
## 总览：指标卡表
## 治理：gate 状态 + retained 清单 + baseline 新鲜度
## 大文件分布：按组聚合 + Top 明细
## 模块代码量：Top 15 条形图
## 扩展维度：性能/测试健康/依赖（未接入则一行占位）
```
