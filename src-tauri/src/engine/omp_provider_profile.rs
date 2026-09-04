//! OMP provider profile identity（add-omp-engine）。
//!
//! OMP uses native `~/.omp` config (config.yml + SQLite stores) — mossx does
//! not materialize multi-provider configs into OMP's home (same stance as PI).
//! 实现复用 pi_provider_profile 的 pi-family 参数化版本；本文件只承载
//! omp 的 local profile sentinel（EngineType::pi_family_spec 引用）。

pub(crate) const OMP_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_omp__";
