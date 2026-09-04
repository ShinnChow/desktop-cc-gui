//! OMP CLI 检测（add-omp-engine）。
//!
//! omp 是 pi 的协议全等 fork（mossx-omp-capability-spike v18.0.11）：版本探测、
//! catalog 三跳链（RPC `get_available_models` → `--list-models` → fallback）、
//! home 解析全部复用 pi-family 共享实现；本文件只承载 omp 身份入口。
//!
//! 候选目录矩阵（env 自定义路径 → 共享 extra search paths → PATH）：
//! - Windows 官方安装目录 `%LOCALAPPDATA%\omp\omp.exe` 与 `~\.omp\bin` 已注册进
//!   `app_server_cli::build_windows_extra_search_paths`（`find_cli_binary("omp")`
//!   覆盖）；`~/.bun/bin` 为既有共享条目（bun 全局安装渠道）。
//! - Unix `~/.omp/bin` 已注册进 unix extra search paths；`~/.local/bin` 为既有共享条目。

use super::*;

pub async fn detect_omp_status(custom_bin: Option<&str>) -> EngineStatus {
    detect_omp_status_with_options(custom_bin, true).await
}

/// 语义同 `detect_pi_status_with_options`：`include_models = false` 为启动检测
/// 轻量分支，models 目录留给 `get_engine_models` 按需路径。
pub async fn detect_omp_status_with_options(
    custom_bin: Option<&str>,
    include_models: bool,
) -> EngineStatus {
    detect_pi_family_status_with_options(omp_spec(), custom_bin, include_models).await
}

pub(crate) fn omp_spec() -> PiFamilySpec {
    EngineType::Omp
        .pi_family_spec()
        .expect("omp is a pi-family engine")
}

pub(crate) fn get_omp_home_dir() -> Option<PathBuf> {
    get_pi_family_home_dir(EngineType::Omp)
}
