# Design

## 实施计划

1. 从上游 main 建立独立 PR 分支，仅引入已实现的首页外观、粒子代码及测试。
2. 使用现有 BasicAppearanceSection 与 settings-pref-* 样式承载表单，首页只显示结果。
3. 复用 clientStorage；配置及低频通知由 home feature 持有，不向 AppShell domain bag 增加状态。
4. 在独立分支运行 focused tests、typecheck、lint、runtime contracts 和 large-file gate，记录真实结果。
5. 按上游 PR template 提交 draft，关联 #1135；保留未完成验收，不把浏览器证据表述为原生平台验收。

## 交互与安全边界

- 标题最多 80 个字符；空标题使用 i18n 默认文案。默认 Logo 随 engine 切换。
- 本地 PNG/JPEG/WebP 限制为 512 KB、2048 × 2048；不允许远程 URL 或 SVG 上传。
- 草稿只有保存才写入；取消恢复已保存内容。恢复默认先更新草稿，保存后生效。
- Canvas 成功绘制后才隐藏视觉源，原有 heading 语义保持；失败、关闭时回退 DOM。
- 鼠标经过时排斥粒子，移开后弹回。静止和页面隐藏时停止 RAF，内容与主题变化后重绘。
- 保留 First Light license 于源码及 public/licenses，随静态资源分发。

## 平台行为

| 模式 | Windows | macOS / Linux |
| --- | --- | --- |
| 开启 | 用户明确选择后播放，不被系统 reduce 阻断 | 同样响应明确选择 |
| 跟随系统（默认） | 遵循系统 reduce；暂停时在设置中提示 | 保留系统偏好 |
| 关闭 / Canvas 失败 | 普通 DOM 标题及 Logo | 同一回退路径 |
| WebGL / frost / shader | 本次未改动 | 本次未改动 |

贡献者提供的视频覆盖 Windows 客户端设置入口、标题保存和鼠标粒子交互；重启、其他播放模式、Logo 上传与 macOS/Linux 回归仍待完成。浏览器实际组件验证不替代 WebView2 / WKWebView 验收。
