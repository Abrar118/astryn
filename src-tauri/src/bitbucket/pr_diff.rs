//! Split a Bitbucket PR's unified `git diff` body into per-file patches.

use crate::code_host::{PrDiff, PrDiffFile, RepositoryName};

/// Same ceiling as the GitHub diff view.
pub const DIFF_MAX_FILES: usize = 3000;

pub fn diff_path(repo: &RepositoryName, id: i64) -> Option<String> {
    (id > 0 && id <= i32::MAX as i64).then(|| {
        format!(
            "/repositories/{}/{}/pullrequests/{id}/diff",
            repo.owner, repo.name
        )
    })
}

/// Undo git's C-style quoting of unusual paths (`"a/caf\303\251"`).
fn unquote(path: &str) -> String {
    let Some(inner) = path.strip_prefix('"').and_then(|p| p.strip_suffix('"')) else {
        return path.to_string();
    };
    let mut bytes = Vec::new();
    let mut it = inner.bytes().peekable();
    while let Some(b) = it.next() {
        if b != b'\\' {
            bytes.push(b);
            continue;
        }
        match it.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(d @ b'0'..=b'7') => {
                let mut v = (d - b'0') as u32;
                for _ in 0..2 {
                    match it.peek() {
                        Some(&n @ b'0'..=b'7') => {
                            v = v * 8 + (n - b'0') as u32;
                            it.next();
                        }
                        _ => break,
                    }
                }
                bytes.push(v as u8);
            }
            Some(other) => bytes.push(other),
            None => {}
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `a/x` / `b/x` → `x`; `/dev/null` → None.
fn side_path(raw: &str, prefix: &str) -> Option<String> {
    let raw = unquote(raw.trim_end_matches('\t').trim());
    if raw == "/dev/null" {
        return None;
    }
    Some(raw.strip_prefix(prefix).unwrap_or(&raw).to_string())
}

/// Paths from `diff --git a/X b/Y` when no `---`/`+++` lines exist (binary,
/// pure renames, mode changes). Prefers the split where both sides match.
fn header_paths(rest: &str) -> (Option<String>, Option<String>) {
    if let Some(quoted) = rest.strip_prefix('"') {
        if let Some(end) = quoted.find("\" ").map(|i| i + 1) {
            let (a, b) = (&rest[..=end], rest[end + 1..].trim());
            return (side_path(a, "a/"), side_path(b, "b/"));
        }
    }
    let splits: Vec<usize> = rest.match_indices(" b/").map(|(i, _)| i).collect();
    let pick = splits
        .iter()
        .copied()
        .find(|&i| rest[..i].strip_prefix("a/") == Some(&rest[i + 3..]))
        .or_else(|| splits.first().copied());
    match pick {
        Some(i) => (side_path(&rest[..i], "a/"), side_path(&rest[i + 1..], "b/")),
        None => (None, None),
    }
}

struct Building {
    old: Option<String>,
    new: Option<String>,
    status: &'static str,
    binary: bool,
    patch: Vec<String>,
    in_hunks: bool,
    additions: i64,
    deletions: i64,
}

impl Building {
    fn finish(self, web_url: &str) -> Option<PrDiffFile> {
        let path = self.new.clone().or_else(|| self.old.clone())?;
        let previous_path = (self.status == "renamed")
            .then(|| self.old.clone())
            .flatten()
            .filter(|old| old != &path);
        Some(PrDiffFile {
            path,
            previous_path,
            change_type: self.status.to_string(),
            additions: self.additions,
            deletions: self.deletions,
            changes: self.additions + self.deletions,
            patch: (!self.binary && !self.patch.is_empty()).then(|| self.patch.join("\n")),
            blob_url: Some(web_url.to_string()),
        })
    }
}

/// Parse a unified diff into files. `truncated_body` means the body was cut
/// at the byte cap, so the last (possibly partial) file is dropped.
pub fn parse_unified_diff(
    text: &str,
    repo: &RepositoryName,
    id: i64,
    truncated_body: bool,
) -> PrDiff {
    let web_url = format!(
        "https://bitbucket.org/{}/{}/pull-requests/{id}/diff",
        repo.owner, repo.name
    );
    let mut files: Vec<PrDiffFile> = Vec::new();
    let mut current: Option<Building> = None;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(done) = current.take().and_then(|b| b.finish(&web_url)) {
                files.push(done);
            }
            let (old, new) = header_paths(rest);
            current = Some(Building {
                old,
                new,
                status: "modified",
                binary: false,
                patch: Vec::new(),
                in_hunks: false,
                additions: 0,
                deletions: 0,
            });
            continue;
        }
        let Some(b) = current.as_mut() else {
            continue;
        };
        if b.in_hunks {
            if line.starts_with('+') {
                b.additions += 1;
            } else if line.starts_with('-') {
                b.deletions += 1;
            }
            b.patch.push(line.to_string());
            continue;
        }
        if line.starts_with("@@") {
            b.in_hunks = true;
            b.patch.push(line.to_string());
        } else if line.starts_with("new file mode") {
            b.status = "added";
        } else if line.starts_with("deleted file mode") {
            b.status = "removed";
        } else if let Some(p) = line.strip_prefix("rename from ") {
            b.status = "renamed";
            b.old = Some(unquote(p));
        } else if let Some(p) = line.strip_prefix("rename to ") {
            b.status = "renamed";
            b.new = Some(unquote(p));
        } else if let Some(p) = line.strip_prefix("--- ") {
            b.old = side_path(p, "a/").or(b.old.take().filter(|_| b.status != "added"));
        } else if let Some(p) = line.strip_prefix("+++ ") {
            b.new = side_path(p, "b/").or(b.new.take().filter(|_| b.status != "removed"));
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            b.binary = true;
        }
    }
    if !truncated_body {
        if let Some(done) = current.take().and_then(|b| b.finish(&web_url)) {
            files.push(done);
        }
    }
    let truncated = truncated_body || files.len() > DIFF_MAX_FILES;
    files.truncate(DIFF_MAX_FILES);
    PrDiff {
        repo: repo.canonical.clone(),
        number: id,
        total_files: files.len(),
        truncated,
        files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code_host::parse_repo_name;

    const SAMPLE: &str = "diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,4 @@
 fn main() {
-    old();
+    new();
+    more();
 }
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1 @@
+# New
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
";

    fn repo() -> RepositoryName {
        parse_repo_name("acme/api").unwrap()
    }

    #[test]
    fn splits_files_with_status_counts_and_patches() {
        let diff = parse_unified_diff(SAMPLE, &repo(), 7, false);
        assert_eq!(diff.repo, "acme/api");
        assert_eq!(diff.number, 7);
        assert_eq!(diff.total_files, 5);
        assert!(!diff.truncated);

        let f = &diff.files[0];
        assert_eq!(f.path, "src/lib.rs");
        assert_eq!(f.change_type, "modified");
        assert_eq!((f.additions, f.deletions, f.changes), (2, 1, 3));
        assert!(f.patch.as_deref().unwrap().starts_with("@@ -1,3 +1,4 @@"));
        assert!(!f.patch.as_deref().unwrap().contains("+++"));
        assert_eq!(
            f.blob_url.as_deref(),
            Some("https://bitbucket.org/acme/api/pull-requests/7/diff")
        );

        assert_eq!(diff.files[1].path, "docs/new.md");
        assert_eq!(diff.files[1].change_type, "added");
        assert_eq!(diff.files[2].path, "gone.txt");
        assert_eq!(diff.files[2].change_type, "removed");
        assert_eq!(diff.files[2].deletions, 1);

        let renamed = &diff.files[3];
        assert_eq!(renamed.path, "new name.txt");
        assert_eq!(renamed.previous_path.as_deref(), Some("old name.txt"));
        assert_eq!(renamed.change_type, "renamed");
        assert_eq!(renamed.patch, None);

        let binary = &diff.files[4];
        assert_eq!(binary.path, "logo.png");
        assert_eq!(binary.patch, None);
    }

    #[test]
    fn truncated_body_drops_the_partial_last_file() {
        let cut = &SAMPLE[..SAMPLE.find("diff --git a/docs").unwrap() + 40];
        let diff = parse_unified_diff(cut, &repo(), 7, true);
        assert!(diff.truncated);
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].path, "src/lib.rs");
    }

    #[test]
    fn quoted_paths_are_unescaped() {
        let text = "diff --git \"a/caf\\303\\251.md\" \"b/caf\\303\\251.md\"\n--- \"a/caf\\303\\251.md\"\n+++ \"b/caf\\303\\251.md\"\n@@ -1 +1 @@\n-a\n+b\n";
        let diff = parse_unified_diff(text, &repo(), 1, false);
        assert_eq!(diff.files[0].path, "café.md");
    }

    #[test]
    fn empty_diff_has_no_files_and_paths_validate() {
        assert_eq!(parse_unified_diff("", &repo(), 1, false).total_files, 0);
        assert_eq!(
            diff_path(&repo(), 7).as_deref(),
            Some("/repositories/acme/api/pullrequests/7/diff")
        );
        assert_eq!(diff_path(&repo(), 0), None);
    }
}
