//! Deterministic fact assembly for the report generators. All rows come from
//! the local SQLite cache — no network. The rendered "fact sheet" is both the
//! LLM's source material and the offline fallback output, so it must read as a
//! usable standup on its own.
//!
//! All window math (Dhaka calendar, workday gaps, week start) happens in the
//! frontend; this module only receives ready-made UTC instants and labels.

use sqlx::SqlitePool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportKind {
    Daily,
    Weekly,
}

/// Frontend-computed report window (see `src/lib/reportWindow.ts`).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowArgs {
    pub kind: ReportKind,
    /// UTC instant lower bound of the window (ISO 8601, `Z`).
    pub since: String,
    /// Human label for the window start, e.g. "Thursday" or "Sunday".
    pub since_label: String,
    /// Today's Dhaka calendar date, YYYY-MM-DD.
    pub today: String,
    /// Header date, e.g. "Saturday, July 26".
    pub title_date: String,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct FactIssue {
    pub identifier: String,
    pub title: String,
    pub state_name: Option<String>,
    pub project_name: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlockedIssue {
    pub issue: FactIssue,
    /// "AST-8 (Fix auth)" per blocker, unfinished blockers only.
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct FactPr {
    pub repo: String,
    pub number: i64,
    pub title: Option<String>,
    pub draft: Option<bool>,
    pub ci_status: Option<String>,
    pub review_decision: Option<String>,
}

#[derive(Debug)]
pub struct ReportFacts {
    pub window: WindowArgs,
    pub viewer_name: String,
    /// Completed inside the window (daily: since last workday; weekly: this week).
    pub completed: Vec<FactIssue>,
    pub in_progress: Vec<FactIssue>,
    pub blocked: Vec<BlockedIssue>,
    /// Daily only: due today and not finished.
    pub due_today: Vec<FactIssue>,
    /// Weekly only: created inside the window.
    pub new_this_week: Vec<FactIssue>,
    pub merged_prs: Vec<FactPr>,
    pub open_prs: Vec<FactPr>,
}

const ISSUE_COLS: &str = "identifier, title, state_name, project_name, due_date";
/// urgent(1) first, none(0) last — same rank the agenda uses.
const PRIO_ORDER: &str = "CASE priority WHEN 0 THEN 5 ELSE priority END, identifier";

pub async fn assemble(
    pool: &SqlitePool,
    viewer_id: &str,
    viewer_name: &str,
    window: WindowArgs,
) -> Result<ReportFacts, sqlx::Error> {
    // `completed_at` is NULL for rows cached before migration 0015; fall back
    // to updated_at (a completed issue's last touch is usually its completion).
    let completed: Vec<FactIssue> = sqlx::query_as(&format!(
        "SELECT {ISSUE_COLS} FROM issues
         WHERE assignee_id = ?1 AND archived_at IS NULL AND state_type = 'completed'
           AND COALESCE(completed_at, updated_at) >= ?2
         ORDER BY COALESCE(completed_at, updated_at)"
    ))
    .bind(viewer_id)
    .bind(&window.since)
    .fetch_all(pool)
    .await?;

    let in_progress: Vec<FactIssue> = sqlx::query_as(&format!(
        "SELECT {ISSUE_COLS} FROM issues
         WHERE assignee_id = ?1 AND archived_at IS NULL AND state_type = 'started'
         ORDER BY {PRIO_ORDER}"
    ))
    .bind(viewer_id)
    .fetch_all(pool)
    .await?;

    let blocked = blocked_issues(pool, viewer_id).await?;

    let due_today: Vec<FactIssue> = match window.kind {
        ReportKind::Daily => {
            sqlx::query_as(&format!(
                "SELECT {ISSUE_COLS} FROM issues
                 WHERE assignee_id = ?1 AND archived_at IS NULL AND due_date = ?2
                   AND state_type NOT IN ('completed','canceled')
                 ORDER BY {PRIO_ORDER}"
            ))
            .bind(viewer_id)
            .bind(&window.today)
            .fetch_all(pool)
            .await?
        }
        ReportKind::Weekly => Vec::new(),
    };

    let new_this_week: Vec<FactIssue> = match window.kind {
        ReportKind::Weekly => {
            sqlx::query_as(&format!(
                "SELECT {ISSUE_COLS} FROM issues
                 WHERE assignee_id = ?1 AND archived_at IS NULL AND created_at >= ?2
                 ORDER BY created_at"
            ))
            .bind(viewer_id)
            .bind(&window.since)
            .fetch_all(pool)
            .await?
        }
        ReportKind::Daily => Vec::new(),
    };

    const PR_COLS: &str = "repo, number, title, draft, ci_status, review_decision";
    let merged_prs: Vec<FactPr> = sqlx::query_as(&format!(
        "SELECT {PR_COLS} FROM github_prs
         WHERE bucket = 'merged' AND merged_at >= ?1
         ORDER BY merged_at"
    ))
    .bind(&window.since)
    .fetch_all(pool)
    .await?;

    let open_prs: Vec<FactPr> = sqlx::query_as(&format!(
        "SELECT {PR_COLS} FROM github_prs WHERE bucket = 'mine' ORDER BY updated_at DESC"
    ))
    .fetch_all(pool)
    .await?;

    Ok(ReportFacts {
        window,
        viewer_name: viewer_name.to_string(),
        completed,
        in_progress,
        blocked,
        due_today,
        new_this_week,
        merged_prs,
        open_prs,
    })
}

/// The viewer's unfinished issues that have at least one unfinished blocker
/// (the relations cache stores both directions, so `blocked_by` rows exist).
async fn blocked_issues(
    pool: &SqlitePool,
    viewer_id: &str,
) -> Result<Vec<BlockedIssue>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct Row {
        identifier: String,
        title: String,
        state_name: Option<String>,
        project_name: Option<String>,
        due_date: Option<String>,
        related_identifier: Option<String>,
        related_title: Option<String>,
    }
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT i.identifier, i.title, i.state_name, i.project_name, i.due_date,
                r.related_identifier, r.related_title
         FROM issues i JOIN relations r ON r.issue_id = i.id
         WHERE i.assignee_id = ?1 AND i.archived_at IS NULL
           AND i.state_type NOT IN ('completed','canceled')
           AND r.type = 'blocked_by'
           AND COALESCE(r.related_state_type, '') NOT IN ('completed','canceled')
         ORDER BY i.identifier, r.related_identifier",
    )
    .bind(viewer_id)
    .fetch_all(pool)
    .await?;

    let mut out: Vec<BlockedIssue> = Vec::new();
    for r in rows {
        let blocker = match (&r.related_identifier, &r.related_title) {
            (Some(id), Some(t)) => format!("{id} ({t})"),
            (Some(id), None) => id.clone(),
            _ => "unknown issue".to_string(),
        };
        match out
            .last_mut()
            .filter(|b| b.issue.identifier == r.identifier)
        {
            Some(b) => b.blockers.push(blocker),
            None => out.push(BlockedIssue {
                issue: FactIssue {
                    identifier: r.identifier,
                    title: r.title,
                    state_name: r.state_name,
                    project_name: r.project_name,
                    due_date: r.due_date,
                },
                blockers: vec![blocker],
            }),
        }
    }
    Ok(out)
}

// ---- Rendering ----

fn issue_line(i: &FactIssue) -> String {
    let mut s = format!("- {} — {}", i.identifier, i.title);
    if let Some(p) = &i.project_name {
        s.push_str(&format!(" [{p}]"));
    }
    s
}

fn pr_line(p: &FactPr, merged: bool) -> String {
    let title = p.title.as_deref().unwrap_or("(untitled)");
    let mut s = format!("- {}#{} — {}", p.repo, p.number, title);
    if merged {
        return s;
    }
    let mut notes: Vec<&str> = Vec::new();
    if p.draft == Some(true) {
        notes.push("draft");
    }
    match p.ci_status.as_deref() {
        Some("failure") => notes.push("CI failing"),
        Some("pending") => notes.push("CI running"),
        _ => {}
    }
    match p.review_decision.as_deref() {
        Some("approved") => notes.push("approved"),
        Some("changes_requested") => notes.push("changes requested"),
        Some("review_required") => notes.push("awaiting review"),
        _ => {}
    }
    if !notes.is_empty() {
        s.push_str(&format!(" ({})", notes.join(", ")));
    }
    s
}

fn section(out: &mut String, heading: &str, lines: Vec<String>) {
    out.push_str(&format!("\n## {heading}\n"));
    if lines.is_empty() {
        out.push_str("- Nothing to report.\n");
    } else {
        for l in lines {
            out.push_str(&l);
            out.push('\n');
        }
    }
}

/// Deterministic markdown fact sheet — the offline fallback output and the
/// LLM's only source of truth.
pub fn render_fact_sheet(f: &ReportFacts) -> String {
    let w = &f.window;
    let mut out = match w.kind {
        ReportKind::Daily => format!(
            "# Daily scrum — {}\n_Covering work since {} · {}_\n",
            w.title_date, w.since_label, f.viewer_name
        ),
        ReportKind::Weekly => format!(
            "# Weekly review — {}\n_Week starting {} · {}_\n",
            w.title_date, w.since_label, f.viewer_name
        ),
    };

    let completed_heading = match w.kind {
        ReportKind::Daily => format!("Done since {}", w.since_label),
        ReportKind::Weekly => "Completed this week".to_string(),
    };
    let mut completed: Vec<String> = f.completed.iter().map(issue_line).collect();
    completed.extend(f.merged_prs.iter().map(|p| pr_line(p, true)));
    section(&mut out, &completed_heading, completed);

    section(
        &mut out,
        "In progress",
        f.in_progress.iter().map(issue_line).collect(),
    );

    if w.kind == ReportKind::Daily {
        section(
            &mut out,
            "Due today",
            f.due_today.iter().map(issue_line).collect(),
        );
    }
    if w.kind == ReportKind::Weekly {
        section(
            &mut out,
            "New this week",
            f.new_this_week.iter().map(issue_line).collect(),
        );
    }

    section(
        &mut out,
        "Blocked",
        f.blocked
            .iter()
            .map(|b| {
                format!(
                    "{} — blocked by {}",
                    issue_line(&b.issue),
                    b.blockers.join(", ")
                )
            })
            .collect(),
    );

    if !f.open_prs.is_empty() {
        section(
            &mut out,
            "Open PRs",
            f.open_prs.iter().map(|p| pr_line(p, false)).collect(),
        );
    }
    out
}

/// (system, user) messages for the LLM. The model only rewrites the facts into
/// prose — bucketing already happened here, which keeps small local models honest.
pub fn build_prompt(f: &ReportFacts, fact_sheet: &str) -> (String, String) {
    let system = match f.window.kind {
        ReportKind::Daily => format!(
            "You write a software engineer's daily scrum update. Write in first person as {name}. \
             Use ONLY the facts provided — never invent tasks, issues, numbers, or details. \
             Output plain Markdown with exactly three sections: '**Since {label}**', '**Today**', '**Blockers**'. \
             Short bullet points; keep issue ids (like AST-12) and PR references. \
             If a section has nothing, write '- Nothing to report.' \
             No preamble, no sign-off, no commentary.",
            name = f.viewer_name,
            label = f.window.since_label,
        ),
        ReportKind::Weekly => format!(
            "You write a software engineer's weekly review. Write in first person as {name}. \
             Use ONLY the facts provided — never invent tasks, issues, numbers, or details. \
             Output plain Markdown with exactly four sections: '**Completed**', '**In progress**', '**New this week**', '**Blockers**'. \
             Short bullet points; keep issue ids (like AST-12) and PR references. \
             Fold merged PRs into '**Completed**'. If a section has nothing, write '- Nothing to report.' \
             No preamble, no sign-off, no commentary.",
            name = f.viewer_name,
        ),
    };
    (system, format!("Facts:\n\n{fact_sheet}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::issues::{upsert_issue, IssueRecord, RelationRecord};

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn rec(id: &str, state_type: &str) -> IssueRecord {
        IssueRecord {
            id: id.into(),
            identifier: format!("AST-{id}"),
            title: format!("Task {id}"),
            description: None,
            due_date: None,
            started_at: None,
            completed_at: None,
            priority: 0,
            url: "u".into(),
            state_id: None,
            state_name: Some(state_type.into()),
            state_type: Some(state_type.into()),
            state_color: None,
            assignee_id: Some("me".into()),
            assignee_name: Some("Abrar".into()),
            team_id: None,
            team_key: None,
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
            created_at: "2026-07-01T00:00:00.000Z".into(),
            updated_at: "2026-07-01T00:00:00.000Z".into(),
            archived_at: None,
            raw_json: "{}".into(),
        }
    }

    async fn insert(pool: &SqlitePool, r: &IssueRecord) {
        let mut tx = pool.begin().await.unwrap();
        upsert_issue(&mut tx, r).await.unwrap();
        tx.commit().await.unwrap();
    }

    async fn insert_relation(pool: &SqlitePool, issue_id: &str, r: &RelationRecord) {
        let mut tx = pool.begin().await.unwrap();
        crate::db::issues::replace_relations(&mut tx, issue_id, std::slice::from_ref(r))
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }

    fn daily_window() -> WindowArgs {
        WindowArgs {
            kind: ReportKind::Daily,
            since: "2026-07-23T18:00:00.000Z".into(), // Jul 24 00:00 Dhaka
            since_label: "Thursday".into(),
            today: "2026-07-26".into(),
            title_date: "Sunday, July 26".into(),
        }
    }

    #[tokio::test]
    async fn buckets_respect_assignee_window_and_state() {
        let (_d, pool) = pool().await;

        // Completed inside the window via completed_at.
        let mut done = rec("1", "completed");
        done.completed_at = Some("2026-07-24T09:00:00.000Z".into());
        insert(&pool, &done).await;
        // Completed but BEFORE the window — excluded.
        let mut old = rec("2", "completed");
        old.completed_at = Some("2026-07-20T09:00:00.000Z".into());
        insert(&pool, &old).await;
        // NULL completed_at falls back to updated_at (inside window).
        let mut legacy = rec("3", "completed");
        legacy.updated_at = "2026-07-25T01:00:00.000Z".into();
        insert(&pool, &legacy).await;
        // Someone else's — excluded.
        let mut other = rec("4", "completed");
        other.assignee_id = Some("them".into());
        other.completed_at = Some("2026-07-24T09:00:00.000Z".into());
        insert(&pool, &other).await;
        // In progress + due today.
        let mut wip = rec("5", "started");
        wip.due_date = Some("2026-07-26".into());
        insert(&pool, &wip).await;

        let f = assemble(&pool, "me", "Abrar", daily_window())
            .await
            .unwrap();
        let ids: Vec<&str> = f.completed.iter().map(|i| i.identifier.as_str()).collect();
        assert_eq!(ids, vec!["AST-1", "AST-3"]);
        assert_eq!(f.in_progress.len(), 1);
        assert_eq!(f.due_today[0].identifier, "AST-5");
        assert!(f.blocked.is_empty());
    }

    #[tokio::test]
    async fn blocked_lists_only_unfinished_blockers() {
        let (_d, pool) = pool().await;
        insert(&pool, &rec("1", "started")).await;
        // Blocked by an unfinished issue → counts.
        insert_relation(
            &pool,
            "1",
            &RelationRecord {
                related_issue_id: "9".into(),
                r#type: "blocked_by".into(),
                related_identifier: Some("AST-9".into()),
                related_title: Some("Auth fix".into()),
                related_state_name: Some("In Progress".into()),
                related_state_type: Some("started".into()),
                related_state_color: None,
            },
        )
        .await;
        // Blocked by a DONE issue → not blocked.
        insert(&pool, &rec("2", "started")).await;
        insert_relation(
            &pool,
            "2",
            &RelationRecord {
                related_issue_id: "8".into(),
                r#type: "blocked_by".into(),
                related_identifier: Some("AST-8".into()),
                related_title: None,
                related_state_name: None,
                related_state_type: Some("completed".into()),
                related_state_color: None,
            },
        )
        .await;

        let f = assemble(&pool, "me", "Abrar", daily_window())
            .await
            .unwrap();
        assert_eq!(f.blocked.len(), 1);
        assert_eq!(f.blocked[0].issue.identifier, "AST-1");
        assert_eq!(f.blocked[0].blockers, vec!["AST-9 (Auth fix)"]);
    }

    #[tokio::test]
    async fn weekly_includes_new_issues_and_skips_due_today() {
        let (_d, pool) = pool().await;
        let mut fresh = rec("1", "unstarted");
        fresh.created_at = "2026-07-24T05:00:00.000Z".into();
        insert(&pool, &fresh).await;

        let mut w = daily_window();
        w.kind = ReportKind::Weekly;
        let f = assemble(&pool, "me", "Abrar", w).await.unwrap();
        assert_eq!(f.new_this_week[0].identifier, "AST-1");
        assert!(f.due_today.is_empty());
    }

    #[tokio::test]
    async fn prs_come_from_merged_and_mine_buckets() {
        let (_d, pool) = pool().await;
        for (id, bucket, merged_at) in [
            ("o/r#1", "merged", Some("2026-07-24T10:00:00Z")),
            ("o/r#2", "merged", Some("2026-07-01T10:00:00Z")), // before window
            ("o/r#3", "mine", None),
        ] {
            sqlx::query(
                "INSERT INTO github_prs (id, bucket, repo, number, title, draft, ci_status,
                   review_decision, updated_at, synced_at, merged_at)
                 VALUES (?1, ?2, 'o/r', ?3, 'PR', 0, 'success', 'approved', 't', 't', ?4)",
            )
            .bind(id)
            .bind(bucket)
            .bind(id.rsplit('#').next().unwrap().parse::<i64>().unwrap())
            .bind(merged_at)
            .execute(&pool)
            .await
            .unwrap();
        }
        let f = assemble(&pool, "me", "Abrar", daily_window())
            .await
            .unwrap();
        assert_eq!(f.merged_prs.len(), 1);
        assert_eq!(f.merged_prs[0].number, 1);
        assert_eq!(f.open_prs.len(), 1);
        assert_eq!(f.open_prs[0].review_decision.as_deref(), Some("approved"));
    }

    #[tokio::test]
    async fn fact_sheet_renders_all_sections() {
        let (_d, pool) = pool().await;
        let mut done = rec("1", "completed");
        done.completed_at = Some("2026-07-24T09:00:00.000Z".into());
        done.project_name = Some("Astryn".into());
        insert(&pool, &done).await;

        let f = assemble(&pool, "me", "Abrar", daily_window())
            .await
            .unwrap();
        let sheet = render_fact_sheet(&f);
        assert!(sheet.starts_with("# Daily scrum — Sunday, July 26"));
        assert!(sheet.contains("## Done since Thursday"));
        assert!(sheet.contains("- AST-1 — Task 1 [Astryn]"));
        assert!(sheet.contains("## In progress\n- Nothing to report."));
        assert!(sheet.contains("## Due today"));
        assert!(sheet.contains("## Blocked"));
        assert!(!sheet.contains("## Open PRs")); // omitted when empty

        let (system, user) = build_prompt(&f, &sheet);
        assert!(system.contains("as Abrar"));
        assert!(system.contains("Since Thursday"));
        assert!(user.contains("AST-1"));
    }
}
