use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

/// env 修改是进程级共享状态，所有改 env 的测试必须串行。
static ENV_LOCK: Mutex<()> = Mutex::new(());
static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// 持有 ENV_LOCK 期间设置 env，Drop 时先恢复原值再释放锁。
struct EnvGuard {
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
    _lock: MutexGuard<'static, ()>,
}

impl EnvGuard {
    fn new(vars: &[(&'static str, &Path)]) -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut saved = Vec::new();
        for (key, value) in vars {
            saved.push((*key, std::env::var_os(key)));
            std::env::set_var(key, value);
        }
        Self { saved, _lock: lock }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..) {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }
}

/// 临时目录，Drop 时清理。
struct TestDir(PathBuf);

impl TestDir {
    fn new(tag: &str) -> Self {
        let unique = format!(
            "ccgui-skills-hub-test-{}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
            tag
        );
        let path = std::env::temp_dir().join(unique);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn sanitize_path_segment_boundaries() {
    assert_eq!(sanitize_path_segment("pdf"), Some("pdf".to_string()));
    assert_eq!(sanitize_path_segment("  pdf  "), Some("pdf".to_string()));
    assert_eq!(
        sanitize_path_segment(".hidden"),
        Some(".hidden".to_string())
    );
    assert_eq!(sanitize_path_segment(""), None);
    assert_eq!(sanitize_path_segment("."), None);
    assert_eq!(sanitize_path_segment(".."), None);
    assert_eq!(sanitize_path_segment("a/b"), None);
    assert_eq!(sanitize_path_segment("a\\b"), None);
    assert_eq!(sanitize_path_segment("a\0b"), None);
}

#[test]
fn sanitize_relative_path_boundaries() {
    assert_eq!(sanitize_relative_path("a/b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("a\\b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("a//b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("  a/b  ").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("~").as_deref(), Some("~"));
    assert_eq!(sanitize_relative_path(""), None);
    assert_eq!(sanitize_relative_path("/a/b"), None);
    assert_eq!(sanitize_relative_path("a/../b"), None);
    assert_eq!(sanitize_relative_path("a/./b"), None);
    assert_eq!(sanitize_relative_path("a:b"), None);
    assert_eq!(sanitize_relative_path("C:/x"), None);
    assert_eq!(sanitize_relative_path("C:\\x"), None);
    assert_eq!(sanitize_relative_path("\\\\server\\share"), None);
    assert_eq!(sanitize_relative_path("\\tmp"), None);
    assert_eq!(sanitize_relative_path("a\0b"), None);
    // drive-relative（`X:foo`）不是 win32 absolute，但段内含 `:` 同样拒绝。
    assert_eq!(sanitize_relative_path("C:foo"), None);
}

#[test]
fn sanitize_local_skill_path_rejects_dot_segments() {
    assert_eq!(sanitize_local_skill_path("a/b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_local_skill_path(".hidden/x"), None);
    assert_eq!(sanitize_local_skill_path("a/.hidden"), None);
    assert_eq!(sanitize_local_skill_path("a/bad:seg"), None);
}

#[test]
fn install_name_from_directory_semantics() {
    assert_eq!(install_name_from_directory("a/b").as_deref(), Some("b"));
    assert_eq!(
        install_name_from_directory("single").as_deref(),
        Some("single")
    );
    assert_eq!(install_name_from_directory(".."), None);
    assert_eq!(install_name_from_directory("/abs"), None);
}

#[test]
fn read_yaml_field_variants() {
    assert_eq!(read_yaml_field("name: pdf-tools\n", "name"), "pdf-tools");
    assert_eq!(
        read_yaml_field("name: \"quoted name\"\n", "name"),
        "quoted name"
    );
    assert_eq!(read_yaml_field("name: 'single'\n", "name"), "single");
    assert_eq!(read_yaml_field("other: 1\n", "name"), "");
    // key 后必须紧跟冒号。
    assert_eq!(read_yaml_field("names: nope\n", "name"), "");
    // 带缩进的 key 同样匹配。
    assert_eq!(read_yaml_field("  name: nested\n", "name"), "nested");
    // block scalar `|`：收集缩进更深的行，dedent 结束。
    let block = "description: |\n  line one\n  line two\nname: x\n";
    assert_eq!(read_yaml_field(block, "description"), "line one line two");
    // block scalar `>-`：空行折叠为空串后 join。
    let folded = "description: >-\n  first\n\n  second\ntail: 1\n";
    assert_eq!(read_yaml_field(folded, "description"), "first  second");
}

#[test]
fn read_skill_metadata_frontmatter_and_fallback() {
    let md = "---\nname: pdf\ndescription: Extracts text from PDFs\n---\nbody\n";
    let meta = read_skill_metadata(md, "fallback");
    assert_eq!(meta.name, "pdf");
    assert_eq!(meta.description, "Extracts text from PDFs");
    // 无 frontmatter → 整个文本当 source，name 用 fallback。
    let no_fm = read_skill_metadata("just body", "fallback-name");
    assert_eq!(no_fm.name, "fallback-name");
    assert_eq!(no_fm.description, "");
    // fallback 也为空 → "Skill"。
    let empty = read_skill_metadata("", "");
    assert_eq!(empty.name, "Skill");
    // description 同行内多空白折叠（inline value 不跨行）。
    let spaced = read_skill_metadata("description: a   b\n\tc\n", "x");
    assert_eq!(spaced.description, "a b");
}

#[test]
fn skill_md_path_detection() {
    assert!(is_skill_md_path("SKILL.md"));
    assert!(is_skill_md_path("dir/SKILL.md"));
    assert!(is_skill_md_path("dir/sub/skill.md"));
    assert!(is_skill_md_path("dir/SkIlL.Md"));
    assert!(!is_skill_md_path("dir/SKILL.md.bak"));
    assert!(!is_skill_md_path("xskill.md"));
    assert_eq!(strip_skill_md_suffix("SKILL.md"), "");
    assert_eq!(strip_skill_md_suffix("dir/SKILL.md"), "dir");
    assert_eq!(strip_skill_md_suffix("dir/sub/skill.md"), "dir/sub");
    assert_eq!(strip_skill_md_suffix("dir/other.md"), "dir/other.md");
}

#[test]
fn hash_directory_stable_and_sensitive() {
    let temp = TestDir::new("hash");
    let skill = temp.path().join("skill");
    fs::create_dir_all(skill.join("sub")).unwrap();
    fs::write(skill.join("SKILL.md"), b"hello").unwrap();
    fs::write(skill.join("sub").join("a.txt"), b"aaa").unwrap();
    fs::write(skill.join(".DS_Store"), b"junk").unwrap(); // HASH_IGNORE 成员
    let first = hash_directory(&skill);
    // 两次调用一致（排序 + NUL 分隔语义稳定）。
    assert_eq!(first, hash_directory(&skill));
    // ignore 集内容变化不影响 hash。
    fs::write(skill.join(".DS_Store"), b"other junk").unwrap();
    assert_eq!(first, hash_directory(&skill));
    // 文件内容变化 → hash 变化。
    fs::write(skill.join("sub").join("a.txt"), b"aab").unwrap();
    assert_ne!(first, hash_directory(&skill));
    // exec bit 变化 → hash 变化（unix）。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let before = hash_directory(&skill);
        fs::set_permissions(
            skill.join("sub").join("a.txt"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert_ne!(before, hash_directory(&skill));
    }
}

#[test]
fn source_signature_from_tree_semantics() {
    let tree = json!([
        {"type": "blob", "path": "skill/a.txt", "sha": "aaa"},
        {"type": "blob", "path": "skill/sub/b.txt", "sha": "bbb"},
        {"type": "blob", "path": "other/c.txt", "sha": "ccc"},
        {"type": "tree", "path": "skill/sub", "sha": "ddd"},
        {"type": "blob", "path": "skill/nosha"},
    ]);
    let tree = tree.as_array().unwrap();
    let signature = source_signature_from_tree(tree, "skill").unwrap();
    // 手工计算：排序后 "path:sha" 以 "\n" join 的 sha256。
    let mut hasher = Sha256::new();
    hasher.update("skill/a.txt:aaa\nskill/sub/b.txt:bbb");
    assert_eq!(signature, format!("{:x}", hasher.finalize()));
    assert!(source_signature_from_tree(tree, "missing").is_none());
    assert!(source_signature_from_tree(&[], "skill").is_none());
    assert!(source_signature_from_tree(tree, "").is_none());
}

#[test]
fn target_skill_path_guards() {
    let temp = TestDir::new("tsp");
    let root = temp.path().join("skills");
    // root 不存在：ENOENT 放行。
    assert_eq!(
        target_skill_path(&root, "a/b"),
        Some(resolve_lexical(&root.join("a").join("b")))
    );
    fs::create_dir_all(&root).unwrap();
    // `..` / 绝对路径被拒。
    assert_eq!(target_skill_path(&root, "../x"), None);
    assert_eq!(target_skill_path(&root, "/etc/x"), None);
    // 中间祖先为 symlink → None。
    let outside = temp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    symlink_dir(&outside, &root.join("link")).unwrap();
    assert_eq!(target_skill_path(&root, "link/x"), None);
    // 中间祖先为普通目录 → Some。
    fs::create_dir_all(root.join("group")).unwrap();
    assert!(target_skill_path(&root, "group/x").is_some());
    // root 是文件 → None。
    let file_root = temp.path().join("file-root");
    fs::write(&file_root, b"x").unwrap();
    assert_eq!(target_skill_path(&file_root, "a"), None);
}

#[test]
fn assert_not_nested_semantics() {
    let base = Path::new("/tmp/ccgui-nest-check");
    assert!(assert_not_nested(base, base).is_ok()); // 同路径 = 幂等覆盖，放行
    assert!(assert_not_nested(base, &base.join("child")).is_err());
    assert!(assert_not_nested(&base.join("child"), base).is_err());
    assert!(assert_not_nested(&base.join("a"), &base.join("b")).is_ok());
}

#[test]
fn classify_in_dirs_three_states() {
    let temp = TestDir::new("classify");
    let base = temp.path().join("skills");
    fs::create_dir_all(&base).unwrap();
    // 缺失 → off。
    assert_eq!(classify_in_dirs("demo", std::slice::from_ref(&base)), "off");
    // 实体目录 → synced。
    fs::create_dir_all(base.join("demo")).unwrap();
    assert_eq!(
        classify_in_dirs("demo", std::slice::from_ref(&base)),
        "synced"
    );
    // 悬空 symlink → orphan。
    fs::remove_dir_all(base.join("demo")).unwrap();
    symlink_dir(
        Path::new("/nonexistent-ccgui-test-target"),
        &base.join("demo"),
    )
    .unwrap();
    assert_eq!(
        classify_in_dirs("demo", std::slice::from_ref(&base)),
        "orphan"
    );
}

#[test]
fn classify_target_skill_with_home_env() {
    let temp = TestDir::new("home");
    let _env = EnvGuard::new(&[("HOME", temp.path())]);
    let claude_skills = temp.path().join(".claude").join("skills");
    fs::create_dir_all(&claude_skills).unwrap();
    assert_eq!(classify_target_skill("demo", "claude"), "off");
    fs::create_dir_all(claude_skills.join("demo")).unwrap();
    assert_eq!(classify_target_skill("demo", "claude"), "synced");
    fs::remove_dir_all(claude_skills.join("demo")).unwrap();
    symlink_dir(
        Path::new("/nonexistent-ccgui-test-target"),
        &claude_skills.join("demo"),
    )
    .unwrap();
    assert_eq!(classify_target_skill("demo", "claude"), "orphan");
    assert_eq!(classify_target_skill("demo", "bogus-target"), "off");
}

#[test]
fn registry_roundtrip_and_defaults() {
    let temp = TestDir::new("registry");
    let _env = EnvGuard::new(&[("CCGUI_SKILLS_HOME", temp.path())]);
    let registry = Registry {
        repos: default_repos(),
        skills: vec![json!({"id": "o/n:dir", "directory": "dir", "targets": ["claude"]})],
    };
    save_registry(&registry).unwrap();
    // unix 下 registry.json 权限 0o600。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(registry_path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    let loaded = read_registry();
    assert_eq!(loaded.repos.len(), 4);
    assert_eq!(loaded.skills.len(), 1);
    assert_eq!(
        loaded.skills[0].get("id").and_then(Value::as_str),
        Some("o/n:dir")
    );
    // 坏文件 → 默认值。
    fs::write(registry_path(), b"not json").unwrap();
    let loaded = read_registry();
    assert!(loaded.skills.is_empty());
    assert_eq!(loaded.repos.len(), 4);
    // repos 非数组 → DEFAULT_REPOS；skills 非数组 → []。
    fs::write(registry_path(), br#"{"repos":123,"skills":{}}"#).unwrap();
    let loaded = read_registry();
    assert_eq!(loaded.repos.len(), 4);
    assert_eq!(
        loaded.repos[0].get("owner").and_then(Value::as_str),
        Some("anthropics")
    );
    assert!(loaded.skills.is_empty());
    // 文件缺失 → 默认。
    let _ = fs::remove_file(registry_path());
    let loaded = read_registry();
    assert_eq!(loaded.repos.len(), 4);
    assert!(loaded.skills.is_empty());
}

#[test]
fn purge_expired_trash_ttl() {
    let temp = TestDir::new("trash");
    let _env = EnvGuard::new(&[("CCGUI_SKILLS_HOME", temp.path())]);
    // 过期条目（trashedAt 在过去）应被清理；新鲜条目保留。
    let old_stamp = now_ms() - (TRASH_TTL_MS + 60_000);
    let new_stamp = now_ms();
    let old_trash = trash_dir().join("b2xk-1");
    fs::create_dir_all(&old_trash).unwrap();
    let registry = Registry {
        repos: default_repos(),
        skills: vec![
            json!({"id": "o/n:old", "directory": "old", "trashedAt": old_stamp, "trashedDirectory": "b2xk-1"}),
            json!({"id": "o/n:new", "directory": "new", "trashedAt": new_stamp, "trashedDirectory": "bmv3-2"}),
            json!({"id": "o/n:live", "directory": "live"}),
        ],
    };
    save_registry(&registry).unwrap();
    purge_expired_trash();
    let after = read_registry();
    assert_eq!(after.skills.len(), 2);
    assert!(after
        .skills
        .iter()
        .all(|s| s.get("directory").and_then(Value::as_str) != Some("old")));
    assert!(!old_trash.exists());
}

fn write_transcript(home: &Path, project: &str, file: &str, lines: &[String]) {
    let dir = claude_projects_dir(home).join(project);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(file), format!("{}\n", lines.join("\n"))).unwrap();
}

fn skill_block_line(ts: &str, blocks: &[(&str, &str)], usage: &str) -> String {
    let content: Vec<String> = blocks
        .iter()
        .map(|(id, skill)| {
            format!(r#"{{"type":"tool_use","name":"Skill","id":"{id}","input":{{"skill":"{skill}"}}}}"#)
        })
        .collect();
    format!(
        r#"{{"timestamp":"{ts}","message":{{"model":"m","usage":{usage},"content":[{}]}}}}"#,
        content.join(",")
    )
}

#[test]
fn usage_scan_dedup_share_and_last_used() {
    let home = TestDir::new("usage-home");
    let skills_home = TestDir::new("usage-skills");
    let _env = EnvGuard::new(&[("CCGUI_SKILLS_HOME", skills_home.path())]);
    let line_b1 = skill_block_line(
        "2026-01-02T00:00:00.000Z",
        &[("b1", "pdf")],
        r#"{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}"#,
    );
    write_transcript(home.path(), "p1", "a.jsonl", std::slice::from_ref(&line_b1));
    write_transcript(
        home.path(),
        "p1",
        "b.jsonl",
        &[
            line_b1, // 跨文件重复 id → 去重
            // 单 turn 两个 Skill block → usage 均摊。
            skill_block_line(
                "2026-01-01T00:00:00.000Z",
                &[("b2", "pdf"), ("b3", "xlsx")],
                r#"{"input_tokens":90,"output_tokens":30}"#,
            ),
            // 预筛：不含 `"name":"Skill"` 子串的行直接跳过。
            r#"{"message":{"content":[{"type":"tool_use","name":"Other"}]}}"#.to_string(),
            // 含子串但 JSON 非法 → 跳过。
            r#"{"name":"Skill" broken"#.to_string(),
        ],
    );

    let result = scan_skill_usage(home.path(), false);
    assert_eq!(result.get("scannedFiles").and_then(Value::as_i64), Some(2));
    assert_eq!(
        result.get("totalInvocations").and_then(Value::as_i64),
        Some(3)
    );
    assert_eq!(result.get("cached").and_then(Value::as_bool), Some(false));
    let skills = result.get("skills").and_then(Value::as_array).unwrap();
    // 按 invocations 降序：pdf(2) 在前，xlsx(1) 在后。
    assert_eq!(skills.len(), 2);
    let pdf = &skills[0];
    assert_eq!(pdf.get("skill").and_then(Value::as_str), Some("pdf"));
    assert_eq!(pdf.get("invocations").and_then(Value::as_i64), Some(2));
    assert_eq!(
        pdf.get("lastUsedAt").and_then(Value::as_str),
        Some("2026-01-02T00:00:00.000Z")
    );
    let pdf_tokens = pdf.get("tokens").unwrap();
    // b1 独占 turn：100/50/20/10；b2 摊半：45/15 → 145/65/20/10。
    assert_eq!(
        pdf_tokens.get("input_tokens").and_then(Value::as_i64),
        Some(145)
    );
    assert_eq!(
        pdf_tokens.get("output_tokens").and_then(Value::as_i64),
        Some(65)
    );
    assert_eq!(
        pdf_tokens
            .get("cached_input_tokens")
            .and_then(Value::as_i64),
        Some(20)
    );
    assert_eq!(
        pdf_tokens
            .get("cache_creation_input_tokens")
            .and_then(Value::as_i64),
        Some(10)
    );
    assert_eq!(
        pdf_tokens.get("total_tokens").and_then(Value::as_i64),
        Some(240)
    );
    let xlsx = &skills[1];
    assert_eq!(xlsx.get("skill").and_then(Value::as_str), Some("xlsx"));
    assert_eq!(xlsx.get("invocations").and_then(Value::as_i64), Some(1));
    let xlsx_tokens = xlsx.get("tokens").unwrap();
    assert_eq!(
        xlsx_tokens.get("input_tokens").and_then(Value::as_i64),
        Some(45)
    );
    assert_eq!(
        xlsx_tokens.get("total_tokens").and_then(Value::as_i64),
        Some(60)
    );

    // fingerprint 不变 → 第二次命中缓存。
    let cached = scan_skill_usage(home.path(), false);
    assert_eq!(cached.get("cached").and_then(Value::as_bool), Some(true));
    assert_eq!(
        cached.get("totalInvocations").and_then(Value::as_i64),
        Some(3)
    );
    // 文件变化 → fingerprint 失效 → 重新扫描。
    write_transcript(
        home.path(),
        "p1",
        "c.jsonl",
        &[skill_block_line(
            "2026-01-03T00:00:00.000Z",
            &[("b9", "pptx")],
            r#"{"input_tokens":7}"#,
        )],
    );
    let refreshed = scan_skill_usage(home.path(), false);
    assert_eq!(
        refreshed.get("cached").and_then(Value::as_bool),
        Some(false)
    );
    assert_eq!(
        refreshed.get("totalInvocations").and_then(Value::as_i64),
        Some(4)
    );
    assert_eq!(
        refreshed.get("scannedFiles").and_then(Value::as_i64),
        Some(3)
    );
}
