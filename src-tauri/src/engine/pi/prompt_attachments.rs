use super::*;

/// RPC transport carries images inline as base64 ImageContent blocks (the
/// print-json `@file` argv transport does not exist in RPC mode).
pub(crate) fn encode_images_for_rpc(
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<Value>, String> {
    use base64::Engine as _;
    let files =
        crate::engine::cli_image_input::resolve_existing_image_files(images, workspace_path)?;
    let mut out = Vec::new();
    for file in files {
        let bytes = std::fs::read(&file)
            .map_err(|error| format!("failed to read image {}: {error}", file.display()))?;
        const MAX_RPC_IMAGE_BYTES: usize = 10 * 1024 * 1024;
        if bytes.len() > MAX_RPC_IMAGE_BYTES {
            return Err(format!(
                "image {} is too large for RPC inline ({} bytes, max {MAX_RPC_IMAGE_BYTES})",
                file.display(),
                bytes.len()
            ));
        }
        let ext = file
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/png",
        };
        out.push(json!({
            "type": "image",
            "data": base64::engine::general_purpose::STANDARD.encode(bytes),
            "mimeType": mime,
        }));
    }
    Ok(out)
}

pub(crate) struct RpcPromptExpansion {
    pub(crate) text: String,
    pub(crate) images: Vec<String>,
}

pub(crate) fn is_image_path(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
    )
}

pub(crate) fn expand_rpc_prompt_attachments(
    text: &str,
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<RpcPromptExpansion, String> {
    let extraction = extract_at_file_references(text, workspace_path);
    let mut image_paths = crate::engine::cli_image_input::collect_non_empty_image_paths(images);
    let mut extras = String::new();
    const MAX_INJECT_CHARS: usize = 128 * 1024;
    for arg in extraction.file_args {
        let path = arg.trim_start_matches('@');
        if is_image_path(path) {
            if !image_paths.iter().any(|existing| existing == path) {
                image_paths.push(path.to_string());
            }
            continue;
        }
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                let clipped = if contents.len() > MAX_INJECT_CHARS {
                    format!(
                        "{}\n…(truncated {} chars)",
                        &contents[..MAX_INJECT_CHARS],
                        contents.len() - MAX_INJECT_CHARS
                    )
                } else {
                    contents
                };
                extras.push_str(&format!("\n\n<file path=\"{path}\">\n{clipped}\n</file>"));
            }
            Err(error) => {
                log::warn!("[pi/rpc] @file {path} not readable: {error}");
            }
        }
    }
    let text = if extras.is_empty() {
        extraction.text
    } else {
        format!("{}{extras}", extraction.text)
    };
    Ok(RpcPromptExpansion {
        text,
        images: image_paths,
    })
}
