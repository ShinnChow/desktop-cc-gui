use super::*;

pub fn get_qoder_home_dir() -> Option<PathBuf> {
    crate::engine::qoder_provider_profile::resolve_qoder_home_dir(None)
}

/// Parse `qodercli status -o json`; returns Some(logged_in) when the probe ran.
pub(crate) fn parse_qoder_status_json(stdout: &str) -> Option<bool> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    value.get("logged_in")?.as_bool()
}

pub(crate) async fn probe_qoder_logged_in(
    distribution: crate::engine::qoder_provider_profile::QoderDistribution,
    bin: &str,
    path_env: Option<&String>,
    home_dir: Option<&Path>,
) -> Option<bool> {
    let mut command = crate::backend::app_server::build_command_for_binary(bin);
    if let Some(home_dir) = home_dir {
        command.env(distribution.config_dir_env_var(), home_dir);
        command.arg("--config-dir").arg(home_dir);
    }
    command.args(["status", "-o", "json"]);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::null());
    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    crate::engine::qoder_auth::apply_qoder_pat_env_for_distribution(&mut command, distribution);
    let output = tokio::time::timeout(std::time::Duration::from_secs(10), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_qoder_status_json(&String::from_utf8_lossy(&output.stdout))
}

/// Fetch the live ACP model catalog (models.availableModels + reasoning
/// options) via a throwaway `qodercli --acp` handshake. Never blocks engine
/// detection: any failure degrades to an empty catalog with a diagnostic.
pub(crate) async fn get_qoder_models(
    distribution: crate::engine::qoder_provider_profile::QoderDistribution,
    custom_bin: Option<&str>,
    home_dir: Option<&str>,
) -> (Vec<ModelInfo>, Option<String>) {
    let cwd = std::env::temp_dir();
    let cwd_string = cwd.to_string_lossy().to_string();
    let result = crate::engine::qoder::run_qoder_acp_initialized_for_distribution(
        distribution,
        custom_bin,
        &cwd,
        home_dir,
        std::time::Duration::from_secs(20),
        |acp| -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<ModelInfo>, String>> + Send + '_>,
        > {
            let cwd_string = cwd_string.clone();
            Box::pin(async move {
                let session = acp
                    .request(
                        "session/new",
                        serde_json::json!({
                            "cwd": cwd_string,
                            "mcpServers": [],
                        }),
                        QODER_MODEL_PROBE_TIMEOUT,
                    )
                    .await?;
                Ok(crate::engine::qoder::parse_qoder_models_from_session_new(
                    &session,
                ))
            })
        },
    )
    .await;
    match result {
        Ok(models) if !models.is_empty() => (models, None),
        Ok(_) => (
            Vec::new(),
            Some("Qoder CLI 未返回可用模型（确认已登录且账号有可用模型）".to_string()),
        ),
        Err(error) => (Vec::new(), Some(format!("Qoder 模型目录探测失败：{error}"))),
    }
}

pub(crate) const QODER_MODEL_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

pub(crate) fn scope_qoder_models_to_distribution(
    distribution: crate::engine::qoder_provider_profile::QoderDistribution,
    models: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    models
        .into_iter()
        .map(|model| model.with_provider_profile_id(distribution.provider_profile_id()))
        .collect()
}

pub async fn detect_qoder_status(custom_bin: Option<&str>) -> EngineStatus {
    detect_qoder_status_with_home(custom_bin, None).await
}

/// phase 2 登录探测（spawn \`status -o json\`，10s 预算）：detect 返回后异步执行，
/// 结果经缓存覆写 + 事件补推（B6/D6）。返回 None 表示探测失败（保持 Unknown）。
pub async fn detect_qoder_login_state_phase_two() -> Option<bool> {
    let bin_path = resolve_bin_path("qodercli", None);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "qodercli".to_string());
    let path_env = build_codex_path_env(None);
    let home_dir = crate::engine::qoder_provider_profile::resolve_qoder_distribution_home_dir(
        crate::engine::qoder_provider_profile::QoderDistribution::Global,
        None,
    );
    probe_qoder_logged_in(
        crate::engine::qoder_provider_profile::QoderDistribution::Global,
        &bin,
        path_env.as_ref(),
        home_dir.as_deref(),
    )
    .await
}

/// 启动检测轻量入口：跳过 ACP models 探测（refactor-engine-detection-pipeline D1）。
pub async fn detect_qoder_status_with_options(
    custom_bin: Option<&str>,
    include_models: bool,
) -> EngineStatus {
    detect_qoder_distribution_status_with_options(
        crate::engine::qoder_provider_profile::QoderDistribution::Global,
        custom_bin,
        None,
        include_models,
    )
    .await
}

pub async fn detect_qoder_status_with_home(
    custom_bin: Option<&str>,
    configured_home_dir: Option<&str>,
) -> EngineStatus {
    detect_qoder_distribution_status(
        crate::engine::qoder_provider_profile::QoderDistribution::Global,
        custom_bin,
        configured_home_dir,
    )
    .await
}

pub async fn detect_qoder_distribution_status(
    distribution: crate::engine::qoder_provider_profile::QoderDistribution,
    custom_bin: Option<&str>,
    configured_home_dir: Option<&str>,
) -> EngineStatus {
    detect_qoder_distribution_status_with_options(
        distribution,
        custom_bin,
        configured_home_dir,
        true,
    )
    .await
}

/// `include_models = false` 为启动检测轻量分支：version + 登录检查即返回，
/// ACP 握手 / `session/new` models 探测留给 `get_engine_models` 按需路径
/// （refactor-engine-detection-pipeline D1）。
pub async fn detect_qoder_distribution_status_with_options(
    distribution: crate::engine::qoder_provider_profile::QoderDistribution,
    custom_bin: Option<&str>,
    configured_home_dir: Option<&str>,
    include_models: bool,
) -> EngineStatus {
    let cli_name = distribution.cli_name();
    let bin_path = resolve_bin_path(cli_name, custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| cli_name.to_string());
    let path_env = build_codex_path_env(custom_bin);
    let (installed, version, error) = probe_cli_version(&bin, cli_name, path_env.as_ref()).await;
    if !installed {
        return not_installed_status(EngineType::Qoder, error);
    }
    let home_dir = crate::engine::qoder_provider_profile::resolve_qoder_distribution_home_dir(
        distribution,
        configured_home_dir.map(Path::new),
    );
    // B6/D6 二段式：phase 1（启动检测，include_models=false）不做 spawn 型登录
    // 探测，auth_state 留 Unknown 由 phase 2 异步补推；完整路径（catalog 语义）
    // 保持既有登录检查。
    let has_pat =
        crate::engine::qoder_auth::qoder_has_pat_credential_for_distribution(distribution);
    let logged_in = if include_models {
        probe_qoder_logged_in(distribution, &bin, path_env.as_ref(), home_dir.as_deref()).await
    } else {
        None
    };
    let qoder_auth_state = match logged_in {
        Some(true) => crate::engine::AuthState::Authenticated,
        Some(false) if !has_pat => crate::engine::AuthState::RequiresLogin,
        _ => crate::engine::AuthState::Unknown,
    };
    if logged_in == Some(false) && !has_pat {
        return EngineStatus {
            engine_type: EngineType::Qoder,
            auth_state: crate::engine::AuthState::RequiresLogin,
            installed: true,
            version,
            bin_path: Some(bin),
            home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
            models: Vec::new(),
            default_model: None,
            features: EngineFeatures::qoder(),
            error: Some(format!("Qoder CLI 未登录：请先运行 {} login", cli_name)),
        };
    }
    let (models, config_diagnostic) = if include_models {
        get_qoder_models(
            distribution,
            Some(&bin),
            home_dir.as_deref().and_then(|p| p.to_str()),
        )
        .await
    } else {
        (Vec::new(), None)
    };
    let models = scope_qoder_models_to_distribution(distribution, models);
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());
    EngineStatus {
        engine_type: EngineType::Qoder,
        auth_state: qoder_auth_state,
        installed: true,
        version,
        bin_path: Some(bin),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::qoder(),
        error: config_diagnostic,
    }
}
