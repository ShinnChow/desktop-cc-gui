use super::*;

pub(super) fn java_declared_type(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") {
            continue;
        }
        let tokens = trimmed
            .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
            .filter(|token| !token.is_empty())
            .collect::<Vec<_>>();
        for (index, token) in tokens.iter().enumerate() {
            if matches!(*token, "class" | "interface" | "enum" | "record") {
                return tokens.get(index + 1).map(|value| (*value).to_string());
            }
        }
    }
    None
}

pub(super) fn java_annotation_description(line: &str) -> Option<String> {
    if line.contains("@Schema") || line.contains("@ApiModelProperty") {
        quoted_value_after_key(line, "description")
            .or_else(|| quoted_value_after_key(line, "value"))
            .or_else(|| quoted_value_after_key(line, "notes"))
            .or_else(|| first_quoted_value(line))
    } else {
        None
    }
}

pub(super) fn java_annotation_example(line: &str) -> Option<String> {
    if line.contains("@Schema") || line.contains("@ApiModelProperty") {
        quoted_value_after_key(line, "example")
    } else {
        None
    }
}

pub(super) fn java_validation_required(line: &str) -> bool {
    line.contains("@NotNull")
        || line.contains("@NotBlank")
        || line.contains("@NotEmpty")
        || line.contains("@NonNull")
}

pub(super) fn java_validation_range(line: &str) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(value) = quoted_value_after_key(line, "regexp") {
        parts.push(format!("pattern={value}"));
    }
    for key in ["min", "max", "size"] {
        if let Some(index) = line.find(key) {
            let tail = &line[index + key.len()..];
            if let Some(value) = tail
                .trim_start()
                .strip_prefix('=')
                .and_then(|value| value.trim_start().split([',', ')']).next())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                parts.push(format!("{key}={value}"));
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(", "))
    }
}

pub(super) fn java_field_from_line(
    file: &ScannedFile,
    line_number: usize,
    line: &str,
    pending_description: Option<String>,
    pending_required: bool,
    pending_example: Option<String>,
    pending_range: Option<String>,
    generated_at: &str,
) -> Option<ApiStructuredSchemaField> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('@')
        || trimmed.starts_with('/')
        || trimmed.starts_with('*')
        || trimmed.starts_with("package ")
        || trimmed.starts_with("import ")
        || trimmed.contains('(')
        || trimmed.contains(" class ")
        || trimmed.starts_with("class ")
        || !trimmed.contains(';')
    {
        return None;
    }
    let before_assignment = trimmed.split('=').next().unwrap_or(trimmed);
    let cleaned = strip_java_annotations(before_assignment)
        .replace(';', " ")
        .replace(',', " ");
    let tokens = cleaned
        .split_whitespace()
        .filter(|token| {
            !matches!(
                *token,
                "public"
                    | "private"
                    | "protected"
                    | "static"
                    | "final"
                    | "transient"
                    | "volatile"
                    | "serialVersionUID"
            )
        })
        .collect::<Vec<_>>();
    if tokens.len() < 2 {
        return None;
    }
    let name = tokens
        .last()?
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '_');
    if name.is_empty() {
        return None;
    }
    let field_type = tokens
        .iter()
        .rev()
        .skip(1)
        .next()
        .map(|value| (*value).to_string());
    let description = java_annotation_description(line).or(pending_description);
    let example = java_annotation_example(line).or(pending_example);
    let range = java_validation_range(line).or(pending_range);
    Some(ApiStructuredSchemaField {
        name: name.to_string(),
        field_type,
        required: Some(pending_required || java_validation_required(line)),
        default_value: None,
        description,
        enum_values: Vec::new(),
        range,
        example,
        children: Vec::new(),
        evidence: vec![api_evidence_payload(
            &file.path,
            line_number,
            trimmed,
            "fallback-pattern",
            generated_at,
        )],
    })
}

pub(super) fn build_java_schema_field_index(
    file_contents: &[(ScannedFile, String)],
    generated_at: &str,
) -> BTreeMap<String, Vec<ApiStructuredSchemaField>> {
    let mut index = BTreeMap::new();
    for (file, content) in file_contents {
        if !matches!(file.language.as_str(), "java" | "kotlin") {
            continue;
        }
        let mut current_type: Option<String> = None;
        let mut current_fields = Vec::new();
        let mut pending_description: Option<String> = None;
        let mut pending_example: Option<String> = None;
        let mut pending_range: Option<String> = None;
        let mut pending_required = false;
        for (line_index, line) in content.lines().enumerate() {
            let line_number = line_index + 1;
            let trimmed = line.trim();
            let tokens = trimmed
                .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
                .filter(|token| !token.is_empty())
                .collect::<Vec<_>>();
            if let Some(type_name) = tokens.iter().enumerate().find_map(|(index, token)| {
                if matches!(*token, "class" | "interface" | "enum" | "record") {
                    tokens.get(index + 1).map(|value| (*value).to_string())
                } else {
                    None
                }
            }) {
                if let Some(previous_type) = current_type.take() {
                    if !current_fields.is_empty() {
                        index.insert(previous_type, std::mem::take(&mut current_fields));
                    }
                }
                current_type = Some(type_name);
                pending_description = None;
                pending_example = None;
                pending_range = None;
                pending_required = false;
                continue;
            }
            if trimmed.starts_with('@')
                || trimmed.starts_with("/**")
                || trimmed.starts_with('*')
                || trimmed.starts_with("//")
            {
                pending_description = java_annotation_description(line)
                    .or_else(|| java_comment_text(line))
                    .or(pending_description);
                pending_example = java_annotation_example(line).or(pending_example);
                pending_range = java_validation_range(line).or(pending_range);
                pending_required = pending_required || java_validation_required(line);
                continue;
            }
            if let Some(field) = java_field_from_line(
                file,
                line_number,
                line,
                pending_description.take(),
                pending_required,
                pending_example.take(),
                pending_range.take(),
                generated_at,
            ) {
                if current_type.is_some() {
                    current_fields.push(field);
                }
                pending_required = false;
                continue;
            }
            pending_description = None;
            pending_example = None;
            pending_range = None;
            pending_required = false;
        }
        if let Some(type_name) = current_type {
            if !current_fields.is_empty() {
                index.insert(type_name, current_fields);
            }
        }
    }
    index
}

pub(super) fn api_schema_lookup_names(schema_name: &str) -> Vec<String> {
    let normalized = schema_name.trim().trim_end_matches("[]").trim().to_string();
    let mut names = vec![normalized.clone()];
    if let Some((_, inner)) = normalized.split_once('<') {
        let inner = inner.trim_end_matches('>').trim();
        names.extend(inner.split(',').map(|value| value.trim().to_string()));
    }
    names.retain(|value| !value.is_empty());
    names
}

pub(super) fn structured_fields_for_schema(
    schema_name: &str,
    schema_field_index: &BTreeMap<String, Vec<ApiStructuredSchemaField>>,
) -> Vec<ApiStructuredSchemaField> {
    api_schema_lookup_names(schema_name)
        .into_iter()
        .find_map(|name| schema_field_index.get(&name).cloned())
        .unwrap_or_default()
}
