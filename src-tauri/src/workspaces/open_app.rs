use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
use super::macos::get_open_app_icon_inner;

#[tauri::command]
pub(crate) async fn open_workspace_in(
    path: String,
    app: Option<String>,
    args: Vec<String>,
    command: Option<String>,
) -> Result<(), String> {
    let command = normalize_open_target_value(command);
    let app = normalize_open_target_value(app);
    let target_label = command
        .as_ref()
        .map(|value| format!("command `{value}`"))
        .or_else(|| app.as_ref().map(|value| format!("app `{value}`")))
        .unwrap_or_else(|| "target".to_string());

    let status = if let Some(command) = command {
        let mut cmd = crate::utils::std_command(command);
        cmd.args(&args).arg(&path);
        cmd.status()
            .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?
    } else if let Some(app) = app {
        #[cfg(target_os = "macos")]
        {
            let mut cmd = crate::utils::std_command("open");
            cmd.arg("-a").arg(&app).arg(&path);
            if !args.is_empty() {
                cmd.arg("--args").args(&args);
            }

            cmd.status()
                .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?
        }

        #[cfg(not(target_os = "macos"))]
        {
            open_workspace_with_non_macos_app(&app, &args, &path, &target_label)?;
            return Ok(());
        }
    } else {
        return Err("Missing app or command".to_string());
    };

    if status.success() {
        return Ok(());
    }

    let exit_detail = status
        .code()
        .map(|code| format!("exit code {code}"))
        .unwrap_or_else(|| "terminated by signal".to_string());
    Err(format!(
        "Failed to open app ({target_label} returned {exit_detail})."
    ))
}

pub(super) fn expand_user_path(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }

    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string());
    }

    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        return Ok(home.join(rest));
    }

    Ok(std::path::PathBuf::from(trimmed))
}

/// Resolve the folder that should be opened for a config file path.
/// - Directory path → that directory
/// - File path → parent directory
/// - Missing file → still use parent if present
pub(super) fn resolve_containing_folder(path: &str) -> Result<std::path::PathBuf, String> {
    let expanded = expand_user_path(path)?;
    let folder = if expanded.is_dir() {
        expanded
    } else {
        expanded
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| format!("Path has no parent directory: {path}"))?
    };

    if folder.exists() {
        return dunce::canonicalize(&folder)
            .map_err(|error| format!("Failed to resolve folder `{}`: {error}", folder.display()));
    }

    Err(format!("Folder does not exist: {}", folder.display()))
}

pub(super) fn open_directory_in_file_manager(folder: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Open the folder itself (no /select — user asked not to open/select the file).
        let path_str = folder.to_string_lossy().to_string();
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|error| format!("Failed to open Explorer: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = crate::utils::std_command("open")
            .arg(folder)
            .status()
            .map_err(|error| format!("Failed to open Finder folder: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "Failed to open Finder folder ({}).",
            format_exit_detail(status.code())
        ));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        tauri_plugin_opener::open_path(folder, None::<&str>)
            .map_err(|error| format!("Failed to open file manager folder: {error}"))
    }
}

/// Reveal a local path in the OS file manager (Finder / Explorer / file manager).
///
/// Windows uses `explorer /select,...` rather than plugin-opener's
/// `SHOpenFolderAndSelectItems`: the latter can fail with non-FILE_NOT_FOUND
/// HRESULTs that the plugin silently swallows, which presents as "click does
/// nothing" for Windows users.
#[tauri::command]
pub(crate) async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }

    let expanded = expand_user_path(trimmed)?;
    let canonical = dunce::canonicalize(&expanded)
        .map_err(|error| format!("Failed to resolve path `{trimmed}`: {error}"))?;

    #[cfg(windows)]
    {
        // Do not route through `std_command` (CREATE_NO_WINDOW): Explorer is a
        // GUI process and must be able to show a window. `spawn` (not `status`)
        // because explorer often returns non-zero even when it succeeds.
        let path_str = canonical.to_string_lossy();
        std::process::Command::new("explorer")
            .arg(format!("/select,{path_str}"))
            .spawn()
            .map_err(|error| format!("Failed to open Explorer: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = crate::utils::std_command("open")
            .arg("-R")
            .arg(&canonical)
            .status()
            .map_err(|error| format!("Failed to reveal in Finder: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "Failed to reveal in Finder ({}).",
            format_exit_detail(status.code())
        ));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        tauri_plugin_opener::reveal_item_in_dir(&canonical)
            .map_err(|error| format!("Failed to reveal in file manager: {error}"))
    }
}

/// Open the containing folder of a path in the OS file manager.
///
/// Unlike `reveal_in_file_manager`, this opens the **folder window** and does
/// not select or open the file itself.
#[tauri::command]
pub(crate) async fn open_folder_in_file_manager(path: String) -> Result<(), String> {
    let folder = resolve_containing_folder(&path)?;
    open_directory_in_file_manager(&folder)
}

pub(super) const DEFAULT_MACOS_APP_NAME: &str = "ccgui";

pub(super) fn normalize_new_window_path(path: Option<String>) -> Option<String> {
    path.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn normalize_open_target_value(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .map(|trimmed| {
            if trimmed.len() >= 2 {
                let wrapped_with_double_quotes = trimmed.starts_with('"') && trimmed.ends_with('"');
                let wrapped_with_single_quotes =
                    trimmed.starts_with('\'') && trimmed.ends_with('\'');
                if wrapped_with_double_quotes || wrapped_with_single_quotes {
                    return trimmed[1..trimmed.len() - 1].trim();
                }
            }
            trimmed
        })
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(not(target_os = "macos"))]
pub(super) fn push_open_app_candidate(candidates: &mut Vec<String>, candidate: impl Into<String>) {
    let candidate = candidate.into();
    if candidate.is_empty()
        || candidates
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate))
    {
        return;
    }
    candidates.push(candidate);
}

#[cfg(target_os = "windows")]
pub(super) fn push_windows_install_candidate(
    candidates: &mut Vec<String>,
    base_dir: Option<std::ffi::OsString>,
    relative_path: &str,
) {
    let Some(base_dir) = base_dir else {
        return;
    };
    let candidate = PathBuf::from(base_dir).join(relative_path);
    if candidate.is_file() {
        push_open_app_candidate(candidates, candidate.to_string_lossy().to_string());
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn open_app_command_candidates(app: &str) -> Vec<String> {
    let trimmed = app.trim();
    let normalized = trimmed.to_ascii_lowercase();
    let mut candidates = Vec::new();
    push_open_app_candidate(&mut candidates, trimmed.to_string());

    match normalized.as_str() {
        "visual studio code" | "vs code" | "vscode" => {
            push_open_app_candidate(&mut candidates, "code");
            push_open_app_candidate(&mut candidates, "code-insiders");
            #[cfg(target_os = "windows")]
            {
                push_windows_install_candidate(
                    &mut candidates,
                    std::env::var_os("LOCALAPPDATA"),
                    "Programs\\Microsoft VS Code\\Code.exe",
                );
                push_windows_install_candidate(
                    &mut candidates,
                    std::env::var_os("PROGRAMFILES"),
                    "Microsoft VS Code\\Code.exe",
                );
                push_windows_install_candidate(
                    &mut candidates,
                    std::env::var_os("PROGRAMFILES(X86)"),
                    "Microsoft VS Code\\Code.exe",
                );
            }
        }
        "cursor" => {
            push_open_app_candidate(&mut candidates, "cursor");
            #[cfg(target_os = "windows")]
            {
                push_windows_install_candidate(
                    &mut candidates,
                    std::env::var_os("LOCALAPPDATA"),
                    "Programs\\Cursor\\Cursor.exe",
                );
                push_windows_install_candidate(
                    &mut candidates,
                    std::env::var_os("PROGRAMFILES"),
                    "Cursor\\Cursor.exe",
                );
            }
        }
        "zed" => {
            push_open_app_candidate(&mut candidates, "zed");
            #[cfg(target_os = "windows")]
            {
                push_windows_install_candidate(
                    &mut candidates,
                    std::env::var_os("LOCALAPPDATA"),
                    "Programs\\Zed\\Zed.exe",
                );
            }
        }
        "ghostty" => {
            push_open_app_candidate(&mut candidates, "ghostty");
        }
        "antigravity" => {
            push_open_app_candidate(&mut candidates, "antigravity");
        }
        _ => {}
    }

    candidates
}

#[cfg(not(target_os = "macos"))]
pub(super) fn open_workspace_with_non_macos_app(
    app: &str,
    args: &[String],
    path: &str,
    target_label: &str,
) -> Result<(), String> {
    let mut last_not_found_error: Option<std::io::Error> = None;

    for candidate in open_app_command_candidates(app) {
        let mut cmd = crate::utils::std_command(&candidate);
        cmd.args(args).arg(path);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
        match cmd.spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_not_found_error = Some(error);
            }
            Err(error) => {
                return Err(format!("Failed to open app ({target_label}): {error}"));
            }
        }
    }

    let detail = last_not_found_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| "program not found".to_string());
    Err(format!("Failed to open app ({target_label}): {detail}"))
}

pub(super) fn format_exit_detail(code: Option<i32>) -> String {
    code.map(|value| format!("exit code {value}"))
        .unwrap_or_else(|| "terminated by signal".to_string())
}

pub(super) fn format_open_new_window_failure(code: Option<i32>) -> String {
    format!(
        "Failed to open new app window (open returned {}).",
        format_exit_detail(code)
    )
}

#[cfg(target_os = "macos")]
pub(super) fn resolve_macos_app_bundle_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    for ancestor in executable.ancestors() {
        if ancestor
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub(super) fn build_macos_new_window_open_args(
    bundle_path: Option<&Path>,
    workspace_path: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["-n".to_string(), "-a".to_string()];
    let app_target = bundle_path
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| DEFAULT_MACOS_APP_NAME.to_string());
    args.push(app_target);
    if let Some(path) = workspace_path {
        args.push(path.to_string());
    }
    args
}

#[tauri::command]
pub(crate) async fn open_new_window(path: Option<String>) -> Result<(), String> {
    let trimmed_path = normalize_new_window_path(path);

    #[cfg(target_os = "macos")]
    {
        let mut command = crate::utils::std_command("open");
        let args = build_macos_new_window_open_args(
            resolve_macos_app_bundle_path().as_deref(),
            trimmed_path.as_deref(),
        );
        command.args(args);
        let status = command
            .status()
            .map_err(|error| format!("Failed to open new app window: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format_open_new_window_failure(status.code()));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let executable = std::env::current_exe()
            .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
        let mut command = crate::utils::std_command(executable);
        if let Some(path) = trimmed_path.as_deref() {
            command.arg(path);
        }
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());
        command
            .spawn()
            .map_err(|error| format!("Failed to open new app window: {error}"))?;
        Ok(())
    }
}

#[cfg(windows)]
pub(super) fn get_windows_associated_icon_png_data_url(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path_buf = std::path::PathBuf::from(trimmed);
    if !path_buf.is_file() {
        return None;
    }
    // Escape for PowerShell single-quoted literal.
    let escaped = trimmed.replace('\'', "''");
    let script = format!(
        r#"
Add-Type -AssemblyName System.Drawing
$path = '{escaped}'
if (-not (Test-Path -LiteralPath $path)) {{ exit 1 }}
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
if ($null -eq $icon) {{ exit 2 }}
$bmp = $icon.ToBitmap()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
"#
    );
    // std_command 携带 CREATE_NO_WINDOW：避免每次图标提取闪现控制台窗口。
    let output = crate::utils::std_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let encoded = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if encoded.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(windows)]
pub(super) fn resolve_windows_icon_source(app_name: &str) -> Option<String> {
    let trimmed = app_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let as_path = std::path::Path::new(trimmed);
    if as_path.is_file() {
        return Some(trimmed.to_string());
    }
    for candidate in open_app_command_candidates(trimmed) {
        let path = std::path::Path::new(&candidate);
        if path.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub(super) fn get_open_app_icon_sync(app_name: &str) -> Option<String> {
    let trimmed = app_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        return get_open_app_icon_inner(trimmed);
    }
    #[cfg(windows)]
    {
        let source = resolve_windows_icon_source(trimmed)?;
        return get_windows_associated_icon_png_data_url(&source);
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        let _ = trimmed;
        None
    }
}

#[tauri::command]
pub(crate) async fn get_open_app_icon(app_name: String) -> Result<Option<String>, String> {
    let trimmed = app_name.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || get_open_app_icon_sync(&trimmed))
        .await
        .map_err(|err| err.to_string())
}

/// One-shot preset probe for Open With settings (lazy; not called at cold start).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenAppPresetProbe {
    pub id: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
}

/// Fixed catalog of preset ids + default app names used for probe.
/// Keep in sync with frontend `OPEN_APP_PRESET_CATALOG` app entries.
const OPEN_APP_PRESET_PROBE_TABLE: &[(&str, &str)] = &[
    ("vscode", "Visual Studio Code"),
    ("cursor", "Cursor"),
    ("zed", "Zed"),
    ("sublime", "Sublime Text"),
    ("ghostty", "Ghostty"),
    ("antigravity", "Antigravity"),
    ("notepad", "notepad"),
];

pub(super) fn looks_like_absolute_fs_path(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with('/') || trimmed.starts_with('~') {
        return true;
    }
    // Windows drive / UNC
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    trimmed.starts_with("\\\\")
}

pub(super) fn expand_user_home_path(value: &str) -> std::path::PathBuf {
    let trimmed = value.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("~"));
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    std::path::PathBuf::from(trimmed)
}

pub(super) fn path_exists_as_launch_target(value: &str) -> bool {
    let path = expand_user_home_path(value);
    path.is_file() || path.is_dir()
}

pub(super) fn probe_macos_app_bundle(app_name: &str) -> Option<String> {
    let trimmed = app_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Absolute / home-relative path first (Browse results).
    if looks_like_absolute_fs_path(trimmed) {
        let path = expand_user_home_path(trimmed);
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
        return None;
    }
    let bundle_name = if trimmed.ends_with(".app") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.app")
    };

    let mut roots = vec![
        std::path::PathBuf::from("/Applications"),
        std::path::PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }

    for root in roots {
        let path = root.join(&bundle_name);
        if path.is_dir() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

/// Probe a single configured open target (lazy; settings only).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenAppTargetProbeResult {
    /// `ok` | `missing` | `broken`
    pub status: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
}

pub(super) fn probe_open_app_target_sync(
    kind: &str,
    app_name: Option<&str>,
    command: Option<&str>,
) -> OpenAppTargetProbeResult {
    let kind = kind.trim();
    if kind.eq_ignore_ascii_case("finder") {
        return OpenAppTargetProbeResult {
            status: "ok".to_string(),
            installed: true,
            resolved_path: None,
        };
    }

    if kind.eq_ignore_ascii_case("command") {
        let cmd = command.map(str::trim).unwrap_or("");
        if cmd.is_empty() {
            return OpenAppTargetProbeResult {
                status: "broken".to_string(),
                installed: false,
                resolved_path: None,
            };
        }
        if looks_like_absolute_fs_path(cmd) {
            if path_exists_as_launch_target(cmd) {
                return OpenAppTargetProbeResult {
                    status: "ok".to_string(),
                    installed: true,
                    resolved_path: Some(expand_user_home_path(cmd).to_string_lossy().to_string()),
                };
            }
            return OpenAppTargetProbeResult {
                status: "broken".to_string(),
                installed: false,
                resolved_path: None,
            };
        }
        #[cfg(target_os = "macos")]
        {
            let ok = command_resolvable_on_path_macos(cmd);
            return OpenAppTargetProbeResult {
                status: if ok {
                    "ok".to_string()
                } else {
                    "missing".to_string()
                },
                installed: ok,
                resolved_path: if ok { Some(cmd.to_string()) } else { None },
            };
        }
        #[cfg(not(target_os = "macos"))]
        {
            if command_resolvable_on_path(cmd) {
                return OpenAppTargetProbeResult {
                    status: "ok".to_string(),
                    installed: true,
                    resolved_path: Some(cmd.to_string()),
                };
            }
            return OpenAppTargetProbeResult {
                status: "missing".to_string(),
                installed: false,
                resolved_path: None,
            };
        }
    }

    // kind == app
    let name = app_name.map(str::trim).unwrap_or("");
    if name.is_empty() {
        return OpenAppTargetProbeResult {
            status: "broken".to_string(),
            installed: false,
            resolved_path: None,
        };
    }

    if looks_like_absolute_fs_path(name) {
        if path_exists_as_launch_target(name) {
            return OpenAppTargetProbeResult {
                status: "ok".to_string(),
                installed: true,
                resolved_path: Some(expand_user_home_path(name).to_string_lossy().to_string()),
            };
        }
        return OpenAppTargetProbeResult {
            status: "broken".to_string(),
            installed: false,
            resolved_path: None,
        };
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(resolved) = probe_macos_app_bundle(name) {
            return OpenAppTargetProbeResult {
                status: "ok".to_string(),
                installed: true,
                resolved_path: Some(resolved),
            };
        }
        return OpenAppTargetProbeResult {
            status: "missing".to_string(),
            installed: false,
            resolved_path: None,
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        for candidate in open_app_command_candidates(name) {
            let path = std::path::Path::new(&candidate);
            if path.is_file() {
                return OpenAppTargetProbeResult {
                    status: "ok".to_string(),
                    installed: true,
                    resolved_path: Some(candidate),
                };
            }
            if command_resolvable_on_path(&candidate) {
                return OpenAppTargetProbeResult {
                    status: "ok".to_string(),
                    installed: true,
                    resolved_path: Some(candidate),
                };
            }
        }
        OpenAppTargetProbeResult {
            status: "missing".to_string(),
            installed: false,
            resolved_path: None,
        }
    }
}

#[cfg(target_os = "macos")]
pub(super) fn command_resolvable_on_path_macos(name: &str) -> bool {
    if name.is_empty() || name.contains('/') {
        return false;
    }
    std::process::Command::new("which")
        .arg(name)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Probe one configured open target. Intended for settings UI re-verify clicks.
#[tauri::command]
pub(crate) async fn probe_open_app_target(
    kind: String,
    app_name: Option<String>,
    command: Option<String>,
) -> Result<OpenAppTargetProbeResult, String> {
    tokio::task::spawn_blocking(move || {
        probe_open_app_target_sync(&kind, app_name.as_deref(), command.as_deref())
    })
    .await
    .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn command_resolvable_on_path(name: &str) -> bool {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return false;
    }
    #[cfg(windows)]
    {
        // std_command 携带 CREATE_NO_WINDOW：避免打开方式探测闪现控制台窗口。
        crate::utils::std_command("where")
            .arg(name)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::process::Command::new("which")
            .arg(name)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

pub(super) fn probe_open_app_preset_sync(id: &str, app_name: &str) -> OpenAppPresetProbe {
    #[cfg(target_os = "macos")]
    {
        let resolved = probe_macos_app_bundle(app_name);
        return OpenAppPresetProbe {
            id: id.to_string(),
            installed: resolved.is_some(),
            resolved_path: resolved,
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Prefer known install paths / CLI aliases (Windows/Linux).
        for candidate in open_app_command_candidates(app_name) {
            let path = std::path::Path::new(&candidate);
            if path.is_file() {
                return OpenAppPresetProbe {
                    id: id.to_string(),
                    installed: true,
                    resolved_path: Some(candidate),
                };
            }
            if command_resolvable_on_path(&candidate) {
                return OpenAppPresetProbe {
                    id: id.to_string(),
                    installed: true,
                    resolved_path: Some(candidate),
                };
            }
        }
        OpenAppPresetProbe {
            id: id.to_string(),
            installed: false,
            resolved_path: None,
        }
    }
}

pub(super) fn probe_open_app_presets_sync() -> Vec<OpenAppPresetProbe> {
    OPEN_APP_PRESET_PROBE_TABLE
        .iter()
        .map(|(id, app_name)| probe_open_app_preset_sync(id, app_name))
        .collect()
}

/// Probe curated Open With presets once. Call only when settings "Open in" is active.
#[tauri::command]
pub(crate) async fn probe_open_app_presets() -> Result<Vec<OpenAppPresetProbe>, String> {
    tokio::task::spawn_blocking(probe_open_app_presets_sync)
        .await
        .map_err(|err| err.to_string())
}
