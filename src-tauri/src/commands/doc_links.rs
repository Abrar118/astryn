//! F9 per-task doc links, owned by the Docs module. A link points at a web URL
//! or at a document in a docs source, and belongs to one task of any tracker.
//! See docs/superpowers/specs/2026-10-29-f9-doc-links-design.md.

use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::doc_links::{self as dl, DocLink, LinkFields, Target};
use crate::db::docs as ddb;
use crate::local_tasks::now;
use crate::modules::{self, Capability, ModuleId};

const MAX_URL: usize = 2048;
const MAX_PATH: usize = 1024;
const MAX_SOURCE_ID: usize = 2048;
const MAX_TASK_ID: usize = 200;
const MAX_TITLE: usize = 200;
const MAX_NOTE: usize = 4000;
const MAX_TAGS: usize = 20;
const MAX_TAG: usize = 40;

/// What the drawer sends for a new or edited link.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocLinkInput {
    /// `url` | `doc`
    pub kind: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub doc_path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// `tracker` must name a module that provides the `tracker` capability, and the
/// task id must look like an id (a link is only ever found by its exact key).
pub fn validate_task(tracker: &str, task_id: &str) -> Result<(), CmdError> {
    let is_tracker = serde_json::from_value::<ModuleId>(serde_json::Value::String(tracker.into()))
        .is_ok_and(|id| modules::spec(id).provides.contains(&Capability::Tracker));
    let id_ok = !task_id.is_empty()
        && task_id.chars().count() <= MAX_TASK_ID
        && !task_id.chars().any(|c| c.is_whitespace() || c.is_control());
    if is_tracker && id_ok {
        Ok(())
    } else {
        Err(CmdError::InvalidDocLink)
    }
}

/// Trimmed text, `None` when blank; refused when longer than `max` characters
/// or (unless `multi_line`) containing control characters such as newlines.
fn clean_text(
    value: Option<String>,
    max: usize,
    multi_line: bool,
) -> Result<Option<String>, CmdError> {
    let Some(text) = value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    else {
        return Ok(None);
    };
    let bad_char = |c: char| c.is_control() && !(multi_line && matches!(c, '\n' | '\t'));
    if text.chars().count() > max || text.chars().any(bad_char) {
        return Err(CmdError::InvalidDocLink);
    }
    Ok(Some(text))
}

/// Trimmed, non-blank, de-duplicated (case-insensitively, first spelling wins).
fn clean_tags(tags: Vec<String>) -> Result<Vec<String>, CmdError> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let Some(tag) = clean_text(Some(tag), MAX_TAG, false)? else {
            continue;
        };
        if !out.iter().any(|t| t.to_lowercase() == tag.to_lowercase()) {
            out.push(tag);
        }
    }
    if out.len() > MAX_TAGS {
        return Err(CmdError::InvalidDocLink);
    }
    Ok(out)
}

/// Trim and check every field. Blank optional text becomes `None`.
pub fn validate_input(input: DocLinkInput) -> Result<LinkFields, CmdError> {
    let target = match input.kind.as_str() {
        "url" => {
            if input.source_id.is_some() || input.doc_path.is_some() {
                return Err(CmdError::InvalidDocLink);
            }
            let url = input
                .url
                .as_deref()
                .and_then(super::normalize_attachment_url)
                .filter(|u| u.len() <= MAX_URL)
                .ok_or(CmdError::InvalidUrl)?;
            Target::Url(url)
        }
        "doc" => {
            if input.url.is_some() {
                return Err(CmdError::InvalidDocLink);
            }
            let source_id = input.source_id.unwrap_or_default();
            let path = input.doc_path.unwrap_or_default();
            let ok = |s: &str, max: usize| {
                !s.trim().is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)
            };
            if !ok(&source_id, MAX_SOURCE_ID) || !ok(&path, MAX_PATH) {
                return Err(CmdError::InvalidDocLink);
            }
            Target::Doc { source_id, path }
        }
        _ => return Err(CmdError::InvalidDocLink),
    };
    Ok(LinkFields {
        target,
        title: clean_text(input.title, MAX_TITLE, false)?,
        note: clean_text(input.note, MAX_NOTE, true)?,
        tags: clean_tags(input.tags)?,
    })
}

/// A doc target must name a configured source when it is saved.
async fn require_source(pool: &SqlitePool, target: &Target) -> Result<(), CmdError> {
    if let Target::Doc { source_id, .. } = target {
        ddb::load_docs_source(pool, source_id)
            .await
            .map_err(|_| CmdError::Internal)?
            .ok_or(CmdError::DocsSourceNotFound)?;
    }
    Ok(())
}

/// A fresh `dl_`-prefixed id (same randomness as local-task ids).
fn new_link_id() -> String {
    format!(
        "dl_{}",
        crate::local_tasks::new_id().trim_start_matches("lt_")
    )
}

pub async fn list_doc_links_logic(
    pool: &SqlitePool,
    tracker: &str,
    task_id: &str,
) -> Result<Vec<DocLink>, CmdError> {
    validate_task(tracker, task_id)?;
    dl::list(pool, tracker, task_id)
        .await
        .map_err(|_| CmdError::Internal)
}

pub async fn create_doc_link_logic(
    pool: &SqlitePool,
    tracker: &str,
    task_id: &str,
    input: DocLinkInput,
    now: &str,
) -> Result<DocLink, CmdError> {
    validate_task(tracker, task_id)?;
    let fields = validate_input(input)?;
    require_source(pool, &fields.target).await?;
    dl::insert(pool, &new_link_id(), tracker, task_id, &fields, now)
        .await
        .map_err(write_err)
}

/// A unique-index hit means the task already holds that target.
fn write_err(e: sqlx::Error) -> CmdError {
    match e {
        sqlx::Error::Database(d) if d.is_unique_violation() => CmdError::DuplicateDocLink,
        _ => CmdError::Internal,
    }
}

pub async fn update_doc_link_logic(
    pool: &SqlitePool,
    id: &str,
    input: DocLinkInput,
    now: &str,
) -> Result<DocLink, CmdError> {
    let fields = validate_input(input)?;
    let current = dl::load(pool, id)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::DocLinkNotFound)?;
    // Editing the note or tags of a link whose source was removed stays allowed;
    // only a newly chosen document must exist.
    let unchanged = matches!(&fields.target, Target::Doc { source_id, path }
        if current.source_id.as_deref() == Some(source_id) && current.doc_path.as_deref() == Some(path));
    if !unchanged {
        require_source(pool, &fields.target).await?;
    }
    dl::update(pool, id, &fields, now)
        .await
        .map_err(write_err)?
        .ok_or(CmdError::DocLinkNotFound)
}

pub async fn delete_doc_link_logic(pool: &SqlitePool, id: &str) -> Result<(), CmdError> {
    if dl::delete(pool, id).await.map_err(|_| CmdError::Internal)? {
        Ok(())
    } else {
        Err(CmdError::DocLinkNotFound)
    }
}

#[tauri::command]
pub async fn list_doc_links(
    state: State<'_, AppState>,
    tracker: String,
    task_id: String,
) -> Result<Vec<DocLink>, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    list_doc_links_logic(&state.pool, &tracker, &task_id).await
}

#[tauri::command]
pub async fn create_doc_link(
    state: State<'_, AppState>,
    tracker: String,
    task_id: String,
    input: DocLinkInput,
) -> Result<DocLink, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    create_doc_link_logic(&state.pool, &tracker, &task_id, input, &now()).await
}

#[tauri::command]
pub async fn update_doc_link(
    state: State<'_, AppState>,
    id: String,
    input: DocLinkInput,
) -> Result<DocLink, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    update_doc_link_logic(&state.pool, &id, input, &now()).await
}

#[tauri::command]
pub async fn delete_doc_link(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    delete_doc_link_logic(&state.pool, &id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn web(url: &str) -> DocLinkInput {
        DocLinkInput {
            kind: "url".into(),
            url: Some(url.into()),
            ..Default::default()
        }
    }

    fn doc(source_id: &str, path: &str) -> DocLinkInput {
        DocLinkInput {
            kind: "doc".into(),
            source_id: Some(source_id.into()),
            doc_path: Some(path.into()),
            ..Default::default()
        }
    }

    fn invalid(r: Result<LinkFields, CmdError>) -> bool {
        matches!(r, Err(CmdError::InvalidDocLink))
    }

    #[test]
    fn only_tracker_modules_own_links() {
        assert!(validate_task("linear", "0b6c7c4e-1").is_ok());
        assert!(validate_task("local-tasks", "lt_abc").is_ok());
        for (tracker, task) in [
            ("docs", "x"),     // a module, but not a tracker
            ("jira", "x"),     // not a module
            ("linear", ""),    // no task
            ("linear", "a b"), // not an id
            ("linear", &"x".repeat(MAX_TASK_ID + 1)),
        ] {
            assert!(
                matches!(validate_task(tracker, task), Err(CmdError::InvalidDocLink)),
                "{tracker} {task}"
            );
        }
    }

    #[test]
    fn web_links_are_normalized_like_linear_links() {
        let f = validate_input(web("  github.com/acme/docs ")).unwrap();
        assert_eq!(f.target, Target::Url("https://github.com/acme/docs".into()));
        for bad in ["", "ftp://x.com", "hello world", "javascript:alert(1)"] {
            assert!(
                matches!(validate_input(web(bad)), Err(CmdError::InvalidUrl)),
                "{bad}"
            );
        }
        let long = format!("https://x.com/{}", "a".repeat(MAX_URL));
        assert!(matches!(
            validate_input(web(&long)),
            Err(CmdError::InvalidUrl)
        ));
        // A web link carries no doc target.
        let mut mixed = web("https://x.com");
        mixed.source_id = Some("s".into());
        assert!(invalid(validate_input(mixed)));
    }

    #[test]
    fn doc_links_need_a_source_and_a_clean_path() {
        let f = validate_input(doc("acme/docs@main", "guide/a b.md")).unwrap();
        assert_eq!(
            f.target,
            Target::Doc {
                source_id: "acme/docs@main".into(),
                path: "guide/a b.md".into()
            }
        );
        assert!(invalid(validate_input(doc("", "a.md"))));
        assert!(invalid(validate_input(doc("s", ""))));
        assert!(invalid(validate_input(doc("s", "a\u{0}.md"))));
        assert!(invalid(validate_input(doc("s", &"a".repeat(MAX_PATH + 1)))));
        let mut mixed = doc("s", "a.md");
        mixed.url = Some("https://x.com".into());
        assert!(invalid(validate_input(mixed)));
        let mut unknown = doc("s", "a.md");
        unknown.kind = "file".into();
        assert!(invalid(validate_input(unknown)));
    }

    #[test]
    fn title_note_and_tags_are_trimmed_and_bounded() {
        let mut input = web("https://x.com");
        input.title = Some("  Spec  ".into());
        input.note = Some("   ".into());
        input.tags = vec![" ops ".into(), "".into(), "OPS".into(), "deploy".into()];
        let f = validate_input(input).unwrap();
        assert_eq!(f.title.as_deref(), Some("Spec"));
        assert_eq!(f.note, None);
        assert_eq!(f.tags, ["ops", "deploy"]);

        let mut multi_line = web("https://x.com");
        multi_line.note = Some("line one\nline two".into());
        assert_eq!(
            validate_input(multi_line).unwrap().note.as_deref(),
            Some("line one\nline two")
        );

        let with = |f: &dyn Fn(&mut DocLinkInput)| {
            let mut i = web("https://x.com");
            f(&mut i);
            validate_input(i)
        };
        assert!(invalid(
            with(&|i| i.title = Some("a".repeat(MAX_TITLE + 1)))
        ));
        assert!(invalid(with(&|i| i.title = Some("two\nlines".into()))));
        assert!(invalid(with(&|i| i.note = Some("a".repeat(MAX_NOTE + 1)))));
        assert!(invalid(with(&|i| i.tags = vec!["a".repeat(MAX_TAG + 1)])));
        assert!(invalid(with(
            &|i| i.tags = (0..=MAX_TAGS).map(|n| n.to_string()).collect()
        )));
        // Limits count characters, not bytes.
        assert!(with(&|i| i.title = Some("é".repeat(MAX_TITLE))).is_ok());
    }

    #[tokio::test]
    async fn links_are_created_listed_and_scoped_to_their_task() {
        let (_d, pool) = pool().await;
        let a = create_doc_link_logic(&pool, "linear", "issue-1", web("https://a.com"), "t1")
            .await
            .unwrap();
        assert!(a.id.starts_with("dl_"));
        create_doc_link_logic(&pool, "local-tasks", "lt_1", web("https://b.com"), "t1")
            .await
            .unwrap();
        let listed = list_doc_links_logic(&pool, "linear", "issue-1")
            .await
            .unwrap();
        assert_eq!(listed, [a]);
        assert!(matches!(
            list_doc_links_logic(&pool, "jira", "issue-1").await,
            Err(CmdError::InvalidDocLink)
        ));
    }

    #[tokio::test]
    async fn a_doc_link_needs_an_existing_source() {
        let (_d, pool) = pool().await;
        assert!(matches!(
            create_doc_link_logic(&pool, "linear", "i1", doc("acme/docs@main", "a.md"), "t1").await,
            Err(CmdError::DocsSourceNotFound)
        ));
        ddb::insert_docs_source(&pool, "Docs", "acme", "docs", "main", "t0")
            .await
            .unwrap();
        let link =
            create_doc_link_logic(&pool, "linear", "i1", doc("acme/docs@main", "a.md"), "t1")
                .await
                .unwrap();
        assert_eq!(link.source_id.as_deref(), Some("acme/docs@main"));
    }

    #[tokio::test]
    async fn a_link_to_a_removed_source_can_still_be_edited_and_deleted() {
        let (_d, pool) = pool().await;
        ddb::insert_docs_source(&pool, "Docs", "acme", "docs", "main", "t0")
            .await
            .unwrap();
        let link =
            create_doc_link_logic(&pool, "linear", "i1", doc("acme/docs@main", "a.md"), "t1")
                .await
                .unwrap();
        ddb::remove_docs_source(&pool, "acme/docs@main")
            .await
            .unwrap();

        // Same target, new note: fine even though the source is gone.
        let mut edit = doc("acme/docs@main", "a.md");
        edit.note = Some("still relevant".into());
        let edited = update_doc_link_logic(&pool, &link.id, edit, "t2")
            .await
            .unwrap();
        assert_eq!(edited.note.as_deref(), Some("still relevant"));
        assert_eq!(edited.updated_at, "t2");

        // Pointing it at another missing source is refused.
        assert!(matches!(
            update_doc_link_logic(&pool, &link.id, doc("gone@main", "a.md"), "t3").await,
            Err(CmdError::DocsSourceNotFound)
        ));
        // Turning it into a web link is fine.
        let web_link = update_doc_link_logic(&pool, &link.id, web("https://x.com"), "t3")
            .await
            .unwrap();
        assert_eq!(web_link.kind, "url");

        delete_doc_link_logic(&pool, &link.id).await.unwrap();
        assert!(matches!(
            delete_doc_link_logic(&pool, &link.id).await,
            Err(CmdError::DocLinkNotFound)
        ));
        assert!(matches!(
            update_doc_link_logic(&pool, &link.id, web("https://x.com"), "t4").await,
            Err(CmdError::DocLinkNotFound)
        ));
    }

    #[tokio::test]
    async fn the_same_link_cannot_be_added_to_a_task_twice() {
        let (_d, pool) = pool().await;
        create_doc_link_logic(&pool, "linear", "i1", web("https://a.com"), "t1")
            .await
            .unwrap();
        // Normalized first, so a bare domain matches its https:// form.
        assert!(matches!(
            create_doc_link_logic(&pool, "linear", "i1", web("a.com"), "t2").await,
            Err(CmdError::DuplicateDocLink)
        ));
        let other = create_doc_link_logic(&pool, "linear", "i1", web("https://b.com"), "t2")
            .await
            .unwrap();
        assert!(matches!(
            update_doc_link_logic(&pool, &other.id, web("https://a.com"), "t3").await,
            Err(CmdError::DuplicateDocLink)
        ));
        assert_eq!(
            CmdError::DuplicateDocLink.to_string(),
            "That link is already on this task."
        );
    }

    #[tokio::test]
    async fn links_persist_across_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("astryn/t.db");
        let pool = crate::db::init_pool(&path).await.unwrap();
        create_doc_link_logic(&pool, "linear", "i1", web("https://a.com"), "t1")
            .await
            .unwrap();
        pool.close().await;
        let reopened = crate::db::init_pool(&path).await.unwrap();
        assert_eq!(
            list_doc_links_logic(&reopened, "linear", "i1")
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn removing_docs_data_deletes_the_links() {
        let (_d, pool) = pool().await;
        create_doc_link_logic(&pool, "linear", "i1", web("https://a.com"), "t1")
            .await
            .unwrap();
        let store: std::sync::Arc<dyn crate::secrets::SecretStore> =
            std::sync::Arc::new(crate::secrets::fake::FakeSecretStore::default());
        let off = crate::modules::ModuleState {
            enabled: Default::default(),
            onboarded: true,
        };
        super::super::modules::remove_module_data_logic(
            &pool,
            store.clone(),
            &off,
            crate::modules::ModuleId::Docs,
        )
        .await
        .unwrap();
        assert!(list_doc_links_logic(&pool, "linear", "i1")
            .await
            .unwrap()
            .is_empty());
    }
}
