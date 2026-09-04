use std::collections::{BTreeMap, BTreeSet};

use crate::project_map_relations::ScannedFile;
use serde_json::{json, Value};

#[path = "project_map_api_contracts_types.rs"]
mod project_map_api_contracts_types;
use project_map_api_contracts_types::*;

#[path = "project_map_api_contracts_identity.rs"]
mod project_map_api_contracts_identity;
use project_map_api_contracts_identity::*;

#[path = "project_map_api_contracts_schema_sources.rs"]
mod project_map_api_contracts_schema_sources;
use project_map_api_contracts_schema_sources::{
    api_contract_schema_ref_from_name, extract_graphql_contract_candidates,
    extract_openapi_contract_candidates, extract_proto_contract_candidates,
    is_graphql_contract_file, is_openapi_contract_file, is_proto_contract_file,
};

#[path = "project_map_api_contracts_java_schema.rs"]
mod project_map_api_contracts_java_schema;
use project_map_api_contracts_java_schema::*;

fn module_label(path: &str) -> String {
    let segments = path.split('/').collect::<Vec<_>>();
    if segments.len() >= 3 && segments[0] == "src" && segments[1] == "features" {
        return format!("frontend:{}", segments[2]);
    }
    if segments.len() >= 3 && segments[0] == "src-tauri" && segments[1] == "src" {
        return format!("backend:{}", segments[2].trim_end_matches(".rs"));
    }
    segments.first().copied().unwrap_or("root").to_string()
}

fn first_quoted_value(text: &str) -> Option<String> {
    let mut chars = text.char_indices();
    while let Some((index, character)) = chars.next() {
        if character != '\'' && character != '"' {
            continue;
        }
        let quote = character;
        let start = index + quote.len_utf8();
        let end = text[start..].find(quote)?;
        return Some(text[start..start + end].to_string());
    }
    None
}

const API_CONTRACT_MAX_FILE_BYTES: u64 = 1_000_000;

fn api_adapter_descriptor_for_language(language: &str) -> Option<ApiAdapterDescriptor> {
    match language {
        "java" => Some(ApiAdapterDescriptor {
            language: "java",
            parser_source: "fallback-pattern",
            frameworks: &["Spring MVC", "WebFlux", "JAX-RS", "Micronaut", "Quarkus"],
            extractor: extract_java_api_candidates,
        }),
        "kotlin" => Some(ApiAdapterDescriptor {
            language: "kotlin",
            parser_source: "fallback-pattern",
            frameworks: &["Spring MVC", "WebFlux", "JAX-RS", "Micronaut", "Quarkus"],
            extractor: extract_java_api_candidates,
        }),
        "python" => Some(ApiAdapterDescriptor {
            language: "python",
            parser_source: "fallback-pattern",
            frameworks: &["FastAPI", "Flask", "Django", "DRF"],
            extractor: extract_python_api_candidates,
        }),
        "go" => Some(ApiAdapterDescriptor {
            language: "go",
            parser_source: "fallback-pattern",
            frameworks: &["net/http", "Gin", "Echo", "Fiber", "Chi", "gRPC"],
            extractor: extract_go_api_candidates,
        }),
        "typescript" | "vue" | "svelte" => Some(ApiAdapterDescriptor {
            language: "typescript",
            parser_source: "fallback-pattern",
            frameworks: &["Express", "Koa", "Fastify", "NestJS", "Next API routes"],
            extractor: extract_typescript_api_candidates,
        }),
        "javascript" => Some(ApiAdapterDescriptor {
            language: "javascript",
            parser_source: "fallback-pattern",
            frameworks: &["Express", "Koa", "Fastify", "NestJS", "Next API routes"],
            extractor: extract_typescript_api_candidates,
        }),
        "csharp" => Some(ApiAdapterDescriptor {
            language: "csharp",
            parser_source: "fallback-pattern",
            frameworks: &["ASP.NET Core Controller", "ASP.NET Core Minimal API"],
            extractor: extract_csharp_api_candidates,
        }),
        "rust" => Some(ApiAdapterDescriptor {
            language: "rust",
            parser_source: "fallback-pattern",
            frameworks: &["Axum", "Actix Web", "Rocket", "Warp"],
            extractor: extract_rust_api_candidates,
        }),
        "c" => Some(ApiAdapterDescriptor {
            language: "c",
            parser_source: "fallback-pattern",
            frameworks: &[
                "Mongoose",
                "CivetWeb",
                "libmicrohttpd",
                "handler table",
                "C ABI",
            ],
            extractor: extract_c_family_api_candidates,
        }),
        "cpp" => Some(ApiAdapterDescriptor {
            language: "cpp",
            parser_source: "fallback-pattern",
            frameworks: &[
                "Drogon",
                "Crow",
                "Oat++",
                "Pistache",
                "RESTinio",
                "Boost.Beast",
                "gRPC",
            ],
            extractor: extract_c_family_api_candidates,
        }),
        _ => None,
    }
}

fn declared_api_adapter_descriptors() -> Vec<ApiAdapterDescriptor> {
    [
        "java",
        "kotlin",
        "python",
        "go",
        "c",
        "cpp",
        "typescript",
        "javascript",
        "csharp",
        "rust",
    ]
    .into_iter()
    .flat_map(api_adapter_descriptor_for_language)
    .collect()
}

fn canonical_api_scope_skip_reason(item: &Value) -> String {
    let raw_reason = item
        .get("reason")
        .and_then(Value::as_str)
        .or_else(|| item.get("source").and_then(Value::as_str))
        .unwrap_or("ignored");
    let raw_path = item
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| item.get("relativePath").and_then(Value::as_str))
        .unwrap_or("");
    let combined = format!("{raw_reason} {raw_path}").to_ascii_lowercase();
    if combined.contains("node_modules")
        || combined.contains("/target/")
        || combined.contains("/build/")
        || combined.contains("/dist/")
        || combined.contains("/vendor/")
        || combined.contains("/.git/")
    {
        "dependency-directory".to_string()
    } else if combined.contains("generated") || combined.contains("codegen") {
        "generated-directory".to_string()
    } else if combined.contains("binary") {
        "binary-file".to_string()
    } else if combined.contains("size")
        || combined.contains("large")
        || combined.contains("oversized")
    {
        "oversized-file".to_string()
    } else if combined.contains("ignore") {
        "workspace-ignore".to_string()
    } else {
        "ignored-path".to_string()
    }
}

fn path_has_segment(path: &str, segment: &str) -> bool {
    path.split('/').any(|value| value == segment)
}

fn api_scan_scope_skip_reason(file: &ScannedFile) -> Option<String> {
    let path = file.path.replace('\\', "/").to_ascii_lowercase();
    if path_has_segment(&path, "node_modules")
        || path_has_segment(&path, "target")
        || path_has_segment(&path, "build")
        || path_has_segment(&path, "dist")
        || path_has_segment(&path, "vendor")
        || path_has_segment(&path, ".git")
    {
        return Some("dependency-directory".to_string());
    }
    if path_has_segment(&path, "generated")
        || path_has_segment(&path, "codegen")
        || path.contains(".generated.")
        || path.contains(".gen.")
    {
        return Some("generated-directory".to_string());
    }
    if file.size_bytes > API_CONTRACT_MAX_FILE_BYTES {
        return Some("oversized-file".to_string());
    }
    let parse_status = file.parse_status.to_ascii_lowercase();
    if parse_status.contains("binary") || file.language == "binary" {
        return Some("binary-file".to_string());
    }
    None
}

fn increment_skipped_reason(
    skipped_by_reason: &mut BTreeMap<String, usize>,
    reason: impl Into<String>,
) {
    *skipped_by_reason.entry(reason.into()).or_insert(0) += 1;
}

fn api_workspace_fingerprint(file_contents: &[(ScannedFile, String)]) -> String {
    let mut fingerprints = file_contents
        .iter()
        .map(|(file, _)| format!("{}:{}", file.path, file.content_hash))
        .collect::<Vec<_>>();
    fingerprints.sort();
    stable_hash(&fingerprints.join("|"))
}

fn api_trimmed_excerpt(line: &str) -> String {
    line.trim().chars().take(220).collect()
}

fn redact_api_evidence_excerpt(line: &str) -> (String, bool) {
    let excerpt = api_trimmed_excerpt(line);
    let lowered = excerpt.to_ascii_lowercase();
    let contains_sensitive_marker = [
        "authorization",
        "set-cookie",
        "cookie",
        "bearer ",
        "token",
        "password",
        "passwd",
        "secret",
        "api_key",
        "api-key",
        "api key",
        "apikey",
        "private_key",
        "private-key",
        "private key",
        "credential",
    ]
    .iter()
    .any(|marker| lowered.contains(marker));
    if contains_sensitive_marker {
        ("[redacted sensitive API evidence]".to_string(), true)
    } else {
        (excerpt, false)
    }
}

fn api_evidence_payload(
    source_file: &str,
    line: usize,
    excerpt: &str,
    parser_source: &str,
    generated_at: &str,
) -> ApiEvidence {
    let (safe_excerpt, redacted) = redact_api_evidence_excerpt(excerpt);
    ApiEvidence {
        path: source_file.to_string(),
        line,
        excerpt: safe_excerpt,
        redacted,
        parser_source: parser_source.to_string(),
        extractor_version: "project-map-api-contract-v1".to_string(),
        observed_at: generated_at.to_string(),
    }
}

fn parse_api_methods_from_line(line: &str) -> Vec<String> {
    let upper = line.to_ascii_uppercase();
    ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]
        .iter()
        .filter(|method| upper.contains(**method))
        .map(|method| method.to_string())
        .collect()
}

fn handler_after_first_comma(line: &str) -> Option<String> {
    let (_, tail) = line.split_once(',')?;
    let raw = tail
        .split([',', ')', ']'])
        .next()
        .unwrap_or(tail)
        .trim()
        .trim_start_matches('&')
        .trim_start_matches('*')
        .trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

fn handler_name_before_parenthesis(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.starts_with('@') || trimmed.starts_with('#') || trimmed.starts_with('[') {
        return None;
    }
    let before_parenthesis = trimmed.split_once('(')?.0.trim();
    let token = before_parenthesis
        .split_whitespace()
        .last()?
        .trim_matches(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '$'
        });
    if token.is_empty()
        || matches!(
            token,
            "if" | "for" | "while" | "switch" | "catch" | "return" | "new" | "class"
        )
    {
        None
    } else {
        Some(token.to_string())
    }
}

fn file_stem_label(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .split('.')
        .next()
        .unwrap_or(path)
        .to_string()
}

fn api_module_label(file: &ScannedFile) -> String {
    let path = file.path.replace('\\', "/");
    if let Some(package_path) = path
        .strip_prefix("src/main/java/")
        .or_else(|| path.strip_prefix("src/main/kotlin/"))
        .and_then(|tail| {
            tail.rsplit_once('/')
                .map(|(directory, _)| directory.replace('/', "."))
        })
    {
        if !package_path.is_empty() {
            return package_path;
        }
    }
    module_label(&file.path)
}

fn push_api_route_candidate(
    candidates: &mut Vec<ApiRouteCandidate>,
    file: &ScannedFile,
    annotation: ApiRouteAnnotation,
    line: usize,
    excerpt: &str,
    handler_symbol: Option<String>,
    controller_label: Option<String>,
) {
    push_api_route_candidate_with_metadata(
        candidates,
        file,
        annotation,
        line,
        excerpt,
        handler_symbol,
        controller_label,
        JavaApiMethodMetadata::default(),
    );
}

fn push_api_route_candidate_with_metadata(
    candidates: &mut Vec<ApiRouteCandidate>,
    file: &ScannedFile,
    annotation: ApiRouteAnnotation,
    line: usize,
    excerpt: &str,
    handler_symbol: Option<String>,
    controller_label: Option<String>,
    metadata: JavaApiMethodMetadata,
) {
    let method = annotation.method.map(|value| value.to_ascii_uppercase());
    let path = normalize_api_path(annotation.path);
    let handler_symbol = handler_symbol.filter(|value| !value.trim().is_empty());
    let controller_label = controller_label
        .filter(|value| !value.trim().is_empty())
        .or_else(|| handler_symbol.clone())
        .unwrap_or_else(|| file_stem_label(&file.path));
    candidates.push(ApiRouteCandidate {
        protocol: "http".to_string(),
        language: file.language.clone(),
        framework: Some(annotation.framework),
        method,
        path,
        operation_name: None,
        handler_symbol,
        source_file: file.path.clone(),
        line,
        excerpt: api_trimmed_excerpt(excerpt),
        confidence: annotation.confidence,
        parser_source: annotation.parser_source,
        module_label: api_module_label(file),
        controller_label,
        parameter_overrides: java_signature_parameters(file, line, excerpt, &metadata),
        request_body_override: java_request_body(file, line, excerpt),
        response_overrides: java_annotation_responses(file, line, excerpt, &metadata),
        request_schema_override: None,
        response_schema_override: None,
        description: metadata.description,
        usage_scenario: None,
    });
}

fn quoted_value_after_key(value: &str, key: &str) -> Option<String> {
    let key_index = value.find(key)?;
    first_quoted_value(&value[key_index..])
}

fn java_swagger_summary(line: &str) -> Option<String> {
    if line.contains("@Operation") {
        quoted_value_after_key(line, "summary")
            .or_else(|| quoted_value_after_key(line, "description"))
            .or_else(|| first_quoted_value(line))
    } else {
        None
    }
}

fn java_swagger_parameter_description(line: &str) -> Option<String> {
    if line.contains("@Parameter") {
        quoted_value_after_key(line, "description").or_else(|| first_quoted_value(line))
    } else {
        None
    }
}

fn java_swagger_response(line: &str) -> Option<(String, String)> {
    if !line.contains("@ApiResponse") {
        return None;
    }
    let code = quoted_value_after_key(line, "responseCode")
        .or_else(|| quoted_value_after_key(line, "code"))
        .unwrap_or_else(|| "default".to_string());
    let description = quoted_value_after_key(line, "description")?;
    Some((code, description))
}

fn java_comment_text(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let text = trimmed
        .trim_start_matches("/**")
        .trim_start_matches("/*")
        .trim_start_matches("//")
        .trim_start_matches('*')
        .trim_end_matches("*/")
        .trim();
    if text.is_empty() || text.starts_with('@') {
        None
    } else {
        Some(text.to_string())
    }
}

fn java_metadata_from_lines(lines: &[String]) -> JavaApiMethodMetadata {
    let mut metadata = JavaApiMethodMetadata::default();
    let mut pending_parameter_description: Option<String> = None;
    let mut comment_lines = Vec::new();
    for line in lines {
        if let Some(summary) = java_swagger_summary(line) {
            metadata.description = Some(summary);
        }
        if let Some(response) = java_swagger_response(line) {
            metadata.response_descriptions.push(response);
        }
        if let Some(description) = java_swagger_parameter_description(line) {
            pending_parameter_description = Some(description);
        }
        if let Some(comment) = java_comment_text(line) {
            comment_lines.push(comment);
        }
    }
    if metadata.description.is_none() && !comment_lines.is_empty() {
        metadata.description = Some(comment_lines.join(" "));
    }
    if let Some(description) = pending_parameter_description {
        metadata
            .parameter_descriptions
            .insert("*".to_string(), description);
    }
    metadata
}

fn java_signature_parameters(
    file: &ScannedFile,
    line: usize,
    excerpt: &str,
    metadata: &JavaApiMethodMetadata,
) -> Vec<ApiParameter> {
    let Some(parameters_text) = api_signature_parameter_text(excerpt) else {
        return Vec::new();
    };
    split_api_signature_parameters(&parameters_text)
        .into_iter()
        .flat_map(|parameter| {
            let Some(location) = api_parameter_location_from_signature(&parameter) else {
                return Vec::new();
            };
            let Some((name, type_name)) = api_parameter_name_and_type(&parameter) else {
                return Vec::new();
            };
            let description = metadata
                .parameter_descriptions
                .get(&name)
                .or_else(|| metadata.parameter_descriptions.get("*"))
                .cloned()
                .or_else(|| java_swagger_parameter_description(&parameter));
            vec![ApiParameter {
                name,
                location: location.to_string(),
                required: matches!(location, "path" | "body"),
                schema: api_contract_schema_ref_from_name(
                    &type_name,
                    file,
                    line,
                    excerpt,
                    "fallback-pattern",
                    "",
                ),
                description,
                default_value: None,
                example: None,
                structured_fields: Vec::new(),
                evidence: vec![api_evidence_payload(
                    &file.path,
                    line,
                    excerpt,
                    "fallback-pattern",
                    "",
                )],
            }]
        })
        .collect()
}

fn java_request_body(file: &ScannedFile, line: usize, excerpt: &str) -> Option<ApiRequestBody> {
    let parameters_text = api_signature_parameter_text(excerpt)?;
    split_api_signature_parameters(&parameters_text)
        .into_iter()
        .find(|parameter| parameter.contains("@RequestBody"))
        .and_then(|parameter| {
            api_parameter_name_and_type(&parameter).map(|(_, type_name)| type_name)
        })
        .map(|type_name| ApiRequestBody {
            content_type: Some("application/json".to_string()),
            required: true,
            schema: api_contract_schema_ref_from_name(
                &type_name,
                file,
                line,
                excerpt,
                "fallback-pattern",
                "",
            ),
            structured_fields: Vec::new(),
            examples: Vec::new(),
            evidence: vec![api_evidence_payload(
                &file.path,
                line,
                excerpt,
                "fallback-pattern",
                "",
            )],
        })
}

fn java_return_type_from_excerpt(excerpt: &str) -> Option<String> {
    let before_parenthesis = excerpt.split_once('(')?.0;
    let tokens = before_parenthesis
        .split_whitespace()
        .filter(|token| {
            !matches!(
                *token,
                "public" | "private" | "protected" | "static" | "final" | "async"
            )
        })
        .collect::<Vec<_>>();
    tokens
        .iter()
        .rev()
        .skip(1)
        .next()
        .map(|value| (*value).to_string())
        .filter(|value| !matches!(value.as_str(), "void" | "Void"))
}

fn java_annotation_responses(
    file: &ScannedFile,
    line: usize,
    excerpt: &str,
    metadata: &JavaApiMethodMetadata,
) -> Vec<ApiResponse> {
    let return_type = java_return_type_from_excerpt(excerpt).unwrap_or_else(|| "R".to_string());
    metadata
        .response_descriptions
        .iter()
        .map(|(status_code, description)| ApiResponse {
            status_code: Some(status_code.clone()),
            content_type: Some("application/json".to_string()),
            schema: api_contract_schema_ref_from_name(
                &return_type,
                file,
                line,
                excerpt,
                "fallback-pattern",
                "",
            ),
            structured_fields: vec![ApiStructuredSchemaField {
                name: "description".to_string(),
                field_type: Some(description.clone()),
                required: None,
                default_value: None,
                description: Some(description.clone()),
                enum_values: Vec::new(),
                range: None,
                example: None,
                children: Vec::new(),
                evidence: vec![api_evidence_payload(
                    &file.path,
                    line,
                    excerpt,
                    "fallback-pattern",
                    "",
                )],
            }],
            examples: Vec::new(),
            is_error: status_code.starts_with('4') || status_code.starts_with('5'),
            evidence: vec![api_evidence_payload(
                &file.path,
                line,
                excerpt,
                "fallback-pattern",
                "",
            )],
        })
        .collect()
}

fn spring_route_annotation(line: &str) -> Option<ApiRouteAnnotation> {
    let trimmed = line.trim();
    let route = if trimmed.contains("@GetMapping") {
        Some(("GET", "Spring MVC"))
    } else if trimmed.contains("@PostMapping") {
        Some(("POST", "Spring MVC"))
    } else if trimmed.contains("@PutMapping") {
        Some(("PUT", "Spring MVC"))
    } else if trimmed.contains("@DeleteMapping") {
        Some(("DELETE", "Spring MVC"))
    } else if trimmed.contains("@PatchMapping") {
        Some(("PATCH", "Spring MVC"))
    } else if trimmed.contains("@Get(") || trimmed.contains("@io.micronaut.http.annotation.Get") {
        Some(("GET", "Micronaut"))
    } else if trimmed.contains("@Post(") || trimmed.contains("@io.micronaut.http.annotation.Post") {
        Some(("POST", "Micronaut"))
    } else if trimmed.contains("@Put(") || trimmed.contains("@io.micronaut.http.annotation.Put") {
        Some(("PUT", "Micronaut"))
    } else if trimmed.contains("@Delete(")
        || trimmed.contains("@io.micronaut.http.annotation.Delete")
    {
        Some(("DELETE", "Micronaut"))
    } else if trimmed == "@GET" || trimmed.contains("@GET ") {
        Some(("GET", "JAX-RS"))
    } else if trimmed == "@POST" || trimmed.contains("@POST ") {
        Some(("POST", "JAX-RS"))
    } else if trimmed == "@PUT" || trimmed.contains("@PUT ") {
        Some(("PUT", "JAX-RS"))
    } else if trimmed == "@DELETE" || trimmed.contains("@DELETE ") {
        Some(("DELETE", "JAX-RS"))
    } else if trimmed == "@PATCH" || trimmed.contains("@PATCH ") {
        Some(("PATCH", "JAX-RS"))
    } else if trimmed.contains("@RequestMapping") {
        None
    } else if trimmed.contains("@Path(") {
        None
    } else if trimmed.contains("@Controller(") {
        None
    } else {
        return None;
    };
    let method = route
        .map(|(method, _)| method.to_string())
        .or_else(|| parse_api_methods_from_line(trimmed).first().cloned());
    Some(ApiRouteAnnotation {
        method,
        path: first_quoted_value(trimmed),
        framework: route
            .map(|(_, framework)| framework)
            .unwrap_or_else(|| {
                if trimmed.contains("@Path(") {
                    "JAX-RS"
                } else if trimmed.contains("@Controller(") {
                    "Micronaut"
                } else {
                    "Spring MVC"
                }
            })
            .to_string(),
        confidence: if trimmed.contains("@RequestMapping")
            || trimmed.contains("@Path(")
            || trimmed.contains("@Controller(")
        {
            "medium"
        } else {
            "high"
        }
        .to_string(),
        parser_source: "fallback-pattern".to_string(),
    })
}

fn merge_java_route_annotations(annotations: Vec<ApiRouteAnnotation>) -> Vec<ApiRouteAnnotation> {
    if annotations.len() <= 1 {
        return annotations;
    }
    let method = annotations
        .iter()
        .find_map(|annotation| annotation.method.clone());
    let path = annotations
        .iter()
        .rev()
        .find_map(|annotation| annotation.path.clone());
    let framework = annotations
        .iter()
        .find(|annotation| annotation.method.is_some())
        .or_else(|| annotations.first())
        .map(|annotation| annotation.framework.clone())
        .unwrap_or_else(|| "JAX-RS".to_string());
    let confidence = if method.is_some() && path.is_some() {
        "high"
    } else {
        "medium"
    }
    .to_string();
    vec![ApiRouteAnnotation {
        method,
        path,
        framework,
        confidence,
        parser_source: "fallback-pattern".to_string(),
    }]
}

fn extract_java_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    let mut candidates = Vec::new();
    let class_name = java_declared_type(content).unwrap_or_else(|| file_stem_label(&file.path));
    let mut class_prefix = "/".to_string();
    let mut pending_annotations = Vec::<ApiRouteAnnotation>::new();
    let mut pending_metadata_lines = Vec::<String>::new();

    for (line_index, line) in content.lines().enumerate() {
        let line_number = line_index + 1;
        if let Some(annotation) = spring_route_annotation(line) {
            if let Some(method_name) = handler_name_before_parenthesis(line) {
                let mut route = annotation;
                route.path = join_api_paths(&class_prefix, route.path);
                let metadata = java_metadata_from_lines(&pending_metadata_lines);
                push_api_route_candidate_with_metadata(
                    &mut candidates,
                    file,
                    route,
                    line_number,
                    line,
                    Some(format!("{class_name}.{method_name}")),
                    Some(class_name.clone()),
                    metadata,
                );
                pending_metadata_lines.clear();
            } else {
                pending_annotations.push(annotation);
            }
            continue;
        }

        let trimmed = line.trim();
        if trimmed.starts_with('@')
            || trimmed.starts_with("/**")
            || trimmed.starts_with("/*")
            || trimmed.starts_with('*')
            || trimmed.starts_with("//")
        {
            pending_metadata_lines.push(line.to_string());
        }
        if !pending_annotations.is_empty()
            && (trimmed.contains(" class ")
                || trimmed.starts_with("class ")
                || trimmed.contains(" interface "))
        {
            if let Some(prefix) = pending_annotations
                .iter()
                .rev()
                .find_map(|annotation| annotation.path.clone())
                .and_then(|path| normalize_api_path(Some(path)))
            {
                class_prefix = prefix;
            }
            pending_annotations.clear();
            pending_metadata_lines.clear();
            continue;
        }

        if pending_annotations.is_empty() {
            continue;
        }
        let Some(method_name) = handler_name_before_parenthesis(line) else {
            continue;
        };
        let annotations = merge_java_route_annotations(pending_annotations.drain(..).collect());
        let metadata = java_metadata_from_lines(&pending_metadata_lines);
        pending_metadata_lines.clear();
        for mut annotation in annotations {
            annotation.path = join_api_paths(&class_prefix, annotation.path);
            push_api_route_candidate_with_metadata(
                &mut candidates,
                file,
                annotation,
                line_number,
                line,
                Some(format!("{class_name}.{method_name}")),
                Some(class_name.clone()),
                metadata.clone(),
            );
        }
    }

    candidates
}

fn python_route_annotation(line: &str) -> Option<ApiRouteAnnotation> {
    let trimmed = line.trim();
    if !trimmed.starts_with('@') {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    for (needle, method, framework) in [
        (".get(", "GET", "FastAPI"),
        (".post(", "POST", "FastAPI"),
        (".put(", "PUT", "FastAPI"),
        (".delete(", "DELETE", "FastAPI"),
        (".patch(", "PATCH", "FastAPI"),
    ] {
        if lower.contains(needle) {
            return Some(ApiRouteAnnotation {
                method: Some(method.to_string()),
                path: first_quoted_value(trimmed),
                framework: framework.to_string(),
                confidence: "high".to_string(),
                parser_source: "fallback-pattern".to_string(),
            });
        }
    }
    if lower.contains(".route(") {
        return Some(ApiRouteAnnotation {
            method: parse_api_methods_from_line(trimmed).first().cloned(),
            path: first_quoted_value(trimmed),
            framework: "Flask".to_string(),
            confidence: "medium".to_string(),
            parser_source: "fallback-pattern".to_string(),
        });
    }
    if lower.contains("@api_view(") {
        return Some(ApiRouteAnnotation {
            method: parse_api_methods_from_line(trimmed).first().cloned(),
            path: None,
            framework: "DRF".to_string(),
            confidence: "medium".to_string(),
            parser_source: "fallback-pattern".to_string(),
        });
    }
    if lower.contains("@action(") {
        let path = trimmed
            .split("url_path")
            .nth(1)
            .and_then(first_quoted_value)
            .or_else(|| first_quoted_value(trimmed));
        return Some(ApiRouteAnnotation {
            method: parse_api_methods_from_line(trimmed).first().cloned(),
            path,
            framework: "DRF".to_string(),
            confidence: "medium".to_string(),
            parser_source: "fallback-pattern".to_string(),
        });
    }
    None
}

fn extract_python_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    let mut candidates = Vec::new();
    let mut pending_annotations = Vec::<ApiRouteAnnotation>::new();
    for (line_index, line) in content.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();
        if let Some(annotation) = python_route_annotation(line) {
            pending_annotations.push(annotation);
            continue;
        }
        if !pending_annotations.is_empty() && trimmed.starts_with("def ") {
            let handler = trimmed.strip_prefix("def ").and_then(|tail| {
                tail.split_once('(')
                    .map(|(name, _)| name.trim().to_string())
            });
            for annotation in pending_annotations.drain(..) {
                push_api_route_candidate(
                    &mut candidates,
                    file,
                    annotation,
                    line_number,
                    line,
                    handler.clone(),
                    Some(file_stem_label(&file.path)),
                );
            }
            continue;
        }
        if trimmed.starts_with("path(")
            || trimmed.contains(" path(")
            || trimmed.starts_with("re_path(")
        {
            push_api_route_candidate(
                &mut candidates,
                file,
                ApiRouteAnnotation {
                    method: None,
                    path: first_quoted_value(trimmed),
                    framework: "Django".to_string(),
                    confidence: "medium".to_string(),
                    parser_source: "fallback-pattern".to_string(),
                },
                line_number,
                line,
                handler_after_first_comma(line),
                Some(file_stem_label(&file.path)),
            );
        }
    }
    candidates
}

fn extract_line_call_api_candidates(
    file: &ScannedFile,
    content: &str,
    framework: &str,
    methods: &[(&str, &str)],
) -> Vec<ApiRouteCandidate> {
    let mut candidates = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let lower = line.to_ascii_lowercase();
        for &(needle, method) in methods {
            if !lower.contains(needle) {
                continue;
            }
            let quoted_path = first_quoted_value(line);
            let route_like_path = quoted_path
                .as_deref()
                .map(|path| path.starts_with('/') || path.starts_with(':') || path.contains('{'))
                .unwrap_or(false);
            let route_like_context = lower.contains("router")
                || lower.contains("route")
                || lower.contains("app.")
                || lower.contains("server")
                || lower.contains("http")
                || lower.trim_start().starts_with('@')
                || lower.trim_start().starts_with('[')
                || lower.contains("mapget")
                || lower.contains("mappost")
                || lower.contains("mapput")
                || lower.contains("mapdelete")
                || lower.contains("mappatch")
                || lower.contains("crow_route")
                || lower.contains("mg_http_match_uri");
            if !route_like_path && !route_like_context {
                continue;
            }
            push_api_route_candidate(
                &mut candidates,
                file,
                ApiRouteAnnotation {
                    method: Some((*method).to_string()),
                    path: quoted_path,
                    framework: framework.to_string(),
                    confidence: "medium".to_string(),
                    parser_source: "fallback-pattern".to_string(),
                },
                line_index + 1,
                line,
                handler_after_first_comma(line),
                Some(file_stem_label(&file.path)),
            );
        }
    }
    candidates
}

fn extract_go_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    let mut candidates = extract_line_call_api_candidates(
        file,
        content,
        "Go router",
        &[
            (".get(", "GET"),
            (".post(", "POST"),
            (".put(", "PUT"),
            (".delete(", "DELETE"),
            (".patch(", "PATCH"),
            (".handlefunc(", ""),
            (".handle(", ""),
            (".methodfunc(", ""),
        ],
    );
    for candidate in &mut candidates {
        if candidate.method.as_deref() == Some("") {
            candidate.method = None;
            candidate.framework = Some("net/http".to_string());
        }
    }
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if !(trimmed.contains("Register") && trimmed.contains("Server(")) {
            continue;
        }
        push_api_route_candidate(
            &mut candidates,
            file,
            ApiRouteAnnotation {
                method: None,
                path: None,
                framework: "gRPC".to_string(),
                confidence: "medium".to_string(),
                parser_source: "fallback-pattern".to_string(),
            },
            line_index + 1,
            line,
            handler_after_first_comma(line),
            Some(file_stem_label(&file.path)),
        );
    }
    candidates
}

fn extract_typescript_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    let mut candidates = extract_line_call_api_candidates(
        file,
        content,
        "Node router",
        &[
            (".get(", "GET"),
            (".post(", "POST"),
            (".put(", "PUT"),
            (".delete(", "DELETE"),
            (".patch(", "PATCH"),
            ("@get(", "GET"),
            ("@post(", "POST"),
            ("@put(", "PUT"),
            ("@delete(", "DELETE"),
            ("@patch(", "PATCH"),
        ],
    );
    for candidate in &mut candidates {
        if candidate.excerpt.trim_start().starts_with('@') {
            candidate.framework = Some("NestJS".to_string());
        }
    }
    let normalized_path = file.path.replace('\\', "/");
    if normalized_path.contains("/pages/api/") || normalized_path.contains("/app/api/") {
        let api_path = normalized_path
            .split("/pages/api/")
            .nth(1)
            .or_else(|| normalized_path.split("/app/api/").nth(1))
            .map(|tail| {
                let without_extension = tail.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(tail);
                format!(
                    "/api/{}",
                    without_extension
                        .replace("/route", "")
                        .replace("[", ":")
                        .replace("]", "")
                )
            });
        if let Some(path) = api_path {
            push_api_route_candidate(
                &mut candidates,
                file,
                ApiRouteAnnotation {
                    method: None,
                    path: Some(path),
                    framework: "Next API routes".to_string(),
                    confidence: "medium".to_string(),
                    parser_source: "fallback-pattern".to_string(),
                },
                1,
                "Next API route file path",
                Some(file_stem_label(&file.path)),
                Some("Next API routes".to_string()),
            );
        }
    }
    candidates
}

fn extract_csharp_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    let mut candidates = extract_line_call_api_candidates(
        file,
        content,
        "ASP.NET Core",
        &[
            ("mapget(", "GET"),
            ("mappost(", "POST"),
            ("mapput(", "PUT"),
            ("mapdelete(", "DELETE"),
            ("mappatch(", "PATCH"),
            ("mapmethods(", ""),
            ("[route(", ""),
            ("[httpget", "GET"),
            ("[httppost", "POST"),
            ("[httpput", "PUT"),
            ("[httpdelete", "DELETE"),
            ("[httppatch", "PATCH"),
        ],
    );
    for candidate in &mut candidates {
        if candidate.path.is_none() && candidate.excerpt.contains('(') {
            candidate.path = Some("/".to_string());
        }
    }
    candidates
}

fn extract_rust_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    extract_line_call_api_candidates(
        file,
        content,
        "Rust web",
        &[
            (".route(", ""),
            ("web::resource(", ""),
            ("warp::path(", ""),
            ("#[get(", "GET"),
            ("#[post(", "POST"),
            ("#[put(", "PUT"),
            ("#[delete(", "DELETE"),
            ("#[patch(", "PATCH"),
        ],
    )
    .into_iter()
    .map(|mut candidate| {
        if candidate.method.as_deref() == Some("") {
            candidate.method = parse_api_methods_from_line(&candidate.excerpt)
                .first()
                .cloned();
            candidate.framework = Some("Axum/Rocket".to_string());
        }
        candidate
    })
    .collect()
}

fn extract_c_family_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    let framework = if file.language == "c" {
        "C HTTP handler"
    } else {
        "C++ HTTP framework"
    };
    let mut candidates = extract_line_call_api_candidates(
        file,
        content,
        framework,
        &[
            ("crow_route(", ""),
            ("drogon::app().registerhandler(", ""),
            ("registerhandler(", ""),
            ("addhandler(", ""),
            ("add_route(", ""),
            ("routes::get(", "GET"),
            ("routes::post(", "POST"),
            ("http_endpoint(", ""),
            ("microhttpd", ""),
            (".get(", "GET"),
            (".post(", "POST"),
            (".put(", "PUT"),
            (".delete(", "DELETE"),
            ("mg_http_match_uri(", ""),
            ("mg_set_request_handler(", ""),
            ("mg_http_reply(", ""),
        ],
    );
    for candidate in &mut candidates {
        if candidate.method.as_deref() == Some("") {
            candidate.method = None;
            candidate.confidence = "low".to_string();
        }
    }
    candidates
}

fn extract_project_api_candidates(file: &ScannedFile, content: &str) -> Vec<ApiRouteCandidate> {
    api_adapter_descriptor_for_language(&file.language)
        .map(|descriptor| (descriptor.extractor)(file, content))
        .unwrap_or_default()
}

fn api_path_parameters(
    path: Option<&str>,
    candidate: &ApiRouteCandidate,
    generated_at: &str,
) -> Vec<ApiParameter> {
    let Some(path) = path else {
        return Vec::new();
    };
    let mut parameters = Vec::new();
    let mut seen = BTreeSet::new();
    for segment in path.split('/') {
        let name = if segment.starts_with('{') && segment.ends_with('}') {
            segment
                .trim_start_matches('{')
                .trim_end_matches('}')
                .to_string()
        } else if let Some(name) = segment.strip_prefix(':') {
            name.to_string()
        } else if segment.starts_with('<') && segment.ends_with('>') {
            segment
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string()
        } else {
            continue;
        };
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        parameters.push(ApiParameter {
            name,
            location: "path".to_string(),
            required: true,
            schema: None,
            description: None,
            default_value: None,
            example: None,
            structured_fields: Vec::new(),
            evidence: vec![api_evidence(candidate, generated_at)],
        });
    }
    parameters
}

fn api_evidence(candidate: &ApiRouteCandidate, generated_at: &str) -> ApiEvidence {
    api_evidence_payload(
        &candidate.source_file,
        candidate.line,
        &candidate.excerpt,
        &candidate.parser_source,
        generated_at,
    )
}

fn api_schema_ref_json(
    type_name: &str,
    candidate: &ApiRouteCandidate,
    generated_at: &str,
) -> Option<ApiSchemaRef> {
    let normalized = type_name
        .trim()
        .trim_start_matches("final ")
        .trim_start_matches("const ")
        .trim()
        .trim_end_matches("...")
        .trim();
    if normalized.is_empty() || matches!(normalized, "void" | "Void" | "Unit") {
        return None;
    }
    Some(ApiSchemaRef {
        id: format!(
            "api-schema-{}",
            stable_hash(&format!("{}|{}", candidate.source_file, normalized))
        ),
        name: normalized.to_string(),
        language: candidate.language.clone(),
        source_file: candidate.source_file.clone(),
        evidence: vec![api_evidence(candidate, generated_at)],
    })
}

fn api_signature_parameter_text(signature: &str) -> Option<String> {
    let start = signature.find('(')?;
    let end = signature.rfind(')')?;
    if end <= start {
        return None;
    }
    Some(signature[start + 1..end].to_string())
}

fn split_api_signature_parameters(value: &str) -> Vec<String> {
    let mut parameters = Vec::new();
    let mut current = String::new();
    let mut angle_depth = 0usize;
    let mut paren_depth = 0usize;
    for character in value.chars() {
        match character {
            '<' => {
                angle_depth += 1;
                current.push(character);
            }
            '>' => {
                angle_depth = angle_depth.saturating_sub(1);
                current.push(character);
            }
            '(' => {
                paren_depth += 1;
                current.push(character);
            }
            ')' => {
                paren_depth = paren_depth.saturating_sub(1);
                current.push(character);
            }
            ',' if angle_depth == 0 && paren_depth == 0 => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    parameters.push(trimmed.to_string());
                }
                current.clear();
            }
            _ => current.push(character),
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        parameters.push(trimmed.to_string());
    }
    parameters
}

fn api_parameter_location_from_signature(parameter: &str) -> Option<&'static str> {
    if parameter.contains("@PathVariable") {
        Some("path")
    } else if parameter.contains("@RequestParam") {
        Some("query")
    } else if parameter.contains("@RequestHeader") {
        Some("header")
    } else if parameter.contains("@CookieValue") {
        Some("cookie")
    } else if parameter.contains("@RequestBody") {
        Some("body")
    } else {
        None
    }
}

fn strip_java_annotations(value: &str) -> String {
    let mut output = String::new();
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '@' {
            output.push(character);
            continue;
        }
        while let Some(next) = chars.peek().copied() {
            if next.is_whitespace() || next == '(' {
                break;
            }
            chars.next();
        }
        if chars.peek() == Some(&'(') {
            let mut depth = 0usize;
            for next in chars.by_ref() {
                if next == '(' {
                    depth += 1;
                } else if next == ')' {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        break;
                    }
                }
            }
        }
        output.push(' ');
    }
    output
}

fn api_parameter_name_and_type(parameter: &str) -> Option<(String, String)> {
    let explicit_name = if parameter.contains("@RequestParam")
        || parameter.contains("@PathVariable")
        || parameter.contains("@RequestHeader")
        || parameter.contains("@CookieValue")
    {
        first_quoted_value(parameter)
    } else {
        None
    };
    let cleaned = strip_java_annotations(parameter)
        .replace("final ", " ")
        .replace("const ", " ")
        .replace("...", " ");
    let tokens = cleaned
        .split_whitespace()
        .filter(|token| {
            !matches!(
                *token,
                "public" | "private" | "protected" | "static" | "final"
            )
        })
        .collect::<Vec<_>>();
    let fallback_name = tokens
        .last()?
        .trim_matches(|character: char| !character.is_alphanumeric() && character != '_');
    let name = explicit_name.unwrap_or_else(|| fallback_name.to_string());
    if name.is_empty() {
        return None;
    }
    let type_name = tokens
        .iter()
        .rev()
        .skip(1)
        .next()
        .copied()
        .unwrap_or("unknown")
        .trim()
        .to_string();
    Some((name, type_name))
}

fn api_signature_parameters(
    candidate: &ApiRouteCandidate,
    generated_at: &str,
) -> Vec<ApiParameter> {
    let Some(parameters_text) = api_signature_parameter_text(&candidate.excerpt) else {
        return Vec::new();
    };
    split_api_signature_parameters(&parameters_text)
        .into_iter()
        .flat_map(|parameter| {
            let Some(location) = api_parameter_location_from_signature(&parameter) else {
                return Vec::new();
            };
            let Some((name, type_name)) = api_parameter_name_and_type(&parameter) else {
                return Vec::new();
            };
            vec![ApiParameter {
                name,
                location: location.to_string(),
                required: matches!(location, "path" | "body"),
                schema: api_schema_ref_json(&type_name, candidate, generated_at),
                description: None,
                default_value: None,
                example: None,
                structured_fields: Vec::new(),
                evidence: vec![api_evidence(candidate, generated_at)],
            }]
        })
        .collect()
}

fn api_request_body(candidate: &ApiRouteCandidate, generated_at: &str) -> Option<ApiRequestBody> {
    let parameters_text = api_signature_parameter_text(&candidate.excerpt)?;
    split_api_signature_parameters(&parameters_text)
        .into_iter()
        .find(|parameter| parameter.contains("@RequestBody"))
        .and_then(|parameter| api_parameter_name_and_type(&parameter))
        .map(|(_, type_name)| ApiRequestBody {
            content_type: Some("application/json".to_string()),
            required: true,
            schema: api_schema_ref_json(&type_name, candidate, generated_at),
            structured_fields: Vec::new(),
            examples: Vec::new(),
            evidence: vec![api_evidence(candidate, generated_at)],
        })
}

fn api_signature_response(candidate: &ApiRouteCandidate, generated_at: &str) -> Vec<ApiResponse> {
    let Some(handler_symbol) = candidate.handler_symbol.as_deref() else {
        return Vec::new();
    };
    let Some(method_name) = handler_symbol.rsplit('.').next() else {
        return Vec::new();
    };
    let Some((prefix, _)) = candidate.excerpt.split_once(&format!("{method_name}(")) else {
        return Vec::new();
    };
    let return_type = prefix.split_whitespace().rev().find(|token| {
        !matches!(
            *token,
            "public" | "private" | "protected" | "static" | "final" | "async"
        )
    });
    let Some(return_type) = return_type else {
        return Vec::new();
    };
    if matches!(return_type, "void" | "Void") {
        return Vec::new();
    }
    vec![ApiResponse {
        status_code: Some("200".to_string()),
        content_type: Some("application/json".to_string()),
        schema: api_schema_ref_json(return_type, candidate, generated_at),
        structured_fields: Vec::new(),
        examples: Vec::new(),
        is_error: false,
        evidence: vec![api_evidence(candidate, generated_at)],
    }]
}

fn java_identifier_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '$')
}

fn java_simple_type_name(value: &str) -> String {
    value
        .rsplit('.')
        .next()
        .unwrap_or(value)
        .split('<')
        .next()
        .unwrap_or(value)
        .trim_matches(|character: char| !java_identifier_char(character))
        .to_string()
}

fn java_injected_field_from_line(
    line: &str,
    previous_line: Option<&str>,
) -> Option<(String, String)> {
    let trimmed = line.trim();
    if !trimmed.ends_with(';') || trimmed.contains('(') {
        return None;
    }
    let has_injection_marker = trimmed.contains("@Autowired")
        || trimmed.contains("@Inject")
        || trimmed.contains("@Resource")
        || previous_line
            .map(|line| {
                line.contains("@Autowired")
                    || line.contains("@Inject")
                    || line.contains("@Resource")
            })
            .unwrap_or(false);
    let cleaned = strip_java_annotations(trimmed)
        .split('=')
        .next()
        .unwrap_or(trimmed)
        .trim_end_matches(';')
        .replace(" final ", " ");
    let tokens = cleaned
        .split_whitespace()
        .filter(|token| {
            !matches!(
                *token,
                "private" | "protected" | "public" | "static" | "final" | "volatile" | "transient"
            )
        })
        .collect::<Vec<_>>();
    if tokens.len() < 2 {
        return None;
    }
    let field_name = tokens
        .last()?
        .trim_matches(|character: char| !java_identifier_char(character));
    let field_type = java_simple_type_name(tokens.get(tokens.len().saturating_sub(2))?);
    if field_name.is_empty() || field_type.is_empty() {
        return None;
    }
    if !has_injection_marker {
        let looks_like_collaborator = field_type.contains("Service")
            || field_type.contains("Manager")
            || field_type.contains("UseCase")
            || field_type.contains("Repository")
            || field_type.contains("Mapper")
            || field_type.ends_with("Dao")
            || field_type.ends_with("Client");
        if !looks_like_collaborator {
            return None;
        }
    }
    Some((field_name.to_string(), field_type))
}

fn java_brace_delta(line: &str) -> isize {
    let mut delta = 0isize;
    let mut in_string = false;
    let mut escaped = false;
    for character in line.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '{' => delta += 1,
            '}' => delta -= 1,
            _ => {}
        }
    }
    delta
}

fn java_method_body_bounds(lines: &[&str], signature_index: usize) -> Option<(usize, usize)> {
    let mut depth = 0isize;
    let mut body_start_index: Option<usize> = None;
    for (line_index, line) in lines.iter().enumerate().skip(signature_index) {
        let delta = java_brace_delta(line);
        if body_start_index.is_none() && line.contains('{') {
            body_start_index = Some(line_index);
        }
        if body_start_index.is_some() {
            depth += delta;
            if depth <= 0 {
                return Some((body_start_index? + 1, line_index + 1));
            }
        }
    }
    None
}

fn build_java_source_index(file: &ScannedFile, content: &str) -> Option<JavaSourceIndex> {
    if !matches!(file.language.as_str(), "java" | "kotlin") {
        return None;
    }
    let class_name = java_declared_type(content).unwrap_or_else(|| file_stem_label(&file.path));
    let lines = content.lines().collect::<Vec<_>>();
    let mut index = JavaSourceIndex {
        class_name: class_name.clone(),
        ..JavaSourceIndex::default()
    };
    for (line_index, line) in lines.iter().enumerate() {
        if let Some((field_name, field_type)) = java_injected_field_from_line(
            line,
            line_index
                .checked_sub(1)
                .and_then(|index| lines.get(index))
                .copied(),
        ) {
            index.injected_fields.insert(field_name, field_type);
        }
        let Some(method_name) = handler_name_before_parenthesis(line) else {
            continue;
        };
        if !line.contains(')') || !line.contains('{') {
            continue;
        }
        let Some((body_start_line, end_line)) = java_method_body_bounds(&lines, line_index) else {
            continue;
        };
        index.methods.push(JavaIndexedMethod {
            class_name: class_name.clone(),
            method_name,
            source_file: file.path.clone(),
            signature_line: line_index + 1,
            body_start_line,
            end_line,
        });
    }
    Some(index)
}

fn build_java_source_indexes(
    file_contents: &[(ScannedFile, String)],
) -> BTreeMap<String, JavaSourceIndex> {
    file_contents
        .iter()
        .filter_map(|(file, content)| {
            build_java_source_index(file, content).map(|index| (file.path.clone(), index))
        })
        .collect()
}

fn java_indexed_method_for_candidate(
    candidate: &ApiRouteCandidate,
    index: &JavaSourceIndex,
) -> Option<JavaIndexedMethod> {
    let method_name = candidate
        .handler_symbol
        .as_deref()
        .and_then(|symbol| symbol.rsplit('.').next())
        .or_else(|| candidate.operation_name.as_deref())?;
    index
        .methods
        .iter()
        .find(|method| {
            method.method_name == method_name
                && candidate.line >= method.signature_line
                && candidate.line <= method.end_line
        })
        .or_else(|| {
            index
                .methods
                .iter()
                .find(|method| method.method_name == method_name)
        })
        .cloned()
}

fn java_call_expressions(line: &str) -> Vec<(String, String)> {
    let chars = line.char_indices().collect::<Vec<_>>();
    let mut calls = Vec::new();
    for (position, (byte_index, character)) in chars.iter().enumerate() {
        if *character != '.' {
            continue;
        }
        let mut receiver_start = *byte_index;
        for (left_byte, left_char) in chars[..position].iter().rev() {
            if java_identifier_char(*left_char) {
                receiver_start = *left_byte;
            } else {
                break;
            }
        }
        let receiver = line[receiver_start..*byte_index].trim();
        if receiver.is_empty() {
            continue;
        }
        let method_start = *byte_index + 1;
        let mut method_end = method_start;
        for (right_byte, right_char) in chars.iter().skip(position + 1) {
            if java_identifier_char(*right_char) {
                method_end = *right_byte + right_char.len_utf8();
            } else {
                break;
            }
        }
        let method = line[method_start..method_end].trim();
        if method.is_empty() || line[method_end..].trim_start().chars().next() != Some('(') {
            continue;
        }
        if matches!(method, "class" | "equals" | "hashCode" | "toString") {
            continue;
        }
        calls.push((receiver.to_string(), method.to_string()));
    }
    calls
}

fn java_resolve_receiver_type(source_index: &JavaSourceIndex, receiver: &str) -> Option<String> {
    if receiver == "this" {
        return Some(source_index.class_name.clone());
    }
    source_index
        .injected_fields
        .get(receiver)
        .cloned()
        .or_else(|| {
            receiver
                .chars()
                .next()
                .filter(|character| character.is_ascii_uppercase())
                .map(|_| java_simple_type_name(receiver))
        })
}

fn java_type_matches_class(type_name: &str, class_name: &str) -> bool {
    let normalized_type = type_name.trim_start_matches('I');
    class_name == type_name
        || class_name == normalized_type
        || class_name == format!("{normalized_type}Impl")
        || class_name.ends_with(&format!(".{normalized_type}"))
        || class_name.ends_with(&format!("{normalized_type}Impl"))
}

fn java_find_target_method(
    java_source_indexes: &BTreeMap<String, JavaSourceIndex>,
    type_name: &str,
    method_name: &str,
) -> Option<JavaIndexedMethod> {
    java_source_indexes
        .values()
        .flat_map(|index| index.methods.iter())
        .find(|method| {
            method.method_name == method_name
                && java_type_matches_class(type_name, &method.class_name)
        })
        .cloned()
}

fn api_call_chain_kind_from_target(type_name: &str, target_file: Option<&str>) -> String {
    let lower = format!("{} {}", type_name, target_file.unwrap_or("")).to_ascii_lowercase();
    if lower.contains("repository") || lower.contains("mapper") || lower.contains("dao") {
        "repository".to_string()
    } else if lower.contains("model") || lower.contains("entity") {
        "model".to_string()
    } else if lower.contains("client") || lower.contains("resttemplate") || lower.contains("http") {
        "outbound-http".to_string()
    } else if lower.contains("rpc") || lower.contains("grpc") {
        "rpc".to_string()
    } else if lower.contains("service") || lower.contains("usecase") || lower.contains("manager") {
        "service".to_string()
    } else {
        "unknown".to_string()
    }
}

fn api_call_chain_edge_kind(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    if lower.contains("repository") || lower.contains(".repo") || lower.contains("dao.") {
        Some("repository".to_string())
    } else if lower.contains("model") || lower.contains("entity") {
        Some("model".to_string())
    } else if lower.contains("fetch(")
        || lower.contains("axios.")
        || lower.contains("http.")
        || lower.contains("request(")
        || lower.contains("resttemplate")
    {
        Some("outbound-http".to_string())
    } else if lower.contains("grpc") || lower.contains("rpc") || lower.contains("stub.") {
        Some("rpc".to_string())
    } else if lower.contains("service") || lower.contains("usecase") || lower.contains("manager") {
        Some("service".to_string())
    } else {
        None
    }
}

fn api_call_chain_target_symbol(line: &str) -> Option<String> {
    let before_parenthesis = line.split_once('(')?.0.trim();
    let token = before_parenthesis
        .split(|character: char| {
            character.is_whitespace() || character == '=' || character == ':' || character == ','
        })
        .last()?
        .trim_matches(|character: char| {
            !character.is_alphanumeric() && !matches!(character, '_' | '.' | ':' | '-')
        });
    if token.is_empty() || matches!(token, "if" | "for" | "while" | "switch" | "return") {
        None
    } else {
        Some(token.to_string())
    }
}

fn extract_fallback_api_call_chain(
    endpoint_id: &str,
    candidate: &ApiRouteCandidate,
    content: &str,
    generated_at: &str,
) -> Option<ApiCallChain> {
    let source_symbol = candidate
        .handler_symbol
        .clone()
        .or_else(|| candidate.operation_name.clone())?;
    let mut edges = Vec::new();
    let start_index = candidate.line.saturating_sub(1);
    for (offset, line) in content.lines().skip(start_index).take(80).enumerate() {
        let Some(kind) = api_call_chain_edge_kind(line) else {
            continue;
        };
        let Some(target_symbol) = api_call_chain_target_symbol(line) else {
            continue;
        };
        if target_symbol == source_symbol {
            continue;
        }
        let line_number = candidate.line + offset;
        let excerpt = api_trimmed_excerpt(line);
        edges.push(ApiCallChainEdge {
            id: format!(
                "api-chain-edge-{}",
                stable_hash(&format!(
                    "{}|{}|{}|{}",
                    endpoint_id, source_symbol, target_symbol, line_number
                ))
            ),
            source_symbol: source_symbol.clone(),
            target_symbol,
            source_file: candidate.source_file.clone(),
            line: Some(line_number),
            target_file: None,
            target_line: None,
            excerpt: Some(excerpt.clone()),
            direction: "forward".to_string(),
            kind,
            confidence: "low".to_string(),
            evidence: vec![api_evidence_payload(
                &candidate.source_file,
                line_number,
                &excerpt,
                &candidate.parser_source,
                generated_at,
            )],
        });
        if edges.len() >= 10 {
            break;
        }
    }
    if edges.is_empty() {
        return None;
    }
    Some(ApiCallChain {
        id: format!("api-chain-{}", stable_hash(endpoint_id)),
        endpoint_id: endpoint_id.to_string(),
        edges,
        max_depth: 1,
        truncated_reason: Some("max-depth-1-conservative-scan".to_string()),
    })
}

fn extract_java_resolved_api_call_chain(
    endpoint_id: &str,
    candidate: &ApiRouteCandidate,
    file_content_index: &BTreeMap<String, &str>,
    java_source_indexes: &BTreeMap<String, JavaSourceIndex>,
    generated_at: &str,
) -> Option<ApiCallChain> {
    let source_index = java_source_indexes.get(&candidate.source_file)?;
    let root_method = java_indexed_method_for_candidate(candidate, source_index)?;
    let mut edges = Vec::<ApiCallChainEdge>::new();
    let mut pending = vec![(root_method, 0usize)];
    let mut visited_methods = BTreeSet::<String>::new();
    let mut truncated = false;

    while let Some((source_method, depth)) = pending.pop() {
        let method_key = format!(
            "{}|{}|{}",
            source_method.source_file, source_method.class_name, source_method.method_name
        );
        if !visited_methods.insert(method_key) {
            continue;
        }
        let Some(source_content) = file_content_index.get(&source_method.source_file) else {
            continue;
        };
        let Some(source_index) = java_source_indexes.get(&source_method.source_file) else {
            continue;
        };
        for (line_offset, line) in source_content
            .lines()
            .enumerate()
            .skip(source_method.body_start_line.saturating_sub(1))
            .take(
                source_method
                    .end_line
                    .saturating_sub(source_method.body_start_line)
                    + 1,
            )
        {
            let line_number = line_offset + 1;
            for (receiver, target_method_name) in java_call_expressions(line) {
                let Some(target_type) = java_resolve_receiver_type(source_index, &receiver) else {
                    continue;
                };
                let target_method =
                    java_find_target_method(java_source_indexes, &target_type, &target_method_name);
                let target_symbol = target_method
                    .as_ref()
                    .map(|method| format!("{}.{}", method.class_name, method.method_name))
                    .unwrap_or_else(|| format!("{}.{}", target_type, target_method_name));
                let source_symbol =
                    format!("{}.{}", source_method.class_name, source_method.method_name);
                if source_symbol == target_symbol {
                    continue;
                }
                let excerpt = api_trimmed_excerpt(line);
                let target_file = target_method
                    .as_ref()
                    .map(|method| method.source_file.clone());
                let target_line = target_method.as_ref().map(|method| method.signature_line);
                let confidence = if target_method.is_some() {
                    "high"
                } else {
                    "medium"
                };
                edges.push(ApiCallChainEdge {
                    id: format!(
                        "api-chain-edge-{}",
                        stable_hash(&format!(
                            "{}|{}|{}|{}",
                            endpoint_id, source_symbol, target_symbol, line_number
                        ))
                    ),
                    source_symbol,
                    target_symbol,
                    source_file: source_method.source_file.clone(),
                    line: Some(line_number),
                    target_file: target_file.clone(),
                    target_line,
                    excerpt: Some(excerpt.clone()),
                    direction: "forward".to_string(),
                    kind: api_call_chain_kind_from_target(&target_type, target_file.as_deref()),
                    confidence: confidence.to_string(),
                    evidence: vec![api_evidence_payload(
                        &source_method.source_file,
                        line_number,
                        &excerpt,
                        "syntax-tree-parser",
                        generated_at,
                    )],
                });
                if edges.len() >= 24 {
                    truncated = true;
                    break;
                }
                if depth < 2 {
                    if let Some(target_method) = target_method {
                        pending.push((target_method, depth + 1));
                    }
                }
            }
            if truncated {
                break;
            }
        }
        if truncated {
            break;
        }
    }

    if edges.is_empty() {
        return None;
    }
    Some(ApiCallChain {
        id: format!("api-chain-{}", stable_hash(endpoint_id)),
        endpoint_id: endpoint_id.to_string(),
        edges,
        max_depth: 3,
        truncated_reason: truncated.then(|| "max-depth-3-resolved-static-scan".to_string()),
    })
}

fn extract_api_call_chain(
    endpoint_id: &str,
    candidate: &ApiRouteCandidate,
    file_content_index: &BTreeMap<String, &str>,
    java_source_indexes: &BTreeMap<String, JavaSourceIndex>,
    generated_at: &str,
) -> Option<ApiCallChain> {
    if matches!(candidate.language.as_str(), "java" | "kotlin") {
        return extract_java_resolved_api_call_chain(
            endpoint_id,
            candidate,
            file_content_index,
            java_source_indexes,
            generated_at,
        );
    }
    file_content_index
        .get(&candidate.source_file)
        .and_then(|content| {
            extract_fallback_api_call_chain(endpoint_id, candidate, content, generated_at)
        })
}

fn api_group_id(level: &str, label: &str, parent_id: Option<&str>) -> String {
    format!(
        "api-group-{}",
        stable_hash(&format!(
            "{}|{}|{}",
            level,
            label.to_ascii_lowercase(),
            parent_id.unwrap_or("")
        ))
    )
}

fn increment_api_group_counts(group: &mut ApiGroupBuild, candidate: &ApiRouteCandidate) {
    *group
        .protocol_counts
        .entry(candidate.protocol.clone())
        .or_insert(0) += 1;
    *group
        .language_counts
        .entry(candidate.language.clone())
        .or_insert(0) += 1;
    *group
        .confidence_counts
        .entry(candidate.confidence.clone())
        .or_insert(0) += 1;
}

pub(crate) fn build_api_contract_artifact(
    file_contents: &[(ScannedFile, String)],
    storage_key: &str,
    scan_run_id: &str,
    generated_at: &str,
    ignored_paths: &[Value],
) -> Value {
    let workspace_fingerprint = api_workspace_fingerprint(file_contents);
    let file_content_index = file_contents
        .iter()
        .map(|(file, content)| (file.path.clone(), content.as_str()))
        .collect::<BTreeMap<_, _>>();
    let java_source_indexes = build_java_source_indexes(file_contents);
    let schema_field_index = build_java_schema_field_index(file_contents, generated_at);
    let mut skipped_by_reason = BTreeMap::<String, usize>::new();
    for item in ignored_paths {
        increment_skipped_reason(
            &mut skipped_by_reason,
            canonical_api_scope_skip_reason(item),
        );
    }

    let descriptors = declared_api_adapter_descriptors();
    let mut adapter_coverage = descriptors
        .iter()
        .map(|descriptor| {
            (
                descriptor.language.to_string(),
                ApiAdapterCoverageBuild::default(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    adapter_coverage
        .entry("openapi".to_string())
        .or_insert_with(ApiAdapterCoverageBuild::default);
    adapter_coverage
        .entry("protobuf".to_string())
        .or_insert_with(ApiAdapterCoverageBuild::default);
    adapter_coverage
        .entry("graphql".to_string())
        .or_insert_with(ApiAdapterCoverageBuild::default);
    let mut adapter_descriptor_index = descriptors
        .iter()
        .map(|descriptor| (descriptor.language.to_string(), *descriptor))
        .collect::<BTreeMap<_, _>>();
    let mut candidates = Vec::<ApiRouteCandidate>::new();
    for (file, content) in file_contents {
        if let Some(reason) = api_scan_scope_skip_reason(file) {
            increment_skipped_reason(&mut skipped_by_reason, reason);
            continue;
        }

        if is_openapi_contract_file(file) {
            let coverage = adapter_coverage.entry("openapi".to_string()).or_default();
            coverage.file_count += 1;
            match extract_openapi_contract_candidates(file, content, generated_at) {
                Ok(file_candidates) => {
                    coverage.endpoint_count += file_candidates.len();
                    if file_candidates.is_empty() {
                        coverage.no_candidate_count += 1;
                        increment_skipped_reason(
                            &mut skipped_by_reason,
                            "adapter-no-candidate:openapi",
                        );
                    }
                    candidates.extend(file_candidates);
                }
                Err(_) => {
                    coverage.unsupported_count += 1;
                    increment_skipped_reason(&mut skipped_by_reason, "adapter-unsupported:openapi");
                }
            }
            continue;
        }

        if is_proto_contract_file(file) {
            let coverage = adapter_coverage.entry("protobuf".to_string()).or_default();
            coverage.file_count += 1;
            let file_candidates = extract_proto_contract_candidates(file, content, generated_at);
            coverage.endpoint_count += file_candidates.len();
            if file_candidates.is_empty() {
                coverage.no_candidate_count += 1;
                increment_skipped_reason(&mut skipped_by_reason, "adapter-no-candidate:protobuf");
            }
            candidates.extend(file_candidates);
            continue;
        }

        if is_graphql_contract_file(file) {
            let coverage = adapter_coverage.entry("graphql".to_string()).or_default();
            coverage.file_count += 1;
            let file_candidates = extract_graphql_contract_candidates(file, content, generated_at);
            coverage.endpoint_count += file_candidates.len();
            if file_candidates.is_empty() {
                coverage.no_candidate_count += 1;
                increment_skipped_reason(&mut skipped_by_reason, "adapter-no-candidate:graphql");
            }
            candidates.extend(file_candidates);
            continue;
        }

        let Some(descriptor) = api_adapter_descriptor_for_language(&file.language) else {
            if matches!(
                file.extension.as_str(),
                "proto" | "graphql" | "gql" | "yaml" | "yml" | "json"
            ) {
                increment_skipped_reason(
                    &mut skipped_by_reason,
                    "unsupported-strong-contract-adapter",
                );
            }
            continue;
        };
        adapter_descriptor_index
            .entry(descriptor.language.to_string())
            .or_insert(descriptor);
        let file_candidates = extract_project_api_candidates(file, content);
        let coverage = adapter_coverage
            .entry(descriptor.language.to_string())
            .or_default();
        coverage.file_count += 1;
        coverage.endpoint_count += file_candidates.len();
        if file_candidates.is_empty() {
            coverage.no_candidate_count += 1;
            increment_skipped_reason(
                &mut skipped_by_reason,
                format!("adapter-no-candidate:{}", descriptor.language),
            );
        }
        candidates.extend(file_candidates);
    }
    candidates.sort_by(|left, right| {
        left.source_file
            .cmp(&right.source_file)
            .then(left.line.cmp(&right.line))
            .then(left.path.cmp(&right.path))
    });

    let mut candidate_groups = BTreeMap::<String, Vec<ApiRouteCandidate>>::new();
    for candidate in candidates {
        candidate_groups
            .entry(api_endpoint_merge_identity(&candidate))
            .or_default()
            .push(candidate);
    }

    let mut endpoints = Vec::<ApiEndpoint>::new();
    let mut groups = BTreeMap::<String, ApiGroupBuild>::new();
    let mut schemas = BTreeMap::<String, ApiSchemaRef>::new();
    let mut call_chains = Vec::<ApiCallChain>::new();

    for (merge_identity, candidate_group) in candidate_groups {
        if candidate_group.is_empty() {
            continue;
        }
        let mut primary_index = 0usize;
        for index in 1..candidate_group.len() {
            if api_candidate_priority(&candidate_group[index])
                > api_candidate_priority(&candidate_group[primary_index])
            {
                primary_index = index;
            }
        }
        let candidate = &candidate_group[primary_index];
        let canonical_identity = canonical_api_endpoint_identity(candidate);
        let endpoint_id = api_endpoint_id_from_identity(&merge_identity);
        let group_layers = [
            ("protocol", candidate.protocol.to_ascii_uppercase()),
            ("module", candidate.module_label.clone()),
            ("controller", candidate.controller_label.clone()),
        ];
        let mut parent_id: Option<String> = None;
        let mut group_ids = Vec::new();
        for (level, label) in group_layers {
            let group_id = api_group_id(level, &label, parent_id.as_deref());
            {
                let group = groups
                    .entry(group_id.clone())
                    .or_insert_with(|| ApiGroupBuild {
                        id: group_id.clone(),
                        label: label.clone(),
                        level: level.to_string(),
                        parent_id: parent_id.clone(),
                        ..ApiGroupBuild::default()
                    });
                group.endpoint_ids.insert(endpoint_id.clone());
                increment_api_group_counts(group, &candidate);
            }
            if let Some(parent) = parent_id.as_ref().and_then(|id| groups.get_mut(id)) {
                parent.child_group_ids.insert(group_id.clone());
            }
            parent_id = Some(group_id.clone());
            group_ids.push(group_id);
        }
        let mut fallback_parameters =
            api_path_parameters(candidate.path.as_deref(), &candidate, generated_at);
        fallback_parameters.extend(api_signature_parameters(&candidate, generated_at));
        let mut parameters = if candidate.parameter_overrides.is_empty() {
            fallback_parameters
        } else {
            candidate.parameter_overrides.clone()
        };
        for parameter in &mut parameters {
            if parameter.structured_fields.is_empty() {
                if let Some(schema_name) =
                    parameter.schema.as_ref().map(|schema| schema.name.as_str())
                {
                    parameter.structured_fields =
                        structured_fields_for_schema(schema_name, &schema_field_index);
                }
            }
        }
        let mut request_body = candidate
            .request_body_override
            .clone()
            .or_else(|| api_request_body(&candidate, generated_at));
        if let Some(body) = request_body.as_mut() {
            if body.structured_fields.is_empty() {
                if let Some(schema_name) = body.schema.as_ref().map(|schema| schema.name.as_str()) {
                    body.structured_fields =
                        structured_fields_for_schema(schema_name, &schema_field_index);
                }
            }
        }
        let mut responses = if candidate.response_overrides.is_empty() {
            api_signature_response(&candidate, generated_at)
        } else {
            candidate.response_overrides.clone()
        };
        for response in &mut responses {
            if response.structured_fields.is_empty() {
                if let Some(schema_name) =
                    response.schema.as_ref().map(|schema| schema.name.as_str())
                {
                    response.structured_fields =
                        structured_fields_for_schema(schema_name, &schema_field_index);
                }
            }
        }
        for parameter in &parameters {
            if let Some(schema) = parameter.schema.clone() {
                schemas.entry(schema.id.clone()).or_insert(schema);
            }
        }
        if let Some(schema) = request_body.as_ref().and_then(|body| body.schema.clone()) {
            schemas.entry(schema.id.clone()).or_insert(schema);
        }
        for response in &responses {
            if let Some(schema) = response.schema.clone() {
                schemas.entry(schema.id.clone()).or_insert(schema);
            }
        }
        let request_schema = candidate
            .request_schema_override
            .clone()
            .or_else(|| request_body.as_ref().and_then(|body| body.schema.clone()));
        let response_schema = candidate.response_schema_override.clone().or_else(|| {
            responses
                .iter()
                .find_map(|response| response.schema.clone())
        });
        let evidence = candidate_group
            .iter()
            .map(|candidate| api_evidence(candidate, generated_at))
            .collect::<Vec<_>>();
        let description_sources = api_description_sources(candidate, &evidence);
        let call_chain = extract_api_call_chain(
            &endpoint_id,
            candidate,
            &file_content_index,
            &java_source_indexes,
            generated_at,
        );
        let call_chain_ids = call_chain
            .as_ref()
            .map(|chain| vec![chain.id.clone()])
            .unwrap_or_default();
        let call_chain_unavailable_reason = if call_chain_ids.is_empty() {
            Some("method-chain-evidence-unavailable".to_string())
        } else {
            None
        };
        if let Some(chain) = call_chain {
            call_chains.push(chain);
        }
        endpoints.push(ApiEndpoint {
            id: endpoint_id,
            protocol: candidate.protocol.clone(),
            language: candidate.language.clone(),
            framework: candidate.framework.clone(),
            method: candidate.method.clone(),
            path: candidate.path.clone(),
            operation_name: candidate.operation_name.clone(),
            handler_symbol: candidate.handler_symbol.clone(),
            source_file: candidate.source_file.clone(),
            parameters,
            request_body,
            responses,
            request_schema,
            response_schema,
            description: candidate.description.clone(),
            description_sources,
            usage_scenario: candidate.usage_scenario.clone(),
            group_ids,
            call_chain_ids,
            call_chain_unavailable_reason,
            confidence: candidate.confidence.clone(),
            evidence,
            canonical_identity,
            identity_kind: api_endpoint_identity_kind(candidate),
            ambiguous_identity: canonical_api_endpoint_identity(candidate).is_none(),
        });
    }

    let groups = groups
        .into_values()
        .map(|group| ApiGroup {
            id: group.id,
            label: group.label,
            level: group.level,
            parent_id: group.parent_id,
            endpoint_ids: group.endpoint_ids.into_iter().collect::<Vec<_>>(),
            child_group_ids: group.child_group_ids.into_iter().collect::<Vec<_>>(),
            protocol_counts: group.protocol_counts,
            language_counts: group.language_counts,
            confidence_counts: group.confidence_counts,
        })
        .collect::<Vec<_>>();

    let adapters = adapter_coverage
        .into_iter()
        .map(|(language, coverage)| {
            let descriptor = adapter_descriptor_index.get(&language);
            let is_openapi_adapter = language == "openapi";
            let is_protobuf_adapter = language == "protobuf";
            let is_graphql_adapter = language == "graphql";
            let status = if coverage.file_count == 0 {
                "not-present"
            } else if coverage.unsupported_count > 0 && coverage.endpoint_count == 0 {
                "unsupported"
            } else if coverage.endpoint_count == 0 {
                "no-candidate"
            } else {
                "active"
            };
            ApiAdapterCoverage {
                language,
                parser_source: descriptor
                    .map(|value| value.parser_source.to_string())
                    .or_else(|| {
                        if is_openapi_adapter {
                            Some("schema-parser".to_string())
                        } else if is_protobuf_adapter {
                            Some("descriptor".to_string())
                        } else if is_graphql_adapter {
                            Some("schema-parser".to_string())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| "fallback-pattern".to_string()),
                frameworks: descriptor
                    .map(|value| {
                        value
                            .frameworks
                            .iter()
                            .map(|framework| (*framework).to_string())
                            .collect()
                    })
                    .or_else(|| {
                        if is_openapi_adapter {
                            Some(vec!["OpenAPI".to_string(), "Swagger".to_string()])
                        } else if is_protobuf_adapter {
                            Some(vec!["protobuf".to_string(), "gRPC".to_string()])
                        } else if is_graphql_adapter {
                            Some(vec!["GraphQL schema".to_string()])
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(Vec::new),
                status: status.to_string(),
                file_count: coverage.file_count,
                endpoint_count: coverage.endpoint_count,
                no_candidate_count: coverage.no_candidate_count,
                unsupported_count: coverage.unsupported_count,
            }
        })
        .collect::<Vec<_>>();

    let graph = ApiContractGraph {
        schema_version: 1,
        generated_at: generated_at.to_string(),
        storage_key: storage_key.to_string(),
        scan_run_id: scan_run_id.to_string(),
        workspace_fingerprint: workspace_fingerprint.clone(),
        endpoints,
        groups,
        schemas: schemas.into_values().collect(),
        call_chains,
        adapters,
        stale: json!({
            "isFresh": true,
            "workspaceFingerprint": workspace_fingerprint,
            "reasons": [],
            "repairSuggestion": Value::Null
        }),
        repair: json!({
            "issues": [],
            "quarantinedArtifacts": [],
            "source": "project-map-api-contract-scan"
        }),
        skipped: skipped_by_reason
            .into_iter()
            .map(|(reason, count)| ApiSkippedSummary { reason, count })
            .collect(),
    };

    serde_json::to_value(graph).unwrap_or_else(|error| {
        json!({
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "storageKey": storage_key,
            "scanRunId": scan_run_id,
            "workspaceFingerprint": "",
            "endpoints": [],
            "groups": [],
            "schemas": [],
            "callChains": [],
            "adapters": [],
            "stale": {
                "isFresh": false,
                "workspaceFingerprint": "",
                "reasons": [{ "message": "failed to serialize API contract graph" }]
            },
            "repair": {
                "issues": [{ "message": format!("failed to serialize API contract graph: {error}") }]
            },
            "skipped": [],
            "error": format!("failed to serialize API contract graph: {error}")
        })
    })
}

#[cfg(test)]
#[path = "project_map_api_contracts_tests.rs"]
mod project_map_api_contracts_tests;
