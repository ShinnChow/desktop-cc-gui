# 首页外观设置与交互粒子字标

## Why

首页标题和引擎图标目前固定展示。Issue #1135 希望允许自定义文字、字体与 Logo，并通过鼠标扰动产生粒子散开、回弹效果；配置应归入现有 Settings → Appearance，不在首页增加编辑入口。

## What Changes

- 在 Settings → Appearance 增加首页外观表单，支持保存、取消、恢复默认和 clientStorage 持久化。
- 移植 First Light Canvas 字标效果，保留 MIT notice；不增加依赖。
- 将粒子模式明确区分为开启、跟随系统、关闭，默认遵循 reduced-motion。
- 保留可访问的 DOM 标题，并处理内容/主题/尺寸刷新、异步清理和失败回退。
- 修正 app-shell 边界测试的 Windows 路径分隔符比较；不变更 allowlist 或 production shell ownership。

## Impact

修改 home feature、BasicAppearanceSection、局部 CSS、10 个 locale bundle 和相关测试。不改 engine/session/provider contract，不调整官方包名、更新服务或构建命令。

PR 保持 draft，直至验证记录中的平台验收和必要检查完成；此 change 暂不 sync/archive。
