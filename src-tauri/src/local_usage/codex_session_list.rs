use super::*;

#[cfg(test)]
pub(crate) fn scan_codex_session_summaries(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    scan_codex_session_summaries_bounded_with_mode(
        workspace_path,
        sessions_roots,
        usize::MAX,
        CodexSessionParseMode::Full,
        None,
    )
    .map(|(sessions, _)| sessions)
}

#[derive(Debug)]
pub(crate) struct CodexSessionCandidate {
    pub(crate) path: PathBuf,
    codex_home: Option<PathBuf>,
    modified_at: SystemTime,
}

fn scan_codex_session_summaries_bounded(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
    unique_session_limit: usize,
) -> Result<(Vec<LocalUsageSessionSummary>, usize), String> {
    scan_codex_session_summaries_bounded_with_mode(
        workspace_path,
        sessions_roots,
        unique_session_limit,
        CodexSessionParseMode::Full,
        None,
    )
}

pub(crate) fn resolve_codex_candidate_scan_limit(unique_session_limit: usize) -> usize {
    if unique_session_limit == usize::MAX {
        usize::MAX
    } else {
        unique_session_limit.saturating_add(CODEX_BOUNDED_CANDIDATE_LOOKAHEAD)
    }
}

/// Session-index / sidebar writer entry: ThreadPreview only, never Full archive parse.
pub(crate) fn scan_codex_session_summaries_for_index(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
    unique_session_limit: usize,
) -> Result<(Vec<LocalUsageSessionSummary>, usize), String> {
    scan_codex_session_summaries_bounded_with_mode(
        workspace_path,
        sessions_roots,
        unique_session_limit,
        CodexSessionParseMode::ThreadPreview,
        None,
    )
}

pub(crate) fn scan_codex_session_summaries_bounded_with_mode(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
    unique_session_limit: usize,
    parse_mode: CodexSessionParseMode,
    scan_deadline: Option<Instant>,
) -> Result<(Vec<LocalUsageSessionSummary>, usize), String> {
    let unique_session_limit = unique_session_limit.max(1);
    let candidate_scan_limit = match parse_mode {
        CodexSessionParseMode::Full => usize::MAX,
        CodexSessionParseMode::ThreadPreview => {
            // Workspace filter rejects many recent global files; expand collect
            // budget so first-page can still fill without full-tree walk.
            let base = resolve_codex_candidate_scan_limit(unique_session_limit);
            if workspace_path.is_some() {
                base.saturating_mul(8).clamp(base, 400)
            } else {
                base
            }
        }
    };
    // ThreadPreview MUST NOT walk the entire sessions/** tree (can be GB-scale).
    // Prefer date-partition reverse walk + early stop; Full keeps exhaustive collect.
    let candidates = match parse_mode {
        CodexSessionParseMode::ThreadPreview => {
            collect_codex_jsonl_candidates_recent_first(sessions_roots, candidate_scan_limit)
        }
        CodexSessionParseMode::Full => {
            let mut seen_files = HashSet::new();
            let mut candidates = Vec::new();
            for root in sessions_roots {
                let codex_home = codex_home_for_sessions_root(root);
                let mut files = Vec::new();
                collect_jsonl_files(root, &mut files, &mut seen_files);
                candidates.extend(files.into_iter().map(|path| {
                    CodexSessionCandidate {
                        modified_at: fs::metadata(&path)
                            .and_then(|metadata| metadata.modified())
                            .unwrap_or(UNIX_EPOCH),
                        path,
                        codex_home: codex_home.clone(),
                    }
                }));
            }
            candidates.sort_by(|left, right| {
                right.modified_at.cmp(&left.modified_at).then_with(|| {
                    left.path
                        .to_string_lossy()
                        .cmp(&right.path.to_string_lossy())
                })
            });
            candidates
        }
    };

    parse_codex_candidates_into_summaries(
        candidates,
        workspace_path,
        parse_mode,
        candidate_scan_limit,
        unique_session_limit,
        scan_deadline,
    )
}

fn parse_codex_candidates_into_summaries(
    candidates: Vec<CodexSessionCandidate>,
    workspace_path: Option<&Path>,
    parse_mode: CodexSessionParseMode,
    candidate_scan_limit: usize,
    unique_session_limit: usize,
    scan_deadline: Option<Instant>,
) -> Result<(Vec<LocalUsageSessionSummary>, usize), String> {
    let unique_session_limit = unique_session_limit.max(1);
    let mut native_titles_by_home = HashMap::<PathBuf, HashMap<String, String>>::new();
    let mut sessions_by_id = HashMap::<String, LocalUsageSessionSummary>::new();
    let mut scanned_file_count = 0;
    for candidate in candidates.into_iter().take(candidate_scan_limit) {
        // 内层 deadline：超期立即终止，禁止放弃的扫描继续读盘
        // （fix-codex-scan-deadline-abort）。Err 语义与外层 timeout 一致。
        if let Some(deadline) = scan_deadline {
            if Instant::now() >= deadline {
                return Err(CODEX_SCAN_DEADLINE_EXCEEDED.to_string());
            }
        }
        scanned_file_count += 1;
        let Some(mut summary) =
            parse_codex_session_summary_with_mode(&candidate.path, workspace_path, parse_mode)?
        else {
            continue;
        };
        let native_title = candidate.codex_home.as_ref().and_then(|codex_home| {
            native_titles_by_home
                .entry(codex_home.clone())
                .or_insert_with(|| read_codex_native_session_titles(codex_home))
                .get(&summary.session_id)
                .cloned()
        });
        if let Some(native_title) = native_title {
            summary.summary = Some(native_title.clone());
            summary.native_title = Some(native_title);
        }
        if let Some(existing) = sessions_by_id.get_mut(&summary.session_id) {
            merge_duplicate_codex_session_summary(existing, summary);
        } else {
            sessions_by_id.insert(summary.session_id.clone(), summary);
        }
        if parse_mode == CodexSessionParseMode::ThreadPreview
            && unique_session_limit != usize::MAX
            && sessions_by_id.len() >= unique_session_limit
        {
            break;
        }
    }
    let mut sessions = sessions_by_id.into_values().collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .timestamp
            .cmp(&left.timestamp)
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    if unique_session_limit != usize::MAX {
        sessions.truncate(unique_session_limit);
    }
    Ok((sessions, scanned_file_count))
}

fn codex_home_for_sessions_root(root: &Path) -> Option<PathBuf> {
    let root_name = root.file_name().and_then(|value| value.to_str())?;
    if !matches!(root_name, "sessions" | "archived_sessions") {
        return None;
    }
    root.parent().map(Path::to_path_buf)
}

fn read_codex_native_session_titles(codex_home: &Path) -> HashMap<String, String> {
    let Ok(file) = File::open(codex_home.join("session_index.jsonl")) else {
        return HashMap::new();
    };
    let mut titles = HashMap::new();
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        if line.len() > 512_000 {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(session_id) = entry
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(thread_name) = entry
            .get("thread_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        titles.insert(session_id.to_string(), thread_name.to_string());
    }
    titles
}

fn merge_duplicate_codex_session_summary(
    existing: &mut LocalUsageSessionSummary,
    mut candidate: LocalUsageSessionSummary,
) {
    let candidate_is_preferred = candidate
        .timestamp
        .cmp(&existing.timestamp)
        .then_with(|| {
            candidate
                .usage
                .total_tokens
                .cmp(&existing.usage.total_tokens)
        })
        .then_with(|| candidate.file_size_bytes.cmp(&existing.file_size_bytes))
        .then_with(|| {
            existing
                .physical_path
                .as_deref()
                .unwrap_or_default()
                .cmp(candidate.physical_path.as_deref().unwrap_or_default())
        })
        .is_gt();
    if candidate_is_preferred {
        std::mem::swap(existing, &mut candidate);
    }

    let latest_timestamp = existing.timestamp.max(candidate.timestamp);
    let preferred_native_title = existing.native_title.clone();
    let relation_was_missing = existing.parent_session_id.is_none();
    if relation_was_missing && candidate.parent_session_id.is_some() {
        existing.parent_session_id = candidate.parent_session_id.clone();
        if preferred_native_title.is_none()
            && candidate.native_title.is_none()
            && candidate.summary.is_some()
        {
            existing.summary = candidate.summary.clone();
        }
    }
    if existing.summary.is_none() && candidate.native_title.is_none() {
        existing.summary = candidate.summary.clone();
    }
    if let Some(native_title) = preferred_native_title {
        existing.summary = Some(native_title);
    }
    if existing.cwd.is_none() {
        existing.cwd = candidate.cwd.clone();
    }
    if existing.source.is_none() {
        existing.source = candidate.source.clone();
    }
    if existing.provider.is_none() {
        existing.provider = candidate.provider.clone();
    }
    if existing.provider_profile_id.is_none() {
        existing.provider_profile_id = candidate.provider_profile_id.clone();
    }
    if existing.provider_profile_source.is_none() {
        existing.provider_profile_source = candidate.provider_profile_source.clone();
    }
    if existing.provider_profile_name.is_none() {
        existing.provider_profile_name = candidate.provider_profile_name.clone();
    }
    if existing.provider_availability.is_none() {
        existing.provider_availability = candidate.provider_availability.clone();
    }
    if existing.physical_path.is_none() {
        existing.physical_path = candidate.physical_path.clone();
    }
    if candidate.usage.total_tokens > existing.usage.total_tokens {
        existing.usage = candidate.usage.clone();
        existing.cost = candidate.cost;
    }
    existing.timestamp = latest_timestamp;
    existing.file_size_bytes = match (existing.file_size_bytes, candidate.file_size_bytes) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    };
    existing.modified_lines = existing.modified_lines.max(candidate.modified_lines);
    existing
        .session_id_aliases
        .extend(candidate.session_id_aliases);
    existing.session_id_aliases.sort();
    existing.session_id_aliases.dedup();
    existing
        .session_id_aliases
        .retain(|alias| !alias.trim().is_empty() && alias != &existing.session_id);
}

pub(crate) fn collect_jsonl_files(root: &Path, output: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    for path in paths {
        if path.is_dir() {
            collect_jsonl_files(&path, output, seen);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if seen.insert(path.clone()) {
            output.push(path);
        }
    }
}

/// Collect Codex rollout candidates newest-first without enumerating the full
/// archive when roots follow `sessions/YYYY/MM/DD/` (or archived_sessions).
/// Stops once `max_candidates` unique files are collected.
pub(crate) fn collect_codex_jsonl_candidates_recent_first(
    sessions_roots: &[PathBuf],
    max_candidates: usize,
) -> Vec<CodexSessionCandidate> {
    if max_candidates == 0 || max_candidates == usize::MAX {
        let mut seen = HashSet::new();
        let mut candidates = Vec::new();
        for root in sessions_roots {
            let codex_home = codex_home_for_sessions_root(root);
            let mut root_files = Vec::new();
            collect_jsonl_files(root, &mut root_files, &mut seen);
            for path in root_files {
                candidates.push(CodexSessionCandidate {
                    modified_at: fs::metadata(&path)
                        .and_then(|metadata| metadata.modified())
                        .unwrap_or(UNIX_EPOCH),
                    path,
                    codex_home: codex_home.clone(),
                });
            }
        }
        candidates.sort_by(|left, right| {
            right.modified_at.cmp(&left.modified_at).then_with(|| {
                left.path
                    .to_string_lossy()
                    .cmp(&right.path.to_string_lossy())
            })
        });
        return candidates;
    }

    // Per-root 公平收集：每个 root 各自 recent-first 取 ≤ max_candidates，
    // 再全局 mtime 排序 + truncate。禁止「第一个 root 填满就 break」——
    // 主 home sessions/archived 膨胀会饿死靠后的 codex-provider-homes roots，
    // 导致 managed provider 会话永远进不了 Index（P0 回归 30b41e1b5）。
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for root in sessions_roots {
        let codex_home = codex_home_for_sessions_root(root);
        let mut root_candidates = Vec::new();
        collect_codex_jsonl_candidates_from_root_recent_first(
            root,
            codex_home.as_ref(),
            max_candidates,
            &mut seen,
            &mut root_candidates,
        );
        candidates.extend(root_candidates);
    }
    candidates.sort_by(|left, right| {
        right.modified_at.cmp(&left.modified_at).then_with(|| {
            left.path
                .to_string_lossy()
                .cmp(&right.path.to_string_lossy())
        })
    });
    if candidates.len() > max_candidates {
        candidates.truncate(max_candidates);
    }
    candidates
}

fn collect_codex_jsonl_candidates_from_root_recent_first(
    root: &Path,
    codex_home: Option<&PathBuf>,
    max_candidates: usize,
    seen: &mut HashSet<PathBuf>,
    candidates: &mut Vec<CodexSessionCandidate>,
) {
    if candidates.len() >= max_candidates {
        return;
    }
    if looks_like_codex_date_partitioned_root(root) {
        collect_date_partitioned_jsonl_recent_first(
            root,
            codex_home,
            max_candidates,
            seen,
            candidates,
        );
        return;
    }
    // Non-partitioned layout: still avoid full-tree collect by streaming with
    // a hard cap via shallow walk + mtime sort of discovered files only up to cap*4.
    let mut files = Vec::new();
    collect_jsonl_files_capped(root, &mut files, seen, max_candidates.saturating_mul(4));
    let mut local: Vec<CodexSessionCandidate> = files
        .into_iter()
        .map(|path| CodexSessionCandidate {
            modified_at: fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH),
            path,
            codex_home: codex_home.cloned(),
        })
        .collect();
    local.sort_by(|left, right| {
        right.modified_at.cmp(&left.modified_at).then_with(|| {
            left.path
                .to_string_lossy()
                .cmp(&right.path.to_string_lossy())
        })
    });
    for candidate in local {
        if candidates.len() >= max_candidates {
            break;
        }
        candidates.push(candidate);
    }
}

fn looks_like_codex_date_partitioned_root(root: &Path) -> bool {
    let Ok(entries) = fs::read_dir(root) else {
        return false;
    };
    let mut year_dirs = 0usize;
    let mut total_dirs = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        total_dirs += 1;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.len() == 4 && name.chars().all(|c| c.is_ascii_digit()) {
            year_dirs += 1;
        }
    }
    year_dirs > 0 && year_dirs * 2 >= total_dirs.max(1)
}

fn collect_date_partitioned_jsonl_recent_first(
    root: &Path,
    codex_home: Option<&PathBuf>,
    max_candidates: usize,
    seen: &mut HashSet<PathBuf>,
    candidates: &mut Vec<CodexSessionCandidate>,
) {
    let mut years = list_numeric_child_dirs(root);
    years.sort_by(|left, right| right.0.cmp(&left.0));
    for (_year, year_path) in years {
        if candidates.len() >= max_candidates {
            return;
        }
        let mut months = list_numeric_child_dirs(&year_path);
        months.sort_by(|left, right| right.0.cmp(&left.0));
        for (_month, month_path) in months {
            if candidates.len() >= max_candidates {
                return;
            }
            let mut days = list_numeric_child_dirs(&month_path);
            days.sort_by(|left, right| right.0.cmp(&left.0));
            for (_day, day_path) in days {
                if candidates.len() >= max_candidates {
                    return;
                }
                push_jsonl_candidates_from_dir(
                    &day_path,
                    codex_home,
                    max_candidates,
                    seen,
                    candidates,
                );
            }
        }
    }
}

/// One Codex `sessions/YYYY/MM/DD` day partition (zero-padded key so string
/// ordering matches chronological ordering).
#[derive(Debug, Clone)]
pub(crate) struct CodexDayPartition {
    pub key: String,
    pub day_dir: PathBuf,
    pub codex_home: Option<PathBuf>,
}

/// List day partitions across all date-partitioned roots, newest-first.
/// Non-partitioned roots are skipped (backfill falls back to capped walk).
pub(crate) fn list_codex_day_partitions(sessions_roots: &[PathBuf]) -> Vec<CodexDayPartition> {
    let mut out = Vec::new();
    for root in sessions_roots {
        if !looks_like_codex_date_partitioned_root(root) {
            continue;
        }
        let codex_home = codex_home_for_sessions_root(root);
        for (year, year_path) in list_numeric_child_dirs(root) {
            for (month, month_path) in list_numeric_child_dirs(&year_path) {
                for (day, day_path) in list_numeric_child_dirs(&month_path) {
                    out.push(CodexDayPartition {
                        key: format!("{:04}/{:02}/{:02}", year, month, day),
                        day_dir: day_path,
                        codex_home: codex_home.clone(),
                    });
                }
            }
        }
    }
    out.sort_by(|left, right| {
        right.key.cmp(&left.key).then_with(|| {
            left.day_dir
                .to_string_lossy()
                .cmp(&right.day_dir.to_string_lossy())
        })
    });
    out
}

/// Backfill support: parse ThreadPreview summaries for explicit day partitions
/// (no candidate cap — a single day dir is naturally bounded).
pub(crate) fn scan_codex_session_summaries_for_day_dirs(
    workspace_path: Option<&Path>,
    partitions: &[CodexDayPartition],
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for partition in partitions {
        push_jsonl_candidates_from_dir(
            &partition.day_dir,
            partition.codex_home.as_ref(),
            usize::MAX,
            &mut seen,
            &mut candidates,
        );
    }
    let (sessions, _scanned) = parse_codex_candidates_into_summaries(
        candidates,
        workspace_path,
        CodexSessionParseMode::ThreadPreview,
        usize::MAX,
        usize::MAX,
        None,
    )?;
    Ok(sessions)
}

/// Backfill fallback for non-partitioned roots: capped shallow walk, mtime desc.
pub(crate) fn collect_codex_jsonl_candidates_capped(
    sessions_roots: &[PathBuf],
    max_files: usize,
) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for root in sessions_roots {
        if looks_like_codex_date_partitioned_root(root) {
            continue;
        }
        collect_jsonl_files_capped(root, &mut files, &mut seen, max_files);
    }
    files.sort_by(|left, right| {
        let left_mtime = fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let right_mtime = fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        right_mtime
            .cmp(&left_mtime)
            .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
    });
    files
}

/// Parse ThreadPreview summaries for explicit candidate files (backfill fallback).
pub(crate) fn scan_codex_session_summaries_for_files(
    workspace_path: Option<&Path>,
    files: Vec<PathBuf>,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let candidates = files
        .into_iter()
        .map(|path| CodexSessionCandidate {
            modified_at: fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH),
            codex_home: codex_home_for_sessions_root_path(&path),
            path,
        })
        .collect();
    let (sessions, _scanned) = parse_codex_candidates_into_summaries(
        candidates,
        workspace_path,
        CodexSessionParseMode::ThreadPreview,
        usize::MAX,
        usize::MAX,
        None,
    )?;
    Ok(sessions)
}

fn codex_home_for_sessions_root_path(path: &Path) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        let Some(name) = ancestor.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if matches!(name, "sessions" | "archived_sessions") {
            return ancestor.parent().map(Path::to_path_buf);
        }
    }
    None
}

fn list_numeric_child_dirs(root: &Path) -> Vec<(i32, PathBuf)> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Ok(value) = name.parse::<i32>() {
            out.push((value, path));
        }
    }
    out
}

fn push_jsonl_candidates_from_dir(
    dir: &Path,
    codex_home: Option<&PathBuf>,
    max_candidates: usize,
    seen: &mut HashSet<PathBuf>,
    candidates: &mut Vec<CodexSessionCandidate>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .collect();
    // Within a day dir, sort by mtime newest first so early stop keeps recent.
    files.sort_by(|left, right| {
        let left_mtime = fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let right_mtime = fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        right_mtime
            .cmp(&left_mtime)
            .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
    });
    for path in files {
        if candidates.len() >= max_candidates {
            return;
        }
        if !seen.insert(path.clone()) {
            continue;
        }
        candidates.push(CodexSessionCandidate {
            modified_at: fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH),
            path,
            codex_home: codex_home.cloned(),
        });
    }
}

fn collect_jsonl_files_capped(
    root: &Path,
    output: &mut Vec<PathBuf>,
    seen: &mut HashSet<PathBuf>,
    max_files: usize,
) {
    if output.len() >= max_files {
        return;
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    for path in paths {
        if output.len() >= max_files {
            return;
        }
        if path.is_dir() {
            collect_jsonl_files_capped(&path, output, seen, max_files);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if seen.insert(path.clone()) {
            output.push(path);
        }
    }
}

