use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::backend::app_server::{
    build_codex_app_server_args, resolve_codex_launch_context, CodexAppServerLaunchOptions,
};
use crate::codex::args::{parse_codex_args, resolve_workspace_codex_args};
use crate::types::{AppSettings, WorkspaceEntry};

#[derive(Debug, Clone)]
pub(crate) struct ResolvedCodexLaunchProfile {
    pub(crate) codex_bin: Option<String>,
    pub(crate) codex_args: Option<String>,
    pub(crate) executable_source: String,
    pub(crate) arguments_source: String,
    pub(crate) workspace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexLaunchProfilePreview {
    ok: bool,
    scope: String,
    workspace_id: Option<String>,
    executable_source: String,
    arguments_source: String,
    codex_bin: Option<String>,
    codex_args: Option<String>,
    resolved_executable: String,
    wrapper_kind: String,
    user_arguments: Vec<String>,
    injected_arguments: Vec<String>,
    launch_arguments: Vec<String>,
    path_env_used: Option<String>,
    warnings: Vec<String>,
    details: Option<String>,
    next_launch_only: bool,
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|trimmed| !trimmed.is_empty())
}

fn normalize_optional_draft(value: Option<String>) -> (bool, Option<String>) {
    match value {
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            (true, (!trimmed.is_empty()).then_some(trimmed))
        }
        None => (false, None),
    }
}

fn normalized_settings_value(value: Option<&String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|trimmed| !trimmed.is_empty())
}

pub(crate) fn resolve_global_codex_launch_profile(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    settings: &AppSettings,
) -> ResolvedCodexLaunchProfile {
    let (has_requested_bin, requested_bin) = normalize_optional_draft(codex_bin);
    let (has_requested_args, requested_args) = normalize_optional_draft(codex_args);
    let settings_bin = normalized_settings_value(settings.codex_bin.as_ref());
    let settings_args = normalized_settings_value(settings.codex_args.as_ref());

    let executable_source = if has_requested_bin {
        "draft"
    } else if settings_bin.is_some() {
        "global"
    } else {
        "path"
    };
    let arguments_source = if has_requested_args {
        "draft"
    } else if settings_args.is_some() {
        "global"
    } else {
        "default"
    };

    ResolvedCodexLaunchProfile {
        codex_bin: if has_requested_bin {
            requested_bin
        } else {
            settings_bin
        },
        codex_args: if has_requested_args {
            requested_args
        } else {
            settings_args
        },
        executable_source: executable_source.to_string(),
        arguments_source: arguments_source.to_string(),
        workspace_id: None,
    }
}

fn resolve_workspace_executable_source(entry: &WorkspaceEntry, settings: &AppSettings) -> String {
    if normalized_settings_value(entry.codex_bin.as_ref()).is_some() {
        "workspace".to_string()
    } else if normalized_settings_value(settings.codex_bin.as_ref()).is_some() {
        "global".to_string()
    } else {
        "path".to_string()
    }
}

fn resolve_workspace_arguments_source(
    entry: &WorkspaceEntry,
    parent_entry: Option<&WorkspaceEntry>,
    settings: &AppSettings,
) -> String {
    if normalized_settings_value(entry.settings.codex_args.as_ref()).is_some() {
        return "workspace".to_string();
    }
    if entry.kind.is_worktree()
        && parent_entry
            .and_then(|parent| normalized_settings_value(parent.settings.codex_args.as_ref()))
            .is_some()
    {
        return "parent-workspace".to_string();
    }
    if normalized_settings_value(settings.codex_args.as_ref()).is_some() {
        "global".to_string()
    } else {
        "default".to_string()
    }
}

pub(crate) fn resolve_workspace_codex_launch_profile(
    workspace_id: &str,
    codex_bin: Option<String>,
    codex_args: Option<String>,
    use_workspace_draft: bool,
    workspaces: &HashMap<String, WorkspaceEntry>,
    settings: &AppSettings,
) -> Result<ResolvedCodexLaunchProfile, String> {
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("workspace not found: {workspace_id}"))?;
    let mut effective_entry = entry.clone();
    if use_workspace_draft {
        effective_entry.codex_bin = normalize_optional_string(codex_bin);
        effective_entry.settings.codex_args = normalize_optional_string(codex_args);
    }

    let parent_entry = effective_entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id));
    let executable_source = resolve_workspace_executable_source(&effective_entry, settings);
    let arguments_source =
        resolve_workspace_arguments_source(&effective_entry, parent_entry, settings);
    let resolved_bin = normalized_settings_value(effective_entry.codex_bin.as_ref())
        .or_else(|| normalized_settings_value(settings.codex_bin.as_ref()));
    let resolved_args =
        resolve_workspace_codex_args(&effective_entry, parent_entry, Some(settings));

    Ok(ResolvedCodexLaunchProfile {
        codex_bin: resolved_bin,
        codex_args: resolved_args,
        executable_source,
        arguments_source,
        workspace_id: Some(workspace_id.to_string()),
    })
}

fn build_preview(scope: &str, profile: ResolvedCodexLaunchProfile) -> CodexLaunchProfilePreview {
    let launch_context = resolve_codex_launch_context(profile.codex_bin.as_deref());
    let parsed_user_arguments = parse_codex_args(profile.codex_args.as_deref());
    let launch_arguments = build_codex_app_server_args(
        profile.codex_args.as_deref(),
        CodexAppServerLaunchOptions::primary(),
    );

    match (parsed_user_arguments, launch_arguments) {
        (Ok(user_arguments), Ok(launch_arguments)) => {
            let injected_arguments = launch_arguments
                .iter()
                .skip(user_arguments.len())
                .cloned()
                .collect();
            CodexLaunchProfilePreview {
                ok: true,
                scope: scope.to_string(),
                workspace_id: profile.workspace_id,
                executable_source: profile.executable_source,
                arguments_source: profile.arguments_source,
                codex_bin: profile.codex_bin,
                codex_args: profile.codex_args,
                resolved_executable: launch_context.resolved_bin,
                wrapper_kind: launch_context.wrapper_kind.to_string(),
                user_arguments,
                injected_arguments,
                launch_arguments,
                path_env_used: launch_context.path_env,
                warnings: Vec::new(),
                details: None,
                next_launch_only: true,
            }
        }
        (Err(error), _) | (_, Err(error)) => CodexLaunchProfilePreview {
            ok: false,
            scope: scope.to_string(),
            workspace_id: profile.workspace_id,
            executable_source: profile.executable_source,
            arguments_source: profile.arguments_source,
            codex_bin: profile.codex_bin,
            codex_args: profile.codex_args,
            resolved_executable: launch_context.resolved_bin,
            wrapper_kind: launch_context.wrapper_kind.to_string(),
            user_arguments: Vec::new(),
            injected_arguments: Vec::new(),
            launch_arguments: Vec::new(),
            path_env_used: launch_context.path_env,
            warnings: Vec::new(),
            details: Some(error),
            next_launch_only: true,
        },
    }
}

pub(crate) fn preview_global_codex_launch_profile(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    settings: &AppSettings,
) -> Value {
    let profile = resolve_global_codex_launch_profile(codex_bin, codex_args, settings);
    serde_json::to_value(build_preview("global", profile)).unwrap_or(Value::Null)
}

pub(crate) fn preview_workspace_codex_launch_profile(
    workspace_id: &str,
    codex_bin: Option<String>,
    codex_args: Option<String>,
    use_workspace_draft: bool,
    workspaces: &HashMap<String, WorkspaceEntry>,
    settings: &AppSettings,
) -> Result<Value, String> {
    let profile = resolve_workspace_codex_launch_profile(
        workspace_id,
        codex_bin,
        codex_args,
        use_workspace_draft,
        workspaces,
        settings,
    )?;
    Ok(serde_json::to_value(build_preview("workspace", profile)).unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::{
        preview_workspace_codex_launch_profile, resolve_global_codex_launch_profile,
        resolve_workspace_codex_launch_profile,
    };
    use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use std::collections::HashMap;

    fn workspace(id: &str, kind: WorkspaceKind) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: format!("/tmp/{id}"),
            codex_bin: None,
            kind,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    #[test]
    fn global_profile_prefers_draft_before_settings() {
        let mut settings = AppSettings::default();
        settings.codex_bin = Some("/global/codex".to_string());
        settings.codex_args = Some("--profile global".to_string());

        let resolved = resolve_global_codex_launch_profile(
            Some(" /draft/codex ".to_string()),
            Some(" --profile draft ".to_string()),
            &settings,
        );

        assert_eq!(resolved.codex_bin.as_deref(), Some("/draft/codex"));
        assert_eq!(resolved.codex_args.as_deref(), Some("--profile draft"));
        assert_eq!(resolved.executable_source, "draft");
        assert_eq!(resolved.arguments_source, "draft");
    }

    #[test]
    fn global_profile_allows_draft_clear_before_settings() {
        let mut settings = AppSettings::default();
        settings.codex_bin = Some("/global/codex".to_string());
        settings.codex_args = Some("--profile global".to_string());

        let resolved = resolve_global_codex_launch_profile(
            Some(" ".to_string()),
            Some(" ".to_string()),
            &settings,
        );

        assert_eq!(resolved.codex_bin, None);
        assert_eq!(resolved.codex_args, None);
        assert_eq!(resolved.executable_source, "draft");
        assert_eq!(resolved.arguments_source, "draft");
    }

    #[test]
    fn workspace_profile_uses_workspace_bin_before_global() {
        let mut settings = AppSettings::default();
        settings.codex_bin = Some("/global/codex".to_string());
        let mut entry = workspace("main", WorkspaceKind::Main);
        entry.codex_bin = Some(" /workspace/codex ".to_string());
        let workspaces = HashMap::from([(entry.id.clone(), entry)]);

        let resolved = resolve_workspace_codex_launch_profile(
            "main",
            None,
            None,
            false,
            &workspaces,
            &settings,
        )
        .expect("resolve workspace profile");

        assert_eq!(resolved.codex_bin.as_deref(), Some("/workspace/codex"));
        assert_eq!(resolved.executable_source, "workspace");
    }

    #[test]
    fn worktree_profile_inherits_parent_args_before_global() {
        let mut settings = AppSettings::default();
        settings.codex_args = Some("--profile global".to_string());
        let mut parent = workspace("parent", WorkspaceKind::Main);
        parent.settings.codex_args = Some("--profile parent".to_string());
        let mut child = workspace("child", WorkspaceKind::Worktree);
        child.parent_id = Some(parent.id.clone());
        let workspaces = HashMap::from([(parent.id.clone(), parent), (child.id.clone(), child)]);

        let resolved = resolve_workspace_codex_launch_profile(
            "child",
            None,
            None,
            false,
            &workspaces,
            &settings,
        )
        .expect("resolve workspace profile");

        assert_eq!(resolved.codex_args.as_deref(), Some("--profile parent"));
        assert_eq!(resolved.arguments_source, "parent-workspace");
    }

    #[test]
    fn workspace_preview_reports_invalid_args_without_throwing() {
        let settings = AppSettings::default();
        let entry = workspace("main", WorkspaceKind::Main);
        let workspaces = HashMap::from([(entry.id.clone(), entry)]);

        let preview = preview_workspace_codex_launch_profile(
            "main",
            None,
            Some("--profile 'unterminated".to_string()),
            true,
            &workspaces,
            &settings,
        )
        .expect("preview should be structured");

        assert_eq!(preview["ok"], false);
        assert!(preview["details"]
            .as_str()
            .is_some_and(|details| details.contains("Invalid Codex args")));
    }
}
