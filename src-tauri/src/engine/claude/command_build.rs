use super::*;

const CLAUDE_PROVIDER_ROUTING_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_REASONING_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_VERTEX",
];

pub(super) struct ClaudeProviderSettingsOverride {
    directory: PathBuf,
    settings_path: PathBuf,
}

impl ClaudeProviderSettingsOverride {
    pub(super) fn create(provider_env: Option<&BTreeMap<String, String>>) -> Result<Option<Self>, String> {
        let Some(provider_env) = provider_env else {
            return Ok(None);
        };
        let directory = std::env::temp_dir().join(format!(
            "ccgui-claude-provider-settings-{}",
            uuid::Uuid::new_v4()
        ));
        let mut directory_builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory_builder.mode(0o700);
        }
        directory_builder.create(&directory).map_err(|error| {
            format!("Failed to create private Claude provider settings directory: {error}")
        })?;

        let settings_path = directory.join("settings.json");
        let write_result = (|| -> Result<(), String> {
            let mut settings_env = provider_env.clone();
            for key in CLAUDE_PROVIDER_ROUTING_ENV_KEYS {
                settings_env
                    .entry((*key).to_string())
                    .or_insert_with(String::new);
            }
            let payload = serde_json::to_vec(&json!({ "env": settings_env })).map_err(|error| {
                format!("Failed to serialize Claude provider settings: {error}")
            })?;
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut settings_file = options.open(&settings_path).map_err(|error| {
                format!("Failed to create private Claude provider settings file: {error}")
            })?;
            settings_file.write_all(&payload).map_err(|error| {
                format!("Failed to write private Claude provider settings file: {error}")
            })?;
            settings_file.sync_all().map_err(|error| {
                format!("Failed to sync private Claude provider settings file: {error}")
            })
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_dir_all(&directory);
            return Err(error);
        }

        Ok(Some(Self {
            directory,
            settings_path,
        }))
    }

    pub(super) fn path(&self) -> &Path {
        &self.settings_path
    }
}

impl Drop for ClaudeProviderSettingsOverride {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.directory) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "[claude] failed to clean private provider settings directory: {}",
                    error
                );
            }
        }
    }
}


impl ClaudeSession {
    pub(super) fn is_invalid_fork_session_id(value: &str) -> bool {
        value.is_empty()
            || value == "."
            || value.starts_with('-')
            || value.contains('/')
            || value.contains('\\')
            || value.contains("..")
            || !value
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    }

    pub(super) fn normalized_fork_session_id(params: &SendMessageParams) -> Result<Option<String>, String> {
        let Some(value) = params.fork_session_id.as_ref() else {
            return Ok(None);
        };
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("forkSessionId is required for Claude fork session".to_string());
        }
        if Self::is_invalid_fork_session_id(trimmed) {
            return Err("invalid forkSessionId for Claude fork session".to_string());
        }
        Ok(Some(trimmed.to_string()))
    }

    pub(super) fn configure_spawn_command(cmd: &mut Command) {
        #[cfg(unix)]
        unsafe {
            cmd.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }

    pub(super) fn should_use_stream_json_input(params: &SendMessageParams) -> bool {
        let has_images = params
            .images
            .as_ref()
            .is_some_and(|imgs| imgs.iter().any(|s| !s.trim().is_empty()));
        if has_images {
            return true;
        }
        // Keep user prompt bytes out of argv. Windows .cmd/.bat wrappers run
        // through cmd.exe, where shell metacharacters can corrupt argv prompts.
        !params.text.trim().is_empty()
    }

    pub(super) fn is_unknown_include_hook_events_error(error_output: &str) -> bool {
        let normalized = error_output.to_ascii_lowercase();
        normalized.contains("include-hook-events")
            && (normalized.contains("unknown")
                || normalized.contains("unrecognized")
                || normalized.contains("unexpected")
                || normalized.contains("invalid option")
                || normalized.contains("not supported"))
    }

    pub(super) fn resolve_cli_binary(&self) -> String {
        if let Some(ref custom) = self.bin_path {
            return custom.clone();
        }
        crate::backend::app_server::find_claude_code_binary(None)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "claude".to_string())
    }

    pub(super) fn should_skip_curated_skill_append_for_binary(bin: &str, is_windows: bool) -> bool {
        let _ = bin;
        is_windows
    }

    pub(super) fn cli_binary_diagnostics(&self) -> (String, &'static str) {
        let bin = self.resolve_cli_binary();
        let wrapper_kind = crate::backend::app_server::wrapper_kind_for_binary(&bin);
        (bin, wrapper_kind)
    }

    /// Build the Claude CLI command
    pub(super) fn build_command(
        &self,
        params: &SendMessageParams,
        use_stream_json_input: bool,
        include_hook_events: bool,
        app_settings: Option<&crate::types::AppSettings>,
        activation_hint_file: Option<&Path>,
    ) -> Command {
        self.build_command_with_provider_env(
            params,
            use_stream_json_input,
            include_hook_events,
            app_settings,
            activation_hint_file,
            None,
            None,
        )
    }

    pub(super) fn build_command_with_provider_env(
        &self,
        params: &SendMessageParams,
        use_stream_json_input: bool,
        include_hook_events: bool,
        app_settings: Option<&crate::types::AppSettings>,
        activation_hint_file: Option<&Path>,
        provider_env: Option<&BTreeMap<String, String>>,
        provider_settings_path: Option<&Path>,
    ) -> Command {
        self.build_command_with_profile(
            params,
            use_stream_json_input,
            include_hook_events,
            app_settings,
            activation_hint_file,
            provider_env,
            provider_settings_path,
            ClaudeCommandProfile::Standard,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_command_with_profile(
        &self,
        params: &SendMessageParams,
        use_stream_json_input: bool,
        include_hook_events: bool,
        app_settings: Option<&crate::types::AppSettings>,
        activation_hint_file: Option<&Path>,
        provider_env: Option<&BTreeMap<String, String>>,
        provider_settings_path: Option<&Path>,
        profile: ClaudeCommandProfile,
    ) -> Command {
        // Resolve the Claude CLI binary path:
        // 1. Use custom bin_path if configured
        // 2. Otherwise use find_cli_binary() to search npm global, cargo, etc.
        // 3. Fall back to bare "claude" as last resort
        let bin = self.resolve_cli_binary();
        let skip_curated_skill_append = profile.is_context_bootstrap()
            || Self::should_skip_curated_skill_append_for_binary(&bin, cfg!(windows));

        // Use build_command_for_binary to properly handle .cmd/.bat files on Windows
        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);

        // Set working directory
        cmd.current_dir(&self.workspace_path);

        // Print mode (non-interactive)
        cmd.arg("-p");

        if profile.is_context_bootstrap() {
            // ponytail: bootstrap 只需一次无工具 ACK。若未来 CLI 移除这些 flags，
            // 在这里升级兼容策略，不污染普通 turn 的 command contract。
            cmd.arg("--safe-mode");
            cmd.arg("--tools");
            cmd.arg("");
            cmd.arg("--disable-slash-commands");
            cmd.arg("--prompt-suggestions");
            cmd.arg("false");
            cmd.arg("--system-prompt");
            cmd.arg(CLAUDE_CONTEXT_BOOTSTRAP_SYSTEM_PROMPT);
        }

        // Append curated skills (if any) via --append-system-prompt. The
        // flag is added immediately after `-p` and **before** any other
        // flag so it does not interfere with subsequent parsing.
        if !skip_curated_skill_append {
            if let Some(settings) = app_settings {
                if let Some(append_body) =
                    curated_skill_prompt::build_curated_skill_append_args(settings)
                {
                    cmd.arg("--append-system-prompt");
                    cmd.arg(append_body);
                }
            }
        }

        if use_stream_json_input {
            // Use stream-json input format for prompt content and images. The
            // actual user message is sent via stdin; adding an empty prompt
            // placeholder after `-p` breaks Windows .cmd wrapper parsing.
            cmd.arg("--input-format");
            cmd.arg("stream-json");
            if params.text.contains("MOSSX_CONTEXT_PACKAGE:") {
                // Change C：只为 Context Package 开 echo，避免改变普通 Claude turn。
                // 旧 CLI 不支持时显式失败，不能降格为首 token ACK。
                cmd.arg("--replay-user-messages");
            }
        } else {
            // Compatibility fallback only. Production sends user prompts through
            // stream-json stdin so shell wrappers never parse prompt text.
            cmd.arg(&params.text);
        }

        // Output format for streaming
        cmd.arg("--output-format");
        cmd.arg("stream-json");

        // Verbose for more events
        cmd.arg("--verbose");

        // Include partial messages for streaming text
        cmd.arg("--include-partial-messages");

        if include_hook_events {
            cmd.arg("--include-hook-events");
        }

        if !profile.is_context_bootstrap() {
            if let Some(path) = activation_hint_file {
                cmd.arg("--append-system-prompt-file");
                cmd.arg(path);
            }
        }
        if let Some(path) = provider_settings_path {
            cmd.arg("--settings");
            cmd.arg(path);
        }

        // Access mode / permission handling
        // Maps UI access modes to Claude Code CLI permission flags
        let is_plan_mode = matches!(params.access_mode.as_deref(), Some("read-only"));
        match params.access_mode.as_deref() {
            Some("full-access") => {
                // Full access: bypass all permission checks
                cmd.arg("--dangerously-skip-permissions");
            }
            Some("read-only") => {
                // Read-only / Plan mode: only allow planning, no execution
                cmd.arg("--permission-mode");
                cmd.arg("plan");
            }
            Some("default") => {
                // Default mode: each tool use requires explicit permission
                cmd.arg("--permission-mode");
                cmd.arg("default");
            }
            _ => {
                // "current" mode: auto-accept edits but still prompt for dangerous ops
                cmd.arg("--permission-mode");
                cmd.arg("acceptEdits");
            }
        }

        // Register the in-process AskUserQuestion MCP server in NON-plan modes.
        // In plan mode the CLI already exposes the native AskUserQuestion tool, so
        // registering ours would double the surface. Outside plan mode the native
        // tool is never offered, so this is what restores mid-turn structured asks.
        //
        // MCP tools are permission-gated, so we must also allow ours explicitly
        // (verified: without this the CLI reports "not granted" and the model
        // can't get the answer). `--dangerously-skip-permissions` (full-access)
        // already covers it, but allowing it is harmless and keeps modes uniform.
        // We intentionally do NOT pass `--strict-mcp-config` so the user's own
        // MCP servers (from ~/.claude.json) keep working — this is purely additive.
        if !is_plan_mode && !profile.is_context_bootstrap() {
            if let Some(server) = crate::engine::claude::askuser_mcp_global() {
                cmd.arg("--mcp-config");
                cmd.arg(server.mcp_config_json(&self.workspace_id, &self.runtime_locator));
                cmd.arg("--allowedTools");
                cmd.arg(crate::engine::claude::AskUserMcpServer::allowed_tool_name());
                // The CLI's per-request MCP tool-call fetch timeout defaults to 60s
                // for remote HTTP servers. Our AskUserQuestion server blocks up to
                // ASK_USER_QUESTION_TIMEOUT_SECS waiting for the user, so without
                // this the CLI abandons the call early. Raise it past the server
                // bound (ms) so scheduling jitter cannot still lose the answer.
                // Only set when our MCP ask is actually wired; the user can still
                // override via env.
                if std::env::var_os("MCP_TOOL_TIMEOUT").is_none() {
                    let timeout_ms = (ASK_USER_QUESTION_TIMEOUT_SECS
                        + ASK_USER_QUESTION_CLI_TIMEOUT_MARGIN_SECS)
                        * 1000;
                    cmd.env("MCP_TOOL_TIMEOUT", timeout_ms.to_string());
                }
            } else {
                log::warn!(
                    "[claude] AskUserQuestion MCP server not started; mid-turn asks unavailable this turn"
                );
            }
        }

        // Model selection
        if let Some(ref model) = params.model {
            cmd.arg("--model");
            cmd.arg(model);
        }

        if let Some(effort) = params
            .effort
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| CLAUDE_REASONING_EFFORTS.contains(value))
        {
            cmd.arg("--effort");
            cmd.arg(effort);
        }

        // Session continuation / explicit session identity.
        // Claude's native fork contract resumes a parent session and asks the
        // CLI to allocate a new child session id.
        match Self::normalized_fork_session_id(params) {
            Ok(Some(fork_session_id)) => {
                cmd.arg("--resume");
                cmd.arg(fork_session_id);
                cmd.arg("--fork-session");
            }
            Ok(None) => {
                if params.continue_session {
                    if let Some(ref session_id) = params.session_id {
                        cmd.arg("--resume");
                        cmd.arg(session_id);
                    } else {
                        cmd.arg("--continue");
                    }
                } else if let Some(ref session_id) = params.session_id {
                    // Force a fresh, stable identity for "new conversation" runs.
                    // This prevents concurrent Claude turns from collapsing into the
                    // same persisted session due CLI implicit reuse behavior.
                    cmd.arg("--session-id");
                    cmd.arg(session_id);
                }
            }
            Err(_) => {}
        }

        if !profile.is_context_bootstrap() {
            if let Some(spec_root) = params
                .custom_spec_root
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                let spec_path = Path::new(spec_root);
                if spec_path.is_absolute() && spec_path != self.workspace_path.as_path() {
                    cmd.arg("--add-dir");
                    cmd.arg(spec_root);
                    // Keep L1 in sync with startup --add-dir so grant UI does not re-prompt.
                    let _ = self.grant_session_directory_root(spec_path);
                }
            }

            // Runtime DirectoryGrant roots (session L1) → Claude CLI --add-dir on each launch.
            for granted_root in self.session_add_dir_args() {
                let granted_path = Path::new(&granted_root);
                if granted_path.is_absolute() && granted_path != self.workspace_path.as_path() {
                    // Avoid duplicating custom_spec_root.
                    let already_spec = params
                        .custom_spec_root
                        .as_ref()
                        .map(|value| value.trim() == granted_root.as_str())
                        .unwrap_or(false);
                    if !already_spec {
                        cmd.arg("--add-dir");
                        cmd.arg(granted_root);
                    }
                }
            }

            // Custom arguments
            if let Some(ref args) = self.custom_args {
                for arg in args.split_whitespace() {
                    cmd.arg(arg);
                }
            }
        }

        // Set up stdio - always pipe stdin so we can write responses
        // for AskUserQuestion tool calls mid-stream
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Environment
        cmd.env(CLAUDE_NON_INTERACTIVE_ENV, "1");
        if let Some(ref home) = self.home_dir {
            cmd.env("CLAUDE_HOME", home);
        }
        if params.disable_thinking {
            cmd.env("CLAUDE_CODE_DISABLE_THINKING", "1");
        }
        // Managed provider：先清掉父进程残留的 routing 键（如 Kimi 时代 ANTHROPIC_MODEL=k3），
        // 再写入当前 profile env，避免第三方 API 收到跨供应商模型名。
        // 无 provider_env 时不清理，保留 local/disk 跟随全局 settings 的既有行为。
        if let Some(provider_env) = provider_env {
            for key in CLAUDE_PROVIDER_ROUTING_ENV_KEYS {
                cmd.env_remove(key);
            }
            cmd.envs(provider_env);
        }

        cmd
    }
}
