# Verification

验证日期：2026-08-30。上游基线：`cd362f8cf0190f459e7cf0628edf01367fa64552`。PR 在独立 worktree 验证，未纳入本地打包配置、生成的发布说明或会话数据。

## 已通过

| 检查 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run src/features/home src/features/settings/components/SettingsView.test.tsx --pool=forks --maxWorkers=2` | 11 files / 105 tests passed；home 43，SettingsView 62 |
| `npm run typecheck` | passed |
| 变更 TS/TSX 文件 scoped ESLint | 0 errors；4 个既有 settings warnings |
| `npm run check:runtime-contracts` | 22 个 app-shell tests 及 git-history runtime contract passed |
| `node node_modules/vite/bin/vite.js build` | passed；存在现有 chunk size / mixed-import warnings |
| `openspec validate add-home-appearance-and-particles --strict` | passed |
| `git diff --cached --check` | passed |

SettingsView 的首页入口断言并入已有 Basic tabs 导航测试，以保留 Appearance/Behavior 覆盖并避免重复挂载同一大组件；最终测试总数为 105（整理前为 106）。

## 全仓检查与基线对照

这些检查未通过，不能标为全仓全绿。对照使用相同依赖和未修改的上游 commit。

- `npm run lint`：1 error / 1000 warnings。唯一 error 在未改动的 `src/features/markdown/fastMarkdownRenderer/__tests__/workerAdapterCrashBackoff.test.ts:157`，规则为 `prefer-const`；在干净上游 worktree 对该文件运行 ESLint 同样失败。
- `npm run test`：batch runner 在包含 `src/app-shell.startup.test.tsx` 的批次停止，该文件 9 项测试出现 `Maximum update depth exceeded`，栈指向 `appShellHostBus.tsx`；干净上游 worktree 单独运行该文件得到相同 9 项失败。全套测试未跑完。
- `npm run check:large-files:gate`：PR 与干净上游均为 72 findings / 31 blocking，未增加 finding 路径。`BasicAppearanceSection.tsx` 在上游已超出记录基线，本次只增加 import 和组件挂载共 2 行；CSS 增加 17 行，仍处在现有 growth allowance 内。没有放宽 policy 或改写 baseline。

## 演示证据与平台范围

- 贡献者提供的 [MP4](../../../docs/guides/ui/media/home-appearance-demo.mp4) 长约 17.5 秒，展示 Windows v0.9.4 自建客户端：首页鼠标粒子扰动/回弹 → 设置 → 基础设置 → 外观 → 修改标题 → 保存 → 返回首页继续交互。
- 视频已检查可见页面，未见密钥或会话正文；原音轨为静音。MP4 保留原文件，另附同内容低分辨率 GIF 预览。
- 此前浏览器中以实际 React 组件验证了自定义中英文标题、PNG Logo 和 800px 布局，浏览器结果不替代原生平台验收。
- PR 未修改 Rust 或官方构建配置；此前同源功能的自建 Windows release/NSIS build 已通过，但不能等同于本 PR 的官方发布流水线验证。

## 待完成

- 原生客户端：关闭/跟随系统切换、重启持久化、Logo 上传与恢复默认。
- macOS/Linux 平台回归。
- 非中英文/繁体中文的 7 个 locale 新文案目前保留英文。
- 全仓检查的基线问题需维护者评估。PR 保持 draft，不绕过检查，不宣称可直接合并；完成验收后再 sync/archive。
