use super::*;

/// Result of scanning prompt text for `@<path>` file reference tokens.
///
/// Pi CLI parses argv tokens starting with `@` as file arguments
/// (`cli/args.js`), and print mode never expands inline `@path` inside the
/// prompt message (that expansion is TUI-editor-only). mossx passes the whole
/// prompt as ONE positional argv element, so a prompt merely *starting* with
/// `@` makes pi treat the entire message — spaces, second `@`, Chinese text
/// and all — as a single fake file path and exit(1) with "File not found".
/// Extraction therefore (a) upgrades resolvable references to real `@file`
/// argv entries so their content is injected, and (b) strips them from the
/// prompt so the remaining text cannot be misparsed.
pub(crate) struct AtReferenceExtraction {
    pub(crate) text: String,
    pub(crate) file_args: Vec<String>,
}

/// Resolve a `@` reference candidate to an existing regular file.
///
/// Folders, missing paths, and non-path text (e.g. `@teammate`) return None
/// so callers keep the token verbatim in the prompt — pi is a tool-using
/// agent and can explore a directory path given as plain text, while
/// `@file` on a directory would make pi's file-processor exit(1).
pub(crate) fn resolve_at_reference_path(raw: &str, workspace_path: &Path) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }
    let path = PathBuf::from(trimmed);
    let absolute = if path.is_absolute() {
        path
    } else {
        workspace_path.join(path)
    };
    match std::fs::metadata(&absolute) {
        Ok(meta) if meta.is_file() => Some(absolute),
        _ => None,
    }
}

/// Scan `text` for `@<path>` tokens at token boundaries (start of text or
/// after whitespace) and extract the ones resolving to existing regular
/// files into pi `@file` argv entries.
///
/// Matching is greedy longest-prefix against the filesystem: candidate
/// substrings end at each following whitespace boundary (and end of text),
/// longest first, so paths containing spaces (`@/abs/shot one.png`) resolve
/// as one token. Unresolvable tokens are preserved verbatim and scanning
/// continues after their `@`.
pub(crate) fn extract_at_file_references(text: &str, workspace_path: &Path) -> AtReferenceExtraction {
    let mut cleaned = String::with_capacity(text.len());
    let mut file_args: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut i = 0usize;
    while i < text.len() {
        let ch = text[i..].chars().next().expect("i is a char boundary");
        let at_token_boundary = ch == '@'
            && (i == 0
                || text[..i]
                    .chars()
                    .last()
                    .map(|prev| prev.is_whitespace())
                    .unwrap_or(false));
        if at_token_boundary {
            // Candidate ends: byte index of each whitespace after the `@`,
            // plus end of text. Try longest first.
            let mut ends: Vec<usize> = Vec::new();
            for (off, c) in text[i + 1..].char_indices() {
                if c.is_whitespace() {
                    ends.push(i + 1 + off);
                }
            }
            ends.push(text.len());
            let mut matched: Option<usize> = None;
            for &end in ends.iter().rev() {
                let candidate = &text[i + 1..end];
                if let Some(path) = resolve_at_reference_path(candidate, workspace_path) {
                    let key = path.to_string_lossy().to_string();
                    if seen.insert(key.clone()) {
                        file_args.push(format!("@{key}"));
                    }
                    matched = Some(end);
                    break;
                }
            }
            if let Some(end) = matched {
                // Drop the token; avoid doubling the boundary whitespace.
                i = end;
                if text[i..]
                    .chars()
                    .next()
                    .map(|next| next.is_whitespace())
                    .unwrap_or(false)
                    && cleaned
                        .chars()
                        .last()
                        .map(|prev| prev.is_whitespace())
                        .unwrap_or(false)
                {
                    i += text[i..]
                        .chars()
                        .next()
                        .expect("i is a char boundary")
                        .len_utf8();
                }
                continue;
            }
        }
        cleaned.push(ch);
        i += ch.len_utf8();
    }

    AtReferenceExtraction {
        text: cleaned,
        file_args,
    }
}
