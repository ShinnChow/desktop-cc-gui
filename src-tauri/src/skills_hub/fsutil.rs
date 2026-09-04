//! TokenTracker skills 后端的逐语义 Rust 移植（有意的单文件模块，对照上游单文件 `skills-manager.js`）。
//!
//! 上游对照：
//! - `TokenTracker/src/lib/skills-manager.js`：registry / install / discover / updates / trash /
//!   activity / targets sync 等全部核心逻辑。
//! - `TokenTracker/src/lib/skill-usage.js`：`~/.claude/projects/**/*.jsonl` 的 Skill 调用统计。
//! - `TokenTracker/src/lib/local-api.js` 的 `/functions/tokentracker-skills` 端点（GET/POST 分发），
//!   对应本文件底部的 [`skills_hub_query`] / [`skills_hub_mutate`]。
//!
//! 与 upstream 的故意偏差（仅 4 条）：
//! 1. SSOT 根目录为 `~/.ccgui/skills`（可用 env `CCGUI_SKILLS_HOME` 覆盖，便于测试隔离），upstream
//!    是 `~/.tokentracker/skills`；子布局一致（managed/ .trash/ tmp/ registry.json discover-cache.json
//!    updates-cache.json popular-cache.json activity.jsonl usage-cache.json）。
//! 2. skill_usage 响应不输出 cost 与 models（定价表不移植）。
//! 3. 排序使用 Rust codepoint 序（`Ord`），upstream 用 `String.localeCompare`（本地化排序）。
//! 4. 不移植 local-auth token / loopback origin 校验（Tauri IPC 天然可信）。
//!
//! 注：registry 条目的 sourceSignature 为 null 时省略该字段——这是移植契约的规定行为
//! （upstream 会写出 `"sourceSignature": null`），不属于额外偏差。

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::core::*;
use super::scan::*;
use super::registry::*;
use super::http::*;
use super::target_sync::*;
use super::lifecycle::*;
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== 小工具：JSON / fs / 编码 / JS 语义兼容 =====

pub(super) fn read_text(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub(super) fn read_json(path: &Path) -> Option<Value> {
    read_text(path).and_then(|text| serde_json::from_str(&text).ok())
}

pub(super) fn ensure_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

/// unix 下把文件权限收紧到 0o600（registry/cache/activity 共用）；Windows 退化为 no-op。
pub(super) fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// 以 unix 0o600 权限写文件（Windows 下退化为普通写；registry/cache/activity 共用）。
pub(super) fn write_file_private(path: &Path, contents: &str) -> std::io::Result<()> {
    fs::write(path, contents)?;
    set_private_permissions(path)
}

/// upstream writeJson：pretty 2 空格 + 尾换行 + 0o600。
pub(super) fn write_json(path: &Path, value: &Value) -> SkillResult<()> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let mut text =
        serde_json::to_string_pretty(value).map_err(|e| SkillError::other(e.to_string()))?;
    text.push('\n');
    write_file_private(path, &text).map_err(SkillError::from)
}

/// 追加一行（activity.jsonl 用），创建时 0o600。
pub(super) fn append_line_private(path: &Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(line.as_bytes())?;
    set_private_permissions(path)
}

pub(super) fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

/// upstream removePath：entity 或 dangling symlink 存在才删除，递归 force、吞错。
pub(super) fn remove_path(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        let _ = fs::remove_file(path);
    } else {
        let _ = fs::remove_dir_all(path);
    }
}

/// 类似 Node `path.resolve`：拼成绝对路径并做词法归一（不解 symlink、不触盘）。
pub(super) fn resolve_lexical(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut out = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop(); // root 处的 `..` 归一时丢弃（root 上 pop 返回 false）
            }
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

/// 对应 upstream pathStrictlyWithin：child 必须严格位于 parent 之内（词法判定）。
pub(super) fn path_strictly_within(parent: &Path, child: &Path) -> bool {
    match child.strip_prefix(parent) {
        Ok(rest) => !rest.as_os_str().is_empty(),
        Err(_) => false,
    }
}

/// upstream removeEmptyAncestors：从 startDir 逐级向上删空目录直到 stopDir。
pub(super) fn remove_empty_ancestors(start_dir: &Path, stop_dir: &Path) {
    let stop = resolve_lexical(stop_dir);
    let mut current = resolve_lexical(start_dir);
    while path_strictly_within(&stop, &current) {
        if fs::remove_dir(&current).is_err() {
            return;
        }
        let Some(parent) = current.parent() else {
            return;
        };
        current = parent.to_path_buf();
    }
}

/// 对应 fs.cpSync(source, dest, {recursive, force})（默认 follow symlink）。
pub(super) fn copy_dir_recursive(source: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        let meta = fs::metadata(entry.path())?;
        if meta.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// upstream copyDir：先防嵌套、清空 dest，再整目录递归 copy。
pub(super) fn copy_dir(source: &Path, dest: &Path) -> SkillResult<()> {
    assert_not_nested(source, dest)?;
    remove_path(dest);
    copy_dir_recursive(source, dest).map_err(SkillError::from)
}

/// 平台 symlink（目录）；任何失败由调用方回退到 copy。
pub(super) fn symlink_dir(source: &Path, dest: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(source, dest);
    #[cfg(windows)]
    return std::os::windows::fs::symlink_dir(source, dest);
    #[cfg(not(any(unix, windows)))]
    unreachable!("unsupported platform")
}

/// JS `encodeURIComponent`：保留 A-Za-z0-9 与 `- _ . ! ~ * ' ( )`。
pub(super) fn encode_uri_component(value: &str) -> String {
    const UNRESERVED: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::new();
    for byte in value.as_bytes() {
        if UNRESERVED.contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// URLSearchParams 的 form-urlencoded：空格 → `+`，保留 A-Za-z0-9 与 `* - . _`。
pub(super) fn encode_form_param(value: &str) -> String {
    const KEEP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._";
    let mut out = String::new();
    for byte in value.as_bytes() {
        if KEEP.contains(byte) {
            out.push(*byte as char);
        } else if *byte == b' ' {
            out.push('+');
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// GitHub raw/doc URL 的 path 部分逐段 encodeURIComponent。
pub(super) fn encode_url_path(path: &str) -> String {
    path.split('/')
        .map(encode_uri_component)
        .collect::<Vec<_>>()
        .join("/")
}
pub(super) fn github_raw_url(owner: &str, name: &str, branch: &str, file_path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{owner}/{name}/{branch}/{}",
        encode_url_path(file_path)
    )
}
pub(super) fn github_doc_url(owner: &str, name: &str, branch: &str, file_path: &str) -> String {
    format!(
        "https://github.com/{owner}/{name}/blob/{branch}/{}",
        encode_url_path(file_path)
    )
}

/// uninstall trash 名：`base64url(directory, 无 padding)`。
pub(super) fn base64url_no_pad(value: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.as_bytes())
}

/// 近似 JS `String(value)`：null/missing → ""，基本类型转字符串，object/array → ""。
pub(super) fn js_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => String::new(),
    }
}

/// 近似 JS `Number(value)`：string 先 trim，空串 → 0，非法 → NaN。
pub(super) fn js_f64(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}

/// 对应 JS `Number(x || default)`：falsy（missing/null/false/0/""/NaN）→ default。
pub(super) fn js_number_or(value: Option<&Value>, default: f64) -> f64 {
    match value {
        None | Some(Value::Null) => default,
        Some(v) => {
            let n = js_f64(v);
            if n == 0.0 || n.is_nan() {
                default
            } else {
                n
            }
        }
    }
}

/// JS Number 的 JSON 序列化：整数值输出为整数（避免 serde_json 把 5.0 打成 "5.0"）。
pub(super) fn json_number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() <= 9.0e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// JS 的 Unicode 大小写不敏感比较（`a.toLowerCase() === b.toLowerCase()`）。
pub(super) fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

// ===== 安全函数：sanitize 三件套 + targetSkillPath + assertNotNested =====

/// upstream sanitizePathSegment：拒空/`.`/`..`/含 `/` `\` `\0`；允许 `.hidden`。
pub(super) fn sanitize_path_segment(value: &str) -> Option<String> {
    let segment = value.trim();
    if segment.is_empty() || segment == "." || segment == ".." {
        return None;
    }
    if segment.contains('/') || segment.contains('\\') || segment.contains('\0') {
        return None;
    }
    Some(segment.to_string())
}

/// Node `path.win32.isAbsolute`：以 `/` 或 `\` 开头，或 `X:` 后接分隔符。
pub(super) fn is_win32_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if bytes[0] == b'/' || bytes[0] == b'\\' {
        return true;
    }
    bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

/// upstream sanitizeRelativePath：`\`→`/`，拒绝对路径/NUL/`.`/`..`/含 `:` 段。
pub(super) fn sanitize_relative_path(value: &str) -> Option<String> {
    let input = value.trim();
    let raw = input.replace('\\', "/");
    if raw.is_empty() || raw.contains('\0') {
        return None;
    }
    if raw.starts_with('/') || is_win32_absolute(input) || is_win32_absolute(&raw) {
        return None;
    }
    let parts: Vec<&str> = raw.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| *part == "." || *part == ".." || part.contains(':'))
    {
        return None;
    }
    Some(parts.join("/"))
}

/// upstream sanitizeLocalSkillPath = sanitizeRelativePath + 拒任何 `.` 开头段。
pub(super) fn sanitize_local_skill_path(value: &str) -> Option<String> {
    let safe = sanitize_relative_path(value)?;
    if safe.split('/').any(|part| part.starts_with('.')) {
        return None;
    }
    Some(safe)
}

/// upstream installNameFromDirectory：末段再过 sanitizePathSegment。
pub(super) fn install_name_from_directory(directory: &str) -> Option<String> {
    let safe = sanitize_relative_path(directory)?;
    safe.rsplit('/').next().and_then(sanitize_path_segment)
}

/// upstream targetSkillPath：词法归一 + 严格内含 + 中间祖先 lstat 校验。
pub(super) fn target_skill_path(base_dir: &Path, directory: &str) -> Option<PathBuf> {
    let safe = sanitize_relative_path(directory)?;
    let root = resolve_lexical(base_dir);
    let target = resolve_lexical(&root.join(&safe));
    if !path_strictly_within(&root, &target) {
        return None;
    }
    // root 若存在必须是目录；ENOENT 放行。
    match fs::metadata(&root) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return None,
    }
    // safe 的中间祖先逐段 lstat：ENOENT 继续，symlink 或非目录 → None。
    let parts: Vec<&str> = safe.split('/').collect();
    let mut current = root.clone();
    for part in &parts[..parts.len() - 1] {
        current = current.join(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => {}
            Ok(_) => return None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return None,
        }
    }
    Some(target)
}

/// upstream managedSkillPath：SSOT managed/ 下的目标路径。
pub(super) fn managed_skill_path(directory: &str) -> SkillResult<PathBuf> {
    target_skill_path(&ssot_dir(), directory)
        .ok_or_else(|| SkillError::other(format!("Invalid skill directory: {directory}")))
}

/// upstream assertNotNested：resolve 后相等放行，互为严格祖先则拒绝。
pub(super) fn assert_not_nested(source: &Path, dest: &Path) -> SkillResult<()> {
    let a = resolve_lexical(source);
    let b = resolve_lexical(dest);
    if a == b {
        return Ok(());
    }
    if path_strictly_within(&a, &b) || path_strictly_within(&b, &a) {
        return Err(SkillError::other(
            "Refusing to sync a skill into its own directory tree",
        ));
    }
    Ok(())
}
