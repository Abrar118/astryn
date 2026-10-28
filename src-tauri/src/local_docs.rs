//! Local folder documentation sources: scan a folder the user picked and read
//! its Markdown, plain-text and PDF files in place. Nothing here touches SQLite —
//! only the folder path is stored, by the caller.
//!
//! Everything is blocking `std::fs`; callers run it on `spawn_blocking`.

use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::db::docs::DocNode;

/// Markdown / plain-text files larger than this are skipped (not listed, not read).
pub const TEXT_MAX_BYTES: u64 = 5 * 1024 * 1024;
/// PDFs larger than this are skipped.
pub const PDF_MAX_BYTES: u64 = 50 * 1024 * 1024;
/// How far one scan may go before it stops and reports `truncated`.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Listed documents.
    pub max_files: usize,
    /// Directory entries looked at, listed or not — so picking a home folder or
    /// a whole drive (full of non-doc files) can't turn into a full disk walk.
    pub max_entries: usize,
    /// Nested folder depth.
    pub max_depth: usize,
}

impl Limits {
    pub const DEFAULT: Self = Self {
        max_files: 5_000,
        max_entries: 50_000,
        max_depth: 32,
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocFormat {
    Markdown,
    Text,
    Pdf,
}

impl DocFormat {
    fn max_bytes(self) -> u64 {
        match self {
            DocFormat::Pdf => PDF_MAX_BYTES,
            DocFormat::Markdown | DocFormat::Text => TEXT_MAX_BYTES,
        }
    }
}

/// The viewer a file name maps to, by extension (case-insensitive); `None` for
/// anything the Docs page can't show.
pub fn format_of(name: &str) -> Option<DocFormat> {
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" => Some(DocFormat::Markdown),
        "txt" => Some(DocFormat::Text),
        "pdf" => Some(DocFormat::Pdf),
        _ => None,
    }
}

/// Dot-prefixed entries (`.git`, `.obsidian`, `.DS_Store`) are never listed or read.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

#[derive(Debug, Default)]
pub struct Scan {
    /// Folders and files, relative paths with `/` separators (the same shape as
    /// the GitHub cache, so the frontend nests both the same way).
    pub nodes: Vec<DocNode>,
    pub file_count: usize,
    pub truncated: bool,
    /// Directory entries looked at so far (bounded by `Limits::max_entries`).
    visited: usize,
}

/// Recursively list the readable documents under `root`. Unsupported, hidden,
/// oversized or unopenable files, symlinks, and unreadable subfolders are skipped
/// silently; folders without any listed file are pruned. Fails only when `root`
/// itself can't be read (moved, deleted, permission denied).
pub fn scan_folder(root: &Path) -> std::io::Result<Scan> {
    scan_folder_with(root, Limits::DEFAULT)
}

pub fn scan_folder_with(root: &Path, limits: Limits) -> std::io::Result<Scan> {
    let entries = fs::read_dir(root)?;
    let mut scan = Scan::default();
    walk_entries(entries, "", 0, &limits, &mut scan);
    Ok(scan)
}

fn walk(dir: &Path, rel: &str, depth: usize, limits: &Limits, scan: &mut Scan) {
    if let Ok(entries) = fs::read_dir(dir) {
        walk_entries(entries, rel, depth, limits, scan);
    }
}

fn walk_entries(entries: fs::ReadDir, rel: &str, depth: usize, limits: &Limits, scan: &mut Scan) {
    // Collecting a directory's names is itself bounded by the entry budget, so a
    // single enormous folder can't be read in full either.
    let budget = limits.max_entries.saturating_sub(scan.visited);
    let mut entries: Vec<fs::DirEntry> = entries.filter_map(Result::ok).take(budget + 1).collect();
    if entries.len() > budget {
        entries.truncate(budget);
        scan.truncated = true;
    }
    // Sorted so the listing (and which files survive truncation) is deterministic.
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if scan.visited >= limits.max_entries {
            scan.truncated = true;
            return;
        }
        scan.visited += 1;
        if scan.truncated && scan.file_count >= limits.max_files {
            return;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue; // non-UTF-8 names can't round-trip through IPC
        };
        if is_hidden(&name) {
            continue;
        }
        // `DirEntry::file_type` does not follow symlinks, so links are skipped here.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        if file_type.is_dir() {
            if depth + 1 >= limits.max_depth {
                scan.truncated = true;
                continue;
            }
            let at = scan.nodes.len();
            let files_before = scan.file_count;
            scan.nodes.push(DocNode {
                path: path.clone(),
                name,
                kind: "tree".into(),
                parent_path: rel.to_string(),
            });
            walk(&entry.path(), &path, depth + 1, limits, scan);
            if scan.file_count == files_before {
                scan.nodes.truncate(at); // prune a folder with nothing to show
            }
        } else if file_type.is_file() && is_listable(&entry.path(), &name) {
            if scan.file_count >= limits.max_files {
                scan.truncated = true;
                return;
            }
            scan.file_count += 1;
            scan.nodes.push(DocNode {
                path,
                name,
                kind: "blob".into(),
                parent_path: rel.to_string(),
            });
        }
    }
}

/// Supported type, within its size cap, and openable for reading.
fn is_listable(path: &Path, name: &str) -> bool {
    let Some(format) = format_of(name) else {
        return false;
    };
    match fs::metadata(path) {
        Ok(meta) if meta.len() <= format.max_bytes() => fs::File::open(path).is_ok(),
        _ => false,
    }
}

/// A canonical path as a plain UTF-8 string: `None` if it isn't valid UTF-8,
/// and on Windows without the `\\?\` verbatim prefix `canonicalize` adds.
pub fn plain_path(path: &Path) -> Option<String> {
    let s = path.to_str()?;
    if cfg!(windows) {
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return Some(format!(r"\\{rest}"));
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return Some(rest.to_string());
        }
    }
    Some(s.to_string())
}

/// Resolve a document path the webview asked for to a file inside `root`.
/// `rel` must be relative (no root, drive prefix, `.` or `..` components, no
/// hidden segments) and name a supported type, and the canonical target must
/// still lie inside the canonical root — so a symlink can't lead outside the
/// folder the user picked.
pub fn resolve_file(root: &Path, rel: &str) -> Option<(PathBuf, DocFormat)> {
    if rel.is_empty() {
        return None;
    }
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(seg) if !is_hidden(&seg.to_string_lossy()) => {}
            _ => return None,
        }
    }
    let name = rel.rsplit('/').next()?;
    let format = format_of(name)?;
    let root = fs::canonicalize(root).ok()?;
    let full = fs::canonicalize(root.join(rel)).ok()?;
    if !full.starts_with(&root) || !full.is_file() {
        return None;
    }
    Some((full, format))
}

/// Read at most `max` bytes. The cap is enforced on the bytes actually read (one
/// byte past it means "too large"), not on an earlier size check, so a file that
/// grows after it was listed — or a device that never ends — can't exceed it.
fn read_capped(path: &Path, max: u64) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut buf = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(max + 1)
        .read_to_end(&mut buf)
        .ok()?;
    (buf.len() as u64 <= max).then_some(buf)
}

/// A Markdown / text file's contents, decoded as UTF-8 (lossily, so a stray
/// invalid byte shows as U+FFFD instead of hiding the whole document).
pub fn read_text(path: &Path) -> Option<String> {
    read_capped(path, TEXT_MAX_BYTES).map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// A PDF's raw bytes for the webview's pdf.js viewer.
pub fn read_pdf(path: &Path) -> Option<Vec<u8>> {
    read_capped(path, PDF_MAX_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &[u8]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }

    fn paths(scan: &Scan) -> Vec<(&str, &str, &str)> {
        scan.nodes
            .iter()
            .map(|n| (n.path.as_str(), n.kind.as_str(), n.parent_path.as_str()))
            .collect()
    }

    #[test]
    fn format_is_chosen_by_extension() {
        assert_eq!(format_of("a.md"), Some(DocFormat::Markdown));
        assert_eq!(format_of("A.MARKDOWN"), Some(DocFormat::Markdown));
        assert_eq!(format_of("notes.TXT"), Some(DocFormat::Text));
        assert_eq!(format_of("spec.pdf"), Some(DocFormat::Pdf));
        assert_eq!(format_of("image.png"), None);
        assert_eq!(format_of("README"), None);
    }

    #[test]
    fn scan_lists_supported_files_recursively_and_skips_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "README.md", b"# Hi");
        write(root, "guide/intro.txt", b"plain");
        write(root, "guide/deep/spec.pdf", b"%PDF-1.4");
        write(root, "guide/logo.png", b"png");
        write(root, "images/a.png", b"png"); // folder with nothing to show → pruned
        write(root, ".git/HEAD.md", b"hidden"); // hidden folder
        write(root, ".draft.md", b"hidden"); // hidden file

        let scan = scan_folder(root).unwrap();
        assert_eq!(
            paths(&scan),
            vec![
                ("README.md", "blob", ""),
                ("guide", "tree", ""),
                ("guide/deep", "tree", "guide"),
                ("guide/deep/spec.pdf", "blob", "guide/deep"),
                ("guide/intro.txt", "blob", "guide"),
            ]
        );
        assert_eq!(scan.file_count, 3);
        assert!(!scan.truncated);
    }

    #[test]
    fn oversized_files_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let big = fs::File::create(dir.path().join("huge.md")).unwrap();
        big.set_len(TEXT_MAX_BYTES + 1).unwrap();
        write(dir.path(), "small.md", b"ok");
        let scan = scan_folder(dir.path()).unwrap();
        assert_eq!(paths(&scan), vec![("small.md", "blob", "")]);
    }

    #[test]
    fn scan_stops_at_the_file_cap_and_reports_truncation() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..=5 {
            write(dir.path(), &format!("{i:02}.md"), b"x");
        }
        let limits = Limits {
            max_files: 5,
            ..Limits::DEFAULT
        };
        let scan = scan_folder_with(dir.path(), limits).unwrap();
        assert_eq!(scan.file_count, 5);
        assert!(scan.truncated);
    }

    #[test]
    fn scan_stops_after_visiting_too_many_entries_even_if_none_are_listed() {
        // A home folder or drive full of non-doc files must not be walked whole.
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            write(dir.path(), &format!("noise/{i:02}.png"), b"x");
        }
        write(dir.path(), "zz.md", b"late");
        let limits = Limits {
            max_entries: 10,
            ..Limits::DEFAULT
        };
        let scan = scan_folder_with(dir.path(), limits).unwrap();
        assert!(scan.truncated);
        assert_eq!(scan.file_count, 0);
    }

    #[test]
    fn reads_are_capped_by_bytes_read_not_by_metadata() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.txt", b"12345");
        let p = dir.path().join("a.txt");
        assert_eq!(read_capped(&p, 5).as_deref(), Some(&b"12345"[..]));
        assert_eq!(read_capped(&p, 4), None);
    }

    /// `/dev/zero` reports a length of 0 but never ends — the stand-in for a file
    /// that grows after its size was checked. Capped reads must stop at the cap.
    #[cfg(unix)]
    #[test]
    fn an_endless_file_is_rejected_at_the_cap() {
        assert_eq!(read_capped(Path::new("/dev/zero"), 1024), None);
    }

    #[test]
    fn scan_of_a_missing_folder_fails() {
        let dir = tempfile::tempdir().unwrap();
        assert!(scan_folder(&dir.path().join("gone")).is_err());
    }

    #[test]
    fn resolve_confines_reads_to_the_folder() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("docs");
        write(&root, "a/b.md", b"# B");
        write(&root, "notes.txt", b"n");
        write(&root, ".secret/key.md", b"k");
        write(outer.path(), "outside.md", b"nope");

        let (path, format) = resolve_file(&root, "a/b.md").unwrap();
        assert_eq!(format, DocFormat::Markdown);
        assert_eq!(read_text(&path).as_deref(), Some("# B"));
        assert_eq!(resolve_file(&root, "notes.txt").unwrap().1, DocFormat::Text);

        for bad in [
            "",
            "../outside.md",
            "a/../../outside.md",
            "./a/b.md",
            ".secret/key.md",
            "a", // a folder, and no supported extension
            "missing.md",
            "a/b.png",
        ] {
            assert!(
                resolve_file(&root, bad).is_none(),
                "{bad} should be refused"
            );
        }
        let absolute = outer.path().join("outside.md");
        assert!(resolve_file(&root, absolute.to_str().unwrap()).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_neither_listed_nor_followed() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("docs");
        write(&root, "real.md", b"r");
        write(outer.path(), "outside.md", b"nope");
        std::os::unix::fs::symlink(outer.path().join("outside.md"), root.join("link.md")).unwrap();

        let scan = scan_folder(&root).unwrap();
        assert_eq!(paths(&scan), vec![("real.md", "blob", "")]);
        assert!(resolve_file(&root, "link.md").is_none());
    }

    #[test]
    fn text_is_decoded_lossily() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.txt", b"ok \xff end");
        assert_eq!(
            read_text(&dir.path().join("a.txt")).as_deref(),
            Some("ok \u{fffd} end")
        );
    }

    #[test]
    fn pdf_bytes_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.pdf", b"%PDF-1.7 body");
        assert_eq!(
            read_pdf(&dir.path().join("a.pdf")).as_deref(),
            Some(&b"%PDF-1.7 body"[..])
        );
    }
}
