use crate::error::AppResult;
use serde::Serialize;
use std::path::Path;

/// One workspace package: its name and its directory relative to the repo root.
#[derive(Serialize, Clone)]
pub struct WorkspacePackage {
    pub name: String,
    pub dir: String,
}

/// A detected Turborepo workspace: the packages and the dependency edges among
/// them (`from` depends on `to`). Everything the webview needs to split a PR by
/// package and compute a blast radius — no `turbo` binary involved.
#[derive(Serialize)]
pub struct Workspace {
    pub packages: Vec<WorkspacePackage>,
    pub edges: Vec<(String, String)>,
}

/// Detect a Turborepo workspace at `path` and return its package graph, or
/// `None` when the repo isn't one.
///
/// The graph is built by reading workspace globs and each package's
/// package.json directly, NOT by shelling out to `turbo`. Deliberate: the
/// binary may be absent even where turbo.json exists, and a third-party CLI's
/// output format is a compatibility surface we don't control — while the
/// package.json shape is what turbo itself reads. `turbo.json` is only the
/// detection signal.
#[tauri::command]
pub async fn monorepo_workspace(path: String) -> AppResult<Option<Workspace>> {
    let root = Path::new(&path);
    if !root.join("turbo.json").is_file() && !root.join("turbo.jsonc").is_file() {
        return Ok(None);
    }

    let globs = workspace_globs(root);
    if globs.is_empty() {
        return Ok(None);
    }

    // Resolve globs to package dirs. Only the `dir/*` (one level) and literal
    // forms are supported — that covers the overwhelmingly common layouts
    // ("apps/*", "packages/*"); anything fancier simply contributes nothing
    // rather than erroring, so detection degrades to fewer packages, not a
    // broken screen.
    let mut packages: Vec<(String, String, serde_json::Value)> = Vec::new();
    for glob in &globs {
        let dirs: Vec<std::path::PathBuf> = if let Some(base) = glob.strip_suffix("/*") {
            match std::fs::read_dir(root.join(base)) {
                Ok(rd) => rd
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect(),
                Err(_) => continue,
            }
        } else if !glob.contains('*') {
            vec![root.join(glob)]
        } else {
            continue;
        };
        for dir in dirs {
            let Ok(raw) = std::fs::read_to_string(dir.join("package.json")) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let Some(name) = json.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            let rel = dir
                .strip_prefix(root)
                .unwrap_or(&dir)
                .to_string_lossy()
                .replace('\\', "/");
            packages.push((name.to_string(), rel, json));
        }
    }
    if packages.is_empty() {
        return Ok(None);
    }

    // Edges: a dependency counts only when it names another workspace member —
    // external packages are irrelevant to review order.
    let names: std::collections::HashSet<&str> =
        packages.iter().map(|(n, _, _)| n.as_str()).collect();
    let mut edges = Vec::new();
    for (name, _, json) in &packages {
        for key in ["dependencies", "devDependencies", "peerDependencies"] {
            if let Some(deps) = json.get(key).and_then(|d| d.as_object()) {
                for dep in deps.keys() {
                    if dep != name && names.contains(dep.as_str()) {
                        edges.push((name.clone(), dep.clone()));
                    }
                }
            }
        }
    }
    edges.sort();
    edges.dedup();

    Ok(Some(Workspace {
        packages: packages
            .into_iter()
            .map(|(name, dir, _)| WorkspacePackage { name, dir })
            .collect(),
        edges,
    }))
}

/// Workspace member globs, from package.json `workspaces` (array or object
/// form) or pnpm-workspace.yaml. Empty when neither declares any.
fn workspace_globs(root: &Path) -> Vec<String> {
    if let Ok(raw) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            let ws = json.get("workspaces");
            let arr = ws
                .and_then(|w| w.as_array())
                .or_else(|| ws.and_then(|w| w.get("packages")).and_then(|p| p.as_array()));
            if let Some(arr) = arr {
                let globs: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.trim_end_matches('/').to_string())
                    .collect();
                if !globs.is_empty() {
                    return globs;
                }
            }
        }
    }
    // pnpm keeps the list in its own YAML. A full YAML parser for two lines is
    // not worth a dependency: accept the plain `- "glob"` list form.
    if let Ok(raw) = std::fs::read_to_string(root.join("pnpm-workspace.yaml")) {
        return raw
            .lines()
            .map(str::trim)
            .filter_map(|l| l.strip_prefix("- "))
            .map(|l| l.trim_matches(|c| c == '"' || c == '\'').trim_end_matches('/').to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('!'))
            .collect();
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[tokio::test]
    async fn detects_and_graphs_a_workspace() {
        let dir = std::env::temp_dir().join(format!("rvw-mono-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write(&dir.join("turbo.json"), "{}");
        write(
            &dir.join("package.json"),
            r#"{"name":"root","workspaces":["apps/*","packages/*"]}"#,
        );
        write(
            &dir.join("packages/ui/package.json"),
            r#"{"name":"@acme/ui"}"#,
        );
        write(
            &dir.join("apps/web/package.json"),
            r#"{"name":"@acme/web","dependencies":{"@acme/ui":"*","react":"^18"}}"#,
        );

        let ws = monorepo_workspace(dir.to_string_lossy().into_owned())
            .await
            .unwrap()
            .expect("workspace detected");
        let mut names: Vec<_> = ws.packages.iter().map(|p| p.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["@acme/ui", "@acme/web"]);
        // External deps (react) never become edges; workspace members do.
        assert_eq!(ws.edges, vec![("@acme/web".into(), "@acme/ui".into())]);
        let web = ws.packages.iter().find(|p| p.name == "@acme/web").unwrap();
        assert_eq!(web.dir, "apps/web");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_plain_repo_is_none() {
        let dir = std::env::temp_dir().join(format!("rvw-mono-none-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write(&dir.join("package.json"), r#"{"name":"plain"}"#);
        let ws = monorepo_workspace(dir.to_string_lossy().into_owned()).await.unwrap();
        assert!(ws.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
