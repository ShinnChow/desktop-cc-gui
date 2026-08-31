use super::*;

/// Build a tokio Command that correctly handles .cmd/.bat files on Windows.
/// Uses CREATE_NO_WINDOW to prevent visible console windows.
#[allow(unused_variables)]
pub(crate) fn build_async_command(bin: &str) -> Command {
    #[cfg(windows)]
    {
        // On Windows, .cmd/.bat files need to be run through cmd.exe
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = crate::utils::async_command("cmd");
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
    }
    crate::utils::async_command(bin)
}

pub(crate) fn resolve_bin_path(name: &str, custom_bin: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_bin.filter(|v| !v.trim().is_empty()) {
        let custom_path = PathBuf::from(custom);
        if custom_path.exists() {
            return Some(custom_path);
        }
    }
    if name == "claude" {
        return find_claude_code_binary(None);
    }
    find_cli_binary(name, None)
}

/// Probe a CLI binary for its version using `--version`.
/// Returns `(installed, version, error)`.
pub(crate) async fn probe_cli_version(
    bin: &str,
    cli_name: &str,
    path_env: Option<&String>,
) -> (bool, Option<String>, Option<String>) {
    let version_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        let output = cmd
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(version)
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                Err(format!("{} --version failed: {}", cli_name, stderr.trim()))
            }
            Err(e) => Err(format!("Failed to execute {}: {}", cli_name, e)),
        }
    })
    .await;

    match version_result {
        Ok(Ok(v)) => (true, Some(v), None),
        Ok(Err(e)) => (false, None, Some(e)),
        Err(_) => (
            false,
            None,
            Some(format!("Timeout detecting {} CLI", cli_name)),
        ),
    }
}

pub(crate) async fn probe_cli_help(bin: &str, path_env: Option<&String>) -> bool {
    let help_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.arg("--help")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await
    })
    .await;

    matches!(help_result, Ok(Ok(output)) if output.status.success())
}

pub(crate) async fn probe_opencode_cli_version(
    bin: &str,
    path_env: Option<&String>,
) -> (bool, Option<String>, Option<String>) {
    let version_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        let _native_artifact_lease =
            crate::engine::opencode_native_artifact::OpenCodeNativeArtifactLease::prepare(
                &mut cmd,
            )?;
        let output = cmd
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|error| format!("Failed to execute opencode: {error}"))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("opencode --version failed: {}", stderr.trim()))
        }
    })
    .await;

    match version_result {
        Ok(Ok(version)) => (true, Some(version), None),
        Ok(Err(error)) => (false, None, Some(error)),
        Err(_) => (
            false,
            None,
            Some("Timeout detecting opencode CLI".to_string()),
        ),
    }
}

pub(crate) async fn probe_opencode_cli_help(bin: &str, path_env: Option<&String>) -> bool {
    let help_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        let _native_artifact_lease =
            crate::engine::opencode_native_artifact::OpenCodeNativeArtifactLease::prepare(
                &mut cmd,
            )?;
        cmd.arg("--help")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await
            .map_err(|error| error.to_string())
    })
    .await;

    matches!(help_result, Ok(Ok(output)) if output.status.success())
}

/// Build an uninstalled EngineStatus stub.
pub(crate) fn not_installed_status(engine_type: EngineType, error: Option<String>) -> EngineStatus {
    EngineStatus {
        engine_type,
        auth_state: crate::engine::AuthState::default(),
        installed: false,
        version: None,
        bin_path: None,
        home_dir: None,
        models: Vec::new(),
        default_model: None,
        features: EngineFeatures::default(),
        error,
    }
}
