//! All local-task SQL. Rows are shaped like the tracker-neutral task model
//! (the cached Linear issue shape) plus a few local-only fields.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};

use super::{new_id, now, valid_date, LtError};
use crate::db::issues::{FilterOptions, ProjectOption, RelationItem, TeamOption};
use crate::linear::issues::double_option;

/// The local viewer: tasks "assigned to me" carry this assignee id.
pub const ME: &str = "lt_me";
pub const CATEGORIES: [&str; 5] = ["backlog", "unstarted", "started", "completed", "canceled"];

/// Every new space starts with this workflow.
const DEFAULT_WORKFLOW: [(&str, &str, &str); 5] = [
    ("Backlog", "backlog", "#8b8d98"),
    ("To do", "unstarted", "#a3a6b4"),
    ("In progress", "started", "#d99a2b"),
    ("Done", "completed", "#4b9e6a"),
    ("Canceled", "canceled", "#8b8d98"),
];

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct List {
    pub id: String,
    pub space_id: String,
    pub name: String,
    pub key: String,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    /// The space or list whose workflow this status belongs to.
    pub scope_id: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Sprint {
    pub id: String,
    pub space_id: String,
    pub number: i64,
    pub name: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tree {
    pub spaces: Vec<Space>,
    pub lists: Vec<List>,
    pub statuses: Vec<Status>,
    pub sprints: Vec<Sprint>,
    pub labels: Vec<Label>,
}

/// A task in the tracker-neutral row shape (team = list, project = space,
/// cycle = sprint) plus local-only fields.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub started_at: Option<String>,
    pub priority: i64,
    pub url: String,
    pub state_id: Option<String>,
    pub state_name: Option<String>,
    pub state_type: String,
    pub state_color: String,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub parent_id: Option<String>,
    pub estimate: Option<f64>,
    pub cycle_name: Option<String>,
    pub cycle_number: Option<i64>,
    pub milestone_name: Option<String>,
    pub link_count: i64,
    pub pr_count: i64,
    pub attachments_truncated: bool,
    pub created_at: String,
    pub updated_at: String,
    pub start_date: Option<String>,
    pub space_id: String,
    pub sprint_id: Option<String>,
    pub position: f64,
    pub list_name: String,
    pub checklist_done: i64,
    pub checklist_total: i64,
    #[sqlx(skip)]
    pub labels: Vec<Label>,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub task_id: String,
    pub body: String,
    pub done: bool,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub url: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    pub id: String,
    pub identifier: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(flatten)]
    pub task: TaskRow,
    /// The effective workflow of the task's list.
    pub statuses: Vec<Status>,
    pub subtasks: Vec<TaskRow>,
    pub checklist: Vec<ChecklistItem>,
    pub relations: Vec<RelationItem>,
    pub comments: Vec<Comment>,
    pub attachments: Vec<Attachment>,
    pub parent: Option<TaskRef>,
}

/// A status in the neutral workflow-state shape (`teamId` = the list it applies to).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeutralStatus {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub color: String,
    pub team_id: String,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    /// List id.
    pub team_id: Option<String>,
    /// Only `ME` matches anything.
    pub assignee_id: Option<String>,
    /// Space id.
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusInput {
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub color: String,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub list_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub assigned_to_me: Option<bool>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub estimate: Option<f64>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub sprint_id: Option<String>,
    #[serde(default)]
    pub label_ids: Vec<String>,
}

/// A neutral task patch (team = list, state = status, cycle = sprint) plus
/// local-only fields. Omitted => unchanged; `null` => cleared.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub state_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub assignee_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub label_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub estimate: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub cycle_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub parent_id: Option<Option<String>>,
    #[serde(default)]
    pub position: Option<f64>,
}

// ── Tree: spaces, lists, workflows, sprints, labels ──────────────────────────

/// Create the default space + list on first use, so the screen is never empty.
pub async fn ensure_seeded(pool: &SqlitePool) -> Result<(), LtError> {
    let mut tx = pool.begin().await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lt_spaces")
        .fetch_one(&mut *tx)
        .await?;
    if count == 0 {
        let space = insert_space(&mut tx, "Personal").await?;
        insert_list(&mut tx, &space.id, "Tasks", "TASK").await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn load_tree(pool: &SqlitePool) -> Result<Tree, LtError> {
    Ok(Tree {
        spaces: sqlx::query_as("SELECT id, name, position FROM lt_spaces ORDER BY position, created_at")
            .fetch_all(pool)
            .await?,
        lists: sqlx::query_as(
            "SELECT id, space_id, name, key, position FROM lt_lists ORDER BY position, created_at",
        )
        .fetch_all(pool)
        .await?,
        statuses: sqlx::query_as(
            "SELECT id, scope_id, name, category, color, position FROM lt_statuses ORDER BY scope_id, position",
        )
        .fetch_all(pool)
        .await?,
        sprints: sqlx::query_as(
            "SELECT id, space_id, number, name, start_date, end_date FROM lt_sprints ORDER BY space_id, number",
        )
        .fetch_all(pool)
        .await?,
        labels: sqlx::query_as("SELECT id, name, color FROM lt_labels ORDER BY name COLLATE NOCASE")
            .fetch_all(pool)
            .await?,
    })
}

fn clean_name(name: &str) -> Result<String, LtError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(LtError::Invalid);
    }
    Ok(name.to_string())
}

/// List keys are 1-6 characters, A-Z then A-Z/0-9.
pub fn clean_key(key: &str) -> Result<String, LtError> {
    let key = key.trim().to_ascii_uppercase();
    let mut chars = key.chars();
    let ok = matches!(chars.next(), Some(c) if c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && key.len() <= 6;
    if ok {
        Ok(key)
    } else {
        Err(LtError::Invalid)
    }
}

fn clean_color(color: &str) -> Result<String, LtError> {
    let c = color.trim();
    let hex = c.strip_prefix('#').unwrap_or("");
    if (hex.len() == 6 || hex.len() == 3) && hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Ok(c.to_string())
    } else {
        Err(LtError::Invalid)
    }
}

async fn insert_space(conn: &mut SqliteConnection, name: &str) -> Result<Space, LtError> {
    let name = clean_name(name)?;
    let id = new_id();
    let ts = now();
    let position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position) + 1, 0) FROM lt_spaces")
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query("INSERT INTO lt_spaces (id, name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
        .bind(&id)
        .bind(&name)
        .bind(position)
        .bind(&ts)
        .execute(&mut *conn)
        .await?;
    for (i, (status, category, color)) in DEFAULT_WORKFLOW.iter().enumerate() {
        sqlx::query(
            "INSERT INTO lt_statuses (id, scope_id, name, category, color, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(new_id())
        .bind(&id)
        .bind(status)
        .bind(category)
        .bind(color)
        .bind(i as i64)
        .execute(&mut *conn)
        .await?;
    }
    Ok(Space { id, name, position })
}

async fn insert_list(
    conn: &mut SqliteConnection,
    space_id: &str,
    name: &str,
    key: &str,
) -> Result<List, LtError> {
    let name = clean_name(name)?;
    let key = clean_key(key)?;
    let space: Option<String> = sqlx::query_scalar("SELECT id FROM lt_spaces WHERE id = ?1")
        .bind(space_id)
        .fetch_optional(&mut *conn)
        .await?;
    if space.is_none() {
        return Err(LtError::NotFound);
    }
    let taken: Option<String> = sqlx::query_scalar("SELECT id FROM lt_lists WHERE key = ?1")
        .bind(&key)
        .fetch_optional(&mut *conn)
        .await?;
    if taken.is_some() {
        return Err(LtError::DuplicateKey);
    }
    let id = new_id();
    let ts = now();
    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM lt_lists WHERE space_id = ?1",
    )
    .bind(space_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO lt_lists (id, space_id, name, key, next_number, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
    )
    .bind(&id)
    .bind(space_id)
    .bind(&name)
    .bind(&key)
    .bind(position)
    .bind(&ts)
    .execute(&mut *conn)
    .await?;
    Ok(List {
        id,
        space_id: space_id.to_string(),
        name,
        key,
        position,
    })
}

pub async fn create_space(pool: &SqlitePool, name: &str) -> Result<Space, LtError> {
    let mut tx = pool.begin().await?;
    let space = insert_space(&mut tx, name).await?;
    tx.commit().await?;
    Ok(space)
}

pub async fn rename_space(pool: &SqlitePool, id: &str, name: &str) -> Result<(), LtError> {
    let name = clean_name(name)?;
    let done = sqlx::query("UPDATE lt_spaces SET name = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id)
        .bind(name)
        .bind(now())
        .execute(pool)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(())
}

/// Delete a space with its lists, sprints, workflows and tasks.
pub async fn delete_space(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "DELETE FROM lt_statuses WHERE scope_id = ?1
            OR scope_id IN (SELECT id FROM lt_lists WHERE space_id = ?1)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let done = sqlx::query("DELETE FROM lt_spaces WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    prune_orphans(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn create_list(
    pool: &SqlitePool,
    space_id: &str,
    name: &str,
    key: &str,
) -> Result<List, LtError> {
    let mut tx = pool.begin().await?;
    let list = insert_list(&mut tx, space_id, name, key).await?;
    tx.commit().await?;
    Ok(list)
}

pub async fn update_list(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    key: Option<&str>,
) -> Result<List, LtError> {
    let mut tx = pool.begin().await?;
    let mut list: List =
        sqlx::query_as("SELECT id, space_id, name, key, position FROM lt_lists WHERE id = ?1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(LtError::NotFound)?;
    if let Some(name) = name {
        list.name = clean_name(name)?;
    }
    if let Some(key) = key {
        let key = clean_key(key)?;
        let taken: Option<String> =
            sqlx::query_scalar("SELECT id FROM lt_lists WHERE key = ?1 AND id <> ?2")
                .bind(&key)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        if taken.is_some() {
            return Err(LtError::DuplicateKey);
        }
        list.key = key;
    }
    sqlx::query("UPDATE lt_lists SET name = ?2, key = ?3, updated_at = ?4 WHERE id = ?1")
        .bind(id)
        .bind(&list.name)
        .bind(&list.key)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(list)
}

pub async fn delete_list(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM lt_statuses WHERE scope_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let done = sqlx::query("DELETE FROM lt_lists WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    prune_orphans(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Drop rows that pointed at deleted tasks/sprints (not foreign keys by design).
async fn prune_orphans(conn: &mut SqliteConnection) -> Result<(), LtError> {
    sqlx::query("DELETE FROM lt_imports WHERE task_id NOT IN (SELECT id FROM lt_tasks)")
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE lt_tasks SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM lt_tasks)")
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE lt_tasks SET sprint_id = NULL WHERE sprint_id IS NOT NULL AND sprint_id NOT IN (SELECT id FROM lt_sprints)")
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// The statuses a list uses: its own override, else its space's workflow.
async fn effective_statuses(
    conn: &mut SqliteConnection,
    list_id: &str,
) -> Result<Vec<Status>, LtError> {
    let own: Vec<Status> = sqlx::query_as(
        "SELECT id, scope_id, name, category, color, position FROM lt_statuses WHERE scope_id = ?1 ORDER BY position",
    )
    .bind(list_id)
    .fetch_all(&mut *conn)
    .await?;
    if !own.is_empty() {
        return Ok(own);
    }
    Ok(sqlx::query_as(
        "SELECT s.id, s.scope_id, s.name, s.category, s.color, s.position
         FROM lt_statuses s JOIN lt_lists l ON l.space_id = s.scope_id
         WHERE l.id = ?1 ORDER BY s.position",
    )
    .bind(list_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Default status for a new task: the first "unstarted" one, else the first.
fn default_status(statuses: &[Status]) -> Option<&Status> {
    statuses
        .iter()
        .find(|s| s.category == "unstarted")
        .or_else(|| statuses.first())
}

/// Every list's effective workflow, in the neutral workflow-state shape.
pub async fn neutral_statuses(pool: &SqlitePool) -> Result<Vec<NeutralStatus>, LtError> {
    let mut conn = pool.acquire().await?;
    let lists: Vec<String> = sqlx::query_scalar("SELECT id FROM lt_lists ORDER BY position")
        .fetch_all(&mut *conn)
        .await?;
    let mut out = Vec::new();
    for list in lists {
        for s in effective_statuses(&mut conn, &list).await? {
            out.push(NeutralStatus {
                id: s.id,
                name: s.name,
                r#type: s.category,
                color: s.color,
                team_id: list.clone(),
            });
        }
    }
    Ok(out)
}

/// Replace a space's workflow, or a list's override (an empty list clears the
/// override). Tasks whose status disappeared move to the status that replaced
/// it, else the first status of the same category, else the first status.
pub async fn set_statuses(
    pool: &SqlitePool,
    scope_id: &str,
    inputs: Vec<StatusInput>,
) -> Result<Vec<Status>, LtError> {
    let mut tx = pool.begin().await?;
    let is_space: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lt_spaces WHERE id = ?1)")
        .bind(scope_id)
        .fetch_one(&mut *tx)
        .await?;
    let is_list: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lt_lists WHERE id = ?1)")
        .bind(scope_id)
        .fetch_one(&mut *tx)
        .await?;
    if !is_space && !is_list {
        return Err(LtError::NotFound);
    }
    if is_space && inputs.is_empty() {
        return Err(LtError::Invalid);
    }
    let mut cleaned = Vec::with_capacity(inputs.len());
    for s in &inputs {
        if !CATEGORIES.contains(&s.category.as_str()) {
            return Err(LtError::Invalid);
        }
        cleaned.push((
            s.id.clone(),
            clean_name(&s.name)?,
            s.category.clone(),
            clean_color(&s.color)?,
        ));
    }

    let old: Vec<Status> =
        sqlx::query_as("SELECT id, scope_id, name, category, color, position FROM lt_statuses")
            .fetch_all(&mut *tx)
            .await?;
    let old_category: HashMap<String, String> = old
        .iter()
        .map(|s| (s.id.clone(), s.category.clone()))
        .collect();
    let in_scope: HashSet<String> = old
        .iter()
        .filter(|s| s.scope_id == scope_id)
        .map(|s| s.id.clone())
        .collect();

    let mut kept: HashSet<String> = HashSet::new();
    let mut replaced: HashMap<String, String> = HashMap::new();
    for (position, (id, name, category, color)) in cleaned.into_iter().enumerate() {
        match id.filter(|id| in_scope.contains(id)) {
            Some(id) => {
                sqlx::query("UPDATE lt_statuses SET name = ?2, category = ?3, color = ?4, position = ?5 WHERE id = ?1")
                    .bind(&id)
                    .bind(&name)
                    .bind(&category)
                    .bind(&color)
                    .bind(position as i64)
                    .execute(&mut *tx)
                    .await?;
                kept.insert(id);
            }
            None => {
                let new = new_id();
                sqlx::query(
                    "INSERT INTO lt_statuses (id, scope_id, name, category, color, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .bind(&new)
                .bind(scope_id)
                .bind(&name)
                .bind(&category)
                .bind(&color)
                .bind(position as i64)
                .execute(&mut *tx)
                .await?;
                // An id from another workflow (e.g. copying the space's) maps onto its copy.
                if let Some(source) = inputs.get(position).and_then(|s| s.id.clone()) {
                    replaced.insert(source, new.clone());
                }
                kept.insert(new);
            }
        }
    }
    for id in in_scope.difference(&kept) {
        sqlx::query("DELETE FROM lt_statuses WHERE id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    let affected: Vec<String> = if is_space {
        sqlx::query_scalar(
            "SELECT id FROM lt_lists l WHERE space_id = ?1
               AND NOT EXISTS (SELECT 1 FROM lt_statuses s WHERE s.scope_id = l.id)",
        )
        .bind(scope_id)
        .fetch_all(&mut *tx)
        .await?
    } else {
        vec![scope_id.to_string()]
    };
    for list in affected {
        let eff = effective_statuses(&mut tx, &list).await?;
        let tasks: Vec<(String, String)> =
            sqlx::query_as("SELECT id, status_id FROM lt_tasks WHERE list_id = ?1")
                .bind(&list)
                .fetch_all(&mut *tx)
                .await?;
        for (task, status) in tasks {
            if eff.iter().any(|s| s.id == status) {
                continue;
            }
            let target = replaced
                .get(&status)
                .and_then(|n| eff.iter().find(|s| &s.id == n))
                .or_else(|| {
                    let cat = old_category.get(&status)?;
                    eff.iter().find(|s| &s.category == cat)
                })
                .or_else(|| eff.first());
            if let Some(target) = target {
                sqlx::query("UPDATE lt_tasks SET status_id = ?2 WHERE id = ?1")
                    .bind(&task)
                    .bind(&target.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }

    let result = if is_list && inputs.is_empty() {
        effective_statuses(&mut tx, scope_id).await?
    } else {
        sqlx::query_as(
            "SELECT id, scope_id, name, category, color, position FROM lt_statuses WHERE scope_id = ?1 ORDER BY position",
        )
        .bind(scope_id)
        .fetch_all(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(result)
}

fn check_dates(start: Option<&str>, end: Option<&str>) -> Result<(), LtError> {
    for d in [start, end].into_iter().flatten() {
        if !valid_date(d) {
            return Err(LtError::Invalid);
        }
    }
    Ok(())
}

pub async fn create_sprint(
    pool: &SqlitePool,
    space_id: &str,
    name: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Sprint, LtError> {
    let name = clean_name(name)?;
    check_dates(start_date, end_date)?;
    let mut tx = pool.begin().await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lt_spaces WHERE id = ?1)")
        .bind(space_id)
        .fetch_one(&mut *tx)
        .await?;
    if !exists {
        return Err(LtError::NotFound);
    }
    let number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM lt_sprints WHERE space_id = ?1",
    )
    .bind(space_id)
    .fetch_one(&mut *tx)
    .await?;
    let id = new_id();
    sqlx::query(
        "INSERT INTO lt_sprints (id, space_id, number, name, start_date, end_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&id)
    .bind(space_id)
    .bind(number)
    .bind(&name)
    .bind(start_date)
    .bind(end_date)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Sprint {
        id,
        space_id: space_id.to_string(),
        number,
        name,
        start_date: start_date.map(str::to_string),
        end_date: end_date.map(str::to_string),
    })
}

pub async fn update_sprint(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<(), LtError> {
    let name = clean_name(name)?;
    check_dates(start_date, end_date)?;
    let done = sqlx::query(
        "UPDATE lt_sprints SET name = ?2, start_date = ?3, end_date = ?4 WHERE id = ?1",
    )
    .bind(id)
    .bind(name)
    .bind(start_date)
    .bind(end_date)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(())
}

pub async fn delete_sprint(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE lt_tasks SET sprint_id = NULL WHERE sprint_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let done = sqlx::query("DELETE FROM lt_sprints WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

/// Create a label, or return the existing one with the same name.
pub async fn create_label(pool: &SqlitePool, name: &str, color: &str) -> Result<Label, LtError> {
    let mut conn = pool.acquire().await?;
    create_label_in(&mut conn, name, color).await
}

pub(crate) async fn create_label_in(
    conn: &mut SqliteConnection,
    name: &str,
    color: &str,
) -> Result<Label, LtError> {
    let name = clean_name(name)?;
    let color = clean_color(color)?;
    if let Some(existing) = sqlx::query_as::<_, Label>(
        "SELECT id, name, color FROM lt_labels WHERE name = ?1 COLLATE NOCASE",
    )
    .bind(&name)
    .fetch_optional(&mut *conn)
    .await?
    {
        return Ok(existing);
    }
    let id = new_id();
    sqlx::query("INSERT INTO lt_labels (id, name, color) VALUES (?1, ?2, ?3)")
        .bind(&id)
        .bind(&name)
        .bind(&color)
        .execute(&mut *conn)
        .await?;
    Ok(Label { id, name, color })
}

pub async fn delete_label(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let done = sqlx::query("DELETE FROM lt_labels WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(())
}

// ── Tasks ────────────────────────────────────────────────────────────────────

const TASK_SELECT: &str = "SELECT t.id, l.key || '-' || t.number AS identifier, t.title, t.description,
    t.due_date, t.started_at, t.priority, '' AS url,
    t.status_id AS state_id, s.name AS state_name,
    COALESCE(s.category, 'unstarted') AS state_type, COALESCE(s.color, '') AS state_color,
    CASE WHEN t.assigned_to_me = 1 THEN 'lt_me' END AS assignee_id,
    CASE WHEN t.assigned_to_me = 1 THEN 'Me' END AS assignee_name,
    t.list_id AS team_id, l.key AS team_key, l.space_id AS project_id, sp.name AS project_name,
    t.parent_id, t.estimate, spr.name AS cycle_name, spr.number AS cycle_number,
    CAST(NULL AS TEXT) AS milestone_name,
    (SELECT COUNT(*) FROM lt_attachments a WHERE a.task_id = t.id) AS link_count,
    0 AS pr_count, 0 AS attachments_truncated, t.created_at, t.updated_at,
    t.start_date, l.space_id AS space_id, t.sprint_id, t.position, l.name AS list_name,
    (SELECT COUNT(*) FROM lt_checklist_items c WHERE c.task_id = t.id AND c.done = 1) AS checklist_done,
    (SELECT COUNT(*) FROM lt_checklist_items c WHERE c.task_id = t.id) AS checklist_total
  FROM lt_tasks t
  JOIN lt_lists l ON l.id = t.list_id
  JOIN lt_spaces sp ON sp.id = l.space_id
  LEFT JOIN lt_statuses s ON s.id = t.status_id
  LEFT JOIN lt_sprints spr ON spr.id = t.sprint_id";

/// `?1` list, `?2` assignee (only `lt_me` matches), `?3` space.
const FILTER: &str = "(?1 IS NULL OR t.list_id = ?1)
    AND (?2 IS NULL OR (?2 = 'lt_me' AND t.assigned_to_me = 1))
    AND (?3 IS NULL OR l.space_id = ?3)";

async fn attach_labels(
    conn: &mut SqliteConnection,
    mut rows: Vec<TaskRow>,
) -> Result<Vec<TaskRow>, LtError> {
    let pairs: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT tl.task_id, lb.id, lb.name, lb.color FROM lt_task_labels tl
         JOIN lt_labels lb ON lb.id = tl.label_id ORDER BY lb.name COLLATE NOCASE",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut by_task: HashMap<String, Vec<Label>> = HashMap::new();
    for (task, id, name, color) in pairs {
        by_task
            .entry(task)
            .or_default()
            .push(Label { id, name, color });
    }
    for row in &mut rows {
        row.labels = by_task.remove(&row.id).unwrap_or_default();
    }
    Ok(rows)
}

pub async fn list_tasks(pool: &SqlitePool, f: &Filters) -> Result<Vec<TaskRow>, LtError> {
    let mut conn = pool.acquire().await?;
    let rows: Vec<TaskRow> = sqlx::query_as(&format!(
        "{TASK_SELECT} WHERE {FILTER} ORDER BY t.position, t.created_at"
    ))
    .bind(&f.team_id)
    .bind(&f.assignee_id)
    .bind(&f.project_id)
    .fetch_all(&mut *conn)
    .await?;
    attach_labels(&mut conn, rows).await
}

/// Tasks due in `[start, end)`.
pub async fn list_calendar(
    pool: &SqlitePool,
    start: &str,
    end: &str,
    f: &Filters,
) -> Result<Vec<TaskRow>, LtError> {
    Ok(sqlx::query_as(&format!(
        "{TASK_SELECT} WHERE {FILTER} AND t.due_date >= ?4 AND t.due_date < ?5 ORDER BY t.due_date, identifier"
    ))
    .bind(&f.team_id)
    .bind(&f.assignee_id)
    .bind(&f.project_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?)
}

pub async fn list_unscheduled(pool: &SqlitePool, f: &Filters) -> Result<Vec<TaskRow>, LtError> {
    Ok(sqlx::query_as(&format!(
        "{TASK_SELECT} WHERE {FILTER} AND t.due_date IS NULL ORDER BY identifier"
    ))
    .bind(&f.team_id)
    .bind(&f.assignee_id)
    .bind(&f.project_id)
    .fetch_all(pool)
    .await?)
}

async fn load_task(conn: &mut SqliteConnection, id: &str) -> Result<TaskRow, LtError> {
    let row: Option<TaskRow> = sqlx::query_as(&format!("{TASK_SELECT} WHERE t.id = ?1"))
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
    let row = row.ok_or(LtError::NotFound)?;
    Ok(attach_labels(conn, vec![row]).await?.remove(0))
}

#[cfg(test)]
pub async fn get_task(pool: &SqlitePool, id: &str) -> Result<TaskRow, LtError> {
    let mut conn = pool.acquire().await?;
    load_task(&mut conn, id).await
}

pub async fn filter_options(pool: &SqlitePool) -> Result<FilterOptions, LtError> {
    Ok(FilterOptions {
        teams: sqlx::query_as::<_, TeamOption>("SELECT id, key FROM lt_lists ORDER BY key")
            .fetch_all(pool)
            .await?,
        projects: sqlx::query_as::<_, ProjectOption>(
            "SELECT id, name FROM lt_spaces ORDER BY position, name",
        )
        .fetch_all(pool)
        .await?,
    })
}

/// Both directions of every relation, in the neutral relation shape.
pub async fn relations(pool: &SqlitePool) -> Result<Vec<RelationItem>, LtError> {
    let mut conn = pool.acquire().await?;
    relations_where(&mut conn, None).await
}

async fn relations_where(
    conn: &mut SqliteConnection,
    task: Option<&str>,
) -> Result<Vec<RelationItem>, LtError> {
    Ok(sqlx::query_as(
        "WITH info AS (
            SELECT t.id, l.key || '-' || t.number AS ident, t.title, s.name AS sname,
                   s.category AS stype, s.color AS scolor
            FROM lt_tasks t JOIN lt_lists l ON l.id = t.list_id
            LEFT JOIN lt_statuses s ON s.id = t.status_id
         ), pairs AS (
            SELECT task_id AS issue_id, type, related_id FROM lt_relations
            UNION ALL
            SELECT related_id, CASE type WHEN 'blocks' THEN 'blocked_by' ELSE 'related' END, task_id
            FROM lt_relations
         )
         SELECT p.issue_id, p.type, p.related_id, i.ident AS related_identifier, i.title AS related_title,
                i.sname AS related_state_name, i.stype AS related_state_type, i.scolor AS related_state_color
         FROM pairs p JOIN info i ON i.id = p.related_id
         WHERE ?1 IS NULL OR p.issue_id = ?1
         ORDER BY p.issue_id, p.type, i.ident",
    )
    .bind(task)
    .fetch_all(&mut *conn)
    .await?)
}

pub async fn get_detail(pool: &SqlitePool, id: &str) -> Result<TaskDetail, LtError> {
    let mut conn = pool.acquire().await?;
    let task = load_task(&mut conn, id).await?;
    let list_id = task.team_id.clone().unwrap_or_default();
    let statuses = effective_statuses(&mut conn, &list_id).await?;
    let subtasks: Vec<TaskRow> = sqlx::query_as(&format!(
        "{TASK_SELECT} WHERE t.parent_id = ?1 ORDER BY t.position, t.created_at"
    ))
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let subtasks = attach_labels(&mut conn, subtasks).await?;
    let checklist = sqlx::query_as(
        "SELECT id, task_id, body, done, position FROM lt_checklist_items WHERE task_id = ?1 ORDER BY position",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let relations = relations_where(&mut conn, Some(id)).await?;
    let comments = sqlx::query_as(
        "SELECT id, task_id, body, created_at, updated_at FROM lt_comments WHERE task_id = ?1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let attachments = sqlx::query_as(
        "SELECT id, task_id, title, url, created_at FROM lt_attachments WHERE task_id = ?1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let parent = match &task.parent_id {
        Some(pid) => {
            sqlx::query_as(
                "SELECT t.id, l.key || '-' || t.number AS identifier, t.title
             FROM lt_tasks t JOIN lt_lists l ON l.id = t.list_id WHERE t.id = ?1",
            )
            .bind(pid)
            .fetch_optional(&mut *conn)
            .await?
        }
        None => None,
    };
    Ok(TaskDetail {
        task,
        statuses,
        subtasks,
        checklist,
        relations,
        comments,
        attachments,
        parent,
    })
}

fn check_priority(p: i64) -> Result<i64, LtError> {
    if (0..=4).contains(&p) {
        Ok(p)
    } else {
        Err(LtError::Invalid)
    }
}

/// started_at/completed_at after a move into `category` (first start sticks).
fn lifecycle(
    category: &str,
    started_at: Option<String>,
    completed_at: Option<String>,
    ts: &str,
) -> (Option<String>, Option<String>) {
    let started = match category {
        "started" | "completed" => started_at.or_else(|| Some(ts.to_string())),
        _ => started_at,
    };
    let completed = if category == "completed" {
        completed_at.or_else(|| Some(ts.to_string()))
    } else {
        None
    };
    (started, completed)
}

async fn set_labels(
    conn: &mut SqliteConnection,
    task: &str,
    labels: &[String],
) -> Result<(), LtError> {
    sqlx::query("DELETE FROM lt_task_labels WHERE task_id = ?1")
        .bind(task)
        .execute(&mut *conn)
        .await?;
    for label in labels {
        sqlx::query(
            "INSERT OR IGNORE INTO lt_task_labels (task_id, label_id)
             SELECT ?1, id FROM lt_labels WHERE id = ?2",
        )
        .bind(task)
        .bind(label)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn task_exists(conn: &mut SqliteConnection, id: &str) -> Result<bool, LtError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lt_tasks WHERE id = ?1)")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

async fn sprint_exists(conn: &mut SqliteConnection, id: &str) -> Result<bool, LtError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lt_sprints WHERE id = ?1)")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

/// Take the next task number of a list.
async fn next_number(conn: &mut SqliteConnection, list_id: &str) -> Result<i64, LtError> {
    let n: Option<i64> = sqlx::query_scalar("SELECT next_number FROM lt_lists WHERE id = ?1")
        .bind(list_id)
        .fetch_optional(&mut *conn)
        .await?;
    let n = n.ok_or(LtError::NotFound)?;
    sqlx::query("UPDATE lt_lists SET next_number = next_number + 1 WHERE id = ?1")
        .bind(list_id)
        .execute(&mut *conn)
        .await?;
    Ok(n)
}

pub(crate) async fn insert_task(
    conn: &mut SqliteConnection,
    input: &CreateTaskInput,
) -> Result<String, LtError> {
    let title = clean_name(&input.title)?;
    let priority = check_priority(input.priority.unwrap_or(0))?;
    check_dates(input.start_date.as_deref(), input.due_date.as_deref())?;
    let number = next_number(conn, &input.list_id).await?;
    let statuses = effective_statuses(conn, &input.list_id).await?;
    let status = match &input.status_id {
        Some(id) => statuses
            .iter()
            .find(|s| &s.id == id)
            .ok_or(LtError::Invalid)?,
        None => default_status(&statuses).ok_or(LtError::Invalid)?,
    };
    if let Some(parent) = &input.parent_id {
        if !task_exists(conn, parent).await? {
            return Err(LtError::NotFound);
        }
    }
    if let Some(sprint) = &input.sprint_id {
        if !sprint_exists(conn, sprint).await? {
            return Err(LtError::NotFound);
        }
    }
    let position: f64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), 0.0) + 1.0 FROM lt_tasks WHERE list_id = ?1",
    )
    .bind(&input.list_id)
    .fetch_one(&mut *conn)
    .await?;
    let ts = now();
    let (started, completed) = lifecycle(&status.category, None, None, &ts);
    let id = new_id();
    sqlx::query(
        "INSERT INTO lt_tasks (id, list_id, number, title, description, status_id, priority, assigned_to_me,
            start_date, due_date, estimate, parent_id, sprint_id, position, created_at, updated_at, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?17)",
    )
    .bind(&id)
    .bind(&input.list_id)
    .bind(number)
    .bind(&title)
    .bind(input.description.as_deref().filter(|d| !d.trim().is_empty()))
    .bind(&status.id)
    .bind(priority)
    .bind(input.assigned_to_me.unwrap_or(false))
    .bind(&input.start_date)
    .bind(&input.due_date)
    .bind(input.estimate)
    .bind(&input.parent_id)
    .bind(&input.sprint_id)
    .bind(position)
    .bind(&ts)
    .bind(started)
    .bind(completed)
    .execute(&mut *conn)
    .await?;
    set_labels(conn, &id, &input.label_ids).await?;
    Ok(id)
}

pub async fn create_task(pool: &SqlitePool, input: &CreateTaskInput) -> Result<TaskRow, LtError> {
    let mut tx = pool.begin().await?;
    let id = insert_task(&mut tx, input).await?;
    let row = load_task(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(row)
}

#[derive(sqlx::FromRow)]
struct RawTask {
    list_id: String,
    title: String,
    description: Option<String>,
    status_id: String,
    priority: i64,
    assigned_to_me: bool,
    start_date: Option<String>,
    due_date: Option<String>,
    estimate: Option<f64>,
    parent_id: Option<String>,
    sprint_id: Option<String>,
    position: f64,
    number: i64,
    started_at: Option<String>,
    completed_at: Option<String>,
}

/// True when `candidate` is `id` itself or one of its descendants.
async fn is_self_or_descendant(
    conn: &mut SqliteConnection,
    id: &str,
    candidate: &str,
) -> Result<bool, LtError> {
    let mut cursor = Some(candidate.to_string());
    let mut seen = HashSet::new();
    while let Some(current) = cursor {
        if current == id {
            return Ok(true);
        }
        if !seen.insert(current.clone()) {
            break;
        }
        cursor = sqlx::query_scalar("SELECT parent_id FROM lt_tasks WHERE id = ?1")
            .bind(&current)
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    }
    Ok(false)
}

pub async fn update_task(
    pool: &SqlitePool,
    id: &str,
    patch: &TaskPatch,
) -> Result<TaskRow, LtError> {
    let mut tx = pool.begin().await?;
    let mut t: RawTask = sqlx::query_as(
        "SELECT list_id, title, description, status_id, priority, assigned_to_me, start_date, due_date, estimate,
                parent_id, sprint_id, position, number, started_at, completed_at
         FROM lt_tasks WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(LtError::NotFound)?;

    if let Some(title) = &patch.title {
        t.title = clean_name(title)?;
    }
    if let Some(p) = patch.priority {
        t.priority = check_priority(p)?;
    }
    if let Some(d) = &patch.due_date {
        check_dates(d.as_deref(), None)?;
        t.due_date = d.clone();
    }
    if let Some(d) = &patch.start_date {
        check_dates(d.as_deref(), None)?;
        t.start_date = d.clone();
    }
    if let Some(a) = &patch.assignee_id {
        t.assigned_to_me = match a.as_deref() {
            None => false,
            Some(ME) => true,
            Some(_) => return Err(LtError::Invalid),
        };
    }
    if let Some(d) = &patch.description {
        t.description = d.clone().filter(|d| !d.trim().is_empty());
    }
    if let Some(e) = patch.estimate {
        if matches!(e, Some(v) if !(0.0..=1000.0).contains(&v)) {
            return Err(LtError::Invalid);
        }
        t.estimate = e;
    }
    if let Some(s) = &patch.cycle_id {
        if let Some(sprint) = s {
            if !sprint_exists(&mut tx, sprint).await? {
                return Err(LtError::NotFound);
            }
        }
        t.sprint_id = s.clone();
    }
    if let Some(p) = &patch.parent_id {
        if let Some(parent) = p {
            if !task_exists(&mut tx, parent).await? {
                return Err(LtError::NotFound);
            }
            if is_self_or_descendant(&mut tx, id, parent).await? {
                return Err(LtError::Invalid);
            }
        }
        t.parent_id = p.clone();
    }
    if let Some(pos) = patch.position {
        if !pos.is_finite() {
            return Err(LtError::Invalid);
        }
        t.position = pos;
    }

    let old_status = t.status_id.clone();
    let old_category: Option<String> =
        sqlx::query_scalar("SELECT category FROM lt_statuses WHERE id = ?1")
            .bind(&old_status)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(list) = patch.team_id.as_ref().filter(|l| **l != t.list_id) {
        t.number = next_number(&mut tx, list).await?;
        t.list_id = list.clone();
    }
    let statuses = effective_statuses(&mut tx, &t.list_id).await?;
    if let Some(status) = &patch.state_id {
        if !statuses.iter().any(|s| &s.id == status) {
            return Err(LtError::Invalid);
        }
        t.status_id = status.clone();
    } else if !statuses.iter().any(|s| s.id == t.status_id) {
        // Moved to a list with another workflow: keep the category if possible.
        let target = old_category
            .as_ref()
            .and_then(|c| statuses.iter().find(|s| &s.category == c))
            .or_else(|| statuses.first())
            .ok_or(LtError::Invalid)?;
        t.status_id = target.id.clone();
    }
    let ts = now();
    if t.status_id != old_status {
        let category = statuses
            .iter()
            .find(|s| s.id == t.status_id)
            .map(|s| s.category.clone())
            .unwrap_or_default();
        let (started, completed) =
            lifecycle(&category, t.started_at.take(), t.completed_at.take(), &ts);
        t.started_at = started;
        t.completed_at = completed;
    }

    sqlx::query(
        "UPDATE lt_tasks SET list_id = ?2, number = ?3, title = ?4, description = ?5, status_id = ?6, priority = ?7,
            assigned_to_me = ?8, start_date = ?9, due_date = ?10, estimate = ?11, parent_id = ?12, sprint_id = ?13,
            position = ?14, started_at = ?15, completed_at = ?16, updated_at = ?17
         WHERE id = ?1",
    )
    .bind(id)
    .bind(&t.list_id)
    .bind(t.number)
    .bind(&t.title)
    .bind(&t.description)
    .bind(&t.status_id)
    .bind(t.priority)
    .bind(t.assigned_to_me)
    .bind(&t.start_date)
    .bind(&t.due_date)
    .bind(t.estimate)
    .bind(&t.parent_id)
    .bind(&t.sprint_id)
    .bind(t.position)
    .bind(&t.started_at)
    .bind(&t.completed_at)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    if let Some(labels) = &patch.label_ids {
        set_labels(&mut tx, id, labels).await?;
    }
    let row = load_task(&mut tx, id).await?;
    tx.commit().await?;
    Ok(row)
}

/// Delete a task and all of its subtasks (with their checklists, comments, links and relations).
pub async fn delete_task(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let mut tx = pool.begin().await?;
    if !task_exists(&mut tx, id).await? {
        return Err(LtError::NotFound);
    }
    let mut doomed = vec![id.to_string()];
    let mut queue = VecDeque::from([id.to_string()]);
    while let Some(current) = queue.pop_front() {
        let children: Vec<String> =
            sqlx::query_scalar("SELECT id FROM lt_tasks WHERE parent_id = ?1")
                .bind(&current)
                .fetch_all(&mut *tx)
                .await?;
        for child in children {
            if !doomed.contains(&child) {
                doomed.push(child.clone());
                queue.push_back(child);
            }
        }
    }
    for task in &doomed {
        sqlx::query("DELETE FROM lt_tasks WHERE id = ?1")
            .bind(task)
            .execute(&mut *tx)
            .await?;
    }
    prune_orphans(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

async fn touch(conn: &mut SqliteConnection, task: &str) -> Result<(), LtError> {
    sqlx::query("UPDATE lt_tasks SET updated_at = ?2 WHERE id = ?1")
        .bind(task)
        .bind(now())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

// ── Checklist, comments, links, relations ───────────────────────────────────

pub async fn add_checklist_item(
    pool: &SqlitePool,
    task: &str,
    body: &str,
) -> Result<ChecklistItem, LtError> {
    let body = clean_name(body)?;
    let mut tx = pool.begin().await?;
    if !task_exists(&mut tx, task).await? {
        return Err(LtError::NotFound);
    }
    let position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM lt_checklist_items WHERE task_id = ?1",
    )
    .bind(task)
    .fetch_one(&mut *tx)
    .await?;
    let id = new_id();
    sqlx::query("INSERT INTO lt_checklist_items (id, task_id, body, done, position) VALUES (?1, ?2, ?3, 0, ?4)")
        .bind(&id)
        .bind(task)
        .bind(&body)
        .bind(position)
        .execute(&mut *tx)
        .await?;
    touch(&mut tx, task).await?;
    tx.commit().await?;
    Ok(ChecklistItem {
        id,
        task_id: task.to_string(),
        body,
        done: false,
        position,
    })
}

pub async fn update_checklist_item(
    pool: &SqlitePool,
    id: &str,
    body: Option<&str>,
    done: Option<bool>,
) -> Result<ChecklistItem, LtError> {
    let mut tx = pool.begin().await?;
    let mut item: ChecklistItem = sqlx::query_as(
        "SELECT id, task_id, body, done, position FROM lt_checklist_items WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(LtError::NotFound)?;
    if let Some(body) = body {
        item.body = clean_name(body)?;
    }
    if let Some(done) = done {
        item.done = done;
    }
    sqlx::query("UPDATE lt_checklist_items SET body = ?2, done = ?3 WHERE id = ?1")
        .bind(id)
        .bind(&item.body)
        .bind(item.done)
        .execute(&mut *tx)
        .await?;
    touch(&mut tx, &item.task_id).await?;
    tx.commit().await?;
    Ok(item)
}

pub async fn delete_checklist_item(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let done = sqlx::query("DELETE FROM lt_checklist_items WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(())
}

fn clean_body(body: &str) -> Result<String, LtError> {
    let body = body.trim();
    if body.is_empty() || body.len() > 100_000 {
        return Err(LtError::Invalid);
    }
    Ok(body.to_string())
}

pub async fn add_comment(pool: &SqlitePool, task: &str, body: &str) -> Result<Comment, LtError> {
    let body = clean_body(body)?;
    let mut tx = pool.begin().await?;
    if !task_exists(&mut tx, task).await? {
        return Err(LtError::NotFound);
    }
    let id = new_id();
    let ts = now();
    sqlx::query("INSERT INTO lt_comments (id, task_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
        .bind(&id)
        .bind(task)
        .bind(&body)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
    touch(&mut tx, task).await?;
    tx.commit().await?;
    Ok(Comment {
        id,
        task_id: task.to_string(),
        body,
        created_at: ts.clone(),
        updated_at: ts,
    })
}

pub async fn update_comment(pool: &SqlitePool, id: &str, body: &str) -> Result<Comment, LtError> {
    let body = clean_body(body)?;
    let ts = now();
    let done = sqlx::query("UPDATE lt_comments SET body = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id)
        .bind(&body)
        .bind(&ts)
        .execute(pool)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(sqlx::query_as(
        "SELECT id, task_id, body, created_at, updated_at FROM lt_comments WHERE id = ?1",
    )
    .bind(id)
    .fetch_one(pool)
    .await?)
}

pub async fn delete_comment(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let done = sqlx::query("DELETE FROM lt_comments WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(())
}

/// Attach a link; `url` must already be normalized (http/https).
pub async fn add_attachment(
    pool: &SqlitePool,
    task: &str,
    url: &str,
    title: Option<&str>,
) -> Result<Attachment, LtError> {
    let title = match title.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => clean_name(t)?,
        None => url.to_string(),
    };
    let mut tx = pool.begin().await?;
    if !task_exists(&mut tx, task).await? {
        return Err(LtError::NotFound);
    }
    let id = new_id();
    let ts = now();
    sqlx::query("INSERT INTO lt_attachments (id, task_id, title, url, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(&id)
        .bind(task)
        .bind(&title)
        .bind(url)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
    touch(&mut tx, task).await?;
    tx.commit().await?;
    Ok(Attachment {
        id,
        task_id: task.to_string(),
        title,
        url: url.to_string(),
        created_at: ts,
    })
}

pub async fn delete_attachment(pool: &SqlitePool, id: &str) -> Result<(), LtError> {
    let done = sqlx::query("DELETE FROM lt_attachments WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    if done.rows_affected() == 0 {
        return Err(LtError::NotFound);
    }
    Ok(())
}

/// `blocks` (task blocks related) or `related` (stored once, both directions read).
pub async fn create_relation(
    pool: &SqlitePool,
    task: &str,
    related: &str,
    kind: &str,
) -> Result<(), LtError> {
    if task == related || !matches!(kind, "blocks" | "related") {
        return Err(LtError::Invalid);
    }
    let mut tx = pool.begin().await?;
    if !task_exists(&mut tx, task).await? || !task_exists(&mut tx, related).await? {
        return Err(LtError::NotFound);
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM lt_relations WHERE type = ?3 AND
            ((task_id = ?1 AND related_id = ?2) OR (?3 = 'related' AND task_id = ?2 AND related_id = ?1)))",
    )
    .bind(task)
    .bind(related)
    .bind(kind)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        sqlx::query("INSERT INTO lt_relations (task_id, related_id, type) VALUES (?1, ?2, ?3)")
            .bind(task)
            .bind(related)
            .bind(kind)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Remove a relation as seen from `task` (`blocks`, `blocked_by` or `related`).
pub async fn delete_relation(
    pool: &SqlitePool,
    task: &str,
    related: &str,
    kind: &str,
) -> Result<(), LtError> {
    let (from, to, stored) = match kind {
        "blocks" => (task, related, "blocks"),
        "blocked_by" => (related, task, "blocks"),
        "related" => (task, related, "related"),
        _ => return Err(LtError::Invalid),
    };
    sqlx::query(
        "DELETE FROM lt_relations WHERE type = ?3 AND
            ((task_id = ?1 AND related_id = ?2) OR (?3 = 'related' AND task_id = ?2 AND related_id = ?1))",
    )
    .bind(from)
    .bind(to)
    .bind(stored)
    .execute(pool)
    .await?;
    Ok(())
}

/// Every local-tasks table, children first (the order a wipe deletes in).
pub const TABLES_CHILD_FIRST: [&str; 12] = [
    "lt_imports",
    "lt_attachments",
    "lt_comments",
    "lt_relations",
    "lt_checklist_items",
    "lt_task_labels",
    "lt_tasks",
    "lt_labels",
    "lt_sprints",
    "lt_statuses",
    "lt_lists",
    "lt_spaces",
];

pub(crate) async fn wipe_in(conn: &mut SqliteConnection) -> Result<(), LtError> {
    for t in TABLES_CHILD_FIRST {
        sqlx::query(&format!("DELETE FROM {t}"))
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Delete every local task, list, space and workflow.
pub async fn wipe(pool: &SqlitePool) -> Result<(), LtError> {
    let mut tx = pool.begin().await?;
    wipe_in(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    /// Seeded pool plus its list id and workflow.
    pub(crate) async fn seeded() -> (tempfile::TempDir, SqlitePool, String, Vec<Status>) {
        let (d, pool) = pool().await;
        ensure_seeded(&pool).await.unwrap();
        let tree = load_tree(&pool).await.unwrap();
        let list = tree.lists[0].id.clone();
        (d, pool, list, tree.statuses)
    }

    pub(crate) fn input(list: &str, title: &str) -> CreateTaskInput {
        CreateTaskInput {
            list_id: list.into(),
            title: title.into(),
            ..Default::default()
        }
    }

    fn status<'a>(statuses: &'a [Status], category: &str) -> &'a Status {
        statuses.iter().find(|s| s.category == category).unwrap()
    }

    #[tokio::test]
    async fn seeding_creates_one_space_list_and_default_workflow_once() {
        let (_d, pool) = pool().await;
        ensure_seeded(&pool).await.unwrap();
        ensure_seeded(&pool).await.unwrap();
        let tree = load_tree(&pool).await.unwrap();
        assert_eq!(tree.spaces.len(), 1);
        assert_eq!(tree.lists[0].key, "TASK");
        let names: Vec<_> = tree.statuses.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            ["Backlog", "To do", "In progress", "Done", "Canceled"]
        );
    }

    #[tokio::test]
    async fn tasks_are_numbered_per_list_and_default_to_todo() {
        let (_d, pool, list, statuses) = seeded().await;
        let a = create_task(&pool, &input(&list, "First")).await.unwrap();
        let b = create_task(&pool, &input(&list, "Second")).await.unwrap();
        assert!(a.id.starts_with("lt_"));
        assert_eq!(
            (a.identifier.as_str(), b.identifier.as_str()),
            ("TASK-1", "TASK-2")
        );
        assert_eq!(
            a.state_id.as_deref(),
            Some(status(&statuses, "unstarted").id.as_str())
        );
        assert_eq!(a.state_type, "unstarted");
        assert_eq!(a.team_key.as_deref(), Some("TASK"));
        assert_eq!(a.project_name.as_deref(), Some("Personal"));
        assert_eq!(a.assignee_id, None);
    }

    #[tokio::test]
    async fn rejects_bad_input() {
        let (_d, pool, list, _) = seeded().await;
        assert!(matches!(
            create_task(&pool, &input(&list, "  ")).await,
            Err(LtError::Invalid)
        ));
        let mut bad = input(&list, "x");
        bad.due_date = Some("tomorrow".into());
        assert!(matches!(
            create_task(&pool, &bad).await,
            Err(LtError::Invalid)
        ));
        let mut prio = input(&list, "x");
        prio.priority = Some(9);
        assert!(matches!(
            create_task(&pool, &prio).await,
            Err(LtError::Invalid)
        ));
        assert!(matches!(
            create_task(&pool, &input("nope", "x")).await,
            Err(LtError::NotFound)
        ));
    }

    #[tokio::test]
    async fn update_moves_status_and_tracks_lifecycle() {
        let (_d, pool, list, statuses) = seeded().await;
        let t = create_task(&pool, &input(&list, "Work")).await.unwrap();
        let started = update_task(
            &pool,
            &t.id,
            &TaskPatch {
                state_id: Some(status(&statuses, "started").id.clone()),
                assignee_id: Some(Some(ME.into())),
                due_date: Some(Some("2026-11-02".into())),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(started.started_at.is_some());
        assert_eq!(started.assignee_id.as_deref(), Some(ME));
        assert_eq!(started.due_date.as_deref(), Some("2026-11-02"));
        let done = update_task(
            &pool,
            &t.id,
            &TaskPatch {
                state_id: Some(status(&statuses, "completed").id.clone()),
                due_date: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(done.state_type, "completed");
        assert_eq!(done.due_date, None);
        let completed_at: Option<String> =
            sqlx::query_scalar("SELECT completed_at FROM lt_tasks WHERE id = ?1")
                .bind(&t.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(completed_at.is_some());
        assert!(matches!(
            update_task(
                &pool,
                &t.id,
                &TaskPatch {
                    assignee_id: Some(Some("linear-user".into())),
                    ..Default::default()
                }
            )
            .await,
            Err(LtError::Invalid)
        ));
    }

    #[tokio::test]
    async fn moving_lists_renumbers_and_keeps_the_status_category() {
        let (_d, pool, list, statuses) = seeded().await;
        let space = load_tree(&pool).await.unwrap().spaces[0].id.clone();
        let other = create_list(&pool, &space, "Ops", "ops").await.unwrap();
        assert_eq!(other.key, "OPS");
        // Give the new list its own workflow.
        set_statuses(
            &pool,
            &other.id,
            vec![
                StatusInput {
                    id: None,
                    name: "Open".into(),
                    category: "unstarted".into(),
                    color: "#999999".into(),
                },
                StatusInput {
                    id: None,
                    name: "Doing".into(),
                    category: "started".into(),
                    color: "#cc9900".into(),
                },
            ],
        )
        .await
        .unwrap();
        let t = create_task(&pool, &input(&list, "Move me")).await.unwrap();
        let t = update_task(
            &pool,
            &t.id,
            &TaskPatch {
                state_id: Some(status(&statuses, "started").id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let moved = update_task(
            &pool,
            &t.id,
            &TaskPatch {
                team_id: Some(other.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(moved.identifier, "OPS-1");
        assert_eq!(moved.state_name.as_deref(), Some("Doing"));
    }

    #[tokio::test]
    async fn duplicate_and_bad_list_keys_are_rejected() {
        let (_d, pool, _, _) = seeded().await;
        let space = load_tree(&pool).await.unwrap().spaces[0].id.clone();
        assert!(matches!(
            create_list(&pool, &space, "Again", "task").await,
            Err(LtError::DuplicateKey)
        ));
        assert!(matches!(
            create_list(&pool, &space, "Bad", "1AB").await,
            Err(LtError::Invalid)
        ));
        assert!(matches!(
            create_list(&pool, &space, "Long", "ABCDEFG").await,
            Err(LtError::Invalid)
        ));
    }

    #[tokio::test]
    async fn replacing_a_workflow_remaps_tasks() {
        let (_d, pool, list, statuses) = seeded().await;
        let space = load_tree(&pool).await.unwrap().spaces[0].id.clone();
        let t = create_task(&pool, &input(&list, "Remap")).await.unwrap();
        let todo = status(&statuses, "unstarted");
        // Drop "To do"; keep the rest; add "Ready" (unstarted).
        let mut inputs: Vec<StatusInput> = statuses
            .iter()
            .filter(|s| s.id != todo.id)
            .map(|s| StatusInput {
                id: Some(s.id.clone()),
                name: s.name.clone(),
                category: s.category.clone(),
                color: s.color.clone(),
            })
            .collect();
        inputs.insert(
            1,
            StatusInput {
                id: None,
                name: "Ready".into(),
                category: "unstarted".into(),
                color: "#aabbcc".into(),
            },
        );
        let next = set_statuses(&pool, &space, inputs).await.unwrap();
        assert_eq!(next.len(), 5);
        assert_eq!(next[1].name, "Ready");
        let moved = get_task(&pool, &t.id).await.unwrap();
        assert_eq!(moved.state_name.as_deref(), Some("Ready"));
        // A space workflow can't be emptied; a list override can be cleared.
        assert!(matches!(
            set_statuses(&pool, &space, vec![]).await,
            Err(LtError::Invalid)
        ));
        let cleared = set_statuses(&pool, &list, vec![]).await.unwrap();
        assert_eq!(cleared.len(), 5);
    }

    #[tokio::test]
    async fn copying_a_space_status_into_a_list_override_follows_the_copy() {
        let (_d, pool, list, statuses) = seeded().await;
        let t = create_task(&pool, &input(&list, "Copy")).await.unwrap();
        let inputs = statuses
            .iter()
            .map(|s| StatusInput {
                id: Some(s.id.clone()),
                name: format!("{} (list)", s.name),
                category: s.category.clone(),
                color: s.color.clone(),
            })
            .collect();
        set_statuses(&pool, &list, inputs).await.unwrap();
        let moved = get_task(&pool, &t.id).await.unwrap();
        assert_eq!(moved.state_name.as_deref(), Some("To do (list)"));
    }

    #[tokio::test]
    async fn calendar_unscheduled_and_filters() {
        let (_d, pool, list, _) = seeded().await;
        let mut a = input(&list, "June");
        a.due_date = Some("2026-06-10".into());
        a.assigned_to_me = Some(true);
        create_task(&pool, &a).await.unwrap();
        let mut b = input(&list, "End");
        b.due_date = Some("2026-07-01".into());
        create_task(&pool, &b).await.unwrap();
        create_task(&pool, &input(&list, "Undated")).await.unwrap();
        let june = list_calendar(&pool, "2026-06-01", "2026-07-01", &Filters::default())
            .await
            .unwrap();
        assert_eq!(
            june.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
            ["June"]
        );
        let unscheduled = list_unscheduled(&pool, &Filters::default()).await.unwrap();
        assert_eq!(unscheduled.len(), 1);
        let mine = list_tasks(
            &pool,
            &Filters {
                assignee_id: Some(ME.into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(mine.len(), 1);
        let someone = list_tasks(
            &pool,
            &Filters {
                assignee_id: Some("linear-user".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(someone.is_empty());
        let opts = filter_options(&pool).await.unwrap();
        assert_eq!(opts.teams[0].key, "TASK");
        assert_eq!(opts.projects[0].name, "Personal");
    }

    #[tokio::test]
    async fn relations_read_both_directions_and_delete_cascades_subtasks() {
        let (_d, pool, list, _) = seeded().await;
        let a = create_task(&pool, &input(&list, "A")).await.unwrap();
        let b = create_task(&pool, &input(&list, "B")).await.unwrap();
        create_relation(&pool, &a.id, &b.id, "blocks")
            .await
            .unwrap();
        create_relation(&pool, &a.id, &b.id, "blocks")
            .await
            .unwrap();
        let rels = relations(&pool).await.unwrap();
        assert_eq!(rels.len(), 2);
        let from_b = rels.iter().find(|r| r.issue_id == b.id).unwrap();
        assert_eq!(
            (from_b.r#type.as_str(), from_b.related_id.as_str()),
            ("blocked_by", a.id.as_str())
        );
        assert!(matches!(
            create_relation(&pool, &a.id, &a.id, "blocks").await,
            Err(LtError::Invalid)
        ));

        let mut child = input(&list, "Child");
        child.parent_id = Some(a.id.clone());
        let child = create_task(&pool, &child).await.unwrap();
        add_checklist_item(&pool, &child.id, "step").await.unwrap();
        // A parent can't become its own descendant's child.
        assert!(matches!(
            update_task(
                &pool,
                &a.id,
                &TaskPatch {
                    parent_id: Some(Some(child.id.clone())),
                    ..Default::default()
                }
            )
            .await,
            Err(LtError::Invalid)
        ));
        let detail = get_detail(&pool, &a.id).await.unwrap();
        assert_eq!(detail.subtasks.len(), 1);
        assert_eq!(detail.relations.len(), 1);

        delete_task(&pool, &a.id).await.unwrap();
        assert!(matches!(
            get_task(&pool, &child.id).await,
            Err(LtError::NotFound)
        ));
        assert!(relations(&pool).await.unwrap().is_empty());
        let items: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lt_checklist_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(items, 0);
        delete_relation(&pool, &b.id, &a.id, "blocked_by")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn checklist_comments_links_and_labels() {
        let (_d, pool, list, _) = seeded().await;
        let t = create_task(&pool, &input(&list, "Bits")).await.unwrap();
        let item = add_checklist_item(&pool, &t.id, "one").await.unwrap();
        update_checklist_item(&pool, &item.id, None, Some(true))
            .await
            .unwrap();
        let row = get_task(&pool, &t.id).await.unwrap();
        assert_eq!((row.checklist_done, row.checklist_total), (1, 1));
        let c = add_comment(&pool, &t.id, "hello").await.unwrap();
        assert_eq!(
            update_comment(&pool, &c.id, "edited").await.unwrap().body,
            "edited"
        );
        add_attachment(&pool, &t.id, "https://example.com", None)
            .await
            .unwrap();
        let bug = create_label(&pool, "Bug", "#cc3333").await.unwrap();
        assert_eq!(
            create_label(&pool, "bug", "#000000").await.unwrap().id,
            bug.id
        );
        let labeled = update_task(
            &pool,
            &t.id,
            &TaskPatch {
                label_ids: Some(vec![bug.id.clone(), "missing".into()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(labeled.labels.len(), 1);
        assert_eq!(labeled.link_count, 1);
        let detail = get_detail(&pool, &t.id).await.unwrap();
        assert_eq!(
            (
                detail.comments.len(),
                detail.attachments.len(),
                detail.checklist.len()
            ),
            (1, 1, 1)
        );
    }

    #[tokio::test]
    async fn sprints_number_per_space_and_clear_on_delete() {
        let (_d, pool, list, _) = seeded().await;
        let space = load_tree(&pool).await.unwrap().spaces[0].id.clone();
        let s1 = create_sprint(
            &pool,
            &space,
            "Sprint 1",
            Some("2026-10-25"),
            Some("2026-11-07"),
        )
        .await
        .unwrap();
        let s2 = create_sprint(&pool, &space, "Sprint 2", None, None)
            .await
            .unwrap();
        assert_eq!((s1.number, s2.number), (1, 2));
        let t = create_task(&pool, &input(&list, "In sprint"))
            .await
            .unwrap();
        let t = update_task(
            &pool,
            &t.id,
            &TaskPatch {
                cycle_id: Some(Some(s1.id.clone())),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            (t.cycle_name.as_deref(), t.cycle_number),
            (Some("Sprint 1"), Some(1))
        );
        delete_sprint(&pool, &s1.id).await.unwrap();
        assert_eq!(get_task(&pool, &t.id).await.unwrap().sprint_id, None);
    }

    #[tokio::test]
    async fn neutral_statuses_expand_per_list_and_wipe_clears_everything() {
        let (_d, pool, list, _) = seeded().await;
        let neutral = neutral_statuses(&pool).await.unwrap();
        assert_eq!(neutral.len(), 5);
        assert!(neutral.iter().all(|s| s.team_id == list));
        create_task(&pool, &input(&list, "x")).await.unwrap();
        let space = load_tree(&pool).await.unwrap().spaces[0].id.clone();
        delete_space(&pool, &space).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lt_tasks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
        ensure_seeded(&pool).await.unwrap();
        wipe(&pool).await.unwrap();
        assert!(load_tree(&pool).await.unwrap().spaces.is_empty());
    }
}
