import "./styles/globals.css";
import "./styles/base.css";
import "./styles/buttons.css";
import "./styles/sidebar-shell.css";
import "./styles/sidebar.css";
import "./styles/sidebar.system-proxy-drawer.css";
import "./styles/sidebar.footer.css";
import "./styles/home.css";
import "./styles/home-chat.css";
import "./styles/first-run-setup.css";
import "./styles/main.css";
// extensions / tokentracker 仅 Extensions 视图需要，改为 feature loader 懒加载
// （见 loadExtensionsStyles），避免进启动 CSS 与首屏 style 图。
import "./styles/messages.css";
import "./styles/collapsible-reveal.css";
import "./styles/approval-toasts.css";
import "./styles/error-toasts.css";
import "./styles/global-runtime-notice-dock.css";
import "./styles/request-user-input.css";
import "./styles/update-toasts.css";
import "./styles/composer.css";
import "./styles/panel-tabs.css";
// P1-1: session-activity / terminal / plan / tool-blocks / status-panel /
// multi-agent / subagent / debug / worktree-modal / clone-modal 改为 feature loader
// （见 src/styles/featureStyleLoaders.ts），缩短空 Home 冷启 style 解析。
import "./styles/prompts.css";
import "./styles/note-cards.css";
import "./styles/tabbar.css";
import "./styles/compact-base.css";
import "./styles/compact-phone.css";
import "./styles/compact-tablet.css";
import "./styles/panel-lock.css";
// CRITICAL: ConversationInspectorSplit (every workspace chat column) depends on
// .subagent-chat-split layout rules. Deferring this collapses the main chat area
// to a 1-char-wide strip (vertical "输入" placeholder) — do not move to loaders.
import "./styles/subagent-ui.css";
import "./styles/pi-session.css";
// 统一滚动条兜底清单（须最后加载，覆盖未登记的滚动容器）
import "./styles/scrollbars.css";
// Wallpaper translucency must win over later shell / messages / composer fills.
import "./styles/workspace-wallpaper.css";
