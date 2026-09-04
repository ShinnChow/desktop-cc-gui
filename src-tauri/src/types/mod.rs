use serde::{Deserialize, Deserializer, Serialize};

use crate::backend_budget::PayloadBudgetMetadata;

/// 结构化技能调用契约（composer 选中 skill/common 发送时随消息下发）。
/// 当前仅在 `engine_send_message` 边界接收并记录日志；引擎侧解析与参数
/// 校验属后续协议演进。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillInvocation {
    pub(crate) name: String,
    /// SKILL.md / skill 目录路径；协作首段 client 侧注入用，引擎可忽略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) args: Option<std::collections::HashMap<String, String>>,
}

mod email;
mod git;
mod providers;
mod settings;
mod usage;
mod workspace;

#[cfg(test)]
mod tests;

pub(crate) use email::*;
pub(crate) use git::*;
pub(crate) use providers::*;
pub(crate) use settings::*;
pub(crate) use usage::*;
pub(crate) use workspace::*;
