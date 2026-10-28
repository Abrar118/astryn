//! Local tasks: a tracker kept entirely in SQLite (the source of truth, not a
//! cache). See docs/superpowers/specs/2026-10-28-local-tasks-design.md.

pub mod backup;
pub mod db;
pub mod import;

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, thiserror::Error)]
pub enum LtError {
    #[error("database error")]
    Db(#[from] sqlx::Error),
    #[error("not found")]
    NotFound,
    #[error("duplicate list key")]
    DuplicateKey,
    #[error("invalid input")]
    Invalid,
    #[error("invalid backup")]
    BadBackup,
    #[error("file read error")]
    Io,
    #[error("file write error")]
    Write,
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A fresh `lt_`-prefixed id (the prefix lets the frontend route it to this tracker).
pub fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let count = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut parts = [0u64; 2];
    for (i, part) in parts.iter_mut().enumerate() {
        // RandomState is seeded from OS randomness, so ids differ across runs.
        let mut h = RandomState::new().build_hasher();
        h.write_u128(nanos);
        h.write_u64(count);
        h.write_usize(i);
        *part = h.finish();
    }
    format!("lt_{:016x}{:08x}", parts[0], parts[1] as u32)
}

/// Current UTC instant, RFC 3339.
pub fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Years a task date may fall in; anything else is a typo (and would make the
/// timeline span centuries).
pub const DATE_YEARS: std::ops::RangeInclusive<i32> = 1970..=2200;

/// A real `YYYY-MM-DD` calendar day (no time zone) within `DATE_YEARS`.
pub fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    if !(digits(0..4) && digits(5..7) && digits(8..10)) {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        s[0..4].parse::<i32>(),
        s[5..7].parse::<u8>(),
        s[8..10].parse::<u8>(),
    ) else {
        return false;
    };
    DATE_YEARS.contains(&year)
        && time::Month::try_from(month)
            .ok()
            .and_then(|m| time::Date::from_calendar_date(year, m, day).ok())
            .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_prefixed_and_unique() {
        let a = new_id();
        let b = new_id();
        assert!(a.starts_with("lt_") && a.len() == 27);
        assert_ne!(a, b);
    }

    #[test]
    fn dates_are_validated() {
        assert!(valid_date("2026-10-28"));
        assert!(!valid_date("2026-13-01"));
        assert!(!valid_date("2026-1-01"));
        assert!(!valid_date("../etc/pas"));
        assert!(!valid_date("2026-02-31"));
        assert!(!valid_date("2026-04-31"));
        assert!(valid_date("2028-02-29"));
        assert!(!valid_date("9999-12-31"));
        assert!(!valid_date("0001-01-01"));
    }
}
