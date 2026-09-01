use super::*;

/// 逐引擎检测完成事件回调（B4）：`(detectRunId, status)`，每引擎每轮恰好
/// 一次；前端据此刻画逐项 reveal（ccgui:engine-status-updated）。
pub type EngineStatusEventSink = Arc<dyn Fn(u64, EngineStatus) + Send + Sync>;

/// Wrap a single engine probe in its own task：任一引擎探测 panic / abort
/// 只落该引擎 error，MUST NOT 影响其他引擎的探测与结果（隔离铁律，
/// refactor-engine-detection-pipeline D10）。探测完成即回调 sink（B4 逐项推送）。
pub(crate) async fn run_engine_detection_isolated<F, Fut>(
    engine_type: EngineType,
    probe: F,
    detect_run_id: u64,
    on_status: Option<EngineStatusEventSink>,
) -> EngineStatus
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = EngineStatus> + Send + 'static,
{
    let status = match tokio::spawn(probe()).await {
        Ok(status) => status,
        Err(join_error) => {
            let mut status = disabled_engine_status(engine_type);
            status.installed = false;
            status.error = Some(format!("engine detection task failed: {join_error}"));
            status
        }
    };
    if let Some(on_status) = on_status.as_ref() {
        on_status(detect_run_id, status.clone());
    }
    status
}

/// Detect all supported engines
pub async fn detect_all_engines(
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
    pi_bin: Option<&str>,
    omp_bin: Option<&str>,
    qoder_bin: Option<&str>,
    dsh_settings: &crate::engine::dsh::supervisor::DshRuntimeSettings,
    gemini_enabled: bool,
) -> Vec<EngineStatus> {
    detect_all_engines_scoped(
        claude_bin,
        codex_bin,
        gemini_bin,
        opencode_bin,
        kimi_bin,
        grok_bin,
        pi_bin,
        omp_bin,
        qoder_bin,
        dsh_settings,
        gemini_enabled,
        &[],
        0,
        None,
    )
    .await
}

/// 同 `detect_all_engines`，但 `disabled_engines` 内的引擎不进入检测
/// （0 spawn、结果不出现；refactor-engine-detection-pipeline D9 启用范围铁律）。
/// 各引擎 MUST 走启动轻量分支（models 目录探测只在 `get_engine_models` 按需路径）。
pub async fn detect_all_engines_scoped(
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
    pi_bin: Option<&str>,
    omp_bin: Option<&str>,
    qoder_bin: Option<&str>,
    dsh_settings: &crate::engine::dsh::supervisor::DshRuntimeSettings,
    gemini_enabled: bool,
    disabled_engines: &[EngineType],
    detect_run_id: u64,
    on_status: Option<EngineStatusEventSink>,
) -> Vec<EngineStatus> {
    // 参数 owned 化：per-engine 独立 task 要求 'static（隔离铁律）。
    let claude_bin = claude_bin.map(str::to_string);
    let codex_bin = codex_bin.map(str::to_string);
    let gemini_bin = gemini_bin.map(str::to_string);
    let opencode_bin = opencode_bin.map(str::to_string);
    let kimi_bin = kimi_bin.map(str::to_string);
    let grok_bin = grok_bin.map(str::to_string);
    let pi_bin = pi_bin.map(str::to_string);
    let omp_bin = omp_bin.map(str::to_string);
    let qoder_bin = qoder_bin.map(str::to_string);
    let dsh_settings = dsh_settings.clone();

    let is_enabled = |engine_type: EngineType| !disabled_engines.contains(&engine_type);

    let claude_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Claude) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Claude,
                move || async move { detect_claude_status(claude_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Claude,
            )))
        };
    let codex_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Codex) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Codex,
                move || async move { detect_codex_status(codex_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Codex,
            )))
        };
    let gemini_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if gemini_enabled && crate::engine_policy::GEMINI_RUNTIME_ENABLED {
            Box::pin(run_engine_detection_isolated(
                EngineType::Gemini,
                move || async move { detect_gemini_status(gemini_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Gemini,
            )))
        };
    let opencode_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::OpenCode) {
            Box::pin(run_engine_detection_isolated(
                EngineType::OpenCode,
                move || async move {
                    detect_opencode_status_with_options(opencode_bin.as_deref(), false).await
                },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::OpenCode,
            )))
        };
    let kimi_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Kimi) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Kimi,
                move || async move { detect_kimi_status(kimi_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Kimi)))
        };
    let grok_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Grok) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Grok,
                move || async move { detect_grok_status(grok_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Grok)))
        };
    let pi_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Pi) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Pi,
                move || async move { detect_pi_status_with_options(pi_bin.as_deref(), false).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Pi)))
        };
    let omp_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Omp) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Omp,
                move || async move { detect_omp_status_with_options(omp_bin.as_deref(), false).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Omp)))
        };
    let qoder_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Qoder) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Qoder,
                move || async move {
                    detect_qoder_status_with_options(qoder_bin.as_deref(), false).await
                },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Qoder,
            )))
        };
    let dsh_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Dsh) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Dsh,
                move || async move { crate::engine::dsh::detect_dsh_status(&dsh_settings).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Dsh)))
        };

    let (
        claude_status,
        codex_status,
        gemini_status,
        opencode_status,
        kimi_status,
        grok_status,
        pi_status,
        omp_status,
        qoder_status,
        dsh_status,
    ) = tokio::join!(
        claude_status,
        codex_status,
        gemini_status,
        opencode_status,
        kimi_status,
        grok_status,
        pi_status,
        omp_status,
        qoder_status,
        dsh_status,
    );

    let statuses = vec![
        claude_status,
        codex_status,
        gemini_status,
        opencode_status,
        kimi_status,
        grok_status,
        pi_status,
        omp_status,
        qoder_status,
        dsh_status,
    ];
    // D4 失效条件：开启引擎全部 not_installed 时清环境解析缓存（npm prefix /
    // 登录 shell / claude version memo），覆盖「用户刚装好 CLI」的场景；
    // 下一轮检测重新解析。不视为引擎间错误传播（D10）。
    if !statuses.is_empty() && statuses.iter().all(|status| !status.installed) {
        invalidate_environment_resolution_caches();
    }
    statuses
        .into_iter()
        .filter(|status| is_enabled(status.engine_type))
        .collect()
}

/// Detect available engines and return the preferred default engine.
/// Priority: Claude > Codex > OpenCode (user can override in settings)
pub async fn detect_preferred_engine(
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
    pi_bin: Option<&str>,
    omp_bin: Option<&str>,
    qoder_bin: Option<&str>,
    dsh_settings: Option<&crate::engine::dsh::supervisor::DshRuntimeSettings>,
) -> EngineType {
    detect_preferred_engine_scoped(
        claude_bin,
        codex_bin,
        gemini_bin,
        opencode_bin,
        kimi_bin,
        grok_bin,
        pi_bin,
        omp_bin,
        qoder_bin,
        dsh_settings,
        &[],
        0,
        None,
    )
    .await
}

/// 同 `detect_preferred_engine`，但 `disabled_engines` 内的引擎不参与探测与
/// 默认引擎选择（refactor-engine-detection-pipeline D9）。
pub async fn detect_preferred_engine_scoped(
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
    pi_bin: Option<&str>,
    omp_bin: Option<&str>,
    qoder_bin: Option<&str>,
    dsh_settings: Option<&crate::engine::dsh::supervisor::DshRuntimeSettings>,
    disabled_engines: &[EngineType],
    detect_run_id: u64,
    on_status: Option<EngineStatusEventSink>,
) -> EngineType {
    let default_dsh = crate::engine::dsh::supervisor::DshRuntimeSettings::default();
    let dsh_settings = dsh_settings.unwrap_or(&default_dsh);
    // 参数 owned 化：per-engine 独立 task 要求 'static（隔离铁律）。
    let claude_bin = claude_bin.map(str::to_string);
    let codex_bin = codex_bin.map(str::to_string);
    let gemini_bin = gemini_bin.map(str::to_string);
    let opencode_bin = opencode_bin.map(str::to_string);
    let kimi_bin = kimi_bin.map(str::to_string);
    let grok_bin = grok_bin.map(str::to_string);
    let pi_bin = pi_bin.map(str::to_string);
    let omp_bin = omp_bin.map(str::to_string);
    let qoder_bin = qoder_bin.map(str::to_string);
    let dsh_settings = dsh_settings.clone();
    let is_enabled = |engine_type: EngineType| !disabled_engines.contains(&engine_type);

    let claude_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Claude) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Claude,
                move || async move { detect_claude_status(claude_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Claude,
            )))
        };
    let codex_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Codex) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Codex,
                move || async move { detect_codex_status(codex_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Codex,
            )))
        };
    let gemini_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if crate::engine_policy::GEMINI_RUNTIME_ENABLED {
            Box::pin(run_engine_detection_isolated(
                EngineType::Gemini,
                move || async move { detect_gemini_status(gemini_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Gemini,
            )))
        };
    let opencode_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::OpenCode) {
            Box::pin(run_engine_detection_isolated(
                EngineType::OpenCode,
                move || async move {
                    detect_opencode_status_with_options(opencode_bin.as_deref(), false).await
                },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::OpenCode,
            )))
        };
    let kimi_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Kimi) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Kimi,
                move || async move { detect_kimi_status(kimi_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Kimi)))
        };
    let grok_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Grok) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Grok,
                move || async move { detect_grok_status(grok_bin.as_deref()).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Grok)))
        };
    let pi_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Pi) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Pi,
                move || async move { detect_pi_status_with_options(pi_bin.as_deref(), false).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Pi)))
        };
    let omp_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Omp) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Omp,
                move || async move { detect_omp_status_with_options(omp_bin.as_deref(), false).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Omp)))
        };
    let qoder_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Qoder) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Qoder,
                move || async move {
                    detect_qoder_status_with_options(qoder_bin.as_deref(), false).await
                },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(
                EngineType::Qoder,
            )))
        };
    let dsh_status: std::pin::Pin<Box<dyn std::future::Future<Output = EngineStatus> + Send>> =
        if is_enabled(EngineType::Dsh) {
            Box::pin(run_engine_detection_isolated(
                EngineType::Dsh,
                move || async move { crate::engine::dsh::detect_dsh_status(&dsh_settings).await },
                detect_run_id,
                on_status.clone(),
            ))
        } else {
            Box::pin(std::future::ready(disabled_engine_status(EngineType::Dsh)))
        };

    let (
        claude_status,
        codex_status,
        gemini_status,
        opencode_status,
        kimi_status,
        grok_status,
        pi_status,
        omp_status,
        qoder_status,
        dsh_status,
    ) = tokio::join!(
        claude_status,
        codex_status,
        gemini_status,
        opencode_status,
        kimi_status,
        grok_status,
        pi_status,
        omp_status,
        qoder_status,
        dsh_status,
    );

    // Priority: Claude first (more users have it installed)
    if claude_status.installed {
        return EngineType::Claude;
    }
    if codex_status.installed {
        return EngineType::Codex;
    }
    if crate::engine_policy::GEMINI_RUNTIME_ENABLED && gemini_status.installed {
        return EngineType::Gemini;
    }
    if opencode_status.installed {
        return EngineType::OpenCode;
    }
    if kimi_status.installed {
        return EngineType::Kimi;
    }
    if grok_status.installed {
        return EngineType::Grok;
    }
    if pi_status.installed {
        return EngineType::Pi;
    }
    if omp_status.installed {
        return EngineType::Omp;
    }
    if dsh_status.installed {
        return EngineType::Dsh;
    }
    if qoder_status.installed {
        return EngineType::Qoder;
    }

    // Default to Claude so error message is helpful
    EngineType::Claude
}

/// Resolve the engine type from user settings or auto-detect.
/// Priority:
/// 1. Workspace-specific setting (entry.settings.engine_type)
/// 2. App default setting (app_settings.default_engine)
/// 3. Auto-detect based on installed CLIs
pub async fn resolve_engine_type(
    workspace_engine: Option<&str>,
    app_default_engine: Option<&str>,
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
    pi_bin: Option<&str>,
    omp_bin: Option<&str>,
    qoder_bin: Option<&str>,
    disabled_engines: &[EngineType],
) -> EngineType {
    // 1. Check workspace-specific setting
    if let Some(engine) = workspace_engine.filter(|s| !s.is_empty()) {
        match engine.to_lowercase().as_str() {
            "claude" => return EngineType::Claude,
            "codex" => return EngineType::Codex,
            "gemini" if crate::engine_policy::GEMINI_RUNTIME_ENABLED => return EngineType::Gemini,
            "gemini" => {}
            "opencode" => return EngineType::OpenCode,
            "kimi" => return EngineType::Kimi,
            "grok" => return EngineType::Grok,
            "pi" => return EngineType::Pi,
            "omp" => return EngineType::Omp,
            "dsh" => return EngineType::Dsh,
            "qoder" => return EngineType::Qoder,
            _ => {} // Invalid value, fall through
        }
    }

    // 2. Check app default setting
    if let Some(engine) = app_default_engine.filter(|s| !s.is_empty()) {
        match engine.to_lowercase().as_str() {
            "claude" => return EngineType::Claude,
            "codex" => return EngineType::Codex,
            "gemini" if crate::engine_policy::GEMINI_RUNTIME_ENABLED => return EngineType::Gemini,
            "gemini" => {}
            "opencode" => return EngineType::OpenCode,
            "kimi" => return EngineType::Kimi,
            "grok" => return EngineType::Grok,
            "pi" => return EngineType::Pi,
            "omp" => return EngineType::Omp,
            "dsh" => return EngineType::Dsh,
            "qoder" => return EngineType::Qoder,
            _ => {} // Invalid value, fall through
        }
    }

    // 3. Auto-detect based on installed CLIs
    // Box 到堆：tokio::join! 并发持有多路 CLI 探测，内联会放大调用方栈帧。
    Box::pin(detect_preferred_engine_scoped(
        claude_bin,
        codex_bin,
        gemini_bin,
        opencode_bin,
        kimi_bin,
        grok_bin,
        pi_bin,
        omp_bin,
        qoder_bin,
        None,
        disabled_engines,
        0,
        None,
    ))
    .await
}
