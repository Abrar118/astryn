use crate::db::issues::{self, IssueRecord, LabelRecord, RelationRecord};
use crate::linear::issues::{IssuesPage, ParsedIssue};
use crate::linear::LinearError;
use sqlx::SqlitePool;
use std::future::Future;

pub const LOOKBACK_SECS: i64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncMode {
    Full,
    Incremental,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub mode: SyncMode,
    pub synced: usize,
}

pub fn to_record(i: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>, Vec<RelationRecord>) {
    let labels = i
        .labels
        .iter()
        .map(|l| LabelRecord {
            label_id: l.id.clone(),
            name: l.name.clone(),
            color: l.color.clone(),
        })
        .collect();
    let relations = i
        .relations
        .iter()
        .map(|r| RelationRecord {
            related_issue_id: r.related_id.clone(),
            r#type: r.r#type.clone(),
            related_identifier: r.related_identifier.clone(),
            related_title: r.related_title.clone(),
            related_state_name: r.related_state_name.clone(),
            related_state_type: r.related_state_type.clone(),
            related_state_color: r.related_state_color.clone(),
        })
        .collect();
    let rec = IssueRecord {
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        description: i.description,
        due_date: i.due_date,
        started_at: i.started_at,
        priority: i.priority,
        url: i.url,
        state_id: i.state_id,
        state_name: i.state_name,
        state_type: i.state_type,
        state_color: i.state_color,
        assignee_id: i.assignee_id,
        assignee_name: i.assignee_name,
        team_id: i.team_id,
        team_key: i.team_key,
        project_id: i.project_id,
        project_name: i.project_name,
        parent_id: i.parent_id,
        estimate: i.estimate,
        cycle_name: i.cycle_name,
        cycle_number: i.cycle_number,
        milestone_name: i.milestone_name,
        link_count: i.link_count,
        pr_count: i.pr_count,
        attachments_truncated: i.attachments_truncated,
        created_at: i.created_at,
        updated_at: i.updated_at,
        archived_at: i.archived_at,
        raw_json: i.raw_json,
    };
    (rec, labels, relations)
}

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

fn fmt_utc_secs(dt: OffsetDateTime) -> String {
    let u = dt.to_offset(time::UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        u.year(),
        u8::from(u.month()),
        u.day(),
        u.hour(),
        u.minute(),
        u.second(),
    )
}

/// Subtract LOOKBACK_SECS from an RFC3339 timestamp (handles fractional seconds
/// and any offset). On a parse failure, returns the input unchanged (safe
/// over-fetch, never an under-fetch).
pub fn lookback_cursor(cursor: &str) -> String {
    match OffsetDateTime::parse(cursor, &Rfc3339) {
        Ok(dt) => fmt_utc_secs(dt - time::Duration::seconds(LOOKBACK_SECS)),
        Err(_) => cursor.to_string(),
    }
}

/// Current UTC time as second-precision RFC3339 — the baseline cursor for an
/// empty workspace, so we don't full-sync forever.
fn now_rfc3339() -> String {
    fmt_utc_secs(OffsetDateTime::now_utc())
}

/// Run a sync. `force_full` (Resync) or an absent cursor => full; else incremental
/// with a lookback window. The cursor is advanced only after every page commits.
pub async fn run_sync<F, Fut>(
    pool: &SqlitePool,
    fetch_page: F,
    force_full: bool,
) -> Result<SyncResult, LinearError>
where
    F: Fn(Option<String>, Option<String>) -> Fut,
    Fut: Future<Output = Result<IssuesPage, LinearError>>,
{
    let cursor = issues::get_sync_cursor(pool)
        .await
        .map_err(|_| LinearError::Malformed)?;
    let (mode, since) = match (force_full, cursor.as_deref()) {
        (false, Some(c)) => (SyncMode::Incremental, Some(lookback_cursor(c))),
        _ => (SyncMode::Full, None),
    };

    let mut after: Option<String> = None;
    let mut synced = 0usize;
    // Full sync builds a fresh baseline from scratch; incremental keeps the prior
    // cursor as the floor so a zero-result run doesn't lose the watermark.
    let mut max_updated: Option<String> = match mode {
        SyncMode::Full => None,
        SyncMode::Incremental => cursor.clone(),
    };

    loop {
        let page = fetch_page(after.clone(), since.clone()).await?;
        let mut tx = pool.begin().await.map_err(|_| LinearError::Malformed)?;
        for parsed in page.issues {
            let updated = parsed.updated_at.clone();
            let (rec, labels, relations) = to_record(parsed);
            let applied = issues::upsert_issue(&mut tx, &rec)
                .await
                .map_err(|_| LinearError::Malformed)?;
            if applied {
                issues::replace_labels(&mut tx, &rec.id, &labels)
                    .await
                    .map_err(|_| LinearError::Malformed)?;
                issues::replace_relations(&mut tx, &rec.id, &relations)
                    .await
                    .map_err(|_| LinearError::Malformed)?;
            }
            synced += 1;
            if max_updated.as_deref().is_none_or(|m| updated.as_str() > m) {
                max_updated = Some(updated);
            }
        }
        tx.commit().await.map_err(|_| LinearError::Malformed)?;
        if page.has_next {
            // hasNextPage with no cursor is a broken response — fail rather than
            // commit an incomplete baseline.
            after = Some(page.end_cursor.ok_or(LinearError::Malformed)?);
        } else {
            break;
        }
    }

    // Advance the cursor only after all pages are durably committed. An empty
    // full sync still records a baseline (now) so we don't full-sync forever.
    let new_cursor = match max_updated {
        Some(m) => m,
        None => now_rfc3339(),
    };
    issues::set_sync_cursor(pool, &new_cursor)
        .await
        .map_err(|_| LinearError::Malformed)?;
    Ok(SyncResult { mode, synced })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        init_pool,
        issues::{get_sync_cursor, load_issue, set_sync_cursor},
    };
    use crate::linear::issues::{IssuesPage, ParsedIssue, ParsedLabel};
    use std::sync::{Arc, Mutex};

    fn issue(id: &str, updated: &str) -> ParsedIssue {
        ParsedIssue {
            id: id.into(),
            identifier: format!("ENG-{id}"),
            title: "T".into(),
            description: None,
            due_date: Some("2026-06-10".into()),
            started_at: None,
            priority: 0,
            url: "u".into(),
            state_id: Some("s".into()),
            state_name: Some("Todo".into()),
            state_type: Some("unstarted".into()),
            state_color: Some("#fff".into()),
            assignee_id: Some("me".into()),
            assignee_name: Some("Me".into()),
            team_id: Some("t".into()),
            team_key: Some("ENG".into()),
            project_id: None,
            project_name: None,
            parent_id: None,
            estimate: None,
            cycle_name: None,
            cycle_number: None,
            milestone_name: None,
            link_count: 0,
            pr_count: 0,
            attachments_truncated: false,
            created_at: "c".into(),
            updated_at: updated.into(),
            archived_at: None,
            labels: vec![ParsedLabel {
                id: "l1".into(),
                name: Some("bug".into()),
                color: None,
            }],
            relations: vec![],
            raw_json: "{}".into(),
        }
    }

    // Build a fetcher that returns pre-seeded pages and records the (after, since) args.
    fn pager(
        pages: Vec<IssuesPage>,
    ) -> (
        impl Fn(
            Option<String>,
            Option<String>,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<IssuesPage, crate::linear::LinearError>>
                    + Send,
            >,
        >,
        Arc<Mutex<Vec<(Option<String>, Option<String>)>>>,
    ) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let pages = Arc::new(Mutex::new(pages.into_iter()));
        let c2 = calls.clone();
        let f = move |after: Option<String>, since: Option<String>| {
            c2.lock().unwrap().push((after, since));
            let next = pages.lock().unwrap().next();
            Box::pin(async move { Ok(next.expect("ran out of pages")) }) as _
        };
        (f, calls)
    }

    #[tokio::test]
    async fn full_sync_pages_and_sets_cursor_after_commit() {
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();
        let (f, calls) = pager(vec![
            IssuesPage {
                issues: vec![issue("1", "2026-06-01T00:00:00Z")],
                has_next: true,
                end_cursor: Some("C1".into()),
            },
            IssuesPage {
                issues: vec![issue("2", "2026-06-03T00:00:00Z")],
                has_next: false,
                end_cursor: None,
            },
        ]);
        let res = run_sync(&p, f, false).await.unwrap();
        assert_eq!(res.mode, SyncMode::Full);
        assert_eq!(res.synced, 2);
        assert!(load_issue(&p, "1").await.unwrap().is_some());
        assert_eq!(
            get_sync_cursor(&p).await.unwrap(),
            Some("2026-06-03T00:00:00Z".into())
        );
        // first call has no cursor (after=None, since=None); second pages with endCursor.
        let c = calls.lock().unwrap();
        assert_eq!(c[0], (None, None));
        assert_eq!(c[1].0, Some("C1".into()));
    }

    #[tokio::test]
    async fn incremental_uses_lookback_window() {
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();
        set_sync_cursor(&p, "2026-06-10T12:00:00Z").await.unwrap();
        let (f, calls) = pager(vec![IssuesPage {
            issues: vec![issue("9", "2026-06-10T12:30:00Z")],
            has_next: false,
            end_cursor: None,
        }]);
        let res = run_sync(&p, f, false).await.unwrap();
        assert_eq!(res.mode, SyncMode::Incremental);
        // since = cursor - 5 min
        assert_eq!(
            calls.lock().unwrap()[0].1,
            Some("2026-06-10T11:55:00Z".into())
        );
        assert_eq!(
            get_sync_cursor(&p).await.unwrap(),
            Some("2026-06-10T12:30:00Z".into())
        );
    }

    #[tokio::test]
    async fn force_full_ignores_existing_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();
        set_sync_cursor(&p, "2026-06-10T12:00:00Z").await.unwrap();
        let (f, _calls) = pager(vec![IssuesPage {
            issues: vec![issue("1", "2026-06-01T00:00:00Z")],
            has_next: false,
            end_cursor: None,
        }]);
        let res = run_sync(&p, f, true).await.unwrap();
        assert_eq!(res.mode, SyncMode::Full);
    }

    #[tokio::test]
    async fn sync_persists_relations() {
        use crate::db::issues::load_relations;
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();

        let mut iss = issue("1", "2026-06-01T00:00:00Z");
        iss.relations = vec![crate::linear::issues::ParsedRelation {
            related_id: "2".into(),
            r#type: "blocks".into(),
            related_identifier: Some("ENG-2".into()),
            related_title: Some("Other".into()),
            related_state_name: Some("In Progress".into()),
            related_state_type: Some("started".into()),
            related_state_color: Some("#abc".into()),
        }];
        let (f, _calls) = pager(vec![IssuesPage {
            issues: vec![iss],
            has_next: false,
            end_cursor: None,
        }]);
        run_sync(&p, f, true).await.unwrap();

        let rels = load_relations(&p).await.unwrap();
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].issue_id, "1");
        assert_eq!(rels[0].related_id, "2");
    }
}
