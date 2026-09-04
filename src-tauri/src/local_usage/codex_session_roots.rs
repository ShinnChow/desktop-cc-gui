use super::*;

pub(crate) fn make_day_keys(days: u32) -> Vec<String> {
    let today = Local::now().date_naive();
    (0..days)
        .rev()
        .map(|offset| {
            let day = today - Duration::days(offset as i64);
            day.format("%Y-%m-%d").to_string()
        })
        .collect()
}

fn resolve_codex_sessions_roots(codex_home_override: Option<PathBuf>) -> Vec<PathBuf> {
    let Some(home) = codex_home_override.or_else(resolve_default_codex_home) else {
        return Vec::new();
    };
    vec![home.join("sessions"), home.join("archived_sessions")]
}

fn resolve_managed_codex_provider_session_roots() -> (Vec<PathBuf>, Vec<String>) {
    match app_paths::codex_provider_homes_dir() {
        Ok(provider_homes_root) => {
            resolve_managed_codex_provider_session_roots_from_root(&provider_homes_root)
        }
        Err(error) => (
            Vec::new(),
            vec![format!("codex-provider-homes-unavailable: {error}")],
        ),
    }
}

pub(crate) fn resolve_managed_codex_provider_session_roots_from_root(
    provider_homes_root: &Path,
) -> (Vec<PathBuf>, Vec<String>) {
    let entries = match fs::read_dir(provider_homes_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Vec::new(), Vec::new());
        }
        Err(error) => {
            return (
                Vec::new(),
                vec![format!(
                    "codex-provider-homes-unreadable:{}:{error}",
                    provider_homes_root.display()
                )],
            );
        }
    };

    let mut provider_dirs = Vec::new();
    let mut diagnostics = Vec::new();
    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(format!(
                    "codex-provider-home-entry-unreadable:{}:{error}",
                    provider_homes_root.display()
                ));
                continue;
            }
        };
        let path = entry.path();
        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => provider_dirs.push(path),
            Ok(_) => {}
            Err(error) => diagnostics.push(format!(
                "codex-provider-home-type-unreadable:{}:{error}",
                path.display()
            )),
        }
    }
    provider_dirs.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));

    let roots = provider_dirs
        .into_iter()
        .flat_map(|provider_home| {
            [
                provider_home.join("sessions"),
                provider_home.join("archived_sessions"),
            ]
        })
        .collect();
    (roots, diagnostics)
}

fn normalized_sessions_root_key(root: &Path) -> String {
    #[cfg(windows)]
    {
        normalize_workspace_match_path(&root.to_string_lossy())
    }

    #[cfg(not(windows))]
    {
        normalize_posix_workspace_match_path(&root.to_string_lossy())
    }
}

#[cfg(test)]
pub(crate) fn merge_codex_session_roots(
    override_home: Option<PathBuf>,
    default_home: Option<PathBuf>,
) -> Vec<PathBuf> {
    merge_codex_session_roots_with_provider_homes(override_home, default_home).roots
}

fn push_unique_session_roots(
    roots: &mut Vec<PathBuf>,
    seen_keys: &mut HashSet<String>,
    candidates: impl IntoIterator<Item = PathBuf>,
) {
    for root in candidates {
        if seen_keys.insert(normalized_sessions_root_key(&root)) {
            roots.push(root);
        }
    }
}

fn merge_codex_session_roots_with_provider_homes(
    override_home: Option<PathBuf>,
    default_home: Option<PathBuf>,
) -> CodexSessionRootResolution {
    let mut roots = Vec::new();
    let mut seen_keys = HashSet::new();
    for root in resolve_codex_sessions_roots(override_home) {
        push_unique_session_roots(&mut roots, &mut seen_keys, [root]);
    }

    push_unique_session_roots(
        &mut roots,
        &mut seen_keys,
        default_home
            .map(|home| vec![home.join("sessions"), home.join("archived_sessions")])
            .unwrap_or_default(),
    );

    let (provider_roots, provider_home_diagnostics) =
        resolve_managed_codex_provider_session_roots();
    push_unique_session_roots(&mut roots, &mut seen_keys, provider_roots);

    CodexSessionRootResolution {
        roots,
        provider_home_diagnostics,
    }
}

pub(crate) fn resolve_sessions_roots(
    workspaces: &HashMap<String, WorkspaceEntry>,
    workspace_path: Option<&Path>,
) -> Vec<PathBuf> {
    resolve_sessions_roots_with_diagnostics(workspaces, workspace_path).roots
}

pub(crate) fn resolve_sessions_roots_with_diagnostics(
    workspaces: &HashMap<String, WorkspaceEntry>,
    workspace_path: Option<&Path>,
) -> CodexSessionRootResolution {
    if let Some(workspace_path) = workspace_path {
        let codex_home_override =
            resolve_workspace_codex_home_for_path(workspaces, Some(workspace_path));
        return merge_codex_session_roots_with_provider_homes(
            codex_home_override,
            resolve_default_codex_home(),
        );
    }

    let mut roots = Vec::new();
    let mut seen_keys = HashSet::new();

    push_unique_session_roots(
        &mut roots,
        &mut seen_keys,
        resolve_codex_sessions_roots(None),
    );

    for entry in workspaces.values() {
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id));
        let Some(codex_home) = resolve_workspace_codex_home(entry, parent_entry) else {
            continue;
        };
        push_unique_session_roots(
            &mut roots,
            &mut seen_keys,
            resolve_codex_sessions_roots(Some(codex_home)),
        );
    }

    let (provider_roots, provider_home_diagnostics) =
        resolve_managed_codex_provider_session_roots();
    push_unique_session_roots(&mut roots, &mut seen_keys, provider_roots);

    CodexSessionRootResolution {
        roots,
        provider_home_diagnostics,
    }
}

pub(crate) fn resolve_workspace_codex_home_for_path(
    workspaces: &HashMap<String, crate::types::WorkspaceEntry>,
    workspace_path: Option<&Path>,
) -> Option<PathBuf> {
    let workspace_path = workspace_path?;
    let entry = workspaces
        .values()
        .filter(|entry| {
            path_matches_workspace(&workspace_path.to_string_lossy(), Path::new(&entry.path))
        })
        .max_by_key(|entry| entry.path.len())?;

    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id));

    resolve_workspace_codex_home(entry, parent_entry)
}

pub(crate) fn day_dir_for_key(root: &Path, day_key: &str) -> PathBuf {
    let mut parts = day_key.split('-');
    let year = parts.next().unwrap_or("1970");
    let month = parts.next().unwrap_or("01");
    let day = parts.next().unwrap_or("01");
    root.join(year).join(month).join(day)
}

