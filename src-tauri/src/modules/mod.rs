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
}

impl ModuleId {
    pub const ALL: [ModuleId; 7] = [
        ModuleId::Linear,
        ModuleId::Github,
        ModuleId::Slack,
        ModuleId::Llm,
        ModuleId::Docs,
        ModuleId::Reports,
        ModuleId::LinkPreviews,
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

static MANIFEST: [ModuleSpec; 7] = [
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
        requires: &[C::DocsSource],
        optional: &[],
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
            if db::load_setting(pool, "linear_viewer_id").await?.is_some() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use sqlx::SqlitePool;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
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
    fn docs_needs_a_docs_source() {
        let on = set(&[ModuleId::Docs]);
        assert_eq!(
            missing_capabilities(ModuleId::Docs, &on),
            vec![Capability::DocsSource]
        );
        assert!(!is_active(ModuleId::Docs, &on));
        assert!(is_active(
            ModuleId::Docs,
            &set(&[ModuleId::Docs, ModuleId::Github])
        ));
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
