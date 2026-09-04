use serde_json::Value;

const MAX_DELTA_SYNC_TURNS: usize = 8;
pub(crate) const MAX_DELTA_SYNC_CHARS: usize = 4_000;

pub(crate) fn extract_first_user_title(items: &[Value]) -> Option<String> {
    for item in items {
        let role = item
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if role != "user" {
            continue;
        }
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if text.is_empty() {
            continue;
        }
        let normalized = text.lines().next().unwrap_or(text).trim();
        if normalized.is_empty() {
            continue;
        }
        let title = if normalized.chars().count() > 32 {
            format!("{}...", normalized.chars().take(32).collect::<String>())
        } else {
            normalized.to_string()
        };
        return Some(title);
    }
    None
}

pub(crate) fn count_user_turns(items: &[Value]) -> u64 {
    items
        .iter()
        .filter(|item| {
            item.get("kind").and_then(Value::as_str) == Some("message")
                && item.get("role").and_then(Value::as_str) == Some("user")
        })
        .count() as u64
}

fn build_delta_sync_projection(items: &[Value], from_turn_seq: u64) -> Option<(String, bool)> {
    if items.is_empty() {
        return None;
    }
    let mut turn_index = 0_u64;
    let mut current_user: Option<String> = None;
    let mut collected: Vec<String> = Vec::new();

    for item in items {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        if kind != "message" {
            continue;
        }
        let role = item.get("role").and_then(Value::as_str).unwrap_or_default();
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .replace('\n', " ");
        if role == "user" {
            turn_index += 1;
            current_user = if text.is_empty() { None } else { Some(text) };
            continue;
        }
        if role == "assistant" && turn_index > from_turn_seq {
            let engine = item
                .get("engineSource")
                .and_then(Value::as_str)
                .unwrap_or("assistant")
                .trim()
                .to_string();
            if !text.is_empty() {
                if let Some(user_text) = current_user.take() {
                    collected.push(format!(
                        "Turn {turn_index}\nUser: {user_text}\n{engine}: {text}"
                    ));
                }
            }
        }
    }

    if collected.is_empty() {
        return None;
    }

    let mut merged = String::from(
        "Shared session context sync. Continue from these recent turns before answering the new request:\n\n",
    );
    let retained_from = collected.len().saturating_sub(MAX_DELTA_SYNC_TURNS);
    let mut truncated = false;
    for block in &collected[retained_from..] {
        let remaining = MAX_DELTA_SYNC_CHARS.saturating_sub(merged.chars().count() + 2);
        if remaining == 0 {
            truncated = true;
            break;
        }
        let block_chars = block.chars().count();
        merged.extend(block.chars().take(remaining));
        merged.push_str("\n\n");
        if block_chars > remaining {
            truncated = true;
            break;
        }
    }
    Some((merged.trim_end().to_string(), truncated))
}

pub(crate) fn build_delta_sync_prefix(items: &[Value], from_turn_seq: u64) -> Option<String> {
    build_delta_sync_projection(items, from_turn_seq).map(|(projection, _)| projection)
}

pub(crate) fn inspect_shared_context_projection(
    items: &[Value],
    from_turn_seq: u64,
) -> Vec<String> {
    let pending_turns = count_user_turns(items).saturating_sub(from_turn_seq);
    let mut omissions = Vec::new();
    if pending_turns as usize > MAX_DELTA_SYNC_TURNS {
        omissions.push(format!(
            "{} older turn(s) omitted by the {}-turn context limit",
            pending_turns as usize - MAX_DELTA_SYNC_TURNS,
            MAX_DELTA_SYNC_TURNS
        ));
    }
    let projection_truncated = build_delta_sync_projection(items, from_turn_seq)
        .map(|(_, truncated)| truncated)
        .unwrap_or(false);
    if projection_truncated {
        omissions.push(format!(
            "context truncated at the {}-character limit",
            MAX_DELTA_SYNC_CHARS
        ));
    }
    omissions
}
