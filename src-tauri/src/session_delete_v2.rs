//! Session delete v2：Index First 定位 + 受控并发执行 + 标记优先（marker-first）结算。
//!
//! Canonical 设计：`docs/plans/2026-08-24-session-delete-architecture-redesign.md`
//! OpenSpec change：`openspec/changes/redesign-session-delete-architecture/`
//!
//! 与旧 `delete_workspace_sessions` 的根本差异：
//! - 定位走 session index 点查 / engine 前缀定向，禁止全量 catalog 扫描；
//! - 用户确认即 tombstone（标记优先），物理删除失败返回 `MARKED_DELETED`，
//!   侧栏保持隐藏，残留由进程内有界重试收尾；
//! - 命令立即返回 requestId，结果经 `session-delete:progress` /
//!   `session-delete:settled` 事件通道回推。

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, Semaphore};

use crate::engine::dsh::host::DshHostClient;
use crate::engine::{self, EngineManager};
use crate::session_index::store as session_index_store;
use crate::session_management;
use crate::state::AppState;
use crate::types::WorkspaceEntry;

pub(crate) const SESSION_DELETE_PROGRESS_EVENT: &str = "session-delete:progress";
pub(crate) const SESSION_DELETE_SETTLED_EVENT: &str = "session-delete:settled";

const DELETE_CONCURRENCY: usize = 4;
const EXECUTE_TIMEOUT: Duration = Duration::from_secs(10);
const DSH_EXECUTE_TIMEOUT: Duration = Duration::from_secs(15);
const DSH_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(5);

/// 统一删除结果码（canonical 见设计文档 §4.2）。
pub(crate) mod codes {
    pub const OK: &str = "OK";
    pub const ALREADY_MISSING: &str = "ALREADY_MISSING";
    pub const GHOST_CLEANED: &str = "GHOST_CLEANED";
    pub const MARKED_DELETED: &str = "MARKED_DELETED";
    #[allow(dead_code)]
    pub const INDEX_MISS: &str = "INDEX_MISS";
    pub const ENGINE_UNSUPPORTED: &str = "ENGINE_UNSUPPORTED";
    pub const ENGINE_BUSY: &str = "ENGINE_BUSY";
    pub const IO_FAILED: &str = "IO_FAILED";
    pub const METADATA_CLEANUP_FAILED: &str = "METADATA_CLEANUP_FAILED";
    pub const REQUEST_TIMEOUT: &str = "REQUEST_TIMEOUT";
}

/// v2 支持物理删除的 engine 集合（resolve/classify 阶段判定，不进入标记阶段）。
const SUPPORTED_DELETE_ENGINES: &[&str] = &[
    "codex", "claude", "gemini", "kimi", "grok", "pi", "omp", "qoder", "dsh", "opencode", "shared",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDeleteV2Target {
    pub thread_id: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub native_session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteWorkspaceSessionsV2Request {
    pub workspace_id: String,
    pub targets: Vec<SessionDeleteV2Target>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteWorkspaceSessionsV2Response {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDeleteV2Result {
    pub session_id: String,
    pub ok: bool,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDeleteProgressPayload {
    request_id: String,
    done: usize,
    total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDeleteSettledPayload {
    request_id: String,
    results: Vec<SessionDeleteV2Result>,
}

impl SessionDeleteV2Result {
    fn success(thread_id: &str, code: &str) -> Self {
        Self {
            session_id: thread_id.to_string(),
            ok: true,
            code: code.to_string(),
            error: None,
        }
    }

    fn failure(thread_id: &str, code: &str, error: impl Into<String>) -> Self {
        Self {
            session_id: thread_id.to_string(),
            ok: false,
            code: code.to_string(),
            error: Some(error.into()),
        }
    }
}

/// threadId 前缀解析：`claude:abc` → ("claude", "abc")；`shared:` 与已知
/// engine 前缀有效；裸 id（codex）或未知前缀返回 None。
fn parse_engine_hint(thread_id: &str) -> Option<(String, String)> {
    let (head, rest) = thread_id.split_once(':')?;
    let head = head.trim().to_ascii_lowercase();
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }
    if head == "shared" || session_index_store::INDEX_LIST_ENGINES.contains(&head.as_str()) {
        Some((head, rest.to_string()))
    } else {
        None
    }
}

#[derive(Debug, Clone)]
struct ResolvedDeleteTarget {
    thread_id: String,
    engine: String,
    native_session_id: String,
    owner_workspace_id: String,
    owner_workspace_path: PathBuf,
    physical_path: Option<PathBuf>,
    provider_profile_id: Option<String>,
    /// index 行已被 tombstone（重试路径：跳过重复标记，仍执行物理删除）。
    already_tombstoned: bool,
    /// index 与 engine 前缀都无法定位：只摘 index 行，不碰磁盘。
    ghost: bool,
}

/// 物理删除计划（MARKED_DELETED 重试用）。opencode / dsh 依赖运行时句柄，不进重试队列。
enum PhysicalDeletePlan {
    CodexFile {
        path: PathBuf,
    },
    CodexLocate {
        session_id: String,
        sessions_roots: Vec<PathBuf>,
    },
    Claude {
        workspace_path: PathBuf,
        session_id: String,
    },
    Gemini {
        workspace_path: PathBuf,
        session_id: String,
    },
    Kimi {
        workspace_path: PathBuf,
        session_id: String,
    },
    Grok {
        workspace_path: PathBuf,
        session_id: String,
    },
    Pi {
        workspace_path: PathBuf,
        session_id: String,
    },
    Omp {
        workspace_path: PathBuf,
        session_id: String,
    },
    Qoder {
        workspace_id: String,
        workspace_path: PathBuf,
        session_id: String,
        provider_profile_id: Option<String>,
    },
    Shared {
        owner_workspace_id: String,
        thread_id: String,
    },
    OpenCode,
    Dsh,
}

type BoxedDeleteFuture<'a> = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;

/// MARKED_DELETED 残留重试闭包：仅清磁盘残留，不动删除标记（'static 自持）。
type RetryFn =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

struct EngineDeleteConfigs {
    claude_config: Option<engine::EngineConfig>,
    gemini_home_dir: Option<String>,
    kimi_home_dir: Option<String>,
    grok_home_dir: Option<String>,
    pi_home_dir: Option<String>,
    omp_home_dir: Option<String>,
    qoder_distribution_settings: crate::engine::qoder_provider_profile::QoderDistributionSettings,
}

/// Resolve 阶段：index 点查结果优选 + engine 前缀定向 + ghost 判定（纯函数，可单测）。
fn resolve_one_target(
    target: &SessionDeleteV2Target,
    lookups: &[session_index_store::SessionIndexDeleteLookup],
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    requesting_workspace_id: &str,
) -> Result<ResolvedDeleteTarget, SessionDeleteV2Result> {
    let thread_id = target.thread_id.trim().to_string();
    if thread_id.is_empty() {
        return Err(SessionDeleteV2Result::failure(
            &target.thread_id,
            codes::IO_FAILED,
            "empty session id",
        ));
    }
    let prefix_hint = parse_engine_hint(&thread_id);
    let explicit_engine = target
        .engine
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .filter(|engine| {
            SUPPORTED_DELETE_ENGINES.contains(&engine.as_str())
                || session_index_store::INDEX_LIST_ENGINES.contains(&engine.as_str())
        });
    let engine_hint =
        explicit_engine.or_else(|| prefix_hint.as_ref().map(|(engine, _)| engine.clone()));

    // index 行优选：engine 匹配 > 未 tombstone > workspace_path 匹配 > updated_at 最新
    let requesting_path = workspaces_snapshot
        .get(requesting_workspace_id)
        .map(|entry| entry.path.clone());
    let mut candidates: Vec<&session_index_store::SessionIndexDeleteLookup> =
        lookups.iter().collect();
    if let Some(engine) = &engine_hint {
        let engine_matches: Vec<_> = candidates
            .iter()
            .copied()
            .filter(|hit| hit.row.engine.eq_ignore_ascii_case(engine))
            .collect();
        if !engine_matches.is_empty() {
            candidates = engine_matches;
        }
    }
    candidates.sort_by(|left, right| {
        let left_active = left.tombstoned_at.is_none();
        let right_active = right.tombstoned_at.is_none();
        right_active
            .cmp(&left_active)
            .then_with(|| {
                let left_ws = requesting_path.is_some()
                    && left.row.workspace_path.as_ref() == requesting_path.as_ref();
                let right_ws = requesting_path.is_some()
                    && right.row.workspace_path.as_ref() == requesting_path.as_ref();
                right_ws.cmp(&left_ws)
            })
            .then_with(|| right.row.updated_at.cmp(&left.row.updated_at))
    });

    if let Some(hit) = candidates.first() {
        let row = &hit.row;
        let (owner_workspace_id, owner_workspace_path) = row
            .workspace_path
            .as_ref()
            .and_then(|path| {
                workspaces_snapshot
                    .iter()
                    .find(|(_, entry)| entry.path == *path)
                    .map(|(id, entry)| (id.clone(), PathBuf::from(&entry.path)))
            })
            .unwrap_or_else(|| {
                (
                    requesting_workspace_id.to_string(),
                    requesting_path
                        .as_ref()
                        .map(PathBuf::from)
                        .unwrap_or_default(),
                )
            });
        return Ok(ResolvedDeleteTarget {
            thread_id,
            engine: row.engine.clone(),
            native_session_id: row.session_id.clone(),
            owner_workspace_id,
            owner_workspace_path,
            physical_path: row.physical_path.as_ref().map(PathBuf::from),
            provider_profile_id: row.provider_profile_id.clone(),
            already_tombstoned: hit.tombstoned_at.is_some(),
            ghost: false,
        });
    }

    // index miss：engine 前缀 / 前端显式 engine 定向（deleter 按约定路径自行定位）
    if let Some(engine) = engine_hint {
        let native = target
            .native_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or_else(|| prefix_hint.as_ref().map(|(_, bare)| bare.clone()))
            .unwrap_or_else(|| thread_id.clone());
        return Ok(ResolvedDeleteTarget {
            thread_id,
            engine,
            native_session_id: native,
            owner_workspace_id: requesting_workspace_id.to_string(),
            owner_workspace_path: requesting_path
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_default(),
            physical_path: None,
            provider_profile_id: None,
            already_tombstoned: false,
            ghost: false,
        });
    }

    // 既无 index 行也无 engine 线索：幽灵行，只摘 index 不碰磁盘。
    Ok(ResolvedDeleteTarget {
        thread_id: thread_id.clone(),
        engine: String::new(),
        native_session_id: thread_id.clone(),
        owner_workspace_id: requesting_workspace_id.to_string(),
        owner_workspace_path: requesting_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_default(),
        physical_path: None,
        provider_profile_id: None,
        already_tombstoned: false,
        ghost: true,
    })
}

fn build_retry_for_plan(
    plan: &PhysicalDeletePlan,
    configs: &EngineDeleteConfigs,
) -> Option<RetryFn> {
    match plan {
        PhysicalDeletePlan::CodexFile { path } => {
            let path = path.clone();
            Some(Arc::new(move || {
                let path = path.clone();
                Box::pin(async move {
                    tokio::task::spawn_blocking(move || {
                        crate::local_usage::delete_codex_session_file_at(&path).map(|_| ())
                    })
                    .await
                    .map_err(|error| error.to_string())?
                })
            }))
        }
        PhysicalDeletePlan::CodexLocate {
            session_id,
            sessions_roots,
        } => {
            let session_id = session_id.clone();
            let sessions_roots = sessions_roots.clone();
            Some(Arc::new(move || {
                let session_id = session_id.clone();
                let sessions_roots = sessions_roots.clone();
                Box::pin(async move {
                    tokio::task::spawn_blocking(move || {
                        let Some(path) = crate::local_usage::locate_codex_session_file_fast(
                            &session_id,
                            &sessions_roots,
                        ) else {
                            return Ok(());
                        };
                        crate::local_usage::delete_codex_session_file_at(&path).map(|_| ())
                    })
                    .await
                    .map_err(|error| error.to_string())?
                })
            }))
        }
        PhysicalDeletePlan::Claude {
            workspace_path,
            session_id,
        } => {
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let config = configs.claude_config.clone();
            Some(Arc::new(move || {
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let config = config.clone();
                Box::pin(async move {
                    engine::claude_history::delete_claude_session_with_config(
                        &workspace_path,
                        &session_id,
                        config.as_ref(),
                    )
                    .await
                    .map(|_| ())
                })
            }))
        }
        PhysicalDeletePlan::Gemini {
            workspace_path,
            session_id,
        } => {
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let home = configs.gemini_home_dir.clone();
            Some(Arc::new(move || {
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let home = home.clone();
                Box::pin(async move {
                    engine::gemini_history::delete_gemini_session(
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                })
            }))
        }
        PhysicalDeletePlan::Kimi {
            workspace_path,
            session_id,
        } => {
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let home = configs.kimi_home_dir.clone();
            Some(Arc::new(move || {
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let home = home.clone();
                Box::pin(async move {
                    engine::kimi_history::delete_kimi_session(
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                })
            }))
        }
        PhysicalDeletePlan::Grok {
            workspace_path,
            session_id,
        } => {
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let home = configs.grok_home_dir.clone();
            Some(Arc::new(move || {
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let home = home.clone();
                Box::pin(async move {
                    engine::grok_history::delete_grok_session(
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                })
            }))
        }
        PhysicalDeletePlan::Pi {
            workspace_path,
            session_id,
        } => {
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let home = configs.pi_home_dir.clone();
            Some(Arc::new(move || {
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let home = home.clone();
                Box::pin(async move {
                    engine::pi_history::delete_pi_family_session(
                        engine::EngineType::Pi,
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                })
            }))
        }
        PhysicalDeletePlan::Omp {
            workspace_path,
            session_id,
        } => {
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let home = configs.omp_home_dir.clone();
            Some(Arc::new(move || {
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let home = home.clone();
                Box::pin(async move {
                    engine::pi_history::delete_pi_family_session(
                        engine::EngineType::Omp,
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                })
            }))
        }
        PhysicalDeletePlan::Qoder {
            workspace_id,
            workspace_path,
            session_id,
            provider_profile_id,
        } => {
            let workspace_id = workspace_id.clone();
            let workspace_path = workspace_path.clone();
            let session_id = session_id.clone();
            let provider_profile_id = provider_profile_id.clone();
            let settings = configs.qoder_distribution_settings.clone();
            Some(Arc::new(move || {
                let workspace_id = workspace_id.clone();
                let workspace_path = workspace_path.clone();
                let session_id = session_id.clone();
                let provider_profile_id = provider_profile_id.clone();
                let settings = settings.clone();
                Box::pin(async move {
                    let launch_profile =
                        engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
                            &workspace_id,
                            provider_profile_id.as_deref(),
                            &settings,
                        )?;
                    engine::qoder_history::delete_qoder_session_for_launch_profile(
                        &workspace_path,
                        &session_id,
                        &launch_profile,
                    )
                    .await
                })
            }))
        }
        PhysicalDeletePlan::Shared {
            owner_workspace_id,
            thread_id,
        } => {
            let owner_workspace_id = owner_workspace_id.clone();
            let thread_id = thread_id.clone();
            Some(Arc::new(move || {
                let owner_workspace_id = owner_workspace_id.clone();
                let thread_id = thread_id.clone();
                Box::pin(async move {
                    tokio::task::spawn_blocking(move || {
                        crate::shared_sessions::delete_shared_session_files(
                            &owner_workspace_id,
                            &thread_id,
                        )
                        .map(|_| ())
                    })
                    .await
                    .map_err(|error| error.to_string())?
                })
            }))
        }
        // opencode / dsh 依赖运行时句柄，残留只记日志，不进重试队列。
        PhysicalDeletePlan::OpenCode | PhysicalDeletePlan::Dsh => None,
    }
}

/// MARKED_DELETED 残留的有界重试（5s / 30s）：只清磁盘，不动标记，不打扰侧栏。
fn schedule_residual_retry(label: String, retry: RetryFn) {
    tokio::spawn(async move {
        for delay in [Duration::from_secs(5), Duration::from_secs(30)] {
            tokio::time::sleep(delay).await;
            match retry().await {
                Ok(()) => {
                    log::info!("[session_delete_v2] residual cleanup succeeded for {label}");
                    return;
                }
                Err(error) => {
                    log::warn!("[session_delete_v2] residual cleanup failed for {label}: {error}");
                }
            }
        }
    });
}

/// 构造单目标的物理删除 future 与可重试计划。
/// opencode 需要借用 workspaces / engine_manager，故 future 生命周期挂 'a。
fn build_delete_execution<'a>(
    target: &ResolvedDeleteTarget,
    configs: &Arc<EngineDeleteConfigs>,
    dsh_client: Option<Arc<DshHostClient>>,
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    workspaces: &'a Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &'a EngineManager,
) -> (PhysicalDeletePlan, BoxedDeleteFuture<'a>) {
    match target.engine.as_str() {
        "codex" => {
            if let Some(path) = target.physical_path.clone() {
                let future_path = path.clone();
                (
                    PhysicalDeletePlan::CodexFile { path },
                    Box::pin(async move {
                        tokio::task::spawn_blocking(move || {
                            crate::local_usage::delete_codex_session_file_at(&future_path)
                                .map(|_| ())
                        })
                        .await
                        .map_err(|error| error.to_string())?
                    }),
                )
            } else {
                let session_id = target.native_session_id.clone();
                let missing_id = target.native_session_id.clone();
                let sessions_roots = crate::local_usage::resolve_sessions_roots(
                    workspaces_snapshot,
                    Some(target.owner_workspace_path.as_path()),
                );
                let future_roots = sessions_roots.clone();
                (
                    PhysicalDeletePlan::CodexLocate {
                        session_id,
                        sessions_roots,
                    },
                    Box::pin(async move {
                        tokio::task::spawn_blocking(move || {
                            let Some(path) = crate::local_usage::locate_codex_session_file_fast(
                                &missing_id,
                                &future_roots,
                            ) else {
                                return Err(format!(
                                    "codex session file not found for session {missing_id}"
                                ));
                            };
                            crate::local_usage::delete_codex_session_file_at(&path).map(|_| ())
                        })
                        .await
                        .map_err(|error| error.to_string())?
                    }),
                )
            }
        }
        "claude" => {
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let config = configs.claude_config.clone();
            (
                PhysicalDeletePlan::Claude {
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                },
                Box::pin(async move {
                    engine::claude_history::delete_claude_session_with_config(
                        &workspace_path,
                        &session_id,
                        config.as_ref(),
                    )
                    .await
                    .map(|_| ())
                }),
            )
        }
        "gemini" => {
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let home = configs.gemini_home_dir.clone();
            (
                PhysicalDeletePlan::Gemini {
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                },
                Box::pin(async move {
                    engine::gemini_history::delete_gemini_session(
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                }),
            )
        }
        "kimi" => {
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let home = configs.kimi_home_dir.clone();
            (
                PhysicalDeletePlan::Kimi {
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                },
                Box::pin(async move {
                    engine::kimi_history::delete_kimi_session(
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                }),
            )
        }
        "grok" => {
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let home = configs.grok_home_dir.clone();
            (
                PhysicalDeletePlan::Grok {
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                },
                Box::pin(async move {
                    engine::grok_history::delete_grok_session(
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                }),
            )
        }
        "pi" => {
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let home = configs.pi_home_dir.clone();
            (
                PhysicalDeletePlan::Pi {
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                },
                Box::pin(async move {
                    engine_manager
                        .drop_pi_resident_by_session_id(&session_id)
                        .await;
                    engine::pi_history::delete_pi_family_session(
                        engine::EngineType::Pi,
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                }),
            )
        }
        "omp" => {
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let home = configs.omp_home_dir.clone();
            (
                PhysicalDeletePlan::Omp {
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                },
                Box::pin(async move {
                    engine_manager
                        .drop_omp_resident_by_session_id(&session_id)
                        .await;
                    engine::pi_history::delete_pi_family_session(
                        engine::EngineType::Omp,
                        &workspace_path,
                        &session_id,
                        home.as_deref(),
                    )
                    .await
                }),
            )
        }
        "qoder" => {
            let workspace_id = target.owner_workspace_id.clone();
            let workspace_path = target.owner_workspace_path.clone();
            let session_id = target.native_session_id.clone();
            let provider_profile_id = target.provider_profile_id.clone();
            let settings = configs.qoder_distribution_settings.clone();
            (
                PhysicalDeletePlan::Qoder {
                    workspace_id: workspace_id.clone(),
                    workspace_path: workspace_path.clone(),
                    session_id: session_id.clone(),
                    provider_profile_id: provider_profile_id.clone(),
                },
                Box::pin(async move {
                    let launch_profile =
                        engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
                            &workspace_id,
                            provider_profile_id.as_deref(),
                            &settings,
                        )?;
                    engine::qoder_history::delete_qoder_session_for_launch_profile(
                        &workspace_path,
                        &session_id,
                        &launch_profile,
                    )
                    .await
                }),
            )
        }
        "shared" => {
            let owner_workspace_id = target.owner_workspace_id.clone();
            let thread_id = if target.thread_id.starts_with("shared:") {
                target.thread_id.clone()
            } else {
                format!("shared:{}", target.native_session_id)
            };
            let future_owner = owner_workspace_id.clone();
            let future_thread = thread_id.clone();
            (
                PhysicalDeletePlan::Shared {
                    owner_workspace_id,
                    thread_id,
                },
                Box::pin(async move {
                    tokio::task::spawn_blocking(move || {
                        crate::shared_sessions::delete_shared_session_files(
                            &future_owner,
                            &future_thread,
                        )
                        .map(|_| ())
                    })
                    .await
                    .map_err(|error| error.to_string())?
                }),
            )
        }
        "dsh" => {
            let session_id = target.native_session_id.clone();
            (
                PhysicalDeletePlan::Dsh,
                Box::pin(async move {
                    let client = dsh_client.ok_or_else(|| "dsh daemon unavailable".to_string())?;
                    crate::engine::dsh::history::archive_dsh_session(&client, &session_id).await
                }),
            )
        }
        "opencode" => {
            let owner_workspace_id = target.owner_workspace_id.clone();
            let session_id = target.native_session_id.clone();
            (
                PhysicalDeletePlan::OpenCode,
                Box::pin(async move {
                    engine::commands::opencode_delete_session_core(
                        workspaces,
                        engine_manager,
                        &owner_workspace_id,
                        &session_id,
                    )
                    .await
                    .map(|_| ())
                }),
            )
        }
        other => {
            let engine = other.to_string();
            (
                PhysicalDeletePlan::OpenCode,
                Box::pin(async move { Err(format!("unsupported delete engine: {engine}")) }),
            )
        }
    }
}

/// v2 删除 orchestrator（可脱离 Tauri 单测）。
/// 顺序：resolve → classify（unsupported 快速失败）→ dsh pre-flight →
/// tombstone（标记优先）→ execute（受控并发 + 超时）→ catalog 元数据清理。
pub(crate) async fn run_session_delete_v2(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &EngineManager,
    storage_path: &std::path::Path,
    workspace_id: &str,
    targets: Vec<SessionDeleteV2Target>,
    progress: &(dyn Fn(usize, usize) + Send + Sync),
) -> Vec<SessionDeleteV2Result> {
    let total = targets.len();
    let mut done = 0usize;
    let mut results_by_thread_id: HashMap<String, SessionDeleteV2Result> = HashMap::new();
    let complete = |results_by_thread_id: &mut HashMap<String, SessionDeleteV2Result>,
                    done: &mut usize,
                    result: SessionDeleteV2Result| {
        *done += 1;
        results_by_thread_id.insert(result.session_id.clone(), result);
        progress(*done, total);
    };

    let workspaces_snapshot = Arc::new(workspaces.lock().await.clone());

    // ---- Resolve：index 点查（单次连接批量查询） ----
    let lookup_ids: Vec<String> = targets
        .iter()
        .map(|target| target.thread_id.trim().to_string())
        .collect();
    let lookups_by_thread_id: HashMap<String, Vec<session_index_store::SessionIndexDeleteLookup>> =
        tokio::task::spawn_blocking({
            let lookup_ids = lookup_ids.clone();
            move || {
                let mut map = HashMap::new();
                if let Ok(connection) = session_index_store::open_connection() {
                    for id in lookup_ids {
                        let rows = session_index_store::lookup_rows_for_delete(&connection, &id)
                            .unwrap_or_default();
                        map.insert(id, rows);
                    }
                }
                map
            }
        })
        .await
        .unwrap_or_default();

    let mut resolved_targets: Vec<ResolvedDeleteTarget> = Vec::new();
    let mut executable: Vec<ResolvedDeleteTarget> = Vec::new();
    for target in &targets {
        let thread_id = target.thread_id.trim().to_string();
        let lookups = lookups_by_thread_id
            .get(&thread_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let resolved = match resolve_one_target(target, lookups, &workspaces_snapshot, workspace_id)
        {
            Ok(resolved) => resolved,
            Err(result) => {
                complete(&mut results_by_thread_id, &mut done, result);
                continue;
            }
        };
        // Classify：ghost 短路成功 / unsupported 快速失败（都不进入标记阶段）
        if resolved.ghost {
            resolved_targets.push(resolved.clone());
            complete(
                &mut results_by_thread_id,
                &mut done,
                SessionDeleteV2Result::success(&resolved.thread_id, codes::GHOST_CLEANED),
            );
            continue;
        }
        if !SUPPORTED_DELETE_ENGINES.contains(&resolved.engine.as_str()) {
            complete(
                &mut results_by_thread_id,
                &mut done,
                SessionDeleteV2Result::failure(
                    &resolved.thread_id,
                    codes::ENGINE_UNSUPPORTED,
                    format!(
                        "session engine '{}' is not supported by delete",
                        resolved.engine
                    ),
                ),
            );
            continue;
        }
        resolved_targets.push(resolved.clone());
        executable.push(resolved);
    }

    // ---- dsh pre-flight（标记前）：daemon 不可达 → ENGINE_BUSY，可重试 ----
    let mut dsh_clients: HashMap<String, Arc<DshHostClient>> = HashMap::new();
    let dsh_targets: Vec<ResolvedDeleteTarget> = executable
        .iter()
        .filter(|target| target.engine == "dsh")
        .cloned()
        .collect();
    if !dsh_targets.is_empty() {
        let dsh_config = engine_manager
            .get_engine_config(engine::EngineType::Dsh)
            .await;
        let runtime = crate::engine::dsh::runtime_settings_from_engine_config(dsh_config.as_ref());
        let mut preflight = FuturesUnordered::new();
        for target in &dsh_targets {
            let runtime = runtime.clone();
            let thread_id = target.thread_id.clone();
            preflight.push(async move {
                let outcome = tokio::time::timeout(DSH_PREFLIGHT_TIMEOUT, async move {
                    crate::engine::dsh::connect_existing(&runtime).await
                })
                .await;
                (thread_id, outcome)
            });
        }
        let mut dsh_ready: Vec<String> = Vec::new();
        while let Some((thread_id, outcome)) = preflight.next().await {
            match outcome {
                Ok(Ok((_snapshot, client))) => {
                    dsh_clients.insert(thread_id.clone(), client);
                    dsh_ready.push(thread_id);
                }
                Ok(Err(error)) => {
                    complete(
                        &mut results_by_thread_id,
                        &mut done,
                        SessionDeleteV2Result::failure(
                            &thread_id,
                            codes::ENGINE_BUSY,
                            format!("dsh daemon unavailable: {error}"),
                        ),
                    );
                }
                Err(_) => {
                    complete(
                        &mut results_by_thread_id,
                        &mut done,
                        SessionDeleteV2Result::failure(
                            &thread_id,
                            codes::ENGINE_BUSY,
                            "dsh daemon connect timeout",
                        ),
                    );
                }
            }
        }
        executable.retain(|target| target.engine != "dsh" || dsh_ready.contains(&target.thread_id));
    }

    // ---- Settle（标记优先）：用户确认即 tombstone，物理删除在其后 ----
    let all_tombstone_ids: Vec<String> = resolved_targets
        .iter()
        .filter(|target| !target.already_tombstoned)
        .filter(|target| {
            target.ghost
                || executable
                    .iter()
                    .any(|item| item.thread_id == target.thread_id)
        })
        .map(|target| {
            if target.ghost || target.engine.is_empty() {
                target.thread_id.clone()
            } else {
                format!("{}:{}", target.engine, target.native_session_id)
            }
        })
        .collect();
    if !all_tombstone_ids.is_empty() {
        let marker_result = tokio::task::spawn_blocking({
            let ids = all_tombstone_ids.clone();
            move || {
                let connection = session_index_store::open_connection()?;
                session_index_store::tombstone_session_ids(&connection, &ids)
            }
        })
        .await;
        let marker_error = match marker_result {
            Ok(Ok(_)) => None,
            Ok(Err(error)) => Some(error),
            Err(join_error) => Some(join_error.to_string()),
        };
        if let Some(message) = marker_error {
            // 标记失败：整项回滚报 IO_FAILED（唯一允许回滚的路径）
            for target in &executable {
                complete(
                    &mut results_by_thread_id,
                    &mut done,
                    SessionDeleteV2Result::failure(
                        &target.thread_id,
                        codes::IO_FAILED,
                        message.clone(),
                    ),
                );
            }
            return finalize_results(&targets, results_by_thread_id);
        }
    }

    // ---- Execute：受控并发 + 超时 + per-engine deleter ----
    let configs = Arc::new(EngineDeleteConfigs {
        claude_config: engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await,
        gemini_home_dir: engine_manager
            .get_engine_config(engine::EngineType::Gemini)
            .await
            .and_then(|item| item.home_dir),
        kimi_home_dir: engine_manager
            .get_engine_config(engine::EngineType::Kimi)
            .await
            .and_then(|item| item.home_dir),
        grok_home_dir: engine_manager
            .get_engine_config(engine::EngineType::Grok)
            .await
            .and_then(|item| item.home_dir),
        pi_home_dir: engine_manager
            .get_engine_config(engine::EngineType::Pi)
            .await
            .and_then(|item| item.home_dir),
        omp_home_dir: engine_manager
            .get_engine_config(engine::EngineType::Omp)
            .await
            .and_then(|item| item.home_dir),
        qoder_distribution_settings: engine_manager.qoder_distribution_settings().await,
    });
    let semaphore = Arc::new(Semaphore::new(DELETE_CONCURRENCY));
    let mut executions = FuturesUnordered::new();

    for target in &executable {
        let semaphore = semaphore.clone();
        let configs = configs.clone();
        let snapshot = workspaces_snapshot.clone();
        let dsh_client = dsh_clients.get(&target.thread_id).cloned();
        let target = target.clone();
        executions.push(async move {
            let _permit = semaphore.acquire_owned().await.ok();
            let (plan, delete_future) = build_delete_execution(
                &target,
                &configs,
                dsh_client,
                snapshot.as_ref(),
                workspaces,
                engine_manager,
            );
            let timeout_budget = if target.engine == "dsh" {
                DSH_EXECUTE_TIMEOUT
            } else {
                EXECUTE_TIMEOUT
            };
            let outcome = tokio::time::timeout(timeout_budget, delete_future).await;
            (target, plan, outcome)
        });
    }

    let mut metadata_cleanup_targets: Vec<ResolvedDeleteTarget> = Vec::new();
    while let Some((target, plan, outcome)) = executions.next().await {
        let result = match outcome {
            Ok(Ok(())) => SessionDeleteV2Result::success(&target.thread_id, codes::OK),
            Ok(Err(error)) => {
                if session_management::should_settle_delete_as_success(&error) {
                    SessionDeleteV2Result::success(&target.thread_id, codes::ALREADY_MISSING)
                } else {
                    // 标记已落：物理删除失败不影响侧栏隐藏（marker-first）
                    // 诊断日志：幽灵会话残留根因（文件锁 / 多 root 副本）取证
                    log::warn!(
                        "[session_delete_v2] MARKED_DELETED engine={} session={} error={}",
                        target.engine,
                        target.native_session_id,
                        error
                    );
                    if let Some(retry) = build_retry_for_plan(&plan, &configs) {
                        schedule_residual_retry(
                            format!("{}:{}", target.engine, target.native_session_id),
                            retry,
                        );
                    } else {
                        log::warn!(
                            "[session_delete_v2] residual left for {}:{} (no retry path): {}",
                            target.engine,
                            target.native_session_id,
                            error
                        );
                    }
                    SessionDeleteV2Result::success(&target.thread_id, codes::MARKED_DELETED)
                }
            }
            Err(_) => SessionDeleteV2Result::failure(
                &target.thread_id,
                codes::REQUEST_TIMEOUT,
                "session delete execution timeout",
            ),
        };
        metadata_cleanup_targets.push(target.clone());
        complete(&mut results_by_thread_id, &mut done, result);
    }

    // ghost 项同样做元数据清理（摘 catalog 键）
    for target in &resolved_targets {
        if target.ghost {
            metadata_cleanup_targets.push(target.clone());
        }
    }

    // ---- catalog 元数据清理（按 owner workspace 分组） ----
    let mut targets_by_owner: HashMap<String, Vec<ResolvedDeleteTarget>> = HashMap::new();
    for target in metadata_cleanup_targets {
        targets_by_owner
            .entry(target.owner_workspace_id.clone())
            .or_default()
            .push(target);
    }
    for (owner_workspace_id, owner_targets) in targets_by_owner {
        let cleanup = session_management::with_catalog_metadata_mutation(
            storage_path,
            &owner_workspace_id,
            |metadata| {
                for target in &owner_targets {
                    let mut keys = session_management::catalog_metadata_lookup_keys_for_session(
                        &owner_workspace_id,
                        &target.thread_id,
                        &target.engine,
                    );
                    keys.extend(
                        session_management::catalog_metadata_lookup_keys_for_session(
                            &owner_workspace_id,
                            &target.native_session_id,
                            &target.engine,
                        ),
                    );
                    keys.sort();
                    keys.dedup();
                    for key in keys {
                        metadata.archived_at_by_session_id.remove(&key);
                        metadata.folder_id_by_session_id.remove(&key);
                        metadata.auto_session_by_session_id.remove(&key);
                        metadata.engine_provider_binding_by_session_key.remove(&key);
                        metadata.codex_provider_binding_by_session_id.remove(&key);
                        metadata.provider_continuation_by_session_key.remove(&key);
                    }
                }
                Ok(())
            },
        );
        if let Err(error) = cleanup {
            for target in &owner_targets {
                // 元数据清理失败：标记保留（行仍隐藏），如实上报失败码
                results_by_thread_id.insert(
                    target.thread_id.clone(),
                    SessionDeleteV2Result::failure(
                        &target.thread_id,
                        codes::METADATA_CLEANUP_FAILED,
                        format!("failed to clean session metadata: {error}"),
                    ),
                );
            }
        }
    }

    finalize_results(&targets, results_by_thread_id)
}

fn finalize_results(
    targets: &[SessionDeleteV2Target],
    mut results_by_thread_id: HashMap<String, SessionDeleteV2Result>,
) -> Vec<SessionDeleteV2Result> {
    let mut results = Vec::new();
    for target in targets {
        let thread_id = target.thread_id.trim().to_string();
        if let Some(result) = results_by_thread_id.remove(&thread_id) {
            results.push(result);
        }
    }
    results
}

#[tauri::command]
pub(crate) async fn delete_workspace_sessions_v2(
    request: DeleteWorkspaceSessionsV2Request,
    app: AppHandle,
) -> Result<DeleteWorkspaceSessionsV2Response, String> {
    let workspace_id = session_management::normalize_workspace_id(&request.workspace_id)?;
    let targets: Vec<SessionDeleteV2Target> = request
        .targets
        .into_iter()
        .filter(|target| !target.thread_id.trim().is_empty())
        .collect();
    if targets.is_empty() {
        return Err("session ids are required".to_string());
    }
    {
        let state = app.state::<AppState>();
        let workspaces = state.workspaces.lock().await;
        if !workspaces.contains_key(&workspace_id) {
            return Err("workspace not found".to_string());
        }
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    let task_app = app.clone();
    let task_request_id = request_id.clone();
    tokio::spawn(async move {
        let state = task_app.state::<AppState>();
        let settled_request_id = task_request_id.clone();
        let progress = |done: usize, total_count: usize| {
            let _ = task_app.emit(
                SESSION_DELETE_PROGRESS_EVENT,
                SessionDeleteProgressPayload {
                    request_id: task_request_id.clone(),
                    done,
                    total: total_count,
                },
            );
        };
        // panic 兜底：orchestrator 任何 panic 也必须 emit settled，
        // 否则前端只能等 30s 超时（表现为「删除报错 + 行回滚复活」）。
        let target_ids: Vec<String> = targets
            .iter()
            .map(|target| target.thread_id.trim().to_string())
            .collect();
        let orchestrator = run_session_delete_v2(
            &state.workspaces,
            &state.engine_manager,
            state.storage_path.as_path(),
            &workspace_id,
            targets,
            &progress,
        );
        let results =
            futures_util::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(orchestrator))
                .await
                .unwrap_or_else(|panic_error| {
                    log::error!(
                        "[session_delete_v2] orchestrator panicked for request {}: {:?}",
                        settled_request_id,
                        panic_error
                    );
                    target_ids
                        .into_iter()
                        .map(|thread_id| {
                            SessionDeleteV2Result::failure(
                                &thread_id,
                                codes::IO_FAILED,
                                "session delete orchestrator panic",
                            )
                        })
                        .collect()
                });
        let _ = task_app.emit(
            SESSION_DELETE_SETTLED_EVENT,
            SessionDeleteSettledPayload {
                request_id: settled_request_id,
                results,
            },
        );
    });
    Ok(DeleteWorkspaceSessionsV2Response { request_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings};

    fn workspace_entry(id: &str, path: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: path.to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn workspaces(entries: Vec<WorkspaceEntry>) -> HashMap<String, WorkspaceEntry> {
        entries
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect()
    }

    fn target(thread_id: &str) -> SessionDeleteV2Target {
        SessionDeleteV2Target {
            thread_id: thread_id.to_string(),
            engine: None,
            native_session_id: None,
        }
    }

    fn lookup(
        engine: &str,
        session_id: &str,
        workspace_path: Option<&str>,
        physical_path: Option<&str>,
        tombstoned: bool,
    ) -> session_index_store::SessionIndexDeleteLookup {
        session_index_store::SessionIndexDeleteLookup {
            row: session_index_store::SessionIndexRow {
                engine: engine.to_string(),
                session_id: session_id.to_string(),
                title: session_id.to_string(),
                native_title: None,
                updated_at: 100,
                created_at: None,
                cwd: workspace_path.map(ToString::to_string),
                workspace_path: workspace_path.map(ToString::to_string),
                physical_path: physical_path.map(ToString::to_string),
                parent_session_id: None,
                size_bytes: None,
                provider_profile_id: None,
                provider_profile_name: None,
            },
            tombstoned_at: if tombstoned { Some(123) } else { None },
        }
    }

    #[test]
    fn parse_engine_hint_recognizes_known_prefixes() {
        assert_eq!(
            parse_engine_hint("claude:abc-1"),
            Some(("claude".to_string(), "abc-1".to_string()))
        );
        assert_eq!(
            parse_engine_hint("shared:s-1"),
            Some(("shared".to_string(), "s-1".to_string()))
        );
        assert_eq!(parse_engine_hint("bare-uuid"), None);
        assert_eq!(parse_engine_hint("unknown:abc"), None);
        assert_eq!(parse_engine_hint("claude:"), None);
    }

    #[test]
    fn resolve_uses_index_row_for_owner_and_physical_path() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let lookups = vec![lookup(
            "claude",
            "abc-1",
            Some("/tmp/proj"),
            Some("/home/user/.claude/projects/proj/abc-1.jsonl"),
            false,
        )];
        let resolved =
            resolve_one_target(&target("claude:abc-1"), &lookups, &map, "ws-1").expect("resolved");
        assert_eq!(resolved.engine, "claude");
        assert_eq!(resolved.native_session_id, "abc-1");
        assert_eq!(resolved.owner_workspace_id, "ws-1");
        assert_eq!(
            resolved.physical_path,
            Some(PathBuf::from(
                "/home/user/.claude/projects/proj/abc-1.jsonl"
            ))
        );
        assert!(!resolved.ghost);
        assert!(!resolved.already_tombstoned);
    }

    #[test]
    fn resolve_keeps_tombstoned_row_resolvable_for_retry() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let lookups = vec![lookup("codex", "uuid-9", Some("/tmp/proj"), None, true)];
        let resolved =
            resolve_one_target(&target("uuid-9"), &lookups, &map, "ws-1").expect("resolved");
        assert_eq!(resolved.engine, "codex");
        assert!(resolved.already_tombstoned);
        assert!(!resolved.ghost);
    }

    #[test]
    fn resolve_prefers_non_tombstoned_row_over_marker() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let lookups = vec![
            lookup("claude", "abc-1", Some("/tmp/proj"), None, true),
            lookup("claude", "abc-1", Some("/tmp/proj"), None, false),
        ];
        let resolved =
            resolve_one_target(&target("claude:abc-1"), &lookups, &map, "ws-1").expect("resolved");
        assert!(!resolved.already_tombstoned);
    }

    #[test]
    fn resolve_falls_back_to_engine_prefix_when_index_misses() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let resolved =
            resolve_one_target(&target("claude:abc-2"), &[], &map, "ws-1").expect("resolved");
        assert_eq!(resolved.engine, "claude");
        assert_eq!(resolved.native_session_id, "abc-2");
        assert_eq!(resolved.owner_workspace_id, "ws-1");
        assert_eq!(resolved.physical_path, None);
        assert!(!resolved.ghost);
    }

    #[test]
    fn resolve_uses_explicit_engine_for_bare_codex_id() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let mut codex_target = target("uuid-bare");
        codex_target.engine = Some("codex".to_string());
        let resolved = resolve_one_target(&codex_target, &[], &map, "ws-1").expect("resolved");
        assert_eq!(resolved.engine, "codex");
        assert_eq!(resolved.native_session_id, "uuid-bare");
        assert!(!resolved.ghost);
    }

    #[test]
    fn resolve_marks_ghost_when_no_index_row_and_no_hint() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let resolved =
            resolve_one_target(&target("mystery-id"), &[], &map, "ws-1").expect("resolved");
        assert!(resolved.ghost);
        assert_eq!(resolved.engine, "");
    }

    #[test]
    fn resolve_rejects_empty_id() {
        let map = workspaces(vec![workspace_entry("ws-1", "/tmp/proj")]);
        let result = resolve_one_target(&target("   "), &[], &map, "ws-1");
        let error = result.expect_err("empty id must fail");
        assert_eq!(error.code, codes::IO_FAILED);
        assert!(!error.ok);
    }

    #[test]
    fn success_codes_are_idempotent_set() {
        // 设计契约：幂等成功收敛为四个 code
        for code in [
            codes::OK,
            codes::ALREADY_MISSING,
            codes::GHOST_CLEANED,
            codes::MARKED_DELETED,
        ] {
            let result = SessionDeleteV2Result::success("t", code);
            assert!(result.ok);
            assert!(result.error.is_none());
        }
        let failure = SessionDeleteV2Result::failure("t", codes::ENGINE_BUSY, "busy");
        assert!(!failure.ok);
        assert_eq!(failure.error.as_deref(), Some("busy"));
    }
}
