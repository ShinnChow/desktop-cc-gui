use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::net::TcpStream;
use tokio::time::{sleep, Duration};

use crate::state::AppState;

const DEFAULT_REMOTE_HOST: &str = "127.0.0.1:4732";
const STARTUP_RETRY_TIMES: usize = 20;
const STARTUP_RETRY_INTERVAL_MS: u64 = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaemonControlStatus {
    pub(crate) running: bool,
    pub(crate) host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_error: Option<String>,
}

pub(crate) async fn maybe_start_local_daemon_for_remote(
    state: &AppState,
    app: &AppHandle,
) -> Result<bool, String> {
    let (resolved_host, token) = read_remote_host_and_token(state).await;

    if !is_local_loopback_host(&resolved_host) {
        return Ok(false);
    }

    if is_host_reachable(&resolved_host).await {
        // 端口已有人监听 ≠ 可以直接收编。daemon 是常驻进程，会跨 app 升级
        // 存活（2026-08-30 实证：8/27 的孤儿 daemon 占着 4733，dev 客户端
        // 连了几天旧代码毫无察觉）。只收编「与本 app 同一 daemon 构建」的
        // 监听进程；识别为旧构建/异源时杀掉重衍，否则升级后新 app 会一直
        // 被旧 daemon 服务，修复与新功能永远不生效。
        let expected_binary = resolve_daemon_binary(app);
        if ensure_listening_daemon_matches_build(&resolved_host, expected_binary.as_deref()) {
            return Ok(true);
        }
        log::warn!(
            "[daemon-bootstrap] listener on {resolved_host} is not the current daemon build; restarting it"
        );
    }

    let daemon_binary = resolve_or_build_daemon_binary(app).await?;

    let mut command = crate::utils::async_command(&daemon_binary);
    // Managed assets are optional for daemon RPC. When ready, pass the standard
    // directory explicitly; the daemon also probes data-dir for long-lived
    // processes that were started before installation.
    if !cfg!(debug_assertions) {
        if let Some(assets_dir) = super::assets_package::ready_assets_dir(app) {
            command.env("MOSSX_WEB_ASSETS_DIR", assets_dir);
        }
    }
    command.arg("--listen").arg(&resolved_host);
    if let Some(token) = token.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        command.arg("--token").arg(token);
    } else {
        command.arg("--insecure-no-auth");
    }

    let (data_dir, fallback_stderr) = match app.path().app_data_dir() {
        Ok(dir) => (Some(dir), None),
        Err(_) => (None, Some(capture_fallback_stderr_tmpdir())),
    };
    if let Some(ref dir) = data_dir {
        command.arg("--data-dir").arg(dir);
    }

    let daemon_stderr = data_dir
        .as_ref()
        .map(|dir| dir.as_path())
        .and_then(capture_daemon_stderr)
        .or(fallback_stderr)
        .unwrap_or(Stdio::null());

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(daemon_stderr);

    command.spawn().map_err(|error| {
        format!(
            "Failed to spawn daemon binary at '{}': {error}",
            daemon_binary.display()
        )
    })?;

    for _ in 0..STARTUP_RETRY_TIMES {
        sleep(Duration::from_millis(STARTUP_RETRY_INTERVAL_MS)).await;
        if is_host_reachable(&resolved_host).await {
            return Ok(true);
        }
    }

    Err(format!(
        "Daemon started but endpoint '{resolved_host}' is still unreachable."
    ))
}

pub(crate) async fn get_local_daemon_status(state: &AppState) -> DaemonControlStatus {
    let (host, _) = read_remote_host_and_token(state).await;
    let running = if is_local_loopback_host(&host) {
        is_host_reachable(&host).await
    } else {
        false
    };
    DaemonControlStatus {
        running,
        host,
        last_error: None,
    }
}

pub(crate) async fn is_local_daemon_configured(state: &AppState) -> bool {
    let (host, _) = read_remote_host_and_token(state).await;
    is_local_loopback_host(&host)
}

pub(crate) async fn start_local_daemon_for_remote(
    state: &AppState,
    app: &AppHandle,
) -> Result<DaemonControlStatus, String> {
    let (host, _) = read_remote_host_and_token(state).await;
    if !is_local_loopback_host(&host) {
        return Err(format!(
            "Only loopback remote host is supported for daemon control: {host}"
        ));
    }

    maybe_start_local_daemon_for_remote(state, app).await?;
    let running = is_host_reachable(&host).await;
    Ok(DaemonControlStatus {
        running,
        host,
        last_error: None,
    })
}

pub(crate) async fn stop_local_daemon_for_remote(
    state: &AppState,
) -> Result<DaemonControlStatus, String> {
    let (host, _) = read_remote_host_and_token(state).await;
    if !is_local_loopback_host(&host) {
        return Err(format!(
            "Only loopback remote host is supported for daemon control: {host}"
        ));
    }

    if !is_host_reachable(&host).await {
        return Ok(DaemonControlStatus {
            running: false,
            host,
            last_error: None,
        });
    }

    let port = parse_port_from_host(&host)
        .ok_or_else(|| format!("Failed to parse daemon port from host: {host}"))?;
    let listener_pids = collect_listener_pids(port)?;
    if listener_pids.is_empty() {
        return Err(format!(
            "Daemon is reachable at {host}, but no LISTEN process was found on port {port}."
        ));
    }
    let daemon_pids = filter_moss_daemon_pids(&listener_pids)?;
    if daemon_pids.is_empty() {
        return Err(format!(
            "Refusing to stop port {port}: no moss daemon process matched listener PIDs {:?}.",
            listener_pids
        ));
    }
    terminate_pids(&daemon_pids)?;

    for _ in 0..STARTUP_RETRY_TIMES {
        sleep(Duration::from_millis(STARTUP_RETRY_INTERVAL_MS)).await;
        if !is_host_reachable(&host).await {
            return Ok(DaemonControlStatus {
                running: false,
                host,
                last_error: None,
            });
        }
    }

    Err(format!(
        "Daemon stop timeout: endpoint '{host}' is still reachable after kill attempts."
    ))
}

async fn read_remote_host_and_token(state: &AppState) -> (String, Option<String>) {
    let settings = state.app_settings.lock().await;
    let host = settings.remote_backend_host.trim().to_string();
    (
        if host.is_empty() {
            DEFAULT_REMOTE_HOST.to_string()
        } else {
            host
        },
        settings.remote_backend_token.clone(),
    )
}

async fn is_host_reachable(host: &str) -> bool {
    TcpStream::connect(host).await.is_ok()
}

fn is_local_loopback_host(host: &str) -> bool {
    let lower = host.to_ascii_lowercase();
    lower.starts_with("127.0.0.1:")
        || lower.starts_with("localhost:")
        || lower.starts_with("[::1]:")
}

fn parse_port_from_host(host: &str) -> Option<u16> {
    if let Ok(addr) = host.parse::<std::net::SocketAddr>() {
        return Some(addr.port());
    }
    host.rsplit_once(':')
        .and_then(|(_, value)| value.parse::<u16>().ok())
}

/// 判定端口上的 moss daemon 监听进程是否与本 app 的 daemon 构建一致。
/// 一致 → true（收编）；识别为旧构建/异源二进制 → 杀掉并返回 false（外层
/// 随即 spawn 当前构建）；无法识别（非 unix、lsof/ps 失败、无 moss 进程）
/// → true（保守收编，保持既有行为，避免误杀未知部署）。
fn ensure_listening_daemon_matches_build(host: &str, expected_binary: Option<&Path>) -> bool {
    let Some(port) = parse_port_from_host(host) else {
        return true;
    };
    let Some(expected_binary) = expected_binary else {
        return true;
    };
    let Ok(expected_path) = expected_binary.canonicalize() else {
        return true;
    };
    let Ok(listener_pids) = collect_listener_pids(port) else {
        return true;
    };
    let Ok(daemon_pids) = filter_moss_daemon_pids(&listener_pids) else {
        return true;
    };
    if daemon_pids.is_empty() {
        // 监听者不是本项目的 daemon（远端网关/未知部署），不越权处理。
        return true;
    }

    let Ok(expected_meta) = std::fs::metadata(&expected_path) else {
        return true;
    };
    let expected_modified = expected_meta.modified().ok();

    let mut stale_pids = Vec::new();
    for pid in &daemon_pids {
        match inspect_daemon_process_freshness(*pid, &expected_path, expected_modified) {
            ProcessFreshness::Current => {}
            ProcessFreshness::Stale => stale_pids.push(*pid),
            ProcessFreshness::Unknown => return true,
        }
    }
    if stale_pids.is_empty() {
        return true;
    }
    if let Err(error) = terminate_pids(&stale_pids) {
        log::warn!(
            "[daemon-bootstrap] failed to restart stale daemon pids {stale_pids:?}: {error}"
        );
        return true;
    }
    false
}

enum ProcessFreshness {
    /// 监听进程就是当前构建（同路径且二进制未在进程启动后被替换）。
    Current,
    /// 旧构建在跑（异源路径，或二进制 mtime 晚于进程启动 = 已被替换）。
    Stale,
    /// 无法判定（ps 失败/输出异常）：保守收编。
    Unknown,
}

fn inspect_daemon_process_freshness(
    pid: u32,
    expected_path: &Path,
    expected_modified: Option<std::time::SystemTime>,
) -> ProcessFreshness {
    let Some(identity) = read_process_identity(pid).ok().flatten() else {
        return ProcessFreshness::Unknown;
    };
    // Unix `ps` 返回的是“命令 + 参数”，取首 token；Windows PowerShell 返回
    // 完整 ExecutablePath，不能按空格切分（例如 `C:\Program Files\...`）。
    #[cfg(windows)]
    let running_binary = Some({
        let path = PathBuf::from(identity.trim());
        path.canonicalize().unwrap_or(path)
    });
    #[cfg(not(windows))]
    let running_binary = identity
        .split_whitespace()
        .next()
        .map(PathBuf::from)
        .map(|path| path.canonicalize().unwrap_or(path));
    let Some(running_binary) = running_binary else {
        return ProcessFreshness::Unknown;
    };

    // Windows：identity 为 PowerShell 拿到的完整 ExecutablePath（无可靠的
    // 进程启动时间源，ps lstart 不可用），退化为「大小写不敏感的全路径
    // 比较」：同路径视为当前构建收编；二进制被替换的旧进程无法据此识别，
    // 由安装器停止服务/用户重启兜底（已知限制）。异源路径以本 app 的构建
    // 为准重建。
    if cfg!(windows) {
        return if running_binary
            .to_string_lossy()
            .eq_ignore_ascii_case(&expected_path.to_string_lossy())
        {
            ProcessFreshness::Current
        } else {
            ProcessFreshness::Stale
        };
    }

    if running_binary != expected_path {
        // 异源二进制（dev target/debug vs 安装版 /Applications 等）：
        // 一律以本 app 的构建为准重建。
        return ProcessFreshness::Stale;
    }
    // 同路径：cargo/安装器替换二进制后，老进程内存里仍是旧代码。
    // 二进制 mtime 晚于进程启动 ⇒ 旧构建。ps lstart 输出为 C locale
    // 英文缩写（macOS/Linux 实证），非 C locale 环境解析失败时保守收编。
    let (Ok(output), Some(binary_modified)) = (
        crate::utils::std_command("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("lstart=")
            .output(),
        expected_modified,
    ) else {
        return ProcessFreshness::Unknown;
    };
    if !output.status.success() {
        return ProcessFreshness::Unknown;
    }
    let started_at = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let Ok(started) = chrono::NaiveDateTime::parse_from_str(&started_at, "%a %b %d %H:%M:%S %Y")
    else {
        return ProcessFreshness::Unknown;
    };
    let Some(started_system) = started
        .and_local_timezone(chrono::Local)
        .single()
        .map(std::time::SystemTime::from)
    else {
        return ProcessFreshness::Unknown;
    };
    if binary_modified > started_system {
        ProcessFreshness::Stale
    } else {
        ProcessFreshness::Current
    }
}

#[cfg(unix)]
fn collect_listener_pids(port: u16) -> Result<Vec<u32>, String> {
    let target = format!("-iTCP:{port}");
    let output = crate::utils::std_command("lsof")
        .arg("-n")
        .arg("-P")
        .arg("-t")
        .arg(target)
        .arg("-sTCP:LISTEN")
        .output()
        .map_err(|error| format!("failed to execute lsof: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pids = stdout
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect::<Vec<_>>();
    Ok(pids)
}

#[cfg(windows)]
fn collect_listener_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = crate::utils::std_command("netstat")
        .arg("-ano")
        .arg("-p")
        .arg("tcp")
        .output()
        .map_err(|error| format!("failed to execute netstat: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let needle_ipv4 = format!(":{port}");
    let needle_ipv6 = format!("]:{port}");

    let mut pids = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols = line.split_whitespace().collect::<Vec<_>>();
        if cols.len() < 5 {
            continue;
        }
        let local_addr = cols[1];
        let state = cols[3];
        let pid = cols[4];
        if !state.eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        if !(local_addr.ends_with(&needle_ipv4) || local_addr.ends_with(&needle_ipv6)) {
            continue;
        }
        if let Ok(parsed) = pid.parse::<u32>() {
            pids.push(parsed);
        }
    }
    Ok(pids)
}

#[cfg(unix)]
fn filter_moss_daemon_pids(pids: &[u32]) -> Result<Vec<u32>, String> {
    let mut matches = Vec::new();
    for pid in pids {
        if let Some(identity) = read_process_identity(*pid)? {
            if is_moss_daemon_identity(&identity) {
                matches.push(*pid);
            }
        }
    }
    Ok(matches)
}

#[cfg(windows)]
fn filter_moss_daemon_pids(pids: &[u32]) -> Result<Vec<u32>, String> {
    let mut matches = Vec::new();
    for pid in pids {
        if let Some(identity) = read_process_identity(*pid)? {
            if is_moss_daemon_identity(&identity) {
                matches.push(*pid);
            }
        }
    }
    Ok(matches)
}

#[cfg(not(any(unix, windows)))]
fn filter_moss_daemon_pids(_pids: &[u32]) -> Result<Vec<u32>, String> {
    Err("daemon stop is not supported on this platform".to_string())
}

#[cfg(unix)]
fn read_process_identity(pid: u32) -> Result<Option<String>, String> {
    let output = crate::utils::std_command("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("command=")
        .output()
        .map_err(|error| format!("failed to inspect process identity for pid {pid}: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let identity = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if identity.is_empty() {
        Ok(None)
    } else {
        Ok(Some(identity))
    }
}

#[cfg(windows)]
fn read_process_identity(pid: u32) -> Result<Option<String>, String> {
    let output = crate::utils::std_command("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(format!(
            "(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').ExecutablePath"
        ))
        .output()
        .map_err(|error| format!("failed to inspect process identity for pid {pid}: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let identity = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if identity.is_empty() {
        return Ok(None);
    }
    Ok(Some(identity))
}

fn is_moss_daemon_identity(identity: &str) -> bool {
    let lower_identity = identity.to_ascii_lowercase();
    daemon_binary_names()
        .iter()
        .any(|name| lower_identity.contains(&name.to_ascii_lowercase()))
}

#[cfg(not(any(unix, windows)))]
fn collect_listener_pids(_port: u16) -> Result<Vec<u32>, String> {
    Err("daemon stop is not supported on this platform".to_string())
}

fn terminate_pids(pids: &[u32]) -> Result<(), String> {
    let mut seen = HashSet::new();
    for pid in pids {
        if !seen.insert(*pid) {
            continue;
        }
        terminate_pid(*pid)?;
    }
    Ok(())
}

#[cfg(unix)]
fn terminate_pid(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .map_err(|error| format!("failed to terminate pid {pid}: {error}"))?;
    if !status.success() {
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .status();
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_pid(pid: u32) -> Result<(), String> {
    let status = crate::utils::std_command("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .status()
        .map_err(|error| format!("failed to terminate pid {pid}: {error}"))?;
    if !status.success() {
        return Err(format!("taskkill failed for pid {pid}"));
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn terminate_pid(_pid: u32) -> Result<(), String> {
    Err("daemon stop is not supported on this platform".to_string())
}

fn resolve_daemon_binary(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            append_daemon_candidates(parent, &mut candidates);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        append_daemon_candidates(&resource_dir, &mut candidates);
    }

    for binary_name in daemon_binary_names() {
        if let Some(path) = find_in_path(binary_name) {
            candidates.push(path);
        }
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        let key = candidate.to_string_lossy().to_string();
        if seen.insert(key) && candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

async fn resolve_or_build_daemon_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = resolve_daemon_binary(app) {
        return Ok(path);
    }

    // Dev-only fallback: tauri dev usually doesn't build secondary bin targets
    // unless explicitly requested. Build cc_gui_daemon once, then retry resolve.
    if cfg!(debug_assertions) {
        if let Some(manifest_path) = find_dev_manifest_path() {
            build_dev_daemon_binary(&manifest_path).await?;
            if let Some(path) = resolve_daemon_binary(app) {
                return Ok(path);
            }
        }
    }

    Err("Failed to locate cc_gui_daemon binary for local auto-start.".to_string())
}

fn find_dev_manifest_path() -> Option<PathBuf> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    // compile-time source path, usually valid for local debug builds.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"));

    if let Ok(current_exe) = env::current_exe() {
        for ancestor in current_exe.ancestors() {
            candidates.push(ancestor.join("Cargo.toml"));
            candidates.push(ancestor.join("src-tauri").join("Cargo.toml"));
        }
    }

    if let Ok(cwd) = env::current_dir() {
        for ancestor in cwd.ancestors() {
            candidates.push(ancestor.join("Cargo.toml"));
            candidates.push(ancestor.join("src-tauri").join("Cargo.toml"));
        }
    }

    for candidate in candidates {
        let key = candidate.to_string_lossy().to_string();
        if seen.insert(key) && candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

async fn build_dev_daemon_binary(manifest_path: &Path) -> Result<(), String> {
    let status = crate::utils::async_command("cargo")
        .arg("build")
        .arg("--manifest-path")
        .arg(manifest_path)
        .arg("--bin")
        .arg("cc_gui_daemon")
        .status()
        .await
        .map_err(|error| format!("Failed to execute cargo build for cc_gui_daemon: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "cargo build --bin cc_gui_daemon failed with status {status}"
        ))
    }
}

fn append_daemon_candidates(base: &Path, output: &mut Vec<PathBuf>) {
    for name in daemon_binary_names() {
        output.push(base.join(name));
    }
}

fn daemon_binary_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &[
            "cc_gui_daemon.exe",
            "moss_x_daemon.exe",
            "moss-x-daemon.exe",
            "cc_gui_daemon",
            "moss_x_daemon",
            "moss-x-daemon",
        ]
    }
    #[cfg(not(windows))]
    {
        &["cc_gui_daemon", "moss_x_daemon", "moss-x-daemon"]
    }
}

/// Open a log file in the daemon's data directory to capture stderr output.
/// Returns `Stdio::null()` if the file cannot be opened (degradation, not a crash).
fn capture_daemon_stderr(base: &Path) -> Option<Stdio> {
    let path = base.join("daemon_stderr.log");
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .map(Stdio::from)
}

/// Fallback stderr capture when `app_data_dir` is unavailable.
fn capture_fallback_stderr_tmpdir() -> Stdio {
    let path = std::env::temp_dir().join("cc_gui_daemon_stderr.log");
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .map(Stdio::from)
        .unwrap_or(Stdio::null())
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
