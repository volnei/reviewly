use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct SpecRequirement {
    pub name: String,
    pub kind: String,
    pub capability: String,
    pub file: String,
    pub scenarios: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct SpecIssue {
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub file: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SpecTask {
    pub label: String,
    pub done: bool,
}

#[derive(Serialize, Clone)]
pub struct SpecPullRequest {
    pub url: String,
    pub label: String,
}

#[derive(Serialize, Clone)]
pub struct SourceSpec {
    pub capability: String,
    pub title: String,
    pub summary: String,
    pub file: String,
    pub requirements: Vec<SpecRequirement>,
    pub scenarios: usize,
}

#[derive(Serialize, Clone)]
pub struct SpecChange {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub stage: String,
    pub proposal_file: Option<String>,
    pub design_file: Option<String>,
    pub tasks_file: Option<String>,
    pub tasks_total: usize,
    pub tasks_done: usize,
    pub tasks: Vec<SpecTask>,
    pub requirements: Vec<SpecRequirement>,
    pub issues: Vec<SpecIssue>,
    pub ready_to_archive: bool,
    pub pull_requests: Vec<SpecPullRequest>,
}

#[derive(Serialize, Clone)]
pub struct OpenSpecScan {
    pub root: String,
    pub config_file: Option<String>,
    pub source_specs: usize,
    pub source_spec_files: Vec<String>,
    pub source_spec_details: Vec<SourceSpec>,
    pub archived_changes: usize,
    pub changes: Vec<SpecChange>,
}

/// Read an OpenSpec workspace directly from disk. Like the Turbo Lab scanner,
/// this deliberately does not depend on a globally installed CLI: Reviewly can
/// still explain the state of a change on a fresh machine or an offline clone.
#[tauri::command]
pub async fn openspec_scan(path: String) -> AppResult<Option<OpenSpecScan>> {
    let out = tauri::async_runtime::spawn_blocking(move || scan_sync(Path::new(&path)))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("OpenSpec scan task failed: {e}")))?;
    Ok(out)
}

/// Bootstrap the standard OpenSpec workspace without introducing any
/// Reviewly-only metadata. Existing files are never overwritten.
#[tauri::command]
pub async fn openspec_setup(path: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || setup_sync(Path::new(&path)))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("OpenSpec setup task failed: {e}")))?
}

fn setup_sync(root: &Path) -> AppResult<()> {
    if !root.is_dir() {
        return Err(crate::error::AppError::Other(
            "the selected repository is not available on this Mac".into(),
        ));
    }
    let openspec = root.join("openspec");
    std::fs::create_dir_all(openspec.join("specs"))
        .map_err(|e| crate::error::AppError::Other(format!("create openspec/specs: {e}")))?;
    std::fs::create_dir_all(openspec.join("changes").join("archive"))
        .map_err(|e| crate::error::AppError::Other(format!("create openspec/changes: {e}")))?;
    let config = openspec.join("config.yaml");
    if !config.exists() {
        std::fs::write(&config, "schema: spec-driven\n").map_err(|e| {
            crate::error::AppError::Other(format!("write openspec/config.yaml: {e}"))
        })?;
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct GeneratedSpecFile {
    capability: String,
    content: String,
}

/// Materialize a reviewed AI draft as one OpenSpec change. Every write is
/// constrained below `openspec/changes/<slug>`; an existing change is never
/// overwritten.
#[tauri::command]
pub async fn openspec_create_change(
    path: String,
    id: String,
    proposal: String,
    design: String,
    tasks: String,
    specs: Vec<GeneratedSpecFile>,
) -> AppResult<()> {
    create_change_sync(Path::new(&path), &id, &proposal, &design, &tasks, specs)
}

fn create_change_sync(
    root: &Path,
    id: &str,
    proposal: &str,
    design: &str,
    tasks: &str,
    specs: Vec<GeneratedSpecFile>,
) -> AppResult<()> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || id.starts_with('-')
        || id.ends_with('-')
    {
        return Err(crate::error::AppError::Other(
            "change id must be a lowercase kebab-case slug".into(),
        ));
    }
    if proposal.trim().is_empty() || tasks.trim().is_empty() || specs.is_empty() {
        return Err(crate::error::AppError::Other(
            "the generated change needs a proposal, tasks and at least one spec".into(),
        ));
    }
    let target = root.join("openspec").join("changes").join(id);
    if target.exists() {
        return Err(crate::error::AppError::Other(format!(
            "OpenSpec change {id} already exists"
        )));
    }
    std::fs::create_dir_all(&target)
        .map_err(|e| crate::error::AppError::Other(format!("create change: {e}")))?;
    let result = (|| -> std::io::Result<()> {
        std::fs::write(
            target.join("proposal.md"),
            proposal.trim_end().to_string() + "\n",
        )?;
        if !design.trim().is_empty() {
            std::fs::write(
                target.join("design.md"),
                design.trim_end().to_string() + "\n",
            )?;
        }
        std::fs::write(target.join("tasks.md"), tasks.trim_end().to_string() + "\n")?;
        for spec in specs {
            let capability = spec.capability.trim();
            if capability.is_empty()
                || capability.len() > 80
                || !capability
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                || capability.starts_with('-')
                || capability.ends_with('-')
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "capability must be a lowercase kebab-case slug",
                ));
            }
            let dir = target.join("specs").join(capability);
            std::fs::create_dir_all(&dir)?;
            std::fs::write(
                dir.join("spec.md"),
                spec.content.trim_end().to_string() + "\n",
            )?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&target);
        return Err(crate::error::AppError::Other(format!(
            "write generated change: {error}"
        )));
    }
    Ok(())
}

fn scan_sync(root: &Path) -> Option<OpenSpecScan> {
    let openspec = root.join("openspec");
    if !openspec.is_dir() {
        return None;
    }

    let config_file = ["config.yaml", "config.yml"]
        .iter()
        .find(|name| openspec.join(name).is_file())
        .map(|name| format!("openspec/{name}"));
    let source_files = spec_files(&openspec.join("specs"));
    let source_spec_files = source_files
        .iter()
        .map(|file| relative(root, file))
        .collect::<Vec<_>>();
    let source_spec_details = source_files
        .iter()
        .map(|file| scan_source_spec(root, file))
        .collect::<Vec<_>>();
    let source_specs = source_spec_files.len();
    let archived_changes = std::fs::read_dir(openspec.join("changes").join("archive"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .count()
        })
        .unwrap_or(0);
    let mut changes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(openspec.join("changes")) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() || entry.file_name().to_string_lossy() == "archive" {
                continue;
            }
            changes.push(scan_change(root, &dir));
        }
    }
    changes.sort_by(|a, b| {
        b.issues
            .len()
            .cmp(&a.issues.len())
            .then_with(|| a.id.cmp(&b.id))
    });

    Some(OpenSpecScan {
        root: openspec.to_string_lossy().into_owned(),
        config_file,
        source_specs,
        source_spec_files,
        source_spec_details,
        archived_changes,
        changes,
    })
}

fn scan_source_spec(root: &Path, file: &Path) -> SourceSpec {
    let raw = std::fs::read_to_string(file).unwrap_or_default();
    let capability = file
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "spec".into());
    let requirements = parse_requirements(root, file);
    let scenarios = requirements.iter().map(|item| item.scenarios.len()).sum();
    SourceSpec {
        capability: capability.clone(),
        title: first_heading(&raw).unwrap_or_else(|| humanize(&capability)),
        summary: first_paragraph(&raw).unwrap_or_else(|| {
            format!(
                "{} current requirement{}.",
                requirements.len(),
                if requirements.len() == 1 { "" } else { "s" }
            )
        }),
        file: relative(root, file),
        requirements,
        scenarios,
    }
}

fn scan_change(root: &Path, dir: &Path) -> SpecChange {
    let id = dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "change".into());
    let proposal = read_optional(&dir.join("proposal.md"));
    let design = read_optional(&dir.join("design.md"));
    let tasks = read_optional(&dir.join("tasks.md"));
    let pull_requests = [&proposal, &design, &tasks]
        .into_iter()
        .flatten()
        .flat_map(|raw| pull_request_urls(raw))
        .fold(Vec::<SpecPullRequest>::new(), |mut out, item| {
            if !out.iter().any(|known| known.url == item.url) {
                out.push(item);
            }
            out
        });
    let mut requirements = Vec::new();
    for file in spec_files(&dir.join("specs")) {
        requirements.extend(parse_requirements(root, &file));
    }
    let parsed_tasks = tasks.as_deref().map(parse_tasks).unwrap_or_default();
    let tasks_total = parsed_tasks.len();
    let tasks_done = parsed_tasks.iter().filter(|task| task.done).count();

    let title = proposal
        .as_deref()
        .and_then(first_heading)
        .unwrap_or_else(|| humanize(&id));
    let summary = proposal
        .as_deref()
        .and_then(first_paragraph)
        .unwrap_or_else(|| "No proposal summary yet.".into());
    let mut issues = Vec::new();
    if proposal.is_none() {
        issues.push(issue(
            "blocking",
            "Write the proposal",
            "The change has no proposal.md, so reviewers cannot see the intent or scope.",
            None,
        ));
    }
    if requirements.is_empty() {
        issues.push(issue(
            "blocking",
            "Define the behavior delta",
            "Add at least one ADDED, MODIFIED, REMOVED or RENAMED requirement under specs/.",
            None,
        ));
    }
    for requirement in requirements.iter().filter(|item| item.scenarios.is_empty()) {
        issues.push(issue(
            "warning",
            &format!("Add a scenario for {}", requirement.name),
            "A requirement without a WHEN/THEN scenario is hard to implement and verify consistently.",
            Some(requirement.file.clone()),
        ));
    }
    if design.is_none() {
        issues.push(issue(
            "note",
            "Capture the implementation design",
            "design.md is missing. Add it when this change introduces architectural choices or trade-offs.",
            None,
        ));
    }
    if tasks.is_none() || tasks_total == 0 {
        issues.push(issue(
            "blocking",
            "Break the change into tasks",
            "tasks.md is missing or has no checkable tasks.",
            None,
        ));
    } else if tasks_done < tasks_total {
        let left = tasks_total - tasks_done;
        issues.push(issue(
            "warning",
            &format!("Complete {left} remaining task{}", if left == 1 { "" } else { "s" }),
            "The change should stay active until every implementation and verification task is checked.",
            Some(relative(root, &dir.join("tasks.md"))),
        ));
    }

    let stage = if proposal.is_none() {
        "proposal"
    } else if requirements.is_empty() {
        "specs"
    } else if tasks_total == 0 {
        "tasks"
    } else if tasks_done < tasks_total {
        "apply"
    } else {
        "verify"
    };
    let ready_to_archive = proposal.is_some()
        && !requirements.is_empty()
        && tasks_total > 0
        && tasks_done == tasks_total
        && !issues.iter().any(|item| item.severity == "blocking");

    SpecChange {
        id,
        title,
        summary,
        stage: stage.into(),
        proposal_file: proposal
            .as_ref()
            .map(|_| relative(root, &dir.join("proposal.md"))),
        design_file: design
            .as_ref()
            .map(|_| relative(root, &dir.join("design.md"))),
        tasks_file: tasks
            .as_ref()
            .map(|_| relative(root, &dir.join("tasks.md"))),
        tasks_total,
        tasks_done,
        tasks: parsed_tasks,
        requirements,
        issues,
        ready_to_archive,
        pull_requests,
    }
}

fn pull_request_urls(raw: &str) -> Vec<SpecPullRequest> {
    raw.split_whitespace()
        .filter_map(|token| {
            let url = token
                .trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '<' | '>' | ',' | '.'));
            let is_pull = url.starts_with("https://")
                && (url.contains("/pull/") || url.contains("/-/merge_requests/"));
            if !is_pull {
                return None;
            }
            let number = url.rsplit('/').next().filter(|value| !value.is_empty());
            Some(SpecPullRequest {
                url: url.to_string(),
                label: number
                    .map(|value| format!("PR #{value}"))
                    .unwrap_or_else(|| "Pull request".into()),
            })
        })
        .collect()
}

fn issue(severity: &str, title: &str, detail: &str, file: Option<String>) -> SpecIssue {
    SpecIssue {
        severity: severity.into(),
        title: title.into(),
        detail: detail.into(),
        file,
    }
}

fn read_optional(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn spec_files(dir: &Path) -> Vec<PathBuf> {
    fn visit(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path, out);
            } else if path.file_name().is_some_and(|name| name == "spec.md") {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    visit(dir, &mut out);
    out.sort();
    out
}

fn parse_requirements(root: &Path, file: &Path) -> Vec<SpecRequirement> {
    let Ok(raw) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    let capability = file
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "spec".into());
    let path = relative(root, file);
    let mut kind = "specified".to_string();
    let mut out: Vec<SpecRequirement> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(section) = trimmed.strip_prefix("## ") {
            let upper = section.to_ascii_uppercase();
            kind = if upper.starts_with("ADDED") {
                "added"
            } else if upper.starts_with("MODIFIED") {
                "modified"
            } else if upper.starts_with("REMOVED") {
                "removed"
            } else if upper.starts_with("RENAMED") {
                "renamed"
            } else {
                "specified"
            }
            .into();
        } else if let Some(name) = trimmed.strip_prefix("### Requirement:") {
            out.push(SpecRequirement {
                name: name.trim().to_string(),
                kind: kind.clone(),
                capability: capability.clone(),
                file: path.clone(),
                scenarios: Vec::new(),
            });
        } else if let Some(name) = trimmed.strip_prefix("#### Scenario:") {
            if let Some(requirement) = out.last_mut() {
                requirement.scenarios.push(name.trim().to_string());
            }
        }
    }
    out
}

fn parse_tasks(raw: &str) -> Vec<SpecTask> {
    let mut tasks = Vec::new();
    for line in raw.lines().map(str::trim) {
        let task = line
            .strip_prefix("- [")
            .or_else(|| line.strip_prefix("* ["));
        if let Some(rest) = task {
            if let Some(mark) = rest.chars().next() {
                if matches!(mark, ' ' | 'x' | 'X') && rest.get(1..2) == Some("]") {
                    tasks.push(SpecTask {
                        label: rest.get(2..).unwrap_or("").trim().to_string(),
                        done: matches!(mark, 'x' | 'X'),
                    });
                }
            }
        }
    }
    tasks
}

fn first_heading(raw: &str) -> Option<String> {
    raw.lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map(str::to_string)
}

fn first_paragraph(raw: &str) -> Option<String> {
    let mut lines = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            if !lines.is_empty() {
                break;
            }
            continue;
        }
        if line.starts_with('#') || line.starts_with("<!--") {
            continue;
        }
        lines.push(line);
    }
    (!lines.is_empty()).then(|| lines.join(" "))
}

fn humanize(id: &str) -> String {
    let value = id.replace(['-', '_'], " ");
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
        .unwrap_or_else(|| "Untitled change".into())
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn scans_change_readiness_and_scenarios() {
        let dir = std::env::temp_dir().join(format!("reviewly-openspec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write(&dir.join("openspec/config.yaml"), "schema: spec-driven\n");
        write(&dir.join("openspec/specs/auth/spec.md"), "# Auth\n");
        write(
            &dir.join("openspec/changes/passkeys/proposal.md"),
            "# Add passkey login\n\nLet people sign in without a password.\n",
        );
        write(
            &dir.join("openspec/changes/passkeys/design.md"),
            "# Design\n",
        );
        write(
            &dir.join("openspec/changes/passkeys/tasks.md"),
            "- [x] Add challenge endpoint\n- [ ] Cover replay protection\n",
        );
        write(
            &dir.join("openspec/changes/passkeys/specs/auth/spec.md"),
            "## ADDED Requirements\n\n### Requirement: Passkey authentication\n\n#### Scenario: Known credential\n- **WHEN** a valid credential is sent\n- **THEN** a session is created\n\n### Requirement: Replay protection\n",
        );

        let scan = scan_sync(&dir).expect("OpenSpec detected");
        assert_eq!(scan.source_specs, 1);
        assert_eq!(scan.source_spec_files, ["openspec/specs/auth/spec.md"]);
        assert_eq!(scan.source_spec_details[0].title, "Auth");
        assert_eq!(scan.changes.len(), 1);
        let change = &scan.changes[0];
        assert_eq!(change.title, "Add passkey login");
        assert_eq!((change.tasks_done, change.tasks_total), (1, 2));
        assert_eq!(change.requirements.len(), 2);
        assert_eq!(change.requirements[0].scenarios, ["Known credential"]);
        assert!(change
            .issues
            .iter()
            .any(|issue| issue.title.contains("Replay protection")));
        assert!(!change.ready_to_archive);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sets_up_standard_openspec_without_overwriting_configuration() {
        let dir =
            std::env::temp_dir().join(format!("reviewly-setup-openspec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        setup_sync(&dir).unwrap();
        assert!(dir.join("openspec/specs").is_dir());
        assert!(dir.join("openspec/changes/archive").is_dir());
        assert_eq!(
            std::fs::read_to_string(dir.join("openspec/config.yaml")).unwrap(),
            "schema: spec-driven\n"
        );
        std::fs::write(dir.join("openspec/config.yaml"), "schema: custom\n").unwrap();
        setup_sync(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("openspec/config.yaml")).unwrap(),
            "schema: custom\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discovers_attached_pull_requests_and_archives() {
        let dir = std::env::temp_dir().join(format!("reviewly-pr-openspec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write(&dir.join("openspec/specs/auth/spec.md"), "# Auth\n\n## Requirements\n\n### Requirement: Sign in\n\n#### Scenario: Valid credentials\n");
        write(
            &dir.join("openspec/changes/archive/old/proposal.md"),
            "# Old\n",
        );
        write(
            &dir.join("openspec/changes/passkeys/proposal.md"),
            "# Passkeys\n\nTrack https://github.com/volnei/reviewly/pull/42.\n",
        );
        write(
            &dir.join("openspec/changes/passkeys/tasks.md"),
            "- [ ] Land https://gitlab.com/acme/app/-/merge_requests/7\n",
        );
        write(&dir.join("openspec/changes/passkeys/specs/auth/spec.md"), "## ADDED Requirements\n\n### Requirement: Passkey\n\n#### Scenario: Known credential\n");
        let scan = scan_sync(&dir).unwrap();
        assert_eq!(scan.archived_changes, 1);
        assert_eq!(scan.changes[0].pull_requests.len(), 2);
        assert_eq!(scan.changes[0].pull_requests[0].label, "PR #42");
        assert_eq!(scan.changes[0].pull_requests[1].label, "PR #7");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_repositories_without_openspec() {
        let dir = std::env::temp_dir().join(format!("reviewly-no-openspec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(scan_sync(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_a_change_without_allowing_path_escape_or_overwrite() {
        let dir =
            std::env::temp_dir().join(format!("reviewly-create-openspec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("openspec/changes")).unwrap();

        create_change_sync(
            &dir,
            "add-device-trust",
            "# Add device trust",
            "# Design",
            "# Tasks\n\n- [ ] Add tests",
            vec![GeneratedSpecFile {
                capability: "sessions".into(),
                content: "## ADDED Requirements".into(),
            }],
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(
                dir.join("openspec/changes/add-device-trust/specs/sessions/spec.md")
            )
            .unwrap(),
            "## ADDED Requirements\n"
        );
        assert!(create_change_sync(
            &dir,
            "add-device-trust",
            "# Duplicate",
            "",
            "- [ ] Duplicate",
            vec![GeneratedSpecFile {
                capability: "sessions".into(),
                content: "duplicate".into(),
            }],
        )
        .is_err());
        assert!(create_change_sync(
            &dir,
            "../../escape",
            "# Escape",
            "",
            "- [ ] Escape",
            vec![GeneratedSpecFile {
                capability: "sessions".into(),
                content: "escape".into(),
            }],
        )
        .is_err());
        assert!(!dir.join("escape").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
