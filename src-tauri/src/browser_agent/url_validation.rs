use super::*;

pub(crate) fn is_local_html_file_url(url: &str) -> bool {
    let without_fragment = url.split(['?', '#']).next().unwrap_or(url);
    let lower = without_fragment.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

pub(crate) fn validate_browser_url_for_workspace(
    raw_url: &str,
    workspace_id: Option<&str>,
) -> BrowserUrlValidationResult {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return blocked_url(raw_url, "empty_url", "Browser Agent URL cannot be empty.");
    }

    let lower = trimmed.to_ascii_lowercase();
    let scheme = match lower.split_once("://") {
        Some((scheme, _)) => scheme,
        None => {
            return blocked_url(
                raw_url,
                "missing_scheme",
                "Browser Agent URL must include an http://, https://, or file:// scheme.",
            );
        }
    };

    // Local HTML preview: allow file:// only for .html / .htm (relative assets keep working).
    if scheme == "file" {
        if !is_local_html_file_url(trimmed) {
            return blocked_url(
                raw_url,
                "blocked_file_type",
                "Browser Agent only opens local .html / .htm files via file://.",
            );
        }
        return BrowserUrlValidationResult {
            raw_url: raw_url.to_string(),
            normalized_url: Some(trimmed.to_string()),
            allowed: true,
            blocked_reason: None,
            diagnostic: None,
            workspace_local_allowed: true,
        };
    }

    if scheme != "http" && scheme != "https" {
        return blocked_url(
            raw_url,
            "blocked_scheme",
            "Browser Agent only allows http://, https://, and local file:// HTML pages.",
        );
    }

    let Some(host) = host_from_normalized_url(trimmed) else {
        return blocked_url(
            raw_url,
            "missing_host",
            "Browser Agent URL must include a host.",
        );
    };
    let workspace_local_allowed = workspace_id
        .map(|id| !id.trim().is_empty())
        .unwrap_or(false)
        && is_workspace_local_development_host(host.as_str());
    if is_blocked_local_host(&host) && !workspace_local_allowed {
        return blocked_url(
            raw_url,
            "blocked_local_host",
            "Browser Agent MVP blocks localhost and private network targets.",
        );
    }

    BrowserUrlValidationResult {
        raw_url: raw_url.to_string(),
        normalized_url: Some(trimmed.to_string()),
        allowed: true,
        blocked_reason: None,
        diagnostic: None,
        workspace_local_allowed,
    }
}
