use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub(crate) enum WorkspaceSessionAttributionMode {
    #[default]
    Related,
    WorkspaceOnly,
}

impl WorkspaceSessionAttributionMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Related => "related",
            Self::WorkspaceOnly => "workspace-only",
        }
    }

    fn from_persisted_value(value: &str) -> Self {
        match value.trim() {
            "workspace-only" => Self::WorkspaceOnly,
            _ => Self::Related,
        }
    }
}

impl<'de> Deserialize<'de> for WorkspaceSessionAttributionMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(match value {
            serde_json::Value::String(value) => Self::from_persisted_value(&value),
            _ => Self::default(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct BranchInfo {
    pub(crate) name: String,
    pub(crate) last_commit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) codex_bin: Option<String>,
    #[serde(default)]
    pub(crate) kind: WorkspaceKind,
    #[serde(default, rename = "parentId")]
    pub(crate) parent_id: Option<String>,
    #[serde(default)]
    pub(crate) worktree: Option<WorktreeInfo>,
    #[serde(default)]
    pub(crate) settings: WorkspaceSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) connected: bool,
    pub(crate) codex_bin: Option<String>,
    #[serde(default)]
    pub(crate) kind: WorkspaceKind,
    #[serde(default, rename = "parentId")]
    pub(crate) parent_id: Option<String>,
    #[serde(default)]
    pub(crate) worktree: Option<WorktreeInfo>,
    #[serde(default)]
    pub(crate) settings: WorkspaceSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub(crate) enum WorkspaceKind {
    #[default]
    Main,
    Worktree,
}

impl WorkspaceKind {
    pub(crate) fn is_worktree(&self) -> bool {
        matches!(self, WorkspaceKind::Worktree)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorktreeInfo {
    pub(crate) branch: String,
    #[serde(default, rename = "baseRef")]
    pub(crate) base_ref: Option<String>,
    #[serde(default, rename = "baseCommit")]
    pub(crate) base_commit: Option<String>,
    #[serde(default)]
    pub(crate) tracking: Option<String>,
    #[serde(default, rename = "publishError")]
    pub(crate) publish_error: Option<String>,
    #[serde(default, rename = "publishRetryCommand")]
    pub(crate) publish_retry_command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceGroup {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, rename = "sortOrder")]
    pub(crate) sort_order: Option<u32>,
    #[serde(default, rename = "copiesFolder")]
    pub(crate) copies_folder: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct WorkspaceSettings {
    #[serde(default, rename = "sidebarCollapsed")]
    pub(crate) sidebar_collapsed: bool,
    #[serde(default, rename = "visibleThreadRootCount")]
    pub(crate) visible_thread_root_count: Option<u32>,
    #[serde(default, rename = "sortOrder")]
    pub(crate) sort_order: Option<u32>,
    #[serde(default, rename = "groupId")]
    pub(crate) group_id: Option<String>,
    #[serde(default, rename = "projectAlias")]
    pub(crate) project_alias: Option<String>,
    #[serde(default, rename = "gitRoot")]
    pub(crate) git_root: Option<String>,
    #[serde(default, rename = "codexHome")]
    pub(crate) codex_home: Option<String>,
    #[serde(default, rename = "codexArgs")]
    pub(crate) codex_args: Option<String>,
    #[serde(default, rename = "launchScript")]
    pub(crate) launch_script: Option<String>,
    #[serde(default, rename = "launchScripts")]
    pub(crate) launch_scripts: Option<Vec<LaunchScriptEntry>>,
    #[serde(default, rename = "worktreeSetupScript")]
    pub(crate) worktree_setup_script: Option<String>,
    /// Engine type for this workspace: "claude" or "codex". If not set, use app default.
    #[serde(default, rename = "engineType")]
    pub(crate) engine_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct LaunchScriptEntry {
    pub(crate) id: String,
    pub(crate) script: String,
    pub(crate) icon: String,
    #[serde(default)]
    pub(crate) label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorktreeSetupStatus {
    #[serde(rename = "shouldRun")]
    pub(crate) should_run: bool,
    pub(crate) script: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct OpenAppTarget {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    #[serde(default, rename = "appName")]
    pub(crate) app_name: Option<String>,
    #[serde(default)]
    pub(crate) command: Option<String>,
    #[serde(default)]
    pub(crate) args: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CodexUnifiedExecPolicy {
    #[default]
    Inherit,
    ForceEnabled,
    ForceDisabled,
}

impl CodexUnifiedExecPolicy {
    pub(crate) fn explicit_value(self) -> Option<bool> {
        match self {
            Self::Inherit => None,
            Self::ForceEnabled => Some(true),
            Self::ForceDisabled => Some(false),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexUnifiedExecExternalStatus {
    pub(crate) config_path: Option<String>,
    pub(crate) has_explicit_unified_exec: bool,
    pub(crate) explicit_unified_exec_value: Option<bool>,
    pub(crate) official_default_enabled: bool,
}

