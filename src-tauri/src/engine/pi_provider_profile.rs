//! pi-family provider launch profile（add-omp-engine 参数化）.
//!
//! pi 族（pi / omp）均使用原生 home 配置（`~/.pi` / `~/.omp`）——mossx 不物化
//! 多 provider 配置进引擎 home（与 kimi/grok 不同）。Launch profile 只承载
//! 可选 custom home / runtime key 的 session 归属隔离。

use std::path::{Path, PathBuf};

use crate::engine::EngineType;
use crate::session_management::EngineProviderBinding;

pub(crate) const PI_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_pi__";

#[derive(Debug, Clone)]
pub(crate) struct PiFamilyProviderLaunchProfile {
    pub(crate) binding: Option<EngineProviderBinding>,
    pub(crate) home_dir: Option<PathBuf>,
    pub(crate) runtime_key: String,
}

fn normalize_profile_id<'a>(engine: EngineType, profile_id: Option<&'a str>) -> &'a str {
    profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| pi_family_local_profile_id(engine))
}

pub(crate) fn pi_family_local_profile_id(engine: EngineType) -> &'static str {
    engine
        .pi_family_spec()
        .map(|spec| spec.local_profile_id)
        .unwrap_or(PI_LOCAL_PROVIDER_PROFILE_ID)
}

/// Runtime Key（Ownership 归属）：
/// - local（`__local_<engine>__` / 空）：= workspace_id（与 Native 默认归属一致）
/// - named profile：`{workspace}::<engine>::{profile}`（与 kimi/grok named 形态对齐）
pub(crate) fn pi_family_runtime_key(
    engine: EngineType,
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> String {
    let profile_id = normalize_profile_id(engine, provider_profile_id);
    if profile_id == pi_family_local_profile_id(engine) {
        workspace_id.to_string()
    } else {
        format!("{workspace_id}::{}::{profile_id}", engine.icon())
    }
}

/// Resolve pi-family launch profile. Custom profile ids are treated as local
/// until a future vendor CRUD lands; home always comes from optional
/// env/settings path via the engine config on the session, not from the
/// multi-provider store.
pub(crate) fn resolve_pi_family_provider_launch_profile(
    engine: EngineType,
    workspace_id: &str,
    provider_profile_id: Option<&str>,
    home_dir: Option<&Path>,
) -> Result<PiFamilyProviderLaunchProfile, String> {
    let runtime_key = pi_family_runtime_key(engine, workspace_id, provider_profile_id);
    Ok(PiFamilyProviderLaunchProfile {
        binding: None,
        home_dir: home_dir.map(Path::to_path_buf),
        runtime_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_profile_uses_workspace_runtime_key() {
        let profile =
            resolve_pi_family_provider_launch_profile(EngineType::Pi, "ws-1", None, None)
                .expect("profile");
        assert_eq!(profile.runtime_key, "ws-1");
        assert!(profile.binding.is_none());
    }

    #[test]
    fn named_profile_scopes_runtime_key_per_engine() {
        let profile = resolve_pi_family_provider_launch_profile(
            EngineType::Pi,
            "ws-1",
            Some("custom"),
            None,
        )
        .expect("profile");
        assert_eq!(profile.runtime_key, "ws-1::pi::custom");
        let omp_profile = resolve_pi_family_provider_launch_profile(
            EngineType::Omp,
            "ws-1",
            Some("custom"),
            None,
        )
        .expect("profile");
        assert_eq!(omp_profile.runtime_key, "ws-1::omp::custom");
    }
}
