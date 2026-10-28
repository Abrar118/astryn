//! Local-tasks commands: thin wrappers over `crate::local_tasks`. Every command
//! is owned by the `local-tasks` module. Backup files are chosen with native
//! dialogs here in Rust, so no file path crosses the IPC boundary.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::{AppState, CmdError};
use crate::db::issues::{FilterOptions, RelationItem};
use crate::local_tasks::backup;
use crate::local_tasks::db::{
    self, Attachment, ChecklistItem, Comment, CreateTaskInput, Filters, Label, List, NeutralStatus,
    Space, Sprint, Status, StatusInput, TaskDetail, TaskPatch, TaskRow, Tree,
};
use crate::local_tasks::import::{self, ImportResult};
use crate::local_tasks::LtError;

impl From<LtError> for CmdError {
    fn from(e: LtError) -> Self {
        match e {
            LtError::Db(_) => CmdError::Internal,
            LtError::NotFound => CmdError::LocalTaskNotFound,
            LtError::DuplicateKey => CmdError::DuplicateListKey,
            LtError::Invalid => CmdError::InvalidLocalInput,
            LtError::BadBackup => CmdError::InvalidBackup,
            LtError::Io => CmdError::FileRead,
        }
    }
}

/// `<app data>/backups`, where daily and safety snapshots live.
pub(crate) fn backups_dir(app: &AppHandle) -> Result<PathBuf, CmdError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| CmdError::Internal)?
        .join("backups"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// Folder holding the automatic backups (shown so the user can find them).
    pub folder: String,
    /// Date of the newest daily backup, if any.
    pub latest: Option<String>,
    pub count: usize,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarArgs {
    pub start: String,
    pub end: String,
    #[serde(flatten)]
    pub filters: Filters,
}

#[tauri::command]
pub async fn list_local_tree(state: State<'_, AppState>) -> Result<Tree, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    db::ensure_seeded(&state.pool).await?;
    Ok(db::load_tree(&state.pool).await?)
}

#[tauri::command]
pub async fn create_local_space(
    state: State<'_, AppState>,
    name: String,
) -> Result<Space, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::create_space(&state.pool, &name).await?)
}

#[tauri::command]
pub async fn rename_local_space(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::rename_space(&state.pool, &id, &name).await?)
}

#[tauri::command]
pub async fn delete_local_space(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_space(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn create_local_list(
    state: State<'_, AppState>,
    space_id: String,
    name: String,
    key: String,
) -> Result<List, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::create_list(&state.pool, &space_id, &name, &key).await?)
}

#[tauri::command]
pub async fn update_local_list(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    key: Option<String>,
) -> Result<List, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::update_list(&state.pool, &id, name.as_deref(), key.as_deref()).await?)
}

#[tauri::command]
pub async fn delete_local_list(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_list(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn set_local_statuses(
    state: State<'_, AppState>,
    scope_id: String,
    statuses: Vec<StatusInput>,
) -> Result<Vec<Status>, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::set_statuses(&state.pool, &scope_id, statuses).await?)
}

#[tauri::command]
pub async fn create_local_sprint(
    state: State<'_, AppState>,
    space_id: String,
    name: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Sprint, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::create_sprint(
        &state.pool,
        &space_id,
        &name,
        start_date.as_deref(),
        end_date.as_deref(),
    )
    .await?)
}

#[tauri::command]
pub async fn update_local_sprint(
    state: State<'_, AppState>,
    id: String,
    name: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::update_sprint(
        &state.pool,
        &id,
        &name,
        start_date.as_deref(),
        end_date.as_deref(),
    )
    .await?)
}

#[tauri::command]
pub async fn delete_local_sprint(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_sprint(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn create_local_label(
    state: State<'_, AppState>,
    name: String,
    color: String,
) -> Result<Label, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::create_label(&state.pool, &name, &color).await?)
}

#[tauri::command]
pub async fn delete_local_label(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_label(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn list_local_tasks(
    state: State<'_, AppState>,
    args: Filters,
) -> Result<Vec<TaskRow>, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::list_tasks(&state.pool, &args).await?)
}

#[tauri::command]
pub async fn list_local_calendar(
    state: State<'_, AppState>,
    args: CalendarArgs,
) -> Result<Vec<TaskRow>, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::list_calendar(&state.pool, &args.start, &args.end, &args.filters).await?)
}

#[tauri::command]
pub async fn list_local_unscheduled(
    state: State<'_, AppState>,
    args: Filters,
) -> Result<Vec<TaskRow>, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::list_unscheduled(&state.pool, &args).await?)
}

#[tauri::command]
pub async fn list_local_relations(
    state: State<'_, AppState>,
) -> Result<Vec<RelationItem>, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::relations(&state.pool).await?)
}

#[tauri::command]
pub async fn list_local_filter_options(
    state: State<'_, AppState>,
) -> Result<FilterOptions, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::filter_options(&state.pool).await?)
}

#[tauri::command]
pub async fn list_local_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<NeutralStatus>, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::neutral_statuses(&state.pool).await?)
}

#[tauri::command]
pub async fn get_local_task_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<TaskDetail, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::get_detail(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn create_local_task(
    state: State<'_, AppState>,
    input: CreateTaskInput,
) -> Result<TaskRow, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::create_task(&state.pool, &input).await?)
}

#[tauri::command]
pub async fn update_local_task(
    state: State<'_, AppState>,
    id: String,
    patch: TaskPatch,
) -> Result<TaskRow, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::update_task(&state.pool, &id, &patch).await?)
}

#[tauri::command]
pub async fn delete_local_task(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_task(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn add_local_checklist_item(
    state: State<'_, AppState>,
    task_id: String,
    body: String,
) -> Result<ChecklistItem, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::add_checklist_item(&state.pool, &task_id, &body).await?)
}

#[tauri::command]
pub async fn update_local_checklist_item(
    state: State<'_, AppState>,
    id: String,
    body: Option<String>,
    done: Option<bool>,
) -> Result<ChecklistItem, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::update_checklist_item(&state.pool, &id, body.as_deref(), done).await?)
}

#[tauri::command]
pub async fn delete_local_checklist_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_checklist_item(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn add_local_comment(
    state: State<'_, AppState>,
    task_id: String,
    body: String,
) -> Result<Comment, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::add_comment(&state.pool, &task_id, &body).await?)
}

#[tauri::command]
pub async fn update_local_comment(
    state: State<'_, AppState>,
    id: String,
    body: String,
) -> Result<Comment, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::update_comment(&state.pool, &id, &body).await?)
}

#[tauri::command]
pub async fn delete_local_comment(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_comment(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn add_local_attachment(
    state: State<'_, AppState>,
    task_id: String,
    url: String,
    title: Option<String>,
) -> Result<Attachment, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    let url = super::normalize_attachment_url(&url).ok_or(CmdError::InvalidUrl)?;
    Ok(db::add_attachment(&state.pool, &task_id, &url, title.as_deref()).await?)
}

#[tauri::command]
pub async fn delete_local_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_attachment(&state.pool, &id).await?)
}

#[tauri::command]
pub async fn create_local_relation(
    state: State<'_, AppState>,
    task_id: String,
    related_id: String,
    kind: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::create_relation(&state.pool, &task_id, &related_id, &kind).await?)
}

#[tauri::command]
pub async fn delete_local_relation(
    state: State<'_, AppState>,
    task_id: String,
    related_id: String,
    kind: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    Ok(db::delete_relation(&state.pool, &task_id, &related_id, &kind).await?)
}

/// Write today's automatic backup if it is missing (`today` is the Dhaka date)
/// and report where backups live.
#[tauri::command]
pub async fn ensure_local_tasks_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    today: String,
) -> Result<BackupStatus, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    let dir = backups_dir(&app)?;
    backup::ensure_daily(&state.pool, &dir, &today).await?;
    let dates = backup::daily_backups(&dir);
    Ok(BackupStatus {
        folder: dir.to_string_lossy().into_owned(),
        latest: dates.first().cloned(),
        count: dates.len(),
    })
}

/// Save a backup where the user picks (native dialog). False when cancelled.
#[tauri::command]
pub async fn export_local_tasks_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    today: String,
) -> Result<bool, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    use tauri_plugin_dialog::DialogExt;
    if !crate::local_tasks::valid_date(&today) {
        return Err(CmdError::InvalidLocalInput);
    }
    let doc = backup::snapshot(&state.pool).await?;
    let name = format!("astryn-local-tasks-{today}.json");
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(name)
            .add_filter("Astryn backup", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|_| CmdError::Internal)?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(false);
    };
    backup::write_file(&path, &doc).await?;
    Ok(true)
}

/// Replace all local tasks with a backup the user picks (native dialog). The
/// current data is snapshotted first. False when cancelled.
#[tauri::command]
pub async fn restore_local_tasks_backup(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    use tauri_plugin_dialog::DialogExt;
    let dir = backups_dir(&app)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Astryn backup", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| CmdError::Internal)?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(false);
    };
    let doc = backup::read_file(&path).await?;
    backup::validate(&doc)?;
    backup::write_safety(&state.pool, &dir, "before-restore").await?;
    backup::restore(&state.pool, &doc).await?;
    Ok(true)
}

/// Copy a Linear team's cached issues into a local list. Needs Linear on too:
/// its cache is another module's data.
#[tauri::command]
pub async fn import_linear_to_local(
    state: State<'_, AppState>,
    team_id: String,
    list_id: String,
) -> Result<ImportResult, CmdError> {
    state.require(crate::modules::ModuleId::LocalTasks)?;
    state.require(crate::modules::ModuleId::Linear)?;
    let viewer = crate::db::load_me(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .map(|(id, _)| id);
    Ok(import::import_linear_team(&state.pool, &team_id, &list_id, viewer.as_deref()).await?)
}
