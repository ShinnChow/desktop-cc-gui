//! Read Claude Code session history from the effective Claude home projects directory.
//!
//! Claude Code stores session data as JSONL files in:
//! `<claude-home>/projects/{encoded-path}/{session-id}.jsonl`
//!
//! Path encoding: all non-alphanumeric characters are replaced with hyphens.

#[path = "claude_history_filter.rs"]
mod filter;
pub use filter::*;

#[path = "claude_history_loader.rs"]
mod loader;
pub use loader::*;

#[path = "claude_history_delete.rs"]
mod delete;
pub use delete::*;

#[cfg(test)]
#[path = "claude_history_inline_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "claude_history_filter_tests.rs"]
mod filter_tests;

#[cfg(test)]
#[path = "claude_history_fork_tests.rs"]
mod fork_tests;
