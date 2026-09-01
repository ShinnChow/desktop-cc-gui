## ADDED Requirements

### Requirement: 首页外观可配置
Settings → Appearance SHALL 提供标题、字体、Logo 和粒子选项，并使用 clientStorage 持久化；首页 SHALL 只展示配置结果，不显示自定义编辑入口。默认标题 SHALL 使用 i18n，默认 Logo SHALL 使用当前 engine 图标。

#### Scenario: 保存、取消和恢复默认
- **WHEN** 用户保存外观并返回首页或重启应用
- **THEN** 首页使用已保存配置；取消不改变已保存配置；恢复默认并保存后回到默认字标

#### Scenario: 本地 Logo 校验
- **WHEN** 用户选择非 PNG/JPEG/WebP、超过 512 KB 或超过 2048 × 2048 的图片
- **THEN** 表单拒绝图片并显示本地化错误，不替换已保存的 Logo

### Requirement: 粒子播放模式
粒子模式 SHALL 区分开启、跟随系统和关闭，默认跟随系统。明确开启 SHALL 不被 reduced-motion 阻断；跟随系统 SHALL 保留系统减少动态效果偏好，并在暂停时提示原因。

#### Scenario: 主动开启鼠标交互
- **WHEN** WebView 返回 reduced-motion 且用户明确选择开启并保存
- **THEN** 鼠标经过字标时粒子散开，移开后回弹；关闭时恢复普通字标

### Requirement: 粒子安全接管
粒子层 SHALL 响应标题、Logo、主题与尺寸变化，保留 heading accessibility，并在失败或关闭时显示正常 DOM。卸载 SHALL 清理 RAF/listener，静止或页面隐藏时 SHALL 停止无效动画循环。

#### Scenario: 内容变化与失败
- **WHEN** 内容变化、Canvas 初始化失败或组件卸载
- **THEN** 不显示旧粒子、不遗留动画资源，正常首页输入和点击保持可操作
