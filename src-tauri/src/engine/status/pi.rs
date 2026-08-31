use super::*;

pub async fn detect_pi_status(custom_bin: Option<&str>) -> EngineStatus {
    detect_pi_status_with_options(custom_bin, true).await
}

/// `include_models = false` 为启动检测轻量分支：只回答「装没装 / 版本」，
/// models 目录留给 `get_engine_models` 按需路径（refactor-engine-detection-pipeline D1）。
pub async fn detect_pi_status_with_options(
    custom_bin: Option<&str>,
    include_models: bool,
) -> EngineStatus {
    let bin_path = resolve_bin_path("pi", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "pi".to_string());
    let path_env = build_codex_path_env(custom_bin);
    if !include_models {
        let (installed, version, error) = probe_cli_version(&bin, "pi", path_env.as_ref()).await;
        if !installed {
            return not_installed_status(EngineType::Pi, error);
        }
        // 快照回填已撤销（P0 教训）：EngineStatus.models 会被引擎切换的乐观
        // 选中 / 新会话默认解析当作**可选模型**消费——静态 fallback 条目
        // （auto，default=true）曾把错误模型绑进 PI 会话（dispatch 解析为
        // 「跟随配置默认」→ 跳过对账 → resident 落 broken 默认链）。目录
        // 只能由 get_engine_models 的真实探测权威填充（on-demand 22s 预算）。
        return EngineStatus {
            engine_type: EngineType::Pi,
            auth_state: crate::engine::AuthState::default(),
            installed: true,
            version,
            bin_path: Some(bin.to_string()),
            home_dir: get_pi_home_dir().map(|p| p.to_string_lossy().to_string()),
            models: Vec::new(),
            default_model: None,
            features: EngineFeatures::pi(),
            error: None,
        };
    }
    // version 与 models 探测无数据依赖：并行发起，最坏路径 30s → 20s
    // （max(version 10s, RPC 10s + list-models 10s 回退)），与 FE on-demand
    // timeout 对齐。未安装时 models 探测 spawn 立即失败，结果被丢弃。
    let version_probe = probe_cli_version(&bin, "pi", path_env.as_ref());
    let models_probe = get_pi_models(&bin, path_env.as_ref());
    let ((installed, version, error), (models, config_diagnostic)) =
        tokio::join!(version_probe, models_probe);
    if !installed {
        return not_installed_status(EngineType::Pi, error);
    }
    let home_dir = get_pi_home_dir();
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());
    EngineStatus {
        engine_type: EngineType::Pi,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::pi(),
        error: config_diagnostic,
    }
}

pub(crate) fn get_pi_home_dir() -> Option<PathBuf> {
    if let Ok(agent_dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = agent_dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir().map(|home| home.join(".pi").join("agent"))
}

pub(crate) const PI_STANDARD_THINKING_LEVELS: &[&str] =
    &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/// Port of pi `getSupportedThinkingLevels`.
/// Non-reasoning models return empty so the composer hides the selector.
pub(crate) fn supported_thinking_levels_for_pi_model(
    reasoning: bool,
    thinking_level_map: Option<&Value>,
) -> Vec<String> {
    if !reasoning {
        return Vec::new();
    }
    PI_STANDARD_THINKING_LEVELS
        .iter()
        .copied()
        .filter(|level| {
            let mapped = thinking_level_map.and_then(|map| map.get(*level));
            if mapped.map(Value::is_null).unwrap_or(false) {
                return false;
            }
            if *level == "xhigh" || *level == "max" {
                return mapped.is_some();
            }
            true
        })
        .map(str::to_string)
        .collect()
}

pub(crate) fn pi_model_catalog_id(provider: &str, model_id: &str) -> String {
    if provider.is_empty() {
        model_id.to_string()
    } else {
        format!("{provider}/{model_id}")
    }
}

pub(crate) fn apply_pi_thinking_levels(info: ModelInfo, levels: Vec<String>) -> ModelInfo {
    if levels.is_empty() {
        info
    } else {
        info.with_reasoning(levels, None)
    }
}

/// Parse RPC `get_available_models` `data` into catalog rows.
pub(crate) fn parse_pi_available_models(data: &Value) -> Vec<ModelInfo> {
    let models = data
        .get("models")
        .and_then(Value::as_array)
        .or_else(|| data.as_array())
        .into_iter()
        .flatten();
    let mut parsed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for model in models {
        let provider = model
            .get("provider")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        let model_id = model
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        if model_id.is_empty() {
            continue;
        }
        let id = pi_model_catalog_id(provider, model_id);
        if !seen.insert(id.clone()) {
            continue;
        }
        let name = model
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(model_id);
        let reasoning = model
            .get("reasoning")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let levels =
            supported_thinking_levels_for_pi_model(reasoning, model.get("thinkingLevelMap"));
        let mut details = Vec::new();
        if let Some(ctx) = model.get("contextWindow").and_then(Value::as_u64) {
            details.push(format!("ctx {ctx}"));
        }
        if reasoning {
            details.push("thinking".to_string());
        }
        let images = model
            .get("input")
            .and_then(Value::as_array)
            .map(|input| input.iter().any(|value| value.as_str() == Some("image")))
            .unwrap_or(false);
        if images {
            details.push("vision".to_string());
        }
        let description = if details.is_empty() {
            id.clone()
        } else {
            details.join(" · ")
        };
        let mut info = ModelInfo::new(id.clone(), name.to_string())
            .with_description(description)
            .with_protocol("pi")
            .with_provenance("cli:pi-available-models")
            .with_source("detected");
        if !provider.is_empty() {
            info = info.with_provider(provider.to_string());
        }
        parsed.push(apply_pi_thinking_levels(info, levels));
    }
    if parsed.is_empty() {
        parsed.push(
            ModelInfo::new("auto", "PI Auto")
                .with_description("Use PI CLI default model")
                .with_provider("pi")
                .with_protocol("pi")
                .with_source("fallback")
                .as_default(),
        );
    } else if let Some(first) = parsed.first_mut() {
        first.default = true;
    }
    parsed
}

/// PI catalog RPC 探测 spawn 参数：跳过 extension boot。扩展齐全的 pi 冷启动
/// 实测 ~10s，贴爆/超出预算；跳过后 ~1s 且模型与 thinkingLevelMap 元数据
/// 完全一致。
pub(crate) const PI_CATALOG_PROBE_RPC_ARGS: &str = "--no-session --no-extensions";

/// PI catalog 探测预算：比全局 DETECTION_TIMEOUT(10s) 放宽到 15s 兜底。
/// 跳过 extension boot 后常态 ~1s，15s 纯属慢机/冷 FS 缓存的余量；只圈
/// catalog 探测（RPC 请求 + `--list-models`），version 探测与其他引擎不动。
pub(crate) const PI_CATALOG_PROBE_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) async fn fetch_pi_models_via_rpc(
    bin: &str,
    home_dir: Option<&str>,
) -> Result<Vec<ModelInfo>, String> {
    let cwd = std::env::temp_dir();
    let client = PiRpcClient::spawn(
        bin,
        &cwd,
        None,
        None,
        home_dir,
        Some(PI_CATALOG_PROBE_RPC_ARGS),
    )
    .await?;
    let data = match timeout(
        PI_CATALOG_PROBE_TIMEOUT,
        client.request(json!({"type": "get_available_models"})),
    )
    .await
    {
        Ok(result) => {
            client.kill().await;
            result?
        }
        Err(_) => {
            client.kill().await;
            return Err("pi get_available_models timed out".to_string());
        }
    };
    let models = parse_pi_available_models(&data);
    if models.is_empty() || models.iter().all(|model| model.source == "fallback") {
        Err("pi get_available_models returned no models".to_string())
    } else {
        Ok(models)
    }
}

/// Parse `pi --list-models` fixed-width table into ModelInfo entries.
pub(crate) fn parse_pi_models_output(stdout: &str) -> Vec<ModelInfo> {
    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw_line in stdout.lines() {
        let line = {
            let mut out = String::new();
            let mut chars = raw_line.chars().peekable();
            while let Some(ch) = chars.next() {
                if ch == '\u{1b}' {
                    if chars.peek() == Some(&'[') {
                        chars.next();
                        for c in chars.by_ref() {
                            if c.is_ascii_alphabetic() {
                                break;
                            }
                        }
                    }
                    continue;
                }
                out.push(ch);
            }
            out.trim().to_string()
        };
        if line.is_empty() {
            continue;
        }
        let parts: Vec<String> = line
            .split(|c: char| c.is_whitespace())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        if parts.len() < 2 {
            continue;
        }
        let provider = &parts[0];
        let model = &parts[1];
        if provider == "provider" && model == "model" {
            continue;
        }
        // 跳过表头/分隔线等杂音行,但 provider 允许 Unicode(中文自定义供应商名)。
        if provider
            .chars()
            .any(|c| !c.is_alphanumeric() && c != '-' && c != '_')
        {
            continue;
        }
        let id = format!("{provider}/{model}");
        if !seen.insert(id.clone()) {
            continue;
        }
        let thinking = parts.get(4).map(|s| s.as_str()) == Some("yes");
        let images = parts.get(5).map(|s| s.as_str()) == Some("yes");
        let mut details = Vec::new();
        if let Some(ctx) = parts.get(2) {
            details.push(format!("ctx {ctx}"));
        }
        if thinking {
            details.push("thinking".to_string());
        }
        if images {
            details.push("vision".to_string());
        }
        let description = if details.is_empty() {
            id.clone()
        } else {
            details.join(" · ")
        };
        let info = ModelInfo::new(id.clone(), id.clone())
            .with_description(description)
            .with_provider(provider.clone())
            .with_protocol("pi")
            .with_provenance("cli:pi-list-models")
            .with_source("detected");
        models.push(apply_pi_thinking_levels(
            info,
            supported_thinking_levels_for_pi_model(thinking, None),
        ));
    }
    if models.is_empty() {
        models.push(
            ModelInfo::new("auto", "PI Auto")
                .with_description("Use PI CLI default model")
                .with_provider("pi")
                .with_protocol("pi")
                .with_source("fallback")
                .as_default(),
        );
    } else if let Some(first) = models.first_mut() {
        first.default = true;
    }
    models
}

pub(crate) async fn run_pi_list_models(
    bin: &str,
    path_env: Option<&String>,
    extra_args: &[&str],
) -> Result<Vec<ModelInfo>, String> {
    let mut cmd = crate::backend::app_server::build_command_for_binary(bin);
    cmd.arg("--list-models");
    for arg in extra_args {
        cmd.arg(arg);
    }
    if let Some(path) = path_env {
        cmd.env("PATH", path);
    }
    let output = timeout(PI_CATALOG_PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "pi --list-models timed out".to_string())?
        .map_err(|error| format!("failed to run pi --list-models: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pi --list-models failed: {}", stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let models = parse_pi_models_output(&stdout);
    if models.is_empty() {
        return Err("pi --list-models returned no models".to_string());
    }
    Ok(models)
}

pub(crate) async fn get_pi_models(bin: &str, path_env: Option<&String>) -> (Vec<ModelInfo>, Option<String>) {
    let (mut models, config_diagnostic) = probe_pi_models_chain(bin, path_env).await;
    promote_pi_default_from_settings(&mut models);
    (models, config_diagnostic)
}

/// PI catalog 三条取数路径（RPC `get_available_models` → `--list-models` 两跳 →
/// generated fallback）。default 标记保持 parse 层兜底语义（首条目），由
/// `promote_pi_default_from_settings` 在汇合点按 settings 修正。
pub(crate) async fn probe_pi_models_chain(
    bin: &str,
    path_env: Option<&String>,
) -> (Vec<ModelInfo>, Option<String>) {
    match fetch_pi_models_via_rpc(bin, None).await {
        Ok(models) => return (models, None),
        Err(error) => {
            log::info!("[pi] catalog rpc unavailable ({error}); falling back to --list-models");
        }
    }
    // 先跳过 extension boot（同 RPC 探测理由，实测 9.3s → 1.0s）；失败再裸
    // 跑一次兜底不识别 --no-extensions 的旧版 pi，两次皆败才落 generated fallback。
    match run_pi_list_models(bin, path_env, &["--no-extensions"]).await {
        Ok(models) => return (models, None),
        Err(error) => {
            log::info!("[pi] --list-models with --no-extensions failed ({error}); retrying bare");
        }
    }
    match run_pi_list_models(bin, path_env, &[]).await {
        Ok(models) => (models, None),
        Err(error) => (get_generated_fallback_models(EngineType::Pi), Some(error)),
    }
}

/// Read `(defaultProvider, defaultModel)` from `<agent>/settings.json`.
/// Provider is optional (custom models.json entries may be provider-less);
/// any failure (missing file / malformed JSON / non-string / blank) → None.
/// 探测链禁止为 settings 缺失注入诊断噪音，故全部静默容错。
pub(crate) fn read_pi_default_model_selection(home_dir: Option<&Path>) -> Option<(Option<String>, String)> {
    let path = home_dir?.join("settings.json");
    let content = std::fs::read_to_string(&path).ok()?;
    let root: serde_json::Value = serde_json::from_str(&content).ok()?;
    let read_field = |key: &str| -> Option<String> {
        root.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some((read_field("defaultProvider"), read_field("defaultModel")?))
}

/// PI default 解析：settings 候选 id 依次 `{defaultProvider}/{defaultModel}` →
/// 裸 `{defaultModel}`；全部未命中或 settings 不可用时不动列表。
pub(crate) fn promote_pi_default_from_settings(models: &mut Vec<ModelInfo>) {
    let Some((provider, model)) = read_pi_default_model_selection(get_pi_home_dir().as_deref())
    else {
        return;
    };
    for candidate in pi_default_candidate_ids(provider.as_deref(), &model) {
        if promote_default_model(models, &candidate) {
            return;
        }
    }
}

/// 候选 id 顺序：`{defaultProvider}/{defaultModel}` 优先，裸 `{defaultModel}`
/// 兜底（覆盖自定义 models.json 无 provider 前缀条目）。
pub(crate) fn pi_default_candidate_ids(provider: Option<&str>, model: &str) -> Vec<String> {
    match provider.map(str::trim).filter(|value| !value.is_empty()) {
        Some(provider) => vec![pi_model_catalog_id(&provider, model), model.to_string()],
        None => vec![model.to_string()],
    }
}
