use crate::link_preview::LinkPreview;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// A small bounded, TTL'd in-memory cache for link previews. `now` is injected
/// so the logic is deterministic under test. Eviction is insertion-order
/// (oldest inserted dropped first) once `capacity` is exceeded. This is the
/// only in-memory cache in the app; preview metadata is never persisted.
pub struct PreviewCache {
    capacity: usize,
    ttl: Duration,
    /// key -> (inserted_at, value). Insertion order tracked separately.
    entries: HashMap<String, (Instant, LinkPreview)>,
    order: Vec<String>,
}

impl PreviewCache {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            capacity: capacity.max(1),
            ttl,
            entries: HashMap::new(),
            order: Vec::new(),
        }
    }

    pub fn get(&mut self, key: &str, now: Instant) -> Option<LinkPreview> {
        let fresh = match self.entries.get(key) {
            Some((inserted, value)) if now.duration_since(*inserted) < self.ttl => {
                Some(value.clone())
            }
            Some(_) => None, // expired
            None => return None,
        };
        if fresh.is_none() {
            self.remove(key);
        }
        fresh
    }

    pub fn put(&mut self, key: String, value: LinkPreview, now: Instant) {
        if self.entries.contains_key(&key) {
            self.order.retain(|k| k != &key);
        }
        self.entries.insert(key.clone(), (now, value));
        self.order.push(key);
        while self.order.len() > self.capacity {
            let oldest = self.order.remove(0);
            self.entries.remove(&oldest);
        }
    }

    fn remove(&mut self, key: &str) {
        self.entries.remove(key);
        self.order.retain(|k| k != key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(url: &str) -> LinkPreview {
        LinkPreview {
            requested_url: url.into(),
            resolved_url: url.into(),
            title: Some("t".into()),
            description: None,
            site_name: None,
            image_data_url: None,
        }
    }

    #[test]
    fn returns_fresh_entry() {
        let t0 = Instant::now();
        let mut c = PreviewCache::new(4, Duration::from_secs(60));
        c.put("k".into(), sample("k"), t0);
        assert!(c.get("k", t0 + Duration::from_secs(10)).is_some());
    }

    #[test]
    fn expires_after_ttl() {
        let t0 = Instant::now();
        let mut c = PreviewCache::new(4, Duration::from_secs(60));
        c.put("k".into(), sample("k"), t0);
        assert!(c.get("k", t0 + Duration::from_secs(61)).is_none());
    }

    #[test]
    fn evicts_oldest_over_capacity() {
        let t0 = Instant::now();
        let mut c = PreviewCache::new(2, Duration::from_secs(60));
        c.put("a".into(), sample("a"), t0);
        c.put("b".into(), sample("b"), t0 + Duration::from_secs(1));
        c.put("c".into(), sample("c"), t0 + Duration::from_secs(2)); // evicts "a"
        let now = t0 + Duration::from_secs(3);
        assert!(c.get("a", now).is_none());
        assert!(c.get("b", now).is_some());
        assert!(c.get("c", now).is_some());
    }

    #[test]
    fn miss_returns_none() {
        let mut c = PreviewCache::new(2, Duration::from_secs(60));
        assert!(c.get("absent", Instant::now()).is_none());
    }
}
