use serde::{Deserialize, Serialize};
use super::email::{
    default_email_inbound_settings, default_email_sender_settings, EmailInboundSettings,
    EmailSenderSettings,
};
use super::workspace::{
    CodexUnifiedExecPolicy, OpenAppTarget, WorkspaceGroup, WorkspaceSessionAttributionMode,
};

fn default_gemini_enabled() -> bool {
    crate::engine_policy::GEMINI_RUNTIME_ENABLED
}

fn default_opencode_enabled() -> bool {
    // Legacy field: OpenCode is always enabled at runtime (see engine::engine_enabled_in_settings);
    // the persisted flag no longer gates anything and defaults to true.
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct AppSettings {
    #[serde(default, rename = "codexBin")]
    pub(crate) codex_bin: Option<String>,
    #[serde(default, rename = "claudeBin")]
    pub(crate) claude_bin: Option<String>,
    #[serde(default, rename = "kimiBin")]
    pub(crate) kimi_bin: Option<String>,
    #[serde(default, rename = "piBin")]
    pub(crate) pi_bin: Option<String>,
    #[serde(default, rename = "dshBin")]
    pub(crate) dsh_bin: Option<String>,
    #[serde(default, rename = "qoderBin")]
    pub(crate) qoder_bin: Option<String>,
    /// Qoder Global configuration directory. `qoderBin` remains the Global
    /// binary for backward compatibility.
    #[serde(default, rename = "qoderConfigDir")]
    pub(crate) qoder_config_dir: Option<String>,
    #[serde(default, rename = "qoderCnBin")]
    pub(crate) qoder_cn_bin: Option<String>,
    #[serde(default, rename = "qoderCnConfigDir")]
    pub(crate) qoder_cn_config_dir: Option<String>,
    #[serde(default, rename = "dshHost")]
    pub(crate) dsh_host: Option<String>,
    #[serde(default, rename = "dshPort")]
    pub(crate) dsh_port: Option<u16>,
    #[serde(default, rename = "dshAutoStart")]
    pub(crate) dsh_auto_start: Option<bool>,
    #[serde(default, rename = "grokBin")]
    pub(crate) grok_bin: Option<String>,
    #[serde(default, rename = "opencodeBin")]
    pub(crate) opencode_bin: Option<String>,
    #[serde(default, rename = "codexArgs")]
    pub(crate) codex_args: Option<String>,
    #[serde(default, rename = "terminalShellPath")]
    pub(crate) terminal_shell_path: Option<String>,
    #[serde(default = "default_gemini_enabled", rename = "geminiEnabled")]
    pub(crate) gemini_enabled: bool,
    #[serde(default = "default_opencode_enabled", rename = "opencodeEnabled")]
    pub(crate) opencode_enabled: bool,
    #[serde(default, rename = "disabledCliEngines")]
    pub(crate) disabled_cli_engines: Vec<String>,
    #[serde(default, rename = "sessionAttributionMode")]
    pub(crate) session_attribution_mode: WorkspaceSessionAttributionMode,
    #[serde(default, rename = "backendMode")]
    pub(crate) backend_mode: BackendMode,
    #[serde(default = "default_remote_backend_host", rename = "remoteBackendHost")]
    pub(crate) remote_backend_host: String,
    #[serde(default, rename = "remoteBackendToken")]
    pub(crate) remote_backend_token: Option<String>,
    #[serde(default = "default_web_service_port", rename = "webServicePort")]
    pub(crate) web_service_port: u16,
    #[serde(default, rename = "webServiceToken")]
    pub(crate) web_service_token: Option<String>,
    #[serde(default, rename = "systemProxyEnabled")]
    pub(crate) system_proxy_enabled: bool,
    #[serde(default, rename = "systemProxyUrl")]
    pub(crate) system_proxy_url: Option<String>,
    #[serde(default = "default_access_mode", rename = "defaultAccessMode")]
    pub(crate) default_access_mode: String,
    #[serde(
        default = "default_composer_model_shortcut",
        rename = "composerModelShortcut"
    )]
    pub(crate) composer_model_shortcut: Option<String>,
    #[serde(
        default = "default_composer_access_shortcut",
        rename = "composerAccessShortcut"
    )]
    pub(crate) composer_access_shortcut: Option<String>,
    #[serde(
        default = "default_composer_reasoning_shortcut",
        rename = "composerReasoningShortcut"
    )]
    pub(crate) composer_reasoning_shortcut: Option<String>,
    #[serde(default = "default_interrupt_shortcut", rename = "interruptShortcut")]
    pub(crate) interrupt_shortcut: Option<String>,
    #[serde(
        default = "default_composer_collaboration_shortcut",
        rename = "composerCollaborationShortcut"
    )]
    pub(crate) composer_collaboration_shortcut: Option<String>,
    #[serde(
        default = "default_open_settings_shortcut",
        rename = "openSettingsShortcut"
    )]
    pub(crate) open_settings_shortcut: Option<String>,
    #[serde(default = "default_new_window_shortcut", rename = "newWindowShortcut")]
    pub(crate) new_window_shortcut: Option<String>,
    #[serde(default = "default_open_chat_shortcut", rename = "openChatShortcut")]
    pub(crate) open_chat_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_open_session_prev_shortcut",
        rename = "cycleOpenSessionPrevShortcut"
    )]
    pub(crate) cycle_open_session_prev_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_open_session_next_shortcut",
        rename = "cycleOpenSessionNextShortcut"
    )]
    pub(crate) cycle_open_session_next_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_left_conversation_sidebar_shortcut",
        rename = "toggleLeftConversationSidebarShortcut"
    )]
    pub(crate) toggle_left_conversation_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_right_conversation_sidebar_shortcut",
        rename = "toggleRightConversationSidebarShortcut"
    )]
    pub(crate) toggle_right_conversation_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_runtime_console_shortcut",
        rename = "toggleRuntimeConsoleShortcut"
    )]
    pub(crate) toggle_runtime_console_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_files_surface_shortcut",
        rename = "toggleFilesSurfaceShortcut"
    )]
    pub(crate) toggle_files_surface_shortcut: Option<String>,
    #[serde(default = "default_save_file_shortcut", rename = "saveFileShortcut")]
    pub(crate) save_file_shortcut: Option<String>,
    #[serde(
        default = "default_find_in_file_shortcut",
        rename = "findInFileShortcut"
    )]
    pub(crate) find_in_file_shortcut: Option<String>,
    #[serde(
        default = "default_expand_selection_shortcut",
        rename = "expandSelectionShortcut"
    )]
    pub(crate) expand_selection_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_git_diff_list_view_shortcut",
        rename = "toggleGitDiffListViewShortcut"
    )]
    pub(crate) toggle_git_diff_list_view_shortcut: Option<String>,
    #[serde(default, rename = "toggleGitGraphShortcut")]
    pub(crate) toggle_git_graph_shortcut: Option<String>,
    #[serde(default, rename = "openNotesShortcut")]
    pub(crate) open_notes_shortcut: Option<String>,
    #[serde(default, rename = "openIntentCanvasShortcut")]
    pub(crate) open_intent_canvas_shortcut: Option<String>,
    #[serde(default, rename = "openRadarShortcut")]
    pub(crate) open_radar_shortcut: Option<String>,
    #[serde(default, rename = "openProjectMapShortcut")]
    pub(crate) open_project_map_shortcut: Option<String>,
    #[serde(default, rename = "openBrowserDockShortcut")]
    pub(crate) open_browser_dock_shortcut: Option<String>,
    #[serde(default, rename = "openFileCompareShortcut")]
    pub(crate) open_file_compare_shortcut: Option<String>,
    #[serde(
        default = "default_increase_ui_scale_shortcut",
        rename = "increaseUiScaleShortcut"
    )]
    pub(crate) increase_ui_scale_shortcut: Option<String>,
    #[serde(
        default = "default_decrease_ui_scale_shortcut",
        rename = "decreaseUiScaleShortcut"
    )]
    pub(crate) decrease_ui_scale_shortcut: Option<String>,
    #[serde(
        default = "default_reset_ui_scale_shortcut",
        rename = "resetUiScaleShortcut"
    )]
    pub(crate) reset_ui_scale_shortcut: Option<String>,
    #[serde(default = "default_new_agent_shortcut", rename = "newAgentShortcut")]
    pub(crate) new_agent_shortcut: Option<String>,
    #[serde(
        default = "default_new_worktree_agent_shortcut",
        rename = "newWorktreeAgentShortcut"
    )]
    pub(crate) new_worktree_agent_shortcut: Option<String>,
    #[serde(
        default = "default_new_clone_agent_shortcut",
        rename = "newCloneAgentShortcut"
    )]
    pub(crate) new_clone_agent_shortcut: Option<String>,
    #[serde(
        default = "default_archive_thread_shortcut",
        rename = "archiveThreadShortcut"
    )]
    pub(crate) archive_thread_shortcut: Option<String>,
    #[serde(
        default = "default_close_current_session_shortcut",
        rename = "closeCurrentSessionShortcut"
    )]
    pub(crate) close_current_session_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_projects_sidebar_shortcut",
        rename = "toggleProjectsSidebarShortcut"
    )]
    pub(crate) toggle_projects_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_git_sidebar_shortcut",
        rename = "toggleGitSidebarShortcut"
    )]
    pub(crate) toggle_git_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_global_search_shortcut",
        rename = "toggleGlobalSearchShortcut"
    )]
    pub(crate) toggle_global_search_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_debug_panel_shortcut",
        rename = "toggleDebugPanelShortcut"
    )]
    pub(crate) toggle_debug_panel_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_terminal_shortcut",
        rename = "toggleTerminalShortcut"
    )]
    pub(crate) toggle_terminal_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_agent_next_shortcut",
        rename = "cycleAgentNextShortcut"
    )]
    pub(crate) cycle_agent_next_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_agent_prev_shortcut",
        rename = "cycleAgentPrevShortcut"
    )]
    pub(crate) cycle_agent_prev_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_workspace_next_shortcut",
        rename = "cycleWorkspaceNextShortcut"
    )]
    pub(crate) cycle_workspace_next_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_workspace_prev_shortcut",
        rename = "cycleWorkspacePrevShortcut"
    )]
    pub(crate) cycle_workspace_prev_shortcut: Option<String>,
    #[serde(default, rename = "lastComposerModelId")]
    pub(crate) last_composer_model_id: Option<String>,
    #[serde(default, rename = "lastComposerReasoningEffort")]
    pub(crate) last_composer_reasoning_effort: Option<String>,
    // Frontend-owned per-engine composer preferences; stored as opaque JSON so
    // new frontend fields survive the save/echo round-trip without backend changes.
    #[serde(default, rename = "lastComposerPrefsByEngine")]
    pub(crate) last_composer_prefs_by_engine: Option<serde_json::Value>,
    #[serde(default = "default_ui_scale", rename = "uiScale")]
    pub(crate) ui_scale: f64,
    #[serde(default = "default_theme", rename = "theme")]
    pub(crate) theme: String,
    /// macOS Dock + in-app logo preference (`default` = shipping product icon).
    #[serde(default = "default_dock_icon_id", rename = "dockIconId")]
    pub(crate) dock_icon_id: String,
    #[serde(
        default = "default_light_theme_preset_id",
        rename = "lightThemePresetId"
    )]
    pub(crate) light_theme_preset_id: String,
    #[serde(default = "default_dark_theme_preset_id", rename = "darkThemePresetId")]
    pub(crate) dark_theme_preset_id: String,
    #[serde(
        default = "default_custom_theme_preset_id",
        rename = "customThemePresetId"
    )]
    pub(crate) custom_theme_preset_id: String,
    #[serde(
        default = "default_custom_skill_directories",
        rename = "customSkillDirectories"
    )]
    pub(crate) custom_skill_directories: Vec<String>,
    #[serde(default = "default_user_msg_color", rename = "userMsgColor")]
    pub(crate) user_msg_color: String,
    #[serde(
        default = "default_usage_show_remaining",
        rename = "usageShowRemaining"
    )]
    pub(crate) usage_show_remaining: bool,
    #[serde(
        default = "default_show_message_anchors",
        rename = "showMessageAnchors"
    )]
    pub(crate) show_message_anchors: bool,
    #[serde(
        default = "default_show_sidebar_provider_labels",
        rename = "showSidebarProviderLabels"
    )]
    pub(crate) show_sidebar_provider_labels: bool,
    #[serde(
        default = "default_visible_thread_root_count",
        rename = "defaultVisibleThreadRootCount"
    )]
    pub(crate) default_visible_thread_root_count: u32,
    #[serde(
        default = "default_performance_compatibility_mode_enabled",
        rename = "performanceCompatibilityModeEnabled"
    )]
    pub(crate) performance_compatibility_mode_enabled: bool,
    #[serde(default = "default_canvas_width_mode", rename = "canvasWidthMode")]
    pub(crate) canvas_width_mode: String,
    #[serde(default = "default_layout_mode", rename = "layoutMode")]
    pub(crate) layout_mode: String,
    #[serde(default = "default_workspace_wallpaper", rename = "workspaceWallpaper")]
    pub(crate) workspace_wallpaper: WorkspaceWallpaperSettings,
    #[serde(default = "default_ui_font_family", rename = "uiFontFamily")]
    pub(crate) ui_font_family: String,
    #[serde(default = "default_code_font_family", rename = "codeFontFamily")]
    pub(crate) code_font_family: String,
    #[serde(default = "default_code_font_size", rename = "codeFontSize")]
    pub(crate) code_font_size: u8,
    #[serde(
        default = "default_notification_sounds_enabled",
        rename = "notificationSoundsEnabled"
    )]
    pub(crate) notification_sounds_enabled: bool,
    #[serde(
        default = "default_notification_sound_id",
        rename = "notificationSoundId"
    )]
    pub(crate) notification_sound_id: String,
    #[serde(
        default = "default_notification_sound_custom_path",
        rename = "notificationSoundCustomPath"
    )]
    pub(crate) notification_sound_custom_path: String,
    #[serde(
        default = "default_system_notification_enabled",
        rename = "systemNotificationEnabled"
    )]
    pub(crate) system_notification_enabled: bool,
    #[serde(default = "default_email_sender_settings", rename = "emailSender")]
    pub(crate) email_sender: EmailSenderSettings,
    #[serde(default = "default_email_inbound_settings", rename = "emailInbound")]
    pub(crate) email_inbound: EmailInboundSettings,
    #[serde(default = "default_preload_git_diffs", rename = "preloadGitDiffs")]
    pub(crate) preload_git_diffs: bool,
    #[serde(
        default = "default_detached_external_change_awareness_enabled",
        rename = "detachedExternalChangeAwarenessEnabled"
    )]
    pub(crate) detached_external_change_awareness_enabled: bool,
    #[serde(
        default = "default_detached_external_change_watcher_enabled",
        rename = "detachedExternalChangeWatcherEnabled"
    )]
    pub(crate) detached_external_change_watcher_enabled: bool,
    #[serde(
        default = "default_experimental_collab_enabled",
        rename = "experimentalCollabEnabled"
    )]
    pub(crate) experimental_collab_enabled: bool,
    #[serde(
        default = "default_experimental_collaboration_modes_enabled",
        rename = "experimentalCollaborationModesEnabled"
    )]
    pub(crate) experimental_collaboration_modes_enabled: bool,
    #[serde(
        default = "default_codex_mode_enforcement_enabled",
        rename = "codexModeEnforcementEnabled"
    )]
    pub(crate) codex_mode_enforcement_enabled: bool,
    #[serde(
        default = "default_experimental_steer_enabled",
        rename = "experimentalSteerEnabled"
    )]
    pub(crate) experimental_steer_enabled: bool,
    #[serde(default, rename = "codexUnifiedExecPolicy")]
    pub(crate) codex_unified_exec_policy: CodexUnifiedExecPolicy,
    #[serde(default, rename = "experimentalUnifiedExecEnabled", skip_serializing)]
    pub(crate) experimental_unified_exec_enabled: Option<bool>,
    #[serde(
        default = "default_chat_canvas_use_normalized_realtime",
        rename = "chatCanvasUseNormalizedRealtime"
    )]
    pub(crate) chat_canvas_use_normalized_realtime: bool,
    #[serde(
        default = "default_chat_canvas_use_unified_history_loader",
        rename = "chatCanvasUseUnifiedHistoryLoader"
    )]
    pub(crate) chat_canvas_use_unified_history_loader: bool,
    #[serde(
        default = "default_chat_canvas_use_presentation_profile",
        rename = "chatCanvasUsePresentationProfile"
    )]
    pub(crate) chat_canvas_use_presentation_profile: bool,
    #[serde(
        default = "default_composer_editor_preset",
        rename = "composerEditorPreset"
    )]
    pub(crate) composer_editor_preset: String,
    #[serde(
        default = "default_composer_send_shortcut",
        rename = "composerSendShortcut"
    )]
    pub(crate) composer_send_shortcut: String,
    #[serde(
        default = "default_composer_fence_expand_on_space",
        rename = "composerFenceExpandOnSpace"
    )]
    pub(crate) composer_fence_expand_on_space: bool,
    #[serde(
        default = "default_composer_fence_expand_on_enter",
        rename = "composerFenceExpandOnEnter"
    )]
    pub(crate) composer_fence_expand_on_enter: bool,
    #[serde(
        default = "default_composer_fence_language_tags",
        rename = "composerFenceLanguageTags"
    )]
    pub(crate) composer_fence_language_tags: bool,
    #[serde(
        default = "default_composer_fence_wrap_selection",
        rename = "composerFenceWrapSelection"
    )]
    pub(crate) composer_fence_wrap_selection: bool,
    #[serde(
        default = "default_composer_fence_auto_wrap_paste_multiline",
        rename = "composerFenceAutoWrapPasteMultiline"
    )]
    pub(crate) composer_fence_auto_wrap_paste_multiline: bool,
    #[serde(
        default = "default_composer_fence_auto_wrap_paste_code_like",
        rename = "composerFenceAutoWrapPasteCodeLike"
    )]
    pub(crate) composer_fence_auto_wrap_paste_code_like: bool,
    #[serde(
        default = "default_composer_list_continuation",
        rename = "composerListContinuation"
    )]
    pub(crate) composer_list_continuation: bool,
    #[serde(
        default = "default_composer_code_block_copy_use_modifier",
        rename = "composerCodeBlockCopyUseModifier"
    )]
    pub(crate) composer_code_block_copy_use_modifier: bool,
    #[serde(default = "default_workspace_groups", rename = "workspaceGroups")]
    pub(crate) workspace_groups: Vec<WorkspaceGroup>,
    #[serde(default = "default_open_app_targets", rename = "openAppTargets")]
    pub(crate) open_app_targets: Vec<OpenAppTarget>,
    #[serde(default = "default_selected_open_app_id", rename = "selectedOpenAppId")]
    pub(crate) selected_open_app_id: String,
    #[serde(
        default = "default_runtime_restore_threads_only_on_launch",
        rename = "runtimeRestoreThreadsOnlyOnLaunch"
    )]
    pub(crate) runtime_restore_threads_only_on_launch: bool,
    #[serde(
        default = "default_runtime_force_cleanup_on_exit",
        rename = "runtimeForceCleanupOnExit"
    )]
    pub(crate) runtime_force_cleanup_on_exit: bool,
    #[serde(
        default = "default_runtime_orphan_sweep_on_launch",
        rename = "runtimeOrphanSweepOnLaunch"
    )]
    pub(crate) runtime_orphan_sweep_on_launch: bool,
    #[serde(
        default = "default_codex_max_hot_runtimes",
        rename = "codexMaxHotRuntimes"
    )]
    pub(crate) codex_max_hot_runtimes: u8,
    #[serde(
        default = "default_codex_max_warm_runtimes",
        rename = "codexMaxWarmRuntimes"
    )]
    pub(crate) codex_max_warm_runtimes: u8,
    #[serde(
        default = "default_codex_warm_ttl_seconds",
        rename = "codexWarmTtlSeconds"
    )]
    pub(crate) codex_warm_ttl_seconds: u16,
    #[serde(
        default = "default_codex_auto_compaction_threshold_percent",
        rename = "codexAutoCompactionThresholdPercent"
    )]
    pub(crate) codex_auto_compaction_threshold_percent: u16,
    #[serde(
        default = "default_codex_auto_compaction_enabled",
        rename = "codexAutoCompactionEnabled"
    )]
    pub(crate) codex_auto_compaction_enabled: bool,
    #[serde(
        default = "default_browser_agent_enabled",
        rename = "browserAgentEnabled"
    )]
    pub(crate) browser_agent_enabled: bool,
    #[serde(
        default = "default_browser_agent_prefer_built_in",
        rename = "browserAgentPreferBuiltIn"
    )]
    pub(crate) browser_agent_prefer_built_in: bool,
    #[serde(
        default = "default_browser_agent_allow_external_provider_fallback",
        rename = "browserAgentAllowExternalProviderFallback"
    )]
    pub(crate) browser_agent_allow_external_provider_fallback: bool,
    /// Default engine type: "claude", "codex", or "opencode". If not set, auto-detect.
    #[serde(default, rename = "defaultEngine")]
    pub(crate) default_engine: Option<String>,
    /// Curated skill ids the user has enabled. Shared across workspaces and
    /// sessions. Toggling these participates in Codex restart detection because
    /// long-lived app-server runtimes cache generated instruction transport state.
    #[serde(
        default = "default_enabled_curated_skill_ids",
        rename = "enabledCuratedSkillIds"
    )]
    pub(crate) enabled_curated_skill_ids: Vec<String>,
    /// One-shot version marker for newly introduced default curated skills.
    /// Legacy settings omit this field and deserialize as 0.
    #[serde(default, rename = "curatedSkillDefaultsVersion")]
    pub(crate) curated_skill_defaults_version: u8,
    /// Built-in Agent Catalog ids the user explicitly enabled for discovery in
    /// the Composer `#` picker. Enablement never injects a prompt by itself.
    #[serde(
        default = "default_enabled_builtin_agent_ids",
        rename = "enabledBuiltInAgentIds"
    )]
    pub(crate) enabled_builtin_agent_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub(crate) enum BackendMode {
    #[default]
    Local,
    Remote,
}

fn default_access_mode() -> String {
    "full-access".to_string()
}

fn default_remote_backend_host() -> String {
    "127.0.0.1:4732".to_string()
}

fn default_web_service_port() -> u16 {
    3080
}

fn default_ui_scale() -> f64 {
    1.0
}

fn default_dock_icon_id() -> String {
    "default".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_light_theme_preset_id() -> String {
    "vscode-light-modern".to_string()
}

fn default_dark_theme_preset_id() -> String {
    "vscode-dark-modern".to_string()
}

fn default_custom_theme_preset_id() -> String {
    "vscode-dark-modern".to_string()
}

fn default_custom_skill_directories() -> Vec<String> {
    Vec::new()
}

fn default_user_msg_color() -> String {
    String::new()
}

fn default_usage_show_remaining() -> bool {
    false
}

fn default_show_message_anchors() -> bool {
    true
}

fn default_show_sidebar_provider_labels() -> bool {
    false
}

fn default_visible_thread_root_count() -> u32 {
    5
}

fn default_performance_compatibility_mode_enabled() -> bool {
    false
}

fn default_canvas_width_mode() -> String {
    "narrow".to_string()
}

fn default_layout_mode() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWallpaperLibraryItem {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) source_path: Option<String>,
    #[serde(default)]
    pub(crate) hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWallpaperSettings {
    #[serde(default = "default_workspace_wallpaper_mode")]
    pub(crate) mode: String,
    #[serde(default)]
    pub(crate) custom_image_path: Option<String>,
    #[serde(default = "default_workspace_wallpaper_fluid_preset")]
    pub(crate) fluid_preset: String,
    #[serde(default = "default_workspace_wallpaper_fluid_motion")]
    pub(crate) fluid_motion: String,
    #[serde(default = "default_workspace_wallpaper_veil_opacity")]
    pub(crate) veil_opacity: u8,
    #[serde(default)]
    pub(crate) library: Vec<WorkspaceWallpaperLibraryItem>,
    #[serde(default)]
    pub(crate) selected_library_id: Option<String>,
    #[serde(default = "default_workspace_wallpaper_blur")]
    pub(crate) wallpaper_blur: u8,
    #[serde(default = "default_workspace_wallpaper_darken")]
    pub(crate) wallpaper_darken: u8,
    #[serde(default = "default_workspace_wallpaper_playback_rate")]
    pub(crate) playback_rate: f32,
    #[serde(default)]
    pub(crate) flip: bool,
    #[serde(default = "default_workspace_wallpaper_object_fit")]
    pub(crate) object_fit: String,
    #[serde(default)]
    pub(crate) paused: bool,
    #[serde(default)]
    pub(crate) rotation_enabled: bool,
    #[serde(default = "default_workspace_wallpaper_rotation_interval")]
    pub(crate) rotation_interval_minutes: u16,
}

fn default_workspace_wallpaper_mode() -> String {
    "none".to_string()
}

fn default_workspace_wallpaper_fluid_preset() -> String {
    "mist".to_string()
}

fn default_workspace_wallpaper_fluid_motion() -> String {
    "drift".to_string()
}

fn default_workspace_wallpaper_veil_opacity() -> u8 {
    0
}

fn default_workspace_wallpaper_blur() -> u8 {
    0
}

fn default_workspace_wallpaper_darken() -> u8 {
    0
}

fn default_workspace_wallpaper_playback_rate() -> f32 {
    1.0
}

fn default_workspace_wallpaper_object_fit() -> String {
    "cover".to_string()
}

fn default_workspace_wallpaper_rotation_interval() -> u16 {
    30
}

fn default_workspace_wallpaper() -> WorkspaceWallpaperSettings {
    WorkspaceWallpaperSettings {
        mode: default_workspace_wallpaper_mode(),
        custom_image_path: None,
        fluid_preset: default_workspace_wallpaper_fluid_preset(),
        fluid_motion: default_workspace_wallpaper_fluid_motion(),
        veil_opacity: default_workspace_wallpaper_veil_opacity(),
        library: Vec::new(),
        selected_library_id: None,
        wallpaper_blur: default_workspace_wallpaper_blur(),
        wallpaper_darken: default_workspace_wallpaper_darken(),
        playback_rate: default_workspace_wallpaper_playback_rate(),
        flip: false,
        object_fit: default_workspace_wallpaper_object_fit(),
        paused: false,
        rotation_enabled: false,
        rotation_interval_minutes: default_workspace_wallpaper_rotation_interval(),
    }
}

fn default_ui_font_family() -> String {
    "Monaco, \"SF Pro Text\", \"SF Pro Display\", -apple-system, \"Helvetica Neue\", sans-serif"
        .to_string()
}

fn default_code_font_family() -> String {
    "Monaco, \"SF Mono\", \"SFMono-Regular\", Menlo, monospace".to_string()
}

fn default_code_font_size() -> u8 {
    11
}

fn default_composer_model_shortcut() -> Option<String> {
    Some("cmd+shift+m".to_string())
}

fn default_composer_access_shortcut() -> Option<String> {
    Some("cmd+shift+a".to_string())
}

fn default_composer_reasoning_shortcut() -> Option<String> {
    Some("cmd+shift+r".to_string())
}

fn default_interrupt_shortcut() -> Option<String> {
    let value = if cfg!(target_os = "macos") {
        "ctrl+c"
    } else {
        "ctrl+shift+c"
    };
    Some(value.to_string())
}

fn default_composer_collaboration_shortcut() -> Option<String> {
    Some("shift+tab".to_string())
}

fn default_open_settings_shortcut() -> Option<String> {
    Some("cmd+,".to_string())
}

fn default_new_window_shortcut() -> Option<String> {
    Some("cmd+shift+n".to_string())
}

fn default_open_chat_shortcut() -> Option<String> {
    Some("cmd+j".to_string())
}

fn default_cycle_open_session_prev_shortcut() -> Option<String> {
    Some("cmd+shift+[".to_string())
}

fn default_cycle_open_session_next_shortcut() -> Option<String> {
    Some("cmd+shift+]".to_string())
}

fn default_toggle_left_conversation_sidebar_shortcut() -> Option<String> {
    Some("cmd+alt+[".to_string())
}

fn default_toggle_right_conversation_sidebar_shortcut() -> Option<String> {
    Some("cmd+alt+]".to_string())
}

fn default_toggle_runtime_console_shortcut() -> Option<String> {
    Some("cmd+shift+`".to_string())
}

fn default_toggle_files_surface_shortcut() -> Option<String> {
    Some("cmd+shift+e".to_string())
}

fn default_save_file_shortcut() -> Option<String> {
    Some("cmd+s".to_string())
}

fn default_find_in_file_shortcut() -> Option<String> {
    Some("cmd+f".to_string())
}

fn default_expand_selection_shortcut() -> Option<String> {
    Some("cmd+w".to_string())
}

fn default_toggle_git_diff_list_view_shortcut() -> Option<String> {
    Some("alt+shift+v".to_string())
}

fn default_increase_ui_scale_shortcut() -> Option<String> {
    Some("cmd+=".to_string())
}

fn default_decrease_ui_scale_shortcut() -> Option<String> {
    Some("cmd+-".to_string())
}

fn default_reset_ui_scale_shortcut() -> Option<String> {
    Some("cmd+0".to_string())
}

fn default_new_agent_shortcut() -> Option<String> {
    Some("cmd+n".to_string())
}

fn default_new_worktree_agent_shortcut() -> Option<String> {
    Some("cmd+shift+n".to_string())
}

fn default_new_clone_agent_shortcut() -> Option<String> {
    Some("cmd+alt+n".to_string())
}

fn default_archive_thread_shortcut() -> Option<String> {
    Some("cmd+ctrl+a".to_string())
}

fn default_close_current_session_shortcut() -> Option<String> {
    Some("cmd+w".to_string())
}

fn default_toggle_projects_sidebar_shortcut() -> Option<String> {
    Some("cmd+shift+p".to_string())
}

fn default_toggle_git_sidebar_shortcut() -> Option<String> {
    Some("cmd+shift+g".to_string())
}

fn default_toggle_global_search_shortcut() -> Option<String> {
    Some("cmd+o".to_string())
}

fn default_toggle_debug_panel_shortcut() -> Option<String> {
    Some("cmd+shift+d".to_string())
}

fn default_toggle_terminal_shortcut() -> Option<String> {
    Some("cmd+shift+t".to_string())
}

fn default_cycle_agent_next_shortcut() -> Option<String> {
    Some("cmd+ctrl+down".to_string())
}

fn default_cycle_agent_prev_shortcut() -> Option<String> {
    Some("cmd+ctrl+up".to_string())
}

fn default_cycle_workspace_next_shortcut() -> Option<String> {
    Some("cmd+shift+down".to_string())
}

fn default_cycle_workspace_prev_shortcut() -> Option<String> {
    Some("cmd+shift+up".to_string())
}

fn default_notification_sounds_enabled() -> bool {
    true
}

fn default_notification_sound_id() -> String {
    "default".to_string()
}

fn default_notification_sound_custom_path() -> String {
    String::new()
}

fn default_detached_external_change_awareness_enabled() -> bool {
    true
}

fn default_detached_external_change_watcher_enabled() -> bool {
    true
}

fn default_system_notification_enabled() -> bool {
    true
}

fn default_preload_git_diffs() -> bool {
    true
}

fn default_experimental_collab_enabled() -> bool {
    false
}

fn default_experimental_collaboration_modes_enabled() -> bool {
    false
}

fn default_codex_mode_enforcement_enabled() -> bool {
    true
}

fn default_experimental_steer_enabled() -> bool {
    false
}

fn default_chat_canvas_use_normalized_realtime() -> bool {
    false
}

fn default_chat_canvas_use_unified_history_loader() -> bool {
    false
}

fn default_chat_canvas_use_presentation_profile() -> bool {
    false
}

fn default_composer_editor_preset() -> String {
    "default".to_string()
}

fn default_composer_send_shortcut() -> String {
    "enter".to_string()
}

fn default_composer_fence_expand_on_space() -> bool {
    false
}

fn default_composer_fence_expand_on_enter() -> bool {
    false
}

fn default_composer_fence_language_tags() -> bool {
    false
}

fn default_composer_fence_wrap_selection() -> bool {
    false
}

fn default_composer_fence_auto_wrap_paste_multiline() -> bool {
    false
}

fn default_composer_fence_auto_wrap_paste_code_like() -> bool {
    false
}

fn default_composer_list_continuation() -> bool {
    false
}

fn default_composer_code_block_copy_use_modifier() -> bool {
    false
}

fn default_workspace_groups() -> Vec<WorkspaceGroup> {
    Vec::new()
}

fn default_open_app_targets() -> Vec<OpenAppTarget> {
    vec![
        OpenAppTarget {
            id: "vscode".to_string(),
            label: "VS Code".to_string(),
            kind: "app".to_string(),
            app_name: Some("Visual Studio Code".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "cursor".to_string(),
            label: "Cursor".to_string(),
            kind: "app".to_string(),
            app_name: Some("Cursor".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "zed".to_string(),
            label: "Zed".to_string(),
            kind: "app".to_string(),
            app_name: Some("Zed".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "ghostty".to_string(),
            label: "Ghostty".to_string(),
            kind: "app".to_string(),
            app_name: Some("Ghostty".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "antigravity".to_string(),
            label: "Antigravity".to_string(),
            kind: "app".to_string(),
            app_name: Some("Antigravity".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "finder".to_string(),
            label: "Finder".to_string(),
            kind: "finder".to_string(),
            app_name: None,
            command: None,
            args: Vec::new(),
        },
    ]
}

fn default_selected_open_app_id() -> String {
    "vscode".to_string()
}

fn default_runtime_restore_threads_only_on_launch() -> bool {
    true
}

fn default_runtime_force_cleanup_on_exit() -> bool {
    true
}

fn default_runtime_orphan_sweep_on_launch() -> bool {
    true
}

fn default_codex_max_hot_runtimes() -> u8 {
    1
}

fn default_codex_max_warm_runtimes() -> u8 {
    2
}

fn default_codex_warm_ttl_seconds() -> u16 {
    7200
}

fn default_codex_auto_compaction_threshold_percent() -> u16 {
    92
}

fn default_codex_auto_compaction_enabled() -> bool {
    true
}

fn default_browser_agent_enabled() -> bool {
    true
}

fn default_browser_agent_prefer_built_in() -> bool {
    true
}

fn default_browser_agent_allow_external_provider_fallback() -> bool {
    true
}

pub(crate) fn default_enabled_curated_skill_ids() -> Vec<String> {
    vec!["lazy-senior-dev".to_string(), "caveman".to_string()]
}

const CURRENT_CURATED_SKILL_DEFAULTS_VERSION: u8 = 1;

fn default_curated_skill_defaults_version() -> u8 {
    CURRENT_CURATED_SKILL_DEFAULTS_VERSION
}

pub(crate) fn default_enabled_builtin_agent_ids() -> Vec<String> {
    Vec::new()
}

fn is_allowed_codex_auto_compaction_threshold_percent(value: u16) -> bool {
    value == 92 || ((100..=200).contains(&value) && value.is_multiple_of(10))
}

impl AppSettings {
    pub(crate) fn normalize_unified_exec_policy(&mut self) {
        self.codex_unified_exec_policy = CodexUnifiedExecPolicy::Inherit;
        self.experimental_unified_exec_enabled = None;
    }

    pub(crate) fn codex_unified_exec_override(&self) -> Option<bool> {
        self.codex_unified_exec_policy.explicit_value()
    }

    pub(crate) fn sanitize_runtime_pool_settings(&mut self) {
        self.codex_max_hot_runtimes = self.codex_max_hot_runtimes.clamp(0, 8);
        self.codex_max_warm_runtimes = self.codex_max_warm_runtimes.clamp(0, 16);
        self.codex_warm_ttl_seconds = self.codex_warm_ttl_seconds.clamp(15, 14400);
        self.default_visible_thread_root_count =
            self.default_visible_thread_root_count.clamp(1, 20);
        if !is_allowed_codex_auto_compaction_threshold_percent(
            self.codex_auto_compaction_threshold_percent,
        ) {
            self.codex_auto_compaction_threshold_percent =
                default_codex_auto_compaction_threshold_percent();
        }
    }

    pub(crate) fn upgrade_runtime_pool_settings_for_startup(&mut self) {
        self.sanitize_runtime_pool_settings();
        self.codex_warm_ttl_seconds = self
            .codex_warm_ttl_seconds
            .max(default_codex_warm_ttl_seconds());
    }

    pub(crate) fn upgrade_curated_skill_defaults_for_startup(&mut self) {
        if self.curated_skill_defaults_version >= CURRENT_CURATED_SKILL_DEFAULTS_VERSION {
            return;
        }
        if !self.enabled_curated_skill_ids.is_empty()
            && !self
                .enabled_curated_skill_ids
                .iter()
                .any(|id| id == "caveman")
        {
            self.enabled_curated_skill_ids.push("caveman".to_string());
        }
        self.curated_skill_defaults_version = CURRENT_CURATED_SKILL_DEFAULTS_VERSION;
    }

    pub(crate) fn sanitize_engine_gates(&mut self) {
        self.gemini_enabled = crate::engine_policy::GEMINI_RUNTIME_ENABLED;
        if self
            .default_engine
            .as_deref()
            .is_some_and(|engine| engine.trim().eq_ignore_ascii_case("gemini"))
        {
            self.default_engine = None;
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_bin: None,
            claude_bin: None,
            kimi_bin: None,
            pi_bin: None,
            dsh_bin: None,
            qoder_bin: None,
            qoder_config_dir: None,
            qoder_cn_bin: None,
            qoder_cn_config_dir: None,
            dsh_host: None,
            dsh_port: None,
            dsh_auto_start: None,
            grok_bin: None,
            opencode_bin: None,
            codex_args: None,
            terminal_shell_path: None,
            gemini_enabled: default_gemini_enabled(),
            opencode_enabled: default_opencode_enabled(),
            disabled_cli_engines: Vec::new(),
            session_attribution_mode: WorkspaceSessionAttributionMode::Related,
            backend_mode: BackendMode::Local,
            remote_backend_host: default_remote_backend_host(),
            remote_backend_token: None,
            web_service_port: default_web_service_port(),
            web_service_token: None,
            system_proxy_enabled: false,
            system_proxy_url: None,
            default_engine: None,
            default_access_mode: "full-access".to_string(),
            composer_model_shortcut: default_composer_model_shortcut(),
            composer_access_shortcut: default_composer_access_shortcut(),
            composer_reasoning_shortcut: default_composer_reasoning_shortcut(),
            interrupt_shortcut: default_interrupt_shortcut(),
            composer_collaboration_shortcut: default_composer_collaboration_shortcut(),
            open_settings_shortcut: default_open_settings_shortcut(),
            new_window_shortcut: default_new_window_shortcut(),
            open_chat_shortcut: default_open_chat_shortcut(),
            cycle_open_session_prev_shortcut: default_cycle_open_session_prev_shortcut(),
            cycle_open_session_next_shortcut: default_cycle_open_session_next_shortcut(),
            toggle_left_conversation_sidebar_shortcut:
                default_toggle_left_conversation_sidebar_shortcut(),
            toggle_right_conversation_sidebar_shortcut:
                default_toggle_right_conversation_sidebar_shortcut(),
            toggle_runtime_console_shortcut: default_toggle_runtime_console_shortcut(),
            toggle_files_surface_shortcut: default_toggle_files_surface_shortcut(),
            save_file_shortcut: default_save_file_shortcut(),
            find_in_file_shortcut: default_find_in_file_shortcut(),
            expand_selection_shortcut: default_expand_selection_shortcut(),
            toggle_git_diff_list_view_shortcut: default_toggle_git_diff_list_view_shortcut(),
            toggle_git_graph_shortcut: None,
            open_notes_shortcut: None,
            open_intent_canvas_shortcut: None,
            open_radar_shortcut: None,
            open_project_map_shortcut: None,
            open_browser_dock_shortcut: None,
            open_file_compare_shortcut: None,
            increase_ui_scale_shortcut: default_increase_ui_scale_shortcut(),
            decrease_ui_scale_shortcut: default_decrease_ui_scale_shortcut(),
            reset_ui_scale_shortcut: default_reset_ui_scale_shortcut(),
            new_agent_shortcut: default_new_agent_shortcut(),
            new_worktree_agent_shortcut: default_new_worktree_agent_shortcut(),
            new_clone_agent_shortcut: default_new_clone_agent_shortcut(),
            archive_thread_shortcut: default_archive_thread_shortcut(),
            close_current_session_shortcut: default_close_current_session_shortcut(),
            toggle_projects_sidebar_shortcut: default_toggle_projects_sidebar_shortcut(),
            toggle_git_sidebar_shortcut: default_toggle_git_sidebar_shortcut(),
            toggle_global_search_shortcut: default_toggle_global_search_shortcut(),
            toggle_debug_panel_shortcut: default_toggle_debug_panel_shortcut(),
            toggle_terminal_shortcut: default_toggle_terminal_shortcut(),
            cycle_agent_next_shortcut: default_cycle_agent_next_shortcut(),
            cycle_agent_prev_shortcut: default_cycle_agent_prev_shortcut(),
            cycle_workspace_next_shortcut: default_cycle_workspace_next_shortcut(),
            cycle_workspace_prev_shortcut: default_cycle_workspace_prev_shortcut(),
            last_composer_model_id: None,
            last_composer_reasoning_effort: None,
            last_composer_prefs_by_engine: None,
            ui_scale: 1.0,
            theme: default_theme(),
            dock_icon_id: default_dock_icon_id(),
            light_theme_preset_id: default_light_theme_preset_id(),
            dark_theme_preset_id: default_dark_theme_preset_id(),
            custom_theme_preset_id: default_custom_theme_preset_id(),
            custom_skill_directories: default_custom_skill_directories(),
            user_msg_color: default_user_msg_color(),
            usage_show_remaining: default_usage_show_remaining(),
            show_message_anchors: default_show_message_anchors(),
            show_sidebar_provider_labels: default_show_sidebar_provider_labels(),
            default_visible_thread_root_count: default_visible_thread_root_count(),
            performance_compatibility_mode_enabled: default_performance_compatibility_mode_enabled(
            ),
            canvas_width_mode: default_canvas_width_mode(),
            layout_mode: default_layout_mode(),
            workspace_wallpaper: default_workspace_wallpaper(),
            ui_font_family: default_ui_font_family(),
            code_font_family: default_code_font_family(),
            code_font_size: default_code_font_size(),
            notification_sounds_enabled: true,
            notification_sound_id: default_notification_sound_id(),
            notification_sound_custom_path: default_notification_sound_custom_path(),
            system_notification_enabled: true,
            email_sender: EmailSenderSettings::default(),
            email_inbound: EmailInboundSettings::default(),
            preload_git_diffs: default_preload_git_diffs(),
            detached_external_change_awareness_enabled:
                default_detached_external_change_awareness_enabled(),
            detached_external_change_watcher_enabled:
                default_detached_external_change_watcher_enabled(),
            experimental_collab_enabled: false,
            experimental_collaboration_modes_enabled: false,
            codex_mode_enforcement_enabled: true,
            experimental_steer_enabled: false,
            codex_unified_exec_policy: CodexUnifiedExecPolicy::Inherit,
            experimental_unified_exec_enabled: None,
            chat_canvas_use_normalized_realtime: false,
            chat_canvas_use_unified_history_loader: false,
            chat_canvas_use_presentation_profile: false,
            composer_editor_preset: default_composer_editor_preset(),
            composer_send_shortcut: default_composer_send_shortcut(),
            composer_fence_expand_on_space: default_composer_fence_expand_on_space(),
            composer_fence_expand_on_enter: default_composer_fence_expand_on_enter(),
            composer_fence_language_tags: default_composer_fence_language_tags(),
            composer_fence_wrap_selection: default_composer_fence_wrap_selection(),
            composer_fence_auto_wrap_paste_multiline:
                default_composer_fence_auto_wrap_paste_multiline(),
            composer_fence_auto_wrap_paste_code_like:
                default_composer_fence_auto_wrap_paste_code_like(),
            composer_list_continuation: default_composer_list_continuation(),
            composer_code_block_copy_use_modifier: default_composer_code_block_copy_use_modifier(),
            workspace_groups: default_workspace_groups(),
            open_app_targets: default_open_app_targets(),
            selected_open_app_id: default_selected_open_app_id(),
            runtime_restore_threads_only_on_launch: default_runtime_restore_threads_only_on_launch(
            ),
            runtime_force_cleanup_on_exit: default_runtime_force_cleanup_on_exit(),
            runtime_orphan_sweep_on_launch: default_runtime_orphan_sweep_on_launch(),
            codex_max_hot_runtimes: default_codex_max_hot_runtimes(),
            codex_max_warm_runtimes: default_codex_max_warm_runtimes(),
            codex_warm_ttl_seconds: default_codex_warm_ttl_seconds(),
            codex_auto_compaction_threshold_percent:
                default_codex_auto_compaction_threshold_percent(),
            codex_auto_compaction_enabled: default_codex_auto_compaction_enabled(),
            browser_agent_enabled: default_browser_agent_enabled(),
            browser_agent_prefer_built_in: default_browser_agent_prefer_built_in(),
            browser_agent_allow_external_provider_fallback:
                default_browser_agent_allow_external_provider_fallback(),
            enabled_curated_skill_ids: default_enabled_curated_skill_ids(),
            curated_skill_defaults_version: default_curated_skill_defaults_version(),
            enabled_builtin_agent_ids: default_enabled_builtin_agent_ids(),
        }
    }
}

