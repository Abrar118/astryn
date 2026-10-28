//! Module manifest: which integrations exist, what capabilities they provide,
//! and the rules deciding whether an enabled module is actually active.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::db;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModuleId {
    Linear,
    Github,
    Slack,
    Llm,
    Docs,
    Reports,
    LinkPreviews,
    Clickup,
}

impl ModuleId {
    pub const ALL: [ModuleId; 8] = [
        ModuleId::Linear,
        ModuleId::Github,
        ModuleId::Slack,
        ModuleId::Llm,
        ModuleId::Docs,
        ModuleId::Reports,
        ModuleId::LinkPreviews,
        ModuleId::Clickup,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    Tracker,
    Notifications,
    CodeHost,
    DocsSource,
    Chat,
    Llm,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleKind {
    Provider,
    Feature,
}

#[derive(Debug)]
pub struct ModuleSpec {
    pub id: ModuleId,
    pub kind: ModuleKind,
    pub provides: &'static [Capability],
    pub requires: &'static [Capability],
    pub optional: &'static [Capability],
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModuleState {
    pub enabled: BTreeSet<ModuleId>,
    pub onboarded: bool,
}

use Capability as C;
use ModuleKind as K;

static MANIFEST: [ModuleSpec; 8] = [
    ModuleSpec {
        id: ModuleId::Linear,
        kind: K::Provider,
        provides: &[C::Tracker, C::Notifications],
        requires: &[],
        optional: &[],
    },
    ModuleSpec {
        id: ModuleId::Github,
        kind: K::Provider,
        provides: &[C::CodeHost, C::DocsSource],
        requires: &[],
        optional: &[],
    },
    ModuleSpec {
        id: ModuleId::Slack,
        kind: K::Provider,
        provides: &[C::Chat],
        requires: &[],
        optional: &[],
    },
    ModuleSpec {
        id: ModuleId::Llm,
        kind: K::Provider,
        provides: &[C::Llm],
        requires: &[],
        optional: &[],
    },
    ModuleSpec {
        id: ModuleId::Docs,
        kind: K::Feature,
        provides: &[],
        // Local folders need no provider; GitHub adds repository sources.
        requires: &[],
        optional: &[C::DocsSource],
    },
    ModuleSpec {
        id: ModuleId::Reports,
        kind: K::Feature,
        provides: &[],
        requires: &[C::Tracker],
        optional: &[C::CodeHost, C::Llm],
    },
    ModuleSpec {
        id: ModuleId::LinkPreviews,
        kind: K::Feature,
        provides: &[],
        requires: &[],
        optional: &[],
    },
    ModuleSpec {
        id: ModuleId::Clickup,
        kind: K::Provider,
        provides: &[C::DocsSource],
        requires: &[],
        optional: &[],
    },
];

pub fn spec(id: ModuleId) -> &'static ModuleSpec {
    MANIFEST
        .iter()
        .find(|s| s.id == id)
        .expect("every ModuleId has a manifest entry")
}

/// True when any enabled provider module supplies `cap`.
pub fn has_capability(cap: Capability, enabled: &BTreeSet<ModuleId>) -> bool {
    enabled.iter().any(|&id| {
        let s = spec(id);
        s.kind == ModuleKind::Provider && s.provides.contains(&cap)
    })
}

/// Required capabilities of `id` that no enabled provider supplies.
pub fn missing_capabilities(id: ModuleId, enabled: &BTreeSet<ModuleId>) -> Vec<Capability> {
    spec(id)
        .requires
        .iter()
        .copied()
        .filter(|&c| !has_capability(c, enabled))
        .collect()
}

/// Enabled and with every required capability available.
pub fn is_active(id: ModuleId, enabled: &BTreeSet<ModuleId>) -> bool {
    enabled.contains(&id) && missing_capabilities(id, enabled).is_empty()
}

const ENABLED_KEY: &str = "modules_enabled";
const ONBOARDED_KEY: &str = "modules_onboarded";

fn all_enabled() -> BTreeSet<ModuleId> {
    ModuleId::ALL.into_iter().collect()
}

/// Load persisted module state. A missing `modules_enabled` key means either a
/// fresh install (empty, not onboarded, nothing persisted) or an install that
/// predates modules (identified by a stored Linear viewer id): enable
/// everything once and persist it. Malformed JSON falls back to everything on.
pub async fn load_state(pool: &SqlitePool) -> Result<ModuleState, sqlx::Error> {
    let onboarded_flag = db::load_setting(pool, ONBOARDED_KEY).await?.as_deref() == Some("true");
    match db::load_setting(pool, ENABLED_KEY).await? {
        Some(raw) => match serde_json::from_str::<Vec<String>>(&raw) {
            Ok(ids) => {
                let enabled = ids
                    .iter()
                    .filter_map(|s| {
                        serde_json::from_value::<ModuleId>(serde_json::Value::String(s.clone()))
                            .ok()
                    })
                    .collect();
                Ok(ModuleState {
                    enabled,
                    onboarded: onboarded_flag,
                })
            }
            Err(_) => Ok(ModuleState {
                enabled: all_enabled(),
                onboarded: true,
            }),
        },
        None => {
            let existing = db::load_setting(pool, "linear_viewer_id").await?.is_some()
                || db::load_setting(pool, "github_login").await?.is_some()
                || sqlx::query_scalar::<_, i64>(
                    "SELECT (EXISTS(SELECT 1 FROM issues) OR EXISTS(SELECT 1 FROM slack_messages))",
                )
                .fetch_one(pool)
                .await?
                    != 0;
            if existing {
                let state = ModuleState {
                    enabled: all_enabled(),
                    onboarded: true,
                };
                save_state(pool, &state).await?;
                Ok(state)
            } else {
                Ok(ModuleState {
                    enabled: BTreeSet::new(),
                    onboarded: false,
                })
            }
        }
    }
}

pub async fn save_state(pool: &SqlitePool, state: &ModuleState) -> Result<(), sqlx::Error> {
    let json = serde_json::to_string(&state.enabled).expect("module ids serialize");
    let mut tx = pool.begin().await?;
    for (k, v) in [
        (ENABLED_KEY, json.as_str()),
        (
            ONBOARDED_KEY,
            if state.onboarded { "true" } else { "false" },
        ),
    ] {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(k)
        .bind(v)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Management and provider-status commands that are always callable.
#[cfg(test)]
pub const CORE_COMMANDS: &[&str] = &[
    "list_modules",
    "set_enabled_modules",
    "remove_module_data",
    "get_connection_status",
    "get_github_status",
    "get_slack_status",
    "get_llm_config",
    "get_docs_status",
    "get_clickup_status",
];

/// The module that owns a registered Tauri command, if it is not core.
#[cfg(test)]
pub fn command_owner(name: &str) -> Option<ModuleId> {
    match name {
        "set_linear_key"
        | "clear_linear_key"
        | "test_linear_connection"
        | "sync_issues"
        | "list_calendar_issues"
        | "list_unscheduled"
        | "list_issues"
        | "list_relations"
        | "list_filter_options"
        | "get_issue_detail"
        | "load_linear_image"
        | "update_issue"
        | "create_issue"
        | "list_users"
        | "list_notifications"
        | "list_labels"
        | "list_cycles"
        | "list_workflow_states"
        | "delete_issue"
        | "create_issue_relation"
        | "create_attachment_link"
        | "update_attachment"
        | "delete_attachment"
        | "upload_file"
        | "get_me"
        | "create_comment"
        | "update_comment"
        | "delete_comment"
        | "add_reaction"
        | "remove_reaction"
        | "create_label" => Some(ModuleId::Linear),
        "fetch_link_preview" => Some(ModuleId::LinkPreviews),
        "sync_github_prs"
        | "list_github_prs"
        | "set_github_repo_favorite"
        | "list_github_repositories"
        | "get_github_pr_detail"
        | "get_github_pr_diff"
        | "get_github_contributions"
        | "sync_github_contributions"
        | "set_github_token"
        | "clear_github_token"
        | "test_github_connection" => Some(ModuleId::Github),
        "set_slack_credentials"
        | "clear_slack_token"
        | "detect_slack_credentials"
        | "sync_slack_catchup"
        | "test_slack_connection"
        | "get_slack_catchup"
        | "get_slack_conversation_messages"
        | "slack_deep_link" => Some(ModuleId::Slack),
        "sync_docs"
        | "list_docs_sources"
        | "add_docs_source"
        | "rename_docs_source"
        | "remove_docs_source"
        | "list_docs_tree"
        | "get_doc_content"
        | "add_local_docs_source"
        | "get_doc_pdf"
        | "add_clickup_docs_source" => Some(ModuleId::Docs),
        "set_clickup_token" | "clear_clickup_token" | "test_clickup_connection" => {
            Some(ModuleId::Clickup)
        }
        "set_llm_config" | "clear_llm_config" | "test_llm_connection" => Some(ModuleId::Llm),
        "generate_report" => Some(ModuleId::Reports),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use sqlx::SqlitePool;

    #[test]
    fn every_registered_command_has_an_owner_or_is_core() {
        let src = include_str!("../lib.rs").replace("\r\n", "\n");
        let list = src
            .split("generate_handler![")
            .nth(1)
            .unwrap()
            .split("])")
            .next()
            .unwrap();
        let unguarded: Vec<&str> = list
            .split(',')
            .map(|s| s.trim().rsplit("::").next().unwrap())
            .filter(|s| !s.is_empty())
            .filter(|n| command_owner(n).is_none() && !CORE_COMMANDS.contains(n))
            .collect();
        assert!(unguarded.is_empty(), "unguarded commands: {unguarded:?}");
    }

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    #[test]
    fn owned_commands_call_require_for_their_owner() {
        for (file, src) in [
            ("mod.rs", include_str!("../commands/mod.rs")),
            ("github.rs", include_str!("../commands/github.rs")),
            ("slack.rs", include_str!("../commands/slack.rs")),
            ("docs.rs", include_str!("../commands/docs.rs")),
            ("clickup.rs", include_str!("../commands/clickup.rs")),
            ("reports.rs", include_str!("../commands/reports.rs")),
        ] {
            let src = src.replace("\r\n", "\n");
            for chunk in src.split("#[tauri::command]").skip(1) {
                let name = chunk
                    .split("fn ")
                    .nth(1)
                    .unwrap()
                    .split('(')
                    .next()
                    .unwrap();
                let body = chunk
                    .split(
                        "{
",
                    )
                    .nth(1)
                    .unwrap_or("");
                match command_owner(name) {
                    Some(id) => assert!(
                        body.trim_start().starts_with(&format!(
                            "state.require(crate::modules::ModuleId::{id:?})?;"
                        )),
                        "{file}: {name} must start with require({id:?})"
                    ),
                    None => assert!(CORE_COMMANDS.contains(&name), "{file}: {name}"),
                }
            }
        }
    }

    #[test]
    fn enabling_another_module_does_not_enable_docs() {
        let off = ModuleState {
            enabled: BTreeSet::from([ModuleId::Github]),
            onboarded: true,
        };
        assert!(crate::commands::require_in(&off, ModuleId::Docs).is_err());
        let on = ModuleState {
            enabled: BTreeSet::from([ModuleId::Docs]),
            onboarded: true,
        };
        assert!(crate::commands::require_in(&on, ModuleId::Docs).is_ok());
    }

    #[tokio::test]
    async fn fresh_install_starts_empty_and_not_onboarded() {
        let (_d, pool) = pool().await;
        let s = load_state(&pool).await.unwrap();
        assert!(s.enabled.is_empty());
        assert!(!s.onboarded);
    }

    #[tokio::test]
    async fn existing_install_enables_everything_once() {
        let (_d, pool) = pool().await;
        db::save_setting(&pool, "linear_viewer_id", "u1")
            .await
            .unwrap();
        let s = load_state(&pool).await.unwrap();
        assert_eq!(s.enabled.len(), ModuleId::ALL.len());
        assert!(s.onboarded);
        assert_eq!(
            db::load_setting(&pool, "modules_onboarded")
                .await
                .unwrap()
                .as_deref(),
            Some("true")
        );
    }

    #[tokio::test]
    async fn github_login_alone_marks_an_existing_install() {
        let (_d, pool) = pool().await;
        db::save_setting(&pool, "github_login", "octocat")
            .await
            .unwrap();
        let s = load_state(&pool).await.unwrap();
        assert_eq!(s.enabled.len(), ModuleId::ALL.len());
        assert!(s.onboarded);
    }

    #[tokio::test]
    async fn unknown_ids_are_dropped_and_bad_json_falls_back() {
        let (_d, pool) = pool().await;
        db::save_setting(&pool, "modules_enabled", r#"["slack","teams"]"#)
            .await
            .unwrap();
        db::save_setting(&pool, "modules_onboarded", "true")
            .await
            .unwrap();
        assert_eq!(
            load_state(&pool).await.unwrap().enabled,
            set(&[ModuleId::Slack])
        );
        db::save_setting(&pool, "modules_enabled", "{nope")
            .await
            .unwrap();
        let s = load_state(&pool).await.unwrap();
        assert_eq!(s.enabled.len(), ModuleId::ALL.len());
        assert!(s.onboarded);
    }

    #[tokio::test]
    async fn stray_onboarded_flag_is_ignored_on_fresh_install() {
        let (_d, pool) = pool().await;
        db::save_setting(&pool, "modules_onboarded", "true")
            .await
            .unwrap();
        let s = load_state(&pool).await.unwrap();
        assert!(s.enabled.is_empty());
        assert!(!s.onboarded);
    }

    #[tokio::test]
    async fn save_then_load_round_trips() {
        let (_d, pool) = pool().await;
        let st = ModuleState {
            enabled: set(&[ModuleId::Linear, ModuleId::Docs]),
            onboarded: true,
        };
        save_state(&pool, &st).await.unwrap();
        assert_eq!(load_state(&pool).await.unwrap(), st);
    }

    fn set(ids: &[ModuleId]) -> BTreeSet<ModuleId> {
        ids.iter().copied().collect()
    }

    #[test]
    fn docs_works_without_a_provider_for_local_folders() {
        // Local folders need no provider, so Docs is active on its own; GitHub
        // (or another docs-source provider) only adds remote sources.
        let on = set(&[ModuleId::Docs]);
        assert!(missing_capabilities(ModuleId::Docs, &on).is_empty());
        assert!(is_active(ModuleId::Docs, &on));
        assert_eq!(spec(ModuleId::Docs).optional, &[Capability::DocsSource]);
    }

    #[test]
    fn clickup_is_a_docs_source_provider() {
        assert!(has_capability(
            Capability::DocsSource,
            &set(&[ModuleId::Clickup])
        ));
        assert_eq!(
            serde_json::to_string(&ModuleId::Clickup).unwrap(),
            "\"clickup\""
        );
    }

    #[test]
    fn reports_optional_capabilities_do_not_block() {
        assert!(is_active(
            ModuleId::Reports,
            &set(&[ModuleId::Reports, ModuleId::Linear])
        ));
        assert!(!is_active(
            ModuleId::Reports,
            &set(&[ModuleId::Reports, ModuleId::Github, ModuleId::Llm])
        ));
    }

    #[test]
    fn providers_are_active_iff_enabled() {
        assert!(is_active(ModuleId::Slack, &set(&[ModuleId::Slack])));
        assert!(!is_active(ModuleId::Slack, &set(&[])));
    }

    #[test]
    fn ids_serialize_kebab_case() {
        assert_eq!(
            serde_json::to_string(&ModuleId::LinkPreviews).unwrap(),
            "\"link-previews\""
        );
        assert_eq!(
            serde_json::to_string(&Capability::CodeHost).unwrap(),
            "\"code-host\""
        );
    }

    #[test]
    fn every_id_has_a_spec() {
        for id in ModuleId::ALL {
            assert_eq!(spec(id).id, id);
        }
    }
}
