//! Screens the owner can switch off on top of their module (backlog item 2).
//! Stored as the set of *disabled* screens so new screens default to on.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::db;

/// Ids match the frontend view ids, which are already persisted in tab layouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ScreenId {
    #[serde(rename = "list")]
    Issues,
    #[serde(rename = "this-week")]
    ThisWeek,
    #[serde(rename = "graph")]
    Dependencies,
    #[serde(rename = "inbox")]
    Inbox,
}

const DISABLED_KEY: &str = "screens_disabled";

/// Missing key or malformed JSON means every screen is on; unknown ids are dropped.
pub async fn load_disabled(pool: &SqlitePool) -> Result<BTreeSet<ScreenId>, sqlx::Error> {
    let Some(raw) = db::load_setting(pool, DISABLED_KEY).await? else {
        return Ok(BTreeSet::new());
    };
    let ids = serde_json::from_str::<Vec<serde_json::Value>>(&raw).unwrap_or_default();
    Ok(ids
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect())
}

pub async fn save_disabled(
    pool: &SqlitePool,
    disabled: &BTreeSet<ScreenId>,
) -> Result<(), sqlx::Error> {
    let json = serde_json::to_string(disabled).expect("screen ids serialize");
    db::save_setting(pool, DISABLED_KEY, &json).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    #[tokio::test]
    async fn missing_key_means_everything_on() {
        let (_d, pool) = pool().await;
        assert!(load_disabled(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn round_trips_and_uses_view_ids() {
        let (_d, pool) = pool().await;
        let set = BTreeSet::from([ScreenId::Inbox, ScreenId::Dependencies]);
        save_disabled(&pool, &set).await.unwrap();
        assert_eq!(load_disabled(&pool).await.unwrap(), set);
        let raw = db::load_setting(&pool, DISABLED_KEY)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(raw, r#"["graph","inbox"]"#);
    }

    #[tokio::test]
    async fn unknown_ids_dropped_and_bad_json_falls_back_to_all_on() {
        let (_d, pool) = pool().await;
        db::save_setting(&pool, DISABLED_KEY, r#"["inbox","calendar",3]"#)
            .await
            .unwrap();
        assert_eq!(
            load_disabled(&pool).await.unwrap(),
            BTreeSet::from([ScreenId::Inbox])
        );
        db::save_setting(&pool, DISABLED_KEY, "{nope")
            .await
            .unwrap();
        assert!(load_disabled(&pool).await.unwrap().is_empty());
    }
}
