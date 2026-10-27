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

    let packages = load_packages(root);
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

/// Resolve workspace globs to member packages: (name, dir relative to root,
/// parsed package.json). Only the `dir/*` (one level) and literal forms are
/// supported — that covers the overwhelmingly common layouts ("apps/*",
/// "packages/*"); anything fancier contributes nothing rather than erroring,
/// so detection degrades to fewer packages, not a broken screen.
fn load_packages(root: &Path) -> Vec<(String, String, serde_json::Value)> {
    let mut packages = Vec::new();
    for glob in workspace_globs(root) {
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
            vec![root.join(&glob)]
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
    packages
}

/// Workspace member globs, from package.json `workspaces` (array or object
/// form) or pnpm-workspace.yaml. Empty when neither declares any.
fn workspace_globs(root: &Path) -> Vec<String> {
    if let Ok(raw) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            let ws = json.get("workspaces");
            let arr = ws.and_then(|w| w.as_array()).or_else(|| {
                ws.and_then(|w| w.get("packages"))
                    .and_then(|p| p.as_array())
            });
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
            .map(|l| {
                l.trim_matches(|c| c == '"' || c == '\'')
                    .trim_end_matches('/')
                    .to_string()
            })
            .filter(|l| !l.is_empty() && !l.starts_with('!'))
            .collect();
    }
    Vec::new()
}

/* ─────────────────────── workspace-wide health scan ─────────────────────── */

/// One import in the repo that reaches across a package boundary into another
/// package's internals.
#[derive(Serialize)]
pub struct RepoCrossing {
    pub file: String,
    pub line: u32,
    pub spec: String,
    pub from_pkg: String,
    pub target: String,
}

/// One declared workspace-internal dependency, with which section declares it
/// — the section is what tells you how to BREAK a cycle (a devDependencies
/// back-edge is usually the one to cut).
#[derive(Serialize)]
pub struct DepEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

/// Aggregated source-level use of one member by another — every import shape,
/// public or deep. Aggregated because a large workspace has thousands of
/// member imports and the client only needs the pair, the volume, and one
/// example location; the full list would be payload for its own sake.
#[derive(Serialize)]
pub struct MemberUse {
    pub from_pkg: String,
    pub target: String,
    pub count: u32,
    pub example_file: String,
    pub example_line: u32,
}

/// One external dependency declared by one member package.
#[derive(Serialize)]
pub struct PackageDep {
    pub package: String,
    pub name: String,
    pub version: String,
}

/// Everything the Turborepo health page needs in one round trip: the graph
/// (cycles are computed client-side, where the algorithm already exists for the
/// PR view), every boundary crossing in the source tree, and each member's
/// external dependencies (version mismatches are grouped client-side).
#[derive(Serialize)]
pub struct WorkspaceScan {
    pub packages: Vec<WorkspacePackage>,
    pub edges: Vec<(String, String)>,
    pub dep_edges: Vec<DepEdge>,
    pub crossings: Vec<RepoCrossing>,
    pub member_uses: Vec<MemberUse>,
    pub deps: Vec<PackageDep>,
}

/// Directories that are build output or vendored code — imports inside them are
/// not the repo's own sins.
const SKIP_DIRS: [&str; 9] = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".turbo",
    ".cache",
];
const SOURCE_EXTS: [&str; 8] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
/// Enough to fill a page many times over; a repo with more has a linting
/// problem, not a reviewing one, and an unbounded payload helps nobody.
const MAX_CROSSINGS: usize = 400;

/// Scan a Turborepo clone for workspace-wide problems. `None` when the repo
/// isn't a Turborepo. Unlike the per-PR insights, this reads the whole source
/// tree — it answers "what is wrong with my monorepo", not "what does this PR
/// change".
#[tauri::command]
pub async fn monorepo_scan(path: String) -> AppResult<Option<WorkspaceScan>> {
    // File walking is honest blocking IO over potentially thousands of files;
    // keep it off the async runtime's core threads.
    let out = tauri::async_runtime::spawn_blocking(move || scan_sync(&path))
        .await
        .map_err(|e| crate::error::AppError::Other(format!("scan task failed: {e}")))?;
    Ok(out)
}

fn scan_sync(path: &str) -> Option<WorkspaceScan> {
    let root = Path::new(path);
    if !root.join("turbo.json").is_file() && !root.join("turbo.jsonc").is_file() {
        return None;
    }
    let packages = load_packages(root);
    if packages.is_empty() {
        return None;
    }
    let names: std::collections::HashSet<String> =
        packages.iter().map(|(n, _, _)| n.clone()).collect();
    // (name, dir) pairs — the owned shape every helper below works over, so no
    // borrow of `packages` outlives its move into the result.
    let members: Vec<(String, String)> = packages
        .iter()
        .map(|(n, d, _)| (n.clone(), d.clone()))
        .collect();

    let mut edges = Vec::new();
    let mut dep_edges = Vec::new();
    let mut deps = Vec::new();
    for (name, _, json) in &packages {
        for key in ["dependencies", "devDependencies", "peerDependencies"] {
            if let Some(obj) = json.get(key).and_then(|d| d.as_object()) {
                for (dep, ver) in obj {
                    if dep == name {
                        continue;
                    }
                    if names.contains(dep.as_str()) {
                        edges.push((name.clone(), dep.clone()));
                        dep_edges.push(DepEdge {
                            from: name.clone(),
                            to: dep.clone(),
                            kind: key.to_string(),
                        });
                    } else if let Some(v) = ver.as_str() {
                        deps.push(PackageDep {
                            package: name.clone(),
                            name: dep.clone(),
                            version: v.to_string(),
                        });
                    }
                }
            }
        }
    }
    edges.sort();
    edges.dedup();

    let mut crossings = Vec::new();
    let mut uses: std::collections::HashMap<(String, String), (u32, String, u32)> =
        std::collections::HashMap::new();
    for (pkg_name, pkg_dir) in &members {
        let mut stack = vec![root.join(pkg_dir)];
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in rd.filter_map(|e| e.ok()) {
                let p = entry.path();
                let fname = entry.file_name().to_string_lossy().into_owned();
                if p.is_dir() {
                    if !SKIP_DIRS.contains(&fname.as_str()) {
                        stack.push(p);
                    }
                    continue;
                }
                let Some(ext) = p.extension().and_then(|e| e.to_str()) else {
                    continue;
                };
                if !SOURCE_EXTS.contains(&ext) {
                    continue;
                }
                let Ok(meta) = p.metadata() else { continue };
                if meta.len() > 1_000_000 {
                    continue; // bundled/generated, not hand-written source
                }
                let Ok(src) = std::fs::read_to_string(&p) else {
                    continue;
                };
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                let file_dir = rel
                    .rsplit_once('/')
                    .map(|(d, _)| d)
                    .unwrap_or("")
                    .to_string();
                for (i, line) in src.lines().enumerate() {
                    for spec in import_specs(line) {
                        let Some((target, deep)) =
                            import_target(spec, pkg_name, &file_dir, &members)
                        else {
                            continue;
                        };
                        let entry = uses.entry((pkg_name.clone(), target.clone())).or_insert((
                            0,
                            rel.clone(),
                            (i + 1) as u32,
                        ));
                        entry.0 += 1;
                        if deep && crossings.len() < MAX_CROSSINGS {
                            crossings.push(RepoCrossing {
                                file: rel.clone(),
                                line: (i + 1) as u32,
                                spec: spec.to_string(),
                                from_pkg: pkg_name.clone(),
                                target,
                            });
                        }
                    }
                }
            }
        }
    }
    crossings.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    let mut member_uses: Vec<MemberUse> = uses
        .into_iter()
        .map(
            |((from_pkg, target), (count, example_file, example_line))| MemberUse {
                from_pkg,
                target,
                count,
                example_file,
                example_line,
            },
        )
        .collect();
    member_uses.sort_by(|a, b| a.from_pkg.cmp(&b.from_pkg).then(a.target.cmp(&b.target)));

    Some(WorkspaceScan {
        packages: members
            .into_iter()
            .map(|(name, dir)| WorkspacePackage { name, dir })
            .collect(),
        edges,
        dep_edges,
        crossings,
        member_uses,
        deps,
    })
}

/// Longest-prefix package lookup, mirroring the client's `ownerOf`.
fn owner_of_member(rel: &str, members: &[(String, String)]) -> Option<String> {
    let mut best: Option<(&str, usize)> = None;
    for (name, dir) in members {
        let prefix = format!("{dir}/");
        if rel.starts_with(&prefix) && best.is_none_or(|(_, l)| prefix.len() > l) {
            best = Some((name.as_str(), prefix.len()));
        }
    }
    best.map(|(n, _)| n.to_string())
}

/// Import specifiers on one source line — `from "x"`, `import("x")`,
/// `require("x")`. Hand-parsed; the shapes are rigid enough that a regex
/// dependency isn't worth it.
fn import_specs(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    for lead in ["from ", "import(", "import (", "require(", "require ("] {
        let mut rest = line;
        while let Some(at) = rest.find(lead) {
            let after = &rest[at + lead.len()..];
            let after = after.trim_start();
            if let Some(q) = after.chars().next().filter(|c| *c == '"' || *c == '\'') {
                if let Some(end) = after[1..].find(q) {
                    out.push(&after[1..1 + end]);
                }
            }
            rest = &rest[at + lead.len()..];
        }
    }
    out
}

/// Which member `spec` imports, and whether it crosses into internals.
/// A relative path escaping its own package is always a crossing; a bare
/// specifier is a legitimate use of the target's public surface unless the
/// subpath reaches into src/dist/lib. Subpath exports ("@acme/ui/styles.css")
/// stay legitimate — but still count as USE, which phantom-dependency
/// detection needs.
fn import_target(
    spec: &str,
    own_pkg: &str,
    file_dir: &str,
    members: &[(String, String)],
) -> Option<(String, bool)> {
    if spec.starts_with('.') {
        let mut parts: Vec<&str> = if file_dir.is_empty() {
            Vec::new()
        } else {
            file_dir.split('/').collect()
        };
        for seg in spec.split('/') {
            match seg {
                "" | "." => {}
                ".." => {
                    parts.pop()?;
                }
                s => parts.push(s),
            }
        }
        let resolved = parts.join("/");
        let target = owner_of_member(&resolved, members)
            .or_else(|| owner_of_member(&format!("{resolved}/x"), members))?;
        return (target != own_pkg).then_some((target, true));
    }
    for (name, _) in members {
        if name == own_pkg {
            continue;
        }
        if spec == name {
            return Some((name.clone(), false));
        }
        if let Some(sub) = spec.strip_prefix(&format!("{name}/")) {
            let deep =
                sub.starts_with("src/") || sub.starts_with("dist/") || sub.starts_with("lib/");
            return Some((name.clone(), deep));
        }
    }
    None
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
    async fn scan_finds_crossings_and_deps() {
        let dir = std::env::temp_dir().join(format!("rvw-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write(&dir.join("turbo.json"), "{}");
        write(
            &dir.join("package.json"),
            r#"{"name":"root","workspaces":["packages/*"]}"#,
        );
        write(
            &dir.join("packages/ui/package.json"),
            r#"{"name":"@acme/ui","dependencies":{"react":"^18.2.0"}}"#,
        );
        write(
            &dir.join("packages/web/package.json"),
            r#"{"name":"@acme/web","dependencies":{"@acme/ui":"*","react":"^18.3.1"}}"#,
        );
        write(
            &dir.join("packages/web/src/page.ts"),
            "import { b } from \"@acme/ui/src/button\";\nimport { ok } from \"@acme/ui\";\nimport { x } from \"../../ui/src/x\";\n",
        );
        // core imports ui but declares nothing — a phantom dependency the
        // client detects by joining member_uses against dep_edges.
        write(
            &dir.join("packages/core/package.json"),
            r#"{"name":"@acme/core"}"#,
        );
        write(
            &dir.join("packages/core/src/thing.ts"),
            "import { ok } from \"@acme/ui\";\n",
        );

        let scan = monorepo_scan(dir.to_string_lossy().into_owned())
            .await
            .unwrap()
            .expect("scanned");
        // Deep bare import AND relative escape, each once; the public import not.
        assert_eq!(
            scan.crossings.len(),
            2,
            "{:?}",
            scan.crossings.iter().map(|c| &c.spec).collect::<Vec<_>>()
        );
        assert!(scan.crossings.iter().all(|c| c.target == "@acme/ui"));
        assert!(scan.crossings.iter().any(|c| c.line == 1));
        assert!(scan.crossings.iter().any(|c| c.line == 3));
        // External dep recorded per package — the client groups the mismatch.
        let reacts: Vec<_> = scan.deps.iter().filter(|d| d.name == "react").collect();
        assert_eq!(reacts.len(), 2);
        // Typed edges carry the declaring section.
        assert!(scan
            .dep_edges
            .iter()
            .any(|e| e.from == "@acme/web" && e.to == "@acme/ui" && e.kind == "dependencies"));
        // Aggregated uses include PUBLIC imports, which crossings do not: core
        // uses ui once with no declared edge — the phantom the client flags.
        assert!(scan
            .member_uses
            .iter()
            .any(|u| u.from_pkg == "@acme/core" && u.target == "@acme/ui" && u.count == 1));
        assert!(!scan.dep_edges.iter().any(|e| e.from == "@acme/core"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_plain_repo_is_none() {
        let dir = std::env::temp_dir().join(format!("rvw-mono-none-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write(&dir.join("package.json"), r#"{"name":"plain"}"#);
        let ws = monorepo_workspace(dir.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert!(ws.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
